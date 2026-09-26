import type { StationRow } from '../data/store';

export class ListModel {
  rows: StationRow[];
  sel = 0;

  constructor(rows: StationRow[], fav: Set<string>) {
    this.rows = [...rows.filter(r => fav.has(r.id)), ...rows.filter(r => !fav.has(r.id))];
  }

  move(dir: number): void {
    this.sel = Math.max(0, Math.min(this.rows.length - 1, this.sel + dir));
  }

  selected(): StationRow {
    return this.rows[this.sel];
  }

  window(n = 7): { rows: StationRow[]; offset: number } {
    const maxSelRow = n - 2;
    const offset = Math.max(0, Math.min(this.sel - maxSelRow, this.rows.length - n));
    return { rows: this.rows.slice(offset, offset + n), offset };
  }
}

export function toggleFav(favs: Set<string>, id: string): Set<string> {
  const next = new Set(favs);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
