import {createHash,pbkdf2,randomBytes,randomUUID,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(pbkdf2), hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const DAY=86400000, life=30*DAY, hex64=/^[a-f0-9]{64}$/;
const newCookie='__Host-lychee-account', oldCookie='__Host-lychee';
export const LEGACY_GARDEN_ID='legacy';
class InputError extends Error {constructor(code,msg){super(msg);this.code=code;}}
const reject=(n,msg)=>{throw new InputError(n,msg);};
function json(body,status=200,cookies=[]){
  const headers=new Headers({'Cache-Control':'private, no-store'});
  for(const cookie of cookies)headers.append('set-cookie',cookie);
  return Response.json(body,{status,headers});
}
const cookie=(k,v,n)=>k+'='+v+'; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age='+n;
function tokens(request){
  const result=new Map();
  for(const item of (request.headers.get('cookie')||'').split(';')){
    const pos=item.indexOf('='),name=item.slice(0,pos).trim(),v=item.slice(pos+1).trim();
    if(pos<0||![newCookie,oldCookie].includes(name))continue;
    result.set(name,!result.has(name)&&hex64.test(v)?hash(v):null);
  }
  return result;
}
function tx(db,fn){db.exec('BEGIN IMMEDIATE');try{const value=fn();db.exec('COMMIT');return value;}catch(e){db.exec('ROLLBACK');throw e;}}
const textOK=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(v);
function gardenText(name,subtitle){
  if(!textOK(name,40))reject(400,'圈名限 1–40 字');
  if(typeof subtitle!=='string'||subtitle.trim().length>80||/[\u0000-\u001f\u007f]/.test(subtitle))reject(400,'小标签最多 80 字');
  return [name.trim(),subtitle.trim()];
}
export {derive,hash,life,hex64,newCookie,oldCookie,InputError,reject,json,cookie,tokens,textOK,gardenText};
export const accountSchema = `CREATE TABLE IF NOT EXISTS mc_accounts(id TEXT PRIMARY KEY,username TEXT UNIQUE COLLATE NOCASE NOT NULL,salt TEXT NOT NULL,verifier TEXT NOT NULL,iterations INTEGER NOT NULL,last_garden TEXT);
    CREATE TABLE IF NOT EXISTS mc_gardens(id TEXT PRIMARY KEY,name TEXT NOT NULL,subtitle TEXT NOT NULL DEFAULT '',revision INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE IF NOT EXISTS mc_members(account TEXT NOT NULL REFERENCES mc_accounts(id),garden TEXT NOT NULL REFERENCES mc_gardens(id),slot INTEGER NOT NULL CHECK(slot>=1),role TEXT NOT NULL CHECK(role IN ('owner','member')),PRIMARY KEY(account,garden),UNIQUE(garden,slot));
    CREATE TABLE IF NOT EXISTS mc_sessions(token_hash TEXT PRIMARY KEY,kind TEXT NOT NULL CHECK(kind IN ('legacy','account')),account TEXT NOT NULL REFERENCES mc_accounts(id),active_garden TEXT,expires INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS mc_sessions_expiry ON mc_sessions(expires);
    CREATE TABLE IF NOT EXISTS mc_garden_codes(garden TEXT PRIMARY KEY REFERENCES mc_gardens(id),code TEXT UNIQUE NOT NULL);
    CREATE TABLE IF NOT EXISTS mc_retired_slots(garden TEXT NOT NULL,account TEXT NOT NULL,slot INTEGER NOT NULL,PRIMARY KEY(garden,account),UNIQUE(garden,slot));
    CREATE TABLE IF NOT EXISTS mc_reads(account TEXT NOT NULL REFERENCES mc_accounts(id),notice TEXT NOT NULL,PRIMARY KEY(account,notice));
    CREATE TABLE IF NOT EXISTS mc_legacy_slots(slot INTEGER PRIMARY KEY,account TEXT UNIQUE NOT NULL REFERENCES mc_accounts(id),source_digest TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS mc_legacy_sessions(digest TEXT PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mc_attempts(bucket TEXT PRIMARY KEY,hits INTEGER NOT NULL,until INTEGER NOT NULL);`.split(';').map(sql=>sql.trim()).filter(Boolean);
export const gardensForAccount = `SELECT g.id,g.name,g.subtitle,g.revision,m.role,
  (SELECT COUNT(*) FROM mc_members AS other WHERE other.garden=g.id) AS memberCount
  FROM mc_members m JOIN mc_gardens g ON g.id=m.garden WHERE m.account=? ORDER BY g.name COLLATE NOCASE,g.id`;
export const circleRoster = `SELECT a.username AS name,m.role,m.slot FROM mc_members m
  JOIN mc_accounts a ON a.id=m.account WHERE m.garden=?
  AND EXISTS (SELECT 1 FROM mc_members mine WHERE mine.garden=m.garden AND mine.account=?)
  ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,m.slot`;
// A former member can reclaim only their own historical slot. New members
// must never inherit somebody else's old profile, goals or private tools.
export const joinMembership = `WITH candidate(account,garden) AS (VALUES(?,?))
  INSERT INTO mc_members(account,garden,slot,role)
  SELECT c.account,c.garden,COALESCE((SELECT slot FROM mc_retired_slots WHERE account=c.account AND garden=c.garden),
    MAX(COALESCE((SELECT MAX(slot) FROM mc_members WHERE garden=c.garden),0),
        COALESCE((SELECT MAX(slot) FROM mc_retired_slots WHERE garden=c.garden),0),
        CASE WHEN c.garden='legacy' THEN 3 ELSE 0 END)+1),'member'
  FROM candidate c WHERE NOT EXISTS(SELECT 1 FROM mc_members WHERE account=c.account AND garden=c.garden)`;
export function rosterResponse(members) {
  if (!members.length) reject(403,'需要先加入这个圈子');
  return json({members:members.map(({name,role,slot})=>({name,role,slot:Number(slot)}))});
}
export function publishedNotices(notices) {
  const published=notices.map(({id,title,body})=>{
    if(!textOK(id,128)||!textOK(title,250)||typeof body!=='string')throw Error('Invalid notice.');
    return {id,title,body};
  });
  if(new Set(published.map(n=>n.id)).size!==published.length)throw Error('Duplicate notice ID.');
  return published;
}
export function createAccounts(db,{notices=[]}={}){
  const published=publishedNotices(notices);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  db.exec(accountSchema.join(';'));
  const get=(sql,...args)=>db.prepare(sql).get(...args),all=(sql,...args)=>db.prepare(sql).all(...args),run=(sql,...args)=>db.prepare(sql).run(...args);
  tx(db,()=>{
    const columns=new Set(all("PRAGMA table_info('mc_gardens')").map(c=>c.name));
    if(!columns.has('subtitle'))db.exec("ALTER TABLE mc_gardens ADD COLUMN subtitle TEXT NOT NULL DEFAULT ''");
    if(!columns.has('revision'))db.exec('ALTER TABLE mc_gardens ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
    // One-time invite digests from earlier test builds cannot be recovered as shared codes.
    // Memberships and the legacy table are retained; joins consult only mc_garden_codes.
  });
  function resolveMember(accountId,gardenId){
    if(typeof accountId!=='string'||typeof gardenId!=='string')return null;
    return get('SELECT m.account AS accountId,a.username,m.garden AS gardenId,m.slot,m.role FROM mc_members m JOIN mc_accounts a ON a.id=m.account WHERE m.account=? AND m.garden=?',accountId,gardenId)??null;
  }
  function resolveSession(request){
    const t=tokens(request),kind=t.has(newCookie)?'account':'legacy',tokenHash=t.get(kind==='account'?newCookie:oldCookie);
    if(!tokenHash)return null;
    const s=get(`SELECT s.account AS accountId,a.username,m.garden AS gardenId,m.slot,s.expires FROM mc_sessions s JOIN mc_accounts a ON a.id=s.account
      LEFT JOIN mc_members m ON m.account=s.account AND m.garden=s.active_garden WHERE s.token_hash=? AND s.kind=? AND s.expires>?`,tokenHash,kind,Date.now());
    return s?{...s,tokenHash}:null;
  }
  function state(s){
    const gardens=all(gardensForAccount,s.accountId);
    const reads=new Set(all('SELECT notice FROM mc_reads WHERE account=?',s.accountId).map(r=>r.notice));
    return {account:{id:s.accountId,username:s.username},gardens,activeGardenId:gardens.some(g=>g.id===s.gardenId)?s.gardenId:null,notices:published.map(n=>({...n,read:reads.has(n.id)}))};
  }
  function revoke(request){for(const [key,digest] of tokens(request))if(digest)run('DELETE FROM mc_sessions WHERE token_hash=? AND kind=?',digest,key===newCookie?'account':'legacy');}
  function issue(user,request){
    const token=randomBytes(32).toString('hex');revoke(request);
    run('INSERT INTO mc_sessions VALUES(?,?,?,?,?)',hash(token),'account',user.id,user.last_garden??null,Date.now()+life);
    return json({ok:true},200,[cookie(newCookie,token,life/1000),cookie(oldCookie,'',0)]);
  }
  function limit(peer,domain){
    const now=Date.now(),start=Math.floor(now/600000),bucket=hash(domain+'|'+peer+'|'+start);
    run('DELETE FROM mc_attempts WHERE until<=?',now);
    const hits=get('INSERT INTO mc_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',bucket,(start+1)*600000).hits;
    if(hits>40)reject(429,'尝试过于频繁，请稍后再试');
  }
  async function account(req,p,context){
    if(p.mode==='logout')return tx(db,()=>{revoke(req);return json({ok:true},200,[cookie(newCookie,'',0),cookie(oldCookie,'',0)]);});
    if(!['login','register'].includes(p.mode)||typeof p.name!=='string'||!p.name.trim()||p.name.trim().length>14||typeof p.password!=='string'||p.password.length<8||p.password.length>128)reject(400,'用户名限 1–14 字，密码限 8–128 位');
    const username=p.name.trim();limit(context.peerId??'shared','account');run('DELETE FROM mc_sessions WHERE expires<=?',Date.now());
    if(p.mode==='register'){
      if(!textOK(username,14))reject(400,'请检查用户名');
      const salt=randomBytes(32).toString('hex'),v=(await derive(p.password,salt,600000,32,'sha256')).toString('hex');
      return tx(db,()=>{
        if(get('SELECT 1 FROM mc_accounts WHERE username=?',username))reject(409,'用户名不可用');
        const id=randomUUID();run('INSERT INTO mc_accounts(id,username,salt,verifier,iterations) VALUES(?,?,?,?,?)',id,username,salt,v,600000);return issue({id},req);
      });
    }
    const user=get('SELECT * FROM mc_accounts WHERE username=?',username);
    const v=await derive(p.password,user?.salt??'lychee-login-fallback',user?.iterations??600000,32,'sha256');
    if(!user||!timingSafeEqual(v,Buffer.from(user.verifier,'hex')))reject(401,'用户名或密码不正确');
    return tx(db,()=>issue(user,req));
  }
  function activate(s,garden){
    run('UPDATE mc_sessions SET active_garden=? WHERE token_hash=?',garden,s.tokenHash);
    run('UPDATE mc_accounts SET last_garden=? WHERE id=?',garden,s.accountId);s.gardenId=garden;
  }
  function workspace(s,p){
    let extra={};
    if(p.action==='create'){
      const [name,subtitle]=gardenText(p.name,p.subtitle===undefined?'':p.subtitle);
      const id=randomUUID();run('INSERT INTO mc_gardens(id,name,subtitle) VALUES(?,?,?)',id,name,subtitle);
      run("INSERT INTO mc_members VALUES(?,?,1,'owner')",s.accountId,id);activate(s,id);
    }else if(p.action==='join'){
      if(typeof p.code!=='string'||!/^LZ-[a-f0-9]{32}$/i.test(p.code.trim()))reject(400,'邀请码无效');
      const invite=get('SELECT garden FROM mc_garden_codes WHERE code=?',p.code.trim().toUpperCase());
      if(!invite)reject(400,'邀请码无效');
      if(!resolveMember(s.accountId,invite.garden)){
        run(joinMembership,s.accountId,invite.garden);
      }
      activate(s,invite.garden);
    }else if(['switch','invite','rotateInvite','edit'].includes(p.action)){
      const member=resolveMember(s.accountId,p.gardenId);
      if(!member)reject(403,'需要先加入这个圈子');
      if(p.action==='switch')activate(s,p.gardenId);
      else if(p.action==='edit'){
        if(!Number.isSafeInteger(p.revision)||p.revision<1)reject(400,'缺少有效的圈子版本');
        const [name,subtitle]=gardenText(p.name,p.subtitle);
        const updated=run('UPDATE mc_gardens SET name=?, subtitle=?, revision=revision+1 WHERE id=? AND revision=?',name,subtitle,p.gardenId,p.revision);
        if(!updated.changes)reject(409,'圈子资料已更新，请刷新后再保存');
      }else{
        const existing=get('SELECT code FROM mc_garden_codes WHERE garden=?',p.gardenId);
        if(existing&&p.action==='invite')extra={inviteCode:existing.code};
        else{
          const code='LZ-'+randomBytes(16).toString('hex').toUpperCase();
          run('INSERT INTO mc_garden_codes(garden,code) VALUES(?,?) ON CONFLICT(garden) DO UPDATE SET code=excluded.code',p.gardenId,code);
          extra={inviteCode:code};
        }
      }
    }else if(p.action==='read'){
      if(!published.some(n=>n.id===p.noticeId))reject(400,'公告不存在');
      run('INSERT OR IGNORE INTO mc_reads VALUES(?,?)',s.accountId,p.noticeId);
    }else reject(400,'无效操作');
    return json({...state(s),...extra});
  }
  async function handle(request,context={}){
    try{
      const url=new URL(request.url);
      if(!['/api/account','/api/workspace'].includes(url.pathname))return json({error:'未找到'},404);
      if(request.method==='GET'&&url.pathname==='/api/workspace'){
        const s=resolveSession(request);if(!s)reject(401,'请先登录');
        if(url.searchParams.has('members'))return rosterResponse(all(circleRoster,url.searchParams.get('members'),s.accountId));
        return json(state(s));
      }
      if(request.method!=='POST')return json({error:'不支持此方法'},405);
      if(request.headers.get('origin')!==url.origin)reject(403,'请从应用内操作');
      const p=await request.json().catch(()=>null);
      if(!p||typeof p!=='object'||Array.isArray(p))reject(400,'无效请求');
      if(url.pathname==='/api/account')return await account(request,p,context);
      const s=resolveSession(request);if(!s)reject(401,'请先登录');
      if(p.action==='join')limit(s.accountId,'join');
      return tx(db,()=>workspace(s,p));
    }catch(e){if(e instanceof InputError)return json({error:e.message},e.code);throw e;}
  }
  function importLegacy(legacyDb,{legacyOwnerSlot=null}={}){
    if(!legacyDb||legacyDb===db)throw Error('Use a separate, explicitly selected legacy database.');
    const table=name=>!!legacyDb.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    if(!table('camp_accounts'))throw Error('Legacy camp_accounts is missing.');
    legacyDb.exec('BEGIN');
    let rows,sessions,reads;
    try{
      rows=legacyDb.prepare('SELECT slot,username,salt,verifier FROM camp_accounts ORDER BY slot').all();
      sessions=table('camp_sessions')?legacyDb.prepare('SELECT token,slot,expires FROM camp_sessions WHERE expires>?').all(Date.now()):[];
      reads=table('release_reads')?legacyDb.prepare('SELECT member,version FROM release_reads').all():[];
      legacyDb.exec('COMMIT');
    }catch(e){legacyDb.exec('ROLLBACK');throw e;}
    return tx(db,()=>{
      let imported=0,importedSessions=0;const ids=new Map();
      if(legacyOwnerSlot!==null&&!rows.some(row=>row.slot===legacyOwnerSlot))throw Error('Selected owner slot is not present in the legacy source.');
      if(rows.length)run('INSERT OR IGNORE INTO mc_gardens(id,name) VALUES(?,?)',LEGACY_GARDEN_ID,'原荔枝园');
      for(const row of rows){
        if(![1,2,3].includes(row.slot)||typeof row.username!=='string'||!row.username||row.username.length>14||typeof row.salt!=='string'||!row.salt||!hex64.test(row.verifier))throw Error('Invalid legacy account row.');
        const fingerprint=hash(JSON.stringify([row.username,row.salt,row.verifier]));
        const m=get('SELECT * FROM mc_legacy_slots WHERE slot=?',row.slot);
        if(m){
          if(m.source_digest!==fingerprint)throw Error('Legacy source differs from the imported account.');
          ids.set(row.slot,m.account);continue;
        }
        if(get('SELECT 1 FROM mc_accounts WHERE username=?',row.username))throw Error('Legacy username conflicts with an existing account.');
        const id=randomUUID();
        run('INSERT INTO mc_accounts VALUES(?,?,?,?,?,?)',id,row.username,row.salt,row.verifier,100000,LEGACY_GARDEN_ID);
        run("INSERT INTO mc_members VALUES(?,?,?,'member')",id,LEGACY_GARDEN_ID,row.slot);
        run('INSERT INTO mc_legacy_slots VALUES(?,?,?)',row.slot,id,fingerprint);ids.set(row.slot,id);imported++;
      }
      for(const s of sessions){
        if(!ids.has(s.slot)||!hex64.test(s.token)||!Number.isSafeInteger(s.expires))throw Error('Invalid legacy session row.');
        // Do not restore a logged-out session when the same source is imported again.
        if(!run('INSERT OR IGNORE INTO mc_legacy_sessions VALUES(?)',s.token).changes)continue;
        run('INSERT INTO mc_sessions VALUES(?,?,?,?,?)',s.token,'legacy',ids.get(s.slot),LEGACY_GARDEN_ID,s.expires);importedSessions++;
      }
      for(const r of reads){
        const id=ids.get(Number(r.member)),notice=published.find(n=>n.id===r.version||n.id==='release-'+r.version);
        if(id&&notice)run('INSERT OR IGNORE INTO mc_reads VALUES(?,?)',id,notice.id);
      }
      if(legacyOwnerSlot!==null){
        const owner=get("SELECT slot FROM mc_members WHERE garden=? AND role='owner'",LEGACY_GARDEN_ID);
        if(owner&&owner.slot!==legacyOwnerSlot)throw Error('An existing garden owner cannot be reassigned by import.');
        run("UPDATE mc_members SET role='owner' WHERE garden=? AND slot=?",LEGACY_GARDEN_ID,legacyOwnerSlot);
      }
      return {gardenId:rows.length?LEGACY_GARDEN_ID:null,imported,importedSessions};
    });
  }
  return {handle,resolveSession,resolveMember,importLegacy};
}
