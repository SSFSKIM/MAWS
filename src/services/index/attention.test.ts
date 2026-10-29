import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  it('replaceForSession then list returns the items; a second replace replaces; retireForSession empties them', async () => {
    const first = [item(a, 'i1'), item(a, 'i2', { kind: 'held_peer_message', expiresAt: '2026-09-28T10:05:00.000Z', sessionId: 's' as SessionId })];
    await index.attention.replaceForSession(a, first);
    await index.attention.replaceForSession(b, [item(b, 'i3', { state: 'delivered' })]);
    expect(await index.attention.list()).toEqual(expect.arrayContaining([...first, item(b, 'i3', { state: 'delivered' })]));
    expect(await index.attention.list()).toHaveLength(3);

    await index.attention.replaceForSession(a, [item(a, 'i4')]);
    expect((await index.attention.list()).map((i) => i.id).sort()).toEqual(['i3', 'i4']);

    await index.attention.retireForSession(a);
    expect((await index.attention.list()).map((i) => i.id)).toEqual(['i3']);
  });

  // C3's service retries a refused write every 5 s for as long as it is refused, so a record-less session (a launch the
  // index holds no record of yet) would be retried and logged forever; its items have nowhere to show after a restart.
  it('an item for an app session with no record is not persisted (one log line, no rejection); removing the record removes its items', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unknown = 'no-such-app' as AppSessionId;
    await expect(index.attention.replaceForSession(unknown, [item(unknown, 'x')])).resolves.toBeUndefined();
    await expect(index.attention.replaceForSession(unknown, [item(unknown, 'y')])).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(`no index record for app session ${unknown}`));
    expect(await index.attention.list()).toEqual([]);
    await index.attention.replaceForSession(a, [item(a, 'i1')]);
    index.sessions.remove(a);
    expect(await index.attention.list()).toEqual([]);
  });
});
