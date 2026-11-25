import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {listen} from '../server/index.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {createTursoAccounts} from '../server/turso-accounts.mjs';
import {startTursoFixture} from './turso-fixture.mjs';
import {forward} from '../static-host/shared/proxy.mjs';
import {schema62,write62} from '../legacy/v62.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const images=()=>{
  // Generate new seeded pixels in memory. The smaller JPEG models the photo
  // compression step of the journal editor; the AI history holds the large original.
  const code=`import io,struct,sys,random
from PIL import Image
data=random.Random(6406).randbytes(2048*2048*3)
im=Image.frombytes('RGB',(2048,2048),data)
for picture,q,sub in [(im,90 if sys.argv[1]=='near-limit' else 91,0 if sys.argv[1]=='near-limit' else 2),(im.resize((512,512)),76,2)]:
 b=io.BytesIO();picture.save(b,format='JPEG',quality=q,subsampling=sub);out=b.getvalue()
 sys.stdout.buffer.write(struct.pack('>I',len(out))+out)`;
  const r=spawnSync(process.env.LYCHEE_TEST_PYTHON||'python',['-c',code,process.env.LYCHEE_TEST_LARGE_JPEG??'standard'],{maxBuffer:10*1024*1024,windowsHide:true});
  if(r.status!==0)throw Error('Image delivery test requires Python 3.9+ and Pillow');
  const size=r.stdout.readUInt32BE(0);
  return {large:r.stdout.subarray(4,4+size),album:r.stdout.subarray(8+size)};
};
const route=(garden,user)=>'/g/'+garden+'/api/for/'+user+'/phone';
function actor(origin,cookie=''){
  return {async call(path,body,expected=200){
    const r=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    if(r.status!==expected){
      const failure=await r.json().catch(()=>({}));
      assert.fail(path.split('?')[0]+' HTTP '+r.status+' '+String(failure.error??'').slice(0,110));
    }
    const next=r.headers.getSetCookie().find(x=>x.startsWith('__Host-lychee-account='));
    if(next)cookie=next.split(';')[0];
    return r;
  },get cookie(){return cookie;}};
}

