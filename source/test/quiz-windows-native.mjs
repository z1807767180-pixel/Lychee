// Exercise the packaged renderer on a private Win32 desktop with a local two-player garden.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {lstat,mkdir,mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';
import {Browser} from './edge.mjs';

const [exePath,outPath]=process.argv.slice(2);
if(process.platform!=='win32'||!exePath||!outPath)throw Error('Pass a packaged Windows EXE and evidence directory');
const exe=resolve(exePath),out=resolve(outPath);
await mkdir(out,{recursive:true});
const root=await mkdtemp(join(tmpdir(),'lychee-quiz-wpf-'));
const server=await listen({dataDir:join(root,'garden')});
const users=[{},{}], workspace='/api/v640/workspace';
async function api(user,path,body) {
  const res=await fetch(server.url+path,{method:body?'POST':'GET',headers:{cookie:user.cookie||'',origin:server.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));
  user.cookie=res.headers.getSetCookie()[0]?.split(';')[0]||user.cookie;return data;
}
async function until(fn,label,ms=18000) {
  const end=Date.now()+ms;let error;
  while(Date.now()<end) {
    try{const value=await fn();if(value)return value;}catch(e){error=e.message;}
    await sleep(100);
  }
  throw Error(label+' timed out '+(error||''));
}
const net=createServer();net.listen(0,'127.0.0.1');await once(net,'listening');
const port=net.address().port;await new Promise(r=>net.close(r));
const report={exeSha256:createHash('sha256').update(await readFile(exe)).digest('hex'),rounds:[]};
const host=spawn('python',['-u',fileURLToPath(new URL('resize-hwnd.py',import.meta.url)),exe,server.url,String(port)],{
  env:{...process.env,TEMP:root,TMP:root},stdio:['pipe','pipe','pipe'],windowsHide:true});
const exited=once(host,'exit'),log=createInterface({input:host.stdout})[Symbol.asyncIterator]();
let stderr='';host.stderr.on('data',bytes=>stderr=(stderr+bytes).slice(-500));
const browser=new Browser();
const click=(label)=>until(()=>browser.js(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.offsetWidth&&!x.disabled&&x.innerText.trim()===${JSON.stringify(label)});if(b){b.click();return true}})()`),label);
async function shot(name) {
  const {data}=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(out,name+'.png'),Buffer.from(data,'base64'));
}
async function inspectSource(selector) {
  const href=await browser.js(`(()=>{const a=document.querySelector(${JSON.stringify(selector)});a.click();return a.href})()`);
  const selected=await browser.js("(()=>{const d=document.querySelector('dialog.lychee-source-link[open]'),i=d?.querySelector('input');return i&&i.readOnly&&i.value.slice(i.selectionStart,i.selectionEnd)})()");
  assert.ok(href.startsWith('https://'));assert.equal(selected,href);
  await browser.js("document.querySelector('.lychee-source-link button:last-child').click()");
  return href;
}
try {
  const first=await log.next();assert.ok(!first.done,stderr);
  const native=JSON.parse(first.value);assert.ok(native.started&&native.privateDesktop!==native.inputDesktop);report.privateDesktop=true;
  const page=await until(async()=>(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(row=>row.type==='page'&&row.url.startsWith(server.url+'/windows/')),'WPF WebView2',45000);
  const ws=browser.socket=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
  ws.onmessage=({data})=>{const m=JSON.parse(data),p=browser.pending.get(m.id);if(p){browser.pending.delete(m.id);clearTimeout(p.timer);m.error?p.fail(Error(m.error.message)):p.resolve(m.result);}};
  for(const name of ['Runtime','Page','Network'])await browser.call(name+'.enable');
  for(const [i,name] of ['青荔','小桂'].entries())await api(users[i],'/api/v640/account',{mode:'register',name,password:randomUUID()});
  const garden=(await api(users[0],workspace,{action:'create',name:'好友对局验收园'})).activeGardenId;
  const code=(await api(users[0],workspace,{action:'invite',gardenId:garden})).inviteCode;
  const guest=await api(users[1],workspace,{action:'join',code});
  const quiz='/api/v7/quiz?'+new URLSearchParams({accountId:guest.account.id,gardenId:garden});
  for(const user of users)for(const n of (await api(user,workspace+'?client=windows-7.0.6')).notices)await api(user,workspace,{action:'read',noticeId:n.id});
  const [name,value]=users[0].cookie.split('=');
  await browser.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
  await browser.call('Page.navigate',{url:server.url+'/windows/workspace.html?garden='+garden});
  await until(()=>browser.js("!document.querySelector('#lychee-launch')&&!!document.querySelector('.windows-nav button')?.offsetWidth"),'启动画面关闭');
  await click('头脑王者');
  await until(()=>browser.js("document.querySelector('.qz-ranks')?.innerText.includes('小桂')"),'园内排行');
  report.version=await browser.js('document.body.dataset.clientBuild');
  assert.equal(report.version,'7.0.6');assert.ok(await browser.js('window.lycheeDesktopHost'));
  await shot('01-lobby');report.licence=await inspectSource('.qz footer a');
  await click('挑战园友');await click('挑战');
  const match=await until(async()=>(await api(users[1],quiz)).invitations?.[0]?.id,'园友收到邀请');
  await api(users[1],quiz,{action:'accept',id:match});
  for(let round=0;round<5;round++) {
    const title='第 '+(round+1)+' / 5 题';
    const prompt=await until(()=>browser.js(`document.querySelector('.qz-round')?.innerText.includes(${JSON.stringify(title)})&&document.querySelector('button.qz-option:not(:disabled)')&&document.querySelector('.qz-question h2')?.innerText`),title);
    assert.equal(await browser.js("document.querySelectorAll('.qz-option').length"),4);
    report.rounds.push(prompt);if(!round)await shot('02-question');
    await browser.js("document.querySelector('button.qz-option:not(:disabled)').click()");
    await api(users[1],quiz,{action:'answer',id:match,round,choice:0});
    if(!round) {
      await until(()=>browser.js("!!document.querySelector('.qz-feedback a')"),'揭晓出处');
      report.questionSource=await inspectSource('.qz-feedback a');
    }
  }
  await until(()=>browser.js("!!document.querySelector('.qz-result-art')"),'五题结算');
  report.result=await browser.js("document.querySelector('.qz h2').innerText");await shot('03-result');
  await click('再来一局');await until(()=>browser.js("!!document.querySelector('.qz-invite')"),'自愿再战');
  const pending=(await api(users[1],quiz)).invitations;
  assert.ok(pending.some(q=>q.id!==match&&q.status==='pending'));
  report.pass=true;console.log(JSON.stringify(report));
} catch(error) {
  report.error=error.message;
  if(browser.socket?.readyState===1)report.ui=await browser.js('document.body.innerText.slice(-1100)').catch(()=>undefined);
  console.error(report);process.exitCode=1;
} finally {
  browser.socket?.close();host.stdin.end();await exited;await server.close();
  await writeFile(join(out,'game.json'),JSON.stringify(report,null,2));
  const actual=await realpath(root);
  assert.equal(dirname(actual),await realpath(tmpdir()));
  assert.match(basename(actual),/^lychee-quiz-wpf-[A-Za-z0-9]{6}$/);
  assert.ok(!(await lstat(root)).isSymbolicLink());
  await rm(actual,{recursive:true,force:true,maxRetries:12,retryDelay:180});
}
