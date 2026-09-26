import { HINT, LIST_HINT, type ListView, type ScreenModel } from './logic';

function div(parent: HTMLElement, cls: string, text = ''): HTMLElement {
  const d = document.createElement('div');
  d.className = cls;
  d.textContent = text;
  parent.appendChild(d);
  return d;
}

/**
 * The preview's text screen inside index.html's #app. The map markup stays in the page, hidden by
 * preview.css, and the "Tap to tune in" gate is index.html's own #gate. All text goes in via textContent:
 * station names are third-party data.
 */
export class PreviewScreen {
  private root: HTMLElement;
  private status: HTMLElement;
  private place: HTMLElement;
  private where: HTMLElement;
  private count: HTMLElement;
  private station: HTMLElement;
  private list: HTMLElement;
  private title: HTMLElement;
  private rows: HTMLElement;

  constructor(private app: HTMLElement) {
    this.root = document.createElement('div');
    this.root.id = 'preview';
    this.status = div(this.root, 'status');
    const center = div(this.root, 'center');
    this.place = div(center, 'place', '…');
    this.where = div(center, 'where');
    this.count = div(center, 'count');
    this.station = div(this.root, 'station');
    for (const line of HINT) div(this.root, 'hint', line);
    this.list = div(this.root, 'list');
    this.list.hidden = true;
    this.title = div(this.list, 'title');
    this.rows = div(this.list, 'rows');
    div(this.list, 'hint', LIST_HINT);
    app.insertBefore(this.root, document.getElementById('gate'));
  }

  fit(w: number, h: number): void {
    this.app.style.width = `${w}px`;
    this.app.style.height = `${h}px`;
  }

  /** Runs `fn` once, on the first tap on the gate, inside that tap's user activation. */
  onGate(fn: () => void): void {
    const gate = document.getElementById('gate');
    if (!gate) return;
    gate.addEventListener('pointerup', () => { gate.hidden = true; fn(); }, { once: true });
  }

  /** A tap anywhere on the screen (the gate is a sibling, so its tap never lands here). */
  onTap(fn: () => void): void {
    this.root.addEventListener('pointerup', () => fn());
  }

  render(m: ScreenModel): void {
    this.status.textContent = m.status;
    this.place.textContent = m.place;
    this.where.textContent = m.where;
    this.count.textContent = m.count;
    this.station.textContent = m.station;
    this.station.classList.toggle('live', m.live);
  }

  fail(message: string): void {
    this.status.textContent = 'error';
    this.place.textContent = 'no data';
    this.where.textContent = message;
  }

  showList(v: ListView | null): void {
    this.list.hidden = !v;
    if (!v) return;
    this.title.textContent = v.title;
    if (!v.rows.length) { this.rows.replaceChildren(); div(this.rows, 'row', 'no stations here'); return; }
    this.rows.replaceChildren(...v.rows.map(r => {
      const d = document.createElement('div');
      d.className = r.sel ? 'row sel' : 'row';
      d.dataset.i = String(r.i);
      d.textContent = (r.fav ? '♥ ' : '') + r.name;
      return d;
    }));
  }
}
