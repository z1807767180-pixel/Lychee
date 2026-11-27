import assert from 'node:assert/strict';
import {createHash,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import test from 'node:test';
import {listen} from '../server/index.mjs';
import {migrate} from '../server/migrate.mjs';

function client(base){
  let cookie='';
  return {setCookie(value){cookie=value;},async call(path,body,status=200){
    const headers={origin:base,cookie};if(body)headers['content-type']='application/json';
    const res=await fetch(base+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
    assert.equal(res.status,status,path);
    const set=res.headers.getSetCookie().find(line=>line.startsWith('__Host-lychee-account='));
    if(set)cookie=set.split(';')[0];
    if(res.headers.get('content-type')?.startsWith('application/json'))return res.json();
    return res.text();
  }};
}

test('live HTTP registration, two private circles, scoped business state and persisted cross-session reads',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-http-'));let app=await listen({dataDir:dir});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const a=client(app.url), b=client(app.url), empty=client(app.url);
  assert.equal((await empty.call('/api/client-capabilities')).version,'6.4.0');
  for(const name of ['/mobile/index.html','/windows/workspace.html'])assert.match(await empty.call(name),/data-app=/);
  const password=randomBytes(12).toString('hex');
  for(const [actor,name] of [[a,'小树'],[b,'篮球'],[empty,'新账号']]){
    await actor.call('/api/account',{mode:'register',name,password});
    assert.deepEqual((await actor.call('/api/workspace')).gardens,[]);
  }
  const spaceA=(await a.call('/api/workspace',{action:'create',name:'周末跑团'})).activeGardenId;
  const spaceB=(await b.call('/api/workspace',{action:'create',name:'学习小队'})).activeGardenId;
  const roster=g=>'/g/'+g+'/api/camp?roster=lychee';
  await empty.call(roster(spaceA),null,403);await b.call(roster(spaceA),null,403);
  const id=randomUUID(), msg='计划周六八点集合';
  await a.call('/g/'+spaceA+'/api/camp',{type:'note',key:id,name:'小树',avatar:0,body:msg});
  assert.ok((await a.call(roster(spaceA))).notes.some(n=>n.body===msg));
  assert.ok(!(await b.call(roster(spaceB))).notes.some(n=>n.body===msg));
  for(const actor of [b,empty])for(const path of ['camp?image=chat.1.'+id,'phone?image='+id,'phone/circles','phone?v61=personal'])
    await actor.call('/g/'+spaceA+'/api/'+path,null,403);
  const invite=(await a.call('/api/workspace',{action:'invite',gardenId:spaceA})).inviteCode;
  await b.call('/api/workspace',{action:'join',code:invite});
  const accountB=(await b.call('/api/workspace')).account.id;
  assert.ok((await b.call('/g/'+spaceA+'/api/for/'+accountB+'/camp')).notes.some(n=>n.body===msg));
  const accountA=(await a.call('/api/workspace')).account.id;
  const quiz=(account,garden)=>'/api/v7/quiz?accountId='+account+'&gardenId='+garden;
  await empty.call(quiz(accountA,spaceA),null,403);
  await b.call(quiz(accountB,'legacy'),null,403);
  const quizA=quiz(accountA,spaceA), quizB=quiz(accountB,spaceA);
  const guestSlot=(await b.call(quizB)).slot, match=randomUUID();
  const invitation={action:'invite',id:match,guest:guestSlot};
  assert.equal((await a.call(quizA,invitation)).chatDelivered,true);
  assert.equal((await a.call(quizA,invitation)).chatDelivered,true);
  const cards=(await b.call(roster(spaceA))).notes.filter(n=>n.body.includes(match));
  assert.equal(cards.length,1);assert.match(cards[0].body,/头脑王者/);
  assert.equal((await b.call(quizB)).invitations[0].id,match);
  await b.call(quiz(accountB,spaceB)+'&id='+match,null,404);
  assert.equal((await a.call(quizA,{action:'cancel',id:match})).status,'cancelled');
  await b.call('/api/workspace',{action:'switch',gardenId:spaceB});
  assert.ok((await b.call(roster(spaceA))).notes.some(n=>n.body===msg));
  await b.call('/api/workspace',{action:'read',noticeId:'release-6.4.0'});
  assert.equal((await a.call('/api/workspace')).notices[0].read,false);
  await app.close();app=await listen({dataDir:dir});
  const next=client(app.url);await next.call('/api/account',{mode:'login',name:'篮球',password});
  assert.equal((await next.call('/api/workspace')).notices[0].read,true);
  assert.ok((await next.call(roster(spaceA))).notes.some(n=>n.body===msg));
  await next.call('/api/camp',null,403);
});

test('atomic offline migration retains original password, live session and original /api/camp data',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-migr-')), src=join(dir,'snapshot.sqlite'), dest=join(dir,'new');
  const original=new DatabaseSync(src), salt=randomBytes(12).toString('hex'),token=randomBytes(32).toString('hex');
  const password=randomBytes(10).toString('hex'), ver=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
  original.exec('CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT,salt TEXT,verifier TEXT);CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER);CREATE TABLE goal(id INTEGER PRIMARY KEY,start TEXT NOT NULL,target TEXT NOT NULL)');
  original.prepare('INSERT INTO camp_accounts VALUES(1,?,?,?)').run('原成员',salt,ver);
  original.prepare('INSERT INTO camp_sessions VALUES(?,1,?)').run(createHash('sha256').update(token).digest('hex'),Date.now()+3600000);
  original.exec("INSERT INTO goal VALUES(1,'2026-01-01','2027-11-25')");original.close();
  const before=await readFile(src);
  assert.equal((await migrate(src,dest)).imported,1);
  await assert.rejects(migrate(src,dest),/existing data/);
  const app=await listen({dataDir:dest});
  t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  const old=client(app.url);old.setCookie('__Host-lychee='+token);
  assert.equal((await old.call('/api/camp')).goal.target,'2027-11-25');
  const renewed=client(app.url);await renewed.call('/api/account',{mode:'login',name:'原成员',password});
  assert.equal((await renewed.call('/api/workspace')).gardens[0].id,'legacy');
  assert.equal((await renewed.call('/g/legacy/api/camp')).goal.target,'2027-11-25');
  assert.deepEqual(await readFile(src),before);
});
