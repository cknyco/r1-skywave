import { describe, expect, it } from 'vitest';
import { FAV_HEADER, HEADS, NEW_HEADER, isHeader, newList, placeList } from '../../src/ui/news';

const rows = ['a', 'b', 'c'].map(id => ({ place: 3, id, name: id.toUpperCase(), url: `https://s/${id}`, codec: '', bitrate: 0, tags: [] }));
const news = [
  { id: 'n1', name: 'Neu FM', place: 7, placeName: 'Wien', cc: 'AT', since: '2026-09-26' },
  { id: 'n2', name: 'Alpenwelle', place: 9, placeName: 'Graz', cc: 'AT', since: '2026-09-20' },
];

describe('placeList', () => {
  it('heads the station list with the two worldwide rows, above the favourites, and selects the first station', () => {
    const m = placeList(rows, new Set(['c']), 2, 5);
    expect(m.rows.map(r => r.id)).toEqual([NEW_HEADER, FAV_HEADER, 'c', 'a', 'b']);
    expect(m.rows.slice(0, HEADS).map(r => r.name)).toEqual(['★ New stations worldwide (2)', '♥ My favourites (5)']);
    expect(m.selected()?.id).toBe('c');
  });

  it('keeps both header rows when nothing is new and nothing is a favourite (Rulings 45, 47)', () => {
    const m = placeList(rows, new Set(), 0, 0);
    expect(m.rows.map(r => r.name).slice(0, 2)).toEqual(['★ New stations worldwide (0)', '♥ My favourites (0)']);
    expect(m.selected()?.id).toBe('a');
  });

  it('is only the header rows for a place without playable stations, the first selected', () => {
    const m = placeList([], new Set(), 1, 0);
    expect(m.rows.map(r => r.id)).toEqual([NEW_HEADER, FAV_HEADER]);
    expect(m.selected()?.id).toBe(NEW_HEADER);
  });

  it('tells header rows from stations', () => {
    expect([NEW_HEADER, FAV_HEADER, 'a'].map(isHeader)).toEqual([true, true, false]);
  });
});

describe('newList', () => {
  it('keeps the served order (newest first) and labels each row "Name — Place, CC"', () => {
    const m = newList(news);
    expect(m.rows.map(r => r.name)).toEqual(['Neu FM — Wien, AT', 'Alpenwelle — Graz, AT']);
    expect(m.selected()).toMatchObject({ id: 'n1', place: 7 });
    m.move(1);
    expect(m.selected()).toMatchObject({ id: 'n2', place: 9 });
  });
});
