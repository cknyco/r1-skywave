// Nightly change log (Tasks 8b, 8c): compares the dataset in --data with the previous snapshot (--prev) and the
// day base (--day-base, the last snapshot of the previous UTC day), both read from branch data-log; a missing
// file means the first run, and a v1 snapshot from before Task 8c makes this run a fresh baseline (Ruling 42).
// Writes
//   --data/new.json                 stations first seen in the last 14 days (deployed with the site)
//   --log/snapshot.json             every station with its first-seen date and stream hash (committed to data-log)
//   --log/day-base.json             the day base for the next run on the same day (committed to data-log)
//   --log/changes/<date>.md         readable added/removed/changed list since the day base (none when empty)
//   --log/changes/latest.json       counts since the day base
// Usage: tsx scripts/changelog.ts --data public/data --prev prev-snapshot.json --day-base prev-day-base.json --log log --date 2026-09-26
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  dayBase, diffSnapshots, isDay, isLegacy, latestJson, newStations, parseSnapshot, renderMarkdown, snapshotFrom,
  stableJson, type Snapshot,
} from './lib/changelog';
import type { ChunkJson, PlacesJson } from './lib/emit';

const { values } = parseArgs({
  options: {
    data: { type: 'string' }, prev: { type: 'string' }, 'day-base': { type: 'string' }, log: { type: 'string' },
    date: { type: 'string' },
  },
});
const { data, prev: prevPath, 'day-base': basePath, log, date } = values;
if (!data || !log || !date || !isDay(date)) {
  console.error('usage: changelog.ts --data <dir> --prev <snapshot.json> --day-base <day-base.json> --log <dir> --date YYYY-MM-DD');
  process.exit(2);
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const places = readJson<PlacesJson>(join(data, 'places.json'));
const chunks = readdirSync(join(data, 'st'))
  .filter(f => f.endsWith('.json'))
  .sort()
  .map(f => readJson<ChunkJson>(join(data, 'st', f)));

/** A snapshot file with its text, so day-base.json can be written byte for byte. */
function readSnapshot(path: string | undefined, what: string): { snap: Snapshot; text: string } | null {
  if (!path || !existsSync(path)) return null;
  try {
    const text = readFileSync(path, 'utf8');
    return { snap: parseSnapshot(text), text };
  } catch (e) {
    console.log(`::warning::${what} ${path} unreadable (${(e as Error).message})`);
    return null;
  }
}

// An unreadable previous snapshot must not block the deploy: carry on as a baseline night. The
// data-log push refuses to replace an existing snapshot with a baseline, so no history is lost.
// An unreadable day base only makes the previous snapshot the day base.
const prev = readSnapshot(prevPath, 'previous snapshot');
const kept = readSnapshot(basePath, 'day base');

// Ruling 42: a v1 snapshot is not continued. This run is a fresh baseline (every station first seen today,
// nothing gone, new.json empty) and the day base for later runs today.
const upgrade = prev !== null && isLegacy(prev.snap);
const last = upgrade ? null : prev;

const snap = snapshotFrom(places, chunks, date, last?.snap ?? null);
const text = `${stableJson(snap)}\n`;
const baseSnap = dayBase(last?.snap ?? null, kept?.snap ?? null, date);
const base = upgrade ? text : baseSnap === null ? null : baseSnap === last?.snap ? last.text : kept?.text;
const diff = diffSnapshots(baseSnap, snap);
const fresh = newStations(snap, date, places, chunks);

writeFileSync(join(data, 'new.json'), JSON.stringify(fresh));
mkdirSync(join(log, 'changes'), { recursive: true });
writeFileSync(join(log, 'snapshot.json'), text);
if (base) writeFileSync(join(log, 'day-base.json'), base);
if (diff.baseline || diff.added.length || diff.removed.length || diff.changed.length) {
  writeFileSync(join(log, 'changes', `${date}.md`), renderMarkdown(diff, date, diff.total, upgrade));
}
writeFileSync(join(log, 'changes', 'latest.json'), `${stableJson(latestJson(diff, date, diff.total))}\n`);

console.log(diff.baseline
  ? `changelog ${date}: baseline${upgrade ? ' (format upgrade)' : ''}, ${diff.total} stations`
  : `changelog ${date}: +${diff.added.length} -${diff.removed.length} ~${diff.changed.length} since ${baseSnap?.date || 'the previous snapshot'}, `
    + `${diff.total} stations, ${fresh.stations.length} new in ${fresh.days} days`);
