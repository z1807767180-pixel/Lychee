// Windows: node source/test/windows-update-e2e.mjs <old QA build> <new QA build> <shared QA UUID>
import assert from 'node:assert/strict';
import {execFile, spawn} from 'node:child_process';
import {createHash, randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {copyFile, mkdir, mkdtemp, open, readFile, unlink, writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {setTimeout as sleep} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {createApp} from '../server/index.mjs';
import {Browser} from './edge.mjs';

const [baseDir, nextDir, instance, variant] = process.argv.slice(2);
const control = variant === '--restart-control';
const checksOnly = variant === '--check-only';
const officialOnly = variant === '--official-only' || variant === '--mirror-only';
assert.ok(!variant || control || checksOnly || officialOnly, 'Unknown test mode');
if (process.platform !== 'win32' || !baseDir || !nextDir || !instance) throw Error('Pass two Windows QA build paths and their QA UUID.');
const python = process.env.LYCHEE_QA_PYTHON || 'python';
const scriptPath = file => fileURLToPath(new URL(file, import.meta.url));
const run = promisify(execFile);
const command = (exe, args) => run(exe, args, {windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024});
const msiInfo = async (mode, ...args) => JSON.parse((await command(python, ['-I', scriptPath('windows-update-msi.py'), mode, ...args])).stdout);
const base = resolve(baseDir), next = resolve(nextDir);
const oldMsi = join(base, 'Lychee.msi'), newMsi = join(next, 'Lychee.msi');
const oldInfo = await msiInfo('inspect', oldMsi, instance), nextInfo = await msiInfo('inspect', newMsi, instance);
assert.equal(oldInfo.upgrade, nextInfo.upgrade);
if (!checksOnly) {
  assert.ok(oldInfo.version.localeCompare(nextInfo.version, 'en', {numeric:true}) < 0, 'Expected a newer QA release');
  assert.notEqual(oldInfo.product,nextInfo.product);
}
const root = await mkdtemp(join(tmpdir(), 'lychee-update-e2e-'));
const report = {root, instance, mode:checksOnly?'settings check':control?'ordinary restart':officialOnly?'official-only in-app update':'in-app update', from: oldInfo.version, to: nextInfo.version, scenarios: {}};
report.currentUserDpapi = await msiInfo('dpapi');
const digest = value => createHash('sha256').update(value).digest('hex');
const hashFile = async file => digest(await readFile(file));
const oldExe = join(base, 'Lychee.exe'), newExe = join(next, 'Lychee.exe');
const oldHash = await hashFile(oldExe), newHash = await hashFile(newExe);
if (!checksOnly) assert.notEqual(oldHash, newHash);
const assetData = {}, assets = [];
for (const kind of ['exe', 'msi']) {
  const name = 'Lychee.' + kind, bytes = await readFile(join(next, name));
  assetData[name] = bytes;
  assets.push({kind, name, length: bytes.length, sha256: digest(bytes)});
}
const installedDir = join(root, 'installed'), installedExe = join(installedDir, 'Lychee.exe');
const portableDir = join(root, 'portable'), portableExe = join(portableDir, 'Lychee QA 副本.exe');
const decoy = join(root, 'Lychee.exe');
await mkdir(portableDir); await copyFile(oldExe, portableExe); await copyFile(oldExe, decoy);

const deadline = async (fn, label, ms = 35000) => {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try {const value = await fn(); if (value) return value;} catch (e) {last = e.message;}
    await sleep(150);
  }
  throw Error(label + ' timeout' + (last ? ' (' + last + ')' : ''));
};
const manifestPath='/windows-update/stable.json';
async function localServer(kind) {
  const app = await createApp({dataDir: join(root, 'server-' + kind), webRoot: join(base, 'site')});
  const fixture = {mode: 'current', requests: []};
  const http = createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/windows-update/')) {
        fixture.requests.push({path: req.url, mode: fixture.mode});
        if (req.url===manifestPath) {
          if (fixture.mode==='unpublished') {res.writeHead(404).end();return;}
          if (fixture.mode==='offline') {res.writeHead(503).end();return;}
          if (fixture.mode==='redirect') {res.writeHead(302,{Location:'/forbidden-update-hop'}).end();return;}
          const version=fixture.mode==='current'?oldInfo.version:checksOnly?'250.0.1':nextInfo.version;
          const entries = assets.map(a => fixture.mode === 'bad' ? {...a, sha256: '0'.repeat(64)} : a);
          res.writeHead(200, {'content-type':'application/json', 'cache-control':'no-store'});
          res.end(JSON.stringify({schema: 1, version, assets: entries, qaInstance:instance})); return;
        }
        const name = req.url.split('/').pop();
        const body = assetData[name];
        const assetPath='/windows-update/'+'windows-v'+nextInfo.version+'/'+name;
        if (body && req.url === assetPath) {
          res.writeHead(200, {'content-type':'application/octet-stream', 'content-length':body.length});
          res.end(body); return;
        }
        res.writeHead(404).end(); return;
      }
      const chunks = [];
      for await (const part of req) chunks.push(part);
      const response = await app.handle(new Request(fixture.origin + req.url,
        {method: req.method, headers: req.headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined}));
      const headers = Object.fromEntries(response.headers), cookies = response.headers.getSetCookie();
      if (cookies.length) headers['set-cookie'] = cookies;
      res.writeHead(response.status, headers).end(Buffer.from(await response.arrayBuffer()));
    } catch {res.writeHead(500).end();}
  });
  http.listen(0, '127.0.0.1'); await once(http, 'listening');
  fixture.origin = 'http://127.0.0.1:' + http.address().port;
  fixture.close = async () => {http.closeAllConnections(); await new Promise(r => http.close(r)); await app.close();};
  return fixture;
}

