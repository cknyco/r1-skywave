// Nightly change log and "new stations" list (Task 8b). Pure functions over the emitted dataset:
// a snapshot remembers when each station id was first seen; comparing tonight's snapshot with the
// previous one yields the added/removed stations, and the first-seen dates yield data/new.json.
import type { ChunkJson, ChunkRow, PlacesJson } from './emit';

export type SnapshotEntry = [name: string, placeName: string, cc: string, firstSeen: string];
/** A station missing from the dataset since `goneSince`, kept for GONE_DAYS so a return is not "new". */
export type GoneEntry = [name: string, placeName: string, cc: string, firstSeen: string, goneSince: string];
/** Keyed by station uuid; `baseline` is the date (YYYY-MM-DD, UTC) of the first run ever. */
export interface Snapshot {
  v: 1;
  baseline: string;
  stations: Record<string, SnapshotEntry>;
  gone: Record<string, GoneEntry>;
}

export interface Entry { id: string; name: string; place: string; cc: string }
export interface CountryChange { added: number; removed: number }
export interface Diff {
  added: Entry[];
  removed: Entry[];
  byCountry: Record<string, CountryChange>;
  total: number;
  baseline: boolean;
}

export interface NewStation { id: string; name: string; place: number; placeName: string; cc: string; since: string }
export interface NewJson { v: 1; date: string; days: number; stations: NewStation[] }

export interface LatestJson {
  v: 1;
  date: string;
  total: number;
  added: number;
  removed: number;
  baseline: boolean;
  byCountry: Record<string, CountryChange>;
}

const LIST_CAP = 200;
const GONE_DAYS = 90;

// Station ids and country codes are third-party data: read them as own properties only.
const own = <T>(o: Record<string, T>, k: string): T | undefined =>
  Object.prototype.hasOwnProperty.call(o, k) ? o[k] : undefined;

// Plain code-unit order: the same on every machine, unlike localeCompare.
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function rowsOf(chunks: Map<string, ChunkJson> | ChunkJson[]): ChunkRow[] {
  return (chunks instanceof Map ? [...chunks.values()] : chunks).flatMap(c => c.rows);
}

/** Radio Browser lists some stations twice under different uuids: same name at the same place = one station. */
const twinKey = (name: string, placeName: string, cc: string) =>
  [cc, placeName, name].map(s => s.toLowerCase().replace(/\s+/g, ' ').trim()).join('\u0000');

export function isDay(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && addDays(s, 0) === s;
}

/** Calendar arithmetic on UTC dates: addDays('2026-09-26', -14) === '2026-09-12'. */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/**
 * Tonight's stations with their first-seen dates. A station keeps its date when its id is back from `gone`
 * (it failed a check for a while) or when a known station has the same name at the same place (a duplicate
 * uuid took its slot); the earliest such date wins. Stations that disappeared move to `gone` for GONE_DAYS.
 */
export function snapshotFrom(
  places: PlacesJson,
  chunks: Map<string, ChunkJson> | ChunkJson[],
  today: string,
  prev: Snapshot | null,
): Snapshot {
  const before = prev?.stations ?? {};
  const keepFrom = addDays(today, -GONE_DAYS);
  const gone = new Map<string, GoneEntry>();
  for (const [id, e] of Object.entries(prev?.gone ?? {})) if (e[4] >= keepFrom) gone.set(id, e);

  const earliest = new Map<string, string>();
  const note = ([name, placeName, cc, firstSeen]: SnapshotEntry | GoneEntry) => {
    const k = twinKey(name, placeName, cc);
    const d = earliest.get(k);
    if (d === undefined || firstSeen < d) earliest.set(k, firstSeen);
  };
  Object.values(before).forEach(note);
  gone.forEach(note);

  const seen = new Map<string, SnapshotEntry>();
  for (const [place, id, name] of rowsOf(chunks)) {
    if (seen.has(id)) continue;
    const placeName = places.name[place], cc = places.cc[place];
    const known = own(before, id) ?? gone.get(id);
    seen.set(id, [name, placeName, cc, known?.[3] ?? earliest.get(twinKey(name, placeName, cc)) ?? today]);
    gone.delete(id);
  }
  for (const [id, [name, placeName, cc, firstSeen]] of Object.entries(before)) {
    if (!seen.has(id)) gone.set(id, [name, placeName, cc, firstSeen, today]);
  }
  // Object.fromEntries defines own data properties, so an id such as "__proto__" stays plain data.
  return { v: 1, baseline: prev?.baseline ?? today, stations: Object.fromEntries(seen), gone: Object.fromEntries(gone) };
}

const entry = (id: string, [name, place, cc]: SnapshotEntry): Entry => ({ id, name, place, cc });
const byEntry = (a: Entry, b: Entry) => cmp(a.cc, b.cc) || cmp(a.name, b.name) || cmp(a.id, b.id);

