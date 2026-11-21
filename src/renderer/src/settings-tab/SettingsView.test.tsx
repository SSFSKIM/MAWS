// The Settings tab (C11 execution document, Interfaces "Settings tab"; M5 pins): five sections over settings v3, every
// row writing exactly its own field through `settings.set` and re-rendering from the settings store.
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useGateway } from '../gateway/store';
import { useAttention } from '../stores/attention';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, settingsBridge, VOICE_HELPER, type SettingsBridge } from '../test-support/settings-bridge';
import { SECTION_TABLE, SETTINGS_SECTIONS, SettingsView } from './SettingsView';
import { MCP_SERVERS, SECTIONS } from './copy';
import { SEND_TO_COPY } from '../delivery/copy';
import { waitingStatus } from '../test-support/host-status';
import { useLayout } from '../stores/layout';
import { LAYOUT_DEFAULTS } from '@shared/ipc/schema/layout';
// C12 start
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { resetBudgetStore, useBudget } from '../budget/store';
import { useSessions } from '../stores/sessions';
import { REL } from '../test-support/relative-time';
// C12 end
import type { UsageSnapshot } from '@shared/usage/types'; // UX wave U7b (O-47): Settings › Usage
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { useUsage } from '../stores/usage';

let b: SettingsBridge;

