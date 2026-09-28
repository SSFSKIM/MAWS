import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId, RequestId, SessionId } from '@shared/graph/ids';
import { summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from './index';

const item = (appSessionId: AppSessionId, id: string, over: Partial<AttentionItem> = {}): AttentionItem => ({
  id: id as AttentionId,
  appSessionId,
  sessionId: null,
  kind: 'permission',
  request: { requestId: `req-${id}` as RequestId, toolUseId: null, taskId: null, agentId: null },
  summary: `Allow ${id}?`,
  createdAt: '2026-09-28T10:00:00.000Z',
  state: 'pending',
  stateChangedAt: '2026-09-28T10:00:00.000Z',
  expiresAt: null,
  ...over,
});

describe('attention items persist through C3\'s AttentionStore port', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let a: AppSessionId;
  let b: AppSessionId;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    a = index.sessions.upsertFromSummary(summary()).record.appId;
    b = index.sessions.upsertFromSummary(summary()).record.appId;
  });
  afterEach(() => {
    index.close();
    dir.dispose();
  });

  it('replaceForSession then list returns the items; a second replace replaces; retireForSession empties them', () => {
    const first = [item(a, 'i1'), item(a, 'i2', { kind: 'held_peer_message', expiresAt: '2026-09-28T10:05:00.000Z', sessionId: 's' as SessionId })];
    index.attention.replaceForSession(a, first);
    index.attention.replaceForSession(b, [item(b, 'i3', { state: 'delivered' })]);
    expect(index.attention.list()).toEqual(expect.arrayContaining([...first, item(b, 'i3', { state: 'delivered' })]));
    expect(index.attention.list()).toHaveLength(3);

    index.attention.replaceForSession(a, [item(a, 'i4')]);
    expect(index.attention.list().map((i) => i.id).sort()).toEqual(['i3', 'i4']);

    index.attention.retireForSession(a);
    expect(index.attention.list().map((i) => i.id)).toEqual(['i3']);
  });

  it('an item for an app session with no record is refused; removing the record removes its items', () => {
    const unknown = 'no-such-app' as AppSessionId;
    expect(() => index.attention.replaceForSession(unknown, [item(unknown, 'x')])).toThrow(`unknown app session: ${unknown}`);
    index.attention.replaceForSession(a, [item(a, 'i1')]);
    index.sessions.remove(a);
    expect(index.attention.list()).toEqual([]);
  });
});
