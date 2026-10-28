// P4-A2 (settings version 17): Settings › Engine's launch profile, drawn inside the Engine section as the owner finds it:
// the user's plugins with a switch each and the hooks (version 19: no output style row, the user's style always); each
// change writes the whole profile through `settings.set`, and the user scope (nothing written) is what an untouched page
// holds.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import type { InstalledPlugin } from '@shared/ipc/schema/plugins';
import type { LaunchProfile } from '@shared/engine/launch-profile';
import { SETTINGS_DEFAULTS_V19 } from '@shared/settings/defaults';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { LAUNCH_PROFILE } from './copy';
import { EngineSection } from './EngineSection';
import { listedPlugins } from './LaunchProfileSettings';

vi.mock('./engine-update', () => ({ openEngineUpdate: vi.fn() }));

const plugin = (id: string, over: Partial<InstalledPlugin> = {}): InstalledPlugin => ({
  id, name: id.split('@')[0]!, marketplace: id.split('@')[1]!, version: '1.0.0', scope: 'user', enabled: true, projectPath: null, installPath: `/Users/owner/.claude/plugins/cache/${id}`,
  errors: [], notes: [], installedAt: null, lastUpdated: null, projectEnabled: false, here: false, coversHere: false, ...over,
});
const INSTALLED = [
  plugin('ptc@ptc-tool'),
  plugin('cua@cua'),
  plugin('doperpowers@doperpowers'),
  plugin('eli5@claude-community', { enabled: false }), // off in the user's own settings: not theirs to switch here
  plugin('supabase@claude-plugins-official', { scope: 'local', projectPath: '/work/app' }), // a project's, not the user's
];

let b: SettingsBridge;
let unsubscribe = () => {};
const current = () => useSettings.getState().state!.settings;

function renderSection(initial: Settings = SETTINGS_DEFAULTS_V19, installed: InstalledPlugin[] = INSTALLED) {
  b = settingsBridge(initial);
  b.answers['plugins.list'] = () => ({ plugins: installed });
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = () => (
    <QueryClientProvider client={client}>
      <EngineSection settings={current()} />
    </QueryClientProvider>
  );
  const rendered = render(view());
  unsubscribe = useSettings.subscribe((state) => {
    if (state.state) rendered.rerender(view());
  });
}
const row = (label: string) => screen.getByRole('group', { name: label });
const pluginSwitch = (id: string) => within(row(LAUNCH_PROFILE.plugins)).getByRole('switch', { name: LAUNCH_PROFILE.pluginOn(id) });
const radio = (group: string, label: string) => within(screen.getByRole('radiogroup', { name: group })).getByRole('radio', { name: label }) as HTMLInputElement;
const profileWith = (over: Partial<LaunchProfile>): Settings => ({ ...SETTINGS_DEFAULTS_V19, engine: { ...SETTINGS_DEFAULTS_V19.engine, launchProfile: { ...SETTINGS_DEFAULTS_V19.engine.launchProfile, ...over } } });

afterEach(() => {
  unsubscribe();
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

describe('Settings › Engine › the launch profile', () => {
  it('shows the user scope untouched: the user’s own plugins each switched on and their hooks, no style choice, nothing written', async () => {
    renderSection();
    expect(await within(row(LAUNCH_PROFILE.plugins)).findByText('ptc@ptc-tool')).toBeTruthy();
    for (const id of ['cua@cua', 'doperpowers@doperpowers', 'ptc@ptc-tool']) expect(pluginSwitch(id).getAttribute('aria-checked'), id).toBe('true');
    expect(within(row(LAUNCH_PROFILE.plugins)).queryByText('eli5@claude-community')).toBeNull();
    expect(within(row(LAUNCH_PROFILE.plugins)).queryByText('supabase@claude-plugins-official')).toBeNull();
    expect(radio(LAUNCH_PROFILE.hooks, LAUNCH_PROFILE.hooksYours).checked).toBe(true);
    expect(screen.queryByRole('radiogroup', { name: /style/i })).toBeNull(); // version 19: the user's style always, no choice
    expect(within(row(LAUNCH_PROFILE.hooks)).getByText(LAUNCH_PROFILE.hooksNote)).toBeTruthy();
    expect(b.calls.filter((c) => c.name === 'plugins.list').map((c) => c.input)).toEqual([{ cwd: '/Users/owner/.claude' }]); // in the engine's config home
    expect(b.sets).toEqual([]);
  });

  it('switches a plugin off and on again and the hooks to none, writing the whole profile each time', async () => {
    renderSection();
    await within(row(LAUNCH_PROFILE.plugins)).findByText('ptc@ptc-tool');
    fireEvent.click(pluginSwitch('ptc@ptc-tool'));
    await vi.waitFor(() => expect(pluginSwitch('ptc@ptc-tool').getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(pluginSwitch('cua@cua'));
    await vi.waitFor(() => expect(pluginSwitch('cua@cua').getAttribute('aria-checked')).toBe('false'));
    fireEvent.click(radio(LAUNCH_PROFILE.hooks, LAUNCH_PROFILE.hooksNone));
    await vi.waitFor(() => expect(radio(LAUNCH_PROFILE.hooks, LAUNCH_PROFILE.hooksNone).checked).toBe(true));
    fireEvent.click(pluginSwitch('ptc@ptc-tool'));
    await vi.waitFor(() => expect(pluginSwitch('ptc@ptc-tool').getAttribute('aria-checked')).toBe('true'));
    expect(b.sets).toEqual([
      { engine: { launchProfile: { plugins: { off: ['ptc@ptc-tool'] }, hooks: 'user' } } },
      { engine: { launchProfile: { plugins: { off: ['cua@cua', 'ptc@ptc-tool'] }, hooks: 'user' } } },
      { engine: { launchProfile: { plugins: { off: ['cua@cua', 'ptc@ptc-tool'] }, hooks: 'none' } } },
      { engine: { launchProfile: { plugins: { off: ['cua@cua'] }, hooks: 'none' } } },
    ]);
    expect(current().engine.launchProfile).toEqual({ plugins: { off: ['cua@cua'] }, hooks: 'none' });
  });

  it('keeps a plugin it switched off listed, off, after the user’s settings stop listing it, so it can come back', async () => {
    renderSection(profileWith({ plugins: { off: ['gone@market'] } }), [plugin('ptc@ptc-tool')]);
    await within(row(LAUNCH_PROFILE.plugins)).findByText('ptc@ptc-tool');
    expect(pluginSwitch('gone@market').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(pluginSwitch('gone@market'));
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { launchProfile: { plugins: { off: [] }, hooks: 'user' } } }]));
  });

  it('says when the user’s settings turn on no plugin', async () => {
    renderSection(SETTINGS_DEFAULTS_V19, []);
    expect(await within(row(LAUNCH_PROFILE.plugins)).findByText(LAUNCH_PROFILE.pluginsNone)).toBeTruthy();
  });

  it('lists the user-scope plugins the settings turn on, then those the profile turns off, once each and sorted', () => {
    expect(listedPlugins(INSTALLED, ['zeta@z', 'ptc@ptc-tool'])).toEqual(['cua@cua', 'doperpowers@doperpowers', 'ptc@ptc-tool', 'zeta@z']);
  });
});
