import { EventEmitter } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { WebContentsView } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { DEFAULT_PARTITION } from '@shared/browser/tab';
import { BROWSER_ACTION_TIMEOUT_MS, BROWSER_COVER_WAIT_MAX_MS, BROWSER_ERROR_DETAIL_MAX_CHARS, BROWSER_EVAL_MAX_CHARS, BROWSER_SCREENSHOT_MAX_BYTES, BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT, BROWSER_TOOL_ERRORS, BrowserScreenshotResultSchema, type BrowserDialog, type BrowserToolName, type BrowserWaitReason } from '@shared/maws/browser';
import { cutSnapshot } from '@shared/browser/snapshot';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { MawsBrowserAnswerResultSchema } from '@shared/ipc/schema/maws';
import { screenshotPath, screenshotsDir } from '@shared/maws/deliverable-files';
import { Navigator } from '../navigation';
import { TabStore, type TabEntry } from '../tabs';
import { TabInUseError, type Driver } from './driver';
import { personHolds } from './control';
import { BrowserHandlers, type AgentControl, type BrowserCall, type DownloadRefusal, type Waited } from './handlers';
import { FakePage, jpegBytes, pngBytes } from './page.fake';

// browser_snapshot, browser_act and browser_eval (E4c Design §5, §6, §11; Decision Log 3, 5, 22, 27, 30, 33, 37, 44 (b))
// over E4a's real TabStore and Navigator, a fake driver whose page is a recording fake Page, and a fake control whose
// pause point the test holds open. Time is vitest's fake clock throughout (the handlers' `now` is Date.now).

const A = 'App-A' as AppSessionId;
const B = 'App-B' as AppSessionId;

class FakeWebContents extends EventEmitter {
  url = '';
  loading = false;
  readonly navigationHistory = { canGoBack: () => false, canGoForward: () => false, getActiveIndex: () => 0, getEntryAtIndex: () => ({ url: this.url, title: '' }) };
  readonly loadURL = vi.fn<(url: string) => Promise<void>>(() => Promise.resolve());
  readonly reload = vi.fn();
  readonly close = vi.fn();
  readonly isDestroyed = () => false;
  readonly isLoading = () => this.loading;
  readonly getZoomFactor = () => 1;
  // Electron's capture of a covered page (browser_screenshot's viewport under a cover)
  readonly picture = { isEmpty: () => false, resize: () => this.picture, toPNG: () => pngBytes(800, 600, 2_000), toJPEG: () => jpegBytes(800, 600) };
  readonly capturePage = vi.fn(async () => this.picture);
}

const SNAPSHOT = ['- generic [ref=e1]:', '  - heading "E4c order form" [level=1] [ref=e2]', '  - textbox "Name" [ref=e3]', '  - button "Submit" [ref=e5]'].join('\n');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

function harness({ withCursor = false }: { withCursor?: boolean } = {}) {
  vi.useFakeTimers({ now: 1_000_000 });
  const emitted: { name: EventName; payload: unknown }[] = [];
  const emit = <N extends EventName>(name: N, payload: EventPayload<N>) => void emitted.push({ name, payload });
  let ids = 0;
  const store = new TabStore({
    emit,
    createView: () => ({ webContents: new FakeWebContents(), getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }) }) as unknown as WebContentsView,
    resolvePartition: () => DEFAULT_PARTITION,
    newTabId: () => `b_${(++ids).toString().padStart(12, '0')}`,
    schedule: () => {},
    now: Date.now,
  });
  const navigator = new Navigator({
    store,
    history: { visit: () => {}, setTitle: () => {} },
    favicons: { resolve: () => Promise.resolve(null) },
    emit,
    seam: { line: () => {}, openExternal: () => {} },
    now: Date.now,
  });
  store.onViewCreated((entry) => navigator.attach(entry));

  const page = new FakePage();
  const log: string[] = []; // control's calls and the page's dispatches, interleaved
  const drivers = { for: vi.fn(async (entry: TabEntry) => ({ entry, page: page.asPage(), browser: {}, bridge: {} }) as unknown as Driver) };
  let pausing: Promise<Waited> | null = null; // the test holds the pause point open with this
  const control: AgentControl = {
    pause: vi.fn(async (entry: TabEntry, signal: AbortSignal, report: (reason: BrowserWaitReason | null) => void) => {
      log.push('pause');
      if (!pausing) return { waitedFor: null, waitedMs: null };
      report('human');
      const aborted = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
      const waited = await Promise.race([pausing, aborted]);
      report(null);
      return waited;
    }),
    markActing: vi.fn((entry: TabEntry) => {
      log.push('acting');
      store.setControl(entry.tab.tabId, 'agent');
    }),
    actionEnded: vi.fn(() => void log.push('ended')),
    requestPending: vi.fn(),
    personHolds: (entry: TabEntry) => personHolds(entry, Date.now()),
  };
  const dialogs = { take: vi.fn<(tabId: string) => BrowserDialog[]>(() => []) };
  const cursor = { aim: vi.fn((_entry: TabEntry, box: object) => void log.push(`aim ${JSON.stringify(box)}`)), hide: vi.fn<(entry: TabEntry) => void>(() => void log.push('hide')) };
  const userData = mkdtempSync(join(tmpdir(), 'maws-e4c-handlers-'));
  userDataDirs.push(userData);
  const refusals = new Set<(refusal: DownloadRefusal) => void>();
  const handlers = new BrowserHandlers({
    store,
    navigator,
    control,
    drivers,
    dialogs,
    cursor: withCursor ? cursor : undefined,
    userData,
    reachable: (appSessionId) => [appSessionId],
    onDownloadRefused: (listener) => {
      refusals.add(listener);
      return () => void refusals.delete(listener);
    },
    emit,
  });
  for (const method of ['click', 'fill', 'selectOption', 'setChecked', 'press', 'hover', 'scrollIntoViewIfNeeded']) page.onAction.set(method, () => void log.push(method));

  const controller = new AbortController();
  const waits: [string, BrowserWaitReason | null][] = [];
  let requests = 0;
  const run = (tool: BrowserToolName, args: Record<string, unknown>, { signal = controller.signal, appSessionId = A, deliverableId = undefined as string | undefined } = {}) =>
    handlers.run({ appSessionId, requestId: `r${++requests}`, toolUseId: null, tool, args, deliverableId } as BrowserCall, {
      signal,
      startedAt: Date.now(),
      waiting: (tabId, reason) => void waits.push([tabId, reason]),
    });
  // A loaded tab of session A (a committed document), and a second one selected after it.
  const open = (url = 'https://a.test/', title = 'Page A') => {
    const tabId = store.open({ appSessionId: A, url, select: true }).tab.tabId;
    const contents = store.entry(tabId)!.view!.webContents as unknown as FakeWebContents;
    contents.url = url;
    contents.emit('did-navigate', {}, url, 200, 'OK');
    contents.emit('page-title-updated', {}, title, true);
    contents.emit('did-stop-loading');
    return tabId;
  };
  const cover = (tabId: string, covered: boolean) => store.update(tabId, { covered });
  // Chromium's main-frame events for a navigation a page call started: its start, its commit, its load's end
  const contentsOf = (tabId: string) => store.entry(tabId)!.view!.webContents as unknown as FakeWebContents;
  const navigation = {
    start: (tabId: string, url = 'https://a.test/next') => void contentsOf(tabId).emit('did-start-navigation', { isMainFrame: true, isSameDocument: false, url }),
    commit: (tabId: string, url = 'https://a.test/next') => void contentsOf(tabId).emit('did-navigate', {}, url, 200, 'OK'),
    stop: (tabId: string) => void contentsOf(tabId).emit('did-stop-loading'),
  };
  return {
    store, page, log, drivers, control, dialogs, cursor, controller, waits, emitted, run, open, cover, navigation, userData,
    hold: () => {
      const gate = deferred<Waited>();
      pausing = gate.promise;
      return gate;
    },
    refuse: (refusal: DownloadRefusal) => [...refusals].forEach((listener) => listener(refusal)),
    refusals,
    contents: (tabId: string) => store.entry(tabId)!.view!.webContents as unknown as FakeWebContents,
    acting: () => emitted.filter((e) => e.name === 'browser.agent.acting').map((e) => e.payload),
  };
}

