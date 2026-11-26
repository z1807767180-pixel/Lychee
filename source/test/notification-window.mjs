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
  for(const n of (await receiver('/api/v640/workspace')).notices)await receiver('/api/v640/workspace',{action:'read',noticeId:n.id});
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
  probe.stdin.write('popup\n');Object.assign(report,await next());
  if(!report.popup)console.log('native delivery diagnostics',await js(`({native:window.__notifyCheck.native,errors:window.__notifyCheck.errors,foreground:document.hasFocus(),hidden:document.hidden,toast:!!document.querySelector('.v61-toast'),workspace:!!document.querySelector('.bottom')})`),(await receiver(prefix+'phone?v61=notifications')).notifications.map(r=>[r.kind,r.read]));
  assert.equal(report.popup,true);assert.equal(report.minimized,true);
  const invoked=await next();assert.equal(invoked.clicked,true,'native notification action');
  await until(()=>js("document.querySelector('[data-room-chat=true]') && document.body.innerText.includes('本地通知验收')"),'clicked notification opens matching chat');
  report.clickedOpensChat=true;
  assert.equal((await receiver(prefix+'phone?v61=notifications')).notifications[0].read,true);
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
