import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, TaskId } from '@shared/graph/ids';
import type { BudgetState } from '@shared/ipc/schema/engine';
import { status } from '../../../../test/support/builders';
import { fakeClient, type FakeClient } from '../../../../test/support/fake-client';
import { useNotices } from '../stores/notices';
import { BUDGET, clockTime, gb, reasonWords } from './copy';
import { BUDGET_BANNER_ID, connectBudget, resetBudgetStore, useBudget } from './store';

const A = 'app-a' as AppSessionId;
const B = 'app-b' as AppSessionId;
const GiB = 1024 * 1024;
const state = (over: Partial<BudgetState> = {}): BudgetState => ({
  enabled: true, limitKiB: 8 * GiB, totalKiB: 3.1 * GiB, sampledAt: '2026-09-29T14:02:00.000Z', over: false, overWithoutCandidate: false, candidates: 0, settling: 0,
  releasing: null, blocked: [], lastRelease: null, ...over,
});
const over = (blocked: AppSessionId[]) => state({ totalKiB: 9 * GiB, over: true, overWithoutCandidate: true, blocked: blocked.map((appSessionId) => ({ appSessionId, reasons: ['turn' as const] })) });
const banners = () => useNotices.getState().notices.filter((n) => n.id === BUDGET_BANNER_ID);

describe('the budget’s words', () => {
  it('writes sizes in GB with one decimal, dropping a zero decimal', () => {
    expect(gb(8 * GiB)).toBe('8 GB');
    expect(gb(3.14 * GiB)).toBe('3.1 GB');
    expect(gb(0.5 * GiB)).toBe('0.5 GB');
    expect(BUDGET.budgetLine(3.1 * GiB, 8 * GiB, 9)).toBe('3.1 GB of 8 GB · 9 sessions');
    expect(BUDGET.budgetLine(0.4 * GiB, 8 * GiB, 1)).toBe('0.4 GB of 8 GB · 1 session');
  });

  it('names the release’s time and budget on the mark and in Session info', () => {
    const at = new Date(2026, 8, 29, 14, 2).toISOString(); // 14:02 on the host's clock
    expect(clockTime(at)).toBe('14:02');
    expect(BUDGET.markTitle({ at, limitKiB: 8 * GiB })).toBe('Released at 14:02 to stay under the 8 GB memory budget · Send resumes it');
    expect(BUDGET.releasedLine({ at, limitKiB: 8 * GiB })).toBe('Released at 14:02 to stay under 8 GB');
  });

  it('says why each session holds work, counting where a count helps', () => {
    const s = status(A, {
      backgroundTasks: [{ taskId: 't1' as TaskId, taskType: 'local_bash', description: 'sleep', ambient: false }, { taskId: 't2' as TaskId, taskType: 'local_bash', description: 'b', ambient: false }, { taskId: 't3' as TaskId, taskType: 'dream', description: 'x', ambient: true }],
      queue: { length: 1, paused: true },
      mcpServers: [{ name: 'c12-kernel', status: 'connected', source: 'project' }, { name: 'plain', status: 'connected', source: 'user' }],
    });
    const stateful = new Set(['c12-kernel']);
    expect(['turn', 'busy', 'background_tasks', 'pending_request', 'queued_messages', 'held_peer_message', 'stateful_mcp'].map((r) => reasonWords(r as never, s, stateful))).toEqual([
      'mid-turn', 'working', '2 background tasks', 'waiting for you', '1 queued message', 'held message', 'stateful server c12-kernel',
    ]);
    expect(reasonWords('background_tasks', null, stateful)).toBe('background tasks');
  });

  it('counts the held sessions in the banner', () => {
    expect(BUDGET.banner(3)).toBe('Memory budget exceeded · 3 sessions hold work MAWS will not stop');
    expect(BUDGET.banner(1)).toBe('Memory budget exceeded · 1 session holds work MAWS will not stop');
  });
});

