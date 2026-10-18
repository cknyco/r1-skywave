/** A place on screen (CSS px); z is its depth on the globe (0 at the limb, 1 facing the viewer), absent in the tile view. */
export interface ScreenDot { i: number; x: number; y: number; count: number; z?: number }

/** CSS px beyond the view where places still count, so that lights just off the edge glow into it. */
export const MARGIN = 16;

/** Places below this station count are hidden at zoom z. */
export function minCountForZoom(z: number): number {
  return z < 2.5 ? 20 : z < 4 ? 5 : z < 5.5 ? 2 : 1;
}

export function dotRadius(count: number): number {
  return count > 20 ? 5 : count > 5 ? 3.5 : 2.5;
}

/** Greedy screen-space clustering: biggest dots claim their neighbourhood first. */
export function clusterScreen(dots: ScreenDot[], cellPx: number): ScreenDot[] {
  const sorted = [...dots].sort((a, b) => b.count - a.count);
  const grid = new Map<string, ScreenDot[]>();
  const out: ScreenDot[] = [];
  const r2 = cellPx * cellPx;
  for (const d of sorted) {
    const gx = Math.floor(d.x / cellPx), gy = Math.floor(d.y / cellPx);
    let host: ScreenDot | undefined;
    for (let ox = -1; ox <= 1 && !host; ox++) {
      for (let oy = -1; oy <= 1 && !host; oy++) {
        for (const c of grid.get(`${gx + ox},${gy + oy}`) ?? []) {
          const dx = c.x - d.x, dy = c.y - d.y;
          if (dx * dx + dy * dy < r2) { host = c; break; }
        }
      }
    }
    if (host) { host.count += d.count; continue; }
    const kept = { ...d };
    out.push(kept);
    const key = `${gx},${gy}`;
    const cell = grid.get(key);
    if (cell) cell.push(kept); else grid.set(key, [kept]);
  }
  return out;
}
