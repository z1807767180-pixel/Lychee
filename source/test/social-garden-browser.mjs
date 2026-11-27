import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {cp,mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';
import {Browser,until} from './browser.mjs';

// Mount the shipped navigation, account API and garden module on a local origin.
// Production auth cookies and both independent browser profiles go through the real server.
const source=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(join(tmpdir(),'lychee-social-ui-'));
const www=join(temp,'www'),a=new Browser(),b=new Browser();
let server;
try{
  await cp(join(source,'public'),www,{recursive:true});
  await mkdir(join(www,'client'),{recursive:true});
  const files=['social-v8-api.js','social-v8-garden.js','social-v8.js','social-v8.css','social-v8-garden.css'];
  for(const f of files)await cp(join(source,'client',f),join(www,'client',f));
  const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    files.map(f=>f.endsWith('.js')?'<script defer src="/client/'+f+'"></script>':'<link rel="stylesheet" href="/client/'+f+'">').join('')+
    '<main id="root"></main><script>addEventListener("DOMContentLoaded",async()=>{const s=await (await fetch("/api/v640/workspace")).json();LycheeSocial.mount(root,s.account,{})})</script>';
  await writeFile(join(www,'social-check.html'),html);
  server=await listen({dataDir:join(temp,'data'),webRoot:www});
  async function api(cookie,path,data){
    const response=await fetch(server.url+path,{method:data?'POST':'GET',headers:{origin:server.url,cookie,'content-type':'application/json'},body:data&&JSON.stringify(data)});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    return {result,cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  }
  async function person(name){
    const {cookie}=await api('','/api/v640/account',{mode:'register',name,password:randomUUID()});
    return {name,cookie,id:(await api(cookie,'/api/v640/workspace')).result.account.id};
  }
  const aa=await person('金荔'),bb=await person('青荔');
  const act=(u,action,p)=>api(u.cookie,'/api/v8/social?accountId='+u.id,{action,...p});
  await act(aa,'friendRequest',{name:bb.name});await act(bb,'friendAccept',{accountId:aa.id});
  await act(aa,'post',{kind:'feed',body:'果园今天开花',clientId:randomUUID()});
  await act(aa,'post',{kind:'questions',title:'哪种荔枝先熟？',body:'',clientId:randomUUID()});
  for(const [browser,u,width] of [[a,aa,980],[b,bb,390]]){
    await browser.open();await browser.size(width,width===980?720:844,width===390);
    const [name,value]=u.cookie.split('=');
    await browser.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
    await browser.call('Page.navigate',{url:server.url+'/social-check.html'});
    await until(()=>browser.js("!!document.querySelector('.s8-nav button')"),'个人首页');
  }
  async function click(browser,name,{partial=false,selector='button'}={}){
    return until(()=>browser.js('(()=>{const el=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(e=>e.getBoundingClientRect().width&&!e.disabled&&(e.getAttribute("aria-label")==='+JSON.stringify(name)+'||e.innerText.trim()'+(partial?'.includes('+JSON.stringify(name)+')':'==='+JSON.stringify(name))+'));if(el){el.click();return true}})()'),name);
  }
  const visible=(browser,selector,words)=>until(()=>browser.js('document.querySelector('+JSON.stringify(selector)+')?.innerText.includes('+JSON.stringify(words)+')'),words);
  const text=(browser,selector,value)=>browser.js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}))})()');
  await visible(b,'[aria-label="荔枝园"]','2');await click(b,'荔枝园');await click(b,'园中事',{partial:true});
  await visible(b,'[aria-label="荔枝园"]','1');await click(b,'果园今天开花',{partial:true});
  await visible(b,'main .s8-content','发送回复');await text(b,'form textarea','我也看到花了');await click(b,'发送回复');
  await visible(b,'.s8-reply-target','我也看到花了');await click(b,'荔枝园');await click(b,'问一问',{partial:true});
  await visible(b,'.s8-content','哪种荔枝先熟');assert.equal(await b.js("document.querySelector('[aria-label=\"荔枝园\"] .s8-badge')?.textContent??''"),'');
  await click(b,'提问题');await text(b,'.s8-content form input','怎么判断荔枝成熟？');await click(b,'发布问题');
  await visible(b,'.s8-garden-detail','怎么判断荔枝成熟？');
  await click(a,'荔枝园');await click(a,'园中事',{partial:true});await click(a,'回复我的',{selector:'summary',partial:true});
  await click(a,'青荔 回复了你',{partial:true});await visible(a,'.s8-reply-target','我也看到花了');
  await click(a,'回复 青荔');await text(a,'form textarea','谢谢青荔');await click(a,'发送回复');
  await visible(a,'.s8-reply-target','谢谢青荔');
  await click(a,'荔枝园');await click(a,'我的荔枝树');await click(a,'浇水',{partial:true});
  await visible(a,'.s8-tree-card','可赠荔枝 1 颗');await text(a,'form select',bb.id);await click(a,'赠送 1 颗荔枝');
  await visible(a,'.s8-gift-row','送给 青荔');await click(b,'荔枝园');await click(b,'我的荔枝树');
  await visible(b,'.s8-gift-row','金荔 送给我');await visible(b,'.s8-tree-card','可赠荔枝 1 颗');
  assert.ok(await b.js('document.documentElement.scrollWidth<=innerWidth+1'));
  assert.ok(await b.js('document.querySelector(".s8-tree-image").naturalWidth>0'));
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  console.log('两份独立浏览器资料和真实服务通过：390/980px；双栏已读、问题发布、直达回复、指定回复、浇水与相互收发记录。');
}finally{await Promise.all([a.close(),b.close()]);await server?.close();await rm(temp,{force:true,recursive:true});}

