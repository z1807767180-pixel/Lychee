import {readFile} from 'node:fs/promises';
import {advance, drawQuestions, publicGame, READY_MS, scores, submit} from './quiz-rounds.mjs';

const reply = (body, status = 200) => Response.json(body, {status, headers:{'cache-control':'private, no-store'}});
const fail = (status, error) => reply({error}, status);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const schema = [
  `CREATE TABLE IF NOT EXISTS mc_quiz_game(id TEXT PRIMARY KEY, garden TEXT NOT NULL,
    host INTEGER NOT NULL, guest INTEGER NOT NULL, created INTEGER NOT NULL, revision INTEGER NOT NULL,
    status TEXT NOT NULL, state TEXT NOT NULL, host_score INTEGER NOT NULL DEFAULT 0, guest_score INTEGER NOT NULL DEFAULT 0)`,
  'CREATE INDEX IF NOT EXISTS mc_quiz_garden_status ON mc_quiz_game(garden,status,created)',
  `CREATE TABLE IF NOT EXISTS mc_quiz_rank(garden TEXT NOT NULL,slot INTEGER NOT NULL,
    stars INTEGER NOT NULL,played INTEGER NOT NULL,PRIMARY KEY(garden,slot))`,
  // Ranking and completion commit in the same database statement, including on libSQL.
  `CREATE TRIGGER IF NOT EXISTS mc_quiz_finish AFTER UPDATE OF status ON mc_quiz_game
   WHEN OLD.status='active' AND NEW.status='done' BEGIN
     UPDATE mc_quiz_game SET state=json_set(state,'$.starChanges',json_array(
       CASE WHEN NEW.host_score>NEW.guest_score THEN 1 WHEN NEW.host_score<NEW.guest_score AND EXISTS
         (SELECT 1 FROM mc_quiz_rank WHERE garden=NEW.garden AND slot=NEW.host AND stars>0) THEN -1 ELSE 0 END,
       CASE WHEN NEW.guest_score>NEW.host_score THEN 1 WHEN NEW.guest_score<NEW.host_score AND EXISTS
         (SELECT 1 FROM mc_quiz_rank WHERE garden=NEW.garden AND slot=NEW.guest AND stars>0) THEN -1 ELSE 0 END))
       WHERE id=NEW.id;
     INSERT INTO mc_quiz_rank(garden,slot,stars,played) VALUES(NEW.garden,NEW.host,NEW.host_score>NEW.guest_score,1)
       ON CONFLICT(garden,slot) DO UPDATE SET played=played+1,stars=MAX(0,stars+(NEW.host_score>NEW.guest_score)-(NEW.host_score<NEW.guest_score));
     INSERT INTO mc_quiz_rank(garden,slot,stars,played) VALUES(NEW.garden,NEW.guest,NEW.guest_score>NEW.host_score,1)
       ON CONFLICT(garden,slot) DO UPDATE SET played=played+1,stars=MAX(0,stars+(NEW.guest_score>NEW.host_score)-(NEW.guest_score<NEW.host_score));
   END`,
];

let bank;
function loadBank() {
  return bank ??= readFile(new URL('./quiz-bank.json', import.meta.url),'utf8').then(JSON.parse)
    .catch(error => { bank = undefined; throw error; });
}

