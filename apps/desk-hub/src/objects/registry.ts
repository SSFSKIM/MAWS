// The org's registry (DX7): one per org. It holds the org, its members, its machines, its projects, and the
// enrollments that create machines, and answers who an Access identity is to the hub; its members' push subscriptions,
// which it sends Web Push to; and the grid, each project's summary as its `Project` reports it, streamed to members'
// grid sockets.
//
// Enrollment is a durable state machine. Redeeming a token reserves the machine's name and records the intent to mint
// (a machine row without a client id) before Cloudflare's API is called; the service token is named
// `desk-<org>-<machine>`, so a token whose create answer was lost is found by name and deleted before anything else is
// minted under it. A second redemption while pending rotates the credential. A pending enrollment that expires, and a
// revoked machine, leave their token's name in `orphans`, swept until the API confirms the deletion. A mint in flight
// is the one thing held only in memory (`busy`): an object restart ends the mint with it, and the name makes whatever
// it left behind findable. Every call to the API under one token name (a sweep's deletion by name, a redemption's
// deletion and mint) runs in turn on that name's queue, so a deletion by name never lists a token minted after it began.
import { DurableObject } from 'cloudflare:workers';
import { hubConfig, MEMBER_HEADER, type Env, type HubConfig } from '../env';
import type { AccessIdentity } from '../identity/access';
import { ServiceTokenApiError, serviceTokens } from '../identity/service-tokens';
import { importVapidKey, pushRequest, type VapidKey } from '../push/web-push';
import { base64urlDecode, base64urlEncode, isBase64urlOf } from '../protocol/base64url';
import type { GridDown, ProjectSummary, PushNotice } from '../protocol/browser';
import { toWire } from '../protocol/parts';
import {
  ENROLLMENT_TTL_S,
  isMachineName,
  machineNameKey,
  MAX_ENROLLMENT_TTL_S,
  serviceTokenName,
  type EnrollmentIssued,
  type EnrollmentRecord,
  type MachineRecord,
  type MemberRecord,
  type OrgRecord,
  type ProjectRecord,
  type PushSubscriptionRecord,
  type Redeemed,
  type WrappedKeyRemoved,
} from '../protocol/identity';
import { OrgKeys, type StoredKey } from './org-keys';

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
  state TEXT NOT NULL, enrollment TEXT NOT NULL, created TEXT NOT NULL, confirmed TEXT);
