import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdir,readFile,realpath,stat} from 'node:fs/promises';
import {dirname,extname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createAccounts,LEGACY_GARDEN_ID} from './accounts.mjs';
import {createDomains} from './domains.mjs';
import {notices,mobileNotices} from './notices.mjs';
import {handleDietVision} from './diet-vision.mjs';
import {handleDietEntries} from './diet-store.mjs';
import {createWebPush} from './notify-push.mjs';
import {createQuizGames} from './quiz-game.mjs';
import {createSocial,accountToolsGarden} from './social.mjs';

const project=dirname(dirname(fileURLToPath(import.meta.url)));
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8',
  '.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.ico':'image/x-icon',
  '.woff2':'font/woff2','.json':'application/json','.webmanifest':'application/manifest+json','.txt':'text/plain; charset=utf-8',
  '.release':'application/octet-stream','.exe':'application/octet-stream'};
const deny=(status,error)=>Response.json({error},{status,headers:{'cache-control':'private, no-store'}});
const business=new Set(['/api/camp','/api/phone','/api/phone/circles']);
const publicInfo=Object.freeze({protocol:1,version:'6.4.0',accountApi:'v640',privateGardens:true,accountNotices:true});
const accountCatalog=[...mobileNotices,...notices];
const mobileNoticeIds=new Set(mobileNotices.map(n=>n.id));

// Private tools reuse the original per-member storage but never register a
// garden, group membership or invite code. Only these personal operations can
// reach it; the ordinary historical group routes keep their own membership check.
const privatePhoneReads=new Set(['status','images','image','image-status','threads','thread','covers']);
const privatePhoneWrites=new Set(['avatar','portrait','income','edit-income','expense','edit-expense','focus','pause-focus',
  'resume-focus','cancel-focus','v61-task','v61-task-done','v61-task-delete','v61-mood','v61-read',
  'v62-thread-delete','v62-chat','v62-assist','v62-image','v62-cover']);
async function privateToolRequest(request,url,route){
  if(route!=='camp'&&route!=='phone')return false;
  if(request.method==='GET'){
    const q=url.searchParams;
    if(route==='camp')return !q.size||(q.size===1&&q.get('roster')==='lychee');
    if(q.has('v62'))return privatePhoneReads.has(q.get('v62'));
    if(q.has('v61'))return ['personal','notifications'].includes(q.get('v61'));
    return !q.size||[...q.keys()].every(k=>['private','month','tools','portrait','rev'].includes(k));
  }
  if(request.method!=='POST')return false;
  const p=await request.clone().json().catch(()=>null);
  return route==='camp'?p?.type==='profile':privatePhoneWrites.has(p?.type);
}

async function gardenNames(domains,origin,member) {
  const response=await domains.handle(new Request(new URL('/api/camp?roster=circle-names',origin)),member);
  if(!response.ok)return null;
  return new Map((await response.json()).profiles.map(p=>[Number(p.slot),p.name]));
}

async function accountRequest(accounts,domains,url,request,ctx){
  const response=await accounts.handle(new Request(url,request),ctx);
  if(response.ok && request.method==='GET' && url.pathname==='/api/workspace' && url.searchParams.has('members')){
    const session=await accounts.resolveSession(request);
    const garden=url.searchParams.get('members');
    const viewer=session && await accounts.resolveMember(session.accountId,garden);
    if(!viewer)return deny(403,'需要先加入这个圈子');
    const roster=await response.json();
    const profiles=await gardenNames(domains,url,viewer);
    if(!profiles)return deny(503,'圈内昵称暂时无法读取，请重试');
    return Response.json({members:roster.members.map(({slot,name,role})=>({name:profiles.get(slot)||name,role}))},
      {headers:response.headers});
  }
  if(!response.ok || url.pathname!=='/api/workspace')return response;
  const audience=url.searchParams.get('client');
  const state=await response.json();
  state.notices=state.notices.filter(n=>{
    if(n.id.startsWith('windows-'))return audience===n.id;
    return !mobileNoticeIds.has(n.id) || audience==='mobile-web';
  });
  return Response.json(state,{status:response.status,headers:response.headers});
}

