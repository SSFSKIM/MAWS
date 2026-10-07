import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId, RequestId } from '@shared/graph/ids';
import { DEFAULT_PARTITION, type BrowserTab } from '@shared/browser/tab';
import type { EventName, EventPayload, HostState } from '@shared/ipc/schema';
import type { MawsBrowserAnswerResult, MawsBrowserRequest } from '@shared/ipc/schema/maws';
import { BROWSER_AGENT_IDLE_MS, BROWSER_TOOL_ERRORS } from '@shared/maws/browser';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { TabStore } from '../tabs';
import type { BrowserCall, CallContext } from './handlers';
import { BrowserRequests, e2eTabIds, provisionalControl, reachableSessions, startBrowserAgent, waitingReporter } from './index';

// The request lifecycle in main (E4c Design §4 "Every request has an AbortController", Interfaces "Main"): one request
// at a time per tab, the host's cancel, the tab's close, the engine host's connection going (Decision Log 46: the host
// settles its own calls `appNotOpen` then and sends no cancel, so main must stop on its own), and what is answered.

const A = 'App-A' as AppSessionId;
const rid = (n: number) => `req-${n}` as RequestId;
const request = (n: number, tool: MawsBrowserRequest['tool'], args: unknown, appSessionId = A): MawsBrowserRequest => ({ appSessionId, requestId: rid(n), toolUseId: null, tool, args });

const TAB = 'b_000000000001';
const OTHER = 'b_000000000002';
const FOREIGN = 'b_000000000003'; // another session's tab

// A run the test settles by hand, with the context it was given.
function deferredRuns() {
  const runs: { call: BrowserCall; ctx: CallContext; settle(result: MawsBrowserAnswerResult | null): void }[] = [];
  const run = vi.fn(
    (call: BrowserCall, ctx: CallContext) =>
      new Promise<MawsBrowserAnswerResult | null>((resolve) => {
        runs.push({ call, ctx, settle: resolve });
      }),
  );
  return { runs, run };
}