function renderView(initial: Settings = SETTINGS_DEFAULTS_V21, section: Parameters<typeof SettingsView>[0]['section'] = null, answers: SettingsBridge['answers'] = {}) {
  b = settingsBridge(initial);
  Object.assign(b.answers, answers); // before the first render, so the sections' first reads see them
  window.maws = b.bridge;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsView section={section} />
    </QueryClientProvider>,
  );
}
const row = (label: string) => screen.getByRole('group', { name: label });
const settings = () => useSettings.getState().state!.settings;
const index = () => screen.getByRole('navigation', { name: 'Settings sections' });
const region = (name: string) => screen.getByRole('region', { name });
// U11a M9: a section's rows in the page's order, by their labels (the supervisor's group is named, not labelled, and holds rows)
const labelsIn = (section: HTMLElement) => [...section.querySelectorAll('[role="group"][aria-labelledby]')].map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)!.textContent);
// the word cut: a row's note, hidden at rest, its words the row's description
const noteOf = (of: HTMLElement) => of.querySelector<HTMLElement>('[data-row-note]')!;
// a row's words as the accessibility tree reads them: its description, whether its note is open or not
const describes = (label: string, words: string) => screen.getByRole('group', { name: label, description: (description) => description.includes(words) });
const describedBy = (label: string, words: string) => screen.getByRole('group', { name: label, description: (d) => d.includes(words) });
// the machine's settings answered (by a daemon before the machine route), so the Gateway section's read does not fail
const ANSWERED = { 'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1 }) };

let usageFixture: UsageSnapshot;
beforeAll(async () => {
  const reader = new ClaudeUsageReader({ dir: join(__dirname, '../../../../test/fixtures/claude-usage'), emit: () => {}, log: () => {}, now: () => Date.parse('2026-09-29T07:36:17Z') });
  usageFixture = await reader.snapshot([]);
  reader.stop();
});
beforeEach(() => {
  useGateway.setState({ relay: null, directLogin: new Map() });
});
afterEach(() => {
  cleanup();
  useUsage.setState({ snapshot: null, routed: null });
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  useAttention.setState({ notificationDelivery: null });
  delete (window as { maws?: PreloadBridge }).maws;
  vi.restoreAllMocks();
});

describe('settings tab writes one field per row', () => {
  // U11a M9 (l8-settings-06, A5): everyday preferences first, the engine last; Org under the rule with no heading of its own.
  // UX wave U7b (O-47): Usage after Gateway.
  const ORDER = ['Appearance', 'Notifications', 'Keyboard', 'Voice', 'Browser', 'Artifacts', 'Sessions', 'Gateway', 'Usage', 'Engine', 'Supervisor', 'Org'];
  it('groups the index in two runs parted by a gap, Org and Customize after them, the footer kept; the body in the same order', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    expect(within(index()).getAllByRole('button').map((x) => x.textContent)).toEqual([...ORDER, 'Customize ›']);
    // the word cut (G1, G3): no title and no group headings, the Settings dialog naming the page; a gap parts the runs
    const groups = [...index().querySelectorAll<HTMLElement>('[data-settings-group]')];
    expect(groups.map((group) => [group.dataset.settingsGroup, [...group.querySelectorAll('button')].map((x) => x.textContent)])).toEqual([['app', ORDER.slice(0, 6)], ['sessions', ORDER.slice(6, 11)]]);
    expect(groups.map((group) => group.classList.contains('pt-3'))).toEqual([false, true]);
    for (const word of ['Settings', 'App', 'Sessions & engine']) expect(within(index()).queryByText(word)).toBeNull();
    expect(index().textContent).toContain("Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude.");
    const sections = [...document.querySelectorAll('[data-settings-body] section[aria-labelledby^="settings-"]')].map((s) => s.getAttribute('aria-labelledby'));
    expect(sections).toEqual(SECTION_TABLE.map(({ section }) => `settings-${section}`));
    expect(SECTION_TABLE.map(({ section }) => SECTIONS[section])).toEqual(ORDER);
    expect(SECTION_TABLE.map(({ group }) => group)).toEqual(['app', 'app', 'app', 'app', 'app', 'app', 'sessions', 'sessions', 'sessions', 'sessions', 'sessions', null]);
    expect([...SETTINGS_SECTIONS]).toEqual(SECTION_TABLE.map(({ section }) => section));
  });

  it('opens at Appearance when no section is asked for', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    expect(within(index()).getByRole('button', { name: 'Appearance' }).getAttribute('aria-current')).toBe('true');
    expect(within(index()).getAllByRole('button').filter((x) => x.getAttribute('aria-current') === 'true')).toHaveLength(1);
  });

  // U11a M9 (A5): each section's rows, in the order of the child's table; Engine's three; no Plugins paragraph
  it('each section holds the rows of the table, in its order; Engine holds Binary alone, and the Plugins paragraph is gone', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    await within(row('Binary')).findByText('2.1.287'); // the version read; its path is the chip's tooltip and in the note
    expect(labelsIn(region('Appearance'))).toEqual(['Theme', 'Transcript width', 'Monospace font']);
    expect(labelsIn(region('Notifications'))).toEqual(['Messages to you', 'Notify me', 'For', 'Sound']);
    expect(within(region('Keyboard')).getByRole('table', { name: 'Key bindings' })).toBeTruthy();
    expect(within(region('Keyboard')).queryByRole('button', { name: 'Reset to defaults' })).toBeNull(); // the word cut (G44): nothing to reset
    // the word cut (G50, G56): the helper ready and the language on this Mac, their rows are not drawn
    await vi.waitFor(() => expect(labelsIn(region('Voice'))).toEqual(['Shortcut', 'Language', 'Microphone', 'Speech recognition']));
    expect(labelsIn(region('Browser'))).toEqual(['Profile', 'Bookmarks bar', 'Search engine', 'New-window links', 'Chrome profile']);
    expect(labelsIn(region('Artifacts'))).toEqual(['Export author name', 'Default design system', 'By Space']);
    expect(labelsIn(region('Sessions'))).toEqual(['Plugins in sessions', 'Hooks in sessions', 'MCP servers', 'Subagent model', 'When auto mode is unavailable', 'Archive after']);
    expect(labelsIn(region('Gateway'))).toEqual(['Default route', 'If the relay is down', 'Switch to Direct in Session info', 'Direct login', 'Relay']);
    expect(labelsIn(region('Engine'))).toEqual(['Binary']);
    // the word cut (G133, G136, G139): the daemon connected, its row is not drawn; Stop all's label is its name alone
    expect(labelsIn(region('Supervisor'))).toEqual(['Status', 'Exit when idle', 'Stop all', 'Release idle sessions over a memory limit', 'Limit', 'Stateful MCP servers']);
    expect(within(region('Supervisor')).getByRole('group', { name: 'Background supervisor' })).toBeTruthy(); // its rows keep their group, named
    expect(within(region('Supervisor')).queryByRole('heading', { name: 'Background supervisor' })).toBeNull(); // the section's heading stands in its place
    expect(screen.queryByRole('group', { name: 'Plugins' })).toBeNull();
    expect(document.body.textContent).not.toContain('Plugin hooks run in MAWS sessions');
    expect(document.body.textContent).not.toContain('MAWS reads them and keeps its own index elsewhere'); // the chip says it
  });

  it('says once under the Sessions heading what every one of its rows would otherwise repeat', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const sessions = region('Sessions');
    const line = within(sessions).getByText('For sessions MAWS runs.'); // the word cut (G85)
    expect(line.closest('h3')).toBeNull(); // under the heading, not in it
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
    for (const label of labelsIn(sessions)) expect(row(label!).textContent).not.toMatch(/terminal session|settings files are never changed/i);
  });

  // the word cut (G13 to G15): a row's note waits in the row, whole, with no More and no Less; the row taking the
  // keyboard (as a search's landing gives it) opens it, and it closes once the keyboard leaves
  it('a note is hidden at rest, the row’s description, and opens whole in the row when the row takes the keyboard', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const archive = row('Archive after');
    expect(noteOf(archive).hidden).toBe(true);
    expect(describedBy('Archive after', 'Archived sessions can be restored from the sidebar. Pinned, live, waiting and background-running sessions stay, as do worktrees with uncommitted changes.')).toBe(archive);
    act(() => archive.focus());
    expect(noteOf(archive).hidden).toBe(false);
    expect(noteOf(archive).textContent).toBe('Archived sessions can be restored from the sidebar. Pinned, live, waiting and background-running sessions stay, as do worktrees with uncommitted changes.');
    expect(screen.queryByRole('button', { name: /^(More|Less)$/ })).toBeNull();
    act(() => archive.blur());
    await vi.waitFor(() => expect(noteOf(archive).hidden).toBe(true)); // after its close motion
    expect(b.sets).toEqual([]);
  });

  it('a state line stays whole: the supervisor waiting on an older version says all of it, with no More', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { ...ANSWERED, 'host.status': () => waitingStatus(2) });
    const status = row('Status');
    await vi.waitFor(() => expect(status.querySelector('[data-settings-note="state"]')).not.toBeNull());
    expect(status.querySelector('[data-settings-note="state"]')!.textContent).toBe("This version of MAWS cannot use it. Restart now stops those sessions and starts this version's supervisor; Send resumes each from its transcript.");
    expect(within(status).queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('Direct login keeps the sign-in command and its Copy on the row’s line at rest, the token sentence in its note (G108)', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const line = row('Direct login').querySelector('[data-settings-note]')! as HTMLElement;
    expect(line.textContent).toBe('claude /loginCopy');
    expect(within(line).getAllByRole('button').map((x) => x.textContent)).toEqual(['Copy']);
    expect(describedBy('Direct login', "MAWS never stores a token; ClaudeUsage holds the relay's accounts.")).toBe(row('Direct login'));
    expect(row('Direct login').textContent).not.toContain('Only Direct sessions use it');
  });

  it('copy outside Settings names the MCP servers row where it now is', () => {
    expect(SEND_TO_COPY.notionNotFound).toContain(`Settings › ${SECTIONS.sessions} › ${MCP_SERVERS.label}`);
    expect(SEND_TO_COPY.notionNoSession).not.toContain('Settings › Engine');
  });

  it('opens the Customize page from the index, closing the Settings dialog, without changing settings', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: { section: null } });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'customize', view: 'mine', show: 'all' }); // UX wave U7b: a page, no tab; U11c: All
    expect(useLayout.getState().settings).toBeNull();
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main);
    expect(b.sets).toEqual([]);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  });

  it('Engine and Sessions: the binary, the config home, and the subagent model as one field', async () => {
    renderView();
    // W13: the installed binary, no pin; the word cut (G125, G128): its path and the config home in the Binary row's note
    await vi.waitFor(() => expect(describes('Binary', '~/.local/share/claude/versions/2.1.287')).toBe(row('Binary')));
    await vi.waitFor(() => expect(describes('Binary', 'Config home · ~/.claude · read-only to MAWS')).toBe(row('Binary')));

    const field = within(row('Subagent model')).getByRole('combobox') as HTMLInputElement;
    expect(field.placeholder).toBe('inherit'); // W3: the engine's word for no override
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'engine.models', input: { refresh: false, gateway: 'gateway' } }));
    // the Claude values of the default route's catalogue, never a gateway alias
    const suggestions = () => [...document.getElementById(field.getAttribute('list')!)!.querySelectorAll('option')].map((o) => o.value);
    await vi.waitFor(() => expect(suggestions()).toEqual(['default', 'sonnet', 'haiku']));
    fireEvent.change(field, { target: { value: 'sonnet' } });
    fireEvent.blur(field);
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { subagentModel: 'sonnet' } }]));
    fireEvent.change(field, { target: { value: '  ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { subagentModel: null } }));
  });

  it('Engine: Change… stores the picked absolute path; main configures the host; no version refuses', async () => {
    renderView();
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude/2.1.290/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    // C12: main configures the host; the tab awaits settings.engineApplied and re-reads the binary as the host now holds it
    b.answers['engine.binaryInfo'] = () => {
      const { binaryPath } = settings().engine;
      return binaryPath === null ? BINARY : { ...BINARY, path: binaryPath, version: '2.1.290' };
    };
    fireEvent.click(await within(row('Binary')).findByRole('button', { name: 'Change…' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { binaryPath: '/opt/claude/2.1.290/claude' } }]));
    expect(b.calls.find((c) => c.name === 'layout.pickFiles')!.input).toEqual({ kind: 'files', directory: null, multiple: false });
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'settings.engineApplied', input: undefined })); // C12
    await vi.waitFor(() => expect(describes('Binary', '/opt/claude/2.1.290/claude')).toBe(row('Binary')));
    expect(within(row('Binary')).queryByText(/re-pin|refuse/)).toBeNull(); // W13: a version never refuses
    // C12; P4-A2: the launch profile's rows read the plugin list on their own schedule, which is no part of this write (P5 O7 M9: and Gateway its default route)
    const afterWrite = () => b.calls.slice(b.calls.findLastIndex((c) => c.name === 'settings.set') + 1).map((c) => c.name).filter((name) => name !== 'plugins.list' && name !== 'fs.state' && name !== 'machineSettings.get'); // P5 O7 M9: Gateway's default route, read again at each settings change
    await vi.waitFor(() => expect(afterWrite().slice(0, 2)).toEqual(['settings.engineApplied', 'engine.binaryInfo'])); // C12
    expect(b.calls.map((c) => c.name)).not.toContain('engine.configure'); // C12: main is its only sender

    // Use installed puts the binary path back to the installed Claude Code
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use installed' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { binaryPath: null } }));
  });

  it('Gateway: the default route, the relay policy and the per-session Direct option, each alone', async () => {
    renderView();
    fireEvent.click(within(row('Default route')).getByRole('radio', { name: 'Direct' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ gateway: { defaultRoute: 'direct' } }]));
    expect((within(row('Default route')).getByRole('radio', { name: 'Direct' }) as HTMLInputElement).checked).toBe(true);

    const policy = within(row('If the relay is down')).getByRole('combobox') as HTMLSelectElement;
    expect([...policy.options].map((o) => o.textContent)).toEqual(['Ask each time', 'Wait for the relay', 'Run direct']);
    fireEvent.change(policy, { target: { value: 'wait' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ gateway: { relayUnreachable: 'wait' } }));

    const offer = within(row('Switch to Direct in Session info')).getByRole('switch', { name: 'Offer "Switch to Direct…" in Session info' });
    expect(offer.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(offer);
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ gateway: { offerDirect: false } }));
    expect(b.sets).toHaveLength(3);
    expect(settings().gateway).toEqual({ defaultRoute: 'direct', relayUnreachable: 'wait', offerDirect: false });
  });

  // P5 O7 M9 ("The default, without a v2"): the machine's default route, read and chosen through `machineSettings.*` on this
  // machine, where `defaultRoute` is the resolved default (machine-route.json's, else the rule); the legacy field is the
  // daemon's to write
  it('Gateway: the default route offers the machine’s own route and round-trips through the machine’s settings', async () => {
    let held: 'gateway' | 'direct' | 'machine' = 'machine';
    const answers = {
      'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1, defaultRoute: held }),
      'machineSettings.set': (input: unknown) => {
        held = (input as { defaultRoute: typeof held }).defaultRoute;
        return { settings: machineSettingsDefaults(), defaultRoute: held };
      },
    };
    const { unmount } = renderView(SETTINGS_DEFAULTS_V21, null, answers);
    const radio = (name: string) => within(row('Default route')).getByRole<HTMLInputElement>('radio', { name });
    await vi.waitFor(() => expect(radio('Machine’s own').checked).toBe(true));
    expect(within(row('Default route')).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['Machine’s own', 'ClaudeUsage relay', 'Direct']);
    expect(describedBy('Default route', 'the machine’s own settings, environment and login decide')).toBe(row('Default route')); // in its note
    fireEvent.click(radio('ClaudeUsage relay'));
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'machineSettings.set', input: { patch: {}, defaultRoute: 'gateway' } }));
    await vi.waitFor(() => expect(radio('ClaudeUsage relay').checked).toBe(true));
    expect(b.sets).toEqual([]); // the legacy field is the daemon's to write, from the route chosen
    unmount();
    renderView(SETTINGS_DEFAULTS_V21, null, answers); // reopened: read back from the machine
    await vi.waitFor(() => expect(within(row('Default route')).getAllByRole('radio')).toHaveLength(3));
    expect(within(row('Default route')).getByRole<HTMLInputElement>('radio', { name: 'ClaudeUsage relay' }).checked).toBe(true);
    fireEvent.click(within(row('Default route')).getByRole('radio', { name: 'Machine’s own' }));
    await vi.waitFor(() => expect(held).toBe('machine'));
  });

  it('Gateway: a machine whose daemon predates the machine route keeps the two legacy routes, and a dropped choice is said', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { 'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1 }) });
    await vi.waitFor(() => expect(within(row('Default route')).getAllByRole('radio').map((r) => r.parentElement?.textContent)).toEqual(['ClaudeUsage relay', 'Direct']));
    fireEvent.click(within(row('Default route')).getByRole('radio', { name: 'Direct' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ gateway: { defaultRoute: 'direct' } }])); // the legacy patch, as before
    cleanup();
    // read as this build's, then answered by an older one: the choice did not take, and the words say why
    renderView(SETTINGS_DEFAULTS_V21, null, {
      'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1, defaultRoute: 'machine' }),
      'machineSettings.set': () => ({ settings: machineSettingsDefaults() }),
    });
    await vi.waitFor(() => expect(within(row('Default route')).getByRole<HTMLInputElement>('radio', { name: 'Machine’s own' }).checked).toBe(true));
    fireEvent.click(within(row('Default route')).getByRole('radio', { name: 'Direct' }));
    await vi.waitFor(() => expect(useNotices.getState().notices.map((n) => n.kind === 'toast' && n.text)).toContain('This machine’s mawsd predates the machine route; choose gateway or direct until it runs this build.'));
    expect(within(row('Default route')).getByRole<HTMLInputElement>('radio', { name: 'Machine’s own' }).checked).toBe(true);
  });

  it("Gateway: the direct login the engine last reported, the sign-in command to copy, and the relay's line", async () => {
    renderView();
    expect(within(row('Direct login')).getByText('Unknown')).toBeTruthy(); // the word cut (G107)
    act(() => useGateway.setState({ directLogin: new Map([['app-1' as never, { login: 'Claude Max', email: 'owner@example.test', organization: null }]]) }));
    expect(within(row('Direct login')).getByText("engine's own · Claude Max · owner@example.test")).toBeTruthy();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(row('Direct login')).getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('claude /login'));
    // the word cut (G109): the address, when it was checked and how fast its tooltip and description
    await vi.waitFor(() => expect(within(row('Relay')).getByText('127.0.0.1:8641', { selector: `[aria-describedby]` }).getAttribute('tabindex')).toBe('0'));
    expect(within(row('Relay')).getByText('127.0.0.1:8641')).toBe(within(row('Relay')).getByText('127.0.0.1:8641', { selector: '[tabindex="0"]' }));
    expect(document.getElementById(within(row('Relay')).getByText('127.0.0.1:8641').getAttribute('aria-describedby')!)!.textContent).toBe(`checked ${REL.now} · 2 ms`);
  });

  it('Appearance: the theme and the monospace font, with a preview line in that family', async () => {
    renderView();
    fireEvent.click(within(row('Theme')).getByRole('radio', { name: 'Dark' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ theme: 'dark' }]));

    const font = within(row('Monospace font')).getByRole('textbox') as HTMLInputElement;
    const preview = within(row('Monospace font')).getByTestId('mono-preview');
    expect(preview.textContent).toContain('');
    expect(preview.textContent).toContain('');
    fireEvent.change(font, { target: { value: 'MesloLGM Nerd Font Mono' } });
    expect(preview.style.fontFamily).toContain('MesloLGM Nerd Font Mono');
    fireEvent.keyDown(font, { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ appearance: { monoFont: 'MesloLGM Nerd Font Mono' } }));
    fireEvent.change(font, { target: { value: '' } });
    fireEvent.blur(font);
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ appearance: { monoFont: null } }));
    expect(within(row('Monospace font')).getByText('Name a Nerd Font to draw prompt glyphs in the terminal')).toBeTruthy();
  });

  it('Sessions: automatic archiving is opt-in and saves the chosen interval', async () => {
    renderView();
    const select = screen.getByRole('combobox', { name: 'Archive after' }); // the word cut (G98)
    expect((select as HTMLSelectElement).value).toBe('never');
    await userEvent.selectOptions(select, '14');
    expect(settings().sessions.archiveInactiveDays).toBe(14);
    await userEvent.selectOptions(select, 'never');
    expect(settings().sessions.archiveInactiveDays).toBeNull();
  });

  it('Notifications: enabled, one kind at a time, sound and no retired near-limit control; held peer messages are not drawn', async () => {
    renderView();
    const when = row('Notify me'); // the word cut (G28): the switch named by the sentence that stood beside it
    expect(within(when).getByRole('switch', { name: 'Notify when I am not looking at that session' })).toBeTruthy();
    expect(within(when).queryByText(/^macOS:/)).toBeNull();
    act(() => useAttention.setState({ notificationDelivery: 'os' }));
    expect(within(when).getByText('macOS: allowed')).toBeTruthy(); // stays (G29)
    act(() => useAttention.setState({ notificationDelivery: 'fallback' }));
    const blocked = within(when).getByText('Blocked in macOS').closest<HTMLElement>('[tabindex="0"]')!; // the word cut (G30)
    expect(document.getElementById(blocked.getAttribute('aria-describedby')!)!.textContent).toBe('MAWS falls back to a dock bounce and a toast');
    fireEvent.click(within(when).getByRole('switch'));
    await vi.waitFor(() => expect(b.sets).toEqual([{ notifications: { enabled: false } }]));

    const kinds = row('For');
    const finished = within(kinds).getByRole('checkbox', { name: 'Turn finished' }) as HTMLInputElement;
    expect(finished.checked).toBe(true);
    fireEvent.click(finished);
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { kinds: { turnFinished: false } } }));
    fireEvent.click(within(kinds).getByRole('checkbox', { name: /^errors/ }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { kinds: { errors: false } } }));
    expect(settings().notifications.kinds).toEqual({ turnFinished: false, approvals: true, questions: true, planReviews: true, errors: false, heldPeerMessages: false, asyncInput: true, essential: true /* P2-C */ });
    // the word cut (G34): held peer messages, which never notify, are not drawn; (G33) approvals' caption is its description
    expect(within(kinds).queryByRole('checkbox', { name: /^held peer messages/ })).toBeNull();
    expect(kinds.textContent).not.toContain('Never notifies in this version');
    expect(within(kinds).getByRole('checkbox', { name: 'approvals', description: 'permission requests, dialogs and MCP elicitations' })).toBeTruthy();

    expect(row('Sound').textContent).toBe('Sound'); // the word cut (G35): no on/off word
    fireEvent.click(within(row('Sound')).getByRole('switch'));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { sound: true } }));
    expect(screen.queryByText('Near-limit banner')).toBeNull();
    expect(b.sets).toHaveLength(4);
  });

  // P2-C start (2026-10-10; the P2-C document, §9 and G7): the to-human mod's app switch and the owner channel's two groups
  it('Notifications: the to-human switch and the two groups an agent’s marks notify for', async () => {
    renderView();
    const mod = row('Messages to you');
    const toggle = within(mod).getByRole('switch', { name: 'To-human' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(describedBy('Messages to you', 'Agents message you and ask questions you answer in place; a session reads as their report. The view follows at once; the instructions, the next time each session starts.')).toBe(mod); // G27: both in its note
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ mods: { toHuman: { enabled: false } } }));

    const kinds = row('For');
    expect(within(kinds).getAllByRole('checkbox').map((box) => box.closest('label')!.textContent)).toEqual(['Turn finished', 'approvals', 'questions', 'plan reviews', 'errors', 'questions an agent left for you', 'must-read messages']);
    fireEvent.click(within(kinds).getByRole('checkbox', { name: 'must-read messages' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { kinds: { essential: false } } }));
    fireEvent.click(within(kinds).getByRole('checkbox', { name: 'questions an agent left for you' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { kinds: { asyncInput: false } } }));
  });
  // P2-C end

  // M5b fix round 2 (e2e:settings settings.spec.ts:121): on the daemon shape a machine field's write crosses to mawsd and
  // back before the store moves, so a segment shows the option chosen while its write is out, then the store's value
  it('a segment shows the chosen option while its write is out, then what the store holds', async () => {
    renderView();
    const invoke = b.bridge.invoke as unknown as ReturnType<typeof vi.fn<(name: string, input: unknown) => Promise<unknown>>>;
    const real = invoke.getMockImplementation()!;
    let release!: () => void;
    invoke.mockImplementation(async (name: string, input: unknown) => {
      if (name === 'settings.set') await new Promise<void>((resolve) => (release = resolve));
      return real(name, input);
    });
    const direct = () => within(row('Default route')).getByRole('radio', { name: 'Direct' }) as HTMLInputElement;
    fireEvent.click(direct());
    expect(direct().checked).toBe(true);
    await act(async () => release());
    await vi.waitFor(() => expect(b.sets).toEqual([{ gateway: { defaultRoute: 'direct' } }]));
    expect(direct().checked).toBe(true);
  });

  // M5b fix round 3 (E): the option shown while the write is out goes back to the store's when the write is refused, and
  // the refusal is shown
  it('a segment whose write is refused puts the old option back and shows the refusal', async () => {
    renderView();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoke = b.bridge.invoke as unknown as ReturnType<typeof vi.fn<(name: string, input: unknown) => Promise<unknown>>>;
    const real = invoke.getMockImplementation()!;
    let refuse!: () => void;
    invoke.mockImplementation(async (name: string, input: unknown) => {
      if (name !== 'settings.set') return real(name, input);
      await new Promise<void>((resolve) => (refuse = resolve));
      return { ok: false, error: { code: 'host_unavailable', message: 'the machine daemon is not reachable' } };
    });
    const radio = (name: string) => within(row('Default route')).getByRole('radio', { name }) as HTMLInputElement;
    fireEvent.click(radio('Direct'));
    expect(radio('Direct').checked).toBe(true); // shown while the write is out
    await act(async () => refuse());
    await vi.waitFor(() => expect(useNotices.getState().notices).toEqual([expect.objectContaining({ kind: 'toast', level: 'warning', text: 'The setting was not saved · the machine daemon is not reachable' })]));
    expect(radio('ClaudeUsage relay').checked).toBe(true);
    expect(radio('Direct').checked).toBe(false);
    expect(error).toHaveBeenCalled();
  });

  it('a refused write shows a toast and the row keeps the value the store holds', async () => {
    renderView();
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoke = b.bridge.invoke as unknown as ReturnType<typeof vi.fn<(name: string, input: unknown) => Promise<unknown>>>;
    const real = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (name: string, input: unknown) => (name === 'settings.set' ? { ok: false, error: { code: 'internal', message: 'disk full' } } : real(name, input)));
    fireEvent.click(within(row('Default route')).getByRole('radio', { name: 'Direct' }));
    await vi.waitFor(() => expect(useNotices.getState().notices).toEqual([expect.objectContaining({ kind: 'toast', level: 'warning', text: 'The setting was not saved · disk full' })]));
    expect((within(row('Default route')).getByRole('radio', { name: 'ClaudeUsage relay' }) as HTMLInputElement).checked).toBe(true);
    expect(error).toHaveBeenCalled();
  });

  it('a refused text field goes back to the saved value, and the same text can be tried again', async () => {
    renderView();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const invoke = b.bridge.invoke as unknown as ReturnType<typeof vi.fn<(name: string, input: unknown) => Promise<unknown>>>;
    const real = invoke.getMockImplementation()!;
    let refusals = 0;
    invoke.mockImplementation(async (name: string, input: unknown) => {
      if (name !== 'settings.set') return real(name, input);
      refusals++;
      return { ok: false, error: { code: 'internal', message: 'disk full' } };
    });
    const font = within(row('Monospace font')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(font, { target: { value: 'MesloLGM Nerd Font Mono' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    await vi.waitFor(() => expect(font.value).toBe(''));
    expect(refusals).toBe(1);
    fireEvent.change(font, { target: { value: 'MesloLGM Nerd Font Mono' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    await vi.waitFor(() => expect(refusals).toBe(2));
  });

  // UX wave U7b (O-47; its execution document, M7 decisions 4 and 7): the whole usage panel as the section's content
  it('Usage holds the grid with the account actions under the title “Claude accounts”, in the section’s measure', async () => {
    useUsage.setState({ snapshot: usageFixture });
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(() => {});
    renderView(SETTINGS_DEFAULTS_V21, 'usage', ANSWERED);
    expect(within(index()).getByRole('button', { name: 'Usage' }).getAttribute('aria-current')).toBe('true');
    const usage = region('Usage');
    expect(within(usage).getByRole('heading', { name: 'Usage' }).id).toBe('settings-usage');
    expect(within(usage).getByRole('heading', { name: 'Claude accounts' })).toBeTruthy();
    expect(within(usage).getByRole('heading', { name: 'Codex accounts' })).toBeTruthy();
    const marked = usage.querySelector<HTMLElement>('[data-settings-row="usage.accounts"]')!;
    expect(marked.getAttribute('data-settings-state')).toBe('default');
    const panel = marked.querySelector<HTMLElement>('[data-usage-panel]')!;
    expect(panel.className).not.toMatch(/(^|\s)(p|px|w)-/);
    expect(panel.querySelector('[data-columns]')!.getAttribute('data-columns')).toBe('2');
    expect(within(panel).getAllByRole('button', { name: 'Remove account…' })).toHaveLength(5);
    expect(within(panel).getByRole('button', { name: 'Add account…' })).toBeTruthy();
    await vi.waitFor(() => expect(b.calls.map((c) => c.name)).toContain('settings.usageControls'));
  });

  it('opens at the section it is given', () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('aria-labelledby') ?? '');
    });
    renderView(SETTINGS_DEFAULTS_V21, 'keyboard');
    expect(scrolled.at(-1)).toMatch(/keyboard/);
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Keyboard' }).getAttribute('aria-current')).toBe('true');
  });

  // W9 (H1): the stacked layout is measured in a split pane by the e2e settings group; here, the classes that give way.
  // U11a M9 (A6): the rows stack by the body's own width (its column is a container of its own) and the index by the view's.
  it('stacks in a narrow body: every fixed column gives way under the body’s container, and the index under the view’s', async () => {
    const { container } = renderView();
    await within(row('Binary')).findByText('2.1.287'); // the version read; its path is the chip's tooltip and in the note
    const root = container.firstElementChild!;
    const classes = (el: Element) => [...el.classList];
    const fixedColumns = (el: Element) => classes(el).some((c) => /^grid-cols-\[.*\d+px/.test(c));
    expect(root.classList.contains('@container/settings')).toBe(true);
    // the index beside the body: the view's
    const grid = root.firstElementChild!;
    expect(fixedColumns(grid)).toBe(true);
    expect(classes(grid)).toContain('@max-lg/settings:grid-cols-1');
    expect(classes(index().querySelector('[data-settings-index]')!)).toContain('@max-lg/settings:flex-row');
    // the body's column is the rows' container: every Setting row and every key binding row gives way under it
    const column = root.querySelector('[data-settings-column]')!;
    expect(column.classList.contains('@container/settings-body')).toBe(true);
    const fixed = [...column.querySelectorAll('*')].filter(fixedColumns);
    const rows = screen.getAllByRole('group').filter((g) => g.hasAttribute('aria-labelledby'));
    expect(fixed.length).toBe(rows.length + screen.getAllByRole('row').filter((r) => r.querySelector('[role="cell"]')).length);
    for (const el of fixed) expect(classes(el).some((c) => c.startsWith('@max-lg/settings-body:grid-cols-')), el.className).toBe(true);
    for (const el of fixed) expect(classes(el).some((c) => c.startsWith('@max-lg/settings:')), el.className).toBe(false);
    for (const el of column.querySelectorAll('.col-start-2')) expect(el.classList.contains('@max-lg/settings-body:col-start-1')).toBe(true);
    // label, control, note in reading order, so one column reads label over control over note
    const binary = row('Binary');
    expect([...binary.children].map((c) => c.textContent)).toEqual(['Binary', expect.stringContaining('Change…'), expect.stringContaining('New sessions start on your installed Claude Code')]); // W13's note
    // below the index's break its row of links drops the groups' gap and keeps the order
    for (const group of index().querySelectorAll('[data-settings-group]')) expect(group.classList.contains('@max-lg/settings:contents')).toBe(true);
  });
});

// C12 start: Settings › Engine's memory budget rows (C12 execution document, Interfaces "Settings, version 4"): the
// budget in GB with one decimal stored in MiB, its default named from the host's limit, and the stateful servers.
describe('settings tab: the memory budget rows', () => {
  const GiB = 1024 * 1024;
  beforeEach(() => {
    resetBudgetStore();
    useBudget.getState().apply({ enabled: true, limitKiB: 8 * GiB, totalKiB: 3 * GiB, sampledAt: null, over: false, overWithoutCandidate: false, candidates: 0, settling: 0, releasing: null, blocked: [], lastRelease: null });
  });
  afterEach(() => {
    resetBudgetStore();
    useSessions.setState({ engine: new Map() });
  });

  it('Memory budget: the default named from the host’s limit; a GB value with one decimal is stored in MiB; Use default writes null', async () => {
    renderView();
    const field = within(row('Limit')).getByRole('textbox', { name: 'Memory budget' }) as HTMLInputElement; // W7: the row is the limit's
    expect(field.value).toBe('');
    expect(field.placeholder).toBe('8');
    expect(describedBy('Limit', 'Past it the least recently used idle session is released.')).toBe(row('Limit')); // the word cut (G142): the default's size is the placeholder
    fireEvent.change(field, { target: { value: '6.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { memoryBudgetMiB: 6656 } }]));
    await vi.waitFor(() => expect(field.value).toBe('6.5'));
    fireEvent.click(within(row('Limit')).getByRole('button', { name: 'Use default' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { memoryBudgetMiB: null } }));
    expect(settings().engine.memoryBudgetMiB).toBeNull();
  });

  it('Memory budget: a value below 0.5 GB or not a number is refused in words and the field goes back', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, memoryBudgetMiB: 6144 } });
    const field = within(row('Limit')).getByRole('textbox', { name: 'Memory budget' }) as HTMLInputElement;
    expect(field.value).toBe('6.0');
    for (const typed of ['0.4', 'lots']) {
      fireEvent.change(field, { target: { value: typed } });
      fireEvent.blur(field);
      await vi.waitFor(() => expect(field.value).toBe('6.0'));
    }
    expect(b.sets).toEqual([]);
    expect(useNotices.getState().notices.map((n) => n.text)).toContain('Enter the memory budget in GB, at least 0.5');
  });

  // W7: the switch (settings version 7), on by default; off hides the limit and the stateful servers
  it('Memory budget: a switch, on by default, writes the switch whole; off hides the limit and the stateful servers and says what off means', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, engine: { ...SETTINGS_DEFAULTS_V21.engine, memoryBudgetMiB: 6144 } });
    const toggle = within(row('Release idle sessions over a memory limit')).getByRole('switch', { name: 'Release idle sessions to stay under a memory limit' }); // the word cut (G139)
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(row('Limit')).toBeTruthy();
    expect(row('Stateful MCP servers')).toBeTruthy();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { memoryBudget: { enabled: false } } }]));
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('group', { name: 'Limit' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Stateful MCP servers' })).toBeNull();
    expect(describedBy('Release idle sessions over a memory limit', 'Session info still shows the memory they use.')).toBeTruthy(); // the word cut (G140)
    expect(row('Release idle sessions over a memory limit').textContent).not.toContain('Off: an engine process ends only');
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(settings().engine.memoryBudget).toEqual({ enabled: true }));
    expect((within(row('Limit')).getByRole('textbox', { name: 'Memory budget' }) as HTMLInputElement).value).toBe('6.0'); // the limit was kept while off
    expect(b.sets).toEqual([{ engine: { memoryBudget: { enabled: false } } }, { engine: { memoryBudget: { enabled: true } } }]);
  });

  it('Stateful MCP servers: adds a typed name, suggests the names live sessions report, and removes a chip', async () => {
    useSessions.setState({ engine: new Map([['app-a' as AppSessionId, status('app-a', { mcpServers: [{ name: 'plugin:ptc:ptc', status: 'connected', source: 'plugin' }, { name: 'c12-kernel', status: 'pending', source: 'project' }] })]]) });
    renderView();
    const add = within(row('Stateful MCP servers')).getByRole('combobox', { name: 'Add a stateful MCP server' }) as HTMLInputElement;
    const suggestions = () => [...document.getElementById(add.getAttribute('list')!)!.querySelectorAll('option')].map((o) => o.value);
    expect(suggestions()).toEqual(['c12-kernel', 'plugin:ptc:ptc']);
    fireEvent.change(add, { target: { value: ' c12-kernel ' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { statefulMcpServers: ['c12-kernel'] } }]));
    await vi.waitFor(() => expect(add.value).toBe(''));
    expect(suggestions()).toEqual(['plugin:ptc:ptc']);
    fireEvent.change(add, { target: { value: 'my-kernel' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    await vi.waitFor(() => expect(settings().engine.statefulMcpServers).toEqual(['c12-kernel', 'my-kernel']));
    fireEvent.click(within(row('Stateful MCP servers')).getByRole('button', { name: 'Remove c12-kernel' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { statefulMcpServers: ['my-kernel'] } }));
  });
});
// C12 end

