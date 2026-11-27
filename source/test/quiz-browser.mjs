import assert from 'node:assert/strict';
import {mkdtemp,rm,cp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {listen} from '../server/index.mjs';
import {Browser,until} from './browser.mjs';

const root=await mkdtemp(join(tmpdir(),'lychee-quiz-browsers-'));
const web=join(root,'www');
await cp(resolve('source/public'),web,{recursive:true});
const phoneBuild=process.argv[2];
if(phoneBuild)await cp(resolve(phoneBuild,'mobile'),join(web,'mobile'),{recursive:true});
const out=process.argv[3];
if(out)await mkdir(out,{recursive:true});
const server=await listen({dataDir:join(root,'private'),webRoot:web});
const windows=new Browser(),mobile=new Browser();
async function api(user,path,body) {
  const res=await fetch(server.url+path,{method:body?'POST':'GET',headers:{
    cookie:user.cookie||'',origin:server.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const data=await res.json();assert.equal(res.status,200,JSON.stringify(data));
  user.cookie=res.headers.getSetCookie()[0]?.split(';')[0]||user.cookie;
  return data;
}
const a={},b={};
const workspace='/api/v640/workspace';
async function click(browser,label,partial=false) {
  return until(()=>browser.js(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.offsetWidth&&!b.disabled&&
    (b.innerText.trim()${partial?'.includes('+JSON.stringify(label)+')':'==='+JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(e){e.click();return true}})()`),label);
}
async function shot(browser,file) {
  if(out)await writeFile(join(out,file+'.png'),Buffer.from((await browser.call('Page.captureScreenshot',{format:'png'})).data,'base64'));
}
try {
  for(const [user,name] of [[a,'青荔'],[b,'小桂']])await api(user,'/api/v640/account',{mode:'register',name,password:randomUUID()});
  const garden=(await api(a,workspace,{action:'create',name:'好友问答测试园'})).activeGardenId;
  const code=(await api(a,workspace,{action:'invite',gardenId:garden})).inviteCode;
  await api(b,workspace,{action:'join',code});
  for(const [user,browser,isPhone] of [[a,windows,false],[b,mobile,true]]) {
    for(const suffix of ['', '?client=mobile-web']) {
      for(const n of (await api(user,workspace+suffix)).notices)await api(user,workspace,{action:'read',noticeId:n.id});
    }
    await browser.open();await browser.size(isPhone?390:980,isPhone?844:720,isPhone);
    const [name,value]=user.cookie.split('=');
    await browser.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
    await browser.call('Page.navigate',{url:server.url+(isPhone?'/mobile/':'/windows/workspace.html')+'?garden='+garden});
    await until(()=>browser.js("!!document.querySelector('.ga-circle-list')?.offsetWidth"),'大厅');
  }
  await click(windows,'头脑王者');
  await until(()=>windows.js("document.querySelector('.qz-ranks')?.innerText.includes('小桂')"),'园友排行');
  await shot(windows,'01-lobby-windows');await click(windows,'挑战园友');await click(windows,'挑战');
  await until(()=>windows.js("document.querySelector('.qz-invite')?.innerText.includes('等待')"),'待应战');
  // Open the main room just as a friend would, using the live chat note.
  await click(mobile,'聊天，0条未读').catch(()=>click(mobile,'聊天，',true)).catch(async()=>{
    await until(()=>mobile.js("(()=>{let e=document.querySelector('button.mobile-chat-badge');if(e){e.click();return true}})()"),'聊天按钮');
  });
  await click(mobile,'查看对局',true);await click(mobile,'应战');
  for(let round=0;round<5;round++) {
    const target='第 '+(round+1)+' / 5 题';
    for(const browser of [windows,mobile])await until(()=>browser.js(`document.querySelector('.qz-round')?.innerText.includes(${JSON.stringify(target)})&&!!document.querySelector('button.qz-option:not(:disabled)')`),'第'+(round+1)+'题');
    if(!round) {
      await shot(mobile,'02-question-mobile');
      assert.ok(await mobile.js('document.documentElement.scrollWidth<=innerWidth+1'));
    }
    // Both choose the same option. The server may put them into different elapsed-second buckets.
    await Promise.all([windows,mobile].map(browser=>browser.js("document.querySelector('button.qz-option:not(:disabled)').click()")));
  }
  for(const browser of [windows,mobile])await until(()=>browser.js("!!document.querySelector('.qz-result-art')"),'结算');
  await shot(mobile,'03-result-mobile');await click(windows,'再来一局');
  await until(()=>windows.js("!!document.querySelector('.qz-invite')"),'新邀请');
  await click(mobile,'查看本园排行');
  await until(()=>mobile.js("document.querySelector('.qz-ranks')?.innerText.includes('星')"),'成局榜单');
  assert.deepEqual(windows.errors,[]);assert.deepEqual(mobile.errors,[]);
  console.log('Windows layout + mobile release: two real accounts, inbox challenge, five questions, settlement, ranks and voluntary rematch passed.');
} catch(error) {
  for(const browser of [windows,mobile])if(browser.socket)console.error(await browser.js('document.body.innerText.slice(-2200)'),browser.errors,browser.responses.filter(r=>r[0]>=400).slice(-8));
  throw error;
} finally {
  await Promise.allSettled([windows.close(),mobile.close()]);
  await server.close();await rm(root,{recursive:true,force:true});
}
