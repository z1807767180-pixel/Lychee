// Add the mobile files after the existing service has unpacked its release.
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const bootstrap = process.env.LYCHEE_TEST_PAGE;
const launch = 'await import(pathToFileURL(join(folder,"server.mjs")).href);';
if (!bootstrap || bootstrap.split(launch).length !== 2) {
  throw new Error('Original service launch point changed. Review before deploying.');
}
const installer = new URL('./install.mjs', import.meta.url);
const installMobile = 'await (await import(' + JSON.stringify(installer.href) +
  ')).install(join(folder,"web"));';
const adapted = bootstrap.replace(launch, () => installMobile + '\n' + launch);
const temporary = await mkdtemp(join(tmpdir(), 'lychee-start-'));
const entry = join(temporary, 'start.mjs');
await writeFile(entry, adapted, { mode: 0o600 });
await import(pathToFileURL(entry).href);
