import { afterEach, describe, expect, it, vi } from 'vitest';
import { IME_TRACE_PREFIX, imeTraceRequested, installImeTrace } from './ime-trace';
import { createXtermRenderer } from './xterm';

afterEach(() => {
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
  document.body.replaceChildren();
});

const options = {
  scrollback: 100,
  webgl: false,
  font: { family: 'monospace', size: 13, lineHeight: 1.2 },
  theme: { background: 'white', foreground: 'black', cursor: 'black', cursorAccent: 'white', selectionBackground: 'grey', ansi: Array(16).fill('black') },
};

// What a keystroke under an IME raises on the textarea, then the bytes xterm would hand on.
function typeComposed(textarea: HTMLTextAreaElement, emit: (data: string) => void) {
  textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㅎ', code: 'KeyG', keyCode: 229, isComposing: true, shiftKey: true }));
  textarea.dispatchEvent(Object.assign(new Event('compositionupdate'), { data: '한' })); // happy-dom's CompositionEvent drops `data`
  textarea.dispatchEvent(new InputEvent('input', { inputType: 'insertCompositionText', data: '한', isComposing: true }));
  emit('한');
}

describe('the IME trace (temporary, P2-F S ime-trace)', () => {
  it('is requested only by ?imeTrace=1', () => {
    expect(imeTraceRequested('')).toBe(false);
    expect(imeTraceRequested('?imeTrace=0')).toBe(false);
    expect(imeTraceRequested('?imeTrace=1')).toBe(true);
  });

  it('is inert without the flag: no listener, no subscription, no line', () => {
    const info = vi.spyOn(console, 'info');
    const textarea = document.createElement('textarea');
    const listen = vi.spyOn(textarea, 'addEventListener');
    const onData = vi.fn();
    installImeTrace(textarea, onData, false);
    typeComposed(textarea, () => {});
    expect(listen).not.toHaveBeenCalled();
    expect(onData).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('records keys, composition, input and the bytes handed on, in order, when asked', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const textarea = document.createElement('textarea');
    let emit: (data: string) => void = () => {};
    installImeTrace(textarea, (cb) => (emit = cb), true);
    typeComposed(textarea, (data) => emit(data));
    const lines = info.mock.calls.map(([line]) => String(line).replace(/ \d+\.\d /, ' T '));
    expect(lines).toEqual([
      `${IME_TRACE_PREFIX} T keydown key="ㅎ" code=KeyG keyCode=229 isComposing=true mods=shift value=""`,
      `${IME_TRACE_PREFIX} T compositionupdate data="한" value=""`,
      `${IME_TRACE_PREFIX} T input inputType=insertCompositionText data="한" isComposing=true value=""`,
      `${IME_TRACE_PREFIX} T onData ed 95 9c value=""`,
    ]);
  });

  it('is off in a terminal the page was loaded without the flag for', () => {
    const info = vi.spyOn(console, 'info');
    const renderer = createXtermRenderer(options);
    renderer.element.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA' }));
    expect(info.mock.calls.filter(([line]) => String(line).startsWith(IME_TRACE_PREFIX))).toEqual([]);
    renderer.dispose();
  });

  it('is on in a terminal of a page loaded with ?imeTrace=1', () => {
    history.replaceState(null, '', '/?imeTrace=1');
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const renderer = createXtermRenderer(options);
    renderer.element.querySelector('textarea')!.dispatchEvent(new KeyboardEvent('keyup', { key: 'a', code: 'KeyA' }));
    expect(info.mock.calls.some(([line]) => String(line).startsWith(`${IME_TRACE_PREFIX} `) && String(line).includes('keyup key="a"'))).toBe(true);
    renderer.dispose();
  });
});
