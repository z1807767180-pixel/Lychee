import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';
const [exeInput,evidenceInput,mode]=process.argv.slice(2);
if(!exeInput||!evidenceInput||!['baseline','fixed'].includes(mode))throw Error('node resize-window.mjs EXE EVIDENCE.json baseline|fixed');
const exe=resolve(exeInput),out=resolve(evidenceInput),temp=await mkdtemp(join(tmpdir(),'lychee-resize-'));
const app=await listen({dataDir:temp});
const debugServer=createServer();debugServer.listen(0,'127.0.0.1');await once(debugServer,'listening');
const debug=debugServer.address().port;await new Promise(done=>debugServer.close(done));
const script=fileURLToPath(new URL('./resize-hwnd.py',import.meta.url));
const child=spawn(process.env.LYCHEE_TEST_PYTHON||'python',['-u',script,exe,app.url,String(debug)],{windowsHide:true,stdio:['pipe','pipe','pipe']});
const reader=createInterface({input:child.stdout})[Symbol.asyncIterator](),exited=once(child,'exit');
const report={mode,exeSha256:createHash('sha256').update(await readFile(exe)).digest('hex'),webviewIntegrated:false};
let ws,seq=0;const pending=new Map();let stderr='';
child.stderr.on('data',b=>stderr=(stderr+b).slice(-2000));
async function line(){const next=await reader.next();if(next.done)throw Error('Isolated desktop probe failed: '+stderr);return JSON.parse(next.value);}
async function until(task,label,timeout=25000){
  const end=Date.now()+timeout;
  while(Date.now()<end){try{const result=await task();if(result)return result;}catch{}await sleep(120);}
  throw Error(label+' timed out');
}
function call(method,params={}){
  const id=++seq;
  return new Promise((ok,no)=>{const timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timed out'));},5000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
}
async function js(expression){
  const r=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(r.exceptionDetails)throw Error('WebView setup failed');return r.result.value;
}
try{
  Object.assign(report,await line());
  const page=await until(async()=>(await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json()).find(x=>x.type==='page'&&x.url.startsWith(app.url)),'isolated WebView');
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
  ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){pending.delete(m.id);clearTimeout(p.timer);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
  await call('Runtime.enable');await call('Page.enable');
  await until(()=>js(`location.origin===${JSON.stringify(app.url)}&&document.readyState!=='loading'`),'embedded app');
  const pass=randomUUID();
  assert.equal(await js(`(async()=>{const post=(p,b)=>fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)}).then(r=>r.json());await post('/api/v640/account',{mode:'register',name:'窗口测试',password:${JSON.stringify(pass)}});await post('/api/v640/workspace',{action:'read',noticeId:'release-6.4.0'});return !!(await post('/api/v640/workspace',{action:'create',name:'窗口隔离园'})).activeGardenId})()`),true);
  await call('Page.navigate',{url:app.url+'/windows/workspace.html'});
  await until(()=>js("document.documentElement.classList.contains('lychee-unified-header')"),'integrated chrome');
  await sleep(250);report.webviewIntegrated=true;
  child.stdin.end('probe\n');
  Object.assign(report,await line());
  report.correctHits=report.edges.filter(r=>r.hit===r.expectedHit).length;
  report.changedInExpectedDirection=report.edges.filter(r=>r.changed).length;
  console.log(JSON.stringify({correctHits:report.correctHits,changed:report.changedInExpectedDirection,
    edges:report.edges.map(r=>[r.edge,r.windowAtPoint,r.hit,r.nativeSizing,r.delta])}));
  if(mode==='fixed'){assert.equal(report.correctHits,8);assert.equal(report.changedInExpectedDirection,8);}
}catch(e){report.error=e.message;throw e;}finally{
  ws?.close();for(const p of pending.values())clearTimeout(p.timer);
  if(!child.stdin.writableEnded)child.stdin.end();
  await exited;
  await app.close();await rm(temp,{recursive:true,force:true});
  await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(report,null,2)+'\n');
}
