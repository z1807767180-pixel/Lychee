import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { link, unlink } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';
import { bindLoopbackTestProvider, providerWorkerEnv } from './provider-config.mjs';
import { openAiQuota, operationFor, providerEndpoints, quotaImageId } from './ai-quota.mjs';
import { gardenImages, imageProviderPayload } from './image-result.mjs';

const routes = new Map([
  ['/api/camp', 'camp.mjs'],
  ['/api/phone', 'phone.mjs'],
  ['/api/phone/circles', 'circle-route.mjs'],
]);
const jsonError = (status, error) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
const gardenFile = (dataDir, gardenId) => join(resolve(dataDir), 'gardens', gardenId + '.sqlite');

// SQLite backup takes a consistent snapshot, including committed WAL pages.
// Publish a complete snapshot atomically without overwriting an existing garden.
export async function importLegacyDatabase({ dataDir, sourceFile }) {
  const target = gardenFile(dataDir, 'legacy');
  mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
  const staging = target + '.' + randomUUID() + '.tmp';
  const source = new DatabaseSync(sourceFile, { readOnly: true });
  try {
    source.prepare('SELECT slot,username,salt,verifier FROM camp_accounts LIMIT 0').all();
    await backup(source, staging);
    await link(staging, target);
    return target;
  } finally {
    source.close();
    await unlink(staging).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

function sqliteDriver(sqlite) {
  function execute({ sql, args }) {
    const statement = sqlite.prepare(sql);
    const columns = statement.columns();
    if (!columns.length) return { rows: [], rowsAffected: statement.run(...args).changes };
    statement.setReturnArrays(true);
    const rows = statement.all(...args).map(values => {
      const row = Object.create(null);
      Object.defineProperty(row, 'length', { value: values.length });
      for (const [index, value] of values.entries()) {
        Object.defineProperty(row, index, { value });
        const { name } = columns[index];
        if (!Object.hasOwn(row, name)) Object.defineProperty(row, name, { value, enumerable: true, writable: true, configurable: true });
      }
      return row;
    });
    return { rows, rowsAffected: 0 };
  }
  return {
    execute,
    batch(queries) {
      sqlite.exec('BEGIN');
      try {
        const result = queries.map(execute);
        sqlite.exec('COMMIT');
        return result;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}

// Require exactly the expected original fragment. A changed upstream release
// must be reviewed before it can use this compatibility layer.
function replaceOnce(source, original, updated) {
  const at = source.indexOf(original);
  if (at < 0 || source.indexOf(original, at + original.length) >= 0) throw Error('Incompatible legacy module');
  return source.slice(0, at) + updated + source.slice(at + original.length);
}

function gardenSource(name, source, originalProfiles) {
  source = source.replaceAll('\r\n', '\n');
  if(name==='v62.mjs'){
    // Account-wide reservations are taken at the provider boundary in dispatch.
    const start=source.indexOf('async function quota(db,me,kind){');
    if(start<0)throw Error('Missing original AI quota');
    const end=source.indexOf('\n',start);
    source=replaceOnce(source,source.slice(start,end),'async function quota(){return true}');
    source=replaceOnce(source,"await call('https://ark.cn-beijing.volces.com", "await globalThis.gardenImagePayload('https://ark.cn-beijing.volces.com");
    const first=source.indexOf("const mime='image/jpeg';const encoded=buf.toString('base64'),iid=crypto.randomUUID()");
    const last=source.indexOf("console.info('lychee-ai-image-ok')",first);
    if(first<0||last<first)throw Error('Incompatible original image publication');
    return replaceOnce(source,source.slice(first,last),'const iid=await globalThis.gardenSaveImage(me,prompt,now,buf);');
  }
  if (name === 'camp.mjs') {
    source = replaceOnce(source, 'chat\\.[1-3]\\.', 'chat\\.[1-9]\\d*\\.');
    source = replaceOnce(source, 'avatar > 3)', 'avatar > 15)');
    source = replaceOnce(source, 'SELECT ?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM ${table} WHERE avatar=? AND id<>?)', 'VALUES(?,?,?,?,?,?)');
    source = replaceOnce(source, 'day(), avatar, id).run()', 'day()).run()');
    source = replaceOnce(source, 'recipients.length > 2 || recipients.some((r) => typeof r !== "string" || !["1", "2", "3"].includes(r) || r === id)',
      'recipients.some((r) => typeof r !== "string" || r === id || !globalThis.gardenHasProfile(r))');
    source = replaceOnce(source, 'FROM camp_accounts a\n', 'FROM (SELECT CAST(id AS INTEGER) AS slot,name AS username FROM camp_profiles) a\n');
    source = replaceOnce(source, 'function emptyMatch() {', 'function emptyMatch(day) {\n  const active = globalThis.gardenMatchPlayers(day);');
    source = replaceOnce(source, 'active: ["1", "2", "3"], scores: { "1": 0, "2": 0, "3": 0 }',
      'active, scores: Object.fromEntries(active.map(id => [id, 0]))');
    source = replaceOnce(source, 'JSON.parse(r.todayGame) : emptyMatch()', 'JSON.parse(r.todayGame) : emptyMatch(day2)');
    source = replaceOnce(source, 'JSON.parse(row.game) : emptyMatch()', 'JSON.parse(row.game) : emptyMatch(day2)');
    source = replaceOnce(source, 'if (game.winner || game.round !== round',
      'if (!game.active.length) return fail("这场三人猜拳需要三位园成员");\n    if (game.winner || game.round !== round');
    return source;
  }
  source = replaceOnce(source, 'var DB = connect();', 'var DB = makeStore(globalThis.gardenSqlite);');
  if (!originalProfiles) source = replaceOnce(source, 'avatar INTEGER UNIQUE NOT NULL', 'avatar INTEGER NOT NULL');
  const start = 'async function identity(req) {';
  const identity = source.slice(source.indexOf(start), source.indexOf('\nvar sameOrigin =', source.indexOf(start)));
  if (!identity.includes('FROM camp_sessions')) throw Error('Unrecognized legacy identity');
  return replaceOnce(source, identity, 'async function identity(req) { return globalThis.gardenIdentity(req); }');
}

function upgradeProfiles(sqlite) {
  // Imported V6.3.3 files still carry the old UNIQUE(avatar) constraint.
  const indexes = sqlite.prepare("PRAGMA index_list('camp_profiles')").all();
  const uniqueAvatar = indexes.some(index => index.unique &&
    sqlite.prepare('SELECT name FROM pragma_index_info(?)').all(index.name).some(column => column.name === 'avatar'));
  if (!uniqueAvatar) return;
  sqlite.exec(`BEGIN IMMEDIATE;
    CREATE TABLE garden_profile_upgrade(id TEXT PRIMARY KEY,name TEXT NOT NULL,avatar INTEGER NOT NULL,
      mood TEXT NOT NULL,action TEXT NOT NULL,day TEXT NOT NULL);
    INSERT INTO garden_profile_upgrade SELECT id,name,avatar,mood,action,day FROM camp_profiles ORDER BY rowid;
    DROP TABLE camp_profiles;
    ALTER TABLE garden_profile_upgrade RENAME TO camp_profiles;
    COMMIT`);
}

function localGarden(file) {
  const sqlite = new DatabaseSync(file);
  sqlite.exec('PRAGMA busy_timeout=5000');
  return {
    driver: sqliteDriver(sqlite),
    close: () => sqlite.close(),
    afterSchema() {
      upgradeProfiles(sqlite);
      sqlite.exec('CREATE TABLE IF NOT EXISTS garden_member_bindings (slot INTEGER PRIMARY KEY, account TEXT UNIQUE NOT NULL)');
      const binding = sqlite.prepare('SELECT account FROM garden_member_bindings WHERE slot=?');
      const bind = sqlite.prepare('INSERT INTO garden_member_bindings VALUES(?,?)');
      const profile = sqlite.prepare("INSERT INTO camp_profiles VALUES(?,?,?,'','休息','') ON CONFLICT(id) DO NOTHING");
      return data => {
        const { slot, accountId, username } = data.member;
        const owner = binding.get(slot);
        if (owner && owner.account !== accountId) return false;
        if (!owner) {
          sqlite.exec('BEGIN IMMEDIATE');
          try {
            bind.run(slot, accountId);
            profile.run(String(slot), username.slice(0, 14), (slot - 1) % 16);
            sqlite.exec('COMMIT');
          } catch (error) {
            sqlite.exec('ROLLBACK');
            throw error;
          }
        }
        return sqlite.prepare('SELECT id FROM camp_profiles ORDER BY CAST(id AS INTEGER)').all().map(row => row.id);
      };
    },
  };
}

async function serveGarden({ file, quotaFile, turso, legacyDir, gardenId, testProviderOrigin }) {
  if (testProviderOrigin !== undefined) bindLoopbackTestProvider(testProviderOrigin, turso);
  let quota,meter;
  const providerFetch=globalThis.fetch;
  globalThis.fetch=(input,options)=>{
    const url=typeof input==='string'?input:input instanceof URL?input.href:input?.url;
    if(!providerEndpoints.has(url))return providerFetch(input,options);
    if(!meter)throw Error('AI request has no verified account context');
    return meter(url,options,providerFetch);
  };
  const readQuota=async()=>quota??=await openAiQuota({quotaFile,turso,legacyDir});
  const backend = turso ? await (await import('./turso-domains.mjs')).openTursoGarden({ ...turso, legacyDir, gardenId }) : localGarden(file);
  const images=gardenImages(backend.driver);
  let imageId;
  globalThis.gardenImagePayload=imageProviderPayload;
  globalThis.gardenSaveImage=(member,prompt,now,bytes)=>{
    if(!imageId)throw Error('Missing image receipt');
    return images.save(imageId,member,prompt,now,bytes);
  };
  const bindings = new WeakMap();
  let ids = [];
  globalThis.gardenSqlite = backend.driver;
  globalThis.gardenIdentity = request => bindings.get(request);
  globalThis.gardenHasProfile = id => ids.includes(id);
  globalThis.gardenMatchPlayers = day => {
    if (ids.length <= 3) return ids.length === 3 ? ids : [];
    const offset = Math.floor(Date.parse(day) / 86400000) % ids.length;
    return [0, 1, 2].map(index => ids[(offset + index) % ids.length]);
  };
  const urlFor = name => pathToFileURL(join(legacyDir, name)).href;
  const adapted = new Map(['phone.mjs', 'camp.mjs', 'v62.mjs', 'chunk-ZIGCNLDY.mjs'].map(name => [urlFor(name), name]));
  registerHooks({ load(url, context, nextLoad) {
    const loaded = nextLoad(url, context);
    const name = adapted.get(url);
    return name ? { ...loaded, source: gardenSource(name, Buffer.from(loaded.source).toString('utf8'), turso && gardenId === 'legacy') } : loaded;
  } });
  const common = await import(urlFor('chunk-ZIGCNLDY.mjs'));
  await common.schema();
  const enter = await backend.afterSchema();
  const handlers = new Map();
  for (const [route, name] of routes) handlers.set(route, await import(urlFor(name)));

  async function dispatch(data) {
    const roster = await enter(data);
    if (!roster) return jsonError(403, '成员编号与账号不匹配');
    ids = roster;
    const { slot } = data.member;
    const url = new URL(data.url);
    const request = new Request(url, { method: data.method, headers: data.headers, body: data.body });
    bindings.set(request, String(slot));
    if (url.pathname === '/api/phone/circles') {
      if (gardenId !== 'legacy' && (data.method !== 'GET' || url.searchParams.has('room'))) {
        return jsonError(403, '此园使用小队主频道。请通过我的圈子创建或加入私密园。');
      }
      if (data.method === 'POST' && !url.searchParams.has('room') &&
          (await request.clone().json().catch(() => null))?.action === 'create') {
        return jsonError(403, '历史频道由原园成员共享。请通过我的圈子管理私密园。');
      }
    }
    const original=()=>handlers.get(url.pathname)[data.method](request);
    const getImageInGarden=(id,options)=>images.lookup(id,String(slot),options);
    if(data.method==='GET'&&url.pathname==='/api/phone'&&url.searchParams.get('v62')==='image-status'){
      const state=await (await readQuota()).imageStatus(data.member.accountId,gardenId,url.searchParams.get('requestId'),getImageInGarden);
      return Response.json(state);
    }
    if(data.method==='POST'&&['/api/camp','/api/phone'].includes(url.pathname)){
      const body=await request.clone().json().catch(()=>null);
      const op=operationFor(url.pathname,body,gardenId);
      if(op)return (await readQuota()).run(data.member.accountId,op,async active=>{
        meter=active;
        imageId=op.kind==='image'?quotaImageId(data.member.accountId,op):null;
        try{return await original();}finally{meter=null;imageId=null;}
      },{getImageInGarden});
    }
    const response=await original();
    const phoneStatus=url.pathname==='/api/phone'&&url.searchParams.get('v62')==='status';
    const soupStatus=url.pathname==='/api/camp'&&url.searchParams.get('soup')==='1';
    if(data.method==='GET'&&response.ok&&(phoneStatus||soupStatus)){
      const result=await response.json();
      const status=await (await readQuota()).status(data.member.accountId,{gardenId,getImageInGarden});
      return Response.json(phoneStatus?{...result,...status}:{...result,aiQuota:status},{status:response.status,headers:response.headers});
    }
    return response;
  }
  let tail = Promise.resolve();
  parentPort.on('message', data => {
    tail = tail.then(async () => {
      if (data.close) { if(quota)await quota.close();await backend.close(); parentPort.close(); return; }
      try {
        const response = await dispatch(data);
        const bytes = await response.arrayBuffer();
        parentPort.postMessage({ id: data.id, status: response.status, headers: [...response.headers], bytes }, [bytes]);
      } catch {
        parentPort.postMessage({ id: data.id, failed: true });
      }
    });
  });
}

function gardenWorker(config, remove) {
  const env = providerWorkerEnv(process.env, config.testProviderOrigin, config.gardenId);
  const worker = new Worker(new URL(import.meta.url), {
    workerData: { ...config, role: 'garden' }, env, execArgv: [],
  });
  const pending = new Map();
  let idle, serial = 0;
  const closed = new Promise(done => worker.once('exit', done));
  function close() {
    clearTimeout(idle);
    remove();
    worker.postMessage({ close: true });
    return closed;
  }
  function fail() {
    clearTimeout(idle);
    remove();
    for (const { reject } of pending.values()) reject(Error('Garden worker unavailable'));
    pending.clear();
  }
  worker.on('error', fail);
  worker.on('exit', fail);
  worker.on('message', ({ id, status, headers, bytes, failed }) => {
    const waiter = pending.get(id);
    if (!waiter) return;
    pending.delete(id);
    if (failed) waiter.reject(Error('Garden operation failed'));
    else waiter.resolve(new Response(bytes, { status, headers }));
    if (!pending.size) { idle = setTimeout(close, 60_000); idle.unref(); }
  });
  return {
    close,
    send(data) {
      clearTimeout(idle);
      const id = ++serial;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        worker.postMessage({ ...data, id });
      });
    },
  };
}

export function createDomains({ dataDir, legacyDir, testProviderOrigin }) {
  mkdirSync(dirname(gardenFile(dataDir, 'legacy')), { recursive: true, mode: 0o700 });
  return createDomainPool({legacyDir, testProviderOrigin, storage: gardenId => ({file:gardenFile(dataDir,gardenId),quotaFile:join(resolve(dataDir),'accounts.sqlite')})});
}

export function createDomainPool({legacyDir, testProviderOrigin, storage}) {
  const workers = new Map();
  const root = resolve(legacyDir);
  let closing = false;
  return {
    async handle(request, member) {
      const url = new URL(request.url);
      if (!routes.has(url.pathname)) return jsonError(404, '接口不存在');
      if (!['GET', 'POST'].includes(request.method)) return jsonError(405, '不支持此操作');
      if (request.method === 'POST' && request.headers.get('origin') !== url.origin) return jsonError(403, '请从本园操作');
      const { gardenId, accountId, username } = member ?? {};
      const slot = Number(member?.slot);
      if (typeof gardenId !== 'string' || !/^[a-z0-9][a-z0-9_-]{0,99}$/.test(gardenId) ||
          /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/.test(gardenId) ||
          !Number.isSafeInteger(slot) || slot < 1 || !accountId || typeof username !== 'string' || !username.trim()) {
        return jsonError(403, '请先加入这个园');
      }
      const body = request.method === 'POST' ? await request.arrayBuffer() : undefined;
      if (body?.byteLength > 400000) return jsonError(413, '请求太大');
      if (closing) return jsonError(503, '服务正在关闭');
      let worker = workers.get(gardenId);
      if (!worker) {
        worker = gardenWorker({ ...storage(gardenId), legacyDir: root, gardenId, testProviderOrigin }, () => {
          if (workers.get(gardenId) === worker) workers.delete(gardenId);
        });
        workers.set(gardenId, worker);
      }
      const headers = { 'content-type': 'application/json' };
      if (request.method === 'POST') headers.origin = url.origin;
      const response = await worker.send({ url: url.href, method: request.method, body, headers,
        member: { slot, accountId: String(accountId), username } });
      response.headers.set('Cache-Control', 'private, no-store');
      return response;
    },
    async close() {
      closing = true;
      await Promise.all([...workers.values()].map(worker => worker.close()));
    },
  };
}

if (!isMainThread && workerData?.role === 'garden') void serveGarden(workerData);
