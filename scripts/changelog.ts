// Nightly change log (Task 8b): compares the dataset in --data with the previous snapshot (--prev, read
// from branch data-log; a missing file means the first run) and writes
//   --data/new.json                 stations first seen in the last 14 days (deployed with the site)
//   --log/snapshot.json             every station with its first-seen date (committed to data-log)
//   --log/changes/<date>.md         readable added/removed list (skipped on a night without changes)
//   --log/changes/latest.json       counts of the latest run
// Usage: tsx scripts/changelog.ts --data public/data --prev prev-snapshot.json --log log --date 2026-09-26
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  diffSnapshots, isDay, latestJson, newStations, parseSnapshot, renderMarkdown, snapshotFrom, stableJson,
  type Snapshot,
} from './lib/changelog';
import type { ChunkJson, PlacesJson } from './lib/emit';

const { values } = parseArgs({
  options: { data: { type: 'string' }, prev: { type: 'string' }, log: { type: 'string' }, date: { type: 'string' } },
});
const { data, prev: prevPath, log, date } = values;
if (!data || !log || !date || !isDay(date)) {
  console.error('usage: changelog.ts --data <dir> --prev <snapshot.json> --log <dir> --date YYYY-MM-DD');
  process.exit(2);
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const places = readJson<PlacesJson>(join(data, 'places.json'));
const chunks = readdirSync(join(data, 'st'))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => readJson<ChunkJson>(join(data, 'st', f)));

// An unreadable previous snapshot must not block the deploy: carry on as a baseline night. The
// data-log push refuses to replace an existing snapshot with a baseline, so no history is lost.
let prev: Snapshot | null = null;
if (prevPath && existsSync(prevPath)) {
  try {
    prev = parseSnapshot(readFileSync(prevPath, 'utf8'));
  } catch (e) {
    console.log(`::warning::previous snapshot ${prevPath} unreadable (${(e as Error).message}); treating tonight as a baseline`);
  }
}

const snap = snapshotFrom(places, chunks, date, prev);
const diff = diffSnapshots(prev, snap);
const fresh = newStations(snap, date, places, chunks);

writeFileSync(join(data, 'new.json'), JSON.stringify(fresh));
mkdirSync(join(log, 'changes'), { recursive: true });
writeFileSync(join(log, 'snapshot.json'), `${stableJson(snap)}\n`);
if (diff.baseline || diff.added.length || diff.removed.length) {
  writeFileSync(join(log, 'changes', `${date}.md`), renderMarkdown(diff, date, diff.total));
}
writeFileSync(join(log, 'changes', 'latest.json'), `${stableJson(latestJson(diff, date, diff.total))}\n`);

console.log(diff.baseline
  ? `changelog ${date}: baseline, ${diff.total} stations`
  : `changelog ${date}: +${diff.added.length} -${diff.removed.length}, ${diff.total} stations, ${fresh.stations.length} new in ${fresh.days} days`);
