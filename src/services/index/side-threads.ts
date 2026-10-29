// The side-thread rows (E3 execution document, Design §5; index migration 4's `side_threads`): one per side thread,
// keyed by the child, mirroring its two app-synthesised events in the parent's stream: `opened_at` (written once, by
// the launch's binding) and the latest summary with the number of the thread's turns that ended. The events are
// re-synthesised from here for a transcript's snapshot, so what a snapshot gets after a restart has the ids and times
// the live run emitted. A row goes with the child's record (ON DELETE CASCADE).
import type { AppSessionId } from '@shared/graph/ids';
import type { Db } from './db';

export interface SideThreadRow {
  childAppSessionId: AppSessionId;
  parentAppSessionId: AppSessionId;
  openedAt: string;
  summarisedAt: string | null;
  text: string | null;
  isError: boolean;
  turns: number; // the thread's turns that ended; 0 until the first
  lastTurnEventId: string | null; // the live `turn.ended` last counted, so a repeated batch never counts twice
}

interface Row {
  child_app_id: string;
  parent_app_id: string;
  opened_at: string;
  summarised_at: string | null;
  text: string | null;
  is_error: number;
  turns: number;
  last_turn_event_id: string | null;
}

const toThread = (row: Row): SideThreadRow => ({
  childAppSessionId: row.child_app_id as AppSessionId,
  parentAppSessionId: row.parent_app_id as AppSessionId,
  openedAt: row.opened_at,
  summarisedAt: row.summarised_at,
  text: row.text,
  isError: row.is_error === 1,
  turns: row.turns,
  lastTurnEventId: row.last_turn_event_id,
});

export class SideThreadStore {
  constructor(private readonly db: Db) {}

  get(child: AppSessionId): SideThreadRow | null {
    const row = this.db.get<Row>('SELECT * FROM side_threads WHERE child_app_id = ?', child);
    return row === null ? null : toThread(row);
  }

  // The parent's threads, oldest first.
  of(parent: AppSessionId): SideThreadRow[] {
    return this.db.all<Row>('SELECT * FROM side_threads WHERE parent_app_id = ? ORDER BY opened_at, rowid', parent).map(toThread);
  }

  // Written once: a later call (the binding after a summary got there first, a restart's re-run) answers the row as
  // first stored, whose `opened_at` is the time the `opened` event carries.
  opened(child: AppSessionId, parent: AppSessionId, openedAt: string): SideThreadRow {
    return this.db.transaction(() => {
      this.db.run('INSERT OR IGNORE INTO side_threads (child_app_id, parent_app_id, opened_at) VALUES (?, ?, ?)', child, parent, openedAt);
      return this.get(child)!;
    });
  }

  // One more ended turn: the summary's time, its text (the previous one kept when the turn ended without text) and
  // whether it failed. Null when the event was already counted or the thread has no row.
  summarised(child: AppSessionId, event: { id: string; at: string; text: string | null; isError: boolean }): SideThreadRow | null {
    return this.db.transaction(() => {
      const row = this.get(child);
      if (row === null || row.lastTurnEventId === event.id) return null;
      this.db.update('side_threads', 'child_app_id', child, {
        summarised_at: event.at,
        text: event.text ?? row.text,
        is_error: event.isError,
        turns: row.turns + 1,
        last_turn_event_id: event.id,
      });
      return this.get(child);
    });
  }
}
