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
//   trusted roots in production, §H), and the session's lineage is read (`session.get`) for the existing reach rule: a
//   side thread reaches its parent's tabs (P-24). Answered null once all three hold, then the session's inventory is
//   pushed (`browserEngine.state`); a session already served answers at once.
// - `drop`: the session's tabs closed, its socket closed and its connections ended (each lease let go), its partition's
//   storage and cache cleared, its browser work reported zero, then answered null (the partition's reason when it could
//   not be cleared). Only that session's tabs close. A `prepare` of the session meanwhile waits for the drop to end.
// - `inventory`: the session's tabs, bounded (screencast.ts), or `unavailable` for a session not served here.
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
  ready: Promise<void>;
  creating: number; // creations in flight
  fence: 'none' | 'held' | Promise<void>; // the session's browser work: none, held, or its acquire in flight
  told: string | null; // the inventory last pushed
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));
const clip = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));

export function startTabEngine(deps: TabEngineDeps): TabEngine {
  const { call, log, machine } = deps;
  const caps = deps.caps ?? HEADLESS_TABS;
  const served = new Map<AppSessionId, Served>();
  const dropping = new Map<AppSessionId, Promise<unknown>>(); // a drop's run, which a prepare of its session waits for
  const opened = new Map<string, Session>(); // every partition opened, cleared at its session's drop

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
  const parentOf = async (appSessionId: AppSessionId): Promise<AppSessionId | null> => {
    const read = await call('session.get', { appSessionId });
    if (!read.ok) {
      log(`[browser] ${appSessionId}'s lineage could not be read (${read.error.message}): it reaches its own tabs alone`);
      return null;
    }
    const lineage = read.value?.lineage;
    return lineage?.kind === 'side-thread' ? (lineage.parentAppSessionId as AppSessionId) : null;
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

  async function prepare(appSessionId: AppSessionId): Promise<null> {
    const existing = served.get(appSessionId);
    if (existing) return existing.ready.then(() => null);
    const session: Served = { parent: null, ready: Promise.resolve(), creating: 0, fence: 'none', told: null };
    served.set(appSessionId, session);
    const dropped = dropping.get(appSessionId);
    session.ready = (async () => {
      await dropped; // its partition cleared, its socket gone
      if (cua.socketPathFor(appSessionId) === null) throw new Error(`the headless browser on ${machine} has no socket for this session`);
      const [parent, , relay] = await Promise.all([parentOf(appSessionId), cua.listening(appSessionId), relayed]);
      if (!relay) throw new Error(`the headless browser on ${machine} could not confirm mawsd's relay`);
      session.parent = parent;
    })();
    try {
      await session.ready;
    } catch (error) {
      if (served.get(appSessionId) === session) {
        served.delete(appSessionId);
        void cua.closeSession(appSessionId);
      }
      throw error;
    }
    if (served.get(appSessionId) !== session) throw new Error(`the headless browser on ${machine} dropped this session while preparing it`);
    return null;
  }

  function drop(appSessionId: AppSessionId): Promise<null> {
    const run = dropSession(appSessionId);
    const settled = run.catch(() => {});
    dropping.set(appSessionId, settled);
    void settled.then(() => dropping.get(appSessionId) === settled && dropping.delete(appSessionId));
    return run;
  }

  async function dropSession(appSessionId: AppSessionId): Promise<null> {
    const session = served.get(appSessionId);
    if (!session) return null;
    served.delete(appSessionId);
    store.removeSession(appSessionId);
    await cua.closeSession(appSessionId);
    // §B: nothing of the session's browsing outlives it here (a session that opened no tab opened no partition)
    const partition = opened.get(headlessPartition(appSessionId));
    const uncleared = partition ? await Promise.all([partition.clearStorageData(), partition.clearCache()]).then(() => null, (error: unknown) => messageOf(error)) : null;
    // the zero only after an acquire that succeeded: one refused or failed made no tab and holds nothing to report, and a
    // zero sent while it is in flight could fail it (or a newer one) at mawsd, so an acquire in flight is waited out
    const fence = session.fence;
    session.fence = 'none';
    const held = fence === 'held' || (fence !== 'none' && (await fence.then(() => true, () => false)));
    if (held) await work(appSessionId, false).catch((error: unknown) => log(`[browser] the zero of ${appSessionId}'s browser work was refused: ${messageOf(error)}`));
    if (uncleared !== null) throw new Error(`the headless browser on ${machine} could not clear this session’s partition: ${uncleared}`);
    return null;
  }

  return {
    request({ id, appSessionId, operation }) {
      const run = operation.op === 'prepare' ? prepare(appSessionId) : operation.op === 'drop' ? drop(appSessionId) : Promise.resolve(inventory(appSessionId));
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
      dialogs.dispose();
      cua.dispose();
      cursor.dispose();
      controls.dispose();
      views.dispose();
      for (const { view } of store.all()) if (view && !view.webContents.isDestroyed()) view.webContents.close();
    },
  };
}
