// C12 M4: Settings › Engine never configures the host itself (C12 execution document, Interfaces "Engine custody",
// Configure): Change… and "Use installed" write settings, await `settings.engineApplied` (main's push for the settings as
// they now stand), and re-read `engine.binaryInfo`. W13: custody and the pin are retired; the row shows the installed
// binary's real path and version, the tested version as information, and the update runs in a terminal tab. The word cut
// (G125 to G128): one row, the version, Change… and Update…; the path is the version's tooltip and, with the config
// home, in the row's note; Update…'s words are its tooltip.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { EngineSection } from './EngineSection';
import { openEngineUpdate } from './engine-update';

vi.mock('./engine-update', () => ({ openEngineUpdate: vi.fn(() => 'terminal:update') })); // W13: the panel host is not under test here

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;

// The host as main configures it: the chosen path, else the installed binary's real path.
function renderSection(initial: Settings = SETTINGS_DEFAULTS_V21, answers: SettingsBridge['answers'] = {}) {
  b = settingsBridge(initial);
  b.answers['engine.binaryInfo'] = () => ({ ...BINARY, path: settings().engine.binaryPath ?? BINARY.path });
  Object.assign(b.answers, answers);
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <EngineSection settings={settings()} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  unsubscribe = useSettings.subscribe((state) => {
    if (state.state) rendered.rerender(view());
  });
}
const row = (label: string) => screen.getByRole('group', { name: label });
const names = () => b.calls.map((c) => c.name);
// the row's note: hidden at rest, its words the row's description (the shared row note, ui/row-note.tsx)
const noteOf = (label: string) => row(label).querySelector<HTMLElement>('[data-row-note]')!;
// a row's words as the accessibility tree reads them: its description holds them, whether the note is open or not
const describes = (label: string, words: string) => screen.getByRole('group', { name: label, description: (description) => description.includes(words) });
const path = (label: string, words: string) => vi.waitFor(() => expect(describes(label, words)).toBe(row(label)));

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
});

describe('Settings › Engine writes settings; main configures the host', () => {
  it('Change… writes the path, waits for main to apply it, then re-reads the binary; engine.configure is never invoked', async () => {
    renderSection();
    await path('Binary', '~/.local/share/claude/versions/2.1.287');
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude/2.1.283/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Change…' }));
    await path('Binary', '/opt/claude/2.1.283/claude');
    expect(b.sets).toEqual([{ engine: { binaryPath: '/opt/claude/2.1.283/claude' } }]);
    // P4-A2: the launch profile's rows read the plugin list on their own schedule, which is no part of this write
    const after = names().slice(names().indexOf('settings.set')).filter((name) => name !== 'plugins.list' && name !== 'fs.state');
    expect(after.slice(0, 3)).toEqual(['settings.set', 'settings.engineApplied', 'engine.binaryInfo']);
    expect(names()).not.toContain('engine.configure');
  });

  it('"Use installed" puts launches back on the installed binary, and the row reads it', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, binaryPath: '/opt/claude' } });
    await path('Binary', '/opt/claude');
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use installed' }));
    await path('Binary', '~/.local/share/claude/versions/2.1.287');
    expect(b.sets).toEqual([{ engine: { binaryPath: null } }]);
    expect(names()).not.toContain('engine.configure');
  });

  it('an error from main (the push’s) is a warning toast, and the rows still re-read', async () => {
    renderSection();
    b.answers['settings.engineApplied'] = () => {
      throw new Error('The engine host did not take the engine configuration: timeout');
    };
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    fireEvent.click(await within(row('Binary')).findByRole('button', { name: 'Change…' }));
    await expect.poll(() => useNotices.getState().notices.map((n) => n.text)).toEqual(['The engine host did not take the engine configuration: timeout']);
    await path('Binary', '/opt/claude');
  });
});

// W13 (charter D-1 as amended 2026-10-01): the installed Claude Code, never refused for its version
describe('the binary row and the update', () => {
  it('shows the probed version, the resolved real path and the tested version in its note, and no pin or copy row', async () => {
    renderSection();
    await path('Binary', '~/.local/share/claude/versions/2.1.287');
    expect(within(row('Binary')).getByText('2.1.287')).toBeTruthy();
    expect(noteOf('Binary').hidden).toBe(true); // information, waiting for the pointer or the keyboard
    expect(screen.getByRole('group', { name: 'Binary', description: (d) => d.includes("New sessions start on your installed Claude Code. Found again at every launch: ~/.local/bin/claude, else claude on your shell's PATH. Running sessions keep the binary they started on. MAWS was verified against Claude Code 2.1.283.") })).toBe(row('Binary'));
    expect(within(row('Binary')).queryByRole('button', { name: 'Use installed' })).toBeNull(); // nothing chosen
    expect(row('Binary').querySelector('.text-warning')).toBeNull(); // a newer version is information, never a refusal
    expect(screen.queryByRole('group', { name: 'Pinned version' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Engine copy' })).toBeNull();
  });

  // U11a M9 (l8-settings-06): the R1 paragraph row is gone, its sentence out of date (plugins' panes are drawn)
  it('holds the Binary row alone, Update on it and the config home in its note, and no Plugins paragraph', async () => {
    renderSection();
    await path('Binary', '~/.local/share/claude/versions/2.1.287');
    expect(screen.getAllByRole('group').map((g) => g.firstElementChild?.textContent)).toEqual(['Binary']);
    await path('Binary', 'Config home · ~/.claude · read-only to MAWS');
    expect(describes('Binary', 'Where the engine keeps transcripts, settings and trust.')).toBe(row('Binary'));
  });

  it('a binary that is missing says why, in the warning colour', async () => {
    renderSection(SETTINGS_DEFAULTS_V21, {
      'engine.binaryInfo': () => ({ ...BINARY, path: '/Users/owner/.local/bin/claude', version: null, ok: false, error: 'Claude Code is not installed: nothing at /Users/owner/.local/bin/claude' }),
    });
    expect(await within(row('Binary')).findByText('Claude Code is not installed: nothing at /Users/owner/.local/bin/claude')).toBeTruthy();
  });

  it('Update Claude Code… opens the update in a terminal tab and says which sessions take the new version', async () => {
    renderSection();
    const update = within(row('Binary')).getByRole('button', { name: 'Update Claude Code…', description: 'Runs claude update in a terminal tab. New sessions start on the new version; running sessions keep theirs.' });
    expect(update.textContent).toBe('Update…');
    fireEvent.click(update);
    expect(openEngineUpdate).toHaveBeenCalledOnce();
    expect(names()).not.toContain('settings.set'); // nothing written: the user's own updater runs
  });

  it('with a chosen binary, the notes say new sessions stay on it until Use installed', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, binaryPath: '/opt/claude' } });
    await path('Binary', '/opt/claude');
    expect(describes('Binary', 'New sessions start on the binary you chose. Running sessions keep the binary they started on. MAWS was verified against Claude Code 2.1.283.')).toBe(row('Binary'));
    expect(within(row('Binary')).getByRole('button', { name: 'Update Claude Code…', description: 'Runs claude update in a terminal tab. New sessions stay on your chosen binary until Use installed. Running sessions keep theirs.' })).toBeTruthy();
  });
});
