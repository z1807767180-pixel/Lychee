import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {openAiQuota,operationFor,providerEndpoints,quotaImageId} from '../server/ai-quota.mjs';
import {imageSettlementMs} from '../server/image-receipts.mjs';
import {startTursoFixture} from './turso-fixture.mjs';
import {listen} from '../server/index.mjs';

const urls=Object.fromEntries([...providerEndpoints].map(([url,kind])=>[kind,url]));
const owner='test-account-one',friend='test-account-two',gardens=[randomUUID(),randomUUID()];
function operation(kind,index,requestId=randomUUID()){
  const fields={prompt:'测试 '+index,requestId};
  if(kind==='soup')return operationFor('/api/camp',{type:'soup',act:'send',mode:'solve',token:randomUUID(),requestId},gardens[index%2]);
  return operationFor('/api/phone',{...fields,type:kind==='image'?'v62-image':kind==='assist'?'v62-assist':'v62-chat'},gardens[index%2]);
}
function invoke(q,account,op,send){
  let saved=null;
  return q.run(account,op,async meter=>{
    const r=await meter(urls[op.kind],{},send);
    if(op.kind==='image'&&r.ok)saved={id:quotaImageId(account,op)};
    return r.ok?Response.json({ok:true}):Response.json({error:'上游拒绝'},{status:503});
  },{getImageInGarden:async()=>saved});
}
for(const remote of [false,true]){
  test((remote?'Turso HTTP':'SQLite')+' atomic account cap, cross-garden reads, idempotency and Beijing reset',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'lychee-quota-'));
    const fixture=remote?await startTursoFixture({databasePath:join(dir,'remote.sqlite')}):undefined;
    let now=Date.parse('2026-11-25T15:59:55Z'),paid=0;
    const settings={quotaFile:join(dir,'accounts.sqlite'),turso:fixture,clock:()=>now};
    const one=await openAiQuota(settings),two=await openAiQuota(settings);
    t.after(async()=>{one.close();two.close();await fixture?.close();await rm(dir,{recursive:true,force:true});});
    const success=async()=>{paid++;return Response.json({});};
    const kinds=['chat','assist','soup'];
    const chats=Array.from({length:24},(_,i)=>operation(kinds[i%3],i));
    const answers=await Promise.all(chats.map((op,i)=>invoke(i%2?one:two,owner,op,success)));
    assert.equal(answers.filter(r=>r.status===200).length,24);
    assert.equal(answers.filter(r=>r.status===429).length,0);
    const images=Array.from({length:17},(_,i)=>operation('image',i));
    const pictures=await Promise.all(images.map((op,i)=>invoke(i%2?one:two,owner,op,success)));
    assert.equal(pictures.filter(r=>r.status===200).length,15);
    assert.equal(pictures.filter(r=>r.status===429).length,2);
    const first=chats[answers.findIndex(r=>r.status===200)];
    assert.deepEqual(await (await invoke(two,owner,first,success)).json(),{ok:true});
    assert.equal(paid,39);
    assert.equal((await invoke(one,friend,first,success)).status,200);
    assert.equal(paid,40);
    assert.deepEqual((await one.status(owner)).remaining,{image:0});
    now=Date.parse('2026-11-25T16:00:00Z');
    assert.deepEqual((await two.status(owner)).remaining,{image:15});
    assert.equal((await two.status(owner)).resetAt,Date.parse('2026-11-26T16:00:00Z'));
    assert.equal((await invoke(two,owner,first,success)).status,200);
    assert.deepEqual((await one.status(owner)).used,{});
    assert.equal((await invoke(two,owner,operation('soup',1),success)).status,200);
    assert.equal(paid,41);
  });
}

