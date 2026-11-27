// Use the normal mobile URL with an isolated account. Public mode sends only static GETs to the real site.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createApp} from '../server/index.mjs';

const [playwright,root,evidence,mode]=process.argv.slice(2);
if(!playwright||!root||!evidence||!['baseline','candidate','public'].includes(mode))throw Error('Pass Playwright path, compiled www, evidence directory, and baseline/candidate/public.');
const {webkit,devices}=createRequire(import.meta.url)(resolve(playwright));
const origin='https://lychee-link-check.onrender.com';
const dataDir=await mkdtemp(join(tmpdir(),'lychee-wheel-webkit-'));
const app=await createApp({dataDir,webRoot:resolve(root),origin});
let cookie='';
const read=async(path,body)=>{
  const r=await app.handle(new Request(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'content-type':'application/json'},body:body&&JSON.stringify(body)}));
  assert.equal(r.status,200,path);
  cookie=r.headers.getSetCookie()[0]?.split(';')[0]||cookie;return r.json();
};
await mkdir(evidence,{recursive:true});
const browser=await webkit.launch();
try{
  await read('/api/v640/account',{mode:'register',name:'转盘体验',password:randomUUID()});
  await read('/api/v640/workspace',{action:'create',name:'转盘验收园'});
  for(const n of (await read('/api/v640/workspace?client=mobile-web')).notices)await read('/api/v640/workspace',{action:'read',noticeId:n.id});
  const context=await browser.newContext(devices['iPhone 13']);
  const artifacts=[];
  await context.route('**/*',async route=>{
    const req=route.request(),url=new URL(req.url());
    if(url.origin!==origin)return route.abort();
    if(/\/wheel-(banner|hub)-v7\.webp$/.test(url.pathname))return route.fulfill({status:404,body:'Missing image test fixture'});
    const business=url.pathname.startsWith('/g/')||url.pathname.startsWith('/api/');
    if(!business&&mode==='public'){
      if(req.method()!=='GET'||!url.pathname.startsWith('/mobile/')||req.headers().cookie)throw Error('Expected anonymous public static asset');
      artifacts.push(url.pathname);
      return route.continue();
    }
    const headers={...req.headers(),cookie,origin};
    const r=await app.handle(new Request(req.url(),{method:req.method(),headers,body:req.postData()||undefined}));
    const safeHeaders=Object.fromEntries(r.headers);delete safeHeaders['set-cookie'];
    await route.fulfill({status:r.status,headers:safeHeaders,body:Buffer.from(await r.arrayBuffer())});
  });
  const page=await context.newPage();
  await page.goto(origin+'/mobile/');
  await page.getByRole('button',{name:'工具箱',exact:true}).click();
  await page.getByRole('button',{name:'交给命运',exact:true}).click();
  const frame=mode==='baseline'?page:page.frameLocator('iframe');
  const banner=frame.locator('.v7-wheel-banner');
  await banner.waitFor();
  const art=await banner.evaluate(async (b,baseline)=>{
    try{await b.decode();}catch(error){if(!baseline)throw error;}
    const h=new Image();h.src=getComputedStyle(document.querySelector('.v7-wheel-hub')).backgroundImage.replace(/^url\(["']?|["']?\)$/g,'');
    try{await h.decode();}catch(error){if(!baseline)throw error;}const rect=b.getBoundingClientRect();
    return {banner:[b.naturalWidth,b.naturalHeight],hub:[h.naturalWidth,h.naturalHeight],
      visibleRatio:rect.width/rect.height,builtIn:b.currentSrc.startsWith('data:image/jpeg;')&&h.src.startsWith('data:image/png;')};
  },mode==='baseline');
  assert.deepEqual(art.banner,mode==='baseline'?[0,0]:[642,147]);
  assert.deepEqual(art.hub,mode==='baseline'?[0,0]:[82,82]);
  if(mode!=='baseline')assert.ok(art.builtIn&&Math.abs(art.visibleRatio-642/147)<.08);
  await page.screenshot({path:join(evidence,'wheel.png')});
  await frame.locator('.v7-wheel-spin').click();
  await frame.locator('.v7-wheel-result').filter({hasText:'选中了'}).waitFor();
  const report={mode,engine:'WebKit',engineVersion:browser.version(),viewport:page.viewportSize(),origin,
    clientVersion:await page.locator('body').getAttribute('data-client-build'),art,
    result:await frame.locator('.v7-wheel-result').innerText(),publicAssets:[...new Set(artifacts)].sort()};
  await writeFile(join(evidence,'wheel.json'),JSON.stringify(report,null,2)+'\n');console.log(report);
}finally{
  await browser.close();await app.close();
  const {rm}=await import('node:fs/promises');
  await rm(dataDir,{recursive:true,force:true});
}
