// The live wire asks the arrivals reader (UX wave U3, first landing; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md,
// M4, Interfaces C and E, decisions 7, 8 and 21). A session MAWS runs, mapped from its journal through `Normalizer`: a
// background task's end is kept from its `system/task_notification` frame until the model is told, its line placed at
// the turn the engine opens, settled by the result that names its run, withdrawn when it does not, and given up at the
// next idle after a turn that did not name it. Each transition is pinned on the probes' recorded sessions
// (spikes/protocol-probe/fixtures/uxwave/); rows written by hand are invented.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { deserialize, serialize } from 'node:v8';
import { describe, expect, it } from 'vitest';
import { carriedOf, consentMessage } from '@shared/engine/arrival';
import { SessionEventSchema, type SessionEvent } from '@shared/graph/events';
import type { AppSessionId, EventId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { FIXTURE_DIR, loadUxwaveJournal } from '../../test/support/fixtures';
import { rowsOf, withAllExpanded } from '../renderer/src/transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../renderer/src/transcript/model/reduce';
import type { Row } from '../renderer/src/transcript/model/rows';
import { Normalizer } from './normalizer';

const APP = 'app-u3' as AppSessionId;
const normalizer = (launchId = 'L1') => new Normalizer({ appSessionId: APP, launchId, sessionId: null });

/** A journal's events through a fresh normaliser, each valid X1. */
function live(rows: JournalRow[], launchId?: string): SessionEvent[] {
  const n = normalizer(launchId);
  const events = rows.flatMap((row) => n.push(row));
  for (const event of events) SessionEventSchema.parse(event);
  return events;
}

const frameAt = (rows: JournalRow[], seq: number) => rows.find((row) => row.seq === seq)!.frame as Record<string, unknown>;
type Message = Extract<SessionEvent, { kind: 'user.message' }>;
const carriers = (events: SessionEvent[]) => events.filter((event): event is Message => event.kind === 'user.message' && event.arrival !== undefined);
/** Each placing and withdrawal of the line under one uuid, by the seq of the row that made it. */
const trail = (events: SessionEvent[], uuid: unknown) => carriers(events).filter((event) => event.messageUuid === uuid).map((event) => `${event.seq} ${carriedOf(event.arrival).length > 0 ? 'placed' : 'withdrawn'}`);
/** A line the host made itself: no frame carried its text (Interfaces C). */
const hostMade = (event: Message) => event.content === '';

const stateOf = (events: SessionEvent[]): TranscriptState => applyEvents(createState(null, null), events);
const drawn = (state: TranscriptState): Row[] => rowsOf(withAllExpanded(state));
const notices = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'notice' ? [`${row.class}${row.outcome === null ? '' : ` ${row.outcome}`}: ${row.text}`] : []));
const turnsOf = (state: TranscriptState) => state.order.map((id) => state.turns.get(id)!);

const r1 = loadUxwaveJournal('u3-tasks-r1');
const r1Events = live(r1);

