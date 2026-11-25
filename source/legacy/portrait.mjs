import {createHash} from 'node:crypto';

export const portraitSchema = 'CREATE TABLE IF NOT EXISTS phone_portraits(member TEXT PRIMARY KEY, revision TEXT NOT NULL, picture TEXT NOT NULL)';

// Accept the format produced by the mobile canvas, including progressive JPEG.
function isSquarePortrait(data){
  if(data.length<12||data.readUInt16BE(0)!==0xffd8||data.readUInt16BE(data.length-2)!==0xffd9)return false;
  let off=2;
  while(off+4<data.length&&data[off]===255){
    const marker=data[off+1],size=data.readUInt16BE(off+2);
    if(size<2||off+2+size>data.length)return false;
    if(marker===0xc0||marker===0xc2)return size>=11&&data.readUInt16BE(off+5)===320&&data.readUInt16BE(off+7)===320;
    if(marker===0xda)return false;
    off+=size+2;
  }
  return false;
}
export async function savePortrait(db, member, picture) {
  if (typeof picture !== 'string' || picture.length < 16 || picture.length > 160000 ||
      !/^\/9j\/[A-Za-z0-9+/]*={0,2}$/.test(picture)) {
    return Response.json({error:'请选择有效的头像图片'}, {status:400});
  }
  const data=Buffer.from(picture,'base64');
  if(!isSquarePortrait(data)) {
    return Response.json({error:'头像文件不完整，请重新选择'}, {status:400});
  }
  const revision=createHash('sha256').update(data).digest('hex');
  await db.prepare('INSERT INTO phone_portraits(member,revision,picture) VALUES(?,?,?) ON CONFLICT(member) DO UPDATE SET revision=excluded.revision,picture=excluded.picture').bind(member,revision,picture).run();
  return Response.json({revision},{headers:{'Cache-Control':'private, no-store'}});
}
export async function readPortrait(db, member, revision) {
  const row=await db.prepare('SELECT picture FROM phone_portraits WHERE member=? AND revision=?').bind(member,revision).first();
  if(!row)return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  return new Response(Buffer.from(row.picture,'base64'),{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-cache','X-Content-Type-Options':'nosniff'}});
}
