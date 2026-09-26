// Nightly change log and "new stations" list (Tasks 8b, 8c). Pure functions over the emitted dataset:
// a snapshot remembers when each station id was first seen and a hash of its stream URL; comparing the
// latest snapshot with the day base yields the added, removed and changed stations, and the first-seen
// dates yield data/new.json.
import { createHash } from 'node:crypto';
import type { ChunkJson, ChunkRow, PlacesJson } from './emit';

/** `stream` is streamHash(url), or '' when unknown (snapshots written before Task 8c). */
export type SnapshotEntry = [name: string, placeName: string, cc: string, firstSeen: string, stream: string];
/** A station missing from the dataset since `goneSince`, kept for GONE_DAYS so a return is not "new". */
export type GoneEntry = [name: string, placeName: string, cc: string, firstSeen: string, goneSince: string, stream: string];
/**
 * Keyed by station uuid; `baseline` is the date (YYYY-MM-DD, UTC) of the first run ever, `date` the date of the
 * run that wrote it ('' when unknown: a v1 snapshot from before Task 8c, read by parseSnapshot).
 */
export interface Snapshot {
  v: 2;
  baseline: string;
  date: string;
  stations: Record<string, SnapshotEntry>;
  gone: Record<string, GoneEntry>;
}

export interface Entry { id: string; name: string; place: string; cc: string }
/** One stream under a new uuid: renamed, moved to another place, or only re-listed (Ruling 40). */
export interface Changed {
  id: string;
  oldId: string;
  name: string;
  oldName: string;
  place: string;
  oldPlace: string;
  cc: string;
  oldCc: string;
}
export interface CountryChange { added: number; removed: number; changed: number }
export interface Diff {
  added: Entry[];
  removed: Entry[];
  changed: Changed[];
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
  changed: number;
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

/** The first 12 hex characters of the SHA-1 of a stream URL: one stream = one station, whatever its uuid. */
export function streamHash(url: string): string {
  return createHash('sha1').update(url).digest('hex').slice(0, 12);
}

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
 * (it failed a check for a while), when a known station had the same stream URL (the stream is listed under a
 * new uuid) or when a known station has the same name at the same place (a duplicate uuid took its slot); the
 * earliest such date wins. Stations that disappeared move to `gone` for GONE_DAYS.
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
  const remember = (k: string, firstSeen: string) => {
    const d = earliest.get(k);
    if (d === undefined || firstSeen < d) earliest.set(k, firstSeen);
  };
  const note = (name: string, placeName: string, cc: string, firstSeen: string, stream: string) => {
    remember(`t\u0000${twinKey(name, placeName, cc)}`, firstSeen);
    if (stream) remember(`s\u0000${stream}`, firstSeen);
  };
  for (const [name, placeName, cc, firstSeen, stream] of Object.values(before)) note(name, placeName, cc, firstSeen, stream);
  for (const [name, placeName, cc, firstSeen, , stream] of gone.values()) note(name, placeName, cc, firstSeen, stream);

  const seen = new Map<string, SnapshotEntry>();
  for (const [place, id, name, url] of rowsOf(chunks)) {
    if (seen.has(id)) continue;
    const placeName = places.name[place], cc = places.cc[place], stream = streamHash(url);
    const known = own(before, id)?.[3] ?? gone.get(id)?.[3];
    const inherited = [earliest.get(`s\u0000${stream}`), earliest.get(`t\u0000${twinKey(name, placeName, cc)}`)]
      .filter((d): d is string => d !== undefined)
      .sort()[0];
    seen.set(id, [name, placeName, cc, known ?? inherited ?? today, stream]);
    gone.delete(id);
  }
  for (const [id, [name, placeName, cc, firstSeen, stream]] of Object.entries(before)) {
    if (!seen.has(id)) gone.set(id, [name, placeName, cc, firstSeen, today, stream]);
  }
  // Object.fromEntries defines own data properties, so an id such as "__proto__" stays plain data.
  return {
    v: 2, baseline: prev?.baseline ?? today, date: today, stations: Object.fromEntries(seen), gone: Object.fromEntries(gone),
  };
}

