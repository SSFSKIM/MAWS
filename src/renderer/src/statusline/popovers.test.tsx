import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { SessionRecord } from '@shared/graph/session';
import type { MawsBridge } from '@shared/ipc/schema';
import type { AccountUsage, UsageSnapshot, UsageWindow } from '@shared/usage/types';
import { record, status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { StatusLine } from '../session/StatusLine';
import { resetCatalogStore } from '../stores/catalog';
import { useSessions } from '../stores/sessions';
import { useUsage } from '../stores/usage';
import { resetShellStores } from '../test-support/shell-stores';
import { registerUsagePopoverFooter } from './footer';
import { ModeMenu } from './ModeMenu';
import type { ModeBinding } from './mode-menu';

const NOW = Date.parse('2026-09-29T07:40:00Z');
const A = 'app-a' as AppSessionId;
const win = (percent: number, resetsAt: string): UsageWindow => ({ percent, resetsAt, recordedAt: '2026-09-29T07:38:00Z' });

function account(uuid: string, five: number, seven: number): AccountUsage {
  return {
    uuid, email: `${uuid}@example.test`, displayName: uuid, planLabel: 'Max', rateLimitTier: null, needsReauthentication: false, lastSeenActive: null, pinnedSessionCount: 1,
    credentialOwnership: null,
    windows: { fiveHour: win(five, '2026-09-29T11:20:00Z'), sevenDay: win(seven, '2026-10-02T17:00:00Z'), scoped: [{ model: 'Fable', window: win(40, '2026-10-02T17:00:00Z') }] },
  };
}

const SNAP: UsageSnapshot = {
  available: true, dataDir: '/cu', readAt: '2026-09-29T07:39:00Z', error: null, drainTarget: 'drain', drainTargetIsManual: false,
  accounts: [account('drain', 53, 63), account('pinned', 77, 44), account('third', 20, 32)], pinsFor: { 'eng-app-a': 'pinned' },
};

const CONTEXT = {
  categories: [
    { name: 'System prompt', tokens: 6810, kind: 'used' },
    { name: 'Messages', tokens: 40_000, kind: 'used' },
    { name: 'Free space', tokens: 153_190, kind: 'free' },
  ],
  totalTokens: 46_810, maxTokens: 200_000, percentage: 23.4, autoCompactThreshold: 167_000, isAutoCompactEnabled: true, model: 'claude-opus',
};
const catalog = (names: string[], terminalOnly: string[] = []) => ({
  commands: names.map((name) => ({ name, description: name, argumentHint: '' })), agents: [], skills: [], terminalSlashCommands: terminalOnly, revision: 1,
});

let fake: FakeClient;
let queryClient: QueryClient;

function mount(rec: SessionRecord = record('app-a'), answers: Parameters<typeof fakeClient>[0] = {}) {
  fake = fakeClient({ 'session.status': status('app-a'), ...answers });
  window.maws = fake.client;
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  useSessions.setState({ records: new Map([[A, rec]]), engine: new Map([[A, status('app-a')]]) });
  return render(
    <QueryClientProvider client={queryClient}>
      <StatusLine record={rec} />
    </QueryClientProvider>,
  );
}

const field = (text: RegExp | string) => within(screen.getByRole('group', { name: 'Session status' })).getByRole('button', { name: text });
const settle = () => act(async () => void (await vi.advanceTimersByTimeAsync(0)));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
  vi.setSystemTime(NOW);
  resetShellStores();
  useUsage.setState({ snapshot: null, windows: null, pinsFor: {}, direct: new Map(), updatedAt: null });
});
afterEach(() => {
  cleanup();
  resetCatalogStore();
  delete (window as { maws?: MawsBridge }).maws;
  vi.useRealTimers();
});

