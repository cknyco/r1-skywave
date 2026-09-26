// Ruling 47: favourites with what the worldwide list needs to show and play them ("Name — Place, CC") without loading
// every country's stations. Stored under a new key, 'favs2' = { v: 2, items }, newest first. The app before P3 kept
// bare station ids under 'favs'; those are carried over as unresolved entries and filled in as soon as a country chunk
// that holds them loads (DataStore.onRows), since an id alone says nothing about its country. None is dropped.
import type { Places, StationRow } from '../data/store';
import { ListModel } from './list';

/**
 * One favourite, or one row of a worldwide list (the new stations have the same fields). `place` is -1 and `name` ''
 * while a carried-over id is not resolved yet.
 */
export interface Fav { id: string; name: string; place: number; placeName: string; cc: string }

export const FAVS_KEY = 'favs2';
export const LEGACY_FAVS_KEY = 'favs';

export interface FavsDoc { v: 2; items: Fav[] }

export const unresolved = (id: string): Fav => ({ id, name: '', place: -1, placeName: '', cc: '' });

/** The favourite for a station of a place list. */
export const favOf = (row: Pick<StationRow, 'id' | 'name' | 'place'>, places: Places): Fav =>
  ({ id: row.id, name: row.name, place: row.place, placeName: places.name[row.place] ?? '', cc: places.cc[row.place] ?? '' });

/** The place a stored favourite means in today's dataset: the same index if its name still matches, else by name and country. */
function anchor(f: Fav, places: Places): number {
  const p = f.place;
  if (Number.isInteger(p) && p >= 0 && p < places.n && places.name[p] === f.placeName && places.cc[p] === f.cc) return p;
  if (!f.placeName) return -1;
  let best = -1;
  for (let i = 0; i < places.n; i++) {
    if (places.name[i] === f.placeName && places.cc[i] === f.cc && (best < 0 || places.count[i] > places.count[best])) best = i;
  }
  return best;
}

const str = (v: unknown) => (typeof v === 'string' ? v : '');

/**
 * The favourites from storage: `doc` is the parsed 'favs2' value, `legacy` the parsed old 'favs' (bare ids). 'favs2'
 * wins once it exists; before that, every old id becomes an unresolved entry. Duplicates and malformed entries go.
 */
export function loadFavs(doc: unknown, legacy: unknown, places: Places): Fav[] {
  const d = doc as Partial<FavsDoc> | null;
  const raw: unknown[] = d && d.v === 2 && Array.isArray(d.items) ? d.items
    : Array.isArray(legacy) ? legacy.filter((x): x is string => typeof x === 'string' && x !== '').map(unresolved) : [];
  const seen = new Set<string>();
  const out: Fav[] = [];
  for (const x of raw) {
    const o = x as Partial<Fav> | null;
    if (!o || typeof o.id !== 'string' || !o.id || seen.has(o.id)) continue;
    seen.add(o.id);
    const f: Fav = { id: o.id, name: str(o.name), place: typeof o.place === 'number' ? o.place : -1, placeName: str(o.placeName), cc: str(o.cc) };
    out.push({ ...f, place: anchor(f, places) });
  }
  return out;
}

/** Fills in favourites that miss their station or place from freshly loaded rows; null when nothing changed. */
export function resolveFavs(favs: Fav[], rows: StationRow[], places: Places): Fav[] | null {
  if (!favs.some(f => f.place < 0 || !f.name)) return null;
  const byId = new Map(rows.map(r => [r.id, r]));
  let changed = false;
  const out = favs.map(f => {
    const r = f.place < 0 || !f.name ? byId.get(f.id) : undefined;
    if (!r) return f;
    changed = true;
    return favOf(r, places);
  });
  return changed ? out : null;
}

/** Adds the station at the top (most recently added first), or removes it when it is already a favourite. */
export function toggleFav(favs: Fav[], f: Fav): Fav[] {
  return favs.some(x => x.id === f.id) ? removeFav(favs, f.id) : [{ id: f.id, name: f.name, place: f.place, placeName: f.placeName, cc: f.cc }, ...favs];
}

export const removeFav = (favs: Fav[], id: string): Fav[] => favs.filter(f => f.id !== id);

export const favIds = (favs: Fav[]): Set<string> => new Set(favs.map(f => f.id));

export const favsDoc = (favs: Fav[]): FavsDoc => ({ v: 2, items: favs });

/** "Name — Place, CC"; a carried-over id not resolved yet has neither. */
export function worldLabel(f: Fav): string {
  if (!f.name) return 'Saved station · place unknown';
  return f.placeName ? `${f.name} — ${f.placeName}, ${f.cc}` : f.name;
}

/** A worldwide list (favourites, new stations) in the given order, the first row selected; each row's name is its label. */
export function worldList(items: Fav[]): ListModel {
  return new ListModel(items.map(f => ({ place: f.place, id: f.id, name: worldLabel(f), url: '', codec: '', bitrate: 0, tags: [] })), new Set());
}
