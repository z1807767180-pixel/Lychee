import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, pbkdf2Sync, randomBytes} from 'node:crypto';
import {mkdtemp, unlink, rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createTursoClient} from '../server/turso-client.mjs';
import {createTursoAccounts} from '../server/turso-accounts.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const notices=[{id:'release-one',title:'第一条',body:'欢迎'},{id:'release-two',title:'第二条',body:'更新'}];
const origin='https://local.example.invalid';
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const random=()=>randomBytes(16).toString('hex');
const makeRequest=(path,body,cookie,source=origin)=>new Request(origin+'/api/v640/'+path,{
  method:body?'POST':'GET',headers:{origin:source,...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},
  body:body?JSON.stringify(body):undefined,
});
async function open(options) {
  const fixture=await startTursoFixture(options),client=await createTursoClient({url:fixture.url,authToken:fixture.authToken});
  const accounts=await createTursoAccounts(client,{notices});
  return {...fixture,accounts,client,async close(){client.close();await fixture.close();}};
}
async function api(service,path,body,cookie,status=200){
  const res=await service.accounts.handle(makeRequest(path,body,cookie));
  const data=await res.json();
  assert.equal(res.status,status,path+' '+(body?.action??body?.mode??'GET')+' '+(data.error??''));
  return {data,cookie:res.headers.getSetCookie().find(v=>v.startsWith('__Host-lychee-account='))?.split(';')[0]};
}
async function register(service,name){
  const password=random();
  const {cookie}=await api(service,'account',{mode:'register',name,password});
  const {data}=await api(service,'workspace',null,cookie);
  assert.equal(data.activeGardenId,null);assert.deepEqual(data.gardens,[]);
  return {...data.account,password,cookie};
}
const act=async(s,cookie,action,fields={},status=200)=>(await api(s,'workspace',{action,...fields},cookie,status)).data;

test('原 libSQL HTTP 客户端：并发入园、版本冲突、共享码、账号已读与真正磁盘重启',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-http-accounts-')),databasePath=join(dir,'turso-fixture.sqlite');
  let svc=await open({databasePath});
  try{
    const [owner,a,b,c]=await Promise.all(['owner','member-a','member-b','member-c'].map(n=>register(svc,n)));
    const {activeGardenId:g}=await act(svc,owner.cookie,'create',{name:'周末',subtitle:'小队'});
    const invite=async user=>(await act(svc,user.cookie,'invite',{gardenId:g})).inviteCode;
    const [first,second]=await Promise.all([invite(owner),invite(owner)]);
    assert.equal(first,second);
    await Promise.all([a,b,a].map(u=>act(svc,u.cookie,'join',{code:first})));
    const members=await Promise.all([owner,a,b].map(u=>svc.accounts.resolveMember(u.id,g)));
    assert.deepEqual(members.map(m=>m.slot).sort(),[1,2,3]);assert.equal(members[0].role,'owner');
    assert.equal(await svc.accounts.resolveMember(c.id,g),null);
    assert.equal(await invite(a),first);
    for(const action of ['invite','rotateInvite','edit']){
      await act(svc,c.cookie,action,{gardenId:g,name:'圈外操作',subtitle:'',revision:1},403);
    }
    const change=(member,name)=>svc.accounts.handle(makeRequest('workspace',{action:'edit',gardenId:g,name,subtitle:name,revision:1},member.cookie));
    const edits=await Promise.all([change(a,'周六'),change(b,'周日')]);
    assert.deepEqual(edits.map(r=>r.status).sort(),[200,409]);
    const copied=(await api(svc,'workspace',null,a.cookie)).data.gardens[0];
    assert.equal(copied.revision,2);assert.equal(copied.name,copied.subtitle);
    const newCode=(await act(svc,a.cookie,'rotateInvite',{gardenId:g})).inviteCode;
    assert.notEqual(first,newCode);
    await act(svc,c.cookie,'join',{code:first},400);await act(svc,c.cookie,'join',{code:newCode});
    const returning=await api(svc,'account',{mode:'login',name:c.username,password:c.password});
    assert.equal((await api(svc,'workspace',null,returning.cookie)).data.gardens[0].role,'member');
    assert.equal((await act(svc,returning.cookie,'invite',{gardenId:g})).inviteCode,newCode);
    await act(svc,owner.cookie,'read',{noticeId:'release-two'});
    const login=await api(svc,'account',{mode:'login',name:owner.username,password:owner.password});
    assert.notEqual(login.cookie,owner.cookie);
    assert.deepEqual((await api(svc,'workspace',null,login.cookie)).data.notices.map(n=>n.read),[false,true]);
    assert.deepEqual((await api(svc,'workspace',null,a.cookie)).data.notices.map(n=>n.read),[false,false]);
    assert.equal((await svc.accounts.handle(makeRequest('workspace',{action:'read',noticeId:'release-one'},owner.cookie,'https://foreign.invalid'))).status,403);
    const untouched=svc.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'mc_%'").all();
    assert.deepEqual(untouched,[]);assert.ok(svc.counts.pipelines>0);
    await svc.close();svc=null;
    svc=await open({databasePath});
    assert.equal((await api(svc,'workspace',null,owner.cookie)).data.activeGardenId,g);
    assert.equal(await invite(owner),newCode);
    assert.equal((await api(svc,'workspace',null,login.cookie)).data.notices[1].read,true);
    await api(svc,'account',{mode:'logout'},owner.cookie);await api(svc,'workspace',null,owner.cookie,401);
    assert.equal((await api(svc,'workspace',null,login.cookie)).data.gardens[0].revision,2);
  }finally{
    if(svc)await svc.close();
    await unlink(databasePath).catch(e=>{if(e.code!=='ENOENT')throw e;});
    await rmdir(dir);
  }
});

