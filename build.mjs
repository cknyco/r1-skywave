import * as esbuild from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const serve = process.argv.includes('--serve');
const out = serve ? 'dist-dev' : 'dist';   // the dev server never clobbers the release build
const QR_LIB = 'node_modules/qrcode-generator/qrcode.js';   // the probe's QR encoder, served next to it (no CDN)
const TARGET = 'chrome101';

/** The CSS that app.js embeds as text, minified (comments and whitespace out) in release and dev builds alike. */
const minCss = {
  name: 'min-css',
  setup(build) {
    build.onLoad({ filter: /\.css$/ }, async args => {
      const { code } = await esbuild.transform(readFileSync(args.path, 'utf8'), { loader: 'css', minify: true, target: TARGET });
      return { contents: code, loader: 'text' };
    });
  },
};

// Files built as ES modules of their own next to app.js, which imports them by URL when it needs them
// (src/platform/lazy.ts): [the define app.js reads the URL from, the source, the output file].
const LAZY = [
  ['__CITIES_JS__', 'src/voice/cities.ts', 'cities.js'],   // the voice city list, loaded from the first voice hold
  ['__GL_JS__', 'src/map/gl/globe-gl.ts', 'globe-gl.js'],   // the WebGL globe, loaded where WebGL exists
];

const hashOf = file => createHash('sha256').update(readFileSync(file)).digest('hex').slice(0, 8);

/**
 * Builds the lazily loaded entries before app.js and returns app.js's defines: each URL hashed like app.js's own
 * (`cities.js?v=<hash>`), or plain in --serve, where every entry gets a watch context of its own.
 */
async function buildLazy() {
  const define = {};
  for (const [name, entry, file] of LAZY) {
    const opts = { entryPoints: [entry], bundle: true, format: 'esm', target: TARGET, outfile: `${out}/${file}`, logLevel: 'info' };
    if (serve) {
      const ctx = await esbuild.context(opts);
      await ctx.rebuild();
      await ctx.watch();
      define[name] = JSON.stringify(file);
    } else {
      await esbuild.build({ ...opts, minify: true });
      define[name] = JSON.stringify(`${file}?v=${hashOf(`${out}/${file}`)}`);
    }
  }
  return define;
}

rmSync(out, { recursive: true, force: true });   // start clean: no files left over from earlier builds

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'iife',
  target: TARGET,
  outfile: `${out}/app.js`,
  plugins: [minCss],
  define: await buildLazy(),
  logLevel: 'info',
};

function copyStatic(appSrc) {
  mkdirSync(out, { recursive: true });
  if (existsSync('public')) cpSync('public', out, { recursive: true });
  if (existsSync('probe')) {
    if (!existsSync(QR_LIB)) throw new Error(`${QR_LIB} is missing: run pnpm install`);
    cpSync('probe', `${out}/probe`, { recursive: true });
    cpSync(QR_LIB, `${out}/probe/qrcode.js`);
  }
  if (serve && existsSync('dev')) cpSync('dev', `${out}/dev`, { recursive: true, filter: f => !f.endsWith('.ts') });
  writeFileSync(`${out}/index.html`, readFileSync('index.html', 'utf8').replace('__APP_JS__', appSrc));
}

if (serve) {
  copyStatic('app.js');
  const ctx = await esbuild.context(options);
  await ctx.watch();
  if (existsSync('dev/view-harness.ts')) {   // dev-only renderer harness (Task 13); the release build never includes it
    const view = await esbuild.context({ ...options, entryPoints: ['dev/view-harness.ts'], outfile: `${out}/dev/view-harness.js` });
    await view.rebuild();
    await view.watch();
  }
  const { port } = await ctx.serve({ servedir: out, port: 8240 });
  console.log(`app:     http://localhost:${port}/`);
  console.log(`harness: http://localhost:${port}/dev/harness.html`);
  console.log(`view:    http://localhost:${port}/dev/view.html`);
} else {
  await esbuild.build({ ...options, minify: true });
  copyStatic(`app.js?v=${hashOf('dist/app.js')}`);
}
