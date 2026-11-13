// The routes agree on what M1 makes a file say as the wire does (UX wave U2, first landing; the U2a execution document,
// M1, Interfaces §F and Acceptance 1 and 6; the wave's law 5): a thought's recorded duration, and a refused call's kind
// and reading. One recorded session is drawn from its journal as a session MAWS runs draws it (the journal through the
// engine host's `Normalizer`), from its transcript file as the chain follower answers `session.events` for it on this
// Mac, and from the same rows as another machine sends them (`freshSource`). It lives beside U3a's
// `arrival-routes.test.ts` and not in the transcript's model, for the reason that test gives: the node project
// typechecks the model's directory, and the graph of the reader of another machine's rows is the renderer's. The three
// readers are written again here because that test exports none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, loadJournal, loadUxwaveJournal, TRANSCRIPT_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { journalToEvents } from '../transcript/dev/journal';
import { rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState } from '../transcript/model/reduce';
import type { Cell, Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';

const SESSION = '0f0e0d0c-0000-4000-8000-00000000c0de';

const rowsIn = (text: string): JsonObject[] => text.split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as JsonObject);

/** The file route: the chain follower over the file's bytes, as `session.events` answers for a session nobody holds. */
async function fromFile(text: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}

/** The link route: the same rows, each with its uuid, through the reader of another machine's rows. */
const fromRows = (text: string): Promise<SessionEvent[]> =>
  freshSource(rowsIn(text).filter((row) => typeof row.uuid === 'string'), SESSION, subagentLookupOf([])).snapshot();

/** The live route: the session's journal through the engine host's normaliser. */
const fromJournal = (rows: JournalRow[]): SessionEvent[] => journalToEvents(rows);

const drawn = (events: SessionEvent[]): Row[] => rowsOf(withAllExpanded(applyEvents(createState(null, null), events)));
const callsOf = (rows: Row[]): Cell[] => rows.flatMap((row) => (row.kind === 'cell' ? [row] : row.kind === 'group' ? row.cells.filter((cell) => cell.toolUseId !== null) : []));

/** What M1 makes a route say: each refused call (its label, status and reading) and each turn's line (its state and its counts). */
function refusals(rows: Row[]): string[] {
  return rows.flatMap((row): string[] => {
    if (row.kind === 'divider') return [`turn ${row.state} · ${row.denied} denied · ${row.autoDenied} auto-denied`];
    if (row.kind === 'ask') return [`ask ${row.state}`];
    return callsOf([row]).flatMap((cell) => (cell.classification.denial === null ? [] : [`${cell.status} ${cell.classification.denial.disposition}: ${cell.label}`]));
  });
}

/** Every thought's recorded duration, as a row outside a run or a cell inside one. */
const recordedDurations = (rows: Row[]): (number | null)[] => rows.flatMap((row) =>
  row.kind === 'thinking' ? [row.recordedMs] : row.kind === 'group' ? row.cells.flatMap((cell) => (cell.detail.kind === 'thinking' ? [cell.detail.recordedMs] : [])) : []);

describe('a call the person’s Stop interrupted is the same refused call by every route (M1’s route proof, before M2)', () => {
  const routes = async (journal: string, file: string) => {
    const text = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, `${file}.jsonl`), 'utf8');
    const events = { live: fromJournal(loadJournal('pass3', journal)), file: await fromFile(text), link: await fromRows(text) };
    return Object.entries(events).map(([route, of]) => ({ route, events: of, rows: drawn(of) }));
  };
  const rejectedResults = (events: SessionEvent[]) => events.flatMap((e) => (e.kind === 'tool.result' && e.denial !== null ? [`${e.toolUseId} ${e.denial}`] : []));
  const refusedCalls = (rows: Row[]) => refusals(rows).filter((line) => !line.startsWith('turn '));
  const firstLine = (rows: Row[]) => refusals(rows).find((line) => line.startsWith('turn '));

  it('steer-next-interrupted: the shell call reads `Stopped: …` on all three, and the turn the Stop cut reads stopped with no denied count', async () => {
    for (const { route, events, rows } of await routes('steer-next-interrupted', 'w1-steer-next-interrupted')) {
      expect(rejectedResults(events), route).toEqual(['toolu_018A2pQ8opsSUGLt6bscFJ4R user-rejected']);
      expect(refusedCalls(rows), route).toEqual(['stopped stopped: Stopped: `sleep 6 && echo 1`']);
      expect(firstLine(rows), route).toBe('turn stopped · 0 denied · 0 auto-denied');
    }
  });

  it('p1-maws-ask-interrupt: the ask reads the same row on all three (withdrawn), and the turn the Stop cut reads stopped with no denied count', async () => {
    const drawn = await routes('p1-maws-ask-interrupt', 'p1-maws-ask-interrupt');
    for (const { route, events, rows } of drawn) {
      expect(rejectedResults(events).map((line) => line.split(' ')[1]), route).toEqual(['user-rejected']);
      expect(refusedCalls(rows).filter((line) => !line.startsWith('ask ')), route).toEqual([]); // the ask is a row of its own kind, no cell
      expect(firstLine(rows), route).toBe('turn stopped · 0 denied · 0 auto-denied');
      // live by the host's own `maws_ask_cancelled` (seq 97), from the file and the link by the refusal that reads stopped
      // (the architect's ruling on the stopped ask)
      const asks = rows.flatMap((row) => (row.kind === 'ask' ? [{ state: row.state, cancelReason: row.cancelReason, error: row.error }] : []));
      expect(asks, route).toEqual([{ state: 'cancelled', cancelReason: 'withdrawn', error: null }]);
    }
  });
});

