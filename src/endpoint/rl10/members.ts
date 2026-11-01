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
  controller?: unknown;
};

const ACCESS: ReadonlySet<string> = new Set(['private', 'listed', 'org-view', 'org-converse']);
const SHARE_GRADES: ReadonlySet<string> = new Set(['view', 'converse', 'approve']);
const isText = (v: unknown, max = 4096): v is string => typeof v === 'string' && v.length <= max;
const isId = (v: unknown): v is string => typeof v === 'string' && v !== '' && v.length <= 512;
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** A `member` frame read for what the endpoint relies on, or null when it doesn't hold its shape. */
export function readMember(frame: Record<string, unknown>): Member | null {
  const { session, alias, project, lane, state, title, cwd, worktree, launch, owners, ownersProof, origin, access, shares } = frame;
  if (!isId(session) || !isText(alias) || !isId(project) || (lane !== 'A' && lane !== 'B') || !isText(state, 256) || !isText(cwd)) return null;
  if (title !== undefined && !isText(title)) return null;
  if (worktree !== undefined && !isText(worktree)) return null;
  if (launch !== undefined && !isId(launch)) return null;
  if (!Array.isArray(owners) || !owners.every((o) => isId(o))) return null;
  if (!Array.isArray(ownersProof)) return null;
  if (!isObject(origin) || !isText(origin.kind, 256)) return null;
  if (access !== undefined && !(typeof access === 'string' && ACCESS.has(access))) return null;
  if (shares !== undefined && !(Array.isArray(shares) && shares.every((s) => isObject(s) && isId(s.member) && typeof s.grade === 'string' && SHARE_GRADES.has(s.grade)))) return null;
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
  log(line: string): void;
  now(): number;
  /**
   * P5 O12 M11: the handed-off mark on disk, app sessions and the engine sessions of records the join could not place:
   * `read` null while the state can't be read, `write` throwing when it can't be written. Absent (a suite's), the mark
   * is kept in memory only.
   */
  marks?: { read(): Marks | null; write(marks: Marks): void };
};

/** P5 O12 M11: the handed-off mark's two lists. */
export type Marks = { appSessionIds: readonly string[]; engineSessionIds: readonly string[] };
type MarkSets = { apps: Set<string>; engines: Set<string> };

export class Members implements RecordSource, CheckoutSource {
  readonly #ctx: MembersContext;
  readonly #members = new Map<string, Member>();
  /** Lane B: engine session id → appSessionId, from `engine.sessions`. */
  readonly #apps = new Map<string, string>();
  readonly #checkouts = new Map<string, string[]>();
  readonly #listeners = new Set<(target: SessionTarget) => void>();
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
      this.#changed(member, member);
    }
    // A lane B app's listing outlives an engine session it superseded: while another member holds the listing (the
    // app's engine session now), retiring the old record withdraws and forgets nothing.
    if (listing !== null && !this.#listedBy(listing)) {
      // Withdrawn first, which settles what notify told the hub (`settled 0`, or owed), then forgotten.
      await this.#ctx.listings.gone(listing);
      this.#ctx.forget(listing);
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

  /** The appSessionId a lane B member was joined to, or null. */
  appSessionId(session: string): string | null {
    return this.#apps.get(session) ?? null;
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
   */
  async #join(session: string): Promise<void> {
    if (this.#apps.has(session)) return;
    let response;
    try {
      response = await this.#ctx.dispatch('engine-host', 'engine.sessions', undefined);
    } catch (error) {
      return this.#ctx.log(`endpoint: engine.sessions could not be read (${(error as Error).message}); a lane B session waits for its appSessionId`);
    }
    if (!response.ok || !Array.isArray(response.value)) return;
    for (const status of response.value as Array<{ appSessionId?: unknown; engineSessionId?: unknown }>) {
      if (!isId(status.appSessionId) || !isId(status.engineSessionId) || this.#members.get(status.engineSessionId)?.lane !== 'B') continue;
      this.#apps.set(status.engineSessionId, status.appSessionId);
      this.#placed(status.engineSessionId, status.appSessionId);
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
    await this.#ctx.listings.report({
      session,
      project: member.project,
      lane: member.lane,
      state: member.state,
      title: member.title ?? '',
      owners: member.owners,
      ...(member.access === undefined ? {} : { access: member.access }),
    });
  }

  /** Tells the record's listeners when what authorization reads of it moved (or it came or went). */
  #changed(now: Member, before: Member | undefined): void {
    const same = before !== undefined && before !== now && JSON.stringify([before.owners, before.access, before.shares, before.launch, before.lane]) === JSON.stringify([now.owners, now.access, now.shares, now.launch, now.lane]);
    if (same) return;
    const app = this.#apps.get(now.session);
    const target: SessionTarget = now.lane === 'A' ? { lane: 'A', session: now.session } : { lane: 'B', session: now.session, appSessionId: app ?? '' };
    for (const listener of this.#listeners) {
      try {
        listener(target);
      } catch (error) {
        this.#ctx.log(`endpoint: a record listener failed: ${(error as Error).message}`);
      }
    }
  }
}
