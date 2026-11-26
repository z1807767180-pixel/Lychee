import test from 'node:test';
import assert from 'node:assert/strict';
import {createECDH,createDecipheriv,createHmac,createPublicKey,randomBytes,verify} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {runInNewContext} from 'node:vm';
import {accountSchema} from '../server/accounts.mjs';
import {createWebPush} from '../server/notify-push.mjs';
import {subscriptionFields,vapidConfig} from '../server/notify-push-transport.mjs';

function device(){
  const ec=createECDH('prime256v1'),p256dh=ec.generateKeys().toString('base64url');
  const sub={endpoint:'https://fcm.googleapis.com/fcm/send/test-fixture',keys:{p256dh,auth:randomBytes(16).toString('base64url')}};
  return {ec,sub};
}
function openEnvelope(request,receiver){
  const wire=request.body,salt=wire.subarray(0,16),pub=wire.subarray(21,86);
  assert.equal(wire.readUInt32BE(16),4096);assert.equal(wire[20],65);
  const hmac=(key,...parts)=>{const h=createHmac('sha256',key);for(const part of parts)h.update(part);return h.digest();};
  const one=Buffer.from([1]);
  const ikm=hmac(hmac(Buffer.from(receiver.sub.keys.auth,'base64url'),receiver.ec.computeSecret(pub)),
    'WebPush: info\0',receiver.ec.getPublicKey(),pub,one);
  const prk=hmac(salt,ikm);
  const dec=createDecipheriv('aes-128-gcm',hmac(prk,'Content-Encoding: aes128gcm\0',one).subarray(0,16),
    hmac(prk,'Content-Encoding: nonce\0',one).subarray(0,12));
  dec.setAuthTag(wire.subarray(-16));
  const plain=Buffer.concat([dec.update(wire.subarray(86,-16)),dec.final()]);
  assert.equal(plain.at(-1),2);return JSON.parse(plain.subarray(0,-1));
}
test('authenticated subscription, per-member routing, encrypted event, retries, restart and logout',async t=>{
  const db=new DatabaseSync(':memory:');t.after(()=>db.close());
  db.exec(accountSchema.join(';'));
  let now=1800000000000;
  for(const [account,garden,slot] of [['a','g',1],['b','g',2],['c','h',1]]){
    db.prepare('INSERT INTO mc_accounts VALUES(?,?,?,?,?,?)').run(account,account,'salt','hash',1,garden);
    db.prepare('INSERT OR IGNORE INTO mc_gardens(id,name) VALUES(?,?)').run(garden,garden);
    db.prepare('INSERT INTO mc_members VALUES(?,?,?,?)').run(account,garden,slot,'member');
    db.prepare('INSERT INTO mc_sessions VALUES(?,?,?,?,?)').run('token'+account,'account',account,garden,now+86400000);
  }
  const ec=createECDH('prime256v1');ec.generateKeys();
  const env={LYCHEE_VAPID_PRIVATE_KEY:ec.getPrivateKey().toString('base64url'),LYCHEE_VAPID_SUBJECT:'mailto:qa@example.invalid'};
  const receiver=device(),calls=[], seen=[],events=[];
  let status=201;
  const domains={handle:async(req,member)=>{seen.push(member);return Response.json({notifications:events});}};
  const execute=(sql,args)=>{const stmt=db.prepare(sql);return {rows:stmt.columns().length?stmt.all(...args):(stmt.run(...args),[])};};
  const options={execute,env,domains,auto:false,clock:()=>now,fetcher:async(url,req)=>{
    assert.equal(url,receiver.sub.endpoint);
    assert.equal(req.redirect,'error');
    const token=/^vapid t=(.+), k=/.exec(req.headers.Authorization)[1].split('.');
    const pub=createPublicKey(vapidConfig(env).key);
    assert.equal(JSON.parse(Buffer.from(token[1],'base64url')).aud,'https://fcm.googleapis.com');
    assert.ok(verify('sha256',Buffer.from(token[0]+'.'+token[1]),{key:pub,dsaEncoding:'ieee-p1363'},Buffer.from(token[2],'base64url')));
    calls.push(openEnvelope(req,receiver));return new Response(null,{status});
  }};
  let push=createWebPush(options);
  async function request(action,account='a',garden='g',sub=receiver.sub){
    const req=new Request('https://app.example/api/v7/push',{method:'POST',headers:{origin:'https://app.example'},body:JSON.stringify({
      action,endpoint:sub.endpoint,subscription:sub})});
    return push.handle(req,{accountId:account,tokenHash:'token'+account},{accountId:account,gardenId:garden});
  }
  assert.equal((await request('subscribe')).status,200);
  assert.equal((await (await request('status','b')).json()).enabled,false);
  assert.equal((await (await request('status')).json()).enabled,true);
  events.push({id:'old',created:now-1},{id:'seen',created:now+1,read:true},{id:'chat1',body:'PRIVATE TEXT',created:++now});
  await push.signal('h');assert.equal(calls.length,0);
  await push.signal('g');assert.deepEqual(calls,[{id:'chat1',scope:'a/g'}]);assert.equal(seen[0].slot,1);
  await push.close();push=createWebPush(options);
  await push.signal();assert.equal(calls.length,1);
  events.push({id:'chat2',created:++now});status=503;await push.signal();assert.equal(calls.length,2);
  now+=61000;status=201;await push.signal();assert.equal(calls.length,3);
  db.prepare('DELETE FROM mc_sessions WHERE account=?').run('a');
  events.push({id:'chat3',created:++now});await push.signal();assert.equal(calls.length,3);
  assert.equal((await (await request('status')).json()).enabled,false);
  await push.close();
});

