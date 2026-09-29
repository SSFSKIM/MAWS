// C4's disk history through C6's model (C6 execution document, M2's pins and the pending C4 gates, closed at the final
// rebase): the real transcripts C4 keeps under test/fixtures/transcripts/ are backfilled by C4's chain follower, as
// `session.events` answers for a session with no live process (`FsService.eventsSnapshot`, holders none), and the events
// are applied through the reducer the renderer uses.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, SessionId } from '@shared/graph/ids';
import { AgentMetaSchema } from '@shared/wire/transcript';
import { ChainFollower } from '../../../../engine-host/fs/chain-follower';
import { TEST_FIXTURE_DIR, TRANSCRIPT_FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { rowsOf } from './derive';
import { applyEvents, createState, type TranscriptState } from './reduce';
import type { Row } from './rows';
import { builder, uuid } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is RowOf<K> => row.kind === kind);

// The session's subagent sidecars, as C4's subagents reader looks them up for an `Agent` tool use.
function sidecars(sessionId: string) {
  const dir = join(TRANSCRIPT_FIXTURE_DIR, sessionId, 'subagents');
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith('.meta.json'))
    .map((name) => ({ agentId: name.slice('agent-'.length, -'.meta.json'.length) as AgentId, meta: AgentMetaSchema.parse(JSON.parse(readFileSync(join(dir, name), 'utf8'))), prompt: null }));
  return { byToolUseId: (toolUseId: string) => entries.find((entry) => entry.meta.toolUseId === toolUseId) ?? null };
}

// A session's transcript backfilled as C4 answers `session.events` for it when nobody holds it.
async function backfill(bytes: Buffer, sessionId: string, subagents?: ReturnType<typeof sidecars>): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(bytes), sessionId as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0, subagents });
  await follower.start();
  follower.stop();
  return events;
}
const backfillFixture = (name: string, sessionId: string, subagents?: ReturnType<typeof sidecars>) => backfill(readFileSync(join(TRANSCRIPT_FIXTURE_DIR, `${name}.jsonl`)), sessionId, subagents);

const stateOf = (events: SessionEvent[]) => applyEvents(createState(null, null), events);
const expanded = (state: TranscriptState): Row[] => rowsOf({ ...state, ui: { ...state.ui, expandedTurns: new Set(state.order), version: state.ui.version + 1, global: state.ui.global + 1 } });
const turnsOf = (state: TranscriptState) => state.order.map((id) => state.turns.get(id)!);

