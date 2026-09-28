// Composer drafts (C7's Tiptap document and attachments), one per app session record. A draft typed into an unstarted
// tab has no record to hang on yet and is C10's to hold until `createForLaunch` makes one (coordinator, 2026-09-28).
import type { AppSessionId } from '@shared/graph/ids';
import type { Draft } from '@shared/ipc/schema/session';
import type { Db } from './db';

export class DraftStore {
  constructor(private readonly db: Db) {}

  get(appId: AppSessionId): Draft | null {
    this.requireSession(appId);
    const row = this.db.get<{ doc: string; attachments: string; updated_at: string }>('SELECT doc, attachments, updated_at FROM drafts WHERE app_session_id = ?', appId);
    return row ? { doc: JSON.parse(row.doc) as unknown, attachments: JSON.parse(row.attachments) as Draft['attachments'], updatedAt: row.updated_at } : null;
  }

  // null deletes the draft.
  set(appId: AppSessionId, draft: Draft | null): void {
    this.db.transaction(() => {
      this.requireSession(appId);
      if (draft === null) {
        this.db.run('DELETE FROM drafts WHERE app_session_id = ?', appId);
        return;
      }
      this.db.run(
        'INSERT INTO drafts (app_session_id, doc, attachments, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (app_session_id) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at',
        appId,
        JSON.stringify(draft.doc ?? null),
        JSON.stringify(draft.attachments),
        draft.updatedAt,
      );
    });
  }

  private requireSession(appId: AppSessionId): void {
    if (!this.db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', appId)) throw new Error(`unknown app session: ${appId}`);
  }
}
