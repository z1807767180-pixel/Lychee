// node source/test/mobile-startup-browser.mjs <previous www> <candidate www> <evidence directory>
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createApp, serveRequest} from '../server/index.mjs';
import {Browser, until} from './browser.mjs';

const [previousRoot,candidateRoot,evidenceDir]=process.argv.slice(2);
if(!previousRoot||!candidateRoot||!evidenceDir)throw Error('Expected previous www, candidate www, and evidence directory.');
const prior=resolve(previousRoot,'mobile'),next=resolve(candidateRoot,'mobile'),out=resolve(evidenceDir);
const version=async dir=>(await readFile(join(dir,'version.txt'),'utf8')).trim();
const report={previous:await version(prior),candidate:await version(next),scenarios:{}};
assert.notEqual(report.previous,report.candidate);
await mkdir(out,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'lychee-mobile-startup-')),web=join(root,'www'),mobile=join(web,'mobile');
await cp(next,mobile,{recursive:true});
const app=await createApp({dataDir:join(root,'test-account'),webRoot:web});
const browser=new Browser(), probes=[];
let mode='ready',origin;
const http=createServer(async(req,res)=>{
  if(new URL(req.url,origin).pathname==='/api/client-capabilities'){
    const attempt={mode,start:Date.now()};probes.push(attempt);
    if(mode==='denied'){
      res.writeHead(403,{'content-type':'application/json','cache-control':'no-store'}).end('{"error":"fixture HTTP 403"}');
      return;
    }
    if(mode==='slow')await sleep(11000);
    attempt.elapsedMs=Date.now()-attempt.start;
  }
  await serveRequest(app,req,res,origin);
});
await new Promise((ok,fail)=>{http.once('error',fail);http.listen(0,'127.0.0.1',ok);});
origin='http://127.0.0.1:'+http.address().port;
let cookie='';
async function api(path,body){
  const response=await fetch(origin+path,{method:body?'POST':'GET',
    headers:{cookie,origin,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  assert.equal(response.status,200,path);
  cookie=response.headers.getSetCookie()[0]?.split(';')[0]||cookie;
  return response.json();
}
async function shot(name){
  const image=await browser.call('Page.captureScreenshot',{format:'png'});
  await writeFile(join(out,name+'.png'),Buffer.from(image.data,'base64'));
}
const status=()=>browser.js("document.querySelector('#lychee-launch p')?.textContent || ''");
async function reportState(){
  await writeFile(join(out,'browser.json'),JSON.stringify(report,null,2)+'\n');
}
try{
  await api('/api/v640/account',{mode:'register',name:'启动验收',password:randomUUID()});
  const workspace=await api('/api/v640/workspace',{action:'create',name:'启动验收园'});
  const garden=workspace.activeGardenId;
  for(const n of (await api('/api/v640/workspace?client=mobile-web')).notices){
    if(!n.read)await api('/api/v640/workspace',{action:'read',noticeId:n.id});
  }
  const url=origin+'/mobile/?garden='+encodeURIComponent(garden);
  await browser.open();await browser.size(390,844,true);
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:
    "Object.defineProperty(window.AbortSignal,'timeout',{configurable:true,value:undefined});"+
    "Object.defineProperty(window,'AbortController',{configurable:true,value:undefined});"});
  const [key,val]=cookie.split('=');
  assert.ok((await browser.call('Network.setCookie',{name:key,value:val,url:origin+'/',path:'/',secure:true,httpOnly:true})).success);
  async function verifyGarden(){
    await until(()=>browser.js("!document.querySelector('#lychee-launch')&&!!document.querySelector('.ga-circle-list')?.offsetWidth"),'已登录园区页面');
    assert.equal(await browser.js('window.LycheeAccess.scope.gardenId'),garden);
    assert.equal(await browser.js('window.LycheeAccess.scope.accountId'),workspace.account.id);
    assert.equal(await browser.js('document.body.dataset.clientBuild'),report.candidate);
    assert.equal(await browser.js("document.querySelector('.ga-circle-list .circle-name-line').innerText"),'启动验收园');
    assert.equal(await browser.js("typeof AbortSignal.timeout + ',' + typeof window.AbortController"),'undefined,undefined');
    const members=await browser.js("(async()=>{const s=window.LycheeAccess.scope;const r=await fetch('/api/v640/workspace?members='+encodeURIComponent(s.gardenId));return r.status===200&&(await r.json()).members.some(m=>m.role==='owner')})()");
    assert.equal(members,true);
  }
  mode='denied';await browser.call('Page.navigate',{url});
  await until(async()=> (await status()).includes('HTTP 403'),'403 错误可见');
  const retry=await browser.js("(()=>{const b=document.querySelector('#lychee-launch button'),r=b.getBoundingClientRect();return {visible:!b.hidden&&r.width>0,label:b.textContent,x:r.x+r.width/2,y:r.y+r.height/2}})()");
  assert.ok(retry.visible);assert.match(retry.label,/重试/);assert.equal(probes.length,1);
  const deniedText=await status();await shot('01-http403');
  mode='ready';
  for(const type of ['mousePressed','mouseReleased'])await browser.call('Input.dispatchMouseEvent',{type,x:retry.x,y:retry.y,button:'left',clickCount:1});
  await verifyGarden();assert.deepEqual(probes.map(p=>p.mode),['denied','ready']);
  report.scenarios.retry={http:403,visible:deniedText,button:retry.label,physicalClick:true,
    capabilityRequests:2,sameAccount:true,sameGarden:true,missingAbortApis:true};
  await shot('02-recovered-garden');await reportState();console.log('Real browser: HTTP 403, visible retry, original authenticated garden passed.');
  mode='slow';const before=probes.length;
  await browser.call('Page.reload');
  await until(async()=> (await status()).includes('正在等荔枝园响应'),'慢响应等待状态');
  await verifyGarden();
  assert.equal(probes.length,before+1);assert.ok(probes[before].elapsedMs>=10000);
  report.scenarios.slow={elapsedMs:probes[before].elapsedMs,requests:1,sameGarden:true};
  await reportState();console.log('Real browser: one delayed probe reached original garden after '+probes[before].elapsedMs+' ms.');
  mode='previous';await cp(prior,mobile,{recursive:true});
  const beforeOld=probes.length;
  await browser.call('Page.reload');
  await until(()=>browser.js('document.body.dataset.clientBuild==='+JSON.stringify(report.previous)),'旧版入口');
  await until(async()=> (await status()).includes('醒来'),'旧版在缺少 API 时等待');
  assert.equal(probes.length,beforeOld);
  const previousText=await status();
  await shot('03-previous-stalled');await cp(next,mobile,{recursive:true});
  mode='recovered';await browser.call('Page.reload');await verifyGarden();
  assert.equal(probes.length,beforeOld+1);
  report.scenarios.refresh={previousText,previousProbeCount:0,newProbeCount:1,
    originUnchanged:await browser.js('location.origin')===origin,sessionAndGardenRetained:true};
  assert.deepEqual(browser.errors,[]);report.passed=true;await reportState();
  console.log('Real browser: old launch stalled with no request; same-origin refresh loaded new bundle and retained the garden.');
} catch(e){
  report.error=e.message;if(browser.socket)report.visible=await browser.js("document.body.innerText.slice(-650)").catch(()=>null);
  await reportState();throw e;
} finally {
  await browser.close();await new Promise(done=>http.close(done));await app.close();
  const actual=await realpath(root);
  assert.equal(dirname(actual),await realpath(tmpdir()));assert.match(basename(actual),/^lychee-mobile-startup-[a-zA-Z0-9]{6}$/);
  await rm(actual,{recursive:true,force:true});
}
