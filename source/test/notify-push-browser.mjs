import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Browser,until} from './edge.mjs';
import {listen} from '../server/index.mjs';

test('cold push click boots the notification garden in the actual mobile client and reads the exact chat',async t=>{
  if(process.env.LYCHEE_QA_EDGE_ISOLATED_HOST==='1')process.argv.push('--isolated-host');
  const dataDir=await mkdtemp(join(tmpdir(),'lychee-notify-push-ui-'));
  const app=await listen({dataDir,webRoot:process.env.LYCHEE_REVIEW_WEB});
  const browser=new Browser();
  t.after(async()=>{try{await browser.close();}finally{await app.close();await rm(dataDir,{recursive:true,force:true});}});
  function actor(){
    let cookie='';
    return {cookie:()=>cookie,async call(path,body){
      const res=await fetch(app.url+path,{method:body?'POST':'GET',headers:{origin:app.url,cookie,'content-type':'application/json'},body:body&&JSON.stringify(body)});
      const token=res.headers.getSetCookie().find(s=>s.startsWith('__Host-lychee-account='));
      if(token)cookie=token.split(';')[0];
      assert.equal(res.status,200,path);
      return res.json();
    }};
  }
  const a=actor(),b=actor();
  for(const [person,name] of [[a,'来源甲'],[b,'收到乙']])await person.call('/api/v640/account',{mode:'register',name,password:randomUUID()});
  const {activeGardenId:g}=await a.call('/api/v640/workspace',{action:'create',name:'通知所属园'});
  const {inviteCode}=await a.call('/api/v640/workspace',{action:'invite',gardenId:g});
  const joined=await b.call('/api/v640/workspace',{action:'join',code:inviteCode});
  for(const n of joined.notices.filter(n=>!n.read))await b.call('/api/v640/workspace',{action:'read',noticeId:n.id});
  await b.call('/g/'+g+'/api/camp?roster=lychee');
  await b.call('/api/v640/workspace',{action:'create',name:'上次打开的另一个园'});
  const key=randomUUID(),body='被通知打开的聊天 '+key;
  await a.call('/g/'+g+'/api/camp',{type:'note',key,name:'来源甲',avatar:0,body});
  const inboxRoute='/g/'+g+'/api/phone?v61=notifications',inbox=await b.call(inboxRoute);
  const row=inbox.notifications.find(x=>x.item==='chat.1.'+key);assert.ok(row&&!row.read);

  // Exercise the worker bytes actually served by this build. Only the OS's click
  // and openWindow handoff are supplied by the harness; the destination boots in Edge.
  let onClick,done,target;
  const self={location:{origin:app.url},addEventListener:(kind,fn)=>{if(kind==='notificationclick')onClick=fn;},
    clients:{matchAll:async()=>[],openWindow:async url=>{target=new URL(url,app.url).href;}}};
  const served=await fetch(app.url+'/mobile/v61-sw.js');assert.equal(served.status,200);
  const script=await served.text();
  assert.equal(script,await readFile(new URL('../client/notify-sw-v7.js',import.meta.url),'utf8'),'Rebuild the shared client before testing.');
  runInNewContext(script,{self,URL,URLSearchParams});
  onClick({notification:{data:{id:row.id,scope:joined.account.id+'/'+g},close(){}},waitUntil:p=>done=p});
  await done;
  await browser.open();
  const [name,value]=b.cookie().split('=');
  await browser.call('Network.setCookie',{url:app.url+'/',name,value,path:'/',secure:true,httpOnly:true});
  await browser.size(390,844,true);
  await browser.call('Page.navigate',{url:target});
  await until(()=>browser.js('window.LycheeAccess?.scope?.gardenId==='+JSON.stringify(g)),'通知所属园已启动');
  await until(()=>browser.js('Boolean(document.querySelector(\'[data-notice-item="'+row.item+'"]\')?.getClientRects().length)'),'目标聊天已呈现');
  assert.ok((await browser.js('document.body.innerText')).includes(body));
  await until(async()=>(await b.call(inboxRoute)).notifications.some(x=>x.id===row.id&&x.read),'对应收件箱记录已读');
});
