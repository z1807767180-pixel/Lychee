import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const legacy='legacy';
const validDigest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const fingerprint=row=>createHash('sha256').update(JSON.stringify([row.username,row.salt,row.verifier])).digest('hex');
const query=async(tx,sql,...args)=>(await tx.execute({sql,args})).rows;
const one=async(tx,sql,...args)=>(await query(tx,sql,...args))[0];

async function inspect(tx,{legacyOwnerSlot,notices,allowEmpty},apply){
  const tables=new Set((await query(tx,"SELECT name FROM sqlite_master WHERE type='table'")).map(row=>row.name));
  if(!tables.has('camp_accounts')||!tables.has('camp_sessions'))throw Error('Legacy account/session schema missing; select the original Turso database.');
  const rows=await query(tx,'SELECT slot,username,salt,verifier FROM camp_accounts ORDER BY slot');
  if(!rows.length&&!allowEmpty)throw Error('No legacy accounts found.');
  const slots=new Set(rows.map(row=>Number(row.slot)));
  if(legacyOwnerSlot!==null&&(!Number.isInteger(legacyOwnerSlot)||!slots.has(legacyOwnerSlot)))throw Error('Selected legacy owner slot is absent.');
  const found=await one(tx,'SELECT COUNT(*) AS n FROM camp_sessions s JOIN camp_accounts a ON a.slot=s.slot WHERE s.expires>?',Date.now());
  const accountTables=['mc_accounts','mc_gardens','mc_members','mc_legacy_slots','mc_reads'];
  const initialized=accountTables.every(name=>tables.has(name));
  if(!initialized&&(apply||accountTables.some(name=>tables.has(name))))throw Error('Initialize the complete Turso account schema first.');
  const bindings=initialized?await query(tx,'SELECT slot,account,source_digest FROM mc_legacy_slots ORDER BY slot'):[];
  if(bindings.some(binding=>!slots.has(Number(binding.slot))))throw Error('A mapped legacy slot disappeared; inspect the source before continuing.');
  const garden=initialized&&await one(tx,'SELECT id FROM mc_gardens WHERE id=?',legacy);
  if(Boolean(garden)!==Boolean(bindings.length))throw Error('Reserved legacy garden and its identity mappings disagree.');
  const owners=initialized?await query(tx,"SELECT slot FROM mc_members WHERE garden=? AND role='owner'",legacy):[];
  const allOriginalManagers=owners.length===3&&[1,2,3].every(slot=>
    owners.some(row=>Number(row.slot)===slot)&&bindings.some(row=>Number(row.slot)===slot));
  if((owners.length>1&&!allOriginalManagers)||legacyOwnerSlot!==null&&owners.some(row=>Number(row.slot)!==legacyOwnerSlot))throw Error('Existing legacy owner cannot be reassigned by import.');
  if(apply&&rows.length&&!garden)await query(tx,'INSERT INTO mc_gardens(id,name) VALUES(?,?)',legacy,'原荔枝园');
  const ids=new Map();
  let added=0,eligibleReads=0;
  for(const row of rows){
    const slot=Number(row.slot);
    if(![1,2,3].includes(slot)||typeof row.username!=='string'||!row.username.trim()||row.username.length>14||typeof row.salt!=='string'||!row.salt||!validDigest(row.verifier))throw Error('Invalid legacy identity; no changes committed.');
    const digest=fingerprint(row);
    const binding=bindings.find(item=>Number(item.slot)===slot);
    if(binding){
      const identity=await one(tx,`SELECT a.username,a.salt,a.verifier,a.iterations,m.slot FROM mc_accounts a
        JOIN mc_members m ON m.account=a.id AND m.garden=? WHERE a.id=?`,legacy,binding.account);
      if(digest!==binding.source_digest||!identity||identity.username!==row.username||identity.salt!==row.salt||identity.verifier!==row.verifier||Number(identity.iterations)!==100000||Number(identity.slot)!==slot)throw Error('Mapped legacy identity or membership differs; no changes committed.');
      ids.set(slot,binding.account);
      continue;
    }
    if(initialized&&(await one(tx,'SELECT 1 FROM mc_accounts WHERE username=?',row.username)||await one(tx,'SELECT 1 FROM mc_members WHERE garden=? AND slot=?',legacy,slot)))throw Error('Username or reserved legacy slot conflicts; no changes committed.');
    ++added;
    const id=apply?randomUUID():null;
    ids.set(slot,id);
    if(apply){
      await query(tx,'INSERT INTO mc_accounts(id,username,salt,verifier,iterations,last_garden) VALUES(?,?,?,?,100000,?)',id,row.username,row.salt,row.verifier,legacy);
      await query(tx,"INSERT INTO mc_members(account,garden,slot,role) VALUES(?,?,?,'member')",id,legacy,slot);
      await query(tx,'INSERT INTO mc_legacy_slots(slot,account,source_digest) VALUES(?,?,?)',slot,id,digest);
    }
  }
  if(apply&&legacyOwnerSlot!==null)await query(tx,"UPDATE mc_members SET role='owner' WHERE garden=? AND slot=?",legacy,legacyOwnerSlot);
  // Old per-event notification reads in v61_notices_read are a different domain.
  if(tables.has('release_reads')){
    for(const notice of notices){
      const plain=notice.id.startsWith('release-')?notice.id.slice(8):notice.id;
      const reads=await query(tx,'SELECT DISTINCT member FROM release_reads WHERE version IN (?,?)',notice.id,plain);
      for(const read of reads){
        const slot=Number(read.member);
        if(!ids.has(slot))continue;
        ++eligibleReads;
        if(apply)await query(tx,'INSERT OR IGNORE INTO mc_reads(account,notice) VALUES(?,?)',ids.get(slot),notice.id);
      }
    }
  }
  if(apply){
    await query(tx,'CREATE TABLE IF NOT EXISTS mc_v640_install(id INTEGER PRIMARY KEY CHECK(id=1),ready INTEGER NOT NULL CHECK(ready=1))');
    await query(tx,'INSERT OR IGNORE INTO mc_v640_install(id,ready) VALUES(1,1)');
  }
  return {gardenId:rows.length?legacy:null,sourceAccounts:rows.length,slots:[...slots],imported:apply?added:0,pendingAccounts:apply?0:added,
    activeLegacySessions:Number(found.n),importedSessions:0,sessionMode:'live camp_sessions',eligibleReleaseReads:eligibleReads,applied:apply};
}