describe('a thought’s recorded duration is the same by every route (Acceptance 6’s number)', () => {
  it('u3-cron-r1: the last turn’s thought carries 10,192 ms from the wire journal, from the transcript file and from the file’s rows', async () => {
    const text = readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-cron-r1.transcript.jsonl'), 'utf8');
    expect(recordedDurations(drawn(fromJournal(loadUxwaveJournal('u3-cron-r1'))))).toEqual([10_192]);
    expect(recordedDurations(drawn(await fromFile(text)))).toEqual([10_192]);
    expect(recordedDurations(drawn(await fromRows(text)))).toEqual([10_192]);
  });
});

// UX wave U2, M2 (decision 23, R2, and the revision's point 13): a call a Stop left unfinished is one stopped member of
// one run by every route. The journal holds the call with no result in a turn its process's exit closed; the file holds
// the same call with the result the engine repairs such a call with on its next load (`toolDenialKind: 'interrupted'`,
// its words as `cli.pretty.js:426583-426660` of 2.1.322 write them), read from the file and from the file's rows. Every
// command, path and name is invented.
describe('a stopped member of its run is the same row in the same run by every route', () => {
  const at = (ms: number) => new Date(Date.parse('2026-09-28T11:00:00.000Z') + ms).toISOString();
  const REPAIRED = '[Tool call interrupted: the session ended before this call’s result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]';
  const PROMPT = 'Tidy the workspace.';
  type Call = { id: string; name: string; input: Record<string, unknown> };

  const journalOf = (done: Call, cut: Call): JournalRow[] => {
    let seq = 0;
    const row = (direction: JournalRow['direction'], ms: number, frame: unknown): JournalRow => ({ seq: (seq += 1), direction, at: at(ms), frame });
    const assistant = (ms: number, id: string, call: Call) => row('in', ms, {
      type: 'assistant', message: { model: 'claude-test', id, type: 'message', role: 'assistant', content: [{ type: 'tool_use', ...call }], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
      parent_tool_use_id: null, uuid: `a-${id}`, timestamp: at(ms), session_id: SESSION,
    });
    return [
      row('meta', 0, { event: 'spawn', pid: 4100, cwd: '/tmp/maws-synth-routes', bin: 'claude', args: ['-p'] }),
      row('out', 10, { type: 'user', uuid: 'u-routes-1', message: { role: 'user', content: PROMPT }, parent_tool_use_id: null, origin: { kind: 'human' } }),
      row('in', 20, { type: 'command_lifecycle', command_uuid: 'u-routes-1', state: 'started', uuid: 'cl-routes-1', session_id: SESSION }),
      row('in', 30, { type: 'system', subtype: 'init', cwd: '/tmp/maws-synth-routes', model: 'claude-test', permissionMode: 'default', tools: [], slash_commands: [], agents: [], skills: [], plugins: [], mcp_servers: [], capabilities: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'sys-routes-1', session_id: SESSION }),
      assistant(40, 'msg_routes_1', done),
      row('in', 50, { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: done.id, content: 'ok' }] }, parent_tool_use_id: null, uuid: 't-routes-1', timestamp: at(50), session_id: SESSION }),
      assistant(60, 'msg_routes_2', cut),
      row('meta', 70, { event: 'exit', code: null, signal: 'SIGKILL', peakRSSKiB: 1, peakTreeRSSKiB: 1 }),
    ];
  };

  const fileOf = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join('\n') + '\n';
  const prompt = (uuid: string, parentUuid: string | null, ms: number, text: string) => ({ type: 'user', uuid, parentUuid, timestamp: at(ms), sessionId: SESSION, message: { role: 'user', content: text } });
  const assistantRecord = (uuid: string, parentUuid: string, ms: number, id: string, call: Call) => ({ type: 'assistant', uuid, parentUuid, timestamp: at(ms), sessionId: SESSION, message: { id, role: 'assistant', model: 'claude-test', content: [{ type: 'tool_use', ...call }] } });
  const resultRecord = (uuid: string, parentUuid: string, ms: number, toolUseId: string, content: string, kind?: string) => ({
    type: 'user', uuid, parentUuid, timestamp: at(ms), sessionId: SESSION, ...(kind !== undefined && { toolDenialKind: kind, toolUseResult: content }),
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content, ...(kind !== undefined && { is_error: true }) }] },
  });
  const transcriptOf = (done: Call, cut: Call) => fileOf([
    prompt('f-1', null, 10, PROMPT),
    assistantRecord('f-2', 'f-1', 40, 'msg_routes_1', done),
    resultRecord('f-3', 'f-2', 50, done.id, 'ok'),
    assistantRecord('f-4', 'f-3', 60, 'msg_routes_2', cut),
    resultRecord('f-5', 'f-4', 70, cut.id, REPAIRED, 'interrupted'),
    prompt('f-6', 'f-5', 90_000, 'Carry on.'),
  ]);

  /** The run that holds the cut call: its calls and caption, and the cut call's row. */
  const reading = (rows: Row[], cut: string) => {
    const run = rows.find((row): row is Extract<Row, { kind: 'group' }> => row.kind === 'group' && row.cells.some((cell) => cell.toolUseId === cut));
    const call = callsOf(rows).find((cell) => cell.toolUseId === cut);
    return { run: run && { calls: run.cells.filter((cell) => cell.toolUseId !== null).map((cell) => cell.toolUseId), caption: run.summary }, call: call && { status: call.status, label: call.label } };
  };

  it.each([
    ['a shell call', { id: 'toolu_routes_1', name: 'Bash', input: { command: 'ls build' } }, { id: 'toolu_routes_2', name: 'Bash', input: { command: 'pnpm clean' } }, 'Ran 2 commands (1 stopped)', 'Stopped: `pnpm clean`'],
    ['an edit', { id: 'toolu_routes_1', name: 'Read', input: { file_path: '/tmp/maws-synth-routes/notes.md' } }, { id: 'toolu_routes_2', name: 'Edit', input: { file_path: '/tmp/maws-synth-routes/todo.md', old_string: 'a', new_string: 'b' } }, 'Read a file, edited a file (1 stopped)', 'Stopped: `/tmp/maws-synth-routes/todo.md`'],
    ['an MCP call', { id: 'toolu_routes_1', name: 'mcp__notes__list_pages', input: {} }, { id: 'toolu_routes_2', name: 'mcp__notes__create_page', input: { title: 'Plan' } }, null, 'Stopped: `notes · create_page`'],
  ] as const)('%s', async (_family, done, cut, caption, label) => {
    const text = transcriptOf(done, cut);
    const routes = { live: drawn(fromJournal(journalOf(done, cut))), file: drawn(await fromFile(text)), link: drawn(await fromRows(text)) };
    const live = reading(routes.live, cut.id);
    expect(live.call).toEqual({ status: 'stopped', label });
    expect(live.run?.calls).toEqual([done.id, cut.id]);
    if (caption !== null) expect(live.run?.caption).toBe(caption);
    expect(live.run?.caption).toMatch(/\(1 stopped\)$/);
    expect(reading(routes.file, cut.id), 'the file').toEqual(live);
    expect(reading(routes.link, cut.id), 'the file’s rows').toEqual(live);
  });

  // The revision's point 7 (R5): a run of three, one finished and two in flight at the Stop, as the file of a session MAWS
  // ran holds it (the keys the recorded pair's file rows carry: `toolDenialKind`, the interrupt marker; no turn end)
  it('a run of three with two in flight at the Stop: `Ran 3 commands (2 stopped)` from the file and from its rows', async () => {
    const bash = (n: number, command: string): Call => ({ id: `toolu_routes_3${n}`, name: 'Bash', input: { command } });
    const REJECTED = 'The user doesn’t want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.';
    const text = fileOf([
      prompt('g-1', null, 10, 'Check the three packages.'),
      assistantRecord('g-2', 'g-1', 20, 'msg_routes_3', bash(1, 'pnpm -F a test')),
      assistantRecord('g-3', 'g-2', 21, 'msg_routes_3', bash(2, 'pnpm -F b test')),
      assistantRecord('g-4', 'g-3', 22, 'msg_routes_3', bash(3, 'pnpm -F c test')),
      resultRecord('g-5', 'g-4', 3_000, 'toolu_routes_31', '1 passed'),
      resultRecord('g-6', 'g-5', 5_000, 'toolu_routes_32', REJECTED, 'user-rejected'),
      resultRecord('g-7', 'g-6', 5_001, 'toolu_routes_33', REJECTED, 'user-rejected'),
      { type: 'user', uuid: 'g-8', parentUuid: 'g-7', timestamp: at(5_002), sessionId: SESSION, message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user for tool use]' }] } },
      prompt('g-9', 'g-8', 60_000, 'Just the first, then.'),
    ]);
    for (const [route, rows] of [['file', drawn(await fromFile(text))], ['link', drawn(await fromRows(text))]] as const) {
      expect(reading(rows, 'toolu_routes_33').run, route).toEqual({ calls: ['toolu_routes_31', 'toolu_routes_32', 'toolu_routes_33'], caption: 'Ran 3 commands (2 stopped)' });
    }
  });

  // The architect's ruling of 2026-11-13 ("A refused sent message and the turn's denied count"): a fold never hides a
  // denial. A refused send is drawn as its message row on every route, and that row folds with its turn, so the turn's
  // line counts it as denied
  it('a refused send to another session: its row folds with the turn, and the turn’s line counts it denied, by every route', async () => {
    const call: Call = { id: 'toolu_routes_send', name: 'SendMessage', input: { to: 'uds:/tmp/socks/7.sock', message: 'The build is green.' } };
    const REFUSED = 'Permission to use SendMessage has been denied.';
    let seq = 0;
    const row = (direction: JournalRow['direction'], ms: number, frame: unknown): JournalRow => ({ seq: (seq += 1), direction, at: at(ms), frame });
    const message = (ms: number, id: string, content: unknown[]) => row('in', ms, {
      type: 'assistant', message: { model: 'claude-test', id, type: 'message', role: 'assistant', content, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
      parent_tool_use_id: null, uuid: `a-${id}`, timestamp: at(ms), session_id: SESSION,
    });
    const journal = [
      row('meta', 0, { event: 'spawn', pid: 4101, cwd: '/tmp/maws-synth-routes', bin: 'claude', args: ['-p'] }),
      row('out', 10, { type: 'user', uuid: 'u-routes-2', message: { role: 'user', content: PROMPT }, parent_tool_use_id: null, origin: { kind: 'human' } }),
      row('in', 20, { type: 'command_lifecycle', command_uuid: 'u-routes-2', state: 'started', uuid: 'cl-routes-2', session_id: SESSION }),
      row('in', 30, { type: 'system', subtype: 'init', cwd: '/tmp/maws-synth-routes', model: 'claude-test', permissionMode: 'default', tools: [], slash_commands: [], agents: [], skills: [], plugins: [], mcp_servers: [], capabilities: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'sys-routes-2', session_id: SESSION }),
      message(40, 'msg_routes_send', [{ type: 'tool_use', ...call }]),
      row('in', 50, {
        type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, content: REFUSED, is_error: true }] }, parent_tool_use_id: null, uuid: 't-routes-send', timestamp: at(50),
        tool_use_result: `Error: ${REFUSED}`, tool_result_meta: [{ id: call.id, non_execution_kind: 'permission-rule' }], session_id: SESSION,
      }),
      message(60, 'msg_routes_after', [{ type: 'text', text: 'I could not send it.' }]),
      row('meta', 70, { event: 'exit', code: 0, signal: null, peakRSSKiB: 1, peakTreeRSSKiB: 1 }),
    ];
    const text = fileOf([
      prompt('h-1', null, 10, PROMPT),
      assistantRecord('h-2', 'h-1', 40, 'msg_routes_send', call),
      resultRecord('h-3', 'h-2', 50, call.id, REFUSED, 'permission-rule'),
      { type: 'assistant', uuid: 'h-4', parentUuid: 'h-3', timestamp: at(60), sessionId: SESSION, message: { id: 'msg_routes_after', role: 'assistant', model: 'claude-test', content: [{ type: 'text', text: 'I could not send it.' }] } },
      prompt('h-5', 'h-4', 90_000, 'Carry on.'),
    ]);
    const routes = { live: fromJournal(journal), file: await fromFile(text), link: await fromRows(text) };
    for (const [route, events] of Object.entries(routes)) {
      const state = applyEvents(createState(null, null), events);
      const send = rowsOf(withAllExpanded(state)).find((r): r is Extract<Row, { kind: 'agent_message' }> => r.kind === 'agent_message');
      expect(send?.direction, route).toBe('between');
      const line = rowsOf(state).find((r): r is Extract<Row, { kind: 'divider' }> => r.kind === 'divider' && r.turnId === send!.turnId)!;
      expect(line.expanded, route).toBe(false);
      expect(rowsOf(state).some((r) => r.id === send!.id), `${route}: the folded turn hides the send's row`).toBe(false);
      expect({ denied: line.denied, caption: line.caption, firstDeniedCell: line.firstDeniedCell, denials: line.summary.denials.map((d) => [d.kind, d.disposition]) }, route)
        .toEqual({ denied: 1, caption: '', firstDeniedCell: send!.id, denials: [['permission-rule', 'denied']] });
    }
  });
});
