// C12 M4: Settings › Engine never configures the host itself (C12 execution document, Interfaces "Engine custody",
// Configure): Change… and "Use installed" write settings, await `settings.engineApplied` (main's push for the settings as
// they now stand), and re-read `engine.binaryInfo`. W13: custody and the pin are retired; the row shows the installed
// binary's real path and version, the tested version as information, and the update runs in a terminal tab.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V11 } from '@shared/settings/defaults';
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
function renderSection(initial: Settings = SETTINGS_DEFAULTS_V11, answers: SettingsBridge['answers'] = {}) {
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

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('Settings › Engine writes settings; main configures the host', () => {
  it('Change… writes the path, waits for main to apply it, then re-reads the binary; engine.configure is never invoked', async () => {
    renderSection();
    expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287')).toBeTruthy();
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude/2.1.283/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Change…' }));
    expect(await within(row('Binary')).findByText('/opt/claude/2.1.283/claude')).toBeTruthy();
    expect(b.sets).toEqual([{ engine: { binaryPath: '/opt/claude/2.1.283/claude' } }]);
    const after = names().slice(names().indexOf('settings.set'));
    expect(after.slice(0, 3)).toEqual(['settings.set', 'settings.engineApplied', 'engine.binaryInfo']);
    expect(names()).not.toContain('engine.configure');
  });

  it('"Use installed" puts launches back on the installed binary, and the row reads it', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V11, engine: { ...SETTINGS_DEFAULTS_V11.engine, binaryPath: '/opt/claude' } });
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use installed' }));
    expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287')).toBeTruthy();
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
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
  });
});

// W13 (charter D-1 as amended 2026-10-01): the installed Claude Code, never refused for its version
describe('the binary row and the update', () => {
  it('shows the resolved real path and the probed version, the tested version as information, and no pin or copy row', async () => {
    renderSection();
    expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287')).toBeTruthy();
    expect(within(row('Binary')).getByText('2.1.287')).toBeTruthy();
    expect(within(row('Binary')).getByText("MAWS's fixtures and conformance tests were recorded on Claude Code 2.1.283")).toBeTruthy();
    expect(within(row('Binary')).queryByRole('button', { name: 'Use installed' })).toBeNull(); // nothing chosen
    expect(row('Binary').querySelector('.text-warning')).toBeNull(); // a newer version is information, never a refusal
    expect(screen.queryByRole('group', { name: 'Pinned version' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Engine copy' })).toBeNull();
  });

  it('says in one line what MAWS shows of a plugin, with no control (R1)', () => {
    renderSection();
    expect(within(row('Plugins')).getByText('Plugin hooks run in MAWS sessions as in the terminal; their toasts, status lines and log lines show in the session, their panes and bands not yet.')).toBeTruthy();
    expect(within(row('Plugins')).queryByRole('button')).toBeNull();
  });

  it('a binary that is missing says why, in the warning colour', async () => {
    renderSection(SETTINGS_DEFAULTS_V11, {
      'engine.binaryInfo': () => ({ ...BINARY, path: '/Users/owner/.local/bin/claude', version: null, ok: false, error: 'Claude Code is not installed: nothing at /Users/owner/.local/bin/claude' }),
    });
    expect(await within(row('Binary')).findByText('Claude Code is not installed: nothing at /Users/owner/.local/bin/claude')).toBeTruthy();
  });

  it('Update Claude Code… opens the update in a terminal tab and says which sessions take the new version', async () => {
    renderSection();
    expect(within(row('Update')).getByText('Runs claude update in a terminal tab. New sessions start on the new version; running sessions keep theirs.')).toBeTruthy();
    fireEvent.click(within(row('Update')).getByRole('button', { name: 'Update Claude Code…' }));
    expect(openEngineUpdate).toHaveBeenCalledOnce();
    expect(names()).not.toContain('settings.set'); // nothing written: the user's own updater runs
  });

  it('with a chosen binary, the notes say new sessions stay on it until Use installed', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V11, engine: { ...SETTINGS_DEFAULTS_V11.engine, binaryPath: '/opt/claude' } });
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
    expect(within(row('Binary')).getByText('New sessions start on the binary you chose. Running sessions keep the binary they started on.', { exact: false })).toBeTruthy();
    expect(within(row('Update')).getByText('Runs claude update in a terminal tab. New sessions stay on the binary you chose until Use installed.')).toBeTruthy();
  });
});

// W3 (charter D-18 as amended 2026-10-01): the mode a session takes when the engine refuses auto, settings version 6
describe('the auto fallback row', () => {
  it('offers every engine mode but auto, shows acceptEdits by default and writes permissions.autoFallback', async () => {
    renderSection();
    const select = screen.getByRole('combobox', { name: 'When auto mode is unavailable' }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(['default', 'acceptEdits', 'plan', 'bypassPermissions', 'dontAsk']);
    expect([...select.options].map((o) => o.textContent)).toEqual(['Manual', 'Accept edits', 'Plan', 'Bypass permissions', "Don't ask"]);
    expect(select.value).toBe('acceptEdits');
    fireEvent.change(select, { target: { value: 'default' } });
    await vi.waitFor(() => expect(b.sets).toEqual([{ permissions: { autoFallback: 'default' } }]));
  });
});
