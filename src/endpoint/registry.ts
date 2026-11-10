// The endpoint's half of the project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H; its
// design §3, §8): the seam the machine's services ask (`RegistrySeam`), the read `maws` takes (`RegistryRead`), and
// what RL10's org frame carries of the registry, over the machine's own record (projects.ts) and the other machines'
// (projects-held.ts).
//
// - Statements are possible on an enrolled machine whose sminos advertised `locations` in its RL10 hello; while no sminos
//   is connected, the last connection's answer, which the kept file remembers. Its listeners hear each change of the
//   answer, the turn to possible being minting's moment (c).
// - `known` (design §4, the desk track's reading): a project sminos holds (its log-plane hello does not `follow` it)
//   with sessions on this machine. While no sminos is connected, or its restatement after a welcome has not closed, the
//   last answer stands: a sminos restarting is not every project's sessions ending. After a restart, before any answer,
//   the kept record's `known` is the last answer (M9's review 1, F8).
// - The directory sminos reads (§8): every project the verified records name, this machine's own included, as a hub
//   project, but a project any location of which says `hub: false`; and the machines' own projects as today.
// - A statement change answers after sminos acknowledged the locations that carry it (`published`), within
//   RESTATE_WAIT_MS; with no sminos connected that reads them, or no locations built from the index now (it is not
//   loaded), at once, unrestated (M9's review 1, F7).
// - The kept files' writes throw on failure (M9's review 1, F3): what follows a write (a record sent, a mark kept, the
//   locations told) never runs on one that failed.
import { machineProjectId } from 'desk-hub/protocol';
import { assembleProjects, directoryMachines, machineProjectNames, type Certificates, type KnownProject, type OrgState, type ProjectsPageFrame, type ProjectsRecord, type ProjectsRecordFrame, type RegistryProject, type SigningKey } from 'org-protocol';
import type { MachineRef } from '@shared/machine/ref';
import type { DeclaredRow, ProjectsSource, RegistryRead, RegistrySeam, StatementsState } from '@shared/machine/registry';
import type { HubUpFrame } from './hub-link';
import { HeldProjects } from './projects-held';
import { OwnProjects, type Locations } from './projects';
import { NO_PROJECTS_KEPT, type EndpointState } from './state/store';

/** How long a statement change waits for sminos's acknowledgement of the locations that carry it (§H). */
export const RESTATE_WAIT_MS = 2000;

/** The capability, in sminos's RL10 hello and the endpoint's welcome, of the org frame's `locations` and `complete` (§D). */
export const LOCATIONS_CAPABILITY = 'locations';

/** What RL10 says of the connected sminos, null while none is connected and welcomed. */
export type SminosView = {
  capabilities: readonly string[];
  /** Its restatement after the welcome has not closed yet. */
  restating: boolean;
  /** The project of each session it holds. */
  sessionProjects(): string[];
  /** The projects it opened on the log plane, with its hello's name and whether it only follows them. */
  logProjects(): Array<{ project: string; name: string; follow: boolean }>;
};

export type RegistryContext = {
  ref(): MachineRef;
  /** The enrollment's org and machine name; null while the machine is not enrolled. */
  enrollment(): { org: string; name: string } | null;
  key(): { key: SigningKey; keyId: string } | null;
  head(): { state: OrgState; certificates: Certificates } | null;
  now(): number;
  hub: { send(frame: HubUpFrame): boolean; capabilities(): readonly string[] };
  sminos(): SminosView | null;
  source: ProjectsSource | null;
  state(): EndpointState | null;
  /** The org frame is stated to sminos again where it changed. */
  restate(): void;
  /** Resolves true once sminos acknowledged `gen` on its connection, false after `ms`. */
  locationsKept(gen: number, ms: number): Promise<boolean>;
  log(line: string): void;
};

/** The registry's parts of RL10's org frame. */
export type DirectoryPart = { hub: Array<{ id: string; name: string }>; complete: boolean; locations: Locations | null };

export class Registry implements RegistrySeam, RegistryRead {
  readonly own: OwnProjects;
  readonly held: HeldProjects;
  readonly #ctx: RegistryContext;
  readonly #listeners = new Set<() => void>();
  #told: string | null = null;
  /** The last `known` answer; null until sminos gave one in this run (the kept record's then). */
  #known: KnownProject[] | null = null;

  constructor(ctx: RegistryContext) {
    this.#ctx = ctx;
    const keptFile = {
      read: () => ctx.state()?.projects ?? NO_PROJECTS_KEPT,
      write: (file: typeof NO_PROJECTS_KEPT) => ctx.state()?.setProjects(file),
    };
    this.own = new OwnProjects({
      ref: ctx.ref,
      enrollment: ctx.enrollment,
      key: ctx.key,
      head: ctx.head,
      now: ctx.now,
      send: (frame) => ctx.hub.send(frame),
      hubKeeps: () => ctx.hub.capabilities().includes('projects'),
      source: ctx.source,
      store: keptFile,
      known: () => this.#knownNow(),
      moved: () => ctx.restate(),
      log: ctx.log,
    });
    this.held = new HeldProjects({
      ref: ctx.ref,
      ownKeyId: () => ctx.key()?.keyId ?? null,
      head: ctx.head,
      now: ctx.now,
      store: { read: () => ctx.state()?.projectsHeld ?? {}, write: (machines) => ctx.state()?.setProjectsHeld(machines) },
      own: (record) => void this.own.ownSeen(record),
      changed: () => ctx.restate(),
      snapshotEnded: () => this.own.snapshotEnded(),
      log: ctx.log,
    });
  }

  // ---- RegistrySeam ---------------------------------------------------------------------------------------------------

