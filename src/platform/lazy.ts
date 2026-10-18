// A file that build.mjs builds as its own ES module next to app.js (a lazily loaded entry, such as the voice city list
// cities.js), imported by the URL the build defines for it. The URL is resolved against the page, and the import()
// takes an expression, not a literal, so the bundler leaves the file out of app.js.

/** The module at `url`; rejects with Error('load failed') when it cannot be fetched or run. */
export const lazyImport = <T>(url: string): Promise<T> =>
  import(new URL(url, document.baseURI).href).then(m => m as T, () => { throw new Error('load failed'); });
