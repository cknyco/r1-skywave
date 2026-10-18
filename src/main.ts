// Skywave (Tasks 18-20): the map app. It grew out of the sound preview (Task P): the same gate, controls, voice
// session, station list and storage, with the map (Task 13) where the preview had its text screen. Task P3 added the
// voice fast path and log (Ruling 44), the worldwide lists of new stations and favourites (Rulings 45, 47), the
// never-black tile ground and tile prefetch (Ruling 46), and the resize path. Task P4a made the wheel the volume, with a
// ✈ fly mode for places (Ruling 49), and put About behind a ⓘ button (Ruling 50). The glowing-globe plan's Task 1 lets a
// side click at the gate tune in, and loads the voice city list as a file of its own (cities.js) on the first voice hold;
// its Tasks 4 and 5 draw the globe with WebGL (globe-gl.js, another file of its own) where a frame-time probe finds it
// fast enough, with the Canvas 2D globe as the fallback and the choice in About.
import css from './ui/styles.css';
import {
  NOTE, isRefusal, lastOf, listTitle, listView, msToNextMinute, placeForIntent, playable, sharePlayer, startPlace,
  stripModel, viewport, type Last, type ListMode,
} from './app/logic';
import { FLY_OFF, VOLUME_KEY, flyEnds, flyNext, readVolume, stepVolume, volumeView, type FlyEvent, type WheelMode } from './app/wheel';
import { Player } from './audio/player';
import { createStatic, type Static } from './audio/static';
import { Tuner } from './audio/tuner';
import {
  CITIES_WAIT_MS, CONNECT_TIMEOUT_MS, GATE_TRY_MS, GL_PROBE_FRAMES, GLOBE_BELOW_ZOOM, NEIGHBOUR_PREFETCH,
  PREFETCH_DELAY_MS, RB_BASE, SETTLE_MS, TEXTURE_URL, VOLUME_SAVE_MS, ZOOM_DEFAULT,
} from './config';
import { DataStore, type NewStation, type StationRow } from './data/store';
import { bindControls, type Action } from './input/controls';
import { globeMode, loadGlGlobe, probeVerdict } from './map/gl-load';
import { Globe, loadTexture } from './map/globe';
import { minCountForZoom } from './map/lod';
import { TILE_SOURCE } from './map/tile-source';
import { mercatorBase, TileLayer } from './map/tiles';
import { MapView, viewSize } from './map/view';
import { buildWalk, stepWalk } from './map/walk';
import { lazyImport } from './platform/lazy';
import {
  askLLM, installKeyboardFallback, installMessageHook, onPluginMessage, startVoice, stopVoice, type PluginMessage,
} from './platform/r1';
import { createStore, loadJson, saveJson } from './platform/storage';
import {
  FAVS_KEY, LEGACY_FAVS_KEY, favIds, favOf, favsDoc, loadFavs, removeFav, resolveFavs, toggleFav, worldList, type Fav,
} from './ui/favs';
import type { ListModel } from './ui/list';
import { FAV_HEADER, HEADS, NEW_HEADER, favHeaderName, isHeader, newList, placeList } from './ui/news';
import { AppScreen } from './ui/screen';
import { Diag, kindOf } from './voice/diag';
import { intentPrompt, readReply } from './voice/intent';
import { createMatcher, type Matcher } from './voice/match';
import { createVoiceSession } from './voice/session';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const screen = new AppScreen();
const size = viewport(window.innerWidth, window.innerHeight);
screen.fit(size.w, size.h);   // before MapView measures #app

const audio = new Audio();   // the one media element; the gate tap unlocks it
audio.preload = 'none';
let noise: Static | undefined;

