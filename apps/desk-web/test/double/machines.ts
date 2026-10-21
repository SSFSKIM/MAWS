// DX7's machine records as the DX3 double serves them, and as the unit suites meet them through a stubbed fetch: one
// implementation of the hub's rules for both (desk-hub's `Registry`: `GET /api/machines`, any member's, by name; and
// `DELETE /api/machines/<name>`, an admin's, the name compared without case, `404 unknown-machine` for one it does not
// hold). Enrollment is not served: a suite puts the records it needs in place.
//
// Provisioning keys too (the provisioning-keys spec, §3): `GET /api/provisioning-keys`, any member's, every key by
// creation with the machines enrolled through it now; `POST`, an admin's, checked against the hub's bounds (`400
// bad-shape` naming the field) and answered with the secret once; `DELETE /api/provisioning-keys/<id>`, an admin's,
// keeping the first revocation's time, `404 unknown-key` for one it does not hold. Redemption is not served:
// `enrollThrough` puts a machine in place as enrolled through a key, counting a use.
import {
  base64urlEncode,
  isMachineName,
  machineNameKey,
  MAX_OFFLINE_REVOKE_S,
  MAX_PROVISIONING_KEY_TTL_S,
  MAX_PROVISIONING_KEY_USES,
  MIN_OFFLINE_REVOKE_S,
  MIN_PROVISIONING_KEY_TTL_S,
  PROVISIONING_KEY_TTL_S,
  PROVISIONING_KEYS_PATH,
  type MachineRecord,
  type MachineState,
  type MemberRecord,
  type ProvisioningKeyRecord,
} from 'desk-hub/protocol';
import type { Answer } from './org-keys';

const MACHINE_PATH = /^\/api\/machines\/([^/]+)$/;
const KEY_PATH = new RegExp(`^${PROVISIONING_KEYS_PATH}/([^/]+)$`);
const whole = (value: unknown, min: number, max: number) => typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
const badShape = (field: string, rule: string): Answer => ({ status: 400, body: { error: 'bad-shape', message: `${field} must be ${rule}` } });

/** A key as the double keeps it: the record without its machines, which are read from the machine records. */
export type KeyRow = Omit<ProvisioningKeyRecord, 'machines'>;

export function machineRecord(name: string, state: MachineState = 'active'): MachineRecord {
  return {
    name,
    client_id: `${name}.access`,
    token_name: `desk-org-${name}`,
    state,
    enrollment: `e-${name}`,
    created: '2026-10-15T00:00:00.000Z',
    confirmed: state === 'active' ? '2026-10-15T00:01:00.000Z' : null,
  };
}

export class MachinesDouble {
  machines: MachineRecord[] = [];
  /** The names each `DELETE` asked for, in order, whatever it was answered. */
  readonly removals: string[] = [];
  keys: KeyRow[] = [];
  /** The bodies each key's `POST` carried, in order, whatever it was answered. */
  readonly keyRequests: unknown[] = [];
  /** The ids each key's `DELETE` asked for, in order, whatever it was answered. */
  readonly keyRevocations: string[] = [];
  /** The key each machine was enrolled through, by the machine's name. */
  private readonly enrolledThrough = new Map<string, string>();
  private nextKey = 0;

  add(name: string, state: MachineState = 'active'): void {
    this.machines.push(machineRecord(name, state));
  }

  /** A key as an admin made it at `created` (an ISO time), unused; `fields` override the rest. */
  addKey(label: string, prefix: string, fields: Partial<KeyRow> = {}): KeyRow {
    const created = fields.created ?? '2026-10-21T00:00:00.000Z';
    const key: KeyRow = {
      id: (++this.nextKey).toString(16).padStart(32, '0'),
      label,
      prefix,
      created_by: '4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c',
      created,
      expires: new Date(Date.parse(created) + PROVISIONING_KEY_TTL_S * 1000).toISOString(),
      max_uses: null,
      uses: 0,
      offline_revoke_s: null,
      revoked: null,
      ...fields,
    };
    this.keys.push(key);
    return key;
  }

  /** A machine enrolled through the key `id`, as a redemption of its secret makes it: one use counted. */
  enrollThrough(id: string, name: string, state: MachineState = 'pending'): void {
    const key = this.keys.find((k) => k.id === id);
    if (!key) throw new Error(`the double holds no key ${id}`);
    this.add(name, state);
    this.enrolledThrough.set(name, id);
    key.uses += 1;
  }

