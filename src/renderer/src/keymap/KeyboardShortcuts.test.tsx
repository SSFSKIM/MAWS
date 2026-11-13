import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ACTION_IDS, ACTIONS, effectiveChord, type KeymapOverrides } from '@shared/keymap/actions';
import { matchesChord, parseChord } from '@shared/keymap/chord';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { registerShellActions } from '../app/shell-actions';
import { useSettings } from '../stores/settings';
import { runAction } from './actions-runtime';
import { KeyboardShortcuts } from './KeyboardShortcuts';

// U6a (decision 12): the sheet lists the table extended with sample rows shaped as the siblings' will be
vi.mock('../settings-tab/keymap', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../settings-tab/keymap')>();
  const { EXTENDED_TABLE } = await import('@shared/keymap/sample-rows');
  return { ...actual, keymapGroups: (overrides: KeymapOverrides) => actual.keymapGroups(overrides, EXTENDED_TABLE) };
});

let off: () => void;
beforeEach(() => { off = registerShellActions(); });
afterEach(() => {
  const close = screen.queryByRole('button', { name: 'Close keyboard shortcuts' });
  if (close) fireEvent.click(close);
  off(); cleanup(); useSettings.setState({ state: null });
});

function setKeymap(keymap: KeymapOverrides) {
  act(() => useSettings.setState({ state: { settings: { ...SETTINGS_DEFAULTS_V21, keymap }, resolvedTheme: 'light' } }));
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

// U6a (A9): the sheet groups its rows as the menus do, submenus included, and lists an editor's own keys under their scope
it('draws a submenu’s group under its path, and lists a fixed key with its chord', () => {
  const dialog = openSheet();
  expect(within(within(dialog).getByRole('table', { name: 'View › Tabs' })).getByRole('row', { name: /Select tab 1–9/ }).textContent).toContain('⌘1…9');
  expect(within(within(dialog).getByRole('table', { name: 'View › More surfaces' })).getByRole('row', { name: /Source control/ })).toBeTruthy();
  expect(within(within(dialog).getByRole('table', { name: 'Edit › Sample' })).getByRole('row', { name: /Sample menu row/ })).toBeTruthy();
  expect(within(within(dialog).getByRole('table', { name: 'In the composer' })).getByRole('row', { name: /Sample fixed key/ }).textContent).toContain('⇧↩');
  expect(within(within(dialog).getByRole('table', { name: 'View' })).getByRole('row', { name: /Terminal/ }).textContent).toContain('⌘J');
});
