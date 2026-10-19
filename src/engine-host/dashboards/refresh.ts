// E3 M2 (docs/doperpowers/plans/2026-10-16-p3-e3-live-datasets.md R3, "Linearization and transitions"; XE5, XE6): a
// granted call's result published as a query dataset's snapshot, in the host, through the same atomic write
// `artifact_dataset` binds a file with. Main never carries the result's bytes; the renderer reads the committed
// descriptor and the host's pages of its snapshot.
//
//   1. `admit`, before the call is dispatched: the dashboard is live and held by no legacy files, the dataset is a query
//      whose server, tool and arguments are the call's, an agent's `baseRevision` is neither future nor older than the
//      dataset's last change, and the dataset's mutation identity (E2's per-dataset change index, `lastChange`) is
//      captured. A page's watch names no base: each refresh's admission is its base.
//   2. `publish`, once the call answered: the result's rows (./query-result.ts) parsed once by the host's dataset
//      parser, and its row key checked, before anything is written. Then one serialized commit
//      (`ArtifactStore.writeWithAssets`) whose `prepare`, synchronous with the write, requires the caller's guard (the
//      grant's fence held, the operation not cancelled), the dataset's identity unchanged and, last, the scope's
//      admission (an agent's request still pending and within its deadline; from that step the request's registry
//      holds its end until the commit or its rollback says how it went); inside that savepoint: the snapshot
//      (`query-<uuid>.json`, a query snapshot), the descriptor, its retention (`retainQuerySnapshots`), an agent's op
//      answer. A discarded publication writes nothing: no snapshot, descriptor, retention or op, and no retry over the
//      newer source; a dataset changed since the admission is `stale` (E3 M2 fix: a descriptor-level conflict, never a
//      tool's failure). A result that fails validation, or a tool that failed, writes the error state alone under the
//      same guard, so an old failure never covers a newer success, and says which failure it was. Right after a
//      successful commit, `collectRetiredAssets` removes what that retention retired and nothing else protects.
import { readDataset, setDataset, type DatasetDescriptor, type QuerySource } from '@artifacts/dashboard/datasets';
import { legacyDashboardFiles } from '@artifacts/dashboard/legacy';
import { DatasetError, parseDataset, rowKeyProblem, type ParsedDataset } from '@artifacts/dashboard/parse';
import { DATASET_STATES } from '@artifacts/dashboard/states';
import { canonicalQueryValue, queryIdentity } from '@artifacts/dashboard/query'; // E3 M3 fix
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactDatasetResult } from '@shared/maws/dashboard-tools';
import { ArtifactStoreError } from '../documents/errors';
import { querySnapshotName } from '../documents/retention'; // E3 panel
import type { ArtifactStore } from '../documents/store';
import type { OpScope } from '../documents/ops';
import { dashboardAdapterOf } from '.';
import { QUERY_RESULT_PROBLEMS, queryRowsOf } from './query-result';

const TOOL = 'artifact_dataset'; // an agent's refresh is this tool's op
const MESSAGE_MAX = 1_000;

/** The call as the host's start received it: the dashboard, the tool and its arguments, and the sink main forwarded. */
export interface RefreshStart {
  artifactId: string;
  server: string;
  tool: string;
  arguments: Record<string, unknown>;
  dataset: { id: string; baseRevision?: number };
}

/** Who publishes, and whether they may still: the human for a page, the asking session for an agent's refresh (its op
 * id, and its request in the host's registry). */
export interface RefreshScope {
  actor: Actor;
  opId: string | null;
  /** In the commit's prepare, synchronously and last: whether it may still publish. True hands the publication's end
   * to the scope's owner, which then waits for `ended` rather than settle "nothing published" meanwhile. */
  admit(): boolean;
  /** How the publication ended: committed, discarded before its commit, or rolled back with its write (`error`). */
  ended?(end: RefreshPublication | { error: string }): void;
}

