// The Keyboard section's rules (C11 execution document, Interfaces "Settings tab" Keyboard; M5 decisions), pure: a
// keydown read into Electron accelerator syntax through C5's chord vocabulary (`KeyboardEvent.code` for letters, digits
// and punctuation, `key` for named keys, exactly as C5's `Chord` matches), the capture's outcome for one action, and
// the action table as the section lists it. U6a: every row is listed, and a row takes a rebinding only when it is
// rebindable (`isRebindable`: not a fixed key of an editor, and an action build F knows, UC-14).
import { ACTIONS, effectiveChord, heldChords, idsOf, isRebindable, tabChords, type ActionId, type ActionSpec, type ActionTable, type KeymapOverrides } from '@shared/keymap/actions';
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
function chordsHeld(id: ActionId, overrides: KeymapOverrides, table: ActionTable): string[] {
  const chord = effectiveChord(id, overrides, table);
  return chord === null ? [] : heldChords(id, chord);
}

// The application menu's role item that holds `chord` window-wide (Undo, Copy, Quit…), if any.
export function reservedItemOf(chord: string): string | null {
  const wanted = parseChord(chord);
  return MENU_ROLE_CHORDS.find((role) => same(parseChord(role.chord), wanted))?.item ?? null;
}

// The action other than `id` that already holds `chord`, if any. UX wave U4a (its decision 11, which U6a's decision 7
// left to the landing with the first fixed row): a fixed row holds its key against every row that could take that key
// from the fixed row's own surface (a row of its scope, an app-wide row, a menu row), and is named first, since a fixed
// key cannot be unbound; a pane row is never delivered from a text field, so the pane's Enter and Esc can be given back.
// U6a (the U6a execution document, Interfaces D): an action given back its own default is not refused for a row that
// holds that chord as its own default too, so the table's own sharing (two composer rows on ⌘Enter) is restorable.
export function conflictOf(id: ActionId, chord: string, overrides: KeymapOverrides, table: ActionTable = ACTIONS): ActionId | null {
  const fixedHolder = fixedHolderOf(id, chord, table);
  if (fixedHolder !== null) return fixedHolder;
  const wanted = heldChords(id, chord).map(parseChord);
  const holds = (chords: string[]) => chords.some((held) => wanted.some((candidate) => same(parseChord(held), candidate)));
  const spec: ActionSpec = table[id];
  const ownDefault = spec.chord !== null && holds(heldChords(id, spec.chord));
  for (const other of idsOf(table)) {
    if (other === id || table[other].fixed) continue;
    const byDefault = !(isRebindable(other, table) && overrides[other] !== undefined);
    if (ownDefault && byDefault && table[other].chord !== null && holds(heldChords(other, table[other].chord!))) continue;
    if (holds(chordsHeld(other, overrides, table))) return other;
  }
  return null;
}

// UX wave U4a (decision 11): the fixed row whose key `chord` is, reached from `id`'s surface (a row of its scope, an
// app-wide row, a menu row), if any.
export function fixedHolderOf(id: ActionId, chord: string, table: ActionTable = ACTIONS): ActionId | null {
  const wanted = heldChords(id, chord).map(parseChord);
  const spec: ActionSpec = table[id];
  const reaches = (fixed: ActionSpec) => spec.scope === fixed.scope || spec.scope === 'app' || spec.sink === 'menu';
  return idsOf(table).find((other) => other !== id && table[other].fixed === true && reaches(table[other]) && heldChords(other, table[other].chord!).some((held) => wanted.some((candidate) => same(parseChord(held), candidate)))) ?? null;
}

export type CaptureOutcome =
  | { kind: 'wait' } // a modifier alone: keep listening
  | { kind: 'cancel' } // Escape
  | { kind: 'unbind' } // Backspace: the action keeps no chord
  | { kind: 'chord'; chord: string }
  | { kind: 'refused'; message: string };

const bare = (e: KeyEventLike) => !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;

