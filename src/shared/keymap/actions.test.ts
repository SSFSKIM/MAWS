import { describe, expect, it } from 'vitest';
import { ACTION_IDS, ACTIONS, effectiveChord } from './actions';
import { parseChord } from './chord';

const specs = Object.entries(ACTIONS);

describe('keymap: chords unique and single-sink', () => {
  it('lists every action id once', () => {
    expect(ACTION_IDS).toEqual(Object.keys(ACTIONS));
    expect(new Set(ACTION_IDS).size).toBe(ACTION_IDS.length);
  });

  it('parses every default chord', () => {
    for (const [id, spec] of specs) if (spec.chord) expect(() => parseChord(spec.chord), id).not.toThrow();
  });

  it('binds no chord twice, so none is in both sinks', () => {
    const seen = new Map<string, string>();
    for (const [id, spec] of specs) {
      if (!spec.chord) continue;
      const normal = JSON.stringify(parseChord(spec.chord));
      expect(seen.get(normal), `${id} repeats ${seen.get(normal)}'s chord ${spec.chord}`).toBeUndefined();
      seen.set(normal, id);
    }
  });

  it('gives every menu-sink action a menu placement', () => {
    for (const [id, spec] of specs) if (spec.sink === 'menu') expect(spec.menu, id).not.toBeNull();
  });

  it('keeps pane- and composer-scoped actions out of the menu sink (the menu cannot see DOM focus)', () => {
    for (const [id, spec] of specs) if (spec.scope !== 'app') expect(spec.sink, id).toBe('renderer');
  });

  it('carries the §5.8 defaults the acceptance names', () => {
    expect(ACTIONS['attention.next'].chord).toBe('Cmd+Shift+J');
    expect(ACTIONS['palette.open'].chord).toBe('Cmd+K');
    expect(ACTIONS['tab.overview'].chord).toBe('Cmd+0');
    expect(ACTIONS['tab.close'].chord).toBe('Cmd+W');
    expect(ACTIONS['panel.toggle'].chord).toBe('Cmd+Shift+B');
  });

  it('resolves overrides: absent is the default, a chord replaces it, null unbinds', () => {
    expect(effectiveChord('attention.next', {})).toBe('Cmd+Shift+J');
    expect(effectiveChord('attention.next', { 'attention.next': 'Cmd+Alt+J' })).toBe('Cmd+Alt+J');
    expect(effectiveChord('tab.close', { 'tab.close': null })).toBeNull();
    expect(effectiveChord('panel.maximize', {})).toBeNull();
  });

  // C7 start: the composer's three actions (C7 execution document, Keymap additions)
  it('carries the composer actions: steer in the editor sink, stop and focus app-scoped, none in the menu', () => {
    expect(ACTIONS['composer.steer']).toMatchObject({ chord: 'Alt+Enter', sink: 'renderer', menu: null, scope: 'composer' });
    expect(ACTIONS['composer.stop']).toMatchObject({ chord: 'Cmd+.', sink: 'renderer', menu: null, scope: 'app' });
    expect(ACTIONS['composer.focus']).toMatchObject({ chord: 'Cmd+L', sink: 'renderer', menu: null, scope: 'app' });
  });
  // C7 end

  // C11 start: Settings, Accounts and the ClaudeUsage hand-off (C11 execution document, Keymap and action entries)
  it('carries settings.open in the application menu at ⌘, and accounts.open (W6: Usage) in View; the hand-off stays out of the menu', () => {
    expect(ACTIONS['settings.open']).toEqual({ title: 'Settings…', chord: 'Cmd+,', sink: 'menu', menu: 'app', scope: 'app' });
    expect(ACTIONS['accounts.open']).toEqual({ title: 'Usage', chord: null, sink: 'menu', menu: 'view', scope: 'app' });
    expect(ACTIONS['gateway.openClaudeUsage']).toEqual({ title: 'Open ClaudeUsage', chord: null, sink: 'renderer', menu: null, scope: 'app' });
  });
  // C11 end
});
