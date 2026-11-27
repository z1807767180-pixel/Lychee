// Run against a complete mobile distribution on a local-only SQLite instance.
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname,basename} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Browser,until} from './edge.mjs';
import {listen} from '../server/index.mjs';

const [website,output]=process.argv.slice(2);
if(!website||!output)throw Error('Usage: node social-trial-pages.mjs <local web root> <evidence directory>');
const folder=resolve(output),data=await mkdtemp(join(tmpdir(),'lychee-pages-'));
await mkdir(folder,{recursive:true});
const app=await listen({storage:'sqlite',host:'127.0.0.1',dataDir:data,webRoot:resolve(website)});
const me=new Browser(),peer=new Browser(),users=[{name:'青禾'},{name:'阿青'},{name:'小满'}];
const evidence={entry:'/mobile/',accounts:['青禾','阿青','小满'],screens:[]};
async function api(u,path,body,expected=200){
  const r=await fetch(app.url+path,{method:body?'POST':'GET',headers:{cookie:u.cookie||'',origin:app.url,'content-type':'application/json'},body:body&&JSON.stringify(body)});
  const v=await r.json();assert.equal(r.status,expected,JSON.stringify(v));
  u.cookie=r.headers.getSetCookie()[0]?.split(';')[0]||u.cookie;return v;
}
const social=(u,body,query='',status=200)=>api(u,'/api/v8/social?accountId='+u.id+query,body,status);
async function open(b,u){
  await b.open();await b.call('Emulation.setDeviceMetricsOverride',{width:394,height:846,mobile:true,deviceScaleFactor:2});
  const [name,value]=u.cookie.split('=');await b.call('Network.setCookie',{name,value,url:app.url+'/',path:'/',secure:true,httpOnly:true});
  await b.call('Page.navigate',{url:app.url+'/mobile/'});await wait(b,'!!document.querySelector(".s8-card")&&!document.querySelector("#lychee-launch")','账号首页');
}
async function wait(b,expression,label){return until(()=>b.js(expression),label);}
const sc=(b,expr,frame=false)=>b.js('(()=>{const d='+(frame?'document.querySelector("iframe")?.contentDocument':'document')+';if(!d)return null;return '+expr+'})()');
async function visible(b,text,frame=false){await until(()=>sc(b,'d.body.innerText.includes('+JSON.stringify(text)+')',frame),text);}
async function tap(b,label,frame=false){
  const value=JSON.stringify(label);
  await until(()=>sc(b,'(()=>{const e=[...d.querySelectorAll("button")].find(b=>b.offsetWidth>0&&!b.disabled&&(b.getAttribute("aria-label")==='+value+'||b.textContent.trim()==='+value+'));if(!e)return false;e.scrollIntoView({block:"nearest"});e.click();return true})()',frame),label);
}
async function fromHomeToPlans(b){
  await wait(b,'!!document.querySelector(".s8-card")','首页约定卡');
  await b.js('document.querySelector(".s8-card").click()');await visible(b,'我的计划');
}
async function chooseShared(b,group){
  await fromHomeToPlans(b);await tap(b,'共同计划');await tap(b,group);await visible(b,'园中共同约定',true);
}
async function fields(b,values,frame=false){
  await until(()=>sc(b,'[...d.querySelectorAll("form input:not([type=file]),form textarea")].filter(e=>e.offsetWidth>0).length==='+values.length,frame),'等待可编辑表单');
  const result=await sc(b,`(()=>{
    const inputs=[...d.querySelectorAll('form input:not([type=file]),form textarea')].filter(e=>e.offsetWidth>0);
    const values=${JSON.stringify(values)};if(inputs.length!==values.length)return inputs.map(e=>e.type);
    for(const [i,e] of inputs.entries()){
      const proto=e.tagName==='TEXTAREA'?d.defaultView.HTMLTextAreaElement.prototype:d.defaultView.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto,'value').set.call(e,values[i]);
      for(const type of ['input','change'])e.dispatchEvent(new d.defaultView.Event(type,{bubbles:true}));
    }return true;
  })()`,frame);assert.equal(result,true,JSON.stringify(result));
}
async function capture(b,file){
  await wait(b,'!document.querySelector("#lychee-launch")&&!document.querySelector("iframe")?.contentDocument?.querySelector("#lychee-launch")','截图前启动画面消失');
  await b.js('document.fonts.ready.then(()=>Promise.all([...document.images].map(i=>i.decode().catch(()=>{}))))');
  const shot=await b.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
  await writeFile(join(folder,file+'.png'),Buffer.from(shot.data,'base64'));evidence.screens.push(file+'.png');
}
async function home(b){await tap(b,'荔圈');await wait(b,'!!document.querySelector(".s8-card")','返回首页');}
async function showTimes(b,label,expected){
  await tap(b,label);await wait(b,'document.querySelector(".s8-log")?.innerText.includes("今天再确认")','实际聊天消息');
  const list=await b.js('Array.from(document.querySelector(".s8-log").children).map(e=>[e.tagName,e.querySelector("p")?.innerText||e.innerText])');
  const times=list.filter(([tag])=>tag==='TIME').map(([,v])=>v);
  assert.deepEqual(times,expected);
  assert.deepEqual(list.map(([tag])=>tag),['TIME','ARTICLE','ARTICLE','TIME','ARTICLE','TIME','ARTICLE']);
  await tap(b,'‹ 返回');return list;
}
try{
  const mobile=join(resolve(website),'mobile'),version=(await readFile(join(mobile,'version.txt'),'utf8')).trim();
  evidence.build={version,sha256:{}};
  for(const name of ['social-v8.js','social-chat.js','social-v8.css']){
    evidence.build.sha256[name]=createHash('sha256').update(await readFile(join(mobile,'assets-'+version,'client',name))).digest('hex');
  }
  for(const u of users){await api(u,'/api/v640/account',{mode:'register',name:u.name,password:randomUUID()});u.id=(await api(u,'/api/v640/workspace')).account.id;
    for(const n of (await api(u,'/api/v640/workspace?client=mobile-web')).notices.filter(n=>!n.read))await api(u,'/api/v640/workspace',{action:'read',noticeId:n.id});}
  const [a,b,c]=users;
  await social(a,{action:'friendRequest',accountId:b.id});await social(b,{action:'friendAccept',accountId:a.id});
  const group='周末写生组',id=(await social(a,{action:'groupCreate',name:group,friendIds:[b.id]})).id;
  const texts=['纸和画笔带齐了。','我带一块野餐垫。','四点在树下见。','今天再确认。'];
  const times=[[21,23,50],[21,23,54],[21,23,59],[22,0,1]].map(([d,h,m])=>new Date(2026,10,d,h,m).getTime());
  const db=new DatabaseSync(join(data,'accounts.sqlite'));try{
    for(const type of ['group','dm'])for(const [i,body] of texts.entries()){
      const actor=i%2?b:a,other=i%2?a:b;
      const item=await social(actor,{action:'message',...(type==='group'?{groupId:id}:{friendId:other.id}),body,clientId:randomUUID()});
      assert.equal(db.prepare('UPDATE mc_v8_entries SET created=? WHERE id=?').run(times[i],item.id).changes,1);
      if(type==='group'){
        const legacy=new DatabaseSync(join(data,'gardens',id+'.sqlite'));try{
          const mirrored=legacy.prepare("UPDATE notes SET created=? WHERE id LIKE ?").run(times[i],'chat.%.'+item.id);
          assert.equal(mirrored.changes,1);
        }finally{legacy.close();}
      }
    }
  }finally{db.close();}
  await open(me,a);await fromHomeToPlans(me);await tap(me,'＋ 新建');
  await fields(me,['去公园写生','2026-12-12T15:00','带速写本']);await tap(me,'添加约定');await visible(me,'去公园写生');
  await tap(me,'编辑');await fields(me,['去湖边写生','2026-12-13T16:00','带好画纸和铅笔']);await tap(me,'保存修改');await visible(me,'去湖边写生');
  await me.call('Page.reload');await wait(me,'!!document.querySelector(".s8-card")&&!document.querySelector("#lychee-launch")','重开');
  await fromHomeToPlans(me);await visible(me,'带好画纸和铅笔');await capture(me,'01-我的计划');
  const mine=(await social(a)).goals.find(g=>g.title==='去湖边写生');assert.equal(mine.due,new Date(2026,11,13,16).getTime());assert.equal(mine.body,'带好画纸和铅笔');
  assert.ok(!(await social(b)).goals.some(g=>g.id===mine.id));
  evidence.personal={title:mine.title,notes:mine.body,localDate:'2026-12-13 16:00',reload:true,privateFromFriend:true};
  await tap(me,'共同计划');await tap(me,group);await visible(me,'园中共同约定',true);
  const edit=await sc(me,'[...d.querySelectorAll("button")].find(b=>b.offsetWidth&&/^(设置|编辑)共同约定$/.test(b.innerText))?.innerText',true);
  await tap(me,edit,true);await fields(me,['沿湖写生','2026-12-13'],true);await tap(me,'保存共同约定',true);await visible(me,'沿湖写生',true);
  await tap(me,'编辑共同约定',true);await fields(me,['湖边写生集合','2026-12-14'],true);await tap(me,'保存共同约定',true);await visible(me,'湖边写生集合',true);
  await capture(me,'02-共同计划');
  await open(peer,b);await chooseShared(peer,group);await visible(peer,'湖边写生集合',true);
  await tap(peer,'编辑共同约定',true);const confirmed=await sc(peer,'[...d.querySelectorAll(".v61-form input")].map(i=>i.value)',true);assert.deepEqual(confirmed,['湖边写生集合','2026-12-14']);
  assert.ok(!(await social(c)).groups.some(g=>g.id===id));
  await social(c,null,'&view=group&id='+id,403);
  await api(c,'/g/'+id+'/api/for/'+c.id+'/camp',null,403);
  await api(c,'/g/'+id+'/api/for/'+c.id+'/phone',null,403);
  evidence.shared={group,title:confirmed[0],date:confirmed[1],memberReadViaUI:true,outsiderGroupResponse:403,outsiderCampResponse:403,outsiderPhoneResponse:403};
  await home(me);
  const expected=['2026年11月21日 23:50','23:59','2026年11月22日 00:01'];
  evidence.groupDividers=await showTimes(me,group,expected);evidence.privateDividers=await showTimes(me,'阿青',expected);
  await tap(me,'工具箱');await visible(me,'头脑王者');
  const categories=await me.js('Array.from(document.querySelectorAll(".s8-grid")).map(grid=>[grid.previousElementSibling.innerText,[...grid.querySelectorAll("b")].map(b=>b.innerText)])');
  assert.deepEqual(categories.map(([,v])=>v.length),[5,4,2]);assert.equal(new Set(categories.flatMap(([,v])=>v)).size,11);
  evidence.toolCategories=categories;await capture(me,'03-工具箱');
  await tap(me,'我');await visible(me,'头像与主题');await capture(me,'04-我');
  await me.js('document.querySelector(".s8-profile").click()');await visible(me,'个人资料');await wait(me,'!!document.querySelector("iframe")?.contentDocument?.querySelector("input")','个人资料内容');
  evidence.profileReached=true;await tap(me,'我');await tap(me,'设置');await visible(me,'手机网页 V');evidence.settingsReached=true;
  assert.deepEqual(me.errors,[]);assert.deepEqual(peer.errors,[]);evidence.passed=true;
  await writeFile(join(folder,'入口实测.json'),JSON.stringify(evidence,null,2));
}catch(error){console.error(error.message);for(const b of [me,peer])if(b.socket)console.error(await sc(b,'d.body.innerText.slice(-680)'),await sc(b,'d.body.innerText.slice(-680)',true));throw error;}
finally{await Promise.allSettled([me.close(),peer.close()]);await app.close();
  assert.equal(dirname(data),tmpdir());assert.match(basename(data),/^lychee-pages-[A-Za-z0-9]{6}$/);await rm(data,{recursive:true,force:true});}
