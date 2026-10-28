// Lane B's pending counts for `notify` (O10's follow-up to O13 M5's finding; P5 Surprises): sminos's pending sets hold
// only what its bridges raised, so a lane B session's requests reach the Notifier from the engine host. A session's
// count is its broker items that wait on an answer (`waitsOnAnswer` in src/shared/attention/kinds.ts: pending or
// delivered, standing for a request), the cards a `cards` subscription would show; the engine host counts its read by
// the same rule.
//
// Two sources, neither per session: every `session.brokerItems` the engine host publishes, for every session whether or
// not a device is subscribed (the whole list on each change); and, at each link to the engine host `mawsd` reports
// (`onUpstream` connected: a restart, a crash, the recycle at each app's attachment and departure), the whole set read
// at once (`engine.pendingItems`: each session's count, those with none left out), which settles whatever changed or
// left while the link was down, as sminos's restated set does lane A's. A change published while that read is in flight is newer than what the read says of its session.
//
// Until O3, the engine host's events reach `mawsd` only while an app is attached (P5 Decision Log 29): with none, the
// counts are those of the last read or event, and a change is told at the next link (an app attaching recycles it).
import { waitsOnAnswer } from '@shared/attention/kinds';
import type { EndpointServices } from './services';

export type LaneBPendingContext = {
  dispatch: EndpointServices['dispatch'];
  notifier: { laneBCount(session: string, count: number): void; laneBSet(counts: ReadonlyMap<string, number>): void };
  log(line: string): void;
};

/** How many of a session's broker items (as `onEvent` gives them, unchecked) wait on an answer. */
export function waitingCount(items: readonly unknown[]): number {
  let count = 0;
  for (const item of items) {
    const { state, request } = (item ?? {}) as { state?: unknown; request?: { requestId?: unknown } | null };
    if (typeof state === 'string' && typeof request?.requestId === 'string' && waitsOnAnswer({ state: state as never, request: { requestId: request.requestId as never } })) count += 1;
  }
  return count;
}

export class LaneBPending {
  readonly #ctx: LaneBPendingContext;
  /** Reads of the whole set begun: only the latest one's answer is taken. */
  #reads = 0;
  /** Each session's count from the events published since the latest read was sent, or null with none in flight. */
  #since: Map<string, number> | null = null;

  constructor(ctx: LaneBPendingContext) {
    this.#ctx = ctx;
  }

  /** A live engine-host event (`onEvent`): a session's broker items, its whole list. */
  event(owner: string, message: { name: string; payload: unknown }): void {
    if (owner !== 'engine-host' || message.name !== 'session.brokerItems') return;
    const { appSessionId, items } = (message.payload ?? {}) as { appSessionId?: unknown; items?: unknown };
    if (typeof appSessionId !== 'string' || !Array.isArray(items)) return;
    const count = waitingCount(items);
    this.#since?.set(appSessionId, count);
    this.#ctx.notifier.laneBCount(appSessionId, count);
  }

  /** Reads the engine host's whole set and restates every lane B count from it (a link to the engine host is up). */
  async restate(): Promise<void> {
    const read = ++this.#reads;
    const since = new Map<string, number>();
    this.#since = since;
    let sessions: unknown;
    let why = 'an answer with no sessions';
    try {
      const response = await this.#ctx.dispatch('engine-host', 'engine.pendingItems', undefined);
      if (response.ok) sessions = (response.value as { sessions?: unknown } | null)?.sessions;
      else why = `${response.error.code}: ${response.error.message}`;
    } catch (error) {
      why = (error as Error).message;
    }
    if (read !== this.#reads) return;
    this.#since = null;
    if (!Array.isArray(sessions)) {
      return this.#ctx.log(`endpoint: lane B's pending set could not be read (${why}); its counts follow the engine host's events alone until the next link`);
    }
    const counts = new Map<string, number>();
    for (const entry of sessions as Array<{ appSessionId?: unknown; waiting?: unknown } | null>) {
      if (typeof entry?.appSessionId === 'string' && Number.isSafeInteger(entry.waiting) && (entry.waiting as number) >= 0) counts.set(entry.appSessionId, entry.waiting as number);
    }
    for (const [session, count] of since) counts.set(session, count);
    this.#ctx.notifier.laneBSet(counts);
  }
}
