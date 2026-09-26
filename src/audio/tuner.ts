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

  /** Fetches and filters `place`'s stations into `this.list`. Reports failure and returns false when it can't. */
  private async loadList(place: number, token: number): Promise<boolean> {
    let rows: StationRow[];
    try {
      rows = await this.d.stations(place);
    } catch (err) {
      if (token !== this.token) return false;
      this.list = [];
      this.station = null;
      this.d.fail?.(err instanceof Error ? err.message : String(err));
      return false;
    }
    if (token !== this.token) return false;
    this.list = rows.filter(r => !this.bad.has(r.id));
    return true;
  }

  private async tunePlace(place: number, token: number): Promise<void> {
    if (!(await this.loadList(place, token))) return;
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

  /** Stops whatever is in flight right now — a pending settle timer, a connecting tune, or live playback — without
   *  forgetting `station`, so a caller (Ruling 37's voice session) can resume it later. */
  cancel(): void {
    clearTimeout(this.timer);
    this.token++;
    if (this.d.player.state === 'playing' || this.d.player.state === 'loading') this.d.player.stop();
  }

  /**
   * Plays a specific station of `place` right away, no settle wait (Ruling 38's "Tap to resume" and a mid-voice
   * resume both want this). Falls back to the top station when `stationId` is missing or no longer in the list.
   */
  async resume(place: number, stationId?: string): Promise<void> {
    clearTimeout(this.timer);
    this.place = place;
    const token = ++this.token;
    if (!(await this.loadList(place, token))) return;
    const at = stationId ? this.list.findIndex(r => r.id === stationId) : -1;
    this.index = at >= 0 ? at : 0;
    await this.playFrom(token);
  }
}
