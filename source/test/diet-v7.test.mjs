import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {handleDietEntries} from '../server/diet-store.mjs';
import {handleDietVision,parseDietVision} from '../server/diet-vision.mjs';
import {startTursoFixture} from './turso-fixture.mjs';

const day='2026-11-26';
const item={name:'白馒头',foodId:'tfda-R2400201',source:'台湾食药署 · R2400201',
  grams:50,per100:{kcal:248,protein:8.1,carbs:51.3,fat:1.2}};

test('配方原料编号、烹饪状态与分量：熟饭只计一次，干面不按熟重',async()=>{
  const context={window:{}};
  for(const file of ['diet-foods-v7.js','diet-recipes-v7.js']){
    runInNewContext(await readFile(new URL('../client/'+file,import.meta.url),'utf8'),context);
  }
  const food=new Map(context.window.LycheeDietFoodsV7.map(v=>[v.id,v]));
  const recipes=new Map(context.window.LycheeDietRecipesV7.map(v=>[v.name,v]));
  const total=recipe=>['kcal','protein','carbs','fat'].map(k=>Number(recipe.items.reduce((sum,p)=>
    sum+food.get(p.foodId)[k]*p.grams/100,0).toFixed(3)));
  const veg=recipes.get('地三鲜'),bowl=recipes.get('地三鲜盖饭'),chicken=recipes.get('红烧鸡块'),noodles=recipes.get('武汉热干面');
  assert.deepEqual(total(veg),[118.05,3.11,14.38,5.622]);
  assert.deepEqual(total(bowl),[313.05,7.145,56.635,6.042]);
  assert.deepEqual(total(chicken),[142.24,10.853,7.271,7.532]);
  assert.deepEqual(total(noodles),[159.17,5.481,27.147,3.189]);
  for(const recipe of recipes.values()){
    assert.match(recipe.source,/^https:\/\//);
    assert.equal(recipe.items.filter(s=>s.role==='oil').length<=1,true);
    assert.ok(recipe.items.every(s=>s.basis&&s.grams>0&&food.has(s.foodId)));
  }
  assert.equal(bowl.items.filter(s=>s.role==='rice').length,1);
  assert.match(noodles.items.find(s=>s.role==='noodle').basis,/干面/);
  assert.ok(bowl.notes.includes('150克'));
});
for(const storage of ['sqlite','turso'])test(storage+' 饮食记录私有、可重试、跨日期与并发保护',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-diet-'));
  const remote=storage==='turso'?await startTursoFixture():null;
  t.after(async()=>{await remote?.close();await rm(dir,{recursive:true,force:true});});
  const storageConfig=remote?{turso:{url:remote.url,authToken:remote.authToken}}:{quotaFile:join(dir,'account.sqlite')};
  const request=(accountId,entry,date=day)=>handleDietEntries(new Request('http://localhost/diet?day='+date,
    entry?{method:'POST',body:JSON.stringify({entry})}:{}),{accountId,storageConfig});
  const record={id:randomUUID(),revision:0,day,title:'午餐馒头',photo:'',items:[item]};
  const first=await (await request('owner',record)).json();
  assert.equal(first.entry.revision,1);
  assert.equal(first.entry.items[0].grams*first.entry.items[0].per100.kcal/100,124);
  assert.equal((await (await request('owner',record)).json()).entry.revision,1,'丢失响应后重试不会新增记录');
  const newer={...first.entry,title:'午饭'};
  assert.equal((await (await request('owner',newer)).json()).entry.revision,2);
  assert.equal((await request('owner',{...first.entry,title:'过时修改'})).status,409);
  assert.equal((await (await request('owner',newer)).json()).entry.revision,2);
  assert.equal((await (await request('owner')).json()).entries[0].title,'午饭');
  assert.deepEqual((await (await request('other')).json()).entries,[]);
  assert.deepEqual((await (await request('owner',null,'2026-11-25')).json()).entries,[]);
  assert.equal((await request('owner',null,'2026-02-31')).status,400);
  assert.equal((await request('owner',{...record,items:[{...item,grams:-30}]})).status,400);
  const blendedOil={name:'调合植物油',source:'台湾食药署 · M9900201',foodId:'tfda-M9900201',grams:2,
    per100:{kcal:887,protein:0,carbs:0,fat:100.3}};
  assert.equal((await request('owner',{...record,id:randomUUID(),items:[blendedOil]})).status,200);
});

test('视觉标签按标示单位换算；真实供应商关闭时不发请求',async()=>{
  const sample={name:'酸奶',grams:90,amount:90,label:{basis:'serving',servingAmount:60,servingUnit:'ml',energy:251.04,energyUnit:'kJ',protein:2.4,carbs:3.6,fat:1.2}};
  sample.label.evidence={basis:'每份60毫升',energy:'251.04千焦',protein:'2.4克',carbs:'3.6克',fat:'1.2克'};
  const result=parseDietVision(JSON.stringify({title:'酸奶',items:[sample]})).items[0];
  assert.equal(result.label.unit,'ml');
  assert.ok(Math.abs(result.label.per100.kcal-100)<1e-7);
  assert.equal(result.label.per100.protein,4);
  assert.equal(result.amount,90);
  sample.label.servingAmount=0;
  assert.equal(parseDietVision(JSON.stringify({items:[sample]})).items[0].label,undefined);
  const reply=await handleDietVision(new Request('http://localhost/',{method:'POST'}),{accountId:'a',gardenId:'legacy',env:{},send:()=>{throw Error('Unexpected provider call');}});
  assert.equal(reply.status,503);
});

test('配置的视觉适配用同一条包装标签返回和共享问答额度，对重试只发送一次',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'lychee-diet-quota-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const quotaConfig={quotaFile:join(dir,'account.sqlite')};
  let sent=0;
  const send=async(url,options)=>{
    sent++;
    assert.equal(url,'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    assert.equal(JSON.parse(options.body).messages[0].content[1].type,'image_url');
    return Response.json({choices:[{message:{content:JSON.stringify({title:'馒头',items:[{name:'白馒头',grams:50}]})}}]});
  };
  const requestId=randomUUID();
  const make=()=>new Request('http://localhost/',{method:'POST',body:JSON.stringify({image:'data:image/jpeg;base64,/9j/2Q==',requestId})});
  const options={accountId:'test',gardenId:'legacy',quotaConfig,send,env:{LYCHEE_ENABLE_DIET_VISION:'1',LYCHEE_ENABLE_PROVIDER_CALLS:'1',ARK_API_KEY:'fixture-only',LYCHEE_DIET_VISION_MODEL:'fixture-only'}};
  for(let n=0;n<2;n++) {
    const reply=await handleDietVision(make(),options);
    assert.equal(reply.status,200);
    assert.equal((await reply.json()).items[0].name,'白馒头');
  }
  assert.equal(sent,1);
});
