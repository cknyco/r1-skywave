import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { emit, sanityCheck } from './lib/emit';
import { Gazetteer, parseGeoNames } from './lib/gazetteer';
import { normalize } from './lib/normalize';
import { aggregate, capFamilies } from './lib/places';
import { fetchGeoStations, USER_AGENT } from './lib/radiobrowser';

const allowHttp = process.env.ALLOW_HTTP === '1';    // decision D4 / gate G4
const allowHls = process.env.ALLOW_HLS !== '0';      // gate G5 — HLS plays natively on the r1, on by default
const CACHE = '.cache';
const GEONAMES = 'https://download.geonames.org/export/dump/cities15000.zip';

async function geonames(): Promise<string> {
  const txt = `${CACHE}/cities15000.txt`;
  if (!existsSync(txt)) {
    mkdirSync(CACHE, { recursive: true });
    const r = await fetch(GEONAMES, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error(`GeoNames download failed: HTTP ${r.status}`);
    writeFileSync(`${CACHE}/cities15000.zip`, Buffer.from(await r.arrayBuffer()));
    execFileSync('unzip', ['-o', `${CACHE}/cities15000.zip`, '-d', CACHE]);
  }
  return readFileSync(txt, 'utf8');
}

const version = new Date().toISOString().slice(0, 10);
const rows = await fetchGeoStations();
const stations = normalize(rows, { allowHttp, allowHls });
const places = capFamilies(aggregate(stations));
const { placesJson, chunks } = emit(places, new Gazetteer(parseGeoNames(await geonames())), version);
sanityCheck(placesJson, stations.length);

rmSync('public/data', { recursive: true, force: true });
mkdirSync('public/data/st', { recursive: true });
writeFileSync('public/data/places.json', JSON.stringify(placesJson));
for (const [cc, chunk] of chunks) writeFileSync(`public/data/st/${cc}.json`, JSON.stringify(chunk));
writeFileSync('public/data/version.json', JSON.stringify({ v: version, stations: stations.length, places: places.length }));
console.log(`rows ${rows.length} → stations ${stations.length} → places ${places.length}, countries ${chunks.size}`);
