// A Reload's re-pin goes through the real frame handle and injected bridge. happy-dom does not lay out the
// artifact, so its anchor's rect and ResizeObserver delivery stand in for the frame's delayed first layout.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HtmlFrame, type FrameHandle } from '../../renderer/src/tools/artifacts/viewers/frames/HtmlFrame';
import { pinOf, placeCard } from '../../renderer/src/side/card/placement';
import { installResizeObserver } from '../../renderer/src/test-support/resize';
import { BRIDGE_SCRIPT } from './bridge-script';

beforeAll(() => {
  (window as unknown as { happyDOM: { settings: { navigation: { disableChildFrameNavigation: boolean } } } }).happyDOM.settings.navigation.disableChildFrameNavigation = true;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function reloadedFrame(initial: { width: number; height: number }) {
  const { resize } = installResizeObserver();
  let handle: FrameHandle | null = null;
  const view = render(<HtmlFrame url="maws-artifact://record/v1/index.html" title="Dashboard" onFrame={(frame) => void (handle = frame)} />);
  const frame = view.container.querySelector('iframe')!;
  const page = frame.contentWindow!;
  const doc = frame.contentDocument!;
  doc.body.innerHTML = '<h1 id="hero">Sales overview</h1>';
  const hero = doc.querySelector('h1')!;
  const measure = vi.spyOn(hero, 'getBoundingClientRect').mockReturnValue(new DOMRect(1061, 153, initial.width, initial.height));
  Object.defineProperty(page, 'ResizeObserver', { configurable: true, value: globalThis.ResizeObserver });
  // The iframe's postMessage boundary, preserving the source windows HtmlFrame and the bridge authenticate.
  vi.spyOn(page, 'postMessage').mockImplementation((data) => {
    page.dispatchEvent(new MessageEvent('message', { data, source: window }));
  });
  const replies = vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    window.dispatchEvent(new MessageEvent('message', { data, source: page }));
  });
  new Function('window', 'document', 'Element', BRIDGE_SCRIPT)(page, doc, Element);
  fireEvent.load(frame);
  return {
    locate: () => handle!.locate('#hero'),
    replies,
    layout: (width: number, height: number) => {
      measure.mockReturnValue(new DOMRect(1061, 153, width, height));
      resize(hero, { width, height });
    },
  };
}

describe('the HTML frame bridge’s re-pin after a Reload', () => {
  it.each([
    { width: 379, height: 0 },
    { width: 0, height: 102 },
    { width: 0, height: 0 },
  ])('pins below the laid-out anchor when its first rect is $width × $height', async (initial) => {
    const frame = reloadedFrame(initial);
    const located = frame.locate();
    frame.layout(initial.width, initial.height); // an observer delivery before layout has size is not final either
    frame.layout(379, 102);
    const rect = await located;
    // HtmlFrame consumes exactly one reply. A premature zero-size reply would pin at y=157 instead of y=259.
    const placement = placeCard({ width: 1440, height: 900 }, rect && pinOf(rect, { scale: 1, offset: { x: 0, y: 0 } }));
    expect(placement).toMatchObject({ mode: 'below', left: 1061, top: 259 });
    expect(rect).toEqual({ x: 1061, y: 153, width: 379, height: 102 });
    frame.layout(400, 200);
    expect(frame.replies).toHaveBeenCalledTimes(1);
  });

  it('gives up without a zero-size pin and stops observing when layout never gives the anchor size', async () => {
    const frame = reloadedFrame({ width: 379, height: 0 });
    expect(await frame.locate()).toBeNull();
    frame.layout(379, 102);
    expect(frame.replies).toHaveBeenCalledTimes(1);
    expect(frame.replies.mock.calls[0]![0]).toMatchObject({ type: 'maws:located', selector: '#hero', rect: null });
  });

  it('answers immediately when the first rect already has size', async () => {
    const frame = reloadedFrame({ width: 379, height: 102 });
    const located = frame.locate();
    expect(frame.replies).toHaveBeenCalledTimes(1);
    expect(await located).toEqual({ x: 1061, y: 153, width: 379, height: 102 });
    frame.layout(400, 200);
    expect(frame.replies).toHaveBeenCalledTimes(1);
  });
});
