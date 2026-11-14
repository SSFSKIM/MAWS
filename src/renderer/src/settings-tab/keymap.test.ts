// The Keyboard section's pure half (C11 execution document, Interfaces "Settings tab" Keyboard; M5 decisions): a keydown
// read into Electron accelerator syntax through C5's chord vocabulary, the conflict and menu rules, and the table's rows.
import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_IDS, idsOf, isRebindable, type ActionTable, type KeymapOverrides } from '@shared/keymap/actions';
import type { KeyEventLike } from '@shared/keymap/chord';
import { EXTENDED_TABLE, SAMPLE_IDS, SAMPLE_ROWS, sample } from '@shared/keymap/sample-rows'; // U6a
import { acceleratorOf, captureChord, displayChord, keymapGroups } from './keymap';

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
    expect(captureChord(key('F6', 'F6'), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Already bound to Focus next region · unbind it first' });
    expect(captureChord(key('F6', 'F6'), 'attention.next', { 'region.focusNext': null })).toEqual({ kind: 'chord', chord: 'F6' });
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
    expect(captureChord(key('F7', 'F7'), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'F7' });
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

  it("refuses the application menu's role chords, naming the item, for any action", () => {
    expect(captureChord(key('KeyC', 'c', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Copy' });
    expect(captureChord(key('KeyZ', 'Z', { metaKey: true, shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Redo' });
    expect(captureChord(key('KeyV', 'V', { metaKey: true, altKey: true, shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Paste and Match Style' });
    expect(captureChord(key('KeyH', '˙', { metaKey: true, altKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Hide Others' });
    expect(captureChord(key('KeyF', 'f', { metaKey: true, ctrlKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Toggle Full Screen' });
    expect(captureChord(key('KeyQ', 'q', { metaKey: true }), 'composer.focus', {})).toEqual({ kind: 'refused', message: 'Reserved by macOS · Quit MAWS' }); // a renderer action too
    // the same letters under other modifiers are free
    expect(captureChord(key('KeyC', 'C', { metaKey: true, shiftKey: true }), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'Cmd+Shift+C' });
    expect(captureChord(key('KeyM', 'µ', { metaKey: true, altKey: true }), 'attention.next', {})).toEqual({ kind: 'chord', chord: 'Cmd+Alt+M' });
  });

  it("refuses a key outside C5's vocabulary with the parser's message", () => {
    expect(captureChord(key('Numpad1', '1', { metaKey: true }), 'attention.next', {})).toEqual({ kind: 'refused', message: 'unknown key "Numpad1" in chord "Cmd+Numpad1"' });
  });
});

const PLACEMENT_LABEL = { app: 'MAWS menu', file: 'File', edit: 'Edit', view: 'View', go: 'Go', help: 'Help' } as const;
const SCOPE_LABEL = { app: 'App-wide', pane: 'In a pane', composer: 'In the composer' } as const;
const TABLES: [string, ActionTable][] = [['the table', ACTIONS], ['the table with the sample rows', EXTENDED_TABLE]]; // U6a (decision 12)
const subsequence = (whole: string[], part: string[]) => {
  let at = 0;
  for (const token of whole) if (token === part[at]) at++;
  return at === part.length;
};

describe('the keymap table', () => {
  it('lists every action once, tab.select as one row, grouped by menu placement, submenu, then scope, with effective chords', () => {
    const groups = keymapGroups({ 'attention.next': 'Cmd+Shift+U', 'palette.open': null });
    const labels = groups.map((g) => g.label);
    expect(subsequence(labels, ['MAWS menu', 'File', 'View', 'View › Tabs', 'View › More surfaces', 'View › Comments', 'View › Appearance', 'Go', 'Help', 'App-wide', 'In a pane', 'In the composer']), labels.join(' · ')).toBe(true);
    const rows = groups.flatMap((g) => g.rows);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    const row = (id: string) => rows.find((r) => r.id === id)!;
    expect(row('settings.open')).toMatchObject({ title: 'Settings…', chord: 'Cmd+,', display: '⌘,', overridden: false, rebindable: true });
    expect(row('attention.next')).toMatchObject({ chord: 'Cmd+Shift+U', display: '⌘⇧U', overridden: true });
    expect(row('palette.open')).toMatchObject({ chord: null, display: 'Unbound', overridden: true });
    expect(row('tab.select')).toMatchObject({ display: '⌘1…9' });
    expect(row('surface.terminal')).toMatchObject({ title: 'Terminal', chord: 'Cmd+J', display: '⌘J' });
    expect(groups.find((g) => g.label === 'View › Tabs')!.rows.map((r) => r.id)).toEqual(['tab.select', 'tab.next', 'tab.previous']); // renderer actions placed in a menu's submenu
    expect(groups.find((g) => g.label === 'In a pane')!.rows.map((r) => r.id)).toEqual(expect.arrayContaining(['request.accept', 'request.decline', 'request.allowOnce', 'request.allowLasting']));
    // UX wave U1a (§D): the two keys a permission prompt gains, and the titles the four request rows read
    expect(row('request.allowOnce')).toMatchObject({ title: 'Allow once', chord: 'Cmd+Enter', display: '⌘↩', rebindable: false });
    expect(row('request.allowLasting')).toMatchObject({ title: 'Allow with the lasting scope the prompt names', chord: 'Cmd+Shift+Enter', display: '⌘⇧↩', rebindable: false });
    expect(row('request.decline')).toMatchObject({ title: 'Deny a prompt, or decline a question', display: '⎋' });
    expect(row('request.accept')).toMatchObject({ title: 'Next or Submit on a question; Implement on a plan', display: '↩' });
  });

  // A9: the sheet and Settings list every row once, under the group the menus draw it in
  it.each(TABLES)('puts every row in exactly one group, labelled by its placement, its submenu’s path or its scope (%s)', (_name, table) => {
    const groups = keymapGroups({}, table);
    expect(groups.flatMap((g) => g.rows.map((r) => r.id)).sort()).toEqual([...idsOf(table)].sort());
    for (const group of groups) {
      expect(group.rows.length, group.label).toBeGreaterThan(0);
      for (const { id } of group.rows) {
        const spec = table[id];
        const label = spec.menu === null ? SCOPE_LABEL[spec.scope] : spec.submenu === undefined ? PLACEMENT_LABEL[spec.menu] : `${PLACEMENT_LABEL[spec.menu]} › ${spec.submenu}`;
        expect(group.label, id).toBe(label);
      }
    }
  });

  it('lists a sibling’s rows with no edit here: an edit row’s submenu, a fixed row under its scope, neither rebindable', () => {
    const groups = keymapGroups({}, EXTENDED_TABLE);
    const labels = groups.map((g) => g.label);
    expect(labels.indexOf('Edit › Sample')).toBe(labels.indexOf('File') + 1); // after File, before View: no Edit row names no submenu
    const composer = groups.find((g) => g.label === 'In the composer')!.rows;
    expect(composer.find((r) => r.id === sample('sample.fixed'))).toMatchObject({ chord: 'Shift+Enter', display: '⇧↩', rebindable: false });
    const rows = groups.flatMap((g) => g.rows);
    for (const id of SAMPLE_IDS) expect(rows.find((r) => r.id === id)!.rebindable, id).toBe(false);
    for (const id of ACTION_IDS) expect(rows.find((r) => r.id === id)!.rebindable, id).toBe(isRebindable(id)); // today's rows keep their control; a row build F does not know takes none (U11a M5's channel.open, U1a's two)
    expect(ACTION_IDS.filter((id) => !isRebindable(id))).toEqual(['channel.open', 'request.allowOnce', 'request.allowLasting', 'composer.submit', 'composer.newLine', 'composer.newLineOption', 'composer.queue', 'composer.takeBack', 'composer.sendNowOrStop', 'composer.historySearch', 'composer.modelMenu', 'composer.effortMenu', 'composer.modeMenu']); // U11a M5's one; U1a's two; U4a's four (M2), two (M3), three (M5) and one (M6)
  });

  it('shows a row that yields its default to a stored rebinding as unbound, and an override it cannot take as no override', () => {
    const chord = SAMPLE_ROWS['sample.menu'].chord;
    const rows = keymapGroups({ 'palette.open': chord, [sample('sample.shared')]: 'Cmd+Y' } as KeymapOverrides, EXTENDED_TABLE).flatMap((g) => g.rows);
    expect(rows.find((r) => r.id === sample('sample.menu'))).toMatchObject({ chord: null, display: 'Unbound', overridden: false });
    expect(rows.find((r) => r.id === 'palette.open')).toMatchObject({ chord, overridden: true });
    expect(rows.find((r) => r.id === sample('sample.shared'))).toMatchObject({ chord: 'Cmd+Enter', overridden: false });
  });
});

// U6a (the U6a execution document, Interfaces D; decisions 7 and 10): what the capture counts as holding a chord
describe('the capture’s conflicts', () => {
  // UX wave U4a (its decision 11, which U6a's decision 7 left to the landing with the first fixed row): a fixed row holds
  // its key against every row that could take it from the fixed row's surface (its own scope, an app-wide row, a menu
  // row), in words of its own, since a fixed key cannot be unbound; a pane row is never delivered from a text field
  const enter = key('Enter', 'Enter');
  const shiftEnter = key('Enter', 'Enter', { shiftKey: true });
  const optionEnter = key('Enter', 'Enter', { altKey: true });

  it('refuses a composer row the composer’s fixed keys, saying which key keeps it', () => {
    expect(captureChord(enter, 'composer.cycleMode', {})).toEqual({ kind: 'refused', message: 'Send keeps this key' });
    expect(captureChord(shiftEnter, 'composer.cycleMode', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    expect(captureChord(optionEnter, 'composer.cycleMode', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    expect(captureChord(shiftEnter, sample('sample.shared'), {}, EXTENDED_TABLE)).toEqual({ kind: 'refused', message: 'New line keeps this key' }); // a sibling's composer row alike
  });

  it('refuses an app-wide or a menu row a fixed key it could take, and leaves a pane row free to take it', () => {
    expect(captureChord(optionEnter, 'composer.stop', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    expect(captureChord(optionEnter, 'attention.next', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    // a bare key too: the fixed key's sentence, not the modifier rule's
    expect(captureChord(enter, 'composer.stop', {})).toEqual({ kind: 'refused', message: 'Send keeps this key' });
    expect(captureChord(enter, 'attention.next', {})).toEqual({ kind: 'refused', message: 'Send keeps this key' });
    expect(captureChord(shiftEnter, 'composer.stop', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    expect(captureChord(shiftEnter, 'attention.next', {})).toEqual({ kind: 'refused', message: 'New line keeps this key' });
    expect(captureChord(key('KeyU', 'u'), 'attention.next', {})).toEqual({ kind: 'refused', message: 'A menu shortcut needs ⌘, ⌃ or ⌥' }); // any other bare key as before
    expect(captureChord(shiftEnter, 'request.accept', {}, EXTENDED_TABLE)).toEqual({ kind: 'chord', chord: 'Shift+Enter' });
    expect(captureChord(optionEnter, 'request.decline', {})).toEqual({ kind: 'chord', chord: 'Alt+Enter' });
  });

  it('gives request.accept its Enter back after it was moved', () => {
    expect(captureChord(enter, 'request.accept', { 'request.accept': 'Y' })).toEqual({ kind: 'chord', chord: 'Enter' });
  });

  it('accepts an action’s own default where another row shares it by default, and refuses that chord for any other action', () => {
    const cmdEnter = key('Enter', 'Enter', { metaKey: true });
    expect(captureChord(cmdEnter, 'composer.send', { 'composer.send': null }, EXTENDED_TABLE)).toEqual({ kind: 'chord', chord: 'Cmd+Enter' });
    expect(captureChord(cmdEnter, 'request.accept', {}, EXTENDED_TABLE)).toEqual({ kind: 'refused', message: 'Already bound to Allow once · unbind it first' }); // U1a: the first row holding ⌘↩
    // a row holding it by its own override is still a conflict
    expect(captureChord(cmdEnter, 'composer.send', { 'composer.send': null, 'composer.cycleMode': 'Cmd+Enter' }, EXTENDED_TABLE)).toEqual({ kind: 'refused', message: 'Already bound to Cycle permission mode · unbind it first' });
  });
});

it('refuses printable app-wide renderer shortcuts, including Shift-only, without restricting pane shortcuts', () => {
  expect(captureChord(key('KeyS', 's'), 'composer.stop', {})).toMatchObject({ kind: 'refused' });
  expect(captureChord(key('KeyS', 'S', { shiftKey: true }), 'composer.stop', {})).toMatchObject({ kind: 'refused' });
  expect(captureChord(key('Space', ' '), 'composer.stop', {})).toMatchObject({ kind: 'refused' });
  expect(captureChord(key('F7', 'F7'), 'composer.stop', {})).toEqual({ kind: 'chord', chord: 'F7' });
  expect(captureChord(key('KeyY', 'y'), 'request.accept', {})).toEqual({ kind: 'chord', chord: 'Y' });
});

it('checks every generated candidate digit when rebinding Select tab 1–9', () => {
  const event = key('Digit1', '!', { metaKey: true, shiftKey: true });
  expect(captureChord(event, 'tab.select', { 'attention.next': 'Cmd+Shift+5' })).toEqual({ kind: 'refused', message: 'Already bound to Next Needs-you · unbind it first' });
  expect(captureChord(event, 'tab.select', { 'attention.next': null })).toEqual({ kind: 'chord', chord: 'Cmd+Shift+1' });
});

// E9 start: Option+Space reports a no-break space as its key; the capture reads Space by its code (Design §5)
it('reads Space by its code, and refuses a bare Space for the app-wide hold to dictate', () => {
  expect(acceleratorOf(key('Space', ' ', { altKey: true }))).toBe('Alt+Space');
  expect(acceleratorOf(key('Space', '\u00a0', { altKey: true }))).toBe('Alt+Space');
  expect(captureChord(key('Space', ' '), 'composer.dictate', {})).toEqual({ kind: 'refused', message: 'An app-wide shortcut needs ⌘, ⌃ or ⌥' });
  expect(captureChord(key('Space', '\u00a0', { altKey: true }), 'composer.dictate', {})).toEqual({ kind: 'chord', chord: 'Alt+Space' });
});
// E9 end

// The panel's finding of 2026-11-12 ("tab-chord expansion past F24"): only a chord whose key is the digit 1 reads as nine
it('shows Select tab numbered through nine only for a chord whose key is the digit 1', () => {
  expect(displayChord('tab.select', 'Cmd+1')).toBe('⌘1…9');
  expect(displayChord('tab.select', 'F21')).toBe('F21');
  expect(displayChord('tab.select', 'F11')).toBe('F11');
  expect(keymapGroups({ 'tab.select': 'F21' }).flatMap((g) => g.rows).find((r) => r.id === 'tab.select')).toMatchObject({ chord: 'F21', display: 'F21' });
});
