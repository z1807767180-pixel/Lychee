// Drive the real Android friends WebView with two disposable players and loopback HTTPS.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {readFile, writeFile, mkdir, mkdtemp} from 'node:fs/promises';
import {createServer} from 'node:https';
import {join, resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp, serveRequest} from '../server/index.mjs';
import {Browser} from './edge.mjs';

const [folderArg, webArg, evidenceArg, legacyProfile] = process.argv.slice(2);
if (!folderArg || !webArg || !evidenceArg) throw Error('Pass QA build, prepared mobile directory and evidence directory');
if (legacyProfile && !['missing-timeout', 'missing-controller'].includes(legacyProfile)) throw Error('Unknown WebView profile');
const folder = resolve(folderArg), evidence = resolve(evidenceArg);
await mkdir(evidence, {recursive: true});
const pkg = 'dev.lychee.quizqa', origin = 'https://127.0.0.1:18443';
const adb = (...args) => execFileSync('adb', args, {encoding:'utf8',timeout:30000}).trim();
const webview = adb('shell','dumpsys','webviewupdate').split('\n').find(line=>line.includes('Current WebView package'));
const report = {platform:adb('shell','getprop','ro.build.version.release'),webview,rounds:[]};
const app = await createApp({origin, webRoot:resolve(webArg), dataDir:await mkdtemp(join(folder,'garden-'))});
const quizResponses = [];
const capabilityResponses = [];
const launchPath = '/mobile/assets-' + (await readFile(join(webArg,'mobile/version.txt'),'utf8')).trim() + '/launch/start.js';
const launch = await readFile(join(webArg,launchPath.slice(1)));
const server = createServer({key:await readFile(join(folder,'server.key')),cert:await readFile(join(folder,'server.pem'))}, (req,res) => {
  const pathname = new URL(req.url,origin).pathname;
  if (legacyProfile && pathname === launchPath) {
    const disable = "if(window.AbortSignal)Object.defineProperty(window.AbortSignal,'timeout',{value:undefined,configurable:true});" +
      (legacyProfile === 'missing-controller' ? "Object.defineProperty(window,'AbortController',{value:undefined,configurable:true});" : '');
    res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'no-store'});
    res.write(disable+'\n');
    res.end(launch);
    return;
  }
  if (pathname === '/api/client-capabilities') res.on('finish',()=>capabilityResponses.push(res.statusCode));
  if (req.url === '/qa-update/current.json') {
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({version:'7.0.2',note:'测试',sha256:'0'.repeat(64)}));
    return;
  }
  if (new URL(req.url,origin).pathname === '/api/v7/quiz') {
    res.on('finish',() => quizResponses.push([req.method,res.statusCode]));
  }
  serveRequest(app,req,res,origin);
});
const browser = new Browser();
async function api(user,path,body) {
  const response = await app.handle(new Request(origin+path,{method:body?'POST':'GET',
    headers:{cookie:user.cookie||'',origin,'content-type':'application/json'},body:body&&JSON.stringify(body)}));
  const data = await response.json();
  assert.equal(response.status,200,JSON.stringify(data));
  user.cookie = response.headers.getSetCookie()[0]?.split(';')[0]||user.cookie;
  return data;
}
async function until(read,label,ms=25000) {
  const end=Date.now()+ms; let last;
  while (Date.now()<end) {
    try { const value=await read(); if(value)return value; } catch(e) { last=e.message; }
    await delay(125);
  }
  throw Error(label+' timed out '+(last||''));
}
const click = (label) => until(() => browser.js(`(()=>{const label=${JSON.stringify(label)};const b=[...document.querySelectorAll('button')].find(x=>x.offsetWidth&&!x.disabled&&(x.innerText.trim().split('\\n')[0]===label||x.getAttribute('aria-label')===label));if(b){b.scrollIntoView({block:'center'});b.click();return true}})()`),label);
async function screenshot(name) {
  await writeFile(join(evidence,name+'.png'),execFileSync('adb',['exec-out','screencap','-p'],{maxBuffer:16*1024*1024}));
}
try {
  server.listen(18443,'127.0.0.1'); await once(server,'listening');
  const apk = join(folder,'quiz-qa.apk');
  report.apkSha256=createHash('sha256').update(await readFile(apk)).digest('hex');
  assert.match(adb('install','-r',apk),/Success/);
  assert.match(adb('shell','pm','clear',pkg),/Success/);
  adb('reverse','tcp:18443','tcp:18443');
  adb('shell','am','start','-W','-n',pkg+'/dev.lychee.pilot.MainActivity');
  const pid=adb('shell','pidof','-s',pkg);
  adb('forward','tcp:19222','localabstract:webview_devtools_remote_'+pid);
  const page=await until(async()=> (await (await fetch('http://127.0.0.1:19222/json/list')).json()).find(row=>row.type==='page'&&row.url.startsWith(origin+'/mobile/')),'Android WebView startup',60000);
  const ws=browser.socket=new WebSocket(page.webSocketDebuggerUrl); await once(ws,'open');
  ws.onmessage=({data})=>{
    const m=JSON.parse(data), pending=browser.pending.get(m.id);
    if (pending) {browser.pending.delete(m.id);clearTimeout(pending.timer);m.error?pending.fail(Error(m.error.message)):pending.resolve(m.result);}
    if (m.method==='Runtime.exceptionThrown') browser.errors.push(m.params.exceptionDetails.text);
  };
  for (const domain of ['Network','Runtime','Page']) await browser.call(domain+'.enable');
  await until(()=>browser.js("document.body.innerText.includes('注册新账号') || document.body.innerText.includes('登录荔枝园')"),'friends sign-in');
  assert.ok(await browser.js('!!window.Capacitor && navigator.userAgent.includes("Android")'));
  if (legacyProfile) {
    report.profile = legacyProfile;
    report.sessionStartup = await browser.js("({timeout: typeof window.AbortSignal?.timeout, controller:typeof window.AbortController,appVersion:document.body.dataset.clientBuild})");
    assert.equal(report.sessionStartup.timeout,'undefined');
    assert.equal(report.sessionStartup.controller,legacyProfile==='missing-controller'?'undefined':'function');
    assert.ok(capabilityResponses.includes(200));
    await screenshot('00-cold-launch-sign-in');
  }
  const player={},friend={},workspace='/api/v640/workspace';
  for (const [user,name] of [[player,'青荔'],[friend,'小桂']]) await api(user,'/api/v640/account',{mode:'register',name,password:randomUUID()});
  const garden=(await api(player,workspace,{action:'create',name:'安卓问答验收园'})).activeGardenId;
  const code=(await api(player,workspace,{action:'invite',gardenId:garden})).inviteCode;
  const joined=await api(friend,workspace,{action:'join',code});
  for (const user of [player,friend]) for (const notice of (await api(user,workspace+'?client=mobile-web')).notices) await api(user,workspace,{action:'read',noticeId:notice.id});
  const [name,value]=player.cookie.split('=');
  assert.ok((await browser.call('Network.setCookie',{name,value,url:origin+'/',path:'/',secure:true,httpOnly:true})).success);
  await browser.call('Page.navigate',{url:origin+'/mobile/?garden='+garden});
  await until(()=>browser.js("!!document.querySelector('.ga-circle-list')?.offsetWidth"),'garden landing');
  if (legacyProfile) {
    await screenshot('01-local-garden');
    report.gardenVisible=true;
    report.capabilityHttpStatuses=[...capabilityResponses];
    report.launchSha256=createHash('sha256').update(launch).digest('hex');
  }
  if (!await browser.js("[...document.querySelectorAll('button')].some(x=>x.offsetWidth&&x.innerText.trim()==='头脑王者')")) await click('工具箱');
  await click('头脑王者'); await until(()=>browser.js("document.querySelector('.qz-ranks')?.innerText.includes('小桂')"),'friend rank');
  await screenshot('01-lobby');
  await click('挑战园友'); await click('挑战');
  const quiz='/api/v7/quiz?'+new URLSearchParams({accountId:joined.account.id,gardenId:garden});
  const match=await until(async()=>(await api(friend,quiz)).invitations?.[0]?.id,'incoming invitation');
  await api(friend,quiz,{action:'accept',id:match});
  for(let round=0;round<5;round++) {
    const label='第 '+(round+1)+' / 5 题';
    const prompt=await until(()=>browser.js(`document.querySelector('.qz-round')?.innerText.includes(${JSON.stringify(label)})&&document.querySelector('button.qz-option:not(:disabled)')&&document.querySelector('.qz-question h2')?.innerText`),label);
    assert.equal(await browser.js("document.querySelectorAll('.qz-option').length"),4);
    assert.ok(await browser.js('document.documentElement.scrollWidth<=innerWidth+1'));
    report.rounds.push(prompt);
    if(!round) await screenshot('02-question');
    await browser.js("document.querySelector('button.qz-option:not(:disabled)').click()");
    await api(friend,quiz,{action:'answer',id:match,round,choice:0});
  }
  await until(()=>browser.js("!!document.querySelector('.qz-result-art')"),'five-question settlement');
  await screenshot('03-result');
  await click('再来一局');
  const rematch=await until(async()=>(await api(friend,quiz)).invitations?.find(q=>q.id!==match&&q.status==='pending'),'voluntary rematch');
  assert.ok(rematch);
  assert.deepEqual(browser.errors,[]);
  for(const method of ['GET','POST'])assert.ok(quizResponses.some(([m,status])=>m===method&&status===200),'Android WebView '+method);
  assert.ok(quizResponses.every(([,status])=>status<400));
  report.webviewQuizRequests=quizResponses.length; report.pass=true;
} catch(error) {
  report.error=error.message;
  if(browser.socket?.readyState===1) report.screen=await browser.js('document.body.innerText.slice(-1200)').catch(()=>undefined);
  await screenshot('failure').catch(()=>{});
  console.error(report); process.exitCode=1;
} finally {
  browser.socket?.close(); server.closeAllConnections();
  for (const [direction,port] of [['forward','tcp:19222'],['reverse','tcp:18443']]) {
    try {adb(direction,'--remove',port);} catch {}
  }
  if(server.listening) await new Promise(done=>server.close(done));
  await app.close(); await writeFile(join(evidence,'game.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
}
