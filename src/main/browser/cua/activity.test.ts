import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { ACTIVITY_MAX_PER_SECOND, ActivityFeed, clickLabel, commandActivity, navigatedUrl, TYPED_COALESCE_MS, within } from './activity';

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
});