async function staticFile(root,path,method){
  if(!root)return null;
  let name;
  try{name=decodeURIComponent(path);}catch{return null;}
  if(name.includes('\\')||name.includes('\0')||name.split('/').some(s=>s.startsWith('.')))return null;
  const type=mime[extname(name).toLowerCase()];if(!type)return null;
  let file,info;
  try{file=await realpath(resolve(root,'.'+name));info=await stat(file);}catch{return null;}
  if(!file.startsWith(root+sep)||!info.isFile())return null;
  return new Response(method==='HEAD'?null:await readFile(file),{headers:{'content-type':type,
    'cache-control':'no-cache','x-content-type-options':'nosniff','referrer-policy':'same-origin'}});
}

async function readLegacyRelease(root){
  if(!root)return null;
  const read=name=>readFile(join(root,name));
  const [web,build,version,signed,exe]=await Promise.all(
    ['web-version.txt','windows-version.txt','product-version.txt','windows.release','lychee-countdown.exe'].map(read));
  const manifest={web:web.toString().trim(),windows:Number(build.toString().trim()),release:version.toString().trim()};
  if(manifest.web!=='336097f30c293325c373cd50'||manifest.windows!==3||manifest.release!=='4.1.7'||
     signed.length!==300||signed.readUInt32LE(8)!==3||!signed.subarray(12,44).equals(createHash('sha256').update(exe).digest()))
    throw Error('Expected the original 4.1.7 static release and matching updater metadata.');
  return JSON.stringify(manifest);
}

function gardenQuiz(execute, domains, push) {
  return createQuizGames(execute,{
    names:(request,member)=>gardenNames(domains,request.url,member),
    async announce(request,member,id,guestName) {
      const origin=new URL(request.url).origin;
      const announcement=await domains.handle(new Request(new URL('/api/camp',origin),{
        method:'POST',headers:{origin,'content-type':'application/json'},
        body:JSON.stringify({type:'note',key:id,name:member.username.slice(0,14),avatar:0,
          body:`【头脑王者】邀请 ${guestName} 答五题\n对局编号：${id}`}),
      }),member);
      if (announcement.ok) void push.signal(member.gardenId);
      return announcement.ok;
    },
  });
}

function originalChat(domains,push){
  return async (request,session,gardenId,row)=>{
    const origin=new URL(request.url).origin;
    const copy=row.body.length<=200?row.body:row.body.slice(0,198)+'…';
    const response=await domains.handle(new Request(new URL('/api/camp',origin),{method:'POST',
      headers:{origin,'content-type':'application/json'},body:JSON.stringify({type:'note',key:row.id,
        name:session.username,avatar:0,body:copy})}),{accountId:session.accountId,username:session.username,gardenId,slot:row.slot});
    if(!response.ok)throw Error('Original group channel unavailable');
    void push.signal(gardenId);
  };
}

async function openStores({storage,turso,dataDir,legacyDir,testProviderOrigin,staticRoots}){
  if(storage==='turso'){
    if(!turso?.url||!turso?.authToken)throw Error('Configure server-side Turso access before starting');
    const {createTursoClient}=await import('./turso-client.mjs');
    const {createTursoAccounts}=await import('./turso-accounts.mjs');
    const {createTursoDomains}=await import('./turso-domains.mjs');
    const client=await createTursoClient({...turso,legacyDir});
    try{
      const accounts=await createTursoAccounts(client,{notices:accountCatalog});
      const domains=createTursoDomains({...turso,legacyDir,testProviderOrigin});
      const execute=(sql,args)=>client.execute({sql,args});
      const push=createWebPush({execute,domains});
      const social=await createSocial({client,publish:originalChat(domains,push)});
      return {accounts,domains,push,social,quiz:gardenQuiz(execute,domains,push),async close(){try{await push.close();await domains.close();await social.close();}finally{client.close();}}};
    }catch(error){client.close();throw error;}
  }
  if(storage!=='sqlite')throw Error('Unsupported LYCHEE_STORAGE');
  if(!dataDir)throw Error('Configure a private, persistent LYCHEE_DATA_DIR');
  const data=resolve(dataDir);
  for(const tree of staticRoots.filter(Boolean)){
    if(data===tree||data.startsWith(tree+sep)||tree.startsWith(data+sep))throw Error('Keep private data outside static directories');
  }
  await mkdir(data,{recursive:true,mode:0o700});
  const db=new DatabaseSync(join(data,'accounts.sqlite'));
  const accounts=createAccounts(db,{notices:accountCatalog}), domains=createDomains({dataDir:data,legacyDir,testProviderOrigin});
  const execute=(sql,args)=>{
    const statement=db.prepare(sql);
    return statement.columns().length?{rows:statement.all(...args)}:{rows:[],rowsAffected:statement.run(...args).changes};
  };
  const push=createWebPush({domains,execute});
  const social=await createSocial({dataDir:data,publish:originalChat(domains,push)});
  return {accounts,domains,push,social,quiz:gardenQuiz(execute,domains,push),async close(){try{await push.close();await domains.close();await social.close();}finally{db.close();}}};
}

