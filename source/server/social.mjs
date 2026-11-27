import {createHash,randomUUID} from 'node:crypto';
import {InputError,reject,json,joinMembership,gardenText} from './accounts.mjs';
import {socialStore} from './social-store.mjs';
import {socialHistory} from './social-history.mjs';
import {getPlay,changePlay,playRoom} from './social-play.mjs';

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const day=()=>new Date(Date.now()+28800000).toISOString().slice(0,10);
const pair=(a,b)=>[a,b].sort();
const covers=['/mobile/break-room.webp','/mobile/tile-garden.webp','/mobile/garden-feed.webp'];
const cover=id=>covers[createHash('sha256').update(id).digest()[0]%covers.length];
const assertUuid=value=>{if(typeof value!=='string'||!uuid.test(value))reject(400,'标识无效');return value;};
const text=(value,max,empty=false)=>{
  if(typeof value!=='string'||value.trim().length>max||(!empty&&!value.trim())||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))reject(400,'请检查文字内容和长度');
  return value.trim();
};
const validKind=k=>{if(k!=='feed'&&k!=='questions')reject(400,'栏目无效');return k;};
export function accountToolsGarden(account){
  const hex=createHash('sha256').update('lychee/v8/private-tools/'+account).digest('hex');
  // UUID v5 format is disjoint from all UUID v4 gardens created by the product.
  return [hex.slice(0,8),hex.slice(8,12),'5'+hex.slice(13,16),'8'+hex.slice(17,20),hex.slice(20,32)].join('-');
}
const groupSelect="SELECT g.id,g.name,g.subtitle,m.role,m.slot AS selfSlot,(SELECT COUNT(*) FROM mc_members others WHERE others.garden=g.id) AS memberCount,"+
  "(SELECT COUNT(*) FROM mc_v8_entries e WHERE e.kind='group' AND e.scope=g.id AND e.author<>m.account AND e.seq>COALESCE((SELECT through FROM mc_v8_reads r WHERE r.account=m.account AND r.scope='group:'||g.id),0)) AS unread "+
  'FROM mc_members m JOIN mc_gardens g ON g.id=m.garden WHERE m.account=?';
const groupFields=g=>({...g,cover:cover(g.id)});
async function group(q,me,id){
  if(typeof id!=='string')reject(400,'请选择群聊');
  const g=await q.first(groupSelect+' AND g.id=?',me,id);
  if(!g)reject(403,'你不在这个群聊中');
  return groupFields(g);
}
const friendsCte='WITH viewer(me) AS (VALUES(?)), peers(id) AS (SELECT CASE WHEN lo=me THEN hi ELSE lo END FROM mc_v8_friends,viewer WHERE accepted=1 AND (lo=me OR hi=me)) ';
const feedCte=friendsCte.trimEnd()+', roots AS (SELECT e.* FROM mc_v8_entries e,viewer WHERE e.kind=? AND (e.author=me OR e.author IN peers)), '+
  "visible AS (SELECT r.seq,r.id,r.author,r.id AS postId,r.author AS owner,r.kind,r.title,r.body,r.created,r.reply_to FROM roots r UNION ALL "+
  "SELECT e.seq,e.id,e.author,p.id,p.author,e.kind,e.title,e.body,e.created,e.reply_to FROM mc_v8_entries e JOIN roots p ON e.scope=p.id,viewer WHERE e.kind='reply' AND (e.author=me OR e.author IN peers)) ";
