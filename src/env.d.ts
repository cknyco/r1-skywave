// src/env.d.ts
declare module '*.css' {
  const css: string;
  export default css;
}
/** The voice city list's URL next to app.js (build.mjs: "cities.js?v=<hash>", or "cities.js" in --serve). */
declare const __CITIES_JS__: string;
/** The WebGL globe's URL next to app.js (build.mjs: "globe-gl.js?v=<hash>", or "globe-gl.js" in --serve). */
declare const __GL_JS__: string;
