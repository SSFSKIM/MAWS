// The org's registry (DX7): one per org. It holds the org, its members, its machines, its projects, and the
// enrollments that create machines, and answers who an Access identity is to the hub; its members' push subscriptions,
// which it sends Web Push to; and the grid, each project's summary as its `Project` reports it, streamed to members'
// grid sockets; and the org's directory, sent down every machine's stream as the `org` frame: every project with its kind,
// and every enrolled machine with whether it is online, as the projects' leases report it. Each enrolled machine has a
// project of its own (`kind` `machine`), registered when its enrollment is confirmed and retired when it is revoked.
//
// Enrollment is a durable state machine. Redeeming a token reserves the machine's name and records the intent to mint
// (a machine row without a client id) before Cloudflare's API is called; the service token is named
// `desk-<org>-<machine>`, so a token whose create answer was lost is found by name and deleted before anything else is
// minted under it. A second redemption while pending rotates the credential. A pending enrollment that expires, and a
// revoked machine, leave their token's name in `orphans`, swept until the API confirms the deletion; a revoked machine
// leaves its revocation for each project of the org in `revocations`, swept until the project takes it. A mint in flight
// is the one thing held only in memory (`busy`): an object restart ends the mint with it, and the name makes whatever
// it left behind findable. Every call to the API under one token name (a sweep's deletion by name, a redemption's
// deletion and mint) runs in turn on that name's queue, so a deletion by name never lists a token minted after it began.
//
// A provisioning key (docs/doperpowers/specs/2026-10-21-desk-provisioning-keys-design.md) is redeemed on the same path:
// its secret, found where no one-time token is, makes an enrollment row already pending, bound to the key
// (`enrollments.key`), from which point nothing downstream knows how it was made. A machine revokes its own enrollment,
// and the alarm revokes a key's machine offline past the key's time; with an admin's removal, three callers of the one
// revocation (`revokeMachine`), each bound to the enrollment it read, so a name enrolled anew between two of its
// caller's steps is never revoked in the old one's place.
//
// Hub v2 (O11 M4) keeps the signed records beside the state (`OrgRecords`, org-records.ts): a v2 machine posts its own
// key and ref with its pairing MAC once redeemed, and is shown listed once the head lists that key, apart from its hub
// confirmation; a machine enrolled through a provisioning key re-issued as a delegation posts its delegation-signed
// certificate, at the use its redemption counted; machines' listings and endpoint records are kept at their newest. An
// active machine re-enrolls in place under a token that names it, once its old credential is fenced. A push for a
// session its own machine listed goes to the listed owners alone, as the v2 notice, to the devices of theirs the head
// still lists.
//
// The org's signed state (RL5; O11 M3) is kept beside all this (`OrgChain`, org-chain.ts): once a genesis is accepted,
// `members` is the head's projection, and member management is a signed successor, never a route of the hub's own. A
// member a state drops is refused from then on, their grid sockets here and their project sockets (through each
// project's announcement of the state, `Project.stateAdvanced`, which carries the head's member ids) closing `4403
// removed`, and a socket the Worker admitted just before is refused at its accept, here and at the project. Each RL1
// relay's object is announced the state the same way from its first socket on (`relays`; O11 M6), for its app sockets.
import { DurableObject } from 'cloudflare:workers';
import { hubConfig, MEMBER_HEADER, type Env, type HubConfig } from '../env';
import type { AccessIdentity } from '../identity/access';
import { ServiceTokenApiError, serviceTokens } from '../identity/service-tokens';
import { importVapidKey, pushRequest, type VapidKey } from '../push/web-push';
import { base64urlDecode, base64urlEncode, isBase64urlOf } from '../protocol/base64url';
import { isListingGone, LISTINGS_PAGE_BYTES, REGISTRY_APP_PARAM, type Delegation, type HistoryInventory, type Listing, type RegistryAppFrame, type Signed } from 'org-protocol';
import type { GridDown, MachineSummary, ProjectSummary, PushNotice, RegistryDown } from '../protocol/browser';
import type { OrgFrame } from '../protocol/machine';
import { toWire } from '../protocol/parts';
import {
  ENROLLMENT_TTL_S,
  type OrgStateAccepted,
  type OrgStateView,
  type PendingDevice,
  type PendingDevices,
  type TransitionAccepted,
  isMachineName,
  machineNameKey,
  machineProjectId,
  MAX_ENROLLMENT_TTL_S,
  serviceTokenName,
  type EnrollmentIssued,
  type EnrollmentRecord,
  type Left,
  type MachineRecord,
  type MachineState,
  type MemberRecord,
  type OrgRecord,
  type ProjectKind,
  type ProjectRecord,
  type ProvisioningKeyIssued,
  type ProvisioningKeyRecord,
  type ProvisioningKeyRevoked,
  type PushSubscriptionRecord,
  type OrgKeysPurged,
  type Redeemed,
  type WrappedKeyRemoved,
  type CertConflict,
  type EnrollmentKey,
  type Listings,
  type MachineEndpoint,
  type MachineView,
  type OwnerNotice,
} from '../protocol/identity';
import { OrgChain } from './org-chain';
import { OrgRecords } from './org-records';
import { OrgKeys, type StoredKey } from './org-keys';
import { described } from './project';
import { relayObjectName } from './relay';
import { checkRequest, ProvisioningKeys, type KeyRow } from './provisioning-keys';
import { lacksMethod, RETRY_ATTEMPTS, RETRY_BASE_MS, RETRY_CAP_MS, retryDelay } from './retry';

/**
 * Who a request is. A machine's `v2` is set when its enrollment posted a machine key (`POST /machine/key`, which
 * `mawsd enroll` sends in the run that redeems): its credential is v2's, and never opens DX2 (O14 M5a).
 */
export type Principal = { kind: 'member'; org: OrgRecord; member: MemberRecord } | { kind: 'machine'; org: OrgRecord; machine: MachineRecord; v2?: true };

