// The org key's wrapped copies (DX7): one per unlock method, as browsers posted them while desk phase 1 served
// `POST /api/org/keys`, and the org's `key_check`. Since O14 M5b the hub adds and removes none: it lists what it holds
// until the org state retires the key, and then purges every copy (M5a). It never saw the key. Kept in the `Registry`'s
// storage.
import type { WrappedKeyRecord } from '../protocol/identity';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wrapped_keys (
  id TEXT PRIMARY KEY, method TEXT NOT NULL, label TEXT NOT NULL, credential TEXT UNIQUE, kdf TEXT NOT NULL,
  iv TEXT NOT NULL, wrapped TEXT NOT NULL, "check" TEXT NOT NULL, created_by TEXT NOT NULL, created TEXT NOT NULL);
`;

/** A `WrappedKeyRecord` as the object hands it to the Worker: `kdf` typed loosely, since the recursive JSON type defeats Durable Object RPC's typing. */
export type StoredKey = Omit<WrappedKeyRecord, 'kdf'> & { kdf: Record<string, unknown> };
type Row = Omit<WrappedKeyRecord, 'kdf'> & { kdf: string };

export class OrgKeys {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  list(): StoredKey[] {
    return this.sql
      .exec<Row>('SELECT id, method, label, credential, kdf, iv, wrapped, "check", created_by, created FROM wrapped_keys ORDER BY created, id')
      .toArray()
      .map((row) => ({ ...row, kdf: JSON.parse(row.kdf) as Record<string, unknown> }));
  }

  /** Deletes every copy, the last included: the purge on the org state's word (O14 M5a), the one way to none. */
  purge(): void {
    this.sql.exec('DELETE FROM wrapped_keys');
  }
}
