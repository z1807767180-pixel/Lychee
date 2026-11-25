import {createRequire as lycheeCreateRequire} from 'node:module'; const require = lycheeCreateRequire(import.meta.url);
import {
  answer,
  db,
  hash,
  random,
  sameOrigin,
  schema,
  tokenOf,
  verifier
} from "./chunk-ZIGCNLDY.mjs";

// lib/invite-digests.ts
var invites = [process.env.LYCHEE_LEGACY_SLOT_1_INVITE_DIGEST || null, process.env.LYCHEE_LEGACY_SLOT_2_INVITE_DIGEST || null, process.env.LYCHEE_LEGACY_SLOT_3_INVITE_DIGEST || null];
var sharedInviteDigest = process.env.LYCHEE_LEGACY_SHARED_INVITE_DIGEST || null;

// app/api/account/route.ts
var dynamic = "force-dynamic";
var cookie = (v, age) => `__Host-lychee=${v}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
async function POST(req) {
  if (!sameOrigin(req)) return answer({ error: "\u8BF7\u4ECE\u4FBF\u7B7E\u9875\u9762\u64CD\u4F5C" }, 403);
  const p = await req.json().catch(() => null);
  if (!p || typeof p !== "object") return answer({ error: "\u8BF7\u6C42\u65E0\u6548" }, 400);
  await schema();
  const sql = db();
  if (p.mode === "logout") {
    const token = tokenOf(req);
    if (token) await sql.prepare("DELETE FROM camp_sessions WHERE token=?").bind(await hash(token)).run();
    return answer({ ok: true }, 200, cookie("", 0));
  }
  const name = typeof p.name === "string" ? p.name.trim() : "", pw = p.password;
  if (!["login", "register"].includes(p.mode) || !name || name.length > 14 || typeof pw !== "string" || pw.length < 8 || pw.length > 128) return answer({ error: "\u7528\u6237\u540D\u9650 1\u201314 \u5B57\uFF0C\u5BC6\u7801\u9650 8\u2013128 \u4F4D" }, 400);
  const now = Date.now(), bucket = await hash((req.headers.get("cf-connecting-ip") || "shared") + ":" + Math.floor(now / 6e5));
  const [, , limit] = await sql.batch([
    sql.prepare("DELETE FROM camp_attempts WHERE until<?").bind(now),
    sql.prepare("DELETE FROM camp_sessions WHERE expires<=?").bind(now),
    sql.prepare("INSERT INTO camp_attempts VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET hits=hits+1 RETURNING hits").bind(bucket, now + 6e5)
  ]);
  if (Number(limit.results[0]?.hits) > 40) return answer({ error: "\u5C1D\u8BD5\u8FC7\u4E8E\u9891\u7E41\uFF0C\u8BF7\u7A0D\u540E\u518D\u8BD5" }, 429);
  const session = random(), sessionHash = await hash(session), age = 30 * 86400;
  const saveSession = (id) => sql.prepare("INSERT INTO camp_sessions VALUES(?,?,?)").bind(sessionHash, id, now + age * 1e3);
  if (p.mode === "register") {
    if (typeof p.invite !== "string" || p.invite.length > 100) return answer({ error: "\u9080\u8BF7\u65E0\u6548" }, 400);
    const digest = await hash(p.invite.trim());
    const slot = invites.indexOf(digest) + 1;
    if (!slot && digest !== sharedInviteDigest) return answer({ error: "\u9080\u8BF7\u65E0\u6548" }, 403);
    const salt = random(), v = await verifier(pw, salt);
    try {
      await sql.batch([
        sql.prepare("INSERT INTO camp_accounts VALUES(COALESCE(NULLIF(?,0),(SELECT MIN(s) FROM (SELECT 1 s UNION ALL SELECT 2 UNION ALL SELECT 3) WHERE s NOT IN (SELECT slot FROM camp_accounts)),4),?,?,?)").bind(slot, name, salt, v),
        sql.prepare("INSERT INTO camp_profiles SELECT CAST(slot AS TEXT),username,a,'','\u4F11\u606F','' FROM camp_accounts CROSS JOIN (SELECT 0 a UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) WHERE username=? AND a NOT IN(SELECT avatar FROM camp_profiles) ORDER BY CASE WHEN a=slot-1 THEN 0 ELSE 1 END,a LIMIT 1").bind(name),
        sql.prepare("INSERT INTO camp_sessions SELECT ?,slot,? FROM camp_accounts WHERE username=?").bind(sessionHash, now + age * 1e3, name)
      ]);
    } catch (e) {
      if (String(e).includes("CHECK")) return answer({ error: "\u4E09\u4E2A\u8D26\u53F7\u90FD\u5DF2\u521B\u5EFA\uFF0C\u8BF7\u76F4\u63A5\u767B\u5F55" }, 409);
      if (String(e).includes("UNIQUE")) return answer({ error: "\u7528\u6237\u540D\u5DF2\u88AB\u4F7F\u7528\uFF0C\u6216\u9080\u8BF7\u540D\u989D\u5DF2\u9886\u53D6" }, 409);
      throw e;
    }
  } else {
    const user = await sql.prepare("SELECT slot,salt,verifier FROM camp_accounts WHERE username=?").bind(name).first();
    const v = await verifier(pw, user?.salt ?? "lychee-login-fallback");
    if (!user || v !== user.verifier) return answer({ error: "\u7528\u6237\u540D\u6216\u5BC6\u7801\u4E0D\u6B63\u786E" }, 401);
    await saveSession(user.slot).run();
  }
  return answer({ ok: true }, 200, cookie(session, age));
}
export {
  POST,
  dynamic
};
