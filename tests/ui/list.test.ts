import { describe, expect, it } from 'vitest';
import { ListModel, toggleFav } from '../../src/ui/list';

const rows = Array.from({ length: 12 }, (_, i) => ({ place: 0, id: `s${i}`, name: `S${i}`, url: '', codec: '', bitrate: 0, tags: [] }));

describe('ListModel', () => {
  it('puts favourites first, keeping order otherwise', () => {
    const m = new ListModel(rows, new Set(['s5']));
    expect(m.rows.map(r => r.id).slice(0, 3)).toEqual(['s5', 's0', 's1']);
  });

  it('keeps one row of look-ahead below the selection', () => {
    const m = new ListModel(rows, new Set());
    for (let i = 0; i < 6; i++) m.move(1);
    const w = m.window(7);
    expect(w.rows[w.rows.length - 1].id).toBe('s7');
    expect(m.selected().id).toBe('s6');
  });

  it('clamps at both ends', () => {
    const m = new ListModel(rows, new Set());
    m.move(-1);
    expect(m.sel).toBe(0);
    for (let i = 0; i < 50; i++) m.move(1);
    expect(m.sel).toBe(11);
  });

  it('toggles favourites immutably', () => {
    const a = new Set(['x']);
    expect([...toggleFav(a, 'y')].sort()).toEqual(['x', 'y']);
    expect([...toggleFav(a, 'x')]).toEqual([]);
    expect([...a]).toEqual(['x']);
  });
});
