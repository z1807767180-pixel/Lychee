// Regression for a saved session that builds a hidden form before its first real screen.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Browser,until} from './browser.mjs';

const [previous,candidate,evidence]=process.argv.slice(2);
if(!previous||!candidate||!evidence)throw Error('Pass previous and new launch scripts, then the evidence directory.');
const scripts=await Promise.all([previous,candidate].map(name=>readFile(resolve(name))));
await mkdir(evidence,{recursive:true});
let version=0;
const server=createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  res.setHeader('Cache-Control','no-store');
  if(pathname==='/api/client-capabilities')return res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({protocol:1,accountApi:'v640',privateGardens:true,accountNotices:true}));
  if(pathname==='/start.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(scripts[version]);
  if(pathname==='/client/garden.js')return res.writeHead(200,{'Content-Type':'text/javascript'}).end(
    "document.querySelector('#root').innerHTML='<main><form hidden><input></form></main>';");
  res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end('<meta charset="utf-8"><body data-client-build="8.0.0"><section id="lychee-launch"><p>正在打开荔枝…</p><button hidden>重试</button></section><div id="root"></div><script src="/start.js"></script>');
});
server.listen(0,'127.0.0.1');await once(server,'listening');
const browser=new Browser(),results=[];
try{
  await browser.open();await browser.size(390,844,true);
  for(version=0;version<scripts.length;version++){
    await browser.call('Page.navigate',{url:'http://127.0.0.1:'+server.address().port+'/?v='+version});
    await until(()=>browser.js("!!document.querySelector('#root form[hidden] input')"),'已生成无可见内容的中间页面');
    await sleep(3200);
    const before=await browser.js("!!document.querySelector('#lychee-launch')");
    assert.equal(before,version===1);
    const shot=await browser.call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(evidence,version?'new-wait.png':'old-blank.png'),Buffer.from(shot.data,'base64'));
    await browser.js("document.querySelector('#root').innerHTML='<button>进入荔枝</button>'");
    await until(()=>browser.js("!document.querySelector('#lychee-launch')&&document.querySelector('#root button').offsetWidth>0"),'可操作首屏');
    results.push({beforeInteractive:before?'launch-visible':'blank',afterInteractive:'ready'});
  }
  await writeFile(join(evidence,'result.json'),JSON.stringify(results,null,2)+'\n');
  console.log(results);
}finally{await browser.close();await new Promise(done=>server.close(done));}
