import type { NewStation, StationRow } from '../data/store';
import { ListModel } from './list';

/** Id of the synthetic first row that switches the station list to the new stations. */
export const NEW_HEADER = '__new__';

/** The place's station list (favourites first, as in Task 19), headed by "★ New stations (N)" when N > 0. */
export function placeList(rows: StationRow[], favs: Set<string>, newCount: number): ListModel {
  const m = new ListModel(rows, favs);
  if (newCount > 0) {
    m.rows.unshift({ place: -1, id: NEW_HEADER, name: `★ New stations (${newCount})`, url: '', codec: '', bitrate: 0, tags: [] });
  }
  return m;
}

/** The new stations in served order (newest first); each row names its place. No URL: data/new.json has none. */
export function newList(news: NewStation[]): ListModel {
  return new ListModel(news.map(n => ({
    place: n.place, id: n.id, name: `${n.name} · ${n.placeName}`, url: '', codec: '', bitrate: 0, tags: [],
  })), new Set());
}
