import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import test from 'node:test';
import {createAcceptanceReceipts} from '../server/acceptance-receipts.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const seed=()=>randomBytes(32).toString('hex');
const childCode=`
  import {createTursoClient} from ${JSON.stringify(new URL('../server/turso-client.mjs',import.meta.url).href)};
  import {createAcceptanceReceipts} from ${JSON.stringify(new URL('../server/acceptance-receipts.mjs',import.meta.url).href)};
  import {randomUUID} from 'node:crypto';
  const chunks=[];for await(const chunk of process.stdin)chunks.push(chunk);
  const task=JSON.parse(Buffer.concat(chunks));
  const client=await createTursoClient(task);
  try{
    const ledger=await createAcceptanceReceipts(client,{seed:task.seed,mode:'run'});
    let claim;
    if(task.step==='prepare'){
      claim=await ledger.claimPreparation();
      if(claim.acquired){
        // Simulate the external garden creation only after a committed claim.
        const garden=randomUUID(),owner=randomUUID();
        await client.batch([{sql:'INSERT INTO mc_gardens VALUES(?)',args:[garden]},
          {sql:"INSERT INTO mc_members VALUES(?,?,'owner')",args:[garden,owner]}],'write');
        await ledger.finishPreparation(garden,owner);
      }
    }else{
      claim=await ledger.claimPhase(task.garden);
      if(claim.acquired){
        for(const kind of ['chat','image','soup']){
          if(!(await ledger.claimAttempt(kind,task.garden)).acquired)throw Error('expected a fresh claim');
          // A local effect counter stands in for a provider. No model runs.
          await client.execute({sql:'INSERT INTO fixture_effects VALUES(?)',args:[kind]});
          if(kind!=='soup')await ledger.finishAttempt(kind,task.garden,kind==='chat'?'succeeded':'uncertain');
        }
        // The worker exits with no final acknowledgement for soup or the phase.
      }
    }
    console.log(JSON.stringify({acquired:claim.acquired}));
  }finally{client.close();}
`;
function child(fixture,runSeed,step,garden){
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',childCode],{stdio:['pipe','pipe','pipe'],windowsHide:true});
    let text='',error='';
    child.stdout.on('data',b=>{text+=b;});child.stderr.on('data',b=>{error+=b;});
    child.on('error',reject);
    child.on('close',code=>{
      try{assert.equal(code,0,error);resolve(JSON.parse(text));}catch(e){reject(e);}
    });
    child.stdin.end(JSON.stringify({url:fixture.url,authToken:fixture.authToken,seed:runSeed,step,garden}));
  });
}

test('status on an absent or existing ledger is read-only, and only the claim owner can confirm a real private garden owner',async t=>{
  const f=await startTursoFixture(),client=await createTursoClient(f);
  t.after(async()=>{client.close();await f.close();});
  const runSeed=seed(),read=await createAcceptanceReceipts(client,{seed:runSeed});
  const snapshot=()=>f.sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
  assert.deepEqual(snapshot(),[]);
  assert.equal((await read.status()).preparation.state,'unprepared');
  await assert.rejects(read.claimPreparation(),/read-only/);
  assert.deepEqual(snapshot(),[]);
  f.sqlite.exec('CREATE TABLE mc_gardens(id TEXT PRIMARY KEY); CREATE TABLE mc_members(garden TEXT,account TEXT,role TEXT)');
  const garden=randomUUID(),owner=randomUUID(),stranger=randomUUID();
  f.sqlite.prepare('INSERT INTO mc_gardens VALUES(?)').run(garden);
  f.sqlite.prepare("INSERT INTO mc_members VALUES(?,?,'owner')").run(garden,owner);
  const first=await createAcceptanceReceipts(client,{seed:runSeed,mode:'run'});
  const second=await createAcceptanceReceipts(client,{seed:runSeed,mode:'run'});
  assert.equal((await first.claimPreparation()).acquired,true);
  assert.equal((await second.claimPreparation()).acquired,false);
  await assert.rejects(second.finishPreparation(garden,owner),/unconfirmed/);
  await assert.rejects(first.finishPreparation('legacy',owner),/invalid-private-garden/);
  await assert.rejects(first.finishPreparation(garden,stranger),/unconfirmed/);
  await first.finishPreparation(garden,owner);
  await first.finishPreparation(garden,owner);
  assert.equal((await second.claimPhase(garden)).acquired,true);
  await assert.rejects(first.claimAttempt('chat',garden),/phase-not-owned/);
  await assert.rejects(second.finishPhase(garden,'succeeded'),/unconfirmed/);
  for(const kind of ['chat','image','soup']){
    const racing=await Promise.all([second.claimAttempt(kind,garden),second.claimAttempt(kind,garden)]);
    assert.equal(racing.filter(item=>item.acquired).length,1);
    await assert.rejects(first.finishAttempt(kind,garden,'succeeded'),/unconfirmed/);
    await second.finishAttempt(kind,garden,'succeeded');
  }
  await second.finishPhase(garden,'succeeded');
  const before=f.sqlite.prepare('SELECT total_changes() n').get().n;
  assert.equal((await read.status()).phase,'succeeded');
  assert.equal(f.sqlite.prepare('SELECT total_changes() n').get().n,before);
  const stored=JSON.stringify(f.sqlite.prepare('SELECT * FROM mc_acceptance_runs_v1').all());
  assert.ok(!stored.includes(runSeed));
});

