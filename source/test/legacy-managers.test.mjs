import assert from 'node:assert/strict';
import {createHash,pbkdf2Sync,randomBytes} from 'node:crypto';
import test from 'node:test';
import {grantLegacyManagers,runLegacyManagers} from '../server/legacy-managers.mjs';
import {listen} from '../server/index.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {ensureTursoAccountsSchema} from '../server/turso-accounts.mjs';
import {migrateTursoLegacy,inspectTursoLegacy} from '../server/turso-migrate.mjs';
import {startTursoFixture} from './turso-fixture.mjs';
import {Browser,until} from './browser.mjs';

function legacyRows(db) {
  db.exec('CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT,salt TEXT,verifier TEXT);'+
    'CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER)');
  return [1,2,3].map(slot=>{
    const name='测试原成员'+slot,password=randomBytes(18).toString('hex'),salt=randomBytes(16).toString('hex');
    const token=randomBytes(32).toString('hex');
    db.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(slot,name,salt,pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));
    db.prepare('INSERT INTO camp_sessions VALUES(?,?,?)').run(createHash('sha256').update(token).digest('hex'),slot,Date.now()+3600000);
    return {name,password,cookie:'__Host-lychee='+token};
  });
}

test('legacy role records are preserved and every joined member can manage only their own garden',async t=>{
  const fixture=await startTursoFixture(),client=await createTursoClient(fixture),secondClient=await createTursoClient(fixture);
  const db=fixture.sqlite,originalPeople=legacyRows(db);
  const source=()=>['camp_accounts','camp_sessions'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY slot').all());
  const baseline=source();
  await ensureTursoAccountsSchema(client);
  await migrateTursoLegacy(client);
  const app=await listen({storage:'turso',turso:fixture});
  let browser;
  t.after(async()=>{await browser?.close();await app.close();client.close();secondClient.close();await fixture.close();});
  const call=(path,cookie,body)=>fetch(app.url+path,{method:body?'POST':'GET',
    headers:{origin:app.url,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
  const workspace=(cookie,action,fields={})=>call('/api/v640/workspace',cookie,action?{action,...fields}:undefined);
  const roles=async cookie=>(await (await workspace(cookie)).json()).gardens;
  const getLegacy=async cookie=>(await roles(cookie)).find(g=>g.id==='legacy');
  const originals=originalPeople.map(p=>p.cookie);
  const signIn=async (name,password,mode='login')=>{
    const response=await call('/api/v640/account','',{name,password,mode});assert.equal(response.status,200);
    return response.headers.getSetCookie().find(line=>line.startsWith('__Host-lychee-account=')).split(';')[0];
  };
  const newSessions=[];
  for(const p of originalPeople)newSessions.push(await signIn(p.name,p.password));
  const newcomerPass=randomBytes(18).toString('hex'),newcomer=await signIn('新成员',newcomerPass,'register');
  const theirGarden=(await (await workspace(newcomer,'create',{name:'其他私园'})).json()).activeGardenId;
  for(const cookie of originals){
    assert.equal((await getLegacy(cookie)).role,'member');
    assert.equal((await workspace(cookie,'invite',{gardenId:'legacy'})).status,200);
    for(const action of ['invite','rotateInvite','edit']){
      assert.equal((await workspace(cookie,action,{gardenId:theirGarden,name:'无关园',subtitle:'',revision:1})).status,403);
    }
  }
  for(const action of ['invite','rotateInvite','edit']){
    assert.equal((await workspace(newcomer,action,{gardenId:'legacy',name:'未加入',subtitle:'',revision:1})).status,403);
  }
  assert.equal((await workspace(originals[0],'edit',{gardenId:'legacy',name:'原园',subtitle:'本人已入园',revision:1})).status,200);
  assert.equal((await workspace(originals[1],'rotateInvite',{gardenId:'legacy'})).status,200);
  if(process.argv.includes('--browser')){
    browser=new Browser();await browser.open();
    await browser.size(984,698);
    const [name,value]=originals[0].split('=');
    assert.equal((await browser.call('Network.setCookie',{name,value,url:app.url+'/',path:'/',secure:true,httpOnly:true})).success,true);
    for(const notice of (await (await workspace(originals[0])).json()).notices){
      await workspace(originals[0],'read',{noticeId:notice.id});
    }
    await browser.call('Page.navigate',{url:app.url+'/windows/workspace.html?garden=legacy'});
    await until(()=>browser.js("!!document.querySelector('.ga-circle-list article')"),'旧园卡片');
    await until(()=>browser.js("!!document.querySelector('.ga-circle-list .ga-invite') && !!document.querySelector('.ga-circle-list .ga-edit')"),'旧成员会话可编辑和邀请');
  }

  const both=await Promise.all([grantLegacyManagers(client),grantLegacyManagers(secondClient)]);
  assert.deepEqual(both.map(r=>r.changed).sort(),[0,3]);
  for(const cookie of [...originals,...newSessions]){
    assert.equal((await getLegacy(cookie)).role,'owner');
    assert.equal((await workspace(cookie,'invite',{gardenId:'legacy'})).status,200);
    assert.equal((await workspace(cookie,'invite',{gardenId:theirGarden})).status,403);
  }
  if(browser){
    await browser.call('Page.reload');
    await until(()=>browser.js("!!document.querySelector('.ga-circle-list .ga-edit') && !!document.querySelector('.ga-circle-list .ga-invite')"),'旧会话可编辑和邀请');
    await browser.js("document.querySelector('.ga-circle-list .ga-invite').click()");
    await until(()=>browser.js("document.querySelector('#ga-heading')?.innerText==='邀请成员'"),'邀请界面');
  }
  for(const [i,cookie] of originals.entries()){
    const previous=await getLegacy(cookie);
    const saved=await workspace(cookie,'edit',{gardenId:'legacy',name:'原园'+i,subtitle:'简介'+i,revision:previous.revision});
    assert.equal(saved.status,200);
    const seen=await getLegacy(newSessions[(i+1)%3]);assert.equal(seen.name,'原园'+i);assert.equal(seen.subtitle,'简介'+i);
    const before=(await (await workspace(cookie,'invite',{gardenId:'legacy'})).json()).inviteCode;
    const after=(await (await workspace(cookie,'rotateInvite',{gardenId:'legacy'})).json()).inviteCode;
    assert.notEqual(after,before);
    assert.equal((await workspace(newcomer,'join',{code:before})).status,400);
  }
  const code=(await (await workspace(originals[2],'invite',{gardenId:'legacy'})).json()).inviteCode;
  assert.equal((await workspace(newcomer,'join',{code})).status,200);
  const returning=await signIn('新成员',newcomerPass),legacy=await getLegacy(returning);
  assert.equal(legacy.role,'member');
  assert.equal((await (await workspace(returning,'invite',{gardenId:'legacy'})).json()).inviteCode,code);
  assert.equal((await workspace(returning,'edit',{gardenId:'legacy',name:'已入园更新',subtitle:'普通成员编辑',revision:legacy.revision})).status,200);
  const replacement=(await (await workspace(returning,'rotateInvite',{gardenId:'legacy'})).json()).inviteCode;
  assert.notEqual(replacement,code);
  assert.equal((await (await workspace(originals[1],'invite',{gardenId:'legacy'})).json()).inviteCode,replacement);
  assert.equal((await getLegacy(newSessions[1])).subtitle,'普通成员编辑');
  assert.equal((await getLegacy(returning)).role,'member');
  const other=(await roles(newcomer)).find(g=>g.id===theirGarden);
  assert.equal(other.role,'owner');assert.equal(other.name,'其他私园');assert.equal(other.revision,1);
  assert.deepEqual(await runLegacyManagers({mode:'apply',env:{TURSO_DATABASE_URL:fixture.url,TURSO_AUTH_TOKEN:fixture.authToken}}),
    {status:'already-applied',mapped:3,managers:3,changed:0});
  assert.equal((await inspectTursoLegacy(client)).pendingAccounts,0);
  assert.deepEqual(source(),baseline);
});

test('upgrade is explicitly gated and rejects incomplete or inconsistent legacy mappings atomically',async t=>{
  assert.deepEqual(await runLegacyManagers({env:{}}),{status:'skipped'});
  await assert.rejects(runLegacyManagers({mode:'unexpected',env:{}}),/Unsupported/);
  const f=await startTursoFixture(),client=await createTursoClient(f),db=f.sqlite;
  t.after(async()=>{client.close();await f.close();});
  legacyRows(db);await ensureTursoAccountsSchema(client);
  await assert.rejects(grantLegacyManagers(client));
  await migrateTursoLegacy(client);
  db.exec("UPDATE mc_members SET slot=9 WHERE garden='legacy' AND slot=3");
  await assert.rejects(grantLegacyManagers(client),/Expected three/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mc_members WHERE role='owner'").get().n,0);
  db.exec("UPDATE mc_members SET slot=3 WHERE garden='legacy' AND slot=9");
  db.exec("UPDATE mc_accounts SET verifier='mismatch' WHERE id=(SELECT account FROM mc_legacy_slots WHERE slot=2)");
  await assert.rejects(grantLegacyManagers(client),/Expected three/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM mc_members WHERE role='owner'").get().n,0);
});
