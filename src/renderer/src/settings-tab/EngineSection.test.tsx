// C12 M4: Settings › Engine never configures the host itself (C12 execution document, Interfaces "Engine custody",
// Configure): Change… and "Use default" write settings, await `settings.engineApplied` (main's push for the settings as
// they now stand), and re-read `engine.binaryInfo`. W13: custody and the pin are retired.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V8 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { EngineSection } from './EngineSection';

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;

// The host as main configures it: the chosen path, else the installed binary's real path.
function renderSection(initial: Settings = SETTINGS_DEFAULTS_V8, answers: SettingsBridge['answers'] = {}) {
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

  it('"Use default" puts launches back on the installed binary, and the row reads it', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V8, engine: { ...SETTINGS_DEFAULTS_V8.engine, binaryPath: '/opt/claude' } });
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use default' }));
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

// W13: no pin, no Re-pin…, no copy row
it('shows no pin and no custody row', async () => {
  renderSection();
  expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287')).toBeTruthy();
  expect(screen.queryByRole('group', { name: 'Pinned version' })).toBeNull();
  expect(screen.queryByRole('group', { name: 'Engine copy' })).toBeNull();
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
