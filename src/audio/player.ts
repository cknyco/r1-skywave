export type PlayerState = 'idle' | 'loading' | 'playing' | 'error';

export interface MediaLike extends EventTarget {
  src: string;
  play(): Promise<void>;
  pause(): void;
  load(): void;
  removeAttribute(name: string): void;
}

export class Player {
  state: PlayerState = 'idle';
  private gen = 0;
  private settle: ((s: PlayerState) => void) | null = null;

  constructor(
    private el: MediaLike,
    private onState: (s: PlayerState, why?: string) => void,
    private timeoutMs = 12000,
  ) {
    el.addEventListener('playing', () => this.finish('playing'));
    el.addEventListener('waiting', () => { if (this.state === 'playing') this.set('loading'); });
    el.addEventListener('error', () => this.finish('error', 'media error'));
  }

  private set(s: PlayerState, why?: string) {
    this.state = s;
    this.onState(s, why);
  }

  private finish(s: PlayerState, why?: string) {
    if (this.state === 'playing' && s === 'playing') return;
    this.set(s, why);
    if (s === 'error') { this.gen++; this.release(); }
    const f = this.settle;
    this.settle = null;
    f?.(s);
  }

  private release() {
    this.el.pause();
    this.el.removeAttribute('src');
    this.el.load();
  }

  play(url: string): Promise<PlayerState> {
    const gen = ++this.gen;
    this.settle?.('idle');
    return new Promise(resolve => {
      this.settle = resolve;
      this.set('loading');
      const timer = setTimeout(() => { if (gen === this.gen && this.state === 'loading') this.finish('error', 'timeout'); }, this.timeoutMs);
      const clear = () => clearTimeout(timer);
      this.el.addEventListener('playing', clear, { once: true });
      this.el.src = url;
      this.el.play().catch((e: Error) => {
        if (gen !== this.gen) return;
        clear();
        this.finish('error', e.name);
      });
    });
  }

  stop(): void {
    this.gen++;
    this.settle?.('idle');
    this.settle = null;
    this.release();
    this.set('idle');
  }
}
