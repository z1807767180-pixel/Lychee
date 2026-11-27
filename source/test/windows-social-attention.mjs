import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';

const stage=resolve(process.argv[2]), username='提醒接收者',pass=randomUUID();
const temp=await mkdtemp(join(tmpdir(),'lychee-notification-window-'));
const app=await listen({dataDir:temp,webRoot:join(stage,'site')});
const portProbe=createServer();portProbe.listen(0,'127.0.0.1');await once(portProbe,'listening');
const port=portProbe.address().port;await new Promise(ok=>portProbe.close(ok));
const probe=spawn('python',['-u',fileURLToPath(new URL('./notification-hwnd.py',import.meta.url)),
  join(stage,'Lychee.exe'),app.url,String(port)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const reader=createInterface({input:probe.stdout})[Symbol.asyncIterator](),exited=once(probe,'exit');
let stderr='',socket,serial=0;
const pending=new Map(),report={};
probe.stderr.on('data',b=>stderr=(stderr+b).slice(-800));
async function next(){const row=await reader.next();if(row.done)throw Error('Native probe exited: '+stderr);return JSON.parse(row.value);}
async function until(read,label,ms=30000){const end=Date.now()+ms;let last;while(Date.now()<end){try{const r=await read();if(r)return r;}catch(e){last=e;}await sleep(120);}throw Error(label+': '+(last?.message||'timeout'));}
async function call(method,params={}){
  const id=++serial;
  return new Promise((ok,no)=>{const timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timeout'));},7000);
    pending.set(id,{ok,no,timer});socket.send(JSON.stringify({id,method,params}));});
}
async function js(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;}
function session(){
  let cookie='';
  return async(path,body)=>{
    const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{cookie,origin:app.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
    for(const line of r.headers.getSetCookie())if(line.startsWith('__Host-lychee-account='))cookie=line.split(';')[0];
    assert.equal(r.status,200,path);return r.json();
  };
}

const evidence=resolve(process.argv[3]),expectBroken=process.argv[4]==='--baseline';
async function command(name){probe.stdin.write(name+'\n');return next();}
try{
  const {started,privateDesktop,inputDesktop}=await next();assert.ok(started);assert.notEqual(inputDesktop,privateDesktop);
  const target=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.url===app.url+'/windows/workspace.html'),'WebView');
  socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
  socket.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;clearTimeout(p.timer);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);};
  await call('Runtime.enable');await call('Page.enable');
  const receiver=session(), sender=session();
  const register=async(client,name)=>{
    await client('/api/v640/account',{mode:'register',name,password:pass});
    const w=await client('/api/v640/workspace?client=windows-8.0.0');
    for(const n of w.notices)await client('/api/v640/workspace',{action:'read',noticeId:n.id});
    return '/api/v8/social?accountId='+w.account.id;
  };
  const mine=await register(receiver,username),theirs=await register(sender,'提醒发送者');
  await sender(theirs,{action:'friendRequest',name:username});
  await receiver(mine,{action:'friendAccept',accountId:new URLSearchParams(theirs.split('?')[1]).get('accountId')});
  const garden=(await sender(theirs,{action:'groupCreate',name:'提醒验收群',friendIds:[new URLSearchParams(mine.split('?')[1]).get('accountId')]})).id;
  const creds=JSON.stringify({mode:'login',name:username,password:pass});
  assert.equal(await js('fetch("/api/v640/account",{method:"POST",headers:{"Content-Type":"application/json"},body:'+JSON.stringify(creds)+'}).then(r=>r.status)'),200);
  await call('Page.navigate',{url:app.url+'/windows/workspace.html'});
  await until(()=>js("!document.querySelector('#lychee-launch')&&!!document.querySelector('.s8-nav')"),'统一首页');
  await js("window.__testNative=[];chrome.webview.addEventListener('message',e=>window.__testNative.push(e.data));true");
  probe.stdin.write('probe\n');
  const active=await command('main-window');assert.ok(active.active&&!active.minimized,JSON.stringify(active));
  await js("chrome.webview.postMessage('notify:state');true");
  await until(()=>js("window.__testNative.includes('notify:active')"),'WPF 前台');
  await js("document.querySelector('button[aria-label=提醒验收群]').click();true");
  await until(()=>js("document.querySelector('.s8-header h1')?.textContent==='提醒验收群'"),'已打开的群');
  const inactive=await command('other-window');assert.ok(inactive.active&&!inactive.minimized,JSON.stringify(inactive));
  await until(()=>js("window.__testNative.at(-1)==='notify:inactive'||window.__testNative.slice(-2).includes('notify:inactive')"),'另一个真实窗口取得前台');
  const post=body=>sender(theirs,{action:'message',groupId:garden,body,clientId:randomUUID()});
  const unread=async()=>(await receiver(mine)).unread.groups;
  const flashed=()=>js("window.__testNative.filter(x=>x==='notify:flash-call:2:3').length");
  await post('另一个窗口前台时收到第一条');
  await post('另一个窗口前台时收到第二条');
  let waited=0,current,flash;
  do{await sleep(1200);waited+=1200;current=await unread();flash=await flashed();}while(waited<17000&&(expectBroken?current!==0:!flash));
  report.otherWindowActive=inactive.active;report.lycheeRemainedUnminimized=!inactive.minimized;report.unreadAfterOtherWindow=current;report.backgroundFlashCalls=flash;
  if(expectBroken){assert.equal(current,0);assert.equal(flash,0);report.regressionReproduced=true;}
  else{
    assert.equal(current,2);assert.equal(flash,1);
    assert.ok((await command('main-window')).active);
    await until(async()=>await unread()===0,'返回可见群清除未读');
    await until(()=>js("window.__testNative.includes('notify:flash-call:0:0')"),'原生清除高亮');
    await post('当前可见群不打扰');
    await until(async()=>await unread()===0,'前台正常读取消息');
    assert.equal(await flashed(),1);
    await js("document.querySelector('.lychee-window-controls [data-command=minimize]').click();true");
    await until(async()=>(await command('minimized')).minimized,'实际最小化');
    await post('最小化时收到');
    const peerId=new URLSearchParams(mine.split('?')[1]).get('accountId');
    await sender(theirs,{action:'message',friendId:peerId,body:'还有私信',clientId:randomUUID()});
    await until(async()=>await flashed()===2,'后台原生定时器再次唤起闪烁');
    const counts=(await receiver(mine)).unread;assert.equal(counts.groups,1);assert.equal(counts.private,1);
    report.minimized={groups:counts.groups,private:counts.private,nativePoll:await js("window.__testNative.includes('notify:poll')")};
    await command('restore');await until(async()=>await unread()===0,'从最小化恢复到群');
    assert.equal((await receiver(mine)).unread.private,1);
    report.groupReadOnReturn=true;report.privateRemainedUnread=true;
  }
  report.nativeFlashEvents=await js("window.__testNative.filter(v=>typeof v==='string'&&v.startsWith('notify:flash-call'))");
  report.pass=true;
}catch(e){report.error=e.message;report.native=await js('window.__testNative').catch(()=>null);process.exitCode=1;}
finally{
  socket?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(!probe.stdin.destroyed)probe.stdin.end('end\n');
  await exited;await app.close();await writeFile(evidence,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await rm(temp,{recursive:true,force:true});
}

