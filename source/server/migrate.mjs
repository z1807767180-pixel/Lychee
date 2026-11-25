import {DatabaseSync} from 'node:sqlite';
import {lstat,mkdir,mkdtemp,rename,rm,rmdir,stat} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';
import {createAccounts} from './accounts.mjs';
import {importLegacyDatabase} from './domains.mjs';
import {notices} from './notices.mjs';

// Run offline before first deployment. Both the identity import and all business
// tables use the same SQLite snapshot. No changes are made to the supplied file.
export async function migrate(sourceFile,destination,{legacyOwnerSlot=null}={}){
  const source=resolve(sourceFile),dest=resolve(destination);
  if(!(await stat(source)).isFile())throw Error('Select a SQLite snapshot file');
  const existing=await lstat(dest).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
  if(existing)throw Error('Choose a new, absent data directory; existing data will not be overwritten');
  await mkdir(dirname(dest),{recursive:true});
  const lock=dest+'.migration-lock';
  await mkdir(lock,{mode:0o700});
  let stage;
  try{
    stage=await mkdtemp(join(dirname(dest),'.'+basename(dest)+'-migration-'));
    const snap=await importLegacyDatabase({dataDir:stage,sourceFile:source});
    const old=new DatabaseSync(snap,{readOnly:true}), db=new DatabaseSync(join(stage,'accounts.sqlite'));
    let result;
    try{
      if(old.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw Error('Snapshot failed SQLite quick_check');
      result=createAccounts(db,{notices}).importLegacy(old,{legacyOwnerSlot});
      if(!result.imported)throw Error('No legacy accounts in the supplied snapshot');
    }finally{db.close();old.close();}
    if(await lstat(dest).then(()=>true,e=>{if(e.code!=='ENOENT')throw e;return false;}))throw Error('Destination appeared during migration');
    await rename(stage,dest);stage=null;
    return result;
  } finally {
    if(stage)await rm(stage,{recursive:true,force:true});
    await rmdir(lock);
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const {values}=parseArgs({options:{from:{type:'string'},to:{type:'string'},'legacy-owner-slot':{type:'string'}}});
  if(!values.from||!values.to)throw Error('node server/migrate.mjs --from snapshot.sqlite --to NEW_DATA_DIR');
  console.log(JSON.stringify(await migrate(values.from,values.to,{legacyOwnerSlot:values['legacy-owner-slot']?Number(values['legacy-owner-slot']):null})));
}
