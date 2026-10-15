// The document kind's host-side state between an agent's tool calls (P3-B's M7; D6, D7 of
// docs/doperpowers/plans/2026-10-12-p3-b-documents.md; Decision Log 20):
//
// - The doc a session's batches are written on is the session's host replica of the artifact (A's `writeAs` with the
//   session as actor, which records the tool's op in the write's own savepoint, A's Decision Log 26c). A read reaches
//   the same replica through A's `readAs` (`onSessionReplica`), so it warms the block index the
//   writer plans with: the range it renders at once, every other block in slices off the host's loop (`warmInSlices`).
//   The replica lives as long as the document is loaded, which A keeps while the session's agent replica is attached.
// - A session's views (`DocumentViews`): for each revision the session has seen of a replica (a read, its own write,
//   a refusal that showed it the targets' current text), the block index's epoch then and the block ids then. A batch's
//   `baseRevision` maps to the latest view at or before it: the epoch the writer validates targets against, the ids a
//   restore since then may have removed. A revision the session never saw on this replica (another process, a reload)
//   maps to no view, and every replace_block, delete and set_cell target counts as changed since.
// - `sinceRevision`: the blocks the changes since a revision touched, from the store's attribution rows between the two
//   revisions, and the blocks deleted since, from the view at that revision or the log rebuilt to it; beyond both (the
//   revision is older than the head checkpoint) the read is whole.
import { DocIndex, type TopBlock } from '@artifacts/document/block-index';
import { blockIdsOf, deletedSince, touchedBlocks } from '@artifacts/document/since';
import { applyV1, applyV2, decodeMap, newDoc, type Doc } from '@artifacts/yjs';
import type { Actor } from '@shared/artifacts/actor';
import type { ArtifactStore } from '../store';

const VIEWS_KEPT = 8; // per replica: the session's recent revisions
const WARM_SLICE_MS = 4;

export interface View {
  revision: number;
  epoch: number;
  ids: ReadonlySet<string>;
}

export class DocumentViews {
  private readonly byDoc = new WeakMap<Doc, View[]>();

  /** The session now knows `doc` as it is, at `revision`. */
  record(doc: Doc, revision: number): View {
    const view: View = { revision, epoch: DocIndex.of(doc).epoch, ids: blockIdsOf(doc) };
    const views = (this.byDoc.get(doc) ?? []).filter((kept) => kept.revision !== revision);
    views.push(view);
    views.sort((a, b) => a.revision - b.revision);
    this.byDoc.set(doc, views.slice(-VIEWS_KEPT));
    return view;
  }

  /** The view at exactly `revision`. */
  at(doc: Doc, revision: number): View | undefined {
    return this.byDoc.get(doc)?.find((view) => view.revision === revision);
  }

  /** The latest view at or before `revision` (what a batch from that base is validated against). */
  base(doc: Doc, revision: number): View | undefined {
    return this.byDoc.get(doc)?.findLast((view) => view.revision <= revision);
  }
}

/**
 * Runs `use` on the session's host replica of the artifact (a synchronous mirror of the live doc, the one its batches
 * are written on) through A's `readAs`, which opens no write frame and refuses an edit, and answers what `use`
 * returned with the live revision. On a read-only store `use` gets a scratch copy instead.
 */
export async function onSessionReplica<T>(store: ArtifactStore, artifactId: string, actor: Actor, use: (doc: Doc, revision: number) => T): Promise<T> {
  if (store.storage.readOnly) {
    const { revision, state } = store.service.readState(artifactId);
    const doc = newDoc();
    try {
      applyV2(doc, state);
      return use(doc, revision);
    } finally {
      doc.destroy();
    }
  }
  return store.service.readAs(artifactId, actor, (doc) => use(doc, store.service.revision(artifactId)));
}

const warming = new WeakSet<Doc>();

/** Warms every block of `doc`'s index a few milliseconds at a time, one slice per event-loop turn, until all are. */
export function warmInSlices(doc: Doc, sliceMs = WARM_SLICE_MS): void {
  if (warming.has(doc)) return;
  warming.add(doc);
  const step = () => {
    const until = performance.now() + sliceMs;
    let done = true;
    try {
      done = DocIndex.of(doc).warm(() => performance.now() >= until);
    } catch {
      // the replica was dropped (the document unloaded or evicted): nothing left to warm
    }
    if (done) warming.delete(doc);
    else setImmediate(step);
  };
  setImmediate(step);
}

/** Whether `doc` still has blocks to warm. */
export const isWarming = (doc: Doc): boolean => warming.has(doc);

/**
 * What changed in `doc` (the session's replica, at the live revision) since `since`: the top-level blocks the changes
 * touched and the block ids deleted; null when the host cannot tell (the revision is older than the head checkpoint and
 * the session holds no view of it), and the read shows its whole range.
 */
export function changesSince(store: ArtifactStore, artifactId: string, doc: Doc, since: number, views: DocumentViews): { touched: Set<TopBlock>; deleted: string[] } | null {
  const revision = store.service.revision(artifactId);
  if (since >= revision) return { touched: new Set(), deleted: [] };
  const before = views.at(doc, since)?.ids ?? idsAtRevision(store, artifactId, since);
  if (!before) return null;
  const map = decodeMap(store.attributions(artifactId, since + 1, revision));
  return { touched: touchedBlocks(doc, map.inserts, map.deletes), deleted: deletedSince(doc, before) };
}

/** The block ids of the document at `revision`, rebuilt from the head checkpoint and the log; null before the head. */
function idsAtRevision(store: ArtifactStore, artifactId: string, revision: number): Set<string> | null {
  const stored = store.storage.load(artifactId);
  if (stored.head && stored.head.seq > revision) return null;
  const doc = newDoc();
  try {
    if (stored.head) applyV2(doc, stored.head.state);
    for (const row of stored.updates) if (row.seq <= revision) applyV1(doc, row.bytes);
    return blockIdsOf(doc);
  } finally {
    doc.destroy();
  }
}