describe('the budget store and its banner', () => {
  let fake: FakeClient;
  let off: () => void;
  beforeEach(() => {
    resetBudgetStore();
    useNotices.setState({ notices: [] });
    fake = fakeClient();
    off = connectBudget(fake.client);
  });
  afterEach(() => off());

  it('subscribes before it reads the snapshot, and an event wins over a snapshot still on its way', async () => {
    expect(fake.calls).toEqual(['on engine.budget', 'on engine.hostState', 'invoke engine.budget']);
    fake.event('engine.budget', state({ totalKiB: 5 * GiB }));
    await fake.reply('engine.budget', state({ totalKiB: 1 * GiB }));
    expect(useBudget.getState().state?.totalKiB).toBe(5 * GiB);
  });

  it('takes the snapshot when no event came first', async () => {
    await fake.reply('engine.budget', state());
    expect(useBudget.getState().state).toEqual(state());
  });

  it('shows the banner once per crossing of the host’s flag; a dismissal holds until the next crossing; it goes when the flag clears', async () => {
    await fake.reply('engine.budget', state());
    expect(banners()).toEqual([]);
    fake.event('engine.budget', state({ over: true })); // over, not yet debounced by the host: no banner
    expect(banners()).toEqual([]);
    fake.event('engine.budget', over([A, B]));
    expect(banners()).toMatchObject([{ level: 'warning', text: 'Memory budget exceeded · 2 sessions hold work MAWS will not stop', dismissible: true, actions: [{ label: 'Review…' }] }]);
    fake.event('engine.budget', over([A, B, A]));
    expect(banners()).toHaveLength(1); // kept current in place
    useNotices.getState().dismiss(BUDGET_BANNER_ID);
    fake.event('engine.budget', over([A]));
    expect(banners()).toEqual([]); // dismissed for this crossing
    fake.event('engine.budget', state());
    fake.event('engine.budget', over([A]));
    expect(banners()).toHaveLength(1); // the next crossing
    fake.event('engine.budget', state());
    expect(banners()).toEqual([]);
  });

  // W7: the budget switched off in settings; the host's state says so
  it('withdraws the banner and closes a sheet when the budget is switched off, and raises none while it stays off', async () => {
    await fake.reply('engine.budget', over([A]));
    useBudget.getState().open({ kind: 'blocked' });
    expect(banners()).toHaveLength(1);
    fake.event('engine.budget', state({ enabled: false, totalKiB: 9 * GiB }));
    expect(banners()).toEqual([]);
    expect(useBudget.getState()).toMatchObject({ sheet: null, state: { enabled: false, totalKiB: 9 * GiB } });
    fake.event('engine.budget', { ...over([A]), enabled: false }); // not a state the host sends; the page holds the line anyway
    expect(banners()).toEqual([]);
  });

  it('Review… opens the blocked sessions sheet', async () => {
    await fake.reply('engine.budget', over([A]));
    banners()[0]!.actions[0]!.run();
    expect(useBudget.getState().sheet).toEqual({ kind: 'blocked' });
  });
});

// M2 review: the store follows the engine host's generations. A snapshot the host could not answer is read again when it
// is ready; a host that goes away takes its state and banner with it, and its restart is read afresh.
describe('the budget store across engine host generations', () => {
  let fake: FakeClient;
  let off: () => void;
  const host = (state: 'starting' | 'ready' | 'crashed' | 'restarting', revision: number) => fake.event('engine.hostState', { state, pid: state === 'ready' ? 7 : null, restarts: 0, revision });
  beforeEach(() => {
    resetBudgetStore();
    useNotices.setState({ notices: [] });
    fake = fakeClient();
    off = connectBudget(fake.client);
  });
  afterEach(() => off());

  it('a startup read the host refused is made again once the host is ready', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await fake.fail('engine.budget', 'engine-host is starting');
    expect(warn).toHaveBeenCalledExactlyOnceWith('[budget] engine.budget unavailable', { code: 'internal', message: 'engine-host is starting' });
    warn.mockRestore();
    expect(useBudget.getState().state).toBeNull();
    host('ready', 2);
    expect(fake.pending('engine.budget')).toBe(1);
    await fake.reply('engine.budget', state());
    expect(useBudget.getState().state).toEqual(state());
  });

  it('a host that goes away clears its over-budget state and banner; the restarted host is read afresh', async () => {
    await fake.reply('engine.budget', over([A, B]));
    expect(banners()).toHaveLength(1);
    host('crashed', 3);
    expect(useBudget.getState().state).toBeNull();
    expect(banners()).toEqual([]);
    host('restarting', 4);
    host('ready', 5);
    await fake.reply('engine.budget', state());
    expect(useBudget.getState().state).toEqual(state());
    expect(banners()).toEqual([]);
  });

  it('an event of the new generation wins over its snapshot, and a late answer of an old generation is dropped', async () => {
    await fake.reply('engine.budget', state());
    host('ready', 2); // a restart the page saw only as ready: read again
    host('crashed', 3);
    host('ready', 4);
    fake.event('engine.budget', state({ totalKiB: 5 * GiB }));
    await fake.reply('engine.budget', state({ totalKiB: 1 * GiB })); // generation 2's answer
    await fake.reply('engine.budget', state({ totalKiB: 2 * GiB })); // generation 4's, overtaken by its event
    expect(useBudget.getState().state?.totalKiB).toBe(5 * GiB);
  });
});
