import {createHash,randomUUID} from 'node:crypto';
import {reject} from './accounts.mjs';
import {loadBank} from './quiz-game.mjs';
import {advance,drawQuestions,publicGame,READY_MS,scores,submit} from './quiz-rounds.mjs';

const games={quiz:'头脑王者',gomoku:'五子棋',soup:'海龟汤',riddles:'脑筋急转弯'};
const uuid=/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i;
const safeId=id=>{if(typeof id!=='string'||!uuid.test(id))reject(400,'对局编号无效');return id;};
const gameName=k=>{if(!Object.hasOwn(games,k))reject(400,'请选择游戏');return games[k];};
export const playSchema=[
  "CREATE TABLE IF NOT EXISTS mc_v8_play(id TEXT PRIMARY KEY,game TEXT NOT NULL,host TEXT NOT NULL,guest TEXT NOT NULL,status TEXT NOT NULL,state TEXT NOT NULL,created INTEGER NOT NULL)",
  'CREATE INDEX IF NOT EXISTS mc_v8_play_host ON mc_v8_play(host,game,status,created)',
  'CREATE INDEX IF NOT EXISTS mc_v8_play_guest ON mc_v8_play(guest,game,status,created)',
  'CREATE TABLE IF NOT EXISTS mc_v8_play_rank(account TEXT PRIMARY KEY,stars INTEGER NOT NULL,played INTEGER NOT NULL)',
];

async function match(q,me,id){
  const row=await q.first('SELECT p.*,a.username AS hostName,b.username AS guestName FROM mc_v8_play p JOIN mc_accounts a ON p.host=a.id JOIN mc_accounts b ON p.guest=b.id WHERE p.id=? AND (p.host=? OR p.guest=?)',safeId(id),me,me);
  if(!row)reject(404,'找不到这场好友对局');
  return row;
}
function visible(row,me){
  const {id,game,host,guest,hostName,guestName,status,created}=row;
  return {id,game,host,guest,hostName,guestName,status,created,side:me===host?0:1};
}
async function saveQuiz(q,row,state){
  if(row.status==='active'&&state.status==='done'){
    const result=scores(state);state.starChanges=[];
    for(const [i,account] of [row.host,row.guest].entries()){
      const old=await q.first('SELECT stars FROM mc_v8_play_rank WHERE account=?',account);
      const delta=Math.sign(result[i]-result[1-i]),previous=old?.stars||0,next=Math.max(0,previous+delta);
      await q.run('INSERT INTO mc_v8_play_rank(account,stars,played) VALUES(?,?,1) ON CONFLICT(account) DO UPDATE SET stars=excluded.stars,played=played+1',account,next);
      state.starChanges.push(next-previous);
    }
  }
  row.state=JSON.stringify(state);row.status=state.status;
  await q.run('UPDATE mc_v8_play SET status=?,state=? WHERE id=?',row.status,row.state,row.id);
}
async function details(q,row,me,now=Date.now()){
  if(row.game!=='quiz'||!['active','done'].includes(row.status))return visible(row,me);
  const state=JSON.parse(row.state);
  if(advance(state,now))await saveQuiz(q,row,state);
  return {...visible(row,me),quiz:publicGame({id:row.id,host:1,guest:2},state,Number(row.guest===me),now)};
}
export async function getPlay(q,me,view,params){
  if(view==='playMatch')return details(q,await match(q,me,params.get('id')),me);
  const game=params.get('game');gameName(game);
  if(game==='quiz'){
    const old=await q.all("SELECT id FROM mc_v8_play WHERE game='quiz' AND status='active' AND (host=? OR guest=?) AND created<?",me,me,Date.now()-12000);
    for(const {id} of old)await details(q,await match(q,me,id),me);
  }
  const matches=await q.all("SELECT p.id,p.game,p.host,p.guest,p.status,p.created,a.username AS hostName,b.username AS guestName FROM mc_v8_play p JOIN mc_accounts a ON p.host=a.id JOIN mc_accounts b ON p.guest=b.id WHERE p.game=? AND (p.host=? OR p.guest=?) AND p.status IN ('pending','active') ORDER BY p.created DESC",game,me,me);
  const ranking=game==='quiz'?await q.all('SELECT a.id,a.username AS name,COALESCE(r.stars,0) AS stars,COALESCE(r.played,0) AS played FROM mc_accounts a LEFT JOIN mc_v8_play_rank r ON r.account=a.id WHERE a.id=? OR a.id IN(SELECT CASE WHEN f.lo=? THEN f.hi ELSE f.lo END FROM mc_v8_friends f WHERE (f.lo=? OR f.hi=?) AND f.accepted=1) ORDER BY (COALESCE(r.played,0)>0) DESC,stars DESC,a.username,a.id',me,me,me,me):[];
  return {matches:matches.map(r=>visible(r,me)),ranking};
}
export async function changePlay(q,me,p){
  const now=Date.now(),id=safeId(p.id);
  if(p.action==='playInvite'){
    const name=gameName(p.game),guest=safeId(p.friendId),[lo,hi]=[me,guest].sort();
    if(guest===me||!await q.first('SELECT 1 AS ok FROM mc_v8_friends WHERE lo=? AND hi=? AND accepted=1',lo,hi))reject(403,'只能邀请已添加的好友');
    const existing=await q.first('SELECT host,guest,game FROM mc_v8_play WHERE id=?',id);
    if(existing){
      if(existing.host!==me||existing.guest!==guest||existing.game!==p.game)reject(409,'邀请编号已使用');
    }else{
      await q.run("INSERT INTO mc_v8_play VALUES(?,?,?,?,'pending','{}',?)",id,p.game,me,guest,now);
      const message=randomUUID();
      await q.run("INSERT INTO mc_v8_entries(id,author,client_id,kind,scope,title,body,created) VALUES(?,?,?,'dm',?,'',?,?)",message,me,message,lo+':'+hi,'【一起玩】'+name+'\n好友对局：'+id,now);
    }
    return details(q,await match(q,me,id),me);
  }
  const row=await match(q,me,id);
  if(p.action==='playRespond'){
    if(!['accept','decline','cancel','leave'].includes(p.decision))reject(400,'请选择邀请操作');
    if((p.decision==='cancel'&&row.host!==me)||(['accept','decline'].includes(p.decision)&&row.guest!==me))reject(403,'无权代替对方回应');
    if(p.decision==='leave'){
      if(row.game==='quiz'||row.status!=='active')reject(409,'当前对局不能结束');
      await q.run("UPDATE mc_v8_play SET status='done' WHERE id=?",id);
    }else if(row.status==='pending'){
      const status=p.decision==='accept'?'active':'cancelled';let state={};
      if(row.game==='quiz'&&status==='active'){
        const recent=new Map();
        const previous=await q.all("SELECT state,created FROM mc_v8_play WHERE game='quiz' AND status IN ('active','done') AND (host IN (?,?) OR guest IN (?,?)) ORDER BY created DESC LIMIT 32",row.host,row.guest,row.host,row.guest);
        for(const prev of previous)for(const question of JSON.parse(prev.state).rounds||[])if(!recent.has(question.id))recent.set(question.id,prev.created);
        state={status,round:0,start:now+READY_MS,rounds:drawQuestions(await loadBank(),recent)};
      }
      await q.run('UPDATE mc_v8_play SET status=?,state=? WHERE id=?',status,JSON.stringify(state),id);
    }else if((row.status==='cancelled')===(p.decision==='accept'))reject(409,'邀请状态已经改变');
    return details(q,await match(q,me,id),me);
  }
  if(p.action!=='playMove'||row.game!=='quiz'||row.status!=='active')reject(409,'这场对局尚未开始或已经结束');
  if(!Number.isInteger(p.choice)||p.choice<0||p.choice>3||!Number.isInteger(p.round)||p.round<0||p.round>4)reject(400,'答案无效');
  const state=JSON.parse(row.state),elapsed=advance(state,now);
  if(submit(state,Number(row.guest===me),p.round,p.choice,now)||elapsed)await saveQuiz(q,row,state);
  return details(q,row,me,now);
}

