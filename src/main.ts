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
import { intentPrompt, parseIntent } from './voice/intent';

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

  let note = '';
  let picked: StationRow | null = null;   // a station chosen in the list; side button resumes it
  let list: ListModel | null = null;
  let listReq = 0;
  let voiceOn = false;

  const render = () => screen.render(screenModel(places, cur, player.state, tuner.station, note, new Date()));
  const click = (id: string) => { void fetch(`${RB_BASE}/json/url/${encodeURIComponent(id)}`).catch(() => {}); };
  const player = new Player(audio, () => { note = ''; render(); }, CONNECT_TIMEOUT_MS);
  const shared = sharePlayer(player, () => noise);
  const tuner = new Tuner({
    player: shared.player,
    stations: p => data.stationsFor(p).then(playable),
    report: id => { click(id); render(); },   // called right after the tuner sets its station
    noise: shared.noise,
    fail: () => { note = NOTE.noData; render(); },
  }, SETTLE_MS);

  Object.assign(window, {
    __preview: { place: () => cur, station: () => tuner.station?.name ?? null, walkSize: () => walk.order.length },
  });

  const go = (p: number) => {
    cur = p;
    note = '';
    picked = null;
    shared.reattach();
    render();
    tuner.select(p);
    void saveJson(kv, 'last', lastOf(places, p));
  };

  const playPick = async (s: StationRow) => {
    picked = s;
    const r = await shared.direct(s.url);
    if (r !== 'playing' || picked !== s) return;
    tuner.station = s;
    click(s.id);
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
      return;
    }
    if (list) { listAction(list, a); return; }
    if (a.type === 'step') {
      const next = stepWalk(walk, cur, a.dir, () => true);
      if (next >= 0) go(next);
    } else if (a.type === 'toggle') toggle();
    else if (a.type === 'voiceStart') {
      voiceOn = startVoice();
      note = voiceOn ? NOTE.listening : NOTE.noVoice;
      render();
    }
  };

  const onMessage = (m: PluginMessage) => {
    if (m.type === 'sttEnded') {
      note = m.transcript && askLLM(intentPrompt(m.transcript)) ? NOTE.thinking : '';
      render();
      return;
    }
    const intent = parseIntent(m);
    if (!intent) return;
    const p = placeForIntent(places, intent);   // genre-only requests are not handled in the preview
    if (p >= 0) { closeList(); go(p); } else { note = NOTE.noMatch; render(); }
  };

  const tick = () => { render(); setTimeout(tick, msToNextMinute(Date.now())); };
  tick();

  return () => {   // after the gate tap: controls, voice and the first tune
    bindControls(window, act);
    onPluginMessage(onMessage);
    screen.onTap(() => { if (list) closeList(); else void openList(); });
    if (cur >= 0) go(cur);
  };
}

const ready = boot();
ready.catch((e: Error) => screen.fail(e.message));
screen.onGate(() => {
  noise = createStatic();              // the AudioContext must be created inside the tap
  void audio.play().catch(() => {});   // unlocks the element while the tap's activation lasts
  void ready.then(start => start(), () => {});
});
