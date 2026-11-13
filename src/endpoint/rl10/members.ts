// The machine's sessions as sminos reports them on RL10 (O10 M6): its `member` frames, the machine-held RL6 record of
// every session on this machine in every project it knows here, and each project's `machine` presence. They are the
// records M5's `RecordSource` answers and the checkouts its `CheckoutSource` knows, what the endpoint lists at the hub
// (M3's `Listings`), attests in its own events and decides words from.
//
// A member's `session` is the engine's session id, by which sminos keys its members, and the frame carries no other id. A
// lane B session is addressed by MAWS's `appSessionId`, stable across `/clear`, which the endpoint joins to the member by
// its `session`, matched with the `engineSessionId` `engine.sessions` reports for it (through `dispatch`); a lane B
// session is listed under its `appSessionId` once joined, the id a device subscribes with, and not before.
//
// sminos restates the whole set after each RL10 welcome and closes the restatement with `restated {}`, and the set
// replaces what was held: a session held before the welcome, or listed at the hub, that the restatement left out left
// while sminos or the endpoint was away, and is withdrawn as if it had sent `gone` (M3's note: its listing would
// otherwise stay at the hub for good). A connection that ends before its `restated` withdraws nothing.
//
// P5 O12 M11 (docs/doperpowers/plans/2026-10-27-p5-o12-sminos-owners.md, M11's Decisions): the handed-off mark. Until the
// endpoint first sees a sminos record for a lane B session, authorization ranks the spawner the spine's record names
// (`launchedBy`) as its owner (authorize.ts's bridge); once it has, the record decides, and a missing record fails closed,
// never back to the spawner. The records here are a cache (empty at each start, a record dropped at `gone`, a `/clear`'s
// new engine session's record a few seconds behind it), so that first sight is kept on disk per appSessionId,
// `handed-off.json` in the endpoint's state directory: marked at the lane B join, and at any read of a lane B record
// placed under its appSessionId, before the read answers. No record is used before its mark is durable: a mark that
// can't be written yet withholds the record (`record` answers none) and counts as handed off, so the session is closed
// to everyone until a later write succeeds. A lane B record not yet joined is marked by its engine session before the
// join awaits the engine host (which may be away, or no longer list it), and a placement on that engine session finds it
// and marks its app session in its stead, as the join does once it places the record. The mark is pruned of the app
// sessions the spine no longer holds, once a process, when first read.
//
// P5 Decision Log 190, residue (b) (O12's "M11's MAWS half as built"): a `/clear` can replace a lane B session's engine
// session before its first record arrives, or while the join reads `engine.sessions`, so the live rows never name the
// record's engine session. The join then places the record by its spawn: the app session whose spine record's
// `launchedBy.opId` is the opId of the record's `session.spawn` act in `ownersProof` (`#bySpawn`), failing closed when two
// app sessions share it.
//
// The UX wave (U9, M1's listing rule; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md): a lane B session's
// listing follows the spine's record, which the member frame does not carry. A joined session whose record is archived
// is withdrawn with the gone record, and listed again when it is unarchived; a record's title replaces the one sminos
// reported (one it holds as a title: its first prompt standing in for none does not). The record is read (`session.get`) when the session is first reported, and judged again at each
// `session.changed` the spine says of it (`recordChanged`), so it holds alike for the listing the hub keeps and for the
// one a channel's `endpoint.listings` signs afresh (`recordSays`). No listing field is added. Each read runs inside an
// operation's hold, so the daemon does not collect over it.
import type { EndpointServices } from '../services';
import type { SessionReport } from '../listings';
import type { Access, CheckoutSource, RecordSource, SessionRecord, SessionTarget, Share } from '../sources';

/** A `member` frame as RL10 carries it (Interfaces §D). */
export type Member = {
  session: string;
  alias: string;
  project: string;
  lane: 'A' | 'B';
  state: string;
  title?: string;
  cwd: string;
  worktree?: string;
  launch?: string;
  owners: string[];
  ownersProof: unknown[];
  origin: { kind: string; requester?: string; spawnerSession?: string };
  principal?: unknown;
  inference?: unknown;
  access?: Access;
  shares?: Share[];
  /** P5 O18: the record's policy revision, bumped by sminos on each access, share or owner change. */
  policyRev?: number;
  controller?: unknown;
};

