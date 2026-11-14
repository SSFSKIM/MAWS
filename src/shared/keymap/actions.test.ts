import { describe, expect, it } from 'vitest';
import { ACTION_IDS, ACTIONS, effectiveChord, heldChords, idsOf, isRebindable, type ActionId, type ActionSpec, type ActionTable, type KeymapOverrides } from './actions';
import { BUILD_F_ACTION_IDS } from './build-f';
import { parseChord } from './chord';
import { MENU_ROLE_CHORDS } from './menu-roles';
import { EXTENDED_TABLE, SAMPLE_IDS, SAMPLE_ROWS, sample } from './sample-rows';

const specs = Object.entries(ACTIONS);
const TABLES: [string, ActionTable][] = [['the table', ACTIONS], ['the table with the sample rows', EXTENDED_TABLE]];
const normal = (chord: string) => JSON.stringify(parseChord(chord));
const over = (id: ActionId, chord: string | null) => ({ [id]: chord }) as KeymapOverrides;
const withRow = (id: ActionId, spec: ActionSpec, table: ActionTable = EXTENDED_TABLE) => ({ ...table, [id]: spec }) as ActionTable;

// UC-6's table as the spec's files give it (the root's UC-6; U1, U3, U4, U6 and U11 under their "UC-6" entries; U6a's
// execution document, Interfaces E). Checked for every id that is a row, so a child's row is held from the landing that
// adds it with no edit here; a child whose execution settles another id or chord amends this list in its own change.
const WAVE_DEFAULTS: Record<string, string | null> = {
  // U6a
  'surface.terminal': 'Cmd+J', 'surface.review': 'Cmd+Shift+D', 'surface.files': 'Cmd+Shift+F',
  // U6b
  'files.goToFile': 'Cmd+P', 'terminal.attachSelection': 'Cmd+Shift+L', 'go.back': 'Cmd+[', 'go.forward': 'Cmd+]',
  'zoom.in': 'Cmd+=', 'zoom.out': 'Cmd+-', 'zoom.reset': null,
  // U3
  'transcript.find': 'Cmd+F', 'transcript.findNext': 'Cmd+G', 'transcript.findPrevious': 'Cmd+Shift+G',
  'transcript.previousPrompt': 'Cmd+Alt+Up', 'transcript.nextPrompt': 'Cmd+Alt+Down',
  // U4
  'composer.queue': 'Cmd+Enter', 'composer.send': 'Cmd+Enter', 'composer.modelMenu': 'Cmd+Shift+I',
  'composer.effortMenu': 'Cmd+Shift+E', 'composer.modeMenu': 'Cmd+Shift+M', 'composer.historySearch': 'Ctrl+R',
  'composer.submit': 'Enter', 'composer.newLine': 'Shift+Enter', 'composer.newLineOption': 'Alt+Enter',
  'composer.takeBack': 'Up', 'composer.sendNowOrStop': 'Escape',
  // U1
  'request.allowOnce': 'Cmd+Enter', 'request.allowLasting': 'Cmd+Shift+Enter', 'request.decline': 'Escape', 'request.accept': 'Enter',
  // U11
  'channel.open': null,
  // "Existing chords do not move"
  'tab.overview': 'Cmd+0', 'palette.open': 'Cmd+K', 'composer.focus': 'Cmd+L', 'composer.stop': 'Cmd+.', 'attention.next': 'Cmd+Shift+J',
  'shortcuts.open': 'Cmd+/', 'sidebar.toggle': 'Cmd+B', 'panel.toggle': 'Cmd+Shift+B', 'pane.split': 'Cmd+\\',
};
// The rows of landed children: each must exist (U6b adds its seven; U11a its one).
const LANDED = [
  'surface.terminal', 'surface.review', 'surface.files', 'channel.open',
  // U4a: M2's rows
  'composer.submit', 'composer.newLine', 'composer.newLineOption', 'composer.queue',
  // U4a: M3's rows
  'composer.takeBack', 'composer.sendNowOrStop',
  // U4a: M5's rows
  'composer.modelMenu', 'composer.effortMenu', 'composer.modeMenu',
  // U4a: M6's row
  'composer.historySearch',
];