/** What the call came back with, as the host's connector leg read it. */
export type RefreshRaw = { kind: 'result'; result: unknown } | { kind: 'failed'; reason: 'toolError' | 'tooLarge' | 'timeout' };
/** The caller's guard, read inside the commit's prepare: the grant's fence and the operation. */
export type RefreshGuard = () => 'held' | 'revoked' | 'cancelled';
/** A failure the publication recorded as the error state: the result refused by validation (its rows, its size), the
 * tool's own error, or its deadline. */
export type RefreshFailure = 'validation' | 'toolError' | 'timeout';
/** The publication's end: its durable answer (with the failure an error state records), or why nothing was written. */
export type RefreshPublication = { published: ArtifactDatasetResult; failed?: RefreshFailure } | { discarded: 'revoked' | 'cancelled' | 'stale'; detail: string };
/** `stale`: the dashboard or the dataset went, or the dataset changed since the base (a concurrent mutation). */
/** `admitted` (E3 M2 residual): told, synchronously in the prepare and after every check, that the commit is admitted,
 * so the caller's own cancel can no longer stop it (the host's connector leg answers it `cancelled: false`). */
export type RefreshPublish = (raw: RefreshRaw, guard: RefreshGuard, admitted?: () => void) => Promise<RefreshPublication>;
export type RefreshAdmission = { ok: true; publish: RefreshPublish } | { ok: false; refusal: string; stale?: true };

// The closed words a failed refresh records (never a server's text), and which failure each is.
const FAILED = {
  toolError: 'the last refresh failed: the tool reported an error',
  tooLarge: 'the last refresh failed: the tool answered too large a result',
  timeout: 'the last refresh failed: the tool did not answer in time',
} as const;
const FAILURE_OF: Record<keyof typeof FAILED, RefreshFailure> = { toolError: 'toolError', tooLarge: 'validation', timeout: 'timeout' };
// P3-F: a result whose reading threw past every closed rule, said in the host's words, never the thrown error's
const UNREADABLE = 'its rows could not be read';
const bounded = (message: string) => message.slice(0, MESSAGE_MAX);

class Discard extends Error {
  constructor(
    readonly why: 'revoked' | 'cancelled' | 'stale',
    detail: string,
  ) {
    super(detail);
  }
}

/** Whether two JSON values are the same, whatever order their objects' keys came in (E3 M3 fix: the shared rule). */
export const sameJson = (a: unknown, b: unknown): boolean => canonicalQueryValue(a) === canonicalQueryValue(b);
/** Whether two queries are one: the same server, tool and arguments (their keys in any order). Its schedule, staleness
 * and the dataset's metadata are no part of a query's identity (the architect's M2 ruling); E3 M3 fix: the identity the
 * editor's live controls read too. */
export const sameQueryIdentity = (a: Pick<QuerySource, 'server' | 'tool' | 'args'>, b: Pick<QuerySource, 'server' | 'tool' | 'args'>): boolean => queryIdentity(a) === queryIdentity(b);
const sameQuery = (source: QuerySource, call: Pick<RefreshStart, 'server' | 'tool' | 'arguments'>) => sameQueryIdentity(source, { server: call.server, tool: call.tool, args: call.arguments });

