// The routes agree (UX wave U2, first landing; the U2a execution document, Interfaces §F and Acceptance 1, 6, 10 and 11;
// the wave's law 5): on what M1 makes a file say as the wire does (a thought's recorded duration, and a refused call's
// kind and reading), on what a row reads (M3), and, at the end (M5), on each recording's whole drawing, compared at rest
// (through `restingRows`) because that is what a person sees: every window draws a session at rest so. One recorded
// session is drawn from its journal as a session MAWS runs draws it (the journal through the engine host's
// `Normalizer`), from its transcript file as the chain follower answers `session.events` for it on this Mac, and from the
// same rows as another machine sends them (`freshSource`). It lives beside U3a's `arrival-routes.test.ts` and not in the
// transcript's model, for the reason that test gives: the node project typechecks the model's directory, and the graph
// of the reader of another machine's rows is the renderer's. The three readers are written again here because that test
// exports none.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JsonObject } from 'desk-hub/protocol';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, ParentToolUseId, SessionId } from '@shared/graph/ids';
import type { JournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR, FIXTURE_PASSES, listEventFixtures, listJournals, listSyntheticJournals, loadEventFixture, loadJournal, loadSyntheticJournal, loadUxwaveJournal, TRANSCRIPT_FIXTURE_DIR } from '../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../test/support/memory-reader';
import { synthesise } from '../../../../test/support/synth-transcript';
import { journalToEvents } from '../transcript/dev/journal';
import { restingRows, rowsOf, withAllExpanded } from '../transcript/model/derive';
import { applyEvents, createState, type TranscriptState } from '../transcript/model/reduce';
import type { Cell, Row } from '../transcript/model/rows';
import { freshSource, subagentLookupOf } from './plane-transcript';
import { descriptionLabel, dividerCopy, lineCountsCopy, thinkingLabel } from '../transcript/model/copy';
import { captionParts, stepsOfCells } from '../transcript/model/caption';
import { presentationOf, stoppedMember } from '../transcript/model/classify';
import { collectCells, runSegments } from '../transcript/model/groups';
import { shellLabel } from '../transcript/view/cells/CellLine';

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

  it('steer-next-interrupted: the shell call reads stopped (`Stopped a command`) on all three, and the turn the Stop cut reads stopped with no denied count', async () => {
    for (const { route, events, rows } of await routes('steer-next-interrupted', 'w1-steer-next-interrupted')) {
      expect(rejectedResults(events), route).toEqual(['toolu_018A2pQ8opsSUGLt6bscFJ4R user-rejected']);
      // from M3 the stopped row names the short command, and `echo` is no command Desktop's rule shows: the fallback
      expect(refusedCalls(rows), route).toEqual(['stopped stopped: Stopped a command']);
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

// The branch review's first finding: a child agent's own transcript, drawn as its drill-in draws it by each route. Live,
// the child's events are the session's journal through the normaliser, selected as the child source selects them (its
// agent's events, but the parent's reports on it); from the file, the child's own transcript through a chain follower
// that has the child's context, as `fs.agentEvents` follows it; through the file's rows, the reader of another machine's
// rows with the child's id. The child's events keep the attribution each route gives them (the call that launched it,
// live and from the file). A rejected call the child went on from reads denied, and its turn, whose end nobody sees,
// closes at rest as no Stop.
describe('a rejected call a child agent went on from reads denied by every route, and its turn is no Stop', () => {
  const at = (ms: number) => new Date(Date.parse('2026-09-28T12:00:00.000Z') + ms).toISOString();
  const CHILD = 'a7c1d2e3f4a5b6c7d';
  const LAUNCH = 'toolu_routes_launch';
  const PUSH = { type: 'tool_use', id: 'toolu_routes_child_push', name: 'Bash', input: { command: 'git push --force' } };
  const REFUSED = 'The user doesn’t want to proceed with this tool use.';
  const AFTER = [{ type: 'text', text: 'Leaving the push to you.' }];
  const own = (event: SessionEvent) => (event.agentId as string | null) === CHILD && !('taskId' in event && (event.taskId as string | null) === CHILD); // `ownOf`, transcript/source/ipc.ts

  let seq = 0;
  const row = (direction: JournalRow['direction'], ms: number, frame: unknown): JournalRow => ({ seq: (seq += 1), direction, at: at(ms), frame });
  const message = (ms: number, id: string, content: unknown[], lane: string | null) => row('in', ms, {
    type: 'assistant', message: { model: 'claude-test', id, type: 'message', role: 'assistant', content, stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 1 } },
    parent_tool_use_id: lane, uuid: `a-${id}`, timestamp: at(ms), session_id: SESSION,
  });
  const journal = [
    row('meta', 0, { event: 'spawn', pid: 4102, cwd: '/tmp/maws-synth-routes', bin: 'claude', args: ['-p'] }),
    row('out', 10, { type: 'user', uuid: 'u-routes-3', message: { role: 'user', content: 'Have an agent publish the branch.' }, parent_tool_use_id: null, origin: { kind: 'human' } }),
    row('in', 20, { type: 'command_lifecycle', command_uuid: 'u-routes-3', state: 'started', uuid: 'cl-routes-3', session_id: SESSION }),
    row('in', 30, { type: 'system', subtype: 'init', cwd: '/tmp/maws-synth-routes', model: 'claude-test', permissionMode: 'default', tools: [], slash_commands: [], agents: [], skills: [], plugins: [], mcp_servers: [], capabilities: [], claude_code_version: '2.1.322', output_style: 'default', uuid: 'sys-routes-3', session_id: SESSION }),
    message(40, 'msg_routes_launch', [{ type: 'tool_use', id: LAUNCH, name: 'Agent', input: { description: 'Publish the branch', prompt: 'Push the branch.' } }], null),
    row('in', 50, { type: 'system', subtype: 'task_started', task_id: CHILD, tool_use_id: LAUNCH, description: 'Publish the branch', subagent_type: 'general-purpose', is_backgrounded: false, spawn_depth: 1, task_type: 'local_agent', prompt: 'Push the branch.', uuid: 'sys-routes-task', session_id: SESSION }),
    message(60, 'msg_routes_child_1', [PUSH], LAUNCH),
    row('in', 70, {
      type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: PUSH.id, content: REFUSED, is_error: true }] }, parent_tool_use_id: LAUNCH, uuid: 't-routes-child-push', timestamp: at(70),
      tool_use_result: `Error: ${REFUSED}`, tool_result_meta: [{ id: PUSH.id, non_execution_kind: 'user-rejected' }], session_id: SESSION,
    }),
    message(80, 'msg_routes_child_2', AFTER, LAUNCH),
  ];
  const record = (uuid: string, parentUuid: string | null, ms: number, body: Record<string, unknown>) => ({ uuid, parentUuid, timestamp: at(ms), sessionId: SESSION, isSidechain: true, agentId: CHILD, ...body });
  const text = [
    record('c-1', null, 55, { type: 'user', message: { role: 'user', content: 'Push the branch.' } }),
    record('c-2', 'c-1', 60, { type: 'assistant', message: { id: 'msg_routes_child_1', role: 'assistant', model: 'claude-test', content: [PUSH] } }),
    record('c-3', 'c-2', 70, { type: 'user', toolDenialKind: 'user-rejected', toolUseResult: `Error: ${REFUSED}`, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: PUSH.id, content: REFUSED, is_error: true }] } }),
    record('c-4', 'c-3', 80, { type: 'assistant', message: { id: 'msg_routes_child_2', role: 'assistant', model: 'claude-test', content: AFTER } }),
  ].map((r) => JSON.stringify(r)).join('\n') + '\n';

  /** The file route: the child's own transcript, followed with the child's context (`fs.agentEvents`). */
  async function fromChildFile(): Promise<SessionEvent[]> {
    const events: SessionEvent[] = [];
    const follower = new ChainFollower(new MemoryFileReader(text), SESSION as SessionId, { agentId: CHILD as AgentId, parentToolUseId: LAUNCH as ParentToolUseId }, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
    await follower.start();
    follower.stop();
    return events;
  }

  it('the call reads denied, and at rest the child’s turn reads no Stop, live, from the file and from its rows', async () => {
    const routes = {
      live: fromJournal(journal).filter(own),
      file: await fromChildFile(),
      link: await freshSource(rowsIn(text), SESSION, subagentLookupOf([]), CHILD).snapshot(),
    };
    expect(routes.live.filter((e) => e.kind === 'tool.result').map((e) => [e.parentToolUseId, e.kind === 'tool.result' && e.denial]), 'the wire names the launching call').toEqual([[LAUNCH, 'user-rejected']]);
    expect(routes.file.filter((e) => e.kind === 'tool.result').map((e) => [e.parentToolUseId, e.kind === 'tool.result' && e.denial]), 'the file’s context names it too').toEqual([[LAUNCH, 'user-rejected']]);
    for (const [route, events] of Object.entries(routes)) {
      const state = withAllExpanded(applyEvents(createState(null, CHILD as AgentId), events));
      const rows = rowsOf(state);
      const call = callsOf(rows).find((cell) => cell.toolUseId === PUSH.id);
      expect(call && { status: call.status, disposition: call.classification.denial?.disposition }, route).toEqual({ status: 'denied', disposition: 'denied' });
      const line = restingRows(state, rows).find((r): r is Extract<Row, { kind: 'divider' }> => r.kind === 'divider');
      expect(line && { state: line.state, denied: line.denied }, `${route}, at rest`).toEqual({ state: 'completed', denied: 1 });
    }
  });
});