it('keyboard section selection places focus in Appearance, so Tab enters its controls', async () => {
  const user = userEvent.setup();
  renderView();
  const appearance = within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Appearance' });
  act(() => appearance.focus());
  await user.keyboard('{Enter}');
  expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Appearance' }));
  await user.tab();
  expect(screen.getByRole('region', { name: 'Appearance' }).contains(document.activeElement)).toBe(true);
});

// E9 start: Settings › Voice (E9 execution document, M4 pins): the shortcut as the keymap has it, the recognition
// language as one field, and the status main's probe reports, with the System Settings pane for a denial.
describe('settings view lists Voice', () => {
  const status =
    (over: Record<string, unknown> = {}) =>
    (input: unknown) => ({
      helper: { state: 'ready', path: VOICE_HELPER },
      backend: 'helper',
      permission: { microphone: 'authorized', speech: 'authorized' },
      systemLocale: 'ko-KR',
      locale: (input as { locale: string | null }).locale ?? 'ko-KR',
      supportsOnDevice: true,
      locales: ['ko-KR', 'en-US', 'fr-FR'],
      ...over,
    });
  const language = () => within(row('Language')).getByRole('combobox', { name: 'Language' }) as HTMLSelectElement;
  const optionTexts = () => [...language().options].map((o) => o.textContent);

  it('renders the Voice heading right after Keyboard', () => {
    renderView();
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.getAttribute('aria-label'));
    expect(headings.indexOf('Voice')).toBe(headings.indexOf('Keyboard') + 1);
  });

  it('the shortcut row shows the effective chord, and Change in Keyboard shows the Keyboard section', () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('aria-labelledby') ?? '');
    });
    renderView({ ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Cmd+D' } });
    expect(within(row('Shortcut')).getByText('⌘D')).toBeTruthy();
    const change = within(row('Shortcut')).getByRole('button', { name: 'Change in Keyboard' }); // the word cut (G47): its name
    expect(change.textContent).toBe('Change');
    fireEvent.click(change);
    expect(scrolled.at(-1)).toBe('settings-keyboard');
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Keyboard' }).getAttribute('aria-current')).toBe('true');
    expect(b.sets).toEqual([]); // the binding is edited where every binding is
  });

  // The owner's ruling (2026-10-06): the toolbar's microphone is the primary control and the hold ships unbound.
  it('the shortcut is unbound by default and says so, points at the microphone, and still offers Change in Keyboard', () => {
    renderView();
    expect(within(row('Shortcut')).getByRole('img', { name: 'Unbound' }).textContent).toBe(''); // the word cut (G40)
    expect(within(row('Shortcut')).getByRole('button', { name: 'Change in Keyboard' })).toBeTruthy();
    expect(describedBy('Shortcut', "Click the microphone in the composer's toolbar to start dictating, and again to stop.")).toBe(row('Shortcut'));
    cleanup();
    renderView({ ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Alt+Space' } });
    expect(within(row('Shortcut')).getByText('⌥Space')).toBeTruthy();
  });

  it('the Language select lists System first, then the locales by name, and writes the choice as one field', async () => {
    renderView();
    await vi.waitFor(() => expect(optionTexts()).toEqual(['System (ko-KR)', 'English (United States)', 'French (France)', 'Korean (South Korea)']));
    expect(language().value).toBe('');
    expect(describedBy('Language', "Recognised on this Mac by Apple's speech recognition. MAWS stores no audio and no transcript.")).toBe(row('Language'));
    fireEvent.change(language(), { target: { value: 'en-US' } });
    await vi.waitFor(() => expect(b.sets).toEqual([{ voice: { locale: 'en-US' } }]));
    expect(language().value).toBe('en-US');
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.status', input: { locale: 'en-US' } })); // re-probed for the choice
    fireEvent.change(language(), { target: { value: '' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ voice: { locale: null } }));
    expect(settings().voice).toEqual({ locale: null });
  });

  it('keeps a saved language the probe does not list, and offers System alone when the helper could not be probed', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, voice: { locale: 'de-DE' } }, null, {
      'voice.status': status({ helper: { state: 'missing', path: VOICE_HELPER }, permission: null, systemLocale: null, supportsOnDevice: null, locales: [] }),
    });
    await vi.waitFor(() => expect(row('Helper').textContent).toContain('Not found'));
    expect(optionTexts()).toEqual(['System', 'German (Germany)']);
    expect(language().value).toBe('de-DE');
  });

  it('a denied microphone shows the denial with a button that opens its System Settings pane', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { 'voice.status': status({ permission: { microphone: 'denied', speech: 'restricted' } }) });
    await vi.waitFor(() => expect(row('Microphone').textContent).toContain('Off for MAWS'));
    expect(row('Speech recognition').textContent).toContain('Off for MAWS and cannot be turned on here');
    fireEvent.click(within(row('Microphone')).getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.openPrivacySettings', input: { pane: 'microphone' } }));
    fireEvent.click(within(row('Speech recognition')).getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.openPrivacySettings', input: { pane: 'speech' } }));
  });

  it('a System Settings pane that fails to open raises a warning toast naming the pane to open by hand', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, {
      'voice.status': status({ permission: { microphone: 'denied', speech: 'denied' } }),
      'voice.openPrivacySettings': () => {
        throw new Error('no handler for x-apple.systempreferences');
      },
    });
    await vi.waitFor(() => expect(row('Microphone').textContent).toContain('Off for MAWS'));
    fireEvent.click(within(row('Speech recognition')).getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(useNotices.getState().notices).toHaveLength(1));
    expect(useNotices.getState().notices[0]).toMatchObject({
      level: 'warning',
      text: 'Could not open System Settings: no handler for x-apple.systempreferences. Open System Settings › Privacy & Security › Speech Recognition by hand.',
    });
  });

  it('granted and not-yet-asked permissions read as such, with no button; a ready helper and an on-device language draw no row', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { 'voice.status': status({ permission: { microphone: 'authorized', speech: 'notDetermined' } }) });
    await vi.waitFor(() => expect(row('Speech recognition').textContent).toBe('Speech recognitionNot asked yet')); // the word cut (G53)
    expect(row('Microphone').textContent).toContain('Allowed');
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull();
    // the word cut (G50, G56): rows drawn only on trouble
    expect(screen.queryByRole('group', { name: 'Recognition' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Helper' })).toBeNull();
    expect(document.body.textContent).not.toContain(VOICE_HELPER);
  });

  it('draws the Helper and Recognition rows while the probe reads, with their words of waiting, and not once it answers ready', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    expect(row('Helper').textContent).toContain('Reading…'); // before the probe's first answer
    expect(row('Recognition').textContent).toContain('Reading…'); // stays (G58)
    await vi.waitFor(() => expect(screen.queryByRole('group', { name: 'Helper' })).toBeNull());
  });

  it('a missing helper shows its path, the exact one its tooltip on a word the keyboard reaches, and how to build it', async () => {
    const exact = '/Users/tester/build/voice-helper/maws-voice-helper';
    renderView(SETTINGS_DEFAULTS_V21, null, {
      'voice.status': status({ helper: { state: 'missing', path: exact }, permission: null, supportsOnDevice: null }),
    });
    const shown = await within(await screen.findByRole('group', { name: 'Helper' })).findByText('~/build/voice-helper/maws-voice-helper');
    expect(shown.tabIndex).toBe(0);
    expect(shown.hasAttribute('title')).toBe(false);
    expect(document.getElementById(shown.getAttribute('aria-describedby')!)!.textContent).toBe(exact);
    expect(row('Helper').textContent).toContain('pnpm build:helper'); // import.meta.env.DEV holds under vitest
    expect(row('Microphone').textContent).toBe('MicrophoneUnknown'); // the word cut (G55)
    expect(row('Recognition').textContent).toBe('RecognitionUnknown');
  });

  it('a language without an on-device model is marked in the select and refused in words', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, voice: { locale: 'fr-FR' } }, null, { 'voice.status': status({ supportsOnDevice: false }) });
    await vi.waitFor(() => expect(row('Recognition').textContent).toContain('No on-device model · download it in System Settings › Keyboard › Dictation'));
    expect(language().selectedOptions[0]!.textContent).toBe('French (France) · no on-device model');
    expect(optionTexts().filter((text) => text!.includes('no on-device model'))).toHaveLength(1);
  });
});
// E9 end

