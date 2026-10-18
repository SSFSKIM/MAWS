// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; E's Decision Log 48): the host's registry of
// agents' `artifact_dataset {refresh: true}` requests, host-wide (every session's tools ask through it, and main reads
// and answers it by request id alone). It is the private request/answer operation the export's bridge is the pattern
// for, with what a bridge lacks: a readable request, the one connector operation bound to it, and the host's own end
// of its publication, which is the request's answer.
//
// - `ask` registers the request under a fresh id and announces the id alone (`maws.artifact.datasetRefresh`, which
//   every window receives); with no app connected it settles `noClient` at once and announces nothing. Its one budget,
//   CONNECTOR_OPERATION_DEADLINE_MS, runs from this admission through main's route, the grant, the call and the
//   publication (E3 M2 fix): past it nothing publishes.
// - `read` is main's view of a pending request (`artifacts.datasetRefreshRequest`): the dashboard, the dataset, the
//   base, the asking session and the query, nothing else.
// - `claim` binds the connector operation whose start carries the request's id, only when that start is the request
//   (its session, dashboard, dataset, base and query) and only once. The scope it answers is the publication's: the
//   session as the actor, the tool call's op id, its admission and its end.
// - It settles once, and the host's own end of the publication is the answer: the durable answer it committed, or the
//   dataset found changed (`stale`, a descriptor-level conflict), or revoked, each at once. Main's reply settles only
//   a request nothing was published for, as refused (the host's own refusal words when its admission refused, else
//   main's closed reason); main's words never replace the host's. The engine withdrawing the call, the deadline and
//   main's going settle too, and cancel the bound operation.
// - E3 M2 fix (reviewer finding 2): from the publication's admission (synchronous with its savepoint) to its durable
//   commit or rollback, the registry owns its end. A reply, withdrawal, deadline or main's going heard meanwhile is
//   held: the commit then answers its durable record, a rollback the end first heard.
import { randomUUID } from 'node:crypto';
import type { HostClientHooks, HostEmit } from '@shared/host/runtime';
import type { Actor } from '@shared/artifacts/actor';
import { CONNECTOR_OPERATION_DEADLINE_MS } from '@shared/artifacts/connectors';
import type { AppSessionId } from '@shared/graph/ids';
import type { MawsDatasetRefreshOutcome } from '@shared/ipc/schema/maws';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { sameJson, type RefreshScope } from '../dashboards/refresh';

/** What the tool asks: the dataset of a dashboard at the base the session read, and its query. */
export interface DatasetRefreshAsk {
  artifactId: string;
  datasetId: string;
  baseRevision: number;
  appSessionId: AppSessionId;
  opId: string | null;
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

export type DatasetRefreshRead = Omit<DatasetRefreshAsk, 'opId'>;

export type DatasetRefreshSettlement =
  | { kind: 'published'; answer: ArtifactDatasetResult }
  | { kind: 'stale'; detail: string }
  | { kind: 'refused'; outcome: MawsDatasetRefreshOutcome; refusal: string | null }
  | { kind: 'timeout' | 'withdrawn' | 'noClient' };

/** The connector start that may carry a request (what `connectors.start` received). */
export interface DatasetRefreshStart {
  appSessionId?: string; // E3c: page direct refreshes have no session; claim still exact-matches an agent
  artifactId: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  dataset: { id: string; baseRevision?: number; requestId?: string };
}

/** A claimed request's publication scope, and where the host's admission says why it refused (`stale`: the dataset
 * changed or went since the session read it). */
export type DatasetRefreshScope = RefreshScope & { refused(refusal: string, stale?: boolean): void };

const REVOKED: MawsDatasetRefreshOutcome = { ok: false, state: 'revoked', reason: 'revoked' };

interface Entry {
  readonly ask: DatasetRefreshAsk;
  readonly deadlineAt: number;
  settle(settlement: DatasetRefreshSettlement): void;
  claimed: boolean;
  committing: boolean; // its publication admitted, its commit not yet settled
  held?: DatasetRefreshSettlement; // the first end heard while committing
  cancel?: () => void;
  refusal?: string;
}

export class DatasetRefreshRequests {
  private readonly entries = new Map<string, Entry>();
  private readonly deadlineMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;

  constructor(private readonly deps: { announce(requestId: string): void; hasClient(): boolean; deadlineMs?: number; now?: () => number; newId?: () => string }) {
    this.deadlineMs = deps.deadlineMs ?? CONNECTOR_OPERATION_DEADLINE_MS;
    this.now = deps.now ?? Date.now;
    this.newId = deps.newId ?? randomUUID;
  }