function harness() {
  const { runs, run } = deferredRuns();
  const answers: { call: BrowserCall; result: MawsBrowserAnswerResult }[] = [];
  const reports: [string, string, unknown][] = [];
  const pending = vi.fn();
  const entries = new Map([TAB, OTHER, FOREIGN].map((tabId) => [tabId, { tab: { tabId } }]));
  const requests = new BrowserRequests({
    run,
    answer: (call, result) => void answers.push({ call, result }),
    report: (call, tabId, reason) => void reports.push([call.requestId, tabId, reason]),
    control: { requestPending: pending },
    store: { entry: (tabId: string) => entries.get(tabId) as never },
    reaches: (appSessionId, tabId) => entries.has(tabId) && (tabId === FOREIGN ? appSessionId === 'App-B' : appSessionId === A),
    now: () => 5_000,
  });
  return { requests, runs, run, answers, reports, pending, entries };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const OK = (n: number): MawsBrowserAnswerResult => ({ ok: true, result: { n } });

afterEach(() => {
  vi.useRealTimers();
});

describe('BrowserRequests: running and answering', () => {
  it('runs a request with its parsed arguments and answers the host', async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'https://example.com' }), 'host');
    await flush();
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0].call).toMatchObject({ appSessionId: A, requestId: rid(1), tool: 'browser_navigate', args: { tabId: TAB, url: 'https://example.com' } }); // validators never transform
    expect(h.runs[0].ctx.startedAt).toBe(5_000);
    h.runs[0].ctx.waiting(TAB, 'human');
    expect(h.reports).toEqual([[rid(1), TAB, 'human']]);
    h.runs[0].settle(OK(1));
    await flush();
    expect(h.answers).toEqual([{ call: h.runs[0].call, result: OK(1) }]);
    expect(h.pending.mock.calls.map(([entry, delta]) => [entry.tab.tabId, delta])).toEqual([
      [TAB, 1],
      [TAB, -1],
    ]);
  });

  it('answers arguments main refuses without running anything', async () => {
    const h = harness();
    await h.requests.accept(request(1, 'browser_tabs', { action: 'open' }), 'host');
    expect(h.run).not.toHaveBeenCalled();
    expect(h.answers[0].result).toEqual({ ok: false, error: TOOL_ERRORS.invalidArguments('browser_tabs', 'url: open needs a url') });
  });

  it("answers tabNotFound at once for a tab the session does not reach, never queuing on it nor counting it pending (P-21)", async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: FOREIGN, url: 'reload' }, 'App-B' as AppSessionId), 'host'); // its owner's request
    await flush();
    const refused = await h.requests.accept(request(2, 'browser_navigate', { tabId: FOREIGN, url: 'reload' }), 'host');
    expect(refused).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_navigate', FOREIGN) });
    expect(h.answers.map(({ call, result }) => [call.requestId, result])).toEqual([[rid(2), refused]]);
    // answered while the owner's request still runs on that tab: never queued behind it, never counted on it
    expect(h.runs.map(({ call }) => call.requestId)).toEqual([rid(1)]);
    expect(h.pending.mock.calls.map(([entry, delta]) => [entry.tab.tabId, delta])).toEqual([[FOREIGN, 1]]);
    expect(await h.requests.accept(request(3, 'browser_navigate', { tabId: 'b_00000000dead', url: 'reload' }), 'seam')).toEqual({
      ok: false,
      error: BROWSER_TOOL_ERRORS.tabNotFound('browser_navigate', 'b_00000000dead'),
    });
  });

  it('runs one request at a time per tab, and different tabs side by side', async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(2, 'browser_navigate', { tabId: TAB, url: 'back' }), 'host');
    void h.requests.accept(request(3, 'browser_navigate', { tabId: OTHER, url: 'reload' }), 'host');
    void h.requests.accept(request(4, 'browser_tabs', { action: 'list' }), 'host');
    await flush();
    expect(h.runs.map(({ call }) => call.requestId).sort()).toEqual([rid(1), rid(3), rid(4)]);
    h.runs.find(({ call }) => call.requestId === rid(1))!.settle(OK(1));
    await flush();
    expect(h.runs.map(({ call }) => call.requestId).at(-1)).toBe(rid(2));
  });

  it('keeps the queue moving after a run that throws, answering actionFailed for it', async () => {
    const h = harness();
    h.run.mockImplementationOnce(() => Promise.reject(new Error('boom\n  at somewhere')));
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(2, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    await flush();
    expect(h.answers[0].result).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.actionFailed('browser_navigate', 'reload', '', 'boom') });
    expect(h.runs.map(({ call }) => call.requestId)).toEqual([rid(2)]);
  });

  it('answers a seam run to its caller, never to the host', async () => {
    const h = harness();
    const answer = h.requests.accept(request(1, 'browser_tabs', { action: 'list' }), 'seam');
    await flush();
    h.runs[0].ctx.waiting(TAB, 'cover');
    h.runs[0].settle(OK(1));
    expect(await answer).toEqual(OK(1));
    expect(h.answers).toEqual([]);
    expect(h.reports).toEqual([[rid(1), TAB, 'cover']]); // the progress the e2e listens to still goes out
  });
});

