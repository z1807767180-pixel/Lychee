import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes} from 'node:crypto';
import {createServer} from 'node:http';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';

const evidence=resolve(process.env.LYCHEE_IMAGE_JOB_EVIDENCE||'work/image-job-review');
const webRoot=resolve(process.env.LYCHEE_REVIEW_WEB||'outputs/lychee-multiclient/public');
const view=(b,fn,...args)=>b.js('('+fn.toString()+')('+args.map(a=>JSON.stringify(a)).join(',')+')');
const has=(b,text)=>until(()=>view(b,t=>document.body.innerText.includes(t),text),text);
async function click(b,label,selector='button'){
  const point=await until(()=>view(b,(label,selector)=>{
    const el=[...document.querySelectorAll(selector)].find(x=>x.getClientRects().length&&!x.disabled&&
      (x.getAttribute('aria-label')===label||x.innerText?.trim().split(/\n/)[0]===label));
    if(!el)return;
    el.scrollIntoView({block:'center',behavior:'instant'});
    const r=el.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return el.contains(document.elementFromPoint(x,y))&&{x,y};
  },label,selector),label);
  for(const type of ['mousePressed','mouseReleased'])await b.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
async function screenshot(b,name){
  const shot=await b.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(evidence,name+'.png'),Buffer.from(shot.data,'base64'));
}
async function input(b,text){
  await b.js("document.querySelector('textarea[aria-label=\"描述图片\"]').focus()");
  await b.call('Input.insertText',{text});
}
async function original(b){
  await until(()=>b.js("document.querySelector('dialog[open] img[alt=\"生成的原图\"]')?.naturalWidth>0"),'原图解码');
  assert.equal(await b.js("document.querySelector('dialog[open] a[download]').href.endsWith('&download=1')"),true);
}

