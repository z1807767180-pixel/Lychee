import {randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {DatabaseSync} from 'node:sqlite';

// Loopback-only subset of Hrana v2 for exercising the shipped libSQL HTTP client.
// Real SQLite owns statement semantics. A baton leases the connection until close.
export async function startTursoFixture({databasePath=':memory:'}={}) {
  const sqlite=new DatabaseSync(databasePath), authToken=randomUUID(), streams=new Map();
  const counts={pipelines:0,statements:0};
  let tail=Promise.resolve();
  async function acquire() {
    const previous=tail;
    let release;
    tail=new Promise(ok=>{release=ok;});
    await previous;
    const id=randomUUID(),stream={id,sql:new Map(),release};
    streams.set(id,stream);
    return stream;
  }
  function value(v) {
    if(v.type==='integer')return BigInt(v.value);
    if(v.type==='blob')return Buffer.from(v.base64,'base64');
    return v.value??null;
  }
  function wire(v) {
    if(v===null)return {type:'null'};
    if(typeof v==='bigint')return {type:'integer',value:String(v)};
    if(typeof v==='number')return {type:'float',value:v};
    if(typeof v==='string')return {type:'text',value:v};
    return {type:'blob',base64:Buffer.from(v).toString('base64')};
  }
  function execute(stream,q) {
    counts.statements++;
    let sql=q.sql??stream.sql.get(q.sql_id);
    if(/^BEGIN (?:TRANSACTION )?READONLY$/i.test(sql)){
      sqlite.exec('PRAGMA query_only=ON');stream.readOnly=true;sql='BEGIN';
    }
    const stmt=sqlite.prepare(sql);
    stmt.setReadBigInts(true);stmt.setReturnArrays(true);
    const args=(q.args??[]).map(value);
    const cols=stmt.columns().map(c=>({name:c.name,decltype:c.type??null}));
    let rows=[], changes=0;
    if(cols.length) {
      rows=stmt.all(...args).map(row=>row.map(wire));
      if(/^\s*(?:insert|update|delete)/i.test(sql))changes=sqlite.prepare('SELECT changes() AS c').get().c;
    } else {
      const result=stmt.run(...args);
      if(stream.readOnly && /^\s*(?:COMMIT|ROLLBACK)\s*$/i.test(sql)){
        sqlite.exec('PRAGMA query_only=OFF');stream.readOnly=false;
      }
      if(/^\s*(?:insert|update|delete)/i.test(sql))changes=Number(result.changes);
    }
    return {cols,rows:q.want_rows===false?[]:rows,affected_row_count:changes,last_insert_rowid:null};
  }
  function request(stream,r) {
    switch(r.type) {
      case 'execute':return {type:r.type,result:execute(stream,r.stmt)};
      case 'store_sql':stream.sql.set(r.sql_id,r.sql);break;
      case 'close_sql':stream.sql.delete(r.sql_id);break;
      case 'get_autocommit':return {type:r.type,is_autocommit:!sqlite.isTransaction};
      case 'close':
        if(sqlite.isTransaction)sqlite.exec('ROLLBACK');
        if(stream.readOnly)sqlite.exec('PRAGMA query_only=OFF');
        streams.delete(stream.id);stream.release();break;
      case 'batch': {
        const rs=[],es=[];
        function matches(c) {
          if(!c)return true;
          if(c.type==='ok')return !!rs[c.step];
          if(c.type==='error')return !!es[c.step];
          if(c.type==='not')return !matches(c.cond);
          if(c.type==='and')return c.conds.every(matches);
          if(c.type==='or')return c.conds.some(matches);
          throw Error('Unsupported condition');
        }
        for(const step of r.batch.steps){
          let result=null,error=null;
          if(matches(step.condition))try{ result=execute(stream,step.stmt); }catch(e){error={message:e.message,code:'SQLITE_ERROR'};}
          rs.push(result);es.push(error);
        }
        return {type:'batch',result:{step_results:rs,step_errors:es}};
      }
      default:throw Error('Unsupported stream request '+r.type);
    }
    return {type:r.type};
  }
  const server=createServer(async(req,res)=>{
    try {
      if(req.url!=='/v2/pipeline'||req.method!=='POST'){res.writeHead(404).end();return;}
      if(req.headers.authorization!=='Bearer '+authToken){res.writeHead(401).end();return;}
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const body=JSON.parse(Buffer.concat(chunks));
      const stream=body.baton?streams.get(body.baton):await acquire();
      if(!stream){res.writeHead(400).end();return;}
      counts.pipelines++;
      const results=body.requests.map(r=>{
        try{return {type:'ok',response:request(stream,r)};}
        catch(e){return {type:'error',error:{message:e.message,code:'SQLITE_ERROR'}};}
      });
      res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({baton:streams.has(stream.id)?stream.id:null,results}));
    }catch{res.writeHead(500).end();}
  });
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  return {url:'http://127.0.0.1:'+server.address().port,authToken,sqlite,counts,
    async close(){await new Promise(ok=>server.close(ok));sqlite.close();}};
}
