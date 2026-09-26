import { dotRadius, type ScreenDot } from './lod';

/** radio.garden's rule, plus hysteresis: largest dot covering the centre, else keep current, else nearest in the ring. */
export function pickAtCenter(dots: ScreenDot[], cx: number, cy: number, ringR: number, current: number): number {
  let inside = -1, insideCount = -1, nearest = -1, nearestD = Infinity, currentOk = false;
  for (const d of dots) {
    const dist = Math.hypot(d.x - cx, d.y - cy);
    const r = dotRadius(d.count);
    if (dist > ringR + r) continue;
    if (d.i === current) currentOk = true;
    if (dist <= r && d.count > insideCount) { inside = d.i; insideCount = d.count; }
    if (dist < nearestD) { nearestD = dist; nearest = d.i; }
  }
  if (inside >= 0) return inside;
  if (currentOk) return current;
  return nearest;
}