for(const remote of [false,true]){
  test((remote?'Turso HTTP':'SQLite')+' image receipts recover a completed album, refund definite absence and keep one provider submission per key after process loss',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'lychee-image-receipt-'));
    const fixture=remote?await startTursoFixture({databasePath:join(dir,'remote.sqlite')}):undefined;
    const settings={quotaFile:join(dir,'accounts.sqlite'),...(fixture?{turso:{url:fixture.url,authToken:fixture.authToken}}:{})};
    let now=Date.parse('2026-11-25T04:00:00Z'),hits=0,unavailable=false;
    const q=await openAiQuota({...settings,clock:()=>now}),second=await openAiQuota({...settings,clock:()=>now});
    t.after(async()=>{q.close();second.close();await fixture?.close();await rm(dir,{recursive:true,force:true});});
    const pictures=new Map(),sealed=new Set(),garden=gardens[0];
    const probe=async(id,{sealIfMissing})=>{
      if(unavailable)throw Error('temporary album outage');
      if(pictures.has(id))return pictures.get(id);
      if(sealIfMissing)sealed.add(id);
      return null;
    };
    const delivery=(id,prompt)=>{if(!sealed.has(id))pictures.set(id,{id,prompt});};
    const opFor=(p,id=randomUUID())=>operationFor('/api/phone',{type:'v62-image',requestId:id,prompt:p,ratio:'1:1'},garden,now);
    const rawId=op=>op.key.slice('request:'.length);
    async function submit(op,provider,save){
      return q.run(owner,op,async meter=>{
        const response=await meter(urls.image,{},async()=>{hits++;return provider();});
        if(response.ok&&save)delivery(quotaImageId(owner,op),'试验图');
        return Response.json({ok:response.ok},{status:response.ok?200:502});
      },{getImageInGarden:probe});
    }
    // These failures all end with a positive no-image fence in the album.
    for(const [name,provider] of [
      ['上游500',()=>new Response(null,{status:500})],
      ['格式错误',()=>Response.json({data:[]})],
      ['请求中断',()=>{throw Error('upstream unavailable');}],
    ]){
      const op=opFor(name),r=await submit(op,provider,false);
      assert.equal(r.status,409);assert.equal((await r.json()).state,'refunded');
      assert.equal((await second.status(owner)).remaining.image,15);
      assert.ok(sealed.has(quotaImageId(owner,op)));
      const replay=await submit(op,()=>{throw Error('forbidden replay');},false);
      assert.equal((await replay.json()).state,'refunded');
    }
    assert.equal(hits,3);
    const ok=opFor('相册成功');
    const saved=await (await submit(ok,()=>Response.json({}),true)).json();
    assert.deepEqual(saved,{state:'ready',id:quotaImageId(owner,ok),prompt:'试验图'});
    const originalHits=hits;
    assert.deepEqual(await second.imageStatus(owner,garden,rawId(ok),probe),saved);
    const hidden=()=>{throw Error('wrong garden attempted an album read');};
    assert.deepEqual(await second.imageStatus(owner,gardens[1],rawId(ok),hidden),{state:'missing'});
    assert.deepEqual(await second.imageStatus(friend,garden,rawId(ok),hidden),{state:'missing'});
    assert.deepEqual(await (await submit(ok,()=>{},false)).json(),saved);
    assert.equal(hits,originalHits);assert.equal((await second.status(owner)).remaining.image,14);

    // Exit a separate OS process after the atomic provider reservation. Model
    // calls are replaced with a local callback that terminates the test process.
    async function crash(op){
      const program=`
        import {openAiQuota,providerEndpoints} from ${JSON.stringify(new URL('../server/ai-quota.mjs',import.meta.url).href)};
        const chunks=[];for await(const c of process.stdin)chunks.push(c);
        const {settings,account,op,now}=JSON.parse(Buffer.concat(chunks));
        const quota=await openAiQuota({...settings,clock:()=>now});
        const image=[...providerEndpoints].find(([,kind])=>kind==='image')[0];
        await quota.run(account,op,meter=>meter(image,{},()=>process.exit(42)),{getImageInGarden:async()=>null});
      `;
      const child=spawn(process.execPath,['--input-type=module','-e',program],{stdio:['pipe','ignore','pipe'],windowsHide:true});
      let error='';child.stderr.on('data',b=>{error+=b;});
      const end=new Promise((yes,no)=>{child.once('exit',yes);child.once('error',no);});
      child.stdin.end(JSON.stringify({settings,account:owner,op,now}));
      assert.equal(await end,42,error);
    }
    const lost=opFor('进程丢失、无图'), committed=opFor('进程丢失、图片已提交');
    await crash(lost);await crash(committed);
    assert.equal((await second.imageStatus(owner,garden,rawId(lost),probe)).state,'pending');
    assert.ok(!sealed.has(quotaImageId(owner,lost)));
    assert.equal((await second.status(owner)).remaining.image,12);
    delivery(quotaImageId(owner,committed),'已入册');
    assert.equal((await second.imageStatus(owner,garden,rawId(committed),probe)).state,'ready');
    now+=imageSettlementMs+1;
    unavailable=true;
    assert.equal((await second.imageStatus(owner,garden,rawId(lost),probe)).state,'pending');
    assert.equal((await second.status(owner,{gardenId:garden,getImageInGarden:probe})).remaining.image,12);
    unavailable=false;
    assert.equal((await second.status(owner,{gardenId:garden,getImageInGarden:probe})).remaining.image,13);
    assert.equal((await second.imageStatus(owner,garden,rawId(lost),probe)).state,'refunded');
    delivery(quotaImageId(owner,lost),'迟到的图片');assert.ok(!pictures.has(quotaImageId(owner,lost)));
    assert.equal((await (await submit(lost,()=>{},true)).json()).state,'refunded');
    assert.equal((await (await submit(committed,()=>{},false)).json()).id,quotaImageId(owner,committed));
    assert.equal(hits,originalHits);
    const slow=opFor('迟到的旧线程');
    let signal,release;
    const started=new Promise(done=>{signal=done;}),gate=new Promise(done=>{release=done;});
    const live=submit(slow,async()=>{signal();await gate;return Response.json({});},true);
    await started;
    const duplicate=await second.run(owner,slow,()=>{throw Error('duplicate dispatch');},{getImageInGarden:probe});
    assert.equal(duplicate.status,202);assert.equal((await duplicate.json()).state,'pending');
    now+=imageSettlementMs+1;
    assert.equal((await second.imageStatus(owner,garden,rawId(slow),probe)).state,'refunded');
    release();
    assert.equal((await (await live).json()).state,'refunded');
    assert.ok(!pictures.has(quotaImageId(owner,slow)));
    assert.equal((await q.status(owner)).remaining.image,13);
    assert.equal(hits,originalHits+1);
    const delayed=opFor('相册已提交但收据更新暂时失败');
    const faultDb=remote?fixture.sqlite:new DatabaseSync(settings.quotaFile);
    try{
      faultDb.exec("CREATE TRIGGER fixture_stop_receipt BEFORE UPDATE OF state ON mc_ai_image_receipts_v646 BEGIN SELECT RAISE(ABORT,'fixture write interruption'); END");
      const waiting=await submit(delayed,()=>Response.json({}),true);
      assert.equal(waiting.status,202);assert.equal((await waiting.json()).state,'pending');
      assert.ok(pictures.has(quotaImageId(owner,delayed)));
      faultDb.exec('DROP TRIGGER fixture_stop_receipt');
    }finally{if(!remote)faultDb.close();}
    assert.equal((await second.imageStatus(owner,garden,rawId(delayed),probe)).state,'ready');
    assert.equal((await (await submit(delayed,()=>{},false)).json()).id,quotaImageId(owner,delayed));
    assert.equal((await q.status(owner)).remaining.image,12);
    assert.equal(hits,originalHits+2);
  });
}

