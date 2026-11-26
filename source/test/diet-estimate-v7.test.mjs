import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
const scope={window:{}};
for(const name of ['diet-foods-v7','diet-recipes-v7','diet-match-v7','diet-estimate-v7']){
  runInNewContext(await readFile(new URL('../client/'+name+'.js',import.meta.url),'utf8'),scope);
}
const {LycheeDietFoodsV7:foods,LycheeDietRecipesV7:recipes,LycheeDietEstimateV7:engine}=scope.window;
const resolve=(items,alts=recipes)=>engine.resolveItems(items,foods,alts);
const close=(actual,expected)=>assert.ok(Math.abs(actual-expected)<0.0001,actual+' differs from '+expected);

test('A measured final yield and observed oil constrain the remainder, including absorbed water',()=>{
  // Analytic fixture: the 30 g dry noodles weigh 90 g after boiling; 10 g oil is eaten.
  // These controlled weights only test the mass balance; this is not a recipe in the catalog.
  const code=foods.find(f=>f.id==='tfda-R2000101'),oil=foods.find(f=>f.id==='tfda-M1100101');
  const recipe={id:'laboratory',name:'称重样品',aliases:[],cookedYieldGrams:100,source:'weighed fixture',items:[
    {foodId:code.id,name:'面条',role:'noodle',grams:30,cookedWeightFactor:3},
    {foodId:oil.id,name:'食用油',role:'oil',grams:10,cookedWeightFactor:1}
  ]};
  for(const g of [200,400]){
    const rows=resolve([{name:'称重样品',kind:'dish',ref:'main',grams:g},
      {name:'食用油',kind:'component',partOf:'main',grams:8,basis:'oil_consumed'}],[recipe]);
    close(engine.groupWeight(rows),g);close(rows[0].grams,(g-8)/3);close(rows[1].grams,8);
    const totals=engine.sums(rows);
    for(const key of ['kcal','protein','carbs','fat'])close(totals[key],((g-8)/3*code[key]+8*oil[key])/100);
  }
  const unknown=resolve([{name:'称重样品',grams:400}],[{...recipe,cookedYieldGrams:undefined}]);
  assert.equal(unknown.length,1);assert.equal(unknown[0].foodId,'');assert.equal(unknown[0].grams,400);
});

test('Four everyday Chinese dishes respond to the edible cooked weight for all four nutrients',()=>{
  for(const name of ['地三鲜盖饭','地三鲜','红烧鸡块','武汉热干面']){
    const dish=grams=>({kind:'dish',name,basis:'cooked',grams});
    const small=resolve([dish(200)]),large=resolve([dish(400)]);
    assert.ok(small.length>1,name);assert.ok(small.every(r=>r.foodId),name);
    close(engine.groupWeight(small),200);close(engine.groupWeight(large),400);
    for(const key of ['kcal','protein','carbs','fat']){
      assert.ok(engine.sums(small)[key]>0,name+' '+key);
      close(engine.sums(small)[key]*2,engine.sums(large)[key]);
    }
    const adjusted=engine.resizeGroup(large,large[0].portionGroup,200);
    close(engine.sums(adjusted).kcal,engine.sums(small).kcal);
  }
});
test('A separate serving of rice survives a rice-bowl photo; a branded drink cannot borrow another nutrition label',()=>{
  const rows=resolve([{ref:'dish',kind:'dish',name:'地三鲜盖饭',basis:'cooked',grams:320},
    {ref:'rice',kind:'food',name:'熟长粒米饭',basis:'cooked',grams:125},
    {ref:'drink',kind:'packaged',name:'原味酸奶',brand:'测试品牌',grams:100}]);
  const side=rows.find(r=>r.foodId==='usda-20445'&&!r.recipeId);
  assert.ok(side);close(side.grams,125);close(side.grams*side.per100.kcal/100,162.5);
  assert.equal(rows.at(-1).foodId,'');
  const labelled=resolve([{kind:'packaged',name:'酸奶饮料',brand:'测试品牌',amount:180,
    label:{unit:'ml',per100:{kcal:42,protein:1.5,carbs:6.3,fat:1.2}}}])[0];
  close(engine.sums([labelled]).kcal,75.6);assert.equal(labelled.unit,'ml');
});

test('A seasoning alone cannot stand in for an entire cooked dish',()=>{
  const rows=resolve([{ref:'eggs',kind:'dish',name:'炒鸡蛋',basis:'cooked',grams:120,
    ingredients:[{name:'大豆油',basis:'oil_consumed',grams:8}]}]);
  assert.equal(rows.length,2);
  assert.equal(rows[0].foodId,'');
  assert.equal(rows[1].foodId,'tfda-M1100101');
  assert.equal(rows[1].grams,8);
});

test('Edible weights can be corrected together when all reported ingredients are ready to eat',()=>{
  const rows=resolve([{name:'午餐搭配',kind:'dish',grams:200,ingredients:[
    {name:'熟长粒米饭',basis:'cooked',grams:150},{name:'去皮烤鸡胸',basis:'cooked',grams:50}]}]);
  assert.ok(rows.every(r=>r.portionName==='午餐搭配'&&r.portionGroup===rows[0].portionGroup));
  close(engine.groupWeight(rows),200);
  close(engine.sums(engine.resizeGroup(rows,rows[0].portionGroup,100)).kcal,(1.5*130+.5*165)/2);
});

test('Whole plate correction preserves measured oil within the total and stops at incompatible units or weight bases',()=>{
  const rows=resolve([{name:'熟长粒米饭',basis:'cooked',grams:100},{name:'去皮烤鸡胸',basis:'cooked',grams:50}]);
  const oil={...engine.entryItem(foods.find(f=>f.id==='tfda-M1100101'),10),portionFixed:true,servedAsWeighed:true};
  const input=[...rows,oil];
  const resized=engine.resizePlate(input,85,foods);
  close(engine.plateWeight(resized,foods),85);assert.deepEqual(Array.from(resized,r=>r.grams),[50,25,10]);
  assert.equal(engine.resizePlate(input,5,foods),input);
  assert.equal(engine.plateWeight([...rows,{...oil,unit:'ml'}],foods),null);
  assert.equal(engine.plateWeight([...rows,{...oil,foodId:''}],foods),null);
  assert.equal(engine.plateWeight([engine.entryItem(foods.find(f=>f.id==='tfda-R2000101'),35)],foods),null);
  const dish=resolve([{name:'武汉热干面',grams:200,basis:'cooked'}]);
  close(engine.plateWeight(dish,foods),200);
});
