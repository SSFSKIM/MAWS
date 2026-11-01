// The producer (P5 O17 M6; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M6's Proves, Interfaces §G; acceptance
// 7.2's bounded half): a tab's paints become JPEG frames for its viewers, one unacknowledged frame per viewer with the
// newest unsent image kept, at most 10 a second, and nothing running while nothing is subscribed; a controlling viewer's
// input reaches the page as a person's. Over a real TabStore whose views are stand-ins, a fake frame source and encoder,
// and fake time (the real frame subscription is M8's pass 3).
import { EventEmitter } from 'node:events';
import type { WebContentsView } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserInput } from '@shared/browser/screencast';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import { TabControls } from './agent/control';
import { encodeJpeg, SCREENCAST_HELD_KEYS, startScreencast, type EncodedFrame, type FrameSource, type ProducedFrame, type Screencast } from './screencast';
import { TabStore, type TabEntry } from './tabs';

const A = 'A' as AppSessionId;
const B = 'B' as AppSessionId;

// A page's contents as the producer reaches them: the input it was sent, in order
class Contents extends EventEmitter {
  readonly sent: Record<string, unknown>[] = [];
  destroyed = false;
  loadURL() {
    return Promise.resolve();
  }
  getURL() {
    return '';
  }
  close() {
    this.destroyed = true;
  }
  isDestroyed() {
    return this.destroyed;
  }
  setWindowOpenHandler() {}
  setBackgroundThrottling() {}
  sendInputEvent(event: Record<string, unknown>) {
    this.sent.push(event);
  }
  insertion: Promise<void> | null = null; // what insertText answers (the page's; resolved at once unless a case says)
  insertText(text: string) {
    this.sent.push({ type: 'insertText', text });
    return this.insertion ?? Promise.resolve();
  }
}
const view = () => {
  const webContents = new Contents();
  let bounds = { x: 0, y: 0, width: 1280, height: 800 };
  return { webContents, setBounds: (next: typeof bounds) => void (bounds = { ...next }), setVisible() {}, getBounds: () => ({ ...bounds }) };
};

// The tab's paints, as the frame source hands them over: each a numbered image painted at a time
interface Image {
  n: number;
}
class Source implements FrameSource<Image> {
  paint: ((image: Image) => void) | null = null;
  starts = 0;
  stops = 0;
  painted = 0;
  start(paint: (image: Image) => void) {
    this.starts += 1;
    this.paint = paint;
  }
  stop() {
    this.stops += 1;
    this.paint = null;
  }
  emit(): number {
    this.painted += 1;
    this.paint?.({ n: this.painted });
    return this.painted;
  }
}

const cleanup: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const done of cleanup.splice(0)) done();
  vi.useRealTimers();
});

function stand(options: { encode?: (image: Image) => Promise<EncodedFrame | null> } = {}) {
  const store = new TabStore({ emit: () => {}, createView: () => view() as unknown as WebContentsView, resolvePartition: () => DEFAULT_PARTITION, schedule: () => {} });
  const controls = new TabControls({ store });
  const sources = new Map<string, Source>();
  const frames: (ProducedFrame & { subscriptionId: string; at: number })[] = [];
  const ended: string[] = [];
  const encoded: number[] = []; // the image each encode was asked for
  const screencast: Screencast = startScreencast<Image>({
    store,
    source: (entry) => {
      const source = new Source();
      sources.set(entry.tab.tabId, source);
      return source;
    },
    encode:
      options.encode ??
      (async (image) => {
        encoded.push(image.n);
        return { jpeg: new Uint8Array([image.n % 256]), width: 1280, height: 800 };
      }),
    frame: (subscriptionId, frame) => void frames.push({ ...frame, subscriptionId, at: Date.now() }),
    ended: (subscriptionId, reason) => void ended.push(`${subscriptionId} ${reason}`),
    now: () => Date.now(),
  });
  cleanup.push(() => screencast.dispose(), () => controls.dispose());
  const tab = (appSessionId: AppSessionId = A): TabEntry => store.entry(store.open({ appSessionId, url: 'http://127.0.0.1:4000/', select: true }).tab.tabId)!;
  const contents = (entry: TabEntry) => entry.view!.webContents as unknown as Contents;
  const of = (id: string) => frames.filter((frame) => frame.subscriptionId === id);
  return { store, controls, screencast, sources, frames, ended, encoded, tab, contents, of };
}