const userDataDirs: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  for (const dir of userDataDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const resultOf = (answer: unknown) => (answer as { ok: true; result: Record<string, unknown> }).result;

describe('browser_snapshot (a read: Design §5, Decision Log 5)', () => {
  it('snapshots the whole page in ai mode, answers the cut text after a JSON header, and touches neither control nor the selection', async () => {
    const h = harness();
    const tabId = h.open();
    const other = h.open('https://b.test/', 'Page B'); // selected
    h.store.setControl(tabId, 'human'); // the person holds it: a read proceeds anyway
    h.page.snapshots.set('page', SNAPSHOT);
    const answer = await h.run('browser_snapshot', { tabId });
    expect(answer).toEqual({
      ok: true,
      result: { status: 'ok', tabId, url: 'https://a.test/', title: 'Page A', ms: 0, root: null, rootMatches: null, chars: SNAPSHOT.length, lines: 4, refs: 4, truncated: false, omitted: null },
      text: SNAPSHOT,
    });
    expect(h.page.calls).toMatchObject([{ method: 'ariaSnapshot', selector: 'page', args: [{ mode: 'ai' }] }]);
    expect(h.control.pause).not.toHaveBeenCalled();
    expect(h.control.markActing).not.toHaveBeenCalled();
    expect(h.store.list(A).selected[A]).toBe(other);
    expect(h.acting()).toEqual([]);
  });

  it('cuts a large page at maxChars (24,000 by default) with its header saying so', async () => {
    const h = harness();
    const tabId = h.open();
    const big = Array.from({ length: 2000 }, (_, i) => `- link "Item number ${i}" [ref=e${i + 10}]`).join('\n');
    h.page.snapshots.set('page', big);
    const whole = await h.run('browser_snapshot', { tabId });
    const cut = cutSnapshot(big, { maxChars: BROWSER_SNAPSHOT_MAX_CHARS_DEFAULT });
    expect(whole).toMatchObject({ ok: true, result: { truncated: true, chars: big.length, lines: 2000, refs: 2000, omitted: cut.omitted }, text: cut.text });
    const smaller = await h.run('browser_snapshot', { tabId, maxChars: 5000 });
    expect((smaller as { text: string }).text.length).toBeLessThanOrEqual(5000);
  });

  it('roots at a ref after counting it, and at the first match of a landmark role, saying how many matched', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e7', 1);
    h.page.snapshots.set('aria-ref=e7', '- form [ref=e7]:\n  - button "Go" [ref=e8]');
    expect(await h.run('browser_snapshot', { tabId, root: 'e7' })).toMatchObject({ ok: true, result: { root: 'e7', rootMatches: null, refs: 2 }, text: '- form [ref=e7]:\n  - button "Go" [ref=e8]' });
    expect(h.page.lines()).toEqual(['count aria-ref=e7', 'ariaSnapshot aria-ref=e7']);
    h.page.calls.length = 0;
    h.page.counts.set('role=navigation', 3);
    h.page.snapshots.set('role=navigation >> first', '- navigation "Global" [ref=e20]');
    expect(await h.run('browser_snapshot', { tabId, root: 'navigation' })).toMatchObject({ ok: true, result: { root: 'navigation', rootMatches: 3 } });
    expect(h.page.lines()).toEqual(['count role=navigation', 'ariaSnapshot role=navigation >> first']);
    expect(h.page.calls[1]!.args).toEqual([{ mode: 'ai', signal: h.controller.signal }]);
  });

  it('answers rootNotFound for a ref that resolves nothing, a ref of a gone frame, and an absent landmark', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=f2e1', new Error('locator.count: Invalid frame in aria-ref selector "aria-ref=f2e1"'));
    for (const root of ['e40', 'f2e1', 'main']) {
      expect(await h.run('browser_snapshot', { tabId, root })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.rootNotFound(root) });
    }
  });

  it('answers tabNotLoaded for a suspended tab and tabCrashed for a crashed one, before attaching', async () => {
    const h = harness();
    const suspended = h.open();
    h.store.suspend(suspended);
    const crashed = h.open('https://c.test/');
    h.contents(crashed).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    expect(await h.run('browser_snapshot', { tabId: suspended })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotLoaded('browser_snapshot', suspended, 'https://a.test/') });
    expect(await h.run('browser_snapshot', { tabId: crashed })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed('browser_snapshot', crashed) });
    expect(h.drivers.for).not.toHaveBeenCalled();
  });

  it("answers tabNotFound for another session's tab, and an attach failure as MAWS could not attach (Design §11)", async () => {
    const h = harness();
    const tabId = h.open();
    expect(await h.run('browser_snapshot', { tabId }, { appSessionId: B })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_snapshot', tabId) });
    h.drivers.for.mockRejectedValueOnce(new Error('the bridge announced no page\n  at somewhere'));
    expect(await h.run('browser_snapshot', { tabId, root: 'main' })).toEqual({
      ok: false,
      error: BROWSER_TOOL_ERRORS.actionFailed('browser_snapshot', 'snapshot', 'main', 'MAWS could not attach to the tab: the bridge announced no page'),
    });
  });

  it('answers tabInUse for a tab cua_repl drives (one automation owner per tab)', async () => {
    const h = harness();
    const tabId = h.open();
    h.drivers.for.mockRejectedValueOnce(new TabInUseError(tabId));
    expect(await h.run('browser_snapshot', { tabId })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabInUse('browser_snapshot', tabId) });
  });
});

