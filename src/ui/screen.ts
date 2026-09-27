import { ABOUT, ABOUT_HINT, ABOUT_TITLE, DIAG_EMPTY, DIAG_TITLE, HINT, type ListView, type StripModel } from '../app/logic';
import { VOLUME_SHOW_MS } from '../config';

const byId = (id: string) => document.getElementById(id) as HTMLElement;

function div(parent: HTMLElement, cls: string, text = '', tag = 'div'): HTMLElement {
  const d = document.createElement(tag);
  d.className = cls;
  d.textContent = text;
  parent.appendChild(d);
  return d;
}

/**
 * A tap: pointerdown and pointerup on `el`, less than 10 px apart. A drag that starts on the map and ends here is
 * not one (touch pointers stay captured by the map anyway; a mouse would not be). Never calls preventDefault().
 */
export function onTap(el: HTMLElement, fn: (e: PointerEvent) => void): void {
  let down: { x: number; y: number } | null = null;
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointercancel', () => { down = null; });
  el.addEventListener('pointerup', e => {
    const d = down;
    down = null;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10) fn(e);
  });
}

/**
 * The app's DOM in index.html's #app: the map canvas and ring, the status line and tile attribution, the zoom buttons,
 * the ★ and ♥ buttons of the worldwide lists, the ✈ and ⓘ buttons (Rulings 49, 50), the volume bar, the bottom strip,
 * the station list, the About screen with the voice log and the "Tap to tune in" gate. Text goes in via textContent
 * only: station names and transcripts are third-party data.
 */
