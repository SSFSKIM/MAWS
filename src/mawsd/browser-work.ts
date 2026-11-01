// Browser work in `mawsd`: the fence's daemon side (P5 O17 M3; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
// Interfaces §E; R4, R5, D12). Eager: no state until an engine reports work, and nothing runs on a timer.
//
// A tab engine holding tabs for a session (the render host's, M4; an app's tabs are never browser work, R5) reports it
// with `browserEngine.work` over machine.sock (front.ts). A session is held while any engine connection holds it.
// `mawsd` tells the engine host the full set of held sessions with `host.browserWork`: first on every fresh link (a
// successor's included, O16's condition), then at each change, one snapshot in flight at a time, changes behind it
// coalesced. The engine host releases a held session under no rule but the idle release's own (D20, M7).
//
// The fence's linearization point is the engine host's acknowledgement of a snapshot that names the session: only then
// does an acquire answer, and only then does the engine make its tab. An acquire resolves at once only when the most
// recently sent snapshot on the current link names its session and was acknowledged; otherwise at the acknowledgement of
// a later snapshot on the current link that names it. An acknowledgement from an earlier link never counts, and an
// acknowledged snapshot no longer counts once a snapshot omitting the session was sent, even unacknowledged, since the
// engine host may apply that one first. A failed acquire (no link, an engine host that predates the command, the link
// lost or the snapshot refused before its acknowledgement) holds nothing, so no tab is made.
//
// Every hold comes from a live connection through `mawsd` (the render host exits when it loses machine.sock), so nothing
// is persisted and a fresh `mawsd`'s first snapshot is its own truth, ordinarily empty (D12). A hold outlives the
// engine-host link: an engine-host restart keeps a held headless tab, and the successor's first snapshot names it.
import type { AppSessionId } from '@shared/graph/ids';

// An engine's machine.sock connection, by identity: the front's client for it (front.ts), which the route selects per
// session (M5's browser-route.ts)
export type EngineConnection = object;

export interface BrowserWork {
  acquire(engine: EngineConnection, appSessionId: AppSessionId): Promise<void>; // rejects with a reason when the fence cannot be had
  release(engine: EngineConnection, appSessionId: AppSessionId): void; // never waits
  holding(engine: EngineConnection, appSessionId: AppSessionId): boolean; // the connection holds the session
  engineGone(engine: EngineConnection): void; // every hold of that connection removed
  linkUp(send: (held: AppSessionId[]) => Promise<void>, capable: boolean): Promise<void>; // the snapshot first on a fresh link
  linkDown(): void; // pending acquires reject
  held(): AppSessionId[];
}

export interface BrowserWorkOptions {
  machine: string; // as the reasons name it
  log(line: string): void;
}

// §I's condition 4, and the acquire's answer to such a host (the old-host cell, §A)
export const oldHostReason = (machine: string) => `the engine host on ${machine} predates browser work holds; it is replaced when idle`;
// No engine-host link: the capability reads this build's, while the fence cannot be had until the link is back
export const reconnectingReason = (machine: string) => `the engine host on ${machine} is reconnecting`;

interface Waiter {
  engine: EngineConnection;
  appSessionId: AppSessionId;
  added: boolean; // this acquire made the connection's hold, so its failure removes it
  resolve(): void;
  reject(error: Error): void;
}

// The latest snapshot sent on a link: in flight, acknowledged, or failed (what the engine host applied is unknown)
interface Sent {
  held: ReadonlySet<AppSessionId>;
  state: 'inFlight' | 'acked' | 'failed';
}

interface Link {
  send(held: AppSessionId[]): Promise<void>;
  capable: boolean;
  sent: Sent | null;
}