// E4a start: Settings › Browser (E4a execution document, Design §9 and §16; settings version 11): the profile select with
// Default first and the imported profiles by name (a saved one the list lost stays, marked), the search template written
// only when it is an http(s) address with %s, and the link target, each one field of `settings.browser`.
describe('settings view lists Browser', () => {
  const listed = (profileDir: string, name: string) => ({ profileDir, name, gaiaName: null, userName: null, avatar: { kind: 'initials', letter: name[0]! } }); // cua #90
  const profiles = { 'browser.profiles.list': () => ({ profiles: [listed('Profile 2', 'Work'), listed('Default', 'Home')] }) };
  const select = () => within(row('Profile')).getByRole('combobox', { name: 'Profile' }) as HTMLSelectElement;
  const search = () => within(row('Search engine')).getByRole('textbox', { name: 'Search engine' }) as HTMLInputElement;

  it('the Profile select lists Default first, then the imported profiles by name, and writes the choice as one field', async () => {
    renderView(SETTINGS_DEFAULTS_V21, 'browser', profiles);
    expect(row('Profile').textContent).toContain('Applies to tabs opened from now on');
    await vi.waitFor(() => expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([['', 'Default'], ['Default', 'Home'], ['Profile 2', 'Work']]));
    fireEvent.change(select(), { target: { value: 'Profile 2' } });
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { profile: 'Profile 2' } }]));
    expect(settings().browser.profile).toBe('Profile 2');
    fireEvent.change(select(), { target: { value: '' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ browser: { profile: null } }));
  });

  it('a saved profile reads as its directory until the list answers, then, if the list lacks it, as not found', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, browser: { ...SETTINGS_DEFAULTS_V21.browser, profile: 'Profile 9' } }, null, profiles);
    expect([...select().options].map((o) => o.textContent)).toEqual(['Default', 'Profile 9']); // not yet answered
    await vi.waitFor(() => expect(select().options).toHaveLength(4));
    expect(select().value).toBe('Profile 9');
    expect(select().selectedOptions[0]!.textContent).toBe('Profile 9 · not found');
  });

  it('the search template is written on Enter when it holds %s, refused in words otherwise, and Use default puts Google back', async () => {
    const user = userEvent.setup();
    renderView();
    expect(search().value).toBe('https://www.google.com/search?q=%s');
    expect(row('Search engine').textContent).toContain('Use %s for the search text');
    expect(within(row('Search engine')).queryByRole('button', { name: 'Use default' })).toBeNull();
    await user.clear(search());
    await user.type(search(), 'https://duckduckgo.com/?q={Enter}');
    await vi.waitFor(() => expect(search().value).toBe('https://www.google.com/search?q=%s'));
    expect(b.sets).toEqual([]);
    expect(useNotices.getState().notices.map((n) => n.text)).toEqual(['Enter an http or https address with %s where the search text goes']);
    await user.clear(search());
    await user.type(search(), 'https://duckduckgo.com/?q=%s{Enter}');
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { searchUrl: 'https://duckduckgo.com/?q=%s' } }]));
    await user.click(within(row('Search engine')).getByRole('button', { name: 'Use default' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ browser: { searchUrl: 'https://www.google.com/search?q=%s' } }));
    expect(search().value).toBe('https://www.google.com/search?q=%s');
  });

  it('the link target writes its one field', async () => {
    renderView();
    const links = within(row('New-window links')); // the word cut (G67 to G69)
    expect((links.getByRole('radio', { name: 'In MAWS' }) as HTMLInputElement).checked).toBe(true);
    expect(row('New-window links').textContent).not.toContain('such a link opens as a new tab');
    fireEvent.click(links.getByRole('radio', { name: 'System browser' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { linkTarget: 'external' } }]));
    expect(settings().browser.linkTarget).toBe('external');
  });

  // cua #90: settings 12's switch, next to the profile
  it('the Bookmarks bar switch mirrors the setting and writes its one field', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V21, browser: { ...SETTINGS_DEFAULTS_V21.browser, bookmarksBar: 'hidden' } }, 'browser', profiles);
    expect(row('Bookmarks bar').textContent).toContain('⌘⇧B in the browser');
    const toggle = within(row('Bookmarks bar')).getByRole('switch', { name: 'Show the bookmarks bar' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { bookmarksBar: 'shown' } }]));
    await vi.waitFor(() => expect(within(row('Bookmarks bar')).getByRole('switch').getAttribute('aria-checked')).toBe('true'));
  });
});
// E4a end