describe('BrowserRequests: ending a request', () => {
  it("the host's cancel aborts a running request and nothing is answered, even when its run answers", async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    await flush();
    expect(h.requests.cancel(A, rid(1))).toBe(true);
    expect(h.runs[0].ctx.signal.aborted).toBe(true);
    h.runs[0].settle(OK(1)); // a dispatched action that completed anyway: its answer is discarded
    await flush();
    expect(h.answers).toEqual([]);
    expect(h.requests.cancel(A, rid(1))).toBe(false);
  });

  it('drops a cancelled request still in the queue unrun', async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(2, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    await flush();
    h.requests.cancel(A, rid(2));
    h.runs[0].settle(OK(1));
    await flush();
    expect(h.runs).toHaveLength(1);
    expect(h.answers.map(({ call }) => call.requestId)).toEqual([rid(1)]);
  });

  it("ignores a cancel naming another session's request", async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_tabs', { action: 'list' }), 'host');
    await flush();
    expect(h.requests.cancel('App-B' as AppSessionId, rid(1))).toBe(false);
    expect(h.runs[0].ctx.signal.aborted).toBe(false);
  });

  it("answers tabClosed for the tab's running and queued requests when it closes", async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(2, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(3, 'browser_navigate', { tabId: OTHER, url: 'reload' }), 'host');
    await flush();
    h.requests.abortTab(TAB);
    h.runs[0].settle(null); // its wait rejected on the abort
    await flush();
    expect(h.answers.map(({ call, result }) => [call.requestId, result])).toEqual([
      [rid(1), { ok: false, error: BROWSER_TOOL_ERRORS.tabClosed('browser_navigate', TAB) }],
      [rid(2), { ok: false, error: BROWSER_TOOL_ERRORS.tabClosed('browser_navigate', TAB) }],
    ]);
    expect(h.runs[1].ctx.signal.aborted).toBe(false); // the other tab's request runs on
  });

  it('aborts every running and queued request, answering none, when the engine host goes (Decision Log 46)', async () => {
    const h = harness();
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(2, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    void h.requests.accept(request(3, 'browser_tabs', { action: 'list' }), 'host');
    await flush();
    h.requests.abortAll();
    expect(h.runs.map(({ ctx }) => ctx.signal.aborted)).toEqual([true, true]);
    for (const run of h.runs) run.settle(OK(0));
    await flush();
    expect(h.runs).toHaveLength(2); // the queued one never ran
    expect(h.answers).toEqual([]);
    expect(h.requests.pendingFor(TAB)).toBe(false);
  });

  it('says whether a tab has a request pending (the driver never idles one out from under it)', async () => {
    const h = harness();
    expect(h.requests.pendingFor(TAB)).toBe(false);
    void h.requests.accept(request(1, 'browser_navigate', { tabId: TAB, url: 'reload' }), 'host');
    await flush();
    expect(h.requests.pendingFor(TAB)).toBe(true);
    h.runs[0].settle(OK(1));
    await flush();
    expect(h.requests.pendingFor(TAB)).toBe(false);
  });
});

describe('reachableSessions (P-24, Decision Log 29)', () => {
  const T = 'App-T' as AppSessionId;
  it('reaches a side thread and its parent; a fork, a plain session or an unreadable index reach themselves', () => {
    const records: Record<string, unknown> = {
      [T]: { lineage: { kind: 'side-thread', parentAppSessionId: A } },
      'App-F': { lineage: { kind: 'fork', parentAppSessionId: A } },
      [A]: { lineage: null },
    };
    const sessions = { get: (id: AppSessionId) => (records[id] ?? null) as never };
    expect(reachableSessions(sessions, T)).toEqual([T, A]);
    expect(reachableSessions(sessions, 'App-F' as AppSessionId)).toEqual(['App-F']);
    expect(reachableSessions(sessions, A)).toEqual([A]);
    expect(reachableSessions(sessions, 'App-unknown' as AppSessionId)).toEqual(['App-unknown']);
    const broken = {
      get: () => {
        throw new Error('index unavailable');
      },
    };
    expect(reachableSessions(broken, T)).toEqual([T]);
  });
});

describe('e2eTabIds (Design §13 (b); Decision Log 36)', () => {
  it('mints b_000000000001 upward under MAWS_E2E=1, above any sequence id restored, and nothing otherwise', () => {
    expect(e2eTabIds({}, [])).toBeUndefined();
    const fresh = e2eTabIds({ MAWS_E2E: '1' }, [])!;
    expect([fresh(), fresh()]).toEqual(['b_000000000001', 'b_000000000002']);
    const restored = e2eTabIds({ MAWS_E2E: '1' }, [{ tabId: 'b_000000000007' }, { tabId: 'b_3fa9c0de12ab' }])!;
    expect(restored()).toBe('b_000000000008');
  });
});

describe('provisionalControl (until Task 2.4)', () => {
  it("marks the agent's tab and lets it lapse to idle 10 s after the action ends", () => {
    vi.useFakeTimers();
    const tab = { tabId: TAB, control: 'idle' } as BrowserTab;
    const entry = { tab } as never;
    const setControl = vi.fn((_tabId: string, control: BrowserTab['control']) => void (tab.control = control));
    const control = provisionalControl({ setControl, entry: () => entry });
    control.markActing(entry);
    expect(setControl).toHaveBeenLastCalledWith(TAB, 'agent');
    control.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS - 1);
    control.markActing(entry); // a next action in time keeps it
    control.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS - 1);
    expect(tab.control).toBe('agent');
    vi.advanceTimersByTime(1);
    expect(setControl).toHaveBeenLastCalledWith(TAB, 'idle');
  });
});

