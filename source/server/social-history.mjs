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
      const names={goals:prefix+'v61_goals',binding:!db&&id==='legacy'?'mc_legacy_member_bindings':prefix+'garden_member_bindings',notes:prefix+'notes',details:prefix+'chat_details',pictures:prefix+'chat_pictures',shared:prefix+'goal',titles:prefix+'phone_garden'};
      const tables=Object.values(names);
      const found=new Set((await all("SELECT name FROM sqlite_master WHERE type='table' AND name IN ("+tables.map(()=>'?').join(',')+")",...tables)).map(x=>x.name));
      return await callback(all,Object.fromEntries(Object.entries(names).filter(([,name])=>found.has(name))));
    }finally{db?.close();}
  }
  return {
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
    async chat(q,garden,me){
      return withTables(q,garden,async(all,t)=>{
        if(!t.notes)return [];
        const since=Math.floor((Date.now()+28800000)/86400000)*86400000-28800000;
        const details=t.details?' LEFT JOIN '+t.details+' d ON d.note_id=n.id':'';
        const body=t.details?"CASE WHEN d.recalled=1 THEN '消息已撤回' ELSE n.body END":'n.body';
        const photo=t.pictures?'EXISTS(SELECT 1 FROM '+t.pictures+' p WHERE p.note_id=n.id)':'0';
        const rows=await all('SELECT n.id,n.name,n.rowid AS ordinal,'+photo+' AS photo,'+body+" AS body,n.created FROM "+t.notes+" n"+details+" WHERE n.id GLOB 'chat.*' AND n.created>=? ORDER BY n.created,n.rowid",since);
        if(!rows.length)return [];
        const mapped=await q.all('SELECT account,slot FROM mc_members WHERE garden=? UNION SELECT account,slot FROM mc_retired_slots WHERE garden=?',garden,garden);
        const members=new Map(mapped.map(r=>[String(r.slot),r.account]));
        const mirror=await q.all("SELECT e.id,e.author FROM mc_v8_entries e WHERE e.kind='group' AND e.scope=? AND e.created>=?",garden,since-86400000);
        const native=new Map(mirror.map(e=>[e.id,e.author]));
        return rows.flatMap(r=>{
          const [,slot,id]=r.id.split('.'),authorId=members.get(slot)??null;
          if(authorId&&native.get(id)===authorId)return [];
          const imageUrl=r.photo?'/g/'+garden+'/api/for/'+me+'/camp?image='+encodeURIComponent(r.id):null;
          return [{...r,body:r.body||(r.photo?'[图片]':'[群消息]'),authorId,imageUrl,source:'legacy'}];
        });
      });
    }
  };
}