// Decision 8 (A13 as amended): two dispatched rows share a default chord only if both are `renderer` rows and at most one
// of them has scope `app`. Every chord a row holds counts, the nine of Select tab included.
function sharingBroken(table: ActionTable): string[] {
  const holders = new Map<string, ActionId[]>();
  for (const id of idsOf(table)) {
    const spec = table[id];
    if (spec.fixed || spec.chord === null) continue;
    for (const chord of heldChords(id, spec.chord)) holders.set(normal(chord), [...(holders.get(normal(chord)) ?? []), id]);
  }
  return [...holders.values()].flatMap((ids) => {
    if (ids.length < 2) return [];
    const allowed = ids.every((id) => table[id].sink === 'renderer') && ids.filter((id) => table[id].scope === 'app').length <= 1;
    return allowed ? [] : [ids.join(' and ')];
  });
}

describe('keymap: the table', () => {
  it('lists every action id once', () => {
    expect(ACTION_IDS).toEqual(Object.keys(ACTIONS));
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
    expect(idsOf(EXTENDED_TABLE)).toEqual([...ACTION_IDS, ...SAMPLE_IDS]);
  });

  // A13
  it.each(TABLES)('holds UC-6’s defaults for every id of the wave that is a row, and the rows of landed children exist (%s)', (_name, table) => {
    for (const [id, chord] of Object.entries(WAVE_DEFAULTS)) if (id in table) expect(table[id as ActionId].chord, id).toBe(chord);
    for (const id of LANDED) expect(id in table, id).toBe(true);
  });

  it.each(TABLES)('two dispatched rows share a default chord only as decision 8 lets them (%s)', (_name, table) => {
    expect(sharingBroken(table)).toEqual([]);
  });

  it('the sharing rule refuses what the dispatcher could not honour', () => {
    const shared = sample('sample.shared'); // a composer row on ⌘Enter, as composer.send is
    const other = (spec: Partial<ActionSpec>) => withRow(sample('sample.menu'), { title: 'Other', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'pane', ...spec });
    expect(sharingBroken(other({}))).toEqual([]); // composer and pane rows: the focus tells them apart
    expect(sharingBroken(other({ sink: 'menu', menu: 'edit', scope: 'app' }))).not.toEqual([]); // a menu chord is held window-wide
    expect(sharingBroken(withRow(shared, { ...SAMPLE_ROWS['sample.shared'], scope: 'app' }, other({ scope: 'app' })))).not.toEqual([]); // two rows reached from anywhere
    expect(sharingBroken(other({ scope: 'app' }))).toEqual([]); // one app row beside composer rows
    expect(sharingBroken(other({ sink: 'menu', menu: 'edit', scope: 'app', chord: 'Cmd+5' }))).not.toEqual([]); // the nine of Select tab count
  });

  it.each(TABLES)('binds no default to a chord of a menu role (%s)', (_name, table) => {
    const roles = new Set(MENU_ROLE_CHORDS.map((role) => normal(role.chord)));
    for (const id of idsOf(table)) {
      const chord = table[id].chord;
      if (chord !== null) for (const held of heldChords(id, chord)) expect(roles.has(normal(held)), `${id} holds ${held}`).toBe(false);
    }
  });

  it.each(TABLES)('keeps the row rules (%s)', (_name, table) => {
    for (const id of idsOf(table)) {
      const spec = table[id];
      if (spec.chord) expect(() => parseChord(spec.chord!), id).not.toThrow();
      if (spec.sink === 'menu') expect(spec.menu, id).not.toBeNull(); // a menu-sink row has a placement
      if (spec.scope !== 'app') expect(spec.sink, id).toBe('renderer'); // the menu cannot see DOM focus
      if (spec.submenu !== undefined) expect(spec.menu, id).not.toBeNull(); // a submenu sits in a menu
      if (spec.fixed) expect({ sink: spec.sink, menu: spec.menu, bound: spec.chord !== null, hold: spec.hold }, id).toEqual({ sink: 'renderer', menu: null, bound: true, hold: undefined });
    }
  });

  it('the sample menu row’s chord is no chord of the wave’s table, so a sibling’s row never collides with it', () => {
    const wave = Object.values(WAVE_DEFAULTS).flatMap((chord) => (chord === null ? [] : [normal(chord)]));
    expect(wave).not.toContain(normal(SAMPLE_ROWS['sample.menu'].chord));
  });

  it('carries the §5.8 defaults the acceptance names', () => {
    expect(ACTIONS['attention.next'].chord).toBe('Cmd+Shift+J');
    expect(ACTIONS['palette.open'].chord).toBe('Cmd+K');
    expect(ACTIONS['tab.overview'].chord).toBe('Cmd+0');
    expect(ACTIONS['tab.close'].chord).toBe('Cmd+W');
    expect(ACTIONS['panel.toggle'].chord).toBe('Cmd+Shift+B');
  });

  it('titles the surface rows by the surface’s name alone (l7-shell-07)', () => {
    const surfaces = ACTION_IDS.filter((id) => id.startsWith('surface.')).map((id) => ACTIONS[id].title);
    expect(surfaces).toEqual(['Terminal', 'Review', 'Files', 'Browser', 'Source control', 'Subagents', 'Background tasks', 'Session info', 'Questions']);
  });

  // C7 start: the composer's actions (C7 execution document, Keymap additions; W10: no ⌥Enter)
  it('carries the composer actions: stop and focus app-scoped, none in the menu, and no ⌥Enter hold (W10)', () => {
    expect('composer.steer' in ACTIONS).toBe(false);
    // among dispatched rows: an editor's own key (a fixed row) may be ⌥Enter
    expect(Object.values(ACTIONS as ActionTable).filter((spec) => !spec.fixed).map((spec) => spec.chord)).not.toContain('Alt+Enter');
    expect(ACTIONS['composer.stop']).toMatchObject({ chord: 'Cmd+.', sink: 'renderer', menu: null, scope: 'app' });
    expect(ACTIONS['composer.focus']).toMatchObject({ chord: 'Cmd+L', sink: 'renderer', menu: null, scope: 'app' });
  });

  // UX wave U4a (Interfaces H): the editor's own keys are fixed rows; ⌘Enter is composer.queue in the main editor, tried
  // before composer.send, which keeps the chord for the reply fields
  it('carries the composer’s fixed keys, and composer.queue ahead of composer.send on ⌘Enter', () => {
    const fixed = (['composer.submit', 'composer.newLine', 'composer.newLineOption'] as const).map((id) => [id, ACTIONS[id].title, ACTIONS[id].chord, (ACTIONS[id] as ActionSpec).fixed]);
    expect(fixed).toEqual([
      ['composer.submit', 'Send', 'Enter', true],
      ['composer.newLine', 'New line', 'Shift+Enter', true],
      ['composer.newLineOption', 'New line', 'Alt+Enter', true],
    ]);
    for (const [id] of fixed) expect(ACTIONS[id as ActionId]).toMatchObject({ sink: 'renderer', menu: null, scope: 'composer' });
    expect(ACTIONS['composer.queue']).toEqual({ title: 'Queue for after the turn', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'composer' });
    expect(ACTIONS['composer.send']).toEqual({ title: 'Send (reply fields)', chord: 'Cmd+Enter', sink: 'renderer', menu: null, scope: 'composer' });
    expect(ACTION_IDS.indexOf('composer.queue')).toBe(ACTION_IDS.indexOf('composer.send') - 1);
    for (const id of ['composer.submit', 'composer.newLine', 'composer.newLineOption', 'composer.queue'] as const) expect(isRebindable(id), id).toBe(false); // build F knows none
  });

  // UX wave U4a M3 (Interfaces H): ↑ and Esc are the editor's own keys in the composer, listed as fixed rows
  it('carries ↑ and Esc as the composer’s fixed keys for the stack', () => {
    expect(ACTIONS['composer.takeBack']).toEqual({ title: 'Take back the newest waiting message', chord: 'Up', sink: 'renderer', menu: null, scope: 'composer', fixed: true });
    expect(ACTIONS['composer.sendNowOrStop']).toEqual({ title: 'Send the first waiting message now, or stop', chord: 'Escape', sink: 'renderer', menu: null, scope: 'composer', fixed: true });
    for (const id of ['composer.takeBack', 'composer.sendNowOrStop'] as const) expect(isRebindable(id), id).toBe(false);
  });

  // UX wave U4a M5 (Interfaces H; decision 21): the three menu chords, app-scoped like ⌘. and ⌘L and registered once
  // (ComposerAppKeys), acting on the focused pane's session; none takes a menu role's chord
  it('carries the model, effort and mode menus’ chords, app-scoped and out of the menu', () => {
    expect(ACTIONS['composer.modelMenu']).toEqual({ title: 'Model menu', chord: 'Cmd+Shift+I', sink: 'renderer', menu: null, scope: 'app' });
    expect(ACTIONS['composer.effortMenu']).toEqual({ title: 'Effort', chord: 'Cmd+Shift+E', sink: 'renderer', menu: null, scope: 'app' });
    expect(ACTIONS['composer.modeMenu']).toEqual({ title: 'Permission mode menu', chord: 'Cmd+Shift+M', sink: 'renderer', menu: null, scope: 'app' });
    for (const id of ['composer.modelMenu', 'composer.effortMenu', 'composer.modeMenu'] as const) expect(isRebindable(id), id).toBe(false); // build F knows none
  });

  // UX wave U4a M6 (Interfaces H; decision 22): Ctrl+R searches the prompt history, dispatched to the focused composer
  it('carries the history search on Ctrl+R, composer-scoped and out of the menu', () => {
    expect(ACTIONS['composer.historySearch']).toEqual({ title: 'Search prompt history', chord: 'Ctrl+R', sink: 'renderer', menu: null, scope: 'composer' });
    expect(isRebindable('composer.historySearch')).toBe(false); // build F knows it not
  });
  // C7 end

  // C11 start: Settings, Accounts and the ClaudeUsage hand-off (C11 execution document, Keymap and action entries)
  it('carries settings.open in the application menu at ⌘, and accounts.open (W6: Usage) in View; the hand-off stays out of the menu', () => {
    expect(ACTIONS['settings.open']).toEqual({ title: 'Settings…', chord: 'Cmd+,', sink: 'menu', menu: 'app', scope: 'app' });
    expect(ACTIONS['accounts.open']).toEqual({ title: 'Usage', chord: null, sink: 'menu', menu: 'view', scope: 'app' });
    expect(ACTIONS['gateway.openClaudeUsage']).toEqual({ title: 'Open ClaudeUsage', chord: null, sink: 'renderer', menu: null, scope: 'app' });
  });
  // C11 end

  // E9 start: the hold action (E9 execution document, Interfaces "Keymap")
  // The owner's ruling (2026-10-06): the toolbar's microphone is the primary control, so the hold ships unbound and a
  // chord is the person's choice in Settings › Keyboard.
  it('carries composer.dictate: an app-scoped hold with no default chord, out of the menu', () => {
    expect(ACTIONS['composer.dictate']).toEqual({ title: 'Hold to dictate', chord: null, sink: 'renderer', menu: null, scope: 'app', hold: true });
    for (const [id, spec] of specs) if (id !== 'composer.dictate') expect((spec as ActionSpec).hold, id).toBeUndefined();
  });
  // E9 end
  // E5 start: the editor's save (E5 execution document, Interfaces *The close guard and the action*)
  it('carries file.save in the File menu at ⌘S, where macOS gives the chord to the menu', () => {
    expect(ACTIONS['file.save']).toEqual({ title: 'Save file', chord: 'Cmd+S', sink: 'menu', menu: 'file', scope: 'app' });
  });
  // E5 end
});

