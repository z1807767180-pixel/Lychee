import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const context = vm.createContext({window:{}});
for (const file of ['diet-foods-v7','diet-match-v7','diet-estimate-v7','diet-condiment-v7']) {
  vm.runInContext(await readFile(new URL('../client/'+file+'.js', import.meta.url),'utf8'), context);
}
const {LycheeDietFoodsV7:catalog, LycheeDietEstimateV7:estimate, LycheeDietCondimentV7:component} = context.window;
const find = id => catalog.find(f => f.id===id);
const oil = find('usda-04053'), sauce = find('usda-43015'), egg = find('usda-01132');
const tracked = (food,grams) => estimate.entryItem(food,grams);
const apply = (items,change) => component.applyChange(items,catalog,change);

test('已列油更新实际重量且保持原菜归属，热量差独立复算', () => {
  const base = tracked(egg,90);
  const oilRow = {...tracked(oil,2), portionGroup:'first', recipeId:'r', cookedFactor:1};
  const rows = [base,oilRow];
  const result = apply(rows,{kind:'oil',target:1,grams:8});
  assert.equal(rows[1].grams,2);
  assert.equal(result.length,2);
  assert.equal(result[0],base);
  assert.equal(result[1].portionGroup,'first');
  assert.equal(result[1].recipeId,'r');
  assert.equal(result[1].cookedFactor,1);
  assert.equal(result[1].portionFixed,true);
  assert.ok(Math.abs(estimate.sums(result).kcal-estimate.sums(rows).kcal-6*oil.kcal/100)<1e-8);
  assert.equal(apply(result,{kind:'oil',target:1,grams:0}).length,1);
});

test('两份酱明确选择其中一份；额外蘸料必须获得用户确认', () => {
  const rows = [tracked(sauce,10),tracked(sauce,15),tracked(egg,105)];
  const edit = apply(rows,{kind:'sauce',target:1,foodId:sauce.id,grams:4});
  assert.equal(edit[0],rows[0]);
  assert.equal(edit[1].grams,4);
  assert.equal(edit[2],rows[2]);
  for (const extra of [false,undefined,'true']) {
    assert.equal(apply(rows,{kind:'sauce',target:'add',foodId:sauce.id,grams:3,extra}),rows);
  }
  const result = apply(rows,{kind:'sauce',target:'add',foodId:sauce.id,grams:4,extra:true});
  assert.equal(result.length,4);
  assert.equal(result[3].servedAsWeighed,true);
  assert.equal(result[3].portionFixed,true);
  assert.equal(result[3].source,sauce.source);
  assert.equal(result[3].portionGroup,undefined);
  assert.equal(result[0],rows[0]);
});

test('炒鸡蛋与乳化酱不能直接改作油；毫升标签须选择每百克来源', () => {
  const dressing = tracked(sauce,15);
  const labelMl = {...dressing,foodId:'label',name:'凯撒沙拉酱',unit:'ml'};
  const unknown = {...dressing,foodId:'',name:'酱料'};
  const rows = [tracked(egg,120),dressing,labelMl,unknown];
  for (const target of [0,1,2]) {
    assert.equal(apply(rows,{kind:'oil',target,foodId:oil.id,grams:5}),rows);
  }
  assert.equal(apply(rows,{kind:'sauce',target:2,grams:3}),rows);
  assert.equal(apply(rows,{kind:'sauce',target:3,grams:3}),rows);
  const update = apply(rows,{kind:'sauce',target:2,foodId:sauce.id,grams:3});
  assert.equal(update[2].unit,'g');
  assert.equal(update[2].source,sauce.source);
  assert.equal(update[2].foodId,sauce.id);
});

test('拒绝空白或超限重量、跨类别操作和超出每餐条数', () => {
  const rows = [tracked(oil,10)];
  for (const grams of [NaN,-1,Infinity,10001,'3']) {
    assert.equal(apply(rows,{kind:'oil',target:0,foodId:oil.id,grams}),rows);
  }
  assert.equal(apply(rows,{kind:'oil',target:0,foodId:sauce.id,grams:3}),rows);
  assert.equal(apply(rows,{kind:'oil',target:5,foodId:oil.id,grams:3}),rows);
  const full = Array(24).fill(rows[0]);
  assert.equal(apply(full,{kind:'oil',target:'add',foodId:oil.id,grams:3,extra:true}),full);
  assert.equal(apply(full,{kind:'oil',target:23,foodId:oil.id,grams:3}).length,24);
});
