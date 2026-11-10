// The other machines' projects records (the project registry, docs/doperpowers/plans/2026-11-10-project-registry.md,
// Interfaces §H, "The held records"; its design §4, §8). The hub hands this endpoint every machine's record, its own
// included: the snapshot as `projects-all` pages after a welcome that lists `projects`, then each record as the hub
// stores it. The hub confers nothing (constraint 6): every record is verified here against the head held
// (`verifyProjectsRecord`), and the newest verified one of each machine is kept in `projects-held.json` with its mark
// (its revision, the hash of its canonical form, the key id that signed it), so the directory sminos reads and the
// registry's answers outlive a restart with the hub out of reach.
//
// - A record below a machine's mark is passed by; one at the mark with another hash is a conflict, passed by and logged;
//   one above it is verified and kept.
// - The hub's snapshot removes nothing: a machine it lacks keeps its record (unknown is not empty, constraint 4). A mark
//   and its record go only when the head no longer lets that key speak for the machine (`adopted`): a retired or
//   re-keyed machine's record stops verifying.
// - A record counts (`records`) once it verified in this run (M9's review 1, F4): one read from the file only after
//   `adopted` verified it again, which the endpoint asks at its start, as at each new head. A delegated machine's
//   authority ends with its delegation's `expires`, with no new head, so the records are verified again then too.
// - The machine's own record, as the hub holds it, goes to `own` once it verifies under this machine's own key: its
//   revision is the floor the next record is signed above (projects.ts). A counter the hub merely states is never one.
// - `complete` (§D): connected to a hub that keeps records, its snapshot of this connection ended, and every machine held
//   here was in it at or above its mark. Until then, and from the connection's end, the directory is incomplete, which
//   is what keeps sminos's leaving rule from reading a withheld record as a project gone. A machine is in it only by a
//   record that verified, or by the very record held (M9's review 1, F5); a frame belongs to the connection it came on,
//   and one still queued when that connection ended is dropped (F6).
import { createHash } from 'node:crypto';
import { canonicalize, isProjectsRecord, isSigned, verifyProjectsRecord, type Certificates, type OrgState, type ProjectsPageFrame, type ProjectsRecord, type ProjectsRecordFrame, type Signed } from 'org-protocol';
import type { ProjectsHeldFile } from './state/store';

export type HeldMachines = ProjectsHeldFile['machines'];

/** A connection's snapshot: the newest revision seen of each machine, and whether its last page came. */
type Snapshot = { seen: Map<string, number>; ended: boolean };

export type HeldContext = {
  /** This machine's ref: its own record is not held here. */
  ref(): string;
  /** The key id of this machine's key in force; null while none is held. */
  ownKeyId(): string | null;
  head(): { state: OrgState; certificates: Certificates } | null;
  now(): number;
  store: { read(): HeldMachines; write(machines: HeldMachines): void };
  /** This machine's own record as the hub holds it, verified under its own key. */
  own(record: Signed<ProjectsRecord>): void;
  /** The held records or `complete` moved. */
  changed(): void;
  /** This connection's snapshot ended: its floor, if any, has been handed to `own`. */
  snapshotEnded(): void;
  log(line: string): void;
};

/** The longest a timer waits (Node fires a longer one at once); the check then waits again. */
const LONGEST_WAIT_MS = 2 ** 31 - 1;

/** The hash a mark keeps: of the record's canonical form, so the same record in another key order is the same. */
export const recordHash = (record: Signed<ProjectsRecord>): string => createHash('sha256').update(canonicalize(record)).digest('base64url');

export class HeldProjects {
  readonly #ctx: HeldContext;
  #snapshot: Snapshot | null = null;
  /** The hub connection's generation, moved at each welcome and end: a frame is taken on the one it came on. */
  #connection = 0;
  /** The hash of each machine's held record as verified in this run. */
  readonly #verified = new Map<string, string>();
  /** The next check of the held records, at the soonest delegation's `expires`. */
  #expiry: ReturnType<typeof setTimeout> | null = null;
  #stopped = false;
  #queue: Promise<unknown> = Promise.resolve();
  readonly #said = new Set<string>();

  constructor(ctx: HeldContext) {
    this.#ctx = ctx;
  }

  /** A hub connection was welcomed; `keeps`: its welcome lists `projects`, so its snapshot follows. */
  welcomed(keeps: boolean): void {
    this.#connection++;
    this.#snapshot = keeps ? { seen: new Map(), ended: false } : null;
    this.#ctx.changed();
  }

  /** The hub connection ended: the directory is incomplete until the next snapshot ends. */
  ended(): void {
    this.#connection++;
    this.#snapshot = null;
    this.#ctx.changed();
  }

  /** A `projects` or `projects-all` frame from the hub, taken in the order they came. */
  frame(frame: ProjectsRecordFrame | ProjectsPageFrame): Promise<void> {
    const connection = this.#connection;
    const snapshot = this.#snapshot;
    return this.#serial(async () => {
      if (connection !== this.#connection) return; // its connection ended: the next one's snapshot sends it again
      if (frame.t === 'projects') return void (await this.#take(frame.record, snapshot));
      if (!Array.isArray(frame.records)) return this.#once('page', 'endpoint: the hub sent a projects page with no records; ignored');
      for (const record of frame.records) await this.#take(record, snapshot);
      if (frame.last === true && snapshot !== null && connection === this.#connection && !snapshot.ended) {
        snapshot.ended = true;
        this.#ctx.snapshotEnded();
        this.#ctx.changed();
      }
    });
  }

