// The `artifact_edit` batch as the patch writer takes it and answers it (§4.4 [binding]; D14's reasons; X25's
// document part): the ops, one result line per op, the provenance carries of moves and type changes, the threads a
// batch left without text, and the refusals, each machine-readable so the tool can answer the agent precisely.
import type { Carry as AttributionCarry } from '../yjs';

export type Op =
  | { op: 'replace_text'; block?: string; old: string; new: string; all?: boolean }
  | { op: 'replace_block'; id: string; markdown: string }
  | { op: 'insert'; after?: string; before?: string; markdown: string }
  | { op: 'delete'; id: string }
  | { op: 'move'; id: string; after: string | null }
  | { op: 'set_cell'; table: string; row: number; col: number; markdown: string };

export interface OpResult {
  line: string;
  target: string;
  newIds: string[];
}

export type Slot = [client: number, clock: number];

/**
 * A move or a type change: the content at `from` (pre-batch item ids, one per character or element) now lives at `to`,
 * pairwise, so provenance keeps its authorship (A's `carryAttribution` reads `kind`, `from` and `to`). The rest serves
 * the host's adapter: `source` and `node` are the block's old and new node items (the duplicate rule keeps the later
 * copy of a block two writers moved), `blocks` pairs each old textblock item with its new one (forwarding an edit that
 * arrives naming only its parent).
 */
export interface Carry extends AttributionCarry {
  blockId: string;
  source?: Slot;
  node?: Slot;
  blocks?: Array<[Slot, Slot]>;
}

export interface Applied {
  results: OpResult[];
  carries: Carry[];
  /** Open threads whose mark no live text carries after the batch (derived; the threads map is never written). */
  orphaned: string[];
  /** With `answering`: the thread and the message the tool posts into it (the result lines). */
  answer: { threadId: string; body: string } | null;
}

export interface ApplyOptions {
  /**
   * The block index's epoch at the agent's read (`DocIndex.of(doc).epoch`): a `replace_block`, `delete` or `set_cell`
   * whose target changed after it is refused as stale. `replace_text` is validated by its quote alone (parent
   * Decision Log 34), `insert` and `move` by their anchors existing. Without it nothing is stale.
   */
  since?: number;
  /** Where the humans' carets are (from awareness): a move never re-inserts a block holding one. */
  carets?: ReadonlyArray<{ blockId: string; pos?: number }>;
  /** Block ids a restore removed since the read: a target among them is refused as `removedByRestore`. */
  restoredAway?: ReadonlySet<string>;
  /**
   * At most this many top-level blocks per tab after the batch: a batch that would leave a tab with more, and more than
   * it had, is refused `invalid` (the tools' limit; a tab already over it may still be edited without growing it).
   */
  blocksPerTab?: number;
  /** A thread the batch answers: it must exist; the answer is returned for the tool to post. */
  answering?: string;
  /** The transaction's origin. */
  origin?: unknown;
  /** Mints the ids of the blocks the batch writes (deterministic in tests). */
  generateID?: () => string;
  /** S5's whitespace merge of word hunks (A5); off only to show what it prevents. */
  mergeWhitespace?: boolean;
}

export type EditRefusal =
  | { reason: 'staleTargets'; blocks: Array<{ id: string; text: string }> }
  | { reason: 'notUnique'; opIndex: number; candidates: Array<{ id: string; text: string; matches: number }> }
  | { reason: 'notFound'; opIndex: number; target: string; candidates: Array<{ id: string; text: string }> }
  | { reason: 'removedByRestore'; blocks: string[] }
  | { reason: 'retry'; opIndex: number; blocks: string[] }
  | { reason: 'invalid'; opIndex: number; message: string };

/** A refused batch: nothing of it was written. */
export class EditError extends Error {
  constructor(
    readonly refusal: EditRefusal,
    message: string,
  ) {
    super(message);
    this.name = 'EditError';
  }

  get reason(): EditRefusal['reason'] {
    return this.refusal.reason;
  }
}