const ACCESS: ReadonlySet<string> = new Set(['private', 'listed', 'org-view', 'org-converse']);
const SHARE_GRADES: ReadonlySet<string> = new Set(['list', 'view', 'converse', 'approve']);
const isText = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 512;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `member` frame read for what the endpoint relies on, or null when it doesn't hold its shape. */
export function readMember(frame: Record<string, unknown>): Member | null {
  const { session, alias, project, lane, state, title, cwd, worktree, launch, owners, ownersProof, origin, access, shares, policyRev } = frame;
  if (!isId(session) || !isText(alias) || !isId(project) || (lane !== 'A' && lane !== 'B') || !isText(state, 256) || !isText(cwd)) return null;
  if (title !== undefined && !isText(title)) return null;
  if (worktree !== undefined && !isText(worktree)) return null;
  if (launch !== undefined && !isId(launch)) return null;
  if (!Array.isArray(owners) || !owners.every((o) => isId(o))) return null;
  if (!Array.isArray(ownersProof)) return null;
  if (!isObject(origin) || !isText(origin.kind, 256)) return null;
  if (access !== undefined && !(typeof access === 'string' && ACCESS.has(access))) return null;
  if (shares !== undefined && !(Array.isArray(shares) && shares.every((s) => isObject(s) && isId(s.member) && typeof s.grade === 'string' && SHARE_GRADES.has(s.grade)))) return null;
  if (policyRev !== undefined && !(Number.isSafeInteger(policyRev) && (policyRev as number) >= 0)) return null;
  return frame as unknown as Member;
}

/** A project's checkouts, as its `machine` presence lists them (`checkouts: [{path, branch}]`). */
export function presenceCheckouts(body: unknown): string[] | null {
  if (!isObject(body) || !Array.isArray(body.checkouts)) return null;
  return body.checkouts.flatMap((c) => (isObject(c) && typeof c.path === 'string' && c.path !== '' ? [c.path] : []));
}

export type MembersContext = {
  dispatch: EndpointServices['dispatch'];
  /** The listings M3 keeps: a member's report, a session's departure. */
  listings: { report(report: SessionReport): Promise<void>; gone(session: string): Promise<void> };
  /** The sessions listed at the hub now (listings.json's keys): a restatement withdraws those it leaves out. */
  listed(): readonly string[];
  /** A session left: what notify keeps of it goes. */
  forget(session: string): void;
  /** U9: an operation's hold around work outside a call or an act (the listing rule's reads); none in a suite that holds nothing. */
  hold?(reason: string): () => void;
  log(line: string): void;
  now(): number;
  /**
   * P5 O12 M11: the handed-off mark on disk, app sessions and the engine sessions of records the join could not place:
   * `read` null while the state can't be read, `write` throwing when it can't be written. Absent (a suite's), the mark
   * is kept in memory only.
   */
  marks?: { read(): Marks | null; write(marks: Marks): void };
};

/**
 * U9: what a lane B session's spine record says of its listing. `title` null: the record names none (the report's stands),
 * which includes a record whose title is only its first prompt standing in (`source: 'none'`): a rename, the engine's
 * generated title or a tool's is a title the record holds.
 */
export type RecordSays = { archived: boolean; title: string | null };
const recordSaysOf = (record: Record<string, unknown>): RecordSays => {
  const held = isObject(record.title) ? record.title : null;
  const title = held !== null && held.source !== 'none' && isText(held.text) && held.text !== '' ? held.text : null;
  return { archived: record.archived === true, title };
};

/** P5 O12 M11: the handed-off mark's two lists. */
export type Marks = { appSessionIds: readonly string[]; engineSessionIds: readonly string[] };
type MarkSets = { apps: Set<string>; engines: Set<string> };