describe('keymap: the effective chord', () => {
  it('resolves overrides: absent is the default, a chord replaces it, null unbinds', () => {
    expect(effectiveChord('attention.next', {})).toBe('Cmd+Shift+J');
    expect(effectiveChord('attention.next', { 'attention.next': 'Cmd+Alt+J' })).toBe('Cmd+Alt+J');
    expect(effectiveChord('tab.close', { 'tab.close': null })).toBeNull();
    expect(effectiveChord('panel.maximize', {})).toBeNull();
  });

  it('a fixed row answers its default always: it takes no override and yields to none', () => {
    const fixed = sample('sample.fixed');
    expect(effectiveChord(fixed, {}, EXTENDED_TABLE)).toBe('Shift+Enter');
    expect(effectiveChord(fixed, over(fixed, 'Cmd+Y'), EXTENDED_TABLE)).toBe('Shift+Enter');
    expect(effectiveChord(fixed, over(fixed, null), EXTENDED_TABLE)).toBe('Shift+Enter');
    expect(effectiveChord(fixed, { 'composer.send': 'Shift+Enter' }, EXTENDED_TABLE)).toBe('Shift+Enter');
  });

  it('an override of a row that is not rebindable is not read', () => {
    expect(effectiveChord(sample('sample.shared'), over(sample('sample.shared'), 'Cmd+Y'), EXTENDED_TABLE)).toBe('Cmd+Enter');
    expect(effectiveChord(sample('sample.menu'), over(sample('sample.menu'), null), EXTENDED_TABLE)).toBe('Ctrl+Alt+Shift+F12');
  });

  it('a stored rebinding wins over a default added later, which returns once the rebinding goes (decision 10)', () => {
    const later = sample('sample.menu');
    const keymap: KeymapOverrides = { 'palette.open': 'Ctrl+Alt+Shift+F12' };
    expect(effectiveChord(later, keymap, EXTENDED_TABLE)).toBeNull(); // a row that is not rebindable yields too
    expect(effectiveChord('palette.open', keymap, EXTENDED_TABLE)).toBe('Ctrl+Alt+Shift+F12');
    expect(effectiveChord(later, {}, EXTENDED_TABLE)).toBe('Ctrl+Alt+Shift+F12');
    expect(effectiveChord(later, { 'palette.open': null }, EXTENDED_TABLE)).toBe('Ctrl+Alt+Shift+F12'); // null holds nothing
    // a rebindable row yields its default the same way, and its own override comes first
    expect(effectiveChord('palette.open', { 'attention.next': 'Cmd+K' })).toBeNull();
    expect(effectiveChord('palette.open', { 'attention.next': 'Cmd+K', 'palette.open': 'Cmd+Alt+K' })).toBe('Cmd+Alt+K');
    expect(effectiveChord('palette.open', { 'attention.next': 'Cmd+Shift+K' })).toBe('Cmd+K');
    // only a rebindable row's override holds a chord: a stored value of another row is never read, so it takes nothing
    expect(effectiveChord('palette.open', over(sample('sample.shared'), 'Cmd+K'), EXTENDED_TABLE)).toBe('Cmd+K');
  });

  it('counts the nine chords of Select tab on either side', () => {
    expect(effectiveChord('tab.select', { 'attention.next': 'Cmd+5' })).toBeNull();
    const table = withRow(sample('sample.shared'), { ...SAMPLE_ROWS['sample.shared'], chord: 'Cmd+Shift+5' });
    expect(effectiveChord(sample('sample.shared'), { 'tab.select': 'Cmd+Shift+1' }, table)).toBeNull();
    expect(effectiveChord(sample('sample.shared'), { 'tab.select': 'Cmd+Alt+1' }, table)).toBe('Cmd+Shift+5');
  });
});