describe('browser_act (Design §6: show, resolve, wait without input, the pause point, dispatch)', () => {
  it('clicks a ref in order: acting, locate, the input-free readiness wait, the pause point, the mark, the click with its own timeout', async () => {
    const h = harness();
    const other = h.open('https://b.test/', 'Page B');
    const tabId = h.open();
    h.store.select(A, other);
    h.page.snapshots.set('page', SNAPSHOT);
    await h.run('browser_snapshot', { tabId }); // names e5
    h.page.calls.length = 0;
    h.page.counts.set('aria-ref=e5', 1);
    const answer = await h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    expect(answer).toEqual({
      ok: true,
      result: { status: 'ok', tabId, url: 'https://a.test/', title: 'Page A', ms: 0, action: 'click', target: { ref: 'e5', role: 'button', name: 'Submit' }, navigated: false, waitedFor: null, waitedMs: null },
    });
    expect(h.page.lines()).toEqual(['count aria-ref=e5', 'waitFor visible aria-ref=e5', 'isEnabled aria-ref=e5', 'click aria-ref=e5']);
    expect(h.log).toEqual(['pause', 'acting', 'click', 'ended']);
    const click = h.page.calls.find((call) => call.method === 'click')!;
    expect(click.args).toEqual([{ timeout: 5_000, signal: h.controller.signal }]);
    expect(h.page.calls.find((call) => call.method === 'waitFor visible')!.args).toEqual([{ state: 'visible', timeout: BROWSER_ACTION_TIMEOUT_MS, signal: expect.any(AbortSignal) }]);
    expect(h.page.calls.some((call) => JSON.stringify(call.args).includes('trial'))).toBe(false);
    expect(h.store.list(A).selected[A]).toBe(tabId); // the acting tab comes forward
    expect(h.acting()).toEqual([{ appSessionId: A, tabId, actingSessionId: A }]);
  });

  it.each([
    ['fill', 'Ada', ['waitFor visible', 'isEnabled', 'isEditable', 'fill'], ['Ada']],
    ['select', 'Banana', ['waitFor visible', 'isEnabled', 'isEditable', 'selectOption'], ['Banana']],
    ['check', undefined, ['waitFor visible', 'isEnabled', 'setChecked'], [true]],
    ['check', 'false', ['waitFor visible', 'isEnabled', 'setChecked'], [false]],
    ['press', 'Enter', ['waitFor visible', 'isEnabled', 'press'], ['Enter']], // a key to a button or a link: no editable check
    ['hover', undefined, ['waitFor visible', 'isEnabled', 'hover'], []],
    ['scroll', undefined, ['waitFor attached', 'scrollIntoViewIfNeeded'], []],
  ] as const)('%s (value %s) waits for what it needs and dispatches its Playwright call', async (action, value, methods, values) => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e3', 1);
    const answer = await h.run('browser_act', { tabId, action, target: 'e3', ...(value === undefined ? {} : { value }) });
    expect(answer).toMatchObject({ ok: true, result: { action, target: { ref: 'e3' } } });
    expect(h.page.calls.filter((call) => call.selector === 'aria-ref=e3' && call.method !== 'count').map((call) => call.method)).toEqual(methods);
    const dispatched = h.page.calls.find((call) => call.method === methods.at(-1))!;
    expect(dispatched.args).toEqual([...values, { timeout: 5_000, signal: h.controller.signal }]);
  });

  it('scrolls into view, then hovers and wheels by value pixels when given', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e3', 1);
    await h.run('browser_act', { tabId, action: 'scroll', target: 'e3', value: '-240' });
    expect(h.page.lines()).toEqual(['count aria-ref=e3', 'waitFor attached aria-ref=e3', 'scrollIntoViewIfNeeded aria-ref=e3', 'hover aria-ref=e3', 'mouse.wheel']);
    expect(h.page.calls.find((call) => call.method === 'mouse.wheel')!.args).toEqual([0, -240]);
  });

  it('acts on a locator target and reports what resolved', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('css=button.go', 2);
    const answer = await h.run('browser_act', { tabId, action: 'click', target: { css: 'button.go' } });
    expect(resultOf(answer).target).toEqual({ css: 'button.go', matches: 2 });
    expect(h.page.lines()).toContain('click css=button.go >> first');
  });

  it('polls isEnabled every 100 ms until the element is enabled, and only then passes the pause point', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.enabled.set('aria-ref=e5', [false, false, false, true]);
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(250);
    expect(h.log).toEqual([]);
    await vi.advanceTimersByTimeAsync(100);
    expect(await answer).toMatchObject({ ok: true });
    expect(h.page.lines().filter((line) => line.startsWith('isEnabled'))).toHaveLength(4);
    expect(h.log).toEqual(['pause', 'acting', 'click', 'ended']);
  });

  it('answers actionTimeout when the element is not ready within 10 s, having dispatched nothing', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.enabled.set('aria-ref=e5', [false]);
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(BROWSER_ACTION_TIMEOUT_MS + 200);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.actionTimeout('browser_act', 'click', 'e5', BROWSER_ACTION_TIMEOUT_MS) });
    expect(h.log).toEqual([]);
  });

  it('suspends the readiness wait while a sheet covers the page, not counting it, and says so (A-33 item 2)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.hidden.add('aria-ref=e5'); // not visible yet: the wait runs
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(4_000);
    h.cover(tabId, true);
    await vi.advanceTimersByTimeAsync(15_000); // longer than the whole deadline: the cover's time is not counted
    expect(h.waits).toEqual([[tabId, 'cover']]);
    expect(h.log).toEqual([]);
    h.cover(tabId, false);
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.waits).toEqual([[tabId, 'cover'], [tabId, null]]);
    h.page.hidden.delete('aria-ref=e5');
    await vi.advanceTimersByTimeAsync(20);
    expect(await answer).toMatchObject({ ok: true, result: { waitedFor: 'cover', waitedMs: 15_000 } });
    expect(h.page.lines().filter((line) => line.startsWith('waitFor visible'))).toHaveLength(2); // restarted after the cover
  });

  it('waits for a cover that is up before the wait starts, and times out on the uncovered time alone', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.hidden.add('aria-ref=e5');
    h.cover(tabId, true);
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(50_000); // under A-47's bound
    expect(h.page.lines()).toEqual(['count aria-ref=e5']);
    h.cover(tabId, false);
    await vi.advanceTimersByTimeAsync(BROWSER_ACTION_TIMEOUT_MS + 100);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.actionTimeout('browser_act', 'click', 'e5', BROWSER_ACTION_TIMEOUT_MS) });
  });

  it('answers pageCovered once its waits under covers, summed over the call, pass 60 s, dispatching nothing and clearing the wait (A-47)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.hidden.add('aria-ref=e5');
    h.cover(tabId, true);
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(40_000);
    h.cover(tabId, false); // lifted: 40 s counted, the readiness wait runs again
    await vi.advanceTimersByTimeAsync(2_000);
    h.cover(tabId, true); // a second cover has the 20 s left
    let settled = false;
    void answer.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(BROWSER_COVER_WAIT_MAX_MS - 40_000 - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.pageCovered('browser_act', 60) });
    expect(h.waits).toEqual([[tabId, 'cover'], [tabId, null], [tabId, 'cover'], [tabId, null]]);
    expect(h.log).toEqual([]);
  });

  it('waits at the pause point while the person holds the page, then dispatches and says how long it waited', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    const gate = h.hold();
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.log).toEqual(['pause']);
    expect(h.page.lines()).not.toContain('click aria-ref=e5');
    expect(h.waits).toEqual([[tabId, 'human']]);
    gate.resolve({ waitedFor: 'human', waitedMs: 5_000 });
    expect(await answer).toMatchObject({ ok: true, result: { waitedFor: 'human', waitedMs: 5_000 } });
    expect(h.log).toEqual(['pause', 'acting', 'click', 'ended']);
  });

  it('answers nothing and dispatches nothing when aborted at the pause point', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.hold();
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(1_000);
    h.controller.abort(new Error('withdrawn'));
    expect(await answer).toBeNull();
    expect(h.log).toEqual(['pause']);
    expect(h.store.entry(tabId)!.tab.control).toBe('idle');
  });

  it('answers nothing and dispatches nothing when aborted during the readiness wait or before the pause point', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.hidden.add('aria-ref=e5');
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(2_000);
    h.controller.abort(new Error('withdrawn'));
    expect(await answer).toBeNull();
    expect(h.log).toEqual([]);
    const aborted = new AbortController();
    aborted.abort(new Error('already'));
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' }, { signal: aborted.signal })).toBeNull();
    expect(h.log).toEqual([]);
  });

  it('does not reach the pause point for a request aborted as its readiness wait ended (Decision Log 3)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onCheck = () => h.controller.abort(new Error('withdrawn')); // the element is ready just as the host withdraws
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).toBeNull();
    expect(h.control.pause).not.toHaveBeenCalled(); // control.ts never enters `human` for a request already gone
    expect(h.log).toEqual([]);
  });

  it('waits for the load of a navigation the act started and says it navigated', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onAction.set('click', () => {
      h.navigation.start(tabId, 'https://a.test/done.html');
      h.page.currentUrl = 'https://a.test/done.html';
    });
    let settled = false;
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' }).then((result) => ((settled = true), result));
    await vi.advanceTimersByTimeAsync(500);
    expect(settled).toBe(false); // started, not loaded
    h.navigation.commit(tabId, 'https://a.test/done.html');
    await vi.advanceTimersByTimeAsync(100);
    expect(settled).toBe(false); // committed, still loading
    h.navigation.stop(tabId);
    expect(resultOf(await answer).navigated).toBe(true);
  });

  it('answers at once when the act started no navigation, and caps a slow load at the 2 s grace', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    expect(resultOf(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).navigated).toBe(false);
    h.page.onAction.set('click', () => h.navigation.start(tabId));
    const slow = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await slow).toMatchObject({ ok: true });
  });

  it('answers downloadRefused for a download the act started, at once rather than after the whole grace (A-31)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onAction.set('click', () => {
      h.refuse({ tabId: 'b_999999999999', url: 'https://x.test/other.zip', filename: 'other.zip' }); // another tab's
      h.refuse({ tabId, url: 'https://a.test/report.pdf', filename: 'report.pdf' });
    });
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(0);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_act', 'https://a.test/report.pdf', 'report.pdf') });
    expect(h.log).toEqual(['pause', 'acting', 'ended']);
    expect(h.refusals.size).toBe(0);
  });

  it('answers downloadRefused for a download that arrives after the click returned: the navigation started, no document commits', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onAction.set('click', () => h.navigation.start(tabId, 'https://a.test/report.pdf'));
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(160);
    h.refuse({ tabId, url: 'https://a.test/report.pdf', filename: 'report.pdf' });
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_act', 'https://a.test/report.pdf', 'report.pdf') });
  });

  it('settles a navigation that stops without a commit after a short grace, in which a refusal still wins', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onAction.set('click', () => h.navigation.start(tabId, 'https://a.test/204'));
    const stopped = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(50);
    h.navigation.stop(tabId); // a 204: no commit, no failure
    await vi.advanceTimersByTimeAsync(250);
    expect(await stopped).toMatchObject({ ok: true, result: { navigated: false } });
    h.page.onAction.set('click', () => h.navigation.start(tabId, 'https://a.test/x.zip'));
    const download = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(50);
    h.navigation.stop(tabId); // the download's abort stops the load before the refusal is told
    await vi.advanceTimersByTimeAsync(100);
    h.refuse({ tabId, url: 'https://a.test/x.zip', filename: 'x.zip' });
    expect(await download).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_act', 'https://a.test/x.zip', 'x.zip') });
  });

  it('answers tabCrashed when the renderer dies during the readiness wait', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.hidden.add('aria-ref=e5');
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(1_000);
    h.contents(tabId).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    h.page.closedWith = new Error('locator.waitFor: Target page, context or browser has been closed');
    await vi.advanceTimersByTimeAsync(20);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed('browser_act', tabId) });
    expect(h.log).toEqual([]);
  });

  it('waits out a cover raised while the person held the page, then passes the pause point again (Decision Log 64)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    const gate = h.hold();
    const answer = h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    await vi.advanceTimersByTimeAsync(1_000);
    h.cover(tabId, true); // the person opens the palette while they hold the page
    gate.resolve({ waitedFor: 'human', waitedMs: 1_000 });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(h.log).toEqual(['pause']); // released, but the sheet holds the action
    expect(h.waits.at(-1)).toEqual([tabId, 'cover']);
    h.cover(tabId, false);
    expect(await answer).toMatchObject({ ok: true, result: { waitedFor: 'human', waitedMs: 2_000 } });
    expect(h.log).toEqual(['pause', 'pause', 'acting', 'click', 'ended']);
    expect(h.page.lines().filter((line) => line.startsWith('waitFor visible'))).toHaveLength(2);
  });

  it("answers a failed dispatch as actionFailed with Playwright's message, and targetNotFound before any dispatch", async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.onAction.set('click', () => {
      throw new Error('locator.click: Element is not attached to the DOM\nCall log:\n  - waiting');
    });
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).toEqual({
      ok: false,
      error: BROWSER_TOOL_ERRORS.actionFailed('browser_act', 'click', 'e5', 'Element is not attached to the DOM'),
    });
    expect(h.log).toEqual(['pause', 'acting', 'ended']);
    h.log.length = 0;
    const missing = h.run('browser_act', { tabId, action: 'click', target: { css: '#gone' } });
    await vi.advanceTimersByTimeAsync(2_100);
    expect(await missing).toEqual({ ok: false, error: 'browser_act: no element matches {css: "#gone"} (0 matches)' });
    expect(h.log).toEqual([]);
  });

  it('answers a stale ref by name (Design §11)', async () => {
    const h = harness();
    const tabId = h.open();
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.staleRef('browser_act', 'e5', 'missing') });
  });
});

