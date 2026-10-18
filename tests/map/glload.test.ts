import { describe, expect, it } from 'vitest';
import { globeMode, probeVerdict } from '../../src/map/gl-load';

describe('globeMode (?globe=…)', () => {
  it('reads gl, mediump and 2d from the query; anything else is auto', () => {
    expect(globeMode('?globe=gl')).toBe('gl');
    expect(globeMode('?place=Berlin&globe=mediump')).toBe('mediump');
    expect(globeMode('?globe=2d')).toBe('2d');
    expect(globeMode('')).toBe('auto');
    expect(globeMode('?globe=x')).toBe('auto');
  });
});

describe('probeVerdict (auto mode)', () => {
  it('probeVerdict: the median frame decides, under 12 ms', () => {
    expect(probeVerdict([5, 6, 30, 7, 8])).toEqual({ ok: true, median: 7 });
    expect(probeVerdict([11, 13, 14, 12, 15])).toEqual({ ok: false, median: 13 });
    expect(probeVerdict([11.9, 11.9, 11.9])).toEqual({ ok: true, median: 11.9 });
    expect(probeVerdict([4, 4, 4], 3).ok).toBe(false);
    expect(probeVerdict([]).ok).toBe(false);
  });
});
