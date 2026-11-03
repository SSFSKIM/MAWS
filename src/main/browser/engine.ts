// The app as a tab engine (P5 O17 M9b; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, M9's Decisions, Interfaces §A,
// §F, §G): on the daemon shape the app's hello lists `browser.engine`, so `mawsd` selects the attached app's connection
// for its sessions' screencasts (its route's `relay`) as it selects the render host's in `headless`. The app answers
// `browserEngine.request` from its own TabStore, with M6's producer (screencast.ts), and pushes `browserEngine.state`.
//
// Only the agent's tabs are served: those a live cua connection of the session reserves or leases (the cua server's
// `agentTab`, TabClaims). The person's own tabs in a session's panel never enter an inventory and never take a viewer
// (`tab_closed`); a tab leaving the agent's set ends its viewers `tab_closed`, as a closed tab's do.
// - `inventory`: the session's agent tabs, bounded (screencast.ts's bounds), its selection when that is one of them. From
//   then on this link pushes the session's inventory at each change of its agent tabs (a tab joining or leaving the set,
//   a title, URL or control change), only when it changed; nothing polls. Sessions not asked about are never pushed.
// - `open`, `ack`, `input`, `close`: a viewer's subscription to one agent tab, as the render host serves them.
// - `prepare` and `drop` are the render host's alone: refused. The app reports no browser work (R5).
// A new machine link (`linkChanged`) starts over: `mawsd` ended this link's subscriptions with its connection, so they
// close here telling no one, and no session is pushed until the new link asks.
//
// A viewed tab paints while no pane shows it. An app tab's view runs with background throttling (view.ts), and a tab no
// pane shows is hidden (`setVisible(false)`, or out of any window), so Chromium stops producing its frames and Electron's
// frame subscription hears nothing. Electron 44 has no capturer count to hold (its `incrementCapturerCount` is gone); its
// `setBackgroundThrottling(false)` shows a hidden widget as hidden-but-painting, the state Chromium gives a captured page
// (electron_api_web_contents.cc). So throttling is off while a viewer subscribes, re-asserted at each change of the tab
// (a navigation among them, and after the agent's control turns it back on as it lets go: control.ts's listener runs
// first), and back on at the last viewer's end unless the agent holds the tab. A view no pane ever placed has no size,
// and a frame subscription of an empty view yields nothing: such a tab is sized as parking sizes one (`size`).
import type { NativeImage, WebContents } from 'electron';
import { BROWSER_SUMMARY_BOUNDS, type BrowserEndReason, type BrowserTabSummary } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserEngineRequest, BrowserEngineResult, EngineInventory } from '@shared/ipc/schema/browser-engine';
import type { CuaBackend } from './cua';
import { contentsFrameSource, startScreencast, type FrameSource, type ScreencastDeps, type ScreencastInspection } from './screencast';
import type { TabEntry, TabStore } from './tabs';

export type EngineCallName = 'browserEngine.answer' | 'browserEngine.state' | 'browserEngine.frame' | 'browserEngine.ended';

export interface AppEngineDeps {
  store: Pick<TabStore, 'all' | 'entry' | 'list' | 'onUpdated' | 'onViewDestroying'>;
  agents: Pick<CuaBackend, 'agentTab' | 'onAgentTabs'>;
  // The machine link's command (hosts.dispatch('machine', …)): its answer, a refusal readable by its error
  call(name: EngineCallName, input: unknown): Promise<{ ok: boolean; error?: { code: string; message: string } }>;
  frames?: Pick<ScreencastDeps<unknown>, 'source' | 'encode' | 'now'>; // Electron's frame subscription and encoder unless a test's
  size?(entry: TabEntry): void; // a view no pane placed and with no size yet, sized to paint (parking's bounds)
  log(line: string): void;
}

export interface AppEngineInspection {
  sessions: number; // asked about on this link
  subscriptions: number;
  screencast: ScreencastInspection;
}

