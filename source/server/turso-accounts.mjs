import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {
  accountSchema, circleRoster, gardensForAccount, rosterResponse, cookie, derive, gardenText, hash, InputError, json, LEGACY_GARDEN_ID,
  life, newCookie, oldCookie, publishedNotices, reject, textOK, tokens, joinMembership,
} from './accounts.mjs';

const stmt = (sql, ...args) => ({sql, args});
const execute = (db, sql, ...args) => db.execute(stmt(sql, ...args));
const rows = async (db, sql, ...args) => (await execute(db, sql, ...args)).rows;
const first = async (db, sql, ...args) => (await rows(db, sql, ...args))[0] ?? null;

async function transaction(client, mode, work) {
  const tx = await client.transaction(mode);
  try {
    const value = await work(tx);
    await tx.commit();
    return value;
  } catch (error) {
    try { await tx.rollback(); } catch { /* Preserve the operation or commit error. */ }
    throw error;
  } finally {
    tx.close();
  }
}

export async function ensureTursoAccountsSchema(client) {
  await client.batch([...accountSchema,
    'CREATE TABLE IF NOT EXISTS mc_legacy_revoked(digest TEXT PRIMARY KEY,expires INTEGER NOT NULL)',
  ], 'write');
  await transaction(client, 'write', async tx => {
    const columns = new Set((await rows(tx, "PRAGMA table_info('mc_gardens')")).map(r => r.name));
    if (!columns.has('subtitle')) await execute(tx, "ALTER TABLE mc_gardens ADD COLUMN subtitle TEXT NOT NULL DEFAULT ''");
    if (!columns.has('revision')) await execute(tx, 'ALTER TABLE mc_gardens ADD COLUMN revision INTEGER NOT NULL DEFAULT 1');
  });
}

const readMember = async (db, accountId, gardenId) => {
  if (typeof accountId !== 'string' || typeof gardenId !== 'string') return null;
  return first(db, `SELECT m.account AS accountId,a.username,m.garden AS gardenId,m.slot,m.role
    FROM mc_members m JOIN mc_accounts a ON a.id=m.account WHERE m.account=? AND m.garden=?`, accountId, gardenId);
};