  /** Every key by creation, with the machines enrolled through it that the double still holds. */
  keyRecords(): ProvisioningKeyRecord[] {
    const order = (a: KeyRow, b: KeyRow) => (a.created === b.created ? (a.id < b.id ? -1 : 1) : a.created < b.created ? -1 : 1);
    return [...this.keys].sort(order).map((key) => ({
      ...key,
      machines: this.machines
        .filter((m) => this.enrolledThrough.get(m.name) === key.id)
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((m) => ({ name: m.name, state: m.state })),
    }));
  }

  private createKey(member: MemberRecord, body: unknown): Answer {
    this.keyRequests.push(body);
    if (member.role !== 'admin') return { status: 403, body: { error: 'not-admin' } };
    const b = (typeof body === 'object' && body !== null && !Array.isArray(body) ? body : {}) as Record<string, unknown>;
    const { label, prefix, ttl_s = PROVISIONING_KEY_TTL_S, max_uses = null, offline_revoke_s = null } = b;
    if (typeof label !== 'string' || label.length < 1 || label.length > 100) return badShape('label', '1 to 100 characters');
    if (typeof prefix !== 'string' || !isMachineName(prefix)) return badShape('prefix', 'an admitted machine name');
    if (!whole(ttl_s, MIN_PROVISIONING_KEY_TTL_S, MAX_PROVISIONING_KEY_TTL_S)) return badShape('ttl_s', `whole seconds from ${MIN_PROVISIONING_KEY_TTL_S} to ${MAX_PROVISIONING_KEY_TTL_S}`);
    if (!(max_uses === null || whole(max_uses, 1, MAX_PROVISIONING_KEY_USES))) return badShape('max_uses', `null or 1 to ${MAX_PROVISIONING_KEY_USES}`);
    if (!(offline_revoke_s === null || whole(offline_revoke_s, MIN_OFFLINE_REVOKE_S, MAX_OFFLINE_REVOKE_S))) {
      return badShape('offline_revoke_s', `null or whole seconds from ${MIN_OFFLINE_REVOKE_S} to ${MAX_OFFLINE_REVOKE_S}`);
    }
    const now = Date.now();
    const key = this.addKey(label, prefix, {
      created_by: member.id,
      created: new Date(now).toISOString(),
      expires: new Date(now + (ttl_s as number) * 1000).toISOString(),
      max_uses: max_uses as number | null,
      offline_revoke_s: offline_revoke_s as number | null,
    });
    return { status: 201, body: { key: { ...key, machines: [] }, token: base64urlEncode(crypto.getRandomValues(new Uint8Array(32))) } };
  }

  private revokeKey(member: MemberRecord, id: string): Answer {
    this.keyRevocations.push(id);
    if (member.role !== 'admin') return { status: 403, body: { error: 'not-admin' } };
    const key = this.keys.find((k) => k.id === id);
    if (!key) return { status: 404, body: { error: 'unknown-key' } };
    key.revoked ??= new Date().toISOString();
    return { status: 200, body: { revoked: id } };
  }

  handle(member: MemberRecord, method: string, path: string, body?: unknown): Answer | null {
    if (path === PROVISIONING_KEYS_PATH) {
      if (method === 'GET') return { status: 200, body: { keys: this.keyRecords() } };
      return method === 'POST' ? this.createKey(member, body) : null;
    }
    const key = KEY_PATH.exec(path);
    if (key) return method === 'DELETE' ? this.revokeKey(member, decodeURIComponent(key[1])) : null;
    if (path === '/api/machines') return method === 'GET' ? { status: 200, body: { machines: [...this.machines].sort((a, b) => (a.name < b.name ? -1 : 1)) } } : null;
    const match = MACHINE_PATH.exec(path);
    if (!match || method !== 'DELETE') return null;
    const name = decodeURIComponent(match[1]);
    this.removals.push(name);
    if (member.role !== 'admin') return { status: 403, body: { error: 'not-admin' } };
    const found = this.machines.find((m) => machineNameKey(m.name) === machineNameKey(name));
    if (!found) return { status: 404, body: { error: 'unknown-machine' } };
    this.machines = this.machines.filter((m) => m !== found);
    this.enrolledThrough.delete(found.name);
    return { status: 200, body: { revoked: found.name } };
  }

  /** A `fetch` serving the endpoints alone, as `member`, for the unit suites. */
  fetch(member: MemberRecord): typeof fetch {
    return async (input, init) => {
      const path = new URL(String(input), 'http://double').pathname;
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
      const answer = this.handle(member, init?.method ?? 'GET', path, body) ?? { status: 404, body: { error: 'not-found' } };
      return new Response(JSON.stringify(answer.body), { status: answer.status, headers: { 'content-type': 'application/json' } });
    };
  }
}
