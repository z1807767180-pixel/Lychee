import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, pbkdf2Sync, randomBytes, randomUUID} from 'node:crypto';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {createServer as createHttpServer} from 'node:http';
import {createServer} from 'node:net';
import {createInterface} from 'node:readline';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve, sep} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';
import {composeOriginal} from '../server/compose-original.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {ensureTursoAccountsSchema} from '../server/turso-accounts.mjs';
import {migrateTursoLegacy} from '../server/turso-migrate.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const project=fileURLToPath(new URL('..',import.meta.url)), sibling=resolve(project,'../lychee-baseline');
const source=resolve(process.env.LYCHEE_TEST_LEGACY_SOURCE||join(sibling,'web-build'));
const windows=resolve(process.env.LYCHEE_TEST_LEGACY_WINDOWS||join(sibling,'windows-release'));
const parts=resolve(process.env.LYCHEE_TEST_RELEASE_PARTS||join(project,'../../work/turso-release-stage/code-parts/candidate.env'));
const version={web:'336097f30c293325c373cd50',windows:3,release:'4.1.7'};
const hashes={exe:'b07acbb6ce358266a849aecdbc39361cfba94cc51b9b5811d68be98d676f89d4',release:'f414f50041a7a2e74adecea9b72bf5941c11c54661812ea5cde5294fc7ea26b2'};
const hash=b=>createHash('sha256').update(b).digest('hex');
const present=p=>stat(p).then(()=>true,e=>{if(e.code==='ENOENT')return false;throw e;});

async function stage(root) {
  const vars=new Map((await readFile(parts,'utf8')).trim().split(/\r?\n/).map(line=>{
    const n=line.indexOf('=');return [line.slice(0,n),line.slice(n+1)];
  }));
  const n=Number(vars.get('LYCHEE_APP_PARTS'));
  assert.ok(Number.isSafeInteger(n)&&n>0&&n<2000);assert.equal(vars.size,n+2);
  const data=Buffer.from(Array.from({length:n},(_,i)=>{const v=vars.get('LYCHEE_APP_PART_'+i);assert.ok(v);return v;}).join(''),'base64');
  assert.equal(hash(data),vars.get('LYCHEE_STAGE_HASH'));
  await cp(source,root,{recursive:true,dereference:true});
  const candidate=JSON.parse(gunzipSync(data));
  assert.equal(Buffer.from(candidate['server.mjs'],'base64').toString('utf8'),composeOriginal(await readFile(join(source,'server.mjs'))));
  for(const [name,encoded] of Object.entries(candidate)){
    assert.match(name,/^[a-zA-Z0-9._/-]+$/);assert.ok(name.split('/').every(s=>s&&s!=='.'&&s!=='..'));
    const dest=resolve(root,name);assert.ok(dest.startsWith(root+sep));
    await mkdir(dirname(dest),{recursive:true});await writeFile(dest,Buffer.from(encoded,'base64'));
  }
  for(const [name,expected] of [['lychee-countdown.exe',hashes.exe],['windows.release',hashes.release]]){
    const bytes=await readFile(join(windows,name));assert.equal(hash(bytes),expected);await writeFile(join(root,'web',name),bytes);
  }
  // Baseline metadata recovered from the published version response. Keep signed bytes intact.
  for(const [name,value] of [['web-version.txt',version.web],['windows-version.txt',String(version.windows)],['product-version.txt',version.release]]){
    await writeFile(join(root,'web',name),value+'\n');
  }
  const guard=fileURLToPath(new URL('./turso-coexist-transport.mjs',import.meta.url));
  return {guard,stageSha256:hash(data)};
}