describe('a background task’s end is kept until the model is told (Interfaces E)', () => {
  it('u3-tasks-r1: kept at seq 58 and placed at the turn the engine opens at 61, at its head; settled by the result at 118, which names its run', () => {
    const uuid = frameAt(r1, 58).uuid;
    expect(trail(r1Events, uuid)).toEqual(['61 placed']);
    const atInit = r1Events.filter((event) => event.seq === 61).map((event) => event.kind);
    expect(atInit.slice(0, 3)).toEqual(['session.init', 'turn.started', 'user.message']);
    expect(carriers(r1Events).find((event) => event.messageUuid === uuid)).toMatchObject({
      isSynthetic: true, origin: 'task-notification', content: '', bash: null,
      arrival: [{ class: 'task', taskId: 'bky1j6v31', runId: '0mwdo00bz-9f5454ae', outcome: 'completed', summary: 'Background command "uxw ok" completed (exit code 0)', durationMs: null, detail: null }],
    });
  });

  it('u3-tasks-r1: an end told during the person’s turn (148) is kept across it and placed at the engine’s turn after it (159)', () => {
    expect(trail(r1Events, frameAt(r1, 148).uuid)).toEqual(['159 placed']);
  });

  it('u3-tasks-r1: an end the frame replayed at a tool boundary told (578) is spent there: never placed, its line the frame’s own', () => {
    expect(trail(r1Events, frameAt(r1, 559).uuid)).toEqual([]);
    const told = carriers(r1Events).filter((event) => event.seq === 578);
    expect(told).toMatchObject([{ messageUuid: frameAt(r1, 578).uuid, isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'task', outcome: 'failed', runId: '0mwdo5gh5-47bafe76' }] }]);
  });

  it('u3-tasks-r1: the stopped task’s frame (216) is never kept; its end is the frame replayed with the person’s next prompt (228)', () => {
    expect(trail(r1Events, frameAt(r1, 216).uuid)).toEqual([]);
    expect(carriers(r1Events).filter((event) => event.seq === 228)).toMatchObject([{ arrival: [{ class: 'task', outcome: 'stopped', runId: '0mwdo1wz6-1b311c22' }] }]);
  });

  it('u3-tasks-r1: a monitor’s end kept at 743 is placed at 753, withdrawn at 762, placed again at 763 and settled at 780', () => {
    const uuid = frameAt(r1, 743).uuid;
    expect(trail(r1Events, uuid)).toEqual(['753 placed', '762 withdrawn', '763 placed']);
    // the withdrawal is the result's first event, before its turn.ended
    expect(r1Events.filter((event) => event.seq === 762).map((event) => event.kind)).toEqual(['user.message', 'turn.ended', 'usage.sample']);
  });

  it('u3-tasks-r1: only a background command’s or monitor’s end is kept: no line is placed for a foreground command, an agent or a stopped task', () => {
    const placed = new Set(carriers(r1Events).filter(hostMade).map((event) => event.messageUuid));
    expect(placed).toEqual(new Set([58, 148, 743].map((seq) => frameAt(r1, seq).uuid)));
  });

  it('u3-tasks-r2: a monitor’s end kept across two turns that are not its own is placed and withdrawn twice before the result at 624 settles it', () => {
    const r2 = loadUxwaveJournal('u3-tasks-r2');
    const events = live(r2);
    expect(trail(events, frameAt(r2, 580).uuid)).toEqual(['590 placed', '599 withdrawn', '600 placed', '609 withdrawn', '610 placed']);
    expect(carriers(events).filter((event) => event.seq === 624)).toEqual([]);
  });

  it('u3-cron-r1: the fire at seq 70 is drawn at the init at 71, under its command’s uuid, and its turn’s end, which has no origin, leaves the turn the engine’s', () => {
    const cron = loadUxwaveJournal('u3-cron-r1');
    const events = live(cron);
    expect(events.filter((event) => event.seq === 71).map((event) => event.kind).slice(0, 3)).toEqual(['session.init', 'turn.started', 'user.message']);
    const fire = carriers(events).find((event) => event.seq === 71)!;
    expect(fire).toMatchObject({ messageUuid: frameAt(cron, 70).command_uuid, content: '', isSynthetic: true, origin: 'task-notification', arrival: [{ class: 'schedule', prompt: null }] });
    const turn = turnsOf(stateOf(events)).find((candidate) => candidate.events.some((event) => event.id === fire.id))!;
    expect(turn).toMatchObject({ origin: 'engine', state: 'closed' });
  });

  // Written by hand (invented): a background command ends during the person's turn, an engine turn opens that does not
  // name it, the engine goes idle, and a later engine turn opens
  it('a kept end no turn names is given up at the next idle after a turn that did not name it, and stands on no turn', () => {
    const rows = handWritten([
      out(prompt('u-1')), inn(started('u-1')), inn(init), inn(bgStarted), inn(bgEnded), inn(result({ origin: { kind: 'human' }, user_message_uuids: ['u-1'] })), inn(idleFrame),
      inn(init), inn(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] })), inn(idleFrame),
      inn(init), inn(result({ origin: { kind: 'task-notification' }, user_message_uuids: [] })),
    ]);
    const events = live(rows);
    expect(trail(events, 'f-ended')).toEqual(['8 placed', '9 withdrawn']);
    expect(notices(drawn(stateOf(events)))).toEqual([]);
  });

  // Interfaces E's invariant (decision 8 as revised): under one uuid the first carrier stands, so a line is withdrawn
  // before it is placed again
  it('in every recorded session: a line is withdrawn before it is placed again, at most one host-made line stands on a turn, and only on a turn the engine opened', () => {
    const journals = readdirSync(join(FIXTURE_DIR, 'uxwave')).filter((name) => /^u3-.*\.jsonl$/.test(name) && !name.endsWith('.transcript.jsonl')).map((name) => name.slice(0, -'.jsonl'.length));
    expect(journals.length).toBeGreaterThan(10);
    for (const name of journals) {
      const standing = new Set<unknown>();
      let lastTurn: string | null = null;
      let onTurn = 0;
      for (const event of live(loadUxwaveJournal(name))) {
        if (event.kind === 'turn.started' && event.parentToolUseId === null) [lastTurn, onTurn] = [event.origin, 0];
        if (event.kind !== 'user.message' || event.arrival === undefined) continue;
        if (carriedOf(event.arrival).length === 0) {
          expect(standing.has(event.messageUuid), `${name} ${event.seq}: a withdrawal of a line that stands`).toBe(true);
          standing.delete(event.messageUuid);
          if (hostMade(event)) onTurn -= 1;
          continue;
        }
        expect(standing.has(event.messageUuid), `${name} ${event.seq}: placed again with no withdrawal`).toBe(false);
        standing.add(event.messageUuid);
        if (!hostMade(event)) continue;
        onTurn += 1;
        expect(onTurn, `${name} ${event.seq}: lines the host made on one turn`).toBeLessThanOrEqual(1);
        expect(lastTurn, `${name} ${event.seq}: the turn it stands on`).toBe('engine');
      }
    }
  });
});