test('两端生图作业恢复、额度提示与页内原图',async t=>{
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  await mkdir(evidence,{recursive:true});
  const dataDir=await mkdtemp(join(tmpdir(),'lychee-job-ui-'));
  const app=await listen({dataDir,webRoot});
  const bytes=await readFile(join(webRoot,'mobile','ai-image-hero.webp'));
  const posts=[],reads=[],jobs=new Map();
  let mode='lost',cookie;
  const proxy=createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,'http://localhost');
      const chunks=[];for await(const c of req)chunks.push(c);
      const body=Buffer.concat(chunks),query=u.searchParams.get('v62');
      const json=(n,data,headers={})=>res.writeHead(n,{'content-type':'application/json','cache-control':'no-store',...headers}).end(JSON.stringify(data));
      if(u.pathname.endsWith('/phone')&&u.pathname.startsWith('/g/')){
        if(query==='status')return json(200,{image:true,limits:{image:10},used:{image:1}});
        if(query==='image-status'){
          const id=u.searchParams.get('requestId');reads.push({path:u.pathname,id});
          return json(200,jobs.get(id)||{state:'missing'});
        }
        if(query==='images')return json(200,{images:[{id:'gallery-id',prompt:'相册回归图'}]});
        if(query==='image')return res.writeHead(200,{'content-type':'image/webp'}).end(bytes);
        if(body.length&&JSON.parse(body).type==='v62-image'){
          const item=JSON.parse(body);posts.push(item.requestId);
          const data={state:'pending',retryAfterMs:1000};
          if(mode==='lost'){
            jobs.set(item.requestId,data);
            res.writeHead(200,{'content-type':'application/json','content-length':1000});
            res.write('{',()=>setTimeout(()=>res.destroy(),30));return;
          }
          if(mode==='disabled')return json(503,{error:'AI 服务尚未配置'});
          if(mode==='bad')return json(400,{error:'请检查输入参数'});
          if(mode==='legacy')return json(200,{id:'old-format',prompt:'同步结果'});
          if(mode==='refund'){jobs.set(item.requestId,{state:'refunded'});return json(409,{state:'refunded'},{'x-lychee-ai-retry':'new'});}
          if(mode!=='missing')jobs.set(item.requestId,data);
          return json(202,data);
        }
      }
      const headers={cookie:req.headers.cookie||'',origin:app.url,'content-type':req.headers['content-type']||'application/json'};
      const reply=await fetch(app.url+req.url,{method:req.method,headers,body:body.length?body:undefined,redirect:'manual'});
      const forwarded=Object.fromEntries(reply.headers);
      for(const name of ['transfer-encoding','content-encoding','content-length','connection'])delete forwarded[name];
      res.writeHead(reply.status,forwarded).end(Buffer.from(await reply.arrayBuffer()));
    }catch{res.writeHead(500).end();}
  });
  await new Promise(ok=>proxy.listen(0,'127.0.0.1',ok));
  const origin='http://127.0.0.1:'+proxy.address().port;
  const b=new Browser(),report={service:'本机真实账号、圈子、页面；生图、状态、图片和额度由回环 HTTP 夹具模拟',views:[]};
  t.after(async()=>{await b.close();proxy.closeAllConnections();await new Promise(ok=>proxy.close(ok));await app.close();await rm(dataDir,{recursive:true,force:true});});
  async function api(path,obj){
    const r=await fetch(app.url+path,{method:'POST',headers:{cookie:cookie||'',origin:app.url,'content-type':'application/json'},body:JSON.stringify(obj)});
    assert.equal(r.status,200);
    const issued=r.headers.getSetCookie().find(x=>x.startsWith('__Host-lychee-account='));
    if(issued)cookie=issued.split(';')[0];
    return r.json();
  }
  let stage='准备';
  try{
    await api('/api/v640/account',{mode:'register',name:'生图测试员',password:randomBytes(18).toString('hex')});
    const g1=(await api('/api/v640/workspace',{action:'create',name:'生图甲园'})).activeGardenId;
    const g2=(await api('/api/v640/workspace',{action:'create',name:'生图乙园'})).activeGardenId;
    await api('/api/v640/workspace',{action:'read',noticeId:'release-6.4.0'});
    await b.open();
    const [name,value]=cookie.split('=');
    await b.call('Network.setCookie',{name,value,url:origin+'/',path:'/',secure:true,httpOnly:true});
    async function enter(mobile,garden){
      const entry=mobile?'/mobile/':'/windows/workspace.html';
      await b.call('Page.navigate',{url:origin+entry+'?garden='+garden});
      await until(()=>b.js("!!document.querySelector('.ga-circle-list')"),'圈子列表');
      if(mobile){await click(b,'工具箱','nav.bottom button');await click(b,'AI 生图');}
      else await click(b,'AI 生图','.windows-nav button');
      await has(b,'今日生图剩余 9 / 10 张');
    }
    for(const mobile of [false,true]){
      const viewport=mobile?'mobile':'windows',offset=posts.length,prompt='隔离测试描述'+viewport;
      stage=viewport+' 丢失响应';await b.size(mobile?390:984,mobile?844:698,mobile);
      await enter(mobile,g1);await input(b,prompt);mode='lost';await click(b,'生成图片');
      await has(b,'查询进度不会再次生成或扣次数');
      assert.equal(posts.length,offset+1);const id=posts.at(-1);assert.match(id,/^[a-f\d-]{36}$/i);
      const stored=await b.js("Object.entries(localStorage).filter(([k])=>k.startsWith('lychee.image-job.'))");
      assert.equal(stored.length,1);assert.ok(stored[0][0].endsWith('.'+id));assert.match(stored[0][1],/^\d+$/);
      stage=viewport+' 离线再查询';
      await b.call('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await click(b,'查询生图结果');await has(b,'暂时连不上服务');await screenshot(b,viewport+'-offline');
      await b.call('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
      await has(b,'查询进度不会再次生成或扣次数');
      for(const picker of ['头像','圈子封面']){
        stage=viewport+' '+picker+'恢复同一任务';
        const entry=mobile?'/mobile/':'/windows/workspace.html';
        await b.call('Page.navigate',{url:origin+entry+'?garden='+g1});
        await until(()=>b.js("!!document.querySelector('.ga-circle-list')"),'圈子列表');
        if(picker==='头像'){
          if(mobile){await click(b,'我','nav.bottom button');await click(b,'编辑个人资料和头像');}
          else await click(b,'个人资料','.windows-nav button');
          await click(b,'✦ AI 生成');
        }else await click(b,'✦ AI 生成','.a62-circle-cover button');
        await until(()=>b.js("document.querySelector('.a62-modal .a624-image')?.innerText.includes('查询进度不会再次生成或扣次数')"),picker+'恢复');
        assert.equal(reads.at(-1).id,id);assert.equal(posts.length,offset+1);
      }
      stage=viewport+' 切园再重开';await enter(mobile,g2);await has(b,'生成图片');
      assert.equal(await b.js("document.body.innerText.includes('查询生图结果')"),false);
      jobs.set(id,{state:'ready',id:'remote-result-'+viewport,prompt:'服务端回读的描述'});
      await enter(mobile,g1);await has(b,'服务端回读的描述');await has(b,'本次使用 1 次生图额度');
      assert.equal(posts.length,offset+1);
      stage=viewport+' 页内原图';await click(b,'查看原图');await original(b);await screenshot(b,viewport+'-original');await click(b,'关闭原图');
      await click(b,'◷ 生成记录');await click(b,'相册回归图','.a62-gallery button');await click(b,'打开生成的原图');await original(b);
      await b.call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await b.call('Input.dispatchKeyEvent',{type:'keyUp',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
      await until(()=>b.js("!document.querySelector('dialog[open]')"),'Esc 关闭原图');
      stage=viewport+' 退款后明确重发';await click(b,'✎ 编辑');mode='refund';await click(b,'生成图片');await has(b,'次数已退回');
      const refunded=posts.at(-1);await enter(mobile,g1);await has(b,'次数已退回');assert.equal(posts.length,offset+2);
      await click(b,'返回编辑');await input(b,'新任务');mode='legacy';await click(b,'生成图片');await has(b,'同步结果');assert.notEqual(posts.at(-1),refunded);
      stage=viewport+' 202与missing';mode='missing';await click(b,'再来一张');await has(b,'正在生图');await click(b,'查询生图结果');await has(b,'暂未查到这次任务');
      await click(b,'结束本次查询');await has(b,'生成图片');
      for(const [kind,text] of [['disabled','AI 服务尚未配置'],['bad','请检查输入参数']]){
        const before=reads.length;mode=kind;await click(b,'生成图片');await has(b,text);await click(b,'返回编辑');
        assert.equal(reads.length,before);
      }
      assert.equal(posts.length,offset+6);assert.equal(await b.js("Object.keys(localStorage).filter(k=>k.startsWith('lychee.image-job.')).length"),0);
      report.views.push({viewport,size:mobile?[390,844]:[984,698],lostResponsePosts:1,pickersRecovered:['头像','圈子封面'],refundedPosts:1,explicitNewPosts:1,missingPosts:1,knownRejections:2,gardenIsolation:true,galleryDialog:true,escape:true,oldResponse:true});
    }
    assert.equal(new Set(posts).size,posts.length);
    assert.ok(reads.every(r=>r.path.startsWith('/g/'+g1+'/api/for/')));
    assert.deepEqual(b.errors,[]);assert.deepEqual(b.urls.filter(u=>/^https?:/.test(u)&&!u.startsWith(origin+'/')),[]);
    report.passed=true;
  }catch(error){report.failure={stage,error:error.message,screen:await b.js('document.body.innerText.slice(-800)').catch(()=>null)};throw error;}
  finally{await writeFile(join(evidence,'image-job-result.json'),JSON.stringify(report,null,2));}
});
