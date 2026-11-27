import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {listen} from '../server/index.mjs';
import {Browser,until} from './browser.mjs';

const dir=await mkdtemp(join(tmpdir(),'lychee-circle-games-'));
const server=await listen({dataDir:dir});
const browser=new Browser();
let cookie='';
const api=async(path,data)=>{
  const reply=await fetch(server.url+path,{method:data?'POST':'GET',headers:{cookie,origin:server.url,'content-type':'application/json'},body:data&&JSON.stringify(data)});
  const raw=await reply.text(); assert.equal(reply.status,200,path+' '+raw); const body=JSON.parse(raw);
  cookie=reply.headers.getSetCookie()[0]?.split(';')[0]||cookie;return body;
};
const click=label=>until(()=>browser.js(`(()=>{const e=[...document.querySelectorAll('button')].find(b=>b.offsetWidth&&!b.disabled&&(b.innerText.trim().split(/\\n/)[0]===${JSON.stringify(label)}||b.getAttribute('aria-label')===${JSON.stringify(label)}));if(e){e.click();return true}})()`),label);
try{
  await api('/api/v640/account',{mode:'register',name:'本机试玩',password:randomUUID()});
  const garden=(await api('/api/v640/workspace',{action:'create',name:'本机试玩园'})).activeGardenId;
  for(const item of (await api('/api/v640/workspace')).notices) await api('/api/v640/workspace',{action:'read',noticeId:item.id});
  const ownerCookie=cookie;
  const invite=(await api('/api/v640/workspace',{action:'invite',gardenId:garden})).inviteCode;
  cookie='';
  await api('/api/v640/account',{mode:'register',name:'乙账号',password:randomUUID()});
  const otherGarden=(await api('/api/v640/workspace',{action:'create',name:'隔离园'})).activeGardenId;
  assert.equal((await fetch(server.url+'/api/v640/workspace?members='+garden,{headers:{cookie}})).status,403);
  assert.equal((await fetch(server.url+'/api/v640/workspace?members='+garden)).status,401);
  await api('/api/v640/workspace',{action:'join',code:invite});
  await api('/g/'+garden+'/api/camp',{type:'profile',name:'圈内小乙',avatar:3,mood:'开心',action:'挥手'});
  cookie=ownerCookie;
  assert.equal((await fetch(server.url+'/api/v640/workspace?members='+otherGarden,{headers:{cookie}})).status,403);
  const roster=()=>api('/api/v640/workspace?members='+garden);
  assert.deepEqual((await roster()).members,[{name:'本机试玩',role:'owner'},{name:'圈内小乙',role:'member'}]);
  const db=new DatabaseSync(join(dir,'accounts.sqlite'));
  try {
    db.prepare("UPDATE mc_members SET role='owner' WHERE garden=?").run(garden);
    assert.equal((await roster()).members.filter(m=>m.role==='owner').length,2);
    db.prepare("UPDATE mc_members SET role='member' WHERE garden=?").run(garden);
    assert.equal((await roster()).members.filter(m=>m.role==='owner').length,0);
    db.prepare("UPDATE mc_members SET role='owner' WHERE garden=? AND slot=1").run(garden);
  } finally { db.close(); }
  await browser.open();
  const [name,value]=cookie.split('=');
  await browser.call('Network.setCookie',{name,value,url:server.url+'/',path:'/',secure:true,httpOnly:true});
  for(const phone of [false,true]){
    await browser.size(phone?390:984,phone?844:698,phone);
    await browser.call('Page.navigate',{url:server.url+(phone?'/mobile/':'/windows/workspace.html')+'?garden='+garden});
    await until(()=>browser.js("!!document.querySelector('.ga-circle-list')?.offsetWidth"),'园子列表');
    await click('圈成员 · 2人');
    await until(()=>browser.js("document.querySelector('.ga-roster')?.innerText.includes('圈内小乙')"),'圈内昵称');
    assert.match(await browser.js("document.querySelector('.ga-card').innerText"),/圈主：本机试玩/);
    await click('返回');
    if(phone)await click('工具箱');
    await click('海龟汤');
    await until(()=>browser.js("document.body.innerText.includes('跳过')||document.body.innerText.includes('自己玩')"),'玩法');
    const skip=await browser.js("[...document.querySelectorAll('button')].find(b=>b.offsetWidth&&b.innerText.includes('跳过'))?.innerText.trim()");
    if(skip)await click(skip);
    await click(phone?'和队友玩':'自己玩');
    await until(()=>browser.js("!!document.querySelector('select[aria-label=难度]')?.offsetWidth"),'选难度');
    const room=phone?'team':'solo';
    const endpoint='/g/'+garden+'/api/camp?soup=1&room='+room;
    const catalog=await api(endpoint),genre=phone?'微恐':'幻想';
    const level=['hard','medium','easy'].find(value=>catalog.counts[genre]?.[value]>0);
    assert.ok(level,'expected playable '+genre+' puzzles');
    await browser.js(`for(const [label,value] of ${JSON.stringify([['题型',genre],['难度',level]])}){
      const e=document.querySelector('select[aria-label='+label+']');e.value=value;e.dispatchEvent(new Event('change',{bubbles:true}));
    }`);
    await until(()=>browser.js("document.querySelector('.soup-controls small')?.innerText.includes('可抽')"),'可抽数量');
    await click('抽题开局');
    const round=await until(async()=>(await api(endpoint)).round,'抽到符合条件的题');
    assert.equal(round.difficulty,level);assert.ok(round.tags.includes(genre));assert.equal(round.solution,null);
    assert.equal((await api(endpoint)).round.id,round.id);
    await api('/g/'+garden+'/api/camp',{type:'soup',room,round:round.id,act:'reveal'});
    console.log(phone?'Mobile':'Windows', 'UI drew and preserved a matching round:',genre,level);
  }
}finally{
  await browser.close();await server.close();await rm(dir,{recursive:true});
}
