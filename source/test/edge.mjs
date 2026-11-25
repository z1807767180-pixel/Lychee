import { spawn } from 'node:child_process';
import { mkdtemp, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export async function until(read, label) {
  let detail;
  for (let i=0; i<65; i++) {
    try { const value=await read(); if (value) return value; }
    catch(error) { detail=error.message; }
    await sleep(140);
  }
  throw Error('等待超时：'+label+(detail?' / '+detail:''));
}

export class Browser {
  constructor() {
    this.errors=[]; this.responses=[]; this.urls=[]; this.posts=[]; this.pending=new Map(); this.seq=0;
  }
  async open() {
    this.profile=await mkdtemp(join(tmpdir(),'lychee-win-ui-'));
    this.child=spawn(process.env.LYCHEE_TEST_BROWSER || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
      ['--headless',...(process.argv.includes('--isolated-host')?['--no-sandbox']:[]),
       '--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--disable-sync',
       '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1','--remote-debugging-port=0',
       '--user-data-dir='+this.profile,'about:blank'],{windowsHide:true,stdio:'ignore'});
    const port=await until(async()=>(await readFile(join(this.profile,'DevToolsActivePort'),'utf8')).split(/\r?\n/)[0],'Edge');
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const ws=this.socket=new WebSocket(pages.find(p=>p.type==='page').webSocketDebuggerUrl);
    await new Promise((ready,fail)=>{ws.onopen=ready;ws.onerror=fail;});
    ws.onmessage=({data})=>{
      const m=JSON.parse(data);const pending=this.pending.get(m.id);
      if(pending){this.pending.delete(m.id);clearTimeout(pending.timer);m.error?pending.fail(Error(m.error.message)):pending.resolve(m.result);}
      if(m.method==='Runtime.exceptionThrown')this.errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      if(m.method==='Network.requestWillBeSent'){
        const r=m.params.request;this.urls.push(r.url);
        if(r.method==='POST'){
          let type=null;
          try{type=JSON.parse(r.postData).type??null;}catch{}
          this.posts.push({path:new URL(r.url).pathname,type});
        }
      }
      if(m.method==='Network.responseReceived')this.responses.push([m.params.response.status,m.params.response.url]);
    };
    for (const domain of ['Runtime','Page','Network']) await this.call(domain+'.enable');
  }
  call(method,params={}) {
    const id=++this.seq;
    return new Promise((resolve,fail)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);fail(Error('浏览器无响应 '+method));},6000);
      this.pending.set(id,{resolve,fail,timer});
      this.socket.send(JSON.stringify({id,method,params}));
    });
  }
  async js(expression) {
    const result=await this.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
    return result.result.value;
  }
  size(width,height,mobile=false) {return this.call('Emulation.setDeviceMetricsOverride',{width,height,mobile,deviceScaleFactor:1});}
  async screenshot(name) {
    const shot=await this.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(new URL('./'+name,import.meta.url),Buffer.from(shot.data,'base64'));
  }
  async close() {
    if(this.socket?.readyState===WebSocket.OPEN) {
      this.socket.send(JSON.stringify({id:999999,method:'Browser.close'}));
      for(let i=0;i<40&&this.child.exitCode===null&&this.child.signalCode===null;i++)await sleep(100);
      this.socket.close();
    }
    if(this.child && this.child.exitCode===null && this.child.signalCode===null) {
      const exited=new Promise(done=>this.child.once('exit',done));this.child.kill();await exited;
    }
    if(this.profile && !(await lstat(this.profile)).isSymbolicLink()) {
      const actual=await realpath(this.profile);
      if(dirname(actual)!==await realpath(tmpdir()) || !/^lychee-win-ui-[A-Za-z0-9]{6}$/.test(basename(actual)))throw Error('测试目录超出预期');
      await rm(actual,{recursive:true,force:true,maxRetries:6,retryDelay:150});
    }
  }
}
