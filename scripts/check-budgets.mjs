import { gzipSync } from 'node:zlib';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const gzSize = file => gzipSync(readFileSync(file), { level: 9 }).length;

// The largest country file (Task P4b): the first tune in its country waits for it once, under the tuning static.
// MX is 68.2 KB gz after Ruling 51. At 100 KB gz it would take about 0.4 s at 2 Mbit/s and under 10 ms to parse at
// 6x CPU (headless Chromium, as slow as the r1), little next to a stream's own connect time.
const chunks = readdirSync('dist/data/st').filter(f => f.endsWith('.json')).map(f => `dist/data/st/${f}`);
const largest = chunks.map(f => [f, gzSize(f)]).sort((a, b) => b[1] - a[1])[0];

const checks = [
  ['dist/app.js', 30 * 1024, true],
  ['dist/cities.js', 10 * 1024, true],   // the voice city list, loaded from the first voice hold (decision 2026-10-17)
  ['dist/globe-gl.js', 6 * 1024, true],   // the WebGL globe, loaded where WebGL exists (glowing-globe plan, Task 4)
  ['dist/data/places.json', 120 * 1024, true],
  [largest[0], 100 * 1024, true, `the largest of ${chunks.length} country files`],
  ['dist/img/earth-2048.jpg', 400 * 1024, false],
];
let failed = false;
for (const [file, limit, gz, note] of checks) {
  const size = gz ? gzSize(file) : statSync(file).size;
  const ok = size <= limit;
  failed ||= !ok;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${file} ${size} B${gz ? ' gz' : ''} (limit ${limit}${note ? `, ${note}` : ''})`);
}
process.exit(failed ? 1 : 0);