// Original games receive only their own accepted two-player room and action family.
export async function playRoom(request,session,store,domains){
  const url=new URL(request.url),params=url.searchParams;
  const practice=params.get('view')==='playPractice';
  const row=practice?{game:params.get('game'),host:session.accountId}:await store.transaction(false,q=>match(q,session.accountId,params.get('match')));
  if(practice?!['soup','riddles'].includes(row.game):row.status!=='active'||row.game==='quiz')reject(403,'请等待好友接受邀请');
  const method=request.method,body=method==='POST'?await request.json().catch(()=>null):null;
  const query=new URLSearchParams(params);
  for(const key of ['view','accountId',practice?'game':'match'])query.delete(key);
  const keys={gomoku:['gomoku'],soup:['soup','room'],riddles:['riddles','format','deck','previous','before']};
  const actions={gomoku:['gomoku'],soup:['soup','soup-tutorial-seen'],riddles:['riddle','riddle-answer']};
  if(method==='GET'){
    if(!query.has(keys[row.game][0])||[...query.keys()].some(key=>!keys[row.game].includes(key)))reject(403,'无效的游戏内容');
    if(row.game==='soup'&&query.get('room')!==(practice?'solo':'team'))reject(403,'无权访问其他房间');
    if(practice&&row.game==='riddles'&&!['challenge','rank'].includes(query.get('riddles')))reject(403,'个人练习不包含好友出题');
  }else if(method!=='POST'||query.size||!body||!actions[row.game].includes(body.type))reject(403,'无效的游戏操作');
  else if((body.type==='soup'&&body.room!==(practice?'solo':'team'))||(practice&&body.type==='riddle'))reject(403,'请在当前游戏内操作');
  const dst=new URL('/api/camp',url);dst.search=query;
  const digest=createHash('sha256').update(practice?'lychee/v8/solo/':'lychee/v8/match/').update(practice?session.accountId:row.id).digest('hex');
  const gardenId=[digest.slice(0,8),digest.slice(8,12),'8'+digest.slice(13,16),'8'+digest.slice(17,20),digest.slice(20,32)].join('-');
  const identity={...session,gardenId,slot:row.host===session.accountId?1:2,role:'member'};
  function call(url,member,payload){
    return domains.handle(new Request(url,{method:payload?'POST':'GET',headers:{origin:dst.origin,'content-type':'application/json'},body:payload?JSON.stringify(payload):undefined}),member);
  }
  const response=await call(dst,identity,body);
  if(row.game!=='gomoku'||method!=='GET'||!response.ok)return response;
  const board=(await response.clone().json()).match;
  if(board?.white||board?.result)return response;
  // Both accounts have already consented. The underlying board also needs a black and white seat.
  const endpoint=new URL('/api/camp',dst);
  if(!board){
    const host={...identity,accountId:row.host,username:row.hostName,slot:1};
    const start=await call(endpoint,host,{type:'gomoku',act:'start',game:row.id,previous:null});
    if(!start.ok)return start;
  }
  const guest={...identity,accountId:row.guest,username:row.guestName,slot:2};
  const join=await call(endpoint,guest,{type:'gomoku',act:'join',game:board?.id||row.id});
  return join.ok?call(dst,identity):join;
}