export async function createApp({dataDir,storage='sqlite',turso,webRoot=join(project,'public'),legacyDir=join(project,'legacy'),legacyWebRoot,origin,testProviderOrigin}){
  const web=await realpath(webRoot);
  const oldWeb=legacyWebRoot?await realpath(legacyWebRoot):null;
  const oldManifest=await readLegacyRelease(oldWeb);
  if(origin&&new URL(origin).origin!==origin)throw Error('LYCHEE_ORIGIN must be an exact origin');
  const stores=await openStores({storage,turso,dataDir,legacyDir,testProviderOrigin,staticRoots:[web,oldWeb]});
  const {accounts,domains}=stores;
  async function handle(request,ctx={}){
    const url=new URL(request.url), path=url.pathname;
    if(origin&&url.origin!==origin)return deny(400,'请求来源无效');
    if(!['GET','HEAD','POST'].includes(request.method))return deny(405,'不支持此操作');
    if(request.method==='POST'&&request.headers.get('origin')!==url.origin)return deny(403,'请从荔枝应用操作');
    if(path==='/api/client-capabilities'&&request.method==='GET')return Response.json(publicInfo,{headers:{'cache-control':'no-store'}});
    if(path==='/api/v640/account'||path==='/api/v640/workspace')
      url.pathname=path.replace('/api/v640/','/api/');
    if(url.pathname==='/api/account'||url.pathname==='/api/workspace')return accountRequest(accounts,domains,url,request,ctx);
    if(path==='/api/v8/social'){
      const session=await accounts.resolveSession(request);
      return session?stores.social.handle(request,session):deny(401,'请先登录');
    }
    if(path==='/api/v7/diet/recognize'||path==='/api/v7/diet/entries'||path==='/api/v7/push'||path==='/api/v7/quiz'){
      const session=await accounts.resolveSession(request);
      if(!session)return deny(401,'请先登录');
      if(url.searchParams.get('accountId')!==session.accountId)return deny(403,'账号已切换，请重新打开');
      const gardenId=url.searchParams.get('gardenId');
      const privateDiet=path.startsWith('/api/v7/diet/')&&gardenId===accountToolsGarden(session.accountId);
      const member=privateDiet?{...session,gardenId,slot:1}:gardenId&&await accounts.resolveMember(session.accountId,gardenId);
      if(!member)return deny(403,'需要先加入这个圈子');
      if(path==='/api/v7/quiz')return stores.quiz(request,member);
      if(path==='/api/v7/push')return stores.push.handle(request,session,member);
      const config=storage==='turso'?{turso,legacyDir}:{quotaFile:join(dataDir,'accounts.sqlite')};
      if(path.endsWith('/recognize')){
        if(request.method!=='POST')return deny(405,'不支持此操作');
        return handleDietVision(request,{accountId:session.accountId,gardenId,quotaConfig:config,env:process.env});
      }
      return handleDietEntries(request,{accountId:session.accountId,storageConfig:config});
    }
    const scoped=/^\/g\/([a-zA-Z0-9-]{1,64})\/api\/(?:for\/([a-zA-Z0-9-]{1,64})\/)?(camp|phone(?:\/circles)?)$/.exec(path);
    if(scoped||business.has(path)){
      const session=await accounts.resolveSession(request);
      if(!session)return deny(401,'请先登录');
      if(scoped?.[2]&&scoped[2]!==session.accountId)return deny(403,'账号已切换，请重新打开圈子');
      const tools=scoped?.[1]===accountToolsGarden(session.accountId);
      if(tools && (scoped[2]!==session.accountId||!await privateToolRequest(request,url,scoped[3])))return deny(403,'个人工具空间不支持此操作');
      const member=tools?{...session,gardenId:scoped[1],slot:1,role:'owner'}:
        await accounts.resolveMember(session.accountId,scoped?scoped[1]:LEGACY_GARDEN_ID);
      if(!member)return deny(403,'需要先加入这个圈子');
      const canonical=new URL(scoped?'/api/'+scoped[3]:path,url);canonical.search=url.search;
      const headers=new Headers({'origin':url.origin});
      if(request.headers.has('content-type'))headers.set('content-type',request.headers.get('content-type'));
      const normalized=new Request(canonical,{method:request.method,headers,
        body:request.method==='POST'?await request.arrayBuffer():undefined});
      const note=request.method==='POST'&&canonical.pathname==='/api/camp'?await normalized.clone().json().catch(()=>null):null;
      const response=await domains.handle(normalized,member);
      if(response.ok&&note?.type==='recall')await stores.social.recall(member,note.id);
      if(response.ok&&request.method==='POST'&&!tools)void stores.push.signal(member.gardenId);
      const safe=new Headers(response.headers);safe.set('cache-control','private, no-store');safe.delete('set-cookie');safe.set('x-content-type-options','nosniff');
      return new Response(response.body,{status:response.status,headers:safe});
    }
    if(path.startsWith('/api/')||path.startsWith('/g/')||request.method==='POST')return deny(404,'没有找到此入口');
    const entry=path==='/'||path==='/mobile'||path==='/mobile/'?'/mobile/index.html':path;
    if(path==='/app-version.json'&&oldManifest)
      return new Response(request.method==='HEAD'?null:oldManifest,{headers:{'content-type':'application/json','cache-control':'no-store'}});
    const fixedOld=['/card','/card/','/app-version.json','/windows.release','/lychee-countdown.exe'];
    const staticResponse=fixedOld.includes(path)?await staticFile(oldWeb,path.startsWith('/card')?'/index.html':path,request.method):
      await staticFile(web,entry,request.method)??await staticFile(oldWeb,entry,request.method);
    return staticResponse??deny(404,'没有找到此页面');
  }
  return {handle,close:stores.close};
}

