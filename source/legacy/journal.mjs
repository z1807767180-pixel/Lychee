const tables = [
  "CREATE TABLE IF NOT EXISTS journal_posts(post TEXT PRIMARY KEY,kind TEXT NOT NULL,prompt TEXT NOT NULL,options TEXT NOT NULL,album TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS journal_album ON journal_posts(album)",
  "CREATE TABLE IF NOT EXISTS journal_votes(post TEXT NOT NULL,member TEXT NOT NULL,choice INTEGER NOT NULL,PRIMARY KEY(post,member))",
  "CREATE TABLE IF NOT EXISTS journal_stickers(post TEXT NOT NULL,member TEXT NOT NULL,sticker TEXT NOT NULL,PRIMARY KEY(post,member))",
  "CREATE TABLE IF NOT EXISTS journal_photos(id TEXT PRIMARY KEY,post TEXT NOT NULL,member TEXT NOT NULL,picture TEXT NOT NULL,created INTEGER NOT NULL)",
  "CREATE INDEX IF NOT EXISTS journal_photos_post ON journal_photos(post)"
];
export const journalSchema = tables;
const uid = s => typeof s==="string" && /^[a-f0-9-]{36}$/i.test(s);
const pictureOK = s => typeof s==="string" && s.length<=384000 && s.length%4===0 && /^\/9j\/[a-zA-Z0-9+/]*={0,2}$/.test(s);
const fail = (text,code=400) => Response.json({error:text},{status:code});
const ok = data => Response.json(data,{headers:{"Cache-Control":"private, no-store"}});
export async function readJournal(db,q,me){
  const stmt=(s,...a)=>db.prepare(s).bind(...a);
  if(q.has("relayImage")){
    const row=await stmt("SELECT picture FROM journal_photos WHERE id=?",q.get("relayImage")).first();
    return row ? new Response(Buffer.from(row.picture,"base64"),{headers:{"Content-Type":"image/jpeg","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}}) : fail("照片不存在",404);
  }
  if(q.has("album")){
    const cursor=Number(q.get("before")||Number.MAX_SAFE_INTEGER);
    const r=await stmt("SELECT p.id,p.member,p.rowid AS cursor FROM phone_posts p JOIN journal_posts j ON j.post=p.id WHERE j.album=? AND j.album<>'' AND p.picture IS NOT NULL AND p.rowid<? ORDER BY p.rowid DESC LIMIT 30",q.get("album"),cursor).run();
    return ok({photos:r.results});
  }
  if(q.has("relay")){
    const before=Number(q.get("before")||Number.MAX_SAFE_INTEGER);
    const r=await stmt("SELECT id,member,rowid AS cursor FROM journal_photos WHERE post=? AND rowid<? ORDER BY rowid DESC LIMIT 30",q.get("relay"),before).run();
    return ok({photos:r.results});
  }
  const before=Number(q.get("before")||Number.MAX_SAFE_INTEGER);
  const ids="SELECT id FROM phone_posts WHERE rowid<? ORDER BY rowid DESC LIMIT 20";
  const [posts,comments,stats,votes,stickers,albumPics,reactions,meta,favorites]=await db.batch([
    stmt("SELECT p.rowid AS cursor,p.id,p.member,p.body,p.picture IS NOT NULL AS photo,p.created,j.kind,j.prompt,j.options,j.album FROM phone_posts p LEFT JOIN journal_posts j ON j.post=p.id WHERE p.rowid<? ORDER BY p.rowid DESC LIMIT 20",before),
    stmt("SELECT post,id,member,body FROM phone_comments WHERE post IN ("+ids+") ORDER BY rowid",before),
    stmt("SELECT post,COUNT(*) AS n FROM journal_photos WHERE post IN ("+ids+") GROUP BY post",before),
    stmt("SELECT post,choice,COUNT(*) AS n,MAX(member=?) AS mine FROM journal_votes WHERE post IN ("+ids+") GROUP BY post,choice",me,before),
    stmt("SELECT post,sticker,COUNT(*) AS n,MAX(member=?) AS mine FROM journal_stickers WHERE post IN ("+ids+") GROUP BY post,sticker",me,before),
    stmt("SELECT id,album FROM (SELECT j.post AS id,j.album,ROW_NUMBER() OVER(PARTITION BY j.album ORDER BY p.rowid DESC) AS n FROM journal_posts j JOIN phone_posts p ON p.id=j.post WHERE j.album<>'' AND j.album IN (SELECT album FROM journal_posts WHERE post IN ("+ids+"))) WHERE n<=3 ORDER BY album,n",before),
    stmt("SELECT item,member,emoji FROM v61_reactions WHERE kind='post' AND item IN ("+ids+")",before),
    stmt("SELECT post,pinned,source FROM v61_post_meta WHERE post IN ("+ids+")",before),
    stmt("SELECT item FROM v61_favorites WHERE kind='post' AND member=?",me)
  ]);
  return ok({posts:posts.results.map(p=>({...p,reactions:reactions.results.filter(r=>r.item===p.id),pinned:!!meta.results.find(r=>r.post===p.id)?.pinned,source:meta.results.find(r=>r.post===p.id)?.source||"",favorite:favorites.results.some(r=>r.item===p.id),options:JSON.parse(p.options||"[]"),albumPics:albumPics.results.filter(r=>r.album===p.album).map(r=>r.id),replies:stats.results.find(r=>r.post===p.id)?.n||0,votes:votes.results.filter(v=>v.post===p.id),stickers:stickers.results.filter(v=>v.post===p.id)})),comments:comments.results});
}
export async function writeJournal(db,p,me){
  const stmt=(s,...a)=>db.prepare(s).bind(...a);
  if(p.type==="journal-post"){
    const {id,body,picture,kind,prompt,options,album}=p;
    if(!uid(id)||typeof body!=="string"||body.length>1000||typeof picture!=="string"||picture&&!pictureOK(picture)||!["plain","relay","poll"].includes(kind)||typeof prompt!=="string"||prompt.length>80||!Array.isArray(options)||typeof album!=="string"||album.length>100)return fail("请检查文字和图片");
    if(kind==="plain"&&!body.trim()&&!picture||kind!=="plain"&&!prompt.trim()||kind==="relay"&&!picture||kind==="poll"&&(options.length<2||options.length>4||options.some(x=>typeof x!=="string"||!x.trim()||x.length>30)||new Set(options.map(x=>x.trim())).size!==options.length)||kind!=="poll"&&options.length)return fail("请补全照片、题目或不同的选项");
    const existing=await stmt("SELECT member FROM phone_posts WHERE id=?",id).first();
    if(existing)return existing.member===me?ok({ok:true}):fail("编号已使用",409);
    if(album){
      const goal=await stmt("SELECT COALESCE(g.title,'出发倒计时') AS title,t.target FROM goal t LEFT JOIN phone_garden g ON g.id=t.id WHERE t.id=1").first();
      if(!picture||!goal||JSON.stringify([goal.title,goal.target])!==album)return fail("约定已更改，请重新选择",409);
    }
    await db.batch([stmt("INSERT OR IGNORE INTO phone_posts VALUES(?,?,?,?,?)",id,me,body.trim(),picture||null,Date.now()),
      stmt("INSERT OR IGNORE INTO journal_posts SELECT id,?,?,?,? FROM phone_posts WHERE id=? AND member=?",kind,prompt.trim(),JSON.stringify(options.map(s=>s.trim())),album,id,me)]);
    if(uid(p.source)&&(await stmt("SELECT id FROM phone_posts WHERE id=?",p.source).first()))await stmt("INSERT OR IGNORE INTO v61_post_meta(post,source) VALUES(?,?)",id,p.source).run();
  }else{
    if(!uid(p.post))return fail("无效动态");
    const post=await stmt("SELECT p.id,j.kind,j.options FROM phone_posts p LEFT JOIN journal_posts j ON j.post=p.id WHERE p.id=?",p.post).first();
    if(!post)return fail("动态不存在",404);
    if(p.type==="journal-vote"){
      if(post.kind!=="poll"||!Number.isInteger(p.choice)||p.choice<0||p.choice>=JSON.parse(post.options).length)return fail("无效选项");
      await stmt("INSERT OR IGNORE INTO journal_votes VALUES(?,?,?)",p.post,me,p.choice).run();
    }else if(p.type==="journal-sticker"){
      if(!["love","clap","hug",""].includes(p.sticker))return fail("无效贴纸");
      if(p.sticker)await stmt("INSERT INTO journal_stickers VALUES(?,?,?) ON CONFLICT(post,member) DO UPDATE SET sticker=excluded.sticker",p.post,me,p.sticker).run();
      else await stmt("DELETE FROM journal_stickers WHERE post=? AND member=?",p.post,me).run();
    }else if(p.type==="journal-photo"){
      if(post.kind!=="relay"||!uid(p.id)||!pictureOK(p.picture))return fail("请为接龙选择一张照片");
      await stmt("INSERT OR IGNORE INTO journal_photos VALUES(?,?,?,?,?)",p.id,p.post,me,p.picture,Date.now()).run();
    }else return fail("未知操作");
  }
  return ok({ok:true});
}
