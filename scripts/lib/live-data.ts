// Fallback source for the nightly refresh: when `npm run data` (Radio Browser + GeoNames) fails,
// re-download the dataset the site is already serving so a run never leaves stale/partial data.

const MIN_PLACES = 2000; // same threshold as emit.ts sanityCheck

interface LivePlaces {
  cc: string[];
}

export async function fetchLiveData(
  base: string,
  fetchFn: typeof fetch,
  write: (relPath: string, body: string) => void,
): Promise<{ places: number; chunks: number }> {
  const placesUrl = `${base}data/places.json`;
  const placesRes = await fetchFn(placesUrl);
  if (!placesRes.ok) throw new Error(`live data fetch failed: HTTP ${placesRes.status} ${placesUrl}`);
  const placesBody = await placesRes.text();
  const places = JSON.parse(placesBody) as LivePlaces;
  if (!Array.isArray(places.cc) || places.cc.length < MIN_PLACES) {
    throw new Error(`live dataset suspiciously small: ${places.cc?.length ?? 0} places`);
  }

  const ccs = [...new Set(places.cc)];
  const chunkBodies = new Map<string, string>();
  for (const cc of ccs) {
    const url = `${base}data/st/${cc}.json`;
    const r = await fetchFn(url);
    if (!r.ok) throw new Error(`live data fetch failed: HTTP ${r.status} ${url}`);
    chunkBodies.set(cc, await r.text());
  }

  const versionUrl = `${base}data/version.json`;
  const versionRes = await fetchFn(versionUrl);
  if (!versionRes.ok) throw new Error(`live data fetch failed: HTTP ${versionRes.status} ${versionUrl}`);
  const versionBody = await versionRes.text();

  // Only write once every download has succeeded, so a failed run never leaves partial files.
  write('places.json', placesBody);
  for (const [cc, body] of chunkBodies) write(`st/${cc}.json`, body);
  write('version.json', versionBody);

  return { places: places.cc.length, chunks: ccs.length };
}
