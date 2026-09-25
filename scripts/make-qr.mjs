// Usage: node scripts/make-qr.mjs <url> <title> <out.png> [description] [themeColor]
import QRCode from 'qrcode';

const [url, title, out, description = '', themeColor = '#E8A33D'] = process.argv.slice(2);
if (!url || !title || !out) {
  console.error('usage: make-qr.mjs <url> <title> <out.png> [description] [themeColor]');
  process.exit(1);
}
if (!url.startsWith('https://')) throw new Error('creation URL must be https');
const payload = JSON.stringify({ title, url, description: description.slice(0, 100), iconUrl: '', themeColor });
await QRCode.toFile(out, payload, { errorCorrectionLevel: 'L', margin: 4, width: 480 });
console.log(`${out}: ${payload.length} chars -> ${payload}`);
