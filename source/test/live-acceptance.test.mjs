import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readdir,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {listen} from '../server/index.mjs';
import {createAcceptanceReceipts} from '../server/acceptance-receipts.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {runServerAcceptance} from '../server/server-acceptance.mjs';
import {startTursoFixture} from './turso-fixture.mjs';
import {currentUserVault,runAcceptance} from './live-acceptance.mjs';

const jpeg='/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAaD3/2Q==';
const prepare=['prepare','--production','--allow-create-test-accounts'];
const ai=g=>['ai','--production','--allow-three-provider-calls','--garden',g];
async function isolated(t,fail){
  const dir=await mkdtemp(join(tmpdir(),'lychee-smoke-unit-')),calls=[],errors=[];
  const provider=createServer(async(req,res)=>{
    try{
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      const kind=req.url==='/api/v3/images/generations'?'image':body.response_format?.type==='json_object'?'soup':'chat';
      calls.push(kind);
      if(kind==='image'){
        assert.equal(body.size,'2048x2048');assert.equal(body.image,undefined);assert.equal(body.n??1,1);
        assert.ok(body.prompt.startsWith('荔枝'));
      }else{
        assert.equal(req.url,'/chat/completions');
        if(kind==='chat'){assert.equal(body.thinking.type,'disabled');assert.equal(body.tools,undefined);assert.equal(body.messages.at(-1).content,'答好');}
        else {assert.equal(body.max_tokens,64);assert.equal(JSON.parse(body.messages.at(-1).content).玩家输入,'是人吗？');}
      }
      if(kind===fail){res.writeHead(502).end();return;}
      const reply=kind==='image'?{data:[{b64_json:jpeg}]}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:kind==='soup'?'{"verdict":"是"}':'好'}}]};
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(reply));
    }catch(e){errors.push(e);res.writeHead(500).end();}
  });
  await new Promise((ok,no)=>provider.once('error',no).listen(0,'127.0.0.1',ok));
  const fixture=await startTursoFixture(),client=await createTursoClient(fixture);
  const app=await listen({storage:'turso',turso:fixture,testProviderOrigin:'http://127.0.0.1:'+provider.address().port});
  const transport=[];
  app.server.on('request',(req,res)=>res.once('finish',()=>transport.push([req.method,req.url.replace(/[0-9a-f-]{36}/gi,'ID'),res.statusCode])));
  t.after(async()=>{
    await app.close();client.close();await fixture.close();await new Promise(ok=>provider.close(ok));
    await rm(dir,{recursive:true,force:true});assert.deepEqual(errors,[]);
  });
  return {origin:app.url,dir,calls,fixture,client,transport};
}

test('default CLI, invalid approvals and server mode all finish without any HTTP request',async t=>{
  let network=0;
  t.mock.method(globalThis,'fetch',()=>{network++;throw Error('Unexpected fetch');});
  t.mock.method(console,'info',()=>{});
  assert.equal((await runAcceptance([])).status,'help');
  for(const argv of [['prepare'],['ai','--production','--garden',randomUUID()],ai('legacy')])await assert.rejects(runAcceptance(argv));
  assert.equal((await runServerAcceptance()).status,'disabled');
  assert.equal((await runServerAcceptance({mode:'prepare',env:{}})).status,'stopped');
  assert.equal(network,0);
});

test('CurrentUser DPAPI round trip when Windows provides an unlocked profile',t=>{
  if(process.platform!=='win32'){t.skip('Windows CurrentUser DPAPI required');return;}
  const original=randomBytes(32);
  let blob;
  try{blob=currentUserVault('protect',original);}
  catch{t.skip('Windows runner does not provide an unlocked CurrentUser profile');return;}
  assert.ok(!blob.includes(original));
  assert.deepEqual(currentUserVault('unprotect',blob),original);
});