describe('a provisional line does not outlive its launch (decision 21)', () => {
  const monitorEnd = 'notice:0mwdo8jdn-29730c86';
  const cut = r1.filter((row) => row.seq <= 758); // the monitor's end kept at 743 and placed at 753; its result at 762 not reached
  const exitRow: JournalRow = { seq: 759, direction: 'meta', at: '2026-11-12T14:57:20.000Z', frame: { event: 'exit', code: 0, signal: null } };
  const ids = (state: TranscriptState) => drawn(state).map((row) => row.id);
  const secondLaunch = () => live(handWritten([out(prompt('u-9')), inn(started('u-9')), inn(init), inn(said('m-9', 'OK')), inn(result({ origin: { kind: 'human' }, user_message_uuids: ['u-9'] }))]), 'L2');

  it('u3-tasks-r1 cut after seq 758 and ended by its exit row: the line is withdrawn before process.exited, and no notice stands on that turn at each step, on a fresh replay, or with a second launch after it', () => {
    const n = normalizer();
    let state = createState(null, null);
    for (const row of cut) state = applyEvents(state, n.push(row));
    expect(ids(state)).toContain(monitorEnd); // placed, waiting for its turn's result
    const atExit = n.push(exitRow);
    expect(atExit.map((event) => event.kind)).toEqual(['user.message', 'process.exited']);
    expect(atExit[0]).toMatchObject({ messageUuid: frameAt(r1, 743).uuid, arrival: [] });
    state = applyEvents(state, atExit);
    expect(ids(state)).not.toContain(monitorEnd);
    const replayed = live([...cut, exitRow]);
    expect(ids(stateOf(replayed))).not.toContain(monitorEnd);
    expect(ids(stateOf([...replayed, ...secondLaunch()]))).not.toContain(monitorEnd);
  });

  it('the same cut journal with no exit row, closed by the model at a synthesised exit, draws none either', () => {
    const events = live(cut);
    const exited: SessionEvent = { id: 'synthesised:exit' as EventId, sessionId: events.at(-1)!.sessionId, at: '2026-11-12T14:57:20.000Z', seq: null, agentId: null, parentToolUseId: null, kind: 'process.exited', code: null, signal: null, reason: 'unknown', lostAttentionCount: 0, budget: null };
    expect(ids(stateOf(events))).toContain(monitorEnd);
    expect(ids(stateOf([...events, exited]))).not.toContain(monitorEnd);
    expect(ids(stateOf([...events, exited, ...secondLaunch()]))).not.toContain(monitorEnd);
  });
});