async function boot(): Promise<() => void> {
  installMessageHook();
  installKeyboardFallback();
  const kv = createStore();
  const data = new DataStore('data/');
  const [places, texture] = await Promise.all([data.load(), loadTexture(TEXTURE_URL)]);
  const walk = buildWalk(places.lon, places.lat);
  const last = await loadJson<Last | null>(kv, 'last', null);
  // Ruling 49: the volume, 0–100 % of the r1's own, remembered. The element keeps it when its src changes, so it holds
  // for every stream; the tuning static follows it once the gate tap has made it.
  let volume = readVolume(await loadJson<unknown>(kv, VOLUME_KEY, null));
  audio.volume = volume / 100;
  // Ruling 47: favourites with their names and places; ids saved by the app before P3 are carried over unresolved.
  let favs: Fav[] = loadFavs(await loadJson<unknown>(kv, FAVS_KEY, null), await loadJson<unknown>(kv, LEGACY_FAVS_KEY, null), places);
  const saveFavs = () => { void saveJson(kv, FAVS_KEY, favsDoc(favs)); };
  const query = new URLSearchParams(location.search).get('place');
  const first = startPlace(places, query, last, Intl.DateTimeFormat().resolvedOptions().timeZone);

  let cur = -1;              // the selected place; only onPick (the view's report) sets it
  let started = false;       // the gate was tapped: audio is unlocked, a pick tunes
  let want: { place: number; id: string } | null = null;   // a station chosen in a worldwide list, played when its place is picked
  let note = '';
  let picked: StationRow | null = null;   // a station chosen in the list; side button resumes it
  let list: ListModel | null = null;
  let mode: ListMode = 'place';   // what the list shows: the place's stations, or a worldwide list (Rulings 45, 47)
  let listReq = 0;
  let news: NewStation[] = [];
  let voiceOn = false;
  let about = false;
  let globeLine = 'globe: starting';   // About's first line: the renderer the globe uses, and why
  // The voice city list (decision 2026-10-17) is a file of its own, cities.js, loaded from the first voice hold on.
  // `cities` is undefined until it has loaded, or null when it failed. match() reads places and countries without it.
  // A failed load is tried again on the next voice hold (the creation may stay open for days), under a URL of its own:
  // a browser keeps a module that failed to load as failed for its URL.
  let cities: string | null | undefined;
  let citiesLoad: Promise<void> | undefined;
  let citiesFailed = 0;
  const loadCities = () => (citiesLoad ??= lazyImport<{ CITIES: string }>(
    citiesFailed ? `${__CITIES_JS__}${__CITIES_JS__.includes('?') ? '&' : '?'}r=${citiesFailed}` : __CITIES_JS__,
  ).then(m => { cities = m.CITIES; }, () => { cities = null; citiesLoad = undefined; citiesFailed++; }));
  let matcher: Matcher | null = null;   // with the list, built on the first voice search once the list is there
  let bare: Matcher | null = null;      // without it
  const match = () => (cities ? (matcher ??= createMatcher(places, cities)) : (bare ??= createMatcher(places, '')));
  const diag = new Diag();

  // A carried-over favourite is resolved when a chunk holding it loads (the start place's, a list, a tune).
  data.onRows = rows => {
    const next = resolveFavs(favs, rows, places);
    if (!next) return;
    favs = next;
    saveFavs();
    if (list && mode === 'favs') { const sel = list.sel; list = worldList(favs); list.sel = sel; drawList(); }
  };

  // Ruling 38: the exact station last playing, if it's still in that place's chunk — the gate offers to resume it.
  let resumeStation: StationRow | null = null;
  if (first >= 0 && last?.id) {
    try {
      resumeStation = playable(await data.stationsFor(first)).find(r => r.id === last.id) ?? null;
    } catch { /* no chunk yet: no resume affordance, startPlace's place still stands */ }
  }
  if (resumeStation) screen.setGateLabel('Tap to resume', resumeStation.name);

  // The status line adds "muted" while the element reads back 0 (Ruling 49): a radio reopened at 0 % must not look
  // live and silent. Read back, like the bar: a WebView that ignores the setter plays, so it does not say muted.
  const render = () => screen.render(stripModel(places, cur, player.state, tuner.station, note, new Date(), audio.volume === 0));
  const click = (id: string) => { void fetch(`${RB_BASE}/json/url/${encodeURIComponent(id)}`).catch(() => {}); };
  // A stop triggered from voiceStart (Ruling 37) can still fire a late, spurious state change on the audio
  // element (removeAttribute('src') + load()); that must not clobber the "listening…"/"thinking…" note it just set.
  const player = new Player(audio, () => {
    if (note !== NOTE.listening && note !== NOTE.thinking) { note = ''; render(); }
  }, CONNECT_TIMEOUT_MS);
  const shared = sharePlayer(player, () => noise);
  const tuner = new Tuner({
    player: shared.player,
    stations: p => data.stationsFor(p).then(playable),
    report: id => { click(id); persistLast(); render(); },   // called right after the tuner sets its station
    noise: shared.noise,
    fail: () => { note = NOTE.noData; render(); },
  }, SETTLE_MS);

  // Ruling 38: the station actually on air right now, saved on every successful play and again on the way out
  // (Ruling 38's platform limit: leaving the creation stops the radio without any other warning).
  const persistLast = () => {
    if (cur < 0) return;
    const id = tuner.station && tuner.station.place === cur ? tuner.station.id : undefined;
    void saveJson(kv, 'last', { ...lastOf(places, cur), id });
  };

  // Ruling 37: voice search stops the radio before it starts listening, and puts back what was playing — the
  // same station, not just the place's top one — when nothing is found in time (10s for the transcript, 25s for the
  // LLM's reply, Ruling 44), voice is unavailable, or there's no transcript. A found place jumps there instead and
  // never resumes. The target is resolved at resume time: `picked` is preferred over `tuner.station` because a list
  // pick still loading when voice starts hasn't set `tuner.station` yet, and `shared.reattach()` must run first, or
  // `tuner.resume()` would wait on a player that a pick has parked.
  const voice = createVoiceSession({
    isPlaying: () => player.state === 'playing' || player.state === 'loading',
    stop: () => tuner.cancel(),
    resume: () => {
      shared.reattach();
      const target = picked && picked.place === cur ? picked : tuner.station && tuner.station.place === cur ? tuner.station : null;
      void tuner.resume(cur, target?.id);
    },
    onSettle: () => { note = ''; render(); },
    onTimeout: ms => diag.push('result', `timeout after ${ms} ms: back to the station before`),
  });
  // Ruling P4: bumped on every voice hold and abandon(), so a transcript that waited for the city list can tell whether
  // the session it belongs to is still the live one.
  let voiceGen = 0;
  const abandon = () => { voiceGen++; voice.abandon(); };

  const { w, h } = viewSize(screen.canvas);
  const globe = new Globe(texture.tex, texture.TW, texture.TH, w, h);
  const tiles = new TileLayer(TILE_SOURCE, () => map.wake());   // a tile only loads after the map asked for it
  tiles.base = mercatorBase(texture.tex, texture.TW, texture.TH);   // Ruling 46: the globe's imagery under the tiles
  const map = new MapView(screen.canvas, places, globe, tiles, p => onPick(p));
  // The WebGL globe: forced by ?globe=gl or ?globe=mediump, or in auto mode where its probe (GL_PROBE_FRAMES frames on
  // the still hidden canvas, usually behind the gate) finds it fast enough. Until it is decided, and whenever it cannot
  // draw, the Canvas 2D globe does. About names the choice in `globeLine`, once per run. Only the texture's data goes
  // along (a view of the same buffer, no copy), so nothing here keeps `texture` alive. The Canvas 2D globe lets go of
  // the untinted data once tinted; a WebGL globe in use keeps it, to rebuild after a lost context.
  const glMode = globeMode(location.search);
  const fallback = (why: string) => { globeLine = `globe: Canvas 2D, ${why}`; };
  void loadGlGlobe(__GL_JS__, screen.glCanvas, glMode, { data: new Uint8Array(texture.tex.buffer), w: texture.TW, h: texture.TH }, map.glow)
    .then(async g => {
      let line = `globe: ${g.info}, forced`;
      g.onState = ok => { if (ok) globeLine = line; else fallback('context lost'); map.wake(); };   // a loss in the probe too
      if (glMode === 'auto') {
        let why = '';   // an error in the probe's frames
        const v = probeVerdict(await g.probe(GL_PROBE_FRAMES, () => map.drawProbe(g)).catch((e: Error) => { why = `probe: ${e.message}`; return []; }));
        if (why || !v.ok || !g.ok) { fallback(why || (g.ok ? `slow (${v.median.toFixed(1)} ms)` : 'context lost')); g.dispose(); return; }
        line = `globe: ${g.info}, ${v.median.toFixed(1)} ms`;
      }
      globeLine = line;
      map.useGl(g);
    }, (e: Error) => fallback(e.message));

  // Ruling 49: fly mode (src/app/wheel.ts), lit on the ✈ button. The map's flights feed it whatever the mode; a timer
  // at flyEnds ends it once the map has rested FLY_MS since the tap or the last wheel step.
  let fly = FLY_OFF;
  let flyTimer: ReturnType<typeof setTimeout> | undefined;
  let flying = false;   // map.moving as fly mode last heard it
  const flyEvent = (e: FlyEvent): WheelMode => {
    const was = fly.mode;
    const now = performance.now();
    fly = flyNext(fly, e, now);
    if (fly.mode !== was) screen.setFly(fly.mode === 'fly');
    clearTimeout(flyTimer);
    const end = flyEnds(fly);
    if (end < Infinity) flyTimer = setTimeout(() => flyEvent('tick'), end - now);
    return fly.mode;
  };
  /** Tells fly mode when a flight starts or the map lands: from every frame, and right after a wheel step's select. */
  const flights = () => {
    if (map.moving === flying) return;
    flying = map.moving;
    flyEvent(flying ? 'moving' : 'rest');
  };
  map.onFrame = g => { screen.setAttribution(g ? '' : TILE_SOURCE.attribution); flights(); };

  // Ruling 49: a wheel event on the map outside fly mode. The bar shows what the element reads back, and the volume is
  // saved once the wheel has rested VOLUME_SAVE_MS (and on the way out), not on each of the many events of a turn.
  let volumeSave: ReturnType<typeof setTimeout> | undefined;
  const saveVolume = () => { clearTimeout(volumeSave); volumeSave = undefined; void saveJson(kv, VOLUME_KEY, volume); };
  const turnVolume = (dir: 1 | -1) => {
    const max = volume === 100 && dir < 0;
    const muted = audio.volume === 0;
    volume = stepVolume(volume, dir);
    audio.volume = volume / 100;
    noise?.level(volume / 100);
    screen.showVolume(volumeView(audio.volume, max));
    if ((audio.volume === 0) !== muted) render();   // the status line's "muted" comes or goes
    clearTimeout(volumeSave);
    volumeSave = setTimeout(saveVolume, VOLUME_SAVE_MS);
  };

  // Ruling 46: once the map has rested on a place, the wheel's next and previous places get their tiles, a few each.
  let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
  const prefetchNeighbours = () => {
    clearTimeout(prefetchTimer);
    prefetchTimer = setTimeout(() => {
      if (map.moving) { prefetchNeighbours(); return; }
      if (cur < 0 || map.cam.z < GLOBE_BELOW_ZOOM) return;
      const min = minCountForZoom(map.cam.z);
      for (const dir of [1, -1] as const) {
        const p = stepWalk(walk, cur, dir, i => places.count[i] >= min);
        if (p >= 0) tiles.prefetch({ lon: places.lon[p], lat: places.lat[p], z: map.cam.z }, map.w, map.h, map.dpr, NEIGHBOUR_PREFETCH);
      }
    }, PREFETCH_DELAY_MS);
  };

  const go = (p: number, resumeId?: string) => {
    abandon();   // a scroll, drag or jump (the voice-found one has already ended the session) must not resume later
    cur = p;
    note = '';
    picked = null;
    shared.reattach();
    render();
    if (resumeId) void tuner.resume(p, resumeId); else tuner.select(p);
    persistLast();   // place-only for now (tuner.station still belongs to the old place); a play fills in `id`
    prefetchNeighbours();
  };

  // The view reports every selection: a wheel step or a jump (map.select) at once, a drag when the map settles.
  const onPick = (p: number) => {
    const id = want && want.place === p ? want.id : undefined;
    want = null;
    if (started) go(p, id);
    else { cur = p; render(); }   // before the gate tap: the strip follows; nothing tunes, nothing is saved
  };

  /** Voice and the worldwide lists jump anywhere: the map arcs there and lands at region zoom or closer. */
  const jump = (p: number) => map.select(p, Math.max(map.cam.z, ZOOM_DEFAULT));

  const playPick = async (s: StationRow) => {
    abandon();   // picking from the list mid-session must not have voice resume something else later
    picked = s;
    const r = await shared.direct(s.url);
    if (r !== 'playing' || picked !== s) return;
    tuner.station = s;
    click(s.id);
    persistLast();
    render();
  };

  /**
   * A station of a worldwide list (Rulings 45, 47): the rows have no stream URL, so the tuner plays it by id once the
   * map picks its place. A favourite whose place is not known yet (a carried-over id) cannot fly anywhere.
   */
  const playWorld = (s: StationRow) => {
    if (s.place < 0) { note = NOTE.noPlace; render(); return; }
    want = { place: s.place, id: s.id };
    jump(s.place);   // onPick → go(place, id) → tuner.resume(place, id): this station, not the place's first
  };

  const drawList = () => screen.showList(list && listView(list, favIds(favs), listTitle(list, places.name[cur] ?? '', mode), mode, data.newsDate));
  const closeList = () => { listReq++; list = null; mode = 'place'; drawList(); };

  /** The place's stations under the two header rows; the station on air is selected when it is in the list. */
  const openList = async () => {
    flyEvent('close');
    const req = ++listReq;
    const at = cur;
    const [rows, fresh] = await Promise.all([
      at >= 0 ? data.stationsFor(at).then(playable).catch((): StationRow[] => []) : Promise.resolve([]),
      data.newStations().catch((): NewStation[] => news),   // optional file: offline keeps what was loaded before
    ]);
    if (req !== listReq || at !== cur) return;
    news = fresh;
    list = placeList(rows, favIds(favs), news.length, favs.length);
    mode = 'place';
    const playing = list.rows.findIndex(r => r.id === tuner.station?.id);
    if (playing >= HEADS) list.sel = playing;
    drawList();
  };

  /** A worldwide list, from its header row or its map button: the new stations (★) or the favourites (♥). */
  const openWorld = async (m: 'new' | 'favs') => {
    flyEvent('close');
    const req = ++listReq;
    if (m === 'new') {
      news = await data.newStations().catch((): NewStation[] => news);
      if (req !== listReq) return;
    }
    list = m === 'new' ? newList(news) : worldList(favs);
    mode = m;
    drawList();
  };

  const listAction = (l: ListModel, a: Action) => {
    if (a.type === 'step') { l.move(a.dir); drawList(); return; }
    const s = l.selected();
    if (!s) return;   // an empty list: nothing to play or mark
    if (a.type === 'toggle') {
      if (s.id === NEW_HEADER) { void openWorld('new'); return; }
      if (s.id === FAV_HEADER) { void openWorld('favs'); return; }
      const world = mode !== 'place';
      closeList();
      if (world) playWorld(s); else void playPick(s);
    } else if (a.type === 'voiceStart' && !isHeader(s.id)) {   // hold: add or remove a favourite; header rows are not stations
      if (mode === 'favs') {
        favs = removeFav(favs, s.id);
        const sel = l.sel;
        list = worldList(favs);
        list.sel = Math.min(sel, Math.max(0, list.rows.length - 1));
      } else {
        const n = mode === 'new' ? news.find(x => x.id === s.id) : undefined;   // a new-list row's name is its label
        if (mode === 'new' && !n) return;
        favs = toggleFav(favs, n ?? favOf(s, places));
        const head = l.rows.find(r => r.id === FAV_HEADER);   // the place list's "♥ My favourites (M)" row
        if (head) head.name = favHeaderName(favs.length);
      }
      saveFavs();
      drawList();
    }
  };

  // About also gives the median time of the last globe frames (up to 120), whichever globe drew them: a photo of it on
  // the r1 then shows whether the globe in use is smooth there, the Canvas 2D fallback above all (findings A5, B5).
  const openAbout = () => {
    flyEvent('close');
    about = true;
    const ms = map.frameMs.filter((_, i) => map.frameGlobe[i]).sort((a, b) => a - b);
    screen.showAbout(true, diag.lines(), ms.length ? `${globeLine}, frames ${ms[ms.length >> 1].toFixed(1)} ms` : globeLine);
  };
  const closeAbout = () => { about = false; screen.showAbout(false); };

  const toggle = () => {
    abandon();   // a side click mid-session must not have voice resume/stop something else later
    const stopped = player.state === 'idle' || player.state === 'error';
    if (stopped && picked && picked.place === cur) { void playPick(picked); return; }
    shared.reattach();
    void tuner.toggle();
  };

  const act = (a: Action) => {
    if (a.type === 'voiceEnd') {
      if (!voiceOn) return;
      voiceOn = false;
      stopVoice();
      if (note === NOTE.listening) { note = ''; render(); }
      voice.release();   // the mic is closed: apply an outcome that landed mid-hold, or arm the clock
      return;
    }
    if (about) {   // the wheel scrolls the About screen (to its voice log), anything else closes it
      if (a.type === 'step') screen.scrollAbout(a.dir); else closeAbout();
      return;
    }
    if (list) { listAction(list, a); return; }
    if (a.type === 'step') {
      if (flyEvent('step') === 'volume') { turnVolume(a.dir); return; }   // Ruling 49: the map never moves for the volume
      const min = minCountForZoom(map.targetZ);   // the places the map shows at this zoom, or at the zoom it is flying to
      const next = stepWalk(walk, cur, a.dir, i => places.count[i] >= min);
      if (next >= 0) map.select(next);   // onPick → go(next): the strip changes at once, the tune after SETTLE_MS
      flights();   // the flight has started: fly mode's countdown waits for the landing
    } else if (a.type === 'toggle') toggle();
    else if (a.type === 'voiceStart') {
      flyEvent('close');
      diag.start();
      voiceGen++;
      voice.start();               // records "was playing" and stops the radio; the clock is armed later
      voiceOn = startVoice();      // only called after the radio is already stopped
      if (voiceOn) { void loadCities(); note = NOTE.listening; render(); }   // the list comes while the user speaks
      else { voice.end(); diag.push('result', 'voice unavailable'); note = NOTE.noVoice; render(); }   // resume right away
    }
  };

  /** A voice search found place p: close whatever covers the map and fly there. */
  const found = (p: number) => () => { closeList(); closeAbout(); jump(p); };
  const named = (p: number) => `${places.name[p]}, ${places.cc[p]}`;

  // The session attributes every sttEnded and LLM reply to the session that asked for it (FIFO), so a retry hold never
  // inherits the previous session's in-flight messages, and holds back any outcome that lands while the mic is still open.
  // Ruling 44: a transcript asking for a known place, big city or country jumps at once (the fast path); only the rest
  // goes to the LLM. Fix round 1 (I2): "asking for" as Matcher.request reads it, so "play Michael Jackson" is not
  // Jackson; fix rounds 2 and 3 (N2, N3) read the LLM's plain-text answers the same way, sentence by sentence
  // (Matcher.reply). Every bridge message and what came of it goes into the voice log.
  const search = (text: string) => {
    if (!cities) diag.push('result', cities === null ? 'city list failed' : 'city list still loading');   // a big city then goes to the LLM
    const p = match().request(text);
    if (p >= 0) {
      diag.push('result', `fast path: ${named(p)}`);
      voice.resolved(true, found(p));
    } else if (askLLM(intentPrompt(text))) {
      diag.push('llm-sent', text);
      voice.asked();
      note = NOTE.thinking;
      render();
    } else {
      diag.push('result', 'bridge unavailable');
      voice.resolved(false);   // the bridge call itself failed: nothing more is coming
    }
  };

  const onMessage = (m: PluginMessage) => {
    if (m.type === 'sttEnded') {
      diag.push('sttEnded', m);
      if (!voice.transcript()) return;   // an earlier session's transcript, or none expected: changes nothing
      const text = m.transcript?.trim() ?? '';
      if (!text) {
        diag.push('result', 'no transcript');
        voice.resolved(false);   // nothing more is coming
      } else if (cities !== undefined) search(text);
      else {
        // The city list is still loading: the fast path waits for it up to CITIES_WAIT_MS, then searches without it.
        // A retry hold, a drag, a scroll or a list pick meanwhile has ended this session: then nothing happens (P4).
        const gen = voiceGen;
        void Promise.race([loadCities(), new Promise(r => setTimeout(r, CITIES_WAIT_MS))]).then(() => {
          if (gen === voiceGen && voice.isLive()) search(text);
          else diag.push('result', 'ended while waiting for the city list');
        });
      }
      return;
    }
    const r = readReply(m);
    diag.push(kindOf(m, r), m);
    if (r.kind === 'status' || r.kind === 'none') return;   // a bridge status message, not an answer
    // An intent names a place or country. A plain-text answer is read like a spoken request (fix round 2, N2): "Taking
    // you to Lisbon" is Lisbon, "Sorry, I can't play Michael Jackson" names no place, just as "play Michael Jackson" does.
    // Fix round 3 (N3): one sentence of it is enough, so "Tuning in to Tokyo. Have fun!" and "place: Lisbon, country:
    // PT" land too.
    const p = r.kind === 'intent' ? placeForIntent(places, r.intent, match()) : match().reply(r.text);
    // Plain text naming no place is not taken as the answer (the app before P3 ignored all plain text): the r1 may send
    // prose that is no reply at all, and taking it would end every search at once. The session still counts it, so a
    // prose "no" leaves no debt to discard the next search's reply, however that search ends (fix rounds 1 and 2).
    if (r.kind === 'text' && p < 0) {
      const w = voice.prose();
      diag.push('result', w === 'waiting' ? 'text without a place: still waiting' : `${w}: text without a place`);
      return;
    }
    const hit = p >= 0;   // genre-only requests are not handled yet
    const whose = voice.answer(hit, found(p));
    diag.push('result', `${whose}: ${hit ? named(p) : 'no place'}`);
    if (whose === 'stale' || hit) return;   // an earlier session's reply never jumps or resumes; a found one jumps (maybe at voiceEnd)
    if (whose === 'accepted' || !voice.isLive()) { note = NOTE.noMatch; render(); }   // an unasked no-match still shows, changes nothing
  };

  // Drag pans; the finger holds the map, so a caught place glides into the ring only once it lets go. The view picks
  // the place under the ring as it moves (onPick → go → tune after SETTLE_MS).
  const bindDrag = () => {
    let drag: { x: number; y: number } | null = null;
    screen.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; map.hold(true); });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      map.panBy(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { if (drag) map.hold(false); drag = null; };   // a tap elsewhere (a button) never wakes the map
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  // M3 minor: the WebView may settle on its final size after boot; the layout and the map follow it.
  window.addEventListener('resize', () => {
    const s = viewport(window.innerWidth, window.innerHeight);
    screen.fit(s.w, s.h);
    const v = viewSize(screen.canvas);
    map.resize(v.w, v.h);
  });

  Object.assign(window, {
    __view: map,
    __app: {
      places,
      place: () => cur,
      station: () => tuner.station?.name ?? null,
      walkSize: () => walk.order.length,
      audio: () => ({ paused: audio.paused, src: audio.src, volume: audio.volume }),   // e2e: the media element isn't in the DOM
      diag: () => diag.lines(),
      favs: () => favs,
    },
  });

  if (first >= 0) {
    map.cam = { lon: places.lon[first], lat: places.lat[first], z: map.cam.z };
    map.select(first);   // onPick sets `cur`; the gate tap tunes it
  }
  map.wake();
  const tick = () => { render(); setTimeout(tick, msToNextMinute(Date.now())); };
  tick();

  return () => {   // after the gate tap: controls, voice, touch and the first tune
    started = true;
    bindControls(window, act);
    onPluginMessage(onMessage);
    screen.onStripTap(() => { if (list) closeList(); else void openList(); });
    screen.onListTap(closeList);
    screen.onZoom(dz => map.zoomBy(dz));
    screen.onWorldLists(() => void openWorld('new'), () => void openWorld('favs'));
    screen.onFly(() => flyEvent('tap'));
    screen.onInfo(openAbout);
    screen.onAboutTap(closeAbout);
    bindDrag();
    noise?.level(volume / 100);
    if (audio.volume === 0) screen.showVolume(volumeView(audio.volume, false));   // reopened at 0 %: the bar says muted
    // Ruling 38: only touch storage once we're actually running — leaving the gate untapped must not
    // downgrade or lose a resume offer that was never acted on. A volume still waiting to be saved goes too.
    const leave = () => { persistLast(); if (volumeSave !== undefined) saveVolume(); };
    window.addEventListener('visibilitychange', () => { if (document.hidden) leave(); });
    window.addEventListener('pagehide', leave);
    window.addEventListener('backHome', leave);   // the r1 platform's own "leaving the creation" signal
    if (cur >= 0) go(cur, resumeStation?.id);
  };
}