// UX wave U2, M3 (O-49, l6-artifacts-12; acceptance 10 and 11): what a row reads is the same by every route. A shell call
// that gave a description reads it live, from the file and through the file's rows, and the test fails if any row falls
// back to the command; an artifact call reads the same words, and its run the same caption, from the journal and from
// the file.
describe('what a row reads is the same by every route (M3)', () => {
  it('u3-tasks-r1: every shell row reads its description, by each route', async () => {
    const text = readFileSync(join(FIXTURE_DIR, 'uxwave', 'u3-tasks-r1.transcript.jsonl'), 'utf8');
    const routes = { live: drawn(fromJournal(loadUxwaveJournal('u3-tasks-r1'))), file: drawn(await fromFile(text)), link: drawn(await fromRows(text)) };
    const described = (rows: Row[]) => callsOf(rows).filter((cell) => cell.toolName === 'Bash').map((cell) => {
      const description = cell.detail.kind === 'shell' ? cell.detail.description : null;
      return { call: cell.toolUseId, description, reads: shellLabel(cell) === descriptionLabel(description ?? '', cell.status) };
    });
    const live = described(routes.live);
    expect(live.length).toBeGreaterThan(0);
    for (const [route, rows] of Object.entries(routes)) {
      const shell = described(rows);
      expect(shell.every((row) => row.description !== null && row.description.trim() !== '' && row.reads), route).toBe(true);
      expect(shell.map(({ call, description }) => ({ call, description })), route).toEqual(live.map(({ call, description }) => ({ call, description })));
    }
  });

  it('p1-maws-artifacts: the artifact calls read the same words, and their runs the same captions, from the journal and from the file', async () => {
    const text = readFileSync(join(TRANSCRIPT_FIXTURE_DIR, 'p1-maws-artifacts.jsonl'), 'utf8');
    const routes = { live: drawn(fromJournal(loadJournal('pass3', 'p1-maws-artifacts'))), file: drawn(await fromFile(text)), link: drawn(await fromRows(text)) };
    const read = (rows: Row[]) => ({
      calls: callsOf(rows).filter((cell) => cell.toolName.startsWith('mcp__maws__')).map((cell) => [cell.toolName, cell.status, cell.label, cell.error ?? null]),
      runs: rows.flatMap((row) => (row.kind === 'group' ? [row.summary] : [])),
    });
    const live = read(routes.live);
    expect(live.calls).toEqual([
      ['mcp__maws__artifact_screenshot', 'done', 'Screenshot of Dashboard v1 (64 × 64)', null],
      ['mcp__maws__artifact_list', 'done', 'Listed 1 artifact', null],
    ]);
    expect(read(routes.file), 'the file').toEqual(live);
    expect(read(routes.link), 'the file’s rows').toEqual(live);
  });
});