async function unusedPort(){
  const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');
  const port=s.address().port;await new Promise(r=>s.close(r));return port;
}
async function originalProcess(root,guard,fixture,port,enabled,settings={}){
  const origin='http://127.0.0.1:'+port;
  const env={PORT:String(port),LYCHEE_ORIGIN:origin,LYCHEE_MULTICLIENT_ENABLED:enabled?'1':'0',
    TURSO_DATABASE_URL:fixture.url,TURSO_AUTH_TOKEN:fixture.authToken,LYCHEE_AI_VERIFY_620:'0',
    TEST_DATABASE_ORIGIN:fixture.url,TEST_APP_ORIGIN:origin,...settings,
    ...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.TEMP?{TEMP:process.env.TEMP}:{})};
  const child=fork(join(root,'server.mjs'),[],{cwd:root,env,execArgv:['--import',pathToFileURL(guard).href],
    stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let err='',onSmoke;const records=[],responses=[];
  child.on('message',m=>{if(typeof m.route==='string')responses.push(m);});
  const lines=createInterface({input:child.stdout});
  lines.on('line',line=>{
    if(!line.startsWith('{'))return;
    try{
      const record=JSON.parse(line);
      if(record.event==='lychee-release-smoke'){records.push(record);onSmoke?.(record);}
    }catch{}
  });
  child.stderr.on('data',b=>{err=(err+b).slice(-1800);});
  const exit=once(child,'exit');
  const stop=async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill();await exit;}};
  let timer;
  try{
    const ready=await Promise.race([
      once(child,'message').then(([msg])=>msg.ready),
      exit.then(()=>{throw Error('Original listener exited: '+err.replaceAll(fixture.authToken,'[redacted]'));}),
      new Promise((_,no)=>{timer=setTimeout(()=>no(Error('Original listener startup timed out')),30000);}),
    ]);
    assert.equal(ready,port);
  }catch(error){await stop();throw error;}finally{clearTimeout(timer);}
  async function smoke(){
    let timeout;
    try{
      return await Promise.race([new Promise(ok=>{onSmoke=ok;if(records.length)ok(records[0]);}),
        exit.then(()=>{throw Error('Listener exited before smoke evidence');}),
        new Promise((_,no)=>{timeout=setTimeout(()=>no(Error('No structured release smoke log within 90 seconds')),90000);})]);
    }finally{clearTimeout(timeout);onSmoke=undefined;}
  }
  return {pid:child.pid,stop,origin,smoke,records,responses};
}

