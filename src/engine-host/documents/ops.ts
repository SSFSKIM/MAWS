// The idempotency ledger (the P3-A document's Decision Log 11 and 26c): `artifact_ops (opId, artifactId, tool, result,
// at)`, keyed by the tool call's tool-use id. A repeated id answers the stored result and applies nothing.
//
// A mutating run records its op inside the savepoint of the write that commits it (`OpScope.record`, called from a
// write's `inFrame` or a store operation's `inFrame` seam), so the op row commits with the write or not at all; a
// mutating run that settles without recording fails, loudly, rather than leave a window where the write is durable and
// its op is not. Only a read-only run (`readOnly`) has its row written in the next commit after it settles.
//
// A retry of an op still running waits for the original's outcome, which settles only once the original's op row has
// committed (or its commit failed, which rejects the retry too); the open batch's rows are visible on the shared
// connection before they commit, so the stored row is consulted only when nothing is running.
import type { DatabaseSync } from 'node:sqlite';

export interface OpScope {
  // Writes the op row now. Called inside the savepoint of the write that completes the op; anywhere else it throws.
  record(result: unknown): void;
}

export interface OpLedgerDeps {
  db: DatabaseSync;
  now: () => number;
  frameOpen: () => boolean; // a write's savepoint is open in the batch
  whenCommitted: () => Promise<void>; // settles when the open batch commits, rejects when it is lost
  inBatch: (write: () => void) => Promise<unknown>; // a savepoint of its own, answered after its commit
}

export class OpLedger {
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(private readonly deps: OpLedgerDeps) {}

  stored(opId: string): { found: true; result: unknown } | { found: false } {
    const row = this.deps.db.prepare('SELECT result FROM artifact_ops WHERE opId = ?').get(opId) as { result: string } | undefined;
    return row ? { found: true, result: JSON.parse(row.result) as unknown } : { found: false };
  }

  // Runs `run` once per `opId` (every time without one: nothing to record, but the recording rule still holds); `fresh`
  // is false for an answer that was stored or already running.
  async once<R>(opId: string | null, tool: string, artifactId: string | null, run: (scope: OpScope) => Promise<R>, readOnly: boolean): Promise<{ result: R; fresh: boolean }> {
    if (opId) {
      const running = this.running.get(opId);
      if (running) return { result: (await running) as R, fresh: false };
      const stored = this.stored(opId);
      if (stored.found) return { result: stored.result as R, fresh: false };
    }
    const named = `${tool} (${opId ? `op ${opId}` : 'no op id'})`;
    const write = (result: unknown) => {
      if (opId) this.deps.db.prepare('INSERT INTO artifact_ops (opId, artifactId, tool, result, at) VALUES (?, ?, ?, ?, ?)').run(opId, artifactId, tool, JSON.stringify(result ?? null), this.deps.now());
    };
    let committed: Promise<void> | null = null;
    const record = (result: unknown) => {
      if (!this.deps.frameOpen()) throw new Error(`${named} recorded its op outside a write's savepoint: record it inside the savepoint of the write that commits it`);
      write(result);
      committed = this.deps.whenCommitted();
      committed.catch(() => {}); // awaited below once the run settles; a run that fails first carries its own error
    };
    const promise = (async () => {
      const result = await run({ record });
      if (committed) {
        await committed;
        if (opId && !this.stored(opId).found) throw new Error(`${named}'s op row was taken back with its write, yet the run succeeded`);
      } else if (readOnly) {
        if (opId) await this.deps.inBatch(() => write(result));
      } else {
        throw new Error(`${named} never recorded its op in the savepoint of the write that commits it (a mutating run must; a read-only one says readOnly)`);
      }
      return result;
    })();
    if (opId) this.running.set(opId, promise);
    try {
      return { result: await promise, fresh: true };
    } finally {
      if (opId) this.running.delete(opId);
    }
  }
}