/** An answer for the Worker to send: a value, or an HTTP status with DX7's `{error, message?}`. */
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message?: string; conflicts?: CertConflict[] };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: number, error: string, message?: string): Result<never> => ({ ok: false, status, error, ...(message ? { message } : {}) });
/** The org key's copies after their purge (O14 M5a): the key is retired, and the hub holds none. */
const retiredKey = (status: 409 | 410) => fail(status, 'retired', 'the org key is retired and its wrapped copies are purged: the hub holds none');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS org (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, key_check TEXT, key_auth TEXT, key_purged TEXT);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machines (
  name TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, client_id TEXT UNIQUE, token_name TEXT NOT NULL,
  state TEXT NOT NULL, enrollment TEXT NOT NULL, created TEXT NOT NULL, confirmed TEXT,
  online INTEGER NOT NULL DEFAULT 0, seen TEXT);
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created TEXT NOT NULL,
  expires TEXT NOT NULL, ttl_s INTEGER NOT NULL, state TEXT NOT NULL, machine TEXT, key TEXT, use INTEGER, replaces TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, registered_by TEXT NOT NULL, created TEXT NOT NULL, archive_machine TEXT,
  kind TEXT NOT NULL DEFAULT 'hub', machine TEXT, retired INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orphans (token_name TEXT PRIMARY KEY, since TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revocations (machine TEXT NOT NULL, project TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY (machine, project));
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY, member TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL, device TEXT);
CREATE TABLE IF NOT EXISTS summaries (
  project TEXT PRIMARY KEY, machines INTEGER NOT NULL, machines_online INTEGER NOT NULL, working INTEGER NOT NULL,
  waiting INTEGER NOT NULL, report_seq INTEGER, live INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS announcements (
  project TEXT PRIMARY KEY, version INTEGER NOT NULL, members TEXT NOT NULL, attempts INTEGER NOT NULL, due INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS relays (ref TEXT PRIMARY KEY);
CREATE TABLE IF NOT EXISTS machine_states (
  project TEXT NOT NULL, name_key TEXT NOT NULL, client TEXT NOT NULL, online INTEGER NOT NULL,
  PRIMARY KEY (project, name_key, client));
`;

/** Columns added to tables a registry stored before them, with what an older row reads as. */
const ADDED_COLUMNS: Record<string, string[]> = {
  // `key_purged`: the wrapped copies' purge on the head's word (O14 M5a), `OrgKeysPurged['purged']` as JSON; null before.
  org: ['key_check TEXT', 'key_auth TEXT', 'key_purged TEXT'],
  machines: ['online INTEGER NOT NULL DEFAULT 0', 'seen TEXT'],
  // The provisioning key an enrollment was made through, and which of its uses it was (O11 M4); null for a one-time
  // token's. `replaces`: the active machine a re-enrollment's token names (O11 M4).
  enrollments: ['key TEXT', 'use INTEGER', 'replaces TEXT'],
  // The member's device a subscription is bound to (O11 M4); null for one bound to the member alone.
  push_subscriptions: ['device TEXT'],
  projects: ["kind TEXT NOT NULL DEFAULT 'hub'", 'machine TEXT', 'retired INTEGER NOT NULL DEFAULT 0'],
  summaries: ['report_seq INTEGER', 'live INTEGER NOT NULL DEFAULT 0'],
};

/** A member's devices: enough for a person's phones, tablets, and browsers, and a bound on what one member can store. */
const MAX_PUSH_SUBSCRIPTIONS = 20;
const MAX_ENDPOINT = 2048;
/** A device id as the org state's pairing exchange bounds it (org-chain.ts). */
const MAX_DEVICE_ID = 128;
/** A registry socket's hibernation attachment: its member, and `app` when it was opened as an app's (O11 M7). */
type RegistrySocketAttachment = { member: string; app?: true };
/** What a push did, for the suites and the logs. */
type Pushed = { sent: number; gone: number; failed: number };
type Counts = Pick<ProjectSummary, 'machines' | 'machines_online' | 'working' | 'waiting' | 'live'>;

/**
 * What a `Project` reports when its line changes: its counts; `seq`, rising with each report it sends, since reports
 * travel asynchronously and one can arrive after a later one; and every machine leased there, a follower too, with
 * whether its lease is fresh and the credential (`client`, the Access client id) of the stream that opened it. A lease
 * is evidence only for the enrollment holding that credential: one of a revoked enrollment, reported late, says nothing
 * of the machine enrolled since under the name, in whatever case. A `Project` on the version before this sends neither,
 * and one on the version before `live` sends no `live`: the count stored for the project stands.
 */
export type SummaryReport = Omit<Counts, 'live'> & { live?: number; seq?: number; machines_state?: Array<{ name: string; online: boolean; client: string }> };

const MACHINE_COLUMNS = 'name, client_id, token_name, state, enrollment, created, confirmed';
const ENROLLMENT_COLUMNS = 'id, created_by, created, expires, state, machine, ttl_s, key, use, replaces';
const PROJECT_COLUMNS = 'id, name, registered_by, created, archive_machine, kind, retired';
type ProjectRow = Omit<ProjectRecord, 'retired'> & { retired: number };
const projectOf = (row: ProjectRow): ProjectRecord => ({ ...row, retired: row.retired === 1 });
/** The `kv` key of the directory's version, raised by every change it carries (`directoryChanged`). */
const DIRECTORY_VERSION = 'directory-version';
/** How soon a failed orphan deletion, or a revocation a project has not taken, is tried again. */
const RETRY_MS = 60_000;
/** An announcement owed to a relay's object (O11 M6) is kept under `ref:<ref>` in `announcements` beside the projects'
 * (keyed by their ids, which hold no `:`). */
const RELAY_TARGET = 'ref:';
const relayTarget = (ref: string) => `${RELAY_TARGET}${ref}`;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** 128 random bits as lowercase hex (DX7's member id; also an enrollment's id). */
const newId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const iso = (ms: number) => new Date(ms).toISOString();
const lapsed = (enrollment: { expires: string }, now = Date.now()) => Date.parse(enrollment.expires) <= now;

type EnrollmentRow = EnrollmentRecord & { ttl_s: number; key: string | null; use: number | null; replaces: string | null };

export class Registry extends DurableObject<Env> {
  /** Enrollments whose mint is in flight in this object's life. */
  private readonly busy = new Set<string>();
  /** Per service-token name, the tail of the API work queued under it (an object restart ends the work with it). */
  private readonly nameQueues = new Map<string, Promise<unknown>>();

  private readonly keys: OrgKeys;
  private readonly provisioning: ProvisioningKeys;
  private readonly chain: OrgChain;
  private readonly records: OrgRecords;
  /** Per enrollment, an offline revocation the sweep began and has not seen complete, and when it last began: its fence
   * may be placed, so it is tried again until it completes, whatever the machine's online state or offline deadline
   * reads since (an object restart forgets it). */
  private readonly unfinished = new Map<string, { name: string; began: number }>();
  /** The version of the latest change of the directory this instance pushed (`directoryChanged`). */
  private pushed = 0;
  /** Per machine, a failed push of that version waiting to be sent again (an object restart forgets it). */
  private readonly pushRetries = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
    // A registry stored before a column was added gains it: an org before wrapped keys (M2's local state) its key check
    // and key auth, empty; machines and projects before the org directory their online state and kind.
    for (const [table, added] of Object.entries(ADDED_COLUMNS)) {
      const columns = ctx.storage.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray().map((c) => c.name);
      for (const column of added) if (!columns.includes(column.split(' ')[0])) ctx.storage.sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column}`);
    }
    this.keys = new OrgKeys(ctx.storage);
    this.provisioning = new ProvisioningKeys(ctx.storage);
    this.chain = new OrgChain(ctx.storage);
    this.records = new OrgRecords(ctx.storage, this.chain);
  }

  private get config(): HubConfig {
    const config = hubConfig(this.env);
    // The Worker reaches no object before its configuration is complete.
    if (!config) throw new Error('the hub is not configured');
    return config;
  }

  private get sql() {
    return this.ctx.storage.sql;
  }

  /** Who an identity Access admitted is to the hub: a member, an enrolled machine, or null for no one. A pending
   * machine's first authenticated request confirms its enrollment, and in the same step registers its machine project,
   * or reactivates it when the name was enrolled before. */
  resolve(identity: AccessIdentity): Principal | null {
    const org = this.ensureOrg();
    if (identity.kind === 'human') {
      const member = this.sql.exec<MemberRecord>('SELECT id, email, role, created FROM members WHERE email = ?', identity.email.toLowerCase()).toArray()[0];
      return member ? { kind: 'member', org, member } : null;
    }
    // Access's service-auth policy admits any service token of the account: only a client id this registry enrolled is
    // a machine.
    const machine = this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE client_id = ?`, identity.clientId).toArray()[0];
    if (!machine) return null;
    if (machine.state === 'active' && machine.confirmed === null) {
      // A machine re-enrolled in place, on its new credential's first request, while its enrollment is live: one that
      // lapsed first is expired here, its credential refused from now (`expire`).
      const enrollment = this.enrollmentById(machine.enrollment);
      if (!enrollment || enrollment.state !== 'pending' || lapsed(enrollment)) {
        if (enrollment && (enrollment.state === 'open' || enrollment.state === 'pending')) {
          this.expire(enrollment);
          void this.scheduleAlarm().catch(() => {});
        }
        return null;
      }
      const confirmed = iso(Date.now());
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('UPDATE machines SET confirmed = ? WHERE name = ?', confirmed, machine.name);
        this.sql.exec("UPDATE enrollments SET state = 'confirmed' WHERE id = ? AND state = 'pending'", machine.enrollment);
      });
      return this.machinePrincipal(org, { ...machine, confirmed });
    }
    if (machine.state === 'pending') {
      const enrollment = this.enrollmentById(machine.enrollment);
      if (!enrollment || enrollment.state !== 'pending' || lapsed(enrollment)) return null;
      const confirmed = iso(Date.now());
      const project = machineProjectId(org.id, machine.name);
      const listed = this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE machines SET state = 'active', confirmed = ? WHERE name = ?", confirmed, machine.name);
        this.sql.exec("UPDATE enrollments SET state = 'confirmed' WHERE id = ?", enrollment.id);
        return this.keepMachineProject(project, machine.name);
      });
      if (listed) {
        this.seedProject(project);
        this.toGrid({ t: 'summary', project: this.summaryOf(this.project(project)!) });
      }
      this.directoryChanged();
      return this.machinePrincipal(org, { ...machine, state: 'active', confirmed });
    }
    return this.machinePrincipal(org, machine);
  }

  /** A machine principal, marked `v2` when its enrollment holds a posted machine key (`Principal`). */
  private machinePrincipal(org: OrgRecord, machine: MachineRecord): Principal {
    return { kind: 'machine', org, machine, ...(this.records.machineKey(machine.enrollment) === null ? {} : { v2: true as const }) };
  }

  /** A one-time token for an admin to build an enrollment code from; the hub keeps only its hash. With `machine`, an
   * active machine's name, the token re-enrolls that machine in place (O11 M4). */
  async createEnrollment(member: MemberRecord, body: unknown): Promise<Result<EnrollmentIssued>> {
    const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256(token);
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    const ttl = typeof body === 'object' && body !== null ? ((body as { ttl_s?: unknown }).ttl_s ?? ENROLLMENT_TTL_S) : undefined;
    const names = typeof body === 'object' && body !== null ? (body as { machine?: unknown }).machine : undefined;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_ENROLLMENT_TTL_S || !(names === undefined || (typeof names === 'string' && isMachineName(names)))) {
      return fail(400, 'bad-shape', `the body is {ttl_s?, machine?}: a whole number of seconds from 1 to ${MAX_ENROLLMENT_TTL_S}, and an active machine's name to re-enroll it`);
    }
    let replaces: string | null = null;
    if (names !== undefined) {
      replaces = this.sql.exec<{ name: string }>("SELECT name FROM machines WHERE name_key = ? AND state = 'active'", machineNameKey(names)).toArray()[0]?.name ?? null;
      if (replaces === null) return fail(409, 'unknown-machine', `no active machine is named "${names}"`);
    }
    const now = Date.now();
    const enrollment: EnrollmentRecord = { id: newId(), created_by: admin.value.id, created: iso(now), expires: iso(now + ttl * 1000), state: 'open', machine: null };
    this.sql.exec(
      "INSERT INTO enrollments (id, token_hash, created_by, created, expires, ttl_s, state, machine, replaces) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL, ?)",
      enrollment.id,
      hash,
      enrollment.created_by,
      enrollment.created,
      enrollment.expires,
      ttl,
      replaces,
    );
    await this.scheduleAlarm();
    return ok({ enrollment, token });
  }

  /** A provisioning key for an admin to build a provisioning code from; the hub keeps only its secret's hash. */
  async createProvisioningKey(member: MemberRecord, body: unknown): Promise<Result<ProvisioningKeyIssued>> {
    const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256(token);
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    const request = checkRequest(body);
    if (!request.ok) return fail(400, 'bad-shape', request.message);
    const key = this.provisioning.add(admin.value, request.value, newId(), hash, Date.now());
    return ok({ key, token });
  }

  /** Every provisioning key, each re-issued as a delegation with the head's key and owners for it (O11 M4). */
  provisioningKeys(): ProvisioningKeyRecord[] {
    const delegations = new Map<string, Delegation>((this.chain.head()?.state.delegations ?? []).map((d) => [d.id, d]));
    return this.provisioning.list().map((key) => {
      const delegation = delegations.get(key.id);
      return delegation ? { ...key, delegation: { pub: delegation.pub, owners: delegation.owners } } : key;
    });
  }

  /** Stops new enrollments through the key; the machines it enrolled stay. A second revocation keeps the first's time. */
  revokeProvisioningKey(member: MemberRecord, id: string): Result<ProvisioningKeyRevoked> {
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    return this.provisioning.revoke(id, iso(Date.now())) ? ok({ revoked: id }) : fail(404, 'unknown-key');
  }

  /** Redeems a one-time token, or a provisioning key's secret, for the machine's own service token (the path Access does
   * not guard). */
  async redeem(body: unknown): Promise<Result<Redeemed>> {
    const { token, machine } = (typeof body === 'object' && body !== null ? body : {}) as { token?: unknown; machine?: unknown };
    if (typeof token !== 'string' || token === '' || typeof machine !== 'string') return fail(400, 'bad-shape', 'the body is {token, machine}');
    if (!isMachineName(machine)) return fail(400, 'bad-name', `"${machine}" is not an admitted machine name`);
    await this.sweep();
    const hash = await sha256(token);

    // From here to the first await below, nothing else runs in this object: the checks and the reservation are one step.
    let enrollment = this.sql.exec<EnrollmentRow>(`SELECT ${ENROLLMENT_COLUMNS} FROM enrollments WHERE token_hash = ?`, hash).toArray()[0];
    if (!enrollment) {
      const key = this.provisioning.bySecret(hash);
      return key ? this.redeemThrough(key, machine) : fail(404, 'unknown-token');
    }
    if (this.busy.has(enrollment.id)) return fail(409, 'busy', 'a redemption of this token is in flight; try again');
    if ((enrollment.state === 'open' || enrollment.state === 'pending') && lapsed(enrollment)) {
      this.expire(enrollment);
      enrollment = this.enrollmentById(enrollment.id)!;
    }
    if (enrollment.state === 'expired') return fail(410, 'expired', 'this token has expired; ask for a new one');
    if (enrollment.state === 'confirmed') return fail(409, 'confirmed', 'this token enrolled its machine, which has connected; ask for a new one');
    if (enrollment.state === 'pending' && enrollment.machine !== machine) {
      return fail(409, 'token-used', `this token is bound to the machine "${enrollment.machine}"`);
    }

    const org = this.ensureOrg();
    const tokenName = serviceTokenName(org.id, machine);
    const expires = iso(Date.now() + enrollment.ttl_s * 1000);
    const id = enrollment.id;
    if (enrollment.state === 'open' && enrollment.replaces !== null) return this.reenroll(enrollment, machine, expires, org.id);
    if (enrollment.state === 'open') {
      const taken = this.sql.exec<{ name: string }>('SELECT name FROM machines WHERE name_key = ?', machineNameKey(machine)).toArray()[0];
      if (taken) {
        return fail(409, 'name-taken', `a machine named "${taken.name}" is enrolled in this org; pick another name and redeem this token under it`);
      }
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE enrollments SET state = 'pending', machine = ?, expires = ? WHERE id = ?", machine, expires, id);
        this.reserve(machine, tokenName, id, iso(Date.now()));
      });
    } else {
      // A rotation, only while the machine still holds this enrollment: one a later re-enrollment displaced must not
      // clear or delete the credential that holds it now. Then the credential minted before stops at the hub at once,
      // before Cloudflare deletes it.
      const holder = this.sql.exec<{ enrollment: string }>('SELECT enrollment FROM machines WHERE name_key = ?', machineNameKey(machine)).toArray()[0];
      if (holder?.enrollment !== id) {
        this.sql.exec("UPDATE enrollments SET state = 'expired' WHERE id = ?", id);
        return fail(410, 'expired', 'a later enrollment of this machine replaced this one; ask for a new one');
      }
      this.rotate(id, machine, expires);
    }
    return this.mint(id, machine, tokenName, org.id);
  }

  /**
   * A re-enrollment in place (O11 M4): the token names an active machine, which redeems it under that name. The old
   * credential is fenced at the machine's `Machine` object first (its streams refused and ended), and nothing else moves
   * until that is done: a fence that fails is `503 fence-failed`, and the redemption is sent again. Then, in one
   * synchronous step, the record passes to this enrollment with no credential, so the old credential is refused at the
   * hub as well, and the new one is minted, which deletes the old one at Cloudflare. The machine keeps its name, project
   * and history; its new credential's first request confirms it (`resolve`), and a v2 machine posts its new key under
   * this enrollment.
   */
  private async reenroll(enrollment: EnrollmentRow, machine: string, expires: string, org: string): Promise<Result<Redeemed>> {
    if (machineNameKey(machine) !== machineNameKey(enrollment.replaces!)) return fail(409, 'token-used', `this token re-enrolls the machine "${enrollment.replaces}"`);
    const active = () => this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE name_key = ? AND state = 'active'`, machineNameKey(machine)).toArray()[0];
    const held = active();
    if (!held) return fail(409, 'not-active', `"${enrollment.replaces}" is no longer an active machine; ask for an enrollment of a new one`);
    const id = enrollment.id;
    // A second redemption of this token meanwhile is answered `busy`.
    this.busy.add(id);
    try {
      await this.env.MACHINE.get(this.env.MACHINE.idFromName(`${org}:${held.name}`)).revoke(held.client_id);
    } catch (error) {
      console.log(JSON.stringify({ desk: 'registry', event: 'reenroll-fence-failed', machine: held.name, error: described(error) }));
      return fail(503, 'fence-failed', 'the machine’s old credential could not be fenced yet; redeem this token again');
    } finally {
      this.busy.delete(id);
    }
    // While its object answered, the machine may have been revoked or re-enrolled, or this token expired.
    const now = active();
    const current = this.enrollmentById(id);
    if (!now || now.enrollment !== held.enrollment || current?.state !== 'open' || lapsed(current)) return fail(409, 'not-active', `"${held.name}" changed while its old credential was fenced; ask for a new enrollment`);
    this.ctx.storage.transactionSync(() => {
      // An earlier re-enrollment whose machine never connected ends here: its token sent again is refused, never rotated.
      this.sql.exec("UPDATE enrollments SET state = 'expired' WHERE id = ? AND state = 'pending'", now.enrollment);
      this.sql.exec("UPDATE enrollments SET state = 'pending', machine = ?, expires = ? WHERE id = ?", held.name, expires, id);
      this.sql.exec('UPDATE machines SET enrollment = ?, client_id = NULL, confirmed = NULL WHERE name = ?', id, held.name);
    });
    return this.mint(id, held.name, serviceTokenName(org, held.name), org);
  }

  /**
   * A redemption through a provisioning key: §2's checks in order, then the reservation, all in the synchronous step the
   * caller began at the lookup. A new enrollment is a row already pending, bound to the key, whose `token_hash` no
   * SHA-256 equals; a redemption under a name the key's own pending enrollment holds rotates it, as a token's second
   * redemption does, and counts no use.
   */
  private async redeemThrough(key: KeyRow, machine: string): Promise<Result<Redeemed>> {
    const now = Date.now();
    if (key.revoked !== null) return fail(410, 'key-revoked', 'this provisioning key was revoked; ask an admin for a new key');
    if (Date.parse(key.expires) <= now) return fail(410, 'key-expired', 'this provisioning key has expired; ask an admin for a new key');
    if (!machineNameKey(machine).startsWith(machineNameKey(key.prefix))) {
      return fail(403, 'prefix-mismatch', `this key enrolls only machines named "${key.prefix}…"; redeem it under such a name`);
    }
    const held = this.sql.exec<{ name: string; state: MachineState; enrollment: string }>('SELECT name, state, enrollment FROM machines WHERE name_key = ?', machineNameKey(machine)).toArray()[0];
    if (held?.state === 'pending' && this.busy.has(held.enrollment)) return fail(409, 'busy', 'a redemption of this name is in flight; try again');
    const org = this.ensureOrg().id;
    const tokenName = serviceTokenName(org, machine);
    const expires = iso(now + ENROLLMENT_TTL_S * 1000);
    if (held?.state === 'pending' && held.name === machine && this.enrollmentById(held.enrollment)?.key === key.id) {
      this.rotate(held.enrollment, machine, expires);
      return this.mint(held.enrollment, machine, tokenName, org);
    }
    if (held) return fail(409, 'name-taken', `a machine named "${held.name}" is enrolled in this org; pick another name and redeem this key under it`);
    if (key.max_uses !== null && key.uses >= key.max_uses) {
      return fail(410, 'key-exhausted', `this provisioning key has made all the ${key.max_uses} enrollments it may; ask an admin for a new key or a higher cap`);
    }
    const id = newId();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        "INSERT INTO enrollments (id, token_hash, created_by, created, expires, ttl_s, state, machine, key) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)",
        id,
        `key:${id}`,
        key.created_by,
        iso(now),
        expires,
        ENROLLMENT_TTL_S,
        machine,
        key.id,
      );
      this.reserve(machine, tokenName, id, iso(now));
      this.sql.exec('UPDATE enrollments SET use = ? WHERE id = ?', this.provisioning.use(key.id), id);
    });
    return this.mint(id, machine, tokenName, org);
  }

  /** Reserves the name for the enrollment's machine, pending and without a credential until the mint returns; called
   * inside the caller's transaction, beside its own change to the enrollment. */
  private reserve(machine: string, tokenName: string, enrollment: string, created: string): void {
    this.sql.exec(
      "INSERT INTO machines (name, name_key, client_id, token_name, state, enrollment, created, confirmed) VALUES (?, ?, NULL, ?, 'pending', ?, ?, NULL)",
      machine,
      machineNameKey(machine),
      tokenName,
      enrollment,
      created,
    );
    // This redemption deletes every token of the name before it mints, which is what an orphan of it waited for.
    this.sql.exec('DELETE FROM orphans WHERE token_name = ?', tokenName);
  }

  /** A pending enrollment redeemed again: its time moves on, and the credential minted before stops at the hub at once,
   * before Cloudflare deletes it. */
  private rotate(id: string, machine: string, expires: string): void {
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('UPDATE enrollments SET expires = ? WHERE id = ?', expires, id);
      this.sql.exec('UPDATE machines SET client_id = NULL WHERE name = ?', machine);
    });
  }

  /** Mints the reserved machine's service token, on its name's queue, after deleting every token of the name. The
   * enrollment is busy from this call's synchronous start until its answer, and its expiry's alarm is set before the
   * API is called, so an object reset during the calls still leaves a wakeup that expires it and orphans its token. */
  private async mint(id: string, machine: string, tokenName: string, org: string): Promise<Result<Redeemed>> {
    this.busy.add(id);
    try {
      await this.scheduleAlarm();
      const holds = () =>
        this.enrollmentById(id)?.state === 'pending' && this.sql.exec<{ enrollment: string }>('SELECT enrollment FROM machines WHERE name = ?', machine).toArray()[0]?.enrollment === id;
      return await this.onName(tokenName, async (): Promise<Result<Redeemed>> => {
        // A mint queued behind another of the name finds the machine as that one left it: an enrollment ended or
        // displaced meanwhile deletes nothing, since the name's tokens are another enrollment's now.
        if (!holds()) return fail(410, 'expired', 'the enrollment ended before its token was minted');
        const api = serviceTokens(this.config.api);
        await api.deleteNamed(tokenName);
        const minted = await api.create(tokenName);
        // A revocation may have run while the API answered; then the token is no machine's.
        if (!holds()) {
          await api.delete(minted.id).catch(() => this.orphan(tokenName));
          return fail(410, 'expired', 'the enrollment ended while its token was minted');
        }
        this.sql.exec('UPDATE machines SET client_id = ? WHERE name = ?', minted.client_id, machine);
        const use = this.enrollmentById(id)?.use ?? null;
        return ok({ org, machine, client_id: minted.client_id, client_secret: minted.client_secret, enrollment: id, ...(use === null ? {} : { use }) });
      });
    } catch (error) {
      if (error instanceof ServiceTokenApiError) return fail(502, 'mint-failed', `${error.message}; redeem again`);
      throw error;
    } finally {
      this.busy.delete(id);
      await this.scheduleAlarm();
    }
  }

  /** An admin's removal of a machine: whatever holds the name now (`revokeMachine`). */
  async revoke(member: MemberRecord, name: string): Promise<Result<{ revoked: string }>> {
    // Checked in the step that begins the revocation (its first await is the fence at the machine's object).
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    if (this.sql.exec('SELECT 1 FROM machines WHERE name_key = ?', machineNameKey(name)).toArray().length === 0) return fail(404, 'unknown-machine');
    return ok(await this.revokeMachine(name));
  }

  /** A machine's revocation of its own enrollment (`DELETE /machine/enrollment`), bound to the enrollment the Worker
   * resolved its credential to: should the name have been revoked and enrolled anew since, that machine is left be. */
  async leave(machine: MachineRecord): Promise<Result<Left>> {
    return ok(await this.revokeMachine(machine.name, { enrollment: machine.enrollment }));
  }

  /**
   * Revokes a machine: its credential is refused and its stream ends at its `Machine` object, then its record goes (the
   * Worker refuses it from then), its service token is deleted (retried until Cloudflare confirms), its name is released,
   * an archive designation of it is cleared, and every project of the org stops counting it on the grid (retried until
   * each project takes it). The `Machine` object goes first because it answers the newest stream generation the machine
   * opened, which the projects are told: no stream of a refused credential opens after, so the generation recorded with
   * the record's deletion is final. What the name holds is read again once the object answers: a revocation of the same
   * enrollment may have finished meanwhile and the name been enrolled anew, and that machine is not this one. The object
   * answers a revocation of a credential it already refused as it did the first, so a DELETE whose answer was lost after
   * the object took it completes when the admin asks again.
   *
   * With `expected`, the caller read the enrollment in an earlier step (a machine's own credential resolved by the
   * Worker; a sweep's candidate), and the name may have been revoked and enrolled anew since: a row that is gone, or is
   * another enrollment's, is answered as revoked and nothing of the name's is touched. The check and the call that fences
   * the credential are one synchronous step.
   */
  private async revokeMachine(name: string, expected?: { enrollment: string }): Promise<{ revoked: string }> {
    const org = this.ensureOrg();
    let machine = this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE name_key = ?`, machineNameKey(name)).toArray()[0];
    if (!machine || (expected && machine.enrollment !== expected.enrollment)) return { revoked: name };
    const object = this.env.MACHINE.get(this.env.MACHINE.idFromName(`${org.id}:${machine.name}`));
    let generation = await object.revoke(machine.client_id);
    // A credential minted for it while its object answered (a pending machine's token redeemed again) is refused there too.
    for (;;) {
      const now = this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE name = ? AND enrollment = ?`, machine.name, machine.enrollment).toArray()[0];
      // Its record went while its object answered (another revocation of it, or its enrollment's expiry), and what the
      // name holds now, if anything, is another machine's: nothing of the name's is touched.
      if (!now) return { revoked: machine.name };
      if (!now.client_id || now.client_id === machine.client_id) break;
      machine = now;
      generation = Math.max(generation, await object.revoke(machine.client_id));
    }
    const revoked = machine;
    const retired = this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM machines WHERE name = ? AND enrollment = ?', revoked.name, revoked.enrollment);
      this.sql.exec('DELETE FROM machine_states WHERE name_key = ?', machineNameKey(revoked.name));
      this.sql.exec("UPDATE enrollments SET state = 'expired' WHERE id = ? AND state IN ('open', 'pending')", revoked.enrollment);
      this.sql.exec('UPDATE projects SET archive_machine = NULL WHERE archive_machine = ?', revoked.name);
      this.orphan(revoked.token_name);
      // Every project of the org: a project knows its machines, the registry does not.
      this.sql.exec(
        'INSERT INTO revocations (machine, project, generation) SELECT ?, id, ? FROM projects WHERE true ON CONFLICT (machine, project) DO UPDATE SET generation = MAX(generation, excluded.generation)',
        revoked.name,
        generation,
      );
      // Its machine project keeps its log for history, off the grid and marked retired in the directory.
      return this.sql.exec("UPDATE projects SET retired = 1 WHERE id = ? AND kind = 'machine' AND retired = 0", machineProjectId(org.id, revoked.name)).rowsWritten > 0;
    });
    // A summary cannot take a row off the grid: the grid goes again whole.
    if (retired) this.toGrid(this.gridFrame());
    this.directoryChanged();
    await this.sweepRevocations();
    await this.sweepOrphans();
    await this.scheduleAlarm();
    return { revoked: revoked.name };
  }

  /** Every machine, a v2 one with the key it posted and whether the head lists that key for its ref (O11 M4). */
  machines(): MachineView[] {
    return this.sql
      .exec<MachineRecord & { online: number; seen: string | null }>(`SELECT ${MACHINE_COLUMNS}, online, seen FROM machines ORDER BY name`)
      .toArray()
      .map(({ online, seen, ...record }) => {
        // DX2 presence, as the directory's `org` frame carries it (O14 M5a: a cutover's check reads it here).
        const machine: MachineView = { ...record, online: online === 1, seen };
        const key = this.records.machineKey(machine.enrollment);
        if (!key) return machine;
        const listed = this.sql.exec('SELECT 1 FROM state_machines WHERE ref = ? AND pub = ?', key.ref, key.pub).toArray().length > 0;
        return { ...machine, key: { ref: key.ref, pub: key.pub, listed } };
      });
  }

  projects(): ProjectRecord[] {
    return this.sql.exec<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created, id`).toArray().map(projectOf);
  }

  project(id: string): ProjectRecord | null {
    const row = this.sql.exec<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`, id).toArray()[0];
    return row ? projectOf(row) : null;
  }

  /**
   * History re-attestation's inventory (O14 M4, Interfaces §D): every project of the directory, retired ones included,
   * whose log holds a DX1 writer under one of `names`, with each such writer's highest DX1 seq, asked of each Project.
   * The names are the machine's own claim (its current and its phase-1 names): the directory records no former names.
   */
  async historyInventory(names: string[]): Promise<HistoryInventory> {
    const org = this.ensureOrg().id;
    const ids = this.sql.exec<{ id: string }>('SELECT id FROM projects ORDER BY created, id').toArray().map((p) => p.id);
    const projects = await Promise.all(ids.map(async (id) => ({ id, writers: await this.env.PROJECT.get(this.env.PROJECT.idFromName(`${org}:${id}`)).historyWriters(names) })));
    return { projects: projects.filter((p) => p.writers.length > 0) };
  }

  /**
   * A machine's `hello` for a project the registry does not hold registers it, under the name from its `.smns`. The id
   * of an enrolled machine's project registers as that machine's (`kind` `machine`, under its name), whoever sends it: a
   * machine enrolled before machine projects existed has none until its first hello of it. A retired machine project
   * whose name was enrolled again is active again. Anything else is answered as held, a retired project too (a machine
   * may hello one from a directory it read before the retirement).
   */
  registerProject(id: string, name: string, machine: string): ProjectRecord {
    const held = this.project(id);
    if (held && !held.retired) return held;
    const org = this.ensureOrg().id;
    const owner = this.sql
      .exec<{ name: string }>("SELECT name FROM machines WHERE state = 'active' ORDER BY name")
      .toArray()
      .find((m) => machineProjectId(org, m.name) === id)?.name;
    if (held && !owner) return held;
    const listed = owner
      ? this.keepMachineProject(id, owner, machine)
      : this.sql.exec("INSERT INTO projects (id, name, registered_by, created, archive_machine, kind, machine, retired) VALUES (?, ?, ?, ?, NULL, 'hub', NULL, 0)", id, name, machine, iso(Date.now())).rowsWritten > 0;
    const project = this.project(id)!;
    if (listed) {
      this.seedProject(id);
      this.toGrid({ t: 'summary', project: this.summaryOf(project) });
      this.directoryChanged();
    }
    return project;
  }

  /**
   * A project new to the grid is owed the head now, as a relay's object is from its first socket (`relayed`): the states
   * accepted before were announced only to the projects held then, and a project told none admits any member. A socket
   * it admits before this announcement lands is closed by it, as one admitted just before a removal is.
   */
  private seedProject(id: string): void {
    const version = this.chain.head()?.state.version;
    if (version === undefined) return;
    const members = this.memberIds();
    this.owe(id, version, members);
    void this.announce(this.ensureOrg().id, { project: id, version, members });
    void this.scheduleAlarm().catch(() => {});
  }

  /** Registers an enrolled machine's project under its name, or reactivates it; true when it was not on the grid. */
  private keepMachineProject(id: string, machine: string, registeredBy = machine): boolean {
    const before = this.project(id);
    if (before && !before.retired) return false;
    this.sql.exec(
      "INSERT INTO projects (id, name, registered_by, created, archive_machine, kind, machine, retired) VALUES (?, ?, ?, ?, NULL, 'machine', ?, 0) ON CONFLICT (id) DO UPDATE SET name = excluded.name, kind = 'machine', machine = excluded.machine, retired = 0",
      id,
      machine,
      registeredBy,
      iso(Date.now()),
      machine,
    );
    return true;
  }

  // ---- The org's directory (the `org` frame down every machine's stream) -----------------------------------------

  /** The org's directory as it stands, and the version of the latest change it carries. */
  orgFrame(): { frame: OrgFrame; version: number } {
    const projects = this.sql
      .exec<{ id: string; name: string; kind: ProjectKind; machine: string | null; retired: number }>('SELECT id, name, kind, machine, retired FROM projects ORDER BY created, id')
      .toArray()
      .map((p) => ({ id: p.id, name: p.name, kind: p.kind, ...(p.kind === 'machine' && p.machine !== null ? { machine: p.machine } : {}), retired: p.retired === 1 }));
    const machines = this.sql
      .exec<{ name: string; online: number; seen: string | null }>("SELECT name, online, seen FROM machines WHERE state = 'active' ORDER BY name")
      .toArray()
      .map((m): MachineSummary => ({ name: m.name, online: m.online === 1, seen: m.seen }));
    return { frame: { t: 'org', projects, machines }, version: this.ctx.storage.kv.get<number>(DIRECTORY_VERSION) ?? 0 };
  }

  /**
   * The directory changed: every enrolled machine with a stream is sent it whole, through its `Machine` object (one
   * with no stream is not sent it: its next `welcome` brings the directory). Each carries the version of its change, so
   * a `Machine` that wrote a later one, or the snapshot its stream opened with, passes an older one by. A push still
   * waiting to be sent again is superseded: this change carries everything it did.
   */
  private directoryChanged(): void {
    const version = (this.ctx.storage.kv.get<number>(DIRECTORY_VERSION) ?? 0) + 1;
    this.ctx.storage.kv.put(DIRECTORY_VERSION, version);
    const { frame } = this.orgFrame();
    const org = this.ensureOrg().id;
    this.pushed = version;
    for (const timer of this.pushRetries.values()) clearTimeout(timer);
    this.pushRetries.clear();
    for (const { name } of frame.machines) this.pushDirectory(org, name, frame, version, 1);
  }

  /**
   * Sends one machine's object the directory of `version`, `attempt` being how many times it was sent (retry.ts). A call
   * that fails is sent again, the same frame and version, until the object answers, a later change supersedes it, or it
   * went RETRY_ATTEMPTS times; an answer of "offline" is an answer (the machine's next stream opens with the directory).
   * Sent again, an older directory still never follows a newer one onto a stream: the `Machine` writes a version only
   * above the last its stream wrote. A retry reads no storage, which an instance replaced meanwhile could not.
   */
  private pushDirectory(org: string, name: string, frame: OrgFrame, version: number, attempt: number): void {
    void this.env.MACHINE.get(this.env.MACHINE.idFromName(`${org}:${name}`))
      .directory(frame, version)
      .catch((error: unknown) => {
        // A later change was pushed meanwhile, to this machine too.
        if (version !== this.pushed) return;
        const wait = attempt < RETRY_ATTEMPTS ? retryDelay(attempt, this.retryBaseMs(), error) : null;
        console.log(JSON.stringify({ desk: 'registry', event: 'push-failed', machine: name, version, attempt, error: described(error), retry_ms: wait === null ? null : Math.round(wait) }));
        if (wait === null) return;
        this.pushRetries.set(
          name,
          setTimeout(() => {
            this.pushRetries.delete(name);
            this.pushDirectory(org, name, frame, version, attempt + 1);
          }, wait),
        );
      });
  }

  /** How long the first retry of a failed push waits at most (retry.ts; the suites' Worker shortens it). */
  protected retryBaseMs(): number {
    return RETRY_BASE_MS;
  }

  /** Each enrolled machine is online while any project reports a fresh lease of it, opened with its own credential,
   * and `seen` is when that last changed; the directory goes out when it did. A machine put offline may start a key's
   * offline time, so the alarm is scheduled then (detached: this runs in `summary`'s synchronous step). */
  private refreshOnline(): void {
    const now = iso(Date.now());
    let changed = false;
    let offline = false;
    for (const m of this.sql.exec<{ name: string; name_key: string; client_id: string | null; online: number }>("SELECT name, name_key, client_id, online FROM machines WHERE state = 'active'").toArray()) {
      const online = this.sql.exec('SELECT 1 FROM machine_states WHERE name_key = ? AND client = ? AND online = 1 LIMIT 1', m.name_key, m.client_id ?? '').toArray().length > 0;
      if (online === (m.online === 1)) continue;
      this.sql.exec('UPDATE machines SET online = ?, seen = ? WHERE name = ?', online ? 1 : 0, now, m.name);
      changed = true;
      offline ||= !online;
    }
    if (changed) this.directoryChanged();
    if (offline) void this.scheduleAlarm().catch(() => {});
  }

  // ---- The grid (DX3's registry socket) and the app's frames on it (OX8; O11 M7) -------------------------------

  /**
   * A member's registry socket (the Worker sends only a member's): every project's summary, then each change. An app's
   * (`?app=1`, OX8; O11 M7) gets after the grid the org state's head version and every listing held, in pages of at
   * most `LISTINGS_PAGE_BYTES`, the last marked, then a `state` notice at each accepted state and each listing as it is
   * stored. A socket without the query, desk-web's grid, gets none of it: listings are no use to it, every phone's
   * reconnect would carry them all, and a snapshot past its parts bound would close it into a reconnect loop.
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== '/grid') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    // Resolved before a state that dropped the member, and reaching here after it.
    const member = request.headers.get(MEMBER_HEADER) ?? '';
    if (this.sql.exec('SELECT 1 FROM members WHERE id = ?', member).toArray().length === 0) return Response.json({ error: 'removed' }, { status: 403 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const app = url.searchParams.get(REGISTRY_APP_PARAM) === '1';
    server.serializeAttachment({ member, ...(app ? { app } : {}) } satisfies RegistrySocketAttachment);
    this.send(server, this.gridFrame());
    if (app) {
      const version = this.chain.head()?.state.version;
      if (version !== undefined) this.send(server, { t: 'state', version });
      const pages = this.records.listingPages(LISTINGS_PAGE_BYTES);
      pages.forEach((records, i) => this.send(server, { t: 'listings', records, last: i === pages.length - 1 }));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The whole grid: every project's line but a retired one's. */
  private gridFrame(): GridDown {
    return { t: 'grid', projects: this.projects().filter((p) => !p.retired).map((p) => this.summaryOf(p)) };
  }

  /** The grid takes nothing up. */
  async webSocketMessage(): Promise<void> {}

  /**
   * A project's counts and its machines' leases, as its `Project` object reports them when they change. A report older
   * than the latest taken from the project changes nothing; a newer one supersedes all the project said before. One
   * without `seq` (a `Project` on the previous version) still sets the counts but leaves the leases as they were; one
   * without `live` leaves that count as it was (0 for a project first reported so). A retired project's are kept and
   * drawn on no grid.
   *
   * It answers `true`, which tells a `Project` its report's every count was kept, or superseded by a later report of its
   * own, which has its own answer. A Registry on the version before `live` answers nothing, having kept no `live`, and
   * the `Project` sends its counts again at its next change, though they are the same.
   */
  summary(project: string, report: SummaryReport): true {
    const seq = Number.isSafeInteger(report.seq) ? (report.seq as number) : null;
    const live = Number.isSafeInteger(report.live) && (report.live as number) >= 0 ? (report.live as number) : null;
    const taken = this.ctx.storage.transactionSync(() => {
      const last = this.sql.exec<{ report_seq: number | null }>('SELECT report_seq FROM summaries WHERE project = ?', project).toArray()[0]?.report_seq ?? null;
      if (seq !== null && last !== null && seq <= last) return false;
      this.sql.exec(
        // `live` is bound twice: SQLite checks NOT NULL before the conflict, so a report without it inserts 0, and its
        // update keeps the stored count (`excluded.live` would read that 0).
        'INSERT INTO summaries (project, machines, machines_online, working, waiting, report_seq, live) VALUES (?, ?, ?, ?, ?, ?, COALESCE(?, 0)) ON CONFLICT (project) DO UPDATE SET machines = excluded.machines, machines_online = excluded.machines_online, working = excluded.working, waiting = excluded.waiting, report_seq = COALESCE(excluded.report_seq, summaries.report_seq), live = COALESCE(?, summaries.live)',
        project,
        report.machines,
        report.machines_online,
        report.working,
        report.waiting,
        seq,
        live,
        live,
      );
      if (seq === null || !Array.isArray(report.machines_state)) return true;
      this.sql.exec('DELETE FROM machine_states WHERE project = ?', project);
      for (const { name, online, client } of report.machines_state) {
        if (typeof name !== 'string' || typeof client !== 'string' || client === '') continue;
        this.sql.exec('INSERT OR REPLACE INTO machine_states (project, name_key, client, online) VALUES (?, ?, ?, ?)', project, machineNameKey(name), client, online ? 1 : 0);
      }
      return true;
    });
    if (!taken) return true;
    const record = this.project(project);
    if (record && !record.retired) this.toGrid({ t: 'summary', project: this.summaryOf(record) });
    this.refreshOnline();
    return true;
  }

  private summaryOf(project: ProjectRecord): ProjectSummary {
    const counts = this.sql.exec<Counts>('SELECT machines, machines_online, working, waiting, live FROM summaries WHERE project = ?', project.id).toArray()[0];
    return { id: project.id, name: project.name, kind: project.kind, ...(counts ?? { machines: 0, machines_online: 0, working: 0, waiting: 0, live: 0 }) };
  }

  private toGrid(frame: GridDown): void {
    for (const socket of this.ctx.getWebSockets()) this.send(socket, frame);
  }

  /** A frame of the app's connection, to the sockets opened as an app's alone. */
  private toApps(frame: RegistryAppFrame): void {
    for (const socket of this.ctx.getWebSockets()) {
      if ((socket.deserializeAttachment() as RegistrySocketAttachment | null)?.app === true) this.send(socket, frame);
    }
  }

  /** A frame above `FRAME_LIMIT` (a grid of many projects) goes in numbered parts, as on a project socket. */
  private send(socket: WebSocket, frame: RegistryDown): void {
    try {
      for (const line of toWire(frame)) socket.send(line);
    } catch {
      // closing as it is written to: the browser reconnects and gets the grid whole
    }
  }

  // ---- Web Push (DX7) ----------------------------------------------------------------------------------------------

  private vapid: Promise<VapidKey> | undefined;

  private vapidKey(): Promise<VapidKey> {
    this.vapid ??= importVapidKey(this.config.vapidKey);
    return this.vapid;
  }

  /** The `applicationServerKey` a browser subscribes with. */
  async pushKey(): Promise<{ key: string }> {
    return { key: (await this.vapidKey()).publicKey };
  }

  /** Keeps a member device's subscription, keyed by its endpoint (a device subscribing again replaces its keys); with
   * `device`, bound to that device of the member's in the head (O11 M4). */
  keepPushSubscription(member: MemberRecord, body: unknown): Result<{ subscription: PushSubscriptionRecord }> {
    const held = this.current(member);
    if (!held.ok) return held;
    const b = (typeof body === 'object' && body !== null ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown }; device?: unknown };
    const endpoint = b.endpoint;
    let url: URL | undefined;
    try {
      url = typeof endpoint === 'string' && endpoint.length <= MAX_ENDPOINT ? new URL(endpoint) : undefined;
    } catch {
      url = undefined;
    }
    if (url?.protocol !== 'https:' || !isBase64urlOf(b.keys?.p256dh, 65) || !isBase64urlOf(b.keys?.auth, 16)) {
      return fail(400, 'bad-shape', 'the body is {endpoint: an https URL, keys: {p256dh: 65 bytes, auth: 16 bytes}, device?}, base64url as PushSubscription.toJSON() gives them');
    }
    const device = b.device;
    if (device !== undefined && (typeof device !== 'string' || device === '' || device.length > MAX_DEVICE_ID)) return fail(400, 'bad-shape', 'device is one of your devices’ ids in the org state');
    if (device !== undefined && this.sql.exec('SELECT 1 FROM devices WHERE id = ? AND member = ?', device, member.id).toArray().length === 0) {
      return fail(409, 'unknown-device', `the org state lists no device "${device}" of yours`);
    }
    const kept = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE member = ? AND endpoint != ?', member.id, endpoint as string).one().n;
    if (kept >= MAX_PUSH_SUBSCRIPTIONS) return fail(409, 'too-many', `a member keeps at most ${MAX_PUSH_SUBSCRIPTIONS} devices; delete one first`);
    const record: PushSubscriptionRecord = {
      member: member.id,
      endpoint: endpoint as string,
      keys: { p256dh: b.keys!.p256dh as string, auth: b.keys!.auth as string },
      created: iso(Date.now()),
      ...(device === undefined ? {} : { device }),
    };
    this.sql.exec(
      'INSERT OR REPLACE INTO push_subscriptions (endpoint, member, p256dh, auth, created, device) VALUES (?, ?, ?, ?, ?, ?)',
      record.endpoint,
      record.member,
      record.keys.p256dh,
      record.keys.auth,
      record.created,
      device ?? null,
    );
    return ok({ subscription: record });
  }

  /** Forgets one of the member's own subscriptions. */
  deletePushSubscription(member: MemberRecord, body: unknown): Result<{ deleted: boolean }> {
    const held = this.current(member);
    if (!held.ok) return held;
    const endpoint = typeof body === 'object' && body !== null ? (body as { endpoint?: unknown }).endpoint : undefined;
    if (typeof endpoint !== 'string') return fail(400, 'bad-shape', 'the body is {endpoint}');
    return ok({ deleted: this.sql.exec('DELETE FROM push_subscriptions WHERE endpoint = ? AND member = ?', endpoint, member.id).rowsWritten > 0 });
  }

  /** The member's subscriptions, unchecked: the contract a Worker on the code before `memberPushSubscriptions` calls. */
  pushSubscriptions(member: MemberRecord): { subscriptions: PushSubscriptionRecord[] } {
    return { subscriptions: this.subscriptionsOf([member.id]) };
  }

  /** The member's subscriptions, while the org state still lists them (`current`). */
  memberPushSubscriptions(member: MemberRecord): Result<{ subscriptions: PushSubscriptionRecord[] }> {
    const held = this.current(member);
    if (!held.ok) return held;
    return ok(this.pushSubscriptions(member));
  }

  /**
   * Sends `notice` (DX7's, from a `Project`) to the members not `looking` (those with a browser showing the project),
   * with the project's `name` as the grid shows it, and `waiting` the org's: the pushing project's own count as of the
   * push (its summary may not have reached here yet) and every other project's as last reported. Answers what
   * happened, for the suites and the logs.
   *
   * `machine` (O11 M4, additive) names the machine whose event or request it is, as its log writers do. When that
   * machine keeps a listing of the session (RL6), the push goes to the listed owners alone and carries only the v2
   * notice (`OwnerNotice`: a question or a permission `waiting`, a message `wrote`). An unlisted session, as every DX2
   * machine's is, and a push from a `Project` on the code before `machine` was passed, keep today's rule and payload.
   */
  async push(notice: Omit<PushNotice, 'name' | 'waiting'>, looking: string[], projectWaiting: number, machine?: string): Promise<Pushed> {
    const members = this.sql.exec<{ id: string }>('SELECT id FROM members').toArray().map((m) => m.id);
    const listed = typeof machine === 'string' ? this.records.listingOfNamed(machine, notice.session) : null;
    if (listed !== null) {
      const owner: OwnerNotice = { project: notice.project, machine: listed.ref, session: notice.session, kind: notice.kind === 'message' ? 'wrote' : 'waiting' };
      return this.sendPush(members.filter((id) => listed.owners.includes(id) && !looking.includes(id)), owner);
    }
    const others = this.sql.exec<{ n: number | null }>('SELECT SUM(waiting) AS n FROM summaries WHERE project != ?', notice.project).one().n ?? 0;
    const { v, project, ...rest } = notice;
    const full: PushNotice = { v, project, name: this.project(project)?.name ?? '', ...rest, waiting: others + projectWaiting };
    return this.sendPush(members.filter((id) => !looking.includes(id)), full);
  }

  /**
   * A v2 notice (RL1's `notify`, through M6's Machine DO): a session of the machine `machine` (its ref) is waiting or
   * wrote. It goes to the devices of the owners the session's listing names, members still and not `looking`, and
   * carries only `{project, machine, session, kind}`. A session the machine listed nothing for (a `private` one, whose
   * owners the hub cannot know, RL §6.2) is pushed to no one.
   */
  async notify(machine: string, notice: { project: string; session: string; kind: OwnerNotice['kind'] }, looking: string[] = []): Promise<Pushed> {
    if (typeof machine !== 'string' || typeof notice?.project !== 'string' || typeof notice.session !== 'string' || !['waiting', 'wrote'].includes(notice.kind)) {
      throw new TypeError('notify takes a machine ref and {project, session, kind: waiting | wrote}');
    }
    const owners = this.records.ownersOf(machine, notice.session);
    if (owners === null) return { sent: 0, gone: 0, failed: 0 };
    const members = new Set(this.sql.exec<{ id: string }>('SELECT id FROM members').toArray().map((m) => m.id));
    const payload: OwnerNotice = { project: notice.project, machine, session: notice.session, kind: notice.kind };
    return this.sendPush(owners.filter((id) => members.has(id) && !looking.includes(id)), payload);
  }

  /** The owners a machine's listing of a session names, or null when it listed none (M6). */
  ownersOf(machine: string, session: string): string[] | null {
    return this.records.ownersOf(machine, session);
  }

  /** One push of `payload` to each deliverable subscription of `members`. A push service that answers 404 or 410 has
   * dropped the subscription, so the hub does too. */
  private async sendPush(members: string[], payload: PushNotice | OwnerNotice): Promise<Pushed> {
    const targets = this.subscriptionsOf(members);
    if (targets.length === 0) return { sent: 0, gone: 0, failed: 0 };
    const vapid = await this.vapidKey();
    const subject = `mailto:${this.config.org.adminEmail}`;
    const outcomes = await Promise.all(
      targets.map(async (target): Promise<'sent' | 'gone' | 'failed'> => {
        try {
          const response = await fetch(await pushRequest(vapid, subject, target, payload));
          await response.arrayBuffer().catch(() => {});
          if (response.status === 404 || response.status === 410) {
            this.sql.exec('DELETE FROM push_subscriptions WHERE endpoint = ?', target.endpoint);
            return 'gone';
          }
          return response.ok ? 'sent' : 'failed';
        } catch {
          return 'failed';
        }
      }),
    );
    return { sent: outcomes.filter((o) => o === 'sent').length, gone: outcomes.filter((o) => o === 'gone').length, failed: outcomes.filter((o) => o === 'failed').length };
  }

  /** The subscriptions of `members`, but one bound to a device the head no longer lists for its member. */
  private subscriptionsOf(members: string[]): PushSubscriptionRecord[] {
    if (members.length === 0) return [];
    return this.sql
      .exec<{ endpoint: string; member: string; p256dh: string; auth: string; created: string; device: string | null }>(
        `SELECT endpoint, member, p256dh, auth, created, device FROM push_subscriptions s WHERE member IN (${members.map(() => '?').join(', ')}) AND (device IS NULL OR EXISTS (SELECT 1 FROM devices d WHERE d.id = s.device AND d.member = s.member)) ORDER BY created, endpoint`,
        ...members,
      )
      .toArray()
      .map((row) => ({ member: row.member, endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth }, created: row.created, ...(row.device === null ? {} : { device: row.device }) }));
  }

  /** Names the one machine that writes the project's git archive (DX2's `have.archive` tells it at its next `hello`), or
   * clears it. */
  designateArchive(member: MemberRecord, id: string, body: unknown): Result<{ project: ProjectRecord }> {
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    const machine = typeof body === 'object' && body !== null ? (body as { machine?: unknown }).machine : undefined;
    if (!(machine === null || typeof machine === 'string')) return fail(400, 'bad-shape', 'the body is {machine}, a name or null');
    if (!this.project(id)) return fail(404, 'unknown-project');
    let name: string | null = null;
    if (machine !== null) {
      const found = this.sql.exec<{ name: string }>("SELECT name FROM machines WHERE name_key = ? AND state = 'active'", machineNameKey(machine)).toArray()[0];
      if (!found) return fail(409, 'unknown-machine', `no enrolled machine is named "${machine}"`);
      name = found.name;
    }
    this.sql.exec('UPDATE projects SET archive_machine = ? WHERE id = ?', name, id);
    return ok({ project: this.project(id)! });
  }

  /** Expired enrollments, orphaned tokens, revocations and state announcements projects have not taken, swept when
   * their time comes. */
  async alarm(): Promise<void> {
    await this.sweep();
  }

  private enrollmentById(id: string): EnrollmentRow | undefined {
    return this.sql.exec<EnrollmentRow>(`SELECT ${ENROLLMENT_COLUMNS} FROM enrollments WHERE id = ?`, id).toArray()[0];
  }

  /** Ends an open or pending enrollment whose time is up: a pending one's machine record goes, its name is released,
   * and its token is left for the orphan sweep. */
  private expire(enrollment: EnrollmentRecord): void {
    this.ctx.storage.transactionSync(() => {
      const machine = this.sql
        .exec<{ name: string; token_name: string }>("SELECT name, token_name FROM machines WHERE enrollment = ? AND state = 'pending'", enrollment.id)
        .toArray()[0];
      if (machine) {
        this.sql.exec('DELETE FROM machines WHERE name = ?', machine.name);
        this.orphan(machine.token_name);
      }
      // A re-enrollment in place that lapsed before its machine connected (O11 M4): the machine stays, with its name,
      // project and history, and no credential; the one minted for it is refused from now and deleted by the sweep.
      const replaced = this.sql
        .exec<{ name: string; token_name: string }>("SELECT name, token_name FROM machines WHERE enrollment = ? AND state = 'active' AND confirmed IS NULL", enrollment.id)
        .toArray()[0];
      if (replaced) {
        this.sql.exec('UPDATE machines SET client_id = NULL WHERE name = ?', replaced.name);
        this.orphan(replaced.token_name);
      }
      this.sql.exec("UPDATE enrollments SET state = 'expired' WHERE id = ?", enrollment.id);
    });
  }

  private orphan(tokenName: string): void {
    this.sql.exec('INSERT OR REPLACE INTO orphans (token_name, since) VALUES (?, ?)', tokenName, iso(Date.now()));
  }

  private async sweep(): Promise<void> {
    const now = Date.now();
    const live = this.sql.exec<EnrollmentRow>(`SELECT ${ENROLLMENT_COLUMNS} FROM enrollments WHERE state IN ('open', 'pending')`).toArray();
    for (const enrollment of live) if (lapsed(enrollment, now) && !this.busy.has(enrollment.id)) this.expire(enrollment);
    await this.sweepOffline(now);
    this.sweepAnnouncements(now);
    await this.sweepRevocations();
    await this.sweepOrphans();
    await this.scheduleAlarm();
  }

  /**
   * Revokes each machine a provisioning key enrolled that has been offline the key's `offline_revoke_s` (a revoked key's
   * too: the machines it enrolled outlive it). The candidates are read in one step and revoked in turn, each bound to
   * the enrollment read: while one's revocation waits on its `Machine` object, a later one's name may be revoked and
   * enrolled anew, and that machine is not the candidate. A lease report that reaches `summary` once a candidate's
   * revocation began does not save it: one that did not complete (its `Machine` object's answer lost, the fence perhaps
   * placed) is tried again a minute on, the others going ahead, until it completes — whatever the machine's online state
   * or offline deadline reads meanwhile, since a fenced credential whose record and token stay held is neither enrolled
   * nor free. Bound to its enrollment, a retry leaves a name enrolled anew alone, and so ends.
   */
  private async sweepOffline(now: number): Promise<void> {
    const retries = [...this.unfinished].filter(([, u]) => u.began + this.offlineRetryMs() <= now).map(([enrollment, u]) => ({ name: u.name, enrollment }));
    const overdue = this.offlineDeadlines().filter((c) => c.deadline <= now && !this.unfinished.has(c.enrollment));
    for (const { name, enrollment } of [...retries, ...overdue]) {
      // Read again at dispatch: while this sweep awaited an earlier candidate, another may have begun this one, failed it
      // (its retry not yet due), or finished it (a retry whose entry is gone). A row already revoked is the revoker's to
      // answer as gone, before any fence.
      const live = this.unfinished.get(enrollment);
      if (live ? live.began + this.offlineRetryMs() > Date.now() : retries.some((r) => r.enrollment === enrollment)) continue;
      this.unfinished.set(enrollment, { name, began: Date.now() });
      try {
        await this.revokeMachine(name, { enrollment });
        this.unfinished.delete(enrollment);
      } catch (error) {
        console.error(JSON.stringify({ desk: 'offline-revoke', machine: name, message: error instanceof Error ? error.message : String(error) }));
      }
    }
  }

  /** How long an unfinished offline revocation waits before it is tried again. */
  protected offlineRetryMs(): number {
    return RETRY_MS;
  }

  /** Each active machine enrolled through a key with an offline time, offline now, and when that time is up: from `seen`,
   * when it last went offline, or from its confirmation for a machine never seen online. */
  private offlineDeadlines(): Array<{ name: string; enrollment: string; deadline: number }> {
    return this.sql
      .exec<{ name: string; enrollment: string; since: string; offline_revoke_s: number }>(
        "SELECT m.name AS name, m.enrollment AS enrollment, COALESCE(m.seen, m.confirmed) AS since, k.offline_revoke_s AS offline_revoke_s FROM machines m JOIN enrollments e ON e.id = m.enrollment JOIN provisioning_keys k ON k.id = e.key WHERE m.state = 'active' AND m.online = 0 AND k.offline_revoke_s IS NOT NULL ORDER BY m.name",
      )
      .toArray()
      .map((m) => ({ name: m.name, enrollment: m.enrollment, deadline: Date.parse(m.since) + m.offline_revoke_s * 1000 }));
  }

  /** Tells each project a revocation it has not taken (`Project.forget` keeps the newest generation it is told, so a
   * second telling is harmless). A row goes once its project answered, unless a later revocation of the name raised its
   * generation meanwhile: that one is still to be told. */
  private async sweepRevocations(): Promise<void> {
    const rows = this.sql.exec<{ machine: string; project: string; generation: number }>('SELECT machine, project, generation FROM revocations').toArray();
    if (rows.length === 0) return;
    const org = this.ensureOrg().id;
    await Promise.allSettled(
      rows.map(async ({ machine, project, generation }) => {
        await this.env.PROJECT.get(this.env.PROJECT.idFromName(`${org}:${project}`)).forget(org, project, machine, generation);
        this.sql.exec('DELETE FROM revocations WHERE machine = ? AND project = ? AND generation = ?', machine, project, generation);
      }),
    );
  }

  /** Deletes orphaned tokens by name, each on its name's queue. A name some machine holds again is that machine's: its
   * redemption, queued behind this deletion, deletes every token of the name before it mints, so the orphan's row just
   * goes. Whether the name is held is read on the queue, so a redemption that reserved it meanwhile is seen. */
  private async sweepOrphans(): Promise<void> {
    const orphans = this.sql.exec<{ token_name: string }>('SELECT token_name FROM orphans').toArray();
    if (orphans.length === 0) return;
    const api = serviceTokens(this.config.api);
    for (const { token_name } of orphans) {
      await this.onName(token_name, async () => {
        // A machine without a credential (a re-enrollment that lapsed) holds no token of the name: its tokens go.
        const held = this.sql.exec('SELECT 1 FROM machines WHERE token_name = ? AND client_id IS NOT NULL', token_name).toArray().length > 0;
        if (!held) {
          try {
            await api.deleteNamed(token_name);
          } catch (error) {
            if (error instanceof ServiceTokenApiError) return;
            throw error;
          }
        }
        this.sql.exec('DELETE FROM orphans WHERE token_name = ?', token_name);
      });
    }
  }

  /** Runs `work` once every piece of API work queued before it under `tokenName` has settled. */
  private onName<T>(tokenName: string, work: () => Promise<T>): Promise<T> {
    const run = (this.nameQueues.get(tokenName) ?? Promise.resolve()).then(work);
    const tail = run.catch(() => {});
    this.nameQueues.set(tokenName, tail);
    void tail.then(() => {
      if (this.nameQueues.get(tokenName) === tail) this.nameQueues.delete(tokenName);
    });
    return run;
  }

  /** The alarm at the next expiry or offline revocation, or sooner when an orphan or a revocation waits for a retry;
   * never in the past, so an enrollment kept open by a mint in flight does not spin it, and an offline revocation that
   * failed waits for its retry. */
  protected async scheduleAlarm(): Promise<void> {
    const now = Date.now();
    const next = this.sql
      .exec<{ expires: string }>("SELECT expires FROM enrollments WHERE state IN ('open', 'pending')")
      .toArray()
      .map((e) => Date.parse(e.expires));
    for (const { enrollment, deadline } of this.offlineDeadlines()) if (!this.unfinished.has(enrollment)) next.push(deadline);
    for (const { began } of this.unfinished.values()) next.push(began + this.offlineRetryMs());
    if (this.sql.exec('SELECT 1 FROM orphans UNION ALL SELECT 1 FROM revocations LIMIT 1').toArray().length > 0) next.push(now + RETRY_MS);
    const announcement = this.sql.exec<{ due: number | null }>('SELECT MIN(due) AS due FROM announcements').one().due;
    if (announcement !== null) next.push(announcement);
    if (next.length === 0) return;
    const at = Math.max(Math.min(...next), now + 250);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= now) await this.ctx.storage.setAlarm(at);
  }

  /**
   * The org, created from the deploy configuration the first time it is needed, with its admin as the first member.
   * This Registry is the one the Worker names by the configured org id, so a stored org of another id was made under a
   * previous configuration: after a deploy, Durable Objects, new ones included, run the previous version with its
   * variables for minutes (M5). While nothing was built on the stored id (no machine, enrollment, project, wrapped key,
   * or provisioning key, whose code carries the id), the org takes its id and name from the configuration; after that,
   * the stored org stands.
   */
  private ensureOrg(): OrgRecord {
    const { org: config } = this.config;
    const existing = this.sql.exec<OrgRecord>('SELECT id, name, created, key_check FROM org').toArray()[0];
    if (existing && existing.id !== config.id && existing.key_check === null && !this.holdsAnything()) {
      this.sql.exec('UPDATE org SET id = ?, name = ?', config.id, config.name);
      return { ...existing, id: config.id, name: config.name };
    }
    if (existing) return existing;
    const created = iso(Date.now());
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO org (id, name, created, key_check) VALUES (?, ?, ?, NULL)', config.id, config.name, created);
      this.sql.exec('INSERT INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', newId(), config.adminEmail.toLowerCase(), 'admin', created);
    });
    return { id: config.id, name: config.name, created, key_check: null };
  }

  private holdsAnything(): boolean {
    return ['machines', 'enrollments', 'projects'].some((table) => this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length > 0) || this.provisioning.any() || this.chain.any();
  }

  // ---- The org's signed state (RL5; O11 M3) --------------------------------------------------------------------

  /** The head, the transitions and the certificates; with `since` (a version, as the query gives it), the chain after it. */
  orgState(since: string | null): Result<OrgStateView> {
    this.ensureOrg();
    if (since === null) return ok(this.stateView());
    if (!/^(0|[1-9][0-9]{0,15})$/.test(since) || !Number.isSafeInteger(Number(since))) return fail(400, 'bad-shape', '?since= is a version: a whole number from 0');
    return ok(this.stateView(Number(since)));
  }

  /** The chain's view, with the machine certificates and retirements kept beside it (O11 M4). */
  private stateView(since?: number): OrgStateView {
    return { ...this.chain.view(since), certificates: this.records.certificates() };
  }

  /** The head as `GET /api/org/state` answers it, for a `Project` verifying v2 events (M5) to cache. */
  head(): OrgStateView {
    this.ensureOrg();
    return this.stateView();
  }

  /**
   * A genesis or a successor (`OrgChain.submit`). Once one is accepted, the members it dropped are refused here at once,
   * their grid sockets close `4403 removed`, every project is told the new version and the members it holds, and every
   * app's registry socket is sent its `state` notice (O11 M7).
   */
  async submitState(member: MemberRecord, body: unknown): Promise<Result<OrgStateAccepted>> {
    if (body === undefined) return fail(400, 'bad-shape', 'the body is a SignedOrgState, {state, sigs}');
    const org = this.ensureOrg();
    const accepted = await this.chain.submit(body, member, org.id, { email: this.config.org.adminEmail });
    if (!accepted.ok) return accepted;
    const { version, removed } = accepted.value;
    for (const socket of this.ctx.getWebSockets()) {
      if (!removed.includes((socket.deserializeAttachment() as { member?: string } | null)?.member ?? '')) continue;
      try {
        socket.close(4403, 'removed');
      } catch {
        // already closing
      }
    }
    // Stored in the step that accepted the state (no await between), so a reset never loses one; a project still owed
    // an older version is owed this one instead, which carries everything the older one did.
    // Every relay's object (O11 M6) is owed it too, by the same table: its endpoint's `state` notice, and its removed
    // members' app sockets closed.
    const members = this.memberIds();
    const targets = [
      ...this.sql.exec<{ id: string }>('SELECT id FROM projects').toArray().map((p) => p.id),
      ...this.sql.exec<{ ref: string }>('SELECT ref FROM relays').toArray().map((r) => relayTarget(r.ref)),
    ];
    for (const target of targets) this.owe(target, version, members);
    for (const target of targets) void this.announce(org.id, { project: target, version, members });
    this.toApps({ t: 'state', version });
    await this.scheduleAlarm();
    return ok({ version });
  }

  /** The head's member ids, as an announcement carries them. */
  private memberIds(): string {
    return JSON.stringify(this.sql.exec<{ id: string }>('SELECT id FROM members ORDER BY id').toArray().map((m) => m.id));
  }

  /** Stores the announcement of `version` owed to `target`; one still owed an older version is owed this one instead,
   * which carries everything the older one did. */
  private owe(target: string, version: number, members: string): void {
    this.sql.exec(
      'INSERT INTO announcements (project, version, members, attempts, due) VALUES (?, ?, ?, 0, ?) ON CONFLICT (project) DO UPDATE SET version = excluded.version, members = excluded.members, attempts = 0, due = excluded.due WHERE excluded.version > announcements.version',
      target,
      version,
      members,
      Date.now() + this.retryBaseMs(),
    );
  }

  /** The head's version, or null before any state: RL1's `state` notice on an endpoint's welcome (O11 M6). */
  stateVersion(): number | null {
    return this.chain.head()?.state.version ?? null;
  }

  /**
   * The ref a machine's RL1 socket is addressed by (O11 M6): the one a signed record binds its name to, the head's live
   * `machines` entry or a kept certificate (`OrgRecords.boundRef`). A ref the machine posted with its key alone binds
   * nothing (any enrollment can post any ref): such a machine is `not-listed` until the head lists it, and one that
   * posted none has `no-ref`. Never taken from the client, so no machine reaches another's object.
   */
  machineRefOf(machine: MachineRecord): { ref: string } | { error: 'no-ref' | 'not-listed' } {
    const ref = this.records.boundRef(machine.name);
    if (ref === null) return { error: this.records.machineKey(machine.enrollment) ? 'not-listed' : 'no-ref' };
    this.relayed(ref);
    return { ref };
  }

  /** The ref an app's socket to a machine names (O11 M6): a ref a signed record binds, or a machine name such a record
   * binds to one (`machineRefOf`'s); null for neither. */
  machineRefNamed(machine: string): string | null {
    const ref = this.records.refBound(machine) ? machine : this.records.boundRef(machine);
    if (ref !== null) this.relayed(ref);
    return ref;
  }

  /** Whether a signed record still binds the machine name `name` to `ref` (`machineRefOf`'s binding): asked by the ref's
   * object as it installs an endpoint the Worker resolved earlier, so a rename accepted meanwhile refuses it. */
  machineBinds(name: string, ref: string): boolean {
    return this.records.boundRef(name) === ref;
  }

  /** A relay's object, kept from its first socket on: it is owed every state from then (`submitState`), and the head
   * now, so the members it admits are the head's though no state has been accepted since. */
  private relayed(ref: string): void {
    if (this.sql.exec('INSERT OR IGNORE INTO relays (ref) VALUES (?)', ref).rowsWritten === 0) return;
    const version = this.chain.head()?.state.version;
    if (version === undefined) return;
    const members = this.memberIds();
    this.owe(relayTarget(ref), version, members);
    void this.announce(this.ensureOrg().id, { project: relayTarget(ref), version, members });
    void this.scheduleAlarm().catch(() => {});
  }

  /**
   * Tells a project the org state advanced to `version`, holding `members` (`Project.stateAdvanced`), or a relay's
   * object (`ref:<ref>`, `Machine.relayState`) likewise. The announcement
   * stays stored until the project answers, or a newer one replaces it; one that fails is sent again by the alarm, its
   * wait growing as retry.ts's does, up to a minute, for as long as it takes: a project that never hears of a removal
   * would keep serving the removed member. A project still on the code before the announcement lacks the method: it
   * holds no state to refresh, and its sockets go at its code update, so it is taken as told.
   */
  private async announce(org: string, owed: { project: string; version: number; members: string }): Promise<void> {
    const { project, version } = owed;
    const members = JSON.parse(owed.members) as string[];
    const ref = project.startsWith(RELAY_TARGET) ? project.slice(RELAY_TARGET.length) : null;
    let failure: { error: unknown } | null = null;
    try {
      if (ref === null) await this.env.PROJECT.get(this.env.PROJECT.idFromName(`${org}:${project}`)).stateAdvanced(version, members);
      else await this.env.MACHINE.get(this.env.MACHINE.idFromName(relayObjectName(org, ref))).relayState(version, members);
    } catch (error) {
      if (!lacksMethod(error, ref === null ? 'stateAdvanced' : 'relayState')) failure = { error };
    }
    if (failure === null) {
      this.sql.exec('DELETE FROM announcements WHERE project = ? AND version = ?', project, version);
      return;
    }
    const row = this.sql.exec<{ attempts: number }>('SELECT attempts FROM announcements WHERE project = ? AND version = ?', project, version).toArray()[0];
    if (!row) return;
    const attempt = row.attempts + 1;
    const wait = retryDelay(Math.min(attempt, RETRY_ATTEMPTS), this.retryBaseMs(), failure.error);
    this.sql.exec('UPDATE announcements SET attempts = ?, due = ? WHERE project = ? AND version = ?', attempt, Date.now() + wait, project, version);
    console.log(JSON.stringify({ desk: 'registry', event: 'announce-failed', project, version, attempt, error: described(failure.error), retry_ms: Math.round(wait) }));
    await this.scheduleAlarm();
  }

  /** Sends again every announcement whose time has come, not waiting for the answers (a redemption sweeps too); one in
   * flight waits a minute before it is sent again, unless its answer says otherwise first. */
  private sweepAnnouncements(now: number): void {
    const due = this.sql.exec<{ project: string; version: number; members: string }>('SELECT project, version, members FROM announcements WHERE due <= ?', now).toArray();
    if (due.length === 0) return;
    const org = this.ensureOrg().id;
    for (const owed of due) this.sql.exec('UPDATE announcements SET due = ? WHERE project = ? AND version = ?', now + RETRY_CAP_MS, owed.project, owed.version);
    for (const owed of due) void this.announce(org, owed);
  }

  /** A root transition the recovery key signed against the head (`OrgChain.submitTransition`). */
  async submitTransition(member: MemberRecord, body: unknown): Promise<Result<TransitionAccepted>> {
    if (body === undefined) return fail(400, 'bad-shape', 'the body is a signed RootTransition, {body, sig}');
    this.ensureOrg();
    return this.chain.submitTransition(body, member);
  }

  /** A new device's pairing entry, posted as its member (`OrgChain.keepPending`). */
  keepPendingDevice(member: MemberRecord, body: unknown): Result<{ pending: PendingDevice }> {
    const held = this.current(member);
    if (!held.ok) return held;
    return this.chain.keepPending(member.id, body);
  }

  /** The member's pairing entries, for their devices to approve. */
  pendingDevices(member: MemberRecord): Result<PendingDevices> {
    const held = this.current(member);
    if (!held.ok) return held;
    return ok({ pending: this.chain.pending(member.id) });
  }

  /**
   * `member` as the members table holds them now. The Worker resolved them before it read the request's body, and a
   * state accepted since may have removed or demoted them, so every change the Registry makes for a member checks
   * here, in the synchronous step of the change itself (after the method's last await): no state comes between.
   */
  private current(member: MemberRecord, role?: 'admin'): Result<MemberRecord> {
    const now = this.sql.exec<MemberRecord>('SELECT id, email, role, created FROM members WHERE id = ?', member.id).toArray()[0];
    if (!now) return fail(403, 'not-a-member', 'the org state no longer lists you');
    if (role === 'admin' && now.role !== 'admin') return fail(403, 'not-admin');
    return ok(now);
  }

  // ---- Hub v2's signed records (O11 M4; RL §5.3, RL6) -----------------------------------------------------------

  /**
   * `machine`'s record as resolved, still held: the same name, enrollment and credential. The Worker resolved the machine
   * before it read the request's body, and a revocation or re-enrollment may have come since, so a change a machine makes
   * checks here as a member's checks `current`, in the change's synchronous step.
   */
  private enrolled(machine: MachineRecord): Result<MachineRecord> {
    const held = this.sql
      .exec('SELECT name FROM machines WHERE name = ? AND enrollment = ? AND client_id IS ?', machine.name, machine.enrollment, machine.client_id)
      .toArray()[0];
    return held ? ok(machine) : fail(403, 'not-enrolled', 'this credential no longer holds the machine’s enrollment');
  }

  /** A v2 machine's key, ref and pairing MAC, posted once redeemed (`OrgRecords.keepMachineKey`). */
  keepMachineKey(machine: MachineRecord, body: unknown): Result<{ key: EnrollmentKey; kept: boolean }> {
    const held = this.enrolled(machine);
    if (!held.ok) return held;
    return this.records.keepMachineKey(machine, body);
  }

  /** The key a machine posted under an enrollment, for the member who made the enrollment. */
  enrollmentKey(member: MemberRecord, id: string): Result<EnrollmentKey> {
    const held = this.current(member);
    if (!held.ok) return held;
    const enrollment = this.enrollmentById(id);
    if (!enrollment) return fail(404, 'unknown-enrollment');
    if (enrollment.created_by !== member.id) return fail(403, 'not-yours', 'only the member who made the enrollment fetches its machine’s key');
    const key = this.records.machineKey(id);
    return key ? ok(key) : fail(404, 'no-key', 'the machine has not posted its key yet');
  }

  /** A delegated machine's certificate (`OrgRecords.storeCert`), for its own name under the key it enrolled through. */
  async storeCert(machine: MachineRecord, body: unknown): Promise<Result<{ stored: boolean }>> {
    const held = this.enrolled(machine);
    if (!held.ok) return held;
    const enrollment = this.enrollmentById(machine.enrollment);
    const poster = { name: machine.name, delegation: enrollment?.key ?? null, use: enrollment?.use ?? null };
    return this.records.storeCert(poster, body, () => this.enrolled(machine));
  }

  /** A certificate's retirement by its delegation's key (`OrgRecords.storeRetirement`), relayed by a member. */
  async memberRetiresCert(member: MemberRecord, body: unknown): Promise<Result<{ stored: boolean }>> {
    const held = this.current(member);
    if (!held.ok) return held;
    return this.records.storeRetirement(body, () => this.current(member));
  }

  /** A certificate's retirement by its delegation's key (`OrgRecords.storeRetirement`), relayed by a machine. */
  async machineRetiresCert(machine: MachineRecord, body: unknown): Promise<Result<{ stored: boolean }>> {
    const held = this.enrolled(machine);
    if (!held.ok) return held;
    return this.records.storeRetirement(body, () => this.enrolled(machine));
  }

  /** A machine-signed listing (RL1's `listing`, through M6's Machine DO). */
  async storeListing(record: unknown): Promise<Result<{ stored: boolean }>> {
    const kept = await this.records.storeListing(record);
    if (!kept.ok) return kept;
    // Relayed to the members' app sockets as it is stored (OX8; O11 M7); one held already is not. A withdrawn one
    // (`LISTING_GONE`) goes to the apps that could see the revision it replaced: every app, since every member sees
    // every live listing, when that revision was live; none when the session was withdrawn already or never listed.
    const listing = record as Signed<Listing>;
    if (kept.value.stored && (!isListingGone(listing.body) || kept.value.replacedLive)) this.toApps({ t: 'listing', record: listing });
    return { ok: true, value: { stored: kept.value.stored } };
  }

  /** A machine-signed endpoint record (RL1's `endpoint`, through M6's Machine DO). */
  storeEndpoint(record: unknown): Promise<Result<{ stored: boolean }>> {
    return this.records.storeEndpoint(record);
  }

  /** The listings kept, a project's alone when named, with their machines' endpoint records. */
  listings(member: MemberRecord, project: string | null): Result<Listings> {
    const held = this.current(member);
    if (!held.ok) return held;
    return ok(this.records.listings(project));
  }

  /** A machine's endpoint record, by its ref or its name. */
  machineEndpoint(member: MemberRecord, machine: string): Result<MachineEndpoint> {
    const held = this.current(member);
    if (!held.ok) return held;
    const record = this.records.endpoint(machine);
    return record ? ok({ record }) : fail(404, 'no-endpoint', `no endpoint record is kept for "${machine}"`);
  }

  // ---- The org key's wrapped copies (DX7) ----------------------------------------------------------------------

  orgKeys(): { key_check: string | null; keys: StoredKey[] } {
    return { key_check: this.ensureOrg().key_check, keys: this.keys.list() };
  }

  /** `orgKeys`, or `410 retired` once the copies are purged (O14 M5a). */
  wrappedOrgKeys(): Result<{ key_check: string | null; keys: StoredKey[] }> {
    return this.keyPurged() === null ? ok(this.orgKeys()) : retiredKey(410);
  }

  /**
   * Deletes every wrapped copy and the org's key check and auth, on the head's word (`legacyRetired`), and records the
   * purge; the record again once done. One synchronous step, so no state accepted meanwhile can drop the retirement
   * between the check and the deletion (OrgChain's commit refuses that drop once the record stands).
   */
  purgeOrgKeys(member: MemberRecord): Result<OrgKeysPurged> {
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    const held = this.keyPurged();
    if (held !== null) return ok({ purged: held });
    const head = this.chain.head();
    if (head?.state.legacyRetired === undefined) return fail(409, 'not-retired', 'the org state does not retire the org key (legacyRetired): retire it in the state first');
    const purged = { version: head.state.version, at: iso(Date.now()) };
    this.ctx.storage.transactionSync(() => {
      this.keys.purge();
      this.sql.exec('UPDATE org SET key_check = NULL, key_auth = NULL, key_purged = ?', JSON.stringify(purged));
    });
    return ok({ purged });
  }

  /** The purge's record, or null while the copies are held. */
  private keyPurged(): OrgKeysPurged['purged'] | null {
    const row = this.sql.exec<{ key_purged: string | null }>('SELECT key_purged FROM org').toArray()[0];
    return row?.key_purged ? (JSON.parse(row.key_purged) as OrgKeysPurged['purged']) : null;
  }

  /** Adds a wrapped key; the first sets the org's `key_check` and `key_auth` in the same step as its insert. */
  async addOrgKey(member: MemberRecord, body: unknown): Promise<Result<{ key: StoredKey }>> {
    const authHash = await this.authHash(body);
    // From here to the insert, nothing else runs in this object: two first posts cannot both set the check, and no
    // state can demote the admin between the check and the insert.
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    if (this.keyPurged() !== null) return retiredKey(409);
    const org = this.ensureOrg();
    const keyAuth = this.keyAuth();
    const setOrg = (check: string, auth: string) => this.sql.exec('UPDATE org SET key_check = ?, key_auth = ?', check, auth);
    const added = this.keys.add(admin.value, body, { keyCheck: org.key_check, keyAuth }, authHash, setOrg, newId(), iso(Date.now()));
    return added.ok ? ok({ key: added.value }) : fail(added.status, added.error, added.message);
  }

  async removeOrgKey(member: MemberRecord, id: string, body: unknown): Promise<Result<WrappedKeyRemoved>> {
    const authHash = await this.authHash(body);
    const admin = this.current(member, 'admin');
    if (!admin.ok) return admin;
    if (this.keyPurged() !== null) return retiredKey(410);
    const removed = this.keys.remove(id, this.keyAuth(), authHash);
    return removed.ok ? ok({ removed: removed.value }) : fail(removed.status, removed.error, removed.message);
  }

  /** SHA-256 of a body's `auth` (32 bytes, canonical base64url), base64url; null when it carries none. The org keeps only
   * this digest (`key_auth`), and compares digests, never the `auth` itself. */
  private async authHash(body: unknown): Promise<string | null> {
    const auth = typeof body === 'object' && body !== null ? (body as { auth?: unknown }).auth : undefined;
    if (!isBase64urlOf(auth, 32)) return null;
    return base64urlEncode(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(base64urlDecode(auth as string)))));
  }

  /** The org's `key_auth`, never returned by any endpoint. */
  private keyAuth(): string | null {
    return this.sql.exec<{ key_auth: string | null }>('SELECT key_auth FROM org').toArray()[0]?.key_auth ?? null;
  }
}
