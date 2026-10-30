import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AttentionItemSchema, type AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { FileAttentionStore } from './file-attention-store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'maws-attention-'));
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

const item = (appSessionId: string, kind: AttentionItem['kind'] = 'interrupted'): AttentionItem =>
  AttentionItemSchema.parse({
    id: `${appSessionId}:${kind}:1`, appSessionId, sessionId: null, kind, request: { requestId: null, toolUseId: null, taskId: null, agentId: null },
    summary: 'Session interrupted, 1 approval lost', createdAt: '2026-09-28T10:00:00.000Z', state: 'pending', stateChangedAt: '2026-09-28T10:00:00.000Z', expiresAt: null,
  });

describe('FileAttentionStore', () => {
  it('starts empty, replaces one session\'s list at a time, and survives a new instance (a restart)', async () => {
    const file = join(dir, 'attention.json');
    const store = new FileAttentionStore(file);
    expect(await store.list()).toEqual([]);
    await store.replaceForSession('app-a' as AppSessionId, [item('app-a')]);
    await store.replaceForSession('app-b' as AppSessionId, [item('app-b', 'error')]);
    await store.replaceForSession('app-a' as AppSessionId, []);
    expect(await new FileAttentionStore(file).list()).toEqual([item('app-b', 'error')]);
    await store.retireForSession('app-b' as AppSessionId);
    expect(await new FileAttentionStore(file).list()).toEqual([]);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, sessions: {} });
    expect(readdirSync(dir)).toEqual(['attention.json']); // written through a temp file and a rename
  });

  it('keeps an unreadable file aside and starts empty with a warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const file = join(dir, 'attention.json');
    writeFileSync(file, '{ not json');
    expect(await new FileAttentionStore(file).list()).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
    const aside = readdirSync(dir).find((name) => name.startsWith('attention.json.corrupt-'));
    expect(aside && readFileSync(join(dir, aside), 'utf8')).toBe('{ not json');
    expect(existsSync(file)).toBe(false);
  });
});
