import './theme-assets.mjs';
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {stat,readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,sep,extname} from 'node:path';
import * as camp from './camp.mjs';
import * as phone from './phone.mjs';
import * as circles from './circle-route.mjs';
import * as account from './account.mjs';
const root=fileURLToPath(new URL('./web',import.meta.url));
const mobileTags=new Map();
const origin=process.env.LYCHEE_ORIGIN;
if(!origin||new URL(origin).origin!==origin)throw Error('Configure exact public LYCHEE_ORIGIN');
const types={'.webmanifest':'application/manifest+json','.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2','.png':'image/png','.svg':'image/svg+xml','.exe':'application/octet-stream'};
const webVersion=(await readFile(resolve(root,'web-version.txt'),'utf8')).trim();
const productVersion=(await readFile(resolve(root,'product-version.txt'),'utf8')).trim();
const windowsVersion=Number((await readFile(resolve(root,'windows-version.txt'),'utf8')).trim());
if(!Number.isSafeInteger(windowsVersion)||windowsVersion<1)throw Error('Invalid Windows version');
const signedRelease=await readFile(resolve(root,'windows.release'));
const executableHash=createHash('sha256').update(await readFile(resolve(root,'lychee-countdown.exe'))).digest();
if(signedRelease.length!==300||signedRelease.readUInt32LE(8)!==windowsVersion||!signedRelease.subarray(12,44).equals(executableHash))throw Error('Windows release metadata does not match the downloadable file');
// Check the host configuration without starting a game or sending player data.
async function checkSoupHost(){
 const key=process.env.DEEPSEEK_API_KEY?.trim();
 if(!key)return 'missing-key';
 const r=await fetch('https://api.deepseek.com/models',{headers:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(8000)});
 if(!r.ok)return 'http-'+r.status;
 const data=await r.json();
 return data.data?.some(m=>m.id==='deepseek-flash')?'model-available':'model-unlisted';
}
void checkSoupHost().catch(()=>'unreachable').then(status=>console.info('soup-host-check',productVersion,status));
createServer(async(req,res)=>{
 try{
 const url=new URL(req.url,origin);if(url.origin!==origin){res.writeHead(400).end();return}
 if((req.method==='GET'||req.method==='HEAD')&&(url.pathname==='/app-version.json'||url.pathname==='/windows.release')){
  const version=url.pathname==='/app-version.json';
  res.writeHead(200,{'Content-Type':version?'application/json':'application/octet-stream','Cache-Control':'no-store'});
  res.end(req.method==='HEAD'?undefined:version?JSON.stringify({web:webVersion,windows:windowsVersion,release:productVersion}):signedRelease);return
 }
 if(url.pathname.startsWith('/api/')){
 const handlers={'/api/phone/circles':circles,'/api/phone':phone,'/api/account':account,'/api/camp':camp};
 const fn=Object.hasOwn(handlers,url.pathname)&&['GET','POST'].includes(req.method)&&handlers[url.pathname][req.method];
 if(!fn){res.writeHead(404).end();return}
 let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>(url.pathname==="/api/account"?16384:400000)){res.writeHead(413).end();return}chunks.push(chunk)}
 const headers=new Headers(req.headers);headers.delete('cf-connecting-ip');
 const request=new Request(url,{method:req.method,headers,body:req.method==='POST'?Buffer.concat(chunks):undefined});
 const result=await fn(request);res.writeHead(result.status,Object.fromEntries(result.headers));res.end(Buffer.from(await result.arrayBuffer()));return
 }
 if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405).end();return}
 const page = ['/','/card'].includes(url.pathname) ? '/index.html' : ['/mobile','/mobile/'].includes(url.pathname) ? '/mobile/index.html' : decodeURIComponent(url.pathname);
 const file=resolve(root,'.'+page);
 if(!file.startsWith(root+sep)||!(await stat(file).catch(()=>null))?.isFile()){res.writeHead(404).end();return}
 const mobile=page.startsWith('/mobile/');
 const entry=mobile&&(page==='/mobile/index.html'||page==='/mobile/version.txt');
 const cache=entry?'no-store':'no-cache';
 let tag;
 if(mobile&&!entry){
  tag=mobileTags.get(file);
  if(!tag){tag='"'+createHash('sha256').update(await readFile(file)).digest('hex')+'"';mobileTags.set(file,tag)}
  const matches=req.headers['if-none-match']?.split(',').some(value=>{const t=value.trim();return t==='*'||t.replace(/^W\//,'')===tag});
  if(matches){res.writeHead(304,{'ETag':tag,'Cache-Control':cache}).end();return}
 }
 res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Cache-Control':cache,...(tag?{'ETag':tag}:{}),...(url.pathname==='/lychee-countdown.exe'?{'Content-Disposition':'attachment; filename="lychee-countdown.exe"'}:{})});if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res)
 }catch{res.writeHead(500).end('服务暂不可用')}
}).listen(Number(process.env.PORT||10000),'0.0.0.0');
