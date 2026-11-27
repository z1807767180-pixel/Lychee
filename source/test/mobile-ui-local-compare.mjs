// Offline desktop-renderer comparison. Reuse the same source/site pair and arguments for each independent sample.
import assert from 'node:assert/strict';
import {randomUUID, createHash} from 'node:crypto';
import {readdir, readFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {resolve, join, dirname, basename} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import {Browser} from './edge.mjs';

const [source, site, output] = process.argv.slice(2);
if (!source || !site || !output) throw Error('Usage: node mobile-ui-local-compare.mjs <source> <built website root> <output.json>');
const {listen} = await import(pathToFileURL(resolve(source, 'server/index.mjs')));
await mkdir(dirname(output), {recursive:true});
const temp = await mkdtemp(join(resolve(dirname(output)), 'isolated-'));
const service = await listen({storage:'sqlite', host:'127.0.0.1', dataDir:temp, webRoot:resolve(site)});
const browser = new Browser();
const results = {fixture:{groups:2, messages:[150,12], viewport:[360,780], cpuThrottle:4, missing:['AbortController','AbortSignal.timeout']}, timingsMs:{}, steps:{}, resources:{}};
const fixture = ['沿着东门的小路慢慢走，转角能看到几棵老树。','带上雨伞吧，天气有点凉。','我周末有时间，一起去看看。'];
async function request(user, path, body) {
  const response = await fetch(service.url + path, {method:body?'POST':'GET', headers:{cookie:user.cookie||'', origin:service.url, 'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const payload = await response.json();
  assert.equal(response.status,200,JSON.stringify(payload));
  user.cookie = response.headers.getSetCookie()[0]?.split(';')[0] || user.cookie;
  return payload;
}
const social = (user,body,query='') => request(user, '/api/v8/social?accountId='+user.id+query, body);
async function seed() {
  const [a,b]=[{},{}];
  for(const [index,user] of [a,b].entries()){
    await request(user,'/api/v640/account',{mode:'register',name:['试用青禾','试用阿青'][index],password:randomUUID()});
    user.id=(await request(user,'/api/v640/workspace')).account.id;
    for(const note of (await request(user,'/api/v640/workspace?client=mobile-web')).notices.filter(n=>!n.read))
      await request(user,'/api/v640/workspace',{action:'read',noticeId:note.id});
  }
  await social(a,{action:'friendRequest',accountId:b.id});
  await social(b,{action:'friendAccept',accountId:a.id});
  const ids=[];
  for(const [index,title] of ['周末散步组','晚饭商量组'].entries()){
    const {id}=await social(a,{action:'groupCreate',name:title,friendIds:[b.id]});
    ids.push(id);
    for(let i=0;i<results.fixture.messages[index];i++)
      await social(i%2?a:b,{action:'message',groupId:id,clientId:randomUUID(),body:title+' 第'+String(i+1).padStart(3,'0')+'条 '+fixture[i%fixture.length]});
  }
  return {a,b,ids};
}
const quote = JSON.stringify;
async function wait(js,label,timeout=14000){
  const end=performance.now()+timeout;
  while(performance.now()<end){if(await browser.js(js))return;await sleep(25);}
  throw Error('等待失败 '+ label);
}
async function tap(label){
  const find='Array.from(document.querySelectorAll("button")).find(b=>b.offsetWidth&&!b.disabled&&(b.getAttribute("aria-label")==='+quote(label)+'||b.textContent.trim()==='+quote(label)+'))';
  await wait('!!('+find+')',label);
  const point=await browser.js('(()=>{const b='+find+';b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()');
  for(const type of ['mousePressed','mouseReleased'])await browser.call('Input.dispatchMouseEvent',{type,button:'left',clickCount:1,...point});
}
const has = text => 'document.querySelector(".s8")?.innerText.includes('+quote(text)+')';
async function timed(name,run){const start=performance.now();await run();results.timingsMs[name]=Math.round(performance.now()-start);}
async function snapshot(){
  const {metrics}=await browser.call('Performance.getMetrics');
  return Object.fromEntries(metrics.filter(x=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','LayoutCount','RecalcStyleCount','TaskDuration'].includes(x.name)).map(x=>[x.name,x.value]));
}
function counts(urls){
  return urls.reduce((count,value)=>{const url=new URL(value);if(url.origin!==service.url)return count;count.total++;if(url.pathname.startsWith('/api/')||url.pathname.startsWith('/g/'))count.api++;return count;},{total:0,api:0});
}
function scrollWorkload(){
  const item=Array.from(document.querySelectorAll('.s8 article,.s8 p')).find(e=>e.innerText.includes('第'));
  if(!item)throw Error('missing message body');
  let scroll=item.parentElement;
  while(scroll && !(scroll.scrollHeight>scroll.clientHeight+100 && /auto|scroll/.test(getComputedStyle(scroll).overflowY)))scroll=scroll.parentElement;
  if(!scroll)throw Error('missing room scroll container');
  const span=scroll.scrollHeight-scroll.clientHeight, frames=[], sampled=new Set(), original=scroll.scrollTop;
  return new Promise(complete=>{let previous; function run(now){
    if(previous!==undefined)frames.push(now-previous);
    previous=now;scroll.scrollTop=span*(1-Math.abs((frames.length%60)-30)/30);sampled.add(scroll.scrollTop);
    if(frames.length<120){requestAnimationFrame(run);return;}
    scroll.scrollTop=original;frames.sort((a,b)=>a-b);
    complete({frames:frames.length,spanPx:span,distinctPositions:sampled.size,p50ms:frames[59],p95ms:frames[113],over33ms:frames.filter(n=>n>33.4).length});
  }requestAnimationFrame(run);});
}
// Follow a real visible control in the current document or its same-origin legacy settings frame.
function themeControl(words,click){
  const docs=[document];
  for(const f of document.querySelectorAll('iframe'))if(f.contentDocument)docs.push(f.contentDocument);
  for(const doc of docs){
    const buttons=[...doc.querySelectorAll('button,[role=button],input[type=radio],label')].filter(b=>b.offsetWidth&&!b.disabled);
    for(const word of words){
      const target=buttons.find(b=>(b.textContent||'').trim()===word || b.getAttribute('aria-label')===word)
        ||buttons.find(b=>b.textContent.includes(word));
      if(!target)continue;
      if(click)target.click();
      return {text:target.textContent.trim().slice(0,64),frame:doc!==document};
    }
  }
  return null;
}
async function themeChoice(words,timeout=2800){
  const js='('+themeControl.toString()+')('+quote(words)+',true)';
  const end=performance.now()+timeout;
  do{const value=await browser.js(js);if(value)return value;await sleep(90);}while(performance.now()<end);
  return null;
}
async function themeStyle(){
  return browser.js(`(()=>{
    const shell=document.querySelector('.s8');
    const vars={};
    for(const k of ['--ink','--s8-ink','--s8-wall','--s8-wallpaper','--wallpaper']){
      const value=getComputedStyle(shell).getPropertyValue(k).trim();if(value)vars[k]=value;
    }
    const imgs=[];
    for(const el of [shell,...shell.querySelectorAll('header,main,section,div')].slice(0,70)){
      for(const pseudo of [null,'::before','::after']){
        const image=getComputedStyle(el,pseudo).backgroundImage;
        if(image&&image.includes('url('))imgs.push(image.replaceAll(location.origin,''));
      }
    }
    return {dataset:{...shell.dataset},cls:shell.className,vars,images:[...new Set(imgs)].slice(0,6),saved:Object.keys(localStorage).filter(k=>k.toLowerCase().includes('theme')).map(k=>localStorage.getItem(k)).sort()};
  })()`);
}
try {
  const mobile=resolve(site,'mobile'), folders=(await readdir(mobile)).filter(s=>s.startsWith('assets-'));
  assert.equal(folders.length,1);const js=await readFile(join(mobile,folders[0],'client','social-v8.js'));
  results.build={version:(await readFile(join(mobile,'version.txt'),'utf8')).trim(),socialJsSha256:createHash('sha256').update(js).digest('hex')};
  const {a,b,ids}=await seed();
  await browser.open();results.browser=(await browser.call('Browser.getVersion')).product;
  await browser.call('Page.bringToFront');
  await browser.size(360,780,true);await browser.call('Emulation.setCPUThrottlingRate',{rate:4});
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:'delete window.AbortController;delete AbortSignal.timeout;'});
  await browser.call('Performance.enable');
  const [name,value]=a.cookie.split('=');
  await browser.call('Network.setCookie',{name,value,url:service.url+'/',path:'/',secure:true,httpOnly:true});
  await timed('coldHome',async()=>{await browser.call('Page.navigate',{url:service.url+'/mobile/'});await wait('!document.getElementById("lychee-launch")&&'+has('周末散步组'),'带两个群的账号首页');});
  results.resources.toHome=counts(browser.urls);results.steps.apis=await browser.js('({abortController:typeof AbortController,timeout:typeof AbortSignal.timeout})');
  await browser.js('document.fonts.ready.then(()=>true)');
  results.resources.homeCompletedResources=await browser.js('(()=>{const e=performance.getEntriesByType("resource");return {count:e.length,encodedBytes:e.reduce((n,r)=>n+r.encodedBodySize,0)}})()');
  let cursor=browser.urls.length;
  await timed('enterLongRoom',async()=>{await tap('周末散步组');await wait('!!document.querySelector(".s8 textarea")&&'+has('第150条'),'长群消息');});
  results.resources.enterRoom=counts(browser.urls.slice(cursor));
  results.room={renderedMessages:await browser.js('Array.from(document.querySelectorAll(".s8 p")).filter(e=>e.textContent.includes("周末散步组 第")).length'),before:await snapshot()};
  results.room.scroll=await browser.js('('+scrollWorkload.toString()+')()');
  results.room.after=await snapshot();
  results.room.dom=await browser.js('(()=>{const s=document.querySelector(".s8");return {elements:s.querySelectorAll("*").length,images:s.querySelectorAll("img").length,uniqueImages:new Set([...s.querySelectorAll("img")].map(i=>i.currentSrc||i.src)).size,failedImages:[...s.querySelectorAll("img")].filter(i=>i.complete&&!i.naturalWidth).length}})()');
  results.steps.idleForeground=await browser.js('!document.hidden');
  cursor=browser.urls.length;await sleep(5000);results.resources.idleFiveSeconds=counts(browser.urls.slice(cursor));
  await timed('switchRoomViaHome',async()=>{await tap('‹ 返回');await tap('晚饭商量组');await wait('!!document.querySelector(".s8 textarea")&&'+has('第012条'),'第二群');});
  await browser.js('document.querySelector(".s8 textarea").focus()');
  await browser.call('Input.insertText',{text:'周末四点树下见。'});
  await browser.size(360,500,true);await sleep(100);
  results.steps.shortViewport=await browser.js('(()=>{const box=document.querySelector(".s8 textarea"),r=box.getBoundingClientRect();return {draft:box.value,focused:document.activeElement===box,visible:r.top>=0&&r.bottom<=innerHeight,viewport:innerHeight}})()');
  await browser.size(360,780,true);await tap('发送');
  await wait(has('周末四点树下见。'),'发送中文');results.steps.sent=(await social(b,null,'&view=group&id='+ids[1])).messages.some(m=>m.body==='周末四点树下见。');
  const pageId=(await browser.call('Target.getTargetInfo')).targetInfo.targetId;
  const cover=(await browser.call('Target.createTarget',{url:'about:blank'})).targetId;
  await browser.call('Target.activateTarget',{targetId:cover});
  results.steps.hiddenBeforeFreeze=await browser.js('document.hidden');
  await browser.call('Page.setWebLifecycleState',{state:'frozen'});
  await social(b,{action:'message',groupId:ids[1],clientId:randomUUID(),body:'刚才的消息收到了。'});
  await sleep(1000);
  const resumed=performance.now();await browser.call('Page.setWebLifecycleState',{state:'active'});
  await browser.call('Target.activateTarget',{targetId:pageId});await browser.call('Page.bringToFront');
  await browser.call('Target.closeTarget',{targetId:cover});
  results.steps.visibleAfterResume=await browser.js('!document.hidden');
  try{await wait(has('刚才的消息收到了。'),'解冻后异端新消息',12500);results.timingsMs.resumeToNewMessage=Math.round(performance.now()-resumed);}
  catch{results.steps.resumeDidNotDeliverWithinMs=12500;}
  results.steps.resumeKeptRoom=await browser.js('document.querySelector(".s8 h1")?.innerText.startsWith("晚饭商量组")');
  await tap('‹ 返回');await tap('我');await wait(has('设置'),'我的设置');
  results.steps.themeLabels=await browser.js('Array.from(document.querySelectorAll(".s8 button")).map(b=>b.innerText.trim()).filter(t=>t.includes("主题"))');
  await tap('设置');await wait('document.querySelector(".s8 h1")?.innerText==="设置"','进入设置');
  results.steps.settingsThemeLabels=await browser.js('Array.from(document.querySelectorAll(".s8 button")).map(b=>b.innerText.trim()).filter(t=>t.includes("主题"))');
  const themeActions=[];
  if(!results.steps.settingsThemeLabels.length)await tap('我');
  themeActions.push(await themeChoice(['主题设置','切换主题','界面主题','头像、主题与更多','主题']));
  if(themeActions[0]){
    const options=['米菲采荔枝','米菲'];
    let chosen=await themeChoice(options,2300);
    if(!chosen){themeActions.push(await themeChoice(['切换主题','主题设置','背景与主题','主题'],2400));chosen=await themeChoice(options,2800);}
    results.steps.miffyChoice=chosen;
    if(chosen){
      await sleep(160);await tap('荔圈');await tap('周末散步组');await wait('!!document.querySelector(".s8 textarea")','切换主题后的群');
      results.steps.roomTheme=await themeStyle();
      await browser.call('Page.reload',{ignoreCache:false});await wait('!document.getElementById("lychee-launch")&&'+has('周末散步组'),'重开首页');
      await tap('周末散步组');await wait('!!document.querySelector(".s8 textarea")','重开后的群');
      results.steps.reloadedRoomTheme=await themeStyle();
    }
  }
  results.steps.themeActions=themeActions;
  if(process.argv.includes('--durability')){
    const openRoom=async(label,last)=>{
      await tap('‹ 返回');await tap(label);
      await wait('!!document.querySelector(".s8 textarea")&&'+has(last),'重复切群');
    };
    async function retained(cycles){
      await browser.call('HeapProfiler.collectGarbage');
      const m=await snapshot();
      return {cycles,jsHeapBytes:m.JSHeapUsedSize,documents:m.Documents,nodes:m.Nodes,activeElements:await browser.js('document.querySelector(".s8").querySelectorAll("*").length')};
    }
    // Both samples begin at the long room with the same saved theme. Ignore warm-up allocations.
    await openRoom('晚饭商量组','第012条');await openRoom('周末散步组','第150条');
    const collected=[await retained(0)],start=performance.now();
    for(let i=1;i<=12;i++){
      await openRoom('晚饭商量组','第012条');await openRoom('周末散步组','第150条');
      if(i%6===0)collected.push(await retained(i));
    }
    results.durability={roomEntries:24,durationMs:Math.round(performance.now()-start),collected};
    await browser.js('document.querySelector(".s8 textarea").focus()');
    await browser.call('Input.imeSetComposition',{text:'shu',selectionStart:3,selectionEnd:3});
    const composing=await browser.js('document.querySelector(".s8 textarea").value');
    await browser.call('Input.insertText',{text:'树'});
    results.durability.composition={preedit:composing,committed:await browser.js('document.querySelector(".s8 textarea").value')};
    if(process.argv.includes('--focus-poll')){
      await browser.js('window.__compareEditor=document.activeElement;window.__compareEditor.setSelectionRange(0,1)');
      await social(b,{action:'message',groupId:ids[0],clientId:randomUUID(),body:'画纸我带上了。'});
      await wait(has('画纸我带上了。'),'输入中对端来信可见',15000);
      const focused=await browser.js('(()=>{const e=document.querySelector(".s8 textarea");return {same:e===window.__compareEditor,focused:e===document.activeElement,draft:e.value,selection:[e.selectionStart,e.selectionEnd]}})()');
      assert.deepEqual(focused,{same:true,focused:true,draft:'树',selection:[0,1]});
      results.durability.focusedIncoming={visible:true,...focused};
    }
    results.durability.decodedChatWall=await browser.js(`(async()=>{
      const style=getComputedStyle(document.querySelector('.s8')).backgroundImage;
      if(!style.startsWith('url('))return null;
      const url=new URL(style.slice(4,-1).replace(/^["']|["']$/g,''),location.href);
      if(url.origin!==location.origin)throw Error('external image');
      const img=new Image();img.src=url.href;await img.decode();
      return {path:url.pathname,width:img.naturalWidth,height:img.naturalHeight};
    })()`);
  }
  results.errors=browser.errors;
  results.externalRequests=browser.urls.filter(u=>u.startsWith('http')&&new URL(u).origin!==service.url).map(u=>new URL(u).origin);
  results.httpErrors=browser.responses.filter(([status])=>status>=400).map(([status,url])=>[status,new URL(url).pathname]);
  assert.deepEqual(results.externalRequests,[]);assert.deepEqual(results.errors,[]);
  assert.equal(results.steps.apis.abortController,'undefined');assert.equal(results.steps.apis.timeout,'undefined');
  assert.equal(results.steps.sent,true);assert.equal(results.steps.shortViewport.draft,'周末四点树下见。');
  assert.ok(results.steps.shortViewport.focused && results.steps.shortViewport.visible);
  assert.ok(results.steps.hiddenBeforeFreeze && results.steps.visibleAfterResume && results.steps.resumeKeptRoom);
  assert.ok(Number.isFinite(results.timingsMs.resumeToNewMessage));
  assert.ok(results.room.renderedMessages>0 && results.room.scroll.distinctPositions>1);
  assert.equal(results.room.dom.failedImages,0);
  if(results.durability)assert.deepEqual(results.durability.composition,{preedit:'shu',committed:'树'});
  results.complete=true;
} catch(error) {
  results.failure=error.message;
  if(browser.socket)console.error(await browser.js('document.body.innerText.slice(-500)'),browser.errors);
  process.exitCode=1;
} finally {
  await writeFile(output,JSON.stringify(results,null,2));
  await browser.close();await service.close();
  assert.equal(dirname(temp),resolve(dirname(output)));assert.match(basename(temp),/^isolated-[A-Za-z0-9]{6}$/);
  await rm(temp,{recursive:true,force:true});
  console.log(output,results.complete?'complete':results.failure);
}
