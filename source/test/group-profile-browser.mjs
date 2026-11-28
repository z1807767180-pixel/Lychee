import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {basename,dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {listen} from '../server/index.mjs';
import {Browser,until} from './edge.mjs';

const [site,receipt]=process.argv.slice(2);
if(!site||!receipt)throw Error('Pass the built mobile www directory and the output receipt.');
const temp=await mkdtemp(join(tmpdir(),'lychee-group-profile-'));
const server=await listen({storage:'sqlite',host:'127.0.0.1',webRoot:resolve(site),dataDir:temp});
const b=new Browser(),checks=[],users=['春禾','夏麦','秋栗','冬雪'].map(name=>({name}));
async function api(user,path,body,expected=200){
  const res=await fetch(server.url+path,{method:body?'POST':'GET',headers:{cookie:user.cookie||'',origin:server.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const data=await res.json();assert.equal(res.status,expected,JSON.stringify(data));
  user.cookie=res.headers.getSetCookie()[0]?.split(';')[0]||user.cookie;return data;
}
const social=(u,body,query='',status=200)=>api(u,'/api/v8/social?accountId='+u.id+query,body,status);
const wait=(expression,label)=>until(()=>b.js(expression),label);
const view=key=>wait('document.querySelector(".s8")?.dataset.view==='+JSON.stringify(key),key);
async function tap(selector,label=''){
  const point=await until(()=>b.js('(()=>{const e=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(n=>n.offsetWidth&&!n.disabled&&(!'+JSON.stringify(label)+'||n.getAttribute("aria-label")==='+JSON.stringify(label)+'||n.innerText.trim()==='+JSON.stringify(label)+'));if(!e)return null;e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return e.contains(document.elementFromPoint(x,y))?{x,y}:null;})()'),label||selector);
  for(const type of ['mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
async function enter(user){
  const [name,value]=user.cookie.split('=');await b.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
  await b.call('Page.navigate',{url:server.url+'/mobile/'});await wait('!!document.querySelector(".s8-card")&&!document.querySelector("#lychee-launch")','真实首页');
}
async function back(key){await tap('.s8-back');await view(key);}
try{
  const version=(await readFile(join(resolve(site),'mobile/version.txt'),'utf8')).trim();
  for(const u of users){
    await api(u,'/api/v640/account',{mode:'register',name:u.name,password:randomUUID()});u.id=(await api(u,'/api/v640/workspace')).account.id;
    for(const n of (await api(u,'/api/v640/workspace?client=mobile-web')).notices.filter(n=>!n.read))await api(u,'/api/v640/workspace',{action:'read',noticeId:n.id});
  }
  const [viewer,author,owner,outsider]=users;
  const group=(await social(owner,{action:'groupCreate',name:'果园小组',friendIds:[],clientId:randomUUID()})).id;
  const invite=(await api(owner,'/api/v640/workspace',{action:'invite',gardenId:group})).inviteCode;
  for(const u of [viewer,author])await api(u,'/api/v640/workspace',{action:'join',code:invite});
  await b.open();await b.size(390,844,true);
  const picture=await b.js("(()=>{const c=document.createElement('canvas');c.width=24;c.height=16;const g=c.getContext('2d');g.fillStyle='#bc4152';g.fillRect(0,0,24,16);return c.toDataURL('image/jpeg').split(',')[1]})()");
  const post=await social(author,{action:'post',kind:'feed',title:'',body:'果园今天开花',photo:picture,clientId:randomUUID()});
  await social(author,{action:'postReact',postId:post.id,emoji:'❤️',active:true});
  await social(viewer,{action:'post',kind:'feed',title:'',body:'其他作者的记录',clientId:randomUUID()});
  await social(author,{action:'message',groupId:group,body:'周末见',clientId:randomUUID()});
  await social(outsider,null,'&view=friendProfile&id='+author.id,403);
  await social(outsider,null,'&view=feed&kind=feed&authorId='+author.id,403);
  checks.push('陌生人无法读取名片及作者动态');
  await enter(viewer);
  await tap('button','果园小组');await view('group');await tap('.s8-room-title','果园小组，3位成员，查看群资料');await view('members');
  await tap('button','群成员');await view('groupMembers');await tap('button',author.name);await view('friendProfile');
  assert.equal(await b.js('!!document.querySelector(".s8-profile-feed")'),false);
  await tap('button','加好友');await wait('document.querySelector(".s8-identity").innerText.includes("已申请")','已申请');
  checks.push('群标题显示三人，可打开名单与非好友名片，未呈现动态，申请状态正确');
  await social(author,{action:'friendAccept',accountId:viewer.id});await back('groupMembers');await tap('button',author.name);await view('friendProfile');
  await wait('document.querySelector(".s8-feed-preview img")?.naturalWidth===24','好友名片预览');
  await tap('button.s8-profile-feed');await view('feed');await wait('document.querySelector(".g81-feed")?.innerText.includes("果园今天开花")','作者专页');
  await wait('document.querySelector(".g81-feed .g81-photo")?.naturalWidth===24 && !!document.querySelector(".g81-reaction[aria-label*=人]")','原图及回应人数');
  assert.equal(await b.js('document.querySelector(".s8-content").innerText.includes("其他作者的记录")'),false);
  await back('friendProfile');await tap('button','发消息');await view('dm');await tap('.s8-room-title');await view('friendProfile');
  checks.push('好友名片显示真实图片预览，作者专页正确显示图片与回应并隔离其他人的动态，可回名片并发起私聊');
  await enter(viewer);await tap('button','果园小组');await view('group');await tap('.s8-chat-person');await view('friendProfile');await back('group');
  await tap('.s8-room-details');await view('members');await tap('button','群设置');await view('groupEdit');
  await b.js('(()=>{const [n,d]=document.querySelectorAll(".s8-content form input");n.value="果园茶厅";d.value="周末见";})()');
  await tap('button','保存群资料');await view('members');await wait('document.querySelector(".s8-group-info")?.innerText.includes("果园茶厅")','群资料保存');
  const updated=(await social(author,null,'&view=group&id='+group)).group;
  assert.equal(updated.name,'果园茶厅');assert.equal(updated.subtitle,'周末见');
  await tap('button','群设置');await view('groupEdit');await tap('button','查看邀请码');await wait('document.querySelector(".s8-content code")?.textContent==='+JSON.stringify(invite),'沿用原邀请码');
  checks.push('消息头像进入同一名片，普通成员可编辑群资料，另一成员可读，旧邀请码相通');
  await back('members');await tap('button','群头像与主图');await view('groupArt');await tap('button','群主图');
  await wait('!![...document.querySelectorAll(".s8-group-art button")].find(n=>n.textContent==="AI 生成群主图")','群主图入口');
  const original=updated.heroUrl;
  await b.js('(async()=>{const field=document.querySelector(".s8-group-art input[type=file]");const bits=Uint8Array.from(atob('+JSON.stringify(picture)+'),c=>c.charCodeAt(0));const dt=new DataTransfer();dt.items.add(new File([bits],"测试果园.jpg",{type:"image/jpeg"}));field.files=dt.files;field.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait('document.querySelector(".s8-group-art img[alt*=预览]")?.naturalWidth>0','选图后的预览');
  assert.equal((await social(author,null,'&view=group&id='+group)).group.heroUrl,original);
  await tap('button','保存为群主图');await view('members');
  const synced=(await social(author,null,'&view=group&id='+group)).group;
  assert.notEqual(synced.heroUrl,original);
  const fetched=await fetch(server.url+synced.heroUrl,{headers:{cookie:author.cookie}});
  assert.equal(fetched.status,200);assert.equal(fetched.headers.get('content-type'),'image/jpeg');
  assert.ok((await fetched.arrayBuffer()).byteLength>0);
  checks.push('上传主图可先预览，明确保存后另一成员可经受控地址读取共享照片');
  await mkdir(dirname(resolve(receipt)),{recursive:true});await writeFile(receipt,JSON.stringify({version,environment:'本地隔离 SQLite 及 Edge 390×844，从实际 /mobile/ 打开',checks},null,2)+'\n');
  console.log(checks.length+' group/profile browser paths passed');
}catch(e){if(b.socket?.readyState===1)console.error(await b.js('document.querySelector(".s8")?.innerText.slice(0,450)'));throw e;}
finally{await b.close();await server.close();assert.equal(dirname(temp),tmpdir());assert.match(basename(temp),/^lychee-group-profile-[A-Za-z0-9]{6}$/);await rm(temp,{recursive:true,force:true});}