export interface AppEngine {
  request(request: BrowserEngineRequest): void; // answered once, with browserEngine.answer
  linkChanged(): void; // the machine link is another (or none): this link's sessions and subscriptions end
  inspect(): AppEngineInspection;
  dispose(): void;
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function startAppEngine(deps: AppEngineDeps): AppEngine {
  const { store, agents, log } = deps;
  const asked = new Map<AppSessionId, string | null>(); // the sessions mawsd asked about on this link: the inventory last told
  const subscriptions = new Map<string, { appSessionId: AppSessionId; tabId: string }>();
  const painting = new Set<string>(); // tabs whose throttling a viewer holds off

  const call = (name: EngineCallName, input: unknown, what: string) =>
    deps.call(name, input).then(
      (posted) => {
        if (!posted.ok) log(`[browser] ${what} was refused: ${posted.error?.code ?? ''} ${posted.error?.message ?? ''}`);
        return posted.ok;
      },
      (error: unknown) => (log(`[browser] ${what} failed: ${messageOf(error)}`), false),
    );

  // ---- painting while hidden -----------------------------------------------------------------------------------------

  const contentsOf = (entry: TabEntry): WebContents | null => {
    const contents = entry.view?.webContents ?? null;
    return contents && !contents.isDestroyed() ? contents : null;
  };
  const paintsHidden = (entry: TabEntry) => contentsOf(entry)?.setBackgroundThrottling(false);
  // The tab's source (Electron's frame subscription unless a test's), the view painting while hidden for as long as it runs
  const paintedSource = (entry: TabEntry): FrameSource<unknown> => {
    const contents = entry.view!.webContents;
    const frames: FrameSource<unknown> = deps.frames?.source?.(entry) ?? (contentsFrameSource(contents) as FrameSource<NativeImage> as FrameSource<unknown>);
    return {
      start(paint) {
        painting.add(entry.tab.tabId);
        paintsHidden(entry);
        frames.start(paint);
      },
      stop() {
        painting.delete(entry.tab.tabId);
        frames.stop();
        if (!contents.isDestroyed() && entry.tab.control !== 'agent') contents.setBackgroundThrottling(true);
      },
    };
  };

  // ---- the producer ----------------------------------------------------------------------------------------------------

  const screencast = startScreencast<unknown>({
    store,
    source: paintedSource,
    ...(deps.frames?.encode && { encode: deps.frames.encode }),
    ...(deps.frames?.now && { now: deps.frames.now }),
    frame: (subscriptionId, { jpeg, ...frame }) =>
      void call('browserEngine.frame', { subscriptionId, frame: { ...frame, jpegBase64: Buffer.from(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength).toString('base64') } }, `a frame of ${subscriptionId}`).then((taken) => {
        if (taken) return;
        const owner = subscriptions.get(subscriptionId); // a subscription mawsd has settled: closed here too
        subscriptions.delete(subscriptionId);
        if (owner) screencast.close(owner.appSessionId, subscriptionId);
      }),
    ended: (subscriptionId, reason) => end(subscriptionId, reason),
  });
  // The producer's own end, or a tab leaving the agent's set: told once
  function end(subscriptionId: string, reason: BrowserEndReason): void {
    if (!subscriptions.delete(subscriptionId)) return;
    void call('browserEngine.ended', { subscriptionId, reason }, `the end of ${subscriptionId}`);
  }

  // ---- the inventory ---------------------------------------------------------------------------------------------------

  const agentTabsOf = (appSessionId: AppSessionId) => store.all().filter((entry) => entry.tab.appSessionId === appSessionId && entry.tab.internal === null && agents.agentTab(entry.tab.tabId));
  const summary = ({ tab }: TabEntry): BrowserTabSummary => ({ tabId: tab.tabId, title: clip(tab.title, BROWSER_SUMMARY_BOUNDS.title), url: clip(tab.url, BROWSER_SUMMARY_BOUNDS.url), control: tab.control });
  const inventory = (appSessionId: AppSessionId): EngineInventory => {
    const tabs = agentTabsOf(appSessionId).slice(0, BROWSER_SUMMARY_BOUNDS.tabs).map(summary);
    const selected = store.list(appSessionId).selected[appSessionId] ?? null;
    return { tabs, selected: tabs.some((tab) => tab.tabId === selected) ? selected : null, state: 'ready' };
  };
  // Pushed after the change settles (several in one turn, one push), only for a session asked about and only when changed
  const due = new Set<AppSessionId>();
  const changed = (appSessionId: AppSessionId) => {
    if (!asked.has(appSessionId) || due.has(appSessionId)) return;
    due.add(appSessionId);
    queueMicrotask(() => {
      due.delete(appSessionId);
      if (!asked.has(appSessionId)) return;
      const now = inventory(appSessionId);
      const text = JSON.stringify(now);
      if (asked.get(appSessionId) === text) return;
      asked.set(appSessionId, text);
      void call('browserEngine.state', { appSessionId, inventory: now }, `browserEngine.state for ${appSessionId}`);
    });
  };

  const unhook = [
    agents.onAgentTabs((tabId) => {
      const entry = store.entry(tabId);
      if (entry) changed(entry.tab.appSessionId);
      if (agents.agentTab(tabId)) return;
      for (const [subscriptionId, owner] of [...subscriptions]) {
        if (owner.tabId !== tabId) continue;
        screencast.close(owner.appSessionId, subscriptionId);
        end(subscriptionId, 'tab_closed');
      }
    }),
    store.onUpdated((entry) => {
      if (painting.has(entry.tab.tabId)) paintsHidden(entry); // after control's own listener, which may have turned it on
      if (agents.agentTab(entry.tab.tabId)) changed(entry.tab.appSessionId);
    }),
    store.onViewDestroying((entry) => queueMicrotask(() => changed(entry.tab.appSessionId))),
  ];

  // ---- the operations ----------------------------------------------------------------------------------------------

  function open(appSessionId: AppSessionId, { subscriptionId, tabId, control }: { subscriptionId: string; tabId: string; control: boolean }): null {
    const entry = store.entry(tabId);
    if (!entry || entry.tab.appSessionId !== appSessionId || entry.tab.internal !== null || !agents.agentTab(tabId)) throw new Error('tab_closed');
    if (entry.view && entry.placement === null) {
      const { width, height } = entry.view.getBounds();
      if (width === 0 || height === 0) deps.size?.(entry);
    }
    screencast.open({ subscriptionId, appSessionId, tabId, control });
    subscriptions.set(subscriptionId, { appSessionId, tabId });
    return null;
  }

  async function run(appSessionId: AppSessionId, operation: BrowserEngineRequest['operation']): Promise<EngineInventory | null> {
    switch (operation.op) {
      case 'inventory': {
        const now = inventory(appSessionId);
        asked.set(appSessionId, JSON.stringify(now));
        return now;
      }
      case 'open':
        return open(appSessionId, operation);
      case 'ack':
        screencast.ack(appSessionId, operation.subscriptionId, operation.seq);
        return null;
      case 'input':
        await screencast.input(appSessionId, operation.subscriptionId, operation.seq, operation.event);
        return null;
      case 'close':
        screencast.close(appSessionId, operation.subscriptionId);
        if (subscriptions.get(operation.subscriptionId)?.appSessionId === appSessionId) subscriptions.delete(operation.subscriptionId);
        return null;
      default:
        throw new Error(`the MAWS app serves no ${operation.op}: it is the render host's`);
    }
  }

  return {
    request({ id, appSessionId, operation }) {
      run(appSessionId, operation).then(
        (value) => void call('browserEngine.answer', { id, result: { ok: true, value } satisfies BrowserEngineResult }, `browserEngine.answer for ${id}`),
        (error: unknown) => void call('browserEngine.answer', { id, result: { ok: false, error: clip(messageOf(error), 4_096) } satisfies BrowserEngineResult }, `browserEngine.answer for ${id}`),
      );
    },
    linkChanged() {
      for (const [subscriptionId, { appSessionId }] of [...subscriptions]) screencast.close(appSessionId, subscriptionId);
      subscriptions.clear();
      asked.clear();
    },
    inspect: () => ({ sessions: asked.size, subscriptions: subscriptions.size, screencast: screencast.inspect() }),
    dispose() {
      for (const off of unhook.splice(0)) off();
      subscriptions.clear();
      asked.clear();
      screencast.dispose();
    },
  };
}
