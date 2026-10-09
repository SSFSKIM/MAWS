import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_AGENT_IDLE_MS } from '@shared/browser/tab';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { TabControls } from '../agent/control';
import { TabStore } from '../tabs';
import { AgentPresence, BROWSER_TAKEOVER_HOLD_MS, CURSOR_HIDE_GRACE_MS, PERSON_USING_TAB, PersonUsingTab } from './presence';

// Control by lease and the takeover gate (the in-app browser spec of 2026-10-08, "Who drives the tab", "Takeover",
// "Cursor"), over MAWS's real TabStore and TabControls with fake timers.

const A = 'A' as AppSessionId;

afterEach(() => vi.useRealTimers());

function stand() {
  vi.useFakeTimers({ now: Date.parse('2026-10-08T10:00:00.000Z') });
  const store = new TabStore({
    emit: () => undefined,
    createView: () => ({ webContents: Object.assign(new EventEmitter(), { loadURL: () => Promise.resolve(), close() {}, isDestroyed: () => false, setBackgroundThrottling() {} }) }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    schedule: () => {},
    now: Date.now,
  });
  const controls = new TabControls({ store });
  const cursor = { move: vi.fn(), hide: vi.fn() };
  const presence = new AgentPresence({ controls, cursor, store });
  const entry = store.entry(store.open({ appSessionId: A, url: 'https://a.test/', select: true }).tab.tabId)!;
  const touch = () => entry.input.emit({ kind: 'mouse', source: 'human', at: Date.now() });
  const gate = (deadline = 10_000, signal = new AbortController().signal) => {
    const outcome = presence.beforeActing(entry, deadline, signal).then(() => 'sent', (error: Error) => error.message);
    return outcome;
  };
  return { store, controls, cursor, presence, entry, touch, gate };
}

describe('control follows the lease', () => {
  it('an acting command makes the tab the agent\'s; the agent-idle timer, re-armed by each, returns it to idle', async () => {
    const s = stand();
    expect(await s.gate()).toBe('sent');
    expect(s.entry.tab.control).toBe('agent');
    s.presence.acted(s.entry);
    await vi.advanceTimersByTimeAsync(BROWSER_AGENT_IDLE_MS - 1);
    expect(await s.gate()).toBe('sent');
    s.presence.acted(s.entry);
    await vi.advanceTimersByTimeAsync(BROWSER_AGENT_IDLE_MS - 1);
    expect(s.entry.tab.control).toBe('agent');
    await vi.advanceTimersByTimeAsync(1);
    expect(s.entry.tab.control).toBe('idle');
  });

  it('releasing the lease returns the tab to idle and hides the cursor', async () => {
    const s = stand();
    await s.gate();
    s.presence.released(s.entry);
    expect(s.entry.tab.control).toBe('idle');
    expect(s.cursor.hide).toHaveBeenCalledWith(s.entry);
  });

  it('cursor.move draws where the agent aims, except while the person holds the tab', () => {
    const s = stand();
    s.presence.cursorMove(s.entry, 10, 20);
    expect(s.cursor.move).toHaveBeenCalledWith(s.entry, 10, 20);
    s.store.setControl(s.entry.tab.tabId, 'human');
    s.presence.cursorMove(s.entry, 30, 40);
    expect(s.cursor.move).toHaveBeenCalledTimes(1);
  });
});

describe('the takeover gate', () => {
  it(`while the person holds the tab an acting command waits at most ${BROWSER_TAKEOVER_HOLD_MS} ms, then is refused`, async () => {
    const s = stand();
    s.touch();
    s.store.setControl(s.entry.tab.tabId, 'human');
    let outcome: string | null = null;
    void s.gate().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(BROWSER_TAKEOVER_HOLD_MS - 1);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(PERSON_USING_TAB);
    expect(PERSON_USING_TAB).toBe('A person is using this tab; wait and retry');
    expect(s.entry.tab.control).toBe('human'); // refused: control untouched
  });

  it('the hold is bounded by the command\'s own deadline less 100 ms; under 200 ms it is refused at once', async () => {
    const s = stand();
    s.store.setControl(s.entry.tab.tabId, 'human');
    let outcome: string | null = null;
    void s.gate(600).then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(499);
    expect(outcome).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome).toBe(PERSON_USING_TAB);
    await expect(s.presence.beforeActing(s.entry, 199, new AbortController().signal)).rejects.toBeInstanceOf(PersonUsingTab);
  });

  it('a touch within 3 s on an idle tab promotes it to human and holds the command; the hand-back lets it through', async () => {
    const s = stand();
    s.touch();
    expect(s.entry.tab.control).toBe('idle'); // no agent held it: the touch alone moves nothing
    let outcome: string | null = null;
    void s.gate().then((o) => (outcome = o));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry.tab.control).toBe('human');
    s.store.setControl(s.entry.tab.tabId, 'idle'); // Hand back
    await vi.advanceTimersByTimeAsync(0);
    expect(outcome).toBe('sent');
    expect(s.entry.tab.control).toBe('agent');
  });

  it('a held command cancelled meanwhile rejects with its reason and never makes the tab the agent\'s', async () => {
    const s = stand();
    s.store.setControl(s.entry.tab.tabId, 'human');
    const cancel = new AbortController();
    const outcome = s.gate(10_000, cancel.signal);
    cancel.abort(new Error('disconnected'));
    expect(await outcome).toBe('disconnected');
    s.store.setControl(s.entry.tab.tabId, 'idle');
    await vi.advanceTimersByTimeAsync(0);
    expect(s.entry.tab.control).toBe('idle');
  });
});

describe("an agent's screenshot never carries the cursor (Design §9; the spec's \"Cursor\", M4 fix wave)", () => {
  it(`hides the cursor, then waits the overlay's ${CURSOR_HIDE_GRACE_MS} ms grace before the capture may go`, async () => {
    const { presence, entry, cursor } = stand();
    let ready = false;
    const before = presence.beforeCapture(entry).then(() => (ready = true));
    expect(cursor.hide).toHaveBeenCalledWith(entry);
    await vi.advanceTimersByTimeAsync(CURSOR_HIDE_GRACE_MS - 1);
    expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await before;
    expect(ready).toBe(true);
    expect(CURSOR_HIDE_GRACE_MS).toBe(50);
  });

  it('a closed tab hides nothing and waits nothing', async () => {
    const { presence, entry, cursor, store } = stand();
    store.close(entry.tab.tabId);
    await presence.beforeCapture(entry);
    expect(cursor.hide).not.toHaveBeenCalled();
  });
});