// UX wave U2a, M5 (Interfaces §F, the proof whole; Acceptance 1): each recording's whole drawing, by every route that
// can draw it, compared row by row. What is compared is what the window draws of the work: every run (its state, its
// caption, its line counts and how its opened body falls into blocks of calls and thought lines), every call (where it
// is drawn, its block and its place in it, its label as its row reads it, its reason and its status), every thought
// line inside a run (its label and whether it opens), every thought's row outside one, and every turn's line (its
// state, its origin and its words, the duration read as 0). A turn's line is named by the first row of its turn that
// every route names alike (an assistant block, a call or a run: their ids are the engine's), because an engine's turn
// has an id of the route's own (the journal's position on the live route, the record's uuid from the file). Every row
// that differs is listed as `route row field: the first route's → this route's`; a row one route draws and another does
// not is listed by the field `drawn`.
type Fields = Record<string, string>;
const callFields = (cell: Cell): Fields => ({ label: cell.detail.kind === 'shell' ? shellLabel(cell) : cell.label, reason: cell.error ?? '', status: cell.status });
const NAMED_ALIKE = new Set<Row['kind']>(['assistant_text', 'thinking', 'cell', 'group']);

function drawing(rows: Row[]): Map<string, Fields> {
  const out = new Map<string, Fields>();
  const anchors = new Map<string, string>();
  for (const row of rows) if (row.turnId !== null && NAMED_ALIKE.has(row.kind) && !anchors.has(row.turnId)) anchors.set(row.turnId, row.id);
  for (const row of rows) {
    if (row.kind === 'divider') {
      out.set(`turn line of ${anchors.get(row.turnId!) ?? row.id}`, { kind: 'turn line', state: row.state, origin: row.origin, words: dividerCopy({ ...row, durationMs: 0 }) });
    } else if (row.kind === 'group') {
      const segments = runSegments(row.cells, row.state === 'active');
      out.set(row.id, { kind: 'run', state: row.state, caption: row.summary, counts: lineCountsCopy(row.counts), body: segments.map((segment) => (segment.kind === 'calls' ? `${segment.cells.length} calls` : 'thought')).join(', ') });
      segments.forEach((segment, i) => {
        if (segment.kind === 'calls') segment.cells.forEach((cell, n) => out.set(cell.id, { kind: 'call', in: `${row.id} block ${i} call ${n}`, ...callFields(cell) }));
        else out.set(segment.id, { kind: 'thought line', in: `${row.id} block ${i}`, label: thinkingLabel(false, segment.recordedMs), opens: String(segment.text !== '') });
      });
    } else if (row.kind === 'cell') {
      out.set(row.id, { kind: 'call', in: 'its own row', ...callFields(row) });
    } else if (row.kind === 'thinking') {
      out.set(row.id, { kind: 'thought', label: thinkingLabel(row.live, row.durationMs), opens: String(row.text !== '') });
    }
  }
  return out;
}

