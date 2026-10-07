import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_HANDBACK_IDLE_MS, DEFAULT_PARTITION, type BrowserControl } from '@shared/browser/tab';
import { BROWSER_AGENT_IDLE_MS, type BrowserWaitReason } from '@shared/maws/browser';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { TabInputSeam } from '../input';
import { TabStore, type TabEntry } from '../tabs';
import { personHolds, TabControls } from './control';

// Design §8's table, row by row, over E4a's real TabStore and input seam with vitest's fake clock: who drives the page,
// the two timers, the pause point's wait (`pause`, `whenReleased`), background throttling while the agent acts, and
// what a closed tab leaves behind (A-31, A-33; Decision Log 4, 27).

const A = 'App-A' as AppSessionId;
const T0 = Date.parse('2026-10-07T09:00:00.000Z');

function harness() {
  vi.useFakeTimers({ now: T0 });
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  const throttling: boolean[][] = [];
  const store = new TabStore({
    emit,
    createView: () => {
      const calls: boolean[] = [];
      throttling.push(calls);
      return { webContents: { loadURL: () => Promise.resolve(), close: () => {}, isDestroyed: () => false, setBackgroundThrottling: (on: boolean) => void calls.push(on) } } as unknown as WebContentsView;
    },
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: Date.now,
  });
  const controls = new TabControls({ store });
  const changes: [string, BrowserControl, BrowserControl][] = [];
  controls.onChange((entry, from) => void changes.push([entry.tab.tabId, from, entry.tab.control]));
  const open = () => {
    const { tabId } = store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab;
    return store.entry(tabId)!;
  };
  const human = (entry: TabEntry, kind: 'mouse' | 'key' | 'wheel' = 'mouse') => entry.input.emit({ kind, source: 'human', at: Date.now() });
  const agent = (entry: TabEntry) => entry.input.emit({ kind: 'mouse', source: 'agent', at: Date.now() });
  const changed = () => emitted.filter((e) => e.name === 'browser.control.changed').map((e) => (e.payload as EventPayload<'browser.control.changed'>).control);
  const reports: (BrowserWaitReason | null)[] = [];
  const report = (reason: BrowserWaitReason | null) => void reports.push(reason);
  return { store, controls, emitted, changes, open, human, agent, changed, throttling, reports, report };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

// Every subscription to a tab's input seam, and every unsubscription, per seam (set before the tabs are made).
function inputSubscriptions() {
  const original = TabInputSeam.prototype.on;
  const subscribed: TabInputSeam[] = [];
  const unsubscribed: TabInputSeam[] = [];
  vi.spyOn(TabInputSeam.prototype, 'on').mockImplementation(function (this: TabInputSeam, listener) {
    subscribed.push(this);
    const off = original.call(this, listener);
    return () => {
      unsubscribed.push(this);
      off();
    };
  });
  return { subscribed, unsubscribed };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('human input (Design §8, rows 1 and 2; Decision Log 4)', () => {
  it('a click on a tab no agent holds and no request awaits stays idle: lastHumanAt stamped, nothing emitted', () => {
    const h = harness();
    const entry = h.open();
    h.human(entry);
    expect(entry.tab.control).toBe('idle');
    expect(entry.input.lastHumanAt).toBe(T0);
    expect(h.changed()).toEqual([]);
  });

  it('a click while a request is pending enters human, stamped and told; 3 s without input returns it to idle', () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    vi.advanceTimersByTime(500);
    h.human(entry);
    expect(entry.tab).toMatchObject({ control: 'human', controlSince: new Date(T0 + 500).toISOString() });
    expect(h.changed()).toEqual(['human']);
    vi.advanceTimersByTime(BROWSER_HANDBACK_IDLE_MS - 1);
    expect(entry.tab.control).toBe('human');
    vi.advanceTimersByTime(1);
    expect(entry.tab.control).toBe('idle');
    expect(h.changed()).toEqual(['human', 'idle']);
  });

  it('every further human input re-arms the hand-back timer, wheels and keys included', () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    vi.advanceTimersByTime(2000);
    h.human(entry, 'wheel');
    vi.advanceTimersByTime(2000);
    h.human(entry, 'key');
    vi.advanceTimersByTime(2999);
    expect(entry.tab.control).toBe('human');
    vi.advanceTimersByTime(1);
    expect(entry.tab.control).toBe('idle');
    expect(h.changed()).toEqual(['human', 'idle']);
  });

  it("a click while the agent holds the tab enters human and stops the agent-idle lapse; the agent's own input changes nothing", () => {
    const h = harness();
    const entry = h.open();
    h.controls.markActing(entry);
    h.controls.actionEnded(entry);
    h.agent(entry); // CDP input, attributed to the agent by E4a's table: never takes the page
    expect(entry.tab.control).toBe('agent');
    vi.advanceTimersByTime(1000);
    h.human(entry); // the human's press during (or right after) the agent's
    expect(entry.tab.control).toBe('human');
    h.agent(entry);
    expect(entry.tab.control).toBe('human');
    vi.advanceTimersByTime(BROWSER_HANDBACK_IDLE_MS);
    expect(entry.tab.control).toBe('idle');
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS); // the old lapse fires into nothing
    expect(h.changed()).toEqual(['agent', 'human', 'idle']);
  });

  it('a request that ends while the person holds the page leaves them holding it until the timer', () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    h.controls.requestPending(entry, -1);
    expect(entry.tab.control).toBe('human');
    vi.advanceTimersByTime(BROWSER_HANDBACK_IDLE_MS);
    expect(entry.tab.control).toBe('idle');
  });
});

