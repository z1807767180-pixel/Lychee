import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
import {once} from 'node:events';
import {copyFile,mkdir,mkdtemp,readFile,writeFile,rm,realpath,lstat,stat} from 'node:fs/promises';
import {createServer,connect as connectTcp} from 'node:net';
import {createServer as createHttpServer} from 'node:http';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';
import {Browser} from './edge.mjs';

const [packageDir,evidenceDir,...flags]=process.argv.slice(2);
const websiteOnly=flags.includes('--website-only'),fromDir=flags.find(value=>value!=='--website-only');
if(!packageDir||!evidenceDir||process.platform!=='win32')throw Error('Pass final Windows package folder, evidence folder, optional older source package folder.');
const base=resolve(packageDir),out=resolve(evidenceDir),origin='https://lychee-link-check.onrender.com';
const build=JSON.parse(await readFile(join(base,'stable.json'))),wanted=build.assets.find(a=>a.kind==='exe').sha256;
const prior=fromDir&&JSON.parse(await readFile(join(fromDir,'stable.json')));
const digest=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
const work=await mkdtemp(join(tmpdir(),'lychee-social-wpf-')),exe=join(work,'Lychee.exe'),profile=join(work,'profile'),tmp=join(work,'tmp');
await mkdir(out,{recursive:true});await mkdir(tmp);await mkdir(profile);
await copyFile(join(fromDir||base,'Lychee.exe'),exe);
const report={from:prior?.version??build.version,to:build.version,startHash:await digest(exe),mode:prior?(websiteOnly?'public-upgrade-website-only':'public-upgrade'):websiteOnly?'current-website-only':'native-social',pass:false};
assert.equal(report.startHash,prior?prior.assets.find(a=>a.kind==='exe').sha256:wanted);
let proxy;
if(websiteOnly){
  const host=new URL(origin).hostname;
  report.connections=[];
  proxy=createHttpServer((_req,res)=>res.writeHead(403).end());
  proxy.on('connect',(req,client,head)=>{
    const allowed=req.url===host+':443';
    report.connections.push({host:req.url,allowed});
    if(!allowed){client.end('HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n');return;}
    const upstream=connectTcp(443,host,()=>{
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if(head.length)upstream.write(head);
      client.pipe(upstream).pipe(client);
    });
    for(const [socket,peer] of [[upstream,client],[client,upstream]]){
      socket.on('error',()=>peer.destroy());
      socket.on('close',()=>peer.destroy());
    }
  });
  proxy.listen(0,'127.0.0.1');await once(proxy,'listening');
  await writeFile(exe+'.config','<configuration><system.net><defaultProxy enabled="true"><proxy usesystemdefault="false" bypassonlocal="false" proxyaddress="http://127.0.0.1:'+proxy.address().port+'"/></defaultProxy></system.net></configuration>');
}
const fixture=await listen({dataDir:join(work,'accounts'),webRoot:await stat(join(base,'site')).then(()=>join(base,'site'),()=>undefined)});
async function api(u,path,body){
  const r=await fetch(fixture.url+path,{method:body?'POST':'GET',headers:{cookie:u.cookie??'',origin:fixture.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const data=await r.json();assert.equal(r.status,200,JSON.stringify(data));
  u.cookie=r.headers.getSetCookie()[0]?.split(';')[0]||u.cookie;return data;
}
const aa={name:'知荔'},bb={name:'小桂'},cc={name:'青荔'};
for(const user of [aa,bb,cc]){
  user.password=randomUUID();await api(user,'/api/v640/account',{mode:'register',name:user.name,password:user.password});
  user.id=(await api(user,'/api/v640/workspace')).account.id;
  for(const v of new Set([build.version,prior?.version].filter(Boolean))){
    for(const n of (await api(user,'/api/v640/workspace?client=windows-'+v)).notices)await api(user,'/api/v640/workspace',{action:'read',noticeId:n.id});
  }
}
const act=(u,action,data)=>api(u,'/api/v8/social?accountId='+u.id,{action,...data});
for(const u of [aa,cc]){await act(u,'friendRequest',{accountId:bb.id});await act(bb,'friendAccept',{accountId:u.id});}
const first=(await act(aa,'groupCreate',{name:'桂味朋友群',friendIds:[bb.id]})).id;
await act(cc,'groupCreate',{name:'糯米糍朋友群',friendIds:[bb.id]});
await act(aa,'message',{groupId:first,clientId:randomUUID(),body:'周末一起吃荔枝'});
await act(cc,'message',{friendId:bb.id,clientId:randomUUID(),body:'我带一篮过来'});
await act(bb,'goalSave',{title:'周末荔枝约定',due:Date.now()+86400000});
assert.equal((await api(bb,'/api/v640/workspace')).activeGardenId,null);
const tcp=createServer();tcp.listen(0,'127.0.0.1');await once(tcp,'listening');const port=tcp.address().port;await new Promise(r=>tcp.close(r));
const host=spawn('python',['-u',fileURLToPath(new URL('resize-hwnd.py',import.meta.url)),exe,'isolated-public-update',String(port)],{
  windowsHide:true,env:{...process.env,TEMP:tmp,TMP:tmp,WEBVIEW2_USER_DATA_FOLDER:profile},stdio:['pipe','pipe','pipe']});
const exited=once(host,'exit'),log=createInterface({input:host.stdout})[Symbol.asyncIterator]();
let errors='',browser,requests=0;host.stderr.on('data',b=>errors=(errors+b).slice(-700));
async function until(fn,label,ms=50000){
  const end=Date.now()+ms;let last;
  while(Date.now()<end){try{const r=await fn();if(r)return r;}catch(e){last=e.message;}await sleep(120);}
  throw Error(label+' 超时 '+(last??errors));
}
async function connect(before){
  const page=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(p=>p.type==='page'&&p.url.startsWith(origin+'/windows/')&&p.id!==before),'WPF WebView2');
  const b=new Browser(),socket=b.socket=new WebSocket(page.webSocketDebuggerUrl);
  await once(socket,'open');
  socket.onmessage=async({data})=>{
    const m=JSON.parse(data),reply=b.pending.get(m.id);
    if(reply){b.pending.delete(m.id);clearTimeout(reply.timer);m.error?reply.fail(Error(m.error.message)):reply.resolve(m.result);return;}
    if(m.method!=='Fetch.requestPaused')return;
    const r=m.params;
    try{
      const u=new URL(r.request.url);assert.equal(u.origin,origin);assert.match(u.pathname,/^\/(?:api\/|g\/)/);
      const {cookies}=await b.call('Network.getCookies',{urls:[u.href]});
      const headers={origin:fixture.url,'content-type':'application/json',cookie:cookies.map(c=>c.name+'='+c.value).join('; ')};
      const response=await fetch(fixture.url+u.pathname+u.search,{method:r.request.method,headers,body:r.request.method==='POST'?r.request.postData:undefined});
      requests++;
      await b.call('Fetch.fulfillRequest',{requestId:r.requestId,responseCode:response.status,
        responseHeaders:[{name:'Content-Type',value:response.headers.get('content-type')||'application/json'},...response.headers.getSetCookie().map(value=>({name:'Set-Cookie',value}))],
        body:Buffer.from(await response.arrayBuffer()).toString('base64')});
    }catch{await b.call('Fetch.failRequest',{requestId:r.requestId,errorReason:'Failed'}).catch(()=>{});}
  };
  for(const domain of ['Page','Runtime','Network'])await b.call(domain+'.enable');
  await b.call('Fetch.enable',{patterns:[{urlPattern:origin+'/api/*'},{urlPattern:origin+'/g/*'}]});
  browser=b;return page.id;
}
async function click(label){
  const point=await until(()=>browser.js('(()=>{const b=[...document.querySelectorAll("button")].find(e=>e.offsetWidth&&!e.disabled&&(e.innerText.trim()==='+JSON.stringify(label)+'||e.getAttribute("aria-label")==='+JSON.stringify(label)+'));if(!b)return; b.scrollIntoView({block:"nearest"});const r=b.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;return b.contains(document.elementFromPoint(x,y))?{x,y}:null})()'),label);
  for(const type of ['mousePressed','mouseReleased'])await browser.call('Input.dispatchMouseEvent',{...point,type,button:'left',clickCount:1});
}
const state=()=>browser.js("document.querySelector('[data-windows-update]:not([hidden])')?.dataset.updateState");
const shot=async name=>{if(!websiteOnly&&!prior)await writeFile(join(out,name+'.png'),Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'));};
try{
  const firstLine=await log.next();assert.ok(!firstLine.done,errors);
  const native=JSON.parse(firstLine.value);assert.ok(native.started&&native.privateDesktop!==native.inputDesktop);
  report.privateDesktop=true;
  const target=await connect();await browser.call('Page.reload');
  await until(()=>browser.js("!document.querySelector('#lychee-launch')&&!!document.querySelector('.garden-access input[name=username]')"),'启动画面消失、原生登录表单');
  await browser.js('(()=>{const f=document.querySelector(".garden-access form");f.elements.username.value='+JSON.stringify(bb.name)+';f.elements.password.value='+JSON.stringify(bb.password)+'})()');
  await click('登录');
  await until(async()=>(await browser.call('Network.getCookies',{urls:[origin]})).cookies.some(c=>c.name==='__Host-lychee-account'&&c.secure&&c.httpOnly),'登录会话已由浏览器保存');
  if(prior){
    await until(async()=>await state()==='available','旧正式版发现新版',120000);
    report.offer=await browser.js("document.querySelector('[data-windows-update] strong').innerText");
    assert.ok(report.offer.endsWith(build.version));
    await browser.js("localStorage.setItem('lychee-social-upgrade-marker','keep')");
    await click('立即更新');await until(async()=>await digest(exe)===wanted,'原地替换正式 EXE',180000);
    browser.socket.close();await connect(target);await browser.call('Page.reload');
    assert.equal(await browser.js("localStorage.getItem('lychee-social-upgrade-marker')"),'keep');
  }
  await until(()=>browser.js("!document.querySelector('#lychee-launch')&&document.querySelector('.s8-content')?.innerText.includes('周末荔枝约定')"),'B 无默认群直接到自己的首页');
  const before=await browser.js("({time:performance.timeOrigin,path:location.pathname,version:document.body.dataset.clientBuild,home:document.querySelector('.s8-content').innerText,host:window.lycheeDesktopHost})");
  assert.ok(before.host);assert.equal(before.version,build.version);assert.ok(before.home.includes('周末荔枝约定'));
  assert.ok(before.home.includes('桂味朋友群')&&before.home.includes('糯米糍朋友群')&&before.home.includes('我带一篮过来'));
  assert.ok(!before.home.includes('常用群'));report.singleList=true;
  await shot('01-统一首页');
  await click('桂味朋友群');await until(()=>browser.js("document.querySelector('.s8-msg')?.innerText.includes('周末一起吃荔枝')"),'原群消息');
  await shot('02-群聊');await click('‹ 返回');
  await until(()=>browser.js("document.querySelector('.s8-content')?.innerText.includes('周末荔枝约定')"),'返回个人首页');
  assert.equal(await browser.js('performance.timeOrigin'),before.time);report.returnedWithoutPageReload=true;
  if(build.version==='8.1.1'){
    await click('工具箱');
    const tools=[['交给命运','.v7-wheel'],['照记饮食','.diet-v7'],['提醒事项','.s81-task-actions'],['番茄钟','.focus-dial'],['记账本','.ledger-header'],['头脑王者','[data-game="quiz"]'],['五子棋','[data-game="gomoku"]'],['海龟汤','[data-game="soup"]'],['脑筋急转弯','[data-game="riddles"]'],['AI 助手','.s81-chat-compose'],['AI 生图','.s81-atelier']];
    report.toolScreens=[];
    for(const [title,selector] of tools){
      await click(title);
      await until(()=>browser.js('!!document.querySelector('+JSON.stringify(selector)+')'),title+' 的功能组件',12000);
      report.toolScreens.push(title);await click('‹ 返回');
    }
    await click('我');await click('头像与主题');
    await until(()=>browser.js("document.querySelectorAll('.s8-theme-picks button img').length===4 && [...document.querySelectorAll('.s8-theme-picks button img')].every(i=>i.complete&&i.naturalWidth>0)"),'四种主题插画加载');
    report.appearance=true;await click('‹ 返回');
  }else await click('我');
  await click('设置');
  report.settingsVersion=await until(()=>browser.js("document.querySelector('.settings-version')?.innerText"),'设置中的版本');
  assert.ok(report.settingsVersion.includes('W'+build.version));
  await click('检查更新');await until(async()=>await state()==='current','正式 .NET 更新器对比公开清单',130000);
  report.settingsResult=await browser.js("document.querySelector('[data-windows-update]').innerText");
  assert.match(report.settingsResult,/已是最新版本/);await shot('03-设置更新');
  report.profile=(await stat(join(profile,'EBWebView','Default'))).isDirectory();
  const {cookies}=await browser.call('Network.getCookies',{urls:[origin]});
  report.persistentAccountCookie=cookies.some(c=>c.name==='__Host-lychee-account'&&c.httpOnly&&c.secure&&!c.session);
  assert.ok(report.profile&&report.persistentAccountCookie);report.artifactSha256=await digest(exe);assert.equal(report.artifactSha256,wanted);
  if(websiteOnly){
    assert.ok(report.connections.some(c=>!c.allowed&&c.host==='raw.githubusercontent.com:443'));
    assert.ok(report.connections.some(c=>c.allowed&&c.host===new URL(origin).hostname+':443'));
  }
  report.localAccountRequests=requests;report.pass=true;
}catch(error){report.error=error.message;report.visible=await browser?.js('document.body.innerText.slice(-900)').catch(()=>null);process.exitCode=1;}
finally{
  if(browser?.socket?.readyState===1){await browser.js("window.chrome.webview.postMessage('window:close')").catch(()=>{});browser.socket.close();}
  host.stdin.end();await exited;await fixture.close();proxy?.close();
  await writeFile(join(out,report.mode+'.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  const actual=await realpath(work);assert.equal(dirname(actual),await realpath(tmpdir()));assert.match(basename(actual),/^lychee-social-wpf-[A-Za-z0-9]{6}$/);
  assert.ok(!(await lstat(actual)).isSymbolicLink());await rm(actual,{force:true,recursive:true,maxRetries:20,retryDelay:180});
}

