// The index (C4 execution document, Interfaces "Index"; charter §4.4 as amended): main's one SQLite file holding what
// the engine does not — projects and membership, app session records (X1), attention items, drafts, replay fixtures,
// (E3) the side-thread rows, (P2-C) the owner channel's sessions and marks, (P3-L) the library's derived rows and
// search index and (P5 O8 M7b) the project channel's journal — opened at `app.whenReady()` on `<userData>/index.sqlite`.
// Everything main-side (the session source, C3's attention service, C5's read model, C10) reaches it through these stores. The browser's history, bookmarks and
// activity (E4a, cua boards #90 and #93) left it at migration 14 for the browser's own database (P5 O3-A).
import { IndexAttentionStore, type AttentionStore } from './attention';
import { openDb, refusedDb, type Db } from './db';
import { DraftStore } from './drafts';
import { ADDED_COLUMNS, ADDED_TABLES, MIGRATIONS, REPAIRS } from './migrations';
import { ProjectStore, type OrgRow } from './projects';
import { machineEnrollment, type Enrollment } from '@shared/machine/identity'; // P5 O3-D M2 (D16)
import { deriveOrg, ORG_GIT_TIMEOUT_MS } from './org-project'; // P5 O6 M5
import { NO_REGISTRY, type ProjectsSource, type RegistrySeam } from '@shared/machine/registry'; // the project registry
import { Statements, type DeriveRule } from './statements';
import { startFolderChecks } from './folder-checks';
import type { AppSessionId, ProjectId } from '@shared/graph/ids';
import { GIT_TIMEOUT_MS } from '../git/runner';
import type { MachineRef } from '@shared/machine/ref';
import { ReplayFixtureStore } from './replay-fixtures';
import { SessionSearchStore } from './session-search';
import { SessionStore } from './sessions';
import { SideThreadStore } from './side-threads'; // E3
import { OwnerChannelStore } from '../owner/store'; // P2-C (2026-10-09)
import { LibraryStore } from '../library/store'; // P3-L
import { ChannelJournal } from '../channel/journal'; // P5 O8 M7b

const ORG_CONCURRENCY = 4; // the derivations in flight at once, as `warmLinkedWorktrees` keeps its calls
// A derivation git gave no answer to (its timeout, typically while the machine starts its hosts) is asked again after
// each of these delays, then left for the next start (P5 O6 M6: on a hosted Mac two apps starting at once left a
// project underived, so ungrouped, for the whole run).
const ORG_RETRY_MS = [1_000, 4_000, 15_000] as const;
// A retry waits for git as long as the git runner does: a cold `/usr/bin/git` shim outlasted the first try's timeout on
// every try at that timeout, each try killed before the shim could warm (P5 O6 M6, hosted e2e:machines).
const ORG_RETRY_GIT_TIMEOUT_MS = GIT_TIMEOUT_MS;

export interface IndexOptions {
  refused?: string | null; // P5 O3-A
  // the project registry (docs/doperpowers/plans/2026-11-10-project-registry.md, Interfaces §H): what the machine's
  // services ask of the endpoint; `NO_REGISTRY` (no stored statement possible) until mawsd wires its endpoint's
  registry?: RegistrySeam;
}

export class Index {
  readonly sessions: SessionStore;
  readonly sessionSearch: SessionSearchStore;
  readonly projects: ProjectStore;
  readonly attention: AttentionStore;
  readonly drafts: DraftStore;
  readonly fixtures: ReplayFixtureStore;
  readonly sideThreads: SideThreadStore; // E3
  readonly ownerChannel: OwnerChannelStore; // P2-C (2026-10-09): the to-human lane's sessions and marks (migration 8)
  readonly library: LibraryStore; // P3-L: the library's rows, links, Spaces and search, derived from the engine host (migration 10)
  readonly channel: ChannelJournal; // P5 O8 M7b: the project channel's to-human entries per org project (ADDED_TABLES)
  readonly statements: Statements; // the project registry: stored statements and the project acts (Interfaces §F, §G)
  private readonly db: Db;
  // the refresh's queue and slots, once it started: a statement change's rows beneath are derived through them
  private requeue: ((row: OrgRow) => void) | null = null;
  private inSlot: (<T>(work: () => Promise<T>) => Promise<T>) | null = null;
  private stopChecks: (() => void) | null = null;
  private stamped = 0;
  private closed = false;

  // P5 O3-A: `refused`, why this run may not run the spine (src/services/settings/spine-lock.ts): the index is then unavailable
  // with that reason, its file never opened (and so nothing staged for the browser, migration 14's step).
  constructor(path: string, options: IndexOptions = {}) {
    this.db = options.refused ? refusedDb(options.refused) : openDb(path, MIGRATIONS, REPAIRS, ADDED_COLUMNS, ADDED_TABLES);
    // One revision per committed change, stamped as each change is announced after its commit (never inside a
    // transaction that may still roll back), so revisions are distinct and in commit order.
    const stamp = () => ++this.stamped;
    this.projects = new ProjectStore(this.db, stamp, (projectId, directory) => this.sessions.attachOrphans(projectId, directory), (from, to) => this.sessions.moveProject(from, to));
    this.sessionSearch = new SessionSearchStore(this.db);
    this.sessions = new SessionStore(this.db, this.projects, stamp);
    this.projects.preserveUsedProjects();
    this.attention = new IndexAttentionStore(this.db);
    this.drafts = new DraftStore(this.db);
    this.fixtures = new ReplayFixtureStore(this.db);
    this.sideThreads = new SideThreadStore(this.db); // E3
    this.ownerChannel = new OwnerChannelStore(this.db); // P2-C (2026-10-09)
    this.channel = new ChannelJournal(this.db); // P5 O8 M7b
    this.library = new LibraryStore(this.db, { sessionTitle: (appSessionId) => this.sessions.get(appSessionId)?.title.text ?? '' }); // P3-L
    this.statements = new Statements(this.projects, options.registry ?? NO_REGISTRY, {
      rederive: (rows) => {
        for (const row of rows) this.requeue?.(row);
      },
      slot: (work) => (this.inSlot === null ? work() : this.inSlot(work)),
    });
  }

