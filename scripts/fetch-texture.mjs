// Bakes the world texture for the globe view from NASA GIBS (public domain).
import { writeFileSync, mkdirSync } from 'node:fs';

const layer = 'BlueMarble_ShadedRelief_Bathymetry';
const url = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&REQUEST=GetMap&VERSION=1.3.0'
  + `&LAYERS=${layer}&STYLES=&CRS=EPSG:4326&BBOX=-90,-180,90,180&WIDTH=2048&HEIGHT=1024&FORMAT=image/jpeg`;
const r = await fetch(url, { headers: { 'User-Agent': 'skywave-build/0.1' } });
const type = r.headers.get('content-type') ?? '';
if (!r.ok || !type.startsWith('image/')) throw new Error(`GIBS ${layer}: HTTP ${r.status} ${type}`);
mkdirSync('public/img', { recursive: true });
const buf = Buffer.from(await r.arrayBuffer());
writeFileSync('public/img/earth-2048.jpg', buf);
console.log(`public/img/earth-2048.jpg ${layer} ${buf.length} bytes`);
