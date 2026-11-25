import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {gardenImages} from '../server/image-result.mjs';
import {openTursoGarden} from '../server/turso-domains.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const legacyDir=join(dirname(fileURLToPath(import.meta.url)),'../legacy');
test('published chunks survive lost commit replies and a sealed absence prevents a late album publication',async t=>{
  const fixture=await startTursoFixture(),gardenId=randomUUID();
  const one=await openTursoGarden({...fixture,gardenId,legacyDir});
  const two=await openTursoGarden({...fixture,gardenId,legacyDir});
  t.after(async()=>{one.close();two.close();await fixture.close();});
  const failures=new Set(),driver={execute:q=>one.driver.execute(q),async batch(queries,mode){
    const results=await one.driver.batch(queries,mode);
    const statement=queries[0].sql;
    for(const table of ['v62_ai_image_parts','v62_ai_images']){
      if(statement.startsWith('INSERT OR IGNORE INTO '+table+'(')&&!failures.has(table)){
        failures.add(table);
        throw Error('simulated lost acknowledgement after commit');
      }
    }
    return results;
  }};
  const writer=gardenImages(driver),reader=gardenImages(two.driver),id=randomUUID();
  const bytes=Buffer.alloc(900000,123);
  await writer.save(id,'1','测试',Date.now(),bytes);
  assert.equal(failures.size,2);
  assert.equal((await reader.lookup(id,'1',{sealIfMissing:true})).id,id);
  const chunks=await two.driver.execute({sql:'SELECT body FROM v62_ai_image_parts WHERE id=? ORDER BY part',args:[id]});
  assert.deepEqual(Buffer.from(chunks.rows.map(row=>row.body).join(''),'base64'),bytes);
  const late=randomUUID();
  assert.equal(await reader.lookup(late,'1',{sealIfMissing:true}),null);
  await writer.save(late,'1','迟到的应答',Date.now(),bytes);
  assert.equal(await reader.lookup(late,'1'),null);
  assert.equal((await two.driver.execute({sql:'SELECT count(*) AS n FROM v62_ai_image_parts WHERE id=?',args:[late]})).rows[0].n,0);
});