const inputs=await Promise.all([source,join(windows,'windows.release'),join(windows,'lychee-countdown.exe'),parts].map(present));
const needInputs=inputs.every(Boolean)?false:'Set LYCHEE_TEST_LEGACY_SOURCE, LYCHEE_TEST_LEGACY_WINDOWS and LYCHEE_TEST_RELEASE_PARTS to the original local artifacts.';
test('原发布进程单端口共存：旧签名下载、迁移前503、迁移入园、隔离及硬重启', {
  skip:needInputs,
},async t=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'lychee-coexist-')),fixture=await startTursoFixture();
  const client=await createTursoClient(fixture),port=await unusedPort(),origin='http://127.0.0.1:'+port;
  const pids=[];let child;
  async function reboot(enabled,guard,settings){
    if(child)await child.stop();child=await originalProcess(root,guard,fixture,port,enabled,settings);pids.push(child.pid);
  }
  async function http(path,body,cookie,expected=200){
    const res=await fetch(origin+path,{method:body?'POST':'GET',headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},
      body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(20000)});
    assert.equal(res.status,expected,path);return res;
  }
  const jar=(res,name)=>{const line=res.headers.getSetCookie().find(x=>x.startsWith(name+'='));assert.ok(line,name);return line.split(';')[0];};
  const work=async(cookie,action,fields={})=>(await http('/api/v640/workspace',{action,...fields},cookie)).json();
  const register=async name=>jar(await http('/api/v640/account',{mode:'register',name,password:randomBytes(18).toString('hex')}),'__Host-lychee-account');
  try{
    const {guard,stageSha256}=await stage(root);
    await reboot(true,guard);
    const originalCard=await readFile(join(source,'web/index.html'));
    async function oldRelease(){
      assert.deepEqual(Buffer.from(await (await http('/card?desktop=5&build=3')).arrayBuffer()),originalCard);
      assert.deepEqual(await (await http('/app-version.json')).json(),version);
      const metadata=Buffer.from(await (await http('/windows.release')).arrayBuffer());
      assert.equal(hash(metadata),hashes.release);assert.equal(metadata.readUInt32LE(8),version.windows);
      assert.equal(metadata.subarray(12,44).toString('hex'),hashes.exe);
      assert.equal(hash(Buffer.from(await (await http('/lychee-countdown.exe')).arrayBuffer())),hashes.exe);
    }
    await oldRelease();
    await http('/api/client-capabilities',null,null,503);
    await http('/api/v640/workspace',null,null,503);
    assert.equal(fixture.sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name GLOB 'mc_*'").get().n,0);
    // Exercise the original path before adding a single isolated old account.
    await http('/api/account',{mode:'logout'});
    const password=randomBytes(18).toString('hex'),salt=randomBytes(32).toString('hex');
    fixture.sqlite.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(1,'旧版测试',salt,pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));
    fixture.sqlite.prepare("INSERT INTO camp_profiles VALUES('1','旧版测试',0,'','休息','')").run();
    const oldLogin=()=>http('/api/account',{mode:'login',name:'旧版测试',password});
    const oldCookie=jar(await oldLogin(),'__Host-lychee');
    assert.equal((await (await http('/api/camp?roster=lychee',null,oldCookie)).json()).me,'1');
    await ensureTursoAccountsSchema(client);
    await migrateTursoLegacy(client);
    await reboot(true,guard);
  assert.equal((await (await http('/api/client-capabilities')).json()).updateRequired,true);
  assert.equal((await (await http('/api/client-capabilities?accountApi=v640')).json()).privateGardens,true);
    const legacyState=await (await http('/api/v640/workspace',null,oldCookie)).json();
    assert.equal(legacyState.activeGardenId,'legacy');
    const [owner,friend,outsider]=await Promise.all(['圈主','好友','路过'].map(register));
    const g=(await work(owner,'create',{name:'同端口共存园'})).activeGardenId;
    const code=(await work(owner,'invite',{gardenId:g})).inviteCode;
    await work(friend,'join',{code});
    const chat=async cookie=>{
      const state=await (await http('/api/v640/workspace',null,cookie)).json();
      return '/g/'+g+'/api/for/'+state.account.id+'/camp?roster=lychee';
    };
    const [ownerChat,friendChat,outsiderChat]=await Promise.all([owner,friend,outsider].map(chat));
    const body='共存试验 '+randomUUID();
    await http(ownerChat,{type:'note',name:'圈主',avatar:0,key:randomUUID(),body},owner);
    const visible=async()=>assert.ok((await (await http(friendChat,null,friend)).json()).notes.some(n=>n.body===body));
    await visible();await http(outsiderChat,null,outsider,403);
    await reboot(false,guard);
    await oldRelease();assert.ok(jar(await oldLogin(),'__Host-lychee'));
    await http('/api/client-capabilities',null,null,503);await http(friendChat,null,friend,503);
    await reboot(true,guard);
    assert.equal((await (await http('/api/v640/workspace',null,friend)).json()).activeGardenId,g);
    await visible();await http(outsiderChat,null,outsider,403);
    assert.equal((await work(owner,'invite',{gardenId:g})).inviteCode,code);
    await oldRelease();assert.equal(new Set(pids).size,pids.length);
    t.diagnostic(JSON.stringify({stageSha256,oldVersion:version,downloadSha256:hashes,distinctServerProcesses:pids.length,
      samePort:true,missingMarker:503,disabled:503,friendReadback:true,nonmember:403}));

    await t.test('同一旧账号跨旧版与新版共享 AI 额度，混合会话仍按旧身份记账',async quotaTest=>{
      const rawStatus='/api/phone?v62=status';
      const get=async(path,cookie)=>(await http(path,null,cookie)).json();
      assert.deepEqual((await get(rawStatus,oldCookie)).limits,{chat:30,image:10});
      const provider=await localProvider();
      try{
        await reboot(true,guard,{LYCHEE_ACCOUNT_AI_QUOTAS:'1',LYCHEE_ENABLE_PROVIDER_CALLS:'1',TEST_PROVIDER_ORIGIN:provider.origin,
          DEEPSEEK_API_KEY:'local-only-chat',ARK_API_KEY:'local-only-image'});
        const pinned='/g/legacy/api/for/'+legacyState.account.id+'/phone?v62=status';
        const other=(await get('/api/v640/workspace',owner)).account.id;
        const otherStatus='/g/'+g+'/api/for/'+other+'/phone?v62=status';
        const mixed=owner+'; '+oldCookie,reverse=oldCookie+'; '+owner;
        const confirm=async(path,cookie,expected)=>{
          const state=await get(path,cookie);
          assert.deepEqual(state.limits,{chat:20,image:10});
          assert.equal(state.used.chat??0,expected);
          assert.deepEqual(state.remaining,{chat:20-expected,image:10});
        };
        await confirm(rawStatus,oldCookie,0);await confirm(pinned,oldCookie,0);
        const reply=await (await http('/api/phone',{type:'v62-assist',prompt:'答好'},mixed)).json();
        assert.equal(reply.reply,'好');assert.deepEqual(provider.calls,['chat']);
        for(const cookie of [oldCookie,mixed,reverse])await confirm(rawStatus,cookie,1);
        await confirm(pinned,oldCookie,1);await confirm(otherStatus,owner,0);
        const text='旧园普通留言 '+randomUUID()+' 结尾完整。';
        await http('/api/camp',{type:'note',name:'旧版测试',avatar:0,key:randomUUID(),body:text},mixed);
        const roster=await get('/api/camp?roster=lychee',oldCookie);
        assert.ok(roster.notes.some(note=>note.body===text));await confirm(rawStatus,oldCookie,1);
        quotaTest.diagnostic(JSON.stringify({stageSha256,legacyDefaultChat:30,enabledLimits:{chat:20,image:10},oldAccountUsed:1,
          otherAccountUsed:0,providerCalls:provider.calls,originalNoteReadback:true}));
      }finally{await provider.close();}
    });
  } finally {
    if(child)await child.stop();client.close();await fixture.close();
    if(dirname(root)!==await realpath(tmpdir())||!/^lychee-coexist-[A-Za-z0-9]{6}$/.test(basename(root)))throw Error('Unexpected test output directory');
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});