async function mobileBridge(backend){
  const server=createServer(async(req,res)=>{
    try{
      const bytes=[];for await(const part of req)bytes.push(part);
      const request=new Request(origin+req.url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(bytes):undefined});
      const result=await forward({request,env:{LYCHEE_API_ORIGIN:'https://local-test.invalid'}},(target,init)=>{
        const url=new URL(target);assert.equal(url.origin,'https://local-test.invalid');
        if(init.method==='POST')init.headers.set('origin',backend);
        return fetch(backend+url.pathname+url.search,init);
      });
      const headers=Object.fromEntries(result.headers);if(result.headers.has('set-cookie'))headers['set-cookie']=result.headers.getSetCookie();
      res.writeHead(result.status,headers);
      for await(const chunk of result.body??[])res.write(chunk);res.end();
    }catch{res.writeHead(500).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port;
  return {origin,close:()=>new Promise(done=>server.close(done))};
}

test('2048-square generated JPEG and linked album survive legacy and private garden delivery, restart and download',async t=>{
  const {large,album}=images();assert.ok(large.length>1024**2&&large.length<8*1024**2);assert.ok(album.length*4/3<384000);
  const calls=[];
  const provider=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/api/v3/images/generations'){res.writeHead(404).end();return;}
    const chunks=[];for await(const b of req)chunks.push(b);
    const q=JSON.parse(Buffer.concat(chunks));calls.push({size:q.size,reference:!!q.image});
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{b64_json:large.toString('base64')}]}));
  });
  provider.listen(0,'127.0.0.1');await once(provider,'listening');
  const fixture=await startTursoFixture(),db=fixture.sqlite,client=await createTursoClient(fixture);
  const testProviderOrigin='http://127.0.0.1:'+provider.address().port;
  const config={storage:'turso',turso:fixture,testProviderOrigin};
  let app,bridge;
  t.after(async()=>{if(bridge)await bridge.close();if(app)await app.close();client.close();await fixture.close();await new Promise(done=>provider.close(done));});
  const passwords=[1,2,3].map(()=>randomBytes(16).toString('hex'));
  db.exec('CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 3),username TEXT UNIQUE COLLATE NOCASE NOT NULL,salt TEXT NOT NULL,verifier TEXT NOT NULL); CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER NOT NULL,expires INTEGER NOT NULL)');
  for(const [i,p] of passwords.entries()){
    const salt=randomBytes(16).toString('hex');
    db.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(i+1,'图片样本'+(i+1),salt,pbkdf2Sync(p,salt,100000,32,'sha256').toString('hex'));
  }
  const accounts=await createTursoAccounts(client);
  assert.equal((await accounts.importLegacy()).imported,3);
  app=await listen(config);bridge=await mobileBridge(app.url);
  const first=actor(app.url),second=actor(bridge.origin),third=actor(bridge.origin);
  const users=[];
  for(const [i,a] of [first,second,third].entries()){
    await a.call('/api/v640/account',{mode:'login',name:'图片样本'+(i+1),password:passwords[i]});
    users.push((await (await a.call('/api/v640/workspace')).json()).account.id);
  }
  const privateGarden=(await (await first.call('/api/v640/workspace',{action:'create',name:'隔离图片园'})).json()).activeGardenId;
  const all=[];
  for(const g of ['legacy',privateGarden]){
    const base=route(g,users[0]),prompt='画一颗荔枝。';
    const draft={type:'v62-image',prompt,ratio:'1:1',style:'自由创作',requestId:randomUUID()};
    const result=await (await first.call(base,draft)).json();
    const img=base+'?v62=image&id='+result.id;
    const same=actor(bridge.origin,first.cookie);
    assert.deepEqual((await (await same.call(base+'?v62=images')).json()).images.map(x=>x.id),[result.id]);
    for(const transport of [first,same]){
      const bytes=await transport.call(img),attachment=await transport.call(img+'&download=1');
      assert.equal(bytes.headers.get('content-type'),'image/jpeg');assert.equal(hash(Buffer.from(await bytes.arrayBuffer())),hash(large));
      assert.equal(attachment.headers.get('content-disposition'),'attachment; filename="lychee-image.jpg"');
      assert.equal(hash(Buffer.from(await attachment.arrayBuffer())),hash(large));
    }
    // A generated AI history is personal; the shared appointment album holds
    // the explicitly published photo for this garden's members.
    const date='2026-12-16',title='测试约定',albumKey=JSON.stringify([title,date]),post=randomUUID();
    await same.call(base,{type:'goal',title,date});
    await same.call(base,{type:'journal-post',id:post,kind:'plain',body:'测试照片',picture:album.toString('base64'),options:[],prompt:'',album:albumKey});
    const list='?album='+encodeURIComponent(albumKey);
    assert.deepEqual((await (await first.call(base+list)).json()).photos.map(x=>x.id),[post]);
    if(g==='legacy'){
      for(const [i,peer] of [second,third].entries()){
        const peerBase=route(g,users[i+1]);
        assert.deepEqual((await (await peer.call(peerBase+'?v62=images')).json()).images,[]);
        assert.deepEqual((await (await peer.call(peerBase+list)).json()).photos.map(x=>x.id),[post]);
        assert.equal(hash(Buffer.from(await(await peer.call(peerBase+'?image='+post)).arrayBuffer())),hash(album));
      }
    }else await second.call(route(g,users[1])+list,null,403);
    all.push({garden:g,image:result.id,post,list,draft});
  }
  const parts=db.prepare('SELECT COUNT(*) n FROM v62_ai_image_parts WHERE id=?').get(all[0].image).n;
  assert.equal(parts,Math.ceil(large.toString('base64').length/180000));
  await bridge.close();bridge=null;await app.close();app=null;
  app=await listen(config);bridge=await mobileBridge(app.url);
  const returning=actor(bridge.origin,first.cookie);
  for(const {garden,image,post,list,draft} of all){
    const base=route(garden,users[0]);
    assert.equal((await(await returning.call(base+'?v62=images')).json()).images[0].id,image);
    assert.equal(hash(Buffer.from(await(await returning.call(base+'?v62=image&id='+image)).arrayBuffer())),hash(large));
    assert.deepEqual((await(await returning.call(base+list)).json()).photos.map(x=>x.id),[post]);
    assert.equal(hash(Buffer.from(await(await returning.call(base+'?image='+post)).arrayBuffer())),hash(album));
    const replay=await(await returning.call(base,draft)).json();
    assert.equal(replay.id,image);
  }
  assert.deepEqual(calls,[{size:'2048x2048',reference:false},{size:'2048x2048',reference:false}]);
  t.diagnostic(JSON.stringify({dimensions:[2048,2048],bytes:large.length,sha256:hash(large),parts,albumBytes:album.length,providerCalls:calls.length,gardens:all.length,originalMembers:3}));
  if(process.env.LYCHEE_VERIFY_IMAGE_EXE){
    const {checkNativeImage}=await import('./image-delivery-native.mjs');
    await checkNativeImage(t,{origin:app.url,exe:process.env.LYCHEE_VERIFY_IMAGE_EXE,user:users[0],password:passwords[0],
      sample:all[0],large,album});
    assert.deepEqual(calls[2],{size:'2048x2048',reference:false});assert.equal(calls.length,3);
  }
});

