import { registerHooks } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const bundled = join(dirname(fileURLToPath(import.meta.url)), '../legacy');
const factories = new Map();
async function loadFactory(legacyDir) {
  const url = pathToFileURL(join(resolve(legacyDir),'chunk-ZIGCNLDY.mjs')).href + '?client-factory';
  // Retain the original bundled libSQL implementation and its file: base for
  // createRequire. Skip application startup, which creates the legacy tables.
  const hook = registerHooks({ load(id, context, next) {
    const loaded = next(id,context);
    if (id !== url) return loaded;
    const parts = Buffer.from(loaded.source).toString('utf8').split('// standalone/turso.mjs');
    if (parts.length !== 2 || !parts[0].includes('function createClient(config)')) throw Error('Unrecognized bundled libSQL client');
    return {...loaded,source:parts[0]+'\nexport {createClient};'};
  } });
  try { return (await import(url)).createClient; } finally { hook.deregister(); }
}
export async function createTursoClient({url,authToken,legacyDir=bundled,fetch}) {
  const endpoint = new URL(url);
  if (!['libsql:','https:','http:'].includes(endpoint.protocol) ||
      (endpoint.protocol==='http:' && !['127.0.0.1','[::1]'].includes(endpoint.hostname)) ||
      endpoint.username || endpoint.password || endpoint.hash || endpoint.search || !authToken) throw Error('Invalid Turso endpoint configuration');
  const root=resolve(legacyDir);
  if(!factories.has(root)) factories.set(root,loadFactory(root).catch(e=>{factories.delete(root);throw e;}));
  const create = await factories.get(root);
  return create({url,authToken,fetch});
}
