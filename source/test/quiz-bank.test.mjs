import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bank = JSON.parse(readFileSync(new URL('../server/quiz-bank.json', import.meta.url), 'utf8'));
const normalize = text => text.normalize('NFKC').replace(/[\p{P}\p{Z}\s]/gu, '').toLowerCase();

test('正式题库覆盖四个方向与十六类，每类至少二十五个独立题干', () => {
  assert.equal(bank.version, 1);
  assert.equal(bank.categories.length, 16);
  const categoryIds = new Set(bank.categories.map(category => category.id));
  assert.equal(categoryIds.size, 16);
  const groupCounts = new Map();
  for (const category of bank.categories) {
    groupCounts.set(category.group, (groupCounts.get(category.group) ?? 0) + 1);
    const questions = bank.questions.filter(question => question.category === category.id);
    assert.ok(questions.length >= 25, `${category.name} 仅有 ${questions.length} 题`);
  }
  assert.deepEqual([...groupCounts.values()].sort(), [4, 4, 4, 4]);
  assert.equal(new Set(bank.questions.map(question => question.id)).size, bank.questions.length);
  assert.equal(new Set(bank.questions.map(question => normalize(question.prompt))).size, bank.questions.length);
  assert.ok(bank.questions.every(question => categoryIds.has(question.category)));
});

test('每题有四个不同选项、有效答案、解释、难度和逐题出处', () => {
  for (const question of bank.questions) {
    const { id, category, prompt, options, answer, explanation, source, difficulty } = question;
    assert.match(id, new RegExp(`^${category}-[0-9]{3}$`));
    assert.ok(prompt.trim().length > 0, id);
    assert.equal(options.length, 4, id);
    assert.ok(options.every(option => typeof option === 'string' && option.trim().length > 0), id);
    const optionKeys = options.map(option => option.normalize('NFKC').trim().toLowerCase());
    assert.equal(new Set(optionKeys).size, 4, id);
    assert.ok(Number.isInteger(answer) && answer >= 0 && answer < 4, id);
    assert.ok(explanation.trim().length > 0, id);
    assert.ok(['easy', 'medium', 'hard'].includes(difficulty), id);
    assert.equal(new URL(source).protocol, 'https:', id);
    assert.ok(['adapted', 'fact', 'worked'].includes(question.sourceType), id);
    if (question.sourceType === 'adapted') {
      assert.equal(question.license, 'CC BY-SA 4.0', id);
      assert.ok(question.sourceAuthor.trim(), id);
      if (new URL(source).hostname === 'opentdb.com') {
        assert.match(question.sourceId, /^\d+$/, id);
        assert.ok(new URL(source).searchParams.get('query'), id);
      } else {
        assert.match(source, /^https:\/\/github\.com\/uberspot\/OpenTriviaQA\/blob\/[a-f\d]{40}\/categories\/[\w-]+#L\d+$/, id);
      }
    }
  }
});
