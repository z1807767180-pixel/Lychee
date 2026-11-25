import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {constants as sqliteConstants} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createTursoClient} from '../server/turso-client.mjs';
import {listen} from '../server/index.mjs';
import {createTursoAccounts,ensureTursoAccountsSchema} from '../server/turso-accounts.mjs';
import {inspectTursoLegacy,migrateTursoLegacy,runTursoStartupOperation} from '../server/turso-migrate.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const notices=[{id:'release-6.4.0',title:'测试公告',body:'本地验证'}];
const origin='http://127.0.0.1';
function request(path,body,cookie=''){
  const headers={origin,cookie};
  if(body)headers['content-type']='application/json';
  return new Request(origin+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined});
}
async function checked(handler,path,body,cookie='',status=200){
  const response=await handler(request(path,body,cookie));
  assert.equal(response.status,status,path+' '+response.status);
  return response;
}
function jar(response,name){
  const line=response.headers.getSetCookie().find(value=>value.startsWith(name+'='));
  assert.ok(line);return line.split(';')[0];
}
const oldCookie='__Host-lychee',newCookie='__Host-lychee-account';
const sha=value=>createHash('sha256').update(value).digest('hex');

test('unchanged legacy libSQL handlers, three mapped identities, live legacy sessions and source-preserving cutover',async t=>{
  const fixture=await startTursoFixture();
  const {sqlite}=fixture, client=await createTursoClient(fixture);
  // Original modules construct two actual libSQL HTTP clients at import time.
  // Bind both to the disposable Hrana fixture before import; block non-fixture fetches.
  process.env.TURSO_DATABASE_URL=fixture.url;
  process.env.TURSO_AUTH_TOKEN=fixture.authToken;
  const normalFetch=globalThis.fetch;
  const allowed=new Set([fixture.url]);
  globalThis.fetch=(input,init)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(!allowed.has(url.origin))throw Error('Non-fixture network request blocked');
    return normalFetch(input,init);
  };
  t.after(async()=>{globalThis.fetch=normalFetch;client.close();await fixture.close();});
  const common=await import('../legacy/chunk-ZIGCNLDY.mjs');
  const account=await import('../legacy/account.mjs'),camp=await import('../legacy/camp.mjs'),phone=await import('../legacy/phone.mjs');
  await common.schema();
  const sample=Array.from({length:3},(_,i)=>({name:'离线成员'+(i+1),password:randomBytes(18).toString('hex'),slot:i+1}));
  for(const person of sample){
    const salt=common.random(),verifier=await common.verifier(person.password,salt);
    sqlite.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(person.slot,person.name,salt,verifier);
    sqlite.prepare("INSERT INTO camp_profiles VALUES(?,?,?,'','休息','')").run(String(person.slot),person.name,person.slot-1);
    const logged=await checked(account.POST,'/api/account',{mode:'login',name:person.name,password:person.password});
    person.cookie=jar(logged,oldCookie);
    const token=person.cookie.slice(oldCookie.length+1);
    assert.equal(sqlite.prepare('SELECT slot FROM camp_sessions WHERE token=? AND expires>?').get(sha(token),Date.now()).slot,person.slot);
    person.chat=randomUUID();
    await checked(camp.POST,'/api/camp',{type:'note',name:person.name,avatar:person.slot-1,key:person.chat,body:'旧端留言 '+person.slot},person.cookie);
    person.task=randomUUID();
    await checked(phone.POST,'/api/phone',{type:'v61-task',id:person.task,kind:'task',title:'旧端提醒 '+person.slot,body:'',due:null},person.cookie);
  }
  sqlite.prepare("INSERT INTO release_reads VALUES('2','6.4.0')").run();
  function sourceState(){
    const tables=sqlite.prepare("SELECT name,sql FROM sqlite_master WHERE type='table' AND name NOT GLOB 'mc_*' ORDER BY name").all();
    const digest=createHash('sha256');
    for(const table of tables){
      const safe='"'+table.name.replaceAll('"','""')+'"';
      digest.update(JSON.stringify(table));
      digest.update(JSON.stringify(sqlite.prepare('SELECT * FROM '+safe).all()));
    }
    return {tables:tables.length,digest:digest.digest('hex')};
  }
  const before=sourceState();
  const plan=await inspectTursoLegacy(client,{notices});
  assert.equal(plan.pendingAccounts,3);assert.equal(plan.activeLegacySessions,3);assert.equal(plan.applied,false);
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name GLOB 'mc_*'").get().n,0);
  const accounts=await createTursoAccounts(client,{notices});
  const first=await accounts.importLegacy({notices});
  assert.equal(first.imported,3);assert.equal(first.importedSessions,0);
  assert.equal(sqlite.prepare('SELECT ready FROM mc_v640_install WHERE id=1').get().ready,1);
  assert.deepEqual(await migrateTursoLegacy(client,{notices}),{...first,imported:0});
  assert.deepEqual(sourceState(),before);
  for(const person of sample){
    const req=request('/api/workspace',null,person.cookie);
    const oldSession=await accounts.resolveSession(req);
    assert.equal(oldSession.slot,person.slot);
    const state=await (await accounts.handle(req)).json();
    assert.equal(state.gardens[0].role,'member');
    assert.equal(state.notices[0].read,person.slot===2);
    const renewed=await checked(accounts.handle,'/api/account',{mode:'login',name:person.name,password:person.password});
    person.newCookie=jar(renewed,newCookie);
    const fresh=await accounts.resolveSession(request('/api/workspace',null,person.newCookie));
    assert.equal(oldSession.accountId,fresh.accountId);
    const roster=await (await checked(camp.GET,'/api/camp?roster=lychee',null,person.cookie)).json();
    assert.equal(roster.notes.filter(n=>sample.some(p=>n.id==='chat.'+p.slot+'.'+p.chat)).length,3);
    const personal=await (await checked(phone.GET,'/api/phone?v61=personal',null,person.cookie)).json();
    assert.deepEqual(personal.tasks.map(row=>row.id),[person.task]);
  }
  const app=await listen({storage:'turso',turso:{url:fixture.url,authToken:fixture.authToken}});
  allowed.add(app.url);
  async function gateway(path,cookie,body){
    const response=await fetch(app.url+path,{method:body?'POST':'GET',headers:{origin:app.url,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
    assert.equal(response.status,200,path);return response.json();
  }
  let privateNote,privateGarden;
  try{
    for(const person of sample){
      const path='/g/legacy/api';
      const oldRecord='chat.'+person.slot+'.'+person.chat;
      assert.ok((await gateway(path+'/camp?roster=lychee',person.newCookie)).notes.some(row=>row.id===oldRecord));
      const fromOld=await gateway(path+'/phone?v61=personal',person.newCookie);
      assert.deepEqual(fromOld.tasks.map(row=>[row.id,row.title]),[[person.task,'旧端提醒 '+person.slot]]);
      person.newChat=randomUUID();
      await gateway(path+'/camp',person.newCookie,{type:'note',name:person.name,avatar:person.slot-1,key:person.newChat,body:'新端兼容留言 '+person.slot});
      await gateway(path+'/phone',person.newCookie,{type:'v61-task',id:person.task,kind:'task',body:'',title:'新版修改 '+person.slot,due:null});
      const seen=await (await checked(phone.GET,'/api/phone?v61=personal',null,person.cookie)).json();
      assert.deepEqual(seen.tasks.map(row=>[row.id,row.title]),[[person.task,'新版修改 '+person.slot]]);
    }
    const actor=sample[0];
    const privateCircle=await gateway('/api/v640/workspace',actor.newCookie,{action:'create',name:'独立测试园'});
    privateGarden=privateCircle.activeGardenId;
    privateNote=randomUUID();
    await gateway('/g/'+privateCircle.activeGardenId+'/api/camp',actor.newCookie,{type:'note',name:actor.name,avatar:0,key:privateNote,body:'独立园的留言'});
    const privateStore=await gateway('/g/'+privateCircle.activeGardenId+'/api/camp?roster=lychee',actor.newCookie);
    assert.ok(privateStore.notes.some(row=>row.id==='chat.1.'+privateNote));
  }finally{await app.close();allowed.delete(app.url);}
  // Revert the application layer only: original handlers keep serving the same file.
  for(const person of sample){
    const roster=await (await checked(camp.GET,'/api/camp?roster=lychee',null,person.cookie)).json();
    assert.ok(sample.every(p=>roster.notes.some(row=>row.id==='chat.'+p.slot+'.'+p.newChat)));
    assert.ok(!roster.notes.some(row=>row.id==='chat.1.'+privateNote));
  }
  const whileDisabled=randomUUID(),firstPerson=sample[0];
  await checked(camp.POST,'/api/camp',{type:'note',key:whileDisabled,name:firstPerson.name,avatar:0,body:'新版停用时的旧端留言'},firstPerson.cookie);
  const resumed=await listen({storage:'turso',turso:{url:fixture.url,authToken:fixture.authToken}});
  allowed.add(resumed.url);
  try{
    for(const [garden,note] of [['legacy',whileDisabled],[privateGarden,privateNote]]){
      const response=await fetch(resumed.url+'/g/'+garden+'/api/camp?roster=lychee',{headers:{cookie:firstPerson.newCookie}});
      assert.equal(response.status,200);assert.ok((await response.json()).notes.some(row=>row.id==='chat.1.'+note));
    }
  }finally{await resumed.close();allowed.delete(resumed.url);}
  // A token minted after mapping is accepted without running migration again.
  const p=sample[0],newOldLogin=await checked(account.POST,'/api/account',{mode:'login',name:p.name,password:p.password});
  const later=jar(newOldLogin,oldCookie);
  assert.equal((await accounts.resolveSession(request('/api/workspace',null,later))).slot,p.slot);
  await checked(account.POST,'/api/account',{mode:'logout'},later);
  assert.equal(await accounts.resolveSession(request('/api/workspace',null,later)),null);
  const expiring=jar(await checked(account.POST,'/api/account',{mode:'login',name:p.name,password:p.password}),oldCookie);
  sqlite.prepare('UPDATE camp_sessions SET expires=? WHERE token=?').run(Date.now()-1,sha(expiring.slice(oldCookie.length+1)));
  assert.equal(await accounts.resolveSession(request('/api/workspace',null,expiring)),null);
  await checked(camp.GET,'/api/camp?roster=lychee',null,expiring,401);
  // An explicit new-side logout cannot restore the same old token on re-import.
  await checked(accounts.handle,'/api/account',{mode:'logout'},sample[2].cookie);
  assert.equal(await accounts.resolveSession(request('/api/workspace',null,sample[2].cookie)),null);
  await migrateTursoLegacy(client,{notices});
  assert.equal(await accounts.resolveSession(request('/api/workspace',null,sample[2].cookie)),null);
  await checked(camp.GET,'/api/camp',null,sample[2].cookie);
  t.diagnostic(JSON.stringify({sourceTablesCompared:before.tables,unchanged:true,initialUsers:3,originalChatWrites:3,originalReminderWrites:3,newChatWritesReadByOld:3,newReminderEditsReadByOld:3,privateGardenNotesHiddenInOld:1,readAfterGatewayStopped:true,resumeShowsOldDuringStopAndIsolatedGarden:true,fixturePipelines:fixture.counts.pipelines}));
});

test('migration rolls back earlier inserts on a later identity conflict; explicit owner and idempotent retry',async t=>{
  const fixture=await startTursoFixture(),client=await createTursoClient(fixture),db=fixture.sqlite;
  t.after(async()=>{client.close();await fixture.close();});
  db.exec(`CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT,salt TEXT,verifier TEXT);
    CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER)`);
  for(const n of [1,2,3])db.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(n,'测试'+n,'独立盐'+n,sha('测试校验值'+n));
  await ensureTursoAccountsSchema(client);
  db.prepare('INSERT INTO mc_accounts(id,username,salt,verifier,iterations) VALUES(?,?,?,?,?)').run('fixture','测试3','fixture',sha('fixture'),600000);
  await assert.rejects(migrateTursoLegacy(client),/conflict/);
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE name='mc_v640_install'").get(),undefined);
  for(const table of ['mc_legacy_slots','mc_gardens','mc_members'])assert.equal(db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM mc_accounts').get().n,1);
  db.prepare("UPDATE mc_accounts SET username='其他测试用户' WHERE id='fixture'").run();
  assert.equal((await migrateTursoLegacy(client,{legacyOwnerSlot:2})).imported,3);
  await assert.rejects(migrateTursoLegacy(client,{legacyOwnerSlot:1}),/owner/);
  assert.equal((await inspectTursoLegacy(client)).pendingAccounts,0);
  assert.equal(db.prepare("SELECT slot FROM mc_members WHERE role='owner'").get().slot,2);
  db.prepare("UPDATE camp_accounts SET username='来源已变' WHERE slot=3").run();
  await assert.rejects(migrateTursoLegacy(client),/differs/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM mc_accounts WHERE username='测试3'").get().n,1);
});

test('empty test source needs explicit opt-in and cannot accidentally publish a legacy garden',async t=>{
  const fixture=await startTursoFixture(),client=await createTursoClient(fixture),db=fixture.sqlite;
  t.after(async()=>{client.close();await fixture.close();});
  db.exec('CREATE TABLE camp_accounts(slot INTEGER,username TEXT,salt TEXT,verifier TEXT);CREATE TABLE camp_sessions(token TEXT,slot INTEGER,expires INTEGER)');
  await ensureTursoAccountsSchema(client);
  await assert.rejects(migrateTursoLegacy(client),/No legacy accounts/);
  assert.equal((await migrateTursoLegacy(client,{allowEmpty:true})).gardenId,null);
  assert.equal((await inspectTursoLegacy(client,{allowEmpty:true})).sourceAccounts,0);
  assert.equal(db.prepare('SELECT ready FROM mc_v640_install WHERE id=1').get().ready,1);
  assert.equal(db.prepare('SELECT count(*) n FROM mc_gardens').get().n,0);
});

test('opt-in startup only reports counts; inspect and repeated ready startup are read-only',async t=>{
  const fixture=await startTursoFixture(),db=fixture.sqlite;
  t.after(()=>fixture.close());
  const env={TURSO_DATABASE_URL:fixture.url,TURSO_AUTH_TOKEN:fixture.authToken};
  assert.deepEqual(await runTursoStartupOperation({env}),{status:'skipped'});
  await assert.rejects(runTursoStartupOperation({mode:'unrecognized',env}),/Invalid Turso startup/);
  assert.equal(fixture.counts.pipelines,0);
  const legacyDir=fileURLToPath(new URL('../legacy/',import.meta.url));
  await assert.rejects(runTursoStartupOperation({mode:'inspect',env,legacyDir:fileURLToPath(new URL('./missing-legacy-fixture/',import.meta.url))}),/Turso startup operation failed/);
  db.exec('CREATE TABLE camp_accounts(slot INTEGER,username TEXT,salt TEXT,verifier TEXT);CREATE TABLE camp_sessions(token TEXT,slot INTEGER,expires INTEGER)');
  const username='启动样本',verifier=sha('启动样本');
  db.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(1,username,'样本盐',verifier);
  const messages=[],writes=[];
  t.mock.method(console,'info',(...args)=>messages.push(args.join(' ')));
  const writeActions=new Set(['CREATE_TABLE','CREATE_INDEX','CREATE_VIEW','CREATE_TRIGGER','ALTER_TABLE','DROP_TABLE','INSERT','UPDATE','DELETE'].map(x=>sqliteConstants['SQLITE_'+x]));
  db.setAuthorizer((action,obj)=>{if(writeActions.has(action))writes.push(obj);return sqliteConstants.SQLITE_OK;});
  const checked=await runTursoStartupOperation({mode:'inspect',env,legacyDir});
  assert.equal(checked.status,'inspected');assert.equal(checked.ready,false);assert.equal(checked.pendingAccounts,1);
  assert.equal(writes.length,0);
  const applied=await runTursoStartupOperation({mode:'apply',env});
  assert.equal(applied.status,'applied');assert.equal(applied.ready,true);assert.equal(applied.imported,1);
  assert.ok(writes.includes('mc_legacy_slots'));
  db.prepare('INSERT INTO mc_legacy_revoked VALUES(?,?)').run(sha('已撤销会话'),Date.now()+86400000);
  db.prepare('INSERT INTO mc_accounts(id,username,salt,verifier,iterations) VALUES(?,?,?,?,?)').run('independent','新用户样本','独立盐',verifier,600000);
  writes.length=0;
  const retry=await runTursoStartupOperation({mode:'apply',env});
  assert.equal(retry.status,'already-ready');assert.equal(retry.imported,0);
  assert.equal(writes.length,0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mc_legacy_revoked').get().n,1);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM mc_accounts').get().n,2);
  db.prepare('UPDATE camp_accounts SET username=? WHERE slot=1').run('人工修改的样本');
  writes.length=0;
  await assert.rejects(runTursoStartupOperation({mode:'apply',env}),/readiness marker and original identity mappings/);
  assert.equal(writes.length,0);
  const output=messages.join(' ');
  for(const restricted of [fixture.authToken,fixture.url,username,'样本盐',verifier,'人工修改的样本'])assert.ok(!output.includes(restricted));
});
