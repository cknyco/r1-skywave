// Skywave (Tasks 18-20): the map app. It grew out of the sound preview (Task P): the same gate, controls, voice
// session, station list and storage, with the map (Task 13) where the preview had its text screen.
import css from './ui/styles.css';
import {
  NOTE, lastOf, listTitle, listView, msToNextMinute, placeForIntent, playable, sharePlayer, startPlace, stripModel,
  viewport, type Last,
} from './app/logic';
import { Player } from './audio/player';
import { createStatic } from './audio/static';
import { Tuner } from './audio/tuner';
import { CONNECT_TIMEOUT_MS, RB_BASE, SETTLE_MS, TEXTURE_URL, ZOOM_DEFAULT } from './config';
import { DataStore, type NewStation, type StationRow } from './data/store';
import { bindControls, type Action } from './input/controls';
import { Globe, loadTexture } from './map/globe';
import { minCountForZoom } from './map/lod';
import { TILE_SOURCE } from './map/tile-source';
import { TileLayer } from './map/tiles';
import { MapView, viewSize } from './map/view';
import { buildWalk, stepWalk } from './map/walk';
import {
  askLLM, installKeyboardFallback, installMessageHook, onPluginMessage, startVoice, stopVoice, type PluginMessage,
} from './platform/r1';
import { createStore, loadJson, saveJson } from './platform/storage';
import { toggleFav, type ListModel } from './ui/list';
import { NEW_HEADER, newList, placeList } from './ui/news';
import { AppScreen } from './ui/screen';
import { intentPrompt, isIntentReply, parseIntent } from './voice/intent';
import { createVoiceSession } from './voice/session';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const screen = new AppScreen();
const size = viewport(window.innerWidth, window.innerHeight);
screen.fit(size.w, size.h);   // before MapView measures #app

const audio = new Audio();   // the one media element; the gate tap unlocks it
audio.preload = 'none';
let noise: { start(): void; stop(): void } | undefined;

