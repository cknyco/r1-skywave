// CLI wrapper for the nightly-refresh fallback: re-downloads the dataset already deployed at
// https://cknyco.github.io/r1-skywave/ into public/data/, used when `npm run data` fails.
import { mkdirSync, writeFileSync } from 'node:fs';
import { fetchLiveData } from './lib/live-data';

const BASE = 'https://cknyco.github.io/r1-skywave/';

mkdirSync('public/data/st', { recursive: true });
const { places, chunks } = await fetchLiveData(BASE, fetch, (relPath, body) =>
  writeFileSync(`public/data/${relPath}`, body),
);
console.log(`live fallback: places ${places}, countries ${chunks}`);
