// Exercise embedded release assets in the actual Windows host on its own non-input desktop.
import {spawn} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename,join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {listen} from '../server/index.mjs';

const [exeArg,outputArg]=process.argv.slice(2);
if (!exeArg||!outputArg) throw Error('Usage: node compact-window-review.mjs <Lychee.exe> <compact-evidence-directory>');
const exe=resolve(exeArg),output=resolve(outputArg);
const probe=fileURLToPath(new URL('resize-hwnd.py',import.meta.url));
const program=String.raw`import runpy,sys
mod=runpy.run_path(sys.argv.pop(1))
def sizes(d,pid):
    hwnd=mod['locate'](d,pid)
    for line in sys.stdin:
        if line.strip()=='end': break
        width,height=map(int,line.split())
        if not 220<=width<=2200 or not 200<=height<=1400: raise ValueError("invalid QA size")
        mod['check'](mod['position'](hwnd,None,90,80,width,height,0x0014))
        mod['time'].sleep(.2)
        x,y,r,b=mod['bounds'](hwnd)
        mod['emit']({'width':r-x,'height':b-y})
    return []
mod['main'](sizes)
`;
const temp=await mkdtemp(join(tmpdir(),'lychee-compact-')),app=await listen({dataDir:temp});
await mkdir(output,{recursive:true});
const free=createServer();free.listen(0,'127.0.0.1');await once(free,'listening');
const port=free.address().port;await new Promise(done=>free.close(done));
const child=spawn(process.env.LYCHEE_TEST_PYTHON||'python',['-u','-c',program,probe,exe,app.url,String(port)],
  {windowsHide:true,stdio:['pipe','pipe','pipe']});
const exited=once(child,'exit'),lines=createInterface({input:child.stdout})[Symbol.asyncIterator]();
let stderr='';child.stderr.on('data',b=>stderr=(stderr+b).slice(-2500));
async function line(){const {value,done}=await lines.next();if(done)throw Error(stderr||'Desktop stopped');return JSON.parse(value);}
async function wait(f,name,ms=4500){const end=Date.now()+ms;let e;while(Date.now()<end){try{const v=await f();if(v)return v;}catch(err){e=err;}await sleep(70);}throw Error(name+(e?' / '+e.message:''));}
let ws,id=0;const pending=new Map();
function call(method,params={}){return new Promise((ok,no)=>{const n=++id;const timer=setTimeout(()=>{pending.delete(n);no(Error(method));},6000);
  pending.set(n,{ok,no,timer});ws.send(JSON.stringify({id:n,method,params}));});}
