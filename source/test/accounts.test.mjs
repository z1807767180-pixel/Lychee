import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes,pbkdf2Sync} from 'node:crypto';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createAccounts,LEGACY_GARDEN_ID} from '../server/accounts.mjs';

const origin='https://local.example.invalid';
const notices=[{id:'release-6.3.3',title:'前版',body:'已发布'},{id:'release-6.4.0',title:'新版',body:'新版上线'}];
const request=(path,body,cookie)=>new Request(origin+path,{method:body?'POST':'GET',
  headers:{origin,...(cookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
const digest=text=>createHash('sha256').update(text).digest('hex');
function client(service){
  return async(path,body,session,status=200)=>{
    const response=await service.handle(request(path,body,session));
    const result=await response.json();assert.equal(response.status,status,JSON.stringify(result));
    const newHeader=response.headers.getSetCookie().find(c=>c.startsWith('__Host-lychee-account='));
    return {result,cookie:newHeader?.split(';')[0]};
  };
}
const pw=()=>randomBytes(18).toString('hex');
test('公开注册、跨会话切园、四名成员、园级访问、公告已读和磁盘重启',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-account-check-')),file=join(dir,'identity.sqlite');
  let db=new DatabaseSync(file);
  try{
    let service=createAccounts(db,{notices}),api=client(service);
    const users=[];
    for(let n=1;n<=5;n++){
      const password=pw(),name='试用账号'+n;
      const {cookie}=await api('/api/account',{mode:'register',name,password});
      const {result}=await api('/api/workspace',null,cookie);assert.deepEqual(result.gardens,[]);assert.equal(result.activeGardenId,null);
      users.push({name,password,cookie,id:result.account.id});
    }
    const [owner,b,c,d,outside]=users;
    const workspace=(u,body,expected=200)=>api('/api/workspace',body,u.cookie,expected).then(x=>x.result);
    const garden=(await workspace(owner,{action:'create',name:'周末的小园'})).activeGardenId;
    const other=(await workspace(owner,{action:'create',name:'家里的园'})).activeGardenId;
    assert.equal((await workspace(owner,null)).gardens.length,2);
    const meta=(state)=>state.gardens.find(g=>g.id===garden);
    assert.deepEqual(meta(await workspace(owner,null)),{id:garden,name:'周末的小园',subtitle:'',revision:1,role:'owner',memberCount:1});
    const invite=await workspace(owner,{action:'invite',gardenId:garden});
    assert.equal(Object.hasOwn(invite,'inviteExpires'),false);
    const otherCode=(await workspace(owner,{action:'invite',gardenId:other})).inviteCode;
    assert.notEqual(otherCode,invite.inviteCode);
    for(const [index,member] of [b,c,d].entries()){
      const join={action:'join',code:invite.inviteCode};
      const result=await workspace(member,join);
      assert.equal(result.activeGardenId,garden);assert.equal(result.gardens[0].role,'member');
      assert.equal(service.resolveMember(member.id,garden).slot,index+2);
      assert.equal((await workspace(member,join)).gardens.length,1);
    }
    assert.equal(service.resolveMember(outside.id,garden),null);
    assert.equal(service.resolveMember(b.id,other),null);
    await workspace(b,{action:'switch',gardenId:other},403);
    assert.equal((await workspace(b,{action:'invite',gardenId:garden})).inviteCode,invite.inviteCode);
    for(const action of ['invite','rotateInvite','edit']){
      for(const [actor,target] of [[outside,garden],[b,other]]){
        await workspace(actor,{action,gardenId:target,name:'跨园修改',subtitle:'取消',revision:1},403);
      }
    }
    const login=await api('/api/account',{mode:'login',name:owner.name,password:owner.password});
    assert.notEqual(login.cookie,owner.cookie);
    const secondOwner={...owner,cookie:login.cookie};
    assert.equal((await workspace(secondOwner,{action:'invite',gardenId:garden})).inviteCode,invite.inviteCode);
    const rotated=(await workspace(b,{action:'rotateInvite',gardenId:garden})).inviteCode;
    assert.notEqual(rotated,invite.inviteCode);
    assert.equal((await workspace(owner,{action:'invite',gardenId:garden})).inviteCode,rotated);
    await workspace(outside,{action:'join',code:invite.inviteCode},400);
    for(const member of [b,c,d])assert.equal((await workspace(member,null)).gardens[0].id,garden);
    assert.equal((await workspace(outside,{action:'join',code:rotated})).activeGardenId,garden);
    const edits=await Promise.all([b,c].map((user,i)=>service.handle(request('/api/workspace',{
      action:'edit',gardenId:garden,name:'新圈名'+i,subtitle:'新标签'+i,revision:1},user.cookie))));
    assert.deepEqual(edits.map(e=>e.status).sort(),[200,409]);
    const latest=meta(await workspace(owner,null));assert.equal(latest.revision,2);
    assert.equal(latest.name.at(-1),latest.subtitle.at(-1));
    assert.deepEqual(meta(await workspace(b,null)),{...latest,role:'member'});
    const untouched=(await workspace(owner,null)).gardens.find(g=>g.id===other);
    assert.equal(untouched.name,'家里的园');assert.equal(untouched.revision,1);
    assert.equal((await workspace(owner,{action:'invite',gardenId:other})).inviteCode,otherCode);
    await workspace(owner,{action:'edit',gardenId:garden,name:'覆盖旧版本',subtitle:'',revision:1},409);
    assert.equal((await workspace(owner,{action:'switch',gardenId:garden})).activeGardenId,garden);
    assert.equal((await api('/api/workspace',null,login.cookie)).result.activeGardenId,other);
    await workspace(owner,{action:'read',noticeId:'release-6.4.0'});
    await workspace(owner,{action:'read',noticeId:'release-6.4.0'});
    assert.deepEqual((await api('/api/workspace',null,login.cookie)).result.notices.map(n=>n.read),[false,true]);
    assert.ok((await workspace(b,null)).notices.every(n=>!n.read));
    await api('/api/workspace',null,undefined,401);
    await api('/api/account',{mode:'login',name:owner.name,password:pw()},null,401);
    await api('/api/account',{mode:'register',name:owner.name,password:pw()},null,409);
    db.close();db=new DatabaseSync(file);service=createAccounts(db,{notices});api=client(service);
    assert.equal((await workspace(owner,null)).activeGardenId,garden);assert.equal((await workspace(owner,null)).notices[1].read,true);
    assert.equal((await workspace(secondOwner,{action:'invite',gardenId:garden})).inviteCode,rotated);
    assert.deepEqual(meta(await workspace(owner,null)),latest);
    await api('/api/account',{mode:'logout'},owner.cookie);await api('/api/workspace',null,owner.cookie,401);
    assert.equal((await api('/api/workspace',null,login.cookie)).result.activeGardenId,other);
    const passwordRow=db.prepare('SELECT verifier,salt,iterations FROM mc_accounts WHERE id=?').get(owner.id);
    assert.ok(passwordRow.verifier!==owner.password && passwordRow.iterations===600000 && passwordRow.salt.length===64);
  }finally{db.close();await unlink(file);await rmdir(dir);}
});

test('旧版测试库升级保留园资料及成员；旧一次性码失效，新固定码可重开',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-stable-code-')),file=join(dir,'identity.sqlite');
  let db=new DatabaseSync(file);
  try{
    const garden='old',id=randomBytes(16).toString('hex'),salt=pw(),password=pw(),code='LZ-'+randomBytes(16).toString('hex').toUpperCase();
    const verifier=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
    db.exec(`CREATE TABLE mc_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE NOT NULL,salt TEXT NOT NULL,verifier TEXT NOT NULL,iterations INTEGER NOT NULL,last_garden TEXT);
      CREATE TABLE mc_gardens(id TEXT PRIMARY KEY,name TEXT NOT NULL);
      CREATE TABLE mc_members(account TEXT NOT NULL,garden TEXT NOT NULL,slot INTEGER NOT NULL,role TEXT NOT NULL,PRIMARY KEY(account,garden),UNIQUE(garden,slot));
      CREATE TABLE mc_invites(digest TEXT PRIMARY KEY,garden TEXT NOT NULL,expires INTEGER NOT NULL,used_by TEXT);`);
    db.prepare('INSERT INTO mc_accounts VALUES(?,?,?,?,?,?)').run(id,'OwnerV1',salt,verifier,100000,garden);
    db.prepare('INSERT INTO mc_gardens VALUES(?,?)').run(garden,'保留旧圈名');
    db.prepare("INSERT INTO mc_members VALUES(?,?,1,'owner')").run(id,garden);
    db.prepare('INSERT INTO mc_invites VALUES(?,?,?,NULL)').run(digest(code),garden,Date.now()+86400000);
    db.close();db=new DatabaseSync(file);
    let api=client(createAccounts(db));
    const {cookie}=await api('/api/account',{mode:'login',name:'OwnerV1',password});
    assert.deepEqual((await api('/api/workspace',null,cookie)).result.gardens,[{id:garden,name:'保留旧圈名',subtitle:'',revision:1,role:'owner',memberCount:1}]);
    await api('/api/workspace',{action:'join',code},cookie,400);
    const fixed=(await api('/api/workspace',{action:'invite',gardenId:garden},cookie)).result.inviteCode;
    assert.notEqual(fixed,code);
    db.close();db=new DatabaseSync(file);api=client(createAccounts(db));
    assert.equal((await api('/api/workspace',{action:'invite',gardenId:garden},cookie)).result.inviteCode,fixed);
  }finally{db.close();await unlink(file);await rmdir(dir);}
});

test('旧账号和会话迁移保留身份，重试原子且不会复活已注销会话',async()=>{
  const db=new DatabaseSync(':memory:'),old=new DatabaseSync(':memory:');
  try{
    old.exec(`CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE,salt TEXT,verifier TEXT);
      CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER);
      CREATE TABLE release_reads(member TEXT,version TEXT,PRIMARY KEY(member,version));`);
    const source=[];
    for(let slot=1;slot<=3;slot++){
      const name='Existing'+slot,password=pw(),salt=pw(),token=randomBytes(32).toString('hex'),expires=Date.now()+600000;
      const verifier=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
      old.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(slot,name,salt,verifier);
      old.prepare('INSERT INTO camp_sessions VALUES(?,?,?)').run(digest(token),slot,expires);
      source.push({slot,name,password,token,expires});
    }
    old.prepare('INSERT INTO release_reads VALUES(?,?)').run('1','6.3.3');
    const expired=randomBytes(32).toString('hex');
    old.prepare('INSERT INTO camp_sessions VALUES(?,?,?)').run(digest(expired),1,Date.now()-1);
    const service=createAccounts(db,{notices}),api=client(service);
    const first=service.importLegacy(old);assert.deepEqual(first,{gardenId:LEGACY_GARDEN_ID,imported:3,importedSessions:3});
    const again=service.importLegacy(old);assert.equal(again.imported+again.importedSessions,0);
    for(const user of source){
      const oldCookie='__Host-lychee='+user.token;
      const info=service.resolveSession(request('/api/workspace',null,oldCookie));
      assert.equal(info.expires,user.expires);assert.equal(info.slot,user.slot);
      assert.equal(service.resolveMember(info.accountId,'legacy').slot,user.slot);
      assert.equal(service.resolveSession(request('/api/workspace',null,'__Host-lychee-account='+user.token)),null);
      const logged=await api('/api/account',{mode:'login',name:user.name.toLowerCase(),password:user.password});
      const state=(await api('/api/workspace',null,logged.cookie)).result;
      assert.equal(state.account.id,info.accountId);assert.equal(state.activeGardenId,'legacy');
      assert.equal(state.notices[0].read,user.slot===1);assert.equal(state.notices[1].read,false);
      assert.equal(state.gardens[0].role,'member');
    }
    service.importLegacy(old,{legacyOwnerSlot:2});
    const ownerSession=service.resolveSession(request('/api/workspace',null,'__Host-lychee='+source[1].token));
    assert.equal(service.resolveMember(ownerSession.accountId,'legacy').role,'owner');
    assert.throws(()=>service.importLegacy(old,{legacyOwnerSlot:1}),/reassigned/);
    assert.equal(service.resolveSession(request('/api/workspace',null,'__Host-lychee='+expired)),null);
    const active='__Host-lychee='+source[0].token;
    await api('/api/account',{mode:'logout'},active);service.importLegacy(old);
    assert.equal(service.resolveSession(request('/api/workspace',null,active)),null);
    old.prepare('UPDATE camp_accounts SET username=? WHERE slot=2').run('Unexpected');
    assert.throws(()=>service.importLegacy(old),/differs/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM mc_accounts').get().n,3);
  }finally{old.close();db.close();}
});