for(const remote of [false,true]){
  test((remote?'Turso HTTP':'SQLite')+' 6.4.5 repairs only exact prior-to-save failures in this account and Beijing day',async t=>{
    const dir=await mkdtemp(join(tmpdir(),'lychee-old-image-quota-'));
    const f=remote?await startTursoFixture():undefined,file=join(dir,'quota.sqlite');
    const q=await openAiQuota({quotaFile:file,turso:f,clock:()=>Date.parse('2026-11-25T04:00:00Z')});
    const raw=f?.sqlite??new DatabaseSync(file);
    t.after(async()=>{q.close();if(!f)raw.close();await f?.close();await rm(dir,{recursive:true,force:true});});
    const day='2026-11-25',prior='2026-11-24',op=operation('image',0),requests='mc_ai_quota_requests';
    const add=(id,acct,d,kind,status,body,sign='test')=>raw.prepare(`INSERT INTO ${requests}
      (account,request_key,signature,day,kind,consumed,response_status,response_body) VALUES(?,?,?,?,?,1,?,?)`).run(acct,id,sign,d,kind,status,body);
    const text=error=>JSON.stringify({error});
    const missing=text('没有收到可保存的图片');
    add(op.key,owner,day,'image',502,missing,op.signature);
    add('bad-format',owner,day,'image',502,text('图片格式或大小不支持'));
    add('upstream',owner,day,'image',502,text('AI 服务暂不可用（503）'));
    add('timeout',owner,day,'image',502,text('AI 响应超时，请稍后查看或重试'));
    add('generic',owner,day,'image',502,text('AI 暂时无法完成，请稍后重试'));
    add('pending',owner,day,'image',null,null);
    add('saved',owner,day,'image',200,JSON.stringify({id:randomUUID(),prompt:'old image'}));
    add('extra',owner,day,'image',502,JSON.stringify({error:'没有收到可保存的图片',extra:true}));
    add('wrong-status',owner,day,'image',503,missing);
    add('other-kind',owner,day,'chat',502,missing);
    add('other-account',friend,day,'image',502,missing);
    add('other-day',owner,prior,'image',502,missing);
    assert.deepEqual((await q.status(owner)).remaining,{image:9});
    const changes=()=>raw.prepare('SELECT total_changes() n').get().n;
    const first=changes();assert.deepEqual((await q.status(owner)).remaining,{image:9});assert.equal(changes(),first);
    const repaired=raw.prepare(`SELECT request_key FROM ${requests} WHERE consumed=0 ORDER BY request_key`).all().map(r=>r.request_key);
    assert.deepEqual(repaired,[op.key,'bad-format','upstream'].sort());
    assert.equal(raw.prepare(`SELECT response_body FROM ${requests} WHERE request_key=?`).get(op.key).response_body,missing);
    const history=await q.imageStatus(owner,op.gardenId,op.key.slice(8),()=>{throw Error('must not guess old image ID');});
    assert.deepEqual(history,{state:'missing'});
    const replay=await q.run(owner,op,()=>{throw Error('no provider replay');});
    assert.equal((await replay.json()).state,'refunded');
  });
}