export class Members implements RecordSource, CheckoutSource {
  readonly #ctx: MembersContext;
  readonly #members = new Map<string, Member>();
  /** Lane B: engine session id → appSessionId, from `engine.sessions` (or, Decision Log 190 (b), by the record's spawn). */
  readonly #apps = new Map<string, string>();
  /**
   * P5 Decision Log 190 (b): the engine sessions joined by their spawn while the spine named another engine session for
   * their app session: superseded, so their records never replace its listing (`#report`).
   */
  readonly #superseded = new Set<string>();
  readonly #checkouts = new Map<string, string[]>();
  readonly #listeners = new Set<(target: SessionTarget) => void>();
  /** U9: what the spine's record says of each joined lane B app session's listing, by its appSessionId (read, or heard). */
  readonly #records = new Map<string, RecordSays>();
  /** The sessions held from before the latest welcome, not restated since; null outside a restatement. */
  #unrestated: Set<string> | null = null;
  /** P5 O12 M11: the handed-off mark as on disk, read on first use (null until then), and the marks not written yet. */
  #durable: MarkSets | null = null;
  readonly #pending: MarkSets = { apps: new Set(), engines: new Set() };

  constructor(ctx: MembersContext) {
    this.#ctx = ctx;
  }

  // ---- What RL10 says ---------------------------------------------------------------------------------------------

  /** A welcome: every session held now, and every session listed at the hub, is to be restated before `restated`. */
  welcome(): void {
    this.#unrestated = new Set([...this.#members.keys(), ...this.#ctx.listed()]);
  }

  /** sminos's `restated`: what the restatement left out left. Nothing outside a restatement (a second `restated`). */
  async restated(): Promise<void> {
    const left = this.#unrestated ?? new Set<string>();
    this.#unrestated = null;
    for (const session of left) await this.gone(session);
  }