export function createQuizGames(execute, {clock = Date.now, getBank = loadBank, names, announce} = {}) {
  const exec = (sql, ...args) => execute(sql, args);
  let initialized;
  async function init() {
    for (const sql of schema) await exec(sql);
  }
  async function recentQuestions(garden, host, guest) {
    const {rows} = await exec(`SELECT state,created FROM mc_quiz_game WHERE garden=? AND status IN ('done','active')
      AND (host IN (?,?) OR guest IN (?,?)) ORDER BY created DESC LIMIT 32`,garden,host,guest,host,guest);
    const recent = new Map();
    for (const row of rows) for (const q of JSON.parse(row.state).rounds) {
      if (!recent.has(q.id)) recent.set(q.id,Number(row.created));
    }
    return recent;
  }

  async function update(id, garden, slot, action, body, now) {
    for (let attempt = 0; attempt < 6; ++attempt) {
      const {rows:[row]} = await exec('SELECT * FROM mc_quiz_game WHERE id=? AND garden=?',id,garden);
      if (!row) return fail(404,'找不到这场对局');
      const side = Number(row.host) === slot ? 0 : Number(row.guest) === slot ? 1 : -1;
      if (side < 0) return fail(403,'仅限本局两位园友');
      const state = JSON.parse(row.state);
      let changed = advance(state,now);
      if (action === 'accept') {
        if (side !== 1) return fail(403,'由受邀园友应战');
        if (state.status === 'pending') {
          state.rounds = drawQuestions(await getBank(),await recentQuestions(garden,row.host,row.guest));
          state.status = 'active';
          state.start = clock() + READY_MS;
          changed = true;
        }
      } else if (action === 'cancel' && state.status === 'pending') {
        state.status = 'cancelled';
        changed = true;
      } else if (action === 'answer') {
        if (!Number.isInteger(body.choice) || body.choice < 0 || body.choice > 3 ||
            !Number.isInteger(body.round) || body.round < 0 || body.round > 4) return fail(400,'答案格式有误');
        changed = submit(state,side,body.round,body.choice,now) || changed;
      }
      if (changed) {
        const [left,right] = scores(state);
        const saved = await exec(`UPDATE mc_quiz_game SET revision=revision+1,status=?,state=?,host_score=?,guest_score=?
          WHERE id=? AND revision=?`,state.status,JSON.stringify(state),left,right,id,row.revision);
        if (!saved.rowsAffected || state.status === 'done') continue;
      }
      return reply(publicGame(row,state,side,clock()));
    }
    return fail(409,'对局状态已变更，请刷新');
  }

  async function lobby(garden, slot, now, profiles) {
    // Unattended matches can still change the leaderboard. Settle only full-length expired games.
    const expired = await exec(`SELECT id,host FROM mc_quiz_game WHERE garden=? AND status='active'
      AND CAST(json_extract(state,'$.start') AS INTEGER)+12000<=?`,garden,now);
    for (const game of expired.rows) await update(game.id,garden,Number(game.host),'read',{},now);
    const {rows:members} = await exec(`SELECT m.slot,a.username AS name,COALESCE(r.stars,0) AS stars,
      COALESCE(r.played,0) AS played FROM mc_members m JOIN mc_accounts a ON a.id=m.account
      LEFT JOIN mc_quiz_rank r ON r.garden=m.garden AND r.slot=m.slot WHERE m.garden=?
      ORDER BY (COALESCE(r.played,0)>0) DESC,stars DESC,m.slot`,garden);
    const {rows:invitations} = await exec(`SELECT id,host,guest,status FROM mc_quiz_game WHERE garden=?
      AND (host=? OR guest=?) AND status IN ('pending','active') ORDER BY created DESC`,garden,slot,slot);
    const roster = members.map(m => ({...m, name:profiles.get(Number(m.slot)) || m.name}));
    return reply({slot,members:roster,invitations,serverTime:now});
  }

  return async function handle(request, member) {
    await (initialized ??= init().catch(error => { initialized=undefined; throw error; }));
    const now = clock(), slot = Number(member.slot), garden = member.gardenId;
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) {
        const profiles = names ? await names(request,member) : new Map();
        return profiles ? lobby(garden,slot,now,profiles) : fail(503,'圈内昵称暂时无法读取，请重试');
      }
      return uuid.test(id) ? update(id,garden,slot,'read',{},now) : fail(400,'无效的对局编号');
    }
    if (request.method !== 'POST') return fail(405,'不支持此操作');
    let body;
    try { body = await request.json(); } catch { return fail(400,'请求格式有误'); }
    if (!body || !uuid.test(body.id) || !['invite','accept','cancel','answer'].includes(body.action)) {
      return fail(400,'无效的对局操作');
    }
    if (body.action === 'invite') {
      if (!Number.isSafeInteger(body.guest) || body.guest <= 0 || body.guest === slot) return fail(400,'请选择另一位园友');
      const {rows:[guest]} = await exec(`SELECT a.username AS name FROM mc_members m JOIN mc_accounts a ON m.account=a.id
        WHERE m.garden=? AND m.slot=?`,garden,body.guest);
      if (!guest) return fail(404,'受邀人不在本园');
      const result = await exec(`INSERT INTO mc_quiz_game(id,garden,host,guest,created,revision,status,state)
        VALUES(?,?,?,?,?,0,'pending',?) ON CONFLICT(id) DO NOTHING`,body.id,garden,slot,body.guest,now,
        JSON.stringify({status:'pending',round:0,rounds:[]}));
      if (!result.rowsAffected) {
        const {rows:[same]} = await exec('SELECT 1 FROM mc_quiz_game WHERE id=? AND garden=? AND host=? AND guest=?',
          body.id,garden,slot,body.guest);
        if (!same) return fail(409,'邀请编号冲突');
      }
      if (announce) {
        const game = await update(body.id,garden,slot,'read',body,now);
        if (!game.ok) return game;
        const view = await game.json();
        // The UUID doubles as the chat idempotency key: retrying cannot create two cards.
        if (view.status === 'pending') {
          const profiles = names ? await names(request,member) : new Map();
          view.chatDelivered = Boolean(profiles && await announce(request,member,body.id,profiles.get(body.guest) || guest.name));
        }
        return reply(view);
      }
    }
    return update(body.id,garden,slot,body.action,body,now);
  };
}
