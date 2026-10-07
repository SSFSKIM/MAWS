import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserControl, BrowserTab } from '@shared/browser/tab';
import { COMMENT_CHANNEL, PICK_AT_MS, type PickReport } from '@shared/browser/comment-protocol';
import { eventChannel } from '@shared/ipc/schema';
import type { TabEntry } from '../tabs';
import type { Crop } from './crop';
import { CommentMode, type CommentModeDeps } from './mode';

const URL_ = 'http://127.0.0.1:4000/comment.html';

// A tab's page as comment mode uses it: Electron's events, the preload's channel, the inserted cursor.
class FakeContents extends EventEmitter {
  static next = 1;
  readonly id = FakeContents.next++;
  destroyed = false;
  url = URL_;
  readonly send = vi.fn();
  readonly insertCSS = vi.fn(async () => `css-${this.id}`);
  readonly removeInsertedCSS = vi.fn(async () => {});
  isDestroyed = () => this.destroyed;
  getURL = () => this.url;
  sent = () => this.send.mock.calls.filter(([channel]) => channel === COMMENT_CHANNEL.toPreload).map(([, message]) => message);
}

function fakeWindow() {
  const send = vi.fn();
  const win = { id: 7, destroyed: false, isDestroyed: () => win.destroyed, webContents: { isDestroyed: () => false, send } };
  return { win, send };
}

// E4a's TabStore as comment mode reads it; `setControl` calls the `onUpdated` listeners synchronously, as E4a's does.
class FakeStore {
  readonly entries = new Map<string, TabEntry>();
  private readonly created = new Set<(entry: TabEntry) => void>();
  private readonly destroying = new Set<(entry: TabEntry) => void>();
  private readonly updated = new Set<(entry: TabEntry) => void>();
  entry = (tabId: string) => this.entries.get(tabId);
  entryOf = (wc: unknown) => [...this.entries.values()].find((entry) => entry.view?.webContents === wc);
  onViewCreated = (listener: (entry: TabEntry) => void) => this.hook(this.created, listener);
  onViewDestroying = (listener: (entry: TabEntry) => void) => this.hook(this.destroying, listener);
  onUpdated = (listener: (entry: TabEntry) => void) => this.hook(this.updated, listener);
  listeners = () => this.created.size + this.destroying.size + this.updated.size;

  add(tabId: string, tab: Partial<BrowserTab> = {}, { placed = true } = {}) {
    const wc = new FakeContents();
    const { win, send } = fakeWindow();
    const view = { webContents: wc, getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) };
    const entry = {
      tab: { tabId, appSessionId: 'App-A', control: 'idle', suspended: false, loadError: null, crashed: null, ...tab } as BrowserTab,
      view,
      placement: placed ? { paneId: 'p', surface: 'panel', window: win, rect: { x: 0, y: 0, width: 800, height: 600 } } : null,
      host: win,
      committed: true,
    } as unknown as TabEntry;
    this.entries.set(tabId, entry);
    for (const listener of this.created) listener(entry);
    return { entry, wc, win, send };
  }
  setControl(tabId: string, control: BrowserControl) {
    const entry = this.entries.get(tabId)!;
    entry.tab = { ...entry.tab, control };
    for (const listener of [...this.updated]) listener(entry);
  }
  destroyView(tabId: string) {
    const entry = this.entries.get(tabId)!;
    for (const listener of [...this.destroying]) listener(entry);
    const wc = entry.view!.webContents as unknown as FakeContents;
    entry.view = null;
    wc.destroyed = true;
    wc.emit('destroyed');
  }
  private hook(set: Set<(entry: TabEntry) => void>, listener: (entry: TabEntry) => void) {
    set.add(listener);
    return () => void set.delete(listener);
  }
}

const A = 'b_aaaaaaaaaaaa';
const B = 'b_bbbbbbbbbbbb';

function report(over: Partial<PickReport> = {}): PickReport {
  return {
    type: 'picked',
    epoch: 1,
    requestId: null,
    mode: 'click',
    description: { css: '#increment', role: 'button', name: 'Increment', a11y: 'main > region “A form” > button “Increment”', tag: 'button', confident: true },
    nameOverLong: false,
    rect: { x: 248, y: 312, width: 96, height: 30 },
    scroll: { x: 0, y: 100 },
    viewport: { width: 800, height: 600 },
    ...over,
  };
}

