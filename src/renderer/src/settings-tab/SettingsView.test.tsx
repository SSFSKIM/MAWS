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
const more = (of: HTMLElement) => within(of).getByRole('button', { name: /^(More|Less)$/ });
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
  it('groups the index under App and Sessions & engine, Org and Customize after them, the footer kept; the body in the same order', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    expect(within(index()).getAllByRole('button').map((x) => x.textContent)).toEqual([...ORDER, 'Customize ›']);
    // the headings stand before their sections, and nothing heads Org
    expect([...index().querySelectorAll('[data-settings-group], button')].map((el) => el.textContent)).toEqual(['App', ...ORDER.slice(0, 6), 'Sessions & engine', ...ORDER.slice(6, 11), 'Org', 'Customize ›']);
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
  it('each section holds the rows of the table, in its order; Engine holds Binary, Update and Config home, and the Plugins paragraph is gone', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287');
    expect(labelsIn(region('Appearance'))).toEqual(['Theme', 'Transcript width', 'Monospace font']);
    expect(labelsIn(region('Notifications'))).toEqual(['Messages to you', 'When a session finishes or needs you', 'For', 'Sound']);
    expect(within(region('Keyboard')).getByRole('table', { name: 'Key bindings' })).toBeTruthy();
    expect(within(region('Keyboard')).getByRole('button', { name: 'Reset to defaults' })).toBeTruthy();
    expect(labelsIn(region('Voice'))).toEqual(['Shortcut', 'Language', 'Helper', 'Microphone', 'Speech recognition', 'Recognition']);
    expect(labelsIn(region('Browser'))).toEqual(['Profile', 'Bookmarks bar', 'Search engine', 'Links that open a new window', 'Chrome profile']);
    expect(labelsIn(region('Artifacts'))).toEqual(['Export author name', 'Default design system', 'By Space']);
    expect(labelsIn(region('Sessions'))).toEqual(['Plugins in sessions', 'Hooks in sessions', 'MCP servers', 'Subagent model', 'When auto mode is unavailable', 'Archive sessions inactive for']);
    expect(labelsIn(region('Gateway'))).toEqual(['Default route', 'Relay unreachable at launch', 'Per-session Direct', 'Direct login', 'Relay']);
    expect(labelsIn(region('Engine'))).toEqual(['Binary', 'Update', 'Config home']);
    expect(labelsIn(region('Supervisor'))).toEqual(['Status', 'Machine daemon', 'Exit when idle', 'Stop all', 'Memory budget', 'Limit', 'Stateful MCP servers']);
    expect(within(region('Supervisor')).getByRole('group', { name: 'Background supervisor' })).toBeTruthy(); // its rows keep their group, named
    expect(within(region('Supervisor')).queryByRole('heading', { name: 'Background supervisor' })).toBeNull(); // the section's heading stands in its place
    expect(screen.queryByRole('group', { name: 'Plugins' })).toBeNull();
    expect(document.body.textContent).not.toContain('Plugin hooks run in MAWS sessions');
    expect(document.body.textContent).not.toContain('MAWS reads them and keeps its own index elsewhere'); // the chip says it
  });

  it('says once under the Sessions heading what every one of its rows would otherwise repeat', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const sessions = region('Sessions');
    const line = within(sessions).getByText('For sessions MAWS runs. Terminal sessions and your Claude Code settings files are not changed.');
    expect(line.closest('h3')).toBeNull(); // under the heading, not in it
    expect(screen.getByRole('heading', { name: 'Sessions' })).toBeTruthy();
    for (const label of labelsIn(sessions)) expect(row(label!).textContent).not.toMatch(/terminal session|settings files are never changed/i);
  });

  // U11a M9 (A6): a note is one line; More opens the rest in place, under it, and Less closes it again
  it('a note is one line, and More opens the rest in place and closes it; a closed More is not in the page', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const update = row('Update');
    const button = more(update);
    expect(button.textContent).toBe('More');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(update.querySelector('[data-settings-note]')!.textContent).toBe('Runs claude update in a terminal tab.More');
    expect(update.textContent).not.toContain('New sessions start on the new version');
    fireEvent.click(button);
    expect(button.textContent).toBe('Less');
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(within(update).getByText('New sessions start on the new version; running sessions keep theirs.').closest('[data-settings-note]')).toBe(update.querySelector('[data-settings-note]'));
    fireEvent.click(button);
    expect(button.textContent).toBe('More');
    expect(update.textContent).not.toContain('New sessions start on the new version');
    expect(b.sets).toEqual([]);
  });

  it('a state line stays whole: the supervisor waiting on an older version says all of it, with no More', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { ...ANSWERED, 'host.status': () => waitingStatus(2) });
    const status = row('Status');
    await vi.waitFor(() => expect(status.querySelector('[data-settings-note="state"]')).not.toBeNull());
    expect(status.querySelector('[data-settings-note="state"]')!.textContent).toBe("This version of MAWS cannot use it. Restart now stops those sessions and starts this version's supervisor; Send resumes each from its transcript.");
    expect(within(status).queryByRole('button', { name: 'More' })).toBeNull();
  });

  it('Direct login keeps its sign-in instruction and its Copy on the row’s line, before More', () => {
    renderView(SETTINGS_DEFAULTS_V21, null, ANSWERED);
    const note = row('Direct login').querySelector('[data-settings-note]')! as HTMLElement;
    expect(note.textContent).toBe('Only Direct sessions use it. Sign in: run claude /login in a terminalCopyMore');
    expect(within(note).getAllByRole('button').map((x) => x.textContent)).toEqual(['Copy', 'More']);
    fireEvent.click(more(note));
    expect(note.textContent).toContain("MAWS never stores a token; ClaudeUsage holds the relay's accounts.");
  });

  it('copy outside Settings names the MCP servers row where it now is', () => {
    expect(SEND_TO_COPY.notionNotFound).toContain(`Settings › ${SECTIONS.sessions} › ${MCP_SERVERS.label}`);
    expect(SEND_TO_COPY.notionNoSession).not.toContain('Settings › Engine');
  });

  it('opens the Customize page from the index, closing the Settings dialog, without changing settings', () => {
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: { section: null } });
    renderView();
    fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
    expect(useLayout.getState().destination).toEqual({ kind: 'customize', view: 'mine', show: 'plugins' }); // UX wave U7b: a page, no tab
    expect(useLayout.getState().settings).toBeNull();
    expect(useLayout.getState().main).toBe(LAYOUT_DEFAULTS.main);
    expect(b.sets).toEqual([]);
    useLayout.setState({ main: LAYOUT_DEFAULTS.main, destination: null, settings: null });
  });

  it('Engine and Sessions: the binary, the config home, and the subagent model as one field', async () => {
    renderView();
    expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287')).toBeTruthy(); // W13: the installed binary, no pin
    expect(await within(row('Config home')).findByText('~/.claude')).toBeTruthy();
    expect(within(row('Config home')).getByText('read-only to MAWS')).toBeTruthy();

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
    expect(await within(row('Binary')).findByText('/opt/claude/2.1.290/claude')).toBeTruthy();
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

    const policy = within(row('Relay unreachable at launch')).getByRole('combobox') as HTMLSelectElement;
    expect([...policy.options].map((o) => o.textContent)).toEqual(['Ask each time', 'Wait for the relay', 'Run direct']);
    fireEvent.change(policy, { target: { value: 'wait' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ gateway: { relayUnreachable: 'wait' } }));

    const offer = within(row('Per-session Direct')).getByRole('switch');
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
    fireEvent.click(more(row('Default route'))); // U11a M9: the machine route's sentence is behind More
    expect(row('Default route').textContent).toContain('the machine’s own settings, environment and login decide');
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
    expect(within(row('Direct login')).getByText('unknown until a Direct session runs')).toBeTruthy();
    act(() => useGateway.setState({ directLogin: new Map([['app-1' as never, { login: 'Claude Max', email: 'owner@example.test', organization: null }]]) }));
    expect(within(row('Direct login')).getByText("engine's own · Claude Max · owner@example.test")).toBeTruthy();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(row('Direct login')).getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('claude /login'));
    await vi.waitFor(() => expect(within(row('Relay')).getByText(`Relay listening on 127.0.0.1:8641 · checked ${REL.now} · 2 ms`)).toBeTruthy());
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
    const select = screen.getByRole('combobox', { name: 'Archive sessions inactive for' });
    expect((select as HTMLSelectElement).value).toBe('never');
    await userEvent.selectOptions(select, '14');
    expect(settings().sessions.archiveInactiveDays).toBe(14);
    await userEvent.selectOptions(select, 'never');
    expect(settings().sessions.archiveInactiveDays).toBeNull();
  });

  it('Notifications: enabled, one kind at a time, sound and no retired near-limit control; held peer messages never notify', async () => {
    renderView();
    const when = row('When a session finishes or needs you');
    expect(within(when).queryByText(/^macOS:/)).toBeNull();
    act(() => useAttention.setState({ notificationDelivery: 'fallback' }));
    expect(within(when).getByText('macOS: not delivered · MAWS falls back to a dock bounce and a toast')).toBeTruthy();
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
    const held = within(kinds).getByRole('checkbox', { name: /^held peer messages/ }) as HTMLInputElement;
    expect(held.disabled).toBe(true);
    expect(kinds.textContent).toContain('Never notifies in this version');
    expect(kinds.textContent).toContain('permission requests, dialogs and MCP elicitations');

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
    expect(mod.textContent).toContain('Agents message you and ask questions you answer in place; a session reads as their report.');
    fireEvent.click(more(mod)); // U11a M9: the rest is behind More
    expect(mod.textContent).toContain('the next time each session starts');
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ mods: { toHuman: { enabled: false } } }));

    const kinds = row('For');
    expect(within(kinds).getAllByRole('checkbox').map((box) => box.closest('label')!.textContent)).toEqual([
      'Turn finished', 'approvals· permission requests, dialogs and MCP elicitations', 'questions', 'plan reviews', 'errors', 'questions an agent left for you', 'must-read messages', 'held peer messages· Never notifies in this version',
    ]);
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
    await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287');
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
    // below the index's break its row of links drops the group headings and keeps the order
    for (const heading of index().querySelectorAll('[data-settings-group]')) expect(heading.classList.contains('@max-lg/settings:hidden')).toBe(true);
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
    expect(row('Limit').textContent).toContain('Default: 25% of physical memory (8 GB).');
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
    const toggle = within(row('Memory budget')).getByRole('switch', { name: 'Release idle sessions to stay under a memory limit' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(row('Limit')).toBeTruthy();
    expect(row('Stateful MCP servers')).toBeTruthy();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { memoryBudget: { enabled: false } } }]));
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('group', { name: 'Limit' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Stateful MCP servers' })).toBeNull();
    expect(row('Memory budget').textContent).toContain('Off: an engine process ends only on archive, quit or stop.');
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
    fireEvent.click(within(row('Shortcut')).getByRole('button', { name: 'Change in Keyboard' }));
    expect(scrolled.at(-1)).toBe('settings-keyboard');
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Keyboard' }).getAttribute('aria-current')).toBe('true');
    expect(b.sets).toEqual([]); // the binding is edited where every binding is
  });

  // The owner's ruling (2026-10-06): the toolbar's microphone is the primary control and the hold ships unbound.
  it('the shortcut is unbound by default and says so, points at the microphone, and still offers Change in Keyboard', () => {
    renderView();
    expect(within(row('Shortcut')).getByText('Unbound')).toBeTruthy();
    expect(within(row('Shortcut')).getByRole('button', { name: 'Change in Keyboard' })).toBeTruthy();
    expect(row('Shortcut').textContent).toContain("Click the microphone in the composer's toolbar to start dictating, and again to stop.");
    cleanup();
    renderView({ ...SETTINGS_DEFAULTS_V21, keymap: { 'composer.dictate': 'Alt+Space' } });
    expect(within(row('Shortcut')).getByText('⌥Space')).toBeTruthy();
  });

  it('the Language select lists System first, then the locales by name, and writes the choice as one field', async () => {
    renderView();
    await vi.waitFor(() => expect(optionTexts()).toEqual(['System (ko-KR)', 'English (United States)', 'French (France)', 'Korean (South Korea)']));
    expect(language().value).toBe('');
    expect(row('Language').textContent).toContain("Recognised on this Mac by Apple's speech recognition.");
    fireEvent.click(more(row('Language')));
    expect(row('Language').textContent).toContain('MAWS stores no audio and no transcript.');
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

  it('granted and not-yet-asked permissions read as such, with no button, and an on-device language says so', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, { 'voice.status': status({ permission: { microphone: 'authorized', speech: 'notDetermined' } }) });
    await vi.waitFor(() => expect(row('Speech recognition').textContent).toContain('Not asked yet · macOS asks the first time you dictate'));
    expect(row('Microphone').textContent).toContain('Allowed');
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull();
    expect(row('Recognition').textContent).toContain('On this Mac');
    expect(row('Helper').textContent).toContain(VOICE_HELPER);
  });

  it('a missing helper shows its path and how to build it', async () => {
    renderView(SETTINGS_DEFAULTS_V21, null, {
      'voice.status': status({ helper: { state: 'missing', path: '/repo/build/voice-helper/maws-voice-helper' }, permission: null, supportsOnDevice: null }),
    });
    await vi.waitFor(() => expect(row('Helper').textContent).toContain('/repo/build/voice-helper/maws-voice-helper'));
    expect(row('Helper').textContent).toContain('pnpm build:helper'); // import.meta.env.DEV holds under vitest
    expect(row('Microphone').textContent).toContain('Unknown until the helper answers');
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
    const links = within(row('Links that open a new window'));
    expect((links.getByRole('radio', { name: 'In MAWS' }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(links.getByRole('radio', { name: 'In the system browser' }));
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
