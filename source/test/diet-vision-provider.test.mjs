import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {handleDietVision} from '../server/diet-vision.mjs';

test('现有 DeepSeek 问答凭据可用于发照片；相同餐照请求重试只结算一次', async t => {
  const dir=await mkdtemp(join(tmpdir(),'lychee-vision-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const env={LYCHEE_ENABLE_PROVIDER_CALLS:'1',LYCHEE_ENABLE_DIET_VISION:'1',DEEPSEEK_API_KEY:'fixture'};
  const body={image:'data:image/jpeg;base64,/9j/2Q==',requestId:randomUUID()};
  const request=()=>new Request('http://localhost/recognize',{method:'POST',body:JSON.stringify(body)});
  let sends=0;
  const options={accountId:'qa',gardenId:'legacy',quotaConfig:{quotaFile:join(dir,'test.sqlite')},env,
    send:async (url,opts)=>{
      sends++;
      assert.equal(url,'https://api.deepseek.com/chat/completions');
      const payload=JSON.parse(opts.body);
      assert.equal(payload.model,'deepseek-flash');
      assert.equal(payload.messages[0].content[1].image_url.url,body.image);
      return Response.json({choices:[{message:{content:JSON.stringify({title:'午饭',items:[{name:'米饭',grams:120}]})}}]});
    }};
  for (let i=0;i<2;i++) {
    const reply=await handleDietVision(request(),options);
    assert.equal(reply.status,200);
    assert.equal((await reply.json()).items[0].grams,120);
  }
  for(const change of [{LYCHEE_ENABLE_DIET_VISION:'0'},{LYCHEE_PROVIDER_GARDEN_ID:'other'},
      {LYCHEE_DIET_VISION_MODEL:'ark-endpoint-without-key'}, {DEEPSEEK_API_KEY:''}]) {
    const reply=await handleDietVision(request(),{...options,env:{...env,...change}});
    assert.equal(reply.status,503);
  }
  assert.equal(sends,1);
});
