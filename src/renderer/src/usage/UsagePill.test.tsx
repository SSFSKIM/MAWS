// The top bar's usage pill and its popover (W6, E1) over the committed ClaudeUsage fixture as C7's reader answers it at
// the fixture's clock: the pill's reading and colour, the popover's sections in ClaudeUsage's panel order, the four
// account actions disabled under the one hint, the hand-off to ClaudeUsage's own panel, and the absent case.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MawsBridge } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import type { UsageSnapshot } from '@shared/usage/types';
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { useGateway } from '../gateway/store';
import { useNotices } from '../stores/notices';
import { useUsage } from '../stores/usage';
import { READ_ONLY_CONTROLS } from './controls';
import { UsagePill, useUsagePopover } from './UsagePill';

const NOW = Date.parse('2026-09-29T07:36:17Z');
const HINT = "Routing controls arrive when ClaudeUsage exposes its control route; use ClaudeUsage's own panel for now";
let fixture: UsageSnapshot;
let calls: { name: string; input: unknown }[];
let usageChanged: ((payload: unknown) => void)[];

beforeAll(async () => {
  fixture = await new ClaudeUsageReader({ dir: join(__dirname, '../../../../test/fixtures/claude-usage'), emit: () => {}, log: () => {}, now: () => NOW }).snapshot([]);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  calls = [];
  usageChanged = [];
  window.maws = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name as never, input);
      if (!checked.ok) return checked;
      switch (name) {
        case 'engine.relayHealth':
          return { ok: true, value: { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 2.6, checkedAt: new Date(NOW - 12_000).toISOString(), error: null } };
        case 'settings.claudeUsage.status':
          return { ok: true, value: { installed: true, running: true, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: new Date(NOW).toISOString() } };
        case 'settings.claudeUsage.open':
          return { ok: true, value: { opened: true, reason: null, instruction: 'ClaudeUsage is in the menu bar · click its icon' } };
        default:
          return { ok: true, value: undefined };
      }
    }),
    on: (name: string, listener: (payload: unknown) => void) => {
      if (name === 'settings.usageChanged') usageChanged.push(listener);
      return () => void (usageChanged = usageChanged.filter((l) => l !== listener));
    },
    pathForFile: () => '',
  } as unknown as MawsBridge;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  useUsage.setState({ snapshot: null });
  useGateway.setState({ relay: null, claudeUsage: null });
  useNotices.setState({ notices: [] });
  useUsagePopover.setState({ open: false });
  delete (window as { maws?: MawsBridge }).maws;
});

const settle = () => act(() => vi.advanceTimersByTimeAsync(0));
const pill = () => document.querySelector<HTMLButtonElement>('[data-usage-pill]')!;
async function openPanel(snapshot: UsageSnapshot | null = fixture) {
  useUsage.setState({ snapshot });
  render(<UsagePill />);
  fireEvent.click(pill());
  await settle();
  return screen.getByRole('dialog', { name: 'Claude Usage' });
}
const card = (panel: HTMLElement, email: string) => within(panel).getByRole('region', { name: email });

describe('the usage pill', () => {
  it("reads the routing account's most binding percent in its severity's colour", () => {
    useUsage.setState({ snapshot: fixture });
    render(<UsagePill />);
    expect(pill().textContent).toBe('82'); // 3@'s Fable week, above its 5h 53 % and weekly 63 %
    expect(pill().getAttribute('data-severity')).toBe('warning');
    expect(pill().querySelector('[data-dot]')!.className).toContain('bg-warning');
    expect(pill().getAttribute('aria-label')).toBe('Usage · Fable 82% · 3@example.test');
  });

  it('is a muted dash without ClaudeUsage data, and before the first read', () => {
    useUsage.setState({ snapshot: { ...fixture, available: false, accounts: [] } });
    const { unmount } = render(<UsagePill />);
    expect(pill().textContent).toBe('--');
    expect(pill().querySelector('[data-dot]')!.className).toContain('bg-fg-muted');
    expect(pill().getAttribute('aria-label')).toBe('Usage · ClaudeUsage has no data');
    unmount();
    useUsage.setState({ snapshot: null });
    render(<UsagePill />);
    expect(pill().textContent).toBe('--');
  });
});

