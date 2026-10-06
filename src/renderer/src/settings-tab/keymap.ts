// The Keyboard section's rules (C11 execution document, Interfaces "Settings tab" Keyboard; M5 decisions), pure: a
// keydown read into Electron accelerator syntax through C5's chord vocabulary (`KeyboardEvent.code` for letters, digits
// and punctuation, `key` for named keys, exactly as C5's `Chord` matches), the capture's outcome for one action, and
// the action table as the section lists it. Every action is editable (C5's residue: all bindings editable).
import { ACTIONS, ACTION_IDS, effectiveChord, type ActionId, type ActionSpec, type KeymapOverrides } from '@shared/keymap/actions';
import { formatChord, parseChord, type Chord, type KeyEventLike } from '@shared/keymap/chord';
import { MENU_ROLE_CHORDS } from '@shared/keymap/menu-roles';
import { KEYBOARD } from './copy';

// KeyboardEvent.code → accelerator token for punctuation (the inverse of C5's table in chord.ts).
const PUNCTUATION: Record<string, string> = {
  Backslash: '\\', Slash: '/', Comma: ',', Period: '.', Semicolon: ';', Quote: "'",
  BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`',
};
// KeyboardEvent.key → accelerator token for named keys (Space is read by its code: E9, Option+Space types a no-break space).
const NAMED: Record<string, string> = {
  Tab: 'Tab', Enter: 'Enter', Escape: 'Escape', Backspace: 'Backspace', Delete: 'Delete',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
};
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'CapsLock', 'Fn', 'OS']);
const FUNCTION_KEY = /^F([1-9]|1[0-9]|2[0-4])$/;

function tokenOf(event: KeyEventLike): string {
  const letter = /^Key([A-Z])$/.exec(event.code);
  if (letter) return letter[1]!;
  const digit = /^Digit([0-9])$/.exec(event.code);
  if (digit) return digit[1]!;
  if (PUNCTUATION[event.code]) return PUNCTUATION[event.code]!;
  if (event.code === 'Space') return 'Space'; // E9
  if (NAMED[event.key]) return NAMED[event.key]!;
  if (FUNCTION_KEY.test(event.key)) return event.key;
  return event.code || event.key; // outside the vocabulary: parseChord refuses it with its own message
}

// The accelerator a keydown reads as, modifiers in the order the table writes them (Cmd, Ctrl, Alt, Shift).
export function acceleratorOf(event: KeyEventLike): string {
  const mods = [event.metaKey && 'Cmd', event.ctrlKey && 'Ctrl', event.altKey && 'Alt', event.shiftKey && 'Shift'].filter(Boolean);
  return [...mods, tokenOf(event)].join('+');
}

const same = (a: Chord, b: Chord) => a.meta === b.meta && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift && a.key === b.key;

// The chords an action holds: its effective chord, and for Select tab 1–9 the nine the menu expands it into.
function chordsHeld(id: ActionId, overrides: KeymapOverrides): string[] {
  const chord = effectiveChord(id, overrides);
  if (chord === null) return [];
  if (id === 'tab.select' && chord.endsWith('1')) return Array.from({ length: 9 }, (_, i) => `${chord.slice(0, -1)}${i + 1}`);
  return [chord];
}

// The application menu's role item that holds `chord` window-wide (Undo, Copy, Quit…), if any.
export function reservedItemOf(chord: string): string | null {
  const wanted = parseChord(chord);
  return MENU_ROLE_CHORDS.find((role) => same(parseChord(role.chord), wanted))?.item ?? null;
}

// The action other than `id` that already holds `chord`, if any.
export function conflictOf(id: ActionId, chord: string, overrides: KeymapOverrides): ActionId | null {
  const wanted = chordsHeld(id, { ...overrides, [id]: chord }).map(parseChord);
  for (const other of ACTION_IDS) {
    if (other === id) continue;
    if (chordsHeld(other, overrides).some((held) => wanted.some((candidate) => same(parseChord(held), candidate)))) return other;
  }
  return null;
}

export type CaptureOutcome =
  | { kind: 'wait' } // a modifier alone: keep listening
  | { kind: 'cancel' } // Escape
  | { kind: 'unbind' } // Backspace: the action keeps no chord
  | { kind: 'chord'; chord: string }
  | { kind: 'refused'; message: string };

const bare = (e: KeyEventLike) => !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

export function captureChord(event: KeyEventLike, id: ActionId, overrides: KeymapOverrides): CaptureOutcome {
  if (MODIFIER_KEYS.has(event.key)) return { kind: 'wait' };
  if (bare(event) && event.key === 'Escape') return { kind: 'cancel' };
  if (bare(event) && event.key === 'Backspace') return { kind: 'unbind' };
  const chord = acceleratorOf(event);
  try {
    parseChord(chord);
  } catch (error) {
    return { kind: 'refused', message: (error as Error).message };
  }
  // Menu and app-wide renderer actions own their chord even in text fields. Only a function key may be bare.
  const spec: ActionSpec = ACTIONS[id];
  if ((spec.sink === 'menu' || spec.scope === 'app') && !event.metaKey && !event.ctrlKey && !event.altKey && !FUNCTION_KEY.test(event.key)) return { kind: 'refused', message: spec.sink === 'menu' ? KEYBOARD.menuNeedsModifier : KEYBOARD.appNeedsModifier };
  // A role item's chord never reaches an action, whatever its sink: the menu takes it first.
  const reserved = reservedItemOf(chord);
  if (reserved !== null) return { kind: 'refused', message: KEYBOARD.reserved(reserved) };
  const taken = conflictOf(id, chord, overrides);
  if (taken !== null) return { kind: 'refused', message: KEYBOARD.conflict(ACTIONS[taken].title) };
  return { kind: 'chord', chord };
}

export interface KeymapRow {
  id: ActionId;
  title: string;
  chord: string | null; // effective
  display: string; // the chord in symbols, `Unbound` when none
  overridden: boolean;
}
export interface KeymapGroup {
  label: string;
  rows: KeymapRow[];
}

export function displayChord(id: ActionId, chord: string | null): string {
  if (chord === null) return KEYBOARD.unbound;
  const shown = formatChord(chord);
  return id === 'tab.select' && chord.endsWith('1') ? `${shown}…9` : shown;
}

const PLACEMENTS: [ActionSpec['menu'], string][] = [['app', 'MAWS menu'], ['file', 'File'], ['view', 'View'], ['go', 'Go'], ['help', 'Help']];
const SCOPES: [ActionSpec['scope'], string][] = [['app', 'App-wide'], ['pane', 'In a pane'], ['composer', 'In the composer']];
const SCOPE_ORDER: ActionSpec['scope'][] = ['app', 'pane', 'composer'];

// The table as the section lists it: by menu placement, then the actions no menu holds by scope; within a group by
// scope, then the table's own order.
export function keymapGroups(overrides: KeymapOverrides): KeymapGroup[] {
  const row = (id: ActionId): KeymapRow => {
    const chord = effectiveChord(id, overrides);
    return { id, title: ACTIONS[id].title, chord, display: displayChord(id, chord), overridden: overrides[id] !== undefined };
  };
  const byScope = (ids: ActionId[]) => [...ids].sort((a, b) => SCOPE_ORDER.indexOf(ACTIONS[a].scope) - SCOPE_ORDER.indexOf(ACTIONS[b].scope));
  const spec = (id: ActionId): ActionSpec => ACTIONS[id];
  const groups: KeymapGroup[] = [
    ...PLACEMENTS.map(([menu, label]) => ({ label, rows: byScope(ACTION_IDS.filter((id) => spec(id).menu === menu)).map(row) })),
    ...SCOPES.map(([scope, label]) => ({ label, rows: ACTION_IDS.filter((id) => spec(id).menu === null && spec(id).scope === scope).map(row) })),
  ];
  return groups.filter((g) => g.rows.length > 0);
}
