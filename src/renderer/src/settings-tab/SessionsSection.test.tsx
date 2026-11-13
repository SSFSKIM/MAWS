// U11a M9 (l8-settings-06): Settings › Sessions, what shapes a session MAWS runs. The auto fallback row moved here from
// Engine with its case, unchanged; the subagent model and the archive rule are pinned through the whole view
// (SettingsView.test.tsx), the launch profile and MAWS's own MCP servers by their own files.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { SessionsSection } from './SessionsSection';

let b: SettingsBridge;
let unsubscribe = () => {};
const settings = () => useSettings.getState().state!.settings;

function renderSection(initial: Settings = SETTINGS_DEFAULTS_V21) {
  b = settingsBridge(initial);
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <SessionsSection settings={settings()} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  unsubscribe = useSettings.subscribe((state) => {
    if (state.state) rendered.rerender(view());
  });
}

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: PreloadBridge }).maws;
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
