// `mawsd`'s browser route per session (P5 O17 M5; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md, Interfaces §B,
// §G; D1, D7, D10, D20): which tab engine a session's cua connections go to, under which epoch. Eager and small: no
// timer, no polling, nothing loaded; the render seam (its chunk) is reached through the options alone.
//
// States: `relay` while an app is attached (machine-wide), the app's own socket for the session (O5 M5); otherwise, where
// the headless browser is usable (`headless`, session-capabilities.ts's reading), `cold` (the broker answers cua; listening
// while the session's engine is live), `starting` (a demand asked the render seam for the render host) and `headless`
// (the render host serves the session; new connections relayed to it straight); otherwise `none`, with its reason.
//
// The epoch is opaque and per session, minted each time its tab engine changes: at an app's arrival or departure, the
// headless browser becoming usable or not, the render host's end, the engine's exit (`exited`, or a different non-null
// pid; never a missing pid or a lost link, so an engine-host restart or an O16 handover ends no tab) and the engine
// host's `host.browserIdle` (D20). A reused pid running another engine (the same pid, another start, as the peer check
// reads it) is an exit too (§B, amended at M5's review). It is minted before anything of the old route is torn down, so every waiter and reply
// bound to the old one is refused from that instant; `cold` → `starting` → `headless` keep it, and a start that fails
// returns to `cold` in the same epoch. Only the latest demand's start moves `starting` on: a retry in the same epoch
// supersedes an aborted one, whose late answer decides nothing. Nothing migrates: the old route's drop (`dropBrowser`) closes its tabs.
//
// The inventory cache (§G): what the selected engine connection last pushed (`browserEngine.state`), stamped with the
// epoch, reset at each; its watchers hear the current reading at once and each change (M6's feed reads it, never loading
// a chunk for it). `periodEnds` tells the subscriptions' owner (M6) why a period ended.
import { randomBytes } from 'node:crypto';
import type { BrowserInventory } from '@shared/browser/screencast';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineInventory } from '@shared/ipc/schema/browser-engine';
import type { EngineConnection } from './browser-work';
import type { BrowserDemand, BrowserRouteReading, BrowserRouteState, BrowserTarget } from './cua-broker'; // types alone: the broker is a deferred chunk
import type { FrontSelection } from './front';

export type PeriodEnd = 'engine_changed' | 'tab_closed'; // §G's closing reasons a route change gives a subscription

export interface BrowserRouteOptions {
  machine: string;
  app(): boolean; // an app is attached and its cua directory serves the sessions (O5 M5's target)
  headless(): string | null; // null while the headless browser is usable here, else why not (§I 2–5)
  ensureBrowser(demand: BrowserDemand): Promise<BrowserTarget>; // RenderHandle.ensureBrowser: starts or joins the render host, prepares the session
  dropBrowser(appSessionId: AppSessionId): Promise<void>; // RenderHandle.dropBrowser: the session's service there ended, its tabs closed
  engineOf(appSessionId: AppSessionId): EngineConnection | null; // the connection the render host prepares or serves the session on
  socketPath(appSessionId: AppSessionId): string | null; // the render host's socket for the session (§D), computed by mawsd
  routeChanged(appSessionId: AppSessionId): void; // the cua sockets: an older epoch's connections end, listening follows
  log(line: string): void;
}

export interface BrowserRoute {
  reading(appSessionId: AppSessionId): BrowserRouteReading; // the state and the current epoch, in every state
  live(appSessionId: AppSessionId): boolean; // §B's *live*: the last raw status's process is not exited
  target(appSessionId: AppSessionId): string | null; // `headless`: the render host's socket a new connection is relayed to
  ensureBrowser(demand: BrowserDemand): Promise<BrowserTarget>; // the broker's demand: `cold` → `starting` → `headless`
  selection(appSessionId: AppSessionId): FrontSelection | null; // the front's: the selected engine connection and its period
  inputsChanged(between?: () => void): void; // the app or the headless browser's usability may have changed; `between`, after the epochs are minted and before any teardown
  statusSeen(appSessionId: AppSessionId, reading: { process: string; pid: number | null; replaced?: boolean }): void; // a raw session.status; `replaced`: its pid now runs another engine (the peer check's start)
  removed(appSessionId: AppSessionId): void; // session.removed, or a session mawsd stops following: its entry goes
  engineEnded(appSessionId: AppSessionId): void; // the render host serving or preparing the session ended
  browserIdle(appSessionId: AppSessionId, held: boolean): void; // host.browserIdle (D20); `held`: browser work is held for it
  state(engine: EngineConnection, input: { appSessionId: AppSessionId; inventory: EngineInventory }): boolean; // false: not the selected connection
  inventory(appSessionId: AppSessionId): BrowserInventory;
  watchInventory(appSessionId: AppSessionId, changed: (inventory: BrowserInventory) => void): () => void;
  periodEnds(listener: (appSessionId: AppSessionId, reason: PeriodEnd) => void): () => void;
  counts(): { browserSessions: number; browserTabs: number };
}