describe('waitingReporter (the host\'s paused deadline and the row\'s waiting line, Design §10)', () => {
  it('tells the host about a host request and the windows about every request', () => {
    const dispatch = vi.fn(() => Promise.resolve({ ok: true }) as never);
    const emitted: unknown[] = [];
    const report = waitingReporter({ hosts: { dispatch }, emit: ((name: string, payload: unknown) => void emitted.push([name, payload])) as never, now: () => Date.parse('2026-10-07T00:00:00.000Z') });
    const call = { appSessionId: A, requestId: rid(9), toolUseId: 'toolu_1', tool: 'browser_act' } as unknown as BrowserCall;
    report(call, TAB, 'human', 'host');
    report(call, TAB, null, 'seam');
    expect(dispatch.mock.calls).toEqual([['engine-host', 'maws.browser.waiting', { appSessionId: A, requestId: rid(9), waiting: 'human' }]]);
    expect(emitted).toEqual([
      ['maws.browser.progress', { appSessionId: A, toolUseId: 'toolu_1', tabId: TAB, tool: 'browser_act', waiting: 'human', since: '2026-10-07T00:00:00.000Z' }],
      ['maws.browser.progress', { appSessionId: A, toolUseId: 'toolu_1', tabId: TAB, tool: 'browser_act', waiting: null, since: '2026-10-07T00:00:00.000Z' }],
    ]);
  });
});

