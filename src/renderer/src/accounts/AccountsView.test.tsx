// The Accounts tab on screen (C11 execution document, Interfaces "Accounts tab"; M5 pins) over the committed ClaudeUsage
// fixture as C7's reader answers it, at the fixture's clock: the cards in ClaudeUsage's geometry, the routing mark and
// its reason, every hand-off through the real command validator, the wait for ClaudeUsage's rewrite, and the absent case.
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';
import type { MawsBridge } from '@shared/ipc/schema';
import { validateCommandInput } from '@shared/ipc/validate';
import type { UsageSnapshot } from '@shared/usage/types';
import { ClaudeUsageReader } from '../../../main/usage/claude-usage-reader';
import { useGateway } from '../gateway/store';
import { useNotices } from '../stores/notices';
import { useUsage } from '../stores/usage';
import { AccountsView } from './AccountsView';

const NOW = Date.parse('2026-09-29T07:36:17Z');
let fixture: UsageSnapshot;
let calls: { name: string; input: unknown }[];
let usageChanged: ((payload: unknown) => void)[];
let installed: boolean;

beforeAll(async () => {
  fixture = await new ClaudeUsageReader({ dir: join(__dirname, '../../../../test/fixtures/claude-usage'), emit: () => {}, log: () => {} }).snapshot([]);
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(NOW);
  calls = [];
  usageChanged = [];
  installed = true;
  window.maws = {
    invoke: vi.fn(async (name: string, input: unknown) => {
      calls.push({ name, input });
      const checked = validateCommandInput(name as never, input);
      if (!checked.ok) return checked;
      switch (name) {
        case 'engine.relayHealth':
          return { ok: true, value: { url: 'http://127.0.0.1:8641', ok: true, status: 200, latencyMs: 2.6, checkedAt: new Date(NOW - 12_000).toISOString(), error: null } };
        case 'settings.claudeUsage.status':
          return { ok: true, value: { installed, running: true, bundleId: 'com.haegi.ClaudeUsage', dataDirPresent: true, checkedAt: new Date(NOW).toISOString() } };
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
  useGateway.setState({ relay: null, relayCheckedAt: null, claudeUsage: null });
  useNotices.setState({ notices: [] });
  delete (window as { maws?: MawsBridge }).maws;
});

const show = (snapshot: UsageSnapshot | null = fixture) => {
  useUsage.setState({ snapshot });
  render(<AccountsView />);
};
const card = (email: string) => screen.getByRole('region', { name: email });
const settle = () => act(() => vi.advanceTimersByTimeAsync(0));

describe('the Accounts tab', () => {
  it("shows ClaudeUsage's accounts in its order and geometry, the routing one marked with why", async () => {
    show();
    await settle();
    const cards = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'));
    expect(cards).toEqual(['3@example.test', '4@example.test', '1@example.test', '5@example.test', '2@example.test']);
    expect(document.querySelector('[data-columns]')!.getAttribute('data-columns')).toBe('2');
    const routing = card('3@example.test');
    expect(routing.textContent).toContain('Routing here · weekly resets soonest of the usable accounts');
    expect(routing.textContent).toContain('8 saved sessions');
    expect(routing.textContent).toContain('Max · default_claude_max_20x');
    expect(within(routing).getAllByRole('meter').map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Five-hour usage', '53'],
      ['Weekly usage', '63'],
      ['Fable weekly usage', '82'],
    ]);
    expect(card('1@example.test').textContent).toContain('1 saved session');
    expect(card('1@example.test').textContent).not.toContain('Routing here');
    // the one window at 100 %: the bar in --danger
    expect(within(card('4@example.test')).getByRole('meter', { name: 'Five-hour usage' }).querySelector('[data-full]')!.className).toContain('bg-danger');
    // a reset that passed reads 0 % and says so
    expect(within(card('2@example.test')).getByRole('meter', { name: 'Five-hour usage' }).getAttribute('aria-valuenow')).toBe('0');
    expect(card('2@example.test').textContent).toContain('5h · no reading since the window reset');
    expect(screen.getByText('read from ClaudeUsage · updated 2m ago')).toBeTruthy();
    expect(document.querySelector('[data-relay-line]')!.textContent).toBe('Relay listening on 127.0.0.1:8641 · checked just now · 3 ms');
  });

  it('hands every account action to ClaudeUsage, through the real validator, and waits for its rewrite', async () => {
    const reauth = { ...fixture, accounts: fixture.accounts.map((a) => (a.email === '5@example.test' ? { ...a, needsReauthentication: true } : a)) };
    show(reauth);
    await settle();
    const dimmed = card('5@example.test');
    expect(dimmed.getAttribute('data-state')).toBe('needs_reauth');
    expect(dimmed.textContent).toContain('Needs reauthentication · the relay skips it until it is reconnected; readings are last known');
    expect(screen.getAllByRole('region').at(-1)).toBe(dimmed);

    fireEvent.click(within(dimmed).getByRole('button', { name: 'Reconnect in ClaudeUsage ↗' }));
    fireEvent.click(within(card('1@example.test')).getByRole('button', { name: 'Remove in ClaudeUsage ↗' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add account in ClaudeUsage ↗' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open ClaudeUsage ↗' })[0]!);
    await settle();
    expect(calls.filter((c) => c.name === 'settings.claudeUsage.open').map((c) => c.input)).toEqual([
      { intent: 'reconnect', accountEmail: '5@example.test' },
      { intent: 'remove', accountEmail: '1@example.test' },
      { intent: 'addAccount' },
      { intent: 'panel' },
    ]);
    expect(useNotices.getState().notices.filter((n) => n.kind === 'toast').map((n) => n.text)).toContain('ClaudeUsage is in the menu bar · click its icon');
    expect(screen.getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
    act(() => usageChanged.forEach((l) => l(fixture)));
    await settle();
    expect(screen.queryByRole('status')).toBeNull();

    fireEvent.click(screen.getAllByRole('button', { name: 'Open ClaudeUsage ↗' })[0]!);
    await settle();
    expect(screen.getByRole('status')).toBeTruthy();
    await act(() => vi.advanceTimersByTimeAsync(60_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a second hand-off while waiting restarts the 60 s wait (M5 fix wave)', async () => {
    show();
    await settle();
    const open = () => fireEvent.click(screen.getAllByRole('button', { name: 'Open ClaudeUsage ↗' })[0]!);
    open();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    open();
    await settle();
    await act(() => vi.advanceTimersByTimeAsync(40_000));
    expect(screen.getByRole('status').textContent).toBe('Waiting for ClaudeUsage…');
    await act(() => vi.advanceTimersByTimeAsync(20_000));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('Refresh forces a relay check', async () => {
    show();
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await settle();
    expect(calls.filter((c) => c.name === 'engine.relayHealth').map((c) => c.input)).toEqual([{ force: false }, { force: true }]);
  });

  it('without ClaudeUsage data: says so, and offers Install when ClaudeUsage is not installed', async () => {
    installed = false;
    show({ ...fixture, available: false, accounts: [] });
    await settle();
    expect(screen.getByText('ClaudeUsage is not installed or has no data')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Install ClaudeUsage' }));
    await settle();
    expect(calls.at(-1)).toEqual({ name: 'layout.openExternal', input: { url: 'https://github.com/SSFSKIM/claude-usage-menubar#readme' } });
  });
});