describe('C4 backfill through the transcript model', () => {
  // The M2 pin read "human turns only": C4's landed backfill gives each `<task-notification>` record the X1 engine origin
  // `task-notification`, so the two follow-up turns are engine turns (positive evidence), as in the live pass1/subagent.
  it('subagent-parent: the prompt’s turn human (null origin) with its user row and the Agent calls as one subagent row, no Agent cell; the two task-notification turns engine, no bubble, Continued', async () => {
    const SESSION = '9a1d4262-0b43-46ad-acb9-5982f31d209c';
    const events = await backfillFixture('subagent-parent', SESSION, sidecars(SESSION));
    expect(events.filter((e) => e.kind === 'turn.started').map((e) => e.kind === 'turn.started' && e.origin)).toEqual([null, 'task-notification', 'task-notification']);
    const state = stateOf(events);
    const turns = turnsOf(state);
    expect(turns.map((turn) => [turn.origin, turn.state, turn.closedBy])).toEqual([['human', 'closed', 'completed'], ['engine', 'closed', 'completed'], ['engine', 'closed', 'completed']]);
    const rows = expanded(state);
    const users = ofKind(rows, 'user');
    expect(users.map((row) => row.turnId)).toEqual([turns[0].id]);
    expect(users[0].text.startsWith('Dispatch two general-purpose Agent subagents')).toBe(true);
    expect(rows.some((row) => row.kind === 'user' && row.text.includes('<task-notification>'))).toBe(false);
    const subagents = ofKind(rows, 'subagent');
    expect(subagents).toHaveLength(1);
    expect(subagents[0]).toMatchObject({ turnId: turns[0].id, status: 'finished', sentence: 'Read and report one.txt content and Read and report two.txt content finished' });
    expect(subagents[0].agents.map((agent) => [agent.agentId, agent.kind])).toEqual([['ad286defbc77bc090', 'agent'], ['ae75ba6ce5d866acc', 'agent']]);
    const cells = rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));
    expect(cells.some((cell) => cell.toolName === 'Agent')).toBe(false);
    expect(ofKind(rows, 'divider').map((d) => [d.origin, d.state])).toEqual([['human', 'completed'], ['engine', 'completed'], ['engine', 'completed']]);
  });

  it('sdk-unended (C4 landed the ask): the last turn, which an SDK session never ends on disk, settles as completed at C4’s synthesised exit, nothing working', async () => {
    const events = await backfillFixture('sdk-unended', '6eff2bf4-616c-40b7-9928-f60df666cdfe');
    expect(events.filter((e) => e.kind === 'turn.ended')).toEqual([]);
    expect(events.at(-1)).toMatchObject({ kind: 'process.exited', reason: 'unknown', seq: null });
    const state = stateOf(events);
    expect(state.current).toBeNull();
    const [turn] = turnsOf(state);
    expect(turn).toMatchObject({ state: 'closed', closedBy: 'completed', endedAt: '2026-09-27T07:00:30.639Z' }); // nobody stopped it
    const rows = expanded(state);
    expect(ofKind(rows, 'divider')).toEqual([]); // no work area, so no divider, and nothing ticks
    expect(ofKind(rows, 'user').map((u) => u.text)).toEqual(['reply with exactly: ok']);
    expect(ofKind(rows, 'error')).toEqual([]); // C4's synthesis closes the turn; nobody witnessed an exit, so no notice
  });

  it('interrupt-marker (C4 landed the ask): no marker bubble, no turn of its own, and the interrupted turn closes stopped', async () => {
    const events = await backfillFixture('interrupt-marker', '68646e1f-b5ba-4d72-bdae-3fd5f7f3ec46');
    expect(events.filter((e) => e.kind === 'turn.started')).toHaveLength(1); // C4 opens no turn for the marker
    expect(events.filter((e) => e.kind === 'user.message').map((e) => e.kind === 'user.message' && e.origin)).toEqual([null, 'interrupt-marker']);
    const state = stateOf(events);
    expect(state.order).toHaveLength(1);
    expect(turnsOf(state)[0]).toMatchObject({ state: 'closed', closedBy: 'stopped' }); // the marker is its evidence
    const rows = expanded(state);
    expect(ofKind(rows, 'user').map((u) => u.text)).toEqual(['ㅇㄹㅁ']);
    expect(rows.some((row) => row.kind === 'user' && row.text.includes('Request interrupted'))).toBe(false);
  });

  it('pasted content, the C4 half: the golden send written as a JSONL user record and backfilled yields the same user row as the live event', async () => {
    const golden = JSON.parse(readFileSync(join(TEST_FIXTURE_DIR, 'composer/pasted-40-lines.json'), 'utf8')) as { sent: string };
    const U1 = '3f1d7e52-0000-4000-8000-000000000001';
    const at = '2026-09-28T10:00:00.000Z';
    const lines = [
      { type: 'user', uuid: U1, parentUuid: null, cwd: '/tmp/p', sessionId: 'S', timestamp: at, message: { role: 'user', content: golden.sent } },
      { type: 'assistant', uuid: 'a1', parentUuid: U1, sessionId: 'S', timestamp: '2026-09-28T10:00:01.000Z', message: { id: 'm1', role: 'assistant', model: 'x', content: [{ type: 'text', text: 'Got it.' }] } },
      { type: 'system', subtype: 'turn_duration', uuid: 's1', parentUuid: 'a1', durationMs: 1000, timestamp: '2026-09-28T10:00:02.000Z' },
    ];
    const disk = ofKind(rowsOf(stateOf(await backfill(Buffer.from(lines.map((l) => JSON.stringify(l) + '\n').join('')), 'S'))), 'user');

    const b = builder(at);
    b.emit('turn.started', { userMessageUuid: uuid(U1), origin: 'human' });
    b.emit('user.message', { messageUuid: uuid(U1), content: golden.sent, isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    const live = ofKind(rowsOf(stateOf(b.events)), 'user');

    expect(disk).toHaveLength(1);
    expect(disk[0]).toEqual({ ...live[0], at: disk[0].at });
    expect(disk[0].attachments.map((a) => [a.kind, a.name, a.text?.split('\n').length])).toEqual([['text', 'Pasted text #1', 40]]);
  });
});
