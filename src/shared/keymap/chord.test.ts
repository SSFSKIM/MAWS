import { describe, expect, it } from 'vitest';
import { CHORD_PATTERN, formatChord, matchesChord, parseChord, type KeyEventLike } from './chord';

const key = (init: Partial<KeyEventLike>): KeyEventLike => ({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, key: '', code: '', ...init });

describe('chord parser', () => {
  it('reads letters as KeyboardEvent codes', () => {
    expect(parseChord('Cmd+Shift+J')).toEqual({ meta: true, ctrl: false, alt: false, shift: true, key: 'KeyJ' });
  });

  it('reads named keys as KeyboardEvent keys', () => {
    expect(parseChord('Ctrl+Tab')).toEqual({ meta: false, ctrl: true, alt: false, shift: false, key: 'Tab' });
    expect(parseChord('Escape').key).toBe('Escape');
    expect(parseChord('Enter').key).toBe('Enter');
  });

  it('reads punctuation and digits as codes', () => {
    expect(parseChord('Cmd+\\')).toEqual({ meta: true, ctrl: false, alt: false, shift: false, key: 'Backslash' });
    expect(parseChord('Cmd+1').key).toBe('Digit1');
  });

  it('treats CmdOrCtrl as Cmd (macOS only, D-11)', () => {
    expect(parseChord('CmdOrCtrl+K')).toEqual(parseChord('Cmd+K'));
  });

  it('throws on an unknown token', () => {
    expect(() => parseChord('Hyper+X')).toThrow(/Hyper/);
    expect(() => parseChord('Cmd+Banana')).toThrow(/Banana/);
    expect(() => parseChord('Cmd J!')).toThrow();
  });

  it('accepts in CHORD_PATTERN exactly what it can parse', () => {
    for (const ok of ['Cmd+Shift+J', 'Ctrl+Tab', 'Cmd+\\', 'Cmd+Alt+J', 'Escape', 'F12', 'Shift+Tab']) {
      expect(CHORD_PATTERN.test(ok), ok).toBe(true);
      expect(() => parseChord(ok), ok).not.toThrow();
    }
    for (const bad of ['Cmd J!', 'Hyper+X', 'Cmd+', 'cmd+j', '']) expect(CHORD_PATTERN.test(bad), bad).toBe(false);
  });

  it('matches events by code for letters and by key for named keys, with exact modifiers', () => {
    const cmdShiftJ = parseChord('Cmd+Shift+J');
    expect(matchesChord(key({ metaKey: true, shiftKey: true, key: 'J', code: 'KeyJ' }), cmdShiftJ)).toBe(true);
    expect(matchesChord(key({ metaKey: true, key: 'j', code: 'KeyJ' }), cmdShiftJ)).toBe(false);
    expect(matchesChord(key({ metaKey: true, shiftKey: true, altKey: true, key: 'J', code: 'KeyJ' }), cmdShiftJ)).toBe(false);
    expect(matchesChord(key({ ctrlKey: true, key: 'Tab', code: 'Tab' }), parseChord('Ctrl+Tab'))).toBe(true);
    expect(matchesChord(key({ key: 'Enter', code: 'NumpadEnter' }), parseChord('Enter'))).toBe(true);
  });

  it('formats for tooltips and the palette', () => {
    expect(formatChord('Cmd+Shift+J')).toBe('⌘⇧J');
    expect(formatChord('Ctrl+Tab')).toBe('⌃⇥');
    expect(formatChord('Cmd+\\')).toBe('⌘\\');
    expect(formatChord('Escape')).toBe('⎋');
  });
});