export function createBrowserWork(options: BrowserWorkOptions): BrowserWork {
  const { machine, log } = options;
  const holds = new Map<AppSessionId, Set<EngineConnection>>(); // only sessions some connection holds
  const waiters = new Set<Waiter>();
  let link: Link | null = null;

  const held = (): AppSessionId[] => [...holds.keys()].sort();
  const hold = (engine: EngineConnection, appSessionId: AppSessionId): boolean => {
    let set = holds.get(appSessionId);
    if (!set) holds.set(appSessionId, (set = new Set()));
    if (set.has(engine)) return false;
    set.add(engine);
    return true;
  };
  const unhold = (engine: EngineConnection, appSessionId: AppSessionId) => {
    const set = holds.get(appSessionId);
    if (!set?.delete(engine)) return;
    if (set.size === 0) holds.delete(appSessionId);
  };
  const fail = (waiter: Waiter, reason: string) => {
    waiters.delete(waiter);
    if (waiter.added) unhold(waiter.engine, waiter.appSessionId);
    waiter.reject(new Error(reason));
  };

  // The next snapshot, when one is due: none while one is in flight; none when the set is the one last acknowledged, or
  // the one last refused with no acquire waiting (a refusal is not retried on its own, so a refusing host is not looped)
  const flush = () => {
    const current = link;
    if (current === null || !current.capable || current.sent?.state === 'inFlight') return;
    const snapshot = held();
    const last = current.sent;
    if (last !== null && sameSet(last.held, snapshot) && (last.state === 'acked' || waiters.size === 0)) return;
    send(current, snapshot);
  };

  const send = (current: Link, snapshot: AppSessionId[]): Promise<void> => {
    const sent: Sent = { held: new Set(snapshot), state: 'inFlight' };
    current.sent = sent;
    let answer: Promise<void>;
    try {
      answer = current.send(snapshot);
    } catch (error) {
      answer = Promise.reject(error);
    }
    return answer.then(
      () => {
        if (link !== current) return; // an earlier link's: never counts
        sent.state = 'acked';
        for (const waiter of [...waiters]) {
          if (!sent.held.has(waiter.appSessionId)) continue;
          waiters.delete(waiter);
          waiter.resolve();
        }
        flush();
      },
      (error: unknown) => {
        if (link !== current) return;
        sent.state = 'failed';
        const why = error instanceof Error ? error.message : String(error);
        log(`[browser] host.browserWork {held: [${snapshot.join(', ')}]} failed: ${why}`);
        for (const waiter of [...waiters]) if (sent.held.has(waiter.appSessionId)) fail(waiter, `the engine host on ${machine} did not take the browser work hold: ${why}`);
        flush();
      },
    );
  };

  const work: BrowserWork = {
    acquire(engine, appSessionId) {
      if (link === null) return Promise.reject(new Error(reconnectingReason(machine)));
      if (!link.capable) return Promise.reject(new Error(oldHostReason(machine)));
      const added = hold(engine, appSessionId);
      const last = link.sent;
      if (last?.state === 'acked' && last.held.has(appSessionId)) return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        waiters.add({ engine, appSessionId, added, resolve, reject });
        flush();
      });
    },
    release(engine, appSessionId) {
      unhold(engine, appSessionId);
      for (const waiter of [...waiters]) if (waiter.engine === engine && waiter.appSessionId === appSessionId) fail(waiter, `the browser work for ${appSessionId} was released before the engine host took it`);
      flush();
    },
    holding: (engine, appSessionId) => holds.get(appSessionId)?.has(engine) ?? false,
    engineGone(engine) {
      for (const waiter of [...waiters]) if (waiter.engine === engine) fail(waiter, 'the engine’s connection ended');
      for (const appSessionId of [...holds.keys()]) unhold(engine, appSessionId);
      flush();
    },
    linkUp(send_, capable) {
      if (link !== null) work.linkDown();
      const current: Link = { send: send_, capable, sent: null };
      link = current;
      if (!capable) return Promise.resolve();
      return send(current, held()); // at once, whatever it holds: an empty one clears the engine host's `unknown`
    },
    linkDown() {
      link = null;
      for (const waiter of [...waiters]) fail(waiter, reconnectingReason(machine));
    },
    held,
  };
  return work;
}

const sameSet = (set: ReadonlySet<AppSessionId>, list: readonly AppSessionId[]) => set.size === list.length && list.every((id) => set.has(id));
