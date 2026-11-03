// The render host's browser sessions as the render seam drives them (P5 O17 M5; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §B, §D, §F; D7): part of the seam's deferred chunk (render-seam.ts composes it, and nothing else imports it).
//
// `ensure` is RenderHandle.ensureBrowser's work once the seam took the demand: the session's lineage read (`parentOf`,
// bounded by the demand's deadline, in parallel with the render host's start), then, on the ready host's connection,
// `prepare` naming the parent, resolved at its answer with the socket `mawsd` computed. A session the ready host serves
// resolves at once; one it is preparing joins that prepare. A demand ends at its deadline or its signal; one that ends
// after its prepare was sent, with no other demand waiting on that prepare, is undone with `drop` (the render host's drop
// cancels a running prepare), so a promotion that expires leaves no prepared session behind. A demand is its connection's
// from the moment it proceeds on it (before the retiring drop's and the lineage's waits): that connection's end fails it
// at once and tells its session's route (`ended`), as for a session prepared or served there.
//
// `drop` ends the session's service on its connection: the connection is *retiring* for the session until the drop's
// answer or the connection's end, its hold on the session ending then (`dropped`), and a new prepare of the session on
// that connection is sent only after it, so the socket's order separates the two periods (engines carry no epoch).
// Request ids are `mawsd`'s; an answer is taken only for a request pending on the connection it arrives on.
import type { AppSessionId } from '@shared/graph/ids';
import type { BrowserEngineRequest, BrowserEngineResult } from '@shared/ipc/schema/browser-engine';
import type { EngineConnection } from './browser-work';
import type { BrowserDemand, BrowserTarget } from './cua-broker';

export interface RenderBrowserOptions {
  machine: string;
  post(engine: EngineConnection, request: BrowserEngineRequest): boolean; // to that connection alone; false when it is going
  socketPath(appSessionId: AppSessionId): string | null; // the render host's socket for the session (§D); null past sun_path
  parentOf(appSessionId: AppSessionId, deadline: number): Promise<AppSessionId | null>; // a side thread's parent, read by its deadline
  ended(appSessionId: AppSessionId): void; // the connection that served or prepared the session ended
  dropped(engine: EngineConnection, appSessionId: AppSessionId): void; // a drop answered: that connection's hold on the session ends
  changed(): void; // demands or operations started or settled (the seam's quiet period follows)
  log(line: string): void;
}

export interface RenderBrowser {
  ensure(demand: BrowserDemand): Promise<BrowserTarget>;
  drop(appSessionId: AppSessionId): Promise<void>;
  answer(engine: EngineConnection, input: { id: string; result: BrowserEngineResult }): boolean; // false: no such request pending on it
  engineOf(appSessionId: AppSessionId): EngineConnection | null; // the connection preparing or serving the session
  served(): AppSessionId[];
  ready(engine: EngineConnection | null): void; // the host's connection takes demands from now (null: none does, the host is ending)
  gone(engine: EngineConnection): void; // that connection ended
  refuse(reason: string): void; // every demand not yet prepared fails (the seam unavailable, or stopping)
  waiting(): boolean; // demands wait for a ready host
  active(): boolean; // demands or operations in flight
}

interface Demand {
  demand: BrowserDemand;
  parent: Promise<AppSessionId | null>;
  on: EngineConnection | null; // the connection it proceeds on, from its assignment (before its waits) to its prepare
  settled: boolean;
  resolve(target: BrowserTarget): void;
  fail(reason: string): void;
}

interface Session {
  engine: EngineConnection;
  phase: 'preparing' | 'served';
  demands: Set<Demand>; // waiting on its prepare
}

interface Pending {
  engine: EngineConnection;
  settle(result: BrowserEngineResult | null): void; // null: the connection ended unanswered
}