// A real 1x1 JPEG sent by the fixed local image endpoint in place of a paid response.
const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAaD3/2Q==';
async function localProvider(){
  const calls=[];
  const server=createHttpServer(async(req,res)=>{
    try{
      assert.equal(req.method,'POST');
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      let result;
      if(req.url==='/chat/completions'){
        assert.equal(req.headers.authorization,'Bearer local-only-chat');
        const soup=body.response_format?.type==='json_object';
        calls.push(soup?'soup':'chat');
        if(soup)assert.equal(JSON.parse(body.messages.at(-1).content).玩家输入,'是人吗？');
        else assert.equal(body.messages.at(-1).content,'答好');
        result={choices:[{finish_reason:'stop',message:{role:'assistant',content:soup?'{"verdict":"是"}':'好'}}]};
      }else{
        assert.equal(req.url,'/api/v3/images/generations');
        assert.equal(req.headers.authorization,'Bearer local-only-image');
        calls.push('image');assert.match(body.prompt,/荔枝/);assert.equal(body.size,'2048x2048');
        result={data:[{b64_json:jpeg}]};
      }
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(result));
    }catch{res.writeHead(400).end();}
  });
  server.listen(0,'127.0.0.1');await once(server,'listening');
  return {origin:'http://127.0.0.1:'+server.address().port,calls,close:()=>new Promise(ok=>server.close(ok))};
}

