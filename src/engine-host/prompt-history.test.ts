// P2-C (2026-10-09; the P2-C document, Design §6 "Restarts and reconnects", M3): `session.promptHistory`'s read over a
// session's retained journals, through the normaliser in launch order.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId } from '@shared/graph/ids';
import { promptHistory } from './prompt-history';

const APP = 'app-ph' as AppSessionId;
let dir: string;
beforeEach(() => {
  dir = join(mkdtempSync(join(tmpdir(), 'maws-prompt-history-')), APP);
  mkdirSync(dir, { recursive: true });
});
afterEach(() => rmSync(join(dir, '..'), { recursive: true, force: true }));

type Row = { direction: 'in' | 'out' | 'meta'; at: string; frame: unknown };
const write = (file: string, firstSeq: number, rows: Row[], tail = '') =>
  writeFileSync(join(dir, file), rows.map((row, i) => JSON.stringify({ seq: firstSeq + i, ...row })).join('\n') + '\n' + tail);
const spawn = (at: string): Row => ({ direction: 'meta', at, frame: { event: 'spawn', args: [] } });
const queueRow = (at: string, action: string, ids: Record<string, string>): Row => ({ direction: 'meta', at, frame: { event: 'queue', action, ...ids } });
const userOut = (at: string, uuid: string): Row => ({ direction: 'out', at, frame: { type: 'user', uuid, message: { role: 'user', content: 'the answer' }, parent_tool_use_id: null, origin: { kind: 'human' } } });
const lifecycle = (at: string, uuid: string, state: string): Row => ({ direction: 'in', at, frame: { type: 'command_lifecycle', command_uuid: uuid, state, uuid: `l-${uuid}-${state}`, session_id: 'sess-1' } });
const summary = (events: SessionEvent[]) =>
  events.map((e) => {
    SessionEventSchema.parse(e);
    if (e.kind === 'queue.transition') return `${e.id} ${e.action} ${e.queueId ?? '-'} ${e.messageUuid ?? '-'}`;
    if (e.kind === 'command.lifecycle') return `${e.id} ${e.state} ${e.commandUuid}`;
    return `${e.id} ${e.kind}`;
  });

// Two launches: L1 from 10:00 (a release, its write and its lifecycle, rotated into L1.1 before the exit), L2 from 11:00
// (a dead process's steer abandoned at recovery, then a release and its start).
function twoLaunches(): void {
  write('L1.jsonl', 1, [
    spawn('2026-01-09T10:00:00.000Z'),
    queueRow('2026-01-09T10:00:01.000Z', 'release', { trigger: 'send', queueId: 'q-1', messageUuid: 'u-1' }),
    userOut('2026-01-09T10:00:01.000Z', 'u-1'),
    lifecycle('2026-01-09T10:00:02.000Z', 'u-1', 'queued'),
    lifecycle('2026-01-09T10:00:02.000Z', 'u-1', 'started'),
    { direction: 'meta', at: '2026-01-09T10:00:03.000Z', frame: { event: 'notice', level: 'info', key: 'k', text: 'not history' } },
  ]);
  write('L1.1.jsonl', 7, [lifecycle('2026-01-09T10:05:00.000Z', 'u-1', 'completed'), { direction: 'meta', at: '2026-01-09T10:05:01.000Z', frame: { event: 'exit', code: 0, signal: null, reason: 'quit' } }]);
  write('L2.jsonl', 1, [
    spawn('2026-01-09T11:00:00.000Z'),
    queueRow('2026-01-09T11:00:01.000Z', 'abandon', { messageUuid: 'u-2' }),
    queueRow('2026-01-09T11:00:02.000Z', 'pause', { reason: 'user' } as Record<string, string>),
    queueRow('2026-01-09T11:00:03.000Z', 'release', { trigger: 'resume', queueId: 'q-2', messageUuid: 'u-3' }),
    userOut('2026-01-09T11:00:03.000Z', 'u-3'),
    lifecycle('2026-01-09T11:00:04.000Z', 'u-3', 'started'),
  ]);
}

describe('session.promptHistory: the prompt record from the retained journals (P2-C)', () => {
  it('answers the queue transitions and command lifecycles at or after `since`, launch by launch, rotations in order, with the live ids', async () => {
    twoLaunches();
    const { events, complete } = await promptHistory(dir, APP, '2026-01-09T10:00:01.500Z');
    expect(complete).toBe(true); // the oldest retained launch began before `since`
    expect(summary(events)).toEqual([
      'app-ph:L1:4:0 queued u-1',
      'app-ph:L1:5:0 started u-1',
      'app-ph:L1:7:0 completed u-1',
      'app-ph:L2:2:0 abandon - u-2',
      'app-ph:L2:4:0 release q-2 u-3',
      'app-ph:L2:6:0 started u-3',
    ]);
  });

  it('across two launches whose earliest journal was rotated away, answers complete: false with what it holds', async () => {
    twoLaunches();
    const { events, complete } = await promptHistory(dir, APP, '2026-01-09T09:00:00.000Z');
    expect(complete).toBe(false); // the launch that ran at 09:00 is gone: what happened then cannot be told
    expect(summary(events)[0]).toBe('app-ph:L1:2:0 release q-1 u-1');
    expect(events).toHaveLength(7);
  });

  it('answers nothing, incomplete, for a session with no retained journal', async () => {
    rmSync(dir, { recursive: true });
    await expect(promptHistory(dir, APP, '2026-01-09T09:00:00.000Z')).resolves.toEqual({ events: [], complete: false });
  });

  it('a launch it cannot read to the end makes the answer incomplete, keeping what came before', async () => {
    twoLaunches();
    write('L2.jsonl', 1, [spawn('2026-01-09T11:00:00.000Z'), queueRow('2026-01-09T11:00:01.000Z', 'abandon', { messageUuid: 'u-2' })], '{"seq": 3, "direction": "meta", "at": "2026-01-09T11:00:0\n');
    const { events, complete } = await promptHistory(dir, APP, '2026-01-09T10:00:01.500Z');
    expect(complete).toBe(false);
    expect(summary(events).at(-1)).toBe('app-ph:L2:2:0 abandon - u-2');
  });
});
