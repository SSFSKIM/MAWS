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
import { DurableObject } from 'cloudflare:workers';
import { hubConfig, MEMBER_HEADER, type Env, type HubConfig } from '../env';
import type { AccessIdentity } from '../identity/access';
import { ServiceTokenApiError, serviceTokens } from '../identity/service-tokens';
import { importVapidKey, pushRequest, type VapidKey } from '../push/web-push';
import { base64urlDecode, base64urlEncode, isBase64urlOf } from '../protocol/base64url';
import type { GridDown, MachineSummary, ProjectSummary, PushNotice } from '../protocol/browser';
import type { OrgFrame } from '../protocol/machine';
import { toWire } from '../protocol/parts';
import {
  ENROLLMENT_TTL_S,
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
  type Redeemed,
  type WrappedKeyRemoved,
} from '../protocol/identity';
import { OrgKeys, type StoredKey } from './org-keys';
import { described } from './project';
import { checkRequest, ProvisioningKeys, type KeyRow } from './provisioning-keys';
import { RETRY_ATTEMPTS, RETRY_BASE_MS, retryDelay } from './retry';

export type Principal = { kind: 'member'; org: OrgRecord; member: MemberRecord } | { kind: 'machine'; org: OrgRecord; machine: MachineRecord };

/** An answer for the Worker to send: a value, or an HTTP status with DX7's `{error, message?}`. */
export type Result<T> = { ok: true; value: T } | { ok: false; status: number; error: string; message?: string };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = (status: number, error: string, message?: string): Result<never> => ({ ok: false, status, error, ...(message ? { message } : {}) });

const SCHEMA = `
CREATE TABLE IF NOT EXISTS org (id TEXT PRIMARY KEY, name TEXT NOT NULL, created TEXT NOT NULL, key_check TEXT, key_auth TEXT);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, role TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS machines (
  name TEXT PRIMARY KEY, name_key TEXT NOT NULL UNIQUE, client_id TEXT UNIQUE, token_name TEXT NOT NULL,
  state TEXT NOT NULL, enrollment TEXT NOT NULL, created TEXT NOT NULL, confirmed TEXT,
  online INTEGER NOT NULL DEFAULT 0, seen TEXT);
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created TEXT NOT NULL,
  expires TEXT NOT NULL, ttl_s INTEGER NOT NULL, state TEXT NOT NULL, machine TEXT, key TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, registered_by TEXT NOT NULL, created TEXT NOT NULL, archive_machine TEXT,
  kind TEXT NOT NULL DEFAULT 'hub', machine TEXT, retired INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS orphans (token_name TEXT PRIMARY KEY, since TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS revocations (machine TEXT NOT NULL, project TEXT NOT NULL, generation INTEGER NOT NULL, PRIMARY KEY (machine, project));
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY, member TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS summaries (
  project TEXT PRIMARY KEY, machines INTEGER NOT NULL, machines_online INTEGER NOT NULL, working INTEGER NOT NULL,
  waiting INTEGER NOT NULL, report_seq INTEGER, live INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS machine_states (
  project TEXT NOT NULL, name_key TEXT NOT NULL, client TEXT NOT NULL, online INTEGER NOT NULL,
  PRIMARY KEY (project, name_key, client));
`;

/** Columns added to tables a registry stored before them, with what an older row reads as. */
const ADDED_COLUMNS: Record<string, string[]> = {
  org: ['key_check TEXT', 'key_auth TEXT'],
  machines: ['online INTEGER NOT NULL DEFAULT 0', 'seen TEXT'],
  // The provisioning key an enrollment was made through; null for a one-time token's.
  enrollments: ['key TEXT'],
  projects: ["kind TEXT NOT NULL DEFAULT 'hub'", 'machine TEXT', 'retired INTEGER NOT NULL DEFAULT 0'],
  summaries: ['report_seq INTEGER', 'live INTEGER NOT NULL DEFAULT 0'],
};