let store: FakeStore;
let emitted: [string, unknown][];
let capture: ReturnType<typeof vi.fn<CommentModeDeps['capture']>>;
let discard: ReturnType<typeof vi.fn<CommentModeDeps['discard']>>;
let now: number;
let mode: CommentMode;

beforeEach(() => {
  store = new FakeStore();
  emitted = [];
  capture = vi.fn(async (): Promise<Crop> => ({ crop: 'none' }));
  discard = vi.fn();
  now = 1000;
  let request = 0;
  mode = new CommentMode({
    store: store as never,
    emit: (name, payload) => void emitted.push([name, payload]),
    capture,
    discard,
    now: () => now,
    requestId: () => `r${++request}`,
  });
});

const changes = () => emitted.filter(([name]) => name === 'browser.comment.changed').map(([, payload]) => payload);
const picked = (send: ReturnType<typeof vi.fn>) => send.mock.calls.filter(([channel]) => channel === eventChannel('browser.comment.picked')).map(([, payload]) => payload);
const key = (wc: FakeContents, input: Record<string, unknown>) => {
  const event = { preventDefault: vi.fn() };
  wc.emit('before-input-event', event, { type: 'keyDown', key: 'Escape', code: 'Escape', meta: false, control: false, alt: false, shift: false, ...input });
  return event.preventDefault;
};

describe('arming (Design §2): browser.comment.set', () => {
  it('arms a placed tab with a page: the epoch to the preload, the crosshair inserted, the change told', () => {
    const { wc } = store.add(A);
    expect(mode.set(A, true)).toEqual({ on: true, reason: 'ok' });
    expect(wc.sent()).toEqual([{ type: 'arm', epoch: 1 }]);
    expect(wc.insertCSS).toHaveBeenCalledExactlyOnceWith('* { cursor: crosshair !important }');
    expect(changes()).toEqual([{ tabId: A, on: true, reason: 'armed' }]);
    expect(mode.state(A)).toEqual({ armed: true, epoch: 1, dropped: 0 });
    expect(mode.set(A, true)).toEqual({ on: true, reason: 'ok' }); // already armed: nothing again
    expect(wc.sent()).toHaveLength(1);
  });

  it('refuses with the reason, and changes nothing, for a tab that cannot be picked on', () => {
    store.add('b_000000000001', { suspended: true });
    store.add('b_000000000002', { loadError: { url: URL_, host: 'h', kind: 'dns', code: -105, description: 'x' } as never });
    store.add('b_000000000003', { crashed: { reason: 'crashed' } });
    store.add('b_000000000004', { control: 'agent' });
    store.add('b_000000000005', {}, { placed: false });
    const viewless = store.add('b_000000000006');
    viewless.entry.view = null;
    const uncommitted = store.add('b_000000000007');
    (uncommitted.entry as { committed: boolean }).committed = false;
    const answers = ['b_00000000000f', 'b_000000000001', 'b_000000000002', 'b_000000000003', 'b_000000000004', 'b_000000000005', 'b_000000000006', 'b_000000000007'].map((tabId) => mode.set(tabId, true));
    expect(answers.map(({ on, reason }) => `${on}:${reason}`)).toEqual(['false:unknownTab', 'false:suspended', 'false:noPage', 'false:noPage', 'false:agent', 'false:notPlaced', 'false:noPage', 'false:noPage']);
    expect(emitted).toEqual([]);
  });

  it('turns off on the toggle: the preload told, the crosshair removed, the change told', async () => {
    const { wc } = store.add(A);
    mode.set(A, true);
    expect(mode.set(A, false)).toEqual({ on: false, reason: 'ok' });
    expect(wc.sent()).toEqual([{ type: 'arm', epoch: 1 }, { type: 'disarm' }]);
    await vi.waitFor(() => expect(wc.removeInsertedCSS).toHaveBeenCalledExactlyOnceWith(`css-${wc.id}`));
    expect(changes()).toEqual([
      { tabId: A, on: true, reason: 'armed' },
      { tabId: A, on: false, reason: 'toggle' },
    ]);
    expect(mode.set(A, false)).toEqual({ on: false, reason: 'ok' }); // already off: nothing more
    expect(changes()).toHaveLength(2);
    expect(mode.set('b_00000000000f', false)).toEqual({ on: false, reason: 'unknownTab' });
  });

  it('keeps one armed tab at a time, and a new arm a new epoch', () => {
    const a = store.add(A);
    store.add(B);
    mode.set(A, true);
    mode.set(B, true);
    expect(a.wc.sent()).toEqual([{ type: 'arm', epoch: 1 }, { type: 'disarm' }]);
    expect(changes().slice(1)).toEqual([
      { tabId: A, on: false, reason: 'other' },
      { tabId: B, on: true, reason: 'armed' },
    ]);
    mode.set(A, true);
    expect(mode.state(A)).toMatchObject({ armed: true, epoch: 2 });
    expect(mode.state(B)).toMatchObject({ armed: false });
  });
});