  statements(): StatementsState {
    if (this.#ctx.enrollment() === null) return { possible: false, reason: 'not-enrolled' };
    const sminos = this.#ctx.sminos();
    const reads = sminos === null ? (this.#ctx.state()?.projects ?? NO_PROJECTS_KEPT).sminosLocations : sminos.capabilities.includes(LOCATIONS_CAPABILITY);
    return reads ? { possible: true } : { possible: false, reason: 'sminos-too-old' };
  }

  onStatements(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  project(id: string): { hub: boolean; nameRev: number } | null {
    const project = this.projects().find((p) => p.id === id);
    if (project === undefined) return null;
    return { hub: project.hub, nameRev: Math.max(0, ...project.locations.map((l) => l.nameRev ?? 0)) };
  }

  fits(rows: readonly DeclaredRow[]): boolean {
    return this.own.fits(rows);
  }

  async published(): Promise<{ restated: boolean }> {
    if (this.#ctx.sminos()?.capabilities.includes(LOCATIONS_CAPABILITY) !== true) return { restated: false };
    const locations = await this.own.publish();
    if (locations === null) return { restated: false };
    return { restated: await this.#ctx.locationsKept(locations.gen, RESTATE_WAIT_MS) };
  }

  // ---- RegistryRead ---------------------------------------------------------------------------------------------------

  read(): ReturnType<RegistryRead['read']> {
    const enrollment = this.#ctx.enrollment();
    const head = this.#ctx.head();
    const machine = { ref: this.#ctx.ref(), name: enrollment?.name ?? '' };
    if (enrollment === null) return { enrolled: false, machine, machines: [], projects: [] };
    // the directory's machines (a VM that exists only by its certificate is one), branded where they enter this machine's types
    const machines = head === null ? [] : directoryMachines(head.state, head.certificates, new Date(this.#ctx.now())).map((m) => ({ ref: m.ref as MachineRef, name: m.name }));
    return { enrolled: true, machine, machines, projects: this.projects() };
  }

  // ---- The endpoint's -------------------------------------------------------------------------------------------------

  /** The org's projects from every verified record held, this machine's own included (Interfaces §A). */
  projects(): RegistryProject[] {
    const enrollment = this.#ctx.enrollment();
    const head = this.#ctx.head();
    if (enrollment === null || head === null) return [];
    const names = machineProjectNames(head.state, head.certificates, new Date(this.#ctx.now()));
    const machineProjects = new Set([enrollment.name, ...names].map((name) => machineProjectId(enrollment.org, name)));
    const own = this.own.record();
    const records: ProjectsRecord[] = [...this.held.records(), ...(own === null || own.body.org !== head.state.org ? [] : [own.body])];
    return assembleProjects(records, machineProjects);
  }

  /** What RL10's org frame carries of the registry (§D, §8's directory). */
  directory(): DirectoryPart {
    return { hub: this.projects().flatMap((p) => (p.hub ? [{ id: p.id, name: p.name }] : [])), complete: this.held.complete(), locations: this.own.locations() };
  }

  /** The endpoint started, or the machine's enrollment or standing moved: the statements' answer told where it changed. */
  statementsMoved(): void {
    const now = JSON.stringify(this.statements());
    if (now === this.#told) return;
    const first = this.#told === null;
    this.#told = now;
    if (first && !this.statements().possible) return;
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch (error) {
        this.#ctx.log(`endpoint: a statements listener failed: ${(error as Error).message}`);
      }
    }
  }

  /** sminos connected (its hello's capabilities read): the kept file remembers whether it reads locations. */
  sminosLinked(): void {
    const sminos = this.#ctx.sminos();
    if (sminos === null) return;
    const reads = sminos.capabilities.includes(LOCATIONS_CAPABILITY);
    const file = this.#ctx.state()?.projects ?? NO_PROJECTS_KEPT;
    if (file.sminosLocations !== reads) this.#write(() => this.#ctx.state()?.setProjects({ ...(this.#ctx.state()?.projects ?? NO_PROJECTS_KEPT), sminosLocations: reads }));
    this.statementsMoved();
  }

  /** A hub connection was welcomed (its capabilities read): the snapshot awaited, the kept record sent again. */
  hubWelcomed(): void {
    this.held.welcomed(this.#ctx.hub.capabilities().includes('projects'));
    void this.own.welcome();
  }

  hubEnded(): void {
    this.held.ended();
    this.own.snapshotEnded();
  }

  hubFrame(frame: ProjectsRecordFrame | ProjectsPageFrame): void {
    void this.held.frame(frame);
  }

  /**
   * The endpoint started, or a new head or certificate set: held records verified again (those read from the file count
   * from then), the own record built again (machine names may move).
   */
  adopted(): void {
    void this.held.adopted();
    this.own.kick();
  }

  /** The endpoint stopped: the held records' clock let go. */
  stop(): void {
    this.held.stop();
  }

  /** The projects with sessions here may have moved (a member, a restatement's close, a log-plane hello). */
  knownMoved(): void {
    this.own.kick();
  }

  /** The candidates for `known`: the last answer while sminos is away or restating. */
  #knownNow(): KnownProject[] {
    const sminos = this.#ctx.sminos();
    if (sminos === null || sminos.restating) return this.#known ?? this.#ctx.state()?.projects.record?.body.known ?? [];
    const held = new Set(sminos.sessionProjects());
    this.#known = sminos.logProjects().flatMap((p) => (p.follow || !held.has(p.project) ? [] : [{ id: p.project, name: p.name }]));
    return this.#known;
  }

  #write(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.#ctx.log(`endpoint: the project registry's file could not be written: ${(error as Error).message}`);
    }
  }
}