export function createRenderBrowser(options: RenderBrowserOptions): RenderBrowser {
  const { machine, log } = options;
  const waiting = new Set<Demand>(); // for a ready host
  const proceeding = new Set<Demand>(); // on a ready host, waiting for a retiring drop and the lineage before the prepare
  const sessions = new Map<AppSessionId, Session>(); // the selected connection per session
  const retiring = new Map<EngineConnection, Map<AppSessionId, Promise<void>>>(); // drops sent, not answered
  const pending = new Map<string, Pending>();
  let engine: EngineConnection | null = null;
  let next = 0;

  const targetOf = (demand: BrowserDemand, socketPath: string): BrowserTarget => ({ epoch: demand.epoch, socketPath });

  // The demand's prepare was sent and it ended first: the prepare is undone when nothing else waits on it
  const abandoned = (appSessionId: AppSessionId) => {
    const current = sessions.get(appSessionId);
    if (current?.phase !== 'preparing' || [...current.demands].some((other) => !other.settled)) return;
    log(`[browser] ${appSessionId}: its promotion ended before the render host prepared it: the prepare undone`);
    void drop(appSessionId);
  };

  function ensure(demand: BrowserDemand): Promise<BrowserTarget> {
    const { appSessionId, signal, deadline } = demand;
    return new Promise<BrowserTarget>((resolve, reject) => {
      if (signal.aborted) return reject(reasonOf(signal));
      const socketPath = options.socketPath(appSessionId);
      if (socketPath === null) return reject(new Error(`the headless browser's socket of this session is longer than a Unix socket allows on ${machine}`));
      const current = sessions.get(appSessionId);
      if (current?.phase === 'served' && current.engine === engine) return resolve(targetOf(demand, socketPath));
      let timer: ReturnType<typeof setTimeout> | null = null;
      const onAbort = () => entry.fail(reasonOf(signal).message);
      const finish = () => {
        entry.settled = true;
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        waiting.delete(entry);
        proceeding.delete(entry);
        options.changed();
      };
      const entry: Demand = {
        demand,
        parent: Promise.resolve(null),
        on: null,
        settled: false,
        resolve(target) {
          if (entry.settled) return;
          finish();
          resolve(target);
        },
        fail(reason) {
          if (entry.settled) return;
          finish();
          reject(new Error(reason));
          abandoned(appSessionId);
        },
      };
      timer = setTimeout(() => entry.fail(`the browser on ${machine} did not start within its deadline`), Math.max(0, deadline - performance.now()));
      signal.addEventListener('abort', onAbort, { once: true });
      if (current?.phase === 'preparing' && current.engine === engine) {
        current.demands.add(entry); // the prepare under way answers it too
        return;
      }
      entry.parent = options.parentOf(appSessionId, deadline).catch(() => null);
      waiting.add(entry);
      options.changed();
      if (engine) void proceed(entry, engine);
    });
  }

  // The demands assigned to a connection that ended (or stopped being the host's) before their prepare was sent: their
  // routes told first (`ended`: §B's render host's end, the epoch minted), then each failed, never left to wait
  const lose = (lost: Demand[], ended: Set<AppSessionId>) => {
    for (const entry of lost) proceeding.delete(entry);
    for (const appSessionId of new Set(lost.map((entry) => entry.demand.appSessionId))) {
      if (!ended.has(appSessionId)) options.ended(appSessionId);
      ended.add(appSessionId);
    }
    for (const entry of lost) entry.fail(`the render host on ${machine} ended`);
  };

  // On the ready host's connection: behind the session's retiring drop there, with its lineage, the prepare. The demand
  // is the connection's from here (`on`), so the connection's end reaches it during either wait
  async function proceed(entry: Demand, on: EngineConnection): Promise<void> {
    const { appSessionId } = entry.demand;
    waiting.delete(entry);
    proceeding.add(entry);
    entry.on = on;
    let parent: AppSessionId | null;
    for (;;) {
      [, parent] = await Promise.all([retiring.get(on)?.get(appSessionId), entry.parent]);
      if (entry.settled) return; // failed meanwhile: the connection's end among the reasons
      if (engine !== on) return lose([entry], new Set()); // the host's connection no more, though not ended yet
      if (!retiring.get(on)?.has(appSessionId)) break; // a drop sent meanwhile: wait for it too
    }
    // from here to the prepare's post no turn passes, so a second demand finds the session reserved and joins it
    proceeding.delete(entry);
    const socketPath = options.socketPath(appSessionId)!;
    const current = sessions.get(appSessionId);
    if (current?.engine === on) {
      if (current.phase === 'served') return entry.resolve(targetOf(entry.demand, socketPath));
      current.demands.add(entry);
      return;
    }
    const session: Session = { engine: on, phase: 'preparing', demands: new Set([entry]) };
    sessions.set(appSessionId, session);
    const id = `browser-${++next}`;
    pending.set(id, {
      engine: on,
      settle(result) {
        if (sessions.get(appSessionId) !== session) return; // dropped meanwhile: its demands failed then
        if (result?.ok) {
          session.phase = 'served';
          for (const waiter of [...session.demands]) waiter.resolve(targetOf(waiter.demand, socketPath));
        } else {
          sessions.delete(appSessionId);
          for (const waiter of [...session.demands]) waiter.fail(result ? result.error : `the render host on ${machine} ended`);
        }
        session.demands.clear();
        options.changed();
      },
    });
    const request: BrowserEngineRequest = { id, appSessionId, operation: { op: 'prepare', ...(parent !== null && { parent }) } };
    if (!options.post(on, request)) {
      pending.delete(id);
      sessions.delete(appSessionId);
      entry.fail(`the render host on ${machine} took no request`);
    }
  }

  function drop(appSessionId: AppSessionId): Promise<void> {
    for (const entry of [...waiting, ...proceeding]) if (entry.demand.appSessionId === appSessionId) entry.fail(`the browser of ${appSessionId} was dropped`);
    const current = sessions.get(appSessionId);
    if (!current) {
      const drops = [...retiring.values()].flatMap((drops) => drops.get(appSessionId) ?? []);
      return Promise.all(drops).then(() => {});
    }
    sessions.delete(appSessionId);
    for (const entry of [...current.demands]) entry.fail(`the browser of ${appSessionId} was dropped`);
    const on = current.engine;
    const id = `browser-${++next}`;
    let answered!: () => void;
    const done = new Promise<void>((resolve) => (answered = resolve));
    let drops = retiring.get(on);
    if (!drops) retiring.set(on, (drops = new Map()));
    drops.set(appSessionId, done);
    const settle = () => {
      pending.delete(id);
      if (retiring.get(on)?.get(appSessionId) === done) {
        retiring.get(on)!.delete(appSessionId);
        if (retiring.get(on)!.size === 0) retiring.delete(on);
      }
      options.dropped(on, appSessionId);
      answered();
      options.changed();
    };
    pending.set(id, {
      engine: on,
      settle: (result) => {
        if (result && !result.ok) log(`[browser] ${appSessionId}: the render host's drop answered ${result.error}`);
        settle();
      },
    });
    options.changed();
    if (!options.post(on, { id, appSessionId, operation: { op: 'drop' } })) settle(); // its connection is going: its end is the drop
    return done;
  }

  return {
    ensure,
    drop,
    answer(on, { id, result }) {
      const request = pending.get(id);
      if (!request || request.engine !== on) return false;
      pending.delete(id);
      request.settle(result);
      return true;
    },
    engineOf: (appSessionId) => sessions.get(appSessionId)?.engine ?? null,
    served: () => [...sessions].filter(([, session]) => session.phase === 'served').map(([appSessionId]) => appSessionId),
    ready(on) {
      engine = on;
      if (on) for (const entry of [...waiting]) void proceed(entry, on);
    },
    gone(on) {
      if (engine === on) engine = null;
      const lost = [...sessions].filter(([, session]) => session.engine === on).map(([appSessionId]) => appSessionId);
      for (const [id, request] of [...pending]) {
        if (request.engine !== on) continue;
        pending.delete(id);
        request.settle(null);
      }
      const ended = new Set<AppSessionId>();
      for (const appSessionId of lost) {
        const current = sessions.get(appSessionId);
        if (current) {
          sessions.delete(appSessionId);
          for (const entry of [...current.demands]) entry.fail(`the render host on ${machine} ended`);
        }
        options.ended(appSessionId);
        ended.add(appSessionId);
      }
      // assigned to it and still waiting for a retiring drop or the lineage: no prepare sent yet, so no session above
      lose([...proceeding].filter((entry) => entry.on === on), ended);
      retiring.delete(on);
      options.changed();
    },
    refuse(reason) {
      for (const entry of [...waiting, ...proceeding]) entry.fail(reason);
    },
    waiting: () => waiting.size > 0,
    active: () => waiting.size > 0 || proceeding.size > 0 || pending.size > 0,
  };
}

function reasonOf(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'the promotion was cancelled');
}
