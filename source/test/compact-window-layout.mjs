// Checks the generated Windows page at CSS viewport sizes. The native shell runs separately.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {setTimeout as sleep} from 'node:timers/promises';
import {Browser, until} from './browser.mjs';
import {listen} from '../server/index.mjs';

const site = resolve(process.argv[2]);
for (const asset of ['windows-frame.css','windows-frame.js']) {
  assert.deepEqual(await readFile(join(site,'launch',asset)), await readFile(new URL('../launch/'+asset,import.meta.url)));
}
const app = await listen({dataDir:await mkdtemp(join(tmpdir(),'lychee-layout-data-')), webRoot:site});
const browser = new Browser();
const sizes = [[304,264],[360,300],[480,320],[600,350],[900,264],[1200,700]];
const reports = [];
const run = (fn, ...args) => browser.js('(' + fn.toString() + ')(' + args.map(JSON.stringify).join(',') + ')');
async function click(selector, text = '') {
  const result = await until(() => run((s, t) => {
    const b = [...document.querySelectorAll(s)].find(e => e.offsetWidth && !e.disabled && (!t || e.textContent.trim() === t));
    if (!b) return;
    b.scrollIntoView({block:'center',inline:'nearest'});
    const r=b.getBoundingClientRect(), x=Math.max(0,r.left)+Math.min(r.width,innerWidth)/2, y=r.top+r.height/2;
    if(y<0 || y>=innerHeight || !b.contains(document.elementFromPoint(x,y)))return;
    return {x,y};
  }, selector,text), selector+' '+text);
  for(const type of ['mousePressed','mouseReleased']) await browser.call('Input.dispatchMouseEvent',{type,...result,button:'left',clickCount:1});
}
async function desktopPage(tab) {
  await browser.size(1050,720,false);
  const selector='.windows-nav [data-page="'+tab+'"]';
  await until(async()=>{
    if(await run(s=>document.querySelector(s)?.getAttribute('aria-current')==='page',selector))return true;
    await click(selector);
    await sleep(150);
    return run(s=>document.querySelector(s)?.getAttribute('aria-current')==='page',selector);
  },'navigate to '+tab);
}
async function snapshot(name) {
  for(const [width,height] of sizes) {
    await browser.size(width,height,false);
    await sleep(95);
    const state=await run(() => {
      const rect=e=>{const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(Math.round)};
      const visible=e=>e.offsetWidth && getComputedStyle(e).visibility!=='hidden';
      const screen=document.querySelector('.garden-app');
      const over=[...screen.querySelectorAll('main,article,section,footer,nav,img,button,label,input,textarea,.room-bubble')].filter(e=>{
        if(!visible(e) || e.closest('.windows-nav') || e.matches('input[type=date]')) return false;
        const r=e.getBoundingClientRect();return r.width>innerWidth+2 || r.left< -2 || r.right>innerWidth+2;
      }).slice(0,10).map(e=>[e.className||e.tagName,e.parentElement.className,e.textContent.slice(0,16),...rect(e)]);
      const scroll=[...screen.querySelectorAll('*')].filter(e=>visible(e) && e.clientHeight>0 && e.scrollHeight>e.clientHeight+2 &&
        /auto|scroll/.test(getComputedStyle(e).overflowY)).map(e=>[e.className,e.clientHeight,e.scrollHeight]).slice(0,5);
      const log=screen.querySelector('.room-log'), editor=screen.querySelector('.v7-wheel-editor'), wheel=screen.querySelector('.v7-wheel');
      const preview=screen.querySelector('.diet-v7-preview');
      const picker=screen.querySelector('.room-compose [aria-expanded=true]');
      return {root:[screen.clientWidth,screen.clientHeight,screen.scrollWidth,screen.scrollHeight],
        header:rect(screen.querySelector('.appbar')), over, scroll,
        roomLog:log?rect(log):null, composer:picker?rect(picker.closest('form')):null,
        wheel:wheel?[rect(wheel),rect(editor)]:null,
        image:preview?[preview.naturalWidth,preview.naturalHeight,...rect(preview),getComputedStyle(preview).objectFit]:null};
    });
    reports.push({name,width,height,...state});
  }
}
try {
  let cookie='';
  async function post(route,data) {
    const res=await fetch(app.url+'/api/v640/'+route,{method:'POST',headers:{origin:app.url,cookie,'content-type':'application/json'},body:JSON.stringify(data)});
    assert.equal(res.status,200); const line=res.headers.getSetCookie().find(v=>v.startsWith('__Host-lychee-account='));
    if(line)cookie=line.split(';')[0];return res.json();
  }
  await post('account',{mode:'register',name:'小窗验收',password:randomUUID()});
  const workspace=await post('workspace',{action:'create',name:'小窗真实园区'});
  for(const item of workspace.notices.filter(n=>!n.read)) await post('workspace',{action:'read',noticeId:item.id});
  await browser.open();
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:
    "window.lycheeDesktopHost=true;window.lycheeNativeFrame=true;window.chrome.webview={postMessage(){},addEventListener(){},removeEventListener(){}};"});
  const [name,value]=cookie.split('=');
  await browser.call('Network.setCookie',{url:app.url+'/',name,value,path:'/',secure:true,httpOnly:true});
  await browser.size(1050,720,false);
  await browser.call('Page.navigate',{url:app.url+'/windows/workspace.html?garden='+workspace.activeGardenId});
  await until(()=>browser.js("document.documentElement.classList.contains('lychee-unified-header')"),'generated Windows frame');
  await desktopPage('聊');await snapshot('chat home');
  await browser.size(304,264,false);
  await click('.ga-enter-room');
  await click('.room-compose input[aria-label]');
  const message='小窗消息 '+ 'a'.repeat(140);
  await browser.call('Input.insertText',{text:message});
  await click('.room-send');
  await until(()=>run(t=>document.querySelector('.room-log')?.textContent.includes(t),message),'sent chat message');
  await snapshot('chat room');
  await browser.size(304,264,false);
  await click('.room-compose [aria-expanded=false]');
  await snapshot('chat picker');
  await browser.size(304,264,false);
  await click('.room-compose [aria-expanded=true]');
  await desktopPage('园');await snapshot('garden');
  await desktopPage('箱');await snapshot('toolbox');
  await desktopPage('settings');
  await until(()=>browser.js("!!document.querySelector('.settings-version')"),'settings content');
  await snapshot('settings');
  await desktopPage('diet');await snapshot('diet');
  await click('.diet-v7-add');
  await browser.size(304,264,false);
  await run(async()=>{
    const canvas=document.createElement('canvas');
    canvas.width=800;canvas.height=120;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#669955';ctx.fillRect(0,0,800,120);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    const transfer=new DataTransfer();transfer.items.add(new File([blob],'layout.png',{type:'image/png'}));
    const input=document.querySelector('.diet-v7 input[type=file]');input.files=transfer.files;
    input.dispatchEvent(new Event('change',{bubbles:true}));
  });
  await until(()=>browser.js("document.querySelector('.diet-v7-preview')?.naturalWidth"),'synthetic photo preview');
  await click('.diet-v7-options button');
  await snapshot('diet edit with photo');
  await browser.size(304,264,false);
  await click('.diet-v7-save');
  await until(()=>browser.js("!!document.querySelector('.diet-v7-sticker')"),'saved photo entry');
  await snapshot('diet saved photo');
  await desktopPage('wheel');await snapshot('wheel');
  await browser.size(304,264,false);
  await click('.v7-wheel-add');
  await browser.call('Input.insertText',{text:'小窗自选'});
  await click('.v7-wheel-spin');
  await until(()=>browser.js("document.querySelector('.v7-wheel-result')?.textContent.includes('选中了')"),'wheel result');
  const failures=reports.filter(r=>r.over.length || r.root[2]>r.root[0]+2);
  if(process.argv.includes('--detail'))console.log(JSON.stringify(reports.filter(r=>r.width===304||r.width===900),null,2));
  console.log(JSON.stringify({checks:reports.length,failures},null,2));
  assert.equal(failures.length,0,'page exceeds its available width');
} finally {await browser.close(); await app.close();}