export function datasetRefresher(store: ArtifactStore, options: { now?: () => number; log?: (line: string) => void } = {}): { admit(start: RefreshStart, scope: RefreshScope): Promise<RefreshAdmission> } {
  const now = options.now ?? Date.now;
  const log = options.log ?? ((line: string) => console.warn(`[datasets] ${line}`));

  async function admit(start: RefreshStart, scope: RefreshScope): Promise<RefreshAdmission> {
    const adapter = dashboardAdapterOf(store);
    if (!adapter) return { ok: false, refusal: 'dashboards are not registered with the artifact store in this run of MAWS' };
    const { artifactId } = start;
    const { id, baseRevision } = start.dataset;
    // E3 M2 fix: a dashboard or dataset gone, or a dataset no longer this query, is a concurrent change (`stale`)
    const found = await store.readCommitted((): { refusal: string; stale?: true } | { prior: DatasetDescriptor & { source: QuerySource }; identity: number } => {
      const artifact = store.get(artifactId);
      if (!artifact) return { refusal: `${artifactId} is gone`, stale: true };
      if (artifact.kind !== 'dashboard') return { refusal: `${artifactId} is a ${artifact.kind} artifact, not a dashboard` };
      const doc = store.service.live(artifactId);
      if (legacyDashboardFiles(doc)) return { refusal: `${artifactId} is a dashboard made from files, which is never written` };
      const descriptor = readDataset(doc, id);
      if (!descriptor) return { refusal: DATASET_STATES.noDataset(id), stale: true };
      if (descriptor.source.kind !== 'query') return { refusal: `dataset "${id}" is not a query`, stale: true };
      if (!sameQuery(descriptor.source, start)) return { refusal: `the call is not dataset "${id}"'s query`, stale: true };
      const identity = adapter.lastChange(artifactId, id);
      if (baseRevision !== undefined) {
        const liveRevision = store.revision(artifactId);
        if (baseRevision > liveRevision) return { refusal: `baseRevision ${baseRevision} is newer than the live revision ${liveRevision}` };
        if (identity > baseRevision) return { refusal: `dataset "${id}" changed since revision ${baseRevision}; read the dashboard again`, stale: true };
      }
      return { prior: descriptor as DatasetDescriptor & { source: QuerySource }, identity };
    });
    if ('refusal' in found) return { ok: false, ...found };
    const { prior, identity } = found;
    return { ok: true, publish: (raw, guard, admitted) => publish(start, scope, prior, identity, raw, guard, admitted) };
  }

  // The candidate, validated before the frame: the parsed rows and their bytes, or the error state's words and failure.
  // It never throws (P3-F): a reading that throws is refused like any invalid result, so every failure after the
  // admission writes the error state and ends the scope. P4 (W1, L246): that throw is logged with its own message under
  // `subject` (the dashboard and dataset), so a fault in the reading reads apart from bad data; the state keeps the
  // closed words.
  function candidate(prior: DatasetDescriptor, raw: RefreshRaw, subject: string): { table: ParsedDataset; bytes: Uint8Array } | { problem: string; failure: RefreshFailure } {
    if (raw.kind === 'failed') return { problem: FAILED[raw.reason], failure: FAILURE_OF[raw.reason] };
    const refused = (problem: string, failure: RefreshFailure = 'validation') => ({ problem: bounded(`the last refresh was refused: ${problem}`), failure });
    try {
      const rows = queryRowsOf(raw.result);
      if (!rows.ok) return refused(rows.problem, rows.problem === QUERY_RESULT_PROBLEMS.toolError ? 'toolError' : 'validation');
      const bytes = new TextEncoder().encode(JSON.stringify(rows.rows));
      const table = parseDataset(bytes, 'json');
      if (table instanceof DatasetError) return refused(table.reason);
      const keyProblem = prior.rowKey === undefined ? null : rowKeyProblem(table, prior.rowKey);
      if (keyProblem) return refused(keyProblem);
      return { table, bytes };
    } catch (error) {
      log(`${subject}: ${UNREADABLE}: ${error instanceof Error ? error.message : String(error)}`);
      return refused(UNREADABLE);
    }
  }

  async function publish(start: RefreshStart, scope: RefreshScope, prior: DatasetDescriptor & { source: QuerySource }, identity: number, raw: RefreshRaw, guard: RefreshGuard, admitted?: () => void): Promise<RefreshPublication> {
    const adapter = dashboardAdapterOf(store)!;
    const { artifactId } = start;
    const { id } = start.dataset;
    const made = candidate(prior, raw, `${artifactId}'s dataset "${id}"`);
    const at = now();
    const { actor } = scope;
    let recorded: ArtifactDatasetResult | undefined;
    let ref: string | null = null;
    // the final check, inside the write's savepoint and synchronous with it
    const prepare = () => {
      const held = guard();
      if (held !== 'held') throw new Discard(held, `${artifactId}'s dataset "${id}": the call's grant or operation ended before the publication (${held})`);
      const changed = () => new Discard('stale', `${artifactId}'s dataset "${id}" changed since the refresh began; nothing was published`);
      if (!store.get(artifactId)) throw changed();
      const doc = store.service.live(artifactId);
      if (legacyDashboardFiles(doc) || adapter.lastChange(artifactId, id) !== identity) throw changed();
      const current = readDataset(doc, id);
      if (current?.source.kind !== 'query' || !sameQuery(current.source, start)) throw changed();
      // last, so nothing after it refuses: from here the scope's owner holds the publication's end until `ended`
      if (!scope.admit()) throw new Discard('cancelled', `${artifactId}'s dataset "${id}": the request ended before the publication`);
      admitted?.();
    };
    const write = (op: OpScope | null) =>
      store.writeWithAssets(
        artifactId,
        actor,
        'table' in made ? [{ bytes: made.bytes, name: querySnapshotName() /* E3 panel: the sink alone mints the namespace */, mime: 'application/json', querySnapshot: true }] : [],
        (doc, refs) => {
          if ('table' in made) {
            ref = refs[0]!.ref;
            const { table } = made;
            setDataset(doc, id, { ...withoutRows(prior), source: { ...prior.source, snapshot: { ref, at } }, columns: table.columns, rows: table.rows.length, updated: { at, by: actor }, state: { status: 'ok', at } });
          } else {
            setDataset(doc, id, { ...prior, state: { status: 'error', message: made.problem, at } });
          }
        },
        {
          prepare,
          inFrame: (revision) => {
            if ('table' in made) {
              store.retainQuerySnapshots(artifactId, id, ref!, revision);
              const { table } = made;
              recorded = { status: 'dataset', artifactId, id, revision, columns: table.columns, rows: table.rows.length, ...(table.warnings.length > 0 && { warnings: table.warnings }) };
            } else {
              recorded = { status: 'dataset', artifactId, id, revision, columns: prior.columns, rows: prior.rows, ...(prior.source.snapshot === null && { notFetched: true as const }), state: { status: 'error', message: made.problem } };
            }
            op?.record(recorded);
          },
        },
      );
    let answer: ArtifactDatasetResult;
    try {
      // an agent's op answers its first durable result: one already recorded under its id is that answer, unwritten
      answer = await store.writeCommitted(async () => (scope.opId === null ? (await write(null), recorded!) : store.withOp(scope.opId, TOOL, artifactId, async (op) => (await write(op), recorded!), { actor })));
    } catch (error) {
      let end: RefreshPublication | null = null;
      if (error instanceof Discard) end = { discarded: error.why, detail: error.message };
      // the dashboard deleted since the admission: refused by the write before its prepare
      else if (error instanceof ArtifactStoreError && error.code === 'notFound') end = { discarded: 'stale', detail: `${artifactId} is gone; nothing was published` };
      scope.ended?.(end ?? { error: error instanceof Error ? error.message : String(error) });
      if (end) return end;
      throw error;
    }
    // what this publication's retention retired, at once; best effort (E3 M2 residual): a failed collection changes
    // nothing committed and never withholds the publication's end, and what it left is collected later
    if (recorded && 'table' in made) {
      try {
        store.collectRetiredAssets(artifactId);
      } catch (error) {
        log(`${artifactId}'s dataset "${id}": its retired snapshots could not be collected after the commit: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    // the failure an error state records (a replayed answer is the op's first, whatever this call brought)
    const failed = answer.state === undefined ? undefined : 'problem' in made ? made.failure : 'validation';
    const end: RefreshPublication = { published: answer, ...(failed && { failed }) };
    scope.ended?.(end);
    return end;
  }

  return { admit };
}

// A descriptor's fields a new snapshot replaces dropped, so the fetched arm is written whole.
function withoutRows(prior: DatasetDescriptor): Pick<DatasetDescriptor, 'title' | 'description' | 'rowKey'> {
  return { title: prior.title, ...(prior.description !== undefined && { description: prior.description }), ...(prior.rowKey !== undefined && { rowKey: prior.rowKey }) };
}
