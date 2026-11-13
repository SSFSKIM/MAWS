// Composer drafts (C7's Tiptap document and attachments), one per app session record. A draft typed into an unstarted
// tab has no record to hang on yet and is C10's to hold until `createForLaunch` makes one (coordinator, 2026-09-28).
// P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): the session's own draft (`drafts`)
// is the machine owners' ('owner'); each other member's is their own (`member_drafts`, ADDED_TABLES), and no reader's
// write reaches another's.
// M6a's re-review, K1: a clear keeps its row as a tombstone, with a stamp the machine mints, so a save naming what was
// kept before it is refused as stale (`replaces`) rather than bringing back the text a send or a clear took away.
import { randomUUID } from 'node:crypto';
import type { AppSessionId } from '@shared/graph/ids';
import type { Reader } from '@shared/ipc/client';
import { DRAFT_CLAIM, DRAFT_KEPT_WORDS, settles, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import type { Db } from './db';

/** A tombstone's `attachments` column: no draft's (DraftSchema's is always a list). */
const CLEARED = 'null';
type Row = { doc: string; attachments: string; updated_at: string };
const draftOf = (row: Row): Draft => ({ doc: JSON.parse(row.doc) as unknown, attachments: JSON.parse(row.attachments) as Draft['attachments'], updatedAt: row.updated_at });
// UX wave U4a (decision 13; Interfaces D): a take-back's stage is a kept draft whose document carries `attrs.takeBack`.
// The text is looked at first, so an ordinary save parses nothing.
const isStage = (row: Row): boolean => {
  if (row.attachments === CLEARED || !row.doc.includes('"takeBack"')) return false;
  const doc = JSON.parse(row.doc) as { attrs?: { takeBack?: unknown } } | null;
  return typeof doc?.attrs?.takeBack === 'object' && doc.attrs.takeBack !== null;
};
const SETTLE = settles('');
// A revision `replaces` could not name, since it would be read as a claim or a settle form, is never written.
const unnameable = (updatedAt: string): boolean => updatedAt.startsWith('claim:') || updatedAt.startsWith(SETTLE);
const UNNAMEABLE_WORDS = 'session.drafts.set: a draft’s revision may not begin with claim: or settle:';

export class DraftStore {
  constructor(private readonly db: Db) {}

  /** The reader's draft; null for none, a cleared one included. */
  get(appId: AppSessionId, reader: Reader = 'owner'): Draft | null {
    const row = this.row(appId, reader);
    return row === null || row.attachments === CLEARED ? null : draftOf(row);
  }

  /** What is kept for the reader, with its revision: a cleared draft as one with no document (null: never written). */
  kept(appId: AppSessionId, reader: Reader = 'owner'): Draft | null {
    const row = this.row(appId, reader);
    if (row === null) return null;
    return row.attachments === CLEARED ? { doc: null, attachments: [], updatedAt: row.updated_at } : draftOf(row);
  }

  // null clears the draft. P5 O8 M6a (M6a's branch review, F1): `replaces`, when given, is the `updatedAt` of the draft
  // this one replaces (null: none ever kept), and a save whose replaced draft is no longer the reader's kept one is
  // refused, in the same transaction as its write. UX wave U4a (decision 13): while the kept draft is a stage, only the
  // save naming `settles(<its revision>)` is taken; a claim (`DRAFT_CLAIM`) is taken where no document is kept, a
  // tombstone or no row; a settle form naming no kept stage is stale.
  set(appId: AppSessionId, draft: Draft | null, reader: Reader = 'owner', replaces?: string | null): void {
    this.db.transaction(() => {
      this.requireSession(appId);
      if (draft !== null && unnameable(draft.updatedAt)) throw new Error(UNNAMEABLE_WORDS);
      const kept = this.row(appId, reader);
      if (kept !== null && isStage(kept)) {
        if (replaces !== settles(kept.updated_at)) throw new Error(STAGED_DRAFT_WORDS);
      } else if (replaces === DRAFT_CLAIM) {
        if (kept !== null && kept.attachments !== CLEARED) throw new Error(DRAFT_KEPT_WORDS);
      } else if (replaces?.startsWith(SETTLE)) {
        throw new Error(STALE_DRAFT_WORDS); // no stage is kept at that revision: another mount settled it, or this one did
      } else if (replaces !== undefined && (kept?.updated_at ?? null) !== replaces) throw new Error(STALE_DRAFT_WORDS);
      const [doc, attachments, updatedAt] = draft === null ? ['null', CLEARED, `${new Date().toISOString()}#${randomUUID()}`] : [JSON.stringify(draft.doc ?? null), JSON.stringify(draft.attachments), draft.updatedAt];
      if (reader === 'owner') {
        this.db.run(
          'INSERT INTO drafts (app_session_id, doc, attachments, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (app_session_id) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at',
          appId,
          doc,
          attachments,
          updatedAt,
        );
        return;
      }
      this.db.run(
        'INSERT INTO member_drafts (app_session_id, member, doc, attachments, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (app_session_id, member) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at',
        appId,
        reader,
        doc,
        attachments,
        updatedAt,
      );
    });
  }

  private row(appId: AppSessionId, reader: Reader): Row | null {
    this.requireSession(appId);
    return reader === 'owner'
      ? this.db.get<Row>('SELECT doc, attachments, updated_at FROM drafts WHERE app_session_id = ?', appId)
      : this.db.get<Row>('SELECT doc, attachments, updated_at FROM member_drafts WHERE app_session_id = ? AND member = ?', appId, reader);
  }

  private requireSession(appId: AppSessionId): void {
    if (!this.db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', appId)) throw new Error(`unknown app session: ${appId}`);
  }
}

/** The SQL a table's rows that are drafts (not tombstones) meet: ./sessions.ts's yield check. */
export const NOT_CLEARED = `attachments <> '${CLEARED}'`;
