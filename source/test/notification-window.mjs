import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
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
try{
  const {started,privateDesktop,inputDesktop}=await next();assert.ok(started);assert.notEqual(inputDesktop,privateDesktop);
  const target=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.url===app.url+'/windows/workspace.html'),'WebView');
  socket=new WebSocket(target.webSocketDebuggerUrl);await once(socket,'open');
  socket.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
  await call('Runtime.enable');await call('Page.enable');
  const receiver=session(), sender=session();
  await receiver('/api/v640/account',{mode:'register',name:username,password:pass});
  const garden=(await receiver('/api/v640/workspace',{action:'create',name:'通知验收园'})).activeGardenId;
  const notices='/api/v640/workspace?client=windows-7.0.5';
  for(const n of (await receiver(notices)).notices)await receiver(notices,{action:'read',noticeId:n.id});
  const code=(await receiver('/api/v640/workspace',{action:'invite',gardenId:garden})).inviteCode;
  await sender('/api/v640/account',{mode:'register',name:'提醒发送者',password:pass});
  await sender('/api/v640/workspace',{action:'join',code});
  const credentials=JSON.stringify({mode:'login',name:username,password:pass});
  assert.equal(await js(`fetch('/api/v640/account',{method:'POST',headers:{'Content-Type':'application/json'},body:${JSON.stringify(credentials)}}).then(r=>r.status)`),200);
  await call('Page.navigate',{url:app.url+'/windows/workspace.html'});
  await until(()=>js("document.querySelector('.lychee-window-controls [data-command=minimize]') && !!document.querySelector('.bottom')"),'normal application');
  await js("window.__notifyCheck={native:[],errors:[]};chrome.webview.addEventListener('message',e=>window.__notifyCheck.native.push(e.data));window.addEventListener('error',e=>window.__notifyCheck.errors.push(e.message));true");
  probe.stdin.write('probe\n');
  await js("document.querySelector('.lychee-window-controls [data-command=minimize]').click()");
  await until(async()=>{probe.stdin.write('minimized\n');return (await next()).minimized;},'native minimize');
  const note={type:'note',name:'提醒发送者',avatar:1,key:randomUUID(),body:'本地通知验收'};
  const prefix='/g/'+garden+'/api/';
  await sender(prefix+'camp',note);
  const flashCount=()=>js("window.__notifyCheck.native.filter(m=>m==='notify:flash-call:2:3').length");
  await until(async()=>await flashCount()===1,'native taskbar flashes three times');
  await sender(prefix+'camp',{...note,key:randomUUID(),body:'第二次后台来信'});
  await until(async()=>(await receiver(prefix+'phone?v61=chat-inbox')).rooms[0]?.unread===2,'two unread while minimized');
  await sleep(8500);
  probe.stdin.write('popup\n');Object.assign(report,await next());
  assert.equal(report.popup,false);assert.equal(report.minimized,true);
  assert.equal(await flashCount(),1,'same inactive window does not keep flashing');
  assert.equal(await js("!!document.querySelector('.v61-toast')"),false);
  probe.stdin.write('restore\n');assert.equal((await next()).restored,true);
  await until(()=>js("window.__notifyCheck.native.includes('notify:flash-call:0:0')"),'activation clears highlight');
  await until(()=>js("[...document.querySelectorAll('.mobile-chat-badge')].some(b=>b.getBoundingClientRect().width>0&&b.querySelector('em')?.textContent==='2')"),'badge survives activation');
  await js("document.querySelector('.mobile-chat-badge').click()");
  await until(async()=>(await receiver(prefix+'phone?v61=chat-inbox')).rooms.length===0,'open visible room reads both');
  await sender(prefix+'camp',{...note,key:randomUUID(),body:'已在本聊天内'});
  await until(()=>js("document.querySelector('[data-chat-room]')?.textContent.includes('已在本聊天内')"),'foreground chat renders');
  await until(async()=>(await receiver(prefix+'phone?v61=chat-inbox')).rooms.length===0,'foreground chat reads new content');
  assert.equal(await js("!!document.querySelector('.v61-toast')"),false);
  assert.equal(await flashCount(),1);
  Object.assign(report,{flashRequests:1,flashesPerRequest:3,stoppedOnActivation:true,unreadBeforeOpen:2,activeChatQuiet:true});
  await js("document.querySelector('.lychee-window-controls [data-command=close]').click();true").catch(()=>{});
  await until(async()=>{try{await fetch('http://127.0.0.1:'+port+'/json/list');return false;}catch{return true;}},'window exit');
  report.closed=true;
  await sender(prefix+'camp',{...note,key:randomUUID(),body:'退出期间'});
  const reopened=session();await reopened('/api/v640/account',{mode:'login',name:username,password:pass});
  report.unreadAfterExit=(await reopened(prefix+'phone?v61=notifications')).notifications.some(x=>x.kind==='chat'&&!x.read);
  assert.ok(report.unreadAfterExit);console.log(JSON.stringify(report));
}finally{
  socket?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(!probe.stdin.destroyed)probe.stdin.end('end\n');
  await exited;await app.close();await rm(temp,{recursive:true,force:true});
}
