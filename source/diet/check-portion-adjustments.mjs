// Offline diagnostic using the unchanged eight public-photo receipts.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';
import {parseDietVision} from '../server/diet-vision.mjs';

const json = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const [manifest, batch, annotations] = await Promise.all([
  json('./nutrition5k-check.json'), json('./nutrition5k-responses.json'), json('./nutrition5k-portions.json')
]);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
assert.equal(digest(batch), '3c413b3a2eb362ea65be0ebcca50f6eac860d1b268b988c756d400ba1cb4ea46',
  'Frozen provider receipts changed');
assert.equal(digest(manifest), '7b6d623088f39732da175ce428b70f033bd16d05a7e9d8c2c2e5afd0c7abb9e8',
  'Original eight test cases changed');
const scope = {window: {}};
for (const file of ['diet-foods-v7', 'diet-recipes-v7', 'diet-match-v7', 'diet-estimate-v7', 'diet-condiment-v7']) {
  runInNewContext(await readFile(new URL('../client/' + file + '.js', import.meta.url), 'utf8'), scope);
}
const {LycheeDietEstimateV7: engine, LycheeDietCondimentV7: condiment,
  LycheeDietFoodsV7: catalog, LycheeDietRecipesV7: recipes} = scope.window;

const receipts = new Map(batch.responses.map(r => [r.id, r]));
const pinned = new Map(annotations.cases.map(a => [a.id, a]));
assert.equal(manifest.cases.length, 8);
assert.equal(receipts.size, 8);
assert.equal(pinned.size, 4);
const withinGrams = (a, b) => assert.ok(Math.abs(a - b) < 0.001, 'Plate mass mismatch: ' + a + ' vs ' + b);
const nutrients = ['kcal', 'protein', 'carbs', 'fat'];
const scenarios = ['photo', 'weighedPlate', 'weighedPlateAndCondiments'];
const round = n => Number(n.toFixed(3));
const mean = values => values.reduce((a, b) => a + b, 0) / values.length;
let validReceipts = 0;
const excluded = [];
const evaluated = [];

function result(rows, sample) {
  const estimate = engine.sums(rows);
  const errors = Object.fromEntries(nutrients.map(k => [k, estimate[k] - sample[k]]));
  return {plateGrams: engine.plateWeight(rows, catalog), kcal: estimate.kcal, errors,
    relativeKcalError: Math.abs(errors.kcal) / sample.kcal};
}

for (const sample of manifest.cases) {
  const receipt = receipts.get(sample.id);
  let parsed;
  if (receipt?.state === 'recognized') parsed = parseDietVision(receipt.output);
  if (!parsed) {
    excluded.push({id: sample.id, reason: 'no valid receipt'});
    assert.ok(!pinned.has(sample.id));
    continue;
  }
  validReceipts++;
  const baseline = engine.resolveItems(parsed.items, catalog, recipes);
  const annotation = pinned.get(sample.id);
  if (!annotation) {
    excluded.push({id: sample.id, reason: 'outside the four originally complete plates',
      unmatched: baseline.filter(row => !row.foodId).map(row => row.name)});
    continue;
  }
  assert.ok(baseline.length && baseline.every(row => row.foodId), 'Incomplete reference cohort plate: ' + sample.id);
  withinGrams(Object.values(annotation.ingredients).reduce((a, b) => a + b, 0), sample.grams);
  const weighed = engine.resizePlate(baseline, sample.grams, catalog);
  withinGrams(engine.plateWeight(weighed, catalog), sample.grams);

  let withCondiments = baseline;
  const pinnedAmounts = [];
  for (const input of annotation.manualInputs || []) {
    const grams = annotation.ingredients[input.annotation];
    assert.ok(grams > 0 && grams < sample.grams);
    // For this cohort the one separately weighed oil was absent from the photo
    // estimate. Reject replacement of an oil already included in a dish.
    assert.ok(!withCondiments.some(row => row.foodId === input.foodId));
    assert.ok(withCondiments.every(row => ['usda-11458', 'usda-11125'].includes(row.foodId)),
      'Only the originally recognized plain vegetables qualify for an uncounted oil addition.');
    const changed = condiment.applyChange(withCondiments, catalog,
      {kind: input.kind, target: 'add', foodId: input.foodId, grams, extra: true});
    assert.ok(changed !== withCondiments && changed.some(r => r.foodId === input.foodId && r.portionFixed));
    withCondiments = changed;
    pinnedAmounts.push({name: input.annotation, grams, foodId: input.foodId});
  }
  // The entered plate weight includes the fixed oil. resizePlate apportions
  // only the residual mass to the other foods.
  const corrected = engine.resizePlate(withCondiments, sample.grams, catalog);
  withinGrams(engine.plateWeight(corrected, catalog), sample.grams);
  for (const amount of pinnedAmounts) {
    withinGrams(corrected.find(row => row.portionFixed && row.foodId === amount.foodId).grams, amount.grams);
  }
  evaluated.push({id: sample.id, photoTitle: parsed.title, referenceGrams: sample.grams, referenceKcal: sample.kcal,
    manualInputs: pinnedAmounts, omittedCondiments: (annotation.omittedCondiments || []).map(name => ({
      name, grams: annotation.ingredients[name], reason: annotation.omissionReason
    })), photo: result(baseline, sample), weighedPlate: result(weighed, sample),
    weighedPlateAndCondiments: result(corrected, sample)});
}
assert.equal(validReceipts, 7);
assert.equal(evaluated.length, pinned.size);

const aggregates = {};
for (const key of scenarios) {
  const results = evaluated.map(d => d[key]);
  const passed = results.filter(r => r.relativeKcalError <= 0.20).length;
  aggregates[key] = {within20Percent: passed,
    denominators: {paired: results.length, validReceipts, originalPhotos: manifest.cases.length},
    meanAbsolutePercentEnergyError: round(mean(results.map(r => r.relativeKcalError)) * 100),
    meanAbsoluteError: Object.fromEntries(nutrients.map(k => [k, round(mean(results.map(r => Math.abs(r.errors[k]))))]))};
}
console.log(JSON.stringify({source: annotations.source, sourceSha256: annotations.sourceSha256,
  interpretation: 'Only photo uses image estimates alone. Both weighed scenarios simulate human input of reference measurements after inference. Unknown dishes and failed photos remain in the original denominator.',
  kcalTolerancePercent: 20, validReceipts, excluded, pairedPlates: evaluated.length, aggregates, meals: evaluated},
  (_, value) => typeof value === 'number' ? Number(value.toFixed(6)) : value, 2));
