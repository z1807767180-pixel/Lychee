import { cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export async function install(webRoot) {
  const mobile = new URL('./www/mobile/', import.meta.url);
  if ((await readFile(new URL('version.txt', mobile), 'utf8')).trim() !== '6.4.7') {
    throw new Error('Missing mobile web release 6.4.7');
  }
  await cp(mobile, join(webRoot, 'mobile'), { recursive: true });
}
