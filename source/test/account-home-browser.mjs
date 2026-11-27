// Two browser surfaces, real SQLite accounts, an existing garden and a new empty group.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {listen} from '../server/index.mjs';
import {Browser,until} from './browser.mjs';
const [mobileRoot,evidencePath]=process.argv.slice(2),evidence=resolve(evidencePath);
const mobileVersion=(await readFile(resolve(mobileRoot,'mobile/version.txt'),'utf8')).trim();
const temp=await mkdtemp(join(tmpdir(),'lychee-account-home-')),web=join(temp,'www');
await mkdir(evidence,{recursive:true});await cp(resolve('source/public'),web,{recursive:true});
await cp(resolve(mobileRoot,'mobile'),join(web,'mobile'),{recursive:true});
const service=await listen({webRoot:web,dataDir:join(temp,'private')});
const [a,b,c]=[{}, {}, {}], desktop=new Browser(),phone=new Browser();
async function send(user,path,body,expected=200){
  const response=await fetch(service.url+path,{method:body?'POST':'GET',headers:{cookie:user.cookie||'',origin:service.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));
  user.cookie=response.headers.getSetCookie()[0]?.split(';')[0]||user.cookie;return data;
}
const social=(u,body,query='',status=200)=>send(u,'/api/v8/social?accountId='+u.id+query,body,status);
async function open(browser,user,path){
  await browser.open();const mobile=path.includes('mobile');await browser.size(mobile?360:980,mobile?780:720,mobile);
  const [name,value]=user.cookie.split('=');
  await browser.call('Network.setCookie',{name,value,url:service.url+'/',path:'/',secure:true,httpOnly:true});
  await browser.call('Page.navigate',{url:service.url+path});await until(()=>browser.js("!document.getElementById('lychee-launch') && !!document.querySelector('.s8-card')"),'账号首页');
}
async function tap(browser,label){
  const point=await until(()=>browser.js(`(()=>{const b=[...document.querySelectorAll('button')].find(e=>e.offsetWidth&&!e.disabled&&(e.textContent.trim()===${JSON.stringify(label)}||e.getAttribute('aria-label')===${JSON.stringify(label)}));if(!b)return;b.scrollIntoView({block:'nearest'});const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(b.contains(document.elementFromPoint(x,y)))return {x,y};})()`),label);
  await browser.call('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
  await browser.call('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
}
const visible=(browser,text)=>until(()=>browser.js('document.querySelector(".s8")?.innerText.includes('+JSON.stringify(text)+')'),text);
async function shot(browser,name){
  await until(()=>browser.js("!document.getElementById('lychee-launch')&&!document.querySelector('iframe')?.contentDocument.getElementById('lychee-launch')"),'启动遮罩消失后取图');
  await browser.js('new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done)))');
  await writeFile(join(evidence,name+'.png'),Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
async function choose(browser,tab){await tap(browser,tab);}
async function refreshHome(browser){if(await browser.js("!!document.querySelector('.s8[data-chat=true]') && !document.querySelector('.s8-nav').offsetHeight"))await tap(browser,'‹ 返回');await choose(browser,'荔圈');await until(()=>browser.js("!!document.querySelector('.s8-card')"),'首页列表');}
async function sendText(browser,body){
  await until(()=>browser.js("!!document.querySelector('.s8-composer textarea')"),'消息输入');
  await browser.js("(()=>{const f=document.querySelector('.s8-composer textarea');f.value="+JSON.stringify(body)+";f.dispatchEvent(new Event('input'));f.form.requestSubmit()})()");
  await visible(browser,body);
}
async function checkThemes(browser,surface){
  const names=['原味荔枝园','米菲采荔枝','图图树下','凯蒂荔枝茶会'],skins=['orchard','miffy','tutu','kitty'];
  async function style(){await refreshHome(browser);await tap(browser,'我');await tap(browser,'头像与主题');await until(()=>browser.js("document.querySelector('iframe')?.contentDocument.querySelectorAll('.theme-grid button').length===4"),'原主题设置');}
  for(const [index,name] of names.entries()){
    await style();await browser.js(`document.querySelector('iframe').contentDocument.querySelectorAll('.theme-grid button')[${index}].click()`);
    await tap(browser,'‹ 返回');await refreshHome(browser);await tap(browser,'周末约饭');await visible(browser,'再发群消息');
    const expected='social-'+(surface==='窄屏'?'wall':'wide')+'-'+skins[index]+'.webp';
    await until(()=>browser.js(`(async()=>{const shell=document.querySelector('.s8'),s=getComputedStyle(shell),url=s.backgroundImage.match(/url\\(["']?([^"')]+)/)?.[1];if(!url||!url.includes('${expected}'))return false;const img=new Image();img.src=url;await img.decode();return s.backgroundSize===${JSON.stringify(surface==='窄屏'?'100% 100%':'cover')}&&document.querySelector('.s8-msg .s8-person')?.naturalWidth>0})()`),surface+'实际壁纸 '+name);
    await shot(browser,surface+'-'+name+'-群聊');
  }
  await browser.call('Page.reload');await until(()=>browser.js("!document.getElementById('lychee-launch')&&!!document.querySelector('.s8-card')"),'主题重开');
  assert.equal(await browser.js("document.querySelector('.s8').dataset.skin"),'kitty');
  // The legacy palette belongs to the signed-in account's private tools garden.
  await style();await browser.js("document.querySelector('iframe').contentDocument.querySelectorAll('.face-grid button')[5].click()");
  await until(()=>browser.js("document.querySelector('iframe').contentDocument.querySelectorAll('.face-grid button')[5].getAttribute('aria-pressed')==='true'"),'已选个人头像');
  await browser.js("(async()=>{const doc=document.querySelector('iframe').contentDocument,c=doc.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#70866a';ctx.fillRect(0,0,64,64);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const dt=new DataTransfer();dt.items.add(new File([blob],'trial.jpg',{type:'image/jpeg'}));const field=doc.querySelector('.wallpaper-controls input[type=file]');field.files=dt.files;field.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(()=>browser.js("!![...document.querySelector('iframe').contentDocument.querySelectorAll('button')].find(b=>b.textContent.includes('恢复主题背景'))"),'保存个人壁纸');
  await tap(browser,'‹ 返回');await refreshHome(browser);await tap(browser,'周末约饭');await visible(browser,'再发群消息');
  await until(()=>browser.js("getComputedStyle(document.querySelector('.s8')).backgroundImage.includes('data:image/jpeg;base64,')&&document.querySelector('.s8-msg.mine .s8-person')?.src.includes('face-5.webp')"),'自选壁纸和本人头像');
  await style();await browser.js("[...document.querySelector('iframe').contentDocument.querySelectorAll('button')].find(b=>b.textContent.includes('恢复主题背景')).click()");
  await tap(browser,'‹ 返回');await refreshHome(browser);
}
try{
  for(const [user,name] of [[a,'小荔'],[b,'阿青'],[c,'小栗']]){
    await send(user,'/api/v640/account',{mode:'register',name,password:randomUUID()});
    user.id=(await send(user,'/api/v640/workspace')).account.id;
    for(const suffix of ['', '?client=mobile-web','?client=windows-8.0.0','?client=windows-7.0.0']){
      const workspace=await send(user,'/api/v640/workspace'+suffix);
      for(const note of workspace.notices.filter(n=>!n.read))await send(user,'/api/v640/workspace',{action:'read',noticeId:note.id});
    }
  }
  const old=await send(a,'/api/v640/workspace',{action:'create',name:'周末约饭'}),g=old.activeGardenId;
  const code=(await send(a,'/api/v640/workspace',{action:'invite',gardenId:g})).inviteCode;
  await send(b,'/api/v640/workspace',{action:'join',code});await send(c,'/api/v640/workspace',{action:'join',code});
  await social(a,{action:'friendRequest',accountId:b.id});await social(b,{action:'friendAccept',accountId:a.id});
  const empty=(await social(a,{action:'groupCreate',name:'散步搭子',friendIds:[b.id]})).id;
  await social(a,{action:'goalSave',title:'周六看展',due:Date.now()+86400000,body:''});
  await open(desktop,a,'/windows/workspace.html');await open(phone,b,'/mobile/');
  await visible(desktop,'周六看展');await tap(desktop,'散步搭子');await visible(desktop,'还没有消息');await tap(desktop,'‹ 返回');await visible(desktop,'周六看展');
  await tap(phone,'周末约饭');await sendText(phone,'先发群消息');await refreshHome(desktop);
  await visible(desktop,'先发群消息');assert.equal(await desktop.js("document.querySelector('[data-conversation]').dataset.conversation"),g);
  await refreshHome(phone);await tap(phone,'小荔');await sendText(phone,'次发私聊');await refreshHome(desktop);await visible(desktop,'次发私聊');
  assert.equal(await desktop.js("document.querySelector('[data-conversation]').dataset.conversation"),b.id);
  await refreshHome(phone);await tap(phone,'周末约饭');await sendText(phone,'再发群消息');await refreshHome(desktop);await visible(desktop,'再发群消息');
  const rows=await desktop.js("Array.from(document.querySelectorAll('[data-conversation]'),b=>b.dataset.conversation)");
  assert.equal(rows[0],g);assert.equal(rows.length,new Set(rows).size);assert.ok(rows.includes(empty));
  await shot(desktop,'Windows-统一首页');await refreshHome(phone);await shot(phone,'手机-统一首页');
  await tap(desktop,'周末约饭');await visible(desktop,'再发群消息');await shot(desktop,'Windows-群聊');
  await tap(desktop,'选表情');await tap(desktop,'😀');
  await tap(desktop,'更多聊天操作');await visible(desktop,'发图片');
  await desktop.js("(async()=>{const canvas=document.createElement('canvas');canvas.width=128;canvas.height=64;const ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,128,64);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));const transfer=new DataTransfer();transfer.items.add(new File([blob],'test.jpg',{type:'image/jpeg'}));const field=document.querySelector('.s8-composer [type=file]');field.files=transfer.files;field.dispatchEvent(new Event('change',{bubbles:true}));})()");
  await until(()=>desktop.js("!!document.querySelector('.s8-draft-photo img')"),'图片草稿');await tap(desktop,'发送');
  await until(()=>desktop.js("!!document.querySelector('.s8-msg.mine .s8-photo-button img')?.naturalWidth"),'自己发的群图片');
  await desktop.js("document.querySelector('.s8-photo-button').click()");await until(()=>desktop.js("!!document.querySelector('.s8-image-preview img')?.naturalWidth"),'查看图片');await tap(desktop,'关闭');
  await shot(desktop,'Windows-群聊图片与表情');
  const sentPhoto=(await social(b,null,'&view=group&id='+g)).messages.find(m=>m.imageUrl&&m.name==='小荔');
  assert.ok(sentPhoto?.imageUrl);assert.match(sentPhoto.body,/😀/u);
  await desktop.js("document.querySelector('.s8-msg.mine .s8-photo-button').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true}))");await tap(desktop,'撤回');
  await until(async()=>(await social(b,null,'&view=group&id='+g)).messages.find(m=>m.id===sentPhoto.id)?.body==='消息已撤回','对方看到已撤回');
  await visible(desktop,'消息已撤回');
  await tap(desktop,'更多聊天操作');await tap(desktop,'原群聊与照片');await until(()=>desktop.js("!!document.querySelector('iframe')?.contentDocument.querySelector('.room-compose [type=file]')"),'原群已有操作保留');
  await choose(desktop,'工具箱');await tap(desktop,'交给命运');
  await until(()=>desktop.js("!!document.querySelector('iframe')?.contentDocument.querySelector('.v7-wheel')"),'原转盘');
  await choose(desktop,'我');await tap(desktop,'设置');await visible(desktop,'Windows W');
  await choose(phone,'我');await tap(phone,'设置');await visible(phone,'手机网页 V'+mobileVersion);
  await checkThemes(phone,'窄屏');await checkThemes(desktop,'宽窗');
  await tap(phone,'周末约饭');await visible(phone,'再发群消息');
  await phone.js("(()=>{const f=document.querySelector('.s8-composer textarea');f.focus();f.value='尚未发出的草稿';f.dataset.sameEditor='yes';f.dispatchEvent(new Event('input'));})()");
  await social(a,{action:'message',groupId:g,body:'输入期间收到的新消息',clientId:randomUUID()});
  await visible(phone,'输入期间收到的新消息');
  assert.equal(await phone.js("document.activeElement.dataset.sameEditor==='yes'&&document.activeElement.value==='尚未发出的草稿'"),true);
  await social(c,{action:'message',friendId:a.id,body:'不应允许',clientId:randomUUID()},'',403);
  const post=await social(a,{action:'post',kind:'feed',body:'仅好友',clientId:randomUUID()});
  await social(c,null,'&view=post&id='+post.id,404);
  await social(b,{action:'groupLeave',groupId:g});await social(b,{action:'message',friendId:a.id,body:'退群后仍是好友',clientId:randomUUID()});
  assert.ok(!(await social(b,null)).groups.some(x=>x.id===g));
  await writeFile(join(evidence,'account-home.json'),JSON.stringify({pass:true,groupPrivateGroupOrder:true,emptyGroup:true,accounts:3,groups:2,sharedGardenMembershipDoesNotGrantPrivateAccess:true,priorToolReachable:true,fourVisibleThemesInBothWidths:true,customWallpaperAndOwnAvatarPersist:true,receivedWhileInputFocusedWithDraftIntact:true,groupPictureEmojiAndRecall:true,desktopErrors:desktop.errors,mobileErrors:phone.errors},null,2));
  assert.deepEqual(desktop.errors,[]);assert.deepEqual(phone.errors,[]);console.log('Three accounts, two groups, mixed recency, stable account, private scope and retained tool passed.');
}catch(error){for(const browser of [desktop,phone])if(browser.socket)console.error(await browser.js('document.body.innerText.slice(-700)'),browser.errors,browser.responses.filter(x=>x[0]>=400).slice(-10),await browser.js('document.querySelector("iframe")?.contentDocument.body.innerText.slice(-500)'));throw error;}
finally{await Promise.allSettled([desktop.close(),phone.close()]);await service.close();await rm(temp,{recursive:true,force:true});}
