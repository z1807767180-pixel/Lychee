const DAY = 86400000;
const tables = [
  "CREATE TABLE IF NOT EXISTS yard65_root (id INTEGER PRIMARY KEY, planted INTEGER NOT NULL, name TEXT NOT NULL DEFAULT '', named_by TEXT NOT NULL DEFAULT '')",
  "CREATE TABLE IF NOT EXISTS yard65_care (kind TEXT NOT NULL, slot TEXT NOT NULL, member TEXT NOT NULL, at INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(kind,slot))",
  "CREATE UNIQUE INDEX IF NOT EXISTS yard65_ribbon_member ON yard65_care(member) WHERE kind='ribbon'",
  "CREATE TABLE IF NOT EXISTS yard65_fruit (crop INTEGER NOT NULL, slot INTEGER NOT NULL, picker TEXT NOT NULL, picked INTEGER NOT NULL, recipient TEXT, note TEXT, sent INTEGER, opened INTEGER, PRIMARY KEY(crop,slot))",
  "CREATE INDEX IF NOT EXISTS yard65_inbox ON yard65_fruit(recipient,sent)"
];
const json = (data,status=200) => Response.json(data,{status,headers:{'Cache-Control':'private, no-store'}});
const fail = (message,status=409) => json({error:message},status);
const prepare = (db,sql,...args) => db.prepare(sql).bind(...args);
let initialized;
async function init(db) {
  if (!initialized) initialized=db.batch(tables.map(t=>db.prepare(t))).catch(e=>{initialized=undefined;throw e;});
  await initialized;
}
const today = now => Math.floor((now+8*3600000)/DAY);
function growth(planted, last, watered, careDays, now) {
  const elapsed = Math.max(0,now-(last?.finish ?? planted))/DAY + Math.min(3,careDays)/8;
  const crop=last ? Number(last.crop)+1 : 1;
  const thresholds=last ? [0,.85,1.8,3] : [0,.75,1.6,2.6,3.6,4.25,5,6];
  let stage=(last?4:0)+thresholds.reduce((n,t)=>n+Number(elapsed>=t),-1);
  if(!last && watered && stage===0) stage=1;
  return {stage,crop,elapsed,ripeDay:last?3:6,age:1+Math.floor(Math.max(0,now-planted)/DAY)};
}
async function state(db,me,now) {
  await init(db);
  const selectRoot=db.prepare("SELECT * FROM yard65_root WHERE id=1");
  let root=await selectRoot.first();
  if(!root) {
    const [,result]=await db.batch([prepare(db,"INSERT OR IGNORE INTO yard65_root(id,planted) VALUES(1,?)",now),selectRoot]);
    root=result.results[0];
  }
  const [last,ribbons,water,own,received,recent] = await db.batch([
    db.prepare("SELECT crop,MAX(picked) AS finish FROM yard65_fruit GROUP BY crop HAVING COUNT(*)=3 ORDER BY crop DESC LIMIT 1"),
    db.prepare("SELECT member,value,at FROM yard65_care WHERE kind='ribbon' ORDER BY at,slot"),
    prepare(db,`SELECT COUNT(*) AS anyWater, COUNT(DISTINCT substr(slot,1,instr(slot,':')-1)) AS careDays,
      EXISTS(SELECT 1 FROM yard65_care WHERE kind='water' AND slot=?) AS mine FROM yard65_care WHERE kind='water'
      AND at>COALESCE((SELECT MAX(finish) FROM (SELECT MAX(picked) AS finish FROM yard65_fruit GROUP BY crop HAVING COUNT(*)=3)),0)`,today(now)+':'+me),
    prepare(db,"SELECT crop,slot FROM yard65_fruit WHERE picker=? AND recipient IS NULL ORDER BY picked",me),
    prepare(db,"SELECT crop,slot,picker,opened,sent FROM yard65_fruit WHERE recipient=? ORDER BY (opened IS NULL) DESC,sent DESC LIMIT 40",me),
    db.prepare("SELECT kind,member,value,at FROM yard65_care ORDER BY at DESC LIMIT 30")
  ]);
  const g=growth(root.planted,last.results[0],water.results[0].anyWater,water.results[0].careDays,now);
  const [picked,photo]=await db.batch([
    prepare(db,"SELECT slot FROM yard65_fruit WHERE crop=?",g.crop),
    prepare(db,"SELECT member FROM yard65_care WHERE kind='photo' AND slot=?",String(g.crop))
  ]);
  const first=ribbons.results[0]?.value||'left';
  const fruit=[first,first==='left'?'right':'left',first].map((side,i)=>({
    slot:i+1,side,ripe:g.elapsed>=g.ripeDay+i*.35,picked:picked.results.some(x=>Number(x.slot)===i+1)
  }));
  return {name:root.name,namedBy:root.named_by,stage:g.stage,day:g.age,crop:g.crop,watered:!!water.results[0].mine,
    ribbons:ribbons.results,photo:photo.results[0]?.member||null,fruit,held:own.results,inbox:received.results,records:recent.results};
}
export async function readYard(db,me,now=Date.now()) {return json(await state(db,me,now));}
export async function actYard(db,me,p,now=Date.now()) {
  const st=await state(db,me,now);
  const run=(sql,...args)=>prepare(db,sql,...args).run();
  const first=(sql,...args)=>prepare(db,sql,...args).first();
  const action=p.action;
  if(action==='name') {
    const value=typeof p.value==='string'?p.value.trim():'';
    if(!value || [...value].length>12) return fail('树名限 1～12 个字',400);
    const changed=await run("UPDATE yard65_root SET name=?,named_by=? WHERE id=1 AND name=''",value,me);
    if(!changed.meta.changes && !(st.name===value && st.namedBy===me))return fail('树已经挂好名牌了');
  } else if(action==='water') {
    const side=p.side==='right'?'right':'left';
    await run("INSERT OR IGNORE INTO yard65_care VALUES('water',?,?,?,?)",today(now)+':'+me,me,now,side);
  } else if(action==='ribbon') {
    if(st.stage<2 || !['left','right'].includes(p.side))return fail('等小树长出枝条再来扶枝');
    await run("INSERT OR IGNORE INTO yard65_care VALUES('ribbon',?,?,?,?)",p.side,me,now,p.side);
    const bound=await first("SELECT member FROM yard65_care WHERE kind='ribbon' AND slot=?",p.side);
    if(bound?.member!==me)return fail('这根枝已被照料，或你已经系过布带');
  } else if(action==='photo') {
    if(p.crop!==st.crop || st.stage!==5)return fail('这只小访客已经飞走了');
    await run("INSERT OR IGNORE INTO yard65_care VALUES('photo',?,?,?,'butterfly')",String(st.crop),me,now);
  } else if(action==='pick') {
    const f=st.fruit.find(x=>x.slot===p.slot);
    const existing=await first("SELECT picker FROM yard65_fruit WHERE crop=? AND slot=?",Number(p.crop)||0,Number(p.slot)||0);
    if(existing)return existing.picker===me?json(await state(db,me,now)):fail('这颗荔枝刚被摘下了');
    if(st.crop!==p.crop || !f?.ripe)return fail('等荔枝变红才能摘');
    await run("INSERT OR IGNORE INTO yard65_fruit(crop,slot,picker,picked) VALUES(?,?,?,?)",st.crop,f.slot,me,now);
    if((await first("SELECT picker FROM yard65_fruit WHERE crop=? AND slot=?",st.crop,f.slot))?.picker!==me)return fail('这颗荔枝刚被摘下了');
  } else if(action==='send') {
    if(!Number.isSafeInteger(p.crop)||!Number.isSafeInteger(p.slot)||typeof p.to!=='string'||p.to===me||typeof p.note!=='string'||!p.note.trim()||[...p.note.trim()].length>120)return fail('请选择朋友并写下 1～120 字的留言',400);
    const note=p.note.trim();
    await run("UPDATE yard65_fruit SET recipient=?,note=?,sent=? WHERE crop=? AND slot=? AND picker=? AND recipient IS NULL AND EXISTS(SELECT 1 FROM camp_profiles WHERE id=?)",p.to,note,now,p.crop,p.slot,me,p.to);
    const f=await first("SELECT recipient,note FROM yard65_fruit WHERE crop=? AND slot=? AND picker=?",p.crop,p.slot,me);
    if(f?.recipient!==p.to || f?.note!==note)return fail('请检查收件人，这颗果实可能已经送出了');
  } else if(action==='open') {
    if(!Number.isSafeInteger(p.crop)||!Number.isSafeInteger(p.slot))return fail('无效纸签',400);
    const [,result]=await db.batch([
      prepare(db,"UPDATE yard65_fruit SET opened=COALESCE(opened,?) WHERE crop=? AND slot=? AND recipient=?",now,p.crop,p.slot,me),
      prepare(db,"SELECT picker,note FROM yard65_fruit WHERE crop=? AND slot=? AND recipient=?",p.crop,p.slot,me)
    ]);
    if(!result.results.length)return fail('找不到这张纸签',404);
    return json({state:await state(db,me,now),letter:result.results[0]});
  } else return fail('未知庭院操作',400);
  return json(await state(db,me,now));
}

