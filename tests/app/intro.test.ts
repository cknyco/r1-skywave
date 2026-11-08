import { describe, expect, it } from 'vitest';
import { introZoom, landingZoom, wantsIntro } from '../../src/app/intro';
import { INTRO_FILL, ZOOM_DEFAULT, ZOOM_MAX, ZOOM_MIN } from '../../src/config';
import { globeRadius } from '../../src/geo/mercator';

describe('the landing zoom (?z=)', () => {
  it('is ZOOM_DEFAULT without ?z or with one that is not a number', () => {
    for (const q of ['', '?place=Berlin', '?z=', '?z=%20', '?z=abc', '?z=5x', '?z=NaN', '?z=Infinity']) {
      expect(landingZoom(q)).toBe(ZOOM_DEFAULT);
    }
  });

  it('takes a number, clamped to ZOOM_MIN..ZOOM_MAX', () => {
    expect(ZOOM_DEFAULT).not.toBe(7);   // so ?z=7 below is read from the query, not the fallback
    expect(landingZoom('?z=7')).toBe(7);
    expect(landingZoom('?place=Berlin&z=6')).toBe(6);
    expect(landingZoom('?z=5.5&intro=0')).toBe(5.5);
    expect(landingZoom('?z=0')).toBe(ZOOM_MIN);
    expect(landingZoom('?z=-3')).toBe(ZOOM_MIN);
    expect(landingZoom('?z=99')).toBe(ZOOM_MAX);
  });
});

describe('the start\'s whole globe', () => {
  it('is on unless ?intro=0', () => {
    expect(wantsIntro('')).toBe(true);
    expect(wantsIntro('?place=Berlin')).toBe(true);
    expect(wantsIntro('?intro=1')).toBe(true);
    expect(wantsIntro('?intro=0')).toBe(false);
    expect(wantsIntro('?place=Berlin&intro=0&z=5')).toBe(false);
  });

  it('shows the globe INTRO_FILL of the r1\'s 240 px wide at every latitude: far out at Berlin, nearer on the equator', () => {
    const want = INTRO_FILL * 240;
    for (const lat of [0, -1.3, 35.7, 52.5, -33.9, 60.2, 70]) {
      const z = introZoom(lat, 240, 292);
      expect(Math.abs(globeRadius(z, lat) - want)).toBeLessThan(0.5);
      expect(z).toBeLessThan(ZOOM_MIN + 0.4);   // a globe with room for its atmosphere, never the tiles
    }
    expect(introZoom(52.5, 240, 292)).toBeCloseTo(0.99, 1);   // below ZOOM_MIN: at 1.4 Berlin's globe is 264 px wide
    expect(introZoom(52.5, 240, 292)).toBeLessThan(introZoom(0, 240, 292));
  });

  it('stays within zoom 0..3 near the poles, on a large screen and before the layout', () => {
    expect(introZoom(80, 240, 292)).toBe(0);
    expect(introZoom(-89, 240, 292)).toBe(0);
    expect(introZoom(0, 3000, 2000)).toBe(3);
    expect(introZoom(0, 0, 0)).toBe(0);
  });
});
