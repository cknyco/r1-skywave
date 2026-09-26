// src/map/tile-source.ts
import type { TileSource } from './tiles';

/** EOX Sentinel-2 cloudless 2016: global, no key, CC BY 4.0. WMTS order is {z}/{y}/{x}. */
export const TILE_SOURCE: TileSource = {
  url: (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless_3857/default/g/${z}/${y}/${x}.jpg`,
  maxZ: 13,
  attribution: '© EOX, Copernicus Sentinel 2016',
};
