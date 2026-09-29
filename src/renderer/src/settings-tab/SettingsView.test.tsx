// The Settings tab (C11 execution document, Interfaces "Settings tab"; M5 pins): five sections over settings v3, every
// row writing exactly its own field through `settings.set` and re-rendering from the settings store.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge, Settings } from '@shared/ipc/schema';
import { SETTINGS_DEFAULTS_V3 } from '@shared/settings/defaults';
import { useGateway } from '../gateway/store';
import { useAttention } from '../stores/attention';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { BINARY, settingsBridge, type SettingsBridge } from '../test-support/settings-bridge';
import { SettingsView } from './SettingsView';

let b: SettingsBridge;

function renderView(initial: Settings = SETTINGS_DEFAULTS_V3, section: Parameters<typeof SettingsView>[0]['section'] = null) {
  b = settingsBridge(initial);
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
  useGateway.setState({ relay: null, relayCheckedAt: null, directLogin: new Map() });
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
  it('has the five sections, the index and its footer', () => {
    renderView();
    const index = screen.getByRole('navigation', { name: 'Settings sections' });
    expect(within(index).getAllByRole('button').map((x) => x.textContent)).toEqual(['Engine', 'Gateway', 'Keyboard', 'Appearance', 'Notifications']);
    expect(index.textContent).toContain("Stored in MAWS's own Application Support folder. Nothing here writes into ~/.claude.");
    for (const name of ['Engine', 'Gateway', 'Keyboard', 'Appearance', 'Notifications']) expect(screen.getByRole('region', { name })).toBeTruthy();
  });

  it('Engine: the binary, the pin that matches it, the config home, and the subagent model as one field', async () => {
    renderView();
    expect(await within(row('Binary')).findByText('~/.local/share/claude/versions/2.1.283')).toBeTruthy();
    expect(within(row('Pinned version')).getByText('matches binary')).toBeTruthy();
    expect((within(row('Pinned version')).getByRole('button', { name: 'Re-pin…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(await within(row('Config home')).findByText('~/.claude')).toBeTruthy();
    expect(within(row('Config home')).getByText('read-only to MAWS')).toBeTruthy();

    const field = within(row('Subagent model')).getByRole('combobox') as HTMLInputElement;
    expect(field.placeholder).toBe('engine default');
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

  it('Engine: Change… stores the picked absolute path and configures the host; a mismatch says sessions will refuse', async () => {
    renderView();
    b.answers['layout.pickFiles'] = () => ({ files: [{ path: '/opt/claude/2.1.290/claude', name: 'claude', bytes: 10, mediaType: null, data: null }] });
    b.answers['engine.configure'] = (input) => ({ ...BINARY, path: (input as { binaryPath: string }).binaryPath, version: '2.1.290', ok: false, error: 'binary reports 2.1.290, expected 2.1.283' });
    fireEvent.click(await within(row('Binary')).findByRole('button', { name: 'Change…' }));
    await vi.waitFor(() => expect(b.sets).toEqual([{ engine: { binaryPath: '/opt/claude/2.1.290/claude' } }]));
    expect(b.calls.find((c) => c.name === 'layout.pickFiles')!.input).toEqual({ kind: 'files', directory: null, multiple: false });
    await vi.waitFor(() => expect(b.calls).toContainEqual({ name: 'engine.configure', input: { binaryPath: '/opt/claude/2.1.290/claude', expectedVersion: '2.1.283' } }));
    expect(await within(row('Binary')).findByText('/opt/claude/2.1.290/claude')).toBeTruthy();
    expect(within(row('Binary')).getByText('does not match the pinned version · sessions will refuse to start until you re-pin')).toBeTruthy();
    expect(within(row('Pinned version')).getByText('binary reports 2.1.290')).toBeTruthy();

    // Re-pin… names both versions and the re-probe rule, then moves the pin alone
    fireEvent.click(within(row('Pinned version')).getByRole('button', { name: 'Re-pin…' }));
    const sheet = await screen.findByRole('dialog', { name: 'Re-pin the engine to 2.1.290?' });
    expect(sheet.textContent).toContain('The pin moves from 2.1.283 to 2.1.290');
    expect(sheet.textContent).toContain('Upgrading the engine is a deliberate re-probe: the fixtures and conformance tests were recorded on 2.1.283.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Re-pin to 2.1.290' }));
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ engine: { pinnedVersion: '2.1.290' } }));
    await vi.waitFor(() => expect(b.calls.at(-1)).toEqual({ name: 'engine.configure', input: { binaryPath: '/opt/claude/2.1.290/claude', expectedVersion: '2.1.290' } }));

    // Use default puts the binary path back to C3's default
    fireEvent.click(within(row('Binary')).getByRole('button', { name: 'Use default' }));
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

  it('Notifications: enabled, one kind at a time, sound and the near-limit threshold; held peer messages never notify', async () => {
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
    const threshold = within(row('Near-limit banner')).getByRole('combobox') as HTMLSelectElement;
    expect([...threshold.options].map((o) => o.value)).toEqual(['80', '85', '90', '95']);
    fireEvent.change(threshold, { target: { value: '85' } });
    await vi.waitFor(() => expect(b.sets.at(-1)).toEqual({ usage: { nearLimitPercent: 85 } }));
    expect(b.sets).toHaveLength(4);
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

  it('opens at the section it is given', () => {
    const scrolled: string[] = [];
    vi.spyOn(HTMLElement.prototype, 'scrollIntoView').mockImplementation(function (this: HTMLElement) {
      scrolled.push(this.getAttribute('aria-labelledby') ?? '');
    });
    renderView(SETTINGS_DEFAULTS_V3, 'keyboard');
    expect(scrolled.at(-1)).toMatch(/keyboard/);
    expect(within(screen.getByRole('navigation', { name: 'Settings sections' })).getByRole('button', { name: 'Keyboard' }).getAttribute('aria-current')).toBe('true');
  });
});
