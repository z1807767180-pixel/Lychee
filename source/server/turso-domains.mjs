import { constants, DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDomainPool } from './domains.mjs';
import { createTursoClient } from './turso-client.mjs';

const bundled = join(dirname(fileURLToPath(import.meta.url)), '../legacy');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// These are schema identifiers in the original business release. No column or
// result alias uses one of these names. SQL parameters never pass through this map.
const objects = new Set(`camp_accounts camp_attempts camp_profiles camp_sessions camp_sessions_expiry chat_details
chat_mentions chat_pictures clear_previous_gomoku daily_chat_created daily_custom_answers daily_questions daily_shifts
daily_votes edit_phone_ledger goal gomoku gomoku_clear_undo gomoku_close_undo gomoku_comments gomoku_pending gomoku_undo
journal_album journal_photos journal_photos_post journal_posts journal_stickers journal_votes notes orchard_branch_owner
orchard_calendar orchard_care orchard_duels orchard_gifts orchard_irrigation orchard_root orchard_water
phone_circle_chat_day_v1 phone_circle_chat_v1 phone_circles_v1 phone_comments phone_comments_post phone_expense_details
phone_expenses phone_focus phone_garden phone_income phone_ledger phone_portraits phone_posts phone_style phone_timer_details
release_preferences release_reads remove_chat_details remove_chat_mentions remove_chat_picture riddle_attempts soup_log
soup_one_active soup_personal_active soup_personal_round soup_played soup_round soup_turn soup_tutorial_seen team_riddles
v61_answers v61_answers_question v61_events v61_events_member v61_favorites v61_goals v61_notices_read v61_personal
v61_post_meta v61_question_images v61_questions v61_reactions v61_tasks v61_tasks_member v62_ai_image_parts v62_ai_images
v62_ai_messages v62_ai_meta v62_ai_msg v62_ai_probe v62_ai_threads v62_ai_usage v62_cover v62_task_rules
yard65_care yard65_fruit yard65_inbox yard65_ribbon_member yard65_root garden_member_bindings garden_image_fences`.split(/\s+/));
const token = /--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[a-zA-Z_][a-zA-Z0-9_$]*/g;

