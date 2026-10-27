// Provisioning keys (docs/doperpowers/specs/2026-10-21-desk-provisioning-keys-design.md §1, §3): an admin's reusable,
// revocable credential that enrolls machines under a name prefix until it expires, is revoked, or is used up. The hub
// keeps SHA-256 of its secret, never the secret; the browser builds the code around it with the org key, which the hub
// never sees. Kept in the `Registry`'s storage beside the enrollments the key makes (`enrollments.key`); redemption
// through a key is the Registry's (`redeem`), since it reserves a machine's name in the same step as the use it counts.
import {
  isMachineName,
  MAX_OFFLINE_REVOKE_S,
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_OFFLINE_REVOKE_S,
  MIN_PROVISIONING_KEY_TTL_S,
  PROVISIONING_KEY_TTL_S,
  type MachineState,
  type MemberRecord,
  type ProvisioningKeyRecord,
} from '../protocol/identity';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS provisioning_keys (
  id TEXT PRIMARY KEY, secret_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL, prefix TEXT NOT NULL,
  created_by TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
  max_uses INTEGER, uses INTEGER NOT NULL DEFAULT 0,
  offline_revoke_s INTEGER, revoked TEXT);
`;

const COLUMNS = 'id, label, prefix, created_by, created, expires, max_uses, uses, offline_revoke_s, revoked';
/** A key as stored, without the machines it enrolled. */
export type KeyRow = Omit<ProvisioningKeyRecord, 'machines' | 'delegation'>;

const whole = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/** A key's request, checked (`ttl_s` defaults to 90 days, the others to null); or a refusal's message naming the first
 * field it fails on and the field's rule. */
export function checkRequest(body: unknown): { ok: true; value: { label: string; prefix: string; ttl_s: number; max_uses: number | null; offline_revoke_s: number | null } } | { ok: false; message: string } {
  const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
  const refuse = (field: string, rule: string) => ({ ok: false as const, message: `${field} must be ${rule}` });
  const { label, prefix, ttl_s = PROVISIONING_KEY_TTL_S, max_uses = null, offline_revoke_s = null } = b;
  if (typeof label !== 'string' || label.length < 1 || label.length > 100) return refuse('label', '1 to 100 characters');
  if (typeof prefix !== 'string' || !isMachineName(prefix)) return refuse('prefix', 'an admitted machine name (letters, digits, ".", "_", "-", starting with a letter or digit, at most 63 characters, not hub or legacy)');
  if (!whole(ttl_s, MIN_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_TTL_S)) return refuse('ttl_s', `whole seconds from ${MIN_PROVISIONING_KEY_TTL_S} to ${MAX_PROVISIONING_KEY_TTL_S}`);
  if (!(max_uses === null || whole(max_uses, 1, MAX_PROVISIONING_KEY_USES))) return refuse('max_uses', `null or 1 to ${MAX_PROVISIONING_KEY_USES}`);
  if (!(offline_revoke_s === null || whole(offline_revoke_s, MIN_OFFLINE_REVOKE_S, MAX_OFFLINE_REVOKE_S))) {
    return refuse('offline_revoke_s', `null or whole seconds from ${MIN_OFFLINE_REVOKE_S} to ${MAX_OFFLINE_REVOKE_S}`);
  }
  return { ok: true, value: { label, prefix, ttl_s, max_uses, offline_revoke_s } };
}

export class ProvisioningKeys {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  /** Stores a checked request as a key made now by `member`, its secret kept as `secretHash`. */
  add(member: MemberRecord, request: Extract<ReturnType<typeof checkRequest>, { ok: true }>['value'], id: string, secretHash: string, now: number): ProvisioningKeyRecord {
    const row: KeyRow = {
      id,
      label: request.label,
      prefix: request.prefix,
      created_by: member.id,
      created: new Date(now).toISOString(),
      expires: new Date(now + request.ttl_s * 1000).toISOString(),
      max_uses: request.max_uses,
      uses: 0,
      offline_revoke_s: request.offline_revoke_s,
      revoked: null,
    };
    this.sql.exec(
      `INSERT INTO provisioning_keys (secret_hash, ${COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      secretHash,
      row.id,
      row.label,
      row.prefix,
      row.created_by,
      row.created,
      row.expires,
      row.max_uses,
      row.uses,
      row.offline_revoke_s,
      row.revoked,
    );
    return { ...row, machines: [] };
  }

  /** The key whose secret hashes to `secretHash`, if any. */
  bySecret(secretHash: string): KeyRow | undefined {
    return this.sql.exec<KeyRow>(`SELECT ${COLUMNS} FROM provisioning_keys WHERE secret_hash = ?`, secretHash).toArray()[0];
  }

  /** Counts one enrollment made through the key; answers which use it was (the count after it). */
  use(id: string): number {
    this.sql.exec('UPDATE provisioning_keys SET uses = uses + 1 WHERE id = ?', id);
    return this.sql.exec<{ uses: number }>('SELECT uses FROM provisioning_keys WHERE id = ?', id).one().uses;
  }

  /** Every key by creation, with the machines enrolled through it now (pending or active). */
  list(): ProvisioningKeyRecord[] {
    const enrolled = new Map<string, Array<{ name: string; state: MachineState }>>();
    for (const m of this.sql
      .exec<{ key: string; name: string; state: MachineState }>('SELECT e.key AS key, m.name AS name, m.state AS state FROM machines m JOIN enrollments e ON e.id = m.enrollment WHERE e.key IS NOT NULL ORDER BY m.name')
      .toArray()) {
      const list = enrolled.get(m.key) ?? [];
      list.push({ name: m.name, state: m.state });
      enrolled.set(m.key, list);
    }
    return this.sql
      .exec<KeyRow>(`SELECT ${COLUMNS} FROM provisioning_keys ORDER BY created, id`)
      .toArray()
      .map((row) => ({ ...row, machines: enrolled.get(row.id) ?? [] }));
  }

  /** Marks the key revoked from `at`, keeping an earlier revocation's time; false when there is no such key. */
  revoke(id: string, at: string): boolean {
    return this.sql.exec('UPDATE provisioning_keys SET revoked = COALESCE(revoked, ?) WHERE id = ?', at, id).rowsWritten > 0;
  }

  /** Whether any key was made (a key's code carries the org id, so a key is built on it). */
  any(): boolean {
    return this.sql.exec('SELECT 1 FROM provisioning_keys LIMIT 1').toArray().length > 0;
  }
}
