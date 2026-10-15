import { describe, expect, it } from 'vitest';
import { CityPlacer, parseAdmin1, REGION_SHARE } from '../../scripts/lib/cityplace';
import { parseGeoNames } from '../../scripts/lib/gazetteer';

// Ruling 51: a station without coordinates sits at the city its state names, or stays off the map. The rows are
// GeoNames cities15000 and admin1CodesASCII as of 2026-09-27: every city of the tested names in its country, and, for
// each region that shares its name with a city, the rest of that region's population as one row, so every share is the
// real one (Tokyo .59, Madrid .51, Shanghai .48, Bangkok .48; São Paulo .29, Rio de Janeiro .40, Quebec .07).
type Row = [name: string, ascii: string, cc: string, admin1: string, pop: number, lat: number, lon: number, fcode?: string];
const ROWS: Row[] = [
  ['Tokyo', 'Tokyo', 'JP', '40', 9733276, 35.6895, 139.69171],
  ['Beijing', 'Beijing', 'CN', '22', 18960744, 39.9075, 116.39723],
  ['Dubai', 'Dubai', 'AE', '03', 3790000, 25.07725, 55.30927],
  ['Madrid', 'Madrid', 'ES', '29', 3255944, 40.4165, -3.70256],
  ['Shanghai', 'Shanghai', 'CN', '23', 24874500, 31.22222, 121.45806],
  ['Bangkok', 'Bangkok', 'TH', '40', 5104476, 13.75398, 100.50144],
  ['Athens', 'Athens', 'GR', 'ESYE31', 664046, 37.98376, 23.72784],
  ['Berlin', 'Berlin', 'DE', '16', 3426354, 52.52437, 13.41053],
  ['Paris', 'Paris', 'FR', '11', 2138551, 48.85341, 2.3488],
  ['London', 'London', 'GB', 'ENG', 8961989, 51.50853, -0.12574],
  ['São Paulo', 'Sao Paulo', 'BR', '27', 12400232, -23.5475, -46.63611],
  ['Rio de Janeiro', 'Rio de Janeiro', 'BR', '21', 6747815, -22.90642, -43.18223],
  ['Québec', 'Quebec', 'CA', '10', 531902, 46.81228, -71.21454],
  ['Washington', 'Washington', 'US', 'DC', 689545, 38.89511, -77.03637],
  ['Washington', 'Washington', 'US', 'IL', 16664, 40.70365, -89.40731],
  ['Washington', 'Washington', 'US', 'UT', 24299, 37.13054, -113.50829],
  ['Oregon', 'Oregon', 'US', 'OH', 20102, 41.64366, -83.48688],
  ['Buenos Aires', 'Buenos Aires', 'AR', '07', 2891082, -34.61315, -58.37723],
  ['Chihuahua', 'Chihuahua', 'MX', '06', 925762, 28.63528, -106.08889],
  ['Jilin', 'Jilin', 'CN', '05', 1895865, 43.84652, 126.5608],
  ['Kawasaki', 'Kawasaki', 'JP', '19', 1538262, 35.52056, 139.71722],
  ['Kawasaki', 'Kawasaki', 'JP', '07', 17324, 33.59993, 130.81495],
  ['Springfield', 'Springfield', 'US', 'IL', 114394, 39.80172, -89.64371],
  ['Springfield', 'Springfield', 'US', 'MO', 170188, 37.21533, -93.29824],
  ['Springfield', 'Springfield', 'US', 'MA', 154341, 42.10148, -72.58981],
  ['rest of JP.40', '', 'JP', '40', 6815684, 0, 0],
  ['rest of CN.22', '', 'CN', '22', 850569, 0, 0],
  ['rest of AE.03', '', 'AE', '03', 431360, 0, 0],
  ['rest of ES.29', '', 'ES', '29', 3114487, 0, 0],
  ['rest of CN.23', '', 'CN', '23', 26539348, 0, 0],
  ['rest of TH.40', '', 'TH', '40', 5635140, 0, 0],
  ['rest of BR.27', '', 'BR', '27', 30831448, 0, 0],
  ['rest of BR.21', '', 'BR', '21', 10210533, 0, 0],
  ['rest of CA.10', '', 'CA', '10', 6806618, 0, 0],
  ['rest of MX.06', '', 'MX', '06', 2137034, 0, 0],
  ['rest of CN.05', '', 'CN', '05', 11915198, 0, 0],
  // Tokyo's 67 wards (districts, PPLX). Counted, they would drop Tokyo's share to .42; like the names, the sum leaves them out.
  ['Tokyo wards', 'Tokyo wards', 'JP', '40', 6507890, 35.69, 139.69, 'PPLX'],
];
const ADMIN1 = [
  'JP.40\tTokyo\tTokyo\t1850144',
  'CN.22\tBeijing\tBeijing\t2038349',
  'AE.03\tDubai\tDubai\t292224',
  'ES.29\tMadrid\tMadrid\t3117732',
  'CN.23\tShanghai\tShanghai\t1796231',
  'TH.40\tBangkok\tBangkok\t1609348',
  'BR.27\tSão Paulo\tSao Paulo\t3448433',
  'BR.21\tRio de Janeiro\tRio de Janeiro\t3451189',
  'CA.10\tQuebec\tQuebec\t6115047',
  'US.WA\tWashington\tWashington\t5815135',
  'US.OR\tOregon\tOregon\t5744337',
  'AR.01\tBuenos Aires\tBuenos Aires\t3435907',
  'MX.06\tChihuahua\tChihuahua\t4014336',
  'CN.05\tJilin\tJilin\t2036500',
  'DE.02\tBavaria\tBavaria\t2951839',
  'US.CA\tCalifornia\tCalifornia\t5332921',
  '',
].join('\n');

