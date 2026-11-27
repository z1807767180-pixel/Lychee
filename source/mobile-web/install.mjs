import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// These are the public 6.4.7 server modules whose original behavior is extended in 7.0.
const previous = {
  'turso-accounts.mjs':'cce8434d2aff2a9094e81a0dfbfab413628793be2dc2a51a206ee11cabc14ba6',
  'accounts.mjs':'36ff0baf12e2ef58a04e64ba4c4038459b3ea624f21950e95df2038db0d0d014',
  'notices.mjs':'8384d0e4170c9f01605a0ba0886c4d952d23eff801bdae029762370a9c2ae6fe',
  'index.mjs':'54655bda28347c51c3c896a9b14658d58ffdf47e84ab5f1011fd63f58233c182',
  'domains.mjs':'f7b0fd83695861270aa1d2ffc22527789a0064c0356be4a1e43d627f8e07c284',
  'ai-quota.mjs':'ea64213e2f3a334b65c8a7c24ccec4ce9361b07222ff25f837b1f505234cf0ec',
};
const additions = ['circle-puzzles.json','soup-categories.mjs','diet-store.mjs','diet-vision.mjs','diet-vision-result.mjs',
  'notification-source.mjs','notify-push.mjs','notify-push-transport.mjs'];
const digest = data => createHash('sha256').update(data.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
const oldRoutes = "url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/g/')";
const newRoutes = "url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/api/v7/')||url.pathname.startsWith('/g/')";

export async function installService(folder) {
  const server = join(folder,'server.mjs');
  const entry = await readFile(server,'utf8');
  const oldCount = entry.split(oldRoutes).length-1, newCount = entry.split(newRoutes).length-1;
  if (oldCount+newCount!==1 || !entry.includes('lychee-v640/server/coexist.mjs')) {
    throw Error('Mobile 7.0: unrecognized service router. Keep the prior release.');
  }
  const changes = [];
  for (const name of [...Object.keys(previous),...additions]) {
    const file = join(folder,'lychee-v640','server',name);
    const next = await readFile(new URL('./server-v7/'+name,import.meta.url));
    const current = await readFile(file).catch(error=>{
      if(error.code==='ENOENT')return null;
      throw error;
    });
    if(current && digest(current)===digest(next))continue;
    if(previous[name] ? !current || digest(current)!==previous[name] : current!==null) {
      throw Error('Mobile 7.0: unrecognized existing module '+name+'; keep the prior release.');
    }
    changes.push({file,next});
  }
  // This folder is freshly extracted by the original bootstrap; the server is not yet listening.
  for (const {file,next} of changes) await writeFile(file,next);
  if(oldCount===1)await writeFile(server,entry.replace(oldRoutes,newRoutes));
}

export async function install(webRoot) {
  const mobile = new URL('./www/mobile/', import.meta.url);
  const version = (await readFile(new URL('version.txt', mobile), 'utf8')).trim();
  const entry = await readFile(new URL('index.html', mobile), 'utf8');
  if (!/^\d+\.\d+\.\d+$/.test(version) || !entry.includes(`data-client-build="${version}"`) ||
      !entry.includes(`/mobile/assets-${version}/launch/start.js`)) {
    throw new Error('Mobile launch page differs from its release version');
  }
  const target = join(webRoot, 'mobile');
  await mkdir(target, { recursive: true });
  const manifest = new URL('app.webmanifest', mobile);
  // Keep the installed home screen app's original identity across upgrades.
  try {
    await copyFile(manifest, join(target, 'app.webmanifest'), constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  await cp(mobile, target, { recursive: true, filter: source => !source.endsWith('app.webmanifest') });
}