export function captureChord(event: KeyEventLike, id: ActionId, overrides: KeymapOverrides, table: ActionTable = ACTIONS): CaptureOutcome {
  if (MODIFIER_KEYS.has(event.key)) return { kind: 'wait' };
  if (bare(event) && event.key === 'Escape') return { kind: 'cancel' };
  if (bare(event) && event.key === 'Backspace') return { kind: 'unbind' };
  const chord = acceleratorOf(event);
  try {
    parseChord(chord);
  } catch (error) {
    return { kind: 'refused', message: (error as Error).message };
  }
  // UX wave U4a (decision 11): an editor's fixed key is named first, whatever else would refuse the chord, since it
  // cannot be unbound
  const fixed = fixedHolderOf(id, chord, table);
  if (fixed !== null) return { kind: 'refused', message: KEYBOARD.fixedKey(table[fixed].title) };
  // Menu and app-wide renderer actions own their chord even in text fields. Only a function key may be bare.
  const spec: ActionSpec = table[id];
  if ((spec.sink === 'menu' || spec.scope === 'app') && !event.metaKey && !event.ctrlKey && !event.altKey && !FUNCTION_KEY.test(event.key)) return { kind: 'refused', message: spec.sink === 'menu' ? KEYBOARD.menuNeedsModifier : KEYBOARD.appNeedsModifier };
  // A role item's chord never reaches an action, whatever its sink: the menu takes it first.
  const reserved = reservedItemOf(chord);
  if (reserved !== null) return { kind: 'refused', message: KEYBOARD.reserved(reserved) };
  const taken = conflictOf(id, chord, overrides, table);
  if (taken !== null) return { kind: 'refused', message: table[taken].fixed ? KEYBOARD.fixedKey(table[taken].title) : KEYBOARD.conflict(table[taken].title) };
  return { kind: 'chord', chord };
}

export interface KeymapRow {
  id: ActionId;
  title: string;
  chord: string | null; // effective
  display: string; // the chord in symbols, `Unbound` when none
  overridden: boolean;
  rebindable: boolean; // U6a: Settings › Keyboard offers Change only here
}
export interface KeymapGroup {
  label: string;
  rows: KeymapRow[];
}

export function displayChord(id: ActionId, chord: string | null): string {
  if (chord === null) return KEYBOARD.unbound;
  const shown = formatChord(chord);
  return id === 'tab.select' && tabChords(chord) !== null ? `${shown}…9` : shown;
}

const PLACEMENTS: [ActionSpec['menu'], string][] = [['app', 'MAWS menu'], ['file', 'File'], ['edit', 'Edit'], ['view', 'View'], ['go', 'Go'], ['help', 'Help']];
const SCOPES: [ActionSpec['scope'], string][] = [['app', 'App-wide'], ['pane', 'In a pane'], ['composer', 'In the composer']];
const SCOPE_ORDER: ActionSpec['scope'][] = ['app', 'pane', 'composer'];

// The table as the section and the shortcut sheet list it, grouped as the menus draw it (U6a): for each menu placement,
// its rows that name no submenu, then one group per submenu in the order the submenus first appear in the table,
// labelled with its path (`View › Tabs`, as the app writes a menu path); then the rows no menu holds by scope, fixed
// keys among them. Within a group by scope, then the table's own order.
export function keymapGroups(overrides: KeymapOverrides, table: ActionTable = ACTIONS): KeymapGroup[] {
  const ids = idsOf(table);
  const row = (id: ActionId): KeymapRow => {
    const chord = effectiveChord(id, overrides, table);
    const rebindable = isRebindable(id, table);
    return { id, title: table[id].title, chord, display: displayChord(id, chord), overridden: rebindable && overrides[id] !== undefined, rebindable };
  };
  const byScope = (rows: ActionId[]) => [...rows].sort((a, b) => SCOPE_ORDER.indexOf(table[a].scope) - SCOPE_ORDER.indexOf(table[b].scope));
  const placed = (menu: ActionSpec['menu'], label: string): KeymapGroup[] => {
    const inMenu = ids.filter((id) => table[id].menu === menu);
    const submenus = [...new Set(inMenu.flatMap((id) => table[id].submenu ?? []))];
    return [
      { label, rows: byScope(inMenu.filter((id) => table[id].submenu === undefined)).map(row) },
      ...submenus.map((name) => ({ label: `${label} › ${name}`, rows: byScope(inMenu.filter((id) => table[id].submenu === name)).map(row) })),
    ];
  };
  const groups: KeymapGroup[] = [
    ...PLACEMENTS.flatMap(([menu, label]) => placed(menu, label)),
    ...SCOPES.map(([scope, label]) => ({ label, rows: ids.filter((id) => table[id].menu === null && table[id].scope === scope).map(row) })),
  ];
  return groups.filter((g) => g.rows.length > 0);
}