describe('what disarms (Design §2, §8)', () => {
  it('Esc in the page, natively: taken from the page with its keyUp, and only while armed and unmodified', () => {
    const { wc } = store.add(A);
    expect(key(wc, {})).not.toHaveBeenCalled(); // unarmed: the page's
    mode.set(A, true);
    expect(key(wc, { meta: true })).not.toHaveBeenCalled();
    expect(key(wc, { key: 'a', code: 'KeyA' })).not.toHaveBeenCalled();
    expect(key(wc, {})).toHaveBeenCalledOnce();
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'escape' });
    expect(key(wc, { type: 'keyUp' })).toHaveBeenCalledOnce(); // no half a keystroke reaches the page
    expect(key(wc, { type: 'keyUp' })).not.toHaveBeenCalled();
  });

  it('a main-frame navigation to another document, with a new epoch; an in-page or subframe one does not', () => {
    const { wc } = store.add(A);
    mode.set(A, true);
    wc.emit('did-start-navigation', { isMainFrame: false, isSameDocument: false, url: URL_ });
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true, url: `${URL_}#x` });
    expect(mode.state(A)).toMatchObject({ armed: true, epoch: 1 });
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://127.0.0.1:4000/b.html' });
    expect(mode.state(A)).toMatchObject({ armed: false, epoch: 2 });
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'navigated' });
  });

  it('a crash, and the view going (a close or a suspension), with nothing sent to a page that is gone', () => {
    const a = store.add(A);
    mode.set(A, true);
    a.wc.emit('render-process-gone', {}, { reason: 'crashed' });
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'crashed' });
    store.add(B);
    mode.set(B, true);
    store.destroyView(B);
    expect(changes().at(-1)).toEqual({ tabId: B, on: false, reason: 'closed' });
    expect(changes().filter((c) => (c as { tabId: string }).tabId === B)).toHaveLength(2); // the `destroyed` that follows adds nothing
  });

  it('the agent taking the page: disarmed inside setControl, before it returns (Decision Log 26(a))', () => {
    const { wc } = store.add(A);
    mode.set(A, true);
    store.setControl(A, 'human');
    expect(mode.state(A)!.armed).toBe(true);
    store.setControl(A, 'agent');
    expect(mode.state(A)!.armed).toBe(false);
    expect(wc.sent().at(-1)).toEqual({ type: 'disarm' });
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'agent' });
  });

  it('an arm made while a navigation is in flight ends when the new document commits (its preload starts disarmed)', () => {
    const { wc } = store.add(A);
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://127.0.0.1:4000/b.html' });
    mode.set(A, true);
    const { epoch } = mode.state(A)!;
    wc.emit('did-navigate', {}, 'http://127.0.0.1:4000/b.html', 200, 'OK');
    expect(mode.state(A)).toMatchObject({ armed: false, epoch: epoch + 1 });
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'navigated' });
    wc.emit('did-navigate', {}, 'http://127.0.0.1:4000/c.html', 200, 'OK'); // an arm already ended: nothing more told
    expect(changes()).toHaveLength(2);
  });

  it('stops listening at dispose, and tells nothing afterwards', () => {
    const { wc } = store.add(A);
    mode.set(A, true);
    const told = emitted.length;
    mode.dispose();
    expect(store.listeners()).toBe(0);
    key(wc, {});
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://x.test/' });
    wc.emit('did-navigate', {}, 'http://x.test/', 200, 'OK');
    wc.emit('render-process-gone', {}, { reason: 'crashed' });
    wc.destroyed = true;
    wc.emit('destroyed');
    expect(emitted).toHaveLength(told);
  });
});