test('concurrent OS processes prepare once and claim each service once; file-backed restart retains ambiguous attempts',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-acceptance-receipts-')),databasePath=join(dir,'fixture.sqlite');
  // Both clients and the local HTTP database are shut down before reopening.
  let f=await startTursoFixture({databasePath}),client=await createTursoClient(f);
  t.after(async()=>{client.close();await f.close();await rm(dir,{recursive:true,force:true});});
  f.sqlite.exec('CREATE TABLE mc_gardens(id TEXT PRIMARY KEY); CREATE TABLE mc_members(garden TEXT,account TEXT,role TEXT); CREATE TABLE fixture_effects(kind TEXT)');
  const runSeed=seed();
  const race=async (step,garden)=>{
    const results=await Promise.all([child(f,runSeed,step,garden),child(f,runSeed,step,garden)]);
    assert.equal(results.filter(r=>r.acquired).length,1);
  };
  await race('prepare');
  assert.equal(f.sqlite.prepare('SELECT count(*) n FROM mc_gardens').get().n,1);
  const reader=await createAcceptanceReceipts(client,{seed:runSeed});
  const info=(await reader.status()).preparation;
  assert.equal(info.state,'ready');
  await race('ai',info.gardenId);
  const interruptedSeed=seed();
  const interrupted=await createAcceptanceReceipts(client,{seed:interruptedSeed,mode:'run'});
  assert.equal((await interrupted.claimPreparation()).acquired,true);
  client.close();await f.close();
  f=await startTursoFixture({databasePath});client=await createTursoClient(f);
  const interruptedAgain=await createAcceptanceReceipts(client,{seed:interruptedSeed,mode:'run'});
  assert.deepEqual(await interruptedAgain.claimPreparation(),{acquired:false,state:'claimed',gardenId:null,ownerAccountId:null});
  const resumed=await createAcceptanceReceipts(client,{seed:runSeed,mode:'run'});
  const state=await resumed.status();
  assert.deepEqual(state.preparation,info);
  assert.equal(state.phase,'claimed');
  assert.deepEqual(state.attempts,{chat:'succeeded',image:'uncertain',soup:'claimed'});
  for(const kind of ['chat','image','soup'])assert.equal((await resumed.claimAttempt(kind,info.gardenId)).acquired,false);
  assert.equal((await resumed.claimPhase(info.gardenId)).acquired,false);
  assert.equal((await resumed.claimPreparation()).acquired,false);
  assert.deepEqual(f.sqlite.prepare('SELECT kind FROM fixture_effects ORDER BY kind').all().map(x=>x.kind),['chat','image','soup']);
  const different=await createAcceptanceReceipts(client,{seed:seed(),mode:'run'});
  assert.equal((await different.claimPreparation()).acquired,true);
  await assert.rejects(different.finishPreparation(info.gardenId,info.ownerAccountId),/unconfirmed/);
  await different.markPreparationUncertain();
  assert.equal((await different.claimPreparation()).acquired,false);
  await assert.rejects(different.claimPhase(info.gardenId),/garden-not-prepared/);
});
