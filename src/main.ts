// Sound preview (Task P): places, tuning, list and voice on a text screen. Task 18 replaces this file.
import css from './preview/preview.css';
import { Player } from './audio/player';
import { createStatic } from './audio/static';
import { Tuner } from './audio/tuner';
import { CONNECT_TIMEOUT_MS, RB_BASE, SETTLE_MS } from './config';
import { DataStore, type StationRow } from './data/store';
import { bindControls, type Action } from './input/controls';
import { buildWalk, stepWalk } from './map/walk';
import {
  askLLM, installKeyboardFallback, installMessageHook, onPluginMessage, startVoice, stopVoice, type PluginMessage,
} from './platform/r1';
import { createStore, loadJson, saveJson } from './platform/storage';
import {
  NOTE, lastOf, listView, msToNextMinute, placeForIntent, playable, screenModel, sharePlayer, startPlace, viewport, type Last,
} from './preview/logic';
import { PreviewScreen } from './preview/screen';
import { ListModel, toggleFav } from './ui/list';
import { intentPrompt, isIntentReply, parseIntent } from './voice/intent';
import { createVoiceSession } from './voice/session';

const style = document.createElement('style');
style.textContent = css;
document.head.appendChild(style);

const screen = new PreviewScreen(document.getElementById('app') as HTMLElement);
const fit = () => { const v = viewport(window.innerWidth, window.innerHeight); screen.fit(v.w, v.h); };
fit();
window.addEventListener('resize', fit);

const audio = new Audio();   // the one media element; the gate tap unlocks it
audio.preload = 'none';
let noise: { start(): void; stop(): void } | undefined;

