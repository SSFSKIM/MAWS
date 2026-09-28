// The replay fixtures the index lists (C4 execution document, M5 fills and plays them): a probe journal or a transcript
// JSONL by absolute path, one row per path.
import { randomUUID } from 'node:crypto';
import type { ReplayFixture } from '@shared/ipc/schema/session';
import type { Db } from './db';

interface FixtureRow {
  id: string;
  name: string;
  kind: ReplayFixture['kind'];
  path: string;
  session_id: string | null;
  added_at: string;
  last_played_at: string | null;
}

const toFixture = (row: FixtureRow): ReplayFixture => ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  path: row.path,
  sessionId: row.session_id,
  addedAt: row.added_at,
  lastPlayedAt: row.last_played_at,
});

export class ReplayFixtureStore {
  constructor(private readonly db: Db) {}

  list(): ReplayFixture[] {
    return this.db.all<FixtureRow>('SELECT * FROM replay_fixtures ORDER BY kind, name, path').map(toFixture);
  }

  // Idempotent by path: a fixture already listed is answered as it is.
  add(fixture: { name: string; kind: ReplayFixture['kind']; path: string; sessionId: string | null }): ReplayFixture {
    return this.db.transaction(() => {
      const existing = this.db.get<FixtureRow>('SELECT * FROM replay_fixtures WHERE path = ?', fixture.path);
      if (existing) return toFixture(existing);
      const id = randomUUID();
      this.db.insert('replay_fixtures', { id, name: fixture.name, kind: fixture.kind, path: fixture.path, session_id: fixture.sessionId, added_at: new Date().toISOString(), last_played_at: null });
      return toFixture(this.db.get<FixtureRow>('SELECT * FROM replay_fixtures WHERE id = ?', id)!);
    });
  }

  markPlayed(id: string, at: string): void {
    this.db.transaction(() => void this.db.update('replay_fixtures', 'id', id, { last_played_at: at }));
  }
}