  /**
   * The start, a new head or certificate set, or a delegation's `expires` reached: every held record verified again,
   * those that verify counted, those that no longer do dropped.
   */
  adopted(): Promise<void> {
    return this.#serial(async () => {
      const head = this.#ctx.head();
      if (head === null) return;
      const held = { ...this.#ctx.store.read() };
      let moved = false;
      for (const [ref, entry] of Object.entries(held)) {
        const verdict = await verifyProjectsRecord(head.state, entry.record, head.certificates, new Date(this.#ctx.now()));
        if (verdict.ok) {
          moved ||= this.#verified.get(ref) !== entry.hash;
          this.#verified.set(ref, entry.hash);
          continue;
        }
        delete held[ref];
        this.#verified.delete(ref);
        moved = true;
        this.#ctx.log(`endpoint: the projects record of machine ${ref.slice(0, 64)} no longer verifies (${verdict.code}); dropped`);
      }
      if (Object.keys(held).length !== Object.keys(this.#ctx.store.read()).length) this.#ctx.store.write(held);
      this.#expires();
      if (moved) this.#ctx.changed();
    });
  }

  /** The held records' bodies that verified in this run, by machine ref. */
  records(): ProjectsRecord[] {
    return Object.entries(this.#ctx.store.read()).flatMap(([ref, entry]) => (this.#verified.get(ref) === entry.hash ? [entry.record.body] : []));
  }

  /** The endpoint stopped: no check waits. */
  stop(): void {
    this.#stopped = true;
    if (this.#expiry !== null) clearTimeout(this.#expiry);
    this.#expiry = null;
  }

  /** §D's `complete`: this connection's snapshot ended, and every machine held here was in it at or above its mark. */
  complete(): boolean {
    const snapshot = this.#snapshot;
    if (snapshot === null || !snapshot.ended) return false;
    return Object.entries(this.#ctx.store.read()).every(([ref, entry]) => (snapshot.seen.get(ref) ?? 0) >= entry.revision);
  }

  /** Settles once every frame and re-verification taken so far is done (the suites'). */
  settled(): Promise<void> {
    return this.#queue.then(() => {});
  }

  async #take(record: unknown, snapshot: Snapshot | null): Promise<void> {
    if (!isSigned(record, isProjectsRecord)) return this.#once('shape', 'endpoint: the hub sent a projects record that is not one; ignored');
    const { machine, revision } = record.body;
    const head = this.#ctx.head();
    const now = new Date(this.#ctx.now());
    if (machine === this.#ctx.ref()) {
      if (head === null || record.sig.kid !== this.#ctx.ownKeyId()) return;
      if ((await verifyProjectsRecord(head.state, record, head.certificates, now)).ok) this.#ctx.own(record);
      return;
    }
    const seen = (): void => {
      if (snapshot !== null) snapshot.seen.set(machine, Math.max(snapshot.seen.get(machine) ?? 0, revision));
    };
    const mark = this.#ctx.store.read()[machine];
    if (mark !== undefined && revision < mark.revision) return;
    const hash = recordHash(record);
    if (mark !== undefined && revision === mark.revision) {
      if (hash === mark.hash) return seen(); // the very record held
      return this.#ctx.log(`endpoint: the hub sent machine ${machine.slice(0, 64)}'s projects record ${revision} with other content than the one held at that revision; ignored`);
    }
    if (head === null) return this.#once('headless', 'endpoint: a projects record came before the org state was read; ignored until the next snapshot');
    const verdict = await verifyProjectsRecord(head.state, record, head.certificates, now);
    if (!verdict.ok) return this.#ctx.log(`endpoint: machine ${machine.slice(0, 64)}'s projects record ${revision} does not verify (${verdict.code}); ignored`);
    this.#ctx.store.write({ ...this.#ctx.store.read(), [machine]: { revision, hash, keyId: record.sig.kid, record } });
    this.#verified.set(machine, hash);
    seen();
    this.#expires();
    this.#ctx.changed();
  }

  /** The held records checked again at the soonest delegation's `expires` still ahead, while any is held. */
  #expires(): void {
    if (this.#expiry !== null) clearTimeout(this.#expiry);
    this.#expiry = null;
    const head = this.#ctx.head();
    if (this.#stopped || head === null || Object.keys(this.#ctx.store.read()).length === 0) return;
    const now = this.#ctx.now();
    const ahead = head.state.delegations.map((d) => Date.parse(d.expires)).filter((at) => at > now);
    if (ahead.length === 0) return;
    this.#expiry = setTimeout(() => void this.adopted(), Math.min(Math.min(...ahead) - now + 1, LONGEST_WAIT_MS));
    this.#expiry.unref?.();
  }

  #once(kind: string, line: string): void {
    if (this.#said.has(kind)) return;
    this.#said.add(kind);
    this.#ctx.log(line);
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(run).catch((error: unknown) => this.#ctx.log(`endpoint: a projects record could not be taken: ${(error as Error).message}`));
    this.#queue = next;
    return next;
  }
}
