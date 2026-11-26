import {createHash,randomUUID} from 'node:crypto';
import {sendPointer,subscriptionFields,vapidConfig} from './notify-push-transport.mjs';

const day=86400000;
const keyOf=endpoint=>createHash('sha256').update(endpoint).digest('hex');
const json=(status,body)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
const deviceDDL=`CREATE TABLE IF NOT EXISTS mc_push_devices_v7(
  id TEXT PRIMARY KEY, binding TEXT UNIQUE NOT NULL, endpoint TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,
  account TEXT NOT NULL,garden TEXT NOT NULL,session_hash TEXT NOT NULL,session_kind TEXT NOT NULL,since INTEGER NOT NULL)`;
const receiptDDL=`CREATE TABLE IF NOT EXISTS mc_push_receipts_v7(
  binding TEXT NOT NULL,event TEXT NOT NULL,lease INTEGER NOT NULL,sent INTEGER NOT NULL,PRIMARY KEY(binding,event))`;

// execute returns {rows, rowsAffected} for both the existing SQLite and Turso account stores.
export function createWebPush({execute,domains,env=process.env,fetcher=fetch,clock=Date.now,auto=true}){
  let config;
  try{config=vapidConfig(env);}catch{console.error('荔枝后台推送配置无效');}
  let ready,timer,stopped=false,run=null,liveLegacy=false;
  const pending=new Set();
  if(config&&auto){timer=setInterval(()=>signal(),60000);timer.unref?.();}
  function tables(){
    if(!ready)ready=(async()=>{
      await execute(deviceDDL,[]);await execute(receiptDDL,[]);
      const available=await execute("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('camp_sessions','mc_legacy_revoked')",[]);
      liveLegacy=available.rows.length===2;
    })().catch(error=>{ready=null;throw error;});
    return ready;
  }
  async function handle(request,session,member){
    if(!session||!member||member.accountId!==session.accountId)return json(403,{error:'请先登录并加入园'});
    if(request.method!=='POST')return json(405,{error:'请使用应用内操作'});
    if(request.headers.get('origin')!==new URL(request.url).origin)return json(403,{error:'请从荔枝操作'});
    const body=await request.json().catch(()=>null);
    if(!body||!['status','subscribe','unsubscribe'].includes(body.action))return json(400,{error:'推送操作无效'});
    if(!config)return json(body.action==='subscribe'?503:200,{configured:false,enabled:false});
    await tables();
    if(body.action==='status'){
      let enabled=false;
      if(typeof body.endpoint==='string'&&body.endpoint.length<=1600){
        const found=await execute('SELECT id FROM mc_push_devices_v7 WHERE id=? AND account=? AND garden=? AND session_hash=?',
          [keyOf(body.endpoint),member.accountId,member.gardenId,session.tokenHash]);
        enabled=found.rows.length>0;
      }
      return json(200,{configured:true,publicKey:config.publicKey,enabled});
    }
    let fields;
    try{fields=subscriptionFields(body.subscription);}catch{return json(400,{error:'无效或不支持的系统推送订阅'});}
    const id=keyOf(fields.endpoint);
    if(body.action==='unsubscribe'){
      await execute('DELETE FROM mc_push_devices_v7 WHERE id=? AND account=? AND garden=? AND auth=?',
        [id,member.accountId,member.gardenId,fields.auth]);
      return json(200,{configured:true,enabled:false});
    }
    const saved=await execute(`INSERT INTO mc_push_devices_v7(id,binding,endpoint,p256dh,auth,account,garden,session_hash,session_kind,since)
      SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM mc_push_devices_v7 WHERE id=?)
        OR (SELECT COUNT(*) FROM mc_push_devices_v7 WHERE account=?)<12
      ON CONFLICT(id) DO UPDATE SET account=excluded.account,garden=excluded.garden,
        session_hash=excluded.session_hash,session_kind=excluded.session_kind,
        binding=CASE WHEN account=excluded.account AND garden=excluded.garden THEN binding ELSE excluded.binding END,
        since=CASE WHEN account=excluded.account AND garden=excluded.garden THEN since ELSE excluded.since END
      WHERE p256dh=excluded.p256dh AND auth=excluded.auth RETURNING id`,
      [id,randomUUID(),fields.endpoint,fields.p256dh,fields.auth,member.accountId,member.gardenId,session.tokenHash,session.kind??'account',clock(),id,member.accountId]);
    if(!saved.rows.length)return json(409,{error:'无法登记此设备，请关闭旧设备的推送后重试'});
    return json(200,{configured:true,enabled:true});
  }
  async function deliver(device,rows,now){
    for(const row of rows){
      if(stopped)break;
      if(row.read||!row.id||row.created<device.since||row.created<now-day)continue;
      const claim=await execute(`INSERT INTO mc_push_receipts_v7(binding,event,lease,sent) VALUES(?,?,?,0)
        ON CONFLICT(binding,event) DO UPDATE SET lease=excluded.lease
        WHERE sent=0 AND lease<=? RETURNING event`,[device.binding,row.id,now+60000,now]);
      if(!claim.rows.length)continue;
      const pointer={scope:device.account+'/'+device.garden,id:row.id};
      let status;
      try{status=await sendPointer(config,device,pointer,fetcher);}catch{break;}
      if(status===404||status===410){
        await execute('DELETE FROM mc_push_devices_v7 WHERE id=? AND binding=?',[device.id,device.binding]);break;
      }
      if(status<200||status>=300)break;
      await execute('UPDATE mc_push_receipts_v7 SET sent=? WHERE binding=? AND event=?',[now,device.binding,row.id]);
    }
  }
  async function sweep(garden){
    await tables();
    const now=clock();
    // Migrated Turso accounts can still have a valid legacy cookie without a new
    // session row. Check the same legacy login and revocation sources as authenticate().
    const liveSession=(active)=>{
      const normal=`EXISTS(SELECT 1 FROM mc_sessions s WHERE s.token_hash=d.session_hash
        AND s.account=d.account AND s.expires>?${active?' AND s.active_garden=d.garden':''})`;
      if(!liveLegacy)return normal;
      const legacy=`EXISTS(SELECT 1 FROM camp_sessions c JOIN mc_legacy_slots l ON l.slot=c.slot
        LEFT JOIN mc_sessions pref ON pref.token_hash=c.token AND pref.kind='legacy' AND pref.account=l.account
        WHERE c.token=d.session_hash AND l.account=d.account AND c.expires>?
        AND NOT EXISTS(SELECT 1 FROM mc_legacy_revoked r WHERE r.digest=c.token)
        ${active?"AND COALESCE(pref.active_garden,'legacy')=d.garden":''})`;
      return `((d.session_kind='legacy' AND ${legacy}) OR (d.session_kind<>'legacy' AND ${normal}))`;
    };
    const times=liveLegacy?[now,now]:[now];
    if(!garden){
      await execute('DELETE FROM mc_push_devices_v7 AS d WHERE NOT '+liveSession(false),times);
      await execute('DELETE FROM mc_push_receipts_v7 WHERE (sent>0 AND sent<?) OR (sent=0 AND lease<?) OR NOT EXISTS(SELECT 1 FROM mc_push_devices_v7 d WHERE d.binding=mc_push_receipts_v7.binding)',[now-day,now-day]);
    }
    const devices=await execute(`SELECT d.*,m.slot,m.role,a.username FROM mc_push_devices_v7 d
      JOIN mc_members m ON m.account=d.account AND m.garden=d.garden JOIN mc_accounts a ON a.id=d.account
      WHERE `+liveSession(true)+(garden?' AND d.garden=?':''),garden?[...times,garden]:times);
    const inboxes=new Map();
    for(const device of devices.rows){
      if(stopped)break;
      const key=device.account+'/'+device.garden;
      if(!inboxes.has(key)){
        const response=await domains.handle(new Request('https://lychee.invalid/api/phone?v61=notifications'),{
          accountId:device.account,gardenId:device.garden,slot:device.slot,role:device.role,username:device.username});
        if(!response.ok)continue;
        inboxes.set(key,(await response.json()).notifications??[]);
      }
      await deliver(device,inboxes.get(key),now);
    }
  }
  function signal(garden=''){
    if(!config||stopped)return;
    pending.add(garden);
    if(!run)run=(async()=>{
      while(pending.size&&!stopped){
        const gardens=pending.has('')?['']:[...pending];pending.clear();
        for(const id of gardens){try{await sweep(id);}catch(e){console.error('荔枝后台通知暂缓',e.name);}}
      }
    })().finally(()=>{run=null;if(pending.size&&!stopped)signal([...pending][0]);});
    return run;
  }
  async function close(){stopped=true;clearInterval(timer);if(run)await run;}
  return {handle,signal,close};
}
