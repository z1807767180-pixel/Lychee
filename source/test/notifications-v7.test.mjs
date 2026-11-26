import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {createApp} from '../server/index.mjs';

test('independent signed-in members receive and reopen their own garden notifications',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'lychee-notify-'));
  const origin='http://127.0.0.1:7570';
  const app=await createApp({dataDir,webRoot:fileURLToPath(new URL('../source/web/',import.meta.url))});
  t.after(async()=>{await app.close();await rm(dataDir,{recursive:true,force:true});});
  function session(){
    let cookie='';
    return async(path,payload,status=200)=>{
      const result=await app.handle(new Request(origin+path,{method:payload?'POST':'GET',
        headers:{origin,cookie,'content-type':'application/json'},body:payload&&JSON.stringify(payload)}));
      assert.equal(result.status,status,path);
      for(const line of result.headers.getSetCookie()){
        if(line.startsWith('__Host-lychee-account='))cookie=line.split(';')[0];
      }
      return result.json();
    };
  }
  const owner=session(),friend=session(),outsider=session();
  const pass=randomUUID();
  for(const [client,name] of [[owner,'小雨'],[friend,'小树'],[outsider,'小溪']]){
    await client('/api/v640/account',{mode:'register',name,password:pass});
  }
  const g=(await owner('/api/v640/workspace',{action:'create',name:'测试小园'})).activeGardenId;
  const code=(await owner('/api/v640/workspace',{action:'invite',gardenId:g})).inviteCode;
  await friend('/api/v640/workspace',{action:'join',code});
  const api='/g/'+g+'/api/', inbox=api+'phone?v61=notifications';
  for(const client of [owner,friend])await client(api+'camp');
  const key=randomUUID(),note={type:'note',key,name:'小雨',avatar:0,body:'一起来吃饭吧'};
  await owner(api+'camp',note);await owner(api+'camp',note);
  const incoming=(await friend(inbox)).notifications;
  assert.equal(incoming.length,1);assert.equal(incoming[0].kind,'chat');assert.equal(incoming[0].read,false);
  assert.equal(incoming[0].item,'chat.1.'+key);
  assert.ok(!incoming[0].body.includes(note.body),'inbox keeps no copy of chat text');
  assert.deepEqual((await owner(inbox)).notifications,[]);
  await outsider(inbox,undefined,403);
  const reopened=session();await reopened('/api/v640/account',{mode:'login',name:'小树',password:pass});
  assert.equal((await reopened(inbox)).notifications[0].read,false);
  await reopened(api+'phone',{type:'v61-read',id:incoming[0].id});
  assert.equal((await friend(inbox)).notifications[0].read,true);
  await owner(api+'camp',{type:'recall',id:incoming[0].item});
  assert.deepEqual((await friend(inbox)).notifications,[]);
  const q=randomUUID();
  await friend(api+'phone',{type:'v61-question',id:q,category:'生活',title:'今天吃什么',body:''});
  await owner(api+'phone',{type:'v61-answer',id:randomUUID(),question:q,body:'饺子'});
  await owner(api+'phone',{type:'v61-reaction',kind:'question',id:q,active:true,emoji:'❤️'});
  assert.deepEqual((await friend(inbox)).notifications.map(x=>[x.kind,x.item]).sort(),[['answer',q],['question-reaction',q]]);
  const task=randomUUID();
  await friend(api+'phone',{type:'v61-task',id:task,title:'午饭',body:'',kind:'task',due:Date.now()-2000});
  assert.ok((await friend(inbox)).notifications.some(x=>x.kind==='reminder'&&x.item===task));
  assert.deepEqual((await owner(inbox)).notifications,[]);
  const yard=api+'phone?v62=yard';
  await owner(yard);
  const clock=new DatabaseSync(join(dataDir,'gardens',g+'.sqlite'));
  try{clock.prepare('UPDATE yard65_root SET planted=? WHERE id=1').run(Date.now()-8*86400000);}finally{clock.close();}
  await owner(yard,{type:'v62-yard',action:'pick',crop:1,slot:1});
  const gift={type:'v62-yard',action:'send',crop:1,slot:1,to:'2',note:'只给收件人的留言'};
  await owner(yard,gift);await owner(yard,gift);
  const gifts=(await friend(inbox)).notifications.filter(x=>x.kind==='gift');
  assert.equal(gifts.length,1);assert.equal(gifts[0].item,'1:1');
  assert.ok(!gifts[0].body.includes(gift.note));
  assert.deepEqual((await owner(inbox)).notifications,[]);
});