describe("browser_act: the agent's cursor (Design §9; Decision Log 68)", () => {
  it("aims at the element's box between the mark and the dispatch, after the pause point", async () => {
    const h = harness({ withCursor: true });
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    h.page.boxes.set('aria-ref=e5', { x: 10, y: 20, width: 30, height: 40 });
    await h.run('browser_act', { tabId, action: 'fill', target: 'e5', value: 'Ada' });
    expect(h.log).toEqual(['pause', 'acting', 'aim {"x":10,"y":20,"width":30,"height":40}', 'fill', 'ended']);
    expect(h.cursor.aim).toHaveBeenCalledWith(h.store.entry(tabId), { x: 10, y: 20, width: 30, height: 40 });
  });

  it('goes back through the pause point when the person takes the page while the agent aims, then aims and acts', async () => {
    const h = harness({ withCursor: true });
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    let aims = 0;
    h.page.boxes.set('aria-ref=e5', () => {
      if (aims++ === 0) {
        h.store.setControl(tabId, 'human'); // the person's click lands during the aim
        const gate = h.hold();
        void Promise.resolve().then(() => gate.resolve({ waitedFor: 'human', waitedMs: 700 }));
      }
      return { x: 0, y: 0, width: 2, height: 2 };
    });
    const answer = await h.run('browser_act', { tabId, action: 'click', target: 'e5' });
    const aim = 'aim {"x":0,"y":0,"width":2,"height":2}';
    expect(h.log).toEqual(['pause', 'acting', aim, 'pause', 'acting', aim, 'click', 'ended']);
    expect(answer).toMatchObject({ ok: true, result: { waitedFor: 'human', waitedMs: 700 } });
  });

  it('acts without the cursor when the box cannot be read, and never after an abort that came while it was read', async () => {
    const h = harness({ withCursor: true });
    const tabId = h.open();
    h.page.counts.set('aria-ref=e5', 1);
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).toMatchObject({ ok: true });
    expect(h.cursor.aim).not.toHaveBeenCalled();
    expect(h.log).toEqual(['pause', 'acting', 'click', 'ended']);
    h.log.length = 0;
    h.page.boxes.set('aria-ref=e5', () => {
      h.controller.abort(new Error('cancelled'));
      return { x: 0, y: 0, width: 1, height: 1 };
    });
    expect(await h.run('browser_act', { tabId, action: 'click', target: 'e5' })).toBeNull();
    expect(h.log).toEqual(['pause', 'acting', 'aim {"x":0,"y":0,"width":1,"height":1}', 'ended']);
  });
});