test('CLI with a loopback-only ephemeral vault reads back across sessions and caps each provider at one',async t=>{
  const f=await isolated(t);
  const config={origin:f.origin,dir:f.dir};
  {
    const memory=new Map();
    config.vault=(mode,bytes)=>{
      if(mode==='unprotect')return memory.get(bytes.toString());
      const id=randomUUID();memory.set(id,bytes);return Buffer.from(id);
    };
  }
  const ready=await runAcceptance(prepare,config);
  assert.equal(ready.status,'prepared');assert.equal(ready.foreignAccessDenied,1);assert.equal(ready.crossSessionReads,2);
  assert.equal((await runAcceptance(prepare,config)).status,'already-prepared');
  await assert.rejects(runAcceptance(ai(randomUUID()),config),/garden-or-identity-mismatch/);
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(await runAcceptance(ai(ready.gardenId),config),{status:'verified',gardenId:ready.gardenId,chat:1,image:1,soup:1});
  await assert.rejects(runAcceptance(ai(ready.gardenId),config),/already-claimed/);
  assert.deepEqual(f.calls,['chat','image','soup']);
  for(const name of ['ai-chat.started','ai-image.started','ai-soup.started','solo-local-start.started','ai-finished.json'])assert.ok((await readdir(f.dir)).includes(name));
  for(const file of ['prepare-credentials.dpapi','prepared.dpapi'])assert.ok(!(await readFile(join(f.dir,file))).includes(Buffer.from('password')));
});

for(const fail of [null,'chat','image','soup']){
  test('server startup runs at most once after '+(fail?'an ambiguous '+fail+' failure':'success'),async t=>{
    const f=await isolated(t,fail);
    const env={LYCHEE_QA_SEED:randomBytes(32).toString('hex'),LYCHEE_MULTICLIENT_ENABLED:'1',
      TURSO_DATABASE_URL:f.fixture.url,TURSO_AUTH_TOKEN:f.fixture.authToken};
    const logs=[];t.mock.method(console,'info',line=>logs.push(line));
    const run=(mode,more={})=>runServerAcceptance({mode,origin:f.origin,loopbackOrigin:f.origin,env:{...env,LYCHEE_RELEASE_SMOKE:mode,...more}});
    const p=await run('prepare');
    assert.equal(p.status,'prepared',JSON.stringify(f.transport));assert.equal(p.accounts,3);assert.deepEqual(f.calls,[]);
    assert.equal((await run('prepare')).status,'already-prepared');
    const scope={LYCHEE_ENABLE_PROVIDER_CALLS:'1',LYCHEE_PROVIDER_GARDEN_ID:p.gardenId,LYCHEE_RELEASE_SMOKE_GARDEN_ID:p.gardenId};
    assert.equal((await run('ai',{...scope,LYCHEE_RELEASE_SMOKE_GARDEN_ID:randomUUID()})).status,'stopped');
    assert.deepEqual(f.calls,[]);
    const a=await run('ai',scope);
    assert.equal(a.status,fail?'stopped':'verified');
    const before=[...f.calls];
    assert.deepEqual(before,fail==='chat'?['chat']:fail==='image'?['chat','image']:['chat','image','soup']);
    assert.equal((await run('ai',scope)).status,'already-attempted');assert.deepEqual(f.calls,before);
    const status=await(await createAcceptanceReceipts(f.client,{seed:env.LYCHEE_QA_SEED,mode:'status'})).status();
    assert.equal(status.phase,fail?'uncertain':'succeeded');
    if(fail)assert.equal(status.attempts[fail],'uncertain');
    if(fail==='image')assert.equal(status.attempts.soup,'unattempted');
    const structured=logs.filter(x=>x.startsWith('{"event":"lychee-release-smoke"'));
    assert.equal(structured.length,5);
    for(const line of structured){
      assert.deepEqual(Object.keys(JSON.parse(line)).sort(),['accounts','attempts','chat','event','gardenId','image','mode','soup','status']);
      assert.ok(!line.includes(env.LYCHEE_QA_SEED)&&!line.includes(env.TURSO_AUTH_TOKEN));
    }
  });
}
