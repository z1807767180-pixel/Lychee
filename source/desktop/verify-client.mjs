import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {Browser as Edge} from '../test/edge.mjs';
import {forward} from '../static-host/shared/proxy.mjs';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createApp} from '../server/index.mjs';

const stage=resolve(process.argv[2]||'work/windows-release-build');
const report={backendWasReadyAtFirstPaint:false};const failures=[];
const privateDir=await mkdtemp(join(stage,'test-data-'));
const app=await createApp({dataDir:privateDir,webRoot:join(stage,'site')});
let warmed=false;
const server=createServer(async (req,res)=>{
 try{
  const u=origin+req.url;
  if(!warmed&&req.url.startsWith('/api/client-capabilities')){
    res.writeHead(503,{'content-type':'text/html'}).end('<title>upstream wakeup</title>');return;
  }
  const chunks=[];for await(const c of req)chunks.push(c);
  const r=await app.handle(new Request(u,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(chunks):undefined}));
  const h=Object.fromEntries(r.headers);if(r.headers.has('set-cookie'))h['set-cookie']=r.headers.getSetCookie();
  res.writeHead(r.status,h).end(Buffer.from(await r.arrayBuffer()));
 }catch(e){res.writeHead(500).end();failures.push(e.message);}
});
server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
let phoneOrigin;
const mobile=new Edge();
const staticServer=createServer(async(req,res)=>{
  try{
    const uri=phoneOrigin+req.url,parts=[];
    for await(const part of req)parts.push(part);
    const request=new Request(uri,{method:req.method,headers:req.headers,body:req.method==='POST'?Buffer.concat(parts):undefined});
    const path=new URL(uri).pathname;
    const r=path.startsWith('/api/')||path.startsWith('/g/')?await forward({request,env:{LYCHEE_API_ORIGIN:'https://lychee-test-backend.invalid'}},(url,init)=>app.handle(new Request(url,init))):await app.handle(request);
    const h=Object.fromEntries(r.headers);if(r.headers.has('set-cookie'))h['set-cookie']=r.headers.getSetCookie();
    res.writeHead(r.status,h).end(Buffer.from(await r.arrayBuffer()));
  }catch(e){res.writeHead(500).end();failures.push(e.message);}
});
staticServer.listen(0,'127.0.0.1');await once(staticServer,'listening');
phoneOrigin='http://127.0.0.1:'+staticServer.address().port;
const tmp=createServer();tmp.listen(0,'127.0.0.1');await once(tmp,'listening');const port=tmp.address().port;await new Promise(r=>tmp.close(r));
const env={...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--no-sandbox --disable-gpu --no-proxy-server --disable-background-networking --remote-debugging-port='+port};
const proc=spawn(join(stage,'Lychee.exe'),['--test-local',origin],{cwd:stage,env,windowsHide:true});
proc.stderr.on("data",b=>console.error(b.toString()));proc.on("exit",code=>{if(code!=null && !report.pass)console.log("native exit "+code);});
let ws,seq=0;const pending=new Map();
async function until(f,desc){
 const end=Date.now()+22000;let last;
 while(Date.now()<end){try{const x=await f();if(x)return x;}catch(e){last=e.message;}await sleep(90);}
 throw Error(desc+' timeout '+(last||''));
}
function call(method,params={}){
 const id=++seq;
 return new Promise((ok,no)=>{const timer=setTimeout(()=>{pending.delete(id);no(Error(method));},6000);
 pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
}
async function js(expression){
 const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);
 return r.result.value;
}
async function click(text){
 const coords=await until(()=>js('('+((t)=>{
 const b=[...document.querySelectorAll('button')].find(b=>b.innerText.trim()===t&&b.offsetWidth);
 if(!b)return;b.scrollIntoView({block:'nearest'});const v=b.getBoundingClientRect();
 const x=v.x+v.width/2,y=v.y+v.height/2; if(!b.contains(document.elementFromPoint(x,y)))return;
 return {x,y};
 }).toString()+')('+JSON.stringify(text)+')'),text);
 for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,...coords,button:'left',clickCount:1});
}
const contains=t=>until(()=>js('document.body.innerText.includes('+JSON.stringify(t)+')'),t);
const qaAccount='Windows验收';const password='Test-'+crypto.randomUUID();
try{
 const page=await until(async()=>{const all=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();return all.find(p=>p.type==='page'&&p.url.startsWith(origin));},'exe page');
 ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
 ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.ok(m.result);} if(m.method==='Runtime.exceptionThrown')failures.push(m.params.exceptionDetails.exception?.description||m.params.exceptionDetails.text);};
 await call('Runtime.enable');await call('Page.enable');
 await contains('正在连接荔枝园');
 report.firstPaint=await js("({title:document.querySelector('#lychee-launch h1').innerText,art:document.querySelector('#lychee-launch img').naturalWidth,animation:getComputedStyle(document.querySelector('#lychee-launch img')).animationName})");
 assert.ok(report.firstPaint.art>0);assert.equal(report.firstPaint.title,'荔枝');
 await js('document.fonts.ready.then(()=>true)');
 await call('DOM.enable');await call('CSS.enable');
 const {root}=await call('DOM.getDocument');
 const {nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#lychee-launch h1'});
 report.firstPaint.fonts=(await call('CSS.getPlatformFontsForNode',{nodeId})).fonts;
 assert.ok(report.firstPaint.fonts.some(font=>font.isCustomFont&&font.glyphCount===2),'内嵌字体应绘制离线启动标题');
 assert.equal(await js("document.body.innerText.includes('upstream wakeup')"),false);
 warmed=true;await click('注册新账号');
 await js("document.querySelector('[name=username]').value="+JSON.stringify(qaAccount)+";document.querySelector('[name=password]').value="+JSON.stringify(password));
 await click('注册');await click('标为已读');
 await click('创建私密园');
 await js("document.querySelector('[name=gardenName]').value='朋友的小圈'");
 await click('创建并进入');
 await until(()=>js("document.querySelector('.windows-nav [data-page=wheel]')?.offsetWidth"),'7.0 工作台');
 const sidebar=await js(`Object.fromEntries([...document.querySelectorAll('.windows-nav section')].map(section=>[
   section.querySelector('h2').textContent,[...section.querySelectorAll('button')].map(b=>b.dataset.page)]))`);
 for(const tool of ['focus','ledger','tasks','diet','wheel']){
   assert.ok(sidebar['工具箱'].includes(tool));
   assert.ok(!sidebar['我'].includes(tool));
 }
 report.workbench=true;
 await call('Page.reload');await until(()=>js("!!document.querySelector('.windows-nav') && !document.querySelector('#lychee-launch')"),'刷新进入工作台');
 assert.equal(await js("!!document.querySelector('.garden-access')"),false);
 report.noRepeatAfterReload=true;
 await until(()=>js("document.documentElement.classList.contains('lychee-unified-header')"),'合并窗口标头');
 report.windowFrame=await js(`(() => {
   const bar=document.querySelector('.garden-app > .appbar'),controls=document.querySelector('.lychee-window-controls');
   const r=controls.getBoundingClientRect(),h=bar.getBoundingClientRect();
   return {buttons:controls.querySelectorAll('button').length,inside:r.top>=h.top&&r.bottom<=h.bottom&&r.right<=h.right+1,
     draggable:getComputedStyle(bar).getPropertyValue('app-region'),width:innerWidth,height:innerHeight};
 })()`);
 assert.equal(report.windowFrame.buttons,3);assert.equal(report.windowFrame.inside,true);assert.equal(report.windowFrame.draggable,'drag');
 const maximize='document.querySelector(".lychee-window-controls [data-command=maximize]").click()';
 await js(maximize);
 await until(()=>js('innerWidth!=='+report.windowFrame.width+' || innerHeight!=='+report.windowFrame.height),'原生最大化');
 await js(maximize);
 await until(()=>js('innerWidth==='+report.windowFrame.width+' && innerHeight==='+report.windowFrame.height),'还原窗口');
 await call('Emulation.setDeviceMetricsOverride',{width:326,height:515,deviceScaleFactor:1,mobile:false});
 await click('工具箱');
 await until(()=>js("document.querySelector('.appbar h1')?.innerText.trim()==='工具箱'"),'小窗口工具箱');
 const fit=await js(`(() => {
   const rect=selector=>document.querySelector(selector).getBoundingClientRect();
   const title=rect('.appbar h1'),chat=rect('.appbar .bubble'),controls=rect('.lychee-window-controls');
   return title.width>20 && title.right<=chat.left+1 && chat.right<=controls.left && controls.right<=innerWidth;
 })()`);
 assert.ok(fit,'小窗口标题、聊天和窗口按钮应各自可见');
 await writeFile(join(stage,'frame-narrow.png'),Buffer.from((await call('Page.captureScreenshot',{format:'png'})).data,'base64'));
 await call('Emulation.clearDeviceMetricsOverride');
 await call('Page.setInterceptFileChooserDialog',{enabled:true});
 await click('照记饮食');await until(()=>js("document.querySelector('.diet-v7-add')?.disabled===false"),'桌面饮食载入');await click('拍照记一餐');
 await until(()=>js("!!document.querySelector('.diet-v7-edit input[placeholder*=搜索米饭]')"),'桌面饮食录入');
 async function field(label,text){
   const found=await js('('+((label)=>{
     const input=[...document.querySelectorAll('.diet-v7-edit label')].find(l=>l.firstChild.textContent===label)?.querySelector('input');
     if(!input)return false;input.focus();input.select();return true;
   }).toString()+')('+JSON.stringify(label)+')');
   assert.ok(found,label);await call('Input.insertText',{text:String(text)});
 }
 await field('添加食物','番茄炒蛋');await click('番茄炒蛋');
 await field('整盘可食净重（克）',200);
 const kcal=()=>js("parseFloat(document.querySelector('.diet-v7-macros strong')?.textContent)");
 await until(async()=>await kcal()===193,'番茄炒蛋 200 克');
 await field('整盘可食净重（克）',400);await until(async()=>await kcal()===386,'番茄炒蛋 400 克');
 await click('补油 / 拌酱');await field('实际吃了多少克',12);await click('更新克数');
 const oil=await js("Array.from(document.querySelectorAll('.diet-v7-row')).filter(r=>r.querySelector('strong')?.textContent==='花生油').map(r=>Number(r.querySelector('input[type=number]').value))");
 assert.deepEqual(oil,[12]);
 await click('保存这一餐');await until(()=>js("!!document.querySelector('.diet-v7-sticker')"),'桌面保存番茄炒蛋');
 report.diet={cooked200:193,cooked400:386,oilGrams:12,persisted:true};
 await mobile.open();await mobile.size(390,844,true);await mobile.call('Page.navigate',{url:phoneOrigin+'/mobile/'});
 await until(()=>mobile.js("!!document.querySelector('input[name=username]') && !document.querySelector('#lychee-launch')"),'mobile static login');
 await mobile.js("document.querySelector('[name=username]').value="+JSON.stringify(qaAccount)+";document.querySelector('[name=password]').value="+JSON.stringify(password)+";document.querySelector('.garden-access form').requestSubmit()");
 await until(()=>mobile.js("!!document.querySelector('.bottom') && !document.querySelector('.garden-access') && !document.querySelector('#lychee-launch')"),'mobile real app');
 assert.ok(await mobile.js("document.body.innerText.includes('朋友的小圈')"));
 const w=await mobile.js("fetch('/api/workspace').then(r=>r.json()).then(v=>({read:v.notices.every(n=>n.read),gardens:v.gardens.map(g=>g.name)}))");
 assert.ok(w.read && w.gardens.includes('朋友的小圈'));report.mobileStaticClient=true;
 await mobile.js("window.LycheeAccess.openAnnouncement()");
 await until(()=>mobile.js("document.querySelector('.ga-notice small')?.innerText==='已读'"),'已读公告可手动查看');
 report.manualHistory=true;
 report.separateSessionReadback=true;assert.deepEqual(failures,[]);report.pass=true;
}catch(e){report.failure=e.message;process.exitCode=1;}
finally{
 if(ws?.readyState===1){if(!report.pass){try{report.ui=(await js('document.body.innerText')).slice(0,350);}catch{}}ws.close();}
 await mobile.close().catch(()=>{});staticServer.closeAllConnections();await new Promise(r=>staticServer.close(r));
 proc.kill();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await app.close();
 report.errors=failures;await writeFile(join(stage,'native-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
}
