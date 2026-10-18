// A Reload's re-pin goes through the real frame handle and injected bridge. happy-dom does not lay out the
// artifact, so its anchor's rect and ResizeObserver delivery stand in for the frame's delayed first layout.
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { HtmlFrame, type FrameHandle } from '../../renderer/src/tools/artifacts/viewers/frames/HtmlFrame';
import { pinOf, placeCard } from '../../renderer/src/side/card/placement';
import { installResizeObserver } from '../../renderer/src/test-support/resize';
import { relayPage, type PageRelay } from '../../renderer/src/tools/artifacts/viewers/connectors/relay';
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

function reloadedFrame(initial: { width: number; height: number }, { late = false }: { late?: boolean } = {}) {
  const { resize } = installResizeObserver();
  let handle: FrameHandle | null = null;
  const view = render(<HtmlFrame url="maws-artifact://record/v1/index.html" title="Dashboard" onFrame={(frame) => void (handle = frame)} />);
  const frame = view.container.querySelector('iframe')!;
  const page = frame.contentWindow!;
  // Vitest's global window is a proxy, not happy-dom's raw parent window. Match the boundary's source identity.
  Object.defineProperty(page, 'parent', { configurable: true, get: () => window });
  const doc = frame.contentDocument!;
  // `late`: the page's own script adds the anchor after the load (`add`), as an app-style page renders its content
  doc.body.innerHTML = late ? '<p>Loading…</p>' : '<h1 id="hero">Sales overview</h1>';
  const hero = late ? Object.assign(doc.createElement('h1'), { id: 'hero', textContent: 'Sales overview' }) : doc.querySelector('h1')!;
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
    add: () => doc.body.append(hero),
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

  // P3-F L198: the re-docked card's first pin after "Show in artifact" raced a page that adds its anchor late
  it('pins the anchor the page adds after the locate, once it exists and has size', async () => {
    const frame = reloadedFrame({ width: 0, height: 0 }, { late: true });
    const located = frame.locate();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.replies).not.toHaveBeenCalled(); // no null at once: the anchor may still come
    frame.add(); // in the page before layout gives it size
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.replies).not.toHaveBeenCalled();
    frame.layout(379, 102);
    expect(await located).toEqual({ x: 1061, y: 153, width: 379, height: 102 });
    expect(frame.replies).toHaveBeenCalledTimes(1);
  });

  it('gives up with null when the anchor never comes, and stops watching the page', async () => {
    const frame = reloadedFrame({ width: 379, height: 102 }, { late: true });
    expect(await frame.locate()).toBeNull();
    expect(frame.replies).toHaveBeenCalledTimes(1);
    expect(frame.replies.mock.calls[0]![0]).toMatchObject({ type: 'maws:located', selector: '#hero', rect: null });
    frame.add();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(frame.replies).toHaveBeenCalledTimes(1);
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

// P3-H H4: the page's connector runtime and the app's relay over the real frame's per-load port: what the page's
// `mawsConnectors` sends is what the relay reads, and the surface's answers and a watch's refreshes reach the page.
describe('the HTML frame bridge’s connector port', () => {
  it('carries a page’s declaration, call and watch to the load’s surface and its answers back', async () => {
    const outcome = { ok: true as const, result: { rows: [[1, 2]] }, fetchedAt: 9, via: { route: 'engine' as const } };
    let refresh: ((update: typeof outcome) => void) | null = null;
    const surface = {
      declareTools: vi.fn(async (tools: readonly { server: string; tool: string }[]) => ({ ok: true as const, declared: [...tools] })),
      callTool: vi.fn(async () => outcome),
      watchTool: vi.fn(async (_request: unknown, listener: (update: typeof outcome) => void) => {
        refresh = listener;
        return { ok: true as const, watchId: 'w1', intervalMs: 60_000 };
      }),
      unwatchTool: vi.fn(async () => true),
      refreshWatch: vi.fn(async () => true),
      setVisible: vi.fn(),
      close: vi.fn(),
    };
    const relays: PageRelay[] = [];
    const onPagePort = (port: MessagePort) => {
      const relay = relayPage(port, surface);
      relays.push(relay);
      return () => relay.dispose();
    };
    const view = render(<HtmlFrame url="maws-artifact://record/v1/index.html" title="Dashboard" onPagePort={onPagePort} />);
    const frame = view.container.querySelector('iframe')!;
    const dispatch = frame.dispatchEvent.bind(frame);
    let loading = false; // happy-dom's own load of the frame is held back: this case says when the page loads
    frame.dispatchEvent = (event: Event) => (event.type === 'load' && !loading ? true : dispatch(event));
    const page = frame.contentWindow!;
    Object.defineProperty(page, 'parent', { configurable: true, get: () => window });
    vi.spyOn(page, 'postMessage').mockImplementation(((data: unknown, _origin: string, transfer: MessagePort[] = []) => {
      page.dispatchEvent(new MessageEvent('message', { data, source: window, ports: transfer }));
    }) as typeof page.postMessage);
    new Function('window', 'document', 'Element', BRIDGE_SCRIPT)(page, frame.contentDocument!, Element);
    type Runtime = { declare(t: unknown): Promise<unknown>; call(r: unknown): Promise<unknown>; watch(r: unknown, on: (u: unknown) => void): Promise<{ stop(): Promise<unknown> }> };
    const api = (page as unknown as { mawsConnectors: Runtime }).mawsConnectors;
    const declared = api.declare([{ server: 'fixture', tool: 'read_series' }]); // before the port: it waits
    loading = true;
    fireEvent.load(frame);
    loading = false;
    expect(relays).toHaveLength(1);
    await expect(declared).resolves.toEqual({ ok: true, declared: [{ server: 'fixture', tool: 'read_series' }] });
    await expect(api.call({ server: 'fixture', tool: 'read_series', args: { days: 7 } })).resolves.toEqual(outcome);
    expect(surface.callTool).toHaveBeenCalledWith({ server: 'fixture', tool: 'read_series', args: { days: 7 } });
    const updates: unknown[] = [];
    const watch = await api.watch({ server: 'fixture', tool: 'read_series', intervalMs: 1 }, (update) => updates.push(update));
    refresh!(outcome);
    await vi.waitFor(() => expect(updates).toEqual([outcome]));
    await expect(watch.stop()).resolves.toBe(true);
    expect(surface.unwatchTool).toHaveBeenCalledWith('w1');
    view.unmount();
    expect(surface.close).toHaveBeenCalledTimes(1);
  });
});
