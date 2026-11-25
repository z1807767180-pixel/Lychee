import {createHash} from 'node:crypto';

export const imageSettlementMs=180000;
const receipts='mc_ai_image_receipts_v646', requests='mc_ai_quota_requests';
const noImage='未能保存可取回的图片，本次生图次数已退回。';
const pending=()=>({state:'pending',retryAfterMs:4000});
const refunded=()=>({state:'refunded',error:noImage});
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
// The old image handler emitted these exact HTTP 502 bodies before issuing
// any image-part or manifest write. Timeout, generic storage and transport
// errors do not establish absence for old randomly allocated image IDs.
const oldBodies=[
  JSON.stringify({error:'没有收到可保存的图片'}),
  JSON.stringify({error:'图片格式或大小不支持'}),
];
const upstreamPrefix='{"error":"AI 服务暂不可用（';
const upstreamSuffix='）"}';
const oldEvidence="kind='image' AND response_status=502 AND (response_body IN (?,?) OR response_body GLOB ?)";
const oldArgs=[...oldBodies,upstreamPrefix+'5[0-9][0-9]'+upstreamSuffix];
export const legacyImageEvidence={sql:oldEvidence,args:oldArgs};
export function isProvenLegacyImageFailure(row){
  return Number(row.response_status)===502 && (oldBodies.includes(row.response_body) ||
    (typeof row.response_body==='string' && row.response_body.startsWith(upstreamPrefix) &&
      row.response_body.endsWith(upstreamSuffix) &&
      /^5\d\d$/.test(row.response_body.slice(upstreamPrefix.length,-upstreamSuffix.length))));
}

// UUIDv5 in a private namespace. Business IDs are stable across restarts but
// are different for two users, two gardens, or two logical requests.
export function quotaImageId(account,op){
  const bytes=createHash('sha1').update(Buffer.from('5e0c2cabf67d49479f534422eb6e5bb1','hex'))
    .update(JSON.stringify([account,op.gardenId,op.key])).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;
  const s=bytes.toString('hex');
  return [s.slice(0,8),s.slice(8,12),s.slice(12,16),s.slice(16,20),s.slice(20)].join('-');
}

export const imageSchema=[
  `CREATE TABLE IF NOT EXISTS ${receipts}(account TEXT NOT NULL,request_key TEXT NOT NULL,signature TEXT NOT NULL,
    garden TEXT NOT NULL,image_id TEXT NOT NULL,day TEXT NOT NULL,recheck_at INTEGER NOT NULL,state TEXT NOT NULL
    CHECK(state IN ('pending','ready','refunded')),response_body TEXT,PRIMARY KEY(account,request_key))`,
  `CREATE INDEX IF NOT EXISTS mc_ai_image_pending_v646 ON ${receipts}(account,garden,state,recheck_at)`,
  // The receipt and the existing account-wide counter must be reserved in one
  // SQLite statement, including when old and new service instances overlap.
  `CREATE TRIGGER IF NOT EXISTS mc_ai_image_reserve_v646 AFTER INSERT ON ${receipts} BEGIN
    INSERT INTO ${requests}(account,request_key,signature,day,kind) VALUES(NEW.account,NEW.request_key,NEW.signature,NEW.day,'image'); END`,
  `CREATE TRIGGER IF NOT EXISTS mc_ai_image_finish_v646 AFTER UPDATE OF state ON ${receipts} WHEN OLD.state='pending' AND NEW.state<>'pending' BEGIN
    UPDATE ${requests} SET consumed=CASE WHEN NEW.state='ready' THEN 1 ELSE 0 END,
      response_status=CASE WHEN NEW.state='ready' THEN 200 ELSE 409 END,response_body=NEW.response_body
      WHERE account=NEW.account AND request_key=NEW.request_key; END`,
];

export function imageReply(result){
  if(result.state==='missing')result=pending();
  return Response.json(result,{status:result.state==='ready'?200:result.state==='refunded'?409:202,
    headers:{'cache-control':'private, no-store',...(result.state==='refunded'?{'x-lychee-ai-retry':'new'}:{})}});
}

export function imageReceipts(exec,clock){
  const lookup=async (account,garden,key)=>(await exec(`SELECT * FROM ${receipts}
    WHERE account=? AND garden=? AND request_key=?`,account,garden,key)).rows[0];
  async function reserve(account,op,day,limit){
    const result=await exec(`INSERT INTO ${receipts}(account,request_key,signature,garden,image_id,day,recheck_at,state)
      SELECT ?,?,?,?,?,?,?,'pending' WHERE NOT EXISTS(SELECT 1 FROM ${requests} WHERE account=? AND request_key=?)
        AND (SELECT count(*) FROM ${requests} WHERE account=? AND day=? AND kind='image' AND consumed=1)<?
      ON CONFLICT(account,request_key) DO NOTHING`,
      account,op.key,op.signature,op.gardenId,quotaImageId(account,op),day,clock()+imageSettlementMs,
      account,op.key,account,day,limit);
    return Number(result.rowsAffected)===1;
  }
  async function inspect(account,garden,key,getImageInGarden,finished=false){
    let row;
    try{row=await lookup(account,garden,key);}catch{return pending();}
    if(!row)return {state:'missing'};
    if(row.state!=='pending')return JSON.parse(row.response_body);
    if(typeof getImageInGarden!=='function')return pending();
    const sealIfMissing=finished||clock()>=Number(row.recheck_at);
    // The album owns the outcome. sealIfMissing requests an atomic no-image
    // fence in the same store as final image publication. A read error (or an
    // unexpected reply) is never treated as proof that no picture exists.
    let image;
    try{image=await getImageInGarden(row.image_id,{sealIfMissing});}catch{return pending();}
    let result;
    if(image?.id===row.image_id){
      result={state:'ready',id:row.image_id,...(typeof image.prompt==='string'?{prompt:image.prompt.slice(0,500)}:{})};
    }else if(sealIfMissing&&image===null)result=refunded();
    else return pending();
    try{
      const updated=await exec(`UPDATE ${receipts} SET state=?,response_body=?
        WHERE account=? AND garden=? AND request_key=? AND state='pending'`,
        result.state,JSON.stringify(result),account,garden,key);
      if(Number(updated.rowsAffected)===1)return result;
      const final=await lookup(account,garden,key);
      return final?.response_body?JSON.parse(final.response_body):pending();
    }catch{
      // A commit acknowledgement can be lost after the album was sealed or
      // published. A later read can repeat settlement without generating.
      return pending();
    }
  }
  async function status(account,garden,requestId,getImageInGarden){
    if(typeof requestId!=='string'||!uuid.test(requestId))return {state:'missing'};
    return inspect(account,garden,'request:'+requestId.toLowerCase(),getImageInGarden);
  }
  async function reconcile(account,garden,getImageInGarden,day){
    if(!garden||typeof getImageInGarden!=='function')return;
    const rows=await exec(`SELECT request_key FROM ${receipts} WHERE account=? AND garden=? AND day=?
      AND state='pending' AND recheck_at<=?`,account,garden,day,clock());
    for(const row of rows.rows)await inspect(account,garden,row.request_key,getImageInGarden);
  }
  async function refundLegacy(account,day){
    await exec(`UPDATE ${requests} SET consumed=0 WHERE account=? AND day=? AND consumed=1 AND ${oldEvidence}
      AND NOT EXISTS(SELECT 1 FROM ${receipts} r WHERE r.account=${requests}.account AND r.request_key=${requests}.request_key)`,
      account,day,...oldArgs);
  }
  return {reserve,inspect,status,reconcile,refundLegacy};
}
