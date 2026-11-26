// Keep the original release inputs reproducible. These inserts run in the
// same garden-scoped database batch as the message that causes the alert.
const ensureEvents = 'CREATE TABLE IF NOT EXISTS v61_events(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)';

export function notificationSource(name, source, once) {
  if (name === 'camp.mjs') {
    const insert = 'db2.prepare("INSERT INTO notes(id,name,avatar,body,created) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING")';
    source = once(source, insert, `db2.prepare(${JSON.stringify(ensureEvents)}),
        db2.prepare(\`INSERT OR IGNORE INTO v61_events(id,recipient,actor,kind,item,body,created)
          SELECT ?||':'||id,id,?,'chat',?,?||' 发来一条消息',? FROM camp_profiles
          WHERE id<>? AND NOT EXISTS(SELECT 1 FROM notes WHERE id=?)\`)
          .bind(noteId,id,noteId,author.name,now,id,noteId),
        ${insert}`);
    const recall = 'db2.prepare("DELETE FROM chat_mentions WHERE note_id=?").bind(target)';
    return once(source, recall, `db2.prepare(${JSON.stringify(ensureEvents)}),
      db2.prepare("DELETE FROM v61_events WHERE kind='chat' AND item=? AND EXISTS(SELECT 1 FROM notes WHERE id=? AND created>=?)").bind(target,target,cutoff),
      ${recall}`);
  }
  if (name === 'v61.mjs') {
    return once(source, "me,'reaction',id,'回应了 '", "me,p.kind==='question'?'question-reaction':'reaction',id,'回应了 '");
  }
  if (name === 'yard65.mjs') {
    const update="UPDATE yard65_fruit SET recipient=?,note=?,sent=? WHERE crop=? AND slot=? AND picker=? AND recipient IS NULL AND EXISTS(SELECT 1 FROM camp_profiles WHERE id=?)";
    return once(source, `await run("${update}",p.to,note,now,p.crop,p.slot,me,p.to);`, `await db.batch([
      db.prepare(${JSON.stringify(ensureEvents)}),
      prepare(db,"${update}",p.to,note,now,p.crop,p.slot,me,p.to),
      prepare(db,\`INSERT OR IGNORE INTO v61_events(id,recipient,actor,kind,item,body,created)
        SELECT 'fruit:'||crop||':'||slot,recipient,picker,'gift',crop||':'||slot,'竹篮里收到一颗荔枝',sent
        FROM yard65_fruit WHERE crop=? AND slot=? AND picker=? AND recipient=? AND note=?\`,
        p.crop,p.slot,me,p.to,note)
    ]);`);
  }
  if (name === 'circle-route.mjs') {
    const run = 'const result = await db().prepare(query).bind(...args).run();';
    // The returned last rowset stays the one expected by the legacy handler.
    return once(source, run, `const store = db();
  if (query.startsWith('INSERT OR IGNORE INTO phone_circle_chat_v1')) {
    const [team, room, day, id, actor, name] = args;
    await store.batch([
      store.prepare(${JSON.stringify(ensureEvents)}),
      store.prepare(query).bind(...args),
      store.prepare(\`INSERT OR IGNORE INTO v61_events(id,recipient,actor,kind,item,body,created)
        SELECT c.id||':'||p.id,p.id,c.member,'room-chat',c.room||'/'||c.id,?||' 在频道发来一条消息',c.created
        FROM phone_circle_chat_v1 c JOIN camp_profiles p ON p.id<>c.member
        WHERE c.team=? AND c.room=? AND c.day=? AND c.id=? AND c.member=? AND c.recalled=0\`)
        .bind(name,team,room,day,id,actor)
    ]); return [];
  }
  if (query.startsWith('UPDATE phone_circle_chat_v1 SET recalled=1')) {
    const [team,room,day,id,member] = args;
    const result = await store.batch([store.prepare(${JSON.stringify(ensureEvents)}),
      store.prepare(query).bind(...args),
      store.prepare("DELETE FROM v61_events WHERE kind='room-chat' AND item=? AND EXISTS(SELECT 1 FROM phone_circle_chat_v1 WHERE team=? AND room=? AND day=? AND id=? AND member=? AND recalled=1)").bind(room+'/'+id,team,room,day,id,member)
    ]);return result[1].results.map(row => Array.from(row));
  }
  ${run}`);
  }
  return source;
}
