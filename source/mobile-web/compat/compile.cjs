const fs = require('node:fs');
const path = require('node:path');
const esbuild = require('esbuild');
const mobile = path.resolve(process.argv[2]);
const target = 'chrome69';

const license = fs.readFileSync(require.resolve('core-js/LICENSE'), 'utf8');
const shims = esbuild.buildSync({
  entryPoints: [path.join(__dirname, 'browser.cjs')], bundle: true, write: false,
  minify: true, charset: 'utf8', platform: 'browser', target,
  banner: {js: '/*! core-js\n' + license + '\n*/'}
}).outputFiles[0].text;

for (const entry of fs.readdirSync(mobile, {recursive: true})) {
  if (!entry.endsWith('.js')) continue;
  const filename = path.join(mobile, entry);
  const source = fs.readFileSync(filename, 'utf8');
  const output = esbuild.transformSync(source, {
    target, charset:'utf8', legalComments:'inline', minifyWhitespace: true
  }).code;
  // The shared launch script runs before the workspace and interactive business bundle.
  const bootstrap = entry.endsWith(path.join('launch','start.js')) ? shims + '\n' : '';
  fs.writeFileSync(filename, bootstrap + output);
}