interface Entry {
  state: BrowserRouteState;
  epoch: string;
  live: boolean;
  pid: number | null; // the engine's, kept across a reading with none
  reason: string | null; // `none`'s reason as published: a reason that changes with the state unchanged is told, no epoch minted
  inventory: EngineInventory | null; // the selected engine's last push in this epoch
  attempt: number; // the latest demand's start: only its completion moves `starting` on (an older one was aborted or superseded)
}

type Watcher = (inventory: BrowserInventory) => void;

const HEADLESS_STATES: ReadonlySet<BrowserRouteState> = new Set(['starting', 'headless']);

export function createBrowserRoute(options: BrowserRouteOptions): BrowserRoute {
  const { machine, log } = options;
  const entries = new Map<AppSessionId, Entry>();
  // The inventory's watchers, per session for as long as they watch: an entry is replaced (an adopted engine's exit, then
  // its resume) under watchers that stay
  const watchers = new Map<AppSessionId, Set<Watcher>>();
  const ends = new Set<(appSessionId: AppSessionId, reason: PeriodEnd) => void>();
  const prefix = randomBytes(4).toString('hex'); // a restarted mawsd never repeats an epoch a viewer still holds
  let minted = 0;
  const mint = () => `${prefix}.${++minted}`;

  const base = (app: boolean, headless: string | null): BrowserRouteState => (app ? 'relay' : headless === null ? 'cold' : 'none');
  const entry = (appSessionId: AppSessionId): Entry => {
    let found = entries.get(appSessionId);
    if (!found) {
      const app = options.app();
      const headless = options.headless();
      const state = base(app, headless);
      entries.set(appSessionId, (found = { state, epoch: mint(), live: false, pid: null, reason: state === 'none' ? headless : null, inventory: null, attempt: 0 }));
      told(appSessionId, found); // a replaced entry's watchers hear its new epoch
    }
    return found;
  };

  const inventoryOf = (current: Entry): BrowserInventory => {
    const unavailable = (reason: string): BrowserInventory => ({ epoch: current.epoch, tabs: [], selected: null, state: 'unavailable', reason });
    if (current.state === 'relay') return unavailable(`the agent's browser is in the MAWS app on ${machine}`);
    if (current.state === 'none') return unavailable(current.reason ?? `the agent's browser is unavailable on ${machine}`);
    if (HEADLESS_STATES.has(current.state) && current.inventory) return { epoch: current.epoch, ...current.inventory };
    return { epoch: current.epoch, tabs: [], selected: null, state: 'ready' };
  };
  function told(appSessionId: AppSessionId, current: Entry): void {
    const watching = watchers.get(appSessionId);
    if (!watching || watching.size === 0) return;
    const inventory = inventoryOf(current);
    for (const watcher of [...watching]) watcher(inventory);
  }
  const ended = (appSessionId: AppSessionId, reason: PeriodEnd) => {
    for (const listener of [...ends]) listener(appSessionId, reason);
  };
  const drop = (appSessionId: AppSessionId) =>
    void options.dropBrowser(appSessionId).catch((error: unknown) => log(`[browser] the drop of ${appSessionId}'s headless browser failed: ${error instanceof Error ? error.message : String(error)}`));

  // A new period: the epoch minted and the cache reset, nothing torn down yet
  const move = (current: Entry, to: BrowserRouteState, reason: string | null = null) => {
    current.state = to;
    current.epoch = mint();
    current.inventory = null;
    current.reason = to === 'none' ? reason : null;
  };
  // The old period's teardown, after the mint: its subscriptions ended, its render-host service dropped when it had one,
  // the sockets told (an older epoch's connections end; listening follows), the watchers told
  const teardown = (appSessionId: AppSessionId, current: Entry, from: BrowserRouteState, reason: PeriodEnd) => {
    ended(appSessionId, reason);
    if (HEADLESS_STATES.has(from)) drop(appSessionId);
    options.routeChanged(appSessionId);
    told(appSessionId, current);
  };
  // A session-level event's move: minted, then torn down, at once
  const moveNow = (appSessionId: AppSessionId, current: Entry, to: BrowserRouteState, reason: PeriodEnd, why: string) => {
    const from = current.state;
    move(current, to);
    log(`[browser] ${appSessionId}: ${from} → ${to} (${why})`);
    teardown(appSessionId, current, from, reason);
  };

  const selection = (appSessionId: AppSessionId): FrontSelection | null => {
    const current = entries.get(appSessionId);
    if (!current || !HEADLESS_STATES.has(current.state)) return null;
    const engine = options.engineOf(appSessionId);
    return engine === null ? null : { engine, period: current.epoch };
  };

  return {
    reading(appSessionId) {
      const { state, epoch } = entry(appSessionId);
      return { state, epoch };
    },
    live: (appSessionId) => entries.get(appSessionId)?.live ?? false,
    target: (appSessionId) => (entries.get(appSessionId)?.state === 'headless' ? options.socketPath(appSessionId) : null),
    ensureBrowser(demand) {
      const { appSessionId, epoch } = demand;
      const current = entry(appSessionId);
      if (current.epoch !== epoch) return Promise.reject(new Error(`the browser route of ${appSessionId} moved on from epoch ${epoch}`));
      if (current.state === 'cold') current.state = 'starting';
      else if (!HEADLESS_STATES.has(current.state)) return Promise.reject(new Error(`the browser route of ${appSessionId} is ${current.state}`));
      const attempt = ++current.attempt;
      const ours = () => entries.get(appSessionId) === current && current.epoch === epoch && current.state === 'starting' && current.attempt === attempt;
      return options.ensureBrowser(demand).then(
        (target) => {
          // §B's linearization point: headless only for the current epoch while still starting
          if (ours()) current.state = 'headless';
          return target;
        },
        (error: unknown) => {
          if (ours()) current.state = 'cold'; // a start that failed or ran out of time mints nothing
          throw error;
        },
      );
    },
    selection,
    inputsChanged(between) {
      const app = options.app();
      const headless = options.headless();
      const moved: { appSessionId: AppSessionId; current: Entry; from: BrowserRouteState }[] = [];
      for (const [appSessionId, current] of entries) {
        const want = base(app, headless);
        const to = want === 'cold' && (current.state === 'starting' || current.state === 'headless') ? current.state : want;
        if (to === current.state) {
          // still `none`, for another reason: the same period, its watchers told
          if (to === 'none' && current.reason !== headless) {
            current.reason = headless;
            told(appSessionId, current);
          }
          continue;
        }
        moved.push({ appSessionId, current, from: current.state });
        move(current, to, headless);
      }
      between?.();
      for (const { appSessionId, current, from } of moved) {
        log(`[browser] ${appSessionId}: ${from} → ${current.state}${current.state === 'none' ? ` (${headless})` : ''}`);
        teardown(appSessionId, current, from, 'engine_changed');
      }
    },
    statusSeen(appSessionId, { process, pid, replaced = false }) {
      const current = entry(appSessionId);
      const exited = process === 'exited';
      const exit = exited || replaced || (pid !== null && current.pid !== null && pid !== current.pid);
      const wasLive = current.live;
      current.live = !exited;
      if (exited) current.pid = null;
      else if (pid !== null) current.pid = pid;
      if (exit && HEADLESS_STATES.has(current.state)) return moveNow(appSessionId, current, 'cold', 'tab_closed', 'its engine exited');
      if (wasLive !== current.live) options.routeChanged(appSessionId); // listen or stop; the path is kept (D10)
    },
    removed(appSessionId) {
      const current = entries.get(appSessionId);
      if (!current) return;
      entries.delete(appSessionId);
      if (!HEADLESS_STATES.has(current.state)) return;
      ended(appSessionId, 'tab_closed');
      drop(appSessionId);
    },
    engineEnded(appSessionId) {
      const current = entries.get(appSessionId);
      if (!current || !HEADLESS_STATES.has(current.state)) return;
      const headless = options.headless();
      move(current, headless === null ? 'cold' : 'none', headless);
      log(`[browser] ${appSessionId}: the render host serving it ended → ${current.state}`);
      ended(appSessionId, 'engine_changed');
      options.routeChanged(appSessionId);
      told(appSessionId, current);
    },
    browserIdle(appSessionId, held) {
      const current = entries.get(appSessionId);
      if (current?.state !== 'headless' || !held) return log(`[browser] host.browserIdle for ${appSessionId} ignored: nothing held for it`);
      moveNow(appSessionId, current, 'cold', 'tab_closed', 'idle for the machine’s whole idle time');
    },
    state(engine, { appSessionId, inventory }) {
      if (selection(appSessionId)?.engine !== engine) return false;
      const current = entries.get(appSessionId)!;
      current.inventory = inventory;
      told(appSessionId, current);
      return true;
    },
    inventory: (appSessionId) => inventoryOf(entry(appSessionId)),
    watchInventory(appSessionId, changed) {
      const current = entry(appSessionId);
      let watching = watchers.get(appSessionId);
      if (!watching) watchers.set(appSessionId, (watching = new Set()));
      watching.add(changed);
      changed(inventoryOf(current));
      return () => {
        watching.delete(changed);
        if (watching.size === 0 && watchers.get(appSessionId) === watching) watchers.delete(appSessionId);
      };
    },
    periodEnds(listener) {
      ends.add(listener);
      return () => void ends.delete(listener);
    },
    counts() {
      const serving = [...entries.values()].filter((current) => current.state === 'headless');
      return { browserSessions: serving.length, browserTabs: serving.reduce((sum, current) => sum + (current.inventory?.tabs.length ?? 0), 0) };
    },
  };
}
