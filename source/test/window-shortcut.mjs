import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';

const stage=resolve(process.argv[2]), temp=await mkdtemp(join(tmpdir(),'lychee-local-keys-'));
const app=await listen({dataDir:temp,webRoot:join(stage,'site')});
const unused=createServer(); unused.listen(0,'127.0.0.1'); await once(unused,'listening');
const port=unused.address().port; await new Promise(ok=>unused.close(ok));
const exe=join(stage,'Lychee.exe');
const probe=spawn('python',['-u',fileURLToPath(new URL('./window-shortcut-hwnd.py',import.meta.url)),exe,app.url,String(port)],{windowsHide:true});
let stderr='',ws,seq=0;
probe.stderr.on('data',b=>stderr=(stderr+b).slice(-1600));
const reader=createInterface({input:probe.stdout})[Symbol.asyncIterator](), exit=once(probe,'exit'), pending=new Map();
const report={sha256:createHash('sha256').update(await readFile(exe)).digest('hex')};
async function row(){const x=await reader.next();if(x.done)throw Error(stderr||'Probe stopped');return JSON.parse(x.value);}
async function native(command){probe.stdin.write(command+'\n');return row();}
async function until(read,name,ms=22000){
  const end=Date.now()+ms;let err;
  while(Date.now()<end){try{const x=await read();if(x)return x;}catch(e){err=e;}await sleep(90);}
  throw Error(name+' timed out '+(err?.message||''));
}
function call(method,params={}){
  const id=++seq;return new Promise((ok,no)=>{const timer=setTimeout(()=>{pending.delete(id);no(Error(method));},6000);
    pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
}
async function js(expression){const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description);return r.result.value;}
async function key(shift){for(const type of ['rawKeyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,modifiers:shift?10:2,key:shift?'Q':'q',code:'KeyQ',windowsVirtualKeyCode:81});}
function session(){let cookie='';return async(path,data)=>{
  const r=await fetch(app.url+path,{method:data?'POST':'GET',headers:{cookie,origin:app.url,'content-type':'application/json'},body:data&&JSON.stringify(data)});
  for(const line of r.headers.getSetCookie())if(line.startsWith('__Host-lychee-account='))cookie=line.split(';')[0];
  assert.equal(r.status,200,path);return r.json();
};}
try{
  const desktop=await row();assert.notEqual(desktop.privateDesktop,desktop.inputDesktop);
  const page=await until(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.url===app.url+'/windows/workspace.html'),'WebView');
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
  ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
  await call('Runtime.enable'); await call('Page.enable');
  await until(()=>js("document.documentElement.classList.contains('lychee-native-window')"),'Windows host');
  probe.stdin.write('probe\n');
  report.nativeShift=await native('key-shift');assert.equal(report.nativeShift.iconic,false);
  report.nativeCtrlQ=await native('key-main');assert.equal(report.nativeCtrlQ.iconic,true);
  await native('restore');
  const receiver=session(),sender=session(),pass=randomUUID();
  const account='窗口快捷键甲',peer='窗口快捷键乙';
  await receiver('/api/v640/account',{mode:'register',name:account,password:pass});
  const garden=(await receiver('/api/v640/workspace',{action:'create',name:'快捷键验收园'})).activeGardenId;
  for(const n of (await receiver('/api/v640/workspace')).notices)await receiver('/api/v640/workspace',{action:'read',noticeId:n.id});
  const invite=(await receiver('/api/v640/workspace',{action:'invite',gardenId:garden})).inviteCode;
  await sender('/api/v640/account',{mode:'register',name:peer,password:pass});
  await sender('/api/v640/workspace',{action:'join',code:invite});
  const login=JSON.stringify({mode:'login',name:account,password:pass});
  assert.equal(await js("fetch('/api/v640/account',{method:'POST',headers:{'content-type':'application/json'},body:"+JSON.stringify(login)+"}).then(r=>r.status)"),200);
  await call('Page.navigate',{url:app.url+'/windows/workspace.html'});
  await until(()=>js("document.documentElement.classList.contains('lychee-unified-header')"),'App window');
  report.tooltip=await js("document.querySelector('[data-command=minimize]').title");assert.match(report.tooltip,/Ctrl\+Q/);
  report.pointer=(await native('drag')).drag;
  assert.equal(report.pointer.filter(edge=>edge.hit===edge.expected&&edge.nativeSizing&&edge.selectedEdgesMoved).length,8);
  report.small=await native('small');
  const [l,t,r,b]=report.small.rect;
  const dips=px=>Math.round(px*96/report.small.dpi);
  assert.deepEqual([dips(r-l),dips(b-t)],[320,280]);
  report.viewport=await js('[innerWidth,innerHeight]');
  assert.ok(report.viewport.every((size,i)=>Math.abs(size-[304,264][i])<=1));
  // Toolbox provides the chat drawer, with the application's real draft editor.
  await js("document.querySelectorAll('.bottom button')[2].click()");
  await until(()=>js("!!document.querySelector('.appbar .bubble')"),'Chat drawer button');
  await js("document.querySelector('.appbar .bubble').click()");
  await until(()=>js("!!Array.from(document.querySelectorAll('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=file])')).find(e=>e.getClientRects().length)"),'Visible editor');
  await js("window.__testDraft=Array.from(document.querySelectorAll('textarea,input:not([type=hidden]):not([type=checkbox]):not([type=file])')).find(e=>e.getClientRects().length);window.__testDraft.focus();true");
  await call('Input.insertText',{text:'还未发出的草稿'});
  const draft=await js('window.__testDraft.value');assert.match(draft,/还未发出的草稿/);
  await key(true);await sleep(150);assert.equal((await native('state')).iconic,false);
  await key(false);await until(async()=>(await native('state')).iconic,'WebView minimize');
  await native('restore');assert.equal(await js('window.__testDraft.value'),draft);
  report.webDraftRetained=true;
  await js("document.querySelector('.appbar .bubble')?.click()");
  await key(false);await until(async()=>(await native('state')).iconic,'Minimize before message');
  const path='/g/'+garden+'/api/';
  const send=(body)=>sender(path+'camp',{type:'note',name:peer,avatar:1,key:randomUUID(),body});
  const unread=async()=>(await receiver(path+'phone?v61=notifications')).notifications.filter(n=>n.kind==='chat'&&!n.read).length;
  await send('第一条临时消息');await until(async()=>(await native('state')).popup,'First native popup');
  const before=await unread();assert.ok(before>0);
  report.dismissed=await native('key-popup');assert.deepEqual(report.dismissed,{iconic:true,popup:false});
  assert.equal(await unread(),before);
  await send('第二条临时消息');await until(async()=>(await native('state')).popup,'Next native popup');
  assert.ok((await unread())>before);report.nextPopupAndUnread=true;
  console.log(JSON.stringify(report));
} catch(e){report.error=e.message;throw e;} finally{
  ws?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(!probe.stdin.destroyed)probe.stdin.end('end\n');
  await exit;await app.close();await rm(temp,{recursive:true,force:true});
  if(process.argv[3])await writeFile(resolve(process.argv[3]),JSON.stringify(report,null,2));
}