const shown = (fields: Fields | undefined) => (fields === undefined ? 'no' : Object.values(fields).join(' · '));
// A route's rows at rest, as the windows draw them (`TranscriptSlot` and `RemoteTranscriptSlot` pass `atRest`; the
// transcript and lane A's drawn rows go through `restingRows`): an open last turn closed as an unseen exit would.
function atRest(events: SessionEvent[]): Row[] {
  const state = withAllExpanded(applyEvents(createState(null, null), events));
  return restingRows(state, rowsOf(state));
}

function differences(routes: Record<string, SessionEvent[]>): string[] {
  const [[, reference], ...others] = Object.entries(routes).map(([route, events]) => [route, drawing(atRest(events))] as const);
  return others.flatMap(([route, other]) => [...new Set([...reference.keys(), ...other.keys()])].flatMap((row) => {
    const a = reference.get(row);
    const b = other.get(row);
    if (a === undefined || b === undefined) return [`${route} ${row} drawn: ${shown(a)} → ${shown(b)}`];
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((field) => a[field] !== b[field]).map((field) => `${route} ${row} ${field}: ${a[field]} → ${b[field]}`);
  }));
}

const UXWAVE = join(FIXTURE_DIR, 'uxwave');
const textOf = (dir: string, name: string) => readFileSync(join(dir, `${name}.jsonl`), 'utf8');
const threeRoutes = async (journal: JournalRow[], text: string) => ({ live: fromJournal(journal), file: await fromFile(text), link: await fromRows(text) });
const twoRoutes = async (text: string) => ({ file: await fromFile(text), link: await fromRows(text) });
/** A probe journal's own transcript file, as its `jsonl_snapshot` row carries it. */
const snapshotText = (rows: JournalRow[], label: string) => {
  const frame = rows.find((row) => row.direction === 'meta' && (row.frame as { event?: unknown }).event === 'jsonl_snapshot' && (row.frame as { label?: unknown }).label === label)!.frame as { records: unknown[] };
  return `${frame.records.map((record) => JSON.stringify(record)).join('\n')}\n`;
};

