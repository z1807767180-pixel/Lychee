import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDomains } from '../server/domains.mjs';
import { listen } from '../server/index.mjs';
import { providerStatus, providerWorkerEnv } from '../server/provider-config.mjs';

const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAaD3/2Q==','base64');

test('registered rollout requires both daily quotas and a resolved member garden', () => {
  const env={LYCHEE_ENABLE_PROVIDER_CALLS:'1',LYCHEE_PROVIDER_GARDEN_ID:'registered-with-daily-limits',
    DEEPSEEK_API_KEY:'test-chat',ARK_API_KEY:'test-image'};
  for(const garden of [randomUUID(),'legacy']){
    assert.equal(providerStatus(env,garden).enabled,false);
    assert.equal(providerStatus({...env,LYCHEE_ACCOUNT_AI_QUOTAS:'0'},garden).enabled,false);
    const production={...env,LYCHEE_ACCOUNT_AI_QUOTAS:'1'};
    assert.equal(providerStatus(production,garden).chatReady,true);
    assert.equal(providerStatus(production,garden).imageReady,true);
    assert.equal(providerStatus({...production,LYCHEE_ENABLE_PROVIDER_CALLS:'0'},garden).enabled,false);
    assert.equal(providerWorkerEnv(production,undefined,garden).ARK_API_KEY,'test-image');
  }
  for(const garden of [null,undefined,'', '*','unverified'])
    assert.equal(providerStatus({...env,LYCHEE_ACCOUNT_AI_QUOTAS:'1'},garden).enabled,false);
});

test('diagnostics return booleans; disabled or blank credentials stay out of the worker', () => {
  const enabled = { LYCHEE_ENABLE_PROVIDER_CALLS:'1' };
  const keys = { DEEPSEEK_API_KEY:'fixture-chat', ARK_API_KEY:'fixture-image', ARK_IMAGE_MODEL:'fixture-model' };
  for (const [env,chat,image] of [[keys,false,false],[{...enabled, DEEPSEEK_API_KEY:'  '},false,false],
    [{...enabled,DEEPSEEK_API_KEY:'fixture-chat'},true,false],[{...enabled,ARK_API_KEY:'fixture-image'},false,true],
    [{...enabled,...keys},true,true]]) {
    assert.deepEqual(providerStatus(env), {enabled:env.LYCHEE_ENABLE_PROVIDER_CALLS==='1',chatReady:chat,imageReady:image,soupReady:chat});
    const worker = providerWorkerEnv({...env,UNRELATED:'irrelevant'});
    assert.equal(!!worker.DEEPSEEK_API_KEY,chat);
    assert.equal(!!worker.ARK_API_KEY,image);
    assert.equal(worker.LYCHEE_AI_VERIFY_620,'0');
    assert.equal(worker.UNRELATED,undefined);
  }
  assert.equal(providerWorkerEnv({...enabled,...keys}).ARK_IMAGE_MODEL,keys.ARK_IMAGE_MODEL);
  assert.throws(()=>providerWorkerEnv({},'http://example.invalid:1234'), /loopback/);
});

test('a single configured private garden must match exactly, with the master switch still enabled', () => {
  const garden = '4beea0e6-448e-471b-93b0-aef804d29d40', other = randomUUID();
  const env = { LYCHEE_ENABLE_PROVIDER_CALLS:'1', DEEPSEEK_API_KEY:'test-only-chat', ARK_API_KEY:'test-only-image' };
  const off = { enabled:false, chatReady:false, imageReady:false, soupReady:false };
  for (const scope of ['', ' ', '*', 'legacy', garden.toUpperCase(), garden+'\n', garden+','+other]) {
    assert.deepEqual(providerStatus({...env,LYCHEE_PROVIDER_GARDEN_ID:scope},scope),off);
  }
  const scoped = {...env,LYCHEE_PROVIDER_GARDEN_ID:garden};
  for (const memberGarden of [undefined, 'legacy', other]) {
    assert.deepEqual(providerStatus(scoped,memberGarden),off);
    assert.deepEqual(providerWorkerEnv(scoped,undefined,memberGarden),{LYCHEE_AI_VERIFY_620:'0'});
  }
  assert.deepEqual(providerStatus({...scoped,LYCHEE_ENABLE_PROVIDER_CALLS:'0'},garden),off);
  assert.deepEqual(providerStatus(scoped,garden),{enabled:true,chatReady:true,imageReady:true,soupReady:true});
  assert.deepEqual(providerStatus(env,other),providerStatus(scoped,garden));
});

test('three actual domain workers see provider readiness only in the selected private garden', async () => {
  const selected = randomUUID(), other = randomUUID();
  const dataDir = await mkdtemp(join(tmpdir(),'lychee-one-garden-provider-'));
  const domains = createDomains({dataDir, legacyDir:fileURLToPath(new URL('../legacy/',import.meta.url))});
  // Replace the environment reference for this isolated test process. No
  // inherited credential is read or sent, and all requests only query status.
  const inherited = process.env;
  process.env = { LYCHEE_ENABLE_PROVIDER_CALLS:'1', LYCHEE_PROVIDER_GARDEN_ID:selected,
    DEEPSEEK_API_KEY:'status-only-fake-chat', ARK_API_KEY:'status-only-fake-image' };
  try {
    for (const gardenId of [other,selected,'legacy']) {
      const member={gardenId,slot:1,username:'本地状态测试',accountId:randomUUID()};
      const get = async path => {
        const r=await domains.handle(new Request('http://127.0.0.1'+path),member);
        assert.equal(r.status,200);
        return r.json();
      };
      const status=await get('/api/phone?v62=status'), host=await get('/api/camp?soup=1&room=solo');
      assert.deepEqual([status.chat,status.image,host.ready],Array(3).fill(gardenId===selected));
      assert.deepEqual(status.used,{});
    }
  } finally {
    process.env=inherited;
    await domains.close();
    await rm(dataDir,{recursive:true,force:true});
  }
});

