import { LONG_PRESS_MS } from '../config';

export interface PluginMessage {
  message?: string;
  data?: string;
  type?: string;
  transcript?: string;
}

interface Poster { postMessage(s: string): void }
type Win = EventTarget & {
  PluginMessageHandler?: Poster;
  CreationVoiceHandler?: Poster;
  closeWebView?: Poster;
  onPluginMessage?: (m: PluginMessage) => void;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
};
const W = () => globalThis as unknown as Win;

export const isDevice = (w: Win = W()) => typeof w.PluginMessageHandler !== 'undefined';

export function askLLM(prompt: string, w: Win = W()): boolean {
  if (!w.PluginMessageHandler) return false;
  w.PluginMessageHandler.postMessage(JSON.stringify({ message: prompt, useLLM: true }));
  return true;
}

export function startVoice(w: Win = W()): boolean {
  if (!w.CreationVoiceHandler) return false;
  w.CreationVoiceHandler.postMessage('start');
  return true;
}

export function stopVoice(w: Win = W()): void {
  w.CreationVoiceHandler?.postMessage('stop');
}

const listeners = new Set<(m: PluginMessage) => void>();

export function onPluginMessage(fn: (m: PluginMessage) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function installMessageHook(w: Win = W()): void {
  w.onPluginMessage = m => listeners.forEach(fn => fn(m));
}

/** Desktop only: arrows = wheel, Space = side button (hold for long press). */
export function installKeyboardFallback(w: Win = W()): void {
  if (isDevice(w)) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let long = false;
  w.addEventListener('keydown', e => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowUp') w.dispatchEvent(new Event('scrollUp'));
    else if (k === 'ArrowDown') w.dispatchEvent(new Event('scrollDown'));
    else if (k === ' ' && !(e as KeyboardEvent).repeat) {
      long = false;
      timer = w.setTimeout(() => { long = true; w.dispatchEvent(new Event('longPressStart')); }, LONG_PRESS_MS);
    }
  });
  w.addEventListener('keyup', e => {
    if ((e as KeyboardEvent).key !== ' ') return;
    w.clearTimeout(timer);
    w.dispatchEvent(new Event(long ? 'longPressEnd' : 'sideClick'));
  });
}
