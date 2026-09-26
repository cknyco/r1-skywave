import { gzipSync } from 'node:zlib';
import { readFileSync, statSync } from 'node:fs';

const checks = [
  ['dist/app.js', 30 * 1024, true],
  ['dist/data/places.json', 120 * 1024, true],
  ['dist/img/earth-2048.jpg', 400 * 1024, false],
];
let failed = false;
for (const [file, limit, gz] of checks) {
  const size = gz ? gzipSync(readFileSync(file), { level: 9 }).length : statSync(file).size;
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file} ${size} B${gz ? ' gz' : ''} (limit ${limit})`);
}
process.exit(failed ? 1 : 0);