describe('status line popovers', () => {
  it('every field opens a popover, and the 5h and 7d fields read the pinned account’s windows with their countdowns', () => {
    useUsage.getState().applySnapshot(SNAP);
    mount();
    const buttons = within(screen.getByRole('group', { name: 'Session status' })).getAllByRole('button');
    expect(buttons.map((b) => b.getAttribute('aria-haspopup'))).toEqual(Array(6).fill('dialog'));
    expect(buttons.map((b) => b.textContent).slice(2, 4)).toEqual(['5h 77% ↻3h40m', '7d 44% ↻3d9h']);
  });

  it('the 5h popover names the account, its three windows, and lists Other accounts with the drain target marked routing', () => {
    useUsage.getState().applySnapshot(SNAP);
    mount();
    fireEvent.click(field(/^5h/));
    const popover = screen.getByRole('dialog', { name: 'Account usage' });
    expect(within(popover).getByText('pinned@example.test · Max')).toBeTruthy();
    expect(within(popover).getAllByRole('meter').map((m) => [m.getAttribute('aria-label'), m.getAttribute('aria-valuenow')])).toEqual([
      ['Five-hour usage', '77'],
      ['Weekly usage', '44'],
      ['Fable weekly usage', '40'],
    ]);
    expect(within(popover).getByText('resets in 3h 40m')).toBeTruthy();
    const others = within(popover).getByRole('list', { name: 'Other accounts' });
    expect(within(others).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['drain@example.test · 7d 63%routing', 'third@example.test · 7d 32%']);
    expect(within(popover).getByText('Updated 2m ago')).toBeTruthy();
  });

  it('a window past its reset reads 0% with a note, in the line and in the popover', () => {
    useUsage.getState().applySnapshot({ ...SNAP, accounts: [account('drain', 53, 63), { ...account('pinned', 100, 44), windows: { ...account('pinned', 0, 44).windows, fiveHour: win(100, '2026-09-29T07:30:00Z') } }] });
    mount();
    expect(field(/^5h/).textContent).toBe('5h 0%');
    fireEvent.click(field(/^5h/));
    expect(within(screen.getByRole('dialog', { name: 'Account usage' })).getByText('no reading since the window reset')).toBeTruthy();
  });

  it('a component registered through registerUsagePopoverFooter renders beside Updated <ago> and leaves with its disposer', () => {
    useUsage.getState().applySnapshot(SNAP);
    const dispose = registerUsagePopoverFooter(({ appSessionId }) => <a href="#x">Open ClaudeUsage for {appSessionId}</a>);
    mount();
    fireEvent.click(field(/^7d/));
    const popover = screen.getByRole('dialog', { name: 'Account usage' });
    const footer = within(popover).getByText('Open ClaudeUsage for app-a');
    expect(footer.parentElement?.textContent).toBe('Open ClaudeUsage for app-aUpdated 2m ago');
    act(() => dispose());
    expect(within(popover).queryByText('Open ClaudeUsage for app-a')).toBeNull();
    expect(within(popover).getByText('Updated 2m ago')).toBeTruthy();
  });

  it('the footer seam carries the popover’s close: a footer action that opens another surface closes the popover', () => {
    useUsage.getState().applySnapshot(SNAP);
    const opened = vi.fn();
    const dispose = registerUsagePopoverFooter(({ close }) => (
      <button
        type="button"
        onClick={() => {
          close();
          opened();
        }}
      >
        Accounts
      </button>
    ));
    mount();
    fireEvent.click(field(/^5h/));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Account usage' })).getByRole('button', { name: 'Accounts' }));
    expect(opened).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog', { name: 'Account usage' })).toBeNull();
    act(() => dispose());
  });

  it('reads — for both windows when ClaudeUsage is unavailable, with the tooltip, and says so in the popover', () => {
    useUsage.getState().applySnapshot({ ...SNAP, available: false, accounts: [], drainTarget: null, pinsFor: {}, error: 'ClaudeUsage is not installed or has no data at /cu' });
    mount();
    for (const name of [/^5h/, /^7d/]) {
      expect(field(name).textContent).toMatch(/^(5h|7d) —$/);
      expect(field(name).getAttribute('title')).toBe('ClaudeUsage is not installed or has no data');
    }
    fireEvent.click(field(/^5h/));
    expect(within(screen.getByRole('dialog', { name: 'Account usage' })).getByText('ClaudeUsage is not installed or has no data')).toBeTruthy();
  });

  it('a direct session reads the engine’s get_usage windows instead of ClaudeUsage’s', async () => {
    useUsage.getState().applySnapshot(SNAP);
    const direct = record('app-a', { gateway: { routed: false, baseUrl: null, autoModeServer: 'unknown' } });
    const base = status('app-a');
    fake = fakeClient({
      'session.getUsage': {
        session: { total_cost_usd: 0, total_api_duration_ms: 0, total_duration_ms: 0, model_usage: {} }, subscription_type: 'max', rate_limits_available: true, behaviors: null,
        rate_limits: { five_hour: { utilization: 12, resets_at: '2026-09-29T09:40:00Z' }, seven_day: { utilization: 34, resets_at: '2026-10-01T07:40:00Z' } },
      },
    });
    window.maws = fake.client;
    useSessions.setState({ records: new Map([[A, direct]]), engine: new Map([[A, { ...base, gateway: { ...base.gateway, mode: 'direct' as const } }]]) });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <StatusLine record={direct} />
      </QueryClientProvider>,
    );
    await settle();
    expect(field(/^5h/).textContent).toBe('5h 12% ↻2h0m');
    expect(field(/^7d/).textContent).toBe('7d 34% ↻2d0h');
    await act(async () => void (await vi.advanceTimersByTimeAsync(60_000)));
    expect(fake.invoked('session.getUsage')).toHaveLength(2);
    fireEvent.click(field(/^5h/));
    expect(within(screen.getByRole('dialog', { name: 'Account usage' })).getByText('Direct · the engine’s own login')).toBeTruthy();
  });

  it('the context popover reads get_context_usage on open, and offers Compact now only when the catalogue lists compact headless', async () => {
    mount(record('app-a'), { 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['model', 'cost']) });
    fireEvent.click(field(/^ctx/));
    await settle();
    const popover = screen.getByRole('dialog', { name: 'Context window' });
    expect(within(popover).getByText('47k of 200k · autocompact at 167k')).toBeTruthy();
    expect(within(popover).getByText('23.4% used · 120k until compaction')).toBeTruthy();
    expect(within(popover).getByRole('img', { name: 'Context breakdown: System prompt 7k, Messages 40k. Autocompact at 167k' })).toBeTruthy();
    expect(within(popover).queryByRole('button', { name: 'Compact now' })).toBeNull();
    expect(fake.invoked('session.getContextUsage')).toEqual([{ appSessionId: A, detail: 'full' }]);
  });

  it('Compact now sends /compact when the catalogue lists it and it is not terminal-only', async () => {
    mount(record('app-a'), { 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['compact']), 'session.send': { messageUuid: null, disposition: 'queued', queueId: 'q1' } });
    fireEvent.click(field(/^ctx/));
    await settle();
    fireEvent.click(screen.getByRole('button', { name: 'Compact now' }));
    await settle();
    expect(fake.invoked('session.send')).toEqual([{ appSessionId: A, content: '/compact' }]);
    cleanup();
    resetCatalogStore();
    mount(record('app-a'), { 'session.getContextUsage': CONTEXT, 'session.catalog': catalog(['compact'], ['compact']) });
    fireEvent.click(field(/^ctx/));
    await settle();
    expect(screen.queryByRole('button', { name: 'Compact now' })).toBeNull();
  });

  it('the cost popover shows the running total and the engine’s cost report', async () => {
    mount(record('app-a'), { 'session.getSessionCost': { text: 'Total cost: $0.42\nUsage by model:\n  claude-opus: 12k input, 3k output ($0.42)\n' } });
    fireEvent.click(field('$—'));
    await settle();
    const popover = screen.getByRole('dialog', { name: 'Session cost' });
    expect(within(popover).getByLabelText('Cost by model').textContent).toContain('claude-opus: 12k input');
  });

  it('the cwd popover shows the directory, branch and additional directories', () => {
    mount(record('app-a', { branch: 'feat/x', additionalDirectories: ['/work/shared'] }));
    fireEvent.click(field('/work/app-a'));
    const popover = screen.getByRole('dialog', { name: 'Working directory' });
    expect(within(popover).getByText('Branch feat/x')).toBeTruthy();
    expect(within(within(popover).getByRole('list', { name: 'Additional directories' })).getByText('/work/shared')).toBeTruthy();
    expect(within(popover).getByRole('button', { name: 'Copy path' })).toBeTruthy();
  });
});

