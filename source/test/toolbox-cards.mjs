import assert from 'node:assert/strict';
import test from 'node:test';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {Browser,until} from './browser.mjs';
import {listen} from '../server/index.mjs';

const evidence=resolve(process.env.LYCHEE_TOOLBOX_EVIDENCE||'work/toolbox-700-review');
const targets=[['提醒事项','把小事交给荔枝'],['约定倒计时','园中共同约定'],['问一问','✎ 提问'],['番茄钟','专注记录'],['记账本','本月支出'],['照记饮食','今日饮食'],['交给命运','开始转动']];
const run=(browser,fn,...args)=>browser.js('('+fn.toString()+')('+args.map(v=>JSON.stringify(v)).join(',')+')');
async function click(browser,label,selector='button'){
  const point=await until(()=>run(browser,(label,selector)=>{
    const button=[...document.querySelectorAll(selector)].find(b=>b.getClientRects().length&&!b.disabled&&
      (b.getAttribute('aria-label')===label||b.innerText.trim().split(/\n/)[0]===label||b.innerText.trim()===label));
    if(!button)return;
    button.scrollIntoView({block:'center',behavior:'instant'});
    const r=button.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2;
    return button.contains(document.elementFromPoint(x,y))&&{x,y};
  },label,selector),label);
  for(const type of ['mousePressed','mouseReleased'])await browser.call('Input.dispatchMouseEvent',{type,...point,button:'left',clickCount:1});
}
const shown=(browser,selector)=>until(()=>run(browser,s=>!!document.querySelector(s)?.getClientRects().length,selector),selector);
const has=(browser,text)=>until(()=>run(browser,t=>document.body.innerText.includes(t),text),text);
async function screenshot(browser,name){
  const shot=await browser.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(evidence,name+'.png'),Buffer.from(shot.data,'base64'));
}
async function fill(browser,selector,text){
  await run(browser,s=>{const input=document.querySelector(s);input.focus();input.select();},selector);
  await browser.call('Input.insertText',{text});
}