async function freePort() {
  const probe = createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
  const port = probe.address().port; await new Promise(r => probe.close(r)); return port;
}
async function connect(port, origin, oldTarget) {
  const page = await deadline(async () => {
    const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
    return list.find(p => p.type === 'page' && p.id !== oldTarget && p.url.startsWith(origin + '/windows/'));
  }, 'actual WPF WebView', 80000);
  const browser = new Browser(), socket = browser.socket = new WebSocket(page.webSocketDebuggerUrl);
  await once(socket, 'open');
  socket.onmessage = ({data}) => {
    const msg = JSON.parse(data), action = browser.pending.get(msg.id);
    if (action) {browser.pending.delete(msg.id); clearTimeout(action.timer);
      if (msg.error) action.fail(Error(msg.error.message)); else action.resolve(msg.result);}
  };
  await browser.call('Runtime.enable');
  return {id: page.id, browser};
}
const atPage = (browser, fn, ...args) => browser.js('(' + fn.toString() + ')(' + args.map(JSON.stringify).join(',') + ')');
async function click(browser, label, selector = 'button') {
  await deadline(() => atPage(browser, (selector, label) => {
    const button = [...document.querySelectorAll(selector)].find(b => b.offsetWidth && !b.disabled && (b.innerText.trim()===label||b.getAttribute('aria-label')===label));
    if (!button) return false; button.click(); return true;
  }, selector, label), 'click ' + label);
}
async function settings(browser) {
  const route=await deadline(()=>browser.js("document.querySelector('.s8-nav [aria-label=我]')?.offsetWidth?'social':document.querySelector('.windows-nav [data-page=settings]')?.offsetWidth?'garden':null"),'settings navigation');
  if(route==='social'){
    await click(browser,'我');await click(browser,'设置');
  }else await browser.js("document.querySelector('.windows-nav [data-page=settings]').click();true");
}
async function cookieMetadata(browser) {
  const {cookies} = await browser.call('Network.getCookies');
  const account = cookies.find(c => c.name === '__Host-lychee-account');
  return {present:!!account, persistent:!!account && !account.session,
    lifetimeDays:account ? Math.round((account.expires - Date.now()/1000)/86400) : null,
    httpOnly:!!account?.httpOnly, secure:!!account?.secure};
}
function startHost(exe, origin, port, tmp) {
  const host = spawn(python, ['-u', scriptPath('resize-hwnd.py'), exe, origin, String(port)],
    {env: {...process.env, TEMP: tmp, TMP: tmp}, windowsHide:true, stdio:['pipe','pipe','pipe']});
  let stderr = '';
  host.stderr.on('data', c => stderr = (stderr + c).slice(-1200));
  return {host, exited:once(host, 'exit'), async started() {
    const first = await createInterface({input:host.stdout})[Symbol.asyncIterator]().next();
    if (first.done) throw Error('WPF launcher failed: ' + stderr);
    const desktop = JSON.parse(first.value); assert.ok(desktop.started && desktop.privateDesktop !== desktop.inputDesktop);
  }};
}
async function stopOwnedShell(exe) {
  assert.ok([portableExe,installedExe].includes(exe) && resolve(exe).startsWith(root + '\\'));
  const script = "$p=Get-Process -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $env:LYCHEE_OWNED_QA_EXE}; foreach($t in $p){if($t.CloseMainWindow()){$null=$t.WaitForExit(2000)}; if(!$t.HasExited -and $t.Path -eq $env:LYCHEE_OWNED_QA_EXE){$t.Kill();$null=$t.WaitForExit(3000)}}";
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{
    windowsHide:true,timeout:12000,env:{...process.env,LYCHEE_OWNED_QA_EXE:exe}});
}
async function panel(browser, text) {
  return deadline(() => atPage(browser, wanted =>
    [...document.querySelectorAll('[data-windows-update]')].some(e => e.offsetWidth && e.innerText.includes(wanted)), text), text);
}
async function testWindow(kind, exe, other) {
  const fixture = await localServer(kind), port = await freePort();
  const privateTmp = join(root, 'profile-' + kind);
  await mkdir(privateTmp);
  let launcher = startHost(exe, fixture.origin, port, privateTmp), browser;
  const outcome = {nativeShell: false, sourceExe: exe};
  report.scenarios[kind] = outcome;
  try {
    await launcher.started();
    const initial = await connect(port, fixture.origin); browser = initial.browser; outcome.nativeShell = true;
    await deadline(() => fixture.requests.some(r => r.mode === 'current' && r.path.endsWith('/stable.json')), 'startup manifest inspection');
    await deadline(() => browser.js("!!document.querySelector('.garden-access input[name=username]')"), 'first usable login window');
    assert.equal(await browser.js("!!document.querySelector('[data-windows-update]')?.offsetWidth"), false);
    assert.ok(fixture.requests.every(r => r.path.endsWith('/stable.json')));
    outcome.startupCurrentSilent = true;
    const marker = 'qa-' + randomUUID(), password = randomUUID();
    const workspace = await atPage(browser, async (marker, password) => {
      const post = async (url, body) => {
        const res = await fetch(url, {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)});
        if (!res.ok) throw Error(url + ' ' + res.status); return res.json();
      };
      await post('/api/v640/account', {mode:'register', name:'升级验收', password});
      const workspaceUrl = '/api/v640/workspace?client=windows-' + encodeURIComponent(document.body.dataset.clientBuild);
      const ws = await post(workspaceUrl, {action:'create', name:'升级留存园'});
      for (const n of ws.notices.filter(n => !n.read)) await post(workspaceUrl, {action:'read', noticeId:n.id});
      localStorage.setItem('lychee-update-qa-marker', marker);
      return {garden:ws.activeGardenId, account:ws.account.id};
    }, marker, password);
    assert.ok(workspace.garden && workspace.account);
    await browser.call('Page.reload');
    await settings(browser);
    if (checksOnly) {
      for (const [mode,state,label] of [
        ['unpublished','check-error','HTTP 404'],
        ['offline','check-error','HTTP 503'],
        ['redirect','check-error','未通过校验'],
        ['good','available','250.0.1'],
      ]) {
        fixture.mode=mode;
        await click(browser,'检查更新'); await panel(browser,label);
        assert.equal(await browser.js("document.querySelector('[data-windows-update]').dataset.updateState"),state);
        outcome[mode]=label;
        await closePanel(browser);
      }
      assert.ok(fixture.requests.every(r=>r.path===manifestPath));
      outcome.passed=true;
      return;
    }
    outcome.cookieBefore = await cookieMetadata(browser);
    assert.ok(outcome.cookieBefore.persistent && outcome.cookieBefore.secure && outcome.cookieBefore.httpOnly);
    const otherHash = other && await hashFile(other);
    if (control) {
      await browser.js("document.querySelector('.lychee-window-controls [data-command=close]').click();true").catch(()=>{});
      await deadline(async () => {try {await fetch('http://127.0.0.1:' + port + '/json/list'); return false;} catch {return true;}}, 'old browser exited');
      launcher.host.stdin.end('end\n'); await launcher.exited;
      fixture.mode = 'good';
      launcher = startHost(exe, fixture.origin, port, privateTmp); await launcher.started();
    } else {
    await click(browser,'检查更新'); await panel(browser,'已是最新版本，暂时无需更新');
      assert.ok(fixture.requests.some(r => r.mode === 'current'));
      outcome.noNewVersion = true;
      await closePanel(browser);
      fixture.mode = 'offline'; await click(browser,'检查更新'); await panel(browser,'重试');
      assert.ok(fixture.requests.some(r => r.mode === 'offline'));
      outcome.networkFailure = true;
      fixture.mode = 'bad'; await click(browser,'重试'); await panel(browser,'立即更新');
      await click(browser,'立即更新'); await panel(browser,'重试');
      assert.ok(fixture.requests.some(r => r.mode === 'bad' && r.path.endsWith('Lychee.' + kind)));
      assert.equal(await hashFile(exe), oldHash); outcome.badHashPreservedOld = true;
      fixture.mode = 'good'; await click(browser,'重试');
      await panel(browser,'立即更新'); await click(browser,'立即更新');
      await deadline(async () => await hashFile(exe) === newHash, 'running path updated', 90000);
      if(officialOnly){
        const asset='/windows-update/windows-v'+nextInfo.version+'/Lychee.'+kind;
        assert.ok(fixture.requests.some(r=>r.mode==='good'&&r.path===asset));
        assert.ok(fixture.requests.every(r=>r.path===manifestPath||r.path===asset));
        outcome.officialManifestAndFullPackageApplied=true;
      }
    }
    browser.socket.close(); browser = (await connect(port, fixture.origin, initial.id)).browser;
    if (control) {
      await panel(browser, '立即更新');
      assert.ok(fixture.requests.some(r => r.path.endsWith('/stable.json') && r.mode === 'good'));
      assert.ok(fixture.requests.every(r => r.path.endsWith('/stable.json')));
      await click(browser, '稍后', '[data-windows-update] button');
      await deadline(() => browser.js("!document.querySelector('[data-windows-update]')?.offsetWidth"), 'update deferred');
      outcome.automaticAvailableAndDeferredWithoutDownload = true;
    }
    await deadline(() => browser.js(`(()=>{
      const notice=[...document.querySelectorAll('.garden-access button')].find(b=>b.offsetWidth&&b.textContent.trim()==='标为已读');
      if(notice){notice.click();return false;}
      return !!document.querySelector('.s8-nav [aria-label=我], .windows-nav [data-page=settings], .garden-access input[name=username]');
    })()`), 'new application finished opening');
    const after = await atPage(browser, async () => {
      const res = await fetch('/api/v640/workspace'), ws = await res.json();
      return {status:res.status,account:ws.account?.id, garden:ws.activeGardenId, marker:localStorage.getItem('lychee-update-qa-marker'),
        hasData:ws.gardens?.some(g => g.name === '升级留存园'), version:document.querySelector('[data-client-build]')?.dataset.clientBuild};
    });
    outcome.afterRelaunch = {workspaceStatus:after.status, originalAccount:after.account === workspace.account,
      originalGarden:after.garden === workspace.garden, profileMarker:after.marker === marker, embeddedVersion:after.version};
    outcome.cookieAfter = await cookieMetadata(browser);
    assert.equal(await hashFile(decoy), oldHash);
    if (other) assert.equal(await hashFile(other), otherHash);
    outcome.decoysUnchanged=true;
    assert.equal(after.marker, marker); assert.equal(after.version, control ? oldInfo.version : nextInfo.version);
    if (after.status === 401) {
      // Keep the continuity failure. A separate authenticated read distinguishes a
      // missing session from loss of stored account data on the same origin.
      const recovery = await atPage(browser, async password => {
        const login = await fetch('/api/v640/account', {method:'POST', headers:{'content-type':'application/json'},
          body:JSON.stringify({mode:'login', name:'升级验收', password})});
        if (!login.ok) return null;
        const data = await (await fetch('/api/v640/workspace')).json();
        return {account:data.account?.id,garden:data.activeGardenId,hasData:data.gardens?.some(g=>g.name==='升级留存园')};
      }, password);
      outcome.userDataAfterFreshLogin = recovery?.account === workspace.account &&
        recovery?.garden === workspace.garden && recovery?.hasData === true;
    }
    outcome.accountRetained = after.garden === workspace.garden && after.account === workspace.account;
    outcome.userDataRetained = after.hasData === true || outcome.userDataAfterFreshLogin === true;
    outcome.relaunchedVersion = after.version;
    if (!control) {
      assert.ok(fixture.requests.some(r => r.mode === 'good' && r.path.endsWith('Lychee.' + kind)));
      assert.ok(!fixture.requests.some(r => r.path.endsWith('Lychee.' + (kind === 'exe'?'msi':'exe'))));
      if (outcome.userDataAfterFreshLogin) await browser.call('Page.reload');
      await settings(browser); await click(browser,'检查更新'); await panel(browser,'已是最新版本，暂时无需更新');
      outcome.latestAfterUpgrade = true;
    }
    assert.ok(outcome.accountRetained, 'Existing authenticated session missing after reopening');
    assert.ok(outcome.userDataRetained, 'Account data did not survive reopening');
    outcome.passed = true;
  } catch (error) {
    outcome.error = error.message;
    if (browser?.socket?.readyState === 1) outcome.ui = await browser.js('document.body.innerText.slice(-700)').catch(()=>undefined);
  } finally {
    if (browser?.socket?.readyState === 1) {
      await browser.js("document.querySelector('.lychee-window-controls [data-command=close]')?.click();true").catch(()=>{});
      browser.socket.close();
    }
    launcher.host.stdin.end('end\n'); await launcher.exited; await stopOwnedShell(exe); await fixture.close();
    outcome.updateRequests = fixture.requests;
  }
}
async function closePanel(browser) {
  await deadline(() => atPage(browser, () => {
    const panel = document.querySelector('[data-windows-update]');
    if (!panel || !panel.offsetWidth) return true;
    const close = [...panel.querySelectorAll('button')].find(b => /关闭|稍后|知道了|完成|确定/.test(b.innerText + b.getAttribute('aria-label')));
    if (!close) return false; close.click(); return true;
  }), 'close update panel');
}

