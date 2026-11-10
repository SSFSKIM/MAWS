// The machine's own projects record and the locations sminos is told (the project registry,
// docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §A, §D and §H; its design §3, §4). The machine is the
// only writer of its record: its declared rows, read from the index through `ProjectsSource`, and `known`, the projects
// with sessions here and no location here.
//
// - Signing. At each change of the source and at each welcome the body is built from the snapshot. A body whose content
//   is the kept record's is not signed again: the kept bytes go again at a welcome, as a listing's do. Otherwise it is
//   signed at a revision that is the later of one past the last and the clock's milliseconds, and above the floor: the
//   revision of this machine's own record as the hub last showed it, verified under this machine's own key
//   (projects-held.ts). When the hub holds a record of this machine at or above the kept one and it is not the kept one,
//   the next is signed above it, which is how a record refused `stale-projects` is signed again. The record is written to
//   the kept file before it is sent, and sent only to a hub whose welcome lists `projects`. From such a welcome until its
//   snapshot ended (at most FLOOR_WAIT_MS) nothing new is signed: the snapshot carries the floor, and a record signed
//   before it would be refused a second time after a lost or older state file.
// - Unknown is not empty (design §3). A null snapshot (the index not loaded, or a declared row not derived yet) signs and
//   sends nothing; the kept record stays what the hub and the directory read.
// - Restoring. When the snapshot comes from another index than the kept file's and the file holds statements, the index
//   takes them back (`restore`) before anything is signed from it, and the file takes the new index's id.
// - The locations sminos is told (§D): every declared location in canonical path form with the project the rule gives,
//   `stated` and `anchor` where a stored statement of the row's own folder decides, and its `hub: false` and state. Read
//   from the snapshot, else from the kept record and statements, so a daemon whose index is not loaded still tells sminos
//   what it last knew; with neither nothing is told (a frame without `locations` erases none). Its `gen` is the later of
//   one past the last and the clock's milliseconds, raised whenever their content changes, an anchor alone included.
import { basename } from 'node:path';
import { machineProjectId } from 'desk-hub/protocol';
import {
  canonicalize,
  isProjectsRecord,
  machineProjectNames,
  PROJECTS_RECORD_BOUNDS,
  signRecord,
  SIGNING_DOMAINS,
  type Certificates,
  type KnownProject,
  type OrgState,
  type ProjectLocation,
  type ProjectsRecord,
  type Signed,
  type SigningKey,
} from 'org-protocol';
import type { Anchor, DeclaredRow, KeptStatement, ProjectsSource } from '@shared/machine/registry';
import type { HubUpFrame } from './hub-link';
import type { ProjectsKeptFile } from './state/store';

/** An entry of the org frame's `locations.at` (§D). */
export type LocationEntry = { path: string; project: string; hub?: false; stated?: 'minted' | 'linked'; anchor?: Anchor; state?: 'missing' | 'replaced' };
export type Locations = { gen: number; at: LocationEntry[] };

export type OwnContext = {
  ref(): string;
  /** The enrollment's org and machine name; null while the machine is not enrolled. */
  enrollment(): { org: string; name: string } | null;
  key(): { key: SigningKey; keyId: string } | null;
  head(): { state: OrgState; certificates: Certificates } | null;
  now(): number;
  send(frame: HubUpFrame): boolean;
  /** Whether the welcomed hub connection's welcome lists `projects`. */
  hubKeeps(): boolean;
  /** The index's side (`mawsd` gives it; none in a suite that has no index). */
  source: ProjectsSource | null;
  store: { read(): ProjectsKeptFile; write(file: ProjectsKeptFile): void };
  /** The projects held here with sessions, before the record's own rules leave out the located and the machines' own. */
  known(): KnownProject[];
  /** The kept record or the locations moved: what sminos is told is stated again. */
  moved(): void;
  log(line: string): void;
};

/** How long after a welcome new signatures wait for the hub's snapshot, which carries the floor. */
export const FLOOR_WAIT_MS = 10_000;

const ID = /^[A-Za-z0-9._-]{1,64}$/;
/** A name within §A's bound of code points, or null when nothing is left of it. */
const bounded = (name: string): string | null => {
  const kept = [...name].slice(0, PROJECTS_RECORD_BOUNDS.name).join('');
  return kept === '' ? null : kept;
};
const contentOf = (body: Pick<ProjectsRecord, 'locations' | 'known'>): string => canonicalize({ locations: body.locations, known: body.known });

/** A declared row as a location of the record (§A): its project the rule's, else the machine's own. */
export function locationOf(row: DeclaredRow, org: string, machine: string): ProjectLocation {
  return {
    pid: row.pid,
    id: row.org.smnsId ?? machineProjectId(org, machine),
    key: row.org.key,
    name: bounded(row.name) ?? bounded(basename(row.path)) ?? row.pid,
    ...(row.nameRev === undefined ? {} : { nameRev: row.nameRev }),
    path: row.path,
    source: row.org.source,
    ...(row.stated === undefined ? {} : { stated: row.stated }),
    ...(row.hub === false ? { hub: false as const } : {}),
    ...(row.remote === undefined ? {} : { remote: row.remote }),
    ...(row.state === undefined ? {} : { state: row.state }),
  };
}