describe('the mode menu in the status line', () => {
  const MODELS = { models: [{ value: 'claude-opus', resolvedModel: 'claude-opus', displayName: 'Opus', description: '', supportsAutoMode: false }] };

  it('lists the modes with the effective one checked, disables auto with the reason, and sets through session.setPermissionMode', async () => {
    mount(record('app-a'), { 'session.listModels': MODELS, 'session.setPermissionMode': { effective: 'plan', refusal: null, error: null } });
    fireEvent.click(field('auto'));
    await settle();
    const menu = screen.getByRole('menu', { name: 'Permission mode' });
    const items = within(menu).getAllByRole('menuitemradio');
    expect(items.map((i) => i.querySelector('.font-mono')?.textContent)).toEqual(['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions']);
    expect(items[3].getAttribute('aria-checked')).toBe('true');
    expect((items[3] as HTMLButtonElement).disabled).toBe(true);
    expect(items[3].textContent).toContain('This model does not support auto mode');
    fireEvent.click(items[2]);
    await settle();
    expect(fake.invoked('session.setPermissionMode')).toEqual([{ appSessionId: A, mode: 'plan' }]);
    expect(screen.queryByRole('menu', { name: 'Permission mode' })).toBeNull(); // closed on the engine's answer
  });

  it('bypassPermissions asks first, and a refusal stays in the menu in words', async () => {
    mount(record('app-a'), { 'session.listModels': { models: [] }, 'session.setPermissionMode': { effective: 'default', refusal: 'auto_mode_settings', error: 'Auto mode is disabled in settings.json' } });
    fireEvent.click(field('auto'));
    await settle();
    fireEvent.click(screen.getByRole('menuitemradio', { name: /bypassPermissions/ }));
    expect(fake.invoked('session.setPermissionMode')).toEqual([]);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })); // a stray Enter keeps the mode
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^default/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Auto mode is disabled by settings');
  });
});

describe('the mode menu on its own binding', () => {
  it('a binding whose set rejects shows the reason as the alert and leaves the menu usable', async () => {
    const binding: ModeBinding = {
      value: 'default', options: ['default', 'plan'], disabled: null, refusal: null, autoUnavailable: null,
      set: () => Promise.reject(new Error('the bridge went away')),
    };
    render(<ModeMenu binding={binding} />);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^plan/ }));
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('the bridge went away');
    expect((screen.getByRole('menuitemradio', { name: /^plan/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