async function boot(): Promise<() => void> {
  installMessageHook();
  installKeyboardFallback();
  const kv = createStore();
  const data = new DataStore('data/');
  const [places, texture] = await Promise.all([data.load(), loadTexture(TEXTURE_URL)]);
  const walk = buildWalk(places.lon, places.lat);
  const last = await loadJson<Last | null>(kv, 'last', null);
  let favs = new Set(await loadJson<string[]>(kv, 'favs', []));
  const query = new URLSearchParams(location.search).get('place');
  const first = startPlace(places, query, last, Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Ruling 38: the exact station last playing, if it's still in that place's chunk — the gate offers to resume it.
  let resumeStation: StationRow | null = null;
  if (first >= 0 && last?.id) {
    try {
      resumeStation = playable(await data.stationsFor(first)).find(r => r.id === last.id) ?? null;
    } catch { /* no chunk yet: no resume affordance, startPlace's place still stands */ }
  }
  if (resumeStation) screen.setGateLabel('Tap to resume', resumeStation.name);

  let cur = -1;              // the selected place; only onPick (the view's report) sets it
  let started = false;       // the gate was tapped: audio is unlocked, a pick tunes
  let want: { place: number; id: string } | null = null;   // a new station chosen in the list, played when its place is picked
  let note = '';
  let picked: StationRow | null = null;   // a station chosen in the list; side button resumes it
  let list: ListModel | null = null;
  let listReq = 0;
  let newMode = false;       // the list shows the new stations instead of the place's stations (Task 19b)
  let news: NewStation[] = [];
  let voiceOn = false;
  let about = false;

  const render = () => screen.render(stripModel(places, cur, player.state, tuner.station, note, new Date()));
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
  // same station, not just the place's top one — when nothing is found within 10s, voice is unavailable, or
  // there's no transcript. A found place jumps there instead and never resumes. The target is resolved at resume
  // time: `picked` is preferred over `tuner.station` because a list pick still loading when voice starts hasn't
  // set `tuner.station` yet, and `shared.reattach()` must run first, or `tuner.resume()` would wait on a player
  // that a pick has parked.
  const voice = createVoiceSession({
    isPlaying: () => player.state === 'playing' || player.state === 'loading',
    stop: () => tuner.cancel(),
    resume: () => {
      shared.reattach();
      const target = picked && picked.place === cur ? picked : tuner.station && tuner.station.place === cur ? tuner.station : null;
      void tuner.resume(cur, target?.id);
    },
    onSettle: () => { note = ''; render(); },
  });

  const { w, h } = viewSize(screen.canvas);
  const globe = new Globe(texture.tex, texture.TW, texture.TH, w, h);
  const tiles = new TileLayer(TILE_SOURCE, () => map.wake());   // a tile only loads after the map asked for it
  const map = new MapView(screen.canvas, places, globe, tiles, p => onPick(p));
  map.onFrame = g => screen.setAttribution(g ? '' : TILE_SOURCE.attribution);

  const go = (p: number, resumeId?: string) => {
    voice.abandon();   // a scroll, drag or jump (the voice-found one has already ended the session) must not resume later
    cur = p;
    note = '';
    picked = null;
    shared.reattach();
    render();
    if (resumeId) void tuner.resume(p, resumeId); else tuner.select(p);
    persistLast();   // place-only for now (tuner.station still belongs to the old place); a play fills in `id`
  };

  // The view reports every selection: a wheel step or a jump (map.select) at once, a drag when the map settles.
  const onPick = (p: number) => {
    const id = want && want.place === p ? want.id : undefined;
    want = null;
    if (started) go(p, id);
    else { cur = p; render(); }   // before the gate tap: the strip follows; nothing tunes, nothing is saved
  };

  /** Voice and the new-stations list jump anywhere: the map arcs there and lands at region zoom or closer. */
  const jump = (p: number) => map.select(p, Math.max(map.cam.z, ZOOM_DEFAULT));

  const playPick = async (s: StationRow) => {
    voice.abandon();   // picking from the list mid-session must not have voice resume something else later
    picked = s;
    const r = await shared.direct(s.url);
    if (r !== 'playing' || picked !== s) return;
    tuner.station = s;
    click(s.id);
    persistLast();
    render();
  };

  /** A new station (Task 19b): new.json has no stream URL, so the tuner plays it by id once the map picks its place. */
  const playNew = (s: StationRow) => {
    want = { place: s.place, id: s.id };
    jump(s.place);   // onPick → go(place, id) → tuner.resume(place, id): this station, not the place's first
  };

  const drawList = () => screen.showList(list && listView(list, favs, listTitle(list, places.name[cur] ?? '', newMode)));
  const closeList = () => { listReq++; list = null; newMode = false; drawList(); };
  const openList = async () => {
    const req = ++listReq;
    const at = cur;
    const [rows, fresh] = await Promise.all([
      at >= 0 ? data.stationsFor(at).then(playable).catch((): StationRow[] => []) : Promise.resolve([]),
      data.newStations().catch((): NewStation[] => []),   // optional file: offline means no header row this time
    ]);
    if (req !== listReq || at !== cur) return;
    news = fresh;
    list = placeList(rows, favs, news.length);
    const playing = list.rows.findIndex(r => r.id === tuner.station?.id);
    if (playing > 0) list.sel = playing;
    drawList();
  };

  const listAction = (l: ListModel, a: Action) => {
    if (a.type === 'step') { l.move(a.dir); drawList(); return; }
    const s = l.selected();
    if (!s) return;   // an empty list: nothing to play or mark
    if (a.type === 'toggle') {
      if (s.id === NEW_HEADER) { list = newList(news); newMode = true; drawList(); return; }
      const fromNew = newMode;
      closeList();
      if (fromNew) playNew(s); else void playPick(s);
    } else if (a.type === 'voiceStart' && s.id !== NEW_HEADER) {   // the header row is not a station
      favs = toggleFav(favs, s.id);
      void saveJson(kv, 'favs', [...favs]);
      drawList();
    }
  };

  const openAbout = () => { about = true; screen.showAbout(true); };
  const closeAbout = () => { about = false; screen.showAbout(false); };

  const toggle = () => {
    voice.abandon();   // a side click mid-session must not have voice resume/stop something else later
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
      voice.release();   // the mic is closed: apply an outcome that landed mid-hold, or arm the 10s clock
      return;
    }
    if (about) { closeAbout(); return; }   // any input only closes the About screen
    if (list) { listAction(list, a); return; }
    if (a.type === 'step') {
      const min = minCountForZoom(map.cam.z);   // the places the map shows at this zoom
      const next = stepWalk(walk, cur, a.dir, i => places.count[i] >= min);
      if (next >= 0) map.select(next);   // onPick → go(next): the strip changes at once, the tune after SETTLE_MS
    } else if (a.type === 'toggle') toggle();
    else if (a.type === 'voiceStart') {
      voice.start();               // records "was playing" and stops the radio; the 10s clock is armed later
      voiceOn = startVoice();      // only called after the radio is already stopped
      if (voiceOn) { note = NOTE.listening; render(); }
      else { voice.end(); note = NOTE.noVoice; render(); }   // voice unavailable: resume right away, no wait
    }
  };

  // The session attributes every sttEnded and LLM reply to the session that asked for it (FIFO), so a retry hold never
  // inherits the previous session's in-flight messages, and holds back any outcome that lands while the mic is still open.
  const onMessage = (m: PluginMessage) => {
    if (m.type === 'sttEnded') {
      if (!voice.transcript()) return;   // an earlier session's transcript, or none expected: changes nothing
      if (m.transcript && askLLM(intentPrompt(m.transcript))) { voice.asked(); note = NOTE.thinking; render(); }
      else voice.resolved(false);   // no transcript, or the bridge call itself failed: nothing more is coming
      return;
    }
    if (!isIntentReply(m)) return;   // a bridge status message, not an answer
    const intent = parseIntent(m);
    const p = intent ? placeForIntent(places, intent) : -1;   // genre-only requests are not handled yet
    const found = p >= 0;
    const r = voice.answer(found, () => { closeList(); closeAbout(); jump(p); });
    if (r === 'stale' || found) return;   // an earlier session's reply never jumps or resumes; a found one jumps (maybe at voiceEnd)
    if (r === 'accepted' || !voice.isLive()) { note = NOTE.noMatch; render(); }   // an unasked no-match still shows, changes nothing
  };

  // Drag pans; when the map settles, the view picks the place under the ring (onPick → go → tune after SETTLE_MS).
  const bindDrag = () => {
    let drag: { x: number; y: number } | null = null;
    screen.canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; });
    window.addEventListener('pointermove', e => {
      if (!drag) return;
      map.panBy(e.clientX - drag.x, e.clientY - drag.y);
      drag = { x: e.clientX, y: e.clientY };
    });
    const end = () => { drag = null; };
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
  };

  Object.assign(window, {
    __view: map,
    __app: {
      places,
      place: () => cur,
      station: () => tuner.station?.name ?? null,
      walkSize: () => walk.order.length,
      audio: () => ({ paused: audio.paused, src: audio.src }),   // e2e: the media element isn't in the DOM
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
    screen.onStatusDoubleTap(openAbout);
    screen.onAboutTap(closeAbout);
    bindDrag();
    // Ruling 38: only touch storage once we're actually running — leaving the gate untapped must not
    // downgrade or lose a resume offer that was never acted on.
    window.addEventListener('visibilitychange', () => { if (document.hidden) persistLast(); });
    window.addEventListener('pagehide', persistLast);
    window.addEventListener('backHome', persistLast);   // the r1 platform's own "leaving the creation" signal
    if (cur >= 0) go(cur, resumeStation?.id);
  };
}

const ready = boot();
ready.catch((e: Error) => screen.fail(e.message));
screen.onGate(() => {
  noise = createStatic();              // the AudioContext must be created inside the tap
  void audio.play().catch(() => {});   // unlocks the element while the tap's activation lasts
  void ready.then(start => start(), () => {});
});
