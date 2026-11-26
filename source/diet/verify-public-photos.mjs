// Run from any directory. Default is offline. Only fixed, hash-verified public photos can be sent.
import {createHash, webcrypto, randomUUID} from 'node:crypto';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import vm from 'node:vm';
import {handleDietVision,parseDietVision} from '../server/diet-vision.mjs';

const home=fileURLToPath(new URL('../.local/v7-evidence/meal-reference/',import.meta.url));
const receipts=join(home,'deepseek-flash-attempts');
const live=process.argv.length===3 && process.argv[2]==='--run-eight-public-photos';
if(process.argv.length>2 && !live) throw Error('Unknown argument');
const {cases}=JSON.parse(await readFile(new URL('./nutrition5k-check.json',import.meta.url)));
const batch=JSON.parse(await readFile(new URL('./nutrition5k-responses.json',import.meta.url)));
const recorded=new Map(batch.responses.map(r=>[r.id,r]));
if(cases.length!==8 || new Set(cases.map(c=>c.id)).size!==8) throw Error('Invalid sample set');
if(live && !process.env.DEEPSEEK_API_KEY?.trim()) throw Error('The test process needs DEEPSEEK_API_KEY');
await mkdir(receipts,{recursive:true});
const context=vm.createContext({window:{},crypto:webcrypto});
for(const file of ['diet-foods-v7.js','diet-recipes-v7.js','diet-match-v7.js','diet-estimate-v7.js']) {
  vm.runInContext(await readFile(new URL('../client/'+file,import.meta.url),'utf8'),context);
}
const {LycheeDietEstimateV7:estimate,LycheeDietFoodsV7:foods,LycheeDietRecipesV7:recipes}=context.window;
const summary=[];
for(const sample of cases){
  const path=join(receipts,sample.id+'.json');
  let receipt=recorded.get(sample.id);
  if(!receipt){
    try {receipt=JSON.parse(await readFile(path,'utf8'));} catch(e){if(e.code!=='ENOENT') throw e;}
  }
  if(!receipt && live){
    const photo=await readFile(join(home,sample.id+'.jpg'));
    if(createHash('sha256').update(photo).digest('hex')!==sample.jpeg_sha256) throw Error('Unexpected image: '+sample.id);
    // Reserve before transmission. A timeout or interruption still consumes this sample's one attempt.
    receipt={id:sample.id,state:'attempted'};
    await writeFile(path,JSON.stringify(receipt),{flag:'wx'});
    console.error('正在识别公开餐照 '+(cases.indexOf(sample)+1)+' / '+cases.length+'，请保持窗口打开。');
    const request=new Request('http://localhost/api/v7/diet/recognize',{method:'POST',body:JSON.stringify({
      image:'data:image/jpeg;base64,'+photo.toString('base64'),requestId:randomUUID()})});
    const result=await handleDietVision(request,{accountId:'public-photo-evaluation',gardenId:'legacy',
      env:{LYCHEE_ENABLE_PROVIDER_CALLS:'1',LYCHEE_ENABLE_DIET_VISION:'1',DEEPSEEK_API_KEY:process.env.DEEPSEEK_API_KEY},
      quotaConfig:{quotaFile:join(receipts,'meter.sqlite')},
      send:async(url,options)=>{
        if(url!=='https://api.deepseek.com/chat/completions') throw Error('Unexpected host');
        receipt.sent=true;
        await writeFile(path,JSON.stringify(receipt));
        let response;
        try {response=await fetch(url,options);}
        catch(e){
          receipt.transport=e.cause?.code||e.name;
          await writeFile(path,JSON.stringify(receipt));
          throw e;
        }
        receipt.providerStatus=response.status;
        if(response.ok){
          const data=await response.clone().json();
          receipt.output=data.choices?.[0]?.message?.content;
          receipt.finish=data.choices?.[0]?.finish_reason;
          receipt.usage=data.usage;
        }
        await writeFile(path,JSON.stringify(receipt));
        return response;
      }});
    receipt={...receipt,state:result.ok?'recognized':'failed',status:result.status,body:await result.json()};
    await writeFile(path,JSON.stringify(receipt));
    console.error(result.ok?'本张已收到识别结果。':'本张未完成：'+(receipt.body.error||result.status));
    if(!result.ok && receipt.providerStatus!==200){
      summary.push({id:sample.id,status:receipt.state,http:result.status});
      break;
    }
  }
  // A parser or catalogue fix can be evaluated again against the untouched original model response.
  let parsed;
  if(receipt?.output){
    try {parsed=parseDietVision(receipt.output);} catch { /* Count invalid provider output as a failure. */ }
  }else if(receipt?.state==='recognized') parsed=receipt.body;
  if(!parsed){
    summary.push({id:sample.id,status:receipt?.state||'not-run'});continue;
  }
  const top=parsed.items.filter(item=>!item.partOf);
  const weighted=top.length>0 && top.every(item=>Number.isFinite(item.grams)&&item.unit!=='ml');
  const weight=weighted?{estimatedGrams:top.reduce((n,item)=>n+item.grams,0),referenceGrams:sample.grams}:{};
  const rows=estimate.resolveItems(parsed.items,foods,recipes);
  const unmatched=rows.filter(row=>!row.foodId).map(row=>row.name);
  if(!rows.length||unmatched.length){
    summary.push({id:sample.id,status:'needs-manual-entry',...weight,unmatched});continue;
  }
  const actual=estimate.sums(rows);
  const deltas=Object.fromEntries(Object.keys(actual).map(k=>[k,Number((actual[k]-sample[k]).toFixed(2))]));
  summary.push({id:sample.id,status:'estimated',...weight,referenceKcal:sample.kcal,
    estimateKcal:Number(actual.kcal.toFixed(2)),deltas,relativeKcalError:Math.abs(deltas.kcal)/sample.kcal});
}
const estimated=summary.filter(s=>s.status==='estimated');
const mean=values=>values.length?Number((values.reduce((a,b)=>a+b,0)/values.length).toFixed(2)):null;
console.log(JSON.stringify({sampleCount:cases.length,automaticallyEstimated:estimated.length,
  within20Percent:estimated.filter(s=>s.relativeKcalError<=.20).length,
  meanAbsoluteGrams:mean(summary.filter(m=>Number.isFinite(m.estimatedGrams)).map(m=>Math.abs(m.estimatedGrams-m.referenceGrams))),
  meanAbsoluteErrorOnCompleted:Object.fromEntries(['kcal','protein','carbs','fat'].map(k=>[k,mean(estimated.map(m=>Math.abs(m.deltas[k])))])),
  meals:summary},null,2));
