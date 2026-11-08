import type { APIRequestContext } from '@playwright/test';
import { ZOOM_DEFAULT } from '../src/config';
import { project } from '../src/geo/mercator';
import { dotRadius } from '../src/map/lod';
import { fold } from '../src/voice/fold';

/** A one-station place inside a big city's dot at the landing zoom, with its playable station (smallPlaces). */
export interface SmallPlace {
  place: number; count: number; placeName: string; cc: string; id: string; station: string; nb: number; nbName: string;
}

/**
 * One-station places inside a big city's dot at the landing zoom (the user's choice of 2026-10-18): 1 station, so below
 * what the ring catches there, a playable station and a name of their own; a place of over 20 stations so near (under
 * its dot's radius less 1 px at ZOOM_DEFAULT) that its dot covers the screen's centre while the small place is in the
 * ring. Biggest neighbour first. Read from the served data, which changes every night; `P` is that places.json.
 */
export async function smallPlaces(request: APIRequestContext): Promise<{ P: any; out: SmallPlace[] }> {
  const P = await (await request.get('/data/places.json')).json();
  const names = new Map<string, number>();
  for (const n of P.name as string[]) names.set(fold(n), (names.get(fold(n)) ?? 0) + 1);
  const at = (i: number) => project(P.lon[i], P.lat[i], ZOOM_DEFAULT);
  const big = (P.count as number[]).flatMap((c, j) => (c > 20 ? [j] : []));
  const found: { place: number; nb: number }[] = [];
  for (let i = 0; i < P.name.length; i++) {
    if (P.count[i] !== 1 || names.get(fold(P.name[i])) !== 1) continue;
    const a = at(i);
    let nb = -1;
    for (const j of big) {
      const b = at(j);
      if (Math.hypot(a.x - b.x, a.y - b.y) < dotRadius(P.count[j]) - 1 && (nb < 0 || P.count[j] > P.count[nb])) nb = j;
    }
    if (nb >= 0) found.push({ place: i, nb });
  }
  found.sort((a, b) => P.count[b.nb] - P.count[a.nb]);
  const out: SmallPlace[] = [];
  for (const f of found) {
    const st = await (await request.get(`/data/st/${P.cc[f.place]}.json`)).json();
    const r = (st.rows as unknown[][]).find(x => x[0] === f.place && String(x[3]).startsWith('https://') && !String(x[3]).includes('radio.garden'));
    if (r) {
      out.push({
        ...f, count: P.count[f.place], placeName: P.name[f.place], cc: P.cc[f.place], id: String(r[1]), station: String(r[2]),
        nbName: P.name[f.nb],
      });
    }
  }
  return { P, out };
}