  /** What the endpoint reads of the index (Interfaces §H's `ProjectsSource`). */
  projectsSource(): ProjectsSource {
    return this.statements.source();
  }

  /** A start in a session's folder failed: its declared row's folder is checked now (Interfaces §F.6). */
  startFailed(appSessionId: AppSessionId): void {
    if (this.db.readOnly || this.closed) return;
    const projectId = this.sessions.get(appSessionId)?.projectId;
    if (projectId) void this.statements.checkFolders([projectId as ProjectId]).catch(() => {});
  }

  // A newer app's database, opened read-only and not used: every store call fails with `index unavailable: <reason>`.
  get readOnly(): boolean {
    return this.db.readOnly;
  }

  get unavailable(): string | null {
    return this.db.unavailable;
  }

  // The migrations this open applied (empty when the file was already current).
  get applied(): readonly number[] {
    return this.db.applied;
  }

  // The index-wide revision: the last one stamped on a committed session or project change (C5's snapshot-and-event
  // rule: every event carries its own, so a consumer can keep the higher of snapshot and event).
  get revision(): number {
    return this.stamped;
  }

  // Runs `fn` as one transaction; the stores' own transactions inside it join it, and their change notifications are
  // delivered once, after it commits.
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  // P5 O6 M5 (docs/doperpowers/plans/2026-10-27-p5-o6-machine-dimension.md, "Persisting and refreshing"): every project's
  // org project, derived again off main's thread at each start, ORG_CONCURRENCY at a time, each change written to its
  // row and told as a project change; from then on a project made is derived once it is committed. A `.smns` added or a
  // remote changed mid-run shows at the next start. A derivation that got no answer leaves the row as it was, and is
  // asked again after each of ORG_RETRY_MS.
  //
  // The project registry (Interfaces §F): each derivation is design §8's rule, its stored statements read through the
  // index (`rule`, a test's stand-in; `derive`, one for the label alone, which skips everything the rule's answer feeds).
  // The start's derivations done, the declared folders are checked (and every ten minutes after), and minting's moment
  // (c) is taken when statements are possible.
  async refreshOrgProjects({ machine, enrollment = machineEnrollment, derive, rule, home, folderCheckMs }: {
    machine: MachineRef;
    enrollment?: () => Enrollment | null;
    derive?: typeof deriveOrg;
    rule?: DeriveRule;
    home?: string;
    folderCheckMs?: number;
  }): Promise<void> {
    if (this.db.readOnly) return;
    this.statements.bind({ machine, enrollment, ...(rule === undefined ? {} : { derive: rule }), ...(home === undefined ? {} : { home }) });
    // Every derivation, the start's queue, a new project's and a retry's alike, takes one of ORG_CONCURRENCY slots.
    let active = 0;
    const waiting: (() => void)[] = [];
    const inSlot = async <T>(work: () => Promise<T>): Promise<T> => {
      if (active >= ORG_CONCURRENCY) await new Promise<void>((resolve) => waiting.push(resolve));
      else active += 1;
      try {
        return await work();
      } finally {
        const next = waiting.shift();
        if (next) next(); // the slot passes straight to the next in line
        else active -= 1;
      }
    };
    const one = async (row: OrgRow, attempt = 0): Promise<void> => {
      try {
        const timeout = attempt === 0 ? ORG_GIT_TIMEOUT_MS : ORG_RETRY_GIT_TIMEOUT_MS;
        const answered = await inSlot(async () => {
          if (this.closed) return false;
          if (derive === undefined) return (await this.statements.deriveRow(row, timeout)) !== null;
          const org = await derive({ directory: row.directory, machine, projectId: row.id, name: row.name, ...(row.files === undefined ? {} : { files: row.files }) }, enrollment(), timeout);
          if (org !== null && !this.closed) this.projects.setOrg(row.id, org);
          return org !== null;
        });
        if (this.closed) return;
        if (!answered && attempt < ORG_RETRY_MS.length) {
          const delay = ORG_RETRY_MS[attempt]!;
          console.warn(`[index] git gave no answer for the org project of ${row.directory}; asking again in ${delay} ms`);
          setTimeout(() => void one(row, attempt + 1), delay).unref();
        }
      } catch (error) {
        if (!this.closed) console.error(`[index] the org project of ${row.directory} failed:`, error instanceof Error ? error.message : error);
      }
    };
    this.projects.onCreated((row) => void one(row));
    this.requeue = (row) => void one(row);
    this.inSlot = inSlot;
    const queue = this.projects.orgRows();
    await Promise.all(queue.map((row) => one(row))); // a closed index asks git nothing more (`inSlot`'s work)
    if (this.closed) return;
    this.stopChecks?.();
    this.stopChecks = startFolderChecks(this.statements, folderCheckMs);
    await this.statements.statementsChanged();
  }

  close(): void {
    this.closed = true;
    this.stopChecks?.();
    this.statements.unbind();
    this.projects.onCreated(null);
    this.db.close();
  }
}