async function startDomain(t, testProviderOrigin) {
  const dataDir = await mkdtemp(join(tmpdir(), 'lychee-provider-test-'));
  const app = await listen({ dataDir, testProviderOrigin });
  t.after(async () => { await app.close(); await rm(dataDir, {recursive:true,force:true}); });
  let cookie = '';
  async function call(path, body, status=200) {
    const response = await fetch(app.url+path, {method:body?'POST':'GET',
      headers:{origin:app.url,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(response.status,status,path);
    const next = response.headers.getSetCookie().find(line=>line.startsWith('__Host-lychee-account='));
    if (next) cookie = next.split(';')[0];
    return response.headers.get('content-type')?.startsWith('image/') ? Buffer.from(await response.arrayBuffer()) : response.json();
  }
  await call('/api/account',{mode:'register',name:'模拟测试',password:randomUUID()});
  const { activeGardenId } = await call('/api/workspace',{action:'create',name:'本地服务测试'});
  return (path, body, status) => call('/g/'+activeGardenId+'/api/'+path,body,status);
}

test('a closed administrator gate gives unavailable chat, image, and soup status over real HTTP', async t => {
  const saved = process.env.LYCHEE_ENABLE_PROVIDER_CALLS;
  process.env.LYCHEE_ENABLE_PROVIDER_CALLS = '0';
  try {
    const call = await startDomain(t);
    const status = await call('phone?v62=status');
    assert.equal(status.chat,false);
    assert.equal(status.image,false);
    assert.equal((await call('camp?soup=1&room=solo')).ready,false);
    await call('phone',{type:'v62-chat',id:randomUUID(),prompt:'本地测试'},503);
    await call('phone',{type:'v62-image',prompt:'本地测试',ratio:'1:1'},503);
    assert.deepEqual((await call('phone?v62=status')).used,{});
  } finally {
    if (saved === undefined) delete process.env.LYCHEE_ENABLE_PROVIDER_CALLS;
    else process.env.LYCHEE_ENABLE_PROVIDER_CALLS = saved;
  }
});

test('loopback provider returns a persisted chat answer, an image and a turtle-soup verdict through authenticated HTTP', async t => {
  const calls = [];
  const fixture = createServer(async (req,res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      let response;
      if (req.url === '/chat/completions') {
        assert.equal(req.headers.authorization,'Bearer local-chat-fixture');
        assert.equal(body.model,'deepseek-flash');
        const soup = body.response_format?.type === 'json_object';
        if (soup) {
          assert.equal(body.max_tokens,64);
          assert.equal(JSON.parse(body.messages.at(-1).content).玩家输入,'这是一个测试问题吗？');
        } else {
          assert.equal(body.messages.at(-1).content,'本地测试对话');
          assert.equal(body.thinking.type,'disabled');
        }
        calls.push(soup?'soup':'chat');
        response = {choices:[{finish_reason:'stop',message:{role:'assistant',content:soup?JSON.stringify({verdict:'是'}):'本地模拟回答'}}]};
      } else {
        assert.equal(req.url,'/api/v3/images/generations');
        assert.equal(req.headers.authorization,'Bearer local-image-fixture');
        assert.equal(body.model,'local-image-model');
        assert.equal(body.size,'2048x2048');
        assert.equal(body.response_format,'b64_json');
        assert.match(body.prompt,/本地测试荔枝/);
        calls.push('image');
        response = {data:[{b64_json:jpeg.toString('base64')}]};
      }
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify(response));
    } catch { res.writeHead(400).end(); }
  });
  await new Promise((ok,no)=>fixture.once('error',no).listen(0,'127.0.0.1',ok));
  t.after(()=>new Promise(done=>fixture.close(done)));
  const call = await startDomain(t,'http://127.0.0.1:'+fixture.address().port);
  const status = await call('phone?v62=status');
  assert.equal(status.chat,true);
  assert.equal(status.image,true);
  const thread = randomUUID();
  const chat={type:'v62-chat',id:thread,prompt:'本地测试对话',thinking:false,web:false,requestId:randomUUID()};
  const reply = await call('phone',chat);
  assert.equal(reply.reply,'本地模拟回答');
  assert.deepEqual(await call('phone',chat),reply);
  await call('phone',{...chat,prompt:'改内容复用相同编号'},409);
  assert.deepEqual((await call('phone?v62=thread&id='+thread)).messages.map(m=>m.body),['本地测试对话','本地模拟回答']);
  const picture={type:'v62-image',prompt:'本地测试荔枝',ratio:'1:1',style:'自由创作',requestId:randomUUID()};
  const image = await call('phone',picture);
  assert.deepEqual(await call('phone',picture),image);
  assert.deepEqual(await call('phone?v62=image&id='+image.id),jpeg);
  assert.deepEqual((await call('phone?v62=images')).images.map(i=>i.id),[image.id]);
  const room = 'camp?soup=1&room=solo';
  assert.equal((await call(room)).ready,true);
  await call('camp',{type:'soup',room:'solo',act:'start',round:0,filter:'全部'});
  const {round} = await call(room);
  await call('camp',{type:'soup',room:'solo',act:'send',round:round.id,mode:'ask',body:'这是一个测试问题吗？',token:randomUUID()});
  assert.equal((await call(room)).round.turns[0].reply,'是');
  assert.deepEqual(calls,['chat','image','soup']);
  assert.deepEqual((await call('phone?v62=status')).used,{chat:2,image:1});
  assert.deepEqual((await call(room)).aiQuota.remaining,{image:14});
});
