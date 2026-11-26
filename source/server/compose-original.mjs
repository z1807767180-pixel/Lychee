import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {dirname,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const originalDigest='50c335d2e5c8c44e44bd124cc71a2b434801508f4a8d999a7f08a7471b73e378';
export async function isLegacyAi(request){
  const url=new URL(request.url);
  if(url.pathname!=='/api/camp'&&url.pathname!=='/api/phone')return false;
  if(request.method==='GET')return url.pathname==='/api/phone'&&url.searchParams.get('v62')==='status';
  if(request.method!=='POST')return false;
  let action;
  try{action=await request.clone().json();}catch{return false;}
  if(url.pathname==='/api/phone')return ['v62-chat','v62-assist','v62-image'].includes(action?.type);
  return action?.type==='soup'&&action.act==='send'&&['ask','solve'].includes(action.mode);
}

export function composeOriginal(bytes){
  if(createHash('sha256').update(bytes).digest('hex')!==originalDigest)
    throw Error('Expected the exact 6.3.3 working-source/server.mjs');
  const code=bytes.toString('utf8'),start='createServer(async(req,res)=>{';
  const origin="const url=new URL(req.url,origin);if(url.origin!==origin){res.writeHead(400).end();return}";
  const listen="}).listen(Number(process.env.PORT||10000),'0.0.0.0');";
  const originalCall='const result=await fn(request);';
  if([start,origin,listen,originalCall].some(marker=>code.split(marker).length!==2))throw Error('Original entry shape mismatch');
  const branch=`
 if(url.pathname==='/api/client-capabilities'||url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/api/v7/')||url.pathname.startsWith('/g/')){
  try{
   await (await loadV640())(req,res);
  }catch{if(!res.headersSent)res.writeHead(503,{'Cache-Control':'no-store','Retry-After':'10'});res.end();}
  return;
 }`;
  const startup=`let v640Mount;
const v640OriginalDir=fileURLToPath(new URL('.',import.meta.url));
${isLegacyAi.toString()}
function loadV640(){
 return v640Mount??=import('./lychee-v640/server/coexist.mjs').then(m=>m.createV640Mount({origin,legacyDir:v640OriginalDir})).catch(error=>{v640Mount=undefined;throw error;});
}
if(process.env.LYCHEE_LEGACY_MANAGERS){
 setImmediate(()=>import('./lychee-v640/server/legacy-managers.mjs')
  .then(m=>m.runLegacyManagers({mode:process.env.LYCHEE_LEGACY_MANAGERS,legacyDir:v640OriginalDir}))
  .catch(()=>console.error('Lychee legacy managers upgrade failed.')));
}
if(process.env.LYCHEE_TURSO_STARTUP_OPERATION){
 setImmediate(()=>import('./lychee-v640/server/turso-migrate.mjs')
  .then(m=>m.runTursoStartupOperation({mode:process.env.LYCHEE_TURSO_STARTUP_OPERATION,legacyDir:v640OriginalDir}))
  .catch(()=>console.error('Lychee Turso startup operation failed; check the staged configuration.')));
}
`;
  const smoke=`}).once('listening',function(){
 const mode=process.env.LYCHEE_RELEASE_SMOKE;
 if(!mode)return;
 const loopbackOrigin='http://127.0.0.1:'+this.address().port;
 void import('./lychee-v640/server/server-acceptance.mjs')
  .then(m=>m.runServerAcceptance({mode,origin,loopbackOrigin,legacyDir:v640OriginalDir}))
  .catch(()=>console.error('Lychee release smoke failed; no automatic retry was requested.'));
`;
  const selectedCall="const result=process.env.LYCHEE_ACCOUNT_AI_QUOTAS==='1' && await isLegacyAi(request) ? await (await loadV640()).legacyAi(request) : await fn(request);";
  return code.replace(start,startup+start).replace(origin,origin+branch).replace(originalCall,selectedCall).replace(listen,smoke+listen);
}

export async function writeDerived(original,output){
  if(resolve(original)===resolve(output))throw Error('Choose a separate output entry');
  const composed=composeOriginal(await readFile(original));
  await mkdir(dirname(resolve(output)),{recursive:true});
  try{await writeFile(output,composed,{flag:'wx'});}
  catch(error){
    if(error.code!=='EEXIST'||await readFile(output,'utf8')!==composed)throw error;
  }
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const args=process.argv.slice(2);
  if(args.length!==4||args[0]!=='--original'||args[2]!=='--output')
    throw Error('Usage: node compose-original.mjs --original original/server.mjs --output stage/server.mjs');
  await writeDerived(args[1],args[3]);
}
