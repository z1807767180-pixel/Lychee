import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {createTursoClient} from './turso-client.mjs';

const headers = {'cache-control': 'private, no-store'};
const response = (body, status = 200) => Response.json(body, {status, headers});
const nutrientKeys = ['kcal', 'protein', 'carbs', 'fat'];
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const schema = 'CREATE TABLE IF NOT EXISTS mc_diet_v7 (account TEXT NOT NULL, id TEXT NOT NULL, day TEXT NOT NULL, revision INTEGER NOT NULL, digest TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(account,id))';
const index = 'CREATE INDEX IF NOT EXISTS mc_diet_v7_day ON mc_diet_v7(account,day)';

function validDay(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const time = Date.parse(s + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0,10) === s;
}
function short(value, max) {
  return typeof value === 'string' && value.length <= max && value.trim().length > 0;
}
function number(value, max) { return Number.isFinite(value) && value >= 0 && value <= max; }
function shape(e, day) {
  if (!e || !uuid.test(e.id) || e.day !== day || !Number.isSafeInteger(e.revision) || e.revision < 0 ||
      !short(e.title, 120) || !Array.isArray(e.items) || !e.items.length || e.items.length > 24) return null;
  if (typeof e.photo !== 'string' || e.photo.length > 320000 ||
      (e.photo && !/^data:image\/(?:jpeg|webp|png);base64,[a-z0-9+/]+=*$/i.test(e.photo))) return null;
  const items = [];
  for (const row of e.items) {
    if (!row || !short(row.name, 100) || !short(row.foodId, 120) || !short(row.source, 512) ||
        (row.unit!=null && !['g','ml'].includes(row.unit)) ||
        !number(row.grams, 10000) || row.grams === 0 || !row.per100 ||
        !nutrientKeys.every(k => number(row.per100[k], k === 'kcal' ? 1000 :
          // The TFDA laboratory result for blended vegetable oil is 100.3 g/100 g.
          (k==='fat'&&row.foodId==='tfda-M9900201'?100.3:100)))) return null;
    const recipe={};
    if(row.recipeId) {
      if(!short(row.recipeId,100)||!short(row.recipeSource,1024)||typeof row.quantityNote!=='string'||row.quantityNote.length>120)return null;
      Object.assign(recipe,{recipeId:row.recipeId,recipeSource:row.recipeSource,quantityNote:row.quantityNote});
    }
    if(row.portionGroup!=null){
      if(!short(row.portionGroup,100)||!number(row.cookedFactor,100))return null;
      Object.assign(recipe,{portionGroup:row.portionGroup,cookedFactor:row.cookedFactor});
      if(row.portionName!=null){
        if(!short(row.portionName,100))return null;
        recipe.portionName=row.portionName;
      }
    }
    if(row.servedAsWeighed===true)recipe.servedAsWeighed=true;
    if(row.portionFixed===true)recipe.portionFixed=true;
    items.push({name:row.name.trim(),foodId:row.foodId,source:row.source,grams:row.grams,unit:row.unit||'g',...recipe,
      per100:Object.fromEntries(nutrientKeys.map(k=>[k,row.per100[k]]))});
  }
  if(e.weighedGrams!=null&&(!number(e.weighedGrams,10000)||e.weighedGrams===0))return null;
  return {id:e.id,day,title:e.title.trim(),photo:e.photo,items,...(e.weighedGrams?{weighedGrams:e.weighedGrams}:{})};
}

async function open(config) {
  if (config.turso) return createTursoClient({...config.turso,legacyDir:config.legacyDir});
  const db = new DatabaseSync(config.quotaFile);
  db.exec('PRAGMA busy_timeout=10000');
  return {execute({sql,args}) {
    const stmt=db.prepare(sql);
    return stmt.columns().length ? {rows:stmt.all(...args)} : {rows:[],rowsAffected:stmt.run(...args).changes};
  }, close:()=>db.close()};
}

export async function handleDietEntries(request, {accountId,storageConfig}) {
  const day=new URL(request.url).searchParams.get('day');
  if (!accountId) return response({error:'请先登录'},401);
  if (!validDay(day)) return response({error:'日期无效'},400);
  if (!['GET','POST'].includes(request.method)) return response({error:'不支持此操作'},405);
  let submitted, value;
  if (request.method === 'POST') {
    let body;
    try { body=await request.json(); } catch { return response({error:'记录格式有误'},400); }
    submitted=body?.entry;
    value=shape(submitted,day);
    if (!value) return response({error:'请检查食物名称、份量或照片后再保存'},400);
  }
  const db=await open(storageConfig);
  const exec=(sql,...args)=>db.execute({sql,args});
  try {
    await exec(schema);
    await exec(index);
    if (!submitted) {
      // Fetch in batches: one day with many photos can exceed a remote driver's response size.
      const entries=[];
      let cursor='';
      while (true) {
        const {rows}=await exec('SELECT id,data,revision FROM mc_diet_v7 WHERE account=? AND day=? AND id>? ORDER BY id LIMIT 4',accountId,day,cursor);
        for (const row of rows) entries.push({...JSON.parse(row.data),revision:Number(row.revision)});
        if (rows.length < 4) break;
        cursor=rows.at(-1).id;
      }
      return response({entries});
    }
    const data=JSON.stringify(value);
    const digest=createHash('sha256').update(data).digest('hex');
    if (submitted.revision === 0) {
      await exec('INSERT INTO mc_diet_v7(account,id,day,revision,digest,data) VALUES(?,?,?,1,?,?) ON CONFLICT(account,id) DO NOTHING', accountId,value.id,day,digest,data);
    } else {
      await exec('UPDATE mc_diet_v7 SET revision=revision+1,digest=?,data=? WHERE account=? AND id=? AND day=? AND revision=?',digest,data,accountId,value.id,day,submitted.revision);
    }
    const current=(await exec('SELECT revision,digest FROM mc_diet_v7 WHERE account=? AND id=?',accountId,value.id)).rows[0];
    if (!current || current.digest !== digest) return response({error:'其他设备已更新这条记录，请重新打开再修改'},409);
    return response({entry:{...value,revision:Number(current.revision)}});
  } finally { db.close(); }
}