test('兼容旧密码；在线核验旧会话、旧端撤销、后续签发及新端独立注销',async()=>{
  const svc=await open();
  try{
    const db=svc.sqlite,password=random(),salt=random(),accountId='fixture-old',oldToken=randomBytes(32).toString('hex');
    const verifier=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
    db.exec(`CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT);
      INSERT INTO camp_accounts VALUES(2,'ReservedOld');
      CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER);
      INSERT INTO mc_gardens(id,name) VALUES('legacy','原荔枝园');`);
    await api(svc,'account',{mode:'register',name:'reservedold',password:random()},null,409);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_accounts').get().n,0);
    db.prepare('INSERT INTO mc_accounts VALUES(?,?,?,?,?,?)').run(accountId,'老成员',salt,verifier,100000,'legacy');
    db.prepare("INSERT INTO mc_members VALUES(?,'legacy',1,'member')").run(accountId);
    db.prepare('INSERT INTO mc_legacy_slots VALUES(1,?,?)').run(accountId,'local-fixture');
    const add=(token,slot=1,ttl=60000)=>db.prepare('INSERT INTO camp_sessions VALUES(?,?,?)').run(digest(token),slot,Date.now()+ttl);
    const ck=t=>'__Host-lychee='+t;
    add(oldToken);
    assert.equal((await api(svc,'workspace',null,ck(oldToken))).data.activeGardenId,'legacy');
    const {activeGardenId:other}=await act(svc,ck(oldToken),'create',{name:'另一个园'});
    assert.equal((await api(svc,'workspace',null,ck(oldToken))).data.activeGardenId,other);
    db.prepare('DELETE FROM camp_sessions WHERE token=?').run(digest(oldToken));
    await api(svc,'workspace',null,ck(oldToken),401);
    const fresh=randomBytes(32).toString('hex');add(fresh);
    assert.equal((await svc.accounts.resolveSession(makeRequest('workspace',null,ck(fresh)))).accountId,accountId);
    await api(svc,'account',{mode:'logout'},ck(fresh));
    await api(svc,'workspace',null,ck(fresh),401);
    assert.ok(db.prepare('SELECT 1 FROM camp_sessions WHERE token=?').get(digest(fresh)));
    const orphan=randomBytes(32).toString('hex'),expired=randomBytes(32).toString('hex');
    add(orphan,2);add(expired,1,-100);await api(svc,'workspace',null,ck(orphan),401);await api(svc,'workspace',null,ck(expired),401);
    const login=await api(svc,'account',{mode:'login',name:'老成员',password});
    assert.equal((await api(svc,'workspace',null,login.cookie)).data.account.id,accountId);
  }finally{await svc.close();}
});
