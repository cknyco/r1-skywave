import type { NewStation, StationRow } from '../data/store';
import { worldList } from './favs';
import { ListModel } from './list';

/** Id of the synthetic first row that switches the station list to the new stations worldwide (Ruling 45). */
export const NEW_HEADER = '__new__';
/** Id of the synthetic second row that switches it to the favourites worldwide (Ruling 47). */
export const FAV_HEADER = '__favs__';
/** How many header rows head every place list. */
export const HEADS = 2;

export const isHeader = (id: string) => id === NEW_HEADER || id === FAV_HEADER;

const header = (id: string, name: string): StationRow => ({ place: -1, id, name, url: '', codec: '', bitrate: 0, tags: [] });
export const newHeaderName = (n: number) => `★ New stations worldwide (${n})`;
export const favHeaderName = (n: number) => `♥ My favourites (${n})`;

/**
 * The place's station list (favourites first, as in Task 19), always headed by "★ New stations worldwide (N)" and
 * "♥ My favourites (M)", also when N or M is 0. The first station is selected; a place without stations selects the
 * first header row.
 */
export function placeList(rows: StationRow[], favs: Set<string>, newCount: number, favCount: number): ListModel {
  const m = new ListModel(rows, favs);
  m.rows.unshift(header(NEW_HEADER, newHeaderName(newCount)), header(FAV_HEADER, favHeaderName(favCount)));
  m.sel = m.rows.length > HEADS ? HEADS : 0;
  return m;
}

/** The new stations in served order (newest first) as "Name — Place, CC". No URL: data/new.json has none. */
export function newList(news: NewStation[]): ListModel {
  return worldList(news);
}