CREATE TABLE IF NOT EXISTS enrollments (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, created TEXT NOT NULL,
  expires TEXT NOT NULL, ttl_s INTEGER NOT NULL, state TEXT NOT NULL, machine TEXT);
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, registered_by TEXT NOT NULL, created TEXT NOT NULL, archive_machine TEXT);
CREATE TABLE IF NOT EXISTS orphans (token_name TEXT PRIMARY KEY, since TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY, member TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS summaries (
  project TEXT PRIMARY KEY, machines INTEGER NOT NULL, machines_online INTEGER NOT NULL, working INTEGER NOT NULL,
  waiting INTEGER NOT NULL);
`;

/** A member's devices: enough for a person's phones, tablets, and browsers, and a bound on what one member can store. */
const MAX_PUSH_SUBSCRIPTIONS = 20;
const MAX_ENDPOINT = 2048;
type Counts = Omit<ProjectSummary, 'id' | 'name'>;

const MACHINE_COLUMNS = 'name, client_id, token_name, state, enrollment, created, confirmed';
const ENROLLMENT_COLUMNS = 'id, created_by, created, expires, state, machine, ttl_s';
const PROJECT_COLUMNS = 'id, name, registered_by, created, archive_machine';
/** How soon a failed orphan deletion is tried again. */
const ORPHAN_RETRY_MS = 60_000;

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
/** 128 random bits as lowercase hex (DX7's member id; also an enrollment's id). */
const newId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
const sha256 = async (text: string) => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
const iso = (ms: number) => new Date(ms).toISOString();
const lapsed = (enrollment: { expires: string }, now = Date.now()) => Date.parse(enrollment.expires) <= now;

type EnrollmentRow = EnrollmentRecord & { ttl_s: number };

export class Registry extends DurableObject<Env> {
  /** Enrollments whose mint is in flight in this object's life. */
  private readonly busy = new Set<string>();
  /** Per service-token name, the tail of the API work queued under it (an object restart ends the work with it). */
  private readonly nameQueues = new Map<string, Promise<unknown>>();

  private readonly keys: OrgKeys;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
    // An org stored before wrapped keys (M2's local state) gains its key check and key auth, empty.
    const columns = ctx.storage.sql.exec<{ name: string }>('PRAGMA table_info(org)').toArray().map((c) => c.name);
    for (const column of ['key_check', 'key_auth']) if (!columns.includes(column)) ctx.storage.sql.exec(`ALTER TABLE org ADD COLUMN ${column} TEXT`);
    this.keys = new OrgKeys(ctx.storage);
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
   * machine's first authenticated request confirms its enrollment. */
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
      this.ctx.storage.transactionSync(() => {
        this.sql.exec("UPDATE machines SET state = 'active', confirmed = ? WHERE name = ?", confirmed, machine.name);
        this.sql.exec("UPDATE enrollments SET state = 'confirmed' WHERE id = ?", enrollment.id);
      });
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

  /** Redeems a one-time token for the machine's own service token (the path Access does not guard). */
  async redeem(body: unknown): Promise<Result<Redeemed>> {
    const { token, machine } = (typeof body === 'object' && body !== null ? body : {}) as { token?: unknown; machine?: unknown };
    if (typeof token !== 'string' || token === '' || typeof machine !== 'string') return fail(400, 'bad-shape', 'the body is {token, machine}');
    if (!isMachineName(machine)) return fail(400, 'bad-name', `"${machine}" is not an admitted machine name`);
    await this.sweep();
    const hash = await sha256(token);

    // From here to the first await below, nothing else runs in this object: the checks and the reservation are one step.
    let enrollment = this.sql.exec<EnrollmentRow>(`SELECT ${ENROLLMENT_COLUMNS} FROM enrollments WHERE token_hash = ?`, hash).toArray()[0];
    if (!enrollment) return fail(404, 'unknown-token');
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
        this.sql.exec(
          "INSERT INTO machines (name, name_key, client_id, token_name, state, enrollment, created, confirmed) VALUES (?, ?, NULL, ?, 'pending', ?, ?, NULL)",
          machine,
          machineNameKey(machine),
          tokenName,
          id,
          iso(Date.now()),
        );
        // This redemption deletes every token of the name before it mints, which is what an orphan of it waited for.
        this.sql.exec('DELETE FROM orphans WHERE token_name = ?', tokenName);
      });
    } else {
      // A rotation: the credential minted before stops at the hub at once, before Cloudflare deletes it.
      this.ctx.storage.transactionSync(() => {
        this.sql.exec('UPDATE enrollments SET expires = ? WHERE id = ?', expires, id);
        this.sql.exec('UPDATE machines SET client_id = NULL WHERE name = ?', machine);
      });
    }
    this.busy.add(id);

    try {
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
        return ok({ org: org.id, machine, client_id: minted.client_id, client_secret: minted.client_secret });
      });
    } catch (error) {
      if (error instanceof ServiceTokenApiError) return fail(502, 'mint-failed', `${error.message}; redeem again`);
      throw error;
    } finally {
      this.busy.delete(id);
      await this.scheduleAlarm();
    }
  }

  /** Revokes a machine: its record goes at once (the hub refuses it from then), its stream ends, its service token is
   * deleted (retried until Cloudflare confirms), its name is released, and an archive designation of it is cleared. */
  async revoke(member: MemberRecord, name: string): Promise<Result<{ revoked: string }>> {
    if (member.role !== 'admin') return fail(403, 'not-admin');
    const org = this.ensureOrg();
    const machine = this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines WHERE name_key = ?`, machineNameKey(name)).toArray()[0];
    if (!machine) return fail(404, 'unknown-machine');
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM machines WHERE name = ?', machine.name);
      this.sql.exec("UPDATE enrollments SET state = 'expired' WHERE id = ? AND state IN ('open', 'pending')", machine.enrollment);
      this.sql.exec('UPDATE projects SET archive_machine = NULL WHERE archive_machine = ?', machine.name);
      this.orphan(machine.token_name);
    });
    await this.env.MACHINE.get(this.env.MACHINE.idFromName(`${org.id}:${machine.name}`)).revoke();
    await this.sweepOrphans();
    await this.scheduleAlarm();
    return ok({ revoked: machine.name });
  }

  machines(): MachineRecord[] {
    return this.sql.exec<MachineRecord>(`SELECT ${MACHINE_COLUMNS} FROM machines ORDER BY name`).toArray();
  }

  projects(): ProjectRecord[] {
    return this.sql.exec<ProjectRecord>(`SELECT ${PROJECT_COLUMNS} FROM projects ORDER BY created, id`).toArray();
  }

  project(id: string): ProjectRecord | null {
    return this.sql.exec<ProjectRecord>(`SELECT ${PROJECT_COLUMNS} FROM projects WHERE id = ?`, id).toArray()[0] ?? null;
  }

  /** A machine's `hello` for a project the registry does not hold registers it, under the name from its `.smns`. */
  registerProject(id: string, name: string, machine: string): ProjectRecord {
    const inserted = this.sql.exec('INSERT OR IGNORE INTO projects (id, name, registered_by, created, archive_machine) VALUES (?, ?, ?, ?, NULL)', id, name, machine, iso(Date.now())).rowsWritten;
    const project = this.project(id)!;
    if (inserted > 0) this.toGrid({ t: 'summary', project: this.summaryOf(project) });
    return project;
  }

  // ---- The grid (DX3's registry socket) ------------------------------------------------------------------------

  /** A member's grid socket (the Worker sends only a member's): every project's summary, then each change. */
  async fetch(request: Request): Promise<Response> {
    if (new URL(request.url).pathname !== '/grid') return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected a WebSocket', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ member: request.headers.get(MEMBER_HEADER) ?? '' });
    this.send(server, { t: 'grid', projects: this.projects().map((p) => this.summaryOf(p)) });
    return new Response(null, { status: 101, webSocket: client });
  }

  /** The grid takes nothing up. */
  async webSocketMessage(): Promise<void> {}

  /** A project's counts, as its `Project` object reports them when they change. */
  summary(project: string, counts: Counts): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO summaries (project, machines, machines_online, working, waiting) VALUES (?, ?, ?, ?, ?)',
      project,
      counts.machines,
      counts.machines_online,
      counts.working,
      counts.waiting,
    );
    const record = this.project(project);
    if (record) this.toGrid({ t: 'summary', project: this.summaryOf(record) });
  }

  private summaryOf(project: ProjectRecord): ProjectSummary {
    const counts = this.sql.exec<Counts>('SELECT machines, machines_online, working, waiting FROM summaries WHERE project = ?', project.id).toArray()[0];
    return { id: project.id, name: project.name, ...(counts ?? { machines: 0, machines_online: 0, working: 0, waiting: 0 }) };
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
  async push(notice: PushNotice, looking: string[]): Promise<{ sent: number; gone: number; failed: number }> {
    const members = this.sql.exec<{ id: string }>('SELECT id FROM members').toArray().map((m) => m.id).filter((id) => !looking.includes(id));
    const targets = this.subscriptionsOf(members);
    if (targets.length === 0) return { sent: 0, gone: 0, failed: 0 };
    const vapid = await this.vapidKey();
    const subject = `mailto:${this.config.org.adminEmail}`;
    const outcomes = await Promise.all(
      targets.map(async (target): Promise<'sent' | 'gone' | 'failed'> => {
        try {
          const response = await fetch(await pushRequest(vapid, subject, target, notice));
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

  /** Expired enrollments and orphaned tokens, swept when their time comes. */
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
    await this.sweepOrphans();
    await this.scheduleAlarm();
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

  /** The alarm at the next expiry, or sooner when an orphan waits for a retry; never in the past, so an enrollment kept
   * open by a mint in flight does not spin it. */
  private async scheduleAlarm(): Promise<void> {
    const now = Date.now();
    const next = this.sql
      .exec<{ expires: string }>("SELECT expires FROM enrollments WHERE state IN ('open', 'pending')")
      .toArray()
      .map((e) => Date.parse(e.expires));
    if (this.sql.exec('SELECT 1 FROM orphans LIMIT 1').toArray().length > 0) next.push(now + ORPHAN_RETRY_MS);
    if (next.length === 0) return;
    const at = Math.max(Math.min(...next), now + 250);
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at || current <= now) await this.ctx.storage.setAlarm(at);
  }

  /** The org, created from the deploy configuration the first time it is needed, with its admin as the first member. */
  private ensureOrg(): OrgRecord {
    const existing = this.sql.exec<OrgRecord>('SELECT id, name, created, key_check FROM org').toArray()[0];
    if (existing) return existing;
    const { org: config } = this.config;
    const created = iso(Date.now());
    this.ctx.storage.transactionSync(() => {
      this.sql.exec('INSERT INTO org (id, name, created, key_check) VALUES (?, ?, ?, NULL)', config.id, config.name, created);
      this.sql.exec('INSERT INTO members (id, email, role, created) VALUES (?, ?, ?, ?)', newId(), config.adminEmail.toLowerCase(), 'admin', created);
    });
    return { id: config.id, name: config.name, created, key_check: null };
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
