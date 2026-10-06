// The side-thread rows in the parent's stream (E3 execution document, Design §5): the tap that counts a side thread's
// live turn ends and emits `side.thread.summarised`, the `opened` event, and their re-synthesis from the index with the
// ids and times the live run emitted.
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import { SessionEventSchema } from '@shared/graph/events';
import type { AppSessionId, SessionId } from '@shared/graph/ids';
import type { Lineage, SessionRecord } from '@shared/graph/session';
import type { EventName, EventPayload } from '@shared/ipc/schema';
import { sessionIdFor, summary, tempDir } from '../../../test/support/index-fixture';
import { Index } from '../index/index';
import { openedEvent, sideThreadEvents, startSideThreads, summaryText } from './side-threads';

const ANCHOR = { kind: 'file-line', locator: '/r/x.ts#L42', label: 'x.ts:42', path: '/r/x.ts', line: 42 } as const;

describe('side-thread rows in the parent’s stream', () => {
  let dir: ReturnType<typeof tempDir>;
  let index: Index;
  let parent: SessionRecord;
  let child: SessionRecord;
  let emitted: SessionEvent[];
  let listener: ((payload: EventPayload<'session.eventBatch'>) => void) | null;
  let stop: () => void;
  let engineIds = 0x100;
  beforeEach(() => {
    dir = tempDir();
    index = new Index(join(dir.path, 'index.sqlite'));
    parent = index.sessions.upsertFromSummary(summary({ sessionId: sessionIdFor(1) })).record;
    child = launch({ kind: 'side-thread', parentAppSessionId: parent.appId, parentEngineSessionId: parent.engineSessionId, anchor: ANCHOR, openedBy: 'comment' });
    emitted = [];
    listener = null;
    let at = 0;
    stop = startSideThreads({
      onEvent: <N extends EventName>(name: N, fn: (payload: EventPayload<N>) => void) => {
        expect(name).toBe('session.eventBatch');
        listener = fn as never;
        return () => (listener = null);
      },
      emit: <N extends EventName>(name: N, payload: EventPayload<N>) => {
        const { appSessionId, events } = payload as EventPayload<'session.eventBatch'>;
        expect([name, appSessionId]).toEqual(['session.eventBatch', parent.appId]);
        emitted.push(...events);
        return true;
      },
      sessions: index.sessions,
      sideThreads: index.sideThreads,
      now: () => `2026-10-06T12:00:0${at++}.000Z`,
    });
  });
  afterEach(() => {
    stop();
    index.close();
    dir.dispose();
  });

  function launch(lineage: Lineage | null): SessionRecord {
    const record = index.sessions.createForLaunch({
      directory: '/r', additionalDirectories: [], worktree: null, model: { requested: null, resolved: null }, effort: null,
      permissionMode: { requested: 'auto', effective: 'auto', refusal: null }, lineage,
    }).record;
    return index.sessions.bindEngineId(record.appId, sessionIdFor(++engineIds));
  }

  let n: number;
  beforeEach(() => (n = 0));
  const turnEnded = (over: Partial<Extract<SessionEvent, { kind: 'turn.ended' }>> = {}): SessionEvent =>
    ({
      id: `${child.appId}:${++n}:0`, sessionId: child.engineSessionId as SessionId, at: `2026-10-06T12:01:0${n}.000Z`, seq: n, agentId: null, parentToolUseId: null,
      kind: 'turn.ended', result: 'success', isError: false, terminalReason: 'completed', resultText: `Answer ${n}.`, durationMs: 1, numTurns: 1, costUsd: 0,
      usage: { inputTokens: 0, outputTokens: 0 }, permissionDenials: [], errors: [], userMessageUuids: [], origin: 'human', resultIndex: null, isEchoReceipt: false,
      ...over,
    }) as SessionEvent;
  const batch = (appSessionId: AppSessionId, ...events: SessionEvent[]) => listener!({ appSessionId, events });

  it('emits opened from the stored row and the child’s lineage, under the parent', () => {
    const row = index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T12:00:00.000Z');
    const event = openedEvent(row, index.sessions.get(child.appId)!)!;
    expect(SessionEventSchema.parse(event)).toEqual(event);
    expect(event).toEqual({
      id: `${parent.appId}:side-thread:${child.appId}:opened`, sessionId: parent.engineSessionId, at: '2026-10-06T12:00:00.000Z', seq: null, agentId: null, parentToolUseId: null,
      kind: 'side.thread.opened', childAppSessionId: child.appId, childEngineSessionId: child.engineSessionId, anchor: ANCHOR, openedBy: 'comment',
    });
  });

  it('summarises each live turn end of a side thread: turns 1, then 2, with the turn’s text and error', () => {
    index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T12:00:00.000Z');
    const first = turnEnded();
    batch(child.appId, first);
    batch(child.appId, turnEnded({ isError: true, resultText: 'It failed.' }));
    expect(emitted.map((e) => SessionEventSchema.parse(e))).toEqual([
      expect.objectContaining({ id: `${parent.appId}:side-thread:${child.appId}:summarised:1`, at: first.at, seq: null, kind: 'side.thread.summarised', childAppSessionId: child.appId, text: 'Answer 1.', isError: false, turns: 1 }),
      expect.objectContaining({ id: `${parent.appId}:side-thread:${child.appId}:summarised:2`, kind: 'side.thread.summarised', text: 'It failed.', isError: true, turns: 2 }),
    ]);
  });

  it('counts nothing from an engine-initiated turn, an echo receipt, an agent’s turn or the disk form, and a repeated batch once', () => {
    index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T12:00:00.000Z');
    batch(child.appId, turnEnded({ origin: 'task-notification' }), turnEnded({ isEchoReceipt: true }), turnEnded({ agentId: 'a1' as never }), turnEnded({ seq: null, origin: null, resultText: null }));
    expect(emitted).toEqual([]);
    const live = turnEnded();
    batch(child.appId, live);
    batch(child.appId, live); // a reconnect repeats the batch
    expect(emitted.map((e) => (e as { turns: number }).turns)).toEqual([1]);
  });

  it('keeps the previous text when a turn ends with none', () => {
    index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T12:00:00.000Z');
    batch(child.appId, turnEnded());
    batch(child.appId, turnEnded({ resultText: null }));
    expect(emitted.map((e) => (e as { text: string | null }).text)).toEqual(['Answer 1.', 'Answer 1.']);
  });

  it('ignores the turns of a fork, of a root session and of the parent itself', () => {
    const fork = launch({ kind: 'fork', parentAppSessionId: parent.appId, parentEngineSessionId: parent.engineSessionId, openedBy: 'fork' });
    const root = launch(null);
    batch(fork.appId, turnEnded());
    batch(root.appId, turnEnded());
    batch(parent.appId, turnEnded());
    expect(emitted).toEqual([]);
    expect(index.sideThreads.get(fork.appId)).toBeNull();
  });

  it('a turn that ends before the binding wrote the row writes it, and the binding’s opened then carries that time', () => {
    const early = turnEnded();
    batch(child.appId, early);
    expect(emitted).toHaveLength(1);
    expect(index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T13:00:00.000Z').openedAt).toBe(early.at);
  });

  it('re-synthesises both events from the index after a restart with the live run’s ids and times', () => {
    const row = index.sideThreads.opened(child.appId, parent.appId, '2026-10-06T12:00:00.000Z');
    const live = [openedEvent(row, index.sessions.get(child.appId)!)!];
    batch(child.appId, turnEnded());
    batch(child.appId, turnEnded({ resultText: 'Second.' }));
    live.push(...emitted);
    index.close();
    index = new Index(join(dir.path, 'index.sqlite')); // a cold start over the same file
    const again = sideThreadEvents({ sessions: index.sessions, sideThreads: index.sideThreads }, parent.appId);
    // one row per thread: the opened event and its latest summary
    expect(again.map((e) => [e.id, e.at])).toEqual([live[0], live[2]].map((e) => [e!.id, e!.at]));
    expect(again).toEqual([live[0], live[2]]);
    expect(sideThreadEvents({ sessions: index.sessions, sideThreads: index.sideThreads }, child.appId)).toEqual([]);
  });

  it('caps the summary at 400 characters, at the first sentence or line end past 200', () => {
    expect(summaryText('  Short answer.  ')).toBe('Short answer.');
    const sentence = `${'a'.repeat(250)}. ${'b'.repeat(300)}`;
    expect(summaryText(sentence)).toBe(`${'a'.repeat(250)}.`);
    const line = `${'a'.repeat(220)}\n${'b'.repeat(300)}`;
    expect(summaryText(line)).toBe('a'.repeat(220));
    const early = `${'a'.repeat(100)}. ${'b'.repeat(500)}`; // the only sentence end is before 200
    expect(summaryText(early)).toBe(`${early.slice(0, 399)}…`);
    expect(summaryText(early)).toHaveLength(400);
  });
});
