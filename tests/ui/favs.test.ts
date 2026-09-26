import { describe, expect, it } from 'vitest';
import type { Places, StationRow } from '../../src/data/store';
import {
  favIds, favOf, favsDoc, loadFavs, removeFav, resolveFavs, toggleFav, unresolved, worldLabel, worldList, type Fav,
} from '../../src/ui/favs';

const places: Places = {
  v: 't', n: 3, lat: new Float32Array(3), lon: new Float32Array(3), count: Uint16Array.from([5, 40, 9]),
  name: ['Wien', 'Berlin', 'Berlin'], cc: ['AT', 'DE', 'US'], tz: ['', '', ''],
};
const row = (id: string, place: number, name = id.toUpperCase()): StationRow =>
  ({ place, id, name, url: `https://${id}`, codec: '', bitrate: 0, tags: [] });
const fav = (id: string, place: number, name = id.toUpperCase()): Fav => favOf(row(id, place, name), places);

describe('favourites (Ruling 47)', () => {
  it('stores what the worldwide list shows', () => {
    expect(fav('a', 1)).toEqual({ id: 'a', name: 'A', place: 1, placeName: 'Berlin', cc: 'DE' });
    expect(favsDoc([fav('a', 1)])).toEqual({ v: 2, items: [fav('a', 1)] });
  });

  it('adds at the top and removes with the same gesture', () => {
    let f = toggleFav([], fav('a', 0));
    f = toggleFav(f, fav('b', 1));
    expect(f.map(x => x.id)).toEqual(['b', 'a']);
    f = toggleFav(f, fav('a', 0));
    expect(f.map(x => x.id)).toEqual(['b']);
    expect(removeFav(f, 'b')).toEqual([]);
    expect([...favIds([fav('a', 0), fav('b', 1)])]).toEqual(['a', 'b']);
  });

  it('keeps only the favourite fields of a new station', () => {
    const n = { id: 'n', name: 'Neu', place: 0, placeName: 'Wien', cc: 'AT', since: '2026-09-26' };
    expect(toggleFav([], n)).toEqual([{ id: 'n', name: 'Neu', place: 0, placeName: 'Wien', cc: 'AT' }]);
  });

  it('carries every id saved before P3 over, unresolved; favs2 wins once it exists', () => {
    expect(loadFavs(null, ['x', 'y', 'x', '', 7], places)).toEqual([unresolved('x'), unresolved('y')]);
    expect(loadFavs(favsDoc([fav('a', 1)]), ['x'], places)).toEqual([fav('a', 1)]);
    expect(loadFavs(null, null, places)).toEqual([]);
    expect(loadFavs({ v: 3, items: [] }, ['x'], places)).toEqual([unresolved('x')]);   // an unknown format falls back
    expect(loadFavs({ v: 2, items: [null, { id: 5 }, { id: 'a', name: 'A', place: 1, placeName: 'Berlin', cc: 'DE' }] }, null, places))
      .toEqual([fav('a', 1)]);
  });

  it('finds a favourite\'s place again in a new dataset by name and country, else leaves it unplaced', () => {
    const moved = { v: 2, items: [{ id: 'a', name: 'A', place: 0, placeName: 'Berlin', cc: 'US' }] };
    expect(loadFavs(moved, null, places)[0].place).toBe(2);
    const gone = { v: 2, items: [{ id: 'a', name: 'A', place: 1, placeName: 'Atlantis', cc: 'DE' }] };
    expect(loadFavs(gone, null, places)[0]).toMatchObject({ id: 'a', name: 'A', place: -1 });
  });

  it('resolves carried-over ids from a loaded chunk, and reports no change otherwise', () => {
    const favs = [unresolved('x'), fav('a', 1), unresolved('y')];
    const next = resolveFavs(favs, [row('x', 0, 'Xtra'), row('a', 1, 'Renamed')], places)!;
    expect(next).toEqual([{ id: 'x', name: 'Xtra', place: 0, placeName: 'Wien', cc: 'AT' }, fav('a', 1), unresolved('y')]);
    expect(resolveFavs(next, [row('z', 0)], places)).toBeNull();
    expect(resolveFavs([fav('a', 1)], [row('a', 1)], places)).toBeNull();
  });

  it('labels rows "Name — Place, CC" and keeps the given order', () => {
    expect(worldLabel(fav('a', 1, 'Radio Eins'))).toBe('Radio Eins — Berlin, DE');
    expect(worldLabel(unresolved('x'))).toBe('Saved station · place unknown');
    const l = worldList([fav('b', 1), fav('a', 0)]);
    expect(l.rows.map(r => [r.id, r.place, r.name])).toEqual([['b', 1, 'B — Berlin, DE'], ['a', 0, 'A — Wien, AT']]);
    expect(l.sel).toBe(0);
  });
});
