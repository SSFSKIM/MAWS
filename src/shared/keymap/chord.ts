// One chord syntax for the application menu and the renderer's key dispatcher (C5 execution document, Interfaces
// "Keymap and action table"): Electron accelerator strings (`Cmd+Shift+J`) parsed into what a `KeyboardEvent` carries.
// macOS only (D-11), so `CmdOrCtrl` is Cmd. The token tables below are the whole vocabulary: `CHORD_PATTERN` is built
// from them, so a string the settings schema accepts is exactly a string `parseChord` can read.

export interface Chord {
  meta: boolean;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  // A `KeyboardEvent.code` for letters, digits and punctuation ('KeyJ', 'Digit1', 'Backslash'), a `KeyboardEvent.key`
  // for named keys ('Tab', 'Enter', 'Escape'), so a chord matches the physical key whatever the keyboard layout types.
  key: string;
}

type Modifier = 'meta' | 'ctrl' | 'alt' | 'shift';
const MODIFIERS: Record<string, Modifier> = {
  Cmd: 'meta', Command: 'meta', CmdOrCtrl: 'meta', CommandOrControl: 'meta', Super: 'meta', Meta: 'meta',
  Ctrl: 'ctrl', Control: 'ctrl',
  Alt: 'alt', Option: 'alt',
  Shift: 'shift',
};

// Accelerator token → KeyboardEvent.code.
const PUNCTUATION: Record<string, string> = {
  '\\': 'Backslash', '/': 'Slash', ',': 'Comma', '.': 'Period', ';': 'Semicolon', "'": 'Quote',
  '[': 'BracketLeft', ']': 'BracketRight', '-': 'Minus', '=': 'Equal', '`': 'Backquote',
};
// Accelerator token → KeyboardEvent.key.
const NAMED: Record<string, string> = {
  Tab: 'Tab', Enter: 'Enter', Return: 'Enter', Escape: 'Escape', Esc: 'Escape', Space: ' ',
  Backspace: 'Backspace', Delete: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight',
  Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const alternatives = (tokens: string[]) => tokens.map(escape).join('|');

export const CHORD_PATTERN = new RegExp(
  `^(?:(?:${alternatives(Object.keys(MODIFIERS))})\\+)*` +
    `(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|${alternatives(Object.keys(PUNCTUATION))}|${alternatives(Object.keys(NAMED))})$`,
);

function keyOf(token: string): string | null {
  if (/^[A-Z]$/.test(token)) return `Key${token}`;
  if (/^[0-9]$/.test(token)) return `Digit${token}`;
  if (FUNCTION_KEY.test(token)) return token;
  return PUNCTUATION[token] ?? NAMED[token] ?? null;
}

export function parseChord(accelerator: string): Chord {
  const chord: Chord = { meta: false, ctrl: false, alt: false, shift: false, key: '' };
  // '+' separates tokens; a trailing empty token would be a '+' key, which the vocabulary does not include.
  const tokens = accelerator.split('+');
  const last = tokens.pop() ?? '';
  for (const token of tokens) {
    const modifier = MODIFIERS[token];
    if (!modifier) throw new Error(`unknown modifier ${JSON.stringify(token)} in chord ${JSON.stringify(accelerator)}`);
    chord[modifier] = true;
  }
  const key = keyOf(last);
  if (key === null) throw new Error(`unknown key ${JSON.stringify(last)} in chord ${JSON.stringify(accelerator)}`);
  chord.key = key;
  return chord;
}

const NAMED_KEYS = new Set(Object.values(NAMED));

type KeyEventLike = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>;

export function matchesChord(event: KeyEventLike, chord: Chord): boolean {
  if (event.metaKey !== chord.meta || event.ctrlKey !== chord.ctrl || event.altKey !== chord.alt || event.shiftKey !== chord.shift) {
    return false;
  }
  return NAMED_KEYS.has(chord.key) || FUNCTION_KEY.test(chord.key) ? event.key === chord.key : event.code === chord.key;
}

const SYMBOLS: Record<Modifier, string> = { meta: '⌘', ctrl: '⌃', alt: '⌥', shift: '⇧' };
const KEY_SYMBOLS: Record<string, string> = {
  Tab: '⇥', Enter: '↩', Return: '↩', Escape: '⎋', Esc: '⎋', Space: 'Space', Backspace: '⌫', Delete: '⌦',
  Up: '↑', Down: '↓', Left: '←', Right: '→', Home: '↖', End: '↘', PageUp: '⇞', PageDown: '⇟',
};

// For tooltips and the palette: 'Cmd+Shift+J' → '⌘⇧J', modifiers in the order the accelerator writes them.
export function formatChord(accelerator: string): string {
  parseChord(accelerator); // validates
  const tokens = accelerator.split('+');
  const last = tokens.pop() ?? '';
  return tokens.map((token) => SYMBOLS[MODIFIERS[token]]).join('') + (KEY_SYMBOLS[last] ?? last);
}
