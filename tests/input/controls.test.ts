import { describe, expect, it } from 'vitest';
import { bindControls, type Action } from '../../src/input/controls';

describe('controls', () => {
  function setup(invert = false) {
    const t = new EventTarget(), got: Action[] = [];
    const off = bindControls(t, a => got.push(a), invert);
    const fire = (n: string) => t.dispatchEvent(new Event(n));
    return { got, fire, off };
  }

  it('maps the wheel to steps, with optional inversion', () => {
    const a = setup();
    a.fire('scrollDown'); a.fire('scrollUp');
    expect(a.got).toEqual([{ type: 'step', dir: 1 }, { type: 'step', dir: -1 }]);
    const b = setup(true);
    b.fire('scrollDown');
    expect(b.got).toEqual([{ type: 'step', dir: -1 }]);
  });

  it('a single sideClick toggles synchronously, with no timer', () => {
    const { got, fire } = setup();
    fire('sideClick');
    expect(got).toEqual([{ type: 'toggle' }]);
  });

  it('two quick sideClicks give two toggles', () => {
    const { got, fire } = setup();
    fire('sideClick'); fire('sideClick');
    expect(got).toEqual([{ type: 'toggle' }, { type: 'toggle' }]);
  });

  it('long press maps to voice', () => {
    const { got, fire } = setup();
    fire('longPressStart'); fire('longPressEnd');
    expect(got).toEqual([{ type: 'voiceStart' }, { type: 'voiceEnd' }]);
  });

  it('unbinds', () => {
    const { got, fire, off } = setup();
    off();
    fire('scrollDown');
    expect(got).toEqual([]);
  });
});