test('最终分片的真实监听入口按启动开关完成 prepare、ai，重启沿用已落盘的收据', {skip:needInputs},async t=>{
  const root=await mkdtemp(join(await realpath(tmpdir()),'lychee-coexist-'));
  const databasePath=join(root,'fixture.sqlite'),provider=await localProvider(),port=await unusedPort();
  const seed=randomBytes(32).toString('hex'),pids=[],statuses=[];
  let fixture,child;
  try{
    const {guard,stageSha256}=await stage(root);
    fixture=await startTursoFixture({databasePath});
    // Only synthetic legacy schema exists. Its successful migration enables the real mount.
    fixture.sqlite.exec('CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT,salt TEXT,verifier TEXT); CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER)');
    const db=await createTursoClient(fixture);
    try{await ensureTursoAccountsSchema(db);await migrateTursoLegacy(db,{allowEmpty:true});}finally{db.close();}
    async function run(mode,status,gardenId){
      const settings={NODE_TEST_CONTEXT:'child-v8',LYCHEE_RELEASE_SMOKE:mode,LYCHEE_QA_SEED:seed,
        TEST_PROVIDER_ORIGIN:provider.origin,...(['ai','album'].includes(mode)?{LYCHEE_ENABLE_PROVIDER_CALLS:'1',LYCHEE_ACCOUNT_AI_QUOTAS:'1',
          LYCHEE_RELEASE_SMOKE_GARDEN_ID:gardenId,LYCHEE_PROVIDER_GARDEN_ID:gardenId,
          DEEPSEEK_API_KEY:'local-only-chat',ARK_API_KEY:'local-only-image',ARK_IMAGE_MODEL:'local-test-image'}:{})};
      child=await originalProcess(root,guard,fixture,port,true,settings);
      pids.push(child.pid);
      const log=await child.smoke();
      assert.deepEqual(Object.keys(log).sort(),['event','mode','status','gardenId','accounts','chat','image','soup','attempts',...(mode==='album'?['savedImageReadable','imageLimit']:[])].sort());
      assert.equal(log.mode,mode);
      assert.equal(log.status,status,JSON.stringify({log,providerCalls:provider.calls,recentRoutes:child.responses.slice(-5)}));
      const expected=mode==='ai'?'succeeded':'unattempted';
      assert.deepEqual(log.attempts,{chat:expected,image:expected,soup:expected});
      assert.equal(child.records.length,1);
      await child.stop();child=null;statuses.push(log.status);
      return log;
    }
    const prepared=await run('prepare','prepared'),gardenId=prepared.gardenId;
    assert.match(gardenId,/^[a-f0-9-]{36}$/);
    assert.deepEqual([prepared.accounts,prepared.chat,prepared.image,prepared.soup],[3,0,0,0]);
    const counts=()=>['mc_accounts','mc_gardens','mc_members'].map(table=>fixture.sqlite.prepare('SELECT COUNT(*) AS n FROM '+table).get().n);
    assert.deepEqual(counts(),[3,1,2]);
    assert.deepEqual(await run('prepare','already-prepared'),{...prepared,status:'already-prepared'});
    assert.deepEqual(counts(),[3,1,2]);assert.deepEqual(provider.calls,[]);
    const checked=await run('ai','verified',gardenId);
    assert.deepEqual([checked.gardenId,checked.chat,checked.image,checked.soup],[gardenId,1,1,1]);
    assert.deepEqual(provider.calls,['chat','image','soup']);
    await fixture.close();fixture=null;
    fixture=await startTursoFixture({databasePath});
    const before=()=>fixture.sqlite.prepare('SELECT kind,state,created,updated FROM mc_acceptance_claims_v1 WHERE garden=? ORDER BY kind').all(gardenId);
    const saved=before();
    assert.deepEqual(saved.map(r=>[r.kind,r.state]),['chat','image','phase','soup'].map(kind=>[kind,'succeeded']));
    assert.deepEqual(await run('ai','already-attempted',gardenId),{...checked,status:'already-attempted'});
    assert.deepEqual(before(),saved);assert.deepEqual(counts(),[3,1,2]);
    const album=await run('album','verified',gardenId);
    assert.ok(album.savedImageReadable);assert.equal(album.imageLimit,10);
    assert.deepEqual(provider.calls,['chat','image','soup']);assert.equal(new Set(pids).size,5);
    t.diagnostic(JSON.stringify({stageSha256,distinctOriginalProcesses:pids.length,listenerSmoke:statuses,
      provider:'isolated-loopback',providerCalls:provider.calls,sqliteReopened:true,unchangedClaims:saved.length}));
  }finally{
    if(child)await child.stop();
    if(fixture)await fixture.close();await provider.close();
    if(dirname(root)!==await realpath(tmpdir())||!/^lychee-coexist-[A-Za-z0-9]{6}$/.test(basename(root)))throw Error('Unexpected test output directory');
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