test('definite provider refusal releases quota, uncertain send counts once, duplicate cannot disclose another garden reply',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-quota-error-'));
  let quota=await openAiQuota({quotaFile:join(dir,'account.sqlite')});
  t.after(async()=>{quota.close();await rm(dir,{recursive:true,force:true});});
  let sends=0;
  const no=async()=>{sends++;return new Response(null,{status:403});},timeout=async()=>{sends++;throw Error('Timeout');};
  const rejected=operation('image',0);
  for(let i=0;i<2;i++){
    const reply=await invoke(quota,owner,rejected,no);
    assert.equal(reply.status,409);assert.equal(reply.headers.get('x-lychee-ai-retry'),'new');
  }
  assert.equal(sends,1);
  assert.deepEqual((await quota.status(owner)).remaining,{image:15});
  const op=operation('chat',0);
  const uncertain=await invoke(quota,owner,op,timeout);
  assert.equal(uncertain.status,503);assert.equal(uncertain.headers.has('x-lychee-ai-retry'),false);
  quota.close();quota=await openAiQuota({quotaFile:join(dir,'account.sqlite')});
  assert.equal((await invoke(quota,owner,op,timeout)).status,503);
  assert.equal((await invoke(quota,owner,{...op,signature:'other-garden'},timeout)).status,409);
  assert.equal(sends,2);assert.equal((await quota.status(owner)).remaining.chat,undefined);
  const noSend=operation('assist',0);
  assert.equal((await quota.run(owner,noSend,()=>Response.json({error:'参数无效'},{status:400}))).status,400);
  assert.equal((await quota.status(owner)).remaining.chat,undefined);
  for(const act of ['start','hint','end'])assert.equal(operationFor('/api/camp',{type:'soup',act},gardens[0]),null);
  assert.equal(operationFor('/api/camp',{type:'soup',act:'send',mode:'chat'},gardens[0]),null);
});

test('normal HTTP account and two private gardens share one persisted quota on real libSQL client',async t=>{
  let hits=0;
  const provider=createServer(async(req,res)=>{
    for await(const part of req)void part;
    if(req.url!=='/chat/completions'){res.writeHead(404).end();return;}
    hits++;
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({
      choices:[{finish_reason:'stop',message:{role:'assistant',content:'本地模拟回复'}}],
    }));
  });
  await new Promise((ok,no)=>provider.once('error',no).listen(0,'127.0.0.1',ok));
  const fixture=await startTursoFixture();
  const settings={storage:'turso',turso:fixture,testProviderOrigin:'http://127.0.0.1:'+provider.address().port};
  let app=await listen(settings),cookie='';
  t.after(async()=>{await app.close();await fixture.close();await new Promise(r=>provider.close(r));});
  async function api(path,body){
    const response=await fetch(app.url+path,{method:body?'POST':'GET',
      headers:{cookie,origin:app.url,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    const next=response.headers.getSetCookie().find(c=>c.startsWith('__Host-lychee-account='));
    if(next)cookie=next.split(';')[0];
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
  }
  await api('/api/v640/account',{mode:'register',name:'配额验收',password:randomUUID()});
  const a=(await api('/api/v640/workspace',{action:'create',name:'测试甲园'})).activeGardenId;
  const b=(await api('/api/v640/workspace',{action:'create',name:'测试乙园'})).activeGardenId;
  const path=id=>'/g/'+id+'/api/phone';
  const assist={type:'v62-assist',prompt:'合成问答',requestId:randomUUID()};
  await api(path(a),assist);
  assert.equal((await api(path(b)+'?v62=status')).remaining.chat,undefined);
  await api(path(b),{type:'v62-chat',id:randomUUID(),prompt:'合成对话',thinking:false,web:false,requestId:randomUUID()});
  assert.deepEqual((await api('/g/'+a+'/api/camp?soup=1&room=solo')).aiQuota.used,{chat:2});
  await app.close();app=await listen(settings);
  assert.equal((await api(path(a),assist)).reply,'本地模拟回复');
  assert.equal((await api(path(b)+'?v62=status')).remaining.chat,undefined);
  assert.equal(hits,2);
});
