const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function fail(status, message) { throw Object.assign(new Error(message), {status}); }
function bounded(value, max, required=false) {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) fail(400,"请检查填写的文字");
  return value.trim();
}

// sql returns plain rows in column order, scoped by the authenticated team's ID.
export function circleStore(sql) {
  let ready;
  const cleanedDay = new Map();
  async function initialize() {
    await sql(`CREATE TABLE IF NOT EXISTS phone_circles_v1 (
      team TEXT NOT NULL,id TEXT NOT NULL,name TEXT NOT NULL,subtitle TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 1,deleted INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL,PRIMARY KEY(team,id))`);
    await sql(`CREATE TABLE IF NOT EXISTS phone_circle_chat_v1 (
      team TEXT NOT NULL,room TEXT NOT NULL,day TEXT NOT NULL,id TEXT NOT NULL,
      member TEXT NOT NULL,name TEXT NOT NULL,body TEXT NOT NULL,photo TEXT NOT NULL,
      reply TEXT NOT NULL,created INTEGER NOT NULL,recalled INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(team,room,id))`);
    await sql("CREATE INDEX IF NOT EXISTS phone_circle_chat_day_v1 ON phone_circle_chat_v1(team,room,day,created DESC)");
  }
  return async function handle({team,member,name,day,method,query,body={}}) {
    if(!team || !member || !day) fail(401,"请登录便签");
    ready ||= initialize().catch(error=>{ready=null;throw error;});
    await ready;
    if(cleanedDay.get(team)!==day){
      await sql("DELETE FROM phone_circle_chat_v1 WHERE team=? AND day<?",[team, day]);
      cleanedDay.set(team,day);
    }
    const room=query.get("room"), image=query.get("image");
    if(!room) {
      // INSERT OR IGNORE also preserves an intentionally removed original circle.
      await sql("INSERT OR IGNORE INTO phone_circles_v1(team,id,name,subtitle,created) VALUES(?,?,?,?,?)",
        [team,"main","摸鱼圈","工作间隙，一起聊两句",0]);
      if(method==="GET") {
        const rows=await sql("SELECT id,name,subtitle,revision FROM phone_circles_v1 WHERE team=? AND deleted=0 ORDER BY created,id",[team]);
        return {circles:rows.map(([id,name,subtitle,revision])=>({id,name,subtitle,revision}))};
      }
      if(method!=="POST") fail(405,"不支持此操作");
      const id=body.id;
      if(id!=="main"&&!uuid.test(id||"")) fail(400,"无效圈子");
      if(body.action==="create") {
        if(id==="main") fail(400,"无效圈子");
        const title=bounded(body.name,30,true),subtitle=bounded(body.subtitle,60);
        await sql("INSERT OR IGNORE INTO phone_circles_v1(team,id,name,subtitle,created) VALUES(?,?,?,?,?)",
          [team,id,title,subtitle,Date.now()]);
        const existing=await sql("SELECT name,subtitle,deleted FROM phone_circles_v1 WHERE team=? AND id=?",[team,id]);
        if (!existing.length||existing[0][0]!==title||existing[0][1]!==subtitle||existing[0][2]) fail(409,"圈子已变化，请刷新");
      } else if(body.action==="update" || body.action==="delete") {
        const rev=Number(body.revision);
        const rows=body.action==="delete"?
          await sql("UPDATE phone_circles_v1 SET deleted=1,revision=revision+1 WHERE team=? AND id=? AND revision=? AND deleted=0 RETURNING id",[team,id,rev]):
          await sql("UPDATE phone_circles_v1 SET name=?,subtitle=?,revision=revision+1 WHERE team=? AND id=? AND revision=? AND deleted=0 RETURNING id",
            [bounded(body.name,30,true),bounded(body.subtitle,60),team,id,rev]);
        if(!rows.length) fail(409,"圈子已被修改，请刷新后再试");
      } else fail(400,"未知操作");
      return {ok:true};
    }
    if(!uuid.test(room)) fail(404,"圈子不存在");
    const live=await sql("SELECT 1 FROM phone_circles_v1 WHERE team=? AND id=? AND deleted=0",[team,room]);
    if(!live.length) fail(404,"圈子已删除");
    if(method==="GET" && image) {
      const rows=await sql("SELECT photo FROM phone_circle_chat_v1 WHERE team=? AND room=? AND day=? AND id=? AND recalled=0",[team,room,day,image]);
      if(!rows[0]?.[0]) fail(404,"未找到图片");
      return {jpeg:Buffer.from(rows[0][0],"base64")};
    }
    if(method==="GET") {
      const rows=await sql("SELECT id,name,body,(photo<>''),reply,recalled,member FROM phone_circle_chat_v1 WHERE team=? AND room=? AND day=? ORDER BY created DESC,rowid DESC LIMIT 100",[team,room,day]);
      return {notes:rows.map(([id,author,text,hasImage,replyTo,recalled,sender])=>({
        id,name:author,body:recalled?"":text,hasImage:!recalled&&!!hasImage,replyTo:recalled?"":replyTo,recalled:!!recalled,
        editBody:recalled&&sender===member?text:"",mentionedMe:!recalled&&sender!==member&&text.includes("@"+name)
      }))};
    }
    if(method!=="POST") fail(405,"不支持此操作");
    if(body.action==="recall") {
      const rows=await sql("UPDATE phone_circle_chat_v1 SET recalled=1,photo='' WHERE team=? AND room=? AND day=? AND id=? AND member=? RETURNING id",
        [team,room,day,body.id,member]);
      if(!rows.length) fail(404,"找不到这条自己的消息");
    } else if(body.action==="send") {
      if(!uuid.test(body.clientId||"")) fail(400,"消息编号无效");
      const text=bounded(body.body,200),photo=bounded(body.picture,384000),reply=bounded(body.replyTo,180);
      if(!text&&!photo) fail(400,"请先写消息");
      if(photo&&(!photo.startsWith("/9j/")||!/^[A-Za-z0-9+/]+={0,2}$/.test(photo))) fail(400,"请选择 JPEG 图片");
      if(reply) {
        const match=await sql("SELECT 1 FROM phone_circle_chat_v1 WHERE team=? AND room=? AND day=? AND id=?",[team,room,day,reply]);
        if(!match.length) fail(400,"引用的消息已失效");
      }
      await sql(`INSERT OR IGNORE INTO phone_circle_chat_v1(team,room,day,id,member,name,body,photo,reply,created)
        SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM phone_circles_v1 WHERE team=? AND id=? AND deleted=0)`,
        [team,room,day,"room."+member+"."+body.clientId,member,name,text,photo,reply,Date.now(),team,room]);
    } else fail(400,"未知操作");
    return {ok:true};
  };
}