export async function createTursoAccounts(client, {notices = []} = {}) {
  const published = publishedNotices(notices);
  await ensureTursoAccountsSchema(client);
  let hasLegacySessions = false;
  async function legacySessionsExist(db) {
    if (!hasLegacySessions) hasLegacySessions = Boolean(await first(db,
      "SELECT 1 FROM sqlite_master WHERE type='table' AND name='camp_sessions'"));
    return hasLegacySessions;
  }
  async function authenticate(db, request) {
    const t = tokens(request), kind = t.has(newCookie) ? 'account' : 'legacy';
    const digest = t.get(kind === 'account' ? newCookie : oldCookie);
    if (!digest) return null;
    let record;
    if (kind === 'account') {
      record = await first(db, `SELECT s.account AS accountId,a.username,m.garden AS gardenId,m.slot,s.expires
        FROM mc_sessions s JOIN mc_accounts a ON a.id=s.account
        LEFT JOIN mc_members m ON m.account=s.account AND m.garden=s.active_garden
        WHERE s.token_hash=? AND s.kind='account' AND s.expires>?`, digest, Date.now());
    } else if (await legacySessionsExist(db)) {
      // Legacy logout deletes this row. A migrated token or saved garden preference
      // alone cannot authenticate it; future legacy logins work after slot mapping.
      record = await first(db, `SELECT a.id AS accountId,a.username,m.garden AS gardenId,m.slot,s.expires
        FROM camp_sessions s JOIN mc_legacy_slots l ON l.slot=s.slot JOIN mc_accounts a ON a.id=l.account
        LEFT JOIN mc_sessions pref ON pref.token_hash=s.token AND pref.account=a.id AND pref.kind='legacy'
        LEFT JOIN mc_members m ON m.account=a.id AND m.garden=COALESCE(pref.active_garden,?)
        WHERE s.token=? AND s.expires>? AND NOT EXISTS(SELECT 1 FROM mc_legacy_revoked r WHERE r.digest=s.token)`,
      LEGACY_GARDEN_ID, digest, Date.now());
    }
    return record ? {...record, tokenHash:digest, kind} : null;
  }

  async function state(db, session) {
    const gardens = await rows(db, gardensForAccount, session.accountId);
    const seen = new Set((await rows(db,'SELECT notice FROM mc_reads WHERE account=?',session.accountId)).map(r => r.notice));
    return {account:{id:session.accountId,username:session.username}, gardens,
      activeGardenId:gardens.some(g => g.id === session.gardenId) ? session.gardenId : null,
      notices:published.map(n => ({...n, read:seen.has(n.id)}))};
  }
  async function mustAuthenticate(db, request) {
    const found = await authenticate(db, request);
    if (!found) reject(401,'请先登录');
    return found;
  }
  async function revoke(db, request) {
    for (const [name,digest] of tokens(request)) {
      if (!digest) continue;
      if (name === oldCookie && await legacySessionsExist(db)) {
        await execute(db, `INSERT OR IGNORE INTO mc_legacy_revoked(digest,expires)
          SELECT token,expires FROM camp_sessions WHERE token=? AND expires>?`, digest,Date.now());
      }
      await execute(db,'DELETE FROM mc_sessions WHERE token_hash=? AND kind=?',digest,name === newCookie ? 'account' : 'legacy');
    }
  }
  async function issue(db, request, account) {
    const token = randomBytes(32).toString('hex');
    await revoke(db,request);
    await execute(db,`INSERT INTO mc_sessions(token_hash,kind,account,active_garden,expires)
      VALUES(?,'account',?,?,?)`,hash(token),account.id,account.last_garden ?? null,Date.now()+life);
    return json({ok:true},200,[cookie(newCookie,token,life/1000),cookie(oldCookie,'',0)]);
  }
  async function limit(peer, domain) {
    const now = Date.now(), period = Math.floor(now/600000), bucket = hash(domain+'|'+peer+'|'+period);
    const [,count] = await client.batch([
      stmt('DELETE FROM mc_attempts WHERE until<=?',now),
      stmt('INSERT INTO mc_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits',bucket,(period+1)*600000),
    ],'write');
    if (count.rows[0].hits > 40) reject(429,'尝试过于频繁，请稍后再试');
  }
  async function account(request, p, context) {
    if (p.mode === 'logout') return transaction(client,'write',async tx => {
      await revoke(tx,request);
      return json({ok:true},200,[cookie(newCookie,'',0),cookie(oldCookie,'',0)]);
    });
    if (!['register','login'].includes(p.mode) || typeof p.name !== 'string' || !p.name.trim() ||
        p.name.trim().length > 14 || typeof p.password !== 'string' || p.password.length < 8 || p.password.length > 128) {
      reject(400,'用户名限 1–14 字，密码限 8–128 位');
    }
    const name = p.name.trim();
    await limit(context.peerId ?? 'shared','account');
    await client.batch([stmt('DELETE FROM mc_sessions WHERE expires<=?',Date.now()),
      stmt('DELETE FROM mc_legacy_revoked WHERE expires<=?',Date.now())],'write');
    if (p.mode === 'register') {
      if (!textOK(name,14)) reject(400,'请检查用户名');
      const id = randomUUID(), salt = randomBytes(32).toString('hex');
      const verifier = (await derive(p.password,salt,600000,32,'sha256')).toString('hex');
      return transaction(client,'write',async tx => {
        // Old clients can still create one of their original slots after cutover.
        // Reserve that username until the operator includes the slot in the mapping.
        const oldAccounts=await first(tx,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='camp_accounts'");
        if (oldAccounts && await first(tx,'SELECT 1 FROM camp_accounts WHERE username=? COLLATE NOCASE LIMIT 1',name)) {
          reject(409,'用户名不可用');
        }
        const result = await execute(tx,`INSERT INTO mc_accounts(id,username,salt,verifier,iterations)
          VALUES(?,?,?,?,600000) ON CONFLICT(username) DO NOTHING`,id,name,salt,verifier);
        if (!result.rowsAffected) reject(409,'用户名不可用');
        return issue(tx,request,{id});
      });
    }
    const user = await first(client,'SELECT * FROM mc_accounts WHERE username=?',name);
    const candidate = await derive(p.password,user?.salt ?? 'lychee-login-fallback',user?.iterations ?? 600000,32,'sha256');
    if (!user || !timingSafeEqual(candidate,Buffer.from(user.verifier,'hex'))) reject(401,'用户名或密码不正确');
    return transaction(client,'write',tx => issue(tx,request,user));
  }

  async function activate(db,s,garden) {
    if (s.kind === 'legacy') {
      await execute(db,`INSERT INTO mc_sessions(token_hash,kind,account,active_garden,expires)
        VALUES(?,'legacy',?,?,?) ON CONFLICT(token_hash) DO UPDATE SET active_garden=excluded.active_garden
        WHERE kind='legacy' AND account=excluded.account`,s.tokenHash,s.accountId,garden,s.expires);
    } else {
      await execute(db,"UPDATE mc_sessions SET active_garden=? WHERE token_hash=? AND kind='account'",garden,s.tokenHash);
    }
    await execute(db,'UPDATE mc_accounts SET last_garden=? WHERE id=?',garden,s.accountId);
    s.gardenId=garden;
  }
  async function workspace(tx,s,p) {
    let extra={};
    switch (p.action) {
      case 'create': {
        const [name,subtitle]=gardenText(p.name,p.subtitle === undefined ? '' : p.subtitle);
        const id=randomUUID();
        await execute(tx,'INSERT INTO mc_gardens(id,name,subtitle) VALUES(?,?,?)',id,name,subtitle);
        await execute(tx,"INSERT INTO mc_members(account,garden,slot,role) VALUES(?,?,1,'owner')",s.accountId,id);
        await activate(tx,s,id);
        break;
      }
      case 'join': {
        if (typeof p.code !== 'string' || !/^LZ-[a-f0-9]{32}$/i.test(p.code.trim())) reject(400,'邀请码无效');
        const invite=await first(tx,'SELECT garden FROM mc_garden_codes WHERE code=?',p.code.trim().toUpperCase());
        if (!invite) reject(400,'邀请码无效');
        await execute(tx,joinMembership,s.accountId,invite.garden);
        await activate(tx,s,invite.garden);
        break;
      }
      case 'switch':
      case 'invite':
      case 'rotateInvite':
      case 'edit': {
        const member=await readMember(tx,s.accountId,p.gardenId);
        if (!member) reject(403,'需要先加入这个圈子');
        if (p.action==='switch') {
          await activate(tx,s,p.gardenId);
        } else if (p.action==='edit') {
          if (!Number.isSafeInteger(p.revision)||p.revision<1) reject(400,'缺少有效的圈子版本');
          const [name,subtitle]=gardenText(p.name,p.subtitle);
          const result=await execute(tx,'UPDATE mc_gardens SET name=?,subtitle=?,revision=revision+1 WHERE id=? AND revision=?',name,subtitle,p.gardenId,p.revision);
          if (!result.rowsAffected) reject(409,'圈子资料已更新，请刷新后再保存');
        } else {
          const code='LZ-'+randomBytes(16).toString('hex').toUpperCase();
          const existing=p.action==='invite' && await first(tx,'SELECT code FROM mc_garden_codes WHERE garden=?',p.gardenId);
          if (existing) extra={inviteCode:existing.code};
          else {
            await execute(tx,`INSERT INTO mc_garden_codes(garden,code) VALUES(?,?)
              ON CONFLICT(garden) DO UPDATE SET code=excluded.code`,p.gardenId,code);
            extra={inviteCode:code};
          }
        }
        break;
      }
      case 'read':
        if (!published.some(n=>n.id===p.noticeId)) reject(400,'公告不存在');
        await execute(tx,'INSERT OR IGNORE INTO mc_reads(account,notice) VALUES(?,?)',s.accountId,p.noticeId);
        break;
      default: reject(400,'无效操作');
    }
    return json({...await state(tx,s),...extra});
  }

  async function handle(request,context={}) {
    try {
      const url=new URL(request.url);
      const path=url.pathname.replace(/^\/api\/v640\/(account|workspace)$/,'/api/$1');
      if (!['/api/account','/api/workspace'].includes(path)) return json({error:'未找到'},404);
      if (path==='/api/workspace' && request.method==='GET') {
        return await transaction(client,'read',async tx => {
          const session=await mustAuthenticate(tx,request);
          if(url.searchParams.has('members'))return rosterResponse(await rows(tx,circleRoster,url.searchParams.get('members'),session.accountId));
          return json(await state(tx,session));
        });
      }
      if (request.method!=='POST') return json({error:'不支持此方法'},405);
      if (request.headers.get('origin')!==url.origin) reject(403,'请从应用内操作');
      const p=await request.json().catch(()=>null);
      if (!p || typeof p!=='object' || Array.isArray(p)) reject(400,'无效请求');
      if (path==='/api/account') return await account(request,p,context);
      if (p.action==='join') {
        const session=await mustAuthenticate(client,request);
        await limit(session.accountId,'join');
      }
      return await transaction(client,'write',async tx => workspace(tx,await mustAuthenticate(tx,request),p));
    } catch(error) {
      if (error instanceof InputError) return json({error:error.message},error.code);
      throw error;
    }
  }

  return {
    handle,
    resolveSession:request=>authenticate(client,request),
    resolveMember:(accountId,gardenId)=>readMember(client,accountId,gardenId),
    async importLegacy(options={}) {
      const {migrateTursoLegacy}=await import('./turso-migrate.mjs');
      return migrateTursoLegacy(client,{...options,notices:published});
    },
  };
}
