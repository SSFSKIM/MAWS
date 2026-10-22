// What a project's session plane keeps in its `Project` object's storage (SQLite), so it survives an eviction while
// sockets stay open, a hibernation, and a restart (§2): each machine's lease and presence, each session's latest
// presence, the pending set, the latest delivery outcome per event and recipient, the RPC records by nonce, the
// browsers' subscriptions, the machines revoked from the org, and the asks a question was pushed for. The logic that moves these lives in `project.ts`; this is their storage and nothing else.
import type { Delivery, MachinePresence, Raised, SessionMessage } from '../protocol/session';
import type { Rpc, RpcOutcome, RpcState } from '../protocol/rpc';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS presence (machine TEXT NOT NULL, session TEXT NOT NULL, message TEXT NOT NULL, PRIMARY KEY (machine, session));
CREATE TABLE IF NOT EXISTS leases (
  machine TEXT PRIMARY KEY, generation INTEGER NOT NULL, expires INTEGER NOT NULL, online INTEGER NOT NULL, closed INTEGER NOT NULL,
  follow INTEGER NOT NULL DEFAULT 0, client TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS machine_presence (machine TEXT PRIMARY KEY, body TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pending (
  machine TEXT NOT NULL, session TEXT NOT NULL, request TEXT NOT NULL, raised TEXT NOT NULL, deadline INTEGER,
  flipped INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (machine, session, request));
CREATE TABLE IF NOT EXISTS deliveries (
  writer TEXT NOT NULL, seq INTEGER NOT NULL, session TEXT NOT NULL, machine TEXT NOT NULL, body TEXT NOT NULL,
  PRIMARY KEY (writer, seq, session));
CREATE TABLE IF NOT EXISTS rpcs (
  nonce TEXT PRIMARY KEY, machine TEXT NOT NULL, member TEXT NOT NULL, rpc TEXT NOT NULL, state TEXT NOT NULL,
  outcome TEXT, generation INTEGER NOT NULL, updated INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS rpcs_by_machine ON rpcs (machine, state);
CREATE TABLE IF NOT EXISTS op_outcomes (
  machine TEXT NOT NULL, session TEXT NOT NULL, rpc TEXT NOT NULL, phase TEXT NOT NULL,
  message TEXT NOT NULL, bytes INTEGER NOT NULL, updated INTEGER NOT NULL,
  PRIMARY KEY (machine, session, rpc));
CREATE TABLE IF NOT EXISTS settled (
  machine TEXT NOT NULL, session TEXT NOT NULL, request TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (machine, session, request));
CREATE TABLE IF NOT EXISTS asked (
  machine TEXT NOT NULL, session TEXT NOT NULL, ask TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (machine, session, ask));
CREATE TABLE IF NOT EXISTS revoked (machine TEXT PRIMARY KEY, generation INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS subs (
  sub TEXT PRIMARY KEY, socket TEXT NOT NULL, machine TEXT NOT NULL, session TEXT NOT NULL, agent_id TEXT,
  generation INTEGER NOT NULL);
`;

/** How long an RPC's record answers a retry of its nonce: a day, as the daemon's ledger keeps its entries. */
const RPC_RECORD_MS = 24 * 3600 * 1000;

/** How long a settled request's id is kept to recognize its `settled` sent again: a month, past any daemon's restart. */
const SETTLED_MS = 30 * 24 * 3600 * 1000;

/** How long a pushed question's ask id is kept, so its other report pushes nothing (`markAsked`): an hour. The two
 * reports of one ask (a bridge's `raised` and the log's `question` event) arrive within seconds of each other, on the
 * uplink's two planes, and the event pushes only within ten minutes of its `ts` (project.ts `PUSH_FRESH_MS`); the
 * hour covers both with room for a machine's clock running ahead or a plane reconnecting late. */
const ASKED_MS = 60 * 60 * 1000;

/** `closed`: the stream it belongs to closed, so nothing of that generation renews it again (a lapse alone may be
 * renewed: a daemon back from a suspension on a stream that held). `follow`: its latest `hello` said the machine only
 * follows the project (DX2 `hello.follow`), so it counts toward none of the project's machines. `client`: the credential
 * (Access client id) of the stream that opened it, which tells one enrollment of the name from another. */
export type Lease = { machine: string; client: string; generation: number; expires: number; online: boolean; closed: boolean; follow: boolean };
type LeaseRow = { machine: string; client: string; generation: number; expires: number; online: number; closed: number; follow: number };
const leaseOf = (row: LeaseRow): Lease => ({ ...row, online: row.online === 1, closed: row.closed === 1, follow: row.follow === 1 });
const LEASE_COLUMNS = 'machine, generation, expires, online, closed, follow, client';
export type PendingRow = { machine: string; raised: Raised; deadline: number | null };
export type RpcRecord = { nonce: string; machine: string; member: string; rpc: Rpc; state: RpcState; outcome: RpcOutcome | null; generation: number };
export type Route = { sub: string; socket: string; machine: string; session: string; agentId: string | null; generation: number };

export class SessionStore {
  constructor(private readonly storage: DurableObjectStorage) {
    storage.sql.exec(SCHEMA);
    // A project stored before follow-only hellos: every lease it holds is a holder's, of a credential it did not keep.
    const columns = storage.sql.exec<{ name: string }>('PRAGMA table_info(leases)').toArray().map((c) => c.name);
    if (!columns.includes('follow')) storage.sql.exec('ALTER TABLE leases ADD COLUMN follow INTEGER NOT NULL DEFAULT 0');
    if (!columns.includes('client')) storage.sql.exec("ALTER TABLE leases ADD COLUMN client TEXT NOT NULL DEFAULT ''");
  }

  private get sql() {
    return this.storage.sql;
  }

  // Leases. A machine is online in the project while its lease is fresh: `online` set and `expires` ahead.

  lease(machine: string): Lease | undefined {
    const row = this.sql.exec<LeaseRow>(`SELECT ${LEASE_COLUMNS} FROM leases WHERE machine = ?`, machine).toArray()[0];
    return row && leaseOf(row);
  }

  leases(): Lease[] {
    return this.sql.exec<LeaseRow>(`SELECT ${LEASE_COLUMNS} FROM leases ORDER BY machine`).toArray().map(leaseOf);
  }

  putLease(lease: Lease): void {
    this.sql.exec(
      `INSERT OR REPLACE INTO leases (${LEASE_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      lease.machine,
      lease.generation,
      lease.expires,
      lease.online ? 1 : 0,
      lease.closed ? 1 : 0,
      lease.follow ? 1 : 0,
      lease.client,
    );
  }

  /** Leases still marked online whose time is up, for the lapse to act on. */
  lapsed(now: number): Lease[] {
    return this.leases().filter((lease) => lease.online && lease.expires <= now);
  }

  // Revocations: a machine revoked from the org, up to the stream generation it had reached then.

  revoke(machine: string, generation: number): void {
    this.sql.exec(
      'INSERT INTO revoked (machine, generation) VALUES (?, ?) ON CONFLICT (machine) DO UPDATE SET generation = MAX(generation, excluded.generation)',
      machine,
      generation,
    );
  }

  /** The newest stream generation of `machine` that was revoked, or null when none was. */
  revokedThrough(machine: string): number | null {
    return this.sql.exec<{ generation: number }>('SELECT generation FROM revoked WHERE machine = ?', machine).toArray()[0]?.generation ?? null;
  }

  // Presence.

  putPresence(machine: string, session: string, message: SessionMessage<'presence'>): void {
    this.sql.exec('INSERT OR REPLACE INTO presence (machine, session, message) VALUES (?, ?, ?)', machine, session, JSON.stringify(message));
  }

  presence(): Array<{ machine: string; message: SessionMessage<'presence'> }> {
    return this.sql
      .exec<{ machine: string; message: string }>('SELECT machine, message FROM presence ORDER BY machine, session')
      .toArray()
      .map((row) => ({ machine: row.machine, message: JSON.parse(row.message) as SessionMessage<'presence'> }));
  }

  putMachinePresence(machine: string, body: MachinePresence): void {
    this.sql.exec('INSERT OR REPLACE INTO machine_presence (machine, body) VALUES (?, ?)', machine, JSON.stringify(body));
  }

  /** Forgets a machine's own presence; true when there was one. */
  deleteMachinePresence(machine: string): boolean {
    return this.sql.exec('DELETE FROM machine_presence WHERE machine = ?', machine).rowsWritten > 0;
  }

  machinePresence(): Array<{ machine: string; body: MachinePresence }> {
    return this.sql
      .exec<{ machine: string; body: string }>('SELECT machine, body FROM machine_presence ORDER BY machine')
      .toArray()
      .map((row) => ({ machine: row.machine, body: JSON.parse(row.body) as MachinePresence }));
  }

  // The pending set.

  pending(): PendingRow[] {
    return this.sql
      .exec<{ machine: string; raised: string; deadline: number | null }>('SELECT machine, raised, deadline FROM pending ORDER BY rowid')
      .toArray()
      .map((row) => ({ machine: row.machine, raised: JSON.parse(row.raised) as Raised, deadline: row.deadline }));
  }

  pendingOf(machine: string, session: string, request: string): Raised | undefined {
    const row = this.sql.exec<{ raised: string }>('SELECT raised FROM pending WHERE machine = ? AND session = ? AND request = ?', machine, session, request).toArray()[0];
    return row && (JSON.parse(row.raised) as Raised);
  }

  /** Adds or replaces one request; true when it was not pending before. */
  raise(machine: string, raised: Raised, deadline: number | null): boolean {
    const known = this.pendingOf(machine, raised.session, raised.request) !== undefined;
    if (known) {
      this.sql.exec('UPDATE pending SET raised = ?, deadline = ? WHERE machine = ? AND session = ? AND request = ?', JSON.stringify(raised), deadline, machine, raised.session, raised.request);
    } else {
      this.sql.exec('INSERT INTO pending (machine, session, request, raised, deadline) VALUES (?, ?, ?, ?, ?)', machine, raised.session, raised.request, JSON.stringify(raised), deadline);
    }
    return !known;
  }

  /** Marks a request settled; false when it already was, so its `settled` is one sent again, or one of the request
   * raised again since (`project.ts` `settled` tells them apart by the pending set). */
  markSettled(machine: string, session: string, request: string, now: number): boolean {
    this.sql.exec('DELETE FROM settled WHERE at < ?', now - SETTLED_MS);
    const known = this.sql.exec('SELECT 1 FROM settled WHERE machine = ? AND session = ? AND request = ?', machine, session, request).toArray().length > 0;
    if (!known) this.sql.exec('INSERT INTO settled (machine, session, request, at) VALUES (?, ?, ?, ?)', machine, session, request, now);
    return !known;
  }

  /** Whether a settlement of the request is kept (for a month: `SETTLED_MS`). */
  isSettled(machine: string, session: string, request: string): boolean {
    return this.sql.exec('SELECT 1 FROM settled WHERE machine = ? AND session = ? AND request = ?', machine, session, request).toArray().length > 0;
  }

  /** Marks a question pushed for the ask `ask` of a session; false when it already was, so the ask's other report (its
   * `raised` or its log `question`, whichever came second) pushes nothing. */
  markAsked(machine: string, session: string, ask: string, now: number): boolean {
    this.sql.exec('DELETE FROM asked WHERE at < ?', now - ASKED_MS);
    const known = this.sql.exec('SELECT 1 FROM asked WHERE machine = ? AND session = ? AND ask = ?', machine, session, ask).toArray().length > 0;
    if (!known) this.sql.exec('INSERT INTO asked (machine, session, ask, at) VALUES (?, ?, ?, ?)', machine, session, ask, now);
    return !known;
  }

  settle(machine: string, session: string, request: string): Raised | undefined {
    const raised = this.pendingOf(machine, session, request);
    if (raised) this.sql.exec('DELETE FROM pending WHERE machine = ? AND session = ? AND request = ?', machine, session, request);
    return raised;
  }

  /** Drops every request of `machine` that `keep` does not name; returns how many went. */
  dropPendingExcept(machine: string, keep: Set<string>): number {
    let dropped = 0;
    for (const { raised } of this.pending().filter((row) => row.machine === machine)) {
      if (keep.has(pendingKey(raised.session, raised.request))) continue;
      this.sql.exec('DELETE FROM pending WHERE machine = ? AND session = ? AND request = ?', machine, raised.session, raised.request);
      dropped++;
    }
    return dropped;
  }

  /** Requests whose deadline passed and that the browsers have not yet been told of; marks them told. */
  flipDeadlines(now: number): number {
    return this.sql.exec('UPDATE pending SET flipped = 1 WHERE flipped = 0 AND deadline IS NOT NULL AND deadline <= ?', now).rowsWritten;
  }

  nextDeadline(now: number): number | null {
    return this.sql.exec<{ next: number | null }>('SELECT MIN(deadline) AS next FROM pending WHERE flipped = 0 AND deadline > ?', now).one().next;
  }

  // Delivery outcomes: the latest per event and recipient.

  putDelivery(machine: string, delivery: Delivery): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO deliveries (writer, seq, session, machine, body) VALUES (?, ?, ?, ?, ?)',
      delivery.event.writer,
      delivery.event.seq,
      delivery.session,
      machine,
      JSON.stringify(delivery),
    );
  }

  deliveries(): Delivery[] {
    return this.sql.exec<{ body: string }>('SELECT body FROM deliveries ORDER BY rowid').toArray().map((row) => JSON.parse(row.body) as Delivery);
  }

  // RPC records, by nonce.

  rpc(nonce: string): RpcRecord | undefined {
    const row = this.sql
      .exec<{ nonce: string; machine: string; member: string; rpc: string; state: RpcState; outcome: string | null; generation: number }>(
        'SELECT nonce, machine, member, rpc, state, outcome, generation FROM rpcs WHERE nonce = ?',
        nonce,
      )
      .toArray()[0];
    return row && { ...row, rpc: JSON.parse(row.rpc) as Rpc, outcome: row.outcome === null ? null : (JSON.parse(row.outcome) as RpcOutcome) };
  }

  putRpc(record: RpcRecord, now: number): void {
    this.sql.exec('DELETE FROM rpcs WHERE updated < ?', now - RPC_RECORD_MS);
    this.sql.exec(
      'INSERT OR REPLACE INTO rpcs (nonce, machine, member, rpc, state, outcome, generation, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      record.nonce,
      record.machine,
      record.member,
      JSON.stringify(record.rpc),
      record.state,
      record.outcome === null ? null : JSON.stringify(record.outcome),
      record.generation,
      now,
    );
  }

  /** Every forwarded RPC of `machine` sent on `generation` or an older stream: forwarded, no result yet. */
  forwarded(machine: string, generation: number): RpcRecord[] {
    return this.sql
      .exec<{ nonce: string }>("SELECT nonce FROM rpcs WHERE machine = ? AND state = 'forwarded' AND generation <= ?", machine, generation)
      .toArray()
      .map((row) => this.rpc(row.nonce)!);
  }

  /** Bounded command receipts, not transcript rows. End wins even if an owed start arrives later. */
  putOp(message: SessionMessage<'op'>, now: number): void {
    const b = message.body;
    if (b.op !== 'command' || typeof b.rpc !== 'string' || !b.rpc || (b.phase !== 'start' && b.phase !== 'end')) return;
    // Only the command envelope and its confirmation belong here. Future op payloads need their own approval.
    const body: Record<string, unknown> = Object.fromEntries(['rpc', 'op', 'phase', 'id', 'name', 'args', 'route']
      .filter((key) => typeof b[key] === 'string').map((key) => [key, b[key]]));
    if (typeof b.t === 'number') body.t = b.t;
    for (const [key, fields] of [['settled', ['ok', 'text', 'error', 'code']], ['readback', ['how', 'text', 'uuid']]] as const) {
      const value = b[key];
      if (value && typeof value === 'object' && !Array.isArray(value)) body[key] = Object.fromEntries(fields
        .filter((field) => typeof value[field] === 'string' || (field === 'ok' && typeof value[field] === 'boolean'))
        .map((field) => [field, value[field]]));
    }
    const json = JSON.stringify({ ...message, body });
    const bytes = new TextEncoder().encode(json).byteLength;
    this.trimOps(now);
    this.sql.exec(`INSERT INTO op_outcomes (machine, session, rpc, phase, message, bytes, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(machine, session, rpc) DO UPDATE SET phase=excluded.phase, message=excluded.message, bytes=excluded.bytes, updated=excluded.updated
      WHERE op_outcomes.phase != 'end'`, message.machine, message.session, b.rpc, b.phase, json, bytes, now);
    this.trimOps(now);
  }

  ops(now: number): SessionMessage<'op'>[] {
    this.trimOps(now);
    return this.sql.exec<{ message: string }>('SELECT message FROM op_outcomes ORDER BY updated, rowid').toArray()
      .map((row) => JSON.parse(row.message) as SessionMessage<'op'>);
  }

  /** The alarm owns no-traffic expiry; reads/writes also prune as a recovery path. */
  expireOps(now: number): void {
    this.sql.exec('DELETE FROM op_outcomes WHERE updated <= ?', now - RPC_RECORD_MS);
  }

  nextOpExpiry(): number | null {
    const oldest = this.sql.exec<{ oldest: number | null }>('SELECT MIN(updated) AS oldest FROM op_outcomes').one().oldest;
    return oldest === null ? null : oldest + RPC_RECORD_MS;
  }

  private trimOps(now: number): void {
    this.expireOps(now);
    // Both limits apply to the newest suffix, including UTF-8 bytes (not JS string length).
    const rows = this.sql.exec<{ rowid: number; bytes: number }>('SELECT rowid, bytes FROM op_outcomes ORDER BY updated DESC, rowid DESC').toArray();
    let bytes = 0;
    for (const [index, row] of rows.entries()) {
      bytes += row.bytes;
      if (index >= 256 || bytes > 4 * 1024 * 1024) this.sql.exec('DELETE FROM op_outcomes WHERE rowid = ?', row.rowid);
    }
  }

  // Subscriptions: which socket each sub's messages go to.

  routes(): Route[] {
    return this.sql
      .exec<{ sub: string; socket: string; machine: string; session: string; agent_id: string | null; generation: number }>('SELECT * FROM subs')
      .toArray()
      .map((row) => ({ sub: row.sub, socket: row.socket, machine: row.machine, session: row.session, agentId: row.agent_id, generation: row.generation }));
  }

  putRoute(route: Route): void {
    this.sql.exec(
      'INSERT INTO subs (sub, socket, machine, session, agent_id, generation) VALUES (?, ?, ?, ?, ?, ?)',
      route.sub,
      route.socket,
      route.machine,
      route.session,
      route.agentId,
      route.generation,
    );
  }

  deleteRoute(sub: string): void {
    this.sql.exec('DELETE FROM subs WHERE sub = ?', sub);
  }
}

export const pendingKey = (session: string, request: string) => `${session}\n${request}`;
