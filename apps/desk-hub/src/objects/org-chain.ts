// The org's signed state (RL5; O11 M3) as the Registry keeps it, in the Registry's own storage as OrgKeys and
// ProvisioningKeys are: the hash-chained versions, the root transitions the recovery key signed, and the device pairing
// exchange's pending entries. Revocations live in the state itself (RL5's `revoked`, RL DL 24), each checked against
// its predecessor by the package, so the hub keeps no record of its own beside the chain. The hub's checks are the protocol
// package's, a courtesy (RL §5.5): it refuses early what a machine would refuse, and nothing it accepts confers
// authority.
//
// After each accepted state, in the same transaction, the hub's projections of the head are rebuilt from it:
//   - `members`, the Registry's table, by which Access identities are admitted (email → member id, with the role);
//   - `devices`: device id → member and class, and the Access client id a device principal may get (U9, M7), kept
//     across rebuilds while the device stays its member's;
//   - `state_machines`: the listed machines by ref, with name, key and owners (P5 DL 21).
// A push subscription bound to a device (the Registry's `push_subscriptions`, O11 M4) is that device's keys', not its
// id's: it is dropped in the same step once the head no longer lists, for its member, a device of that id with those
// keys, so a replacement under the id, or the id listed again after a removal, has none until it subscribes itself.
// Before any state, the bootstrap admin `ensureOrg` made is the one member, so the owner is admitted as before.
//
// A state is verified against the head read before the verification's awaits, and committed only if that is still the
// head, so a successor that loses a race is refused `not-head` and its writer signs again on the new head (RL §5.2).
// It is verified against the root transitions held then too, and committed only while they are still all the chain
// holds: a transition accepted meanwhile changes which roots sign without moving the head, so the successor is verified
// again against the set that now stands (a recovery fences the old root at once), up to VERIFY_ROUNDS times.
import {
  canonicalize,
  isBase64urlOf,
  isDevice,
  NO_CERTIFICATES,
  verifyGenesis,
  verifySuccessor,
  verifyTransition,
  type Device,
  type OrgState,
  type RootTransition,
  type Signed,
  type SignedOrgState,
} from 'org-protocol';
import { MAX_PENDING_DEVICES, PENDING_DEVICE_TTL_S, type MemberId, type MemberRecord, type OrgStateView, type PendingDevice, type PendingDeviceRequest } from '../protocol/identity';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS org_states (version INTEGER PRIMARY KEY, body TEXT NOT NULL, accepted TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS org_transitions (body TEXT PRIMARY KEY, from_version INTEGER NOT NULL, accepted TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, member TEXT NOT NULL, class TEXT NOT NULL, access_client_id TEXT UNIQUE);
CREATE TABLE IF NOT EXISTS state_machines (ref TEXT PRIMARY KEY, name TEXT NOT NULL, pub TEXT NOT NULL, owners TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending_devices (
  member TEXT NOT NULL, device TEXT NOT NULL, body TEXT NOT NULL, created TEXT NOT NULL, expires TEXT NOT NULL,
  PRIMARY KEY (member, device));
`;

/** About how much of the chain one `?since=` answer carries (at least one state). */
const CHAIN_PAGE_BYTES = 1024 * 1024;
const MAX_DEVICE_ID = 128;
/** How many times a successor is verified when root transitions land under its verification, before `503 busy`. */
const VERIFY_ROUNDS = 3;
const PENDING_FIELDS = ['deviceId', 'class', 'keyStorage', 'channelPub', 'stepUpPub', 'passkey', 'mac'];

/** A refusal for the Worker to send, with DX7's `{error, message?}`. */
export type Refused = { ok: false; status: number; error: string; message?: string };
type Outcome<T> = { ok: true; value: T } | Refused;
const refused = (status: number, error: string, message?: string): Refused => ({ ok: false, status, error, ...(message ? { message } : {}) });
const iso = (ms: number) => new Date(ms).toISOString();
const notMember = () => refused(403, 'not-a-member', 'the org state no longer lists you');

/** What an accepted state changed beyond the chain: its version, and the members it dropped. */
export type Accepted = { version: number; removed: MemberId[] };

export class OrgChain {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
  }

  private get sql() {
    return this.storage.sql;
  }

  /** Whether any state was accepted. */
  any(): boolean {
    return this.sql.exec('SELECT 1 FROM org_states LIMIT 1').toArray().length > 0;
  }

  head(): SignedOrgState | null {
    const row = this.sql.exec<{ body: string }>('SELECT body FROM org_states ORDER BY version DESC LIMIT 1').toArray()[0];
    return row ? (JSON.parse(row.body) as SignedOrgState) : null;
  }

  private headVersion(): number {
    return this.sql.exec<{ v: number | null }>('SELECT MAX(version) AS v FROM org_states').one().v ?? 0;
  }

  private transitionCount(): number {
    return this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM org_transitions').one().n;
  }

  transitions(): Signed<RootTransition>[] {
    return this.sql.exec<{ body: string }>('SELECT body FROM org_transitions ORDER BY from_version, accepted, body').toArray().map((r) => JSON.parse(r.body) as Signed<RootTransition>);
  }

  /** The head, the transitions and the certificates; with `since`, the chain after that version too, paged. */
  view(since?: number): OrgStateView {
    const base: OrgStateView = { head: this.head(), transitions: this.transitions(), certificates: NO_CERTIFICATES };
    if (since === undefined) return base;
    const chain: SignedOrgState[] = [];
    let bytes = 0;
    let last = since;
    for (const row of this.sql.exec<{ version: number; body: string }>('SELECT version, body FROM org_states WHERE version > ? ORDER BY version', since)) {
      if (chain.length > 0 && bytes + row.body.length > CHAIN_PAGE_BYTES) break;
      chain.push(JSON.parse(row.body) as SignedOrgState);
      bytes += row.body.length;
      last = row.version;
    }
    const more = this.sql.exec('SELECT 1 FROM org_states WHERE version > ? LIMIT 1', last).toArray().length > 0;
    return { ...base, chain, more };
  }

  /**
   * A genesis or a successor, verified and, when it still follows the head it was verified against, accepted with the
   * projections rebuilt. A genesis comes from the configured admin (`bootstrap.email`) and lists that admin under the
   * id the `members` table holds for it: every log carries `hub/<id>` for good.
   */
  async submit(body: unknown, poster: MemberRecord, org: string, bootstrap: { email: string }): Promise<Outcome<Accepted>> {
    const head = this.head();
    if (head === null) {
      const email = bootstrap.email.toLowerCase();
      if (poster.email !== email) return refused(403, 'not-org-admin', 'the org’s first state comes from its configured admin');
      const verdict = await verifyGenesis(body as SignedOrgState);
      if (!verdict.ok) return refused(409, verdict.code);
      const genesis = body as SignedOrgState;
      if (genesis.state.org !== org) return refused(409, 'bad-link', `this hub serves the org ${org}`);
      const id = this.sql.exec<{ id: string }>('SELECT id FROM members WHERE email = ?', email).toArray()[0]?.id;
      if (genesis.state.members.find((m) => m.email.toLowerCase() === email)?.id !== id) {
        return refused(409, 'genesis-member', `the genesis must list ${email} as the member ${id ?? '(none)'}, the id the hub's logs already carry`);
      }
      return this.commit(0, genesis, poster);
    }
    for (let round = 0; round < VERIFY_ROUNDS; round++) {
      const transitions = this.transitions();
      const verdict = await verifySuccessor(head, body as SignedOrgState, transitions);
      if (!verdict.ok) return this.refusedAgainst(head.state.version, verdict.code);
      const committed = this.commit(head.state.version, body as SignedOrgState, poster, transitions.length);
      if (committed !== 'transitions-moved') return committed;
    }
    return refused(503, 'busy', 'root transitions kept landing while this was verified; send it again');
  }

  /** A root transition the recovery key signed against the head, kept beside the chain (once). */
  async submitTransition(body: unknown, poster: MemberRecord): Promise<Outcome<{ fromVersion: number }>> {
    const head = this.head();
    if (head === null) return refused(409, 'no-state', 'the org has no state to transition from');
    const verdict = await verifyTransition(head, body as Signed<RootTransition>, head.state.root.recoveryPub);
    if (!verdict.ok) return this.refusedAgainst(head.state.version, verdict.code);
    const t = body as Signed<RootTransition>;
    return this.storage.transactionSync(() => {
      if (!this.holds(poster)) return notMember();
      if (this.headVersion() !== head.state.version) return this.refusedAgainst(this.headVersion(), 'rollback');
      this.sql.exec('INSERT OR IGNORE INTO org_transitions (body, from_version, accepted) VALUES (?, ?, ?)', canonicalize(t), t.body.fromVersion, iso(Date.now()));
      return { ok: true as const, value: { fromVersion: t.body.fromVersion } };
    });
  }

  private refusedAgainst(head: number, code: string): Refused {
    if (code === 'not-head' || code === 'rollback') return refused(409, code, `the head is version ${head}; fetch it and sign again on it`);
    return refused(409, code);
  }

  /** Whether `poster` is still a member: verification awaited, and a state accepted meanwhile may have removed them. */
  private holds(poster: MemberRecord): boolean {
    return this.sql.exec('SELECT 1 FROM members WHERE id = ?', poster.id).toArray().length > 0;
  }

  /**
   * Stores `s` as the version after `expected`, unless the head moved meanwhile or its poster is no longer a member,
   * and rebuilds the projections. With `transitions`, the count of root transitions `s` was verified against: a
   * transition accepted since (the table only grows) answers `transitions-moved`, and nothing is stored.
   */
  private commit(expected: number, s: SignedOrgState, poster: MemberRecord): Outcome<Accepted>;
  private commit(expected: number, s: SignedOrgState, poster: MemberRecord, transitions: number): Outcome<Accepted> | 'transitions-moved';
  private commit(expected: number, s: SignedOrgState, poster: MemberRecord, transitions?: number): Outcome<Accepted> | 'transitions-moved' {
    return this.storage.transactionSync(() => {
      if (!this.holds(poster)) return notMember();
      const current = this.headVersion();
      if (current !== expected) return this.refusedAgainst(current, 'not-head');
      if (transitions !== undefined && this.transitionCount() !== transitions) return 'transitions-moved' as const;
      const before = this.head()?.state;
      // Once the wrapped copies are purged (the Registry's `key_purged`, O14 M5a) the retirement stands: a machine that
      // went back to the key would ask for one nobody holds.
      if (before?.legacyRetired !== undefined && s.state.legacyRetired === undefined && this.keyPurged()) {
        return refused(409, 'key-purged', "the org key's wrapped copies are purged: a successor keeps legacyRetired");
      }
      const now = iso(Date.now());
      this.sql.exec('INSERT INTO org_states (version, body, accepted) VALUES (?, ?, ?)', s.state.version, canonicalize(s), now);
      const removed = this.projectMembers(s.state, now);
      this.projectDevices(s.state);
      if (before) this.dropEndedSubscriptions(before, s.state);
      this.sql.exec('DELETE FROM state_machines');
      for (const m of s.state.machines) this.sql.exec('INSERT INTO state_machines (ref, name, pub, owners) VALUES (?, ?, ?, ?)', m.ref, m.name, m.pub, JSON.stringify(m.owners));
      return { ok: true as const, value: { version: s.state.version, removed } };
    });
  }

  /** Whether the Registry purged the org key's wrapped copies (its `org` row, in this storage). */
  private keyPurged(): boolean {
    return (this.sql.exec<{ key_purged: string | null }>('SELECT key_purged FROM org').toArray()[0]?.key_purged ?? null) !== null;
  }

  /** `members` made the head's, each keeping the time it was first admitted; answers the ids it dropped. */
  private projectMembers(state: OrgState, now: string): MemberId[] {
    const before = this.sql.exec<{ id: string; created: string }>('SELECT id, created FROM members').toArray();
    const created = new Map(before.map((m) => [m.id, m.created]));
    this.sql.exec('DELETE FROM members');
    for (const m of state.members) this.sql.exec('INSERT INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', m.id, m.email.toLowerCase(), m.role, created.get(m.id) ?? now);
    const kept = new Set(state.members.map((m) => m.id));
    return before.map((m) => m.id).filter((id) => !kept.has(id));
  }

  /** `devices` made the head's; a device listed now drops its pending entry. */
  private projectDevices(state: OrgState): void {
    const before = new Map(this.sql.exec<{ id: string; member: string; access_client_id: string | null }>('SELECT id, member, access_client_id FROM devices').toArray().map((d) => [d.id, d]));
    this.sql.exec('DELETE FROM devices');
    for (const member of state.members) {
      for (const device of member.devices) {
        const held = before.get(device.id);
        const clientId = held?.member === member.id ? held.access_client_id : null;
        this.sql.exec('INSERT INTO devices (id, member, class, access_client_id) VALUES (?, ?, ?, ?)', device.id, member.id, device.class, clientId);
        this.sql.exec('DELETE FROM pending_devices WHERE member = ? AND device = ?', member.id, device.id);
      }
    }
  }

  /** Drops the push subscriptions bound to a device of `before` that `after` no longer lists for its member with the
   * same keys: a device id outlives the keys it was given, and a subscription belongs to the keys' holder. */
  private dropEndedSubscriptions(before: OrgState, after: OrgState): void {
    const incarnation = (member: string, d: Device) => JSON.stringify([member, d.id, d.channelPub, d.stepUpPub ?? null]);
    const kept = new Set(after.members.flatMap((m) => m.devices.map((d) => incarnation(m.id, d))));
    for (const member of before.members) {
      for (const device of member.devices) {
        if (!kept.has(incarnation(member.id, device))) this.sql.exec('DELETE FROM push_subscriptions WHERE member = ? AND device = ?', member.id, device.id);
      }
    }
  }

  // ---- The pairing exchange (RL §5.3) ----------------------------------------------------------------------------

  /** Keeps a new device's entry for its member's devices to list; the MAC is the approving device's to check. */
  keepPending(member: MemberId, body: unknown): Outcome<{ pending: PendingDevice }> {
    const request = pendingRequest(body);
    if (!request) {
      return refused(400, 'bad-shape', `the body is {deviceId (1 to ${MAX_DEVICE_ID} characters), class, keyStorage, channelPub, stepUpPub?, passkey?, mac (32 bytes)}, as a device of the org state carries them`);
    }
    const now = Date.now();
    this.sweepPending(now);
    const held = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM pending_devices WHERE member = ? AND device != ?', member, request.deviceId).one().n;
    if (held >= MAX_PENDING_DEVICES) return refused(409, 'too-many', `a member has at most ${MAX_PENDING_DEVICES} devices waiting to be paired; let one expire or pair it first`);
    const pending: PendingDevice = { ...request, member, created: iso(now), expires: iso(now + PENDING_DEVICE_TTL_S * 1000) };
    this.sql.exec(
      'INSERT OR REPLACE INTO pending_devices (member, device, body, created, expires) VALUES (?, ?, ?, ?, ?)',
      member,
      request.deviceId,
      JSON.stringify(request),
      pending.created,
      pending.expires,
    );
    return { ok: true, value: { pending } };
  }

  /** The member's entries that have not expired, oldest first. */
  pending(member: MemberId): PendingDevice[] {
    this.sweepPending(Date.now());
    return this.sql
      .exec<{ body: string; created: string; expires: string }>('SELECT body, created, expires FROM pending_devices WHERE member = ? ORDER BY created, device', member)
      .toArray()
      .map((row) => ({ ...(JSON.parse(row.body) as PendingDeviceRequest), member, created: row.created, expires: row.expires }));
  }

  private sweepPending(now: number): void {
    this.sql.exec('DELETE FROM pending_devices WHERE expires <= ?', iso(now));
  }
}

/** A pairing request whose fields are a device's (the package's `isDevice`) and a 32-byte MAC, and nothing else. */
function pendingRequest(body: unknown): PendingDeviceRequest | null {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (!Object.keys(b).every((key) => PENDING_FIELDS.includes(key))) return null;
  const { deviceId, mac, ...rest } = b;
  if (typeof deviceId !== 'string' || deviceId.length > MAX_DEVICE_ID || !isBase64urlOf(mac, 32)) return null;
  const device: Record<string, unknown> = { id: deviceId, ...rest };
  if (!isDevice(device)) return null;
  const { id, ...keys } = device as Device;
  return { deviceId: id, ...keys, mac: mac as string } as PendingDeviceRequest;
}
