import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {DatabaseSync} from 'node:sqlite';
import {createApp} from '../server/index.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const origin='https://lychee.test';
for(const storage of ['sqlite','turso'])test('三账号两群真实会话、持久化、原资料和个人工具 '+storage,async()=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-social-'));
  const fixture=storage==='turso'?await startTursoFixture({databasePath:join(dir,'cloud.sqlite')}):null;
  const options={storage,dataDir:dir,webRoot:fileURLToPath(new URL('../source/web/',import.meta.url)),turso:fixture&&{url:fixture.url,authToken:fixture.authToken},origin};
  let app;
  try{
    app=await createApp(options);
    async function api(path,body,cookie,status=200){
      const response=await app.handle(new Request(origin+path,{method:body?'POST':'GET',headers:{origin,...(cookie?{cookie}:{}),...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}));
      const data=await response.json();
      assert.equal(response.status,status,path+' '+(body?.action??body?.type??'')+' '+JSON.stringify(data));
      return {data,cookie:response.headers.getSetCookie().find(c=>c.startsWith('__Host-lychee-account='))?.split(';')[0]};
    }
    async function register(name){
      const {cookie}=await api('/api/v640/account',{mode:'register',name,password:randomUUID()});
      const {data}=await api('/api/v640/workspace',null,cookie);
      return {id:data.account.id,name,cookie};
    }
    const a=await register('社交甲'),b=await register('社交乙'),c=await register('社交丙');
    const url=(u,view={})=>'/api/v8/social?'+new URLSearchParams({accountId:u.id,...view});
    const get=(u,view={},status=200)=>api(url(u,view),null,u.cookie,status).then(x=>x.data);
    const act=(u,action,data={},status=200)=>api(url(u),{action,...data},u.cookie,status).then(x=>x.data);
    const workspace=(u,body,status=200)=>api('/api/v640/workspace',body,u.cookie,status).then(x=>x.data);
    for(const who of [a,b,c])assert.deepEqual((await get(who)).groups,[]);
    const tools=(await get(a)).accountToolsGardenId;
    assert.notEqual(tools,(await get(b)).accountToolsGardenId);
    await api(url(a),null,null,401);
    await api(url(a),{action:'water'},b.cookie,403);
    await api('/api/v8/social',{action:'water'},a.cookie,403);
    const scoped=(u,id,route)=>'/g/'+id+'/api/for/'+u.id+'/'+route;
    const ownRoster=(await api(scoped(a,tools,'camp?roster=lychee'),null,a.cookie)).data;
    assert.equal(ownRoster.members.length,1);assert.equal(ownRoster.members[0].name,a.name);
    await api(scoped(b,tools,'camp?roster=lychee'),null,b.cookie,403);
    const names=(await api(scoped(a,tools,'camp?roster=circle-names'),null,a.cookie)).data.profiles;
    assert.deepEqual(names.map(p=>p.name),[a.name]);
    await api(scoped(b,tools,'camp?roster=circle-names'),null,b.cookie,403);
    await api(scoped(a,tools,'camp?roster=other'),null,a.cookie,403);
    await api(scoped(a,tools,'camp?roster=lychee&room=group'),null,a.cookie,403);
    await api(scoped(a,tools,'phone?private=1&tools=2'),null,a.cookie);
    const taskId=randomUUID();
    await api(scoped(a,tools,'phone'),{type:'v61-task',id:taskId,title:'个人待办',body:'自己',kind:'note',due:null},a.cookie);
    assert.ok((await api(scoped(a,tools,'phone?v61=personal'),null,a.cookie)).data.tasks.some(x=>x.id===taskId));
    await api(scoped(b,tools,'phone?v61=personal'),null,b.cookie,403);
    await api(scoped(a,tools,'camp'),{type:'note',key:randomUUID(),body:'拒绝私人工具群聊'},a.cookie,403);
    await workspace(a,{action:'invite',gardenId:tools},403);
    await act(a,'groupInvite',{groupId:tools,friendIds:[b.id]},403);
    assert.deepEqual((await workspace(a,null)).gardens,[]);
    const gate=await api('/api/v640/workspace?client=windows-8.0.0',null,a.cookie);
    assert.ok(gate.data.notices.some(n=>n.id==='windows-8.0.0'));
    assert.ok(!(await api('/api/v640/workspace?client=windows-7.0.6',null,a.cookie)).data.notices.some(n=>n.id==='windows-8.0.0'));
    for(const who of [b,c]){
      await act(a,'friendRequest',{name:who.name});
      await act(a,'friendAccept',{accountId:who.id},403);
      await act(a,'message',{friendId:who.id,body:'未通过不能私信',clientId:randomUUID()},403);
      assert.ok((await get(who)).requests.some(x=>x.id===a.id&&x.direction==='incoming'));
      await act(who,'friendAccept',{accountId:a.id});
    }
    await act(b,'friendRequest',{accountId:c.id});
    await act(c,'friendDecline',{accountId:b.id});
    const ga=(await act(a,'groupCreate',{name:'甲乙群',friendIds:[b.id]})).id;
    const gb=(await act(a,'groupCreate',{name:'甲丙群',friendIds:[c.id]})).id;
    const groupView=(u,id)=>get(u,{view:'group',id});
    const cover=(await groupView(a,ga)).group.cover;
    assert.equal((await groupView(b,ga)).group.cover,cover);
    assert.deepEqual((await groupView(a,ga)).members.map(x=>x.id),[a.id,b.id]);
    await get(c,{view:'group',id:ga},403);
    await act(b,'groupInvite',{groupId:ga,friendIds:[c.id]},403);
    await act(c,'groupCreate',{name:'不能部分创建',friendIds:[b.id]},403);
    assert.equal((await get(c)).groups.length,1);
    const groupMessage={groupId:ga,body:'甲乙可阅',clientId:randomUUID()};
    const sent=await act(a,'message',groupMessage);
    assert.equal((await act(a,'message',groupMessage)).id,sent.id);
    assert.ok((await api(scoped(b,ga,'camp'),null,b.cookie)).data.notes.some(n=>n.body==='甲乙可阅'));
    assert.equal((await groupView(b,ga)).messages.filter(n=>n.body==='甲乙可阅').length,1);
    assert.equal((await get(b)).groups.find(g=>g.id===ga).lastMessage.body,'甲乙可阅');
    await act(a,'message',{...groupMessage,body:'错误重用'},409);
    assert.equal((await get(b)).unread.groups,1);
    const groupPage=await groupView(b,ga);
    await act(a,'message',{...groupMessage,body:'在读取之后到达',clientId:randomUUID()});
    await act(b,'read',{groupId:ga,through:groupPage.through});
    assert.equal((await get(b)).unread.groups,1);
    const dm=await act(b,'message',{friendId:a.id,body:'双方私信',clientId:randomUUID()});
    assert.equal((await get(a)).friends.find(f=>f.id===b.id).lastMessage.body,'双方私信');
    assert.equal((await get(a)).unread.private,1);
    assert.ok((await get(a,{view:'dm',id:b.id})).messages.some(r=>r.id===dm.id));
    await get(c,{view:'dm',id:b.id},403);
    await act(c,'message',{friendId:b.id,body:'拒绝',clientId:randomUUID()},403);
    const post=(await act(a,'post',{kind:'feed',title:'动态',body:'好友可看',clientId:randomUUID()})).id;
    const question=(await act(a,'post',{kind:'questions',title:'问一问',clientId:randomUUID()})).id;
    assert.deepEqual((({feed,questions,garden})=>[feed,questions,garden])((await get(b)).unread),[1,1,2]);
    await act(b,'read',{kind:'feed',through:(await get(b,{view:'feed',kind:'feed'})).through});
    assert.equal((await get(b)).unread.garden,1);
    const reply=(await act(b,'reply',{postId:post,body:'乙的回答',clientId:randomUUID()})).id;
    assert.ok((await get(a,{view:'feed',kind:'feed'})).repliesToMe.some(r=>r.postId===post&&r.id===reply));
    assert.ok(!(await get(c,{view:'post',id:post})).replies.some(r=>r.id===reply));
    await act(c,'reply',{postId:post,replyTo:reply,body:'不能回陌生人的留言',clientId:randomUUID()},404);
    const privatePost=(await act(b,'post',{kind:'questions',title:'丙不可见',clientId:randomUUID()})).id;
    await get(c,{view:'post',id:privatePost},404);
    await act(c,'reply',{postId:privatePost,body:'不可回',clientId:randomUUID()},404);
    const oldId=randomUUID(),entry=randomUUID();
    for(const [person,garden,title] of [[a,ga,'本人旧约定甲'],[a,gb,'本人旧约定乙'],[b,ga,'乙的旧约定']]){
      await api(scoped(person,garden,'phone'),{type:'v61-goal',id:person===b?randomUUID():oldId,title,body:'留原处',due:1893456000000},person.cookie);
    }
    await api(scoped(a,ga,'camp'),{type:'note',name:a.name,avatar:0,key:entry,body:'旧主频道留言'},a.cookie);
    assert.ok((await groupView(b,ga)).messages.some(r=>r.source==='legacy'&&r.body==='旧主频道留言'));
    assert.equal((await get(b)).groups.find(g=>g.id===ga).lastMessage.body,'旧主频道留言');
    const photoId=randomUUID();
    await api(scoped(a,ga,'camp'),{type:'note',name:a.name,avatar:0,key:photoId,picture:'/9j/2Q==',body:''},a.cookie);
    const mixed=await groupView(b,ga);
    const photo=mixed.messages.find(x=>x.id.endsWith(photoId));
    assert.equal(photo.body,'[图片]');
    const image=await app.handle(new Request(origin+photo.imageUrl,{headers:{cookie:b.cookie}}));
    assert.equal(image.headers.get('Content-Type'),'image/jpeg');
    assert.deepEqual([...new Uint8Array(await image.arrayBuffer())],[255,216,255,217]);
    await act(b,'read',{groupId:ga,through:mixed.through,legacyThrough:mixed.legacyThrough});
    assert.equal((await get(b)).groups.find(g=>g.id===ga).unread,0);
    await api(scoped(a,ga,'camp'),{type:'recall',id:'chat.1.'+sent.id},a.cookie);
    assert.equal((await groupView(b,ga)).messages.find(n=>n.id===sent.id).body,'消息已撤回');
    const legacy=(await get(a)).goals;
    assert.deepEqual(legacy.map(g=>g.title).sort(),['本人旧约定甲','本人旧约定乙'].sort());
    assert.notEqual(legacy[0].id,legacy[1].id);
    await act(a,'goalDelete',{id:legacy[0].id},400);
    const goal=(await act(a,'goalSave',{title:'账号约定',due:1893456000000})).id;
    await act(b,'goalSave',{id:goal,title:'别人的约定',due:1893456000000},403);
    assert.ok(!(await get(b)).goals.some(g=>g.id===goal));
    await Promise.all([act(a,'water'),act(a,'water')]);
    assert.equal((await get(a,{view:'tree'})).tree.fruit,1);
    const gift={friendId:b.id,clientId:randomUUID()};
    const accepted=await Promise.all([act(a,'gift',gift),act(a,'gift',gift)]);
    assert.equal(accepted[0].id,accepted[1].id);
    assert.equal((await get(a)).tree.fruit,0);assert.equal((await get(b)).tree.fruit,1);
    await act(b,'gift',{friendId:c.id,clientId:randomUUID()},403);
    await act(a,'gift',{friendId:c.id,clientId:randomUUID()},409);
    await act(b,'groupLeave',{groupId:ga});
    await get(b,{view:'group',id:ga},403);
    await api(scoped(b,ga,'phone?v61=personal'),null,b.cookie,403);
    assert.ok((await get(b)).goals.some(g=>g.title==='乙的旧约定'));
    assert.ok((await get(b)).friends.some(f=>f.id===a.id));
    const code=(await workspace(a,{action:'invite',gardenId:ga})).inviteCode;
    await workspace(c,{action:'join',code});
    assert.equal((await groupView(c,ga)).members.find(m=>m.id===c.id).slot,3);
    assert.ok(!(await get(c)).goals.some(g=>g.title==='乙的旧约定'));
    await act(a,'groupInvite',{groupId:ga,friendIds:[b.id]});
    assert.equal((await groupView(a,ga)).members.find(m=>m.id===b.id).slot,2);
    await act(a,'groupLeave',{groupId:ga});
    assert.equal((await groupView(b,ga)).group.role,'owner');
    const jpeg=await readFile(new URL('../source/web/mobile/sticker-0.jpg',import.meta.url));
    const picture=jpeg.toString('base64'),key=randomUUID();
    const payload={friendId:b.id,clientId:key,picture,body:''};
    const [one,two]=await Promise.all([act(a,'message',payload),act(a,'message',payload)]);
    assert.equal(one.id,two.id);
    await act(a,'message',{...payload,picture:undefined,body:'[图片]'},409);
    await act(a,'message',{...payload,picture:(await readFile(new URL('../source/web/mobile/sticker-1.jpg',import.meta.url))).toString('base64')},409);
    for(const invalid of ['','////','/9j/'+('A'.repeat(384000)),null])await act(a,'message',{...payload,clientId:randomUUID(),picture:invalid},400);
    await act(c,'message',{...payload,friendId:b.id},403);
    const caption=await act(b,'message',{friendId:a.id,clientId:randomUUID(),picture,body:'喝杯茶'});
    const page=await get(b,{view:'dm',id:a.id});
    assert.equal(page.messages.filter(m=>m.id===one.id).length,1);
    const senderPage=await get(a,{view:'dm',id:b.id});
    const getPic=(path,cookie)=>app.handle(new Request(origin+path,{headers:cookie?{cookie}:{}}));
    for(const [u,rows] of [[a,senderPage],[b,page]]){
      const address=rows.messages.find(m=>m.id===one.id).imageUrl;
      const response=await getPic(address,u.cookie);
      assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');
      assert.match(response.headers.get('cache-control'),/no-store/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),jpeg);
      assert.equal((await getPic(address,c.cookie)).status,403);
      assert.equal((await getPic(address,null)).status,401);
      assert.equal(rows.messages.find(m=>m.id===one.id).body,'[图片]');
      assert.equal(rows.messages.find(m=>m.id===caption.id).body,'喝杯茶');
      assert.ok(!JSON.stringify(rows).includes(picture));
    }
    assert.equal((await get(a)).friends.find(f=>f.id===b.id).lastMessage.body,'喝杯茶');
    assert.ok(!JSON.stringify(await get(a)).includes(picture));
    await get(c,{view:'dmPhoto',id:a.id,messageId:one.id},404); // c is also a's friend, outside this conversation
    await get(a,{view:'dmPhoto',id:b.id,messageId:dm.id},404); // text-only historical message
    await app.close();app=await createApp(options);
    const persisted=await getPic(page.messages.find(m=>m.id===one.id).imageUrl,b.cookie);
    assert.deepEqual(Buffer.from(await persisted.arrayBuffer()),jpeg);
    assert.equal((await get(b,{view:'tree'})).gifts.length,1);
    assert.equal((await groupView(b,ga)).group.cover,cover);
    assert.equal((await get(a,{view:'post',id:question})).post.id,question);
    assert.ok((await get(a)).goals.some(g=>g.id===goal));
    if(fixture){
      const before=fixture.counts.pipelines;
      await get(c);
      console.log('同一账号两群首页的 Turso HTTP 往返数',fixture.counts.pipelines-before);
    }
    assert.equal((await get(b,{view:'dm',id:a.id})).messages[0].id,dm.id);
    // Break an ownership link in this synthetic fixture. Read-only aggregation
    // must skip that garden, not infer a match from the numeric slot alone.
    const prefix=fixture?'g_'+ga.replaceAll('-','')+'_':'';
    const db=fixture?fixture.sqlite:new DatabaseSync(join(dir,'gardens',ga+'.sqlite'));
    try{
      db.prepare('DELETE FROM '+prefix+'garden_member_bindings WHERE slot=?').run(1);
      assert.ok(!(await get(a)).goals.some(g=>g.title==='本人旧约定甲'));
      assert.ok((await get(a)).goals.some(g=>g.title==='本人旧约定乙'));
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM '+prefix+'v61_goals WHERE member=?').get('1').n,1);
    }finally{if(!fixture)db.close();}
  }finally{await app?.close();await fixture?.close();await rm(dir,{recursive:true,force:true});}
});

