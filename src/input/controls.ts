export type Action =
  | { type: 'step'; dir: 1 | -1 }
  | { type: 'toggle' }
  | { type: 'voiceStart' }
  | { type: 'voiceEnd' };

export function bindControls(target: EventTarget, emit: (a: Action) => void, invert = false): () => void {
  const handlers: Record<string, () => void> = {
    scrollDown: () => emit({ type: 'step', dir: invert ? -1 : 1 }),
    scrollUp: () => emit({ type: 'step', dir: invert ? 1 : -1 }),
    sideClick: () => emit({ type: 'toggle' }),
    longPressStart: () => emit({ type: 'voiceStart' }),
    longPressEnd: () => emit({ type: 'voiceEnd' }),
  };
  for (const [name, fn] of Object.entries(handlers)) target.addEventListener(name, fn);
  return () => {
    for (const [name, fn] of Object.entries(handlers)) target.removeEventListener(name, fn);
  };
}