const ready = boot();
ready.catch((e: Error) => screen.fail(e.message));

// The way in, by a tap on the gate or a side click (below), and only once: the static and the media element are
// unlocked inside the gesture, then the app starts. The tap has hidden the gate already, so a flag guards it, not
// gateOpen(): start() must never bind the controls twice.
let tuned = false;
const tuneIn = () => {
  if (tuned) return;
  tuned = true;
  screen.closeGate();
  noise = createStatic();              // the AudioContext must be created inside the gesture
  void audio.play().catch(() => {});   // unlocks the element while the gesture's activation lasts
  void ready.then(start => start(), () => {});
};
screen.onGate(tuneIn);

// A side click at the gate (the r1's hardware button) tunes in like the tap when the WebView lets the app play without
// a tap. play() on the element with no source tells: a refusal rejects at once with NotAllowedError, and the button
// pulses to ask for the tap; an allowed play() stays pending, so GATE_TRY_MS without an answer counts as allowed, like
// a resolve or any other error. The controls are bound later, inside start(), so this press never also plays or stops.
window.addEventListener('sideClick', () => {
  if (!screen.gateOpen()) return;
  void Promise.race([audio.play(), new Promise(r => setTimeout(r, GATE_TRY_MS))]).then(
    () => { if (screen.gateOpen()) tuneIn(); },   // a tap within GATE_TRY_MS has tuned in already
    e => { if (screen.gateOpen()) { if (isRefusal(e)) screen.pulseGate(); else tuneIn(); } },
  );
});
