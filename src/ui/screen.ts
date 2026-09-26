import { ABOUT, ABOUT_HINT, ABOUT_TITLE, HINT, LIST_HINT, doubleTap, type ListView, type StripModel } from '../app/logic';

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
 * the bottom strip, the station list, the About screen and the "Tap to tune in" gate. Text goes in via textContent
 * only: station names are third-party data.
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
  private about = byId('about');
  private gate = byId('gate');

  constructor() {
    (this.list.querySelector('.hint') as HTMLElement).textContent = LIST_HINT;
    const hint = this.gate.querySelector('.hint') as HTMLElement;
    hint.replaceChildren();
    for (const line of HINT) div(hint, 'line', line);
    div(this.about, 'title', ABOUT_TITLE);
    for (const line of ABOUT) div(this.about, '', line, 'p');
    div(this.about, 'hint', ABOUT_HINT, 'p');
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

  /** A double tap on the status line (top left); its box is larger than its text, and there even when it is empty. */
  onStatusDoubleTap(fn: () => void): void {
    const tap = doubleTap();
    onTap(this.status, e => { if (tap(e.timeStamp, e.clientX, e.clientY)) fn(); });
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
    if (!v.rows.length) { this.rows.replaceChildren(); div(this.rows, 'row', 'no stations here'); return; }
    this.rows.replaceChildren(...v.rows.map(r => {
      const d = document.createElement('div');
      d.className = 'row' + (r.head ? ' head' : '') + (r.sel ? ' sel' : '');
      d.dataset.i = String(r.i);
      d.textContent = (r.fav ? '♥ ' : '') + r.name;
      return d;
    }));
  }

  showAbout(open: boolean): void {
    this.about.hidden = !open;
  }

  fail(message: string): void {
    this.status.textContent = 'error';
    this.name.textContent = 'no data';
    this.where.textContent = message;
  }
}