describe('the producer’s frames (§G; acceptance 7.2)', () => {
  it('reads a 60 Hz page for a 2 fps viewer over 60 s with one unsent image and one frame in flight, each frame after an ack the latest paint within 250 ms', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: false });
    const source = t.sources.get(entry.tab.tabId)!;
    expect(source.starts).toBe(1);
    const paintedAt = new Map<number, number>();
    let ackAt = -1;
    const shapes = new Set<string>();
    let worst = 0;
    for (let ms = 0; ms < 60_000; ms += 1) {
      if (ms % 50 === 0 || ms % 50 === 17 || ms % 50 === 33) paintedAt.set(source.emit(), Date.now()); // 60 Hz
      const last = t.of('v1').at(-1);
      if (last && ackAt < 0 && Date.now() - last.at >= 500) {
        t.screencast.ack(A, 'v1', last.seq); // the viewer draws at 2 fps
        ackAt = Date.now();
      }
      await vi.advanceTimersByTimeAsync(1);
      const next = t.of('v1').at(-1)!;
      if (ackAt >= 0 && next !== last) {
        // the frame after the ack: the newest paint at its sending, within 250 ms of the ack
        expect(next.capturedAt).toBe(paintedAt.get(source.painted));
        worst = Math.max(worst, next.at - ackAt);
        ackAt = -1;
      }
      const seen = t.screencast.inspect();
      expect(seen.images).toBeLessThanOrEqual(1);
      for (const viewer of seen.viewers) expect(viewer.encoding + viewer.inFlight, 'one encoded frame per viewer').toBeLessThanOrEqual(1);
      if (ms >= 5_000 && ms % 1_000 === 0) shapes.add(JSON.stringify({ ...seen, viewers: seen.viewers.map(({ id, encoding, inFlight }) => ({ id, encoding, inFlight })) }));
    }
    expect(worst).toBeLessThanOrEqual(250);
    expect(t.of('v1').length).toBeGreaterThanOrEqual(110); // about two a second
    expect(t.of('v1').length).toBeLessThanOrEqual(121);
    expect(shapes.size, 'the counters stay flat').toBeLessThanOrEqual(2);
  });

  it('holds the newest paint while an ack is paused, then sends it at the resumed ack; a still page sends nothing more', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: false });
    const source = t.sources.get(entry.tab.tabId)!;
    source.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.of('v1').map((frame) => frame.seq)).toEqual([1]);
    for (let i = 0; i < 100; i += 1) {
      source.emit();
      await vi.advanceTimersByTimeAsync(20);
    }
    expect(t.of('v1'), 'nothing past the unacknowledged frame').toHaveLength(1);
    expect(t.screencast.inspect().images).toBe(1);
    t.screencast.ack(A, 'v1', 1);
    await vi.advanceTimersByTimeAsync(0);
    expect(t.of('v1')).toHaveLength(2);
    expect(t.encoded.at(-1), 'the newest paint, not a queued one').toBe(source.painted);
    t.screencast.ack(A, 'v1', 2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.of('v1'), 'a still page: its latest image sent, then nothing').toHaveLength(2);
    expect(vi.getTimerCount(), 'no timer runs for a still page').toBe(0);
    // a second viewer of the still page gets its latest image at once, encoded once for both
    t.screencast.open({ subscriptionId: 'v2', appSessionId: A, tabId: entry.tab.tabId, control: false });
    await vi.advanceTimersByTimeAsync(0);
    expect(t.of('v2').map((frame) => frame.seq)).toEqual([1]);
    expect(t.encoded.filter((n) => n === source.painted)).toHaveLength(1);
    expect(source.starts, 'one subscription per tab, shared').toBe(1);
  });

  it('spaces a fast viewer’s frames to at most 10 a second, by the delivery, never by the page’s rate', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: false });
    const source = t.sources.get(entry.tab.tabId)!;
    for (let ms = 0; ms < 10_000; ms += 1) {
      if (ms % 17 === 0) source.emit();
      const last = t.of('v1').at(-1);
      if (last && t.screencast.inspect().viewers[0]!.inFlight === 1) t.screencast.ack(A, 'v1', last.seq); // drawn at once
      await vi.advanceTimersByTimeAsync(1);
    }
    const gaps = t.of('v1').slice(1).map((frame, at) => frame.at - t.of('v1')[at]!.at);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(100);
    expect(t.of('v1').length).toBeGreaterThanOrEqual(90);
    expect(t.of('v1').length).toBeLessThanOrEqual(101);
  });

  it('sends nothing for a viewer closed mid-encode, and stops the source with its last viewer: no timer, no image', async () => {
    let release!: () => void;
    const t = stand({ encode: () => new Promise((resolve) => (release = () => resolve({ jpeg: new Uint8Array([1]), width: 10, height: 10 }))) });
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: false });
    const source = t.sources.get(entry.tab.tabId)!;
    source.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.screencast.inspect().viewers[0]).toMatchObject({ encoding: 1 });
    t.screencast.close(A, 'v1');
    expect(source.stops).toBe(1);
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.frames).toEqual([]);
    expect(t.ended, 'a viewer’s own close is told nothing').toEqual([]);
    expect(t.screencast.inspect()).toMatchObject({ tabs: 0, images: 0, viewers: [] });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps no source and no timer while nothing is subscribed', async () => {
    const t = stand();
    t.tab();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(t.sources.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ends a subscription whose frame is over 1 MiB with frame_too_large, and one whose encoder failed with producer_failed', async () => {
    let fail = false;
    const t = stand({ encode: async () => (fail ? Promise.reject(new Error('no JPEG')) : { jpeg: new Uint8Array(1_048_577), width: 1280, height: 800 }) });
    const first = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: first.tab.tabId, control: false });
    t.sources.get(first.tab.tabId)!.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ended).toEqual(['v1 frame_too_large']);
    expect(t.frames).toEqual([]);
    expect(t.sources.get(first.tab.tabId)!.stops).toBe(1);
    fail = true;
    const second = t.tab();
    t.screencast.open({ subscriptionId: 'v2', appSessionId: A, tabId: second.tab.tabId, control: false });
    t.sources.get(second.tab.tabId)!.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(t.ended).toEqual(['v1 frame_too_large', 'v2 producer_failed']);
    expect(() => t.screencast.ack(A, 'v2', 1), 'an ended subscription is gone').toThrow();
  });

  it('takes an ack of the outstanding frame as the credit for the next; a duplicate is a no-op and a future sequence refused', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: false });
    const source = t.sources.get(entry.tab.tabId)!;
    source.emit();
    await vi.advanceTimersByTimeAsync(0);
    expect(() => t.screencast.ack(A, 'v1', 2)).toThrow(/future/);
    t.screencast.ack(A, 'v1', 1);
    t.screencast.ack(A, 'v1', 1);
    source.emit();
    await vi.advanceTimersByTimeAsync(100);
    expect(t.of('v1').map((frame) => frame.seq)).toEqual([1, 2]);
    expect(() => t.screencast.ack(B, 'v1', 2), 'bound to its session').toThrow();
  });

  it('ends a tab’s subscriptions tab_closed at its close and view_gone at its suspension, the source stopped before the page goes', async () => {
    const t = stand();
    const closing = t.tab();
    const suspending = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: closing.tab.tabId, control: true });
    t.screencast.open({ subscriptionId: 'v2', appSessionId: A, tabId: suspending.tab.tabId, control: false });
    const stoppedBeforeClose: boolean[] = [];
    const page = t.contents(closing);
    const close = page.close.bind(page);
    page.close = () => (stoppedBeforeClose.push(t.sources.get(closing.tab.tabId)!.stops === 1), close());
    t.store.close(closing.tab.tabId);
    t.store.suspend(suspending.tab.tabId);
    await vi.advanceTimersByTimeAsync(0);
    expect(stoppedBeforeClose).toEqual([true]);
    expect(t.ended).toEqual([`v1 tab_closed`, `v2 view_gone`]);
    expect(t.screencast.inspect()).toMatchObject({ tabs: 0, viewers: [] });
    expect(() => t.screencast.open({ subscriptionId: 'v3', appSessionId: A, tabId: suspending.tab.tabId, control: false })).toThrow('view_gone');
    expect(() => t.screencast.open({ subscriptionId: 'v4', appSessionId: A, tabId: closing.tab.tabId, control: false })).toThrow('tab_closed');
  });
});

