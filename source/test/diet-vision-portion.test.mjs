import assert from 'node:assert/strict';
import test from 'node:test';
import {parseDietVision} from '../server/diet-vision-result.mjs';

const parse=(...items)=>parseDietVision(JSON.stringify({items})).items;
const drink=()=>({
  basis:'serving',servingAmount:60,servingUnit:'ml',energy:251.04,energyUnit:'kJ',
  protein:2.4,carbs:3.6,fat:1.2,servingsPerPackage:4,
  evidence:{basis:'每份（60 毫升）',energy:'能量 251.04 千焦',protein:'蛋白质 2.4 克',
    carbs:'碳水化合物 3.6 克',fat:'脂肪 1.2 克',servingsPerPackage:'每包装含4份'}
});
test('vegetables and rice belong only to the explicitly identified bowl; a second bowl of rice stays separate',()=>{
  const [dish,rice,side]=parse(
    {ref:'bowl',kind:'dish',name:'地三鲜盖饭',cooking:'炒',grams:420,basis:'cooked',kcal:650,
      ingredients:[{name:'烹调油',grams:6,basis:'oil_consumed',cooking:'炒菜'}]},
    {ref:'r1',kind:'component',partOf:'bowl',name:'熟米饭',grams:125,basis:'cooked'},
    {ref:'r2',kind:'food',name:'熟米饭',grams:150,basis:'cooked',per100:{kcal:100}});
  assert.equal(dish.grams,420);assert.equal(dish.basis,'cooked');assert.equal(dish.cooking,'炒');
  assert.deepEqual(dish.ingredients,[{name:'烹调油',grams:6,basis:'oil_consumed',cooking:'炒菜'}]);
  assert.equal(rice.partOf,dish.ref);assert.equal(side.partOf,undefined);
  assert.equal(side.per100,undefined);assert.equal(dish.kcal,undefined);
  const [original]=parse({name:'米饭',grams:100});
  assert.equal(original.kind,'food');assert.equal(original.grams,100);
});
test('ambiguous or cyclic ownership cannot silently double-count a dish',()=>{
  const x={ref:'x',kind:'dish',name:'面',grams:200};
  const child={ref:'y',kind:'component',partOf:'x',name:'面条',grams:80,basis:'dry'};
  assert.throws(()=>parse(x,{...child,ref:'x'}),/duplicate/);
  assert.throws(()=>parse({...child,partOf:'nobody'}),/reference/);
  assert.throws(()=>parse({...child,partOf:undefined}),/ownership/);
  assert.throws(()=>parse(child,{...child,ref:'x',partOf:'y'}),/reference/);
  assert.throws(()=>parse({...x,partOf:'x'}),/ownership/);
  const [independent]=parse({...x,basis:'dry'});
  assert.equal(independent.basis,'dry');
});
test('packaged food preserves visible identifiers, counts only the edible servings and uses the printed column',()=>{
  const label=drink();
  const [item]=parse({ref:'yogurt',kind:'packaged',name:'酸奶',brand:'测试乳品',productName:'原味浓酸奶 240毫升',label,servingsEaten:1.5});
  assert.equal(item.brand,'测试乳品');assert.equal(item.productName,'原味浓酸奶 240毫升');
  assert.equal(item.label.servingsPerPackage,4);assert.equal(item.label.servingAmount,60);
  assert.equal(item.amount,90);assert.equal(item.unit,'ml');
  assert.ok(Math.abs(item.label.per100.kcal-100)<1e-9);
  assert.deepEqual([item.label.per100.protein,item.label.per100.carbs,item.label.per100.fat],[4,6,2]);
  assert.throws(()=>parse({name:'酸奶',label}),/portion/,'package count alone does not identify what was eaten');
  assert.throws(()=>parse({name:'酸奶',label,unit:'g',grams:90}),/unit/);
  for(const [basis,unit,line] of [['100g','g','每100克'],['100ml','ml','Per 100 ml']]){
    const raw={...label,basis,evidence:{...label.evidence,basis:line}};
    const [v]=parse({name:'酸奶',label:raw,grams:120,amount:120,unit});
    assert.equal(v.label.unit,unit);assert.equal(v.amount,120);assert.equal(v.label.per100.protein,2.4);
    assert.equal(v.label.servingAmount,undefined);
  }
});
test('a brand or an inconsistent label cannot supply nutrients; typed quantities survive',()=>{
  const label=drink();
  const damaged=[
    {...label,evidence:undefined},
    {...label,evidence:{...label.evidence,protein:'蛋白质 2.7 克'}},
    {...label,evidence:{...label.evidence,fat:'脂肪 6% NRV'}},
    {...label,evidence:{...label.evidence,carbs:'蛋白质 3.6 克'}},
    {...label,evidence:{...label.evidence,basis:'每100毫升'}},
    {...label,evidence:{...label.evidence,basis:'每份60克'}},
    {...label,energyUnit:'kcal'}
  ];
  for(const rejected of damaged){
    const [item]=parse({name:'酸奶',brand:'示例',label:rejected,grams:80,energy:100,per100:{kcal:100},fat:5});
    assert.equal(item.kind,'packaged');assert.equal(item.grams,80);assert.equal(item.brand,'示例');
    for(const key of ['label','per100','energy','fat'])assert.equal(item[key],undefined);
  }
  const [bottle]=parse({kind:'packaged',name:'牛奶',brand:'品牌',unit:'ml',amount:135,kcal:1000});
  assert.equal(bottle.amount,135);assert.equal(bottle.grams,undefined);assert.equal(bottle.kcal,undefined);
});
