import { describe, expect, it } from 'vitest';
import { pickAtCenter } from '../../src/map/pick';

describe('pickAtCenter', () => {
  const c = { x: 120, y: 141 };
  it('prefers the biggest dot whose disc covers the centre', () => {
    const dots = [{ i: 1, x: 121, y: 141, count: 2 }, { i: 2, x: 122, y: 142, count: 30 }];
    expect(pickAtCenter(dots, c.x, c.y, 28, -1)).toBe(2);
  });
  it('falls back to the nearest dot inside the ring', () => {
    const dots = [{ i: 1, x: 140, y: 141, count: 2 }, { i: 2, x: 130, y: 150, count: 2 }];
    expect(pickAtCenter(dots, c.x, c.y, 28, -1)).toBe(2);
  });
  it('keeps the current place while it is still inside the ring (no flicker)', () => {
    const dots = [{ i: 1, x: 140, y: 141, count: 2 }, { i: 2, x: 130, y: 150, count: 2 }];
    expect(pickAtCenter(dots, c.x, c.y, 28, 1)).toBe(1);
  });
  it('returns -1 over empty ocean', () => {
    expect(pickAtCenter([{ i: 1, x: 10, y: 10, count: 5 }], c.x, c.y, 28, -1)).toBe(-1);
  });
});
