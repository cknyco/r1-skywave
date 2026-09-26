const N = 4096; // grid resolution: 360°/4096 ≈ 0.09°

export function xy2d(n: number, x: number, y: number): number {
  let d = 0;
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (x & s) > 0 ? 1 : 0;
    const ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = n - 1 - x; y = n - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return d;
}

export interface Walk { order: Uint32Array; rank: Int32Array }

export function buildWalk(lon: ArrayLike<number>, lat: ArrayLike<number>): Walk {
  const n = lon.length;
  const key = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const x = Math.min(N - 1, Math.floor(((lon[i] + 180) / 360) * N));
    const y = Math.min(N - 1, Math.floor(((lat[i] + 90) / 180) * N));
    key[i] = xy2d(N, x, y);
  }
  const order = Uint32Array.from({ length: n }, (_, i) => i).sort((a, b) => key[a] - key[b]);
  const rank = new Int32Array(n);
  order.forEach((p, r) => { rank[p] = r; });
  return { order, rank };
}

export function stepWalk(walk: Walk, current: number, dir: 1 | -1, eligible: (i: number) => boolean): number {
  const n = walk.order.length;
  let r = current >= 0 ? walk.rank[current] : dir > 0 ? -1 : 0;
  for (let k = 0; k < n; k++) {
    r = (r + dir + n) % n;
    const p = walk.order[r];
    if (p !== current && eligible(p)) return p;
  }
  return -1;
}
