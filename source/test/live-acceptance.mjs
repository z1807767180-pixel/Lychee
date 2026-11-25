import {randomBytes} from 'node:crypto';
import {acceptanceSession,checkCapabilities,prepareTestGarden,verifyProviders,uuid,requireThat,AcceptanceError} from '../server/acceptance-flow.mjs';
import {spawnSync} from 'node:child_process';
import {mkdir,open,readFile} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const production='https://lychee-link-check.onrender.com';
const stable=resolve(dirname(fileURLToPath(import.meta.url)),'../../../work/live-acceptance-private');
const usage='默认不发起请求。prepare --production --allow-create-test-accounts 建立测试园；ai --production --allow-three-provider-calls --garden UUID 只对该园各验一次聊天、生图、单人海龟汤。';
export function currentUserVault(mode,bytes){
  requireThat(process.platform==='win32','dpapi-unavailable');
  const method=mode==='protect'?'Protect':'Unprotect';
  const command="$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;"+
    "$bytes=[Convert]::FromBase64String([Console]::ReadLine());"+
    "$out=[System.Security.Cryptography.ProtectedData]::"+method+"($bytes,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);"+
    "[Console]::Write([Convert]::ToBase64String($out))";
  const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,
    input:bytes.toString('base64')+'\n',encoding:'utf8',timeout:15000,maxBuffer:32768});
  requireThat(result.status===0&&result.stdout?.trim(),'dpapi-failed');
  return Buffer.from(result.stdout.trim(),'base64');
}

async function exclusive(dir,name,bytes='claimed\n'){
  let f;
  try{f=await open(join(dir,name),'wx',0o600);}
  catch(e){if(e.code==='EEXIST')throw new AcceptanceError('already-claimed');throw new AcceptanceError('ledger-unavailable');}
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
}
function flags(args,word){
  return args.length===2&&args.includes(word)&&args.includes('--production');
}
export async function runAcceptance(argv,fixture){
  if(!argv.length||argv.includes('--help'))return {status:'help',instructions:usage};
  const [phase,...args]=argv;
  const gardenAt=args.indexOf('--garden'),garden=gardenAt<0?'':args[gardenAt+1];
  const gate=phase==='prepare'?flags(args,'--allow-create-test-accounts'):
    phase==='ai'&&uuid(garden)&&args.length===4&&flags(args.filter((_,i)=>i!==gardenAt&&i!==gardenAt+1),'--allow-three-provider-calls');
  requireThat(gate,'explicit-authorization-required');
  if(fixture){
    const url=new URL(fixture.origin);
    requireThat(process.env.NODE_TEST_CONTEXT&&url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&url.origin===fixture.origin&&fixture.dir,'loopback-test-only');
  }
  const origin=fixture?.origin??production,dir=fixture?.dir??stable;
  const vault=fixture?.vault??currentUserVault;
  await mkdir(dir,{recursive:true,mode:0o700});
  const seal=async(name,value)=>exclusive(dir,name,vault('protect',Buffer.from(JSON.stringify(value))));
  async function state(){
    try{return JSON.parse(vault('unprotect',await readFile(join(dir,'prepared.dpapi'))).toString());}
    catch{throw new AcceptanceError('prepared-state-unavailable');}
  }
  const session=()=>acceptanceSession({origin,beforePost:mark=>exclusive(dir,mark+'.started')});
  if(phase==='prepare'){
    try{
      await readFile(join(dir,'prepared.dpapi'));
      const previous=await state();
      requireThat(previous.origin===origin&&uuid(previous.garden),'invalid-state');
      return {status:'already-prepared',gardenId:previous.garden};
    }catch(e){if(e.code!=='ENOENT')throw e;}
    const tag=randomBytes(5).toString('hex'),name='验收园-'+tag;
    const users=['甲','乙','丙'].map(label=>({name:'验'+tag+label,password:randomBytes(24).toString('base64url')}));
    // Allocate the secrets before the first POST. An interrupted prepare is never replayed.
    await seal('prepare-credentials.dpapi',{origin,name,users});
    await checkCapabilities(session);
    const saved=await prepareTestGarden({session,users,name}),g=saved.garden;
    await seal('prepared.dpapi',{origin,name,garden:g,owner:users[0]});
    return {status:'prepared',gardenId:g,accounts:3,joined:1,foreignAccessDenied:1,crossSessionReads:2};
  }
  const saved=await state();
  requireThat(saved.origin===origin&&saved.garden===garden&&uuid(saved.owner?.id)&&/^验收园-[0-9a-f]{10}$/.test(saved.name)&&
    saved.owner.name==='验'+saved.name.slice(4)+'甲','garden-or-identity-mismatch');
  await exclusive(dir,'ai-phase.started');
  await checkCapabilities(session);
  await verifyProviders({session,saved});
  await exclusive(dir,'ai-finished.json',JSON.stringify({gardenId:garden,chat:1,image:1,soup:1}));
  return {status:'verified',gardenId:garden,chat:1,image:1,soup:1};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  try{console.log(JSON.stringify(await runAcceptance(process.argv.slice(2))));}
  catch(e){console.error(JSON.stringify({status:'stopped',reason:e instanceof AcceptanceError?e.message:'verification-failed'}));process.exitCode=1;}
}
