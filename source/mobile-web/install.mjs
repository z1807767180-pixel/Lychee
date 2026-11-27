import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { copyFile, cp, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
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
  'notification-source.mjs','notify-push.mjs','notify-push-transport.mjs','quiz-game.mjs','quiz-rounds.mjs','quiz-bank.json',
  'social.mjs','social-store.mjs','social-history.mjs','social-play.mjs'];
const digest = data => createHash('sha256').update(data.toString('utf8').replace(/\r\n/g,'\n')).digest('hex');
const oldRoutes = "url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/g/')";
const v7Routes = "url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/api/v7/')||url.pathname.startsWith('/g/')";
const newRoutes = "url.pathname.startsWith('/api/v640/')||url.pathname.startsWith('/api/v7/')||url.pathname==='/api/v8/social'||url.pathname.startsWith('/g/')";

export async function installService(folder) {
  const server = join(folder,'server.mjs');
  const entry = await readFile(server,'utf8');
  const matches = [oldRoutes,v7Routes,newRoutes].filter(routes => entry.includes(routes));
  if (matches.length!==1 || entry.split(matches[0]).length!==2 || !entry.includes('lychee-v640/server/coexist.mjs')) {
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
  if(matches[0]!==newRoutes)await writeFile(server,entry.replace(matches[0],newRoutes));
}

async function installAndroidUpdates(webRoot) {
  const source = new URL('./www/android-update/', import.meta.url);
  const manifest = await readFile(new URL('current.json', source));
  const {version, sha256} = JSON.parse(manifest);
  if (!/^(?:0|[1-9][0-9]?)(?:\.(?:0|[1-9][0-9]?)){2}$/.test(version)) {
    throw Error('Invalid Android friends release version');
  }
  const tag = 'android-friends-v'+version;
  const name = 'Lychee-Friends-V'+version+'.apk';
  const packageUrl = new URL(tag+'/'+name, source);
  const {size} = await stat(packageUrl);
  if (size < 1 || size > 128*1024*1024) throw Error('Invalid Android friends APK size');
  const apk = await readFile(packageUrl);
  if (createHash('sha256').update(apk).digest('hex') !== sha256) {
    throw Error('Prepared Android friends APK does not match its release manifest');
  }
  const page = await readFile(new URL('download.html', source));
  const target = join(webRoot, 'android-update');
  await mkdir(target);
  await mkdir(join(target,tag));
  await writeFile(join(target,tag,name),apk);
  if (Number(version.split('.')[0])>=8) await writeFile(join(target,tag,'Lychee-Friends-A'+version+'.apk'),apk);
  const archives = [
    ['8.0.0','3a0b9149e8bf60b8e51acaa6b5274b9feb2d787100fcbb95e23240cb69abaf42'],
    ['8.0.1','a79805c9cf23ec4e9a485aa55e830cd119f966270cc74f52a4539913396e278c'],
  ];
  const versionCode = v => v.split('.').reduce((total,n) => total*100 + Number(n),0);
  for (const [oldVersion, expected] of archives) {
    if (versionCode(version) <= versionCode(oldVersion)) continue;
    const oldTag = 'android-friends-v'+oldVersion;
    const old = new URL(oldTag+'/Lychee-Friends-V'+oldVersion+'.apk',source);
    if ((await stat(old)).size !== 3007817) throw Error('Invalid archived APK size: '+oldVersion);
    const archive = await readFile(old);
    if (createHash('sha256').update(archive).digest('hex') !== expected) throw Error('Archived APK differs: '+oldVersion);
    const oldFolder = join(target,oldTag);
    await mkdir(oldFolder);
    for (const prefix of ['A','V']) await writeFile(join(oldFolder,'Lychee-Friends-'+prefix+oldVersion+'.apk'),archive);
  }
  await writeFile(join(target,'download.html'),page);
  await writeFile(join(target,'current.json'),manifest);
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
  if (process.env.RENDER === 'true') {
    await cp(new URL('./www/windows-update/', import.meta.url), join(webRoot, 'windows-update'), {
      recursive: true, errorOnExist: true, force: false,
    });
    await installAndroidUpdates(webRoot);
  }
}
