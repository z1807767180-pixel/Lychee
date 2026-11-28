import {DatabaseSync} from 'node:sqlite';
import {existsSync} from 'node:fs';
import {join} from 'node:path';

const gardenId=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function socialHistory(dataDir){
  async function withTables(q,id,callback){
    if(id!=='legacy'&&!gardenId.test(id))return [];
    let db;
    try{
      if(dataDir){
        const file=join(dataDir,'gardens',id+'.sqlite');
        if(!existsSync(file))return [];
        db=new DatabaseSync(file,{readOnly:true});
      }
      const all=db?(sql,...args)=>db.prepare(sql).all(...args):q.all;
      const prefix=db||id==='legacy'?'':'g_'+id.replaceAll('-','')+'_';
      const names={goals:prefix+'v61_goals',binding:!db&&id==='legacy'?'mc_legacy_member_bindings':prefix+'garden_member_bindings',notes:prefix+'notes',details:prefix+'chat_details',pictures:prefix+'chat_pictures',shared:prefix+'goal',titles:prefix+'phone_garden',profile:prefix+'camp_profiles',style:prefix+'phone_style',portrait:prefix+'phone_portraits',...(!db&&id==='legacy'?{merged:'mc_legacy_all_profiles'}:{})};
      const tables=Object.values(names);
      const found=new Set((await all("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name IN ("+tables.map(()=>'?').join(',')+")",...tables)).map(x=>x.name));
      return await callback(all,Object.fromEntries(Object.entries(names).filter(([,name])=>found.has(name))));
    }finally{db?.close();}
  }
  // Cache only public profile metadata. Image bytes and access decisions never enter the cache.
  const cachedPeople=new Map();
  function cached(garden){
    const hit=cachedPeople.get(garden);
    if(hit&&hit.until>Date.now())return hit.rows;
    cachedPeople.delete(garden);
  }
  return {
    cached,
    invalidate(garden){cachedPeople.delete(garden);},
    async people(q,garden){
      const hit=cached(garden);if(hit)return hit;
      const rows=await withTables(q,garden,async(all,t)=>{
        if(!t.binding||!t.profile)return [];
        return all('SELECT b.account,p.name,p.mood,p.avatar,p.day,'+(t.style?'s.avatar':'NULL')+' AS selected,'+(t.portrait?'u.revision':'NULL')+' AS revision FROM '+t.binding+' b JOIN '+(t.merged||t.profile)+' p ON p.id=CAST(b.slot AS TEXT)'+(t.style?' LEFT JOIN '+t.style+' s ON s.member=p.id':'')+(t.portrait?' LEFT JOIN '+t.portrait+' u ON u.member=p.id':''));
      });
      if(cachedPeople.size>=1000)cachedPeople.delete(cachedPeople.keys().next().value);
      cachedPeople.set(garden,{rows,until:Date.now()+30000});
      return rows;
    },
    async picture(q,garden,account,revision){
      const rows=await withTables(q,garden,async(all,t)=>{
        if(!t.binding||!t.portrait)return [];
        return all('SELECT p.picture AS jpeg FROM '+t.portrait+' p JOIN '+t.binding+' b ON p.member=CAST(b.slot AS TEXT) WHERE b.account=? AND p.revision=?',account,revision);
      });
      return rows[0];
    },
    async sharedGoals(q,groups){
      const plans=await Promise.all(groups.map(g=>withTables(q,g.id,async(all,t)=>{
        if(!t.shared)return [];
        const title=t.titles?'(SELECT title FROM '+t.titles+' WHERE id=1)':'NULL';
        const [row]=await all('SELECT target,'+title+' AS title FROM '+t.shared+' WHERE id=1');
        if(!row||!/^\d{4}-\d{2}-\d{2}$/.test(row.target))return [];
        const due=Date.parse(row.target+'T00:00:00+08:00');
        if(!Number.isFinite(due))return [];
        return [{id:'shared:'+g.id,source:'shared',gardenId:g.id,groupName:g.name,title:row.title||'出发倒计时',date:row.target,due}];
      })));
      return plans.flat().sort((a,b)=>a.due-b.due||a.id.localeCompare(b.id));
    },
    async goals(q,account){
      const ownership=await q.all('SELECT garden,slot FROM mc_members WHERE account=? UNION SELECT garden,slot FROM mc_retired_slots WHERE account=?',account,account);
      const result=await Promise.all(ownership.map(async({garden,slot})=>{
        const rows=await withTables(q,garden,async(all,t)=>{
          if(!t.goals)return [];
          const bindings=t.binding?await all('SELECT slot,account FROM '+t.binding+' WHERE slot=? OR account=?',slot,account):[];
          if(bindings.length && !bindings.every(b=>Number(b.slot)===Number(slot)&&b.account===account))return [];
          if(!bindings.length && !(garden==='legacy'&&await q.first('SELECT 1 FROM mc_legacy_slots WHERE slot=? AND account=?',slot,account)))return [];
          return all('SELECT id,title,body,due,created FROM '+t.goals+' WHERE member=? ORDER BY due,id',String(slot));
        });
        return rows.map(r=>({...r,id:'legacy:'+garden+':'+r.id,legacyId:r.id,gardenId:garden,source:'legacy'}));
      }));
      return result.flat();
    },
    async chat(q,garden,me,messageId){
      return withTables(q,garden,async(all,t)=>{
        if(!t.notes)return [];
        const since=Math.floor((Date.now()+28800000)/86400000)*86400000-28800000;
        const details=t.details?' LEFT JOIN '+t.details+' d ON d.note_id=n.id':'';
        const body=t.details?"CASE WHEN d.recalled=1 THEN '消息已撤回' ELSE n.body END":'n.body';
        const photo=t.pictures?'EXISTS(SELECT 1 FROM '+t.pictures+' p WHERE p.note_id=n.id)':'0';
        const filter=messageId?'n.id=?':'n.created>=?';
        const rows=await all('SELECT n.id,n.name,n.rowid AS ordinal,'+photo+' AS photo,'+body+" AS body,n.created FROM "+t.notes+" n"+details+" WHERE n.id GLOB 'chat.*' AND "+filter+" ORDER BY n.created,n.rowid",messageId||since);
        if(!rows.length)return [];
        const mapped=await q.all('SELECT account,slot FROM mc_members WHERE garden=? UNION SELECT account,slot FROM mc_retired_slots WHERE garden=?',garden,garden);
        const bindings=t.binding?await all('SELECT slot,account FROM '+t.binding):[];
        if(!bindings.length&&garden==='legacy')bindings.push(...await q.all('SELECT slot,account FROM mc_legacy_slots'));
        const members=new Map();
        for(const {slot,account} of mapped){
          const key=String(slot);
          if(bindings.some(b=>String(b.slot)===key&&b.account===account))
            members.set(key,members.has(key)&&members.get(key)!==account?null:account);
        }
        const mirror=await q.all("SELECT e.id,e.author FROM mc_v8_entries e WHERE e.kind='group' AND e.scope=? AND e.created>=?",garden,since-86400000);
        const native=new Map(mirror.map(e=>[e.id,e.author]));
        return rows.flatMap(r=>{
          const [,slot,id]=r.id.split('.'),authorId=members.get(slot)??null;
          if(authorId&&native.get(id)===authorId)return [];
          const imageUrl=r.photo&&r.body!=='消息已撤回'?'/g/'+garden+'/api/for/'+me+'/camp?image='+encodeURIComponent(r.id):null;
          return [{...r,body:r.body||(r.photo?'[图片]':'[群消息]'),authorId,imageUrl,source:'legacy'}];
        });
      });
    }
  };
}

