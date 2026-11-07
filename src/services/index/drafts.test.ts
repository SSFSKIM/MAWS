import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { STALE_DRAFT_WORDS, type Draft } from '@shared/ipc/schema/session';
import { summary, tempDir } from '../../../test/support/index-fixture';
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
});
