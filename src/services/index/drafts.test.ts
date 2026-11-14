import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Reader } from '@shared/ipc/client';
import { DRAFT_CLAIM, DRAFT_KEPT_WORDS, settles, STAGED_DRAFT_WORDS, STALE_DRAFT_WORDS, type Draft, type TakeBackMark } from '@shared/ipc/schema/session';
import { summary, tempDir } from '../../../test/support/index-fixture';
import type { Db } from './db';
import { Index } from './index';

const DRAFT: Draft = { doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'half a thought' }] }] }, attachments: [{ path: '/tmp/a.png', kind: 'image' }], updatedAt: '2026-09-28T10:00:00.000Z' };

describe('composer drafts', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let appId: AppSessionId;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    appId = index.sessions.upsertFromSummary(summary()).record.appId;
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('set then get round-trips the draft; set(null) deletes it; they survive a reopen', () => {
    expect(index.drafts.get(appId)).toBeNull();
    index.drafts.set(appId, DRAFT);
    expect(index.drafts.get(appId)).toEqual(DRAFT);
    index.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    expect(index.drafts.get(appId)).toEqual(DRAFT);
    index.drafts.set(appId, null);
    expect(index.drafts.get(appId)).toBeNull();
  });

  it('a draft for an app session with no record fails: the unstarted tab holds its own draft until the record exists', () => {
    const unknown = 'unstarted-tab' as AppSessionId;
    expect(() => index.drafts.set(unknown, DRAFT)).toThrow(`unknown app session: ${unknown}`);
    expect(() => index.drafts.get(unknown)).toThrow(`unknown app session: ${unknown}`);
    expect(() => index.drafts.set(unknown, DRAFT, 'b'.repeat(32))).toThrow(`unknown app session: ${unknown}`);
    expect(() => index.drafts.get(unknown, 'b'.repeat(32))).toThrow(`unknown app session: ${unknown}`);
  });

  // P5 O8 M6a (docs/doperpowers/plans/2026-10-28-p5-o8-org-interface.md, Interfaces §P): the session's own draft is the
  // machine's owners' ('owner', the default); each other member's is their own, and no side's write reaches another's.
  it('keeps a draft per member beside the owners’ own, each written and deleted alone, across a reopen', () => {
    const B = 'b'.repeat(32);
    const C = 'c'.repeat(32);
    const theirs: Draft = { doc: { type: 'doc' }, attachments: [], updatedAt: '2026-09-28T11:00:00.000Z' };
    index.drafts.set(appId, DRAFT);
    expect(index.drafts.get(appId, B)).toBeNull();
    index.drafts.set(appId, theirs, B);
    expect(index.drafts.get(appId, B)).toEqual(theirs);
    expect(index.drafts.get(appId, C)).toBeNull();
    expect(index.drafts.get(appId)).toEqual(DRAFT);
    expect(index.drafts.get(appId, 'owner')).toEqual(DRAFT);
    index.close();
    index = new Index(join(dir.path, 'index.sqlite'));
    expect(index.drafts.get(appId, B)).toEqual(theirs);
    index.drafts.set(appId, null);
    expect(index.drafts.get(appId, B)).toEqual(theirs);
    index.drafts.set(appId, DRAFT);
    index.drafts.set(appId, null, B);
    expect(index.drafts.get(appId, B)).toBeNull();
    expect(index.drafts.get(appId)).toEqual(DRAFT);
  });

  // M6a's re-review, K1: a clear keeps a revision of its own (a stamp the machine mints), so a save naming what was kept
  // before it, a late one above all, is refused, for the owners and for a member alike; a load still answers null for
  // it, and only the stamp-naming read (`kept`, a link's read) answers it, as a draft with no document.
  it('a clear advances the kept revision, so a save naming the one before it is refused, and still loads as null', () => {
    for (const reader of ['owner', 'b'.repeat(32)]) {
      const delayed: Draft = { doc: { type: 'doc', text: 'already sent' }, attachments: [], updatedAt: '2026-11-07T10:00:00.000Z' };
      index.drafts.set(appId, null, reader, null); // the send's clear, nothing kept before it
      expect(() => index.drafts.set(appId, delayed, reader, null)).toThrow(STALE_DRAFT_WORDS); // the save sent before it, landing late
      expect(index.drafts.get(appId, reader)).toBeNull();
      const cleared = index.drafts.kept(appId, reader)!;
      expect(cleared).toEqual({ doc: null, attachments: [], updatedAt: expect.any(String) });
      index.drafts.set(appId, delayed, reader, cleared.updatedAt); // a save on top of the clear is taken
      expect(index.drafts.get(appId, reader)).toEqual(delayed);
      index.drafts.set(appId, null, reader, delayed.updatedAt);
      expect(() => index.drafts.set(appId, delayed, reader, delayed.updatedAt)).toThrow(STALE_DRAFT_WORDS); // a second clear's stamp is its own
      expect(index.drafts.kept(appId, reader)!.updatedAt).not.toBe(cleared.updatedAt);
      index.drafts.set(appId, null, reader); // a clear naming nothing, as this Mac's own composer does, keeps one too
      expect(() => index.drafts.set(appId, delayed, reader, null)).toThrow(STALE_DRAFT_WORDS);
    }
    expect(index.drafts.kept(appId, 'c'.repeat(32))).toBeNull(); // never written: no revision
  });

  // UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, decision 13; Interfaces D; Acceptance 6):
  // taking a message back keeps a copy in the draft store first. Its save names the claim, written only where no draft
  // with a document is kept; its document carries `attrs.takeBack` (a stage), and while a stage is kept every save but
  // the one naming `settles(<its revision>)` is refused, so nothing writes over the message before the box holds it.
  describe('the take-back’s claim, the stage’s fence and its settling save (UX wave U4a)', () => {
    const MEMBER = 'b'.repeat(32);
    const mark: TakeBackMark = { ref: 'steer-7', kind: 'steer', since: '2026-11-13T09:00:00.000Z' };
    const stage = (updatedAt: string): Draft => ({ doc: { type: 'doc', attrs: { takeBack: mark }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rename the module' }] }] }, attachments: [], updatedAt });
    const loaded = (updatedAt: string): Draft => ({ doc: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'rename the module' }] }] }, attachments: [], updatedAt });

    it('a claim is taken by a slot never written and by one a send has just cleared, and refused where a document is kept', () => {
      for (const reader of ['owner', MEMBER] as Reader[]) {
        index.drafts.set(appId, stage('2026-11-13T09:00:01.000Z'), reader, DRAFT_CLAIM); // never written
        expect(index.drafts.get(appId, reader)).toEqual(stage('2026-11-13T09:00:01.000Z'));
        index.drafts.set(appId, DRAFT, reader, settles('2026-11-13T09:00:01.000Z'));
        expect(() => index.drafts.set(appId, stage('2026-11-13T09:00:02.000Z'), reader, DRAFT_CLAIM)).toThrow(DRAFT_KEPT_WORDS); // a document is kept
        expect(index.drafts.get(appId, reader)).toEqual(DRAFT);
        index.drafts.set(appId, null, reader); // the send's clear: a tombstone
        index.drafts.set(appId, stage('2026-11-13T09:00:03.000Z'), reader, DRAFT_CLAIM);
        expect(index.drafts.get(appId, reader)).toEqual(stage('2026-11-13T09:00:03.000Z'));
      }
    });

    it('while a stage is kept every save is refused but its settling one, which is taken once; the owners’ and a member’s alike', () => {
      for (const reader of ['owner', MEMBER] as Reader[]) {
        const kept = stage(`2026-11-13T10:00:00.000Z#${reader}`);
        index.drafts.set(appId, kept, reader, DRAFT_CLAIM);
        expect(() => index.drafts.set(appId, DRAFT, reader)).toThrow(STAGED_DRAFT_WORDS); // a pending save naming nothing
        expect(() => index.drafts.set(appId, DRAFT, reader, null)).toThrow(STAGED_DRAFT_WORDS);
        expect(() => index.drafts.set(appId, DRAFT, reader, kept.updatedAt)).toThrow(STAGED_DRAFT_WORDS); // the bare revision
        expect(() => index.drafts.set(appId, stage('2026-11-13T10:00:01.000Z'), reader, DRAFT_CLAIM)).toThrow(STAGED_DRAFT_WORDS);
        expect(() => index.drafts.set(appId, null, reader)).toThrow(STAGED_DRAFT_WORDS); // a clear
        expect(index.drafts.get(appId, reader)).toEqual(kept);
        index.drafts.set(appId, loaded('2026-11-13T10:00:02.000Z'), reader, settles(kept.updatedAt));
        expect(index.drafts.get(appId, reader)).toEqual(loaded('2026-11-13T10:00:02.000Z'));
        expect(() => index.drafts.set(appId, loaded('2026-11-13T10:00:03.000Z'), reader, settles(kept.updatedAt))).toThrow(STALE_DRAFT_WORDS); // a second settle: no stage at that revision
        expect(index.drafts.get(appId, reader)).toEqual(loaded('2026-11-13T10:00:02.000Z'));
        index.drafts.set(appId, DRAFT, reader, '2026-11-13T10:00:02.000Z'); // the slot is the editor's again
        expect(index.drafts.get(appId, reader)).toEqual(DRAFT);
      }
      expect(() => index.drafts.set(appId, DRAFT, 'c'.repeat(32), settles('2026-11-13T10:00:00.000Z'))).toThrow(STALE_DRAFT_WORDS); // never written
    });

    it('one reader’s stage fences no other reader’s draft', () => {
      index.drafts.set(appId, stage('2026-11-13T11:00:00.000Z'), 'owner', DRAFT_CLAIM);
      index.drafts.set(appId, DRAFT, MEMBER);
      index.drafts.set(appId, null, MEMBER);
      expect(index.drafts.get(appId)).toEqual(stage('2026-11-13T11:00:00.000Z'));
    });

    it('a draft whose revision would read as a claim or a settle form is never written', () => {
      for (const updatedAt of [DRAFT_CLAIM, settles('2026-11-13T12:00:00.000Z')]) {
        expect(() => index.drafts.set(appId, { ...DRAFT, updatedAt })).toThrow(/session\.drafts\.set/);
        expect(index.drafts.get(appId)).toBeNull();
      }
    });

    // Build F's store (today's `set` before this landing: the stale comparison alone), copied literally, serving the
    // same table: it reads the claim and a settle form as revisions it does not hold, so it refuses both as stale, and
    // a take-back against it stages nothing.
    function buildFSet(db: Db, app: AppSessionId, draft: Draft | null, reader: Reader = 'owner', replaces?: string | null): void {
      type Row = { doc: string; attachments: string; updated_at: string };
      const requireSession = () => {
        if (!db.get('SELECT 1 AS present FROM sessions WHERE app_id = ?', app)) throw new Error(`unknown app session: ${app}`);
      };
      const row = (): Row | null => {
        requireSession();
        return reader === 'owner'
          ? db.get<Row>('SELECT doc, attachments, updated_at FROM drafts WHERE app_session_id = ?', app)
          : db.get<Row>('SELECT doc, attachments, updated_at FROM member_drafts WHERE app_session_id = ? AND member = ?', app, reader);
      };
      db.transaction(() => {
        requireSession();
        if (replaces !== undefined && (row()?.updated_at ?? null) !== replaces) throw new Error(STALE_DRAFT_WORDS);
        const [doc, attachments, updatedAt] = draft === null ? ['null', 'null', `${new Date().toISOString()}#build-f`] : [JSON.stringify(draft.doc ?? null), JSON.stringify(draft.attachments), draft.updatedAt];
        if (reader === 'owner') {
          db.run('INSERT INTO drafts (app_session_id, doc, attachments, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT (app_session_id) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at', app, doc, attachments, updatedAt);
          return;
        }
        db.run('INSERT INTO member_drafts (app_session_id, member, doc, attachments, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (app_session_id, member) DO UPDATE SET doc = excluded.doc, attachments = excluded.attachments, updated_at = excluded.updated_at', app, reader, doc, attachments, updatedAt);
      });
    }

    it('a copy of build F’s set refuses the claim and the settle form as stale, where this build’s takes them', () => {
      const db = (index as unknown as { db: Db }).db;
      expect(() => buildFSet(db, appId, stage('2026-11-13T13:00:00.000Z'), 'owner', DRAFT_CLAIM)).toThrow(STALE_DRAFT_WORDS); // never written
      buildFSet(db, appId, null);
      expect(() => buildFSet(db, appId, stage('2026-11-13T13:00:00.000Z'), 'owner', DRAFT_CLAIM)).toThrow(STALE_DRAFT_WORDS); // cleared
      expect(index.drafts.get(appId)).toBeNull();
      index.drafts.set(appId, stage('2026-11-13T13:00:00.000Z'), 'owner', DRAFT_CLAIM); // this build's store takes it
      expect(() => buildFSet(db, appId, DRAFT, 'owner', settles('2026-11-13T13:00:00.000Z'))).toThrow(STALE_DRAFT_WORDS);
      expect(() => buildFSet(db, appId, DRAFT, MEMBER, DRAFT_CLAIM)).toThrow(STALE_DRAFT_WORDS);
      index.drafts.set(appId, DRAFT, 'owner', settles('2026-11-13T13:00:00.000Z'));
      expect(index.drafts.get(appId)).toEqual(DRAFT);
    });
  });
});