// The recordings of §F, each by every route that can draw it: the live route where a journal exists, the file's two
// routes always. The terminal sessions have no journal (their files are what a terminal session on this Mac and on
// another machine draw); `u3-terminal-cron-r1` is also read cut at its first fire row (line 50, its meta row not
// written), as U3a's routes test reads it.
const RECORDINGS: Record<string, () => Promise<Record<string, SessionEvent[]>>> = {
  'uxwave/u3-tasks-r1': () => threeRoutes(loadUxwaveJournal('u3-tasks-r1'), textOf(UXWAVE, 'u3-tasks-r1.transcript')),
  'uxwave/u3-tasks-r2': () => threeRoutes(loadUxwaveJournal('u3-tasks-r2'), textOf(UXWAVE, 'u3-tasks-r2.transcript')),
  'uxwave/u3-cron-r1': () => threeRoutes(loadUxwaveJournal('u3-cron-r1'), textOf(UXWAVE, 'u3-cron-r1.transcript')),
  'pass3/p1-maws-artifacts': () => threeRoutes(loadJournal('pass3', 'p1-maws-artifacts'), textOf(TRANSCRIPT_FIXTURE_DIR, 'p1-maws-artifacts')),
  'pass3/steer-next-interrupted': () => threeRoutes(loadJournal('pass3', 'steer-next-interrupted'), textOf(TRANSCRIPT_FIXTURE_DIR, 'w1-steer-next-interrupted')),
  'pass3/p1-maws-ask-interrupt': () => threeRoutes(loadJournal('pass3', 'p1-maws-ask-interrupt'), textOf(TRANSCRIPT_FIXTURE_DIR, 'p1-maws-ask-interrupt')),
  'pass3/p1-side-thread-live, with the file its snapshot holds': () => {
    const journal = loadJournal('pass3', 'p1-side-thread-live');
    return threeRoutes(journal, snapshotText(journal, 'side-thread-parent'));
  },
  'uxwave/u3-sminos-r1-terminal': () => twoRoutes(textOf(UXWAVE, 'u3-sminos-r1-terminal.transcript')),
  'uxwave/u3-terminal-checkin-r1': () => twoRoutes(textOf(UXWAVE, 'u3-terminal-checkin-r1.transcript')),
  'uxwave/u3-terminal-cron-r1': () => twoRoutes(textOf(UXWAVE, 'u3-terminal-cron-r1.transcript')),
  'uxwave/u3-terminal-cron-r1, cut at its first fire row': () => twoRoutes(`${textOf(UXWAVE, 'u3-terminal-cron-r1.transcript').split('\n').slice(0, 50).join('\n')}\n`),
};

// One difference between routes, named: a turn a monitor's event opened (the U2a document, Reported 10's visible cost;
// the architect's ruling on M5). The live wire carries no monitor event, so on that route the turn only answers and has
// no line (a turn with nothing under it has none), while the file and its rows, which carry the event, draw the
// engine's `Continued for …`. Listed row by row, the turns by their first text; the exception ends when the live wire
// carries the monitor's event.
const monitorTurns = (...texts: string[]) => ['file', 'link'].flatMap((route) => texts.map((text) => `${route} turn line of text:${text}:0 drawn: no → turn line · completed · engine · Continued for 0s`));
const MONITOR_TURN: Record<string, string[]> = {
  'uxwave/u3-tasks-r1': monitorTurns('msg_011CgyEGFdZPRJDtCKFTFsDV', 'msg_011CgyEGnD5hvk8b2VcZ7Anw', 'msg_011CgyEH889fq8Wpv37JEgAX'),
  'uxwave/u3-tasks-r2': monitorTurns('msg_011CgyF4rjii1Qw8FZtavENQ', 'msg_011CgyF5PZNQZn5q9eeR5ma6', 'msg_011CgyF5xhvBxUobnikmA5JM'),
};

describe('the whole drawing at rest is the same by every route, but for the monitor\'s turn (§F, the proof whole)', () => {
  for (const [name, routes] of Object.entries(RECORDINGS)) {
    it(name, async () => {
      expect(differences(await routes())).toEqual(MONITOR_TURN[name] ?? []);
    });
  }
});

