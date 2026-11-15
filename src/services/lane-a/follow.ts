// A watched terminal session's subagents and jobs (UX wave U8d M2; docs/doperpowers/plans/2026-11-15-ux-wave-U8d-terminal-
// subagents.md, "The inputs on this Mac", "What is derived, and when it is sent", M2's decisions 1 to 6): one follow per
// session while a watch holds it (./driver.ts starts and stops it), holding the main transcript's follower, the engine
// host's listing of the sidecars, and a follower of each parent agent's own transcript; the bridge's agents are the state
// stream's (./agents.ts). DX4's body is derived from them (./jobs.ts `derive`) when, and only when, one of them changed:
// a ledger's facts, the bridge's map, the listing, or the process going. Rows that name no agent and no job, nearly every
// row of a transcript that streams, derive nothing and send nothing.
//
// - A tick (every `pollMs`) reads the main transcript and every open parent; a bridge event asks for a read at once,
//   joining one in flight, and derives after it.
// - The first listing is owed until it is answered: a failed read is asked again on the backoff's steps and when the
//   engine host streams again, at which a held listing is read again too (a restarted host says changes only for the
//   sessions it has read). An answer older than the one held, or one that lands after the follow stopped, is dropped.
// - A parent's follower follows the grades of its nested agents ("Settled and provisional", N2): open (read on each
//   tick) while one of them runs or has provisionally ended; read once when it becomes a parent or a new agent is listed
//   under it; once settled with nothing under it open, read once more and closed for good, its ledger kept. A parent
//   that cannot be read is tried again only when the listing changes its own entry or names a new agent under it.
import type { SubagentEntry } from '@shared/ipc/schema/fs';
import type { AgentMeta, DerivedAgent, LaneAAgent } from '@shared/lane-a/agents';
import type { BridgeAgents } from './agents';
import { derive, settled, type Ledger } from './jobs';
import { NO_SUBAGENTS, type SubagentsBody } from './reshape';
import { TranscriptJobs } from './transcript-jobs';

export interface FollowDeps {
  session: string; // the engine session id, which log lines name
  locate(): Promise<string | null>; // the main transcript's path now
  bridge: BridgeAgents; // the state stream's, held by the driver
  listing?(): Promise<SubagentEntry[]>; // `fs.subagents`; a rejection is a failed read
  pollMs: number;
  backoff(): { next(): number }; // a fresh backoff for a run of failed listings
  changed(): void; // the body changed
  log(line: string): void;
}

// A parent agent's follower: its own transcript, holding its nested agents' calls and results.
interface Parent {
  id: string;
  jobs: TranscriptJobs;
  held: boolean; // a read found its file: its ledger is its nested agents' loop
  readable: boolean | null; // null until its first read lands
  key: string | null; // its listing entry when it was last read (null: not listed)
  children: Set<string>; // the agents listed under it
  open: boolean; // read on each tick
  reading: boolean;
  final: boolean; // its last read began once it was settled with nothing under it open
  closed: boolean;
  logged: Set<string>; // the causes of an unreadable file already logged
}

