// The Keyboard section's capture on screen (C11 execution document, M5 pins): a row records the next chord, refuses a
// conflict and a bare menu key in words while it keeps listening, unbinds on Backspace, cancels on Escape, and writes
// the whole override map as one field; Reset to defaults clears it after a confirm.
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V13 } from '@shared/settings/defaults';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { KeymapSection } from './KeymapSection';

let b: SettingsBridge;
function Live() {
  const keymap = useSettings((s) => s.state!.settings.keymap);
  return <KeymapSection keymap={keymap} />;
}
function renderSection(keymap = {}) {
  b = settingsBridge({ ...SETTINGS_DEFAULTS_V13, keymap });
  window.maws = b.bridge;
  render(<Live />);
}
const row = (title: string) => within(screen.getByRole('table', { name: 'Key bindings' })).getByRole('row', { name: title });
const chordOf = (title: string) => row(title).querySelector('kbd')!.textContent;
const record = (title: string) => {
  fireEvent.click(within(row(title)).getByRole('button', { name: `Change ${title}` }));
  return within(row(title)).getByLabelText(`${title}: Press keys… esc cancels`);
};

afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('keymap capture records, refuses conflicts and unbinds', () => {
  it('records ⌘⇧U for Next Needs-you, showing what it was while recording', async () => {
    renderSection({ 'palette.open': 'Cmd+P' });
    expect(chordOf('Next Needs-you')).toBe('⌘⇧J');
    const capture = record('Next Needs-you');
    expect(within(row('Next Needs-you')).getByRole('button', { name: 'Was ⌘⇧J' })).toBeTruthy();
    fireEvent.keyDown(capture, { key: 'Shift', code: 'ShiftLeft', shiftKey: true }); // a modifier alone waits
    expect(b.sets).toEqual([]);
    fireEvent.keyDown(capture, { key: 'U', code: 'KeyU', metaKey: true, shiftKey: true });
    await vi.waitFor(() => expect(b.sets).toEqual([{ keymap: { 'palette.open': 'Cmd+P', 'attention.next': 'Cmd+Shift+U' } }]));
    expect(chordOf('Next Needs-you')).toBe('⌘⇧U');
  });

  it('refuses ⌘K with the action that holds it and keeps recording; a bare key is refused for a menu action', () => {
    renderSection();
    const capture = record('Next Needs-you');
    fireEvent.keyDown(capture, { key: 'k', code: 'KeyK', metaKey: true });
    expect(within(row('Next Needs-you')).getByRole('alert').textContent).toBe('Already bound to Command palette · unbind it first');
    fireEvent.keyDown(capture, { key: 'u', code: 'KeyU' });
    expect(within(row('Next Needs-you')).getByRole('alert').textContent).toBe('A menu shortcut needs ⌘, ⌃ or ⌥');
    expect(b.sets).toEqual([]);
    fireEvent.keyDown(capture, { key: 'Escape', code: 'Escape' });
    expect(within(row('Next Needs-you')).queryByRole('alert')).toBeNull();
    expect(chordOf('Next Needs-you')).toBe('⌘⇧J');
    expect(b.sets).toEqual([]);
  });

  it('Backspace unbinds; choosing the default again drops the override', async () => {
    renderSection({ 'attention.next': 'Cmd+Shift+U' });
    fireEvent.keyDown(record('Next Needs-you'), { key: 'Backspace', code: 'Backspace' });
    await vi.waitFor(() => expect(b.sets).toEqual([{ keymap: { 'attention.next': null } }]));
    expect(chordOf('Next Needs-you')).toBe('Unbound');
    fireEvent.keyDown(record('Next Needs-you'), { key: 'J', code: 'KeyJ', metaKey: true, shiftKey: true });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ keymap: {} }));
  });

  // E9 M6: the owner's ruling (2026-10-06) ships the hold to dictate unbound; this row is where a chord is bound
  it('Hold to dictate is unbound by default and records ⌥Space by its code', async () => {
    renderSection();
    expect(chordOf('Hold to dictate')).toBe('Unbound');
    fireEvent.keyDown(record('Hold to dictate'), { key: ' ', code: 'Space', altKey: true }); // Option+Space types a no-break space
    await vi.waitFor(() => expect(b.sets).toEqual([{ keymap: { 'composer.dictate': 'Alt+Space' } }]));
    expect(chordOf('Hold to dictate')).toBe('⌥Space');
  });

  it('Reset to defaults clears every override after a confirm', async () => {
    renderSection({ 'attention.next': 'Cmd+Shift+U', 'palette.open': null });
    fireEvent.click(screen.getByRole('button', { name: 'Reset to defaults' }));
    const sheet = await screen.findByRole('dialog', { name: 'Reset every key binding?' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Reset' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ keymap: {} }]));
    expect(chordOf('Command palette')).toBe('⌘K');
    expect((screen.getByRole('button', { name: 'Reset to defaults' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('sets the menu shortcuts aside while a row records, and back when it ends by a chord, Escape, blur or unmount', async () => {
    renderSection();
    const captures = () => b.calls.filter((c) => c.name === 'layout.captureChords').map((c) => c.input);
    const capture = record('Next Needs-you');
    expect(capture.hasAttribute('data-chord-capture')).toBe(true);
    await vi.waitFor(() => expect(captures()).toEqual([{ active: true }]));
    fireEvent.keyDown(capture, { key: 'Escape', code: 'Escape' });
    await vi.waitFor(() => expect(captures()).toEqual([{ active: true }, { active: false }]));
    fireEvent.blur(record('Command palette'));
    await vi.waitFor(() => expect(captures()).toEqual([{ active: true }, { active: false }, { active: true }, { active: false }]));
    fireEvent.keyDown(record('Command palette'), { key: 'P', code: 'KeyP', metaKey: true, shiftKey: true });
    await vi.waitFor(() => expect(captures().slice(4)).toEqual([{ active: true }, { active: false }]));
    record('Command palette');
    await vi.waitFor(() => expect(captures().slice(6)).toEqual([{ active: true }]));
    cleanup();
    await vi.waitFor(() => expect(captures().slice(6)).toEqual([{ active: true }, { active: false }]));
  });

  it('every action is a row, the docked request keys included', () => {
    renderSection();
    for (const title of ['Approve / answer the docked request', 'Decline the docked request', 'Settings…', 'Select tab 1–9', 'Open ClaudeUsage']) expect(row(title)).toBeTruthy();
    expect(chordOf('Select tab 1–9')).toBe('⌘1…9');
  });
});