/** A member's devices: enough for a person's phones, tablets, and browsers, and a bound on what one member can store. */
const MAX_PUSH_SUBSCRIPTIONS = 20;
const MAX_ENDPOINT = 2048;
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
const ENROLLMENT_COLUMNS = 'id, created_by, created, expires, state, machine, ttl_s, key';
const PROJECT_COLUMNS = 'id, name, registered_by, created, archive_machine, kind, retired';
type ProjectRow = Omit<ProjectRecord, 'retired'> & { retired: number };
const projectOf = (row: ProjectRow): ProjectRecord => ({ ...row, retired: row.retired === 1 });
/** The `kv` key of the directory's version, raised by every change it carries (`directoryChanged`). */
const DIRECTORY_VERSION = 'directory-version';
/** How soon a failed orphan deletion, or a revocation a project has not taken, is tried again. */
const RETRY_MS = 60_000;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** 128 random bits as lowercase hex (DX7's member id; also an enrollment's id). */
const newId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const iso = (ms: number) => new Date(ms).toISOString();
const lapsed = (enrollment: { expires: string }, now = Date.now()) => Date.parse(enrollment.expires) <= now;

type EnrollmentRow = EnrollmentRecord & { ttl_s: number; key: string | null };

export class Registry extends DurableObject<Env> {
  /** Enrollments whose mint is in flight in this object's life. */
  private readonly busy = new Set<string>();
  /** Per service-token name, the tail of the API work queued under it (an object restart ends the work with it). */
  private readonly nameQueues = new Map<string, Promise<unknown>>();