test('unconfigured push and provider endpoint restrictions',async()=>{
  for(const endpoint of ['https://localhost/send','https://fcm.googleapis.com.evil.invalid/send','https://fcm.googleapis.com:444/send','https://user@fcm.googleapis.com/send']){
    const {sub}=device();assert.throws(()=>subscriptionFields({...sub,endpoint}));
  }
  let touched=false;
  const push=createWebPush({env:{},execute(){touched=true;},auto:false});
  const req=new Request('https://site.test/api/v7/push',{method:'POST',headers:{origin:'https://site.test'},body:'{"action":"status"}'});
  assert.equal((await (await push.handle(req,{accountId:'a'},{accountId:'a'})).json()).configured,false);
  await push.signal();await push.close();assert.equal(touched,false);
});
test('worker displays a generic push and opens a scoped mobile deep link after page closure',async()=>{
  const listeners={},notices=[],opened=[],windows=[];
  const self={location:{origin:'https://site.test'},addEventListener:(type,f)=>listeners[type]=f,
    registration:{showNotification:async(title,options)=>notices.push(options)},
    clients:{matchAll:async()=>windows,openWindow:async url=>opened.push(url)}};
  runInNewContext(await readFile(new URL('../client/notify-sw-v7.js',import.meta.url),'utf8'),{self,URLSearchParams,URL});
  let done;
  const data={scope:'acc/garden',id:'chat.2.01'};
  listeners.push({data:{json:()=>data},waitUntil:p=>done=p});await done;
  assert.equal(notices[0].tag,'acc/garden/chat.2.01');
  listeners.notificationclick({notification:{data,close(){}},waitUntil:p=>done=p});await done;
  const target=new URL(opened[0],'https://site.test');assert.equal(target.pathname,'/mobile/');
  assert.equal(target.searchParams.get('garden'),'garden');
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('scope'),data.scope);
  assert.equal(new URLSearchParams(target.hash.slice(1)).get('lychee-notice'),data.id);
  const unrelated={url:'https://site.test/mobile/?garden=other',focus(){assert.fail('Focused an unrelated garden');}};
  windows.push(unrelated);
  listeners.notificationclick({notification:{data,close(){}},waitUntil:p=>done=p});await done;
  assert.equal(opened.length,2);
  let focused=false,navigated='';
  const matched={url:'https://site.test/mobile/?garden=garden',focus:async()=>{focused=true;},
    navigate:async url=>{navigated=url;return matched;}};
  windows.push(matched);
  listeners.notificationclick({notification:{data,close(){}},waitUntil:p=>done=p});await done;
  assert.equal(focused,true);assert.equal(navigated,target.href);assert.equal(opened.length,2);
});