describe('a viewer’s input (§G: a person’s, through the takeover gate)', () => {
  it('lets one subscription per tab control it: a second gets control_busy, a read-only one is taken and sends no input', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    expect(() => t.screencast.open({ subscriptionId: 'v2', appSessionId: A, tabId: entry.tab.tabId, control: true })).toThrow('control_busy');
    t.screencast.open({ subscriptionId: 'v3', appSessionId: A, tabId: entry.tab.tabId, control: false });
    await expect(t.screencast.input(A, 'v3', 1, { kind: 'blur' })).rejects.toThrow('read_only');
    t.screencast.close(A, 'v1');
    t.screencast.open({ subscriptionId: 'v4', appSessionId: A, tabId: entry.tab.tabId, control: true });
  });

  it('sends pointers in the tab’s viewport coordinates, wheels in Electron’s sense, keys by their names and text as text', () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    let seq = 0;
    const send = (event: Parameters<Screencast['input']>[3]) => t.screencast.input(A, 'v1', ++seq, event);
    send({ kind: 'pointer', type: 'move', x: 640.4, y: 399.6, button: 'left', buttons: 0, clickCount: 0, modifiers: [] });
    send({ kind: 'pointer', type: 'down', x: 640.4, y: 399.6, button: 'left', buttons: 1, clickCount: 1, modifiers: ['Shift', 'Meta'] });
    send({ kind: 'pointer', type: 'up', x: 640.4, y: 399.6, button: 'left', buttons: 0, clickCount: 1, modifiers: [] });
    send({ kind: 'wheel', x: 10, y: 20, deltaX: 0, deltaY: 120, modifiers: [] });
    send({ kind: 'key', type: 'down', key: 'ArrowUp', code: 'ArrowUp', repeat: true, modifiers: ['Control'] });
    send({ kind: 'key', type: 'up', key: 'ArrowUp', code: 'ArrowUp', repeat: false, modifiers: [] });
    send({ kind: 'key', type: 'down', key: ' ', code: 'Space', repeat: false, modifiers: [] });
    send({ kind: 'key', type: 'up', key: ' ', code: 'Space', repeat: false, modifiers: [] });
    send({ kind: 'text', text: '안녕 é' });
    expect(t.contents(entry).sent).toEqual([
      { type: 'mouseMove', x: 640, y: 400, modifiers: [] },
      { type: 'mouseDown', x: 640, y: 400, button: 'left', clickCount: 1, modifiers: ['shift', 'meta', 'leftbuttondown'] },
      { type: 'mouseUp', x: 640, y: 400, button: 'left', clickCount: 1, modifiers: [] },
      { type: 'mouseWheel', x: 10, y: 20, deltaX: -0, deltaY: -120, modifiers: [] },
      { type: 'keyDown', keyCode: 'Up', modifiers: ['control', 'isAutoRepeat'] },
      { type: 'keyUp', keyCode: 'Up', modifiers: [] },
      { type: 'keyDown', keyCode: 'Space', modifiers: [] },
      { type: 'keyUp', keyCode: 'Space', modifiers: [] },
      { type: 'insertText', text: '안녕 é' },
    ]);
  });

  it('takes a sequence once, and releases held keys and buttons at a blur and at the close', () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    const down: BrowserInput = { kind: 'pointer', type: 'down', x: 5, y: 6, button: 'right', buttons: 2, clickCount: 1, modifiers: [] };
    t.screencast.input(A, 'v1', 1, down);
    t.screencast.input(A, 'v1', 1, down);
    t.screencast.input(A, 'v1', 2, { kind: 'key', type: 'down', key: 'Shift', code: 'ShiftLeft', repeat: false, modifiers: ['Shift'] });
    expect(t.contents(entry).sent).toHaveLength(2);
    t.screencast.input(A, 'v1', 3, { kind: 'blur' });
    expect(t.contents(entry).sent.slice(2)).toEqual([
      { type: 'keyUp', keyCode: 'Shift', modifiers: [] },
      { type: 'mouseUp', x: 5, y: 6, button: 'right', clickCount: 1, modifiers: [] },
    ]);
    t.screencast.input(A, 'v1', 4, { kind: 'key', type: 'down', key: 'a', code: 'KeyA', repeat: false, modifiers: [] });
    t.screencast.close(A, 'v1');
    expect(t.contents(entry).sent.at(-1), 'released at the close').toEqual({ type: 'keyUp', keyCode: 'a', modifiers: [] });
    t.screencast.open({ subscriptionId: 'v2', appSessionId: A, tabId: entry.tab.tabId, control: true });
    expect(() => t.screencast.input(A, 'v2', 1, down), 'nothing replays across subscriptions: a new one counts afresh').not.toThrow();
  });

  it('carries the pressed buttons into each pointer event, so a drag’s moves report the held button', () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    let seq = 0;
    const pointer = (type: 'move' | 'down' | 'up', buttons: number, button: 'left' | 'middle' | 'right' = 'left') =>
      t.screencast.input(A, 'v1', ++seq, { kind: 'pointer', type, x: 10, y: 20, button, buttons, clickCount: type === 'move' ? 0 : 1, modifiers: ['Shift'] });
    pointer('down', 1);
    pointer('move', 1);
    pointer('down', 5, 'middle');
    pointer('move', 7);
    pointer('up', 0);
    expect(t.contents(entry).sent.map((event) => event.modifiers)).toEqual([
      ['shift', 'leftbuttondown'],
      ['shift', 'leftbuttondown'],
      ['shift', 'leftbuttondown', 'middlebuttondown'],
      ['shift', 'leftbuttondown', 'rightbuttondown', 'middlebuttondown'],
      ['shift'],
    ]);
  });

  it('releases the native key it pressed, whatever the key reads at the release (Shift let go first, a UK layout’s Quote)', () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    let seq = 0;
    const key = (type: 'down' | 'up', key: string, repeat = false) => t.screencast.input(A, 'v1', ++seq, { kind: 'key', type, key, code: 'Digit2', repeat, modifiers: [] });
    key('down', '"');
    key('down', '2', true); // its auto-repeat after Shift's release: the same native key
    key('up', '2');
    t.screencast.input(A, 'v1', ++seq, { kind: 'blur' });
    expect(t.contents(entry).sent).toEqual([
      { type: 'keyDown', keyCode: '"', modifiers: [] },
      { type: 'keyDown', keyCode: '"', modifiers: ['isAutoRepeat'] },
      { type: 'keyUp', keyCode: '"', modifiers: [] },
    ]);
  });

  it(`holds at most ${SCREENCAST_HELD_KEYS} keys: a press past them releases the oldest first, so a blur releases no more`, () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    const presses = 5_000;
    for (let n = 1; n <= presses; n += 1) t.screencast.input(A, 'v1', n, { kind: 'key', type: 'down', key: 'a', code: `Code${n}`, repeat: false, modifiers: [] });
    const sent = t.contents(entry).sent;
    expect(sent.slice(0, SCREENCAST_HELD_KEYS + 2)).toEqual([
      ...Array.from({ length: SCREENCAST_HELD_KEYS }, () => ({ type: 'keyDown', keyCode: 'a', modifiers: [] })),
      { type: 'keyUp', keyCode: 'a', modifiers: [] }, // the oldest, before the press past the bound
      { type: 'keyDown', keyCode: 'a', modifiers: [] },
    ]);
    const before = sent.length;
    t.screencast.input(A, 'v1', presses + 1, { kind: 'blur' });
    expect(sent.slice(before)).toHaveLength(SCREENCAST_HELD_KEYS);
    expect(sent.filter((event) => event.type === 'keyUp')).toHaveLength(presses);
  });

  it('is the person’s input: an agent holding the tab yields it (human), and the seam records a human press', () => {
    const t = stand();
    const entry = t.tab();
    t.store.setControl(entry.tab.tabId, 'agent');
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    t.screencast.input(A, 'v1', 1, { kind: 'pointer', type: 'down', x: 1, y: 1, button: 'left', buttons: 1, clickCount: 1, modifiers: [] });
    expect(entry.tab.control).toBe('human');
    expect(entry.input.lastHumanAt).toBe(Date.now());
    expect(entry.input.lastHumanActivationAt).toBe(Date.now());
    expect(t.controls.personHolds(entry), 'the agent’s acting commands wait').toBe(true);
  });

  it('answers text once the page has inserted it, and an insertion that fails as the input’s failure', async () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    let insert!: () => void;
    t.contents(entry).insertion = new Promise((resolve) => (insert = resolve));
    let answered = false;
    const typed = t.screencast.input(A, 'v1', 1, { kind: 'text', text: 'slow' }).then(() => void (answered = true));
    await vi.advanceTimersByTimeAsync(50);
    expect(answered, 'not before the insertion settles').toBe(false);
    insert();
    await typed;
    expect(answered).toBe(true);
    t.contents(entry).insertion = Promise.reject(new Error('the frame went away'));
    await expect(t.screencast.input(A, 'v1', 2, { kind: 'text', text: 'lost' })).rejects.toThrow('the text could not be inserted: the frame went away');
  });

  it('takes Escape and a chord the browser keeps as the person’s input but no activation, as native keys are (input.ts)', () => {
    const t = stand();
    const entry = t.tab();
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: entry.tab.tabId, control: true });
    const key = (seq: number, name: string, modifiers: string[] = []) => void t.screencast.input(A, 'v1', seq, { kind: 'key', type: 'down', key: name, code: name, repeat: false, modifiers });
    key(1, 'Escape');
    expect(entry.input.lastHumanAt).toBe(Date.now());
    expect(entry.input.lastHumanActivationAt, 'Escape opens no gate').toBeNull();
    expect(entry.input.lastActivationAt).toBeNull();
    key(2, 'r', ['Meta']); // ⌘R, the browser's reload
    key(3, 'l', ['Meta']); // ⌘L
    expect(entry.input.lastHumanActivationAt, 'a reserved chord opens no gate').toBeNull();
    key(4, 'a');
    expect(entry.input.lastHumanActivationAt, 'an ordinary key is an activation').toBe(Date.now());
  });

  it('closes a session’s subscriptions at its drop, telling no one (mawsd ended them first)', () => {
    const t = stand();
    const a = t.tab(A);
    const b = t.tab(B);
    t.screencast.open({ subscriptionId: 'v1', appSessionId: A, tabId: a.tab.tabId, control: true });
    t.screencast.open({ subscriptionId: 'v2', appSessionId: B, tabId: b.tab.tabId, control: false });
    t.screencast.input(A, 'v1', 1, { kind: 'key', type: 'down', key: 'x', code: 'KeyX', repeat: false, modifiers: [] });
    t.screencast.closeSession(A);
    expect(t.ended).toEqual([]);
    expect(t.contents(a).sent.at(-1)).toEqual({ type: 'keyUp', keyCode: 'x', modifiers: [] });
    expect(t.screencast.inspect().viewers.map((viewer) => viewer.id)).toEqual(['v2']);
  });
});

describe('the Electron encoder', () => {
  // A NativeImage stand-in: its size, and what a resize was asked
  const image = (width: number, height: number) => {
    const resized: { width: number; height: number }[] = [];
    const make = (size: { width: number; height: number }): Record<string, unknown> => ({
      getSize: () => size,
      isEmpty: () => size.width === 0 || size.height === 0,
      resize: (to: { width: number; height: number }) => (resized.push({ width: to.width, height: to.height }), make(to)),
      toJPEG: (quality: number) => Buffer.from([quality]),
    });
    return { image: make({ width, height }), resized };
  };

  it('fits the image within 1280×800 at quality 60, keeping its aspect, and skips an empty one', async () => {
    const retina = image(2560, 1600);
    expect(await encodeJpeg(retina.image as never)).toEqual({ jpeg: new Uint8Array([60]), width: 1280, height: 800 });
    const tall = image(1000, 3000);
    expect(await encodeJpeg(tall.image as never)).toMatchObject({ width: 266, height: 800 });
    const small = image(800, 600);
    expect(await encodeJpeg(small.image as never)).toMatchObject({ width: 800, height: 600 });
    expect(small.resized).toEqual([]);
    expect(await encodeJpeg(image(0, 0).image as never)).toBeNull();
  });
});
