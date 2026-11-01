// The render host as a tab engine (P5 O17 M4; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M4, Interfaces §D, §E,
// §F, §H; D1, D11): with no app attached, an agent's tabs live here, in offscreen views (offscreen-views.ts), served to
// cua over a per-session socket by the app's own primitive server. Nothing of src/main/browser/ moves or is renamed: the
// TabStore, the guarded partitions, the navigator, the page guards, `window.open`'s adoption, the input seams, the
// debugger leases and presence are composed here through their deps, with three of the server's options set as the app
// leaves them not (`socketDir`, `orphans`, `creations`; cua/index.ts).
//
// `mawsd` drives it with `browserEngine.request` (the host's request loop hands each here; each is answered once with
// `browserEngine.answer`):
// - `prepare`: the session's socket under `renderCuaSocketDir` listens, admitting only `mawsd`'s confirmed relay (the
//   peer of this process's `machine.sock` link, through the addon, confirmed by `machine.identity` on that link; no
//   trusted roots in production, §H). The request names a side thread's parent (P5 O17 M5: `mawsd` reads it from its own
//   index), for the existing reach rule: a side thread reaches its parent's tabs (P-24). Answered null once both hold,
//   then the session's inventory is pushed (`browserEngine.state`); a session already served answers at once.
// - `drop`: the session's tabs closed, its socket closed and its connections ended (each lease let go), its partition's
//   storage and cache cleared, its browser work reported zero, then answered null (the partition's reason when it could
//   not be cleared). Only that session's tabs close. A session's prepares and drops run one at a time, in the order
//   sent; a prepare cleans a partition a drop left uncleared first, or is refused with the reason.
// - `inventory`: the session's tabs, bounded (screencast.ts), or `unavailable` for a session not served here.
// - M6: `open`, `ack`, `input` and `close`, a viewer's subscription to one of the session's tabs, served by the producer
//   (src/main/browser/screencast.ts): its frames go to `mawsd` as `browserEngine.frame` and its own end as
//   `browserEngine.ended`. `open` joins the session's serial chain, so it follows a prepare it was sent after and a drop
//   sent after it finds its subscription; it does no waiting of its own, so a drop behind it is never held up. `ack`,
//   `input` and `close` act on a subscription already open and answer at once. A drop closes the session's
//   subscriptions first, telling no one (`mawsd` ended them when it made the connection retiring); a frame `mawsd`
//   refuses (a subscription it has settled) closes it here too.
// The inventory is pushed again at each change of the session's tabs (the store's coalesced `browser.tabs.changed`), only
// when it changed; nothing polls.
//
// Each session's tabs open in a partition of its own, in memory (no `persist:`), so one session's cookies never reach
// another's and none outlives the render host, whose userData is cleared at each start; a drop clears it, so a session
// prepared again (§B: tabs, cookies and in-flight commands are lost at a handover) starts with nothing.
// No imported profile, no browser preload, no application window; a page's download is refused (no person is there to
// save it, and nothing here may write it), its `mailto:` and external links go nowhere. A page's `alert` and `confirm`
// never reach Electron's own box, which for an offscreen page is a parentless modal that would stall the engine: the
// app's dialog wrap (agent/dialogs.ts) answers them with the defaults, or holds a leased tab's for cua (cua/dialogs.ts).
//
// The fence (§E): a `tabs.create` passes the creation gate first. At the session's first tab (no tab and no creation in
// flight) it acquires with `browserEngine.work {held: true}`, which `mawsd` answers only once the engine host has
// acknowledged a snapshot naming the session; a rejection answers the primitive with its reason and no tab is made.
// Concurrent creations share one acquire. A popup adopted from a session's tab needs none (the session already holds,
// and the child is counted the moment it is adopted, before its opener can close). When the session holds no tab and no
// creation is in flight, `browserEngine.work {held: false}` reports its zero: only ever after an acquire that succeeded
// (one refused or failed made no tab and holds nothing at `mawsd`).
//
// The caps (D11): HEADLESS_TABS, tabs plus creations in flight; past either, `tabs.create` answers its reason and a page's
// popup is denied, at its admission and again when Chromium hands its child over (another popup or creation may have
// taken the room meanwhile, its opener closed or its session been dropped). The orphan policy (D1): a tab whose creating connection closed is adopted, at its first lease or
// close, by a connection of its own session (claims.ts), so a tab whose cua connection died can still be closed.
// `windows.query` answers one synthetic window, so the query that follows a promotion agrees with `windows.create`.
import type { Session, WebContents, WebContentsView, WebPreferences } from 'electron';
import type { BrowserTabSummary } from '@shared/browser/screencast';
import { BROWSER_SUMMARY_BOUNDS } from '@shared/browser/screencast';
import type { BrowserTab } from '@shared/browser/tab';
import type { AppSessionId } from '@shared/graph/ids';
import type { CommandResult } from '@shared/ipc/schema';
import type { BrowserEngineRequest, BrowserEngineResult, EngineInventory } from '@shared/ipc/schema/browser-engine';
import { TabControls } from '../main/browser/agent/control';
import { AgentCursor } from '../main/browser/agent/cursor';
import { PageDialogs } from '../main/browser/agent/dialogs';
import { startCuaBackend, type CuaBackend } from '../main/browser/cua';
import type { PeerAddon } from '../main/browser/cua/peer';
import { attachInputSeams } from '../main/browser/input';
import { startScreencast, type ScreencastDeps } from '../main/browser/screencast';
import { Navigator } from '../main/browser/navigation';
import { Partitions } from '../main/browser/partition';
import { guardPage, preparePermissions } from '../main/browser/permissions';
import { TabStore, type BrowserEmit, type OpenRequest, type TabEntry } from '../main/browser/tabs';
import { attachWindowOpen } from '../main/browser/window-open';
import type { EngineCall } from './host';