async function boot(): Promise<() => void> {
  installMessageHook();
  installKeyboardFallback();
  const kv = createStore();
  const data = new DataStore('data/');
  const places = await data.load();
  const walk = buildWalk(places.lon, places.lat);
  const last = await loadJson<Last | null>(kv, 'last', null);
  let favs = new Set(await loadJson<string[]>(kv, 'favs', []));
  const query = new URLSearchParams(location.search).get('place');
  let cur = startPlace(places, query, last, Intl.DateTimeFormat().resolvedOptions().timeZone);

  // Ruling 38: the exact station last playing, if it's still in that place's chunk — the gate offers to resume it.
  let resumeStation: StationRow | null = null;
  if (cur >= 0 && last?.id) {
    try {
      resumeStation = playable(await data.stationsFor(cur)).find(r => r.id === last.id) ?? null;
    } catch { /* no chunk yet: no resume affordance, startPlace's place still stands */ }
  }
  if (resumeStation) screen.setGateLabel('Tap to resume', resumeStation.name);

  let note = '';
  let picked: StationRow | null = null;   // a station chosen in the list; side button resumes it
  let list: ListModel | null = null;
  let listReq = 0;
  let voiceOn = false;

  const render = () => screen.render(screenModel(places, cur, player.state, tuner.station, note, new Date()));
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

  // Ruling 38: the station actually on screen right now, saved on every successful play and again on the way out
  // (Ruling 38's platform limit: leaving the creation stops the radio without any other warning).
  const persistLast = () => {
    if (cur < 0) return;
    const id = tuner.station && tuner.station.place === cur ? tuner.station.id : undefined;
    void saveJson(kv, 'last', { ...lastOf(places, cur), id });
  };

  // Ruling 37: voice search stops the radio before it starts listening, and puts back what was playing — the
  // same station, not just the place's top one — when nothing is found within 10s, voice is unavailable, or
  // there's no transcript. A found place jumps there instead (existing behaviour) and never resumes.
  // Fix round 1 (I1/I2): the target is resolved at resume time, not captured at longPressStart — `cur` and
  // `picked` may have moved on (a scroll or another pick abandons the session before this ever runs; see
  // `go`/`toggle`/`playPick` below). `picked` is preferred over `tuner.station` because a list pick still
  // loading when voice starts hasn't set `tuner.station` yet. `shared.reattach()` must run first: a pick
  // plays through `shared.direct()`, which parks the shared player until reattached, so `tuner.resume()`
  // would otherwise await a promise that never settles.
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

  Object.assign(window, {
    __preview: {
      place: () => cur,
      station: () => tuner.station?.name ?? null,
      walkSize: () => walk.order.length,
      audio: () => ({ paused: audio.paused, src: audio.src }),   // e2e: the media element isn't in the DOM
    },
  });

  const go = (p: number, resumeId?: string) => {
    voice.abandon();   // I2: a scroll (or the voice-found jump itself, already ended) must not resume later
    cur = p;
    note = '';
    picked = null;
    shared.reattach();
    render();
    if (resumeId) void tuner.resume(p, resumeId); else tuner.select(p);
    persistLast();   // place-only for now (tuner.station still belongs to the old place); a play fills in `id`
  };

  const playPick = async (s: StationRow) => {
    voice.abandon();   // I2: picking from the list mid-session must not have voice resume something else later
    picked = s;
    const r = await shared.direct(s.url);
    if (r !== 'playing' || picked !== s) return;
    tuner.station = s;
    click(s.id);
    persistLast();
    render();
  };

  const drawList = () => screen.showList(list && listView(list, favs, places.name[cur]));
  const closeList = () => { listReq++; list = null; drawList(); };
  const openList = async () => {
    const req = ++listReq;
    const at = cur;
    let rows: StationRow[] = [];
    try { rows = playable(await data.stationsFor(at)); } catch { /* shown as an empty list */ }
    if (req !== listReq || at !== cur) return;
    list = new ListModel(rows, favs);
    const playing = list.rows.findIndex(r => r.id === tuner.station?.id);
    if (playing > 0) list.sel = playing;
    drawList();
  };

  const listAction = (l: ListModel, a: Action) => {
    const s = l.selected();
    if (a.type === 'step') { l.move(a.dir); drawList(); }
    else if (a.type === 'toggle' && s) { closeList(); void playPick(s); }
    else if (a.type === 'voiceStart' && s) {
      favs = toggleFav(favs, s.id);
      void saveJson(kv, 'favs', [...favs]);
      drawList();
    }
  };

  const toggle = () => {
    voice.abandon();   // I2: a side click mid-session must not have voice resume/stop something else later
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
      voice.release();   // the mic is closed: apply an outcome that landed mid-hold, or arm the 10s clock (N1)
      return;
    }
    if (list) { listAction(list, a); return; }
    if (a.type === 'step') {
      const next = stepWalk(walk, cur, a.dir, () => true);
      if (next >= 0) go(next);
    } else if (a.type === 'toggle') toggle();
    else if (a.type === 'voiceStart') {
      voice.start();               // records "was playing" and stops the radio; the 10s clock is armed later (I3)
      voiceOn = startVoice();      // only called after the radio is already stopped
      if (voiceOn) { note = NOTE.listening; render(); }
      else { voice.end(); note = NOTE.noVoice; render(); }   // voice unavailable: resume right away, no wait
    }
  };

  // Fix round 2 (N1): the session attributes every sttEnded and LLM reply to the session that asked for it (FIFO), so
  // a retry hold never inherits the previous session's in-flight messages, and holds back any outcome that lands while
  // the mic is still open until voiceEnd.
  const onMessage = (m: PluginMessage) => {
    if (m.type === 'sttEnded') {
      if (!voice.transcript()) return;   // an earlier session's transcript, or none expected: changes nothing
      if (m.transcript && askLLM(intentPrompt(m.transcript))) { voice.asked(); note = NOTE.thinking; render(); }
      else voice.resolved(false);   // no transcript, or the bridge call itself failed: nothing more is coming
      return;
    }
    if (!isIntentReply(m)) return;   // a bridge status message, not an answer
    const intent = parseIntent(m);
    const p = intent ? placeForIntent(places, intent) : -1;   // genre-only requests are not handled in the preview
    const found = p >= 0;
    const r = voice.answer(found, () => { closeList(); go(p); });
    if (r === 'stale' || found) return;   // an earlier session's reply never jumps or resumes; a found one jumps (maybe at voiceEnd)
    if (r === 'accepted' || !voice.isLive()) { note = NOTE.noMatch; render(); }   // an unasked no-match still shows, changes nothing
  };

  const tick = () => { render(); setTimeout(tick, msToNextMinute(Date.now())); };
  tick();

  return () => {   // after the gate tap: controls, voice and the first tune
    bindControls(window, act);
    onPluginMessage(onMessage);
    screen.onTap(() => { if (list) closeList(); else void openList(); });
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
