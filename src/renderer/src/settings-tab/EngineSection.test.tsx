// C12 M4: Settings › Engine never configures the host itself (C12 execution document, Interfaces "Engine custody",
// Configure): Change…, "Use default" and the re-pin confirm write settings, await `settings.engineApplied` (main's push
// for the settings as they now stand, custody for a new pin included), and re-read `engine.binaryInfo`. The custody row
// shows MAWS's copy or the refusal in words.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import type { Custody } from '@shared/ipc/schema/settings';
import { SETTINGS_DEFAULTS_V7 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, CUSTODY, settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { EngineSection } from './EngineSection';

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;
const COPY = CUSTODY.state === 'ok' ? CUSTODY.path : '';

// The host as main configures it: the chosen path, else MAWS's copy.
function renderSection(initial: Settings = SETTINGS_DEFAULTS_V7, answers: SettingsBridge['answers'] = {}) {
  b = settingsBridge(initial);
  b.answers['engine.binaryInfo'] = () => ({ ...BINARY, path: settings().engine.binaryPath ?? COPY, expectedVersion: settings().engine.pinnedVersion });
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
    expect(await within(row('Binary')).findByText('~/Library/Application Support/MAWS/engine/2.1.283/claude')).toBeTruthy();
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude/2.1.283/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Change…' }));
    expect(await within(row('Binary')).findByText('/opt/claude/2.1.283/claude')).toBeTruthy();
    expect(b.sets).toEqual([{ engine: { binaryPath: '/opt/claude/2.1.283/claude' } }]);
    const after = names().slice(names().indexOf('settings.set'));
    expect(after.slice(0, 3)).toEqual(['settings.set', 'settings.engineApplied', 'engine.binaryInfo']);
    expect(names()).not.toContain('engine.configure');
  });

  it('"Use default" puts launches back on MAWS’s copy, and the row reads it', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, binaryPath: '/opt/claude' } });
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use default' }));
    expect(await within(row('Binary')).findByText('~/Library/Application Support/MAWS/engine/2.1.283/claude')).toBeTruthy();
    expect(b.sets).toEqual([{ engine: { binaryPath: null } }]);
    expect(names()).not.toContain('engine.configure');
  });

  it('the re-pin confirm writes the pin alone and waits for main (custody for the new version runs there)', async () => {
    renderSection(
      { ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, binaryPath: '/opt/claude/2.1.290/claude' } },
      { 'engine.binaryInfo': () => ({ ...BINARY, path: '/opt/claude/2.1.290/claude', version: '2.1.290', expectedVersion: settings().engine.pinnedVersion, ok: settings().engine.pinnedVersion === '2.1.290', error: null }) },
    );
    expect(await within(row('Pinned version')).findByText('binary reports 2.1.290')).toBeTruthy();
    fireEvent.click(within(row('Pinned version')).getByRole('button', { name: 'Re-pin…' }));
    fireEvent.click(within(await screen.findByRole('dialog', { name: 'Re-pin the engine to 2.1.290?' })).getByRole('button', { name: 'Re-pin to 2.1.290' }));
    await expect.poll(() => b.sets).toEqual([{ engine: { pinnedVersion: '2.1.290' } }]);
    await expect.poll(() => names().slice(names().lastIndexOf('settings.set') + 1, names().lastIndexOf('settings.set') + 3)).toEqual(['settings.engineApplied', 'engine.binaryInfo']);
    expect(await within(row('Pinned version')).findByText('matches binary')).toBeTruthy();
    expect(names()).not.toContain('engine.configure');
  });

  it('an error from main (custody’s or the push’s) is a warning toast, and the rows still re-read', async () => {
    renderSection();
    b.answers['settings.engineApplied'] = () => {
      throw new Error("Claude Code 2.1.283 is missing from MAWS's copy");
    };
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    fireEvent.click(await within(row('Binary')).findByRole('button', { name: 'Change…' }));
    await expect.poll(() => useNotices.getState().notices.map((n) => n.text)).toEqual(["Claude Code 2.1.283 is missing from MAWS's copy"]);
    expect(await within(row('Binary')).findByText('/opt/claude')).toBeTruthy();
  });
});

describe('the custody row', () => {
  it('names MAWS’s copy, its version, the start of its hash and when it was copied', async () => {
    renderSection();
    expect(await within(row('Engine copy')).findByText('MAWS copy · 2.1.283 · sha256 d8cb1e5c… · copied 2026-09-29')).toBeTruthy();
  });

  it('says the copy is not used while a binary path is chosen', async () => {
    renderSection({ ...SETTINGS_DEFAULTS_V7, engine: { ...SETTINGS_DEFAULTS_V7.engine, binaryPath: '/opt/claude' } });
    expect(await within(row('Engine copy')).findByText('not used while a binary path is chosen')).toBeTruthy();
  });

  it('gives a refusal in words', async () => {
    const refused: Custody = { state: 'mismatch', path: '/u/engine/2.1.283/claude', message: "Claude Code 2.1.283 has been altered in MAWS's copy at /u/engine/2.1.283/claude." };
    renderSection(SETTINGS_DEFAULTS_V7, { 'settings.engineCustody': () => refused });
    expect(await within(row('Engine copy')).findByText(refused.message)).toBeTruthy();
  });

  it('says when custody does not run (tests and replay)', async () => {
    renderSection(SETTINGS_DEFAULTS_V7, { 'settings.engineCustody': () => null });
    expect(await within(row('Engine copy')).findByText('not kept in this run · launches use the installed binary')).toBeTruthy();
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