  /** A `member` frame: the session's record as it stands. */
  async member(frame: Record<string, unknown>): Promise<void> {
    if (frame.gone === true) {
      if (isId(frame.session)) await this.gone(frame.session);
      return;
    }
    const member = readMember(frame);
    if (member === null) return this.#ctx.log('endpoint: an RL10 member frame that is not one was ignored');
    this.#unrestated?.delete(member.session);
    const before = this.#members.get(member.session);
    this.#members.set(member.session, member);
    // P5 O12 M11: told before the join, which awaits the engine host, so a subscription the spawner holds by the bridge
    // is held at once (by its engine session) by a first record that grants it nothing; told again once joined
    this.#changed(member, before);
    if (member.lane === 'B' && !this.#apps.has(member.session)) {
      this.#mark('engines', member.session); // P5 O12 M11: seen, on disk before the join, which may never place it
      await this.#join(member.session);
      if (this.#apps.has(member.session)) this.#changed(member, undefined);
    }
    // A lane B session the join placed is restated under its appSessionId too, which its listing went by.
    const listing = this.listingId(member.session);
    if (listing !== null) this.#unrestated?.delete(listing);
    await this.#report(member);
  }

  /** A session that left (or wasn't restated): withdrawn, its record gone. */
  async gone(session: string): Promise<void> {
    const member = this.#members.get(session);
    // A session held only as a listing (from before a restart) is gone by its listing's id; read before the member goes.
    const listing = member === undefined ? session : this.listingId(session);
    this.#members.delete(session);
    if (member !== undefined) {
      this.#apps.delete(session);
      this.#superseded.delete(session);
      this.#changed(member, member);
    }
    // A lane B app's listing outlives an engine session it superseded: while another member holds the listing (the
    // app's engine session now), retiring the old record withdraws and forgets nothing.
    if (listing !== null && !this.#listedBy(listing)) {
      // Withdrawn first, which settles what notify told the hub (`settled 0`, or owed), then forgotten.
      await this.#ctx.listings.gone(listing);
      this.#ctx.forget(listing);
      this.#records.delete(listing); // U9: read again if the session comes back
    } else if (listing !== null && member !== undefined) {
      // P5 Decision Log 190 (b): a superseded record that deferred to the one that left reports the listing now (the
      // spine's index can lag a `/clear`, so the record it deferred to may have been the older).
      for (const other of this.sessions()) {
        const stays = this.#members.get(other);
        if (stays !== undefined && this.#superseded.has(other) && this.listingId(other) === listing) await this.#report(stays);
      }
    }
  }

  /** A project's `machine` presence: its known checkouts here. */
  presence(project: string, body: unknown): void {
    const checkouts = presenceCheckouts(body);
    if (checkouts === null) return this.#ctx.log(`endpoint: a machine presence of project ${project.slice(0, 64)} with no checkouts was ignored`);
    this.#checkouts.set(project, checkouts);
  }

  // ---- What the endpoint reads ------------------------------------------------------------------------------------

  /** The member frame held for a session (by its engine session id), or null. */
  get(session: string): Member | null {
    return this.#members.get(session) ?? null;
  }

  /** Whether a restatement after a welcome is open (its `restated` not yet come): the set held may be partial. */
  get restating(): boolean {
    return this.#unrestated !== null;
  }

  /** Every session held now, by its engine session id. */
  sessions(): string[] {
    return [...this.#members.keys()];
  }

  /** The id a session is listed under: lane A its session, lane B its appSessionId once joined (null before). */
  listingId(session: string): string | null {
    const member = this.#members.get(session);
    if (member === undefined) return null;
    return member.lane === 'A' ? session : (this.#apps.get(session) ?? null);
  }

  /**
   * U9: what the spine's record says of a lane B app session's listing (archived, its title), as last read or heard;
   * null while nothing is known of it (a lane A session's id, or one not yet read).
   */
  recordSays(listingId: string): RecordSays | null {
    return this.#records.get(listingId) ?? null;
  }

  /**
   * U9: the spine said a record changed (`session.changed`): a joined lane B session's listing is judged again when what
   * it says of the listing moved. Any other record is passed by.
   */
  async recordChanged(record: unknown): Promise<void> {
    if (!isObject(record) || !isId(record.appId)) return;
    const app = record.appId;
    const reporting = this.sessions().filter((session) => this.#members.get(session)?.lane === 'B' && this.listingId(session) === app);
    if (reporting.length === 0) return;
    const now = recordSaysOf(record);
    const before = this.#records.get(app);
    this.#records.set(app, now);
    if (before !== undefined && before.archived === now.archived && before.title === now.title) return;
    const release = this.#ctx.hold?.('a listing following its record') ?? (() => {});
    try {
      for (const session of reporting) {
        const member = this.#members.get(session);
        if (member !== undefined) await this.#report(member);
      }
    } finally {
      release();
    }
  }

  /** The appSessionId a lane B member was joined to, or null. */
  appSessionId(session: string): string | null {
    return this.#apps.get(session) ?? null;
  }

  /**
   * P5 O8 M6b: the member a lane B app session's record acts go to, the one keying sminos's record: of the members joined to
   * `appSessionId`, `preferred` (the engine session the spine records for it) when it is one, else the one a superseded
   * record doesn't stand for (Decision Log 190 (b)), else the only one; null when none is joined, or two can't be told
   * apart.
   */
  recordMember(appSessionId: string, preferred?: string): string | null {
    const joined = [...this.#apps].flatMap(([session, app]) => (app === appSessionId && this.#members.get(session)?.lane === 'B' ? [session] : []));
    if (preferred !== undefined && joined.includes(preferred)) return preferred;
    const standing = joined.filter((session) => !this.#superseded.has(session));
    if (standing.length === 1) return standing[0];
    return joined.length === 1 ? joined[0] : null;
  }

  /** The project whose presence lists `checkout`, or null (a spawn's project, Interfaces §D). */
  projectOfCheckout(checkout: string): string | null {
    for (const [project, paths] of this.#checkouts) if (paths.includes(checkout)) return project;
    return null;
  }

  /**
   * P5 O12 M11: a lane B record read under its appSessionId marks that app session handed off first, and is withheld
   * (none) while the mark can't be made durable.
   */
  record(target: SessionTarget): SessionRecord | null {
    const member = this.#members.get(target.session);
    if (member === undefined || member.lane !== target.lane) return null;
    if (target.lane === 'B' && target.appSessionId !== '' && !this.#placed(target.session, target.appSessionId)) return null;
    return this.recordOf(member.session);
  }

  /**
   * P5 O12 M11: whether a sminos record was seen for an engine session of the lane B session `target` (its app session,
   * or the engine session placed, for a record the join could not place), after which the bridge never applies to it.
   * Every session reads as handed off while the mark can't be read, and once marked though not yet on disk. An engine
   * session's mark found under a placement passes to its app session, so the next engine session (a `/clear`) is covered.
   */
  handedOff(target: SessionTarget): boolean {
    const durable = this.#marks();
    if (durable === null || target.lane !== 'B') return true;
    const { appSessionId: app, session } = target;
    if (durable.apps.has(app) || this.#pending.apps.has(app)) return true;
    if (!durable.engines.has(session) && !this.#pending.engines.has(session)) return false;
    if (app !== '') this.#placed(session, app);
    return true;
  }

  /** The record authorization reads of a session, by its engine session id, whatever its lane; null when none is held. */
  recordOf(session: string): SessionRecord | null {
    const member = this.#members.get(session);
    if (member === undefined) return null;
    return {
      session: member.session,
      lane: member.lane,
      owners: member.owners,
      ...(member.access === undefined ? {} : { access: member.access }),
      ...(member.shares === undefined ? {} : { shares: member.shares }),
      ...(member.launch === undefined ? {} : { launch: member.launch }),
    };
  }

  onChange(listener: (target: SessionTarget) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  known(path: string): boolean {
    return this.projectOfCheckout(path) !== null;
  }

  /** The connection ended (or the endpoint stops): a restatement it left unfinished withdraws nothing. */
  stop(): void {
    this.#unrestated = null;
  }

  // ---- Inside -----------------------------------------------------------------------------------------------------

  /** Whether a member held now is listed under `listing`. */
  #listedBy(listing: string): boolean {
    for (const session of this.#members.keys()) if (this.listingId(session) === listing) return true;
    return false;
  }

  /**
   * Joins a lane B member to its appSessionId through `engine.sessions`, once; a host that can't answer leaves it unjoined.
   * P5 O12 M11: each app session joined is marked handed off in its engine session's stead.
   * P5 Decision Log 190 (b): a member the live rows leave unjoined (a `/clear` replaced its engine session before its
   * record arrived, or while `engine.sessions` was in flight; or the host away) is joined by its spawn instead (`#bySpawn`).
   */
  async #join(session: string): Promise<void> {
    if (this.#apps.has(session)) return;
    let response;
    try {
      response = await this.#ctx.dispatch('engine-host', 'engine.sessions', undefined);
    } catch (error) {
      this.#ctx.log(`endpoint: engine.sessions could not be read (${(error as Error).message}); a lane B session waits for its appSessionId`);
    }
    if (response?.ok === true && Array.isArray(response.value)) {
      for (const status of response.value as Array<{ appSessionId?: unknown; engineSessionId?: unknown }>) {
        if (!isId(status.appSessionId) || !isId(status.engineSessionId) || this.#members.get(status.engineSessionId)?.lane !== 'B') continue;
        this.#apps.set(status.engineSessionId, status.appSessionId);
        this.#superseded.delete(status.engineSessionId); // Decision Log 190 (b): the live rows name it now
        this.#placed(status.engineSessionId, status.appSessionId);
      }
    }
    if (!this.#apps.has(session)) await this.#bySpawn(session);
  }

  /**
   * P5 Decision Log 190 (b): a lane B member joined to the app session whose spine record's `launchedBy.opId` is the opId
   * of its record's spawn act (the `ownersProof` entry whose action is `session.spawn`; sminos appends other acts, such
   * as `record.owners`, after it or to a record that had none), the spawn its session was launched for (sminos takes the proof from the file
   * `session.spawn` writes, and a `/clear` keeps it), which the spine names whatever engine session it runs now. A record
   * with no spawn act, or whose spawn no spine record names, stays unjoined. An opId two app sessions share (reused after the
   * op ledger's `KEPT_S`) joins neither and marks each handed off, the mark's closed side: a spawner's bridge on either
   * ends until that session's own record decides. Every record counts, the archived too, so a reuse is never missed.
   */
  async #bySpawn(session: string): Promise<void> {
    const proof = this.#members.get(session)?.ownersProof.find((act) => isObject(act) && act.action === 'session.spawn');
    const opId = isObject(proof) ? proof.opId : undefined;
    if (!isId(opId)) return;
    let response;
    try {
      response = await this.#ctx.dispatch('machine', 'session.list', { includeArchived: true });
    } catch {
      return;
    }
    const sessions = response.ok && isObject(response.value) && Array.isArray(response.value.sessions) ? response.value.sessions : null;
    if (sessions === null) return;
    const spawned = sessions.filter((record): record is Record<string, unknown> & { appId: string } => isObject(record) && isId(record.appId) && isObject(record.launchedBy) && record.launchedBy.opId === opId);
    const spawns = [...new Set(spawned.map((record) => record.appId))];
    if (spawns.length > 1) this.#ctx.log(`endpoint: a lane B record's spawn ${opId.slice(0, 64)} names ${spawns.length} app sessions; it is placed under none, and each is handed off`);
    // A member gone or joined meanwhile is not joined here; its sight is passed on all the same, and each app session
    // it passed to, but not joined under, is told, so a subscription held there by the bridge is decided again.
    if (spawns.length === 1 && this.#members.get(session)?.lane === 'B' && !this.#apps.has(session)) {
      this.#apps.set(session, spawns[0]!);
      const current = spawned[0]!.engineSessionId;
      if (isId(current) && current !== session) this.#superseded.add(session);
    }
    for (const app of spawns) {
      this.#placed(session, app);
      if (this.#apps.get(session) !== app) this.#tell({ lane: 'B', session, appSessionId: app });
    }
  }

  /** P5 O12 M11: the handed-off mark as on disk, read on its first use (then pruned once); null while it can't be read. */
  #marks(): MarkSets | null {
    if (this.#durable !== null) return this.#durable;
    if (this.#ctx.marks === undefined) return (this.#durable = { apps: new Set(), engines: new Set() });
    let read: Marks | null;
    try {
      read = this.#ctx.marks.read();
    } catch (error) {
      this.#ctx.log(`endpoint: the handed-off mark could not be read: ${(error as Error).message}`);
      return null;
    }
    if (read === null) return null;
    this.#durable = { apps: new Set(read.appSessionIds), engines: new Set(read.engineSessionIds) };
    void this.#prune(this.#durable);
    return this.#durable;
  }

  /** P5 O12 M11: `id` marked handed off; whether the mark is on disk (else it waits, counted, for the next write). */
  #mark(kind: keyof MarkSets, id: string): boolean {
    const durable = this.#marks();
    if (durable?.[kind].has(id)) return true;
    this.#pending[kind].add(id);
    return durable !== null && this.#persist(durable);
  }

  /**
   * P5 O12 M11: the engine session `session` placed under `app`: the app session marked, the engine session's own mark
   * dropped, in one write; whether the app session's mark is on disk (a write that fails changes nothing on disk, the
   * app session's mark waiting, counted, with the rest).
   */
  #placed(session: string, app: string): boolean {
    const durable = this.#marks();
    this.#pending.apps.add(app);
    if (durable === null) return false;
    if (durable.apps.has(app) && !durable.engines.has(session) && !this.#pending.engines.has(session)) {
      this.#pending.apps.delete(app);
      return true;
    }
    return this.#persist(durable, { engines: [session] }) || durable.apps.has(app);
  }

  /** P5 O12 M11: the mark written whole, the pending marks with it, less `drop`; whether the write held (nothing changes when not). */
  #persist(durable: MarkSets, drop: { apps?: readonly string[]; engines?: readonly string[] } = {}): boolean {
    const apps = new Set([...durable.apps, ...this.#pending.apps]);
    const engines = new Set([...durable.engines, ...this.#pending.engines]);
    for (const app of drop.apps ?? []) apps.delete(app);
    for (const session of drop.engines ?? []) engines.delete(session);
    try {
      this.#ctx.marks?.write({ appSessionIds: [...apps], engineSessionIds: [...engines] });
    } catch (error) {
      this.#ctx.log(`endpoint: the handed-off mark could not be written (${(error as Error).message}); the sessions it would mark stay closed until it is`);
      return false;
    }
    durable.apps = apps;
    durable.engines = engines;
    this.#pending.apps.clear();
    this.#pending.engines.clear();
    return true;
  }

  /** P5 O12 M11: the mark loses each app session the spine no longer holds (deleted); a spine that can't answer keeps them all. */
  async #prune(durable: MarkSets): Promise<void> {
    const before = [...durable.apps];
    if (before.length === 0) return;
    let response;
    try {
      response = await this.#ctx.dispatch('machine', 'session.list', { includeArchived: true });
    } catch {
      return;
    }
    const sessions = response.ok && isObject(response.value) && Array.isArray(response.value.sessions) ? response.value.sessions : null;
    if (sessions === null) return;
    const held = new Set(sessions.flatMap((record) => (isObject(record) && isId(record.appId) ? [record.appId] : [])));
    const gone = before.filter((app) => !held.has(app));
    if (gone.length === 0) return;
    this.#persist(durable, { apps: gone });
  }

  async #report(member: Member): Promise<void> {
    const session = this.listingId(member.session);
    if (session === null) return;
    // P5 Decision Log 190 (b): a superseded record never replaces the listing of one that is not.
    if (this.#superseded.has(member.session) && this.sessions().some((other) => other !== member.session && !this.#superseded.has(other) && this.listingId(other) === session)) return;
    // U9: a lane B session's listing follows its record: withdrawn while archived, under the record's title
    const says = member.lane === 'B' ? await this.#recordOf(session) : null;
    if (says?.archived === true) return this.#ctx.listings.gone(session);
    await this.#ctx.listings.report({
      session,
      project: member.project,
      lane: member.lane,
      state: member.state,
      title: says?.title ?? member.title ?? '',
      owners: member.owners,
      ...(member.access === undefined ? {} : { access: member.access }),
    });
  }

  /** U9: what the spine's record says of `app`'s listing, read once (inside a hold) and then kept current by `recordChanged`. */
  async #recordOf(app: string): Promise<RecordSays | null> {
    const known = this.#records.get(app);
    if (known !== undefined) return known;
    const release = this.#ctx.hold?.('a listing reading its record') ?? (() => {});
    try {
      const response = await this.#ctx.dispatch('machine', 'session.get', { appSessionId: app });
      if (!response.ok || !isObject(response.value)) return null; // no record (or no answer): the member's report stands
      // a change heard while the read was out is the newer
      const says = this.#records.get(app) ?? recordSaysOf(response.value);
      this.#records.set(app, says);
      return says;
    } catch (error) {
      this.#ctx.log(`endpoint: a lane B record could not be read for its listing (${(error as Error).message}); its report stands`);
      return null;
    } finally {
      release();
    }
  }

  /** Tells the record's listeners when what authorization reads of it moved (or it came or went). */
  #changed(now: Member, before: Member | undefined): void {
    const same = before !== undefined && before !== now && JSON.stringify([before.owners, before.access, before.shares, before.launch, before.lane]) === JSON.stringify([now.owners, now.access, now.shares, now.launch, now.lane]);
    if (same) return;
    const app = this.#apps.get(now.session);
    this.#tell(now.lane === 'A' ? { lane: 'A', session: now.session } : { lane: 'B', session: now.session, appSessionId: app ?? '' });
  }

  /** Tells the record's listeners that what authorization reads of `target` may have moved. */
  #tell(target: SessionTarget): void {
    for (const listener of this.#listeners) {
      try {
        listener(target);
      } catch (error) {
        this.#ctx.log(`endpoint: a record listener failed: ${(error as Error).message}`);
      }
    }
  }
}
