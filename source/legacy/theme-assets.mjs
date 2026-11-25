import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

// Each group names an immutable, previously staged archive and its public artwork.
const groups = JSON.parse(await readFile(new URL('./theme-assets.json', import.meta.url), 'utf8'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function loadArchive(hash) {
  const endpoint = new URL('/v2/pipeline', process.env.TURSO_DATABASE_URL.replace(/^libsql:/, 'https:'));
  const stmt = { sql: 'SELECT content FROM lychee_static_assets WHERE digest=?', args: [{ type: 'text', value: hash }] };
  const response = await fetch(endpoint, {
    method: 'POST', signal: AbortSignal.timeout(25000),
    headers: { Authorization: 'Bearer ' + process.env.TURSO_AUTH_TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ type: 'execute', stmt }, { type: 'close' }] })
  });
  if (!response.ok) throw Error('Theme archive unavailable, HTTP ' + response.status);
  const result = (await response.json()).results[0];
  const blob = result.response?.result?.rows?.[0]?.[0]?.base64;
  if (!blob) throw Error('Theme archive missing: ' + hash);
  const bytes = Buffer.from(blob, 'base64');
  if (digest(bytes) !== hash) throw Error('Invalid theme archive: ' + hash);
  return JSON.parse(gunzipSync(bytes));
}

for (const { archive, files } of groups) {
  let contents;
  for (const [name, expected] of Object.entries(files)) {
    if (!/^[a-z\d-]+\.(jpg|webp|svg)$/.test(name)) throw Error('Invalid theme asset name');
    const path = 'web/mobile/' + name;
    const url = new URL(path, import.meta.url);
    const local = await readFile(url).catch(error => {
      if (error.code !== 'ENOENT') throw error;
    });
    if (local && digest(local) === expected) continue;
    contents ??= await loadArchive(archive);
    const image = Buffer.from(contents[path], 'base64');
    if (digest(image) !== expected) throw Error('Invalid theme asset: ' + name);
    await writeFile(url, image);
  }
}