export const HEADLESS_TABS = { session: 32, total: 64 } as const; // D11: tabs and creations in flight
export const HEADLESS_WINDOW = { id: 1, focused: true } as const; // windows.query's one window, every session's

// A session's partition: in memory (no `persist:`), its own
export const headlessPartition = (appSessionId: AppSessionId): string => `maws-headless-${appSessionId}`;

// Where the views live (offscreen-views.ts's OffscreenViews; a stand-in in the tests)
export interface TabEngineViews {
  readonly childPreferences: WebPreferences;
  createView(tab: BrowserTab, adopted?: WebContents): WebContentsView;
  place(entry: TabEntry): void;
  unplace(entry: TabEntry): void;
  dispose(): void;
}

export interface TabEngineDeps {
  call: EngineCall; // the machine.sock link's commands
  socketFd(): number | null; // the link's descriptor: the relay this engine admits is its peer
  views(partitions: Pick<Partitions, 'session'>): TabEngineViews;
  fromPartition: ConstructorParameters<typeof Partitions>[0]; // Electron's `session.fromPartition`
  socketDir: string; // renderCuaSocketDir
  userData: string;
  peer: { addon: PeerAddon | null; platform?: NodeJS.Platform };
  machine: string; // as the reasons name it
  version: string; // the hello's
  caps?: { session: number; total: number }; // HEADLESS_TABS unless a test lowers them
  frames?: Pick<ScreencastDeps<unknown>, 'source' | 'encode' | 'now'>; // M6: Electron's frame subscription and encoder unless a test's
  log(line: string): void;
}

export interface TabEngineInspection {
  sessions: Record<string, { tabs: number; creating: number; held: 'none' | 'acquiring' | 'held' }>;
}

export interface TabEngine {
  request(request: BrowserEngineRequest): void; // answered once, with browserEngine.answer
  inspect(): TabEngineInspection;
  dispose(): void;
}

// A session this engine serves, from its `prepare` until its `drop`
interface Served {
  parent: AppSessionId | null; // a side thread's parent, whose tabs it reaches
  creating: number; // creations in flight
  fence: 'none' | 'held' | Promise<void>; // the session's browser work: none, held, or its acquire in flight
  told: string | null; // the inventory last pushed
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// The promise, or the signal's reason once it is aborted first (the promise's later outcome then goes nowhere)
function cancellable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason as Error);
  return new Promise<T>((resolve, reject) => {
    const cancelled = () => reject(signal.reason as Error);
    signal.addEventListener('abort', cancelled, { once: true });
    const done = () => signal.removeEventListener('abort', cancelled);
    promise.then(
      (value) => (done(), resolve(value)),
      (error: unknown) => (done(), reject(error as Error)),
    );
  });
}
const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));

