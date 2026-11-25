const fences='garden_image_fences';
const schema=[
  'CREATE TABLE IF NOT EXISTS v62_ai_images(id TEXT PRIMARY KEY,member TEXT NOT NULL,prompt TEXT NOT NULL,created INTEGER NOT NULL,mime TEXT NOT NULL,parts INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS v62_ai_image_parts(id TEXT NOT NULL,part INTEGER NOT NULL,body TEXT NOT NULL,PRIMARY KEY(id,part))',
  `CREATE TABLE IF NOT EXISTS ${fences}(id TEXT PRIMARY KEY)`,
];
const complete=`SELECT i.id,i.prompt FROM v62_ai_images i WHERE i.id=? AND i.member=? AND i.parts>0
  AND i.parts=(SELECT count(*) FROM v62_ai_image_parts p WHERE p.id=i.id AND p.part>=0 AND p.part<i.parts AND length(p.body)>0)`;
const query=(sql,...args)=>({sql,args});

// The receipt ledger and each garden can live in different databases. The
// fence and the publication check must commit in the garden itself.
export function gardenImages(driver){
  let installed;
  function prepare(){
    return installed??=Promise.resolve().then(()=>driver.batch(schema.map(sql=>query(sql)),'write'))
      .catch(error=>{installed=null;throw error;});
  }
  return {
    async lookup(id,member,{sealIfMissing=false}={}){
      await prepare();
      const find=query(complete,id,member);
      if(!sealIfMissing)return (await driver.execute(find)).rows[0]??null;
      const result=await driver.batch([
        query(`INSERT OR IGNORE INTO ${fences}(id) SELECT ? WHERE NOT EXISTS(${complete})`,id,id,member),
        find,
      ],'write');
      return result[1].rows[0]??null;
    },
    async save(id,member,prompt,now,bytes){
      await prepare();
      const encoded=bytes.toString('base64'), partSize=180000, total=Math.ceil(encoded.length/partSize);
      // All writes are idempotent when a transaction commits but its response
      // is lost. Only the database operation can repeat, never the generator.
      async function write(batch){
        try{return await driver.batch(batch,'write');}
        catch{return await driver.batch(batch,'write');}
      }
      for(let first=0;first<total;first+=5){
        const group=[];
        for(let part=first;part<Math.min(first+5,total);part++){
          group.push(query('INSERT OR IGNORE INTO v62_ai_image_parts(id,part,body) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM garden_image_fences WHERE id=?)',
            id,part,encoded.slice(part*partSize,(part+1)*partSize),id));
        }
        await write(group);
      }
      await write([query(`INSERT OR IGNORE INTO v62_ai_images(id,member,prompt,created,mime,parts)
        SELECT ?,?,?,?,'image/jpeg',? WHERE NOT EXISTS(SELECT 1 FROM ${fences} WHERE id=?)`,
        id,member,prompt,now,total,id)]);
      return id;
    },
  };
}

// Log only the stage and a fixed category. A request or vendor error body
// may include user content or credential details.
export async function imageProviderPayload(url,key,payload,timeout){
  let response;
  try{
    response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+key,'Content-Type':'application/json'},
      body:JSON.stringify(payload),signal:AbortSignal.timeout(timeout)});
  }catch(error){
    console.info('lychee-image-provider',error?.name==='TimeoutError'?'timeout':'connect');
    throw Error('AI 服务连接中断');
  }
  if(!response.ok){
    console.info('lychee-image-provider','http',response.status);
    await response.body?.cancel().catch(()=>{});
    throw Error('AI 服务暂不可用');
  }
  try{return await response.json();}
  catch{console.info('lychee-image-provider','body');throw Error('没有收到完整的图片响应');}
}