test('工具箱七项、个人页和版本，以及记账与专注的跨端保存读回',async t=>{
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  const db=await mkdtemp(join(tmpdir(),'lychee-toolbox-'));
  const app=await listen({dataDir:db,webRoot:process.env.LYCHEE_REVIEW_WEB});
  const b=new Browser();
  t.after(async()=>{await b.close();await app.close();await rm(db,{recursive:true,force:true});});
  await mkdir(evidence,{recursive:true});
  const report={views:[]};
  let stage='创建隔离账号',cookie='';
  async function api(path,body){
    const r=await fetch(app.url+path,{method:'POST',headers:{origin:app.url,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
    assert.equal(r.status,200);
    const issued=r.headers.getSetCookie().find(v=>v.startsWith('__Host-lychee-account='));
    if(issued)cookie=issued.split(';')[0];
    return r.json();
  }
  try{
    await api('/api/v640/account',{mode:'register',name:'荔枝试用员',password:randomBytes(20).toString('hex')});
    const {activeGardenId:g}=await api('/api/v640/workspace',{action:'create',name:'周末茶园'});
    const state=await api('/api/v640/workspace',{action:'read',noticeId:'release-6.4.0'});
    const phone='/g/'+g+'/api/for/'+state.account.id+'/phone';
    const day=new Date(Date.now()+8*3600000).toISOString().slice(0,10);
    await api(phone,{type:'expense',id:randomUUID(),label:'原入口记下的午饭',category:'餐饮',cents:1700,day});
    await b.open();const [name,value]=cookie.split('=');
    await b.call('Network.setCookie',{url:app.url+'/',name,value,path:'/',secure:true,httpOnly:true});
    for(const [view,w,h,entry] of [['mobile',390,844,'/mobile/'],['windows',984,698,'/windows/workspace.html']]){
      const mobile=view==='mobile',result={view,w,h,destinations:[]};
      report.views.push(result);stage=view+' 工具箱首页';
      await b.size(w,h,mobile);await b.call('Page.navigate',{url:app.url+entry+'?garden='+g});
      await shown(b,'.ga-circle-list');await click(b,mobile?'工具箱':'全部工具',mobile?'nav.bottom button':'.windows-nav button');
      await shown(b,'.toolbox-shortcuts');
      await b.js('document.fonts.ready.then(()=>true)');
      await until(()=>b.js("[...document.querySelectorAll('.toolbox-shortcuts img')].every(i=>i.complete&&i.naturalWidth>0)"),'工具卡随包原图');
      result.build=await b.js('document.body.dataset.clientBuild');
      result.cards=await run(b,()=>{
        const grid=document.querySelector('.toolbox-shortcuts');
        grid.scrollIntoView({block:'center',behavior:'instant'});
        return [...grid.querySelectorAll('button')].map(e=>{
          const r=e.getBoundingClientRect(),img=e.querySelector('img'),x=r.x+r.width/2,y=r.y+r.height/2;
          return {title:e.innerText.trim(),art:new URL(img.currentSrc).pathname,width:Math.round(r.width),height:Math.round(r.height),
            y:Math.round(r.y),centerClickable:e.contains(document.elementFromPoint(x,y)),naturalSize:[img.naturalWidth,img.naturalHeight]};
        });
      });
      assert.deepEqual(result.cards.map(c=>c.title),targets.map(([title])=>title));
      const pair=result.cards.slice(-2);
      assert.deepEqual(pair.map(c=>c.art),['/client/diet-card-v7.webp','/client/wheel-card-v7.webp']);
      assert.ok(pair.every(c=>c.naturalSize[0]>=48&&c.naturalSize[0]===c.naturalSize[1]));
      assert.equal(result.build,'7.0.0');assert.equal(new Set(result.cards.map(c=>c.y)).size,mobile?3:2);
      assert.ok(result.cards.every(c=>c.centerClickable&&c.width>=44&&c.height>=44));
      assert.equal(await b.js("document.querySelector('.ph-scroll.tools').innerText.includes('园中事')"),false);
      assert.ok(await b.js("document.documentElement.scrollWidth<=innerWidth"));
      await screenshot(b,view+'-toolbox');
      if(mobile){
        const clip=await b.js(`(()=>{
          const cards=[...document.querySelectorAll('.toolbox-shortcuts button')].slice(-2);
          const [first,last]=cards.map(c=>c.getBoundingClientRect());
          return {x:first.left+scrollX-3,y:first.top+scrollY-3,width:last.right-first.left+6,height:last.bottom-first.top+6,scale:1};
        })()`);
        const shot=await b.call('Page.captureScreenshot',{format:'png',clip,captureBeyondViewport:false});
        await writeFile(join(evidence,'toolbox-card-pair.png'),Buffer.from(shot.data,'base64'));
      }
      for(const [name,detail] of targets){
        stage=view+' '+name;await click(b,name,'.toolbox-shortcuts button');
        await has(b,detail);
        if(name==='番茄钟'){
          if(mobile){
            await fill(b,'.focus-task input','整理书桌');await click(b,'开始专注');await has(b,'整理书桌');
            await click(b,'暂停');await has(b,'已暂停');
          }else{
            await has(b,'整理书桌');await has(b,'已暂停');await click(b,'继续计时');await has(b,'暂停');
          }
        }
        if(name==='记账本'){
          await has(b,'原入口记下的午饭');
          if(mobile){
            await click(b,'＋ 记一笔');await fill(b,'input[aria-label="金额"]','8.90');
            await fill(b,'input[placeholder="例如 午饭"]','午后茶点');await click(b,'保存');await has(b,'午后茶点');
          }else{
            await has(b,'午后茶点');await click(b,'午后茶点','.ledger-row');
            await fill(b,'input[aria-label="金额"]','9.80');await click(b,'保存修改');await has(b,'−¥9.80');
          }
        }
        await click(b,'返回');await shown(b,'.toolbox-shortcuts');
        result.destinations.push({name,detail,returned:true});
      }
      stage=view+' 我的入口与设置版本';
      await click(b,mobile?'我':'个人主页',mobile?'nav.bottom button':'.windows-nav button');
      await shown(b,'.profile-rows');const personal=await b.js("document.querySelector('.profile-rows').innerText");
      for(const label of ['通知中心','主题与头像','设置'])assert.ok(personal.includes(label),label);
      assert.ok(await b.js("document.querySelector('.profile-id[aria-label=\"编辑个人资料和头像\"]')?.getClientRects().length"));
      for(const label of ['提醒事项','番茄钟','账本'])assert.equal(personal.includes(label),false,label);
      await screenshot(b,view+'-profile');await click(b,'设置','.profile-rows button');await has(b,'当前版本 7.0.0');
      await screenshot(b,view+'-version');result.version='7.0.0';await click(b,'返回');await shown(b,'.profile-rows');
      stage=view+' 荔枝园中的园中事';await click(b,mobile?'荔枝园':'荔枝园首页',mobile?'nav.bottom button':'.windows-nav button');
      await click(b,'园中事','.garden-hub button');await has(b,'全部动态');await has(b,'我的收藏');await screenshot(b,view+'-garden-feed');
      result.gardenFeed=true;
    }
    const stored=await (await fetch(app.url+phone+'?private=1&tools=2&month='+day.slice(0,7),{headers:{cookie}})).json();
    assert.ok(stored.expenses.some(x=>x.label==='午后茶点'&&x.cents===980));
    assert.ok(stored.focus.some(x=>x.task==='整理书桌'&&x.pausedAt==null));
    report.persistence={seededExpenseCents:1700,mobileAddedCents:890,windowsEditedCents:980,mobilePaused:true,windowsResumed:true};
    assert.deepEqual(b.errors,[]);assert.deepEqual(b.urls.filter(u=>/^https?:/.test(u)&&!u.startsWith(app.url+'/')),[]);
    report.passed=true;
  }catch(e){
    report.failure={stage,message:e.message,screen:await b.js('document.body.innerText.slice(0,1100)').catch(()=>null)};
    throw Error(stage+' '+e.message,{cause:e});
  }finally{await writeFile(join(evidence,'toolbox-result.json'),JSON.stringify(report,null,2));}
});
