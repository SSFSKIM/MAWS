// Main's resync (E10 execution document, §Design 3 "Main's resync, and why it comes before `ready`"; X13 "Main"). The
// digest fold is order-dependent and its id window (SEEN_WINDOW) is smaller than a tail, so main pulls before it streams:
// between a host's welcome and main's `ready` line it lists the host's rows (`engine.sessions`), applies each row's
// status, and folds each row's launch from `session.events`, paged; then the host's burst and live batches pass the fold
// filter, which drops for the fold what it already holds. Every other listener of `session.eventBatch`, and the windows,
// still receive every batch: for them the burst's events are new.
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import type { EngineSessionStatus } from '@shared/engine/status';
import type { EventsSnapshot } from '@shared/ipc/schema/session';
import type { HostDispatch } from '../ipc/router';
import type { ReadModelWriter } from './read-model';

export const RESYNC_PAGE = 2_000; // events per `session.events` page

// How far the fold holds a row's launch: its last journal row, and the ids of that row's events already folded (one row
// yields several events, and a live batch may split a row).
export interface FoldPosition {
  launchId: string;
  lastSeq: number;
  idsAtLastSeq: Set<string>;
}

// The launch an event of `appSessionId` belongs to, read from its id (`${appSessionId}:${launchId}:${seq}:${i}`, the
// normaliser's form); null for an event that is not a launch's (main's own, `seq: null`, or another id form).
function launchOf(appSessionId: AppSessionId, event: SessionEvent): string | null {
  const prefix = `${appSessionId}:`;
  if (event.seq === null || !event.id.startsWith(prefix)) return null;
  const rest = event.id.slice(prefix.length);
  const index = rest.lastIndexOf(':');
  const seqAt = index > 0 ? rest.lastIndexOf(':', index - 1) : -1;
  if (seqAt <= 0 || rest.slice(seqAt + 1, index) !== String(event.seq)) return null;
  return rest.slice(0, seqAt);
}

// Per row, the position the fold reached, advanced over every event it lets through (the resync's pages, the burst,
// live batches), so an in-run reconnect pages from it and no event is folded twice or out of order. An event of another
// launch than the one held starts that launch's position afresh; an event that is not a launch's always passes.
export class FoldFilter {
  private readonly folded = new Map<AppSessionId, FoldPosition>();

  position(appSessionId: AppSessionId): FoldPosition | null {
    return this.folded.get(appSessionId) ?? null;
  }

  forget(appSessionId: AppSessionId): void {
    this.folded.delete(appSessionId);
  }

  pass(appSessionId: AppSessionId, events: SessionEvent[]): SessionEvent[] {
    const passed: SessionEvent[] = [];
    for (const event of events) {
      const launchId = launchOf(appSessionId, event);
      if (launchId === null) {
        passed.push(event);
        continue;
      }
      const seq = event.seq!;
      let at = this.folded.get(appSessionId);
      if (at === undefined || at.launchId !== launchId) {
        at = { launchId, lastSeq: seq, idsAtLastSeq: new Set() };
        this.folded.set(appSessionId, at);
      } else if (seq < at.lastSeq || (seq === at.lastSeq && at.idsAtLastSeq.has(event.id))) {
        continue;
      }
      if (seq > at.lastSeq) {
        at.lastSeq = seq;
        at.idsAtLastSeq = new Set();
      }
      at.idsAtLastSeq.add(event.id);
      passed.push(event);
    }
    return passed;
  }
}

export interface ResyncDeps {
  dispatch: HostDispatch; // the supervisor's resync dispatch: refused once the signal has aborted
  signal: AbortSignal; // aborts on a host transition (`transition`) or at RESYNC_BOUND_MS (`bound`)
  writer: Pick<ReadModelWriter, 'fold' | 'applyEngineStatus'>;
  filter: FoldFilter;
  held: Set<AppSessionId>; // the ids whose status this host generation sent (forgotten when the host leaves `ready`)
  log: (line: string) => void;
}

// One resync. A row main already folded in this launch pages from the start of the last row it holds (the filter drops
// what of it the fold has, so a row a batch split is completed once); any other row from its launch's start. A page
// answered from the disk (events with `seq: null`: no stream for the row) is not the launch's stream and folds nothing.
// Cancelled (the signal), it stops asking and folding at once; at the bound it logs the rows it left, whose digests then
// fold from the burst with whatever position the filter holds for them.
export async function resyncDigests({ dispatch, signal, writer, filter, held, log }: ResyncDeps): Promise<void> {
  const listed = await dispatch('engine-host', 'engine.sessions', undefined);
  if (signal.aborted) {
    if (signal.reason === 'bound') log(`resync: stopped at its bound before the host's sessions were listed; every digest folds from the tail`);
    return;
  }
  if (!listed.ok) return log(`resync: the host's sessions could not be listed (${listed.error.message}); their digests fold from the tail`);
  const statuses = listed.value as EngineSessionStatus[];
  for (const status of statuses) {
    held.add(status.appSessionId);
    writer.applyEngineStatus(status);
  }
  const left = new Set(statuses.map((s) => s.appSessionId));
  const atBound = () => {
    if (signal.reason === 'bound' && left.size > 0) {
      log(`resync: stopped at its bound with ${left.size} row${left.size === 1 ? '' : 's'} not folded (${[...left].join(', ')}); their digests fold from the tail`);
    }
  };
  signal.addEventListener('abort', atBound, { once: true });
  let folded = 0;
  try {
    for (const status of statuses) {
      const id = status.appSessionId;
      const at = filter.position(id);
      let afterSeq: number | null = at !== null && at.launchId === status.launchId ? at.lastSeq - 1 : null;
      if (afterSeq === null) filter.forget(id);
      for (;;) {
        const answer = await dispatch('engine-host', 'session.events', { appSessionId: id, afterSeq, limit: RESYNC_PAGE });
        if (signal.aborted) return;
        if (!answer.ok) {
          log(`resync: ${id}'s events could not be read (${answer.error.message}); its digest folds from the tail`);
          break;
        }
        const { events, lastSeq, complete } = answer.value as EventsSnapshot;
        const passed = filter.pass(id, events.filter((event) => event.seq !== null));
        writer.fold(id, passed);
        folded += passed.length;
        if (complete || events.length === 0) break;
        afterSeq = lastSeq;
      }
      left.delete(id);
    }
    log(`resync: ${statuses.length} row${statuses.length === 1 ? '' : 's'}, ${folded} events folded`);
  } finally {
    signal.removeEventListener('abort', atBound);
  }
}