// The same file's second proof (§F): over every session the snapshot suite walks, which exist in one form only, each
// drawn turn is whole. Every call the turn drew as a call before is drawn in exactly one place (a block of one run, or
// a row of its own), in the order the engine made the calls; a run's parts count exactly its calls (a refused call that
// stands alone is in no run); a folded run and the same run opened name the same calls; no two thought lines of a run
// are adjacent; and no row is drawn twice. What stands against the rows the same events gave before this landing is the
// snapshot diff's, read once at M5 (the report's account); this proof is what makes that diff evidence.
const SESSIONS: Record<string, () => SessionEvent[]> = {
  ...Object.fromEntries(FIXTURE_PASSES.flatMap((pass) => listJournals(pass).map((name) => [`${pass}/${name}`, () => journalToEvents(loadJournal(pass, name))] as const))),
  ...Object.fromEntries(listSyntheticJournals().map((name) => [`transcript/${name}`, () => journalToEvents(loadSyntheticJournal(name))] as const)),
  ...Object.fromEntries(listEventFixtures().map((name) => [`events/${name}`, () => loadEventFixture(name)] as const)),
  'synthetic/500': () => synthesise({ turns: 500, seed: 1 }),
};

/** The state's rows with every turn open and every run folded: what a reader sees before opening a run. */
const runsFolded = (state: TranscriptState): Row[] => rowsOf({ ...state, ui: { ...withAllExpanded(state).ui, expandedGroups: new Set(), expandedCells: new Set() } });

function wholeness(events: SessionEvent[]): string[] {
  const state = applyEvents(createState(null, null), events);
  const opened = rowsOf(withAllExpanded(state));
  const folded = new Map(runsFolded(state).flatMap((row) => (row.kind === 'group' ? [[row.id, row.cells.map((cell) => cell.id)] as const] : [])));
  const found: string[] = [];
  const seen = new Set<string>();
  for (const row of opened) {
    if (seen.has(row.id)) found.push(`${row.id}: drawn twice`);
    seen.add(row.id);
  }
  for (const id of [...state.order, ...(state.hidden?.turns ?? [])]) {
    const turn = state.turns.get(id);
    if (!turn) continue;
    const made = [...new Set(turn.events.flatMap((event) => (event.kind === 'tool.use' && presentationOf(event.toolName) === 'cell' ? [event.toolUseId as string] : [])))];
    const drawnCalls = collectCells(opened.filter((row) => row.turnId === id)).flatMap((cell) => (cell.toolUseId === null ? [] : [cell.toolUseId as string]));
    if (drawnCalls.join(' ') !== made.join(' ')) found.push(`${id}: calls made ${made.join(',')} but drawn ${drawnCalls.join(',')}`);
  }
  for (const row of opened) {
    if (row.kind !== 'group') continue;
    const calls = row.cells.filter((cell) => cell.toolName !== 'thinking');
    const counted = captionParts(stepsOfCells(row.cells)).reduce((sum, part) => sum + part.calls, 0);
    if (counted !== calls.length) found.push(`${row.id}: its parts count ${counted} calls of ${calls.length}`);
    if (calls.some((cell) => cell.classification.denial !== null && !stoppedMember(cell.classification.denial))) found.push(`${row.id}: holds a refused call that stands alone`);
    const named = folded.get(row.id);
    if (named === undefined || named.join(' ') !== row.cells.map((cell) => cell.id).join(' ')) found.push(`${row.id}: folded it names ${named?.join(',') ?? 'nothing'}`);
    const kinds = runSegments(row.cells, row.state === 'active').map((segment) => segment.kind);
    if (kinds.some((kind, i) => kind === 'thought' && kinds[i - 1] === 'thought')) found.push(`${row.id}: two thought lines adjacent`);
  }
  return found;
}

// What a session drew wrong before this landing as after it, the same at the base (b513add6f) and on master 5c9cfa0c5;
// not this landing's to move.
const BEFORE_THIS_LANDING: Record<string, string[]> = {
  // the subagent row of the child the relay woke is drawn twice in its turn (the tracker's row, U2a's record)
  'pass3/relay-to-child': ['subagent:accea5ba03e220b64: drawn twice'],
};

describe('every session the snapshot suite walks draws each turn whole (§F, the second proof)', () => {
  for (const [name, events] of Object.entries(SESSIONS)) {
    it(name, () => {
      expect(wholeness(events())).toEqual(BEFORE_THIS_LANDING[name] ?? []);
    });
  }
});
