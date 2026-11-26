import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {runInNewContext} from 'node:vm';

const scope = {window: {}};
for (const asset of ['diet-foods-v7', 'diet-recipes-v7', 'diet-match-v7', 'diet-estimate-v7']) {
  runInNewContext(await readFile(new URL('../client/' + asset + '.js', import.meta.url), 'utf8'), scope);
}
const {LycheeDietFoodsV7: foods, LycheeDietRecipesV7: recipes, LycheeDietEstimateV7: engine} = scope.window;
const byId = id => foods.find(food => food.id === id);
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 0.00001, actual + ' != ' + expected);

test('Chinese recipe portions scale from cooked edible yield and independently tabulated portion energy', () => {
  // Expected cooked grams from MEXT rows; kcal from TFDA ingredient rows and the source recipe.
  const references = [
    ['recipe-disanxian', 142.9, 118.05],
    ['recipe-disanxian-rice', 292.9, 313.05],
    ['recipe-braised-chicken', 79.8, 142.24],
    ['recipe-hot-dry-noodles', 99.5, 159.17]
  ];
  for (const [id, grams, kcal] of references) {
    const recipe = recipes.find(entry => entry.id === id);
    assert.equal(recipe.estimatedYieldGrams, grams);
    assert.equal(recipe.cookedYieldGrams, undefined);
    assert.match(recipe.yieldSource, /mext\.go\.jp/);
    for (const serving of [200, 400]) {
      const rows = engine.resolveItems([{name: recipe.name, kind: 'dish', basis: 'cooked', grams: serving}], foods, recipes);
      near(engine.groupWeight(rows), serving);
      near(engine.sums(rows).kcal, kcal * serving / grams);
    }
  }
});

test('weighed tomato and egg batch serves 200 or 400 grams under both common Chinese dish names', () => {
  const recipe = recipes.find(r => r.name === '番茄炒蛋');
  assert.equal(recipe.cookedYieldGrams * 2, 505);
  assert.equal(recipe.estimatedYieldGrams, undefined);
  const batch = {kcal: 487.438, protein: 23.465, carbs: 20.057, fat: 35.923};
  for (const name of ['番茄炒蛋', '西红柿炒鸡蛋', '蕃茄炒蛋']) {
    for (const grams of [200, 400]) {
      const rows = engine.resolveItems([{name, kind: 'dish', basis: 'cooked', grams}], foods, recipes);
      assert.equal(rows.length, 5);
      near(engine.groupWeight(rows), grams);
      near(rows.find(row => row.name === '花生油').grams, 22 * grams / 505);
      for (const [nutrient, value] of Object.entries(batch)) near(engine.sums(rows)[nutrient], value * grams / 505);
    }
  }
});

test('US restaurant kung pao chicken keeps its location and the user’s serving weight', () => {
  const chicken = byId('usda-36619');
  assert.match(chicken.name, /美式中餐馆/);
  assert.ok(chicken.aliases.includes('宫保鸡丁'));
  assert.equal(chicken.measuredPortionGrams, 604);
  assert.equal(chicken.measuredPortionUnit, '1 order');
  for (const grams of [200, 400]) {
    const rows = engine.resolveItems([{name: chicken.name, basis: 'cooked', grams}], foods, recipes);
    assert.equal(rows[0].foodId, chicken.id);
    near(engine.sums(rows).kcal, 129 * grams / 100);
  }
});

test('cooked vegetable, oil, rice, and dry noodle masses each contribute once', () => {
  const veg = recipes.find(entry => entry.id === 'recipe-disanxian');
  const vegMass = veg.items.filter(i => i.role === 'vegetable').reduce((s, i) => s + i.grams * i.cookedWeightFactor, 0);
  near(vegMass, 50 * (97 + 76 - 4.3 + 96 - 3.9) / 100);
  near(veg.items.filter(i => i.role === 'oil').reduce((s, i) => s + i.grams * i.cookedWeightFactor, 0), 5);
  const bowl = recipes.find(entry => entry.id === 'recipe-disanxian-rice');
  near(bowl.estimatedYieldGrams - veg.estimatedYieldGrams, 150);
  const noodles = recipes.find(entry => entry.id === 'recipe-hot-dry-noodles');
  const dry = noodles.items.find(i => i.role === 'noodle');
  assert.equal(dry.grams, 35);
  near(dry.grams * dry.cookedWeightFactor, 87.5);
  near(noodles.estimatedYieldGrams - 87.5, 5 + 2 + 5);
});

test('prepared Singapore samples distinguish weighed servings from values per 100 g', async () => {
  const reference = JSON.parse(await readFile(new URL('../diet/prepared_samples.json', import.meta.url), 'utf8'));
  assert.match(reference.license, /CC BY 4\.0/);
  assert.equal(reference.samples.length, 8);
  for (const sample of reference.samples) {
    const record = byId(sample.id);
    assert.equal(record.grams, 100);
    assert.equal(record.measuredPortionGrams, sample.portionGrams);
    assert.equal(record.basis, 'cooked');
    assert.match(record.source, /10\.3390\/foods10071659/);
    near(record.kcal, Math.round(sample.kJ * 100 / 4.184) / 100);
    for (const field of ['protein', 'carbs', 'fat']) assert.equal(record[field], sample[field]);
  }
  // Published Table 1: 388 g sample, 746 kJ per 100 g. One customer's weight is independently editable.
  const rice = byId('sg-yangzhou-fried-rice');
  assert.equal(rice.measuredPortionGrams, 388);
  near(rice.kcal * 2, 356.60);
  near(rice.kcal * 4, 713.20);
});

test('Caesar salad includes the dressing and toppings; plain pizza crust includes none', () => {
  const salad = byId('recipe-ottawa-caesar');
  assert.equal(salad.measuredPortionGrams, 45);
  assert.equal(salad.grams, 100);
  assert.equal(salad.kcal, 100);
  for (const [key, perServing] of Object.entries({protein: 1, carbs: 2, fat: 3.5})) {
    assert.ok(Math.abs(salad[key] * 0.45 - perServing) < 0.003);
  }
  assert.match(salad.source, /ottawapublichealth\.ca/);
  const crust = byId('no-05.062');
  assert.match(crust.source, /matvaretabellen\.no/);
  assert.equal(crust.measuredPortionGrams, null);
  assert.equal(crust.kcal, 252);
  near(crust.carbs, 45.1 + 3);
  assert.equal(crust.protein, 8.4);
  assert.equal(crust.fat, 3.4);
});
