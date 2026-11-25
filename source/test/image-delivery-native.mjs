import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {once} from 'node:events';
import {mkdir,mkdtemp,readFile,readdir,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function poll(fn,label,timeout=20000){
  const end=Date.now()+timeout;let detail='';
  while(Date.now()<end){try{const v=await fn();if(v)return v;}catch(e){detail=e.message;}await sleep(100);}
  throw Error(label+' timed out '+detail);
}
export async function checkNativeImage(t,{origin,exe,user,password,sample,large,album}){
  assert.match(origin,/^http:\/\/127\.0\.0\.1:\d+$/);
  const downloads=await mkdtemp(join(tmpdir(),'lychee-image-download-'));
  const server=createServer();server.listen(0,'127.0.0.1');await once(server,'listening');
  const debug=server.address().port;await new Promise(done=>server.close(done));
  const flags='--no-sandbox --disable-gpu --disable-background-networking --no-proxy-server --host-resolver-rules="MAP * ~NOTFOUND, EXCLUDE 127.0.0.1" --remote-debugging-port='+debug;
  const child=spawn(exe,['--test-local',origin],{windowsHide:true,stdio:'ignore',env:{...process.env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:flags}});
  let ws,seq=0;const pending=new Map();
  const list=()=>fetch('http://127.0.0.1:'+debug+'/json/list').then(r=>r.json());
  async function cmd(method,params={}){
    const id=++seq;
    return new Promise((ok,no)=>{
      const timer=setTimeout(()=>{pending.delete(id);no(Error(method+' timeout'));},16000);
      pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));
    });
  }
  const js=async expr=>{
    const r=await cmd('Runtime.evaluate',{expression:expr,awaitPromise:true,returnByValue:true});
    if(r.exceptionDetails)throw Error('WebView evaluate failed: '+r.exceptionDetails.text);
    return r.result.value;
  };
  const click=async(selector,needle='')=>{
    const position=await poll(()=>js(`(()=>{const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.getClientRects().length&&x.textContent.includes(${JSON.stringify(needle)}));if(!e)return;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;if(!e.contains(document.elementFromPoint(x,y)))return;return {x,y}})()`),selector+' '+needle);
    for(const type of ['mousePressed','mouseReleased'])await cmd('Input.dispatchMouseEvent',{type,...position,button:'left',clickCount:1});
  };
  const output={exeSha256:hash(await readFile(exe))};
  const inline=process.env.LYCHEE_EXPECT_IMAGE_VIEWER==='1';
  const evidence=process.env.LYCHEE_IMAGE_EVIDENCE;
  const screenshot=async name=>{
    if(!evidence)return;
    const dir=resolve(evidence);await mkdir(dir,{recursive:true});
    const shot=await cmd('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    await writeFile(join(dir,output.exeSha256.slice(0,10)+'-'+name+'.png'),Buffer.from(shot.data,'base64'));
  };
  try{
    const page=await poll(async()=>(await list()).find(x=>x.type==='page'&&x.url.startsWith(origin)),'WebView listener');
    ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
    ws.onmessage=({data})=>{
      const m=JSON.parse(data),p=pending.get(m.id);if(!p)return;pending.delete(m.id);clearTimeout(p.timer);
      if(m.error)p.no(Error(m.error.message));else p.ok(m.result);
    };
    await cmd('Page.enable');await cmd('Runtime.enable');
    await poll(()=>js(`document.readyState!=='loading'&&location.origin===${JSON.stringify(origin)}&&!!document.body`),'embedded document ready');
    await cmd('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
    const body={mode:'login',name:'图片样本1',password};
    assert.equal(await js(`fetch('/api/v640/account',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(body))}}).then(r=>r.status)`),200);
    for(const action of [{action:'switch',gardenId:'legacy'},{action:'read',noticeId:'release-6.4.0'}])
      assert.equal(await js(`fetch('/api/v640/workspace',{method:'POST',headers:{'content-type':'application/json'},body:${JSON.stringify(JSON.stringify(action))}}).then(r=>r.status)`),200);
    await cmd('Page.navigate',{url:origin+'/windows/workspace.html?garden=legacy'});
    await click('.windows-nav button','AI 生图');
    await click('.a624-switches button','暖');
    await click('.a624-styles button','自由创作');
    await click('textarea[aria-label="描述图片"]');
    await cmd('Input.insertText',{text:'画一颗荔枝。'});
    await click('button','生成图片');
    const dimensions=await poll(()=>js("(()=>{const e=document.querySelector('.a624-photo img');return e?.naturalWidth?[e.naturalWidth,e.naturalHeight]:null})()"),'generated image',60000);
    assert.deepEqual(dimensions,[2048,2048]);output.actualNativePostAndDecode=dimensions;
    await screenshot('generated');
    await click('button','生成记录');
    const gallery=await poll(()=>js("(()=>{const es=[...document.querySelectorAll('.a62-gallery img')];return es.length>=2&&es.every(e=>e.naturalWidth===2048)?es.length:0})()"),'history');
    output.nativeHistory=gallery;await screenshot('history');await click('.a62-gallery button');
    if(inline&&await js("!!document.querySelector('dialog[open]')"))await click('dialog[open] button','关闭原图');
    const before=await js('location.href'),pagesBefore=(await list()).filter(x=>x.type==='page').length;
    if(inline){
      await click('button,a','查看原图');
      const original=await poll(()=>js(`(()=>{const dialog=document.querySelector('dialog[open][aria-label="查看原图"]');const i=dialog?.querySelector('img[alt="生成的原图"]');return i?.naturalWidth?[i.naturalWidth,i.naturalHeight,new URL(i.currentSrc).origin===location.origin]:null})()`),'full-size in-window viewer');
      assert.deepEqual(original,[2048,2048,true]);assert.equal(await js('location.href'),before);
      assert.equal((await list()).filter(x=>x.type==='page').length,pagesBefore);
      await screenshot('original-viewer');
      await click('dialog[open] a[download]');
      await cmd('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await cmd('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await poll(()=>js("!document.querySelector('dialog[open]')"),'Esc closes viewer');
      await click('.a624-photo');
      await poll(()=>js("document.querySelector('dialog[open] img')?.naturalWidth===2048"),'image opens original viewer');
      await click('dialog[open] button','关闭原图');
      await poll(()=>js("!document.querySelector('dialog[open]')"),'button closes viewer');
      output.inlineViewer={original,escapeClosed:true,closeButtonClosed:true};
    }else await click('a[download]');
    const downloaded=await poll(async()=>{
      for(const file of await readdir(downloads))if(file.endsWith('.jpg')){
        const bytes=await readFile(join(downloads,file));if(bytes.length===large.length)return bytes;
      }
    },'real download');
    assert.equal(hash(downloaded),hash(large));output.downloadBytes=downloaded.length;
    if(!inline){
      await click('a','查看原图');await sleep(650);
      output.viewOriginal={sameLocation:await js('location.href')===before,samePageCount:(await list()).filter(x=>x.type==='page').length===pagesBefore,
        appStillShowsPreview:await js("!!document.querySelector('.a624-photo img')")};
    }
    await click('.windows-nav button','园中事');await click('button','约定相册');
    const photo=await poll(()=>js(`(()=>{const e=[...document.images].find(i=>i.currentSrc.includes(${JSON.stringify(sample.post)})&&i.naturalWidth);return e?[e.naturalWidth,e.naturalHeight]:null})()`),'shared album');
    assert.deepEqual(photo,[512,512]);output.sharedAlbum=photo;await screenshot('album');
    const path='/g/legacy/api/for/'+user+'/phone?image='+sample.post;
    const digest=await js(`fetch(${JSON.stringify(path)}).then(r=>r.arrayBuffer()).then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join(''))`);
    assert.equal(digest,hash(album));
    t.diagnostic(JSON.stringify(output));
  }catch(e){
    if(ws?.readyState===1)t.diagnostic(String(await js('document.body.innerText').catch(()=>'')).slice(-360));
    throw e;
  }finally{
    const dir=process.env.LYCHEE_IMAGE_EVIDENCE;
    if(dir){await mkdir(resolve(dir),{recursive:true});await writeFile(join(resolve(dir),inline?'native-inline-image.json':'native-image.json'),JSON.stringify(output,null,2)+'\n');}
    ws?.close();for(const p of pending.values())clearTimeout(p.timer);
    if(child.exitCode===null&&child.signalCode===null){const closed=once(child,'exit');child.kill();await closed;}
    await rm(downloads,{recursive:true,force:true});
  }
}
