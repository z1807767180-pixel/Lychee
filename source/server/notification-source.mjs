// Keep the original release inputs reproducible. These inserts run in the
// same garden-scoped database batch as the message that causes the alert.
const ensureEvents = 'CREATE TABLE IF NOT EXISTS v61_events(id TEXT PRIMARY KEY,recipient TEXT NOT NULL,actor TEXT NOT NULL,kind TEXT NOT NULL,item TEXT NOT NULL,body TEXT NOT NULL,created INTEGER NOT NULL)';

// Uploaded JPEGs may carry a JFXX JPEG thumbnail following the JFIF header.
// Older senders store only their original image. Both use the same authorization and expiry checks.
function chatJpeg(bytes,preview){
  let image=bytes;
  if(preview && bytes.length>=18 && bytes.readUInt32BE(0)===0xffd8ffe0 && bytes.toString('ascii',6,11)==='JFIF\0'){
    const at=4+bytes.readUInt16BE(4);
    if(at+12<bytes.length && bytes.readUInt16BE(at)===0xffe0 && bytes.toString('ascii',at+4,at+9)==='JFXX\0' && bytes[at+9]===16){
      const end=at+2+bytes.readUInt16BE(at+2);
      if(end>=at+14 && end<=bytes.length && bytes.readUInt16BE(at+10)===0xffd8 && bytes.readUInt16BE(end-2)===0xffd9){
        image=bytes.subarray(at+10,end);
      }
    }
  }
  return new Response(image,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store',
    'X-Content-Type-Options':'nosniff','X-Lychee-Preview':image===bytes?'original':'small'}});
}

export function notificationSource(name, source, once) {
  if (name === 'camp.mjs') {
    const response='return new Response(Uint8Array.from(atob(image.jpeg), (c) => c.charCodeAt(0)), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });';
    source=once(source,response,"return chatJpeg(Buffer.from(image.jpeg,'base64'),params.get('preview')==='1');")+'\n'+chatJpeg.toString();
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
    // Chat is day-scoped in both rooms. Retired messages cannot remain in the badge after midnight.
    const cutoff="(CAST((?+28800000)/86400000 AS INTEGER)*86400000-28800000)";
    const room="(CASE WHEN e.kind='chat' THEN 'main' ELSE substr(e.item,1,instr(e.item,'/')-1) END)";
    source=once(source,"if(mode==='notifications'){",`if(mode==='chat-inbox'){
      const rows=await s("SELECT "+${JSON.stringify(room)}+" AS room,COUNT(*) AS unread,MAX(created) AS latest FROM v61_events e WHERE recipient=? AND kind IN ('chat','room-chat') AND created>="+${JSON.stringify(cutoff)}+" AND NOT EXISTS(SELECT 1 FROM v61_notices_read r WHERE r.member=e.recipient AND r.id=e.id) GROUP BY room ORDER BY latest DESC,room",me,Date.now()).run();
      return ok({rooms:rows.results});
    }
    if(mode==='notification'){
      const id=q.get('id');if(!id||id.length>220)return bad('无效通知');
      const event=await s('SELECT * FROM v61_events WHERE recipient=? AND id=?',me,id).first();
      return ok({notification:event||null});
    }
    if(mode==='notifications'){`);
    source=once(source,"else if(type==='v61-read'){",`else if(type==='v61-chat-read'){
      if(typeof p.room!=='string'||p.room.length>100||!Number.isSafeInteger(p.through)||p.through<=0)return bad('无效聊天');
      await s("INSERT OR IGNORE INTO v61_notices_read(member,id) SELECT recipient,id FROM v61_events e WHERE recipient=? AND kind IN ('chat','room-chat') AND "+${JSON.stringify(room)}+"=? AND created BETWEEN "+${JSON.stringify(cutoff)}+" AND ?",me,p.room,now,Math.min(now,p.through)).run();
    }
    else if(type==='v61-read'){`);
    return once(source, "me,'reaction',id,'回应了 '", "me,p.kind==='question'?'question-reaction':'reaction',id,'回应了 '");
  }
  if (name === 'circles.mjs') {
    source=once(source,'reply,recalled,member FROM phone_circle_chat_v1','reply,recalled,member,created FROM phone_circle_chat_v1');
    return once(source,'replyTo,recalled,sender])=>({','replyTo,recalled,sender,created])=>({created,');
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
    const imageResponse='if(result.jpeg) return new Response(result.jpeg,{headers:{\n      "Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"\n    }});';
    source=once(source,imageResponse,"if(result.jpeg)return chatJpeg(result.jpeg,new URL(request.url).searchParams.get('preview')==='1');")+'\n'+chatJpeg.toString();
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
