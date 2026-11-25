import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const output=resolve(process.env.LYCHEE_FONT_EVIDENCE||'work/typography-review/current');
await mkdir(output,{recursive:true});
const dir=await mkdtemp(join(tmpdir(),'lychee-type-'));
const fixture=process.argv.includes('--turso-fixture')?await startTursoFixture():null;
const app=await listen({dataDir:dir,webRoot:process.env.LYCHEE_REVIEW_WEB,...(fixture?{storage:'turso',turso:fixture}:{})});
const browser=new Browser();
const report={views:{},fontRequests:[],storage:fixture?'libSQL HTTP loopback':'local SQLite'};
report.chromeSamples={};
const run=(f,...args)=>browser.js('('+f.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
const ready=s=>until(()=>run(s=>!!document.querySelector(s),s),s);
const ownerName='小荔',peerName='阿青';
const longText='这周想约大家一起去打篮球。我们先在图书馆门口集合，再去附近的球场；如果下雨，就回到室内商量下一周的安排。';
const shortText='收到，我们周六见。';
function actor(name){
  const password=randomBytes(16).toString('hex');let cookie='';
  async function api(path,payload){
    const r=await fetch(app.url+path,{method:payload?'POST':'GET',headers:{origin:app.url,cookie,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined});
    assert.equal(r.status,200,path);
    const set=r.headers.getSetCookie().find(v=>v.startsWith('__Host-lychee-account='));
    if(set)cookie=set.split(';')[0];
    return r.json();
  }
  return {name,password,api,register:()=>api('/api/account',{mode:'register',name,password})};
}
async function click(text,scope='button'){
  const p=await until(()=>run((text,scope)=>{
    const button=[...document.querySelectorAll(scope)].find(e=>e.getClientRects().length&&!e.disabled&&
      (e.innerText.trim().split(/\n/)[0]===text||e.textContent.trim()===text||e.ariaLabel===text||e.textContent.replace(/[→＋]/g,'').trim()===text));
    if(!button)return false;
    button.scrollIntoView({behavior:'instant',block:'nearest'});
    const r=button.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    return button.contains(document.elementFromPoint(x,y))&&{x,y};
  },text,scope),text);
  for(const type of ['mousePressed','mouseReleased'])await browser.call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
}
async function snap(file){
  const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(output,file+'.png'),Buffer.from(shot.data,'base64'));
}
async function metrics(selector){
  await ready(selector);
  await browser.js('document.fonts.ready.then(()=>true)');
  const metric=await run(selector=>{
    const e=document.querySelector(selector),s=getComputedStyle(e),r=e.getBoundingClientRect(),parent=e.parentElement.getBoundingClientRect();
    const range=document.createRange(),walker=document.createTreeWalker(e,NodeFilter.SHOW_TEXT),byLine=new Map();
    while(walker.nextNode()){
      range.selectNodeContents(walker.currentNode);
      for(const b of range.getClientRects()){
        if(!b.width||!b.height)continue;
        const key=Math.round(b.top),line=byLine.get(key);
        byLine.set(key,line?DOMRect.fromRect({x:Math.min(b.left,line.left),y:b.top,
          width:Math.max(b.right,line.right)-Math.min(b.left,line.left),height:Math.max(b.height,line.height)}):b);
      }
    }
    const lines=[...byLine.values()];
    return {text:e.textContent.trim(),font:s.fontFamily,size:parseFloat(s.fontSize),lineHeight:s.lineHeight,weight:s.fontWeight,align:s.textAlign,
      box:[r.left,r.top,r.width,r.height],parent:[parent.left,parent.top,parent.width,parent.height],
      lines:lines.map(l=>[l.x,l.y,l.width,l.height]),
      contentFits:lines.every(line=>line.left>=r.left-1&&line.right<=r.right+1&&line.top>=r.top-2&&line.bottom<=r.bottom+2),
      scrollWidth:e.scrollWidth,clientWidth:e.clientWidth,nowrap:s.whiteSpace,documentOverflow:document.documentElement.scrollWidth>innerWidth};
  },selector);
  const {root}=await browser.call('DOM.getDocument');
  const {nodeId}=await browser.call('DOM.querySelector',{nodeId:root.nodeId,selector});
  metric.paintedFonts=(await browser.call('CSS.getPlatformFontsForNode',{nodeId})).fonts;
  return metric;
}
const sizes=[['wide',984,698],['narrow',496,478],['phone',390,844],['compact',320,480]];
async function samples(page,selector){
  for(const [name,w,h] of sizes){
    await browser.size(w,h);await sleep(240);
    const data=await metrics(selector);
    report.views[page+'-'+name]=data;
    if(['wide','phone','compact'].includes(name))await snap(page+'-'+name);
  }
}
async function openEntry(path){
  await browser.call('Page.navigate',{url:app.url+path});await ready('.ga-circle-list');
}
try{
  const a=actor(ownerName),b=actor(peerName);await a.register();await b.register();
  const garden=(await a.api('/api/workspace',{action:'create',name:'周末茶园'})).activeGardenId;
  const {inviteCode}=await a.api('/api/workspace',{action:'invite',gardenId:garden});
  await b.api('/api/workspace',{action:'join',code:inviteCode});
  await a.api('/api/workspace',{action:'read',noticeId:'release-6.4.0'});
  await browser.open();await browser.call('DOM.enable');await browser.call('CSS.enable');
  await browser.size(984,698);
  const win='/windows/workspace.html?garden='+garden, mobile='/mobile/?garden='+garden;
  await browser.call('Page.navigate',{url:app.url+win});await ready('input[name=username]');
  report.chromeSamples.loginTitle=await metrics('.garden-access h1');
  await run((name,pw)=>{
    const form=document.querySelector('input[name=username]').form;
    form.querySelector('[name=username]').value=name;form.querySelector('[name=password]').value=pw;form.requestSubmit();
  },a.name,a.password);
  await ready('.ga-circle-list');
  report.chromeSamples.circleTitle=await metrics('.ga-circle-list h3');
  report.chromeSamples.enterButton=await metrics('.ga-enter-room');
  report.chromeSamples.navigation=await metrics('.windows-nav button');
  await click('进入圈子','.ga-circle-list button');await ready('.room-empty');
  await samples('empty-chat','.room-empty');
  await openEntry(mobile);await click('进入圈子','.ga-circle-list button');await browser.size(390,844,true);
  report.views['mobile-empty']=await metrics('.room-empty');
  await snap('mobile-empty');
  const api='/g/'+garden+'/api/camp';
  await b.api(api+'?roster=lychee');await b.api(api,{type:'note',key:randomUUID(),name:b.name,avatar:1,body:longText});
  await a.api(api,{type:'note',key:randomUUID(),name:a.name,avatar:0,body:shortText});
  await until(()=>browser.js("document.querySelectorAll('.room-bubble').length===2"),'两则真实发言');
  const peer='.room-row:not(.mine) .room-bubble',mine='.room-row.mine .room-bubble';
  for(const [name,w,h] of sizes){
    await browser.size(w,h);await sleep(160);
    const left=await metrics(peer),right=await metrics(mine);
    const avatars=await run(()=>[...document.querySelectorAll('.room-row')].map(row=>{
      const r=row.querySelector('.room-avatar').getBoundingClientRect();return {mine:row.classList.contains('mine'),x:r.left,right:r.right};
    }));
    report.views['messages-'+name]={left,right,avatars};
    if(name==='compact'||name==='phone')await snap('messages-'+name);
  }
  await browser.size(984,698);await openEntry(win);await click('海龟汤','.windows-nav button');
  await until(()=>run(()=>document.body.innerText.includes('跳过')||document.body.innerText.includes('自己玩')),'海龟汤初始页');
  const skip=await run(()=>[...document.querySelectorAll('button')].find(b=>b.getClientRects().length&&b.textContent.includes('跳过'))?.textContent.trim());
  if(skip)await click(skip);
  await click('自己玩');
  const soupSelector='.soup-room > [role=status]';
  await until(()=>run(()=>[...document.querySelectorAll('small[role=status]')].some(e=>e.textContent.includes('主持还没读到密钥'))),'未配置主持提示');
  await samples('soup',soupSelector);
  await browser.size(390,844,true);await openEntry(mobile);await click('工具箱','nav.bottom button');
  await click('海龟汤');await click('自己玩');
  report.views['mobile-soup']=await metrics(soupSelector);await snap('mobile-soup');
  await browser.size(984,698);await openEntry(win);
  report.desktopRoutes=[];
  const navLabels=await run(()=>[...document.querySelectorAll('.windows-nav button')].map(b=>b.innerText.trim()));
  assert.equal(navLabels.length,19);
  for(const label of navLabels){
    await click(label,'.windows-nav button');
    await until(()=>run(label=>document.querySelector('.windows-nav [aria-current="page"]')?.innerText.trim()===label,label),label+' 激活');
    await sleep(170);
    const body=await run(()=>{
      const root=document.querySelector('main.garden-app');
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      const values=[];
      while(walker.nextNode()){
        const node=walker.currentNode,e=node.parentElement,s=node.textContent.trim();
        if(s&&!e.closest('nav,script,style')&&e.getClientRects().length)values.push(s);
      }
      return values.join(' ').slice(0,150);
    });
    assert.ok(body.length>4,label+' 显示内容');
    report.desktopRoutes.push({label,body});
  }
  const statusFont=await run(()=>[...document.fonts].map(f=>({family:f.family,weight:f.weight,status:f.status})));
  report.fontStatus=statusFont;
  report.fontRequests=browser.responses.filter(([,url])=>/\.(woff2?|ttf|otf)(?:\?|$)/i.test(url)).map(([status,url])=>[status,new URL(url).pathname]);
  report.errors=browser.errors;report.offsite=browser.urls.filter(u=>/^https?:/.test(u)&&!u.startsWith(app.url+'/'));
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.offsite,[]);
  for(const [key,value] of Object.entries(report.views)){
    for(const item of value.left?[value.left,value.right]:[value]){
      assert.ok(item.contentFits&&!item.documentOverflow,key+' 文字超出可用宽度');
      assert.ok(item.paintedFonts.some(font=>font.isCustomFont&&font.glyphCount>0),key+' 应实际绘制内置字体');
      assert.ok(item.font.includes('LXGW 975 Yuan SC'),key+' 应优先使用 975 圆体');
    }
    if(value.left){
      assert.ok(value.avatars.find(a=>!a.mine).right<=value.left.box[0]+1,key+' 对方头像在气泡左侧');
      assert.ok(value.avatars.find(a=>a.mine).x>=value.right.box[0]+value.right.box[2]-1,key+' 本人头像在气泡右侧');
    }else{
      assert.equal(value.align,'center',key+' 提示文字应居中');
      assert.ok(value.size>=15,key+' 提示字号');
      assert.ok(Math.abs(value.box[0]+value.box[2]/2-value.parent[0]-value.parent[2]/2)<2,key+' 提示居中于内容区');
    }
  }
  for(const [key,value] of Object.entries(report.chromeSamples)){
    assert.ok(value.paintedFonts.some(font=>font.isCustomFont&&font.glyphCount>0),key+' 应实际绘制内置字体');
    assert.ok(value.font.includes('LXGW 975 Yuan SC'),key+' 优先字体');
  }
  assert.ok(report.fontRequests.some(([status,path])=>status===200&&path.startsWith('/client/fonts/')),'同源字体资源');
  assert.ok(report.views['empty-chat-compact'].lines.length>1,'窄窗提示换行');
  assert.ok(report.views['empty-chat-wide'].box[2]<report.views['empty-chat-wide'].parent[2]*.8,'宽窗提示随字数收窄');
  assert.ok(report.views['messages-compact'].left.lines.length>1,'长句真实换行');
  report.passed=true;
} catch(e){report.failure=e.message;report.screen=await browser.js("document.body.innerText.slice(-1000)").catch(()=>null);console.error(e.message,report.screen);process.exitCode=1;}
finally{
  await writeFile(join(output,'result.json'),JSON.stringify(report,null,2));
  await browser.close();await app.close();await fixture?.close();await rm(dir,{recursive:true,force:true});
}
