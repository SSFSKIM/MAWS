// The index (C4 execution document, Interfaces "Index"; charter §4.4 as amended): main's one SQLite file holding what
// the engine does not — projects and membership, app session records (X1), attention items, drafts, replay fixtures —
// opened at `app.whenReady()` on `<userData>/index.sqlite`. Everything main-side (the session source, C3's attention
// service, C5's read model, C10) reaches it through these stores.
import { IndexAttentionStore, type AttentionStore } from './attention';
import { openDb, type Db } from './db';
import { DraftStore } from './drafts';
import { MIGRATIONS } from './migrations';
import { ProjectStore } from './projects';
import { ReplayFixtureStore } from './replay-fixtures';
import { SessionStore } from './sessions';

export class Index {
  readonly sessions: SessionStore;
  readonly projects: ProjectStore;
  readonly attention: AttentionStore;
  readonly drafts: DraftStore;
  readonly fixtures: ReplayFixtureStore;
  private readonly db: Db;
  private changes = 0;

  constructor(path: string) {
    this.db = openDb(path, MIGRATIONS);
    const bump = () => void (this.changes += 1);
    this.projects = new ProjectStore(this.db, bump, (projectId, directory) => this.sessions.attachOrphans(projectId, directory));
    this.sessions = new SessionStore(this.db, this.projects, bump);
    this.attention = new IndexAttentionStore(this.db);
    this.drafts = new DraftStore(this.db);
    this.fixtures = new ReplayFixtureStore(this.db);
  }

  // A newer app's database: reads answer, every write fails with `the index is read-only`.
  get readOnly(): boolean {
    return this.db.readOnly;
  }

  // The migrations this open applied (empty when the file was already current).
  get applied(): readonly number[] {
    return this.db.applied;
  }

  // The index-wide revision: bumped on every session or project change (C5's snapshot-and-event rule).
  get revision(): number {
    return this.changes;
  }

  // Runs `fn` as one transaction; the stores' own transactions inside it join it, and their change notifications are
  // delivered once, after it commits.
  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn);
  }

  close(): void {
    this.db.close();
  }
}