test('original V6.3.3 image handler reports the same 502 TypeError for two distinct loopback transport failures',async t=>{
  const sqlite=new DatabaseSync(':memory:');for(const statement of schema62)sqlite.exec(statement);
  const db={prepare(sql){return {bind(...args){return {run(){return {meta:{changes:sqlite.prepare(sql).run(...args).changes}};}};}};}};
  const modes=['before-headers','mid-body','missing-image','invalid-json'];
  const local=createServer(async(req,res)=>{
    for await(const _ of req){}
    const mode=modes.shift();
    if(mode==='before-headers'){req.socket.destroy();return;}
    if(mode==='mid-body'){
      res.writeHead(200,{'content-type':'application/json','content-length':200});
      res.write('{"data":[',()=>setTimeout(()=>res.destroy(),40));return;
    }
    res.writeHead(200,{'content-type':'application/json'}).end(mode==='missing-image'?'{"data":[]}':'invalid JSON');
  });
  local.listen(0,'127.0.0.1');await once(local,'listening');
  const target='http://127.0.0.1:'+local.address().port,original=globalThis.fetch,events=[];
  t.after(async()=>{delete process.env.ARK_API_KEY;sqlite.close();await new Promise(done=>local.close(done));});
  process.env.ARK_API_KEY='fixture-local-only';
  t.mock.method(globalThis,'fetch',(url,init)=>{
    assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/images/generations');
    assert.equal(init.headers.Authorization,'Bearer fixture-local-only');
    return original(target,init);
  });
  t.mock.method(console,'info',(...values)=>events.push(values));
  for(const [i,name] of ['TypeError','TypeError','Error','SyntaxError'].entries()){
    const result=await write62(db,{type:'v62-image',prompt:'测试',style:'自由创作',ratio:'1:1'},'1');
    assert.equal(result.status,502);assert.deepEqual(events.at(-1),['lychee-ai-error','image',name]);
    const {error}=await result.json();
    assert.equal(error,i===2?'没有收到可保存的图片':'AI 暂时无法完成，请稍后重试');
  }
  assert.equal(modes.length,0);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM v62_ai_images').get().n,0);
});

test('second HTTP gateway refunds a timed-out garden request and the first cannot publish the late JPEG',async t=>{
  const {large}=images();
  let incoming,release;
  const arrived=new Promise(done=>{incoming=done;});
  const hold=new Promise(done=>{release=done;});
  let calls=0;
  const vendor=createServer(async(req,res)=>{
    for await(const _ of req){}
    assert.equal(req.url,'/api/v3/images/generations');
    calls++;incoming();await hold;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({data:[{b64_json:large.toString('base64')}]}));
  });
  vendor.listen(0,'127.0.0.1');await once(vendor,'listening');
  const fixture=await startTursoFixture(),opts={storage:'turso',turso:fixture,testProviderOrigin:'http://127.0.0.1:'+vendor.address().port};
  const first=await listen(opts),second=await listen(opts);
  t.after(async()=>{release();await Promise.all([first.close(),second.close()]);await fixture.close();await new Promise(done=>vendor.close(done));});
  const owner=actor(first.url);
  await owner.call('/api/v640/account',{mode:'register',name:'迟到图片测试',password:randomUUID()});
  const state=await(await owner.call('/api/v640/workspace',{action:'create',name:'临时园'})).json();
  const g=state.activeGardenId,id=state.account.id,base=route(g,id),observer=actor(second.url,owner.cookie);
  const request={type:'v62-image',prompt:'延迟图片',style:'自由创作',ratio:'1:1',requestId:randomUUID()};
  const response=owner.call(base,request,409);
  try{
    await Promise.race([arrived,response.then(()=>{throw Error('Provider request unexpectedly completed');})]);
    const inspect=()=>observer.call(base+'?v62=image-status&requestId='+request.requestId).then(r=>r.json());
    assert.equal((await inspect()).state,'pending');
    // Advance just this synthetic record's deadline; do not change a process clock.
    const old=fixture.sqlite.prepare('UPDATE mc_ai_image_receipts_v646 SET recheck_at=? WHERE account=? AND garden=? AND request_key=?').run(Date.now()-1,id,g,'request:'+request.requestId);
    assert.equal(old.changes,1);
    assert.equal((await inspect()).state,'refunded');
  }finally{release();}
  assert.equal((await(await response).json()).state,'refunded');
  assert.deepEqual((await(await observer.call(base+'?v62=images')).json()).images,[]);
  assert.equal((await(await observer.call(base+'?v62=status')).json()).remaining.image,10);
  assert.equal((await(await observer.call(base,request,409)).json()).state,'refunded');
  assert.equal(calls,1);
});
