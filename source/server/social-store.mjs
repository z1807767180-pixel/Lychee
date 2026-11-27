import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';

const schema=[
  'CREATE TABLE IF NOT EXISTS mc_v8_friends(lo TEXT NOT NULL,hi TEXT NOT NULL,sender TEXT NOT NULL,accepted INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(lo,hi),CHECK(lo<hi))',
  'CREATE INDEX IF NOT EXISTS mc_v8_friends_hi ON mc_v8_friends(hi,accepted)',
  'CREATE TABLE IF NOT EXISTS mc_v8_goals(id TEXT PRIMARY KEY,account TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,due INTEGER NOT NULL,created INTEGER NOT NULL)',
  'CREATE INDEX IF NOT EXISTS mc_v8_goals_owner ON mc_v8_goals(account,due)',
  "CREATE TABLE IF NOT EXISTS mc_v8_entries(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,author TEXT NOT NULL,client_id TEXT NOT NULL,kind TEXT NOT NULL,scope TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,reply_to TEXT,created INTEGER NOT NULL,UNIQUE(author,client_id))",
  'CREATE INDEX IF NOT EXISTS mc_v8_stream ON mc_v8_entries(kind,scope,seq)',
  'CREATE INDEX IF NOT EXISTS mc_v8_activity ON mc_v8_entries(kind,author,seq)',
  'CREATE TABLE IF NOT EXISTS mc_v8_reads(account TEXT NOT NULL,scope TEXT NOT NULL,through INTEGER NOT NULL,PRIMARY KEY(account,scope))',
  "CREATE TABLE IF NOT EXISTS mc_v8_trees(account TEXT PRIMARY KEY,fruit INTEGER NOT NULL DEFAULT 0 CHECK(fruit>=0),water_count INTEGER NOT NULL DEFAULT 0,last_day TEXT NOT NULL DEFAULT '')",
  'CREATE TABLE IF NOT EXISTS mc_v8_gifts(id TEXT PRIMARY KEY,sender TEXT NOT NULL,recipient TEXT NOT NULL,client_id TEXT NOT NULL,created INTEGER NOT NULL,UNIQUE(sender,client_id))',
  'CREATE INDEX IF NOT EXISTS mc_v8_gifts_to ON mc_v8_gifts(recipient,created)',
  'CREATE TABLE IF NOT EXISTS mc_v8_legacy_delivery(entry TEXT PRIMARY KEY,delivered INTEGER NOT NULL DEFAULT 0,recalled INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS mc_v8_legacy_reads(account TEXT NOT NULL,garden TEXT NOT NULL,created INTEGER NOT NULL,ordinal INTEGER NOT NULL,PRIMARY KEY(account,garden))',
  'CREATE TABLE IF NOT EXISTS mc_v8_group_requests(account TEXT NOT NULL,client_id TEXT NOT NULL,garden TEXT NOT NULL,request TEXT NOT NULL,PRIMARY KEY(account,client_id))',
];
function queries(execute){
  const all=async(sql,...args)=>(await execute(sql,args)).rows;
  return {all,first:async(sql,...args)=>(await all(sql,...args))[0],run:(sql,...args)=>execute(sql,args)};
}
// Independent reads in one snapshot can share a single Hrana HTTP request.
// Writes always stay in their original, explicitly awaited transaction order.
function readQueries(tx){
  let pending=[];
  return queries((sql,args)=>new Promise((resolve,reject)=>{
    if(!pending.length)queueMicrotask(async()=>{
      const group=pending;pending=[];
      try{
        const result=await tx.batch(group.map(x=>x.statement));
        group.forEach((entry,i)=>entry.resolve(result[i]));
      }catch(error){group.forEach(entry=>entry.reject(error));}
    });
    pending.push({statement:{sql,args},resolve,reject});
  }));
}
export async function socialStore({client,dataDir}){
  if(client){
    await client.batch(schema,'write');
    return {async transaction(write,work){
      const tx=await client.transaction(write?'write':'read');
      try{
        const result=await work(write?queries((sql,args)=>tx.execute({sql,args})):readQueries(tx));
        await tx.commit();
        return result;
      }catch(error){try{await tx.rollback();}catch{}throw error;}finally{tx.close();}
    },close(){}};
  }
  const db=new DatabaseSync(join(dataDir,'accounts.sqlite'));
  db.exec('PRAGMA busy_timeout=5000;'+schema.join(';'));
  const q=queries((sql,args)=>{
    const st=db.prepare(sql);
    return st.columns().length?{rows:st.all(...args)}:{rows:[],rowsAffected:st.run(...args).changes};
  });
  let tail=Promise.resolve();
  return {transaction(write,work){
    const result=tail.then(async()=>{
      db.exec(write?'BEGIN IMMEDIATE':'BEGIN');
      try{const result=await work(q);db.exec('COMMIT');return result;}
      catch(error){db.exec('ROLLBACK');throw error;}
    });
    tail=result.catch(()=>{});
    return result;
  },async close(){await tail;db.close();}};
}

