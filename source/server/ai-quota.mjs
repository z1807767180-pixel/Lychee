import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {createTursoClient} from './turso-client.mjs';
import {imageSchema,imageReceipts,imageReply,legacyImageEvidence,isProvenLegacyImageFailure} from './image-receipts.mjs';
export {quotaImageId} from './image-receipts.mjs';

const limits=Object.freeze({chat:20,image:10});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const table='mc_ai_quota_requests';
const schema=[
  `CREATE TABLE IF NOT EXISTS ${table}(account TEXT NOT NULL,request_key TEXT NOT NULL,signature TEXT NOT NULL,
   day TEXT NOT NULL,kind TEXT NOT NULL,consumed INTEGER NOT NULL DEFAULT 1,
   response_status INTEGER,response_body TEXT,PRIMARY KEY(account,request_key))`,
  `CREATE INDEX IF NOT EXISTS mc_ai_quota_day ON ${table}(account,day,kind,consumed)`,
];
const hash=s=>createHash('sha256').update(s).digest('hex');
const problem=(status,error)=>Response.json({error},{status,headers:{'cache-control':'private, no-store'}});
export const providerEndpoints=new Map([
  ['https://api.deepseek.com/chat/completions','chat'],
  ['https://ark.cn-beijing.volces.com/api/v3/chat/completions','chat'],
  ['https://ark.cn-beijing.volces.com/api/v3/images/generations','image'],
]);

function beijingDay(time){return new Date(time+8*3600000).toISOString().slice(0,10);}
function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  return value;
}
export function operationFor(path,body,gardenId,now=Date.now()){
  const soup=path==='/api/camp'&&body?.type==='soup'&&body.act==='send'&&['ask','solve'].includes(body.mode);
  const kind=soup?'chat':path==='/api/phone'?({'v62-chat':'chat','v62-assist':'chat','v62-image':'image'}[body?.type]):null;
  if(kind!=='chat'&&kind!=='image')return null;
  const {requestId,...parameters}=body;
  if(requestId!==undefined&&!(typeof requestId==='string'&&uuid.test(requestId)))return {invalid:true};
  const signature=hash(JSON.stringify([gardenId,path,stable(parameters)]));
  const key=requestId?'request:'+requestId.toLowerCase():soup&&uuid.test(body.token)?
    'soup:'+gardenId+':'+body.token:'legacy:'+beijingDay(now)+':'+signature;
  return {kind,key,signature,gardenId};
}
function sqliteConnection(file){
  const db=new DatabaseSync(file);
  db.exec('PRAGMA busy_timeout=10000');
  return {execute({sql,args}){
    const s=db.prepare(sql);
    if(s.columns().length)return {rows:s.all(...args),rowsAffected:0};
    return {rows:[],rowsAffected:s.run(...args).changes};
  },close(){db.close();}};
}
function existingReply(row,op){
  if(row.signature!==op.signature)return problem(409,'此请求编号已用于另一项操作，请重新提交。');
  if(row.response_status&&row.response_body!==null)return new Response(row.response_body,{
    status:Number(row.response_status),headers:{'content-type':'application/json; charset=utf-8','cache-control':'private, no-store',
      ...(Number(row.consumed)===0?{'x-lychee-ai-retry':'new'}:{})}});
  return problem(409,'这次操作已提交，暂时无法确认结果，请查看历史记录。');
}
function exhausted(kind){return problem(429,kind==='chat'?'今日问答 20 次已用完，北京时间零点恢复。':'今日生图 10 次已用完，北京时间零点恢复。');}