describe('the pause point (Design §6 step 3, §8 row 3; Decision Log 27)', () => {
  it('passes at once when nobody used the page in the last 3 s, touching nothing', async () => {
    const h = harness();
    const entry = h.open();
    h.human(entry);
    vi.advanceTimersByTime(BROWSER_HANDBACK_IDLE_MS);
    await expect(h.controls.pause(entry, new AbortController().signal, h.report)).resolves.toEqual({ waitedFor: null, waitedMs: null });
    expect(entry.tab.control).toBe('idle');
    expect(h.reports).toEqual([]);
  });

  it('an action within 3 s of a click on an idle tab enters human, reports it, and waits out the rest of the 3 s', async () => {
    const h = harness();
    const entry = h.open();
    h.human(entry);
    vi.advanceTimersByTime(1000);
    vi.setSystemTime(T0 + 1000.4); // the clock between milliseconds: waitedMs is still an integer (Decision Log 44 (b))
    let waited: unknown = null;
    void h.controls.pause(entry, new AbortController().signal, h.report).then((w) => (waited = w));
    expect(entry.tab.control).toBe('human');
    expect(h.reports).toEqual(['human']);
    await vi.advanceTimersByTimeAsync(1998);
    expect(waited).toBeNull();
    await vi.advanceTimersByTimeAsync(2);
    expect(entry.tab.control).toBe('idle');
    expect(waited).toEqual({ waitedFor: 'human', waitedMs: 2000 });
    expect(Number.isInteger((waited as { waitedMs: number }).waitedMs)).toBe(true);
    expect(h.reports).toEqual(['human', null]);
  });

  it('a pause under human resolves at the chrome\'s Hand back (E4a sets idle) and the timer is cleared', async () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    const paused = h.controls.pause(entry, new AbortController().signal, h.report);
    await vi.advanceTimersByTimeAsync(1500);
    h.store.setControl(entry.tab.tabId, 'idle'); // register.ts's browser.control.handBack
    await expect(paused).resolves.toEqual({ waitedFor: 'human', waitedMs: 1500 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('an abort while waiting rejects with the signal\'s reason; the person keeps the page until the timer', async () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    const controller = new AbortController();
    const paused = h.controls.pause(entry, controller.signal, h.report);
    const reason = new Error('cancelled');
    controller.abort(reason);
    await expect(paused).rejects.toBe(reason);
    expect(h.reports).toEqual(['human', null]);
    expect(entry.tab.control).toBe('human');
    vi.advanceTimersByTime(BROWSER_HANDBACK_IDLE_MS);
    expect(entry.tab.control).toBe('idle');
  });

  it('an already aborted request never enters human', async () => {
    const h = harness();
    const entry = h.open();
    h.human(entry);
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    await expect(h.controls.pause(entry, controller.signal, h.report)).rejects.toThrow('gone');
    expect(entry.tab.control).toBe('idle');
  });

  it('whenReleased resolves at once off human and when control leaves human', async () => {
    const h = harness();
    const entry = h.open();
    await expect(h.controls.whenReleased(entry, new AbortController().signal)).resolves.toBeUndefined();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    let released = false;
    void h.controls.whenReleased(entry, new AbortController().signal).then(() => (released = true));
    await vi.advanceTimersByTimeAsync(BROWSER_HANDBACK_IDLE_MS - 1);
    expect(released).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(released).toBe(true);
  });
});

describe('the agent (Design §8 rows 6 to 8; Design §9 throttling)', () => {
  it('markActing marks the agent, stamped, and turns background throttling off; 10 s after the action ended it lapses to idle and throttling returns', () => {
    const h = harness();
    const entry = h.open();
    vi.advanceTimersByTime(250);
    h.controls.markActing(entry);
    expect(entry.tab).toMatchObject({ control: 'agent', controlSince: new Date(T0 + 250).toISOString() });
    expect(h.throttling[0]).toEqual([false]);
    h.controls.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS - 1);
    expect(entry.tab.control).toBe('agent');
    vi.advanceTimersByTime(1);
    expect(entry.tab.control).toBe('idle');
    expect(h.throttling[0]).toEqual([false, true]);
    expect(h.changed()).toEqual(['agent', 'idle']);
  });

  it('a second action before the lapse keeps the agent without flicker, and re-asserts throttling off (lost on navigation)', () => {
    const h = harness();
    const entry = h.open();
    h.controls.markActing(entry);
    h.controls.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS - 1000);
    h.controls.markActing(entry);
    vi.advanceTimersByTime(5000);
    h.controls.actionEnded(entry);
    vi.advanceTimersByTime(BROWSER_AGENT_IDLE_MS - 1);
    expect(entry.tab.control).toBe('agent');
    vi.advanceTimersByTime(1);
    expect(h.changed()).toEqual(['agent', 'idle']);
    expect(h.throttling[0]).toEqual([false, false, true]);
  });

  it('a pause point with the person holding a tab the agent held: human, then the agent again once released', async () => {
    const h = harness();
    const entry = h.open();
    h.controls.markActing(entry);
    h.controls.actionEnded(entry);
    h.controls.requestPending(entry, 1);
    h.human(entry);
    expect(h.throttling[0]).toEqual([false, true]); // leaving the agent restores throttling
    const paused = h.controls.pause(entry, new AbortController().signal, h.report);
    await vi.advanceTimersByTimeAsync(BROWSER_HANDBACK_IDLE_MS);
    await expect(paused).resolves.toEqual({ waitedFor: 'human', waitedMs: BROWSER_HANDBACK_IDLE_MS });
    h.controls.markActing(entry);
    expect(h.changed()).toEqual(['agent', 'human', 'idle', 'agent']);
  });

  it('onChange hears every transition with the state it left, and pending changes with the current one', () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.controls.markActing(entry);
    h.controls.requestPending(entry, -1);
    expect(h.controls.pending(entry)).toBe(0);
    expect(h.changes).toEqual([
      [entry.tab.tabId, 'idle', 'idle'],
      [entry.tab.tabId, 'idle', 'agent'],
      [entry.tab.tabId, 'agent', 'agent'],
    ]);
  });
});