describe('the report gate (Design §8, §9)', () => {
  it('accepts the armed tab\'s one report: crops, sends the anchor to the owner window, disarms as picked', async () => {
    const { wc, send } = store.add(A);
    const shot = { path: '/u/browser/crops/b_aaaaaaaaaaaa-1-abcd.png', width: 192, height: 60 };
    capture.mockResolvedValueOnce({ crop: 'attached', screenshot: shot });
    mode.set(A, true);
    await mode.receive(wc as never, report());
    expect(capture).toHaveBeenCalledExactlyOnceWith(store.entry(A), report().rect);
    expect(picked(send)).toEqual([
      {
        tabId: A,
        appSessionId: 'App-A',
        crop: 'attached',
        anchor: {
          kind: 'browser-element',
          locator: '#increment',
          label: 'button “Increment”',
          pageUrl: URL_,
          screenshot: shot,
          css: '#increment',
          role: 'button',
          name: 'Increment',
          a11y: 'main > region “A form” > button “Increment”',
          box: { x: 248, y: 412, width: 96, height: 30 },
        },
      },
    ]);
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'picked' });
    expect(wc.sent().at(-1)).toEqual({ type: 'disarm' });
    expect(discard).not.toHaveBeenCalled();
  });

  it('drops, counts and disarms nothing for a report that is not the person\'s pick', async () => {
    const { wc, send } = store.add(A);
    const stranger = new FakeContents();
    await mode.receive(wc as never, report()); // not armed
    mode.set(A, true);
    await mode.receive(stranger as never, report()); // a sender not in the tab map
    await mode.receive(wc as never, report({ epoch: 0 })); // a stale epoch
    await mode.receive(wc as never, report({ requestId: 'r9' })); // a pickAt nobody asked for
    await mode.receive(wc as never, 'junk'); // nothing to match it to
    expect(mode.state(A)).toEqual({ armed: true, epoch: 1, dropped: 4 });
    expect(mode.foreignDropped()).toBe(1);
    const first = mode.receive(wc as never, report());
    await mode.receive(wc as never, report()); // a second report for one arm, while the first is cropped
    await first;
    expect(mode.state(A)!.dropped).toBe(5);
    expect(picked(send)).toHaveLength(1);
    expect(capture).toHaveBeenCalledOnce();
  });

  it('refuses, disarming with refused, a report from the armed tab that fails a check, and a refusal', async () => {
    const cases: unknown[] = [
      { type: 'refused', epoch: 1, requestId: null, reason: 'tooDeep' },
      { ...report(), extra: 1 }, // PickReportSchema is strict
      report({ description: { ...report().description, css: 'div, body' } }), // outside CSS_PATH
      report({ rect: { x: Number.NaN, y: 0, width: 1, height: 1 } }),
    ];
    for (const message of cases) {
      const tabId = `b_${String(cases.indexOf(message)).padStart(12, '0')}`;
      const { wc, send } = store.add(tabId);
      mode.set(tabId, true);
      await mode.receive(wc as never, message);
      expect(changes().at(-1)).toEqual({ tabId, on: false, reason: 'refused' });
      expect(picked(send)).toEqual([]);
    }
    expect(capture).not.toHaveBeenCalled();
  });

  it('a page URL that is not http(s) refuses the pick', async () => {
    const { wc } = store.add(A);
    wc.url = 'chrome-error://chromewebdata/';
    mode.set(A, true);
    await mode.receive(wc as never, report());
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'refused' });
  });

  it('drops the pick as closed when the owner window is gone, and lets its crop go', async () => {
    const { wc, win, send } = store.add(A);
    capture.mockResolvedValueOnce({ crop: 'attached', screenshot: { path: '/u/c.png', width: 2, height: 2 } });
    mode.set(A, true);
    win.destroyed = true;
    await mode.receive(wc as never, report());
    expect(picked(send)).toEqual([]);
    expect(changes().at(-1)).toEqual({ tabId: A, on: false, reason: 'closed' });
    expect(discard).toHaveBeenCalledExactlyOnceWith('/u/c.png');
  });

  it('abandons a pick whose tab navigated, disarmed or went while it was cropped', async () => {
    for (const interrupt of ['navigate', 'escape', 'agent', 'close'] as const) {
      const tabId = `b_00000000000${['navigate', 'escape', 'agent', 'close'].indexOf(interrupt)}`;
      const { wc, send } = store.add(tabId);
      capture.mockImplementationOnce(async () => {
        if (interrupt === 'navigate') wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://x.test/' });
        if (interrupt === 'escape') key(wc, {});
        if (interrupt === 'agent') store.setControl(tabId, 'agent');
        if (interrupt === 'close') store.destroyView(tabId);
        return { crop: 'attached', screenshot: { path: `/u/${interrupt}.png`, width: 2, height: 2 } };
      });
      mode.set(tabId, true);
      await mode.receive(wc as never, report());
      expect(picked(send)).toEqual([]);
      expect(discard).toHaveBeenLastCalledWith(`/u/${interrupt}.png`);
      expect(changes().filter((c) => (c as { reason: string }).reason === 'picked')).toEqual([]);
    }
  });

  it('sends the anchor without the picture, crop failed, when the screenshot would not make a valid anchor', async () => {
    const { wc, send } = store.add(A);
    const long = `/u/${'x'.repeat(1001)}.png`; // over AnchorScreenshotSchema's path cap
    capture.mockResolvedValueOnce({ crop: 'attached', screenshot: { path: long, width: 2, height: 2 } });
    mode.set(A, true);
    await mode.receive(wc as never, report());
    const [payload] = picked(send) as { crop: string; anchor: { screenshot?: unknown } }[];
    expect(payload.crop).toBe('failed');
    expect(payload.anchor.screenshot).toBeUndefined();
    expect(discard).toHaveBeenCalledExactlyOnceWith(long);
  });

  it('refuses, before disarming, a pick whose payload the X2 registry refuses, and lets its crop go', async () => {
    const { wc, send } = store.add(A, { appSessionId: '' as never }); // AppSessionIdSchema refuses an empty id
    capture.mockResolvedValueOnce({ crop: 'attached', screenshot: { path: '/u/x.png', width: 2, height: 2 } });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    mode.set(A, true);
    await mode.receive(wc as never, report());
    expect(picked(send)).toEqual([]);
    expect(changes().map((c) => (c as { reason: string }).reason)).toEqual(['armed', 'refused']);
    expect(discard).toHaveBeenCalledExactlyOnceWith('/u/x.png');
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it('passes the crop outcome through when there is no picture', async () => {
    const { wc, send } = store.add(A);
    capture.mockResolvedValueOnce({ crop: 'tooLarge' });
    mode.set(A, true);
    await mode.receive(wc as never, report());
    expect(picked(send)).toMatchObject([{ crop: 'tooLarge' }]);
  });
});