  private readonly keys: OrgKeys;
  private readonly provisioning: ProvisioningKeys;
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
      if (listed) this.toGrid({ t: 'summary', project: this.summaryOf(this.project(project)!) });
      this.directoryChanged();
      return { kind: 'machine', org, machine: { ...machine, state: 'active', confirmed } };
    }
    return { kind: 'machine', org, machine };
  }

  /** A one-time token for an admin to build an enrollment code from; the hub keeps only its hash. */
  async createEnrollment(member: MemberRecord, body: unknown): Promise<Result<EnrollmentIssued>> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
    const ttl = typeof body === 'object' && body !== null ? ((body as { ttl_s?: unknown }).ttl_s ?? ENROLLMENT_TTL_S) : undefined;
    if (typeof ttl !== 'number' || !Number.isInteger(ttl) || ttl < 1 || ttl > MAX_ENROLLMENT_TTL_S) {
      return fail(400, 'bad-shape', `the body is {ttl_s?}, a whole number of seconds from 1 to ${MAX_ENROLLMENT_TTL_S}`);
    }
    const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const hash = await sha256(token);
    const now = Date.now();
    const enrollment: EnrollmentRecord = { id: newId(), created_by: member.id, created: iso(now), expires: iso(now + ttl * 1000), state: 'open', machine: null };
    this.sql.exec(
      "INSERT INTO enrollments (id, token_hash, created_by, created, expires, ttl_s, state, machine) VALUES (?, ?, ?, ?, ?, ?, 'open', NULL)",
      enrollment.id,
      hash,
      enrollment.created_by,
      enrollment.created,
      enrollment.expires,
      ttl,
    );
    await this.scheduleAlarm();
    return ok({ enrollment, token });
  }

  /** A provisioning key for an admin to build a provisioning code from; the hub keeps only its secret's hash. */
  async createProvisioningKey(member: MemberRecord, body: unknown): Promise<Result<ProvisioningKeyIssued>> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
    const request = checkRequest(body);
    if (!request.ok) return fail(400, 'bad-shape', request.message);
    const token = base64urlEncode(crypto.getRandomValues(new Uint8Array(32)));
    const key = this.provisioning.add(member, request.value, newId(), await sha256(token), Date.now());
    return ok({ key, token });
  }

  provisioningKeys(): ProvisioningKeyRecord[] {
    return this.provisioning.list();
  }

  /** Stops new enrollments through the key; the machines it enrolled stay. A second revocation keeps the first's time. */
  revokeProvisioningKey(member: MemberRecord, id: string): Result<ProvisioningKeyRevoked> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
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
      // A rotation: the credential minted before stops at the hub at once, before Cloudflare deletes it.
      this.rotate(id, machine, expires);
    }
    return this.mint(id, machine, tokenName, org.id);
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
      this.provisioning.use(key.id);
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
      return await this.onName(tokenName, async (): Promise<Result<Redeemed>> => {
        const api = serviceTokens(this.config.api);
        await api.deleteNamed(tokenName);
        const minted = await api.create(tokenName);
        // A revocation may have run while the API answered; then the token is no machine's.
        const held = this.sql.exec<{ enrollment: string }>('SELECT enrollment FROM machines WHERE name = ?', machine).toArray()[0];
        if (this.enrollmentById(id)?.state !== 'pending' || held?.enrollment !== id) {
          await api.delete(minted.id).catch(() => this.orphan(tokenName));
          return fail(410, 'expired', 'the enrollment ended while its token was minted');
        }
        this.sql.exec('UPDATE machines SET client_id = ? WHERE name = ?', minted.client_id, machine);
        return ok({ org, machine, client_id: minted.client_id, client_secret: minted.client_secret });
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
    if (member.role !== 'admin') return fail(403, 'not-admin');
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

  machines(): MachineRecord[] {
    return this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines ORDER BY name`).toArray();
  }

  projects(): ProjectRecord[] {
    return this.sql.exec<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created, id`).toArray().map(projectOf);
  }

  project(id: string): ProjectRecord | null {
    const row = this.sql.exec<ProjectRow>(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`, id).toArray()[0];
    return row ? projectOf(row) : null;
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
      this.toGrid({ t: 'summary', project: this.summaryOf(project) });
      this.directoryChanged();
    }
    return project;
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

  // ---- The grid (DX3's registry socket) ------------------------------------------------------------------------

  /** A member's grid socket (the Worker sends only a member's): every project's summary, then each change. */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/grid') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ member: request.headers.get(MEMBER_HEADER) ?? '' });
    this.send(server, this.gridFrame());
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

  /** A frame above `FRAME_LIMIT` (a grid of many projects) goes in numbered parts, as on a project socket. */
  private send(socket: WebSocket, frame: GridDown): void {
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

  /** Keeps a member device's subscription, keyed by its endpoint (a device subscribing again replaces its keys). */
  keepPushSubscription(member: MemberRecord, body: unknown): Result<{ subscription: PushSubscriptionRecord }> {
    const b = (typeof body === 'object' && body !== null ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
    const endpoint = b.endpoint;
    let url: URL | undefined;
    try {
      url = typeof endpoint === 'string' && endpoint.length <= MAX_ENDPOINT ? new URL(endpoint) : undefined;
    } catch {
      url = undefined;
    }
    if (url?.protocol !== 'https:' || !isBase64urlOf(b.keys?.p256dh, 65) || !isBase64urlOf(b.keys?.auth, 16)) {
      return fail(400, 'bad-shape', 'the body is {endpoint: an https URL, keys: {p256dh: 65 bytes, auth: 16 bytes}}, base64url as PushSubscription.toJSON() gives them');
    }
    const kept = this.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM push_subscriptions WHERE member = ? AND endpoint != ?', member.id, endpoint as string).one().n;
    if (kept >= MAX_PUSH_SUBSCRIPTIONS) return fail(409, 'too-many', `a member keeps at most ${MAX_PUSH_SUBSCRIPTIONS} devices; delete one first`);
    const record: PushSubscriptionRecord = { member: member.id, endpoint: endpoint as string, keys: { p256dh: b.keys!.p256dh as string, auth: b.keys!.auth as string }, created: iso(Date.now()) };
    this.sql.exec(
      'INSERT OR REPLACE INTO push_subscriptions (endpoint, member, p256dh, auth, created) VALUES (?, ?, ?, ?, ?)',
      record.endpoint,
      record.member,
      record.keys.p256dh,
      record.keys.auth,
      record.created,
    );
    return ok({ subscription: record });
  }

  /** Forgets one of the member's own subscriptions. */
  deletePushSubscription(member: MemberRecord, body: unknown): Result<{ deleted: boolean }> {
    const endpoint = typeof body === 'object' && body !== null ? (body as { endpoint?: unknown }).endpoint : undefined;
    if (typeof endpoint !== 'string') return fail(400, 'bad-shape', 'the body is {endpoint}');
    return ok({ deleted: this.sql.exec('DELETE FROM push_subscriptions WHERE endpoint = ? AND member = ?', endpoint, member.id).rowsWritten > 0 });
  }

  pushSubscriptions(member: MemberRecord): { subscriptions: PushSubscriptionRecord[] } {
    return { subscriptions: this.subscriptionsOf([member.id]) };
  }

  /**
   * One push of `notice` to each subscribed device of every member not in `looking` (those with a browser showing the
   * project). A push service that answers 404 or 410 has dropped the subscription, so the hub does too. Answers what
   * happened, for the suites and the logs.
   */
  /** Sends `notice` to the members not `looking`, with the project's `name` as the grid shows it, and `waiting` the org's: the pushing project's own count as of the
   * push (its summary may not have reached here yet) and every other project's as last reported. */
  async push(notice: Omit<PushNotice, 'name' | 'waiting'>, looking: string[], projectWaiting: number): Promise<{ sent: number; gone: number; failed: number }> {
    const others = this.sql.exec<{ n: number | null }>('SELECT SUM(waiting) AS n FROM summaries WHERE project != ?', notice.project).one().n ?? 0;
    const { v, project, ...rest } = notice;
    const full: PushNotice = { v, project, name: this.project(project)?.name ?? '', ...rest, waiting: others + projectWaiting };
    const members = this.sql.exec<{ id: string }>('SELECT id FROM members').toArray().map((m) => m.id).filter((id) => !looking.includes(id));
    const targets = this.subscriptionsOf(members);
    if (targets.length === 0) return { sent: 0, gone: 0, failed: 0 };
    const vapid = await this.vapidKey();
    const subject = `mailto:${this.config.org.adminEmail}`;
    const outcomes = await Promise.all(
      targets.map(async (target): Promise<'sent' | 'gone' | 'failed'> => {
        try {
          const response = await fetch(await pushRequest(vapid, subject, target, full));
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

  private subscriptionsOf(members: string[]): PushSubscriptionRecord[] {
    if (members.length === 0) return [];
    return this.sql
      .exec<{ endpoint: string; member: string; p256dh: string; auth: string; created: string }>(
        `SELECT endpoint, member, p256dh, auth, created FROM push_subscriptions WHERE member IN (${members.map(() => '?').join(', ')}) ORDER BY created, endpoint`,
        ...members,
      )
      .toArray()
      .map((row) => ({ member: row.member, endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth }, created: row.created }));
  }

  /** Names the one machine that writes the project's git archive (DX2's `have.archive` tells it at its next `hello`), or
   * clears it. */
  designateArchive(member: MemberRecord, id: string, body: unknown): Result<{ project: ProjectRecord }> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
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

  /** Expired enrollments, orphaned tokens, and revocations projects have not taken, swept when their time comes. */
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
        const held = this.sql.exec('SELECT 1 FROM machines WHERE token_name = ?', token_name).toArray().length > 0;
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
    return ['machines', 'enrollments', 'projects'].some((table) => this.sql.exec(`SELECT 1 FROM ${table} LIMIT 1`).toArray().length > 0) || this.provisioning.any();
  }

  // ---- The org key's wrapped copies (DX7) ----------------------------------------------------------------------

  orgKeys(): { key_check: string | null; keys: StoredKey[] } {
    return { key_check: this.ensureOrg().key_check, keys: this.keys.list() };
  }

  /** Adds a wrapped key; the first sets the org's `key_check` and `key_auth` in the same step as its insert. */
  async addOrgKey(member: MemberRecord, body: unknown): Promise<Result<{ key: StoredKey }>> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
    const authHash = await this.authHash(body);
    // From here to the insert, nothing else runs in this object: two first posts cannot both set the check.
    const org = this.ensureOrg();
    const keyAuth = this.keyAuth();
    const setOrg = (check: string, auth: string) => this.sql.exec('UPDATE org SET key_check = ?, key_auth = ?', check, auth);
    const added = this.keys.add(member, body, { keyCheck: org.key_check, keyAuth }, authHash, setOrg, newId(), iso(Date.now()));
    return added.ok ? ok({ key: added.value }) : fail(added.status, added.error, added.message);
  }

  async removeOrgKey(member: MemberRecord, id: string, body: unknown): Promise<Result<WrappedKeyRemoved>> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
    const authHash = await this.authHash(body);
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