const msiexec = join(process.env.WINDIR, 'System32', 'msiexec.exe');
const log = tag => join(root, tag + '.log');
async function msiError(e, path) {
  const bytes = await readFile(path).catch(() => Buffer.alloc(0));
  const text = bytes.toString(bytes[0] === 255 ? 'utf16le' : 'utf8');
  return {code:e.code, log:path, relevant:text.split(/\r?\n/).filter(l =>
    /inprogressinstallinfo\.ipi.*-2147287035|^DEBUG: Error (250[23])|return value 3/i.test(l)).slice(-8)};
}
let installed = false;
let lock;
let attemptedInstall = false;
const lockPath = join(tmpdir(), 'lychee-update-msi-' + instance + '.lock');
try {
  if (!control && !checksOnly) {
    lock = await open(lockPath, 'wx');
    for (const file of [oldMsi, newMsi]) assert.equal((await msiInfo('state', file)).productState, -1, 'Use a fresh QA instance.');
    try {
      attemptedInstall = true;
      await command(msiexec, ['/i', oldMsi, '/qn', '/norestart', 'INSTALLDIR=' + installedDir, '/L*v', log('install')]);
      installed = true;
      const tracked = await msiInfo('state', oldMsi);
      assert.equal(tracked.productState,5); assert.equal(tracked.componentState,3);
      assert.equal(resolve(tracked.exePath).toLowerCase(), installedExe.toLowerCase()); assert.equal(await hashFile(installedExe), oldHash);
    } catch(e) {report.msiInstallFailure = {...await msiError(e, log('install')), message:e.message};}
  }
  await testWindow('exe', portableExe, installed && !report.msiInstallFailure ? installedExe : null);
  if (installed && !report.msiInstallFailure) {
    await testWindow('msi', installedExe, portableExe);
    report.installedAfter = await msiInfo('state', newMsi);
    assert.equal((await msiInfo('state', oldMsi)).productState, -1);
    assert.equal(report.installedAfter.productState, 5);
    assert.equal(resolve(report.installedAfter.exePath).toLowerCase(), installedExe.toLowerCase());
  }
} catch (e) {report.error=e.message;}
finally {
  for (const [file, pkg] of (attemptedInstall ? [[newMsi,nextInfo],[oldMsi,oldInfo]] : [])) {
    if ((await msiInfo('state', file)).productState !== -1) {
      try {await command(msiexec, ['/x',pkg.product,'/qn','/norestart','/L*v',log('uninstall-' + pkg.version)]);}
      catch(e) {report.cleanupError = await msiError(e,log('uninstall-' + pkg.version));}
    }
  }
  if (lock) {await lock.close(); await unlink(lockPath);}
  report.pass = !report.error && !report.cleanupError && !!report.scenarios.exe?.passed && (checksOnly || control || !!report.scenarios.msi?.passed);
  await writeFile(join(root, 'result.json'), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (!report.pass) process.exitCode=1;
}
