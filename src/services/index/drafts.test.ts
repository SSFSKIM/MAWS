import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import type { Draft } from '@shared/ipc/schema/session';
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
});