export async function serveRequest(app,req,res,expected){
    try{
      const url=new URL(req.url,expected);if(url.origin!==expected){res.writeHead(400).end();return;}
      const chunks=[];let n=0;
      const limit=['/api/account','/api/v640/account'].includes(url.pathname)?16384:1000000;
      for await(const chunk of req){n+=chunk.length;if(n>limit){res.writeHead(413).end();return;}chunks.push(chunk);}
      const request=new Request(url,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});
      const reply=await app.handle(request,{peerId:req.socket.remoteAddress});
      const headers=Object.fromEntries(reply.headers);const cookies=reply.headers.getSetCookie();if(cookies.length)headers['set-cookie']=cookies;
      res.writeHead(reply.status,headers);res.end(req.method==='HEAD'?undefined:Buffer.from(await reply.arrayBuffer()));
    }catch(error){console.error('Lychee request failed:',error.name);if(!res.headersSent)res.writeHead(500,{'cache-control':'no-store'});res.end();}
}

export async function listen({dataDir,storage,turso,webRoot,legacyDir,legacyWebRoot,origin,port=0,host='127.0.0.1',testProviderOrigin}){
  if(!['127.0.0.1','::1','localhost'].includes(host)&&(!origin||!origin.startsWith('https://')))throw Error('Configure a public HTTPS origin behind TLS before listening publicly');
  const app=await createApp({dataDir,storage,turso,webRoot,legacyDir,legacyWebRoot,origin,testProviderOrigin});
  const server=createServer(async(req,res)=>{
    const expected=origin??('http://127.0.0.1:'+req.socket.localPort);
    if(!origin&&req.headers.host!==new URL(expected).host){res.writeHead(400).end();return;}
    await serveRequest(app,req,res,expected);
  });
  try {await new Promise((ok,no)=>{server.once('error',no);server.listen(port,host,ok);});}
  catch(error){await app.close();throw error;}
  return {server,url:origin??('http://127.0.0.1:'+server.address().port),async close(){await new Promise(r=>server.close(r));await app.close();}};
}

if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const live=await listen({dataDir:process.env.LYCHEE_DATA_DIR,storage:process.env.LYCHEE_STORAGE,
    turso:{url:process.env.TURSO_DATABASE_URL,authToken:process.env.TURSO_AUTH_TOKEN},webRoot:process.env.LYCHEE_WEB_ROOT,
    legacyWebRoot:process.env.LYCHEE_LEGACY_WEB_ROOT,origin:process.env.LYCHEE_ORIGIN,
    host:process.env.LYCHEE_HOST||'127.0.0.1',port:Number(process.env.PORT||10000)});
  console.log('Lychee 6.4.0 ready',live.url);
  for(const event of ['SIGTERM','SIGINT'])process.once(event,()=>live.close().then(()=>process.exit(0)));
}