describe('browser_eval (an action: Design §6, Decision Log 5)', () => {
  it('passes the pause point and marks the agent, evaluates the expression as a string, and answers its value as JSON', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = async () => ({ heading: 'Example', count: 2, at: undefined });
    const pending = h.run('browser_eval', { tabId, expression: 'document.title' });
    await vi.advanceTimersByTimeAsync(250); // the window in which a navigation the expression started would begin
    const answer = await pending;
    expect(answer).toEqual({ ok: true, result: { status: 'ok', tabId, url: 'https://a.test/', title: 'Page A', ms: 250, value: { heading: 'Example', count: 2 }, truncated: false } });
    expect(h.page.calls).toEqual([{ method: 'evaluate', selector: null, args: ['document.title'] }]);
    expect(h.log).toEqual(['pause', 'acting', 'ended']);
    expect(h.acting()).toEqual([{ appSessionId: A, tabId, actingSessionId: A }]);
  });

  it('never waits for a cover: script runs in a hidden page, so a covered tab evaluates at once (A-47 holds trivially)', async () => {
    const h = harness();
    const tabId = h.open();
    h.cover(tabId, true);
    h.page.onEvaluate = async () => 2;
    const pending = h.run('browser_eval', { tabId, expression: '1 + 1' });
    await vi.advanceTimersByTimeAsync(250);
    expect(resultOf(await pending)).toMatchObject({ value: 2 });
    expect(h.waits).toEqual([]);
  });

  it('cuts a long value at 16,000 characters', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = async () => 'x'.repeat(BROWSER_EVAL_MAX_CHARS + 50);
    const pending = h.run('browser_eval', { tabId, expression: 'document.body.innerText' });
    await vi.advanceTimersByTimeAsync(250);
    expect(resultOf(await pending)).toMatchObject({ value: 'x'.repeat(BROWSER_EVAL_MAX_CHARS), truncated: true });
  });

  it("answers the page's exception as evalFailed", async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = async () => {
      throw new Error('page.evaluate: ReferenceError: nope is not defined\n    at eval (eval at evaluate (:311:30), <anonymous>:1:1)');
    };
    expect(await h.run('browser_eval', { tabId, expression: 'nope' })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.evalFailed('ReferenceError: nope is not defined') });
    expect(h.log).toEqual(['pause', 'acting', 'ended']);
  });

  it("cuts a page's long exception message, so the answer and its journaled row stay bounded", async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = async () => {
      throw new Error(`page.evaluate: Error: ${'x'.repeat(50_000)}\n    at eval`);
    };
    const answer = await h.run('browser_eval', { tabId, expression: 'throw new Error("x".repeat(50000))' });
    expect(answer).toEqual({ ok: false, error: `browser_eval: Error: ${'x'.repeat(BROWSER_ERROR_DETAIL_MAX_CHARS - 'Error: '.length - 1)}…` });
  });

  it('waits for the person at the pause point, and never evaluates when aborted there', async () => {
    const h = harness();
    const tabId = h.open();
    h.hold();
    const answer = h.run('browser_eval', { tabId, expression: '1' });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.page.calls).toEqual([]);
    h.controller.abort(new Error('withdrawn'));
    expect(await answer).toBeNull();
    expect(h.page.calls).toEqual([]);
  });

  it('answers a promise that never settles as evalFailed before the host gives up, and nothing when aborted meanwhile', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = () => new Promise(() => {});
    const answer = h.run('browser_eval', { tabId, expression: 'new Promise(() => {})' });
    await vi.advanceTimersByTimeAsync(28_000);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.evalFailed('the expression did not settle within 28 s') });
    const cancelled = h.run('browser_eval', { tabId, expression: 'new Promise(() => {})' });
    await vi.advanceTimersByTimeAsync(1_000);
    h.controller.abort(new Error('withdrawn'));
    expect(await cancelled).toBeNull();
  });

  it('answers downloadRefused for a download the evaluation started, which arrives after evaluate returned', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onEvaluate = async () => undefined; // `location = …` returns at once
    const answer = h.run('browser_eval', { tabId, expression: "location = '/x.zip'" });
    await vi.advanceTimersByTimeAsync(5);
    h.navigation.start(tabId, 'https://a.test/x.zip'); // the navigation begins just after
    await vi.advanceTimersByTimeAsync(155);
    h.refuse({ tabId, url: 'https://a.test/x.zip', filename: 'x.zip' }); // ~160 ms later, the download
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.downloadRefused('browser_eval', 'https://a.test/x.zip', 'x.zip') });
    expect(h.log).toEqual(['pause', 'acting', 'ended']);
  });

  it('answers tabCrashed when the renderer dies during the evaluation', async () => {
    const h = harness();
    const tabId = h.open();
    let fail!: (error: Error) => void;
    h.page.onEvaluate = () => new Promise((_, reject) => (fail = reject));
    const answer = h.run('browser_eval', { tabId, expression: 'while (true) {}' });
    await vi.advanceTimersByTimeAsync(1_000);
    h.contents(tabId).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    fail(new Error('page.evaluate: Target crashed'));
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed('browser_eval', tabId) });
  });
});