export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Diff {
  const ids = Object.keys(next.stations);
  if (!prev) return { added: [], removed: [], byCountry: {}, total: ids.length, baseline: true };
  const added = ids.filter(id => !own(prev.stations, id)).map(id => entry(id, next.stations[id])).sort(byEntry);
  const removed = Object.keys(prev.stations)
    .filter(id => !own(next.stations, id))
    .map(id => entry(id, prev.stations[id]))
    .sort(byEntry);
  const counts = new Map<string, CountryChange>();
  const bump = (cc: string, k: keyof CountryChange) => {
    const c = counts.get(cc) ?? { added: 0, removed: 0 };
    c[k]++;
    counts.set(cc, c);
  };
  for (const e of added) bump(e.cc, 'added');
  for (const e of removed) bump(e.cc, 'removed');
  return { added, removed, byCountry: Object.fromEntries(counts), total: ids.length, baseline: false };
}

/** Stations first seen within the last `days` days (inclusive), excluding the baseline night; twins listed once. */
export function newStations(
  snap: Snapshot,
  today: string,
  places: PlacesJson,
  chunks: Map<string, ChunkJson> | ChunkJson[],
  days = 14,
  max = 100,
): NewJson {
  const cutoff = addDays(today, -days);
  const placeOf = new Map<string, number>();
  for (const [place, id] of rowsOf(chunks)) if (!placeOf.has(id)) placeOf.set(id, place);
  const stations: NewStation[] = [];
  for (const id of Object.keys(snap.stations)) {
    const [name, , , since] = snap.stations[id];
    const place = placeOf.get(id);
    if (place === undefined || since === snap.baseline || since < cutoff || since > today) continue;
    stations.push({ id, name, place, placeName: places.name[place], cc: places.cc[place], since });
  }
  stations.sort((a, b) => cmp(b.since, a.since) || cmp(a.name, b.name) || cmp(a.id, b.id));
  const listed = new Set<string>();
  const once = stations.filter(s => {
    const k = twinKey(s.name, s.placeName, s.cc);
    if (listed.has(k)) return false;
    listed.add(k);
    return true;
  });
  return { v: 1, date: today, days, stations: once.slice(0, max) };
}

/** Station names are untrusted: neutralise Markdown/HTML control characters and line breaks. */
export function escapeMd(s: string): string {
  return s
    .replace(/[\\`*_[\]<>|#]/g, c => `\\${c}`)
    .replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, ' ')
    .trim();
}

function list(title: string, entries: Entry[]): string[] {
  if (!entries.length) return [];
  const lines = entries.slice(0, LIST_CAP).map(e => `- ${escapeMd(e.name)} — ${escapeMd(e.place)} (${escapeMd(e.cc)})`);
  if (entries.length > LIST_CAP) lines.push('', `…and ${entries.length - LIST_CAP} more`);
  return ['', `## ${title}`, '', ...lines];
}

export function renderMarkdown(diff: Diff, today: string, total: number): string {
  const head = `# Station changes ${today}`;
  if (diff.baseline) return `${head}\n\nBaseline: ${total} stations. Changes are reported from the next run on.\n`;
  const countries = Object.keys(diff.byCountry)
    .map(cc => ({ cc, ...diff.byCountry[cc] }))
    .filter(c => c.added + c.removed > 0)
    .sort((a, b) => b.added + b.removed - (a.added + a.removed) || cmp(a.cc, b.cc));
  const table = countries.length
    ? ['', '| Country | Added | Removed |', '|:--|--:|--:|', ...countries.map(c => `| ${escapeMd(c.cc)} | ${c.added} | ${c.removed} |`)]
    : [];
  return [
    head,
    '',
    `${total} stations: ${diff.added.length} added, ${diff.removed.length} removed.`,
    ...table,
    ...list('Added', diff.added),
    ...list('Removed', diff.removed),
    '',
  ].join('\n');
}

export function latestJson(diff: Diff, today: string, total: number): LatestJson {
  return {
    v: 1, date: today, total, added: diff.added.length, removed: diff.removed.length,
    baseline: diff.baseline, byCountry: diff.byCountry,
  };
}

/** Deterministic JSON: object keys sorted at every level, arrays of plain values kept on one line. */
export function stableJson(value: unknown, indent = ''): string {
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.every(x => x === null || typeof x !== 'object')) return JSON.stringify(value);
    if (!value.length) return '[]';
    return `[\n${value.map(x => inner + stableJson(x, inner)).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    if (!keys.length) return '{}';
    return `{\n${keys.map(k => `${inner}${JSON.stringify(k)}: ${stableJson(o[k], inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/** Parses the previous night's snapshot.json; throws on anything that is not a v1 snapshot. */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Snapshot;
  const table = (t: unknown, width: number) => !!t && typeof t === 'object' && !Array.isArray(t)
    && Object.values(t).every(e => Array.isArray(e) && e.length === width && e.every(x => typeof x === 'string'));
  const ok = !!s && typeof s === 'object' && !Array.isArray(s) && s.v === 1 && isDay(String(s.baseline))
    && table(s.stations, 4) && (s.gone === undefined || table(s.gone, 5));
  if (!ok) throw new Error('not a v1 station snapshot');
  // Snapshots written before `gone` existed have none.
  return { ...s, gone: s.gone ?? {} };
}