// cities15000 columns: geonameid name asciiname alternatenames lat lon fclass fcode cc cc2 admin1 admin2 admin3 admin4 pop elevation dem tz moddate
const tsv = ROWS.map(([name, ascii, cc, admin1, pop, lat, lon, fcode = 'PPL']) =>
  ['0', name, ascii, '', lat, lon, 'P', fcode, cc, '', admin1, '', '', '', pop, '', '', 'UTC', '2026-09-27'].join('\t')).join('\n');
const placer = () => new CityPlacer(parseGeoNames(tsv), parseAdmin1(ADMIN1));

describe('CityPlacer (Ruling 51)', () => {
  const p = placer();
  const city = (cc: string, state: string) => {
    const r = p.find(cc, state);
    return 'city' in r ? `${r.city.name} ${r.city.cc}` : r.reason;
  };

  it.each([
    ['JP', 'Tokyo'], ['CN', 'Beijing'], ['AE', 'Dubai'], ['ES', 'Madrid'], ['CN', 'Shanghai'], ['TH', 'Bangkok'],
  ])('places %s "%s" at the city: it is also a region, and the city holds 45 %% or more of it', (cc, state) => {
    expect(city(cc, state)).toBe(`${state} ${cc}`);
  });

  it.each([['GR', 'Athens'], ['DE', 'Berlin'], ['FR', 'Paris'], ['GB', 'London']])(
    'places %s "%s" at the city: no region has its name', (cc, state) => {
      expect(city(cc, state)).toBe(`${state} ${cc}`);
    },
  );

  it.each([
    ['BR', 'São Paulo'], ['BR', 'Rio de Janeiro'], ['CA', 'Quebec'], ['MX', 'Chihuahua'], ['CN', 'Jilin'],
  ])('leaves %s "%s" off the map: the region of that name is more than its city', (cc, state) => {
    expect(city(cc, state)).toBe('region');
  });

  it.each([['US', 'Washington'], ['US', 'Oregon'], ['AR', 'Buenos Aires']])(
    'leaves %s "%s" off the map: the city of that name lies outside the region of that name', (cc, state) => {
      expect(city(cc, state)).toBe('region');
    },
  );

  it.each([['DE', 'Bavaria'], ['US', 'California'], ['DE', 'Atlantis'], ['US', 'Tokyo'], ['CA', 'London']])(
    'leaves %s "%s" off the map: no city of that name in that country', (cc, state) => {
      expect(city(cc, state)).toBe('no city');
    },
  );

  it.each([[''], ['   '], ['—'], ['-, .']])('leaves a station with the state "%s" off the map', state => {
    expect(city('DE', state)).toBe('no state');
  });

  it('folds case, accents and punctuation as the voice matcher does', () => {
    expect(city('JP', ' TOKYO ')).toBe('Tokyo JP');
    expect(city('CN', 'beijing.')).toBe('Beijing CN');
    expect(city('CA', 'Québec')).toBe('region');
    expect(city('BR', 'SAO PAULO')).toBe('region');
  });

  it('takes the most populous city of the name', () => {
    expect(city('US', 'Springfield')).toBe('Springfield US');
    const r = p.find('US', 'Springfield');
    expect('city' in r && r.city.admin1).toBe('MO');
    const k = p.find('JP', 'Kawasaki');
    expect('city' in k && k.city.pop).toBe(1538262);
  });

  it('holds the threshold at 45 %', () => {
    expect(REGION_SHARE).toBe(0.45);
  });

  it('gives a placed station its city\'s coordinates and counts every outcome', () => {
    const q = placer();
    expect(q.place('JP', 'Tokyo')).toEqual({ lat: 35.6895, lon: 139.69171 });
    expect(q.place('BR', 'Rio de Janeiro')).toBeNull();
    expect(q.place('DE', 'Bavaria')).toBeNull();
    expect(q.place('DE', '')).toBeNull();
    expect(q.place('GB', 'London')).toEqual({ lat: 51.50853, lon: -0.12574 });
    expect(q.tally).toEqual({ placed: 2, 'no state': 1, 'no city': 1, region: 1 });
  });

  it('names the city of a state for place names without counting it', () => {
    const q = placer();
    expect(q.cityOf('JP', 'tokyo')?.name).toBe('Tokyo');
    expect(q.cityOf('BR', 'São Paulo')).toBeNull();
    expect(q.cityOf('DE', '')).toBeNull();
    expect(q.tally).toEqual({ placed: 0, 'no state': 0, 'no city': 0, region: 0 });
  });
});

describe('parseAdmin1', () => {
  it('reads code, name and ASCII name, and skips blank lines', () => {
    expect(parseAdmin1('BR.27\tSão Paulo\tSao Paulo\t3448433\n\n')).toEqual([{ code: 'BR.27', name: 'São Paulo', ascii: 'Sao Paulo' }]);
  });
});
