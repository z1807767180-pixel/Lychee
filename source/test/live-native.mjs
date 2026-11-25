import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdtemp, readFile, realpath, rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {basename, dirname, join, resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {pathToFileURL} from 'node:url';

const knownOrigin='https://lychee-link-check.onrender.com';
const capabilities='/api/client-capabilities?accountApi=v640', session='/api/v640/workspace';
const checkedTarget=value=>{
  const url=new URL(value);
  if(url.href!==url.origin+'/' || !(url.origin===knownOrigin || (url.protocol==='http:' && url.hostname==='127.0.0.1' && url.port))) {
    throw Error('Expected the configured HTTPS origin or an explicit IPv4 loopback test port');
  }
  return url.origin;
};
async function bind(server){
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  return 'http://127.0.0.1:'+server.address().port;
}
async function stop(server){
  if(!server.listening)return;
  const closed=new Promise((ok,no)=>server.close(e=>e?no(e):ok()));
  server.closeAllConnections();await closed;
}
function answer(res,status,body){
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'}).end(JSON.stringify(body));
}
async function bridgeFor(upstream){
  const seen=[];
  const server=createServer(async(req,res)=>{
    if(req.headers.host!==new URL(origin).host || (req.headers.origin && req.headers.origin!==origin) ||
       req.headers['sec-fetch-site']==='cross-site' || req.headers.authorization || req.headers.cookie) {
      answer(res,403,{});return;
    }
    if(req.method!=='GET'){answer(res,405,{});return;}
    if(req.url!==capabilities && req.url!==session){answer(res,403,{});return;}
    try {
      const path=req.url;
      const result=await fetch(upstream+path,{redirect:'error',credentials:'omit',headers:{accept:'application/json'},signal:AbortSignal.timeout(12000)});
      seen.push({path,status:result.status});
      if(path===session){
        await result.body?.cancel();
        answer(res,result.status===401?401:502,{error:'Anonymous session required'});return;
      }
      if(result.status!==200 || !result.headers.get('content-type')?.includes('application/json')){
        await result.body?.cancel();answer(res,503,{});return;
      }
      const parts=[];let count=0;
      for await(const chunk of result.body){count+=chunk.length;if(count>8192)throw Error('Unexpected response size');parts.push(chunk);}
      const d=JSON.parse(Buffer.concat(parts));
      answer(res,200,{protocol:d.protocol===1?1:null,accountApi:d.accountApi==='v640'?'v640':null,privateGardens:d.privateGardens===true,accountNotices:d.accountNotices===true});
    } catch { answer(res,502,{}); }
  });
  const origin=await bind(server);return {origin,seen,close:()=>stop(server)};
}
async function waitFor(read,label,child,ms=45000){
  const end=Date.now()+ms;let detail;
  while(Date.now()<end){
    if(child.exitCode!==null || child.signalCode!==null)throw Error('Native test client exited early: '+child.exitCode);
    try{const result=await read();if(result)return result;}catch(e){detail=e.message;}
    await sleep(120);
  }
  throw Error(label+' timed out'+(detail?' ('+detail+')':''));
}
async function openTarget(profile,origin,child){
  const port=await waitFor(async()=>{
    for(const f of [join(profile,'EBWebView','DevToolsActivePort'),join(profile,'DevToolsActivePort')]){
      try {const n=Number((await readFile(f,'utf8')).split(/\r?\n/)[0]);if(n>0 && n<65536)return n;}
      catch(e){if(e.code!=='ENOENT')throw e;}
    }
  },'Isolated WebView2 debugger',child);
  const target=await waitFor(async()=>{
    const response=await fetch('http://127.0.0.1:'+port+'/json/list',{redirect:'error',signal:AbortSignal.timeout(1600)});
    return (await response.json()).find(x=>x.type==='page'&&x.url===origin+'/windows/workspace.html');
  },'Packaged local page',child);
  const url=new URL(target.webSocketDebuggerUrl);
  assert.equal(url.origin,'ws://127.0.0.1:'+port);
  const socket=new WebSocket(url);await once(socket,'open');
  const pending=new Map();let serial=0;
  socket.onmessage=({data})=>{
    const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;
    pending.delete(m.id);clearTimeout(p.timer);if(m.error)p.no(Error(m.error.message));else p.ok(m.result);
  };
  function call(method,params={}){
    return new Promise((ok,no)=>{
      const id=++serial,timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timed out'));},5000);
      pending.set(id,{ok,no,timer});socket.send(JSON.stringify({id,method,params}));
    });
  }
  return {call,close:()=>socket.close()};
}

// The only public operation is a fixed anonymous gate inspection. Do not expose
// the debugger, API port, arbitrary JS, credentials, or a business submit method.
export const verifyNativeLiveGate=options=>inspectNative(options,false);
async function inspectNative({exe,upstream},managedFixture){
  const target=checkedTarget(upstream),binary=await realpath(exe);
  const executableSha256=createHash('sha256').update(await readFile(binary)).digest('hex');
  const temp=await realpath(tmpdir()),scratch=await mkdtemp(join(temp,'lychee-native-gate-'));
  let child,exited,bridge,debuggerSession;
  try{
    bridge=await bridgeFor(target);
    const profile=join(scratch,'Lychee-Windows-QA',new URL(bridge.origin).port);
    const env={};
    for(const key of ['SystemRoot','WINDIR','ProgramFiles','ProgramFiles(x86)','ProgramW6432','PATH','USERPROFILE','LOCALAPPDATA','APPDATA']){
      if(process.env[key])env[key]=process.env[key];
    }
    Object.assign(env,{TEMP:scratch,TMP:scratch,WEBVIEW2_USER_DATA_FOLDER:profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:(managedFixture?'--no-sandbox ':'')+'--disable-background-networking --disable-component-update --disable-sync --disable-gpu --no-proxy-server --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1" --remote-debugging-address=127.0.0.1 --remote-debugging-port=0'});
    child=spawn(binary,['--test-local',bridge.origin],{cwd:dirname(binary),env,windowsHide:true,stdio:'ignore'});
    await once(child,'spawn');exited=once(child,'exit');
    debuggerSession=await openTarget(profile,bridge.origin,child);
    const {call}=debuggerSession;
    const gate=await waitFor(async()=>{
      const r=await call('Runtime.evaluate',{returnByValue:true,expression:`(()=>{
        const f=document.querySelector('.garden-access form');
        if(!f?.querySelector('input[name=password]')||document.querySelector('#lychee-launch')||!document.fonts||document.fonts.status!=='loaded')return null;
        const h=document.getElementById('ga-heading'),u=f.querySelector('input[name=username]'),p=f.querySelector('input[name=password]');
        return {title:h.innerText,usernameEmpty:u?.value==='',passwordEmpty:p?.value==='',submit:f.querySelector('button[type=submit]')?.innerText,
          headingFont:getComputedStyle(h).fontFamily,viewport:[innerWidth,innerHeight]};
      })()`});
      return r.result.value;
    },'Anonymous sign-in form',child,45000);
    assert.ok(gate.usernameEmpty&&gate.passwordEmpty);assert.equal(gate.submit,'登录');
    await call('DOM.enable');await call('CSS.enable');
    const {root}=await call('DOM.getDocument'),{nodeId}=await call('DOM.querySelector',{nodeId:root.nodeId,selector:'#ga-heading'});
    const {fonts}=await call('CSS.getPlatformFontsForNode',{nodeId});
    assert.ok(fonts.some(f=>f.isCustomFont&&f.glyphCount>0&&/975|LXGW/i.test(f.familyName)),'Packaged Chinese font must paint the gate heading');
    assert.ok(bridge.seen.some(x=>x.path===capabilities&&x.status===200));
    assert.ok(bridge.seen.some(x=>x.path===session&&x.status===401));
    return {passed:true,upstream:target,executableSha256,gate,paintedFonts:fonts,anonymousReads:bridge.seen};
  } finally {
    debuggerSession?.close();
    try{
      if(exited&&child.exitCode===null&&child.signalCode===null){child.kill();await exited;}
    } finally {
      if(bridge)await bridge.close();
      if(dirname(scratch)!==temp||!/^lychee-native-gate-[A-Za-z0-9]{6}$/.test(basename(scratch)))throw Error('Unexpected test profile directory');
      await rm(scratch,{recursive:true,force:true,maxRetries:12,retryDelay:190});
    }
  }
}

async function selftest(exe){
  const paths=[];
  const fake=createServer((req,res)=>{
    paths.push([req.method,req.url]);
    if(req.method!=='GET'||req.headers.cookie||req.headers.authorization){answer(res,403,{});return;}
    if(req.url===capabilities)answer(res,200,{protocol:1,accountApi:'v640',privateGardens:true,accountNotices:true});
    else if(req.url===session)answer(res,401,{error:'请先登录'});
    else answer(res,404,{});
  });
  const upstream=await bind(fake);
  try{
    const result=await inspectNative({exe,upstream},true);
    assert.deepEqual(paths,[['GET',capabilities],['GET',session]]);
    console.log(JSON.stringify({...result,testUpstream:'disposable IPv4 loopback'}));
  }finally{await stop(fake);}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  if(process.argv.length!==4||process.argv[2]!=='--self-test')throw Error('Usage: node test/live-native.mjs --self-test <localEXE>');
  await selftest(process.argv[3]);
}