async function feedInfo(q,me,kind){
  return q.first(feedCte+"SELECT COALESCE(MAX(seq),0) AS through,COUNT(CASE WHEN author<>? AND seq>COALESCE((SELECT through FROM mc_v8_reads WHERE account=? AND scope=?),0) THEN 1 END) AS unread FROM visible",me,kind,me,me,kind);
}
async function friend(q,me,id){
  assertUuid(id);
  const row=await q.first('SELECT a.id,a.username AS name FROM mc_v8_friends f JOIN mc_accounts a ON a.id=? WHERE f.lo=? AND f.hi=? AND f.accepted=1',id,...pair(me,id));
  if(!row)reject(403,'请先成为好友');
  return row;
}
async function roster(q,me,id){
  return q.all("SELECT a.id,a.username AS name,m.role,m.slot,CASE WHEN a.id=? THEN 'self' WHEN f.accepted=1 THEN 'friend' WHEN f.sender=? THEN 'outgoing' WHEN f.sender IS NOT NULL THEN 'incoming' ELSE 'none' END AS friendStatus "+
    'FROM mc_members m JOIN mc_accounts a ON a.id=m.account LEFT JOIN mc_v8_friends f ON f.lo=MIN(a.id,?) AND f.hi=MAX(a.id,?) WHERE m.garden=? ORDER BY m.slot',me,me,me,me,id);
}
async function tree(q,me){
  const r=await q.first("SELECT COALESCE(t.fruit,0) AS fruit,COALESCE(t.water_count,0) AS waterCount,COALESCE(t.last_day,'') AS lastDay,COALESCE(g.progress,0) AS progress FROM (SELECT ? AS owner) p LEFT JOIN mc_v8_trees t ON t.account=p.owner LEFT JOIN mc_v8_tree_growth g ON g.account=p.owner",me);
  return {...r,wateredToday:r.lastDay===day(),mature:r.progress===3};
}
async function planList(q,me,groups,personal,original,history){
  const [sharedGoals,choice]=await Promise.all([history.sharedGoals(q,groups),q.first('SELECT goal FROM mc_v8_goal_choice WHERE account=?',me)]);
  const goals=[...personal,...original].sort((a,b)=>a.due-b.due||a.id.localeCompare(b.id));
  const bannerGoals=[...goals,...sharedGoals].sort((a,b)=>a.due-b.due||a.id.localeCompare(b.id));
  const selectedGoalId=bannerGoals.length===1?bannerGoals[0].id:bannerGoals.find(g=>g.id===choice?.goal)?.id||null;
  return {goals,sharedGoals,bannerGoals,selectedGoalId};
}
async function messages(q,kind,scope,before){
  const params=[kind,scope];
  let filter='';
  if(before){const n=Number(before);if(!Number.isSafeInteger(n)||n<1)reject(400,'无效的翻页位置');filter=' AND seq<?';params.push(n);}
  const rows=await q.all('SELECT e.seq,e.id,e.author AS authorId,a.username AS name,e.body,e.created FROM mc_v8_entries e JOIN mc_accounts a ON a.id=e.author WHERE kind=? AND scope=?'+filter+' ORDER BY seq DESC LIMIT 100',...params);
  return {messages:rows.reverse(),through:rows.at(-1)?.seq??0,before:rows[0]?.seq??0};
}
function legacyCursor(rows){
  const last=rows.at(-1);
  return last?last.created+':'+last.ordinal:'0:0';
}
async function pinMessage(q,history,me,scope,id){
  if(!id)return null;
  const item=id.startsWith('chat.')
    ?(await history.chat(q,scope,me,id))[0]
    :await q.first("SELECT e.id,e.seq,e.body,e.created,e.author AS authorId,a.username AS name FROM mc_v8_entries e JOIN mc_accounts a ON a.id=e.author WHERE e.id=? AND e.kind='group' AND e.scope=?",id,scope);
  return item&&item.body!=='消息已撤回'?item:null;
}
async function addPreviews(q,me,groups,friends,history){
  const [received,readRows,old]=await Promise.all([
    q.all("SELECT scope,kind,name,body,created FROM (SELECT e.scope,e.kind,a.username AS name,e.body,e.created,ROW_NUMBER() OVER(PARTITION BY kind,scope ORDER BY seq DESC) AS place FROM mc_v8_entries e JOIN mc_accounts a ON a.id=e.author WHERE (kind='group' AND scope IN (SELECT garden FROM mc_members WHERE account=?)) OR (kind='dm' AND scope IN (SELECT lo||':'||hi FROM mc_v8_friends WHERE accepted=1 AND (lo=? OR hi=?)))) WHERE place=1",me,me,me),
    q.all('SELECT garden,created,ordinal FROM mc_v8_legacy_reads WHERE account=?',me),
    Promise.all(groups.map(g=>history.chat(q,g.id,me)))]);
  const recents=new Map(received.map(({scope,kind,...r})=>[kind+scope,r]));
  const reads=new Map(readRows.map(r=>[r.garden,r]));
  for(const [i,g] of groups.entries()){
    const existing=old[i],last=existing.at(-1),read=reads.get(g.id);
    g.unread+=existing.filter(x=>x.authorId!==me && (!read||x.created>read.created||(x.created===read.created&&x.ordinal>read.ordinal))).length;
    const fresh=recents.get('group'+g.id);
    g.lastMessage=last&&(!fresh||last.created>fresh.created)?{body:last.body,name:last.name,created:last.created}:fresh??null;
  }
  for(const f of friends)f.lastMessage=recents.get('dm'+pair(me,f.id).join(':'))??null;
}
const fields='v.id,v.seq,v.author AS authorId,a.username AS name,v.title,v.body,v.created,v.postId,v.kind,v.reply_to AS replyTo';
const gardenEmoji=new Set(['⭐','❤️','👍','✈️']);
async function rootFor(q,me,id){
  const row=await q.first(friendsCte+"SELECT e.kind FROM mc_v8_entries e,viewer WHERE e.id=? AND e.kind IN ('feed','questions') AND (author=me OR author IN peers)",me,assertUuid(id));
  if(!row)reject(404,'内容不可见');return row;
}
async function enrichGarden(q,me,kind,items){
  if(!items.length)return;
  // Join each attachment and response through the viewer's allowed root/peer set.
  const [previews,counts,pictures]=await Promise.all([
    q.all(feedCte+"SELECT * FROM (SELECT "+fields+",ROW_NUMBER() OVER(PARTITION BY postId ORDER BY seq) AS pos FROM visible v JOIN mc_accounts a ON a.id=v.author WHERE v.kind='reply' AND (?='feed' OR v.reply_to IS NULL OR NOT EXISTS(SELECT 1 FROM visible parent WHERE parent.id=v.reply_to AND parent.kind='reply'))) WHERE pos<=2 ORDER BY seq",me,kind,kind),
    kind==='feed'?q.all(feedCte+"SELECT x.post,x.emoji,COUNT(*) AS total,MAX(x.account=me) AS mine FROM mc_v81_post_reaction x JOIN roots r ON r.id=x.post,viewer WHERE x.account=me OR x.account IN peers GROUP BY x.post,x.emoji ORDER BY x.emoji",me,kind):[],
    kind==='feed'?q.all(feedCte+"SELECT x.post FROM mc_v81_post_photo x JOIN roots r ON r.id=x.post",me,kind):[]
  ]);
  const map=new Map(items.map(item=>[item.id,item]));
  for(const row of previews){const it=map.get(row.postId);if(it)(it.preview??=[]).push(row);}
  for(const row of counts){const it=map.get(row.post);if(it)(it.reactions??=[]).push({emoji:row.emoji,count:row.total,mine:!!row.mine});}
  for(const row of pictures){const it=map.get(row.post);if(it)it.hasPhoto=true;}
}
async function get(q,session,params,history){
  const me=session.accountId,id=params.get('id'),view=params.get('view')||'home';
  if(view==='playLobby'||view==='playMatch')return getPlay(q,me,view,params);
  if(view==='friendLookup'){
    const name=text(params.get('name'),14);
    const match=await q.first('SELECT id,username AS name FROM mc_accounts WHERE username=? AND id<>?',name,me);
    return {match:match||null};
  }
  if(view==='myStatus'){
    const saved=await q.first('SELECT status FROM mc_v81_my_status WHERE account=?',me);
    return {status:saved?.status??null};
  }
  if(view==='friendProfile'){
    const person=await friend(q,me,id);
    const groups=await q.all("SELECT g.id,g.name,other.slot FROM mc_members mine JOIN mc_members other ON other.garden=mine.garden JOIN mc_gardens g ON g.id=mine.garden WHERE mine.account=? AND other.account=? ORDER BY g.name,g.id",me,person.id);
    return {person,groups};
  }
  if(view==='home'){
    const [groupRows,friends,requests,goals,originalGoals,plant,feedState,questionState]=await Promise.all([
      q.all(groupSelect+' ORDER BY g.name,g.id',me),
      q.all(friendsCte+"SELECT a.id,a.username AS name,(SELECT COUNT(*) FROM mc_v8_entries e WHERE e.kind='dm' AND e.author=a.id AND e.scope=MIN(a.id,me)||':'||MAX(a.id,me) AND e.seq>COALESCE((SELECT through FROM mc_v8_reads r WHERE r.account=me AND r.scope='dm:'||a.id),0)) AS unread FROM peers JOIN mc_accounts a ON a.id=peers.id,viewer ORDER BY a.username",me),
      q.all("SELECT a.id,a.username AS name,CASE WHEN f.sender=? THEN 'outgoing' ELSE 'incoming' END AS direction FROM mc_v8_friends f JOIN mc_accounts a ON a.id=CASE WHEN f.lo=? THEN f.hi ELSE f.lo END WHERE f.accepted=0 AND (f.lo=? OR f.hi=?) ORDER BY a.username",me,me,me,me),
      q.all("SELECT id,title,body,due,created,'account' AS source FROM mc_v8_goals WHERE account=?",me),
      history.goals(q,me),tree(q,me),feedInfo(q,me,'feed'),feedInfo(q,me,'questions')]);
    const groups=groupRows.map(groupFields);
    const [plans]=await Promise.all([planList(q,me,groups,goals,originalGoals,history),addPreviews(q,me,groups,friends,history)]);
    const feed=feedState.unread,questions=questionState.unread;
    return {me:{id:me,name:session.username},accountToolsGardenId:accountToolsGarden(me),groups,friends,requests,...plans,tree:plant,
      unread:{feed,questions,garden:feed+questions,groups:groups.reduce((n,g)=>n+g.unread,0),private:friends.reduce((n,f)=>n+f.unread,0)}};
  }
  if(view==='group'){
    const g=await group(q,me,id),page=await messages(q,'group',id,params.get('before'));
    if(!params.has('before')){
      const old=await history.chat(q,id,me);
      page.messages.push(...old.slice(-100));page.legacyThrough=legacyCursor(old);
    }
    page.messages.sort((a,b)=>a.created-b.created||(a.seq??0)-(b.seq??0));
    const saved=await q.first('SELECT message FROM mc_v81_group_pin WHERE garden=?',id);
    const pin=saved?await pinMessage(q,history,me,id,saved.message):null;
    return {group:g,members:await roster(q,me,id),pin,...page};
  }
  if(view==='dm')return {friend:await friend(q,me,id),...await messages(q,'dm',pair(me,id).join(':'),params.get('before'))};
  if(view==='tree'){
    const mine=!id||id===me,owner=mine?{id:me,name:session.username}:await friend(q,me,id);
    const [plant,notes,help,gifts]=await Promise.all([
      tree(q,owner.id),
      q.all('SELECT n.id,n.body,n.created,n.author AS authorId,a.username AS name FROM mc_v8_tree_notes n JOIN mc_accounts a ON a.id=n.author WHERE n.owner=? ORDER BY n.created DESC,n.id LIMIT 40',owner.id),
      mine?null:q.first('SELECT 1 AS done FROM mc_v8_tree_help WHERE owner=? AND helper=? AND day=?',owner.id,me,day()),
      mine?q.all('SELECT g.id,g.sender AS fromId,g.recipient AS toId,a.username AS fromName,b.username AS toName,g.created,1 AS amount FROM mc_v8_gifts g JOIN mc_accounts a ON a.id=g.sender JOIN mc_accounts b ON b.id=g.recipient WHERE sender=? OR recipient=? ORDER BY g.created DESC,g.id LIMIT 100',me,me):[]
    ]);
    if(!mine)delete plant.fruit;
    return {owner,mine,tree:plant,helpedToday:!!help,notes,gifts};
  }
  if(view==='feed'){
    const kind=validKind(params.get('kind')),info=await feedInfo(q,me,kind);
    const items=await q.all(feedCte+'SELECT '+fields+",(SELECT COUNT(*) FROM visible c WHERE c.postId=v.id AND c.kind='reply') AS replyCount,(SELECT COUNT(*) FROM visible c WHERE c.postId=v.id AND c.kind='reply' AND (c.reply_to IS NULL OR NOT EXISTS(SELECT 1 FROM visible pr WHERE pr.id=c.reply_to AND pr.kind='reply'))) AS answerCount,EXISTS(SELECT 1 FROM visible c WHERE c.postId=v.id AND c.author<>? AND c.seq>COALESCE((SELECT through FROM mc_v8_reads WHERE account=? AND scope=?),0)) AS unread FROM visible v JOIN mc_accounts a ON a.id=v.author WHERE v.kind<> 'reply' ORDER BY v.seq DESC",me,kind,me,me,kind);
    const repliesToMe=await q.all(feedCte+'SELECT '+fields+" FROM visible v JOIN mc_accounts a ON a.id=v.author WHERE v.kind='reply' AND v.author<>? AND ((v.reply_to IS NULL AND v.owner=?) OR v.reply_to IN (SELECT id FROM visible WHERE author=?)) ORDER BY v.seq DESC",me,kind,me,me,me);
    await enrichGarden(q,me,kind,items);
    return {items:items.map(r=>({...r,unread:!!r.unread})),repliesToMe,through:info.through};
  }
  if(view==='post'){
    assertUuid(id);
    const root=await q.first(friendsCte+"SELECT e.kind FROM mc_v8_entries e,viewer WHERE e.id=? AND e.kind IN ('feed','questions') AND (author=me OR author IN peers)",me,id);
    if(!root)reject(404,'内容不可见');
    const result=await q.all(feedCte+'SELECT '+fields+' FROM visible v JOIN mc_accounts a ON a.id=v.author WHERE v.postId=? ORDER BY v.seq',me,root.kind,id);
    if(root.kind==='feed')await enrichGarden(q,me,'feed',[result[0]]);
    return {post:result[0],replies:result.slice(1)};
  }
  reject(400,'未知页面');
}
async function append(q,me,p,kind,scope,title,body,replyTo=null){
  const key=assertUuid(p.clientId),id=randomUUID();
  await q.run('INSERT INTO mc_v8_entries(id,author,client_id,kind,scope,title,body,reply_to,created) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(author,client_id) DO NOTHING',id,me,key,kind,scope,title,body,replyTo,Date.now());
  const row=await q.first('SELECT id,kind,scope,title,body,reply_to FROM mc_v8_entries WHERE author=? AND client_id=?',me,key);
  if(row.kind!==kind||row.scope!==scope||row.title!==title||row.body!==body||row.reply_to!==replyTo)reject(409,'此操作标识已使用');
  return {id:row.id};
}
async function invite(q,me,id,ids){
  if(!Array.isArray(ids)||ids.length>100)reject(400,'请从好友中选择成员');
  for(const other of new Set(ids)){
    await friend(q,me,other);
    await q.run(joinMembership,other,id);
  }
}
async function change(q,session,p,history){
  const me=session.accountId;
  if(['playInvite','playRespond','playMove'].includes(p.action))return changePlay(q,me,p);
  switch(p.action){
    case 'myStatus': {
      if(!['去采风','看书中','喝茶中','忙一会','听音乐','休息','喝咖啡','挥手','犯困','疲惫',''].includes(p.status))reject(400,'请选择趣味状态');
      await q.run('INSERT INTO mc_v81_my_status VALUES(?,?) ON CONFLICT(account) DO UPDATE SET status=excluded.status',me,p.status);
      return {};
    }
    case 'pinGroupMessage': {
      const g=await group(q,me,p.groupId);
      if(g.role!=='owner')reject(403,'只有群主可以管理置顶');
      const id=text(p.messageId,160);
      if(p.remove===true){await q.run('DELETE FROM mc_v81_group_pin WHERE garden=? AND message=?',g.id,id);return {};}
      if(!await pinMessage(q,history,me,g.id,id))reject(404,'本群没有这条可置顶的消息');
      await q.run('INSERT INTO mc_v81_group_pin(garden,message) VALUES(?,?) ON CONFLICT(garden) DO UPDATE SET message=excluded.message',g.id,id);
      return {};
    }
    case 'goalSelect': {
      const value=text(p.id,200);
      let allowed;
      if(value.startsWith('shared:')){
        const g=await group(q,me,value.slice(7));
        allowed=(await history.sharedGoals(q,[g])).some(goal=>goal.id===value);
      }else if(value.startsWith('legacy:')){
        allowed=(await history.goals(q,me)).some(goal=>goal.id===value);
      }else allowed=await q.first('SELECT 1 AS found FROM mc_v8_goals WHERE account=? AND id=?',me,assertUuid(value));
      if(!allowed)reject(404,'这个约定已不在你的计划里');
      await q.run('INSERT INTO mc_v8_goal_choice VALUES(?,?) ON CONFLICT(account) DO UPDATE SET goal=excluded.goal',me,value);
      return {id:value};
    }
    case 'goalSave': {
      const id=p.id===undefined?randomUUID():assertUuid(p.id);
      const title=text(p.title,80),body=text(p.body??'',300,true);
      if(!Number.isSafeInteger(p.due)||p.due<0||p.due>8640000000000000)reject(400,'日期无效');
      const result=await q.run('INSERT INTO mc_v8_goals VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,body=excluded.body,due=excluded.due WHERE account=excluded.account',id,me,title,body,p.due,Date.now());
      if(!result.rowsAffected)reject(403,'无权修改此约定');
      return {id};
    }
    case 'goalDelete': {
      if(!(await q.run('DELETE FROM mc_v8_goals WHERE id=? AND account=?',assertUuid(p.id),me)).rowsAffected)reject(404,'约定不存在');
      return {};
    }
    case 'groupCreate': {
      const [name,subtitle]=gardenText(p.name,p.subtitle??''),id=randomUUID();
      const key=p.clientId===undefined?null:assertUuid(p.clientId),ids=p.friendIds??[];
      if(!Array.isArray(ids)||ids.length>100)reject(400,'请从好友中选择成员');
      const request=JSON.stringify([name,subtitle,[...new Set(ids.map(assertUuid))].sort()]);
      const prior=key&&await q.first('SELECT garden,request FROM mc_v8_group_requests WHERE account=? AND client_id=?',me,key);
      if(prior){if(prior.request!==request)reject(409,'此操作标识已使用');return {id:prior.garden};}
      await q.run('INSERT INTO mc_gardens(id,name,subtitle) VALUES(?,?,?)',id,name,subtitle);
      await q.run("INSERT INTO mc_members VALUES(?,?,1,'owner')",me,id);
      await invite(q,me,id,ids);
      if(key)await q.run('INSERT INTO mc_v8_group_requests VALUES(?,?,?,?)',me,key,id,request);
      return {id};
    }
    case 'groupInvite': {await group(q,me,p.groupId);await invite(q,me,p.groupId,p.friendIds);return {id:p.groupId};}
    case 'groupLeave': {
      const id=p.groupId;
      await group(q,me,id);
      await q.run('INSERT OR IGNORE INTO mc_retired_slots(garden,account,slot) SELECT garden,account,slot FROM mc_members WHERE garden=? AND account=?',id,me);
      await q.run('DELETE FROM mc_members WHERE garden=? AND account=?',id,me);
      await q.run("UPDATE mc_members SET role='owner' WHERE garden=? AND slot=(SELECT MIN(slot) FROM mc_members WHERE garden=?) AND NOT EXISTS(SELECT 1 FROM mc_members WHERE garden=? AND role='owner')",id,id,id);
      await q.run('DELETE FROM mc_garden_codes WHERE garden=? AND NOT EXISTS(SELECT 1 FROM mc_members WHERE garden=?)',id,id);
      await q.run('UPDATE mc_accounts SET last_garden=NULL WHERE id=? AND last_garden=?',me,id);
      await q.run('UPDATE mc_sessions SET active_garden=NULL WHERE account=? AND active_garden=?',me,id);
      return {};
    }
    case 'friendRequest': {
      const other=p.accountId?await q.first('SELECT id FROM mc_accounts WHERE id=?',assertUuid(p.accountId)):await q.first('SELECT id FROM mc_accounts WHERE username=?',text(p.name,14));
      if(!other)reject(404,'没有找到这个账号');
      if(other.id===me)reject(400,'请选择其他账号');
      const ids=pair(me,other.id);
      const current=await q.first('SELECT sender,accepted FROM mc_v8_friends WHERE lo=? AND hi=?',...ids);
      if(current&&!current.accepted&&current.sender!==me)reject(409,'对方已向你发出申请，请接受申请');
      await q.run('INSERT OR IGNORE INTO mc_v8_friends(lo,hi,sender) VALUES(?,?,?)',...ids,me);
      return {id:other.id};
    }
    case 'friendAccept':
    case 'friendDecline': {
      const id=assertUuid(p.accountId),ids=pair(me,id),accept=p.action==='friendAccept';
      const row=await q.first('SELECT * FROM mc_v8_friends WHERE lo=? AND hi=?',...ids);
      if(!row||(!row.accepted&&row.sender!==id)||(!accept&&row.accepted))reject(403,'没有可处理的好友申请');
      if(accept)await q.run('UPDATE mc_v8_friends SET accepted=1 WHERE lo=? AND hi=?',...ids);
      else await q.run('DELETE FROM mc_v8_friends WHERE lo=? AND hi=?',...ids);
      return {id};
    }
    case 'message':
    case 'read': {
      const scopes=[p.groupId,p.friendId,p.kind].filter(v=>v!==undefined);
      if(scopes.length!==1)reject(400,'请选择一个会话或栏目');
      let kind,scope,readKey;
      if(p.groupId!==undefined){kind='group';scope=(await group(q,me,p.groupId)).id;readKey='group:'+scope;}
      else if(p.friendId!==undefined){kind='dm';const f=await friend(q,me,p.friendId);scope=pair(me,f.id).join(':');readKey='dm:'+f.id;}
      else{kind=validKind(p.kind);readKey=kind;}
      if(p.action==='message'){
        if(!scope)reject(400,'请选择聊天对象');
        const item=await append(q,me,p,kind,scope,'',text(p.body,4000));
        if(kind==='group')await q.run('INSERT OR IGNORE INTO mc_v8_legacy_delivery(entry) VALUES(?)',item.id);
        return item;
      }
      if(!Number.isSafeInteger(p.through)||p.through<0)reject(400,'已读位置无效');
      const latest=scope?(await q.first('SELECT COALESCE(MAX(seq),0) AS through FROM mc_v8_entries WHERE kind=? AND scope=?',kind,scope)).through:(await feedInfo(q,me,kind)).through;
      await q.run('INSERT INTO mc_v8_reads VALUES(?,?,?) ON CONFLICT(account,scope) DO UPDATE SET through=MAX(through,excluded.through)',me,readKey,Math.min(p.through,latest));
      if(kind==='group' && p.legacyThrough && p.legacyThrough!=='0:0'){
        const match=/^(\d{1,16}):(\d{1,16})$/.exec(String(p.legacyThrough));
        if(!match)reject(400,'原群已读位置无效');
        const [created,ordinal]=match.slice(1).map(Number);
        const seen=(await history.chat(q,scope,me)).filter(x=>x.created<created||(x.created===created&&x.ordinal<=ordinal)).at(-1);
        if(seen)await q.run('INSERT INTO mc_v8_legacy_reads VALUES(?,?,?,?) ON CONFLICT(account,garden) DO UPDATE SET created=excluded.created,ordinal=excluded.ordinal WHERE (created,ordinal)<(excluded.created,excluded.ordinal)',me,scope,seen.created,seen.ordinal);
      }
      return {};
    }
    case 'post': {
      const kind=validKind(p.kind),title=text(p.title??'',120,true);
      const jpeg=p.photo||'';
      if(jpeg&&(kind!=='feed'||typeof jpeg!=='string'||jpeg.length>384000||!/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(jpeg)||!Buffer.from(jpeg,'base64').subarray(-2).equals(Buffer.from([255,217]))))reject(400,'请选择有效的手机图片');
      if(kind==='questions'&&!title)reject(400,'请填写问题');
      const prior=await q.first('SELECT e.id,p.jpeg FROM mc_v8_entries e LEFT JOIN mc_v81_post_photo p ON p.post=e.id WHERE e.author=? AND e.client_id=?',me,assertUuid(p.clientId));
      if(prior&&(prior.jpeg||'')!==jpeg)reject(409,'此操作标识已使用');
      const result=await append(q,me,p,kind,'',title,text(p.body??'',4000,!!(title||jpeg)));
      if(jpeg)await q.run('INSERT INTO mc_v81_post_photo(post,jpeg) VALUES(?,?) ON CONFLICT(post) DO NOTHING',result.id,jpeg);
      return result;
    }
    case 'postReact': {
      const post=await rootFor(q,me,p.postId);
      if(post.kind!=='feed'||!gardenEmoji.has(p.emoji)||typeof p.active!=='boolean')reject(400,'回应无效');
      if(p.active)await q.run('INSERT INTO mc_v81_post_reaction(post,account,emoji) VALUES(?,?,?) ON CONFLICT DO NOTHING',p.postId,me,p.emoji);
      else await q.run('DELETE FROM mc_v81_post_reaction WHERE post=? AND account=? AND emoji=?',p.postId,me,p.emoji);
      return {};
    }
    case 'reply': {
      const id=assertUuid(p.postId);
      const post=await q.first(friendsCte+"SELECT kind FROM mc_v8_entries,viewer WHERE id=? AND kind IN ('feed','questions') AND (author=me OR author IN peers)",me,id);
      if(!post)reject(404,'内容不可见');
      if(p.replyTo && !await q.first(feedCte+'SELECT id FROM visible WHERE postId=? AND id=?',me,post.kind,id,assertUuid(p.replyTo)))reject(404,'回复不可见');
      return append(q,me,p,'reply',id,'',text(p.body,2000),p.replyTo??null);
    }
    case 'water':
      await q.run('INSERT INTO mc_v8_trees VALUES(?,1,1,?) ON CONFLICT(account) DO UPDATE SET fruit=fruit+1,water_count=water_count+1,last_day=excluded.last_day WHERE last_day<>excluded.last_day',me,day());
      return {tree:await tree(q,me)};
    case 'treeWater': {
      const owner=p.friendId?(await friend(q,me,p.friendId)).id:me;
      const today=day(),plant=await tree(q,owner);
      if(plant.mature)return {mature:true,changed:false};
      let marked;
      if(owner===me){
        marked=await q.run('INSERT INTO mc_v8_trees(account,water_count,last_day) VALUES(?,1,?) ON CONFLICT(account) DO UPDATE SET water_count=water_count+1,last_day=excluded.last_day WHERE last_day<>excluded.last_day',me,today);
      }else{
        marked=await q.run('INSERT INTO mc_v8_tree_help VALUES(?,?,?) ON CONFLICT DO NOTHING',owner,me,today);
      }
      if(marked.rowsAffected)await q.run('INSERT INTO mc_v8_tree_growth VALUES(?,1) ON CONFLICT(account) DO UPDATE SET progress=MIN(3,progress+1)',owner);
      return {changed:!!marked.rowsAffected,mature:!!marked.rowsAffected&&plant.progress===2};
    }
    case 'treeHarvest': {
      if(p.friendId&&p.friendId!==me)reject(403,'只有主人能采摘荔枝');
      const key=assertUuid(p.clientId);
      if(await q.first('SELECT 1 FROM mc_v8_tree_harvest WHERE account=? AND client_id=?',me,key))return {amount:3};
      if(!(await q.run('UPDATE mc_v8_tree_growth SET progress=0 WHERE account=? AND progress=3',me)).rowsAffected)reject(409,'荔枝还没有熟');
      await q.run('INSERT INTO mc_v8_tree_harvest VALUES(?,?)',me,key);
      await q.run('INSERT INTO mc_v8_trees(account,fruit) VALUES(?,3) ON CONFLICT(account) DO UPDATE SET fruit=fruit+3',me);
      return {amount:3};
    }
    case 'treeNote': {
      const owner=p.friendId?(await friend(q,me,p.friendId)).id:me;
      const key=assertUuid(p.clientId),body=text(p.body,240);
      await q.run('INSERT INTO mc_v8_tree_notes VALUES(?,?,?,?,?,?) ON CONFLICT(author,client_id) DO NOTHING',randomUUID(),owner,me,body,Date.now(),key);
      const note=await q.first('SELECT id,owner,body FROM mc_v8_tree_notes WHERE author=? AND client_id=?',me,key);
      if(note.owner!==owner||note.body!==body)reject(409,'操作标识已使用');
      return {id:note.id};
    }
    case 'gift': {
      const other=(await friend(q,me,p.friendId)).id,key=assertUuid(p.clientId);
      const prior=await q.first('SELECT id,recipient FROM mc_v8_gifts WHERE sender=? AND client_id=?',me,key);
      if(prior){if(prior.recipient!==other)reject(409,'此操作标识已使用');return {id:prior.id};}
      if(!(await q.run('UPDATE mc_v8_trees SET fruit=fruit-1 WHERE account=? AND fruit>0',me)).rowsAffected)reject(409,'树上暂时没有可送的荔枝');
      await q.run('INSERT INTO mc_v8_trees(account,fruit) VALUES(?,1) ON CONFLICT(account) DO UPDATE SET fruit=fruit+1',other);
      const id=randomUUID();await q.run('INSERT INTO mc_v8_gifts VALUES(?,?,?,?,?)',id,me,other,key,Date.now());return {id};
    }
    default:reject(400,'未知操作');
  }
}
export async function createSocial(options){
  const store=await socialStore(options),history=socialHistory(options.dataDir);
  return {close:()=>store.close(),async handle(request,session){
    try{
      const params=new URL(request.url).searchParams;
      if(params.get('accountId')!==session.accountId)reject(403,'账号已切换，请重新打开');
      if(request.method==='GET'&&params.get('view')==='postPhoto'){
        const id=params.get('id');
        const picture=await store.transaction(false,async q=>{
          await rootFor(q,session.accountId,id);
          return q.first('SELECT jpeg FROM mc_v81_post_photo WHERE post=?',id);
        });
        if(!picture)reject(404,'图片不可见');
        return new Response(Buffer.from(picture.jpeg,'base64'),{headers:{'content-type':'image/jpeg','cache-control':'private, no-store','x-content-type-options':'nosniff'}});
      }
      if(['playRoom','playPractice'].includes(params.get('view')))return await playRoom(request,session,store,options.domains);
      if(request.method==='GET')return json(await store.transaction(['playLobby','playMatch'].includes(params.get('view')),q=>get(q,session,params,history)));
      if(request.method!=='POST')reject(405,'不支持此操作');
      const p=await request.json().catch(()=>null);
      if(!p||typeof p!=='object'||Array.isArray(p))reject(400,'请求内容无效');
      const result=await store.transaction(true,q=>change(q,session,p,history));
      if(p.action==='message' && p.groupId && options.publish){
        const row=await store.transaction(false,q=>q.first("SELECT e.id,e.body,e.created,m.slot FROM mc_v8_entries e JOIN mc_v8_legacy_delivery d ON e.id=d.entry AND d.delivered=0 AND d.recalled=0 JOIN mc_members m ON m.garden=e.scope AND m.account=e.author WHERE e.id=? AND e.author=? AND e.scope=?",result.id,session.accountId,p.groupId));
        if(row&&day()===new Date(row.created+28800000).toISOString().slice(0,10)){
          await options.publish(request,session,p.groupId,row);
          await store.transaction(true,q=>q.run('UPDATE mc_v8_legacy_delivery SET delivered=1 WHERE entry=?',row.id));
        }
      }
      return json({ok:true,...result});
    }catch(error){
      if(error instanceof InputError)return json({error:error.message},error.code);
      console.error('Social service unavailable:',error.name);
      return json({error:'暂时无法同步，请重试。'},503);
    }
  },async recall(member,id){
    const parts=typeof id==='string'?id.split('.'):[];
    if(parts.length!==3||parts[1]!==String(member.slot)||!uuid.test(parts[2]))return;
    await store.transaction(true,async q=>{
      await q.run("UPDATE mc_v8_entries SET body='消息已撤回' WHERE id=? AND kind='group' AND author=? AND scope=?",parts[2],member.accountId,member.gardenId);
      await q.run("UPDATE mc_v8_legacy_delivery SET recalled=1 WHERE entry IN(SELECT id FROM mc_v8_entries WHERE id=? AND author=? AND scope=?)",parts[2],member.accountId,member.gardenId);
    });
  }};
}

