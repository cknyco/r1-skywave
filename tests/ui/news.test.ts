import { describe, expect, it } from 'vitest';
import { NEW_HEADER, newList, placeList } from '../../src/ui/news';

const rows = ['a', 'b', 'c'].map(id => ({ place: 3, id, name: id.toUpperCase(), url: `https://s/${id}`, codec: '', bitrate: 0, tags: [] }));
const news = [
  { id: 'n1', name: 'Neu FM', place: 7, placeName: 'Wien', cc: 'AT', since: '2026-09-26' },
  { id: 'n2', name: 'Alpenwelle', place: 9, placeName: 'Graz', cc: 'AT', since: '2026-09-20' },
];

describe('placeList', () => {
  it('heads the station list with the new-stations row, above favourites', () => {
    const m = placeList(rows, new Set(['c']), 2);
    expect(m.rows.map(r => r.id)).toEqual([NEW_HEADER, 'c', 'a', 'b']);
    expect(m.selected()?.name).toBe('★ New stations (2)');
  });

  it('is the plain station list when nothing is new', () => {
    expect(placeList(rows, new Set(), 0).rows.map(r => r.id)).toEqual(['a', 'b', 'c']);
  });

  it('is only the header row for a place without playable stations', () => {
    const m = placeList([], new Set(), 1);
    expect(m.rows.map(r => r.id)).toEqual([NEW_HEADER]);
  });
});

describe('newList', () => {
  it('keeps the served order (newest first) and names the place on each row', () => {
    const m = newList(news);
    expect(m.rows.map(r => r.name)).toEqual(['Neu FM · Wien', 'Alpenwelle · Graz']);
    m.move(1);
    expect(m.selected()).toMatchObject({ id: 'n2', place: 9 });
  });
});