export class AppScreen {
  readonly canvas = byId('map') as HTMLCanvasElement;
  private app = byId('app');
  private ring = byId('ring');
  private status = byId('status');
  private attr = byId('attr');
  private strip = byId('strip');
  private name = this.strip.querySelector('.name') as HTMLElement;
  private where = this.strip.querySelector('.where') as HTMLElement;
  private list = byId('list');
  private title = this.list.querySelector('.title') as HTMLElement;
  private rows = this.list.querySelector('.rows') as HTMLElement;
  private listHint = this.list.querySelector('.hint') as HTMLElement;
  private about = byId('about');
  private diag: HTMLElement;
  private gate = byId('gate');
  private fly = byId('bfly');
  private vol = byId('vol');
  private volFill = this.vol.querySelector('.fill') as HTMLElement;
  private volPct = this.vol.querySelector('.pct') as HTMLElement;
  private volNote = this.vol.querySelector('.note') as HTMLElement;
  private volTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const hint = this.gate.querySelector('.hint') as HTMLElement;
    const plane = this.fly.querySelector('svg') as SVGElement;
    hint.replaceChildren();
    for (const text of HINT) {   // a ✈ in a hint is the button's own icon: a text ✈ can be a colour emoji on Android
      const line = div(hint, 'line');
      text.split('✈').forEach((part, k) => {
        if (k) line.appendChild(plane.cloneNode(true));
        line.appendChild(document.createTextNode(part));
      });
    }
    div(this.about, 'title', ABOUT_TITLE);
    for (const line of ABOUT) div(this.about, '', line, 'p');
    div(this.about, 'hint', ABOUT_HINT, 'p');
    this.diag = div(this.about, 'diag');
  }

  /** Sizes #app, which MapView measures when it is created (Ruling 19: never a fixed 282). */
  fit(w: number, h: number): void {
    this.app.style.width = `${w}px`;
    this.app.style.height = `${h}px`;
  }

  /** Runs `fn` once, on the first tap on the gate, inside that tap's user activation. */
  onGate(fn: () => void): void {
    this.gate.addEventListener('pointerup', () => { this.gate.hidden = true; fn(); }, { once: true });
  }

  /** Ruling 38: before the tap, offer to resume the station remembered from last time instead of the default label. */
  setGateLabel(primary: string, stationName?: string): void {
    const btn = byId('start');
    btn.textContent = primary;
    if (!stationName) return;
    btn.appendChild(document.createElement('br'));
    const line = document.createElement('span');
    line.className = 'resume-station';
    line.textContent = stationName;
    btn.appendChild(line);
  }

  onStripTap(fn: () => void): void { onTap(this.strip, () => fn()); }
  onListTap(fn: () => void): void { onTap(this.list, () => fn()); }
  onAboutTap(fn: () => void): void { onTap(this.about, () => fn()); }
  onZoom(fn: (dz: number) => void): void {
    onTap(byId('zin'), () => fn(1));
    onTap(byId('zout'), () => fn(-1));
  }
  /** The ★ (new stations worldwide, Ruling 45) and ♥ (my favourites, Ruling 47) map buttons. */
  onWorldLists(news: () => void, favs: () => void): void {
    onTap(byId('bnew'), () => news());
    onTap(byId('bfav'), () => favs());
  }

  /** The ✈ button (Ruling 49): fly mode on, or off when it is lit. */
  onFly(fn: () => void): void { onTap(this.fly, () => fn()); }
  /** The ⓘ button (Ruling 50): About, with one tap. */
  onInfo(fn: () => void): void { onTap(byId('binfo'), () => fn()); }

  /** Lights the ✈ button (amber, like live) while the wheel flies between places. */
  setFly(on: boolean): void {
    this.fly.classList.toggle('on', on);
    this.fly.setAttribute('aria-pressed', String(on));
  }

  /** Shows the volume bar for VOLUME_SHOW_MS after each change (Ruling 49). */
  showVolume(v: { fill: number; text: string; note: string }): void {
    this.volFill.style.width = `${v.fill}%`;
    this.volPct.textContent = v.text;
    this.volNote.textContent = v.note;
    this.vol.hidden = false;
    clearTimeout(this.volTimer);
    this.volTimer = setTimeout(() => { this.vol.hidden = true; }, VOLUME_SHOW_MS);
  }

  render(m: StripModel): void {
    this.status.textContent = m.status;
    this.name.textContent = m.name;
    this.name.classList.toggle('live', m.live);
    this.where.textContent = m.where;
    this.ring.className = m.ring;
  }

  /** The tile attribution (8 px, top right) while tiles show; '' while the globe does. */
  setAttribution(text: string): void {
    if (this.attr.textContent === text && this.attr.hidden === !text) return;
    this.attr.textContent = text;
    this.attr.hidden = !text;
  }

  showList(v: ListView | null): void {
    this.list.hidden = !v;
    if (!v) return;
    this.title.textContent = v.title;
    this.listHint.textContent = v.hint;
    if (!v.rows.length) {
      this.rows.replaceChildren();
      for (const line of v.empty) div(this.rows, 'empty', line);
      return;
    }
    this.rows.replaceChildren(...v.rows.map(r => {
      const d = document.createElement('div');
      d.className = 'row' + (r.head ? ' head' : '') + (r.sel ? ' sel' : '');
      d.dataset.i = String(r.i);
      d.textContent = (r.fav ? '♥ ' : '') + r.name;
      return d;
    }));
  }

  /** Opens the About screen at its top with the voice log (Ruling 44), oldest line first; or closes it. */
  showAbout(open: boolean, diag: string[] = []): void {
    this.about.hidden = !open;
    if (!open) return;
    this.diag.replaceChildren();
    div(this.diag, 'dhead', DIAG_TITLE, 'p');
    for (const line of diag.length ? diag : [DIAG_EMPTY]) div(this.diag, '', line, 'p');
    this.about.scrollTop = 0;
  }

  /** The wheel scrolls the About screen (to reach the voice log); dir 1 is down. */
  scrollAbout(dir: number): void {
    this.about.scrollTop += dir * 60;
  }

  fail(message: string): void {
    this.status.textContent = 'error';
    this.name.textContent = 'no data';
    this.where.textContent = message;
  }
}
