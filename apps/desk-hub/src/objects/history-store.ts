// A project's history attestations (O14 M4, Interfaces §D), kept by its `Project` object in SQLite beside its log: the
// newest per writer. The record's signer and binding are checked before it reaches here (`Project.keepAttestation`);
// this keeps the rule on `upTo` alone, in one synchronous step, so two posts racing can't both replace one record.
import { canonicalize, type HistoryAttestation, type Signed } from 'org-protocol';

const SCHEMA = 'CREATE TABLE IF NOT EXISTS attestations (writer TEXT PRIMARY KEY, up_to INTEGER NOT NULL, record TEXT NOT NULL)';

/**
 * What a record came to: `stored` (the writer's first, at a higher `upTo` than the one held, or at the same `upTo` as a
 * held record the caller judged to verify no more), `held` (that very record was held already), `stale` (one at the
 * same or a higher `upTo` is held; the first at an `upTo` stands while it verifies, so a later claim over a name nobody
 * owns can't replace an earlier one).
 */
export type Kept = 'stored' | 'held' | 'stale';

export class HistoryStore {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  /** The writer's record, if one is held. */
  held(writer: string): Signed<HistoryAttestation> | undefined {
    const row = this.storage.sql.exec<{ record: string }>('SELECT record FROM attestations WHERE writer = ?', writer).toArray()[0];
    return row === undefined ? undefined : (JSON.parse(row.record) as Signed<HistoryAttestation>);
  }

  /**
   * Keeps `record` by the rule above. `lapsed` is a held record the caller found no longer verifying (its key revoked
   * since, say): it gives way to one at the same `upTo`, if it is still the one held.
   */
  keep(record: Signed<HistoryAttestation>, lapsed?: Signed<HistoryAttestation>): Kept {
    const { writer, upTo } = record.body;
    const held = this.storage.sql.exec<{ up_to: number; record: string }>('SELECT up_to, record FROM attestations WHERE writer = ?', writer).toArray()[0];
    if (held !== undefined && held.up_to >= upTo) {
      const was = canonicalize(JSON.parse(held.record));
      if (was === canonicalize(record)) return 'held';
      if (held.up_to > upTo || lapsed === undefined || was !== canonicalize(lapsed)) return 'stale';
    }
    this.storage.sql.exec('INSERT INTO attestations (writer, up_to, record) VALUES (?, ?, ?) ON CONFLICT (writer) DO UPDATE SET up_to = excluded.up_to, record = excluded.record', writer, upTo, JSON.stringify(record));
    return 'stored';
  }

  /** Every writer's record, by writer. */
  records(): Signed<HistoryAttestation>[] {
    return this.storage.sql
      .exec<{ record: string }>('SELECT record FROM attestations ORDER BY writer')
      .toArray()
      .map((row) => JSON.parse(row.record) as Signed<HistoryAttestation>);
  }
}