describe('pickAt (Design §7): the context menu\'s one-shot pick', () => {
  it('asks the preload at the point with a request id and the epoch, and accepts that one answer without arming', async () => {
    const { wc, send } = store.add(A);
    expect(mode.pickAt(A, 120.5, 40)).toBe(true);
    expect(wc.sent()).toEqual([{ type: 'pickAt', x: 120.5, y: 40, requestId: 'r1', epoch: 0 }]);
    await mode.receive(wc as never, report({ epoch: 0, requestId: 'r1' }));
    expect(picked(send)).toHaveLength(1);
    expect(changes()).toEqual([]); // never armed, so nothing to turn off
    await mode.receive(wc as never, report({ epoch: 0, requestId: 'r1' })); // answered once
    expect(mode.state(A)!.dropped).toBe(1);
  });

  it('drops an answer later than PICK_AT_MS, or after a navigation', async () => {
    const { wc, send } = store.add(A);
    mode.pickAt(A, 1, 1);
    now += PICK_AT_MS + 1;
    await mode.receive(wc as never, report({ epoch: 0, requestId: 'r1' }));
    mode.pickAt(A, 1, 1);
    wc.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url: 'http://x.test/' });
    await mode.receive(wc as never, report({ epoch: 0, requestId: 'r2' }));
    await mode.receive(wc as never, report({ epoch: 1, requestId: 'r2' }));
    expect(picked(send)).toEqual([]);
    expect(mode.state(A)!.dropped).toBe(3);
  });

  it('refuses a tab with no page or under the agent, and tells a refused answer', async () => {
    store.add(B, { control: 'agent' });
    store.add('b_000000000001', { suspended: true });
    expect(mode.pickAt(B, 1, 1)).toBe(false);
    expect(mode.pickAt('b_000000000001', 1, 1)).toBe(false);
    expect(mode.pickAt('b_00000000000f', 1, 1)).toBe(false);
    const { wc } = store.add(A);
    mode.pickAt(A, 1, 1);
    await mode.receive(wc as never, { type: 'refused', epoch: 0, requestId: 'r1', reason: 'noElement' });
    expect(changes()).toEqual([{ tabId: A, on: false, reason: 'refused' }]);
  });

  it('the agent taking the page drops a pending pick', async () => {
    const { wc, send } = store.add(A);
    mode.pickAt(A, 1, 1);
    store.setControl(A, 'agent');
    await mode.receive(wc as never, report({ epoch: 0, requestId: 'r1' }));
    expect(picked(send)).toEqual([]);
    expect(mode.state(A)!.dropped).toBe(1);
  });
});
