// Composer drafts (C7's Tiptap document and attachments), one per app session record. A draft typed into an unstarted
// tab has no record to hang on yet and is C10's to hold until `createForLaunch` makes one (coordinator, 2026-09-28).
// P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): the session's own draft (`drafts`)
// is the machine owners' ('owner'); each other member's is their own (`member_drafts`, ADDED_TABLES), and no reader's
// write reaches another's.
import type { AppSessionId } from '@shared/graph/ids';
import type { Reader } from '@shared/ipc/client';
import type { Draft } from '@shared/ipc/schema/session';
import type { Db } from './db';

export class DraftStore {
  constructor(private readonly db: Db) {}

  get(appId: AppSessionId, reader: Reader = 'owner'): Draft | null {
    this.requireSession(appId);
    const row =
      reader === 'owner'
        ? this.db.get<{ doc: string; attachments: string; updated_at: string }>('SELECT doc, attachments, updated_at FROM drafts WHERE app_session_id = ?', appId)
        : this.db.get<{ doc: string; attachments: string; updated_at: string }>('SELECT doc, attachments, updated_at FROM member_drafts WHERE app_session_id = ? AND member = ?', appId, reader);
    return row ? { doc: JSON.parse(row.doc) as unknown, attachments: JSON.parse(row.attachments) as Draft['attachments'], updatedAt: row.updated_at } : null;
  }

  // null deletes the draft.
  set(appId: AppSessionId, draft: Draft | null, reader: Reader = 'owner'): void {
    this.db.transaction(() => {
      this.requireSession(appId);
      if (reader !== 'owner') {
        this.setMember(appId, reader, draft);
        return;
      }
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

  private setMember(appId: AppSessionId, member: string, draft: Draft | null): void {
    if (draft === null) {
      this.db.run('DELETE FROM member_drafts WHERE app_session_id = ? AND member = ?', appId, member);
      return;
    }
    this.db.run(
      'INSERT INTO member_drafts (app_session_id, member, doc, attachments, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (app_session_id, member) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at',
      appId,
      member,
      JSON.stringify(draft.doc ?? null),
      JSON.stringify(draft.attachments),
      draft.updatedAt,
    );
  }

  private requireSession(appId: AppSessionId): void {
    if (!this.db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', appId)) throw new Error(`unknown app session: ${appId}`);
  }
}
