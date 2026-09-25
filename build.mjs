import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const serve = process.argv.includes('--serve');
const out = serve ? 'dist-dev' : 'dist';   // the dev server never clobbers the release build
const QR_LIB = 'node_modules/qrcode-generator/qrcode.js';   // the probe's QR encoder, served next to it (no CDN)
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: 'chrome101',
  outfile: `${out}/app.js`,
  loader: { '.css': 'text' },
  logLevel: 'info',
};

rmSync(out, { recursive: true, force: true });   // start clean: no files left over from earlier builds

function copyStatic(appSrc) {
  mkdirSync(out, { recursive: true });
  if (existsSync('public')) cpSync('public', out, { recursive: true });
  if (existsSync('probe')) {
    if (!existsSync(QR_LIB)) throw new Error(`${QR_LIB} is missing: run npm install`);
    cpSync('probe', `${out}/probe`, { recursive: true });
    cpSync(QR_LIB, `${out}/probe/qrcode.js`);
  }
  if (serve && existsSync('dev')) cpSync('dev', `${out}/dev`, { recursive: true });
  writeFileSync(`${out}/index.html`, readFileSync('index.html', 'utf8').replace('__APP_JS__', appSrc));
}

if (serve) {
  copyStatic('app.js');
  const ctx = await esbuild.context(options);
  await ctx.watch();
  const { port } = await ctx.serve({ servedir: out, port: 8240 });
  console.log(`app:     http://localhost:${port}/`);
  console.log(`harness: http://localhost:${port}/dev/harness.html`);
} else {
  await esbuild.build({ ...options, minify: true });
  const hash = createHash('sha256').update(readFileSync('dist/app.js')).digest('hex').slice(0, 8);
  copyStatic(`app.js?v=${hash}`);
}
