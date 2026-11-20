// The word cut in Settings (docs/doperpowers/specs/2026-11-16-word-cut-design.md, rule 5 and Acceptance 4; the rows
// G13 to G15, G27, G30, G33, G40, G76, G109, G126, G127, G129): a row is its label and its control at rest. Its note opens
// in the row on pointing or on keyboard focus and is its accessible description at all times, with no More and no Less;
// a line that states a condition, or that the owner kept at rest, stays. A fact sent to a tooltip has an owner the
// keyboard reaches, and the keyboard alone shows it.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge, Settings } from '@shared/ipc/schema';
import { machineSettingsDefaults, SETTINGS_DEFAULTS_V21 } from '@shared/settings/defaults';
import { useGateway } from '../gateway/store';
import { useAttention } from '../stores/attention';
import { useHosts } from '../stores/hosts';
import { useNotices } from '../stores/notices';
import { useSettings } from '../stores/settings';
import { accessibleText } from '../test-support/accessible-text';
import { daemonStatus, supervisorStatus } from '../test-support/host-status';
import { settingsBridge } from '../test-support/settings-bridge';
import { importBridge, RECORD } from '../test-support/browser-import';
import { connectBrowserImport, resetBrowserImport } from '../tools/browser/import/store';
import { SettingsView } from './SettingsView';

const ANSWERED = { 'machineSettings.get': () => ({ settings: machineSettingsDefaults(), version: 1 }) };
const RUNNING = () => ({
  transport: 'daemon',
  state: 'ready',
  supervisor: supervisorStatus(),
  appBuildId: 'b',
  appWire: 'w',
  mainBuild: { version: '0.0.0', commit: 'ac8724a6', builtAt: '2026-10-08T09:05:53.000Z' },
  matches: true,
  reason: null,
  waitingLiveSessions: null,
  lastExit: null,
  daemon: daemonStatus(),
  daemonUnavailable: null,
});

let disconnect = () => {};
function renderView(answers: Record<string, (input: unknown) => unknown> = {}, initial: Settings = SETTINGS_DEFAULTS_V21) {
  const b = settingsBridge(initial);
  Object.assign(b.answers, ANSWERED, answers);
  window.maws = b.bridge;
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SettingsView section={null} />
    </QueryClientProvider>,
  );
  return b;
}
afterEach(() => {
  cleanup();
  disconnect();
  disconnect = () => {};
  resetBrowserImport();
  useSettings.setState({ state: null });
  useNotices.setState({ notices: [] });
  useAttention.setState({ notificationDelivery: null });
  useGateway.setState({ relay: null, directLogin: new Map() });
  useHosts.setState({ supervisor: null, hosts: { engine: null, pty: null } });
  delete (window as { maws?: PreloadBridge }).maws;
});

const row = (label: string) => screen.getByRole('group', { name: label });
const body = () => document.querySelector<HTMLElement>('[data-settings-body]')!;
const tooltip = () => screen.getByRole('tooltip').textContent;
// Keyboard alone: the control before `owner` takes focus, then Tab moves to it.
async function tabTo(from: HTMLElement, owner: HTMLElement) {
  act(() => from.focus());
  await userEvent.setup().tab();
  expect(document.activeElement).toBe(owner);
}