describe('dialogs (Decision Log 33, 35, 37; the seam Task 2.4 fills)', () => {
  it("adds the tab's answered dialogs to a successful result, and leaves them for the next result after an error", async () => {
    const h = harness();
    const tabId = h.open();
    h.page.snapshots.set('page', SNAPSHOT);
    expect(resultOf(await h.run('browser_snapshot', { tabId }))).not.toHaveProperty('dialogs');
    h.dialogs.take.mockReturnValueOnce([{ type: 'alert', message: 'Saved' }]);
    expect(resultOf(await h.run('browser_snapshot', { tabId })).dialogs).toEqual([{ type: 'alert', message: 'Saved' }]);
    expect(h.dialogs.take).toHaveBeenLastCalledWith(tabId);
    h.dialogs.take.mockClear();
    expect((await h.run('browser_act', { tabId, action: 'click', target: 'e99' }))?.ok).toBe(false);
    expect(h.dialogs.take).not.toHaveBeenCalled();
  });
});

describe('browser_screenshot (a read: Design §7, Decision Log 5, 23, 43, 44 (b), 47)', () => {
  const ID = '6f1c2a4e-3b5d-4c7e-8f90-a1b2c3d4e5f6';
  const shotsOf = (h: ReturnType<typeof harness>) => screenshotsDir(h.userData, A);

  it('captures the viewport, writes it at the path main derives, and answers the result and the image, touching nothing', async () => {
    const h = harness({ withCursor: true });
    const tabId = h.open();
    const other = h.open('https://b.test/', 'Page B'); // selected
    h.store.setControl(tabId, 'human'); // the person holds it: a read proceeds anyway
    const picture = pngBytes(1280, 800, 5_000);
    h.page.onScreenshot = () => picture;
    const answer = await h.run('browser_screenshot', { tabId }, { deliverableId: ID });
    const path = screenshotPath(h.userData, A, ID, 'png');
    expect(answer).toEqual({
      ok: true,
      result: { status: 'ok', tabId, url: 'https://a.test/', title: 'Page A', ms: 0, deliverableId: ID, path, width: 1280, height: 800, bytes: 5_000, mimeType: 'image/png', target: null, fullPage: false },
      image: { path, mimeType: 'image/png', width: 1280, height: 800, bytes: 5_000 },
    });
    expect(BrowserScreenshotResultSchema.safeParse(resultOf(answer)).success).toBe(true); // what the host checks
    expect(MawsBrowserAnswerResultSchema.safeParse(answer).success).toBe(true);
    expect(readFileSync(path).equals(picture)).toBe(true);
    expect(h.page.calls).toMatchObject([{ method: 'screenshot', selector: 'page' }]);
    // a read: no pause point, no control change, no selection change, no acting tab, no cursor message
    expect(h.control.pause).not.toHaveBeenCalled();
    expect(h.control.markActing).not.toHaveBeenCalled();
    expect(h.store.entry(tabId)!.tab.control).toBe('human');
    expect(h.store.list(A).selected[A]).toBe(other);
    expect(h.acting()).toEqual([]);
    expect(h.cursor.aim).not.toHaveBeenCalled();
    expect(h.cursor.hide).not.toHaveBeenCalled();
  });

  it('captures a ref target with its snapshot role and name, and a locator target with its matches', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.snapshots.set('page', SNAPSHOT);
    await h.run('browser_snapshot', { tabId });
    h.page.counts.set('aria-ref=e5', 1);
    h.page.counts.set('css=.card', 3);
    h.page.onScreenshot = (selector) => (selector === 'page' ? pngBytes(1, 1) : pngBytes(120, 40));
    expect(resultOf(await h.run('browser_screenshot', { tabId, target: 'e5' }, { deliverableId: ID }))).toMatchObject({ target: { ref: 'e5', role: 'button', name: 'Submit' }, width: 120, height: 40, fullPage: false });
    expect(resultOf(await h.run('browser_screenshot', { tabId, target: { css: '.card' } }, { deliverableId: ID }))).toMatchObject({ target: { css: '.card', matches: 3 } });
    expect(h.page.calls.filter((call) => call.method === 'screenshot').map((call) => call.selector)).toEqual(['aria-ref=e5', 'css=.card >> first']);
  });

  it('answers screenshotFailed, capturing and writing nothing, when the request carries no record id (Decision Log 77 (d))', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onScreenshot = () => pngBytes(10, 10);
    expect(await h.run('browser_screenshot', { tabId })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.screenshotFailed('the request carries no deliverable id') });
    expect(h.page.calls.filter((call) => call.method === 'screenshot')).toEqual([]);
    expect(existsSync(screenshotsDir(h.userData, A))).toBe(false);
  });

  it('writes the JPEG retake of an oversize full page as .jpg', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onScreenshot = (_selector, options) => (options.type === 'png' ? pngBytes(1280, 9_000, BROWSER_SCREENSHOT_MAX_BYTES + 1) : jpegBytes(1280, 9_000, { size: 700_000 }));
    const answer = await h.run('browser_screenshot', { tabId, fullPage: true }, { deliverableId: ID });
    const path = screenshotPath(h.userData, A, ID, 'jpg');
    expect(resultOf(answer)).toMatchObject({ path, mimeType: 'image/jpeg', bytes: 700_000, width: 1280, height: 9_000, fullPage: true });
    expect(answer).toMatchObject({ image: { path, mimeType: 'image/jpeg', bytes: 700_000 } });
    expect(existsSync(screenshotPath(h.userData, A, ID, 'png'))).toBe(false);
  });

  it('writes nothing for a refusal: too large, a stale ref, another session, a suspended tab', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onScreenshot = () => pngBytes(1280, 99_000, BROWSER_SCREENSHOT_MAX_BYTES + 1);
    expect(await h.run('browser_screenshot', { tabId, fullPage: true }, { deliverableId: ID })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.screenshotTooLarge(BROWSER_SCREENSHOT_MAX_BYTES + 1) });
    expect(await h.run('browser_screenshot', { tabId, target: 'e9' }, { deliverableId: ID })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.staleRef('browser_screenshot', 'e9', 'missing') });
    expect(await h.run('browser_screenshot', { tabId }, { appSessionId: B, deliverableId: ID })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotFound('browser_screenshot', tabId) });
    h.store.suspend(tabId);
    expect(await h.run('browser_screenshot', { tabId }, { deliverableId: ID })).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabNotLoaded('browser_screenshot', tabId, 'https://a.test/') });
    expect(existsSync(shotsOf(h))).toBe(false);
  });

  it("captures a covered viewport through Electron's capturePage after hiding the cursor", async () => {
    const h = harness({ withCursor: true });
    const tabId = h.open();
    h.cover(tabId, true);
    const answer = h.run('browser_screenshot', { tabId }, { deliverableId: ID });
    await vi.advanceTimersByTimeAsync(50);
    expect(resultOf(await answer)).toMatchObject({ width: 800, height: 600, mimeType: 'image/png', bytes: 2_000 });
    expect(h.cursor.hide).toHaveBeenCalledWith(h.store.entry(tabId));
    expect(h.contents(tabId).capturePage).toHaveBeenCalledTimes(1);
    expect(h.page.calls).toEqual([]);
  });

  it('answers pageCovered for a target held under a cover for 60 s, writing nothing (A-47)', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('css=#chart', 1);
    h.page.onScreenshot = () => pngBytes(300, 200);
    h.cover(tabId, true);
    const answer = h.run('browser_screenshot', { tabId, target: { css: '#chart' } }, { deliverableId: ID });
    await vi.advanceTimersByTimeAsync(BROWSER_COVER_WAIT_MAX_MS);
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.pageCovered('browser_screenshot', 60) });
    expect(h.waits).toEqual([[tabId, 'cover'], [tabId, null]]);
    expect(h.page.calls.filter((call) => call.method === 'screenshot')).toEqual([]);
    expect(existsSync(shotsOf(h))).toBe(false);
  });

  it('waits out a cover for a target, reporting it to the host and the row', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.counts.set('css=#chart', 1);
    h.page.onScreenshot = () => pngBytes(300, 200);
    h.cover(tabId, true);
    const answer = h.run('browser_screenshot', { tabId, target: { css: '#chart' } }, { deliverableId: ID });
    await vi.advanceTimersByTimeAsync(3_000);
    expect(h.waits).toEqual([[tabId, 'cover']]);
    h.cover(tabId, false);
    expect(resultOf(await answer)).toMatchObject({ width: 300, height: 200 });
    expect(h.waits).toEqual([[tabId, 'cover'], [tabId, null]]);
  });

  it('answers nothing and writes nothing when cancelled during the capture', async () => {
    const h = harness();
    const tabId = h.open();
    h.page.onScreenshot = (_selector, options) => new Promise((_, reject) => options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    const answer = h.run('browser_screenshot', { tabId }, { deliverableId: ID });
    await vi.advanceTimersByTimeAsync(100);
    h.controller.abort('withdrawn');
    expect(await answer).toBeNull();
    expect(existsSync(shotsOf(h))).toBe(false);
  });

  it('answers tabCrashed when the renderer dies during the capture', async () => {
    const h = harness();
    const tabId = h.open();
    let fail!: (error: Error) => void;
    h.page.onScreenshot = () => new Promise((_, reject) => (fail = reject));
    const answer = h.run('browser_screenshot', { tabId }, { deliverableId: ID });
    await vi.advanceTimersByTimeAsync(100);
    h.contents(tabId).emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
    fail(new Error('page.screenshot: Target crashed'));
    expect(await answer).toEqual({ ok: false, error: BROWSER_TOOL_ERRORS.tabCrashed('browser_screenshot', tabId) });
  });
});
