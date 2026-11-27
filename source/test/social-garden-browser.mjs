import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {cp,mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';
import {Browser,until} from './browser.mjs';

// Mount the shipped navigation, account API and garden module on a local origin.
// Production auth cookies and both independent browser profiles go through the real server.
const source=fileURLToPath(new URL('..',import.meta.url)),temp=await mkdtemp(join(tmpdir(),'lychee-social-ui-'));
const www=join(temp,'www'),a=new Browser(),b=new Browser();
const evidence=process.argv[2],candidate=process.argv[3]&&resolve(process.argv[3]);
const report={entry:candidate?'/mobile/':'isolated module',themes:[]};
async function capture(browser,label){
  if(!evidence)return;
  await browser.js('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))');
  const {data}=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(evidence,label+'.png'),Buffer.from(data,'base64'));
}
let server;
try{
  if(evidence)await mkdir(evidence,{recursive:true});
  if(candidate){
    const html=await readFile(join(candidate,'mobile/index.html'),'utf8');
    const asset=html.match(/src="(\/mobile\/assets-[^"]+\/client\/social-v8-garden\.js)(?:\?[^"]*)?"/)?.[1];
    assert.ok(asset,'完整构建需加载园模块');
    report.gardenJsSha256=createHash('sha256').update(await readFile(join(candidate,asset.slice(1)))).digest('hex');
  }
  if(!candidate){
  await cp(join(source,'public'),www,{recursive:true});
  await mkdir(join(www,'client'),{recursive:true});
  const files=['social-v8-api.js','social-appearance.js','social-chat.js','social-v8-garden.js','social-v8.js','social-v8.css','social-v8-garden.css'];
  for(const f of files)await cp(join(source,'client',f),join(www,'client',f));
  for(const s of ['orchard','kitty','miffy','tutu'])await cp(join(source,'client','social-corner-'+s+'.webp'),join(www,'client','social-corner-'+s+'.webp'));
  const html='<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    files.map(f=>f.endsWith('.js')?'<script defer src="/client/'+f+'"></script>':'<link rel="stylesheet" href="/client/'+f+'">').join('')+
    '<main id="root"></main><script>addEventListener("DOMContentLoaded",async()=>{const s=await (await fetch("/api/v640/workspace")).json();LycheeSocial.mount(root,s.account,{})})</script>';
  await writeFile(join(www,'social-check.html'),html);
  }
  server=await listen({dataDir:join(temp,'data'),webRoot:candidate||www});
  async function api(cookie,path,data){
    const response=await fetch(server.url+path,{method:data?'POST':'GET',headers:{origin:server.url,cookie,'content-type':'application/json'},body:data&&JSON.stringify(data)});
    const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));
    return {result,cookie:response.headers.getSetCookie()[0]?.split(';')[0]};
  }
  async function person(name){
    const password=randomUUID(),{cookie}=await api('','/api/v640/account',{mode:'register',name,password});
    return {name,password,cookie,id:(await api(cookie,'/api/v640/workspace')).result.account.id};
  }
  const aa=await person('金荔'),bb=await person('青荔');
  const act=(u,action,p)=>api(u.cookie,'/api/v8/social?accountId='+u.id,{action,...p});
  await act(aa,'friendRequest',{name:bb.name});await act(bb,'friendAccept',{accountId:aa.id});
  await act(aa,'post',{kind:'feed',body:'果园今天开花',clientId:randomUUID()});
  await act(aa,'post',{kind:'questions',title:'哪种荔枝先熟？',body:'',clientId:randomUUID()});
  const group=await act(aa,'groupCreate',{name:'周末小院',friendIds:[bb.id]});
  await act(bb,'goalSave',{title:'去公园写生',due:Date.now()+86400000});
  for(const [browser,u,width] of [[a,aa,980],[b,bb,390]]){
    await browser.open();await browser.size(width,width===980?720:844,width===390);
    if(candidate){
      await browser.call('Page.navigate',{url:server.url+'/mobile/'});
      await until(()=>browser.js("!document.querySelector('#lychee-launch')&&!!document.querySelector('form input[name=username]')"),'启动与账号登录表单');
      await browser.js('(()=>{const f=document.querySelector("form input[name=username]").form;f.elements.username.value='+JSON.stringify(u.name)+';f.elements.password.value='+JSON.stringify(u.password)+';f.requestSubmit()})()');
    }else{
      const [name,value]=u.cookie.split('=');
      await browser.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
      await browser.call('Page.navigate',{url:server.url+'/social-check.html'});
    }
    await until(()=>browser.js("!!document.querySelector('.s8-nav button')"),'个人首页');
    if(candidate){const {cookies}=await browser.call('Network.getCookies',{urls:[server.url]});assert.ok(cookies.some(c=>c.name==='__Host-lychee-account'&&c.secure&&c.httpOnly));}
  }
  async function click(browser,name,{partial=false,selector='button'}={}){
    return until(()=>browser.js('(()=>{const el=[...document.querySelectorAll('+JSON.stringify(selector)+')].find(e=>e.getBoundingClientRect().width&&!e.disabled&&(e.getAttribute("aria-label")==='+JSON.stringify(name)+'||e.innerText.trim()'+(partial?'.includes('+JSON.stringify(name)+')':'==='+JSON.stringify(name))+'));if(el){el.click();return true}})()'),name);
  }
  const visible=(browser,selector,words)=>until(()=>browser.js('document.querySelector('+JSON.stringify(selector)+')?.innerText.includes('+JSON.stringify(words)+')'),words);
  const text=(browser,selector,value)=>browser.js('(()=>{const e=document.querySelector('+JSON.stringify(selector)+');e.value='+JSON.stringify(value)+';e.dispatchEvent(new Event("input",{bubbles:true}))})()');
  await visible(b,'[aria-label="荔枝园"]','2');await click(b,'荔枝园');
  await visible(b,'.s8-garden-inbox-head','2 条未读');
  assert.deepEqual(await b.js("[...document.querySelectorAll('.s8-garden-row strong')].map(x=>x.innerText)"),['园中事','问一问','约定','荔枝树']);
  assert.equal(await b.js("document.querySelector('.s8-content').innerText.includes('原圈资料')"),false);
  await capture(b,'03-荔枝园');
  async function checkTheme(name,skin){
    await until(()=>b.js('document.querySelector(".s8").dataset.skin==='+JSON.stringify(skin)),'主题 '+name);
    const state=await b.js(`(()=>({image:getComputedStyle(document.querySelector('.s8-scroll')).backgroundImage,urls:[...new Set(performance.getEntriesByType('resource').map(r=>r.name).filter(s=>s.includes('/social-corner-')))]}))()`);
    const names=state.urls.map(u=>new URL(u).pathname.split('/').pop());
    assert.ok(state.image.includes('social-corner-'+skin+'.webp'),state.image);
    assert.deepEqual(names,['social-corner-'+skin+'.webp']);
    report.themes.push({name,skin,corner:state.image.match(/social-corner-[a-z]+\.webp/)[0],requested:names});
    await capture(b,'03-荔枝园-'+name);
  }
  if(candidate){
    await checkTheme('原味荔枝园','orchard');
    for(const [label,skin] of [['凯蒂荔枝茶会','kitty'],['米菲采荔枝','miffy'],['图图树下','tutu']]){
      await click(b,'我');await click(b,'头像与主题');
      await until(()=>b.js('(()=>{const d=document.querySelector("iframe")?.contentDocument;const btn=[...(d?.querySelectorAll(".theme-grid button")||[])].find(el=>el.innerText.trim()==='+JSON.stringify(label)+');if(btn){btn.click();return true}})()'),'主题选择 '+label);
      await b.js('performance.clearResourceTimings()');await click(b,'荔枝园');await visible(b,'.s8-garden-inbox-head','2 条未读');await checkTheme(label,skin);
    }
    await b.call('Page.reload');await until(()=>b.js('!!document.querySelector(".s8-nav")'),'保持登录');
    await click(b,'荔枝园');await visible(b,'.s8-garden-inbox-head','2 条未读');await until(()=>b.js('document.querySelector(".s8").dataset.skin==="tutu"'),'重新打开仍用图图');
    report.themePersisted=true;
  }
  await click(b,'约定',{selector:'.s8-garden-row',partial:true});await visible(b,'.s8-header','约定');
  if(candidate){
    await visible(b,'.s8-content','去公园写生');await click(b,'共同计划');await visible(b,'.s8-content','周末小院');
    assert.ok(group.result.id);report.personalAndSharedGoals=true;
  }
  await click(b,'荔枝园');
  await click(b,'园中事',{partial:true});
  await visible(b,'[aria-label="荔枝园"]','1');await click(b,'果园今天开花',{partial:true});
  await visible(b,'.s8-content','发表评论');await text(b,'form textarea','我也看到花了');await click(b,'发表评论');
  await visible(b,'.s8-reply-target','我也看到花了');await capture(b,'04-园中事与评论');await click(b,'荔枝园');await click(b,'问一问',{partial:true});
  await visible(b,'.s8-content','哪种荔枝先熟');assert.equal(await b.js("document.querySelector('[aria-label=\"荔枝园\"] .s8-badge')?.textContent??''"),'');
  assert.equal(await b.js("document.querySelectorAll('.s8-garden-post .s8-badge').length"),0);
  await capture(b,'05-问一问');
  await click(b,'发问');await text(b,'.s8-content form input','怎么判断荔枝成熟？');await click(b,'发布问题');
  await visible(b,'.s8-garden-detail','怎么判断荔枝成熟？');
  await text(b,'form textarea','先观察品种和颜色');await click(b,'发布回答');await visible(b,'.s8-reply-target','先观察品种和颜色');
  await capture(b,'06-问题与回答');
  await click(a,'荔枝园');await click(a,'园中事',{partial:true});await click(a,'回复我的',{selector:'summary',partial:true});
  await click(a,'青荔 回复了你',{partial:true});await visible(a,'.s8-reply-target','我也看到花了');
  await click(a,'回复 青荔');await text(a,'form textarea','谢谢青荔');await click(a,'发表评论');
  await visible(a,'.s8-reply-target','谢谢青荔');
  await click(a,'荔枝园');await click(a,'荔枝树',{selector:'.s8-garden-row',partial:true});await visible(a,'.s8-tree-stats strong','0颗');await click(a,'浇水',{partial:true});
  await visible(a,'.s8-tree-stats strong','1颗');await text(a,'form select',bb.id);await click(a,'赠送 1 颗荔枝');
  await visible(a,'.s8-gift-row','送给 青荔');await visible(a,'.s8-tree-stats strong','0颗');
  await click(b,'荔枝园');await click(b,'荔枝树',{selector:'.s8-garden-row',partial:true});
  await visible(b,'.s8-gift-row','金荔 送给我');await visible(b,'.s8-tree-stats strong','1颗');
  assert.ok(await b.js('document.documentElement.scrollWidth<=innerWidth+1'));
  assert.ok(await b.js('document.querySelector(".s8-tree-image").naturalWidth>0'));
  await capture(b,'09-荔枝树与赠果');
  assert.deepEqual(a.errors,[]);assert.deepEqual(b.errors,[]);
  Object.assign(report,{widths:[390,980],unread:[2,1,0],postedQuestion:true,answered:true,directedReply:true,fruit:{before:0,watered:1,giverAfter:0,receiverAfter:1},pass:true});
  if(evidence)await writeFile(join(evidence,'园内操作.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify(report));
}finally{await Promise.all([a.close(),b.close()]);await server?.close();await rm(temp,{force:true,recursive:true});}