export function startTabEngine(deps: TabEngineDeps): TabEngine {
  const { call, log, machine } = deps;
  const caps = deps.caps ?? HEADLESS_TABS;
  const served = new Map<AppSessionId, Served>();
  const chains = new Map<AppSessionId, Promise<unknown>>(); // each session's prepares and drops, one at a time (`serially`)
  const cancels = new Map<AppSessionId, AbortController>(); // the session's prepares queued or running, which a drop cancels
  const opened = new Map<string, Session>(); // every partition opened, cleared at its session's drop
  const uncleared = new Set<string>(); // partitions a drop could not clear: the session's next prepare cleans them first

  // ---- the composition --------------------------------------------------------------------------------------------

  const emit: BrowserEmit = (name, payload) => {
    if (name === 'browser.tabs.changed') changed((payload as { appSessionId: AppSessionId }).appSessionId);
  };
  const partitions = new Partitions(deps.fromPartition, [
    (ses, partition) => void opened.set(partition, ses),
    (ses, partition) => preparePermissions(store)(ses, partition),
    (ses) =>
      void ses.on('will-download', (event) => {
        event.preventDefault();
        log('[browser] a headless page’s download was refused');
      }),
  ]);
  const views = deps.views(partitions);
  const store: TabStore = new TabStore({
    emit,
    createView: (tab, adopted) => views.createView(tab, adopted),
    resolvePartition: (appSessionId) => headlessPartition(appSessionId),
    driven: (tabId) => cua.holds(tabId),
  });
  const seam = { line: () => {}, openExternal: (url: string) => log(`[browser] a headless page’s external link went nowhere (${url.slice(0, 64)})`) };
  const navigator = new Navigator({ store, history: { visit: () => {}, setTitle: () => {} }, favicons: { resolve: async () => null }, emit, seam });
  // A page's popup within the caps (D11), else denied as a popup with no room is. Admission (`hasRoomForView`) and the
  // child's arrival (`adoptChild`, or `open` for a modifier-clicked link) are apart, so the arrival is checked again; a
  // child refused there is closed by window-open.ts, a link refused opens nothing (Electron does not read the answer).
  const popupRefusal = (opener: TabEntry): string | null => {
    if (store.entry(opener.tab.tabId) !== opener) return 'its opener has closed';
    if (!served.has(opener.tab.appSessionId)) return `the headless browser on ${machine} no longer serves this session`;
    return room(opener.tab.appSessionId);
  };
  const refusePopup = (opener: TabEntry, why: string): string => {
    if (store.entry(opener.tab.tabId) === opener) store.update(opener.tab.tabId, { blockedPopups: opener.tab.blockedPopups + 1 });
    log(`[browser] a page’s popup was refused: ${why}`);
    return `a page’s popup was refused: ${why}`;
  };
  const popups = {
    entry: (tabId: string) => store.entry(tabId),
    update: store.update.bind(store),
    hasRoomForView: (opener?: TabEntry) => (opener === undefined || room(opener.tab.appSessionId) === null) && store.hasRoomForView(opener),
    adoptChild: (opener: TabEntry, request: Parameters<TabStore['adoptChild']>[1]) => {
      const why = popupRefusal(opener);
      if (why !== null) throw new Error(refusePopup(opener, why));
      return store.adoptChild(opener, request);
    },
    open: (request: OpenRequest) => {
      const why = request.opener ? popupRefusal(request.opener) : null;
      if (why === null) return store.open(request);
      refusePopup(request.opener!, why);
      return { tab: request.opener!.tab, reused: true };
    },
  };
  store.onViewCreated((entry) => {
    navigator.attach(entry);
    guardPage(entry);
    attachWindowOpen(entry, { store: popups, linkTarget: () => 'in-app', seam, childPreferences: views.childPreferences });
    attachInputSeams(entry);
    views.place(entry);
  });
  store.onViewDestroying((entry) => views.unplace(entry));
  const controls = new TabControls({ store });
  const cursor = new AgentCursor({ store, controls });
  // M6: the viewers' frames and input; a frame mawsd refuses is for a subscription it has settled, closed here too
  const screencast = startScreencast<unknown>({
    store,
    ...deps.frames,
    frame: (subscriptionId, { jpeg, ...frame }) =>
      void call('browserEngine.frame', { subscriptionId, frame: { ...frame, jpegBase64: Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength).toString('base64') } }).then((posted) => {
        if (posted.ok) return;
        log(`[browser] a frame of ${subscriptionId} was refused: ${posted.error.code} ${posted.error.message}`);
        const owner = subscriptions.get(subscriptionId);
        subscriptions.delete(subscriptionId);
        if (owner) screencast.close(owner, subscriptionId);
      }),
    ended: (subscriptionId, reason) => {
      subscriptions.delete(subscriptionId);
      void call('browserEngine.ended', { subscriptionId, reason }).then((posted) => {
        if (!posted.ok) log(`[browser] the end of ${subscriptionId} was refused: ${posted.error.code} ${posted.error.message}`);
      });
    },
  });
  const subscriptions = new Map<string, AppSessionId>(); // M6: each open subscription's session

  const platform = deps.peer.platform ?? process.platform;
  const cua: CuaBackend = startCuaBackend({
    store,
    peer: { addon: deps.peer.addon, platform },
    presence: { controls, cursor },
    windows: () => [HEADLESS_WINDOW],
    reaches: (appSessionId, tabSessionId) => tabSessionId === appSessionId || served.get(appSessionId)?.parent === tabSessionId,
    userData: deps.userData,
    socketDir: deps.socketDir,
    orphans: 'session',
    creations: { begin },
    version: deps.version,
    log: (line) => log(`[browser] ${line}`),
  });
  // Every view's dialogs wrapped as it is made, adopted popups' included: never placed, so an unleased page's are answered
  // with the defaults (the `hidden` route), a leased one's held for cua
  const dialogs = new PageDialogs({ store, emit, log: (line) => log(`[browser] ${line}`), held: cua.dialogs });
  // §H: on darwin only mawsd's relay is admitted, by the daemon this link reaches; elsewhere the uid is the boundary
  const fd = deps.socketFd();
  const relayed: Promise<boolean> =
    platform !== 'darwin' ? Promise.resolve(true) : cua.relay(fd === null ? null : { fd, confirm: async () => (await call('machine.identity', undefined)).ok });

  // ---- the link ----------------------------------------------------------------------------------------------------

  const answer = (id: string, result: BrowserEngineResult) =>
    void call('browserEngine.answer', { id, result }).then((posted) => {
      if (!posted.ok) log(`[browser] browserEngine.answer for ${id} was refused: ${posted.error.code} ${posted.error.message}`);
    });
  const work = async (appSessionId: AppSessionId, held: boolean) => {
    const answered: CommandResult<'browserEngine.work'> = await call('browserEngine.work', { appSessionId, held });
    if (!answered.ok) throw new Error(answered.error.message);
  };

  // ---- the inventory -----------------------------------------------------------------------------------------------

  const tabsOf = (appSessionId: AppSessionId) => store.all().filter((entry) => entry.tab.appSessionId === appSessionId && entry.tab.internal === null);
  const summary = ({ tab }: TabEntry): BrowserTabSummary => ({ tabId: tab.tabId, title: clip(tab.title, BROWSER_SUMMARY_BOUNDS.title), url: clip(tab.url, BROWSER_SUMMARY_BOUNDS.url), control: tab.control });
  const inventory = (appSessionId: AppSessionId): EngineInventory => {
    if (!served.has(appSessionId)) return { tabs: [], selected: null, state: 'unavailable', reason: `the headless browser on ${machine} does not serve this session` };
    const tabs = tabsOf(appSessionId).slice(0, BROWSER_SUMMARY_BOUNDS.tabs).map(summary);
    const selected = store.list(appSessionId).selected[appSessionId] ?? null;
    return { tabs, selected: tabs.some((tab) => tab.tabId === selected) ? selected : null, state: 'ready' };
  };
  const push = (appSessionId: AppSessionId) => {
    const session = served.get(appSessionId);
    if (!session) return;
    const now = inventory(appSessionId);
    const text = JSON.stringify(now);
    if (session.told === text) return;
    session.told = text;
    void call('browserEngine.state', { appSessionId, inventory: now }).then((posted) => {
      if (!posted.ok) log(`[browser] browserEngine.state for ${appSessionId} was refused: ${posted.error.code} ${posted.error.message}`);
    });
  };

  // ---- the fence and the caps --------------------------------------------------------------------------------------

  const creatingTotal = () => [...served.values()].reduce((sum, session) => sum + session.creating, 0);
  // Why one more tab of the session cannot be made, or null
  function room(appSessionId: AppSessionId): string | null {
    const creating = served.get(appSessionId)?.creating ?? 0;
    if (tabsOf(appSessionId).length + creating >= caps.session) return `the headless browser on ${machine} already holds its ${caps.session} tabs`;
    if (store.all().length + creatingTotal() >= caps.total) return `the headless browser on ${machine} already holds its ${caps.total} tabs`;
    return null;
  }

  // The creation gate (connection.ts `gatedCreate`): the caps, then the fence; the creation's end settles the count
  async function begin(appSessionId: AppSessionId): Promise<() => void> {
    const session = served.get(appSessionId);
    if (!session) throw new Error(`the headless browser on ${machine} does not serve this session`);
    const full = room(appSessionId);
    if (full !== null) throw new Error(full);
    session.creating += 1;
    let ended = false;
    const end = () => {
      if (ended) return;
      ended = true;
      session.creating -= 1;
      changed(appSessionId);
    };
    try {
      if (session.fence === 'none') {
        const acquire = work(appSessionId, true);
        session.fence = acquire;
        acquire.then(
          () => void (session.fence === acquire && (session.fence = 'held')),
          () => void (session.fence === acquire && (session.fence = 'none')),
        );
      }
      if (session.fence !== 'held') await session.fence;
      if (served.get(appSessionId) !== session) throw new Error(`the headless browser on ${machine} no longer serves this session`);
    } catch (error) {
      end();
      throw error;
    }
    return end;
  }

  // The session's tabs changed, or a creation ended: the inventory pushed, and the session's zero reported
  function changed(appSessionId: AppSessionId): void {
    const session = served.get(appSessionId);
    if (!session) return;
    push(appSessionId);
    if (session.fence !== 'held' || session.creating > 0 || tabsOf(appSessionId).length > 0) return;
    session.fence = 'none';
    work(appSessionId, false).catch((error: unknown) => log(`[browser] the zero of ${appSessionId}'s browser work was refused: ${messageOf(error)}`));
  }

  // ---- the operations ----------------------------------------------------------------------------------------------

  // A session's prepares and drops run one at a time, each once the one before has settled, its failure included: a
  // drop tears down what a prepare before it made, a second drop finds nothing served and answers at once, and a
  // prepare finds the partition a drop left uncleared. A drop first cancels every prepare of the session queued or
  // running before it (as dispose cancels them all): a prepare's waits (the socket's listen, the relay's confirmation on
  // the link) have no deadline of their own and end at once, so a drop is bounded by the prepare's own
  // teardown and its partition's clear, never by a peer's answer; a late answer to a cancelled prepare does nothing. Each step still checks, after each await, that
  // it serves the session before making anything for it.
  function serially(appSessionId: AppSessionId, step: () => Promise<null>): Promise<null> {
    const run = (chains.get(appSessionId) ?? Promise.resolve()).then(step);
    const settled = run.catch(() => {});
    chains.set(appSessionId, settled);
    void settled.then(() => chains.get(appSessionId) === settled && chains.delete(appSessionId));
    return run;
  }

  function cancelPrepares(appSessionId: AppSessionId, why: string): void {
    cancels.get(appSessionId)?.abort(new Error(why));
    cancels.delete(appSessionId);
  }

  async function prepare(appSessionId: AppSessionId, parent: AppSessionId | null, signal: AbortSignal): Promise<null> {
    signal.throwIfAborted();
    if (served.has(appSessionId)) return null;
    const session: Served = { parent, creating: 0, fence: 'none', told: null };
    served.set(appSessionId, session);
    const serves = () => {
      signal.throwIfAborted();
      if (served.get(appSessionId) !== session) throw new Error(`the headless browser on ${machine} no longer serves this session`);
    };
    try {
      // local work, the session's own cleanup, never cut short: a drop's clear must not overlap it
      const why = uncleared.has(headlessPartition(appSessionId)) ? await clearPartition(appSessionId) : null;
      if (why !== null) throw new Error(why);
      serves();
      if (cua.socketPathFor(appSessionId) === null) throw new Error(`the headless browser on ${machine} has no socket for this session`);
      const [, relay] = await cancellable(Promise.all([cua.listening(appSessionId), relayed]), signal);
      if (!relay) throw new Error(`the headless browser on ${machine} could not confirm mawsd's relay`);
      serves();
      return null;
    } catch (error) {
      if (served.get(appSessionId) === session) served.delete(appSessionId);
      await cua.closeSession(appSessionId);
      throw error;
    }
  }

  // §B: nothing of the session's browsing outlives it here. Both clears settle; one that failed leaves the partition
  // marked, its reason returned. A session that opened no tab opened no partition.
  async function clearPartition(appSessionId: AppSessionId): Promise<string | null> {
    const name = headlessPartition(appSessionId);
    const partition = opened.get(name);
    if (!partition) return null;
    const settled = await Promise.allSettled([partition.clearStorageData(), partition.clearCache()]);
    const failed = settled.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (!failed) {
      uncleared.delete(name);
      return null;
    }
    uncleared.add(name);
    const why = `the headless browser on ${machine} could not clear this session’s partition: ${messageOf(failed.reason)}`;
    log(`[browser] ${appSessionId}: ${why}`);
    return why;
  }

  async function drop(appSessionId: AppSessionId): Promise<null> {
    const session = served.get(appSessionId);
    if (!session) return null;
    served.delete(appSessionId);
    screencast.closeSession(appSessionId); // M6: before its views go, so none of them is told tab_closed
    for (const [subscriptionId, owner] of [...subscriptions]) if (owner === appSessionId) subscriptions.delete(subscriptionId);
    store.removeSession(appSessionId);
    await cua.closeSession(appSessionId);
    const why = await clearPartition(appSessionId);
    // the zero only after an acquire that succeeded: one refused or failed made no tab and holds nothing to report, and a
    // zero sent while it is in flight could fail it (or a newer one) at mawsd, so an acquire in flight is waited out
    const fence = session.fence;
    session.fence = 'none';
    const held = fence === 'held' || (fence !== 'none' && (await fence.then(() => true, () => false)));
    if (held) await work(appSessionId, false).catch((error: unknown) => log(`[browser] the zero of ${appSessionId}'s browser work was refused: ${messageOf(error)}`));
    if (why !== null) throw new Error(why);
    return null;
  }

  // M6: a viewer's subscription to one of the session's own tabs (the inventory's), on the session's chain
  async function open(appSessionId: AppSessionId, { subscriptionId, tabId, control }: { subscriptionId: string; tabId: string; control: boolean }): Promise<null> {
    if (!served.has(appSessionId)) throw new Error(`the headless browser on ${machine} does not serve this session`);
    if (store.entry(tabId)?.tab.internal) throw new Error('tab_closed');
    screencast.open({ subscriptionId, appSessionId, tabId, control });
    subscriptions.set(subscriptionId, appSessionId);
    return null;
  }

  // M6: what a viewer does with an open subscription, at once
  function subscription(appSessionId: AppSessionId, operation: Extract<BrowserEngineRequest['operation'], { op: 'ack' | 'input' | 'close' }>): null {
    if (operation.op === 'ack') screencast.ack(appSessionId, operation.subscriptionId, operation.seq);
    else if (operation.op === 'input') screencast.input(appSessionId, operation.subscriptionId, operation.seq, operation.event);
    else {
      screencast.close(appSessionId, operation.subscriptionId);
      if (subscriptions.get(operation.subscriptionId) === appSessionId) subscriptions.delete(operation.subscriptionId);
    }
    return null;
  }

  return {
    request({ id, appSessionId, operation }) {
      let run: Promise<EngineInventory | null>;
      if (operation.op === 'inventory') run = Promise.resolve(inventory(appSessionId));
      else if (operation.op === 'open') run = serially(appSessionId, () => open(appSessionId, operation));
      else if (operation.op === 'ack' || operation.op === 'input' || operation.op === 'close') run = new Promise((resolve) => resolve(subscription(appSessionId, operation)));
      else if (operation.op === 'drop') {
        cancelPrepares(appSessionId, `the headless browser on ${machine} dropped this session while preparing it`);
        run = serially(appSessionId, () => drop(appSessionId));
      } else {
        let cancel = cancels.get(appSessionId);
        if (!cancel) cancels.set(appSessionId, (cancel = new AbortController()));
        const { signal } = cancel;
        const parent = (operation.parent ?? null) as AppSessionId | null;
        run = serially(appSessionId, () => prepare(appSessionId, parent, signal));
      }
      run.then(
        (value) => {
          answer(id, { ok: true, value });
          if (operation.op === 'prepare') push(appSessionId); // after the answer: the session is ready
        },
        (error: unknown) => answer(id, { ok: false, error: clip(messageOf(error), 4_096) }),
      );
    },
    inspect: () => ({
      sessions: Object.fromEntries(
        [...served].map(([appSessionId, session]) => [appSessionId, { tabs: tabsOf(appSessionId).length, creating: session.creating, held: session.fence === 'none' || session.fence === 'held' ? session.fence : 'acquiring' }]),
      ),
    }),
    dispose() {
      for (const appSessionId of [...cancels.keys()]) cancelPrepares(appSessionId, `the headless browser on ${machine} is ending`);
      served.clear();
      screencast.dispose(); // M6
      dialogs.dispose();
      cua.dispose();
      cursor.dispose();
      controls.dispose();
      views.dispose();
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
