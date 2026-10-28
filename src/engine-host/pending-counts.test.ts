// `engine.pendingItems`'s answer (P5 O10; review of the lane B notify follow-up): per session, how many of its broker
// items wait on an answer, never the items themselves, so the answer's size follows the sessions waiting, not what the
// items carry. It must stay far below the socket's line cap (LINE_CAP), past which the link closes.
import { describe, expect, it } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { LINE_CAP } from '@shared/host/socket-protocol';
import { commands } from '@shared/ipc/schema/engine';
import { pendingCounts } from './pending-counts';

const item = (app: string, n: number, state: AttentionItem['state'], fields: Partial<AttentionItem> = {}): AttentionItem =>
  ({
    id: `att-${app}-${n}`,
    appSessionId: app,
    sessionId: null,
    kind: 'question',
    request: { requestId: `rq-${app}-${n}`, toolUseId: null, taskId: null, agentId: null },
    summary: 'Which way?',
    createdAt: '2026-10-28T00:00:00.000Z',
    state,
    stateChangedAt: '2026-10-28T00:00:00.000Z',
    expiresAt: null,
    ...fields,
  }) as AttentionItem;

const row = (app: string, items: AttentionItem[]) => ({ status: () => ({ appSessionId: app as AppSessionId }), brokerItems: () => items });

describe('engine.pendingItems’s answer', () => {
  it('counts each session’s items that wait on an answer, and leaves out a session with none', () => {
    const answer = pendingCounts([
      row('app-1', [item('app-1', 1, 'pending'), item('app-1', 2, 'delivered'), item('app-1', 3, 'confirmed'), item('app-1', 4, 'retired')]),
      row('app-2', [item('app-2', 1, 'pending', { kind: 'error', request: { requestId: null, toolUseId: null, taskId: null, agentId: null } })]),
      row('app-3', []),
    ]);
    expect(answer).toEqual({ sessions: [{ appSessionId: 'app-1', waiting: 2 }] });
    expect(commands['engine.pendingItems'].output.parse(answer)).toEqual(answer);
  });

  it('stays small whatever the items carry: 65 sessions, each a 1 MiB question, answer in under 4 KiB', () => {
    const huge = 'x'.repeat(1024 * 1024);
    const rows = Array.from({ length: 65 }, (_, i) => row(`app-${i}`, [item(`app-${i}`, 1, 'pending', { summary: huge })]));
    const line = JSON.stringify(pendingCounts(rows));
    expect(Buffer.byteLength(line)).toBeLessThan(4 * 1024);
    expect(Buffer.byteLength(line)).toBeLessThan(LINE_CAP / 1000);
    expect(JSON.parse(line).sessions).toHaveLength(65);
    expect((JSON.parse(line) as { sessions: Array<{ waiting: number }> }).sessions.every((s) => s.waiting === 1)).toBe(true);
  });
});
