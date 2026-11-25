import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { createTursoClient } from '../server/turso-client.mjs';
import { createTursoDomains } from '../server/turso-domains.mjs';
import { startTursoFixture } from './turso-fixture.mjs';

const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAaD3/2Q==','base64');
function actor(gardenId,slot=1){return {gardenId,slot,accountId:gardenId+'-'+slot,username:'用户'+slot};}
function request(domains,member,path,payload){
  const url=new URL(path,'http://127.0.0.1');
  return domains.handle(new Request(url,{method:payload?'POST':'GET',headers:{origin:url.origin,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined}),member);
}
async function json(p,status=200){
  const r=await p,body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;
}

test('Turso garden domains use original handlers, independent SQL objects and durable writes across instances',async t=>{
  const fixture=await startTursoFixture(),raw=await createTursoClient(fixture);
  const app1=createTursoDomains(fixture),app2=createTursoDomains(fixture);
  t.after(async()=>{await Promise.all([app1.close(),app2.close()]);raw.close();await fixture.close();});
  const a=actor(randomUUID(),4), b=actor(randomUUID(),4), legacy=actor('legacy'), id=randomUUID();
  for(const [m,title] of [[a,'甲园'],[b,'乙园'],[legacy,'旧园']]){
    const picture=Buffer.concat([Buffer.from([255,216,255,254,0,3,m===a?65:m===b?66:67]),jpeg.subarray(2)]);
    const state=await json(request(app1,m,'/api/camp'));
    assert.equal(state.me,String(m.slot));
    await json(request(app1,m,'/api/camp',{type:'note',key:id,name:m.username,avatar:0,body:title,picture:picture.toString('base64')}));
    assert.equal((await json(request(app2,m,'/api/camp'))).notes[0].body,title);
    await json(request(app1,m,'/api/phone',{type:'v61-task',id,kind:'task',title,body:'',due:Date.now()+3600000}));
    assert.deepEqual((await json(request(app2,m,'/api/phone?v61=personal'))).tasks.map(row=>row.title),[title]);
    await json(request(app1,m,'/api/phone',{type:'expense',id,label:title,cents:100,day:'2026-11-25',category:'其他'}));
    await json(request(app2,m,'/api/phone',{type:'edit-expense',id,label:title+'改',cents:200,day:'2026-11-25',category:'其他',revision:0}));
    assert.equal((await json(request(app1,m,'/api/phone?private=1&tools=2&month=2026-11'))).expenses[0].label,title+'改');
    assert.equal((await json(request(app1,m,'/api/phone/circles'))).circles[0].id,'main');
    await json(request(app1,m,'/api/phone',{type:'journal-post',id,kind:'plain',body:title,options:[],picture:picture.toString('base64'),album:'',prompt:''}));
    for(const route of ['/api/camp?image=chat.'+m.slot+'.'+id,'/api/phone?image='+id]){
      const r=await request(app2,m,route);
      assert.equal(r.headers.get('content-type'),'image/jpeg');
      assert.deepEqual(Buffer.from(await r.arrayBuffer()),picture);
    }
    assert.equal(typeof (await json(request(app2,m,'/api/camp?soup=1'))).ready,'boolean');
    assert.ok(await json(request(app2,m,'/api/phone?v62=yard')));
  }
  assert.deepEqual((await raw.execute('SELECT body FROM notes')).rows.map(row=>row.body),['旧园']);
  await raw.execute({sql:'UPDATE notes SET body=? WHERE id=?',args:['旧端改写','chat.1.'+id]});
  assert.equal((await json(request(app2,legacy,'/api/camp'))).notes[0].body,'旧端改写');
  const key=randomUUID(),p={type:'note',key,name:'用户4',avatar:1,body:'两实例重试'};
  await Promise.all([json(request(app1,a,'/api/camp',p)),json(request(app2,a,'/api/camp',p))]);
  assert.equal((await json(request(app1,a,'/api/camp'))).notes.filter(row=>row.body===p.body).length,1);
  const l4=actor('legacy',4);
  await json(request(app1,l4,'/api/camp',{type:'profile',name:'第四位',avatar:0,mood:'',action:'挥手'}));
  assert.equal((await json(request(app2,legacy,'/api/camp'))).members.find(row=>row.id==='4').name,'第四位');
  assert.deepEqual((await raw.execute('SELECT id FROM camp_profiles')).rows.map(row=>row.id),['1']);
  // In an old team a member without a profile may find their original default
  // already claimed by someone else. Profile creation must choose a free avatar.
  await raw.execute("UPDATE camp_profiles SET avatar=1 WHERE id='1'");
  const claimed=await json(request(app2,actor('legacy',2),'/api/camp'));
  assert.equal(claimed.members.find(row=>row.id==='1').avatar,1);
  assert.equal(claimed.members.find(row=>row.id==='2').avatar,0);
  await app1.close();
  const previousSchema=(await raw.execute('SELECT count(*) AS n FROM mc_domain_schema')).rows[0].n;
  const restarted=createTursoDomains(fixture);
  try{
    assert.equal((await json(request(restarted,a,'/api/phone?v61=personal'))).tasks[0].title,'甲园');
    assert.equal((await json(request(restarted,b,'/api/phone?v61=personal'))).tasks[0].title,'乙园');
    assert.equal((await raw.execute('SELECT count(*) AS n FROM mc_domain_schema')).rows[0].n,previousSchema);
  }finally{await restarted.close();}
});
