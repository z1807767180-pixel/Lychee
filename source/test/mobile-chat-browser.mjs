import assert from 'node:assert/strict';
import test from 'node:test';
import {createECDH,pbkdf2Sync,randomBytes,randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {listen} from '../server/index.mjs';
import {migrate} from '../server/migrate.mjs';
import {Browser,until} from './edge.mjs';

test('mobile release chat: two members, slow media, viewer, timing, channel unread and sender thumbnail',async t=>{
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  const dataDir=await mkdtemp(join(tmpdir(),'lychee-mobile-chat-'));
  const dbPath=join(dataDir,'old.sqlite'),fixture=new DatabaseSync(dbPath),password=randomUUID(),room=randomUUID();
  fixture.exec('CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY,username TEXT,salt TEXT,verifier TEXT); CREATE TABLE camp_sessions(token TEXT PRIMARY KEY,slot INTEGER,expires INTEGER); CREATE TABLE goal(id INTEGER PRIMARY KEY,start TEXT NOT NULL,target TEXT NOT NULL);');
  for(const [slot,name] of [[1,'发图人'],[2,'看图人']]){
    const salt=randomUUID();fixture.prepare('INSERT INTO camp_accounts VALUES(?,?,?,?)').run(slot,name,salt,pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex'));
  }
  fixture.exec('CREATE TABLE phone_circles_v1(team TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,subtitle TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL,PRIMARY KEY(team,id))');
  fixture.prepare('INSERT INTO phone_circles_v1(team,id,name,subtitle,created) VALUES(?,?,?,?,?)').run('garden-1',room,'旧版保留的频道','频道摘要',1);
  fixture.close();await migrate(dbPath,join(dataDir,'service'));
  const vapid=createECDH('prime256v1'),receiver=createECDH('prime256v1');vapid.generateKeys();
  const subscription={endpoint:'https://web.push.apple.com/local-fixture',keys:{
    p256dh:receiver.generateKeys().toString('base64url'),auth:randomBytes(16).toString('base64url')}};
  const sent=[];
  const realFetch=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,init)=>{
    if(url===subscription.endpoint){sent.push(init.body.byteLength);return new Response(null,{status:201});}
    assert.equal(new URL(url instanceof Request?url.url:url).hostname,'127.0.0.1');
    return realFetch(url,init);
  });
  const both={LYCHEE_VAPID_PRIVATE_KEY:vapid.getPrivateKey().toString('base64url'),LYCHEE_VAPID_SUBJECT:'mailto:test@example.invalid'};
  for(const [key,value] of Object.entries(both)){
    const old=process.env[key];process.env[key]=value;
    t.after(()=>{if(old===undefined)delete process.env[key];else process.env[key]=old;});
  }
  const app=await listen({dataDir:join(dataDir,'service'),webRoot:process.env.LYCHEE_REVIEW_WEB}),browser=new Browser();
  t.after(async()=>{try{await browser.close();}finally{await app.close();await rm(dataDir,{recursive:true,force:true});}});
  const actor=()=>{
    let cookie='';
    return {cookie:()=>cookie,async api(path,data){
      const res=await fetch(app.url+path,{method:data?'POST':'GET',headers:{cookie,origin:app.url,'Content-Type':'application/json'},body:data&&JSON.stringify(data)});
      const login=res.headers.getSetCookie().find(v=>v.startsWith('__Host-lychee-account='));
      if(login)cookie=login.split(';')[0];
      assert.equal(res.status,200,path+' '+(!res.ok?await res.text():''));
      return res.json();
    }};
  };
  const a=actor(),b=actor();
  for(const [who,name] of [[a,'发图人'],[b,'看图人']])await who.api('/api/v640/account',{mode:'login',name,password});
  const workspace='/api/v640/workspace',g='legacy',joined=await b.api(workspace);
  for(const n of joined.notices.filter(n=>!n.read))await b.api(workspace,{action:'read',noticeId:n.id});
  const api='/g/'+g+'/api/',camp=api+'camp',phone=api+'phone',circles=phone+'/circles';
  for(const who of [a,b])await who.api(camp);
  const add=(body,picture)=>a.api(camp,{type:'note',name:'发图人',avatar:0,key:randomUUID(),body,picture});
  await browser.open();await browser.size(390,844,true);
  const fixtureJpeg=(w,h)=>browser.js(`(()=>{const canvas=document.createElement('canvas');canvas.width=${w};canvas.height=${h};
    const ctx=canvas.getContext('2d');ctx.fillStyle='#a34530';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.fillStyle='#78ad59';ctx.fillRect(canvas.width/2,0,canvas.width/2,canvas.height);return canvas.toDataURL('image/jpeg').split(',')[1];})()`);
  await add('屏幕外图片',await fixtureJpeg(300,900));
  for(let i=0;i<24;i++)await add(i===3?'0':'聊天行 '+i);
  await add('已有原图',await fixtureJpeg(1000,250));
  async function channel(text){await a.api(circles+'?room='+room,{action:'send',clientId:randomUUID(),body:text,picture:'',replyTo:''});}
  await browser.call('Browser.grantPermissions',{origin:app.url,permissions:['notifications']});
  const [name,value]=b.cookie().split('=');
  await browser.call('Network.setCookie',{url:app.url+'/',name,value,path:'/',secure:true,httpOnly:true});
  // The underlying requests still use the release service and two real accounts. Only timing/one failure are controlled.
  await browser.call('Page.addScriptToEvaluateOnNewDocument',{source:`{
    const original=window.fetch;window.chatMedia=[];
    let subscription=null;
    PushManager.prototype.getSubscription=async()=>subscription;
    PushManager.prototype.subscribe=async options=>{
      if(!options.userVisibleOnly||options.applicationServerKey.byteLength!==65)throw Error('订阅参数无效');
      const fields=${JSON.stringify(subscription)};
      return subscription={...fields,options,toJSON:()=>fields,unsubscribe:async()=>{subscription=null;return true;}};
    };
    window.fetch=async(input,options)=>{
      const path=new URL(typeof input==='string'?input:input.url,location.href);
      if(path.searchParams.has('image')||/\\/face-\\d+\\.webp$/.test(path.pathname)){
        window.chatMedia.push(path.pathname+path.search);
        await new Promise(r=>setTimeout(r,650));
        if(path.searchParams.has('image')&&!window.failedPhoto){window.failedPhoto=true;return new Response('',{status:503});}
        if(path.pathname.includes('/face-')&&!window.failedAvatar){window.failedAvatar=true;return new Response('',{status:503});}
      }
      return original(input,options);
    };
  }`});
  await browser.call('Page.navigate',{url:app.url+'/mobile/?garden='+g});
  const js=q=>browser.js(q),wait=(expr,label)=>until(()=>js(expr),label),click=selector=>js('document.querySelector('+JSON.stringify(selector)+').click()');
  const badge='.mobile-chat-badge';
  await wait('document.querySelector(".mobile-chat-badge em")?.textContent==="26"','主园未读 26');
  const enable=await browser.call('Runtime.evaluate',{expression:'LycheeWebPush.enable()',awaitPromise:true,returnByValue:true,userGesture:true});
  assert.equal(enable.result.value?.enabled,true,'真实 SW 注册、VAPID 公钥及服务端设备登记');
  await js('window.dispatchEvent(new Event("lychee:push-changed"))');
  await click(badge);
  await wait('document.querySelector(".room-log")?.textContent.includes("已有原图")','聊天记录');
  assert.equal(await js('[...document.querySelectorAll(".room-content")].flatMap(e=>[...e.childNodes]).filter(n=>n.nodeType===Node.TEXT_NODE&&n.textContent.trim()==="0").length'),0);
  assert.equal(await js('[...document.querySelectorAll(".room-bubble")].filter(e=>e.textContent==="0").length'),1,'用户的 0 消息保留');
  assert.equal(await js('[...document.querySelectorAll(".mobile-chat-photo")].at(-1).textContent'),'','慢网加载没有文字占位');
  assert.equal(await js('getComputedStyle([...document.querySelectorAll(".mobile-chat-photo")].at(-1)).backgroundColor'),'rgba(0, 0, 0, 0)');
  await wait('document.querySelector(".mobile-chat-photo:not(:disabled)")?.textContent.includes("重试")','图片加载失败后可重试');
  assert.ok(await js('document.querySelector(".mobile-chat-avatar").textContent.trim().length>0'));
  await js('[...document.querySelectorAll(".mobile-chat-avatar")].find(el=>!el.disabled)?.click()');
  await wait('[...document.querySelectorAll(".mobile-chat-avatar img")].some(e=>e.naturalWidth>0)','头像重试');
  assert.equal(await js('chatMedia.filter(p=>p.includes("image=")).length'),1,'屏幕外的旧图不会抢带宽');
  await click('.mobile-chat-photo:not(:disabled)');
  await wait('[...document.querySelectorAll(".mobile-chat-photo img")].some(e=>e.naturalWidth>0)','第一次失败的图片可重试');
  const geometry=index=>js(`(()=>{const btn=[...document.querySelectorAll(".mobile-chat-photo")][${index}],img=btn.querySelector('img'),box=btn.getBoundingClientRect(),pic=img.getBoundingClientRect();
    return {w:box.width,h:box.height,pw:pic.width,ph:pic.height,iw:img.naturalWidth,ih:img.naturalHeight,bg:getComputedStyle(btn).backgroundColor,visible:getComputedStyle(img).visibility};})()`);
  function fits(size,ratio){
    assert.equal(size.iw/size.ih,ratio);assert.ok(Math.abs(size.w/size.h-ratio)<0.01,JSON.stringify(size));
    assert.equal(size.w,size.pw);assert.equal(size.h,size.ph);assert.equal(size.bg,'rgba(0, 0, 0, 0)');assert.equal(size.visible,'visible');
  }
  fits(await geometry(1),4);
  const photo='.mobile-chat-photo:has(img)';
  const oldRequests=await js('chatMedia.filter(p=>p.includes("image=")).length');
  for(const method of ['button','tap','swipe','back']){
    const top=await js('document.querySelector(".room-log").scrollTop-=25');
    await click(photo);
    await wait('document.querySelector("dialog[open] .image-viewport img")?.naturalWidth>0','查看真实旧图');
    if(method==='button')await click('dialog .image-toolbar button');
    if(method==='back')await js('history.back()');
    if(method==='tap'||method==='swipe'){
      const {x,y}=await js('(()=>{const r=document.querySelector("dialog .image-viewport").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()');
      await browser.call('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y}]});
      if(method==='swipe')await browser.call('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x,y:y+100}]});
      await browser.call('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    }
    await wait('!document.querySelector("dialog[open]")','关闭 '+method);
    assert.equal(await js('document.querySelector(".room-log").scrollTop'),top,method+' 保留滚动位置');
  }
  assert.equal(await js('chatMedia.filter(p=>p.includes("image=")).length'),oldRequests,'打开老图没有再次下载');
  assert.equal(await js('document.querySelectorAll(".mobile-chat-time").length'),1);
  // The client clears its message list at Beijing midnight. Check the separator directly for a replay spanning the boundary.
  assert.deepEqual(await js(`[1,4,5,6].map(minutes=>Boolean(LycheeMobileChat.timeLabel({createElement:()=>true},{created:1800000000000+minutes*60000},{created:1800000000000})))`),[false,false,true,true]);
  assert.match(await js(`LycheeMobileChat.timeLabel({createElement:(tag,props,value)=>value},{created:Date.parse('2026-11-27T00:01:00+08:00')},{created:Date.parse('2026-11-26T23:59:00+08:00')})`),/2026-11-27 00:01/);
  await until(async()=>!(await b.api(phone+'?v61=chat-inbox')).rooms.length,'主园已读扣减');
  const anchorY=await js(`(()=>{const log=document.querySelector('.room-log'),rows=log.querySelectorAll('.room-row');
    log.scrollTop+=rows[0].getBoundingClientRect().bottom-log.getBoundingClientRect().top+12;
    window.fixtureAnchor=rows[1];return fixtureAnchor.getBoundingClientRect().top;})()`);
  await wait('document.querySelector(".mobile-chat-photo[data-sized] img")?.naturalHeight===900','滚近竖图后自动加载');
  fits(await geometry(0),1/3);
  assert.ok(Math.abs(await js('fixtureAnchor.getBoundingClientRect().top')-anchorY)<1,'竖图在视区上方展开时正文不跳动');
  await add('翻看旧记录时的新消息');
  await wait('document.querySelector(".room-log").textContent.includes("翻看旧记录时的新消息")','停在历史位置时有新消息');
  assert.equal((await b.api(phone+'?v61=chat-inbox')).rooms.find(x=>x.room==='main')?.unread,1);
  await js('document.querySelector(".room-log").scrollTop=document.querySelector(".room-log").scrollHeight');
  await until(async()=>!(await b.api(phone+'?v61=chat-inbox')).rooms.length,'滑到新消息后扣减');
  await add('前台静默');await channel('频道未读');
  await wait('document.querySelector(".room-log").textContent.includes("前台静默")','前台收消息');
  await delay(8200);
  assert.equal(await js('document.querySelector(".v61-toast")?.textContent||""'),'');
  assert.equal(sent.length,0,'可见时不会向测试设备发送系统聊天推送');
  assert.deepEqual((await b.api(phone+'?v61=chat-inbox')).rooms.map(x=>[x.room,x.unread]),[[room,1]]);
  await click('.quick-chat-nav button');
  await wait('document.querySelector(".mobile-chat-badge em")?.textContent==="1"','其他页面显示频道未读');
  await click('.bottom button:nth-child(2)');
  await js('[...document.querySelectorAll(".garden-portals button")].find(b=>b.textContent.includes("园中事")).click()');
  await wait('document.querySelector(".mobile-journal-bubble em")?.textContent==="1"','园中事独立页头显示同一未读数');
  await click('button:has(.mobile-journal-bubble)');await wait('document.querySelector(".room-log")?.textContent.includes("频道未读")','角标打开正确频道');
  await until(async()=>!(await b.api(phone+'?v61=chat-inbox')).rooms.length,'频道已读扣减');
  // Exercise the normal photo composer, not a direct call to the thumbnail helper.
  await js(`(async()=>{const canvas=document.createElement('canvas');canvas.width=1000;canvas.height=700;
    const ctx=canvas.getContext('2d');for(let i=0;i<8000;i++){ctx.fillStyle='hsl('+i%360+' 70% 50%)';ctx.fillRect((i*83)%1000,(i*53)%700,20,16);}
    const blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg'));const transfer=new DataTransfer();
    transfer.items.add(new File([blob],'test.jpg',{type:'image/jpeg'}));const picker=document.querySelector('.room-compose [type=file]');
    picker.files=transfer.files;picker.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait('!document.querySelector(".room-send").disabled','发送选中的测试图片');
  await click('.room-send');
  await wait('document.querySelector(".mobile-chat-photo img")?.naturalWidth>0','频道小图');
  const notes=(await b.api(circles+'?room='+room)).notes,latest=notes.find(n=>n.hasImage);
  assert.ok(latest?.created,'频道带有服务端时间');
  const url=app.url+circles+'?room='+room+'&image='+latest.id;
  const pic=async name=>{const r=await fetch(url+name,{headers:{cookie:a.cookie()}});assert.equal(r.status,200);return [r.headers.get('X-Lychee-Preview'),(await r.arrayBuffer()).byteLength];};
  const small=await pic('&preview=1'),full=await pic('');
  assert.equal(small[0],'small');assert.equal(full[0],'original');assert.ok(small[1]<full[1]/2);
  const picture=Buffer.from(await (await fetch(url,{headers:{cookie:b.cookie()}})).arrayBuffer()).toString('base64');
  const key=randomUUID();
  await b.api(camp,{type:'note',key,name:'看图人',avatar:1,body:'主园图片',picture});
  const mainPreview=await fetch(app.url+camp+'?image=chat.2.'+key+'&preview=1',{headers:{cookie:a.cookie()}});
  assert.equal(mainPreview.headers.get('X-Lychee-Preview'),'small');
  assert.equal((await mainPreview.arrayBuffer()).byteLength,small[1]);
  t.diagnostic('频道新图预览 '+small[1]+' B，打开原图 '+full[1]+' B；已有图片打开四次均复用一次成功下载。');
  for(const [actor,w,h] of [[a,1000,250],[b,300,900]]){
    await actor.api(circles+'?room='+room,{action:'send',clientId:randomUUID(),body:'',picture:await fixtureJpeg(w,h),replyTo:''});
  }
  await wait('document.querySelectorAll(".garden-app[data-room-chat=true] .mobile-chat-photo[data-sized]").length===3','完整频道会话自动显示横竖图');
  const wide=await geometry(1), tall=await geometry(2);
  fits(wide,4);fits(tall,1/3);
  await until(async()=>!(await b.api(phone+'?v61=chat-inbox')).rooms.length,'读完频道中的新图片');
  if(process.env.LYCHEE_CHAT_EVIDENCE){
    const evidence=process.env.LYCHEE_CHAT_EVIDENCE;
    await writeFile(join(evidence,'photo-geometry.json'),JSON.stringify({wide,tall},null,2)+'\n');
    const shot=await browser.call('Page.captureScreenshot',{format:'png'});
    await writeFile(join(evidence,'photo-layout.png'),Buffer.from(shot.data,'base64'));
  }
  assert.deepEqual(browser.errors,[]);
  await browser.call('Page.navigate',{url:'about:blank'});
  await channel('离开网页后的后台通知');
  await until(()=>sent.length>0,'退出后使用已登记的订阅投递加密通知');
  assert.equal(sent.length,1);assert.ok(sent[0]>100);
  const inbox=(await b.api(phone+'?v61=notifications')).notifications;
  const alert=inbox.find(n=>n.kind==='room-chat'&&!n.read);
  let open,target,done;
  const worker={location:{origin:app.url},addEventListener:(kind,fn)=>{if(kind==='notificationclick')open=fn;},
    clients:{matchAll:async()=>[],openWindow:async url=>{target=url;}}};
  runInNewContext(await (await fetch(app.url+'/mobile/v61-sw.js')).text(),{self:worker,URL,URLSearchParams});
  open({notification:{data:{id:alert.id,scope:joined.account.id+'/'+g},close(){}},waitUntil:value=>done=value});
  await done;await browser.call('Page.navigate',{url:target});
  await wait('document.querySelector(".room-log")?.textContent.includes("离开网页后的后台通知")','冷启动准确打开历史频道');
  await until(async()=>!(await b.api(phone+'?v61=chat-inbox')).rooms.length,'系统通知进入频道后角标清零');
});