// The panel's finding of 2026-11-12, "tab-chord expansion past F24": only a chord whose key is the digit 1 numbers
// Select tab through nine; F11 and F21 are one chord each, and F21 must not expand into F22 … F29, past the vocabulary.
describe('keymap: the chords Select tab numbers through nine', () => {
  it('numbers a chord whose key is the digit 1, with or without modifiers, and no other', () => {
    expect(heldChords('tab.select', 'Cmd+1')).toEqual(['Cmd+1', 'Cmd+2', 'Cmd+3', 'Cmd+4', 'Cmd+5', 'Cmd+6', 'Cmd+7', 'Cmd+8', 'Cmd+9']);
    expect(heldChords('tab.select', 'Cmd+Alt+1')).toHaveLength(9);
    expect(heldChords('tab.select', 'Cmd+Alt+1').at(-1)).toBe('Cmd+Alt+9');
    expect(heldChords('tab.select', 'F11')).toEqual(['F11']);
    expect(heldChords('tab.select', 'F21')).toEqual(['F21']);
  });

  it('resolves every chord with a stored Select tab of F21 or F11, without throwing', () => {
    for (const chord of ['F21', 'F11']) {
      expect(effectiveChord('session.new', { 'tab.select': chord }), chord).toBe('Cmd+N');
      expect(effectiveChord('tab.select', { 'tab.select': chord }), chord).toBe(chord);
    }
    expect(effectiveChord('region.focusNext', { 'tab.select': 'F16' })).toBe('F6'); // F16 is not F6 … F9's expansion either
  });
});

// UC-14 (decision 11): build F refuses a settings file whose keymap names an action it does not know.
describe('keymap: what may be rebound while build F may run', () => {
  it('knows build F’s 58 ids, each once and each a row', () => {
    expect(BUILD_F_ACTION_IDS).toHaveLength(58);
    expect(new Set(BUILD_F_ACTION_IDS).size).toBe(58);
    for (const id of BUILD_F_ACTION_IDS) expect(id in ACTIONS, id).toBe(true);
  });

  it('a row is rebindable when it is not fixed and build F knows its id', () => {
    for (const id of BUILD_F_ACTION_IDS) expect(isRebindable(id), id).toBe(true); // today's rows all stay rebindable
    for (const id of SAMPLE_IDS) expect(isRebindable(id, EXTENDED_TABLE), id).toBe(false);
    const fixedKnown = withRow('request.accept', { ...ACTIONS['request.accept'], fixed: true }, ACTIONS);
    expect(isRebindable('request.accept', fixedKnown)).toBe(false);
    expect(effectiveChord('request.accept', { 'request.accept': 'Y' }, fixedKnown)).toBe('Enter');
  });
});