describe('a journal replayed gives the same events', () => {
  it('twice through fresh normalisers, and through a state restored from a checkpoint while a line is placed', () => {
    expect(live(r1)).toEqual(r1Events);
    const n = normalizer();
    const before = r1.filter((row) => row.seq <= 758).flatMap((row) => n.push(row));
    const restored = new Normalizer({ appSessionId: APP, launchId: 'L1', sessionId: null, state: deserialize(serialize(n.state)) as Normalizer['state'] });
    const after = r1.filter((row) => row.seq > 758).flatMap((row) => restored.push(row));
    expect([...before, ...after]).toEqual(r1Events);
  });
});

describe('a turn’s origin, twice (pitfall 5)', () => {
  it('u3-tasks-r1: a hand-back’s turn ends as the engine’s (“Continued for”), and the empty turn the engine reports after it is no turn', () => {
    expect(r1Events.find((event) => event.kind === 'turn.ended' && event.seq === 354)).toMatchObject({ origin: 'engine' });
    const state = stateOf(r1Events);
    const handback = turnsOf(state).find((turn) => turn.events.some((event) => event.seq === 337))!;
    expect(handback.origin).toBe('engine');
    expect(turnsOf(state).some((turn) => turn.events.some((event) => event.seq === 356 && event.kind === 'turn.ended'))).toBe(false);
  });

  it('u3-sminos-r1-maws: the owner’s inbox send while idle is one turn, the person’s, with no empty turn before it; a peer’s message while idle is a peer’s turn', () => {
    const journal = loadUxwaveJournal('u3-sminos-r1-maws');
    const events = live(journal);
    expect(events.filter((event) => event.seq === 54).map((event) => event.kind)).toEqual(['turn.started', 'user.message']);
    expect(events.find((event) => event.kind === 'turn.ended' && event.seq === 91)).toMatchObject({ origin: 'human' });
    expect(events.find((event) => event.kind === 'turn.ended' && event.seq === 233)).toMatchObject({ origin: 'peer' });
    const turns = turnsOf(stateOf(events));
    const own = turns.findIndex((turn) => turn.events.some((event) => event.kind === 'user.message' && event.content === 'UXW owner idle: reply with only the word ONE.'));
    expect(turns[own]).toMatchObject({ origin: 'human', state: 'closed' });
    expect(turns[own - 1]!.events.some((event) => event.kind === 'user.message' && event.content === 'Without using any tool, reply with only the word READY.')).toBe(true); // the turn before it is the person's last
    expect(turns.find((turn) => turn.events.some((event) => event.seq === 100))).toMatchObject({ origin: 'peer' });
  });
});

