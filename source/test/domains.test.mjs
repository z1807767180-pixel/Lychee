import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { createDomains, importLegacyDatabase } from '../server/domains.mjs';

const legacyDir = fileURLToPath(new URL('../legacy/', import.meta.url));
const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABv/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIoAaD3/2Q==';
// A JPEG comment yields distinguishable bytes while keeping both images decodable.
const secondJpeg = Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xfe,0,3,65]), Buffer.from(jpeg, 'base64').subarray(2)]).toString('base64');
const portraitJpeg = inflateSync(Buffer.from('eJz7f+P/AwYBLzdPNwZGRgYGRiBk+H+bwZmBg42NnY2Vg52dnZOTg4tHhJeHm5tHUkiYX0RWSl5OVkpGRkFFT11BSUdZRkbDXFPHwNDExERe3dLWwshGz9jECGQIIycnJw83jwQvr4SRooyiEcng/wEGQQ5GB0YHZkYlBiZBRmZBxv9HGETBTkUBbEBhEQF0UQaQYkbsigUxFd9i4GFmBFrDLMhgz9DFaNKPrmIUjALKAfv/mwAiqCr6','base64')).toString('base64');
const member = (gardenId, slot) => ({ gardenId, slot, username: '测试' + slot, accountId: gardenId + '_' + slot });
function api(domains, member, path, payload) {
  const url = new URL(path, 'http://127.0.0.1');
  const req = new Request(url, payload === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json', origin: url.origin }, body: JSON.stringify(payload),
  });
  return domains.handle(req, member);
}
async function json(response, expected = 200) {
  const r = await response;
  const body = await r.json();
  assert.equal(r.status, expected, JSON.stringify(body));
  return body;
}
async function photo(response, picture) {
  const r = await response;
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'image/jpeg');
  assert.equal(r.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from(picture, 'base64'));
}

test('two gardens keep the same local IDs independent, including member 4, images, work and personal reminders', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lychee-domain-test-'));
  const domains = createDomains({ dataDir, legacyDir });
  t.after(async () => { await domains.close(); await rm(dataDir, { recursive: true }); });
  const a = member('garden-a', 4), b = member('garden-b', 4);
  const partner = member('garden-a', 1);
  const id = randomUUID();
  for (let slot = 1; slot <= 5; slot++) {
    const state = await json(api(domains, member('garden-a', slot), '/api/camp?roster=lychee'));
    assert.equal(state.me, String(slot));
    assert.equal(state.members.length, slot);
    assert.equal(state.tree.game.active.length, slot >= 3 ? 3 : 0);
    assert.ok(state.tree.game.active.every(id => state.members.some(m => m.id === id)));
  }
  for (const [actor, text, picture] of [[a,'甲园',jpeg], [b,'乙园',secondJpeg]]) {
    await json(api(domains, actor, '/api/camp', { type: 'note', key: id, name: '测试4', avatar: 3, body: text, picture }));
    await json(api(domains, actor, '/api/phone', { type: 'v61-task', id, kind: 'task', title: text, body: '', due: Date.now()+3600000 }));
    await json(api(domains, actor, '/api/phone', { type: 'focus', minutes: 25, id }));
    await json(api(domains, actor, '/api/phone', { type: 'journal-post', id, body: text, kind: 'relay', prompt: '测试照片', options: [], album: '', picture }));
    await json(api(domains, actor, '/api/phone', { type: 'journal-photo', id, post: id, picture }));
    await json(api(domains, actor, '/api/phone', { type: 'v61-question', id, title:text, body:'', category:'生活', picture }));
    await json(api(domains, actor, '/api/phone', { type: 'v62-cover', kind: 'wall', item: 'main', picture }));
  }
  for (const [actor, text, picture] of [[a,'甲园',jpeg], [b,'乙园',secondJpeg]]) {
    const feed = await json(api(domains, actor, '/api/phone?journal=1'));
    assert.deepEqual(feed.posts.map(p => [p.id, p.body, p.member]), [[id,text,'4']]);
    assert.equal((await json(api(domains, actor, '/api/camp'))).notes[0].body, text);
    assert.deepEqual((await json(api(domains, actor, '/api/phone?v61=personal'))).tasks.map(t => t.title), [text]);
    assert.equal((await json(api(domains, actor, '/api/phone?private=1&tools=2'))).focus[0].id, id);
    await photo(api(domains, actor, '/api/phone?image=' + id), picture);
    await photo(api(domains, actor, '/api/camp?image=chat.4.' + id), picture);
    await photo(api(domains, actor, '/api/phone?relayImage=' + id), picture);
    await photo(api(domains, actor, '/api/phone?v61=question-image&id=' + id), picture);
    assert.equal((await json(api(domains, actor, '/api/phone?v62=covers'))).covers[0].picture, picture);
  }
  const reply = { type: 'note', name: '测试1', avatar: 0, key: randomUUID(), body: '@测试4 收到', mentions: ['4'], replyTo: 'chat.4.'+id };
  await json(api(domains, partner, '/api/camp', reply));
  assert.equal((await json(api(domains, a, '/api/camp'))).notes[0].mentionedMe, 1);
  await json(api(domains, a, '/api/camp', { type: 'profile', name: '四号', avatar: 0, mood: '已就绪', action: '挥手' }));
  assert.equal((await json(api(domains, partner, '/api/camp'))).members.find(m => m.id === '4').name, '四号');
  assert.equal((await json(api(domains, a, '/api/camp?riddles=rank'))).rows.length, 5);
  await photo(api(domains, partner, '/api/phone?image='+id), jpeg);
  assert.deepEqual((await json(api(domains, partner, '/api/phone?v61=personal'))).tasks, []);
  assert.deepEqual((await json(api(domains, partner, '/api/phone?private=1&tools=2'))).focus, []);
  assert.deepEqual((await json(api(domains, partner, '/api/phone?v62=covers'))).covers, []);
  const {revision} = await json(api(domains, a, '/api/phone', { type: 'portrait', picture: portraitJpeg }));
  assert.match(revision, /^[a-f0-9]{64}$/);
  await photo(api(domains, partner, '/api/phone?portrait=4&rev='+revision), portraitJpeg);
  assert.deepEqual((await json(api(domains, b, '/api/phone'))).portraits,{});
  assert.deepEqual((await json(api(domains, a, '/api/phone/circles'))).circles.map(c => c.id), ['main']);
  await json(api(domains, a, '/api/phone/circles', { action: 'create', id: randomUUID(), name: '新园' }), 403);
  await domains.close();
  const reopened = createDomains({ dataDir, legacyDir });
  try {
    await photo(api(reopened, partner, '/api/camp?image=chat.4.' + id), jpeg);
    await photo(api(reopened, b, '/api/camp?image=chat.4.' + id), secondJpeg);
  } finally { await reopened.close(); }
});

