import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createQuizGames} from '../server/quiz-game.mjs';
import {points,drawQuestions} from '../server/quiz-rounds.mjs';
import {createTursoClient} from '../server/turso-client.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const categories = Array.from({length:16},(_,i) => ({id:String(i),group:Math.floor(i/4)}));
const bank = {categories,questions:categories.flatMap(c => [0,1].map(n => ({
  id:c.id+'-'+n, category:c.id, prompt:'测试题 '+c.id+'-'+n, options:['对','错一','错二','错三'],
  answer:0, explanation:'本地测试夹具',
})))};

test('五个不同类别、至少三种方向、优先未见；临界秒及末题分档',() => {
  const recent = new Map(categories.map(c=>[c.id+'-0',1]));
  for (let i=0;i<100;i++) {
    const round=drawQuestions(bank,recent);
    assert.equal(new Set(round.map(q=>q.category)).size,5);
    assert.ok(new Set(round.map(q=>categories[Number(q.category)].group)).size>=3);
    assert.ok(round.every(q=>q.id.endsWith('-1') && q.options[q.answer]==='对'));
  }
  for(const [time,normal] of [[-1,0],[0,200],[999,200],[1000,180],[8999,40],[9000,20],[9999,20],[10000,0]]) {
    assert.equal(points(0,time),normal);
    assert.equal(points(4,time),normal*2);
  }
});

for (const storage of ['SQLite','libSQL HTTP']) test(storage+' 实际语句：应战、平局、刷新、并发和断线结算',async t=>{
  let execute;
  if(storage==='SQLite') {
    const db=new DatabaseSync(':memory:');
    t.after(()=>db.close());
    execute=(sql,args)=>{const cmd=db.prepare(sql);return cmd.columns().length?
      {rows:cmd.all(...args)}:{rows:[],rowsAffected:cmd.run(...args).changes};};
  } else {
    const fixture=await startTursoFixture();
    const db=await createTursoClient(fixture);
    t.after(async()=>{db.close();await fixture.close();});
    execute=(sql,args)=>db.execute({sql,args});
  }
  for(const sql of [
    'CREATE TABLE mc_accounts(id TEXT PRIMARY KEY,username TEXT)',
    'CREATE TABLE mc_members(garden TEXT,account TEXT,slot INTEGER)',
    "INSERT INTO mc_accounts VALUES('a','甲'),('b','乙'),('c','丙')",
    "INSERT INTO mc_members VALUES('garden','a',1),('garden','b',2),('garden','c',3),('other','c',1)",
  ]) await execute(sql,[]);
  let now=1234000;
  const server=createQuizGames(execute,{clock:()=>now,getBank:async()=>bank});
  async function call(slot,body,query='',expected=200,garden='garden') {
    const response=await server(new Request('https://garden.example/api/v7/quiz'+query,
      {method:body?'POST':'GET',body:body&&JSON.stringify(body)}),{slot,gardenId:garden});
    const data=await response.json();assert.equal(response.status,expected,JSON.stringify(data));return data;
  }
  const match=randomUUID();
  const invite={id:match,action:'invite',guest:2}, accept={id:match,action:'accept'};
  await call(1,invite);await call(1,invite);
  assert.equal((await call(2)).invitations.length,1);
  await call(1,accept,'',403);await call(3,accept,'',403);
  await call(1,null,'?id='+match,404,'other');
  const both=await Promise.all([call(2,accept),call(2,accept)]);
  assert.equal(both[0].start,both[1].start);
  assert.equal(both[0].question,undefined);
  const get=(slot=1)=>call(slot,null,'?id='+match);
  let current=both[0];now=current.start;
  const first=await get(),right=first.question.options.indexOf('对');
  const answer=(slot,round,choice)=>call(slot,{id:match,action:'answer',round,choice});
  let chosen=await answer(1,0,right);
  assert.equal(chosen.myChoice,right);assert.deepEqual(chosen.scores,[0,0]);
  assert.equal((await get(2)).myChoice,null);assert.equal((await get(2)).answer,undefined);
  assert.equal((await answer(1,0,(right+1)%4)).myChoice,right);
  current=await answer(2,0,right);assert.deepEqual(current.scores,[200,200]);
  for(let round=1;round<5;round++) {
    now=current.next;
    const view=await get();assert.equal(view.round,round);
    now=view.deadline; // both miss, including an answer received on the deadline
    current=await answer(1,round,view.question.options.indexOf('对'));
    assert.deepEqual(current.scores,[200,200]);
  }
  now=current.next;
  const results=await Promise.all([get(1),get(2)]);
  assert.ok(results.every(r=>r.status==='done' && r.winner===null));
  assert.deepEqual((await call(1)).members.map(m=>[m.stars,m.played]),[[0,1],[0,1],[0,0]]);

  const next=randomUUID();await call(1,{...invite,id:next});
  const second=await call(2,{...accept,id:next});
  now=second.start+1000;
  const q=await call(1,null,'?id='+next);
  await call(1,{action:'answer',id:next,round:0,choice:q.question.options.indexOf('对')});
  // Both disconnect for five rounds. A subsequent visit settles all deadlines exactly once.
  now+=70000;
  await Promise.all([call(1),call(2)]);
  const finished=await call(2,null,'?id='+next);
  assert.deepEqual(finished.starChanges,[1,0]);assert.equal(finished.review.length,5);
  assert.deepEqual(finished.scores,[180,0]);assert.equal(finished.winner,0);
  assert.deepEqual((await call(1)).members.map(m=>[m.stars,m.played]),[[1,2],[0,2],[0,0]]);
  assert.deepEqual((await call(1,null,'',200,'other')).members.map(m=>m.played),[0]);

  // Host leads by 200 before the last round; a 2.4-second correct answer scores 320.
  const third=randomUUID();await call(1,{...invite,id:third});
  let view=await call(2,{...accept,id:third});
  for(let round=0;round<5;round++) {
    now=round===0?view.start:view.next;
    view=await call(1,null,'?id='+third);
    const right=view.question.options.indexOf('对'),wrong=(right+1)%4;
    if(round===4)now+=2400;
    await call(1,{id:third,action:'answer',round,choice:round===0?right:wrong});
    view=await call(2,{id:third,action:'answer',round,choice:round===4?right:wrong});
  }
  now=view.next;
  const comeback=await call(1,null,'?id='+third);
  assert.deepEqual(comeback.scores,[200,320]);assert.equal(comeback.winner,1);
  assert.deepEqual(comeback.starChanges,[-1,1]);
  assert.deepEqual((await call(2)).members.map(m=>[m.slot,m.stars]),[[2,1],[1,0],[3,0]]);

});
