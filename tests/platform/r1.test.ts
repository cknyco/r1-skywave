import { describe, expect, it } from 'vitest';
import { askLLM, installKeyboardFallback, installMessageHook, onPluginMessage } from '../../src/platform/r1';

function fakeWindow(extra: Record<string, unknown> = {}) {
  const t = new EventTarget() as EventTarget & Record<string, unknown>;
  Object.assign(t, { setTimeout, clearTimeout }, extra);
  return t;
}

describe('r1 bridge', () => {
  it('sends LLM prompts through PluginMessageHandler', () => {
    const sent: string[] = [];
    const w = fakeWindow({ PluginMessageHandler: { postMessage: (s: string) => sent.push(s) } });
    expect(askLLM('hi', w as never)).toBe(true);
    expect(JSON.parse(sent[0])).toEqual({ message: 'hi', useLLM: true });
  });

  it('returns false when not on the device', () => {
    expect(askLLM('hi', fakeWindow() as never)).toBe(false);
  });

  it('fans plugin messages out to subscribers', () => {
    const w = fakeWindow();
    installMessageHook(w as never);
    const got: unknown[] = [];
    const off = onPluginMessage(m => got.push(m));
    (w.onPluginMessage as (m: unknown) => void)({ message: 'x' });
    off();
    (w.onPluginMessage as (m: unknown) => void)({ message: 'y' });
    expect(got).toEqual([{ message: 'x' }]);
  });

  it('maps arrow keys to wheel events on desktop only', () => {
    const w = fakeWindow();
    installKeyboardFallback(w as never);
    let ups = 0;
    w.addEventListener('scrollUp', () => ups++);
    w.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowUp' }));
    expect(ups).toBe(1);

    const device = fakeWindow({ PluginMessageHandler: { postMessage() {} } });
    installKeyboardFallback(device as never);
    let deviceUps = 0;
    device.addEventListener('scrollUp', () => deviceUps++);
    device.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowUp' }));
    expect(deviceUps).toBe(0);
  });
});