test('two signed-in members: sending through the normal chat API delivers the same ID as the recipient inbox',async t=>{
  const {createApp}=await import('../server/index.mjs');
  const ec=createECDH('prime256v1');ec.generateKeys();
  const config={LYCHEE_VAPID_PRIVATE_KEY:ec.getPrivateKey().toString('base64url'),LYCHEE_VAPID_SUBJECT:'mailto:qa@example.invalid'};
  const saved=Object.keys(config).map(key=>[key,process.env[key]]);
  Object.assign(process.env,config);
  const received=[],receiver=device();
  t.mock.method(globalThis,'fetch',async(url,req)=>{
    assert.equal(url,receiver.sub.endpoint);
    received.push(openEnvelope(req,receiver));return new Response(null,{status:201});
  });
  const data=await mkdtemp(join(tmpdir(),'lychee-shadow-push-data-'));
  const web=await mkdtemp(join(tmpdir(),'lychee-shadow-push-static-'));
  let app;
  t.after(async()=>{
    try{await app?.close();}
    finally{
      for(const [key,value] of saved){if(value===undefined)delete process.env[key];else process.env[key]=value;}
      await Promise.all([data,web].map(path=>rm(path,{recursive:true,force:true})));
    }
  });
  app=await createApp({storage:'sqlite',dataDir:data,webRoot:web});
  const base='https://lychee.test';
  function actor(){
    let cookie='';
    return async(path,body)=>{
      const response=await app.handle(new Request(base+path,{method:body?'POST':'GET',headers:{origin:base,cookie,'Content-Type':'application/json'},
        body:body?JSON.stringify(body):undefined}));
      const login=response.headers.getSetCookie().find(s=>s.startsWith('__Host-lychee-account='));
      if(login)cookie=login.split(';')[0];
      const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result;
    };
  }
  const a=actor(),b=actor();
  for(const [call,name] of [[a,'测试甲'],[b,'测试乙']]){
    await call('/api/v640/account',{mode:'register',name,password:'local-fixture-password'});
  }
  const {activeGardenId:g}=await a('/api/v640/workspace',{action:'create',name:'推送验收'});
  const {inviteCode}=await a('/api/v640/workspace',{action:'invite',gardenId:g});
  await b('/api/v640/workspace',{action:'join',code:inviteCode});
  const {account:{id}}=await b('/api/v640/workspace');
  await b('/g/'+g+'/api/camp?roster=lychee');
  const route='/api/v7/push?'+new URLSearchParams({accountId:id,gardenId:g});
  assert.equal((await b(route,{action:'subscribe',subscription:receiver.sub})).enabled,true);
  await a('/g/'+g+'/api/camp',{type:'note',key:crypto.randomUUID(),name:'测试甲',avatar:0,body:'隔离测试消息'});
  const {notifications}=await b('/g/'+g+'/api/phone?v61=notifications');
  const item=notifications.find(row=>row.kind==='chat');assert.ok(item);
  for(let i=0;i<150&&!received.length;i++)await delay(20);
  assert.deepEqual(received,[{scope:id+'/'+g,id:item.id}]);
  const page=crypto.randomUUID();
  let sequence=0;
  const presence=(visible,through=0)=>b(route,{action:'presence',endpoint:receiver.sub.endpoint,page,visible,through,sequence:++sequence});
  await presence(true);
  await a('/g/'+g+'/api/camp',{type:'note',key:crypto.randomUUID(),name:'测试甲',avatar:0,body:'前台只看聊天角标'});
  const latest=(await b('/g/'+g+'/api/phone?v61=chat-inbox')).rooms[0];
  assert.equal(latest.unread,2);
  await presence(true,latest.latest);
  await delay(180);
  assert.equal(received.length,1,'可见设备未弹出聊天系统通知');
  await presence(false);
  await a('/g/'+g+'/api/camp',{type:'note',key:crypto.randomUUID(),name:'测试甲',avatar:0,body:'回桌面后的新通知'});
  for(let i=0;i<150&&received.length<2;i++)await delay(20);
  const hidden=(await b('/g/'+g+'/api/phone?v61=notifications')).notifications[0];
  assert.deepEqual(received.slice(1),[{scope:id+'/'+g,id:hidden.id}]);
});
