// The title bar's usage ring and its compact popover (UX wave U7b, O-47; docs/doperpowers/plans/
// 2026-11-12-ux-wave-U7-sidebar-title-bar-destinations.md, M7 decisions 2, 3 and 5), over the committed ClaudeUsage
// fixture as C7's reader answers it at the fixture's clock: the ring's arc and colour, its empty and dimmed forms and no
// digit; the popover's accounts, the relay's line only when it is in trouble, the no-data line, its width and its one
// link; the Usage action, which shows Settings › Usage while the Settings dialog is open.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PreloadBridge } from '@shared/ipc/schema';
import type { RelayHealth } from '@shared/engine/relay-health';
import type { UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { useGateway } from '../gateway/store';
import { isActionEnabled, runAction } from '../keymap/actions-runtime';
import { useLayout } from '../stores/layout';
import { useUsage } from '../stores/usage';
import { resetShellStores } from '../test-support/shell-stores';
import { REL } from '../test-support/relative-time';
import { TEST_MACHINE } from '../../../../test/support/machine';
import { useUsageControlState } from './controls';
import { useUsagePopover } from './popover';
import { UsageRing } from './UsageRing';
import { registerUsage } from '.';
import { registerSlot, resetSlots } from '../app/slots';
import { SettingsDialog } from '../destination/SettingsDialog';

const NOW = Date.parse('2026-09-29T07:36:17Z');
const CIRCUMFERENCE = 2 * Math.PI * 6; // a 14 px ring of a 2 px stroke
let fixture: UsageSnapshot;
let relay: RelayHealth;

beforeAll(async () => {
  const reader = new ClaudeUsageReader({ dir: join(__dirname, '../../../../test/fixtures/claude-usage'), emit: () => {}, log: () => {}, now: () => NOW });
  fixture = await reader.snapshot([]);
  reader.stop();
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  resetShellStores();
  relay = { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 2.6, checkedAt: new Date(NOW - 12_000).toISOString(), error: null };
  window.maws = {
    localMachine: TEST_MACHINE,
    invoke: vi.fn(async (name: string) => {
      switch (name) {
        case 'engine.relayHealth':
          return { ok: true, value: relay };
        case 'settings.claudeUsage.status':
          return { ok: true, value: { installed: true, running: true, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: new Date(NOW).toISOString() } };
        case 'settings.usageControls':
          return { ok: true, value: { available: false, reason: 'no_route', state: null } };
        default:
          return { ok: true, value: undefined };
      }
    }),
    on: () => () => {},
    pathForFile: () => '',
  } as unknown as PreloadBridge;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUsage.setState({ snapshot: null, routed: null });
  useGateway.setState({ relay: null, claudeUsage: null });
  useUsagePopover.setState({ open: false });
  useUsageControlState.setState({ answer: null, notice: null, busy: false });
  resetShellStores();
  delete (window as { maws?: PreloadBridge }).maws;
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const ring = () => document.querySelector<HTMLButtonElement>('[data-usage-ring]')!;
const arc = () => ring().querySelector('[data-ring-arc]');
const track = () => ring().querySelector('[data-ring-track]')!;
async function openPopover(snapshot: UsageSnapshot | null = fixture) {
  useUsage.setState({ snapshot });
  render(<UsageRing />);
  fireEvent.click(ring());
  await settle();
  return screen.getByRole('dialog', { name: 'Usage' });
}
const accountsIn = (popover: HTMLElement) => [...popover.querySelectorAll<HTMLElement>('[data-account]')];

// The routing account (3@) read at `percent` in its five-hour window, its other windows low.
const at = (percent: number): UsageSnapshot => {
  const window = (p: number): UsageWindow => ({ percent: p, resetsAt: new Date(NOW + 3_600_000).toISOString(), recordedAt: new Date(NOW - 60_000).toISOString() });
  return { ...fixture, accounts: fixture.accounts.map((a) => (a.email === '3@example.test' ? { ...a, windows: { fiveHour: window(percent), sevenDay: window(10), scoped: [] } } : a)) };
};

describe('the usage ring', () => {
  it.each([
    [30, 'stroke-success', 'normal'],
    [80, 'stroke-warning', 'warning'],
    [96, 'stroke-danger', 'critical'],
  ])('draws %i percent as an arc of the ring in the severity’s colour, and no digit', (percent, colour, severity) => {
    useUsage.setState({ snapshot: at(percent) });
    render(<UsageRing />);
    expect(ring().getAttribute('data-usage-ring')).toBe(String(percent));
    expect(ring().getAttribute('data-severity')).toBe(severity);
    expect(arc()!.getAttribute('class')).toContain(colour);
    expect(Number(arc()!.getAttribute('stroke-dasharray'))).toBeCloseTo(CIRCUMFERENCE);
    expect(Number(arc()!.getAttribute('stroke-dashoffset'))).toBeCloseTo(CIRCUMFERENCE * (1 - percent / 100));
    expect(track().getAttribute('class')).toContain('stroke-border-strong');
    expect(ring().textContent).toBe('');
    expect(ring().getAttribute('aria-label')).toBe(`Usage · 5h ${percent}% · 3@example.test`);
    expect(ring().getAttribute('title')).toBe(ring().getAttribute('aria-label'));
    expect(ring().querySelector('svg')!.getAttribute('class')).not.toContain('opacity-50');
  });

  it('is a muted empty track with no reading: no data, before the first read, and an account without readings', () => {
    useUsage.setState({ snapshot: { ...fixture, available: false, accounts: [] } });
    const { unmount } = render(<UsageRing />);
    expect(arc()).toBeNull();
    expect(track().getAttribute('class')).toContain('stroke-fg-muted');
    expect(ring().getAttribute('data-usage-ring')).toBe('');
    expect(ring().getAttribute('aria-label')).toBe('Usage · ClaudeUsage has no data');
    unmount();
    useUsage.setState({ snapshot: null });
    const again = render(<UsageRing />);
    expect(arc()).toBeNull();
    expect(ring().getAttribute('aria-label')).toBe('Usage · ClaudeUsage has no data');
    again.unmount();
    const bare = fixture.accounts.map((a) => (a.email === '3@example.test' ? { ...a, windows: { fiveHour: null, sevenDay: null, scoped: [] } } : a));
    useUsage.setState({ snapshot: { ...fixture, accounts: bare } });
    render(<UsageRing />);
    expect(arc()).toBeNull();
    expect(track().getAttribute('class')).toContain('stroke-fg-muted');
    expect(ring().getAttribute('aria-label')).toBe('Usage · no readings yet for 3@example.test');
    expect(ring().textContent).toBe('');
  });

  it('is dimmed while the routed account must sign in again', () => {
    const reauth = fixture.accounts.map((a) => (a.email === '3@example.test' ? { ...a, needsReauthentication: true } : a));
    useUsage.setState({ snapshot: { ...fixture, accounts: reauth } });
    render(<UsageRing />);
    expect(ring().querySelector('svg')!.getAttribute('class')).toContain('opacity-50');
    expect(arc()).not.toBeNull();
  });
});

describe('the usage popover', () => {
  it('lists the routed account first and marked, then the others, then the Codex accounts, each as its name and limit rows', async () => {
    const popover = await openPopover();
    expect(within(popover).getByRole('heading', { name: 'Usage' })).toBeTruthy();
    expect(popover.textContent).toContain(`updated ${REL.agoNarrow(2, 'minute')}`);
    const accounts = accountsIn(popover);
    expect(accounts.map((a) => a.getAttribute('aria-label'))).toEqual(['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test', '6@example.test', '7@example.test']);
    const mark = (a: HTMLElement) => a.querySelector('[data-account-mark]')?.textContent ?? null;
    expect(accounts.map(mark)).toEqual(['Routing here', null, null, null, null, 'Codex', 'Codex']);
    expect(within(accounts[0]!).getAllByRole('meter').map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Five-hour usage', '53'],
      ['Weekly usage', '63'],
      ['Fable weekly usage', '82'],
    ]);
    expect(accounts.filter((a) => a.closest('[data-codex]') === null)).toHaveLength(5); // the Codex accounts stand apart
    for (const codex of accounts.slice(5)) {
      expect(within(codex).queryAllByRole('meter')).toHaveLength(0);
      expect(codex.textContent).toContain("Limits show in ClaudeUsage's own panel");
    }
    // no saved sessions, no activity, no actions, no add row
    expect(popover.textContent).not.toContain('saved session');
    expect(popover.querySelector('[data-serving]')).toBeNull();
    expect(within(popover).getAllByRole('button').map((b) => b.textContent)).toEqual(['Usage settings']);
  });

  it('draws the relay’s line only while the relay is in trouble: not answering, or degraded in its last ten minutes', async () => {
    const quiet = { ...fixture, activity: fixture.activity && { ...fixture.activity, health: { ...fixture.activity.health, stalls: 0, transportFailures: 0, refused: 0, unreachable: 0 } } };
    let popover = await openPopover(quiet);
    expect(popover.querySelector('[data-relay-line]')).toBeNull();
    cleanup();
    useUsagePopover.setState({ open: false });

    popover = await openPopover(fixture); // the fixture's last ten minutes hold a stall, a connection error and a refusal
    expect(popover.querySelector('[data-relay-line]')!.textContent).toBe('Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held');
    cleanup();
    useUsagePopover.setState({ open: false });

    relay = { ...relay, ok: false, status: null, latencyMs: null, error: 'connection refused' };
    popover = await openPopover(quiet);
    expect(popover.querySelector('[data-relay-line]')!.textContent).toBe('Relay not answering · connection refused');
  });

  it('with no data says so in one line and keeps the link', async () => {
    const popover = await openPopover({ ...fixture, available: false, accounts: [], gateway: null, codex: null, activity: null });
    expect(popover.querySelector('[data-usage-none]')!.textContent).toBe('ClaudeUsage is not installed or has no data');
    expect(accountsIn(popover)).toHaveLength(0);
    expect(within(popover).getAllByRole('button').map((b) => b.textContent)).toEqual(['Usage settings']);
  });

  it('“Usage settings” opens Settings at Usage and closes the popover', async () => {
    const popover = await openPopover();
    fireEvent.click(within(popover).getByRole('button', { name: 'Usage settings' }));
    await settle();
    expect(useLayout.getState().settings).toEqual({ section: 'usage' });
    expect(useUsagePopover.getState().open).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Usage' })).toBeNull();
  });

  // The branch review: the link's button goes with the popover, so the ring holds the keyboard when Settings opens and
  // gets it back when Settings closes.
  it('“Usage settings” by keyboard: closing Settings gives the keyboard back to the ring', async () => {
    registerSlot('settingsTab', ({ section }) => <p>section {String(section)}</p>);
    try {
      useUsage.setState({ snapshot: fixture });
      render(<><UsageRing /><SettingsDialog /></>);
      act(() => ring().focus());
      fireEvent.click(ring());
      await settle();
      const link = within(screen.getByRole('dialog', { name: 'Usage' })).getByRole('button', { name: 'Usage settings' });
      act(() => link.focus());
      fireEvent.click(link);
      await settle();
      expect(screen.getByRole('dialog', { name: 'Settings' }).textContent).toContain('section usage');
      act(() => useLayout.getState().closeSettings());
      await settle();
      expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
      expect(document.activeElement).toBe(ring());
    } finally {
      resetSlots();
    }
  });

  it('is at most 320 px wide by its class, opening below the ring at its right edge', async () => {
    const popover = await openPopover();
    expect(popover.className.split(/\s+/)).toContain('w-80');
    expect(popover.getAttribute('data-side')).toBe('bottom');
    expect(popover.getAttribute('data-align')).toBe('end');
  });

  it('cuts a long account name with an ellipsis and keeps it whole in its title; the mark beside it is never cut', async () => {
    const long = `${'a'.repeat(37)}@example.test`; // fifty characters
    expect(long).toHaveLength(50);
    const accounts = fixture.accounts.map((a) => (a.email === '3@example.test' ? { ...a, email: long } : a));
    const popover = await openPopover({ ...fixture, accounts });
    const name = accountsIn(popover)[0]!.querySelector<HTMLElement>('[data-account-name]')!;
    expect(name.textContent).toBe(long);
    expect(name.title).toBe(long);
    expect(name.className.split(/\s+/)).toEqual(expect.arrayContaining(['truncate', 'min-w-0']));
    const mark = accountsIn(popover)[0]!.querySelector<HTMLElement>('[data-account-mark]')!;
    expect(mark.textContent).toBe('Routing here');
    expect(mark.className.split(/\s+/)).toEqual(expect.arrayContaining(['shrink-0', 'whitespace-nowrap']));
    const codex = accountsIn(popover).at(-1)!.querySelector<HTMLElement>('[data-account-mark]')!;
    expect(codex.textContent).toBe('Codex');
    expect(codex.className).toContain('text-fg-muted');
  });

  it('opens from its store, as the Usage action opens it', async () => {
    useUsagePopover.setState({ open: true });
    useUsage.setState({ snapshot: fixture });
    render(<UsageRing />);
    await settle();
    expect(screen.getByRole('dialog', { name: 'Usage' })).toBeTruthy();
  });
});

describe('the Usage action (the retired Accounts tab’s id, kept for keymap overrides)', () => {
  it('opens the popover, over a page too; while the Settings dialog is open it shows Settings › Usage instead', async () => {
    const off = registerUsage();
    try {
      useUsage.setState({ snapshot: fixture });
      render(<UsageRing />);
      expect(isActionEnabled('accounts.open')).toBe(true);
      act(() => runAction('accounts.open'));
      await settle();
      expect(screen.getByRole('dialog', { name: 'Usage' })).toBeTruthy();
      act(() => useUsagePopover.setState({ open: false }));

      act(() => useLayout.getState().openDestination({ kind: 'projects' }));
      act(() => runAction('accounts.open'));
      await settle();
      expect(useUsagePopover.getState().open).toBe(true);
      expect(useLayout.getState().destination).toEqual({ kind: 'projects' });
      act(() => useUsagePopover.setState({ open: false }));

      act(() => useLayout.getState().openSettings('appearance'));
      act(() => runAction('accounts.open'));
      await settle();
      expect(useUsagePopover.getState().open).toBe(false);
      expect(useLayout.getState().settings).toEqual({ section: 'usage' });
      expect(useLayout.getState().destination).toEqual({ kind: 'projects' });
    } finally {
      off();
    }
    expect(isActionEnabled('accounts.open')).toBe(false);
  });
});
