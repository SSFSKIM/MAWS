// The org key's wrapped copies (DX7): one per unlock method, stored as the browser posts them, and the org's
// `key_check`, set by the first and compared with every later one, so one org never holds two keys. The hub reads
// nothing of a wrapped key but its shape and the check's equality; it never sees the key. Kept in the `Registry`'s
// storage; every operation is one synchronous step of that object, so two first-time posts that race cannot both set
// the check.
import { base64urlDecode, isBase64urlOf } from '../protocol/base64url';
import type { MemberRecord, WrappedKeyRecord } from '../protocol/identity';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS wrapped_keys (
  id TEXT PRIMARY KEY, method TEXT NOT NULL, label TEXT NOT NULL, credential TEXT UNIQUE, kdf TEXT NOT NULL,
  iv TEXT NOT NULL, wrapped TEXT NOT NULL, "check" TEXT NOT NULL, created_by TEXT NOT NULL, created TEXT NOT NULL);
`;

/** A `kdf` is the browser's description of a derivation: small. */
const KDF_LIMIT = 1024;
const encoder = new TextEncoder();
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A credential id: base64url in its one spelling, of any length but empty. */
function isCredential(value: unknown): value is string {
  if (typeof value !== 'string' || value === '' || value.length > 1024) return false;
  try {
    return base64urlDecode(value).length > 0;
  } catch {
    return false;
  }
}

export type KeyResult<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message: string };

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

  /**
   * Stores a wrapped key as posted. The first sets the org's `key_check` and `key_auth` (`setOrg`, in the same step as
   * the insert); every later one must prove the key (`authHash`, SHA-256 of its `auth`, equal to `key_auth`) before
   * anything else about the records is told, and must wrap the org's key (its `check` the org's).
   */
  add(
    member: MemberRecord,
    body: unknown,
    org: { keyCheck: string | null; keyAuth: string | null },
    authHash: string | null,
    setOrg: (check: string, auth: string) => void,
    id: string,
    now: string,
  ): KeyResult<StoredKey> {
    // Once the org has a key, the proof of holding it comes before anything else: a caller without it learns nothing,
    // not even what is wrong with the shape of what it posted. A missing or malformed `auth` has no digest.
    if (org.keyAuth !== null && org.keyAuth !== authHash) return notKeyHolder();
    const b = isObject(body) ? body : {};
    const { method, label, credential, kdf, iv, wrapped, check, auth } = b;
    const kdfText = isObject(kdf) ? JSON.stringify(kdf) : undefined;
    const valid =
      (method === 'passkey' || method === 'passphrase') &&
      typeof label === 'string' &&
      label.length >= 1 &&
      label.length <= 100 &&
      kdfText !== undefined &&
      encoder.encode(kdfText).length <= KDF_LIMIT &&
      isBase64urlOf(iv, 12) &&
      isBase64urlOf(wrapped, 48) &&
      isBase64urlOf(check, 32) &&
      isBase64urlOf(auth, 32) &&
      authHash !== null &&
      (method === 'passkey' ? isCredential(credential) : credential === undefined || credential === null);
    if (!valid) {
      return refuse(
        400,
        'bad-shape',
        'the body is {method: passkey | passphrase, label: 1 to 100 characters, credential: a passkey\'s id in base64url (none for a passphrase), kdf: an object of at most 1 KiB, iv, wrapped, check, auth: 12, 48, 32, and 32 bytes in canonical base64url}',
      );
    }
    if (org.keyCheck !== null && org.keyCheck !== check) return refuse(409, 'different-key', "this wraps another key than the org's: unlock the org's key and wrap that one");
    if (method === 'passkey' && this.sql.exec('SELECT 1 FROM wrapped_keys WHERE credential = ?', credential as string).toArray().length > 0) {
      return refuse(409, 'credential-taken', 'a wrapped key for this passkey exists; remove it first to wrap again');
    }
    const record: StoredKey = {
      id,
      method,
      label,
      credential: method === 'passkey' ? (credential as string) : null,
      kdf: kdf as Record<string, unknown>,
      iv: iv as string,
      wrapped: wrapped as string,
      check: check as string,
      created_by: member.id,
      created: now,
    };
    this.storage.transactionSync(() => {
      if (org.keyCheck === null) setOrg(record.check, authHash!);
      this.sql.exec(
        'INSERT INTO wrapped_keys (id, method, label, credential, kdf, iv, wrapped, "check", created_by, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        record.id,
        record.method,
        record.label,
        record.credential,
        kdfText,
        record.iv,
        record.wrapped,
        record.check,
        record.created_by,
        record.created,
      );
    });
    return { ok: true, value: record };
  }

  /** Removes one, for a holder of the key only, and never the org's last: the key would be lost to every browser that
   * has not kept it. */
  remove(id: string, keyAuth: string | null, authHash: string | null): KeyResult<string> {
    if (keyAuth === null || authHash !== keyAuth) return notKeyHolder();
    if (this.sql.exec('SELECT 1 FROM wrapped_keys WHERE id = ?', id).toArray().length === 0) return refuse(404, 'unknown-key', `no wrapped key ${id}`);
    if (this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM wrapped_keys').one().n <= 1) {
      return refuse(409, 'last-key', "the org's only wrapped key is never removed: add another method first");
    }
    this.sql.exec('DELETE FROM wrapped_keys WHERE id = ?', id);
    return { ok: true, value: id };
  }
}

const notKeyHolder = () => refuse(403, 'not-key-holder', "changing the org's wrapped keys takes the org key: send its auth");

const refuse = (status: number, error: string, message: string): { ok: false; status: number; error: string; message: string } => ({ ok: false, status, error, message });