// A memory-only SQLite schema compiles each distinct outgoing statement. No
// business rows are copied here. SQLite resolves joins, triggers and views on
// the garden's own schema before the service can send SQL to the shared file.
async function namespace(client,gardenId) {
  if (gardenId !== 'legacy' && !uuid.test(gardenId)) throw Error('Invalid garden identifier');
  const legacy=gardenId==='legacy',prefix=legacy?'':'g_'+gardenId.replaceAll('-','')+'_';
  const names=new Map([...objects].map(name=>[name,prefix+name]));
  if(legacy)names.set('garden_member_bindings','mc_legacy_member_bindings');
  const allowed=new Set(names.values());
  const extra='mc_legacy_extra_profiles', roster='mc_legacy_all_profiles';
  if(legacy){allowed.add(extra);allowed.add(roster);}
  const shadow=new DatabaseSync(':memory:');
  let creating=false,merged=false;
  const validated=new Set();
  const dbActions=new Set([constants.SQLITE_READ,constants.SQLITE_UPDATE,constants.SQLITE_INSERT,constants.SQLITE_DELETE]);
  shadow.setAuthorizer((action,object,detail)=>{
    if(dbActions.has(action)){
      if(creating && ['sqlite_master','sqlite_schema'].includes(object))return constants.SQLITE_OK;
      return allowed.has(object)?constants.SQLITE_OK:constants.SQLITE_DENY;
    }
    if([constants.SQLITE_CREATE_TABLE,constants.SQLITE_CREATE_VIEW,constants.SQLITE_CREATE_TRIGGER,constants.SQLITE_CREATE_INDEX,constants.SQLITE_REINDEX].includes(action)){
      if(allowed.has(object) || (creating && object.startsWith('sqlite_autoindex_') && allowed.has(detail)))return constants.SQLITE_OK;
      return constants.SQLITE_DENY;
    }
    return [constants.SQLITE_SELECT,constants.SQLITE_FUNCTION,constants.SQLITE_RECURSIVE].includes(action)?constants.SQLITE_OK:constants.SQLITE_DENY;
  });
  function validate(sql) {
    if(validated.has(sql))return;
    creating=/^\s*CREATE (?:UNIQUE )?(?:TABLE|INDEX|VIEW|TRIGGER) IF NOT EXISTS\b/i.test(sql);
    try{
      const stmt=shadow.prepare(sql);
      if(sql.slice(stmt.sourceSQL.length).trim())throw Error('Expected one business statement');
      if(creating)stmt.run();
      validated.add(sql);
    }finally{creating=false;}
  }
  function translate(q) {
    let {sql,args=[]}=q;
    const profileWrite=/^\s*INSERT INTO camp_profiles\b/i.test(sql);
    const readMerged=merged && !/^\s*CREATE\b/i.test(sql) && !profileWrite;
    sql=sql.replace(token,word=>{
      const lower=word.toLowerCase();
      if(legacy && lower==='camp_profiles'){
        if(profileWrite && Number(args[0])>3)return extra;
        if(readMerged)return roster;
      }
      return names.get(lower)??word;
    });
    if(legacy && merged && profileWrite && Number(args[0])<=3 && args.length===6){
      // Existing 4.1.7 profiles use unique avatars 0–3. New private-UI slots
      // live in the additive table and never consume an original avatar.
      sql=sql.replace('VALUES(?,?,?,?,?,?)','SELECT ?,?,?,?,?,? WHERE ? BETWEEN 0 AND 3 AND NOT EXISTS(SELECT 1 FROM camp_profiles WHERE avatar=? AND id<>?)');
      args=[...args,args[2],args[2],args[0]];
    }
    validate(sql);
    return {sql,args};
  }
  // The original release lazily ensures fixed schema groups. Record successful
  // groups atomically with their DDL, so a cold worker need not send those
  // writes again. The local schema is still compiled and checked on each boot.
  const history={sql:'SELECT signature FROM mc_domain_schema WHERE garden=?',args:[gardenId]};
  let historyRows;
  try { historyRows=await client.execute(history); }
  catch(error){
    if(!/no such table:\s*(?:main\.)?mc_domain_schema/i.test(error.message))throw error;
    await client.execute('CREATE TABLE IF NOT EXISTS mc_domain_schema(garden TEXT NOT NULL,signature TEXT NOT NULL,PRIMARY KEY(garden,signature))');
    historyRows=await client.execute(history);
  }
  const installed=new Set(historyRows.rows.map(row=>row.signature));
  function schemaGroup(queries){
    return queries.some(q=>/^\s*CREATE\b/i.test(q.sql)) && queries.every(q=>!q.args?.length &&
      /^\s*(?:CREATE (?:UNIQUE )?(?:TABLE|INDEX|VIEW|TRIGGER) IF NOT EXISTS\b|INSERT OR IGNORE INTO orchard_(?:root|calendar)\b)/i.test(q.sql));
  }
  async function run(queries,mode,single=false){
    const mapped=queries.map(translate);
    if(!schemaGroup(queries))return single?[await client.execute(mapped[0])]:client.batch(mapped,mode);
    const signature=createHash('sha256').update(JSON.stringify(mapped.map(q=>q.sql))).digest('hex');
    if(installed.has(signature))return mapped.map(()=>({rows:[],rowsAffected:0}));
    const result=await client.batch([...mapped,{sql:'INSERT OR IGNORE INTO mc_domain_schema(garden,signature) VALUES(?,?)',args:[gardenId,signature]}],'write');
    installed.add(signature);
    return result.slice(0,-1);
  }
  const driver={
    execute:async q=>(await run([q],'write',true))[0],
    batch:run,
  };
  async function afterSchema() {
    const schema=['CREATE TABLE IF NOT EXISTS garden_member_bindings(slot INTEGER PRIMARY KEY,account TEXT UNIQUE NOT NULL)'];
    if(legacy){
      schema.push('CREATE TABLE IF NOT EXISTS '+extra+'(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar INTEGER NOT NULL,mood TEXT NOT NULL,action TEXT NOT NULL,day TEXT NOT NULL)',
        'CREATE VIEW IF NOT EXISTS '+roster+' AS SELECT id,name,avatar,mood,action,day,CAST(id AS INTEGER) AS rowid FROM camp_profiles UNION ALL SELECT id,name,avatar,mood,action,day,CAST(id AS INTEGER) AS rowid FROM '+extra);
    }
    await driver.batch(schema.map(sql=>({sql})), 'write');
    merged=legacy;
    const bindings=names.get('garden_member_bindings'),profiles=names.get('camp_profiles');
    const seen=new Set();
    return async ({member:{slot,accountId,username}})=>{
      // Bind the slot to a stable account exactly once. The profile insert and
      // roster return both depend on that binding, also across service instances.
      const key=JSON.stringify([slot,accountId]);
      const select={sql:`SELECT p.id FROM ${legacy?roster:profiles} p WHERE EXISTS(SELECT 1 FROM ${bindings} WHERE slot=? AND account=?) ORDER BY CAST(p.id AS INTEGER)`,args:[slot,accountId]};
      if(seen.has(key)){
        const ids=(await client.execute(select)).rows.map(r=>r.id);
        return ids.includes(String(slot))?ids:false;
      }
      const target=legacy&&slot>3?extra:profiles;
      const id=String(slot), name=username.slice(0,14), avatar=(slot-1)%16;
      const membership=`EXISTS(SELECT 1 FROM ${bindings} WHERE slot=? AND account=?) AND NOT EXISTS(SELECT 1 FROM ${target} WHERE id=?)`;
      const insertProfile=legacy&&slot<=3 ? {
        sql:`INSERT INTO camp_profiles(id,name,avatar,mood,action,day)
          SELECT ?,?,candidate.avatar,'','休息','' FROM (SELECT 0 AS avatar UNION ALL SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3) candidate
          WHERE ${membership} AND NOT EXISTS(SELECT 1 FROM camp_profiles existing WHERE existing.avatar=candidate.avatar)
          ORDER BY (candidate.avatar=?) DESC,candidate.avatar LIMIT 1`,
        args:[id,name,slot,accountId,id,avatar],
      } : {sql:`INSERT INTO ${target}(id,name,avatar,mood,action,day) SELECT ?,?,?,'','休息','' WHERE ${membership}`,
        args:[id,name,avatar,slot,accountId,id]};
      const results=await client.batch([
        {sql:`INSERT OR IGNORE INTO ${bindings}(slot,account) VALUES(?,?)`,args:[slot,accountId]},
        insertProfile,
        select,
      ],'write');
      const ids=results[2].rows.map(r=>r.id);
      if(!ids.includes(String(slot)))return false;
      seen.add(key);return ids;
    };
  }
  return {driver,afterSchema,close(){shadow.close();client.close();}};
}

export async function openTursoGarden({url,authToken,legacyDir,gardenId}) {
  const client=await createTursoClient({url,authToken,legacyDir});
  try{return await namespace(client,gardenId);}catch(e){client.close();throw e;}
}
export function createTursoDomains({url,authToken,legacyDir=bundled,testProviderOrigin}) {
  return createDomainPool({legacyDir,testProviderOrigin,storage:gardenId=>{
    if(gardenId!=='legacy'&&!uuid.test(gardenId))throw Error('Invalid garden identifier');
    return {turso:{url,authToken}};
  }});
}