// The wiring: the host's events in, the commands out, the tab's close and the host's state, over E4a's real store.
describe('startBrowserAgent', () => {
  class FakeWebContents extends EventEmitter {
    readonly loadURL = vi.fn(() => Promise.resolve());
    readonly close = vi.fn();
    readonly isDestroyed = () => false;
    readonly isLoading = () => false;
  }

  function wired() {
    const emitted: { name: EventName; payload: unknown }[] = [];
    const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
    let ids = 0;
    const store = new TabStore({
      emit,
      createView: () => ({ webContents: new FakeWebContents() }) as unknown as WebContentsView,
      resolvePartition: () => DEFAULT_PARTITION,
      newTabId: () => `b_${String(++ids).padStart(12, '0')}`,
      schedule: () => {},
    });
    const listeners = new Map<string, (payload: never) => void>();
    const stateListeners = new Set<(state: HostState) => void>();
    const dispatched: [string, unknown][] = [];
    const hosts = {
      onEvent: vi.fn((name: string, listener: (payload: never) => void) => {
        listeners.set(name, listener);
        return () => void listeners.delete(name);
      }),
      dispatch: vi.fn(async (_owner: string, name: string, input: unknown) => {
        dispatched.push([name, input]);
        return { ok: true, value: { outcome: 'delivered' } } as never;
      }),
      onState: vi.fn((_owner: string, listener: (state: HostState) => void) => {
        stateListeners.add(listener);
        return () => void stateListeners.delete(listener);
      }),
    };
    const drivers = { for: vi.fn(), state: vi.fn(() => 'none' as const), close: vi.fn(async () => {}), retire: vi.fn(async () => {}), stop: vi.fn(async () => {}) };
    const agent = startBrowserAgent({
      store,
      navigator: { navigate: vi.fn(() => true) },
      onDownloadRefused: () => () => {},
      sessions: { get: (id: AppSessionId) => (id === THREAD ? ({ lineage: { kind: 'side-thread', parentAppSessionId: A } } as never) : null) },
      hosts: hosts as never,
      emit,
      env: {},
      drivers,
    });
    const send = (name: string, payload: unknown) => listeners.get(name)!(payload as never);
    const hostState = (state: HostState['state']) => {
      for (const listener of stateListeners) listener({ state, pid: null, restarts: 0, revision: 1 });
    };
    return { store, agent, send, hostState, dispatched, listeners, emitted, drivers };
  }

  const THREAD = 'App-Thread' as AppSessionId;
  const status = (appSessionId: AppSessionId, process: string) => ({ appSessionId, status: { appSessionId, process } });

  it("retires the drivers of an exited session's tabs at once, but not one another session still has a request on (Design §4)", async () => {
    const w = wired();
    const mine = w.store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    const busy = w.store.open({ appSessionId: A, url: 'https://b.test/', select: false }).tab.tabId;
    const theirs = w.store.open({ appSessionId: 'App-B' as AppSessionId, url: 'https://c.test/', select: true }).tab.tabId;
    // a side thread of A is navigating in A's second tab
    w.send('maws.browser.request', request(1, 'browser_navigate', { tabId: busy, url: 'https://d.test/' }, THREAD));
    await flush();
    w.send('session.status', status(A, 'ready'));
    expect(w.drivers.retire).not.toHaveBeenCalled();
    w.send('session.status', status(A, 'exited'));
    expect(w.drivers.retire.mock.calls).toEqual([[mine]]);
    expect(w.drivers.retire).not.toHaveBeenCalledWith(theirs);
    await w.agent.stop();
  });

  it("answers tabNotFound for another session's tab without queuing on it", async () => {
    const w = wired();
    const theirs = w.store.open({ appSessionId: 'App-B' as AppSessionId, url: 'https://c.test/', select: true }).tab.tabId;
    w.send('maws.browser.request', request(1, 'browser_navigate', { tabId: theirs, url: 'reload' }));
    await vi.waitFor(() => expect(w.dispatched).toHaveLength(1));
    expect(w.dispatched[0]).toEqual(['maws.browser.answer', { appSessionId: A, requestId: rid(1), result: { ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_navigate', theirs) } }]);
    await w.agent.stop();
  });

  it("answers maws.browser.request through maws.browser.answer, and stops listening at stop", async () => {
    const w = wired();
    const tabId = w.store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    w.send('maws.browser.request', request(1, 'browser_tabs', { action: 'list' }));
    await vi.waitFor(() => expect(w.dispatched).toHaveLength(1));
    expect(w.dispatched[0]).toEqual([
      'maws.browser.answer',
      { appSessionId: A, requestId: rid(1), result: { ok: true, result: expect.objectContaining({ action: 'list', tabs: [expect.objectContaining({ tabId })] }) } },
    ]);
    await w.agent.stop();
    expect(w.listeners.size).toBe(0);
  });

  it('a request the host cancels, or that the engine host stops waiting for, answers nothing', async () => {
    const w = wired();
    const tabId = w.store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    w.send('maws.browser.request', request(1, 'browser_navigate', { tabId, url: 'https://b.test/' }));
    w.send('maws.browser.request', request(2, 'browser_navigate', { tabId, url: 'https://c.test/' }));
    await flush();
    w.send('maws.browser.cancel', { appSessionId: A, requestId: rid(1) });
    await flush();
    w.hostState('restarting');
    await flush();
    expect(w.dispatched).toEqual([]);
    await w.agent.stop();
  });

  it("answers tabClosed for a request whose tab the person closes, and closes the tab's driver", async () => {
    const w = wired();
    const tabId = w.store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    w.send('maws.browser.request', request(1, 'browser_navigate', { tabId, url: 'https://b.test/' }));
    await flush();
    w.store.close(tabId);
    await vi.waitFor(() => expect(w.dispatched).toHaveLength(1));
    expect(w.dispatched[0]).toEqual(['maws.browser.answer', { appSessionId: A, requestId: rid(1), result: { ok: false, error: BROWSER_TOOL_ERRORS.tabClosed('browser_navigate', tabId) } }]);
    expect(w.drivers.close).toHaveBeenCalledWith(tabId);
    await w.agent.stop();
  });


  it('runs a seam request without the host, and reads the tab for the e2e', async () => {
    const w = wired();
    const tabId = w.store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId;
    const answer = await w.agent.seam.run(A, 'browser_tabs', { action: 'list' });
    expect(answer).toMatchObject({ ok: true, result: { action: 'list' } });
    expect(w.dispatched).toEqual([]);
    expect(w.agent.seam.control(tabId)).toEqual({ control: 'idle', controlSince: expect.any(String) });
    expect(w.agent.seam.control('b_00000000dead')).toBeNull();
    expect(w.agent.seam.driverState(tabId)).toBe('none');
    w.store.entry(tabId)!.input.emit({ kind: 'mouse', source: 'human', at: 7 });
    expect(w.agent.seam.lastInputs(tabId)).toEqual([{ kind: 'mouse', source: 'human', at: 7 }]);
    await w.agent.stop();
  });
});
