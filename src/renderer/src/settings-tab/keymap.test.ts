// The Keyboard section's pure half (C11 execution document, Interfaces "Settings tab" Keyboard; M5 decisions): a keydown
// read into Electron accelerator syntax through C5's chord vocabulary, the conflict and menu rules, and the table's rows.
import { describe, expect, it } from 'vitest';
import type { KeyEventLike } from '@shared/keymap/chord';
import { acceleratorOf, captureChord, keymapGroups } from './keymap';

const key = (code: string, keyValue: string, mods: Partial<Pick<KeyEventLike, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>> = {}): KeyEventLike => ({
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  code,
  key: keyValue,
  ...mods,
});

describe('keymap capture records, refuses conflicts and unbinds', () => {
  it('reads letters and digits by code, punctuation by code, named keys by key, modifiers in accelerator order', () => {
    expect(acceleratorOf(key('KeyU', 'U', { metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+U');
    expect(acceleratorOf(key('KeyU', 'ü', { altKey: true }))).toBe('Alt+U'); // the physical key, whatever the layout types
    expect(acceleratorOf(key('Digit7', '&', { shiftKey: true, ctrlKey: true }))).toBe('Ctrl+Shift+7');
    expect(acceleratorOf(key('Backslash', '|', { metaKey: true, shiftKey: true }))).toBe('Cmd+Shift+\\');
    expect(acceleratorOf(key('Comma', ',', { metaKey: true }))).toBe('Cmd+,');
    expect(acceleratorOf(key('ArrowUp', 'ArrowUp', { altKey: true }))).toBe('Alt+Up');
    expect(acceleratorOf(key('Space', ' ', { ctrlKey: true }))).toBe('Ctrl+Space');
    expect(acceleratorOf(key('F5', 'F5'))).toBe('F5');
    expect(acceleratorOf(key('Tab', 'Tab', { ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+Tab');
  });

  it('⌘⇧U for attention.next is taken as Cmd+Shift+U', () => {
    expect(captureChord(key('KeyU', 'U', { metaKey: true, shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'Cmd+Shift+U' });
  });

  it('refuses a chord already effective for another action, and accepts it once that action is unbound', () => {
    expect(captureChord(key('KeyK', 'k', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Already bound to Command palette · unbind it first' });
    expect(captureChord(key('KeyK', 'k', { metaKey: true }), 'attention.next', { 'palette.open': null })).toEqual({ kind: 'chord', chord: 'Cmd+K' });
    // an override takes the chord with it: palette.open moved to Cmd+P frees Cmd+K and takes Cmd+P
    expect(captureChord(key('KeyP', 'p', { metaKey: true }), 'attention.next', { 'palette.open': 'Cmd+P' })).toMatchObject({ kind: 'refused', message: 'Already bound to Command palette · unbind it first' });
  });

  it('counts the nine tab chords the menu expands Select tab 1–9 into', () => {
    expect(captureChord(key('Digit5', '5', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Already bound to Select tab 1–9 · unbind it first' });
  });

  it("an action's own chord is no conflict", () => {
    expect(captureChord(key('KeyJ', 'J', { metaKey: true, shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'Cmd+Shift+J' });
  });

  it('refuses a menu shortcut without ⌘, ⌃ or ⌥; a renderer action may take a bare key', () => {
    expect(captureChord(key('KeyU', 'u'), 'attention.next', {})).toEqual({ kind: 'refused', message: 'A menu shortcut needs ⌘, ⌃ or ⌥' });
    expect(captureChord(key('KeyU', 'U', { shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'A menu shortcut needs ⌘, ⌃ or ⌥' });
    expect(captureChord(key('F6', 'F6'), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'F6' });
    expect(captureChord(key('KeyY', 'y'), 'request.accept', {})).toEqual({ kind: 'chord', chord: 'Y' });
  });

  it('Backspace unbinds, Escape cancels, a bare modifier waits for the key', () => {
    expect(captureChord(key('Backspace', 'Backspace'), 'attention.next', {})).toEqual({ kind: 'unbind' });
    expect(captureChord(key('Escape', 'Escape'), 'attention.next', {})).toEqual({ kind: 'cancel' });
    for (const [code, k, mods] of [['MetaLeft', 'Meta', { metaKey: true }], ['ShiftRight', 'Shift', { shiftKey: true }], ['AltLeft', 'Alt', { altKey: true }], ['ControlLeft', 'Control', { ctrlKey: true }]] as const) {
      expect(captureChord(key(code, k, mods), 'attention.next', {})).toEqual({ kind: 'wait' });
    }
    // with a modifier they are chords like any other
    expect(captureChord(key('Backspace', 'Backspace', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'Cmd+Backspace' });
  });

  it("refuses a key outside C5's vocabulary with the parser's message", () => {
    expect(captureChord(key('Numpad1', '1', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'unknown key "Numpad1" in chord "Cmd+Numpad1"' });
  });
});

describe('the keymap table', () => {
  it('lists every action once, tab.select as one row, grouped by menu placement then scope, with effective chords', () => {
    const groups = keymapGroups({ 'attention.next': 'Cmd+Shift+U', 'palette.open': null });
    expect(groups.map((g) => g.label)).toEqual(['MAWS menu', 'File', 'View', 'Go', 'Help', 'App-wide', 'In a pane', 'In the composer']);
    const rows = groups.flatMap((g) => g.rows);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row('settings.open')).toMatchObject({ title: 'Settings…', chord: 'Cmd+,', display: '⌘,', overridden: false });
    expect(row('attention.next')).toMatchObject({ chord: 'Cmd+Shift+U', display: '⌘⇧U', overridden: true });
    expect(row('palette.open')).toMatchObject({ chord: null, display: 'Unbound', overridden: true });
    expect(row('tab.select')).toMatchObject({ display: '⌘1…9' });
    expect(groups.find((g) => g.label === 'View')!.rows.map((r) => r.id)).toContain('tab.next'); // a renderer action placed in a menu
    expect(groups.find((g) => g.label === 'In a pane')!.rows.map((r) => r.id)).toEqual(['request.accept', 'request.decline']);
  });
});