async function js(s){const r=await call('Runtime.evaluate',{expression:s,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;}
const run=(f,...args)=>js('('+String(f)+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
const report={exe:basename(exe),exeSha256:createHash('sha256').update(await readFile(exe)).digest('hex'),screenshotType:'WebView2 viewport in a private WPF window',sizes:[],failures:[]};
let view;
async function shot(name){const r=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(output,name+'.png'),Buffer.from(r.data,'base64'));}
const controls=(selector,label='',scroll=true)=>run((selector,label,scroll)=>{
  const nodes=[...document.querySelectorAll(selector)].filter(e=>e.offsetWidth&&e.offsetHeight&&!e.disabled);
  const e=nodes.find(e=>!label||e.innerText.trim()===label)||nodes.find(e=>e.innerText.includes(label));
  if(!e)return null;
  if(scroll)e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
  const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
  return {x,y,hit:e.contains(document.elementFromPoint(x,y)),label:e.innerText.slice(0,38)};
},selector,label,scroll);
async function click(s,label=''){const spot=await wait(async()=>{const el=await controls(s,label);return el?.hit&&el;},'unreachable '+s+' '+label,1700);
  for(const type of ['mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:spot.x,y:spot.y,button:'left',clickCount:1});}
async function tab(wide,narrow){
  if(await controls('.windows-nav [data-page="'+wide+'"]'))return click('.windows-nav [data-page="'+wide+'"]');
  for(let depth=0;depth<4&&!await controls('nav.bottom button',narrow);depth++){
    await click('.appbar .back');await sleep(90);
  }
  await click('nav.bottom button',narrow);
}
async function tool(name,page){await tab('箱','工具箱');await wait(()=>js("document.querySelector('.appbar h1')?.textContent.trim()==='工具箱'"),'toolbox tab');
  await click('button',name);await wait(()=>js('!!document.querySelector('+JSON.stringify(page)+')'),name);}
async function dom(){return js(`(() => {
  const dim=e=>{const r=e.getBoundingClientRect();return {width:Math.round(r.width),height:Math.round(r.height)}};
  const hosts=[...document.querySelectorAll('.ph-scroll,.v7-tool,.room-messages,.room-feed,.toolbox-screen')].filter(e=>e.offsetWidth);
  return {title:document.querySelector('.appbar h1')?.textContent,viewport:[innerWidth,innerHeight],
    horizontal:[document.documentElement.scrollWidth,document.body.scrollWidth],
    hosts:hosts.map(e=>({class:e.className,client:[e.clientWidth,e.clientHeight],scroll:[e.scrollWidth,e.scrollHeight]})),
    nav:[...document.querySelectorAll('nav.bottom button')].filter(e=>e.offsetWidth).map(e=>e.innerText),body:dim(document.body)};
})()`);}
async function check(name,fn){const res={name};view.pages.push(res);
  try{Object.assign(res,await fn());}catch(e){res.error=e.message;report.failures.push(view.name+' '+name+' '+e.message);}
  await sleep(260);res.layout=await dom();
  if(res.layout.horizontal.some(w=>w>res.layout.viewport[0]+1)||res.layout.hosts.some(v=>v.scroll[0]>v.client[0]+2)){
    report.failures.push(view.name+' '+name+' horizontal overflow');
  }
  if(res.error)res.buttons=await js("[...document.querySelectorAll('button')].filter(e=>e.offsetWidth).map(e=>e.textContent.trim().slice(0,28)).slice(0,35)");
  await shot(view.name+'-'+name);
}
async function nativeSize(width,height){let outer=[width,height],actual;for(let i=0;i<3;i++){
  child.stdin.write(outer.join(' ')+'\n');actual=await line();await sleep(110);const v=await js('[innerWidth,innerHeight]');
  if(v[0]===width&&v[1]===height)return {outer:actual,viewport:v};
  const scale=await js('devicePixelRatio');
  outer=[Math.max(220,Math.round(actual.width+(width-v[0])*scale)),Math.max(200,Math.round(actual.height+(height-v[1])*scale))];
}return {outer:actual,viewport:await js('[innerWidth,innerHeight]')};}
try{
  const started=await line();if(started.privateDesktop===started.inputDesktop)throw Error('Not isolated');report.privateDesktop=true;
  const page=await wait(async()=>(await(await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(x=>x.url.startsWith(app.url)),'WebView',25000);
  ws=new WebSocket(page.webSocketDebuggerUrl);await once(ws,'open');
  ws.onmessage=({data})=>{const m=JSON.parse(data),p=pending.get(m.id);if(p){clearTimeout(p.timer);pending.delete(m.id);m.error?p.no(Error(m.error.message)):p.ok(m.result);}};
  await call('Runtime.enable');await call('Page.enable');await wait(()=>js('!!document.body&&location.origin==='+JSON.stringify(app.url)),'app',15000);
  let cookie='';
  async function post(route,data){const r=await fetch(app.url+route,{method:'POST',headers:{origin:app.url,cookie,'content-type':'application/json'},body:JSON.stringify(data)});
    for (const c of r.headers.getSetCookie())if(c.startsWith('__Host-lychee-account='))cookie=c.split(';')[0];
    if(!r.ok)throw Error(route+' '+r.status);return r.json();}
  await post('/api/v640/account',{mode:'register',name:'小窗验收',password:randomUUID()});
  const space=await post('/api/v640/workspace',{action:'create',name:'荔枝小院'});
  for(const n of space.notices.filter(v=>!v.read))await post('/api/v640/workspace',{action:'read',noticeId:n.id});
  const prefix='/g/'+space.activeGardenId+'/api/';
  await post(prefix+'camp',{type:'note',key:randomUUID(),name:'小窗验收',avatar:1,body:'今天午饭吃了什么？一起记下来吧。'});
  await call('Network.enable');const [cookieName,cookieValue]=cookie.split('=');
  await call('Network.setCookie',{name:cookieName,value:cookieValue,url:app.url+'/',path:'/',secure:true,httpOnly:true});
  await call('Page.navigate',{url:app.url+'/windows/workspace.html'});await wait(()=>js("document.documentElement.classList.contains('lychee-unified-header')&&!!document.querySelector('nav.bottom')&&!document.querySelector('#lychee-launch')"),'workspace',20000);
  const {day,photo}=await run(()=>{const d=new Date(),day=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    const c=document.createElement('canvas');c.width=320;c.height=100;const g=c.getContext('2d');g.fillStyle='#e3b497';g.fillRect(0,0,320,100);g.fillStyle='#537443';g.fillRect(30,20,60,60);
    return {day,photo:c.toDataURL('image/png')};});
  await post('/api/v7/diet/entries?'+new URLSearchParams({accountId:space.account.id,gardenId:space.activeGardenId,day}),{entry:{id:randomUUID(),day,revision:0,title:'午饭记录',photo,
    items:[{name:'白米饭',foodId:'usda-20445',grams:120,source:'USDA',per100:{kcal:130,protein:2.69,carbs:28.17,fat:.28}}]}});
  child.stdin.write('probe\n');
  for(const [name,width,height] of [['small',304,264],['medium',640,500],['wide-short',1000,320]]){
    view={name,requested:[width,height],...await nativeSize(width,height),pages:[]};report.sizes.push(view);
    if(Math.abs(view.viewport[0]-width)>4||Math.abs(view.viewport[1]-height)>4)report.failures.push(name+' native size differs: '+view.viewport.join('x'));
    await check('chat',async()=>{await tab('聊','荔圈');await click('button','进入圈子');let field='.room-compose textarea,.room-compose input:not([type=file]):not([type=hidden])';
      await wait(()=>controls(field),'chat composer');await click(field);await call('Input.insertText',{text:'周末一起做饭吧'});const draft=await js('document.activeElement.value');
      if(!draft?.includes('周末一起做饭吧'))throw Error('chat input lost focus');
      const input=await controls(field,'',false);const send=await controls('.room-compose button[type=submit],.room-compose .room-send','',false);
      if(!input?.hit||!send?.hit)throw Error('chat input or send obscured');return {draft,input,send};});
    await check('toolbox',async()=>{await tab('箱','工具箱');const entry=await controls('button','照记饮食');if(!entry?.hit)throw Error('diet entry obscured');return {entry};});
    await check('diet',async()=>{await tool('照记饮食','.diet-v7-sticker');await click('.diet-v7-sticker');const preview=await wait(()=>js(`(()=>{const i=document.querySelector('.diet-v7-preview');if(!i?.naturalWidth)return null;const r=i.getBoundingClientRect();return {natural:[i.naturalWidth,i.naturalHeight],box:[r.width,r.height],fit:getComputedStyle(i).objectFit}})()`),'photo preview');
      if(!['contain','cover','scale-down','none'].includes(preview.fit)&&Math.abs(preview.box[0]/preview.box[1]-3.2)>.04)throw Error('photo stretched');
      const save=await controls('button','保存这一餐');if(!save?.hit)throw Error('save below visible scroll area');return {preview,save};});
    await check('wheel',async()=>{await tool('交给命运','.v7-wheel-frame');
      const rect=await js("(()=>{const r=document.querySelector('.v7-wheel-frame').getBoundingClientRect();return [r.width,r.height]})()");
      if(Math.abs(rect[0]-rect[1])>2)throw Error('wheel distorted');
      const topic=await controls('.v7-wheel-topic input');const spin=await controls('.v7-wheel-spin');if(!topic?.hit||!spin?.hit)throw Error('wheel inputs obscured');
      const lines=await js(`(()=>{const button=document.querySelector('.v7-wheel-spin');const range=document.createRange();range.selectNodeContents(button);
        return new Set([...range.getClientRects()].filter(r=>r.width&&r.height).map(r=>Math.round(r.top))).size;})()`);
      if(name==='wide-short'&&lines>1)report.failures.push(name+' primary wheel button wraps to '+lines+' lines');
      return {rect,topic,spin,spinLines:lines};});
    await check('settings',async()=>{if(await controls('.windows-nav [data-page=settings]'))await click('.windows-nav [data-page=settings]');
      else {await tab('我','我');await click('button','设置');}
      await wait(()=>js("document.querySelector('.appbar h1')?.textContent.trim()==='设置'"),'settings detail');
      const last=await js(`(()=>{const s=document.querySelector('.ph-scroll');const el=[...(s||document).querySelectorAll('button,input,select')].filter(e=>e.offsetWidth&&!e.disabled).at(-1);if(!el)return null;el.scrollIntoView({block:'center'});const r=el.getBoundingClientRect();return {label:el.innerText,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)),offset:s?.scrollTop}})()`);
      if(!last?.hit)throw Error('last settings control obscured');return {last};});
  }
}catch(e){report.failures.push(e.message);console.error(e);}finally{
  ws?.close();child.stdin.end('end\n');await exited;await app.close();await rm(temp,{recursive:true,force:true});
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({sizes:report.sizes.map(v=>v.viewport),failures:report.failures}));
  if(report.failures.length)process.exitCode=1;
}
