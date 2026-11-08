// Usage: node scripts/make-qr.mjs <url> <title> <out.png> [description] [themeColor]
import QRCode from 'qrcode';

const [url, title, out, description = '', themeColor = '#E8A33D'] = process.argv.slice(2);
if (!url || !title || !out) {
  console.error('usage: make-qr.mjs <url> <title> <out.png> [description] [themeColor]');
  process.exit(1);
}
if (!url.startsWith('https://')) throw new Error('creation URL must be https');
// The r1 shows this icon on its loading screen; an empty iconUrl gets Android's default robot there. It sits next to
// index.html, so the creation URL must name the app's folder (…/r1-skywave/?v=6, not …/r1-skywave?v=6), and it takes
// the URL's ?v=N along so a new install also fetches a changed icon.
if (!/\/(index\.html)?$/.test(new URL(url).pathname)) throw new Error('creation URL must end in / before ?v=N (e.g. https://cknyco.github.io/r1-skywave/?v=6)');
const icon = new URL('img/icon.png', url);
const v = new URL(url).searchParams.get('v');
if (v) icon.searchParams.set('v', v);
const iconUrl = icon.href;
const payload = JSON.stringify({ title, url, description: description.slice(0, 100), iconUrl, themeColor });
await QRCode.toFile(out, payload, { errorCorrectionLevel: 'L', margin: 4, width: 480 });
console.log(`${out}: ${payload.length} chars -> ${payload}`);
