import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {setTimeout as sleep} from 'node:timers/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
const root=await mkdtemp(join(tmpdir(),'lychee-browser-evidence-'));
const webRoot=resolve(process.env.LYCHEE_REVIEW_WEB||fileURLToPath(new URL('../public/',import.meta.url)));
const dataDir=await mkdtemp(join(root,'db-'));
console.log('Browser evidence:',root);
const server=await listen({dataDir,webRoot});
const mobile=new Browser(),desktop=new Browser(),second=new Browser(),clients=[mobile,desktop,second];
const run=(b,f,...a)=>b.js('('+f.toString()+')('+a.map(v=>JSON.stringify(v)).join(',')+')');
const has=(b,selector)=>until(()=>run(b,s=>[...document.querySelectorAll(s)].some(e=>e.getClientRects().length),selector),selector);
const hasText=(b,t)=>until(()=>run(b,t=>document.body.innerText.includes(t),t),t);
const click=async(b,t,scope='button',circleName='')=>{
 const p=await until(()=>run(b,(t,s,n)=>{
   const e=[...document.querySelectorAll(s)].find(button=>{
     const card=button.closest('article');
     if(!button.getClientRects().length||button.disabled)return false;
     if(n&&card?.getAttribute('aria-label')!==n)return false;
     const accessibleText=button.cloneNode(true);
     accessibleText.querySelectorAll('[aria-hidden="true"]').forEach(icon=>icon.remove());
     return button.innerText.trim().split(/\n/)[0]===t||button.getAttribute('aria-label')===t||
       accessibleText.textContent.trim()===t;
   });
   if(!e)return false;
   e.scrollIntoView({block:'nearest',inline:'nearest'});
   const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
   return e.contains(document.elementFromPoint(x,y))?{x,y}:false;
 },t,scope,circleName),circleName+' '+t);
 for(let type of ['mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,...p,button:'left',clickCount:1});
};
const cardAction=(b,name,action)=>click(b,action,'.ga-circle-list article button',name);
const shownCode=async b=>{await has(b,'.ga-invite-code');return b.js("document.querySelector('.ga-invite-code').textContent");};
const closeInvitation=async b=>{await click(b,'返回园子列表');await click(b,'返回应用');};
async function openCircleMenu(b){
 const actions=['创建私密园','加入私密园','管理园子'];
 const visible=()=>run(b,labels=>labels.filter(label=>[...document.querySelectorAll('button')].some(e=>
   e.getClientRects().length&&e.innerText.trim()===label)),actions);
 assert.deepEqual(await visible(),[]);
 await click(b,'添加圈子');
 await until(async()=>(await visible()).length===actions.length,'添加圈子的三个菜单项');
}
const field=async(b,s,v)=>{await has(b,s);await run(b,(s,v)=>{const e=document.querySelector(s);Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value').set.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));},s,v)};
const getState=b=>b.js("(async()=>await(await fetch('/api/workspace')).json())()");
const report={checks:[]},log=s=>{report.checks.push(s);console.log(s)},pass=randomUUID();
const shot=async(b,n)=>{let o=await b.call('Page.captureScreenshot',{format:'png'});await writeFile(join(root,n+'.png'),Buffer.from(o.data,'base64'));};
async function measureDialog(browser){
 await has(browser,'.a62-modal');
 return run(browser,()=>{
   const e=document.querySelector('.a62-modal'),r=e.getBoundingClientRect(),w=innerWidth,h=innerHeight;
   const points=[[1,1],[w-2,1],[1,h-2],[w-2,h-2]];
   return {viewport:[w,h],rect:[r.left,r.top,r.right,r.bottom],
     hits:points.map(([x,y])=>e.contains(document.elementFromPoint(x,y)))};
 });
}
async function circleShot(browser,name){
 await run(browser,async()=>{await document.fonts.ready;await document.querySelector('.ga-circle-list article img').decode();});
 await sleep(260);
 const position=()=>run(browser,()=>{
   const list=document.querySelector('.ga-circle-list'),card=list.querySelector('article').getBoundingClientRect();
   const heading=list.querySelector('h2').getBoundingClientRect();
   const nav=[...document.querySelectorAll('nav.bottom')].find(n=>n.getClientRects().length);
   const bottom=Math.min(innerHeight,nav?.getBoundingClientRect().top??innerHeight);
   const x=Math.round(card.left+card.width/2),y=Math.round((bottom+70)/2);
   return {x,y,bottom,cardBottom:card.bottom,headingTop:heading.top,
     hit:document.elementFromPoint(x,y)?.className, distance:Math.ceil(card.bottom-bottom+10)};
 });
 let placed=false;
 for(let attempt=0;attempt<7;attempt++){
   const p=await position();
   if(p.headingTop>=0&&p.cardBottom<=p.bottom+1){
     await sleep(180); const q=await position();
     if(q.headingTop>=0&&q.cardBottom<=q.bottom+1&&Math.abs(q.headingTop-p.headingTop)<2){placed=true;break;}
   }
   const amount=p.distance>0?p.distance:Math.floor(p.headingTop-8);
   await browser.call('Input.dispatchMouseEvent',{type:'mouseWheel',x:p.x,y:p.y,deltaX:0,deltaY:amount});
   await sleep(150);
 }
 assert.ok(placed,'圈子标题和卡片完整显示 '+JSON.stringify(await position()));
 await shot(browser,name+'-window');
 const measured=await run(browser,async()=>{
   const list=document.querySelector('.ga-circle-list');
   const card=list.querySelector('article'),img=card.querySelector('img');
   await img.decode();
   await new Promise(ready=>requestAnimationFrame(()=>requestAnimationFrame(ready)));
   const r=list.getBoundingClientRect(), c=card.getBoundingClientRect(), picture=img.getBoundingClientRect();
   const left=Math.max(0,Math.floor(r.left-8)),top=Math.max(0,Math.floor(r.top-8));
   const right=Math.min(innerWidth,Math.ceil(r.right+8)),bottom=Math.min(innerHeight,Math.ceil(c.bottom+10));
   const actions=[...card.querySelectorAll('button')].filter(e=>e.getClientRects().length).map(e=>{
     const box=e.getBoundingClientRect();return {label:e.innerText.trim()||e.ariaLabel,
       width:Math.round(box.width),height:Math.round(box.height)};
   });
   return {viewport:[innerWidth,innerHeight],clip:{x:left+scrollX,y:top+scrollY,width:right-left,height:bottom-top,scale:1},
     image:{width:picture.width,height:picture.height,natural:[img.naturalWidth,img.naturalHeight]},
     overflow:document.documentElement.scrollWidth>innerWidth,actions};
 });
 assert.equal(measured.overflow,false);
 assert.ok(measured.clip.width>0&&measured.clip.height>0);
 const frame=await browser.call('Page.captureScreenshot',{format:'png',clip:measured.clip,captureBeyondViewport:false});
 await writeFile(join(root,name+'.png'),Buffer.from(frame.data,'base64'));
 return measured;
}
const addUser=async(b,name,register=true)=>{
 if(register)await click(b,'注册新账号');
 await field(b,'input[name=username]',name);await field(b,'input[name=password]',pass);await click(b,register?'注册':'登录');
 if(register){await hasText(b,'账号公告');await click(b,'标为已读');await hasText(b,'我的私密园');}
};
let stage='';
try{
 await Promise.all(clients.map(b=>b.open()));
 await Promise.all([mobile.size(390,844,true),desktop.size(1280,900),second.size(496,478)]);
 await mobile.call('Page.navigate',{url:server.url+'/mobile/'});await has(mobile,'input[name=username]');await shot(mobile,'login-mobile');
 stage='A注册、公告和创建';await addUser(mobile,'园主安安');await click(mobile,'创建私密园');await field(mobile,'input[name=gardenName]','春日小园');await field(mobile,'input[name=subtitle]','午后茶会');await click(mobile,'创建并进入');await has(mobile,'.ga-circle-list');const g1=(await getState(mobile)).activeGardenId;assert.ok(g1);assert.equal(await mobile.js("document.documentElement.hasAttribute('data-windows-workspace')"),false);
 assert.equal(await mobile.js("new URL(location.href).searchParams.get('garden')"),g1);log('手机页面注册→公告已读→创建私密园→原移动应用');
 stage='发码';await cardAction(mobile,'春日小园','邀请成员');await has(mobile,'.ga-invite-code');const code=await mobile.js("document.querySelector('.ga-invite-code').textContent");assert.match(code,/^LZ-/i);await click(mobile,'返回园子列表');await click(mobile,'返回应用');log('园主查看园子稳定邀请码');
 stage='B注册、加入';await desktop.call('Page.navigate',{url:server.url+'/windows/workspace.html'});await addUser(desktop,'入园小禾');await click(desktop,'加入私密园');await field(desktop,'input[name=inviteCode]','无效试码');await click(desktop,'加入并进入');await hasText(desktop,'邀请码无效');await field(desktop,'input[name=inviteCode]',code);await click(desktop,'加入并进入');await has(desktop,'.ga-circle-list');await has(desktop,'.windows-nav');assert.equal((await getState(desktop)).activeGardenId,g1);
 await has(desktop,'.ga-circle-list button.ga-edit');await has(desktop,'.ga-circle-list button.ga-invite');
 await openCircleMenu(desktop);await click(desktop,'管理园子');await has(desktop,'.ga-garden-row small');
 assert.equal(await desktop.js("document.querySelector('.ga-garden-row small').textContent"),'成员');
 await click(desktop,'邀请成员','.ga-garden-row button');assert.equal(await shownCode(desktop),code);await closeInvitation(desktop);
 await shot(desktop,'member-windows');log('Windows 普通成员加入同园，身份仍为成员，从园子管理面板读回园主所见的稳定码');
 stage='第二位成员重复使用同一码';await second.call('Page.navigate',{url:server.url+'/windows/workspace.html'});await addUser(second,'入园小林');await click(second,'加入私密园');await field(second,'input[name=inviteCode]',code);await click(second,'加入并进入');await has(second,'.ga-circle-list');assert.equal((await getState(second)).activeGardenId,g1);await openCircleMenu(second);await click(second,'管理园子');await click(second,'退出账号');log('同一个稳定码连续供两位不同新成员加入');
 stage='园主编辑名签';await cardAction(mobile,'春日小园','编辑');await field(mobile,'input[aria-label=圈名]','应当取消');await click(mobile,'取消','.ga-card-form button');assert.ok((await getState(mobile)).gardens.some(g=>g.name==='春日小园'));
 stage='成员编辑名签及另一账号读回';await cardAction(desktop,'春日小园','编辑');
 await field(desktop,'input[aria-label=圈名]','春日茶园');await field(desktop,'input[aria-label=小标签]','朋友午后');await click(desktop,'保存','.ga-card-form button');
 await hasText(desktop,'朋友午后');await mobile.call('Page.reload');await hasText(mobile,'朋友午后');
 assert.ok((await getState(desktop)).gardens.some(g=>g.name==='春日茶园'&&g.subtitle==='朋友午后'));const img=async b=>b.js("(async()=>{let i=document.querySelector('img.circle-banner');await i.decode();let r=i.getBoundingClientRect();return {natural:[i.naturalWidth,i.naturalHeight],box:[r.width,r.height],src:i.getAttribute('src')};})()");report.covers={mobile:await img(mobile),windows:await img(desktop)};await shot(desktop,'member-windows');await shot(mobile,'owner-mobile');log('园主取消保持原值，普通成员原位编辑及保存，园主在手机读回圈名和小标签');
 stage='普通成员取消及确认换码';await cardAction(desktop,'春日茶园','邀请成员');assert.equal(await shownCode(desktop),code);
 await click(desktop,'更换邀请码');await click(desktop,'保留原码');assert.equal(await shownCode(desktop),code);
 await click(desktop,'更换邀请码');await click(desktop,'确认换码');await hasText(desktop,'邀请码已更换');
 const newCode=await shownCode(desktop);assert.notEqual(newCode,code);await closeInvitation(desktop);
 assert.equal((await getState(desktop)).gardens.find(g=>g.id===g1).role,'member');
 await addUser(second,'入园小林',false);await has(second,'.ga-circle-list');await hasText(second,'朋友午后');
 await cardAction(second,'春日茶园','邀请成员');assert.equal(await shownCode(second),newCode);
 await click(second,'返回园子列表');await click(second,'退出账号');await has(second,'input[name=username]');
 log('普通成员取消换码保留原码，确认后新码生效；早先加入的另一位普通成员重新登录，原成员身份、圈名/标签和新邀请码均读回');
 stage='应用个人封面';await click(mobile,'✦ AI 生成','.a62-circle-cover button');await hasText(mobile,'生成圈子封面');report.coverDialog={mobile:await measureDialog(mobile)};
 await click(desktop,'✦ AI 生成','.a62-circle-cover button');report.coverDialog.desktop=await measureDialog(desktop);await sleep(300);await click(desktop,'关闭','.a62-modal button');await until(()=>desktop.js("!document.querySelector('.a62-modal')"),'封面弹窗关闭');
 const fixtureId=randomUUID();const jpeg=await readFile(join(webRoot,'mobile/orchard-tea.jpg'));const fixtureDb=new DatabaseSync(join(dataDir,'gardens',g1+'.sqlite'));try{fixtureDb.exec('BEGIN IMMEDIATE');fixtureDb.prepare('INSERT INTO v62_ai_images VALUES(?,?,?,?,?,?)').run(fixtureId,'1','本地隔离历史图片',Date.now(),'image/jpeg',1);fixtureDb.prepare('INSERT INTO v62_ai_image_parts VALUES(?,?,?)').run(fixtureId,0,jpeg.toString('base64'));fixtureDb.exec('COMMIT');}finally{fixtureDb.close()}
 await click(mobile,'◷ 生成记录');await click(mobile,'本地隔离历史图片','.a62-gallery button');await click(mobile,'使用这张图片');await until(()=>mobile.js("document.querySelector('.ga-circle-list img.circle-banner')?.src.startsWith('data:image/jpeg;base64,')"),'应用到个人封面');await mobile.call('Page.reload');await has(mobile,'.ga-circle-list');assert.equal(await mobile.js("document.querySelector('.ga-circle-list img.circle-banner').src.startsWith('data:image/jpeg;base64,')"),true);assert.equal(await desktop.js("document.querySelector('.ga-circle-list img.circle-banner').getAttribute('src')"),'/mobile/break-room.webp');log('原换封面控件选择本地隔离历史图片，应用后刷新仍在，其他成员仍显示原封面；实际未发起生图');
 stage='Windows设置重看';await click(desktop,'设置','.windows-nav button');await click(desktop,'账号公告','.entry');await hasText(desktop,'已读');await click(desktop,'返回应用');await click(desktop,'荔圈首页','.windows-nav button');
 stage='共享业务房间';await cardAction(desktop,'春日茶园','进入圈子');await has(desktop,'textarea,input:not([type=file])');
 const s=await desktop.js("[...document.querySelectorAll('textarea,input')].filter(x=>x.getClientRects().length).map(x=>[x.tagName,x.type,x.placeholder])");report.roomFields=s;
 const selector=s.some(x=>x[0]==='TEXTAREA')?'textarea':'input[placeholder="聊两句…"]';await field(desktop,selector,'同园跨端消息');await click(desktop,'发送');await hasText(desktop,'同园跨端消息');
 await cardAction(mobile,'春日茶园','进入圈子');await hasText(mobile,'同园跨端消息');
 assert.equal(await mobile.js('document.querySelector(".tea-room-title p").textContent'),'朋友午后');
 log('Windows 成员发送原聊天消息；手机读回正文、圈名和小标签');
 stage='同账号跨设备登录';await second.call('Page.navigate',{url:server.url+'/windows/workspace.html'});await addUser(second,'园主安安',false);await has(second,'.ga-circle-list');assert.ok((await getState(second)).notices.every(n=>n.read));assert.equal(await second.js("new URL(location.href).searchParams.get('garden')"),g1);log('同一园主在另一 Windows 窄窗登录，公告保持账号已读，进入原园');
 stage='圈子宽窄图面';report.layout={};
 await second.size(984,698);report.layout.wide=await circleShot(second,'circles-wide');
 await second.size(496,720);report.layout.portrait=await circleShot(second,'circles-portrait');
 await second.size(496,478);report.layout.narrow=await circleShot(second,'circles-narrow');
 stage='添加圈子菜单';await openCircleMenu(second);await shot(second,'circles-menu-narrow');
 await click(second,'加入私密园','.ga-add-panel button');await has(second,'input[name=inviteCode]');await click(second,'返回园子列表');await click(second,'返回应用');
 await openCircleMenu(second);for(const type of ['keyDown','keyUp'])await second.call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
 assert.equal(await second.js("document.querySelector('.ga-add-trigger').getAttribute('aria-expanded')"),'false');
 assert.equal(await second.js("document.activeElement===document.querySelector('.ga-add-trigger')"),true);
 log('添加圈子菜单可用鼠标打开三个入口，Esc 收起后焦点回到按钮');
 stage='园主从另一设备复核成员换码';await cardAction(second,'春日茶园','邀请成员');
 assert.equal(await shownCode(second),newCode);await closeInvitation(second);
 assert.equal((await getState(second)).gardens.find(g=>g.id===g1).role,'owner');
 log('园主在另一台 Windows 登录，查到普通成员换发的同一码，身份保持园主');
 stage='移动提醒与Windows读回';await click(mobile,'返回');await click(mobile,'工具箱','nav.bottom button');await click(mobile,'提醒事项','.toolbox-shortcuts button');await click(mobile,'＋ 新建事项');await field(mobile,'[aria-label=事项名称]','跨端提醒核验');await click(mobile,'保存事项');await hasText(mobile,'跨端提醒核验');await click(second,'工具箱','nav.bottom button');await click(second,'提醒事项','.toolbox-shortcuts button');await hasText(second,'跨端提醒核验');log('同一账号手机创建原版提醒，在独立 Windows 窄窗会话读取');
 stage='创建第二个园及切换';await click(second,'返回');await click(second,'荔圈','nav.bottom button');await has(second,'.ga-circle-list');await openCircleMenu(second);await click(second,'创建私密园');await field(second,'input[name=gardenName]','秋日小园');await click(second,'创建并进入');await has(second,'.ga-circle-list');const g2=(await getState(second)).activeGardenId;assert.notEqual(g1,g2);await cardAction(second,'春日茶园','进入圈子');await hasText(second,'同园跨端消息');assert.equal(await second.js("new URL(location.href).searchParams.get('garden')"),g1);log('切换其他园更新 URL，进入目标园原房间并读取已发消息');
 stage='非成员园 URL';await desktop.call('Page.navigate',{url:server.url+'/windows/workspace.html?garden='+g2});await hasText(desktop,'当前账号未加入此园');assert.equal(await desktop.js("!!document.querySelector('main.garden-app')"),false);
 assert.deepEqual(await desktop.js("[...document.querySelectorAll('.ga-garden-row strong')].map(n=>n.firstChild.textContent)"),['春日茶园']);
 assert.ok(!(await getState(desktop)).gardens.some(g=>g.id===g2));await click(desktop,'退出账号');await has(desktop,'input[name=username]');assert.equal(await desktop.js("(async()=>(await fetch('/api/workspace')).status)()"),401);log('直接打开非成员园停在园选择，退出后服务端返回 401');await addUser(desktop,'换码核验员');
 assert.equal(await desktop.js("document.querySelectorAll('.ga-garden-row,.ga-edit,.ga-invite').length"),0);
 log('其他园成员打开未加入园的地址仅见本人园子，未入任何园的新账号看不到编辑或邀请入口');
 await click(desktop,'加入私密园');await field(desktop,'input[name=inviteCode]',code);await click(desktop,'加入并进入');await hasText(desktop,'邀请码无效');await field(desktop,'input[name=inviteCode]',newCode);await click(desktop,'加入并进入');await has(desktop,'.ga-circle-list');assert.equal((await getState(desktop)).activeGardenId,g1);log('新注册成员使用旧码失败、使用更换后的码成功');
 for(const [client,m] of Object.entries(report.coverDialog)){const [w,h]=m.viewport;assert.ok(m.rect.every((n,i)=>Math.abs(n-[0,0,w,h][i])<=1)&&m.hits.every(Boolean),'封面弹窗边界 '+client+' '+JSON.stringify(m));}
 report.status='通过';report.version=(await mobile.call('Browser.getVersion')).product;
}catch(error){report.status='失败';report.failure={stage,message:error.message};for(const [i,b] of clients.entries()){try{let text=await b.js("document.body.innerText");report['buttons'+i]=await b.js("[...document.querySelectorAll('button')].filter(x=>x.getClientRects().length).map(x=>[x.innerText.trim(),x.getAttribute('aria-label'),x.title]).slice(-16)");report['screen'+i]=text.replaceAll(/LZ-[A-Fa-f0-9]{32}/g,'[邀请码]');}catch{}}console.error(stage,error.message);process.exitCode=1;}
finally{report.errors=clients.map(b=>b.errors);report.externalRequests=clients.flatMap(b=>b.urls).filter(u=>/^https?:/.test(u)&&!u.startsWith(server.url+'/'));await writeFile(join(root,'result.json'),JSON.stringify(report,null,2));await Promise.allSettled(clients.map(b=>b.close()));await server.close();await rm(dataDir,{recursive:true,force:true});}