async function run(client,options,apply){
  const tx=await client.transaction(apply?'write':'read');
  try{
    const result=await inspect(tx,{legacyOwnerSlot:null,notices:[],allowEmpty:false,...options},apply);
    await tx.commit();
    return result;
  }catch(error){
    try{await tx.rollback();}catch{}
    throw error;
  }finally{tx.close();}
}

export const inspectTursoLegacy=(client,options={})=>run(client,options,false);
// The caller initializes mc_* once. All identity mappings are committed together.
export const migrateTursoLegacy=(client,options={})=>run(client,options,true);

async function readMarker(client){
  const table=await one(client,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='mc_v640_install'");
  if(!table)return false;
  const marker=await one(client,'SELECT ready FROM mc_v640_install WHERE id=1');
  if(Number(marker?.ready)!==1)throw Error('Incomplete readiness marker.');
  return true;
}

async function operate(mode,env,options,legacyDir){
  const [{createTursoClient},{notices}]=await Promise.all([import('./turso-client.mjs'),import('./notices.mjs')]);
  const client=await createTursoClient({url:env.TURSO_DATABASE_URL,authToken:env.TURSO_AUTH_TOKEN,legacyDir});
  try{
    const config={notices,...options};
    const ready=await readMarker(client);
    const checked=await inspectTursoLegacy(client,config);
    if(ready&&checked.pendingAccounts)throw Error('Installation and identity mappings disagree.');
    let result=checked,status=mode==='inspect'?'inspected':'already-ready';
    if(mode==='apply'&&(!ready||options.legacyOwnerSlot!=null)){
      if(!ready){
        const {ensureTursoAccountsSchema}=await import('./turso-accounts.mjs');
        await ensureTursoAccountsSchema(client);
      }
      result=await migrateTursoLegacy(client,config);
      status='applied';
    }
    return {status,ready:ready||status==='applied',sourceAccounts:result.sourceAccounts,
      pendingAccounts:result.pendingAccounts,imported:result.imported,activeLegacySessions:result.activeLegacySessions,
      eligibleReleaseReads:result.eligibleReleaseReads};
  }finally{client.close();}
}

// The original server invokes this after it is listening. The environment value
// only selects the operation at that call site; a missing mode here is a no-op.
export async function runTursoStartupOperation({mode,env=process.env,legacyDir}={}){
  if(mode===undefined||mode==='')return {status:'skipped'};
  if(!['inspect','apply'].includes(mode))throw Error('Invalid Turso startup operation.');
  try{
    const result=await operate(mode,env,{},legacyDir);
    console.info('Lychee Turso startup',JSON.stringify(result));
    return result;
  }catch{
    throw Error('Turso startup operation failed. Check database access, the readiness marker and original identity mappings.');
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const {values}=parseArgs({options:{apply:{type:'boolean'},'allow-empty':{type:'boolean'},'legacy-owner-slot':{type:'string'}}});
  const options={allowEmpty:values['allow-empty']===true,legacyOwnerSlot:values['legacy-owner-slot']===undefined?null:Number(values['legacy-owner-slot'])};
  try{
    console.log(JSON.stringify(await operate(values.apply?'apply':'inspect',process.env,options)));
  }catch{console.error('Turso operation failed. Check database access, the readiness marker and original identity mappings.');process.exitCode=1;}
}
