import type { StationRow } from '../data/store';
import type { PlayerState } from './player';

interface Deps {
  player: { play(url: string): Promise<PlayerState>; stop(): void; state: PlayerState };
  stations: (place: number) => Promise<StationRow[]>;
  report: (id: string) => void;
  noise?: { start(): void; stop(): void };
  fail?: (why: string) => void;
}

export class Tuner {
  place = -1;
  station: StationRow | null = null;
  private list: StationRow[] = [];
  private index = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private token = 0;
  private bad = new Set<string>();

  constructor(private d: Deps, private settleMs = 700) {}

  select(place: number): void {
    clearTimeout(this.timer);
    this.place = place;
    const token = ++this.token;
    this.timer = setTimeout(() => { void this.tunePlace(place, token); }, this.settleMs);
  }

  private async tunePlace(place: number, token: number): Promise<void> {
    let rows: StationRow[];
    try {
      rows = await this.d.stations(place);
    } catch (err) {
      if (token !== this.token) return;
      this.list = [];
      this.station = null;
      this.d.fail?.(err instanceof Error ? err.message : String(err));
      return;
    }
    if (token !== this.token) return;
    this.list = rows.filter(r => !this.bad.has(r.id));
    this.index = 0;
    await this.playFrom(token);
  }

  private async playFrom(token: number): Promise<void> {
    for (let tries = 0; tries < 3 && this.index < this.list.length; tries++) {
      const s = this.list[this.index];
      this.d.noise?.start();
      const result = await this.d.player.play(s.url);
      this.d.noise?.stop();
      if (token !== this.token) return;
      if (result === 'playing') {
        this.station = s;
        this.d.report(s.id);
        return;
      }
      this.bad.add(s.id);
      this.index++;
    }
    this.station = null;
  }

  async next(): Promise<void> {
    if (!this.list.length) return;
    this.index = (this.index + 1) % this.list.length;
    await this.playFrom(++this.token);
  }

  async toggle(): Promise<void> {
    if (this.d.player.state === 'playing' || this.d.player.state === 'loading') {
      this.token++;
      this.d.player.stop();
      return;
    }
    if (this.list.length && this.list[0].place === this.place) { await this.playFrom(++this.token); return; } // resume same station
    if (this.place >= 0) await this.tunePlace(this.place, ++this.token);
  }
}
