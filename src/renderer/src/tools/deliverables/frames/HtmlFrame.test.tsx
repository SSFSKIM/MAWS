// P2-E1 (M3): the HTML frame's locate handle (P2-E1 document, D8). The frame is an opaque origin, so a message posted
// before its load reaches the blank document and is lost: a locate waits for the frame's load, posts `maws:locate`, and
// resolves on the matching `maws:located` from its own window (another window's answer, or another selector's, is
// ignored), or null 1 s after the post. Answers are heard whether or not picking is on; an unmounted frame answers null.
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { CardRect } from '../../code/anchor/anchor';
import { HtmlFrame, LOCATE_TIMEOUT_MS, type FrameHandle } from './HtmlFrame';

const A = 'app-a' as AppSessionId;
const RECT: CardRect = { x: 0, y: 0, width: 640, height: 101 };

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
const located = (selector: string, rect: CardRect | null) => ({ type: 'maws:located', selector, rect });

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
    expect(sent).toEqual([{ type: 'maws:locate', selector: '#hero' }]);
    answer(located('#hero', RECT), frame.contentWindow);
    expect(await result).toEqual(RECT);
  });

  it('after the load, a locate is posted at once; another window’s answer, another selector’s or a malformed one is ignored', async () => {
    const { handle, frame, sent } = mount();
    load(frame);
    const result = handle().locate('#hero');
    expect(sent).toEqual([{ type: 'maws:locate', selector: '#hero' }]);
    answer(located('#hero', { x: 9, y: 9, width: 9, height: 9 }), window); // the app's own window
    answer(located('#hero', { x: 9, y: 9, width: 9, height: 9 }), null);
    answer(located('#other', { x: 9, y: 9, width: 9, height: 9 }), frame.contentWindow);
    answer({ type: 'maws:located', selector: '#hero', rect: { x: 'no' } }, frame.contentWindow);
    expect(await stateOf(result)).toEqual({ settled: false });
    answer(located('#hero', null), frame.contentWindow); // the page has no such element
    expect(await result).toBeNull();
  });

  it('answers are heard while picking too', async () => {
    const { handle, frame } = mount(true);
    load(frame);
    const result = handle().locate('#hero');
    answer(located('#hero', RECT), frame.contentWindow);
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

  it('an unmounted frame answers its pending locates with null', async () => {
    const { handle, view } = mount();
    const result = handle().locate('#hero');
    view.unmount();
    expect(await result).toBeNull();
  });
});
