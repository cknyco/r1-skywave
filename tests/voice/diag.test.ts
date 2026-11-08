import { describe, expect, it } from 'vitest';
import { Diag, kindOf, sanitize } from '../../src/voice/diag';
import { readReply } from '../../src/voice/intent';

describe('voice log (Ruling 44)', () => {
  it('dumps a message as JSON without the plugin id, control characters as spaces, at most 80 characters', () => {
    expect(sanitize({ message: 'ok', pluginId: 'secret-install-id', data: '{"place":"Tokyo"}' }))
      .toBe('{"message":"ok","data":"{\\"place\\":\\"Tokyo\\"}"}');
    expect(sanitize('line one\nline two\t!')).toBe('line one line two !');
    expect(sanitize('x'.repeat(200))).toHaveLength(80);
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(sanitize(loop)).toBe('[object Object]');
  });

  it('names the kind of a bridge message', () => {
    const k = (m: object) => kindOf(m, readReply(m));
    expect(k({ type: 'sttEnded', transcript: 'hi' })).toBe('sttEnded');
    expect(k({ message: 'STT started', data: '{"type":"sttStarted"}' })).toBe('sttStarted');
    expect(k({ data: '{"place":"Tokyo","country":null,"genre":null}' })).toBe('llm-reply');
    expect(k({ message: 'Taking you to Lisbon' })).toBe('llm-reply');
    expect(k({ data: '{"type":"somethingElse"}' })).toBe('other');
    expect(k({})).toBe('other');
  });

  it('keeps the last entries, timed from the latest voice start', () => {
    let now = 1000;
    const d = new Diag(3, () => now);
    d.push('other', 'before any search');
    now = 5000;
    d.start();
    now = 5250;
    d.push('sttEnded', { type: 'sttEnded', transcript: 'take me to Tokyo' });
    now = 7000;
    d.push('result', 'fast path: Aoi, JP');
    expect(d.lines()).toEqual([
      '+0 voice start',
      '+250 sttEnded {"type":"sttEnded","transcript":"take me to Tokyo"}',
      '+2000 result fast path: Aoi, JP',
    ]);
    expect(d.entries()).toHaveLength(3);
  });

  it('the wheel log (2026-10-18): timed from the latest ✈ tap, a run of equal events in one line', () => {
    let now = 1000;
    const d = new Diag(4, () => now, true);
    d.push('wheel', 'step → volume');
    now = 2000;
    d.start('fly', 'tap → fly 3000 ms left');
    now = 2400;
    d.push('wheel', 'step → volume');
    now = 2500;
    d.push('wheel', 'step → volume');
    d.push('wheel', 'step → volume');
    now = 2600;
    d.push('fly', 'moving → volume');
    expect(d.lines()).toEqual([
      '+0 wheel step → volume',   // timed when it happened, from the log's own start
      '+0 fly tap → fly 3000 ms left',
      '+400 wheel step → volume ×3',
      '+600 fly moving → volume',
    ]);
    const plain = new Diag(4, () => now);   // the voice log keeps every event on its own line
    plain.push('other', 'a');
    plain.push('other', 'a');
    expect(plain.lines()).toEqual(['+0 other a', '+0 other a']);
  });
});
