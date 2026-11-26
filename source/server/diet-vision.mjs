import {createHash} from 'node:crypto';
import {openAiQuota} from './ai-quota.mjs';
import {providerStatus} from './provider-config.mjs';

import {dietVisionPrompt, parseDietVision} from './diet-vision-result.mjs';
export {parseDietVision};
const json=(body,status=200)=>Response.json(body,{status,headers:{'cache-control':'private, no-store'}});
const fail=(message,status)=>json({error:message},status);
function visionService(env) {
  const model=env.LYCHEE_DIET_VISION_MODEL?.trim() || 'deepseek-flash';
  if (model==='deepseek-flash') {
    return {endpoint:'https://api.deepseek.com/chat/completions',key:env.DEEPSEEK_API_KEY?.trim(),model,
      options:{thinking:{type:'disabled'},response_format:{type:'json_object'},max_tokens:4096}};
  }
  return {endpoint:'https://ark.cn-beijing.volces.com/api/v3/chat/completions',key:env.ARK_API_KEY?.trim(),model,options:{}};
}

export async function handleDietVision(request, {accountId,gardenId,env=process.env,quotaConfig,send=fetch}) {
  if (!accountId || !gardenId) return fail('请先登录并进入荔枝园',403);
  if (request.method!=='POST') return fail('不支持此操作',405);
  const {enabled}=providerStatus(env,gardenId);
  const service=visionService(env);
  if (!enabled || env.LYCHEE_ENABLE_DIET_VISION!=='1' || !service.key || !quotaConfig)
    return fail('照片识别尚未启用，可手动选择食物',503);
  let body;
  try {body=await request.json();} catch {return fail('照片格式无效',400);}
  const {image,requestId}=body??{};
  if (typeof image!=='string' || image.length>900000 || !/^data:image\/jpeg;base64,\/9j\/[a-z0-9+/]+=*$/i.test(image)) return fail('请选择一张可读取的照片',400);
  if (typeof requestId!=='string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestId)) return fail('识别请求编号无效',400);
  const signature=createHash('sha256').update('diet-v7:'+gardenId+':'+image).digest('hex');
  const quota=await openAiQuota(quotaConfig);
  try {
    return await quota.run(accountId,{kind:'chat',key:'diet:'+requestId.toLowerCase(),signature,gardenId},async meter=>{
      const reply=await meter(service.endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(45000),
        headers:{authorization:'Bearer '+service.key,'content-type':'application/json'},
        body:JSON.stringify({model:service.model,...service.options,
          messages:[{role:'user',content:[{type:'text',text:dietVisionPrompt},{type:'image_url',image_url:{url:image}}]}]})},send);
      if (!reply.ok) return fail('这次照片识别未完成，可手动选择食物',reply.status===429?429:502);
      const result=await reply.json();
      try {return json(parseDietVision(result.choices?.[0]?.message?.content));}
      catch {return fail('未能读取识别结果，可手动选择食物',502);}
    });
  } finally {quota.close();}
}