export async function openAiQuota({quotaFile,turso,legacyDir,clock=Date.now}){
  const db=turso?await createTursoClient({...turso,legacyDir}):sqliteConnection(quotaFile);
  const exec=(sql,...args)=>db.execute({sql,args});
  try{for(const sql of [...schema,...imageSchema])await exec(sql);}catch(error){db.close();throw error;}
  const images=imageReceipts(exec,clock);
  async function status(account,{gardenId,getImageInGarden}={}){
    const day=beijingDay(clock());
    await images.reconcile(account,gardenId,getImageInGarden,day);
    let result=await exec(`SELECT kind,count(*) AS n,MAX(CASE WHEN ${legacyImageEvidence.sql} THEN 1 ELSE 0 END) AS has_proven_failure
      FROM ${table} WHERE account=? AND day=? AND consumed=1 GROUP BY kind`,...legacyImageEvidence.args,account,day);
    if(result.rows.some(r=>Number(r.has_proven_failure))){
      await images.refundLegacy(account,day);
      result=await exec(`SELECT kind,count(*) AS n FROM ${table} WHERE account=? AND day=? AND consumed=1 GROUP BY kind`,account,day);
    }
    const used=Object.fromEntries(result.rows.map(r=>[r.kind,Number(r.n)]));
    return {used,limits,remaining:{chat:Math.max(0,limits.chat-(used.chat||0)),image:Math.max(0,limits.image-(used.image||0))},
      resetAt:Date.parse(day+'T16:00:00Z')};
  }
  async function find(account,op){
    return (await exec(`SELECT kind,signature,day,consumed,response_status,response_body FROM ${table} WHERE account=? AND request_key=?`,account,op.key)).rows[0];
  }
  async function reserve(account,op,day){
    if(op.kind==='image')return images.reserve(account,op,day,limits.image);
    const result=await exec(`INSERT INTO ${table}(account,request_key,signature,day,kind)
      SELECT ?,?,?,?,? WHERE (SELECT count(*) FROM ${table} WHERE account=? AND day=? AND kind=? AND consumed=1)<?
      ON CONFLICT(account,request_key) DO NOTHING`,account,op.key,op.signature,day,op.kind,account,day,op.kind,limits[op.kind]);
    return Number(result.rowsAffected)===1;
  }
  async function replay(account,op,row,probe){
    if(op.kind==='image'&&row.signature===op.signature){
      const receipt=await images.inspect(account,op.gardenId,op.key,probe);
      if(receipt.state!=='missing')return imageReply(receipt);
      if(row.kind==='image' && isProvenLegacyImageFailure(row) && row.day===beijingDay(clock())){
        await images.refundLegacy(account,row.day);
        return imageReply({state:'refunded',error:'未收到可保存的图片，本次生图次数已退回。'});
      }
    }
    return existingReply(row,op);
  }
  async function run(account,op,dispatch,{getImageInGarden}={}){
    if(op.invalid)return problem(400,'AI 请求编号无效，请重新提交。');
    const existing=await find(account,op);
    if(existing)return replay(account,op,existing,getImageInGarden);
    if(op.kind==='image'&&typeof getImageInGarden!=='function')return problem(503,'图片相册尚未就绪，请稍后再试。');
    // Reject a full day before an original soup handler can create a turn.
    if(!(await status(account,{gardenId:op.gardenId,getImageInGarden})).remaining[op.kind]){
      const concurrent=await find(account,op);
      return concurrent?replay(account,op,concurrent,getImageInGarden):exhausted(op.kind);
    }
    let sent=false,refundable=false,override=null;
    async function meter(url,options,send){
      if(sent||override||providerEndpoints.get(url)!==op.kind)throw Error('Unexpected AI provider request');
      const day=beijingDay(clock());
      // One SQLite statement both checks the daily cap and reserves this request
      // across concurrent servers. Keeping the row on an ambiguous timeout is deliberate.
      const reserved=await reserve(account,op,day);
      if(!reserved){
        const duplicate=await find(account,op);
        override=duplicate?await replay(account,op,duplicate,getImageInGarden):exhausted(op.kind);
        throw Error('AI request was not reserved');
      }
      sent=true;
      const reply=await send(url,options);
      // These rejections are explicit input/auth/model/rate errors before completion.
      // A timeout, invalid successful payload, transport error or 5xx remains counted.
      refundable=[400,401,403,404,413,415,422,429].includes(reply.status);
      return reply;
    }
    let response;
    try{response=await dispatch(meter);}catch(error){
      if(!sent&&!override)throw error;
      response=problem(503,'本次 AI 请求结果尚未确认，请查看历史记录。');
    }
    if(override)return override;
    if(sent && op.kind==='image')return imageReply(await images.inspect(account,op.gardenId,op.key,getImageInGarden,true));
    if(sent){
      const text=await response.clone().text();
      await exec(`UPDATE ${table} SET consumed=?,response_status=?,response_body=? WHERE account=? AND request_key=?`,
        refundable?0:1,response.status,Buffer.byteLength(text)<=65536?text:null,account,op.key);
      if(refundable){
        const headers=new Headers(response.headers);headers.set('x-lychee-ai-retry','new');
        response=new Response(response.body,{status:response.status,headers});
      }
    }
    return response;
  }
  return {status,run,imageStatus:images.status,close:()=>db.close()};
}
