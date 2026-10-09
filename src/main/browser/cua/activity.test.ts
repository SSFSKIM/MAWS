import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { BROWSER_ACTIVITIES_KEPT, type BrowserAgentActivity } from '@shared/browser/activity';
import { summary, tempDir } from '../../../../test/support/index-fixture';
import { Index } from '../../index/index';
import { ACTIVITY_MAX_PER_SECOND, ActivityFeed, agentCapture, clickLabel, commandActivity, navigatedUrl, TYPED_COALESCE_MS, within } from './activity';

const A = 'A' as AppSessionId;
const T = 'b_000000000001';

afterEach(() => vi.useRealTimers());

describe('what one command the agent sent did', () => {
  it('a press (not a double click\'s second), typed characters as a count, a named key, a screenshot; nothing else', () => {
    expect(commandActivity('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20, button: 'left', clickCount: 1 })).toEqual({ kind: 'press', x: 10, y: 20 });
    expect(commandActivity('Input.dispatchMouseEvent', { type: 'mousePressed', x: 10, y: 20, clickCount: 2 })).toBeNull();
    expect(commandActivity('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 10, y: 20 })).toBeNull();
    expect(commandActivity('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 10, y: 20 })).toBeNull();
    expect(commandActivity('Input.insertText', { text: 'héllo 🙂' })).toEqual({ kind: 'typed', chars: 7 });
    expect(commandActivity('Input.insertText', { text: '' })).toBeNull();
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'keyDown', key: 'x', text: 'x' })).toEqual({ kind: 'typed', chars: 1 });
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'char', text: 'y' })).toEqual({ kind: 'typed', chars: 1 });
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', text: '\r' })).toEqual({ kind: 'key', key: 'Enter' });
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab' })).toEqual({ kind: 'key', key: 'Tab' });
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'a' })).toBeNull(); // its char follows
    expect(commandActivity('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Enter' })).toBeNull();
    expect(commandActivity('Page.captureScreenshot', { format: 'jpeg' })).toEqual({ kind: 'screenshot' });
    expect(commandActivity('Runtime.evaluate', { expression: 'document.title' })).toBeNull();
  });

  it("the agent's capture: a screenshot, or a screencast bounded to the viewport; never the vendor's own unbounded one", () => {
    expect(agentCapture('Page.captureScreenshot', { format: 'jpeg' })).toBe(true);
    expect(agentCapture('Page.startScreencast', { everyNthFrame: 1, format: 'jpeg', maxHeight: 800, maxWidth: 1280, quality: 80 })).toBe(true);
    expect(agentCapture('Page.startScreencast', { everyNthFrame: 1, format: 'jpeg', quality: 80 })).toBe(false);
    expect(agentCapture('Page.stopScreencast', {})).toBe(false);
    expect(agentCapture('Page.screencastFrameAck', { sessionId: 1 })).toBe(false);
  });

  it('a committed navigation of the main frame only, with its fragment', () => {
    expect(navigatedUrl({ frame: { id: 'F', url: 'https://example.com/a', urlFragment: '#b' } })).toBe('https://example.com/a#b');
    expect(navigatedUrl({ frame: { id: 'C', parentId: 'F', url: 'https://ads.test/' } })).toBeNull();
    expect(navigatedUrl({})).toBeNull();
  });
});

describe('a click\'s label', () => {
  const sender = (replies: Record<string, unknown | Error>) => async (method: string) => {
    const reply = replies[method];
    if (reply instanceof Error) throw reply;
    return reply;
  };

  it('the node\'s tag and accessible name, cut to 40 characters', async () => {
    const send = sender({ 'DOM.describeNode': { node: { localName: 'button', nodeName: 'BUTTON' } }, 'Accessibility.getPartialAXTree': { nodes: [{ name: { value: '  Submit\n order ' } }] } });
    expect(await clickLabel(send, Promise.resolve({ backendNodeId: 7 }))).toBe('button Submit order');
    const long = sender({ 'DOM.describeNode': { node: { localName: 'a' } }, 'Accessibility.getPartialAXTree': { nodes: [{ name: { value: 'x'.repeat(80) } }] } });
    expect(await clickLabel(long, Promise.resolve({ backendNodeId: 7 }))).toHaveLength(40);
  });

  it('else the node\'s own text; null when the node cannot be named', async () => {
    const send = sender({ 'DOM.describeNode': { node: { localName: 'p', children: [{ nodeType: 3, nodeValue: 'Hello' }, { nodeType: 1, nodeValue: '' }] } }, 'Accessibility.getPartialAXTree': new Error('no') });
    expect(await clickLabel(send, Promise.resolve({ backendNodeId: 3 }))).toBe('p Hello');
    expect(await clickLabel(send, Promise.resolve({}))).toBeNull();
  });

  it('within its bound, else null; a failure is null too', async () => {
    vi.useFakeTimers();
    const slow = within(new Promise<string>(() => {}), 500);
    await vi.advanceTimersByTimeAsync(500);
    expect(await slow).toBeNull();
    expect(await within(Promise.reject(new Error('gone')), 500)).toBeNull();
    expect(await within(Promise.resolve('button Go'), 500)).toBe('button Go');
  });
});