  ask(ask: DatasetRefreshAsk, signal: AbortSignal): Promise<DatasetRefreshSettlement> {
    if (signal.aborted) return Promise.resolve({ kind: 'withdrawn' });
    if (!this.deps.hasClient()) return Promise.resolve({ kind: 'noClient' });
    const requestId = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => this.end(requestId, { kind: 'timeout' }), this.deadlineMs);
      (timer as { unref?: () => void }).unref?.();
      const onAbort = () => this.end(requestId, { kind: 'withdrawn' });
      const entry: Entry = {
        ask,
        deadlineAt: this.now() + this.deadlineMs,
        claimed: false,
        committing: false,
        settle: (settlement) => {
          if (this.entries.get(requestId) !== entry) return;
          this.entries.delete(requestId);
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(settlement);
        },
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.entries.set(requestId, entry);
      this.deps.announce(requestId);
    });
  }

  read(requestId: string): DatasetRefreshRead | null {
    const entry = this.entries.get(requestId);
    if (!entry) return null;
    const { artifactId, datasetId, baseRevision, appSessionId, server, tool, args } = entry.ask; // never its op id
    return { artifactId, datasetId, baseRevision, appSessionId, server, tool, args };
  }

  // Main's reply: nothing was published for the request, by main's account. Held while a commit is in flight.
  answer(requestId: string, outcome: MawsDatasetRefreshOutcome): 'delivered' | 'not_pending' {
    const entry = this.entries.get(requestId);
    if (!entry) return 'not_pending';
    const settlement: DatasetRefreshSettlement = { kind: 'refused', outcome, refusal: entry.refusal ?? null };
    if (entry.committing) entry.held ??= settlement;
    else entry.settle(settlement);
    return 'delivered';
  }

  claim(requestId: string, start: DatasetRefreshStart, cancel: () => void): DatasetRefreshScope | null {
    const entry = this.entries.get(requestId);
    if (!entry || entry.claimed) return null;
    const { ask } = entry;
    const matches =
      start.dataset.requestId === requestId &&
      start.appSessionId === ask.appSessionId &&
      start.artifactId === ask.artifactId &&
      start.dataset.id === ask.datasetId &&
      start.dataset.baseRevision === ask.baseRevision &&
      start.server === ask.server &&
      start.tool === ask.tool &&
      sameJson(start.arguments, ask.args);
    if (!matches) return null;
    entry.claimed = true;
    entry.cancel = cancel;
    const actor: Actor = { kind: 'session', appSessionId: ask.appSessionId };
    const pending = () => this.entries.get(requestId) === entry;
    return {
      actor,
      opId: ask.opId,
      // pending, within its budget, and not admitted already: from now its end waits for the commit's
      admit: () => {
        if (!pending() || entry.committing || this.now() >= entry.deadlineAt) return false;
        entry.committing = true;
        return true;
      },
      ended: (end) => {
        if (!pending()) return;
        if ('published' in end) return entry.settle({ kind: 'published', answer: end.published });
        if ('discarded' in end && end.discarded === 'stale') return entry.settle({ kind: 'stale', detail: end.detail });
        if ('discarded' in end && end.discarded === 'revoked') return entry.settle({ kind: 'refused', outcome: REVOKED, refusal: end.detail });
        // cancelled before its admission, or rolled back after it: nothing was published
        entry.refusal = 'discarded' in end ? end.detail : `the publication was not committed: ${end.error}`;
        entry.committing = false;
        const held = entry.held;
        if (held) {
          entry.settle(held.kind === 'refused' ? { ...held, refusal: held.refusal ?? entry.refusal } : held);
          entry.cancel?.();
        }
      },
      refused: (refusal, stale) => {
        if (stale) entry.settle({ kind: 'stale', detail: refusal });
        else entry.refusal = refusal;
      },
    };
  }

  // Main's client went: nothing can answer a pending request any more.
  clientGone(): void {
    for (const requestId of [...this.entries.keys()]) this.end(requestId, { kind: 'noClient' });
  }

  // Ended otherwise than by main's reply: the bound operation, if any, is withdrawn (it may still be running). Held
  // while a commit is in flight, which then answers.
  private end(requestId: string, settlement: DatasetRefreshSettlement): void {
    const entry = this.entries.get(requestId);
    if (!entry) return;
    if (entry.committing) {
      entry.held ??= settlement;
      return;
    }
    entry.settle(settlement);
    entry.cancel?.();
  }
}

/** The host's registry as its entry wires it: announced on the host's event, asked only with an app connected, ended
 * when main's client goes. One per host, given to the artifacts surface, the connector leg and the engine IPC. */
export function hostDatasetRefresh(emit: HostEmit, client: Pick<HostClientHooks, 'hasClient' | 'onClientGone'>): DatasetRefreshRequests {
  const requests = new DatasetRefreshRequests({ announce: (requestId) => void emit('maws.artifact.datasetRefresh', { requestId }), hasClient: client.hasClient });
  client.onClientGone(() => requests.clientGone());
  return requests;
}