describe('the usage popover', () => {
  it("copies ClaudeUsage's panel: header, accounts with activity and limits, add, Codex, toggle, relay and health", async () => {
    const panel = await openPanel();
    expect(within(panel).getByRole('heading', { name: 'Claude Usage' })).toBeTruthy();
    expect(panel.textContent).toContain('updated 2m ago');
    expect(panel.textContent).toContain('Usage includes all machines. Activity below is from this Mac.');
    const accounts = within(panel).getAllByRole('region').filter((r) => r.hasAttribute('data-account') && !r.closest('[data-codex]'));
    expect(accounts.map((r) => r.getAttribute('aria-label'))).toEqual(['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test']);
    expect(panel.querySelector('[data-columns]')!.getAttribute('data-columns')).toBe('2');
    const routing = card(panel, '3@example.test');
    expect(routing.textContent).toContain('Routing here · weekly resets soonest of the usable accounts');
    expect(routing.textContent).toContain('8 saved sessions');
    expect(routing.querySelector('[data-serving="latest"]')!.textContent).toBe('5 requests · 97% cached · just now');
    expect(card(panel, '1@example.test').querySelector('[data-serving="recent"]')!.textContent).toBe('1 request · 63% cached · 3m ago');
    expect(within(routing).getAllByRole('meter').map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Five-hour usage', '53'],
      ['Weekly usage', '63'],
      ['Fable weekly usage', '82'],
    ]);
    // bars in their severity's colour: 4@'s five-hour window at 100 % critical, 3@'s Fable week at 82 % a warning
    expect(within(card(panel, '4@example.test')).getByRole('meter', { name: 'Five-hour usage' }).querySelector('[data-full]')!.className).toContain('bg-danger');
    expect(within(routing).getByRole('meter', { name: 'Fable weekly usage' }).firstElementChild!.className).toContain('bg-warning');
    expect(within(routing).getByRole('meter', { name: 'Five-hour usage' }).firstElementChild!.className).toContain('bg-success');

    const codex = within(panel).getByRole('region', { name: 'Codex accounts' });
    expect(codex.textContent).toContain('Used by GPT models routed through this app.');
    expect(within(codex).getAllByRole('region').map((r) => r.getAttribute('aria-label'))).toEqual(['6@example.test', '7@example.test']);
    expect(card(codex, '6@example.test').textContent).toContain('Routing here · chosen by the relay');
    expect(card(codex, '6@example.test').textContent).toContain("Limits show in ClaudeUsage's own panel");
    expect(card(codex, '7@example.test').getAttribute('data-state')).toBe('needs_reauth');

    const toggle = within(panel).getByRole('checkbox', { name: 'Route Claude Code through this app' });
    expect([(toggle as HTMLInputElement).checked, (toggle as HTMLInputElement).disabled]).toEqual([true, true]);
    expect(panel.querySelector('[data-relay-line]')!.textContent).toBe('Relay listening on 127.0.0.1:8641 · checked just now · 3 ms');
    expect(panel.querySelector('[data-health]')!.textContent).toBe('Last 10 min: 8 requests · response start median 1.0s, p95 3.2s · 1 stall, 1 connection error, 1 refused, 1 held');
    expect(panel.querySelector('[data-health]')!.getAttribute('data-health')).toBe('degraded');
  });

  it('renders Route requests here, Add, Reconnect and Remove disabled under the one hint', async () => {
    const reauth = { ...fixture, accounts: fixture.accounts.map((a) => (a.email === '5@example.test' ? { ...a, needsReauthentication: true } : a)) };
    const panel = await openPanel(reauth);
    const hint = within(panel).getByText(HINT);
    expect(within(panel).getAllByText(HINT)).toHaveLength(1);
    const actions = [
      ...within(panel).getAllByRole('button', { name: 'Route requests here' }),
      ...within(panel).getAllByRole('button', { name: 'Remove account…' }),
      within(panel).getByRole('button', { name: 'Add account…' }),
      within(panel).getByRole('button', { name: 'Reconnect…' }),
    ];
    expect(actions).toHaveLength(3 + 5 + 2); // Route on the three usable accounts that are not routing; Remove on all five
    for (const button of actions) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
      expect(button.getAttribute('aria-describedby')).toBe(hint.id);
    }
    expect(within(card(panel, '3@example.test')).queryByRole('button', { name: 'Route requests here' })).toBeNull();
    expect(within(card(panel, '5@example.test')).getByRole('button', { name: 'Reconnect…' })).toBeTruthy();
    expect(within(card(panel, '5@example.test')).queryByRole('button', { name: 'Route requests here' })).toBeNull();
    expect(READ_ONLY_CONTROLS.unavailable).toBe(HINT);
    // nothing reached main but the reads the popover makes on open
    expect([...new Set(calls.map((c) => c.name))].sort()).toEqual(['engine.relayHealth', 'settings.claudeUsage.status']);
  });

  it("hands off to ClaudeUsage's own panel and waits for its rewrite; Refresh re-checks the relay; Esc closes", async () => {
    const panel = await openPanel();
    fireEvent.click(within(panel).getByRole('button', { name: 'Open ClaudeUsage ↗' }));
    await settle();
    expect(calls.filter((c) => c.name === 'settings.claudeUsage.open').map((c) => c.input)).toEqual([{ intent: 'panel' }]);
    expect(useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => n.text)).toContain('ClaudeUsage is in the menu bar · click its icon');
    expect(within(panel).getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
    act(() => usageChanged.forEach((l) => l(fixture)));
    await settle();
    expect(within(panel).queryByRole('status')).toBeNull();

    fireEvent.click(within(panel).getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(calls.filter((c) => c.name === 'engine.relayHealth').map((c) => c.input)).toEqual([{ force: false }, { force: true }]);

    fireEvent.keyDown(panel, { key: 'Escape' });
    await settle();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useUsagePopover.getState().open).toBe(false);
  });

  it('without ClaudeUsage data says so and offers Open ClaudeUsage; the store opens it too', async () => {
    useUsagePopover.setState({ open: true });
    useUsage.setState({ snapshot: { ...fixture, available: false, accounts: [], gateway: null, codex: null, activity: null } });
    render(<UsagePill />);
    await settle();
    const panel = screen.getByRole('dialog', { name: 'Claude Usage' });
    expect(panel.textContent).toContain('ClaudeUsage is not installed or has no data');
    expect(within(panel).getAllByRole('button', { name: 'Open ClaudeUsage' })).toHaveLength(1);
    expect(panel.querySelector('[data-account]')).toBeNull();
    expect(within(panel).queryByRole('button', { name: 'Add account…' })).toBeNull();
    expect(panel.querySelector('[data-codex]')).toBeNull();
  });
});
