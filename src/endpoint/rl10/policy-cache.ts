// The endpoint's policy cache (P5 O18 D7, docs/doperpowers/plans/2026-11-05-p5-o18-message-reach.md): what this machine
// knows of each session's audience, kept in `policy/cache.json` in the state directory.
//
// Remote sessions. Each entry comes from a verified `joined` or `state` snapshot of a session on another machine, as it
// arrives from the hub or as a rebuild reads it back from sminos's log: the machine that signed it (its ref), its
// audience (null: listed or org-wide), its `policyRev`, its signed `created` and its attested owners. The newest wins by
// `policyRev`, a tie by `created`, so streams arriving out of order settle on the newest, and a plain-writer snapshot of a
// higher rev clears the audience. An entry is bound to its machine as the hub's registry binds the session (D5): a
// snapshot from another machine is never taken. A rebuild restores the binding rather than choosing it, since every
// snapshot the log holds passed the hub's binding check; a session whose stored snapshots name two machines (a log from
// before O18) is marked unbound for good, nothing taken from it, and the hub decides.
//
// Local sessions. Their audiences come from their records (the `member` frames), never from here; what the cache keeps
// of them is their history by `policyRev`, which an `unlisted` notice's withdrawn set is checked against at signing.
//
// The rebuild. A project is `done` once its snapshots were read back whole (`snapshots?`, link.ts). A missing or
// unreadable file has none done, so every project sminos opens is read back once; a project done stays done, its later
// snapshots arriving live.
import { join } from 'node:path';
import { readPrivateText, writeAtomic } from '../state/files';

/** An audience: the sorted member ids, or null for the whole org (listed, org-view or org-converse). */
export type Audience = string[] | null;

export type CachedPolicy = { machine: string; audience: Audience; policyRev: number; created: string; owners: string[] };
export type Snapshot = CachedPolicy & { session: string };
type Entry = CachedPolicy | { unbound: true };

const FILE = 'cache.json';
/** The local revisions kept per session, newest first; an `unlisted` notice needs only the one before its own. */
export const HISTORY = 16;

type Stored = { v: 1; done: string[]; sessions: Record<string, Entry>; local: Record<string, Array<[number, Audience]>> };

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isAudienceValue = (v: unknown): v is Audience => v === null || (Array.isArray(v) && v.every((m) => typeof m === 'string'));
const isRev = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;

function isEntry(v: unknown): v is Entry {
  if (!isObject(v)) return false;
  if (v.unbound === true) return true;
  return typeof v.machine === 'string' && isAudienceValue(v.audience) && isRev(v.policyRev) && typeof v.created === 'string' && Array.isArray(v.owners) && v.owners.every((o) => typeof o === 'string');
}

/** Whether `a` is newer than `b`: a higher `policyRev`, or the same and a later `created`. */
export const newer = (a: { policyRev: number; created: string }, b: { policyRev: number; created: string }) => a.policyRev > b.policyRev || (a.policyRev === b.policyRev && a.created > b.created);

export class PolicyCache {
  readonly #dir: (() => string) | null;
  readonly #log: (line: string) => void;
  #loaded = false;
  readonly #entries = new Map<string, Entry>();
  readonly #done = new Set<string>();
  readonly #local = new Map<string, Map<number, Audience>>();

  /** `dir` gives `policy/` (made private on first use); null holds the cache in memory only (a suite's). */
  constructor(dir: (() => string) | null, log: (line: string) => void) {
    this.#dir = dir;
    this.#log = log;
  }

  /** A remote session's policy, or null: unknown, or unbound (its log names two machines). */
  get(session: string): CachedPolicy | null {
    const entry = this.#load().get(session);
    return entry === undefined || 'unbound' in entry ? null : entry;
  }

  /** Whether the cache holds a bound policy for `session`. */
  confirmed(session: string): boolean {
    return this.get(session) !== null;
  }