describe('a row’s note opens in the row, for the pointer and the keyboard (G13 to G15)', () => {
  it('no row has More or Less; a plain note is out of the resting text and is the row’s description, both sentences', () => {
    renderView();
    expect(within(body()).queryByRole('button', { name: /^(More|Less)$/ })).toBeNull();
    const archive = row('Archive after');
    expect(accessibleText(archive)).not.toContain('Archived sessions can be restored from the sidebar.');
    expect(screen.getByRole('group', { name: 'Archive after', description: 'Archived sessions can be restored from the sidebar. Pinned, live, waiting and background-running sessions stay, as do worktrees with uncommitted changes.' })).toBe(archive);
  });

  it('opens on keyboard focus alone, at once, in the row itself', async () => {
    renderView();
    const archive = row('Archive after');
    await tabTo(within(row('When auto mode is unavailable')).getByRole('combobox'), within(archive).getByRole('combobox', { name: 'Archive after' }));
    expect(accessibleText(archive)).toContain('Archived sessions can be restored from the sidebar.');
    expect(archive.querySelector('[data-row-note]')!.hasAttribute('data-open')).toBe(true);
  });

  it('keeps a line the owner kept at rest, and only the rest waits in the note (Hooks)', () => {
    renderView();
    const hooks = row('Hooks in sessions');
    expect(accessibleText(hooks)).toContain("None turns off every hook in the sessions MAWS runs, the to-human plugin's included.");
    expect(accessibleText(hooks)).not.toContain('Hooks come from your settings');
    expect(screen.getByRole('group', { name: 'Hooks in sessions', description: /^Hooks come from your settings and your plugins\./ })).toBe(hooks);
  });

  it('Messages to you holds both its sentences in its note, its switch alone at rest (G26, G27)', () => {
    renderView();
    const mod = row('Messages to you');
    expect(accessibleText(mod)).toBe('Messages to you');
    expect(within(mod).getByRole('switch', { name: 'To-human' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Messages to you', description: 'Agents message you and ask questions you answer in place; a session reads as their report. The view follows at once; the instructions, the next time each session starts.' })).toBe(mod);
  });
});

describe('a fact sent to a tooltip has an owner the keyboard reaches', () => {
  it('Blocked in macOS says why on focus (G30)', async () => {
    renderView();
    act(() => useAttention.setState({ notificationDelivery: 'fallback' }));
    const notify = row('Notify me');
    const chip = within(notify).getByText('Blocked in macOS');
    await tabTo(within(notify).getByRole('switch'), chip);
    expect(tooltip()).toBe('MAWS falls back to a dock bounce and a toast');
    expect(accessibleText(notify)).not.toContain('dock bounce');
  });

  it('approvals carries its caption as its tooltip and its description (G33)', async () => {
    renderView();
    const kinds = row('For');
    const approvals = within(kinds).getByRole('checkbox', { name: 'approvals', description: 'permission requests, dialogs and MCP elicitations' });
    expect(accessibleText(kinds)).not.toContain('permission requests');
    await tabTo(within(kinds).getByRole('checkbox', { name: 'Turn finished' }), approvals);
    expect(tooltip()).toBe('permission requests, dialogs and MCP elicitations');
  });

  it('the Relay row reads its address, and when it was checked is the address’s tooltip (G109)', async () => {
    renderView();
    const relay = row('Relay');
    const address = await within(relay).findByText('127.0.0.1:8641');
    expect(accessibleText(relay)).not.toContain('checked');
    act(() => address.focus());
    expect(tooltip()).toMatch(/^checked .+ · 2 ms$/);
  });

  it('Update… sits on the Binary row, named in full, and says what it does on focus (G126, G127)', async () => {
    renderView();
    const update = await within(row('Binary')).findByRole('button', { name: 'Update Claude Code…' });
    expect(update.textContent).toBe('Update…');
    await tabTo(within(row('Binary')).getByRole('button', { name: 'Change…' }), update);
    expect(tooltip()).toBe('Runs claude update in a terminal tab. New sessions start on the new version; running sessions keep theirs.');
  });

  it('the Binary row’s path is its version’s tooltip and is in its note, with the config home (G125, G128)', async () => {
    renderView();
    const binary = row('Binary');
    const version = await within(binary).findByText('2.1.287');
    expect(accessibleText(binary)).not.toContain('~/.local/share/claude/versions/2.1.287');
    expect(screen.queryByRole('group', { name: 'Config home' })).toBeNull();
    await vi.waitFor(() => expect(screen.getByRole('group', { name: 'Binary', description: /~\/\.local\/share\/claude\/versions\/2\.1\.287 Config home · ~\/\.claude · read-only to MAWS/ })).toBe(binary));
    act(() => version.closest<HTMLElement>('[tabindex="0"]')!.focus());
    expect(tooltip()).toBe('~/.local/share/claude/versions/2.1.287');
  });

  it('Status reads its state and its sessions; when, which process and when it exits are its tooltip, with the daemon (G129, G133)', async () => {
    renderView({ 'host.status': RUNNING });
    const status = row('Status');
    const line = await within(status).findByText('Running · 3 sessions');
    expect(screen.queryByRole('group', { name: 'Machine daemon' })).toBeNull(); // connected: its line is in the tooltip
    act(() => line.focus());
    expect(tooltip()).toContain('Since 14:02 · pid 48213 · exits 10 min after the last session ends');
    expect(tooltip()).toContain('Machine daemon · This profile only · pid 4100 · machine mRef0123456789abcdefAB');
  });

  it('an unbound key cap is empty, named and tipped Unbound, in Keyboard and on Voice’s Shortcut (G40)', async () => {
    renderView();
    const caps = within(screen.getByRole('table', { name: 'Key bindings' })).getAllByRole('img', { name: 'Unbound' });
    expect(caps.length).toBeGreaterThan(0);
    for (const cap of caps) expect(cap.textContent).toBe('');
    const voice = within(row('Shortcut')).getByRole('img', { name: 'Unbound' });
    act(() => voice.focus());
    expect(tooltip()).toBe('Unbound');
  });

  it('the extensions’ popup limit is an ⓘ beside their heading, named and tipped by the sentence (G76)', async () => {
    const b = importBridge(SETTINGS_DEFAULTS_V21);
    Object.assign(b.answers, ANSWERED, { 'browser.import.list': () => ({ profiles: [RECORD], fileBroken: false, running: null }) });
    window.maws = b.bridge;
    const queries = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    disconnect = connectBrowserImport(undefined, queries);
    render(
      <QueryClientProvider client={queries}>
        <SettingsView section={null} />
      </QueryClientProvider>,
    );
    const SENTENCE = 'Extension popups can’t see the current tab here, so ad blockers and per-site toggles may not work.';
    const mark = await screen.findByRole('img', { name: SENTENCE });
    expect(accessibleText(document.querySelector('[data-imported-profile]')!)).not.toContain('ad blockers');
    act(() => mark.focus());
    expect(tooltip()).toBe(SENTENCE);
  });
});