/**
 * Ruling 41: a day's log compares the latest snapshot with the last snapshot of the previous UTC day. A previous
 * snapshot from an earlier day (or one without a date) becomes the day base; later runs on the same day keep the
 * base they were handed, or fall back to the previous snapshot when there is none. The CLI never hands it a
 * snapshot without a date: it replaces those with a fresh baseline (isLegacy, Ruling 42).
 */
export function dayBase(prev: Snapshot | null, kept: Snapshot | null, today: string): Snapshot | null {
  if (!prev) return null;
  return !kept || prev.date < today ? prev : kept;
}

const entry = (id: string, [name, place, cc]: SnapshotEntry): Entry => ({ id, name, place, cc });
const byEntry = (a: Entry, b: Entry) => cmp(a.cc, b.cc) || cmp(a.name, b.name) || cmp(a.id, b.id);

/**
 * Stations in `next` but not in `prev` are added, the reverse removed; a removed and an added station with the
 * same stream hash are one station under a new uuid and count as changed instead (Ruling 40).
 */
export function diffSnapshots(prev: Snapshot | null, next: Snapshot): Diff {
  const ids = Object.keys(next.stations);
  if (!prev) return { added: [], removed: [], changed: [], byCountry: {}, total: ids.length, baseline: true };
  let added = ids.filter(id => !own(prev.stations, id)).map(id => entry(id, next.stations[id])).sort(byEntry);
  const removed = Object.keys(prev.stations)
    .filter(id => !own(next.stations, id))
    .map(id => entry(id, prev.stations[id]))
    .sort(byEntry);

  const removedByStream = new Map<string, Entry>();
  for (const e of removed) {
    const stream = prev.stations[e.id][4];
    if (stream && !removedByStream.has(stream)) removedByStream.set(stream, e);
  }
  const changed: Changed[] = [];
  const paired = new Set<Entry>();
  added = added.filter(e => {
    const old = removedByStream.get(next.stations[e.id][4]);
    if (!old || paired.has(old)) return true;
    paired.add(old);
    changed.push({ id: e.id, oldId: old.id, name: e.name, oldName: old.name, place: e.place, oldPlace: old.place, cc: e.cc, oldCc: old.cc });
    return false;
  });

  const counts = new Map<string, CountryChange>();
  const bump = (cc: string, k: keyof CountryChange) => {
    const c = counts.get(cc) ?? { added: 0, removed: 0, changed: 0 };
    c[k]++;
    counts.set(cc, c);
  };
  const stillRemoved = removed.filter(e => !paired.has(e));
  for (const e of added) bump(e.cc, 'added');
  for (const e of stillRemoved) bump(e.cc, 'removed');
  for (const c of changed) bump(c.cc, 'changed');
  return { added, removed: stillRemoved, changed, byCountry: Object.fromEntries(counts), total: ids.length, baseline: false };
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

function list(title: string, lines: string[]): string[] {
  if (!lines.length) return [];
  const shown = lines.slice(0, LIST_CAP);
  if (lines.length > LIST_CAP) shown.push('', `…and ${lines.length - LIST_CAP} more`);
  return ['', `## ${title}`, '', ...shown];
}

const entryLine = (e: Entry) => `- ${escapeMd(e.name)} — ${escapeMd(e.place)} (${escapeMd(e.cc)})`;

/** "- Old name — Old place → New name — New place (CC)", leaving out what did not change. */
function changedLine(c: Changed): string {
  const [name, oldName, place, oldPlace, cc, oldCc] = [c.name, c.oldName, c.place, c.oldPlace, c.cc, c.oldCc].map(escapeMd);
  const renamed = c.name !== c.oldName;
  const moved = c.place !== c.oldPlace || c.cc !== c.oldCc;
  const from = c.cc === c.oldCc ? oldPlace : `${oldPlace} (${oldCc})`;
  if (renamed && moved) return `- ${oldName} — ${from} → ${name} — ${place} (${cc})`;
  if (renamed) return `- ${oldName} → ${name} — ${place} (${cc})`;
  if (moved) return `- ${name} — ${from} → ${place} (${cc})`;
  return `- ${name} — ${place} (${cc}), re-listed`;
}

/** `upgrade`: the baseline replaces a snapshot from before Task 8c (Ruling 42). */
export function renderMarkdown(diff: Diff, today: string, total: number, upgrade = false): string {
  const head = `# Station changes ${today}`;
  const baseline = upgrade ? 'Baseline (format upgrade)' : 'Baseline';
  if (diff.baseline) return `${head}\n\n${baseline}: ${total} stations. Changes are reported from the next run on.\n`;
  const size = (c: CountryChange) => c.added + c.removed + c.changed;
  const countries = Object.keys(diff.byCountry)
    .map(cc => ({ cc, ...diff.byCountry[cc] }))
    .filter(c => size(c) > 0)
    .sort((a, b) => size(b) - size(a) || cmp(a.cc, b.cc));
  const table = countries.length
    ? [
      '',
      '| Country | Added | Removed | Changed |',
      '|:--|--:|--:|--:|',
      ...countries.map(c => `| ${escapeMd(c.cc)} | ${c.added} | ${c.removed} | ${c.changed} |`),
    ]
    : [];
  return [
    head,
    '',
    `${total} stations: ${diff.added.length} added, ${diff.removed.length} removed, ${diff.changed.length} changed.`,
    ...table,
    ...list('Added', diff.added.map(entryLine)),
    ...list('Removed', diff.removed.map(entryLine)),
    ...list('Changed', diff.changed.map(changedLine)),
    '',
  ].join('\n');
}

export function latestJson(diff: Diff, today: string, total: number): LatestJson {
  return {
    v: 1, date: today, total, added: diff.added.length, removed: diff.removed.length, changed: diff.changed.length,
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

/**
 * Ruling 42: a v1 snapshot (Task 8b) has no stream hashes, and many of its first-seen dates were born from the
 * click churn Task 8c removed. The CLI does not continue it but writes a fresh baseline; build-data still
 * prefers its ids, so the stations stay the same.
 */
export const isLegacy = (s: Snapshot): boolean => s.date === '';

/**
 * Parses a snapshot.json or day-base.json; throws on anything that is not a station snapshot. A v1 snapshot
 * (Task 8b) comes back as v2 with an unknown date ('', see isLegacy) and unknown stream hashes, so it never
 * pairs as changed.
 */
export function parseSnapshot(text: string): Snapshot {
  const s = JSON.parse(text) as Record<string, unknown>;
  const table = (t: unknown, width: number) => !!t && typeof t === 'object' && !Array.isArray(t)
    && Object.values(t).every(e => Array.isArray(e) && e.length === width && e.every(x => typeof x === 'string'));
  const shaped = !!s && typeof s === 'object' && !Array.isArray(s) && isDay(String(s.baseline));
  if (shaped && s.v === 2 && isDay(String(s.date)) && table(s.stations, 5) && table(s.gone, 6)) return s as unknown as Snapshot;
  if (shaped && s.v === 1 && table(s.stations, 4) && (s.gone === undefined || table(s.gone, 5))) {
    // Snapshots written before `gone` existed have none. Object.fromEntries keeps ids such as "__proto__" plain.
    const widen = <T>(t: unknown) => Object.fromEntries(Object.entries((t ?? {}) as Record<string, string[]>).map(([id, e]) => [id, [...e, ''] as T]));
    return { v: 2, baseline: String(s.baseline), date: '', stations: widen<SnapshotEntry>(s.stations), gone: widen<GoneEntry>(s.gone) };
  }
  throw new Error('not a v1 or v2 station snapshot');
}