describe('where each class is read (M4)', () => {
  it('u3-commands-r1: a command’s output frame is the command’s output, never the model’s answer; one sent again under its uuid emits nothing', () => {
    const events = live(loadUxwaveJournal('u3-commands-r1'));
    expect(events.filter((event) => event.kind === 'assistant.block.complete' && event.parentToolUseId === null && event.model === '<synthetic>')).toEqual([]);
    const outputs = events.filter((event): event is Message => event.kind === 'user.message' && event.origin === 'local-command');
    expect(outputs.filter((event) => event.content === '<local-command-stdout>Compaction canceled.</local-command-stdout>').map((event) => event.seq)).toEqual([406]);
    expect(outputs.find((event) => event.seq === 28)).toMatchObject({ content: '<local-command-stderr>Error: No messages to compact</local-command-stderr>', isSynthetic: false });
  });

  it('MAWS’s own consent message carries its arrival on the person’s message; the same sentence with one word changed carries none', () => {
    const sentence = consentMessage('command', 'npm run deploy:demo');
    const events = live(handWritten([out(prompt('u-1', sentence)), out(prompt('u-2', sentence.replace('exact', 'whole')))]));
    expect(events).toMatchObject([{ kind: 'user.message', origin: 'human', isSynthetic: false, arrival: [{ class: 'consent', kind: 'command', subject: 'npm run deploy:demo' }] }, { kind: 'user.message', origin: 'human' }]);
    expect(events[1]).not.toHaveProperty('arrival');
  });

  it('u3-tasks-r1: the notification a hand-back claimed at one tool boundary (667, after 666) emits nothing; the hand-back is its line', () => {
    expect(r1Events.filter((event) => event.seq === 667)).toEqual([]);
    expect(r1Events.filter((event) => event.seq === 666).map((event) => event.kind)).toEqual(['user.message', 'subagent.message']);
    expect(r1Events.find((event) => event.seq === 666)).toMatchObject({ isSynthetic: true, origin: 'peer' });
  });

  // The replayed frames of a notification, a hand-back and a peer's message exist only because MAWS launches the engine
  // with --replay-user-messages (launch.ts); the bare launches show the wire without it (findings-uxwave-u3-tasks.txt,
  // -commands.txt). What other frames carry stays: a background command's end told while idle (`system/task_notification`),
  // a command's output frame, and the "Compacted" frame, which the engine sends without the flag too.
  it('the bare launches: nothing is an error, no message line is drawn, and what the other frames carry still draws', () => {
    for (const name of ['u3-tasks-bare', 'u3-commands-bare']) {
      const events = live(loadUxwaveJournal(name));
      expect(events.filter((event) => event.kind === 'error.raised' || event.kind === 'frame.unknown'), name).toEqual([]);
      expect(drawn(stateOf(events)).some((row) => row.kind === 'agent_message'), name).toBe(false);
    }
    expect(notices(drawn(stateOf(live(loadUxwaveJournal('u3-tasks-bare')))))).toEqual(['task failed: Background command "uxw fail" failed with exit code 1']);
    const outputs = drawn(stateOf(live(loadUxwaveJournal('u3-commands-bare')))).flatMap((row) => (row.kind === 'local_command' ? [row.text.split('\n', 1)[0]] : []));
    expect(outputs).toEqual(['Error: No messages to compact', 'Total cost:            $0.0013', 'Session renamed to: uxw renamed', 'Compaction canceled.', 'Compacted']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// Rows written by hand, in the shapes the recorded frames have, with invented values

function handWritten(rows: { direction: JournalRow['direction']; frame: unknown }[]): JournalRow[] {
  return rows.map((row, i) => ({ seq: i + 1, direction: row.direction, at: `2026-11-12T10:00:${String(i).padStart(2, '0')}.000Z`, frame: row.frame }));
}
const inn = (frame: unknown) => ({ direction: 'in' as const, frame });
const out = (frame: unknown) => ({ direction: 'out' as const, frame });
const prompt = (uuid: string, content = 'Start the demo job.') => ({ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } });
const started = (uuid: string) => ({ type: 'command_lifecycle', command_uuid: uuid, state: 'started', uuid: `s-${uuid}`, session_id: 'sess-demo' });
const init = {
  type: 'system', subtype: 'init', cwd: '/tmp/demo', session_id: 'sess-demo', tools: ['Bash'], mcp_servers: [], model: 'claude-demo', permissionMode: 'default',
  slash_commands: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'i-demo',
};
const idleFrame = { type: 'system', subtype: 'session_state_changed', state: 'idle', uuid: 'st-demo', session_id: 'sess-demo' };
const bgStarted = { type: 'system', subtype: 'task_started', task_id: 'bdemo0001', run_id: 'run-demo-1', tool_use_id: 'toolu_demo1', description: 'demo sleep', is_backgrounded: true, task_type: 'local_bash', uuid: 'f-started', session_id: 'sess-demo' };
const bgEnded = {
  type: 'system', subtype: 'task_notification', task_id: 'bdemo0001', run_id: 'run-demo-1', tool_use_id: 'toolu_demo1', status: 'completed', output_file: '/tmp/demo/bdemo0001.output',
  summary: 'Background command "demo sleep" completed (exit code 0)', uuid: 'f-ended', session_id: 'sess-demo',
};
const said = (id: string, text: string) => ({ type: 'assistant', message: { id, type: 'message', role: 'assistant', model: 'claude-demo', content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } }, parent_tool_use_id: null, uuid: `a-${id}`, session_id: 'sess-demo' });
const result = (extra: Record<string, unknown>) => ({
  type: 'result', subtype: 'success', session_id: 'sess-demo', is_error: false, duration_ms: 10, duration_api_ms: 8, num_turns: 1, total_cost_usd: 0.01,
  usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [], result: 'OK', terminal_reason: 'completed', uuid: 'r-demo', ...extra,
});