const ENDED: readonly string[] = ['completed', 'failed', 'stopped', 'exited'];
const str = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const parentOf = (e: DerivedAgent): string | null => str(e.meta.parentAgentId) ?? str(e.spawn?.parentAgentId);
const keyOf = ({ agentId, transcriptPath, runId, meta }: SubagentEntry): string => JSON.stringify([agentId, transcriptPath, runId, meta]); // the host's own change key
const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export class SessionFollow {
  readonly main: TranscriptJobs;
  private stopped = false;
  private running = true; // the session's process; false once it is gone
  private tick: NodeJS.Timeout | null = null;
  private round: Promise<void> | null = null;
  private inputs: string | null = null; // what the last derivation was made of
  private entries = new Map<string, DerivedAgent>();
  private current: SubagentsBody = NO_SUBAGENTS;
  private readonly parents = new Map<string, Parent>();
  // the listing
  private metas: AgentMeta[] = [];
  private listed = new Map<string, SubagentEntry>();
  private listedKey: string | null = null;
  private listingVersion = 0;
  private asked = 0; // the listings asked for, a change event counted as one asked and answered at once
  private applied = 0;
  private retry: NodeJS.Timeout | null = null;
  private delays: { next(): number } | null = null;
  private failureLogged = false;

  constructor(private readonly deps: FollowDeps) {
    this.main = new TranscriptJobs(deps.locate);
  }

  start(): void {
    this.poll();
    this.readListing();
  }

  stop(): void {
    this.stopped = true;
    if (this.tick) clearTimeout(this.tick);
    if (this.retry) clearTimeout(this.retry);
    this.tick = this.retry = null;
  }

  /** The body as last derived: what a watch's snapshot carries. */
  get body(): SubagentsBody {
    return this.current;
  }

  get sessionRunning(): boolean {
    return this.running;
  }

  /** The bridge's map changed: a read at once (joining one in flight), then a derivation. */
  bridgeChanged(): void {
    void this.read();
  }

  /** The engine host's `fs.subagentsChanged` for the session: the whole listing. */
  listingChanged(entries: SubagentEntry[]): void {
    this.applyListing(entries, ++this.asked);
  }

  /** The engine host streams again: the listing is read again, owed until that read is answered. */
  hostStreaming(): void {
    this.readListing();
  }

  /** The session's process is gone: derived with it gone, now, before the watches end. */
  processGone(): void {
    this.running = false;
    this.update(false);
  }

  // ---- reads ----------------------------------------------------------------------------------------------------------
  private poll(): void {
    void this.read().finally(() => {
      if (this.stopped) return;
      this.tick = setTimeout(() => this.poll(), this.deps.pollMs);
      this.tick.unref();
    });
  }

  // One round: the main transcript and every open parent, then a derivation if an input moved.
  private read(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.round !== null) return this.round;
    const open = [...this.parents.values()].filter((p) => p.open && !p.reading);
    const round = Promise.all([
      this.main.read().catch((error: unknown) => this.deps.log(`${this.deps.session}: its transcript could not be read for its jobs and subagents (${message(error)})`)),
      ...open.map((p) => this.readParent(p, false, false)),
    ]);
    this.round = round.then(() => {
      this.round = null;
      this.update(open.length > 0);
    });
    return this.round;
  }

  // `final`: it is read once it was settled with nothing under it open. `alone`: not in a round, so it updates itself.
  private readParent(p: Parent, final: boolean, alone: boolean): Promise<void> {
    p.reading = true;
    p.key = this.keyOfParent(p.id);
    return p.jobs.read().then(
      () => {
        if (p.jobs.found) {
          p.readable = p.held = true;
        } else this.unreadable(p, p.key === null ? 'not listed' : 'missing', p.key === null ? 'is in no listing' : 'is missing');
      },
      (error: unknown) => this.unreadable(p, 'failed', `could not be read (${message(error)})`),
    ).finally(() => {
      p.reading = false;
      if (final && p.readable === true) p.final = true;
      if (alone) this.update(true);
    });
  }

  private unreadable(p: Parent, cause: string, said: string): void {
    p.readable = false;
    p.open = false;
    if (this.stopped || p.logged.has(cause)) return;
    p.logged.add(cause);
    this.deps.log(`${this.deps.session}: the transcript of agent ${p.id}, a parent, ${said}; it is tried again when the listing changes it`);
  }

  // ---- the listing ----------------------------------------------------------------------------------------------------
  private readListing(): void {
    const listing = this.deps.listing;
    if (listing === undefined || this.stopped) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const asked = ++this.asked;
    listing().then(
      (entries) => this.applyListing(entries, asked),
      (error: unknown) => this.listingFailed(error, asked),
    );
  }

  // Every read is owed until answered: the first, and the one at the host's streaming signal. One that fails leaves the
  // last listing standing and is asked again on the backoff's steps, unless a later read or a change answers first.
  private listingFailed(error: unknown, asked: number): void {
    if (this.stopped || asked !== this.asked) return;
    if (!this.failureLogged) this.deps.log(`${this.deps.session}: its subagents’ listing could not be read (${message(error)}); it is asked again`);
    this.failureLogged = true;
    this.delays ??= this.deps.backoff();
    this.retry = setTimeout(() => {
      this.retry = null;
      this.readListing();
    }, this.delays.next());
    this.retry.unref();
  }

  private applyListing(entries: SubagentEntry[], asked: number): void {
    if (this.stopped || asked < this.applied) return;
    this.applied = asked;
    this.failureLogged = false;
    this.delays = null;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    this.listed = new Map(entries.map((e) => [e.agentId as string, e]));
    const key = JSON.stringify(entries.map(keyOf));
    if (key === this.listedKey) return;
    this.listedKey = key;
    this.listingVersion += 1;
    // a workflow's agents are in no list
    this.metas = entries.filter((e) => e.runId === null).map((e) => ({ agentId: e.agentId, meta: (e.meta ?? {}) as Record<string, unknown> }));
    this.update(false);
  }

  private keyOfParent(id: string): string | null {
    const listed = this.listed.get(id);
    return listed === undefined ? null : keyOf(listed);
  }

  // ---- the derivation ---------------------------------------------------------------------------------------------------
  // Derives when an input moved since the last derivation; then, and after a parent's read, decides each parent's
  // follower from the entries.
  private update(evaluate: boolean): void {
    if (this.stopped) return;
    const inputs = JSON.stringify([
      this.main.version,
      [...this.parents.values()].filter((p) => p.held).map((p) => [p.id, p.jobs.version]),
      this.deps.bridge.version,
      this.listingVersion,
      this.running,
    ]);
    if (inputs !== this.inputs) {
      this.inputs = inputs;
      this.derive();
      evaluate = true;
    }
    if (evaluate) this.followParents();
  }

  private derive(): void {
    const parents = new Map<string, Ledger | null>();
    for (const p of this.parents.values()) parents.set(p.id, p.held ? p.jobs.ledger : null);
    const { subagents, jobs } = derive(this.main.ledger, { metas: this.metas, bridge: this.deps.bridge.list(), parents, sessionRunning: this.running });
    this.entries = new Map(subagents.map((e) => [e.agentId, e]));
    this.current = { subagents: subagents.map((e) => this.withStart(e, parents)), jobs };
    this.deps.changed();
  }

  // R2: when the agent's call was made, from the ledger of the loop that made it (the main one, or its parent's).
  private withStart(e: DerivedAgent, parents: ReadonlyMap<string, Ledger | null>): LaneAAgent {
    const parent = parentOf(e);
    const loop = parent === null ? this.main.ledger : (parents.get(parent) ?? null);
    const tool = str(e.meta.toolUseId) ?? str(e.spawn?.toolUseId);
    const at = tool === null ? null : (loop?.callAt(tool) ?? null);
    return at === null ? e : { ...e, startedAt: at };
  }

  private followParents(): void {
    if (!this.running) return; // the follow ends with the process: every status is settled, nothing is read again
    const under = new Map<string, DerivedAgent[]>();
    for (const e of this.entries.values()) {
      const parent = parentOf(e);
      if (parent === null) continue;
      const nested = under.get(parent);
      if (nested === undefined) under.set(parent, [e]);
      else nested.push(e);
    }
    for (const [id, nested] of under) {
      const p = this.parents.get(id) ?? this.parent(id);
      if (p.reading) continue; // decided again when its read lands
      const named = nested.filter((n) => !p.children.has(n.agentId));
      for (const n of named) p.children.add(n.agentId);
      const open = nested.some((n) => n.status === 'running' || (ENDED.includes(n.status) && !settled(n, this.entries)));
      const own = this.entries.get(id);
      const done = !open && own !== undefined && settled(own, this.entries);
      if (p.readable === null || named.length > 0) {
        // it became a parent, or a new entry names it: read, as when it first became one
        p.closed = p.final = false;
        void this.readParent(p, done, true);
      } else if (p.readable === false) {
        if (this.keyOfParent(id) !== p.key) void this.readParent(p, done, true);
      } else if (!p.closed) {
        p.open = open;
        if (!done) p.final = false;
        else if (p.final) p.closed = true;
        else void this.readParent(p, true, true);
      }
    }
  }

  private parent(id: string): Parent {
    const p: Parent = {
      id,
      jobs: new TranscriptJobs(() => Promise.resolve(this.listed.get(id)?.transcriptPath ?? null)),
      held: false, readable: null, key: null, children: new Set(), open: false, reading: false, final: false, closed: false, logged: new Set(),
    };
    this.parents.set(id, p);
    return p;
  }
}
