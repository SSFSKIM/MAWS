// P2-E1 (M3): the HTML frame's locate handle (P2-E1 document, D8). The frame is an opaque origin, so a message posted
// before its load reaches the blank document and is lost: a locate waits for the frame's load, posts `maws:locate` with
// an id of its own, and resolves on the `maws:located` carrying that id from its own window (another window's answer, or
// another locate's, even for the same selector, is not its), or null 1 s after the post, a later answer then matching
// nothing. Answers are heard whether or not picking is on; an unmounted frame answers null.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CardRect } from '../../code/anchor/anchor';
import { HtmlFrame, LOCATE_TIMEOUT_MS, type FrameHandle } from './HtmlFrame';

const A = 'app-a' as AppSessionId;
const RECT: CardRect = { x: 0, y: 0, width: 640, height: 101 };
const MOVED: CardRect = { x: 40, y: 200, width: 300, height: 50 };

// happy-dom knows no `maws-deliverable:` scheme: child-frame navigation is off, so a frame only takes its URL; the load
// happy-dom then fires on its own is held back, so each case says when the frame loads
beforeAll(() => {
  (window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(picking = false) {
  let handle: FrameHandle | null = null;
  const onFrame = vi.fn((h: FrameHandle | null) => void (handle = h));
  const view = render(<HtmlFrame url="maws-deliverable://x/v1.html" title="Dashboard" appSessionId={A} deliverableId="d1" version={1} picking={picking} onFrame={onFrame} />);
  const frame = document.querySelector('iframe')!;
  const dispatch = frame.dispatchEvent.bind(frame);
  frame.dispatchEvent = (event: Event) => (event.type === 'load' && !loading ? true : dispatch(event));
  const sent: unknown[] = [];
  frame.contentWindow!.postMessage = ((data: unknown) => void sent.push(data)) as typeof window.postMessage;
  return { handle: () => handle!, onFrame, frame, sent, view };
}

let loading = false;
const load = (frame: HTMLIFrameElement) =>
  act(() => {
    loading = true;
    frame.dispatchEvent(new Event('load'));
    loading = false;
  });
const answer = (data: unknown, source: unknown) => act(() => void window.dispatchEvent(new MessageEvent('message', { data, source: source as MessageEventSource })));
const located = (id: number, selector: string, rect: CardRect | null) => ({ type: 'maws:located', id, selector, rect });
const idOf = (message: unknown) => (message as { id: number }).id;

// a promise's state, without waiting on it
async function stateOf<T>(promise: Promise<T>): Promise<{ settled: false } | { settled: true; value: T }> {
  const pending = Symbol('pending');
  const value = await Promise.race([promise, Promise.resolve(pending)]);
  return value === pending ? { settled: false } : { settled: true, value: value as T };
}

describe('the HTML frame’s locate handle', () => {
  it('hands its parent a handle on mount, and null on unmount', () => {
    const { onFrame, view } = mount();
    expect(onFrame).toHaveBeenCalledTimes(1);
    expect(onFrame.mock.calls[0]![0]).not.toBeNull();
    view.unmount();
    expect(onFrame.mock.calls.at(-1)![0]).toBeNull();
  });

  it('a locate asked before the load is posted after it, and resolves on its own window’s answer', async () => {
    const { handle, frame, sent } = mount();
    const result = handle().locate('#hero');
    expect(sent).toEqual([]);
    load(frame);
    expect(sent).toEqual([{ type: 'maws:locate', id: expect.any(Number), selector: '#hero' }]);
    answer(located(idOf(sent[0]), '#hero', RECT), frame.contentWindow);
    expect(await result).toEqual(RECT);
  });

  it('after the load, a locate is posted at once; another window’s answer, another selector’s or a malformed one is ignored', async () => {
    const { handle, frame, sent } = mount();
    load(frame);
    const result = handle().locate('#hero');
    expect(sent).toEqual([{ type: 'maws:locate', id: expect.any(Number), selector: '#hero' }]);
    const id = idOf(sent[0]);
    answer(located(id, '#hero', { x: 9, y: 9, width: 9, height: 9 }), window); // the app's own window
    answer(located(id, '#hero', { x: 9, y: 9, width: 9, height: 9 }), null);
    answer(located(id, '#other', { x: 9, y: 9, width: 9, height: 9 }), frame.contentWindow);
    answer(located(id + 1, '#hero', { x: 9, y: 9, width: 9, height: 9 }), frame.contentWindow); // another locate's
    answer({ type: 'maws:located', id, selector: '#hero', rect: { x: 'no' } }, frame.contentWindow);
    answer({ type: 'maws:located', selector: '#hero', rect: { x: 9, y: 9, width: 9, height: 9 } }, frame.contentWindow); // no id
    expect(await stateOf(result)).toEqual({ settled: false });
    answer(located(id, '#hero', null), frame.contentWindow); // the page has no such element
    expect(await result).toBeNull();
  });

  it('answers are heard while picking too', async () => {
    const { handle, frame, sent } = mount(true);
    load(frame);
    const result = handle().locate('#hero');
    const asked = sent.find((message) => (message as { type: string }).type === 'maws:locate');
    answer(located(idOf(asked), '#hero', RECT), frame.contentWindow);
    expect(await result).toEqual(RECT);
  });

  it('times out to null 1 s after the post, not before the load', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { handle, frame } = mount();
    const result = handle().locate('#hero');
    await act(() => vi.advanceTimersByTimeAsync(5 * LOCATE_TIMEOUT_MS)); // not loaded: nothing posted, no clock running
    expect(await stateOf(result)).toEqual({ settled: false });
    load(frame);
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS - 1));
    expect(await stateOf(result)).toEqual({ settled: false });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(await result).toBeNull();
  });

  it('two locates of one selector in flight each resolve on their own answer, in order', async () => {
    const { handle, frame, sent } = mount();
    load(frame);
    const older = handle().locate('#hero');
    const newer = handle().locate('#hero');
    const [first, second] = sent.map(idOf);
    expect(first).not.toBe(second);
    answer(located(first!, '#hero', RECT), frame.contentWindow);
    expect(await stateOf(newer)).toEqual({ settled: false });
    answer(located(second!, '#hero', MOVED), frame.contentWindow);
    expect(await older).toEqual(RECT);
    expect(await newer).toEqual(MOVED);
  });

  it('an answer arriving after its locate timed out matches nothing: a newer locate of the same selector waits for its own', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { handle, frame, sent } = mount();
    load(frame);
    const late = handle().locate('#hero');
    await act(() => vi.advanceTimersByTimeAsync(LOCATE_TIMEOUT_MS));
    expect(await late).toBeNull();
    const fresh = handle().locate('#hero');
    answer(located(idOf(sent[0]), '#hero', RECT), frame.contentWindow); // the timed-out locate's answer, late
    expect(await stateOf(fresh)).toEqual({ settled: false });
    answer(located(idOf(sent[1]), '#hero', MOVED), frame.contentWindow);
    expect(await fresh).toEqual(MOVED);
  });

  it('an unmounted frame answers its pending locates with null', async () => {
    const { handle, view } = mount();
    const result = handle().locate('#hero');
    view.unmount();
    expect(await result).toBeNull();
  });
});
