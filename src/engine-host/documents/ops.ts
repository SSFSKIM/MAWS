// The idempotency ledger (the P3-A document's Decision Log 11): `artifact_ops (opId, artifactId, tool, result, at)`,
// keyed by the tool call's tool-use id. A repeated id answers the stored result and applies nothing; a call already
// running answers the same promise. A write records its op inside its own savepoint (`OpScope.record`, from a write's
// `inFrame`), so the op row commits with the write's last row or not at all; a run that never records is recorded right
// after it settles, in the next commit.
import type { DatabaseSync } from 'node:sqlite';

export interface OpScope {
  // Writes the op row now, inside the open savepoint of the write that completes the op.
  record(result: unknown): void;
}

export class OpLedger {
  private readonly running = new Map<string, Promise<unknown>>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number,
  ) {}

  stored(opId: string): { found: true; result: unknown } | { found: false } {
    const row = this.db.prepare('SELECT result FROM artifact_ops WHERE opId = ?').get(opId) as { result: string } | undefined;
    return row ? { found: true, result: JSON.parse(row.result) as unknown } : { found: false };
  }

  // Runs `run` once per `opId`; `fresh` is false for an answer that was stored or already running. `inBatch` writes the
  // op row in a commit when `run` did not record it in its own.
  async once<R>(opId: string, tool: string, artifactId: string | null, run: (scope: OpScope) => Promise<R>, inBatch: (write: () => void) => Promise<unknown>): Promise<{ result: R; fresh: boolean }> {
    const stored = this.stored(opId);
    if (stored.found) return { result: stored.result as R, fresh: false };
    const running = this.running.get(opId);
    if (running) return { result: (await running) as R, fresh: false };
    let recorded = false;
    const write = (result: unknown) => {
      this.db.prepare('INSERT INTO artifact_ops (opId, artifactId, tool, result, at) VALUES (?, ?, ?, ?, ?)').run(opId, artifactId, tool, JSON.stringify(result ?? null), this.now());
      recorded = true;
    };
    const promise = (async () => {
      const result = await run({ record: write });
      if (!recorded) await inBatch(() => write(result));
      return result;
    })();
    this.running.set(opId, promise);
    try {
      return { result: await promise, fresh: true };
    } finally {
      this.running.delete(opId);
    }
  }
}
