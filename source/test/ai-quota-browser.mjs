import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';

const desktop={entry:'/windows/workspace.html',size:[984,698,false]},mobile={entry:'/mobile/',size:[390,844,true]};
const evidence=resolve(process.env.LYCHEE_QUOTA_EVIDENCE||'work/ai-quota-review');
const get=(b,fn,...args)=>b.js('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
async function click(b,text,selector='button'){
  const point=await until(()=>get(b,(text,selector)=>{
    const e=[...document.querySelectorAll(selector)].find(e=>e.getClientRects().length&&!e.disabled&&(
      e.getAttribute('aria-label')===text||e.textContent.trim()===text||e.innerText.trim().split(/\n/)[0]===text));
    if(!e)return;
    e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'});
    const r=e.getBoundingClientRect(),x=r.left+r.width/2,y=r.top+r.height/2;
    return e.contains(document.elementFromPoint(x,y))&&{x,y};
  },text,selector),text);
  for(const type of ['mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
const visible=(b,selector)=>until(()=>get(b,s=>!!document.querySelector(s)?.getClientRects().length,selector),selector);
const has=(b,text)=>until(()=>get(b,s=>document.body.innerText.includes(s),text),text);
const noChatMeter=b=>get(b,()=>!/(今日问答剩余|今日问答额度已用完)/.test(document.body.innerText));
async function readLabel(browser,text){
  for(let i=0;i<14;i++){
    if(await get(browser,s=>document.body.innerText.includes(s),text))return true;
    await new Promise(ok=>setTimeout(ok,100));
  }
  return false;
}
async function shot(b,file){
  const data=await b.call('Page.captureScreenshot',{format:'png'});
  await writeFile(join(evidence,file+'.png'),Buffer.from(data.data,'base64'));
}
async function openPage(b,spec,base,garden,target){
  await b.call('Page.navigate',{url:base+spec.entry+'?garden='+garden});
  await visible(b,'.ga-circle-list');
  if(target==='cover'){await click(b,'✦ AI 生成','.a62-circle-cover button');return;}
  const profile=target==='个人资料'||target==='状态灵感';
  if(spec===desktop)await click(b,profile?'个人资料':target,'.windows-nav button');
  else if(profile){
    await click(b,'我','nav.bottom button');
    await click(b,'编辑个人资料和头像');
  }else{
    await click(b,'工具箱','nav.bottom button');
    await click(b,target);
  }
  if(target==='状态灵感'){await visible(b,'.a62-assist');return;}
  if(target==='个人资料'){await click(b,'✦ AI 生成');return;}
  if(target==='海龟汤'){
    await until(()=>get(b,()=>document.body.innerText.includes('跳过')||document.body.innerText.includes('自己玩')),'海龟汤初始页');
    const skip=await get(b,()=>[...document.querySelectorAll('button')].find(e=>e.getClientRects().length&&e.innerText.includes('跳过'))?.innerText.trim());
    if(skip)await click(b,skip);
    await click(b,'自己玩');
  }
}
function seedFull(account,dir){
  const db=new DatabaseSync(join(dir,'accounts.sqlite'));
  const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
  try{
    const count=db.prepare('SELECT COUNT(*) AS n FROM mc_ai_quota_requests WHERE account=? AND day=? AND kind=? AND consumed=1');
    const insert=db.prepare('INSERT INTO mc_ai_quota_requests(account,request_key,signature,day,kind) VALUES(?,?,?,?,?)');
    for(const [kind,limit] of [['chat',20],['image',15]]){
      for(let i=count.get(account,day,kind).n;i<limit;i++)insert.run(account,randomUUID(),'fixture-only',day,kind);
    }
  }finally{db.close();}
}
test('真实双端跨园额度、重试、头像封面和主持',async t=>{
  await mkdir(evidence,{recursive:true});
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  const oldGate=process.env.LYCHEE_ENABLE_PROVIDER_CALLS;
  process.env.LYCHEE_ENABLE_PROVIDER_CALLS='0';
  const dir=await mkdtemp(join(tmpdir(),'lychee-quota-ui-'));
  const provider=[];
  const fake=createServer(async(req,res)=>{
    const chunks=[];for await(const c of req)chunks.push(c);
    if(req.url!=='/chat/completions'){res.writeHead(400).end();return;}
    provider.push(JSON.parse(Buffer.concat(chunks)).model);
    res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({choices:[{
      finish_reason:'stop',message:{role:'assistant',content:'回环测试回复'},
    }]}));
  });
  await new Promise(ok=>fake.listen(0,'127.0.0.1',ok));
  const opts={dataDir:dir,webRoot:process.env.LYCHEE_REVIEW_WEB};
  const server=await listen({...opts,testProviderOrigin:'http://127.0.0.1:'+fake.address().port});
  const b=[new Browser(),new Browser()];let offline,stage;
  const report={source:'真实共用账号、园与额度数据库；供应商为本机模拟，耗尽边界由本机数据库预置',views:[]};
  t.after(async()=>{
    await Promise.allSettled(b.map(x=>x.close()));await offline?.close();await server.close();
    await new Promise(ok=>fake.close(ok));await rm(dir,{recursive:true,force:true});
    if(oldGate===undefined)delete process.env.LYCHEE_ENABLE_PROVIDER_CALLS;else process.env.LYCHEE_ENABLE_PROVIDER_CALLS=oldGate;
  });
  try{
    const name='界面测试员',password=randomBytes(20).toString('hex');
    async function api(path,body,cookie=''){
      const response=await fetch(server.url+path,{method:body?'POST':'GET',headers:{origin:server.url,cookie,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});
      assert.equal(response.status,200,path);
      return {data:await response.json(),cookie:response.headers.getSetCookie().find(x=>x.startsWith('__Host-lychee-account='))?.split(';')[0]};
    }
    const creds={name,password};
    const {cookie}=await api('/api/v640/account',{...creds,mode:'register'});
    const gardens=[];
    for(const n of ['测试甲园','测试乙园'])gardens.push((await api('/api/v640/workspace',{action:'create',name:n},cookie)).data.activeGardenId);
    const account=(await api('/api/v640/workspace',{action:'read',noticeId:'release-6.4.0'},cookie)).data.account.id;
    const cookies=[cookie,(await api('/api/v640/account',{...creds,mode:'login'})).cookie];
    const specs=[desktop,mobile];
    for(const [i,x] of b.entries()){
      await x.open();await x.size(...specs[i].size);const [name,value]=cookies[i].split('=');
      await x.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
      await x.call('Page.addScriptToEvaluateOnNewDocument',{source:`window.qaWire=[];const originalFetch=window.fetch;window.fetch=async(...args)=>{
        const body=args[1]?.body && JSON.parse(args[1].body);
        if(body?.type!=='v62-chat')return originalFetch(...args);
        window.qaWire.push(body.requestId);const response=await originalFetch(...args);
        if(window.qaLoseReply){window.qaLoseReply=false;await response.arrayBuffer();throw TypeError('测试：响应已丢失');}
        return response;
      };`});
    }
    for(const [i,x] of b.entries()){
      const window=i?'mobile':'windows';
      for(const [target,kind] of [['AI 助手','chat'],['AI 生图','image'],['个人资料','image'],['状态灵感','chat'],['cover','image'],['海龟汤','chat']]){
        stage=window+':'+target;
        await openPage(x,specs[i],server.url,gardens[i],target);
        const expected=kind==='image'?'今日生图剩余 15 / 15 张':null;
        report.views.push({window,target,expected,visible:expected?await readLabel(x,expected):await noChatMeter(x)});
      }
    }
    stage='真实聊天成功后丢失响应';
    const win=b[0];await openPage(win,desktop,server.url,gardens[0],'AI 助手');
    await click(win,'深度思考');await click(win,'联网搜索');
    async function typePrompt(){
      await win.js("document.querySelector('.a62-composer textarea').focus()");
      await win.call('Input.insertText',{text:'相同的本机测试输入'});
    }
    await typePrompt();await win.js('window.qaLoseReply=true');await click(win,'发送');
    await has(win,'测试：响应已丢失');assert.ok(await noChatMeter(win));
    await click(win,'发送');await has(win,'回环测试回复');
    assert.equal(provider.length,1);
    await typePrompt();await click(win,'发送');assert.ok(await noChatMeter(win));
    const ids=await win.js('window.qaWire');assert.equal(ids.length,3);assert.match(ids[0],/^[a-f0-9-]{36}$/i);
    assert.equal(ids[0],ids[1]);assert.notEqual(ids[1],ids[2]);assert.equal(provider.length,2);
    report.retries={realBrowserPosts:3,mockProviderPosts:2,sameKeyAfterLostReply:true,freshKeyAfterSuccess:true};
    stage='另一独立会话在乙园无问答日限提示';
    await openPage(b[1],mobile,server.url,gardens[1],'AI 助手');assert.ok(await noChatMeter(b[1]));
    await shot(b[1],'mobile-cross-garden');
    stage='个人状态真实辅助回复和用量刷新';
    await openPage(b[1],mobile,server.url,gardens[1],'状态灵感');assert.ok(await noChatMeter(b[1]));
    await click(b[1],'✦ AI 状态灵感','.a62-assist button');await has(b[1],'回环测试回复');
    assert.ok(await noChatMeter(b[1]));
    assert.equal(provider.length,3);report.profileAssistRefresh={hasDailyLimit:false};
    seedFull(account,dir);
    for(const [i,x] of b.entries()){
      const window=i?'mobile':'windows';
      for(const [target,kind] of [['AI 助手','问答'],['AI 生图','生图'],['cover','生图'],['个人资料','生图'],['状态灵感','问答'],['海龟汤','问答']]){
        stage=window+':耗尽:'+target;await openPage(x,specs[i],server.url,gardens[i],target);
        const expected=kind==='生图'?'今日生图额度已用完，北京时间零点恢复':null;
        report.views.push({window,target,expected,visible:expected?await readLabel(x,expected):await noChatMeter(x)});
        if(['AI 助手','个人资料','海龟汤','状态灵感'].includes(target))await shot(x,window+'-'+({ 'AI 助手':'chat','个人资料':'avatar','海龟汤':'soup','状态灵感':'assist'}[target]));
      }
    }
    stage='主持未配置';offline=await listen(opts);
    const [oldName,oldValue]=cookies[0].split('=');
    await win.call('Network.setCookie',{name:oldName,value:oldValue,url:offline.url+'/',path:'/',secure:true,httpOnly:true});
    await openPage(win,desktop,offline.url,gardens[0],'海龟汤');await has(win,'主持还没读到密钥，可以先看题。');
    assert.equal(await get(win,()=>document.body.innerText.includes('额度已用完')),false);
    report.unconfiguredHost=true;
    assert.deepEqual(b.flatMap(x=>x.errors),[]);
    assert.deepEqual(b.flatMap(x=>x.urls).filter(url=>/^https?:/.test(url)&&![server.url,offline.url].some(o=>url.startsWith(o+'/'))),[]);
    assert.deepEqual(report.views.filter(view=>!view.visible),[],'各入口实际显示额度');
    report.passed=true;
  }catch(error){
    report.failure={stage,error:error.message,ui:await Promise.all(b.map(x=>x.js('document.body.innerText.slice(-550)').catch(()=>null)))};
    report.controls=await b[0].js(`[...document.querySelectorAll('.a62-composer button,.a62-modes button')].map(e=>{
      const r=e.getBoundingClientRect();return {text:e.textContent.trim(),disabled:e.disabled,rect:r.toJSON(),hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.className};
    })`).catch(()=>null);
    throw Error(stage+' '+error.message,{cause:error});
  }finally{await writeFile(join(evidence,'result.json'),JSON.stringify(report,null,2));}
});
