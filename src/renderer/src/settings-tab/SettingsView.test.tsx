// The Settings tab (C11 execution document, Interfaces "Settings tab"; M5 pins): five sections over settings v3, every
// row writing exactly its own field through `settings.set` and re-rendering from the settings store.
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V12 } from '@shared/settings/defaults';
import { useGateway } from '../gateway/store';
import { useAttention } from '../stores/attention';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, settingsBridge, VOICE_HELPER, type SettingsBridge } from '../test-support/settings-bridge';
import { SettingsView } from './SettingsView';
// C12 start
import type { AppSessionId } from '@shared/graph/ids';
import { status } from '../../../../test/support/builders';
import { resetBudgetStore, useBudget } from '../budget/store';
import { useSessions } from '../stores/sessions';
// C12 end

let b: SettingsBridge;

function renderView(initial: Settings = SETTINGS_DEFAULTS_V12, section: Parameters<typeof SettingsView>[0]['section'] = null, answers: SettingsBridge['answers'] = {}) {
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

beforeEach(() => {
  useGateway.setState({ relay: null, directLogin: new Map() });
});
afterEach(() => {
  cleanup();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  useAttention.setState({ notificationDelivery: null });
  delete (window as { maws?: MawsBridge }).maws;
  vi.restoreAllMocks();
});

describe('settings tab writes one field per row', () => {
  it('has the seven sections, the index and its footer', () => {
    renderView();
    const index = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(index).getAllByRole('button').map((x) => x.textContent)).toEqual(['Engine', 'Gateway', 'Keyboard', 'Voice', 'Appearance', 'Notifications', 'Browser']); // E9: Voice after Keyboard; E4a: Browser last
    expect(index.textContent).toContain("Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude.");
    for (const name of ['Engine', 'Gateway', 'Keyboard', 'Voice', 'Appearance', 'Notifications', 'Browser']) expect(screen.getByRole('region', { name })).toBeTruthy();
  });

  it('Engine: the binary, the config home, and the subagent model as one field', async () => {
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
    const afterWrite = () => b.calls.slice(b.calls.findLastIndex((c) => c.name === 'settings.set') + 1).map((c) => c.name); // C12
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

  it("Gateway: the direct login the engine last reported, the sign-in command to copy, and the relay's line", async () => {
    renderView();
    expect(within(row('Direct login')).getByText('unknown until a Direct session runs')).toBeTruthy();
    act(() => useGateway.setState({ directLogin: new Map([['app-1' as never, { login: 'Claude Max', email: 'owner@example.test', organization: null }]]) }));
    expect(within(row('Direct login')).getByText("engine's own · Claude Max · owner@example.test")).toBeTruthy();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    fireEvent.click(within(row('Direct login')).getByRole('button', { name: 'Copy' }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith('claude /login'));
    await vi.waitFor(() => expect(within(row('Relay')).getByText(/^Relay listening on 127\.0\.0\.1:8641 · checked just now · 2 ms$/)).toBeTruthy());
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

  it('Notifications: enabled, one kind at a time, sound and no retired near-limit control; held peer messages never notify', async () => {
    renderView();
    const when = row('When a session needs you');
    expect(within(when).queryByText(/^macOS:/)).toBeNull();
    act(() => useAttention.setState({ notificationDelivery: 'fallback' }));
    expect(within(when).getByText('macOS: not delivered · MAWS falls back to a dock bounce and a toast')).toBeTruthy();
    fireEvent.click(within(when).getByRole('switch'));
    await vi.waitFor(() => expect(b.sets).toEqual([{ notifications: { enabled: false } }]));

    const kinds = row('For');
    fireEvent.click(within(kinds).getByRole('checkbox', { name: /^errors/ }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { kinds: { errors: false } } }));
    expect(settings().notifications.kinds).toEqual({ approvals: true, questions: true, planReviews: true, errors: false, heldPeerMessages: false });
    const held = within(kinds).getByRole('checkbox', { name: /^held peer messages/ }) as HTMLInputElement;
    expect(held.disabled).toBe(true);
    expect(kinds.textContent).toContain('Never notifies in this version');
    expect(kinds.textContent).toContain('permission requests, dialogs and MCP elicitations');

    fireEvent.click(within(row('Sound')).getByRole('switch'));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ notifications: { sound: true } }));
    expect(screen.queryByText('Near-limit banner')).toBeNull();
    expect(b.sets).toHaveLength(3);
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
    invoke.mockImplementation(async (name: string, input: unknown) => (name === 'settings.set' ? (refusals++, { ok: false, error: { code: 'internal', message: 'disk full' } }) : real(name, input)));
    const font = within(row('Monospace font')).getByRole('textbox') as HTMLInputElement;
    fireEvent.change(font, { target: { value: 'MesloLGM Nerd Font Mono' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    await vi.waitFor(() => expect(font.value).toBe(''));
    expect(refusals).toBe(1);
    fireEvent.change(font, { target: { value: 'MesloLGM Nerd Font Mono' } });
    fireEvent.keyDown(font, { key: 'Enter' });
    await vi.waitFor(() => expect(refusals).toBe(2));
  });

  it('opens at the section it is given', () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('aria-labelledby') ?? '');
    });
    renderView(SETTINGS_DEFAULTS_V12, 'keyboard');
    expect(scrolled.at(-1)).toMatch(/keyboard/);
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Keyboard' }).getAttribute('aria-current')).toBe('true');
  });

  // W9 (H1): the stacked layout is the `settings` container's (the e2e settings group measures it in a split pane);
  // here, that no row keeps a fixed column or a second-column note once the view is narrower than 32rem.
  it('stacks in a narrow view: every fixed column and second-column note gives way under the settings container', async () => {
    const { container } = renderView();
    await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.287');
    const root = container.firstElementChild!;
    expect(root.classList.contains('@container/settings')).toBe(true);
    const classes = (el: Element) => [...el.classList];
    const fixed = [...root.querySelectorAll('*')].filter((el) => classes(el).some((c) => /^grid-cols-\[.*\d+px/.test(c)));
    // the index beside the body, every Setting row (E10: the Background supervisor group is a group of them, not one), every key binding row
    const rows = screen.getAllByRole('group').filter((g) => !g.querySelector(':scope > h4'));
    expect(fixed.length).toBe(1 + rows.length + screen.getAllByRole('row').filter((r) => r.querySelector('[role="cell"]')).length);
    for (const el of fixed) expect(classes(el).some((c) => c.startsWith('@max-lg/settings:grid-cols-'))).toBe(true);
    for (const el of root.querySelectorAll('.col-start-2')) expect(el.classList.contains('@max-lg/settings:col-start-1')).toBe(true);
    // label, control, note in reading order, so one column reads label over control over note
    const binary = row('Binary');
    expect([...binary.children].map((c) => c.textContent)).toEqual(['Binary', expect.stringContaining('Change…'), expect.stringContaining('New sessions start on your installed Claude Code')]); // W13's note
    expect(screen.getByRole('navigation', { name: 'Settings sections' }).classList.contains('@max-lg/settings:flex-row')).toBe(true);
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
    expect(row('Limit').textContent).toContain('Default · 25% of physical memory (8 GB)');
    fireEvent.change(field, { target: { value: '6.5' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { memoryBudgetMiB: 6656 } }]));
    await vi.waitFor(() => expect(field.value).toBe('6.5'));
    fireEvent.click(within(row('Limit')).getByRole('button', { name: 'Use default' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { memoryBudgetMiB: null } }));
    expect(settings().engine.memoryBudgetMiB).toBeNull();
  });

  it('Memory budget: a value below 0.5 GB or not a number is refused in words and the field goes back', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V12, engine: { ...SETTINGS_DEFAULTS_V12.engine, memoryBudgetMiB: 6144 } });
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
    renderView({ ...SETTINGS_DEFAULTS_V12, engine: { ...SETTINGS_DEFAULTS_V12.engine, memoryBudgetMiB: 6144 } });
    const toggle = within(row('Memory budget')).getByRole('switch', { name: 'Release idle sessions to stay under a memory limit' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(row('Limit')).toBeTruthy();
    expect(row('Stateful MCP servers')).toBeTruthy();
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { memoryBudget: { enabled: false } } }]));
    await vi.waitFor(() => expect(toggle.getAttribute('aria-checked')).toBe('false'));
    expect(screen.queryByRole('group', { name: 'Limit' })).toBeNull();
    expect(screen.queryByRole('group', { name: 'Stateful MCP servers' })).toBeNull();
    expect(row('Memory budget').textContent).toContain('Off · engine processes never exit on their own');
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
    renderView({ ...SETTINGS_DEFAULTS_V12, keymap: { 'composer.dictate': 'Cmd+D' } });
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
    expect(row('Shortcut').textContent).toContain("Click the microphone in the composer's toolbar to start dictating and again to stop.");
    cleanup();
    renderView({ ...SETTINGS_DEFAULTS_V12, keymap: { 'composer.dictate': 'Alt+Space' } });
    expect(within(row('Shortcut')).getByText('⌥Space')).toBeTruthy();
  });

  it('the Language select lists System first, then the locales by name, and writes the choice as one field', async () => {
    renderView();
    await vi.waitFor(() => expect(optionTexts()).toEqual(['System (ko-KR)', 'English (United States)', 'French (France)', 'Korean (South Korea)']));
    expect(language().value).toBe('');
    expect(row('Language').textContent).toContain("Dictation runs on this Mac through Apple's speech recognition; MAWS stores no audio and no transcript.");
    fireEvent.change(language(), { target: { value: 'en-US' } });
    await vi.waitFor(() => expect(b.sets).toEqual([{ voice: { locale: 'en-US' } }]));
    expect(language().value).toBe('en-US');
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.status', input: { locale: 'en-US' } })); // re-probed for the choice
    fireEvent.change(language(), { target: { value: '' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ voice: { locale: null } }));
    expect(settings().voice).toEqual({ locale: null });
  });

  it('keeps a saved language the probe does not list, and offers System alone when the helper could not be probed', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V12, voice: { locale: 'de-DE' } }, null, {
      'voice.status': status({ helper: { state: 'missing', path: VOICE_HELPER }, permission: null, systemLocale: null, supportsOnDevice: null, locales: [] }),
    });
    await vi.waitFor(() => expect(row('Helper').textContent).toContain('Not found'));
    expect(optionTexts()).toEqual(['System', 'German (Germany)']);
    expect(language().value).toBe('de-DE');
  });

  it('a denied microphone shows the denial with a button that opens its System Settings pane', async () => {
    renderView(SETTINGS_DEFAULTS_V12, null, { 'voice.status': status({ permission: { microphone: 'denied', speech: 'restricted' } }) });
    await vi.waitFor(() => expect(row('Microphone').textContent).toContain('Off for MAWS'));
    expect(row('Speech recognition').textContent).toContain('Off for MAWS and cannot be turned on here');
    fireEvent.click(within(row('Microphone')).getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.openPrivacySettings', input: { pane: 'microphone' } }));
    fireEvent.click(within(row('Speech recognition')).getByRole('button', { name: 'Open System Settings' }));
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'voice.openPrivacySettings', input: { pane: 'speech' } }));
  });

  it('a System Settings pane that fails to open raises a warning toast naming the pane to open by hand', async () => {
    renderView(SETTINGS_DEFAULTS_V12, null, {
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
    renderView(SETTINGS_DEFAULTS_V12, null, { 'voice.status': status({ permission: { microphone: 'authorized', speech: 'notDetermined' } }) });
    await vi.waitFor(() => expect(row('Speech recognition').textContent).toContain('Not asked yet · macOS asks the first time you dictate'));
    expect(row('Microphone').textContent).toContain('Allowed');
    expect(screen.queryByRole('button', { name: 'Open System Settings' })).toBeNull();
    expect(row('Recognition').textContent).toContain('On this Mac');
    expect(row('Helper').textContent).toContain(VOICE_HELPER);
  });

  it('a missing helper shows its path and how to build it', async () => {
    renderView(SETTINGS_DEFAULTS_V12, null, {
      'voice.status': status({ helper: { state: 'missing', path: '/repo/build/voice-helper/maws-voice-helper' }, permission: null, supportsOnDevice: null }),
    });
    await vi.waitFor(() => expect(row('Helper').textContent).toContain('/repo/build/voice-helper/maws-voice-helper'));
    expect(row('Helper').textContent).toContain('pnpm build:helper'); // import.meta.env.DEV holds under vitest
    expect(row('Microphone').textContent).toContain('Unknown until the helper answers');
  });

  it('a language without an on-device model is marked in the select and refused in words', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V12, voice: { locale: 'fr-FR' } }, null, { 'voice.status': status({ supportsOnDevice: false }) });
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
  const profiles = { 'browser.profiles.list': () => ({ profiles: [{ profileDir: 'Profile 2', name: 'Work' }, { profileDir: 'Default', name: 'Home' }] }) };
  const select = () => within(row('Profile')).getByRole('combobox', { name: 'Profile' }) as HTMLSelectElement;
  const search = () => within(row('Search engine')).getByRole('textbox', { name: 'Search engine' }) as HTMLInputElement;

  it('the Profile select lists Default first, then the imported profiles by name, and writes the choice as one field', async () => {
    renderView(SETTINGS_DEFAULTS_V12, 'browser', profiles);
    expect(row('Profile').textContent).toContain('Applies to tabs opened from now on');
    await vi.waitFor(() => expect([...select().options].map((o) => [o.value, o.textContent])).toEqual([['', 'Default'], ['Default', 'Home'], ['Profile 2', 'Work']]));
    fireEvent.change(select(), { target: { value: 'Profile 2' } });
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { profile: 'Profile 2' } }]));
    expect(settings().browser.profile).toBe('Profile 2');
    fireEvent.change(select(), { target: { value: '' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ browser: { profile: null } }));
  });

  it('a saved profile reads as its directory until the list answers, then, if the list lacks it, as not found', async () => {
    renderView({ ...SETTINGS_DEFAULTS_V12, browser: { ...SETTINGS_DEFAULTS_V12.browser, profile: 'Profile 9' } }, null, profiles);
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
    renderView({ ...SETTINGS_DEFAULTS_V12, browser: { ...SETTINGS_DEFAULTS_V12.browser, bookmarksBar: 'hidden' } }, 'browser', profiles);
    expect(row('Bookmarks bar').textContent).toContain('⌘⇧B in the browser');
    const toggle = within(row('Bookmarks bar')).getByRole('switch', { name: 'Show the bookmarks bar' });
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(toggle);
    await vi.waitFor(() => expect(b.sets).toEqual([{ browser: { bookmarksBar: 'shown' } }]));
    await vi.waitFor(() => expect(within(row('Bookmarks bar')).getByRole('switch').getAttribute('aria-checked')).toBe('true'));
  });
});
// E4a end
