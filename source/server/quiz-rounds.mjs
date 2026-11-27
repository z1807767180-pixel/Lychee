import {randomInt} from 'node:crypto';

const ROUND_MS = 10000;
const REVEAL_MS = 1600;
export const READY_MS = 1800;

function shuffle(items) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; --i) {
    const other = randomInt(i + 1);
    [result[i], result[other]] = [result[other], result[i]];
  }
  return result;
}

export function drawQuestions(bank, recent = new Map()) {
  const groups = new Map();
  for (const category of bank.categories) {
    if (!groups.has(category.group)) groups.set(category.group, []);
    groups.get(category.group).push(category.id);
  }
  const first = shuffle([...groups.values()]).slice(0, 3).map(ids => shuffle(ids)[0]);
  const remaining = bank.categories.map(c => c.id).filter(id => !first.includes(id));
  const categories = shuffle([...first, ...shuffle(remaining).slice(0, 5 - first.length)]);
  if (categories.length !== 5 || first.length < 3) throw Error('Insufficient quiz categories');
  const topics = new Set();
  return categories.map(category => {
    const pool = shuffle(bank.questions.filter(q => q.category === category && !topics.has(q.topic ?? q.id)));
    pool.sort((a, b) => (recent.get(a.id) ?? 0) - (recent.get(b.id) ?? 0));
    const q = pool[0];
    if (!q) throw Error('Empty quiz category: ' + category);
    topics.add(q.topic ?? q.id);
    const order = shuffle([0, 1, 2, 3]);
    return {id:q.id, category, categoryName:bank.categories.find(c=>c.id===category).name, source:q.source, license:q.license, sourceAuthor:q.sourceAuthor, prompt:q.prompt, options:order.map(i => q.options[i]),
      answer:order.indexOf(q.answer), explanation:q.explanation, picks:[null, null]};
  });
}

export function points(round, elapsed) {
  if (elapsed < 0 || elapsed >= ROUND_MS) return 0;
  return (200 - Math.floor(elapsed / 1000) * 20) * (round === 4 ? 2 : 1);
}

export function scores(state) {
  const totals = [0, 0];
  for (const q of state.rounds) {
    for (let side = 0; side < 2; ++side) totals[side] += q.picks[side]?.points ?? 0;
  }
  return totals;
}

// Reconstruct missed deadlines from server timestamps even if both phones went to sleep.
export function advance(state, now) {
  let changed = false;
  while (state.status === 'active') {
    const q = state.rounds[state.round];
    const end = q.revealedAt ?? state.start + ROUND_MS;
    if (now < end) break;
    if (q.revealedAt == null) { q.revealedAt = end; changed = true; }
    const next = end + REVEAL_MS;
    if (now < next) break;
    changed = true;
    if (state.round === state.rounds.length - 1) {
      state.status = 'done';
    } else {
      ++state.round;
      state.start = next;
    }
  }
  return changed;
}

export function submit(state, side, round, choice, now) {
  if (state.status !== 'active' || round !== state.round || now < state.start) return false;
  const q = state.rounds[round];
  if (q.revealedAt != null || q.picks[side] || now >= state.start + ROUND_MS) return false;
  q.picks[side] = {choice, points:choice === q.answer ? points(round, now - state.start) : 0};
  if (q.picks.every(Boolean)) q.revealedAt = now;
  return true;
}

export function publicGame(row, state, side, now) {
  const self = {id:row.id, host:Number(row.host), guest:Number(row.guest), status:state.status,
    side, serverTime:now};
  if (!state.rounds.length) return self;
  const q = state.rounds[state.round];
  const revealed = q.revealedAt != null;
  const total = scores(state);
  if (!revealed) for (let i = 0; i < 2; ++i) total[i] -= q.picks[i]?.points ?? 0;
  Object.assign(self, {round:state.round, scores:total, start:state.start, deadline:state.start + ROUND_MS,
    phase:revealed ? 'reveal' : now < state.start ? 'ready' : 'answer',
    submitted:q.picks.map(Boolean), myChoice:q.picks[side]?.choice ?? null});
  if (now >= state.start) self.question = {prompt:q.prompt, options:q.options, category:q.category,categoryName:q.categoryName};
  if (revealed) Object.assign(self, {answer:q.answer, explanation:q.explanation, source:q.source, picks:q.picks, next:q.revealedAt + REVEAL_MS});
  if (state.status === 'done') {
    self.winner = total[0] === total[1] ? null : total[0] > total[1] ? 0 : 1;
    self.starChanges = state.starChanges;
    self.review = state.rounds.map(item => ({prompt:item.prompt, answer:item.options[item.answer],
      explanation:item.explanation, source:item.source, license:item.license, sourceAuthor:item.sourceAuthor}));
  }
  return self;
}
