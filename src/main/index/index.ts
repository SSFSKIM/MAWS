// The index (C4 execution document, Interfaces "Index"; charter §4.4 as amended): main's one SQLite file holding what
// the engine does not — projects and membership, app session records (X1), attention items, drafts, replay fixtures,
// (E3) the side-thread rows, (E4a) the browser's history and (cua board #93) the agent's browser activity — opened at `app.whenReady()` on `<userData>/index.sqlite`. Everything main-side (the
// session source, C3's attention service, C5's read model, C10) reaches it through these stores.
import { IndexAttentionStore, type AttentionStore } from './attention';
import { openDb, type Db } from './db';
import { DraftStore } from './drafts';
import { MIGRATIONS, REPAIRS } from './migrations';
import { ProjectStore } from './projects';
import { ReplayFixtureStore } from './replay-fixtures';
import { SessionStore } from './sessions';
import { SideThreadStore } from './side-threads'; // E3
import { BrowserHistoryStore } from './browser-history'; // E4a
import { BrowserActivityStore } from './browser-activity'; // cua board #93

export class Index {
  readonly sessions: SessionStore;
  readonly projects: ProjectStore;
  readonly attention: AttentionStore;
  readonly drafts: DraftStore;
  readonly fixtures: ReplayFixtureStore;
  readonly sideThreads: SideThreadStore; // E3
  readonly browserHistory: BrowserHistoryStore; // E4a
  readonly browserActivity: BrowserActivityStore; // cua board #93: the agent's browser activity across restarts
  private readonly db: Db;
  private stamped = 0;

  constructor(path: string) {
    this.db = openDb(path, MIGRATIONS, REPAIRS);
    // One revision per committed change, stamped as each change is announced after its commit (never inside a
    // transaction that may still roll back), so revisions are distinct and in commit order.
    const stamp = () => ++this.stamped;
    this.projects = new ProjectStore(this.db, stamp, (projectId, directory) => this.sessions.attachOrphans(projectId, directory));
    this.sessions = new SessionStore(this.db, this.projects, stamp);
    this.attention = new IndexAttentionStore(this.db);
    this.drafts = new DraftStore(this.db);
    this.fixtures = new ReplayFixtureStore(this.db);
    this.sideThreads = new SideThreadStore(this.db); // E3
    this.browserHistory = new BrowserHistoryStore(this.db); // E4a
    this.browserActivity = new BrowserActivityStore(this.db, path); // cua board #93: writes over a connection of its own
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

  close(): void {
    this.browserActivity.close();
    this.db.close();
  }
}
