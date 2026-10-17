// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3; E's Decision Log 48): the host's registry of
// agents' `artifact_dataset {refresh: true}` requests, host-wide (every session's tools ask through it, and main reads
// and answers it by request id alone). It is the private request/answer operation the export's bridge is the pattern
// for, with what a bridge lacks: a readable request, the one connector operation bound to it, and the durable answer.
//
// - `ask` registers the request under a fresh id and announces the id alone (`maws.artifact.datasetRefresh`, which
//   every window receives); with no app connected it settles `noClient` at once and announces nothing.
// - `read` is main's view of a pending request (`artifacts.datasetRefreshRequest`): the dashboard, the dataset, the
//   base, the asking session and the query, nothing else.
// - `claim` binds the connector operation whose start carries the request's id, only when that start is the request
//   (its session, dashboard, dataset, base and query) and only once. The scope it answers is the publication's: the
//   session as the actor, the tool call's op id, the request's liveness, and where its durable answer is recorded.
// - It settles once. Main's reply (`answer`) settles with the durable answer the publication recorded, else as refused
//   (the host's own refusal words when its admission refused, else main's reason); main's words never replace a
//   durable answer. The engine withdrawing the call, the deadline and main's going settle too, and cancel the bound
//   operation; a durable answer recorded before then is still the answer (its op is the call's first result).
import { randomUUID } from 'node:crypto';
import type { HostClientHooks, HostEmit } from '@shared/host/runtime';
import type { Actor } from '@shared/artifacts/actor';
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
  | { kind: 'refused'; outcome: MawsDatasetRefreshOutcome; refusal: string | null }
  | { kind: 'timeout' | 'withdrawn' | 'noClient' };

/** The connector start that may carry a request (what `connectors.start` received). */
export interface DatasetRefreshStart {
  appSessionId: string;
  artifactId: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  dataset: { id: string; baseRevision?: number; requestId?: string };
}

/** A claimed request's publication scope, and where the host's admission records why it refused. */
export type DatasetRefreshScope = RefreshScope & { refused(refusal: string): void };

// Past main's own 180 s connector deadline (src/main/connectors/engine-route.ts), which covers the route, the call and
// the publication together and so answers first: this one only ends a request main never answers.
export const DATASET_REFRESH_ANSWER_MS = 190_000;

interface Entry {
  readonly ask: DatasetRefreshAsk;
  settle(settlement: DatasetRefreshSettlement): void;
  claimed: boolean;
  cancel?: () => void;
  published?: ArtifactDatasetResult;
  refusal?: string;
}

export class DatasetRefreshRequests {
  private readonly entries = new Map<string, Entry>();
  private readonly answerMs: number;
  private readonly newId: () => string;

  constructor(private readonly deps: { announce(requestId: string): void; hasClient(): boolean; answerMs?: number; newId?: () => string }) {
    this.answerMs = deps.answerMs ?? DATASET_REFRESH_ANSWER_MS;
    this.newId = deps.newId ?? randomUUID;
  }

  ask(ask: DatasetRefreshAsk, signal: AbortSignal): Promise<DatasetRefreshSettlement> {
    if (signal.aborted) return Promise.resolve({ kind: 'withdrawn' });
    if (!this.deps.hasClient()) return Promise.resolve({ kind: 'noClient' });
    const requestId = this.newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => end({ kind: 'timeout' }), this.answerMs);
      (timer as { unref?: () => void }).unref?.();
      const onAbort = () => end({ kind: 'withdrawn' });
      const entry: Entry = {
        ask,
        claimed: false,
        settle: (settlement) => {
          if (this.entries.get(requestId) !== entry) return;
          this.entries.delete(requestId);
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve(entry.published ? { kind: 'published', answer: entry.published } : settlement);
        },
      };
      // ended otherwise than by main's reply: the bound operation, if any, is withdrawn (it may still be running)
      const end = (settlement: DatasetRefreshSettlement) => {
        if (this.entries.get(requestId) !== entry) return;
        entry.settle(settlement);
        if (!entry.published) entry.cancel?.();
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

  // Main's reply: the first one settles the request.
  answer(requestId: string, outcome: MawsDatasetRefreshOutcome): 'delivered' | 'not_pending' {
    const entry = this.entries.get(requestId);
    if (!entry) return 'not_pending';
    entry.settle({ kind: 'refused', outcome, refusal: entry.refusal ?? null });
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
    return {
      actor,
      opId: ask.opId,
      live: () => this.entries.get(requestId) === entry,
      published: (answer) => {
        entry.published = answer;
      },
      refused: (refusal) => {
        entry.refusal = refusal;
      },
    };
  }

  // Main's client went: nothing can answer a pending request any more.
  clientGone(): void {
    for (const [requestId, entry] of [...this.entries]) {
      if (this.entries.get(requestId) !== entry) continue;
      entry.settle({ kind: 'noClient' });
      if (!entry.published) entry.cancel?.();
    }
  }
}

/** The host's registry as its entry wires it: announced on the host's event, asked only with an app connected, ended
 * when main's client goes. One per host, given to the artifacts surface, the connector leg and the engine IPC. */
export function hostDatasetRefresh(emit: HostEmit, client: Pick<HostClientHooks, 'hasClient' | 'onClientGone'>): DatasetRefreshRequests {
  const requests = new DatasetRefreshRequests({ announce: (requestId) => void emit('maws.artifact.datasetRefresh', { requestId }), hasClient: client.hasClient });
  client.onClientGone(() => requests.clientGone());
  return requests;
}