  /** Every remote session with a bound policy. */
  policies(): Array<[string, CachedPolicy]> {
    return [...this.#load()].flatMap(([session, entry]) => ('unbound' in entry ? [] : [[session, entry] as [string, CachedPolicy]]));
  }

  /**
   * A verified snapshot of a remote session: taken when it is newer than the entry held and from its bound machine;
   * whether the entry moved. `rebuild`: read back from the log, where a second machine leaves the session unbound.
   */
  take(snapshot: Snapshot, rebuild = false): boolean {
    const entries = this.#load();
    const { session, ...policy } = snapshot;
    const held = entries.get(session);
    if (held !== undefined && 'unbound' in held) return false;
    if (held !== undefined && held.machine !== policy.machine) {
      if (!rebuild) return false;
      entries.set(session, { unbound: true });
      this.#log(`endpoint: the log holds snapshots of session ${session.slice(0, 64)} from two machines: the policy cache leaves it unbound, and the hub decides`);
      this.#save();
      return true;
    }
    if (held !== undefined && !newer(policy, held)) return false;
    entries.set(session, { ...policy, owners: [...policy.owners] });
    this.#save();
    return true;
  }

  /** Whether `project`'s snapshots were read back whole. */
  done(project: string): boolean {
    this.#load();
    return this.#done.has(project);
  }

  /** `project`'s snapshots read back whole: kept, so it is never read back again. */
  markDone(project: string): void {
    this.#load();
    if (this.#done.has(project)) return;
    this.#done.add(project);
    this.#save();
  }

  /** A local session's audience at `policyRev`, as its record stood (the newest computed for that rev). */
  remember(session: string, policyRev: number, audience: Audience): void {
    this.#load();
    let revs = this.#local.get(session);
    if (revs === undefined) this.#local.set(session, (revs = new Map()));
    if (revs.has(policyRev) && JSON.stringify(revs.get(policyRev)) === JSON.stringify(audience)) return;
    revs.set(policyRev, audience);
    for (const rev of [...revs.keys()].sort((a, b) => b - a).slice(HISTORY)) revs.delete(rev);
    this.#save();
  }

  /** A local session's audience at the newest rev before `policyRev`, or undefined when the cache holds none. */
  before(session: string, policyRev: number): { policyRev: number; audience: Audience } | undefined {
    this.#load();
    const revs = this.#local.get(session);
    if (revs === undefined) return undefined;
    const earlier = [...revs.keys()].filter((rev) => rev < policyRev).sort((a, b) => b - a)[0];
    return earlier === undefined ? undefined : { policyRev: earlier, audience: revs.get(earlier) ?? null };
  }

  /** Drops what was read: the state directory's records were moved aside, and the file is read anew. */
  forget(): void {
    this.#loaded = false;
    this.#entries.clear();
    this.#done.clear();
    this.#local.clear();
  }

  #load(): Map<string, Entry> {
    if (this.#loaded) return this.#entries;
    this.#loaded = true;
    if (this.#dir === null) return this.#entries;
    let text: string | null = null;
    try {
      text = readPrivateText(join(this.#dir(), FILE));
    } catch (error) {
      this.#log(`endpoint: the policy cache could not be read (${(error as Error).message}); it is rebuilt from the log`);
    }
    if (text === null) return this.#entries;
    let stored: unknown;
    try {
      stored = JSON.parse(text);
    } catch {
      this.#log('endpoint: the policy cache is not JSON; it is rebuilt from the log');
      return this.#entries;
    }
    if (!isObject(stored) || stored.v !== 1 || !Array.isArray(stored.done) || !isObject(stored.sessions) || !isObject(stored.local)) {
      this.#log('endpoint: the policy cache is not one this endpoint reads; it is rebuilt from the log');
      return this.#entries;
    }
    for (const [session, entry] of Object.entries(stored.sessions)) if (isEntry(entry)) this.#entries.set(session, entry);
    for (const project of stored.done) if (typeof project === 'string') this.#done.add(project);
    for (const [session, revs] of Object.entries(stored.local)) {
      if (!Array.isArray(revs)) continue;
      const held = new Map<number, Audience>();
      for (const pair of revs) if (Array.isArray(pair) && isRev(pair[0]) && isAudienceValue(pair[1])) held.set(pair[0], pair[1]);
      this.#local.set(session, held);
    }
    return this.#entries;
  }

  #save(): void {
    if (this.#dir === null) return;
    const stored: Stored = {
      v: 1,
      done: [...this.#done],
      sessions: Object.fromEntries(this.#entries),
      local: Object.fromEntries([...this.#local].map(([session, revs]) => [session, [...revs]])),
    };
    try {
      writeAtomic(this.#dir(), FILE, JSON.stringify(stored));
    } catch (error) {
      // Held in memory meanwhile; a lost write only means a rebuild after the next start.
      this.#log(`endpoint: the policy cache could not be written: ${(error as Error).message}`);
    }
  }
}
