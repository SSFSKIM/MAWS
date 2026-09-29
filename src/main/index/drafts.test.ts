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
  });
});