describe('personHolds (Design §6 step 3, §8): the one statement of the rule', () => {
  it('holds while human, and within 3 s of the person\'s last input whatever the state', () => {
    const h = harness();
    const entry = h.open();
    expect(personHolds(entry, Date.now())).toBe(false);
    h.human(entry);
    expect(personHolds(entry, Date.now() + BROWSER_HANDBACK_IDLE_MS - 1)).toBe(true);
    expect(personHolds(entry, Date.now() + BROWSER_HANDBACK_IDLE_MS)).toBe(false);
    h.store.setControl(entry.tab.tabId, 'human');
    expect(personHolds(entry, Date.now() + 60_000)).toBe(true);
    expect(h.controls.personHolds(entry)).toBe(true);
  });
});

describe('a closed tab (Design §8 last row, §11)', () => {
  it('clears its timers and lets go of its input seam: nothing fires into, or keeps, a tab the store no longer has', async () => {
    const subscriptions = inputSubscriptions();
    const h = harness();
    const human = h.open();
    h.controls.requestPending(human, 1);
    h.human(human);
    const agent = h.open();
    h.controls.markActing(agent);
    h.controls.actionEnded(agent);
    expect(vi.getTimerCount()).toBe(2);
    h.store.close(human.tab.tabId);
    h.store.close(agent.tab.tabId);
    await Promise.resolve(); // the close is known once the store has dropped the entry
    expect(vi.getTimerCount()).toBe(0);
    expect(subscriptions.unsubscribed).toEqual([human.input, agent.input]);
    h.controls.actionEnded(agent); // a late call for the closed tab subscribes nothing again
    expect(subscriptions.subscribed).toEqual([human.input, agent.input]);
    expect(h.changed()).toEqual(['human', 'agent']);
  });

  it('a pause waiting on the person rejects once the request\'s controller is aborted for the close (index.ts answers tabClosed)', async () => {
    const h = harness();
    const entry = h.open();
    h.controls.requestPending(entry, 1);
    h.human(entry);
    const controller = new AbortController();
    const paused = h.controls.pause(entry, controller.signal, h.report);
    h.store.close(entry.tab.tabId);
    controller.abort(new Error('tabClosed'));
    await expect(paused).rejects.toThrow('tabClosed');
    await flush();
  });

  it('a suspended and resumed tab keeps one input subscription', async () => {
    const subscriptions = inputSubscriptions();
    const h = harness();
    const entry = h.open();
    h.store.suspend(entry.tab.tabId);
    await Promise.resolve();
    h.store.load(entry.tab.tabId, 'https://a.test/');
    expect(subscriptions.subscribed).toEqual([entry.input]);
    expect(subscriptions.unsubscribed).toEqual([]);
    h.controls.requestPending(entry, 1);
    h.human(entry);
    expect(h.changed()).toEqual(['human']);
  });
});
