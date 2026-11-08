import { describe, expect, it } from 'vitest';
import { GL_FRAME_LIMIT_MS } from '../../src/config';
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
  it('probeVerdict: the median frame decides, under 25 ms', () => {
    expect(probeVerdict([5, 6, 30, 7, 8])).toEqual({ ok: true, median: 7 });
    expect(probeVerdict([24, 26, 27, 25, 28])).toEqual({ ok: false, median: 26 });
    expect(probeVerdict([24.9, 24.9, 24.9])).toEqual({ ok: true, median: 24.9 });
    expect(probeVerdict([25, 25, 25]).ok).toBe(false);   // under, not at
    expect(probeVerdict([4, 4, 4], 3).ok).toBe(false);
    expect(probeVerdict([]).ok).toBe(false);
  });

  it('the limit is 25 ms (the user\'s decision of 2026-11-08): the r1\'s probe median of 18.1 ms now picks WebGL', () => {
    expect(GL_FRAME_LIMIT_MS).toBe(25);
    expect(probeVerdict([17.6, 18.1, 18.4, 17.9, 19.2])).toEqual({ ok: true, median: 18.1 });   // was "slow (18.1 ms)" at 12
    expect(probeVerdict([17.6, 18.1, 18.4, 17.9, 19.2], 12).ok).toBe(false);
  });
});
