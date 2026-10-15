import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { CityPlacer, parseAdmin1 } from './lib/cityplace';
import { emit, sanityCheck } from './lib/emit';
import { Gazetteer, parseGeoNames } from './lib/gazetteer';
import { readPrefer, stationPlaces } from './lib/pipeline';
import { fetchStations, USER_AGENT } from './lib/radiobrowser';

const allowHttp = process.env.ALLOW_HTTP === '1';    // decision D4 / gate G4
const allowHls = process.env.ALLOW_HLS !== '0';      // gate G5 — HLS plays natively on the r1, on by default
const prevSnapshot = process.env.PREV_SNAPSHOT;      // Rulings 39, 42 — the previous run's snapshot.json, if any
const CACHE = '.cache';
const GEONAMES = 'https://download.geonames.org/export/dump/';

/** A GeoNames dump file, downloaded once into .cache (the pages workflow caches the directory); `zip`: fetched zipped. */
async function geonames(file: string, zip = false): Promise<string> {
  const txt = `${CACHE}/${file}`;
  if (!existsSync(txt)) {
    mkdirSync(CACHE, { recursive: true });
    const name = zip ? file.replace(/\.txt$/, '.zip') : file;
    const r = await fetch(GEONAMES + name, { headers: { 'User-Agent': USER_AGENT } });
    if (!r.ok) throw new Error(`GeoNames download failed: HTTP ${r.status} (${name})`);
    const body = Buffer.from(await r.arrayBuffer());
    if (zip) {
      writeFileSync(`${CACHE}/${name}`, body);
      execFileSync('unzip', ['-o', `${CACHE}/${name}`, '-d', CACHE]);
    } else {
      writeFileSync(txt, body);
    }
  }
  return readFileSync(txt, 'utf8');
}

const version = new Date().toISOString().slice(0, 10);
// The previous snapshot's stations and gone ids keep their stream, their broadcaster slot and their place anchor.
const prefer = readPrefer(prevSnapshot);
const cities = parseGeoNames(await geonames('cities15000.txt', true));
// Ruling 51: a station without coordinates sits at the city its state names, or stays off the map.
const admin1 = parseAdmin1(await geonames('admin1CodesASCII.txt'));
// A body that is not the TSV (an error page) would turn the region guard off without a word: fail instead, so the
// nightly job deploys the last live dataset, and drop the file from .cache so the next run downloads it again.
if (admin1.length < 3000) {
  rmSync(`${CACHE}/admin1CodesASCII.txt`, { force: true });
  throw new Error(`GeoNames admin1CodesASCII.txt has only ${admin1.length} regions (about 3,900 expected)`);
}
const placer = new CityPlacer(cities, admin1);
const rows = await fetchStations();
const { stations, places } = stationPlaces(rows, { allowHttp, allowHls, prefer, place: (cc, state) => placer.place(cc, state) });
const { placesJson, chunks } = emit(places, new Gazetteer(cities), version, (cc, state) => placer.cityOf(cc, state));
sanityCheck(placesJson, stations.length);

rmSync('public/data', { recursive: true, force: true });
mkdirSync('public/data/st', { recursive: true });
writeFileSync('public/data/places.json', JSON.stringify(placesJson));
for (const [cc, chunk] of chunks) writeFileSync(`public/data/st/${cc}.json`, JSON.stringify(chunk));
writeFileSync('public/data/version.json', JSON.stringify({ v: version, stations: stations.length, places: places.length }));
const t = placer.tally;
console.log(`rows ${rows.length} → stations ${stations.length} → places ${places.length}, countries ${chunks.size}, ${prefer.size} known ids`);
console.log(`without coordinates: ${t.placed} placed at their city (${stations.filter(s => s.placed).length} kept after the `
  + `stream dedupe), ${t['no state']} no state, ${t['no city']} no known city, ${t.region} a region, not its city`);