test('legacy snapshot retains profiles, history and legacy channels without reopening the old login', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'lychee-domain-import-'));
  const sourceFile = join(dataDir,'source.sqlite');
  const source = new DatabaseSync(sourceFile);
  const channel = randomUUID(), imageId = randomUUID();
  source.exec(`CREATE TABLE camp_accounts(slot INTEGER PRIMARY KEY CHECK(slot BETWEEN 1 AND 3),username TEXT,salt TEXT,verifier TEXT);
    INSERT INTO camp_accounts VALUES(1,'old','test-salt','test-verifier');
    CREATE TABLE camp_profiles(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar INTEGER UNIQUE NOT NULL,mood TEXT NOT NULL,action TEXT NOT NULL,day TEXT NOT NULL);
    INSERT INTO camp_profiles VALUES('1','旧昵称',0,'晴天','休息','');
    CREATE TABLE goal(id INTEGER PRIMARY KEY,start TEXT NOT NULL,target TEXT NOT NULL);
    INSERT INTO goal VALUES(1,'2026-01-01','2027-01-01');
    CREATE TABLE phone_circles_v1(team TEXT,id TEXT,name TEXT,subtitle TEXT,revision INTEGER DEFAULT 1,deleted INTEGER DEFAULT 0,created INTEGER,PRIMARY KEY(team,id));
    CREATE TABLE v62_ai_images(id TEXT PRIMARY KEY,member TEXT,prompt TEXT,created INTEGER,mime TEXT,parts INTEGER);
    CREATE TABLE v62_ai_image_parts(id TEXT,part INTEGER,body TEXT,PRIMARY KEY(id,part))`);
  source.prepare("INSERT INTO phone_circles_v1 VALUES('garden-1',?,'旧园历史频道','历史频道',1,0,1)").run(channel);
  source.prepare("INSERT INTO v62_ai_images VALUES(?,'1','旧照片',0,'image/jpeg',1)").run(imageId);
  source.prepare('INSERT INTO v62_ai_image_parts VALUES(?,0,?)').run(imageId, jpeg);
  source.close();
  const digest = async () => createHash('sha256').update(await readFile(sourceFile)).digest('hex');
  const before = await digest();
  await importLegacyDatabase({ dataDir, sourceFile });
  await assert.rejects(importLegacyDatabase({ dataDir, sourceFile }), { code: 'EEXIST' });
  const domains = createDomains({ dataDir, legacyDir });
  t.after(async () => { await domains.close(); await rm(dataDir, { recursive: true }); });
  const owner = member('legacy',1);
  let state = await json(api(domains, owner, '/api/camp'));
  assert.equal(state.members[0].name, '旧昵称');
  assert.equal(state.goal.target, '2027-01-01');
  state = await json(api(domains, member('legacy',17), '/api/camp'));
  assert.equal(state.members.find(m => m.id==='17').avatar, 0);
  assert.deepEqual((await json(api(domains, owner, '/api/phone/circles'))).circles.map(c=>c.id), ['main',channel]);
  const room = '/api/phone/circles?room='+channel;
  await json(api(domains, owner, '/api/phone/circles', { action:'update', id:channel, revision:1, name:'原园的历史频道', subtitle:'旧园成员共享' }));
  await json(api(domains, owner, room, { action: 'send', clientId:imageId, body:'频道照片', picture:jpeg, replyTo:'' }));
  const [message] = (await json(api(domains, member('legacy',17), room))).notes;
  assert.equal(message.body,'频道照片');
  await photo(api(domains, member('legacy',17), room+'&image='+message.id), jpeg);
  await photo(api(domains, owner, '/api/phone?v62=image&id='+imageId), jpeg);
  await json(api(domains, member('legacy',17), '/api/phone?v62=image&id='+imageId),404);
  assert.deepEqual((await json(api(domains, member('new',1), '/api/phone/circles'))).circles.map(c=>c.id), ['main']);
  assert.equal(await digest(), before);
});