/**
 * The org frame's entry for a location (§D): `stated` and `anchor` where the row's own folder holds a statement that
 * counts (not hidden, anchored, the folder not replaced), the link's kind before the minted id's.
 */
export function locationEntry(location: ProjectLocation, kept: KeptStatement | undefined): LocationEntry {
  const own = kept !== undefined && !kept.hidden && kept.anchor !== null && (kept.linked !== null || kept.minted !== null) && location.state !== 'replaced';
  return {
    path: location.path,
    project: location.id,
    ...(location.hub === false ? { hub: false as const } : {}),
    ...(own ? { stated: kept.linked !== null ? ('linked' as const) : ('minted' as const), anchor: kept.anchor! } : {}),
    ...(location.state === undefined ? {} : { state: location.state }),
  };
}

export class OwnProjects {
  readonly #ctx: OwnContext;
  #queue: Promise<unknown> = Promise.resolve();
  #kicked = false;
  /** The revision of this machine's own record as the hub last showed it (0 before it has). */
  #floor = 0;
  #locations: Locations | null = null;
  #locationsText: string | null = null;
  /** A welcome's snapshot is awaited: new signatures wait for its floor (its release timer while it is). */
  #awaiting: ReturnType<typeof setTimeout> | null = null;
  /** The hub holds a record of this machine at or above the kept one that is not it: the next is signed whatever it says. */
  #superseded = false;

  constructor(ctx: OwnContext) {
    this.#ctx = ctx;
  }

