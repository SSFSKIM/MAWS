import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { ACTION_IDS, ACTIONS, effectiveChord, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { registerShellActions } from '../app/shell-actions';
import { useSettings } from '../stores/settings';
import { runAction } from './actions-runtime';
import { KeyboardShortcuts } from './KeyboardShortcuts';

let off: () => void;
beforeEach(() => { off = registerShellActions(); });
afterEach(() => {
  const close = screen.queryByRole('button', { name: 'Close keyboard shortcuts' });
  if (close) fireEvent.click(close);
  off(); cleanup(); useSettings.setState({ state: null });
});

function setKeymap(keymap: KeymapOverrides) {
  act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V19, keymap }, resolvedTheme: 'light' } }));
}
function openSheet() {
  render(<><button>Opener</button><KeyboardShortcuts /></>);
  screen.getByRole('button', { name: 'Opener' }).focus();
  const chord = new KeyboardEvent('keydown', { key: '/', code: 'Slash', metaKey: true });
  const id = ACTION_IDS.find((id) => {
    const effective = effectiveChord(id, {});
    return ACTIONS[id].sink === 'menu' && effective !== null && matchesChord(chord, parseChord(effective));
  });
  expect(id).toBe('shortcuts.open');
  act(() => runAction(id!));
  return screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
}

it('opens from Cmd+/ and shows effective bindings for navigation and composer keys, including unbound actions', () => {
  setKeymap({ 'tab.stripNext': 'Cmd+Alt+Right', 'composer.focus': null });
  const dialog = openSheet();
  const row = (title: string) => within(dialog).getByRole('row', { name: new RegExp(title) });
  expect(row('Next tab in strip').textContent).toContain('⌘⌥→');
  expect(row('Focus the composer').textContent).toContain('Unbound');
  expect(row('Cycle permission mode').textContent).toContain('⇧⇥');
  expect(row('Focus next region').textContent).toContain('F6');
  expect(document.activeElement).toBe(screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' }));
});

it('searches action names and effective chords, updates when bindings change, and explains an empty result', () => {
  const dialog = openSheet();
  const search = screen.getByRole('searchbox', { name: 'Search keyboard shortcuts' });
  fireEvent.change(search, { target: { value: 'next tab in strip' } });
  expect(within(dialog).getAllByRole('row')).toHaveLength(1);
  expect(within(dialog).getByRole('row').textContent).toContain('⌘⌥]');
  setKeymap({ 'tab.stripNext': 'Cmd+Alt+Right' });
  expect(within(dialog).getByRole('row').textContent).toContain('⌘⌥→');
  fireEvent.change(search, { target: { value: 'Cmd+Alt+Right' } });
  expect(within(dialog).getAllByRole('row')).toHaveLength(1);
  expect(within(dialog).getByRole('row').textContent).toContain('Next tab in strip');
  fireEvent.change(search, { target: { value: 'nothing matches this' } });
  expect(within(dialog).queryByRole('row')).toBeNull();
  expect(within(dialog).getByRole('status').textContent).toBe('No shortcuts match your search.');
});

it('closes on Escape, restores the opener, and clears search when reopened', async () => {
  openSheet();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'composer' } });
  const user = userEvent.setup();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Opener' }));
  act(() => runAction('shortcuts.open'));
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('');
  fireEvent.click(screen.getByRole('button', { name: 'Close keyboard shortcuts' }));
});


it.each(['cards', 'terminal', 'review', 'files', 'browser'])('finds the current surface vocabulary for %s', (query) => {
  const dialog = openSheet();
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: query } });
  expect(within(dialog).getAllByRole('row').length).toBeGreaterThan(0);
});