describe('the windows\' feed', () => {
  const feed = () => {
    const emitted: { name: string; payload: { appSessionId: string; tabId: string; at: string; activity: unknown } }[] = [];
    let now = 1_000_000;
    const activity = new ActivityFeed({ emit: (name, payload) => emitted.push({ name, payload: payload as never }), now: () => now });
    return { activity, emitted, tick: (ms: number) => (now += ms), kinds: () => emitted.map((e) => e.payload.activity) };
  };
  const drain = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('coalesces typed characters per second into one count, stamped at the first, told before the next activity', async () => {
    vi.useFakeTimers();
    const { activity, kinds, emitted, tick } = feed();
    activity.typed(A, T, 3);
    tick(200);
    activity.typed(A, T, 2);
    await vi.advanceTimersByTimeAsync(0);
    expect(emitted).toEqual([]);
    activity.tell(A, T, { kind: 'key', key: 'Enter' });
    activity.typed(A, T, 1);
    await vi.advanceTimersByTimeAsync(TYPED_COALESCE_MS);
    expect(kinds()).toEqual([{ kind: 'typed', chars: 5 }, { kind: 'key', key: 'Enter' }, { kind: 'typed', chars: 1 }]);
    expect(emitted[0]).toMatchObject({ name: 'browser.agent.activity', payload: { appSessionId: A, tabId: T, at: new Date(1_000_000).toISOString() } });
    activity.dispose();
  });

  it('keeps the order things happened in: a click waits for its label, and what follows waits for the click', async () => {
    const { activity, kinds } = feed();
    let name!: (activity: { kind: 'clicked'; x: number; y: number; label: string | null }) => void;
    activity.tell(A, T, new Promise((resolve) => (name = resolve)));
    activity.typed(A, T, 4);
    activity.tell(A, T, { kind: 'key', key: 'Enter' });
    await drain();
    expect(kinds()).toEqual([]);
    name({ kind: 'clicked', x: 1, y: 2, label: 'input' });
    await drain();
    expect(kinds()).toEqual([{ kind: 'clicked', x: 1, y: 2, label: 'input' }, { kind: 'typed', chars: 4 }, { kind: 'key', key: 'Enter' }]);
  });

  it(`keeps each session's last ${BROWSER_ACTIVITIES_KEPT} activities as told, oldest first, for the list a window asks on mount`, async () => {
    const { activity, tick } = feed();
    const B = 'B' as AppSessionId;
    for (let i = 0; i < BROWSER_ACTIVITIES_KEPT + 5; i++) {
      activity.tell(A, `b_${String(i % 7).padStart(12, '0')}`, { kind: 'key', key: `F${i}` });
      tick(100); // under the rate bound
      await drain();
    }
    activity.tell(B, T, { kind: 'screenshot' });
    await drain();
    const kept = activity.list(A);
    expect(kept).toHaveLength(BROWSER_ACTIVITIES_KEPT);
    expect(kept[0]!.activity).toEqual({ kind: 'key', key: 'F5' });
    expect(kept.at(-1)!.activity).toEqual({ kind: 'key', key: `F${BROWSER_ACTIVITIES_KEPT + 4}` });
    expect(activity.list(B).map((a) => a.activity)).toEqual([{ kind: 'screenshot' }]);
    expect(activity.list('C' as AppSessionId)).toEqual([]);
    activity.list(B).pop(); // a copy: the caller cannot change what is kept
    expect(activity.list(B)).toHaveLength(1);
    activity.forgetSession(B);
    expect(activity.list(B)).toEqual([]);
  });

  it(`tells at most ${ACTIVITY_MAX_PER_SECOND} activities per tab per second`, async () => {
    const { activity, emitted, tick } = feed();
    for (let i = 0; i < 30; i++) activity.tell(A, T, { kind: 'screenshot' });
    activity.tell(A, 'b_000000000002', { kind: 'screenshot' });
    await drain();
    expect(emitted).toHaveLength(ACTIVITY_MAX_PER_SECOND + 1);
    tick(1_000);
    activity.tell(A, T, { kind: 'screenshot' });
    await drain();
    expect(emitted).toHaveLength(ACTIVITY_MAX_PER_SECOND + 2);
  });

  // cua board #93: the kept activity survives an app restart through the index
  it('loads a session\'s activity from the store on first use, then appends after it and writes each new one through', async () => {
    const dir = tempDir();
    const path = join(dir.path, 'index.sqlite');
    try {
      let index = new Index(path);
      const B = index.sessions.upsertFromSummary(summary()).record.appId;
      let now = 1_000_000;
      const first = new ActivityFeed({ emit: () => {}, now: () => now, store: index.browserActivity });
      for (let i = 0; i < BROWSER_ACTIVITIES_KEPT + 2; i++) {
        first.tell(B, `b_${String(i % 7).padStart(12, '0')}`, { kind: 'key', key: `F${i}` });
        now += 100; // under the rate bound
        await drain();
      }
      const before = first.list(B);
      first.dispose();
      index.close();

      // the app restarts: a new feed over the reopened index answers the same list, and what is told next joins it
      index = new Index(path);
      const emitted: BrowserAgentActivity[] = [];
      const second = new ActivityFeed({ emit: (_name, payload) => void emitted.push(payload as BrowserAgentActivity), now: () => now, store: index.browserActivity });
      expect(second.list(B)).toEqual(before);
      expect(before[0]!.activity).toEqual({ kind: 'key', key: 'F2' });
      second.tell(B, T, { kind: 'screenshot' });
      await drain();
      expect(emitted.map((a) => a.activity)).toEqual([{ kind: 'screenshot' }]); // only the new one is told live
      const after = second.list(B);
      expect(after).toHaveLength(BROWSER_ACTIVITIES_KEPT);
      expect(after.slice(0, -1)).toEqual(before.slice(1));
      expect(after.at(-1)).toEqual(emitted[0]);
      expect(index.browserActivity.list(B)).toEqual(after); // written through, capped alike
      second.dispose();
      index.close();
    } finally {
      dir.dispose();
    }
  });

  it('tells and keeps the live row when the store fails, logging once until it works again', async () => {
    const log = vi.fn();
    let failing = true;
    const store = {
      list: vi.fn((): BrowserAgentActivity[] => {
        throw new Error('disk I/O error');
      }),
      append: vi.fn(() => {
        if (failing) throw new Error('FOREIGN KEY constraint failed');
      }),
    };
    const emitted: unknown[] = [];
    let now = 1_000_000;
    const activity = new ActivityFeed({ emit: (_name, payload) => void emitted.push(payload), now: () => now, store, log });
    for (const key of ['F1', 'F2', 'F3']) {
      activity.tell(A, T, { kind: 'key', key });
      now += 100;
      await drain();
    }
    expect(emitted).toHaveLength(3);
    expect(activity.list(A).map((a) => a.activity)).toEqual(['F1', 'F2', 'F3'].map((key) => ({ kind: 'key', key })));
    expect(store.list).toHaveBeenCalledTimes(1); // a failed load is not retried: the live ring stands
    expect(store.append).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]![0]).toContain('disk I/O error');
    failing = false;
    activity.tell(A, T, { kind: 'screenshot' });
    await drain();
    failing = true;
    activity.tell(A, T, { kind: 'screenshot' });
    await drain();
    expect(log).toHaveBeenCalledTimes(2); // a new failure after a success is told again
    expect(log.mock.calls[1]![0]).toContain('FOREIGN KEY constraint failed');
  });
});