  /** The source or `known` changed: the record built again, once for any number of calls before it runs. */
  kick(): void {
    if (this.#kicked) return;
    this.#kicked = true;
    void this.#serial(async () => {
      this.#kicked = false;
      await this.#publish();
    });
  }

  /** Builds, and signs where it changed, now, after anything queued. */
  publish(): Promise<void> {
    return this.#serial(() => this.#publish());
  }

  /**
   * A hub connection was welcomed: the kept record goes again byte for byte where it is current, and the source is read.
   * Where the hub keeps records, a new one waits for its snapshot's end (`snapshotEnded`), or FLOOR_WAIT_MS.
   */
  welcome(): Promise<void> {
    return this.#serial(async () => {
      const kept = this.#ctx.store.read().record;
      const keeps = this.#ctx.hubKeeps();
      if (kept !== null && this.#current(kept) && keeps) this.#ctx.send({ t: 'projects', record: kept });
      this.#release();
      if (keeps) {
        this.#awaiting = setTimeout(() => this.snapshotEnded(), FLOOR_WAIT_MS);
        this.#awaiting.unref?.();
      }
      await this.#publish();
    });
  }

  /** The welcome's snapshot ended (or its wait did, or the connection): what changed since is signed. */
  snapshotEnded(): void {
    if (this.#awaiting === null) return;
    this.#release();
    this.kick();
  }

  #release(): void {
    if (this.#awaiting !== null) clearTimeout(this.#awaiting);
    this.#awaiting = null;
  }

  /** The hub refused the record for now: the kept one goes again where it is still current. */
  resend(): Promise<void> {
    return this.#serial(async () => {
      const kept = this.#ctx.store.read().record;
      if (kept !== null && this.#current(kept) && this.#ctx.hubKeeps()) this.#ctx.send({ t: 'projects', record: kept });
    });
  }

  /** This machine's own record as the hub holds it (verified under its own key): its revision is the floor. */
  ownSeen(record: Signed<ProjectsRecord>): Promise<void> {
    return this.#serial(async () => {
      this.#floor = Math.max(this.#floor, record.body.revision);
      const kept = this.#ctx.store.read().record;
      if (kept !== null && record.body.revision < kept.body.revision) return;
      if (kept !== null && canonicalize(kept) === canonicalize(record)) return;
      this.#superseded = true;
      await this.#publish();
    });
  }

  /** The newest record signed, as kept. */
  record(): Signed<ProjectsRecord> | null {
    return this.#ctx.store.read().record;
  }

  /** What sminos is told of this machine's locations; null while nothing is known of them. */
  locations(): Locations | null {
    if (this.#locations === null) {
      const kept = this.#ctx.store.read();
      if (kept.record !== null) this.#setLocations(kept.record.body.locations, kept.statements, false);
    }
    return this.#locations;
  }

  /** Whether a record of these rows, with the known projects of now, keeps within §A's bounds. */
  fits(rows: readonly DeclaredRow[]): boolean {
    const enrollment = this.#ctx.enrollment();
    if (enrollment === null) return true;
    const body = this.#body(rows, enrollment);
    return isProjectsRecord({ org: enrollment.org, machine: this.#ctx.ref(), revision: Number.MAX_SAFE_INTEGER, issued: new Date(this.#ctx.now()).toISOString(), ...body });
  }

  /** Settles once everything queued so far ran (the suites'). */
  settled(): Promise<void> {
    return this.#queue.then(() => {});
  }

  async #publish(): Promise<void> {
    const source = this.#ctx.source;
    if (source === null) return;
    // The snapshot and a restore in one synchronous step: the index read is the index restored into.
    const snapshot = source.snapshot();
    if (snapshot === null) return;
    const file = this.#ctx.store.read();
    if (file.indexId !== snapshot.indexId) {
      const restoring = file.statements.length > 0;
      if (restoring) source.restore(file.statements);
      this.#ctx.store.write({ ...file, indexId: snapshot.indexId });
      if (restoring) {
        this.#ctx.log(`endpoint: the index was rebuilt; its ${file.statements.length} stored statement(s) given back from the kept file`);
        return; // the restored rows are derived again, and their change publishes
      }
    }
    if (canonicalize(snapshot.statements) !== canonicalize(this.#ctx.store.read().statements)) this.#ctx.store.write({ ...this.#ctx.store.read(), statements: snapshot.statements });
    const enrollment = this.#ctx.enrollment();
    if (enrollment === null) return;
    const body = this.#body(snapshot.rows, enrollment);
    this.#setLocations(body.locations, snapshot.statements, true);
    await this.#sign(body);
  }

  async #sign(body: Pick<ProjectsRecord, 'locations' | 'known'>): Promise<void> {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    if (key === null || head === null || this.#awaiting !== null) return;
    const kept = this.#ctx.store.read().record;
    if (!this.#superseded && kept !== null && this.#current(kept) && contentOf(kept.body) === contentOf(body)) return;
    const now = this.#ctx.now();
    const revision = Math.max((kept?.body.revision ?? 0) + 1, now, this.#floor + 1);
    const full: ProjectsRecord = { org: head.state.org, machine: this.#ctx.ref(), revision, issued: new Date(now).toISOString(), ...body };
    if (!isProjectsRecord(full)) return this.#ctx.log(`endpoint: the machine's ${body.locations.length} declared folder(s) do not fit one projects record; none signed`);
    const record = await signRecord(SIGNING_DOMAINS.projects, full, key.key.privateKey, key.key.pub);
    this.#ctx.store.write({ ...this.#ctx.store.read(), record });
    this.#superseded = false;
    if (this.#ctx.hubKeeps()) this.#ctx.send({ t: 'projects', record });
    this.#ctx.moved();
  }

  /** The record's `locations` and `known` from these rows (§A): `known` less the located and the machines' own. */
  #body(rows: readonly DeclaredRow[], enrollment: { org: string; name: string }): Pick<ProjectsRecord, 'locations' | 'known'> {
    const locations = rows.map((row) => locationOf(row, enrollment.org, enrollment.name)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const head = this.#ctx.head();
    const names = head === null ? [enrollment.name] : [enrollment.name, ...machineProjectNames(head.state, head.certificates, new Date(this.#ctx.now()))];
    const excluded = new Set([...locations.map((l) => l.id), ...names.map((name) => machineProjectId(enrollment.org, name))]);
    const known = new Map<string, KnownProject>();
    for (const candidate of this.#ctx.known()) {
      const name = bounded(candidate.name);
      if (!ID.test(candidate.id) || excluded.has(candidate.id) || known.has(candidate.id) || name === null) continue;
      known.set(candidate.id, { id: candidate.id, name });
    }
    return { locations, known: [...known.values()].sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, PROJECTS_RECORD_BOUNDS.known) };
  }

  /** What sminos is told, its `gen` raised when its content changed; `tell`: the endpoint states it again. */
  #setLocations(locations: readonly ProjectLocation[], statements: readonly KeptStatement[], tell: boolean): void {
    const byPath = new Map(statements.map((s) => [s.path, s]));
    const at = locations.map((l) => locationEntry(l, byPath.get(l.path))).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    const text = canonicalize(at);
    if (text === this.#locationsText) return;
    const file = this.#ctx.store.read();
    const gen = Math.max(file.locationsGen + 1, this.#ctx.now());
    this.#ctx.store.write({ ...file, locationsGen: gen });
    this.#locations = { gen, at };
    this.#locationsText = text;
    if (tell) this.#ctx.moved();
  }

  /** Signed by the key in force for this machine, in the head's org. */
  #current(record: Signed<ProjectsRecord>): boolean {
    const key = this.#ctx.key();
    const head = this.#ctx.head();
    return key !== null && head !== null && record.sig.kid === key.keyId && record.body.org === head.state.org && record.body.machine === this.#ctx.ref();
  }

  #serial(run: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(run).catch((error: unknown) => this.#ctx.log(`endpoint: the projects record could not be made: ${(error as Error).message}`));
    this.#queue = next;
    return next;
  }
}
