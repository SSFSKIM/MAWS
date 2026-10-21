// P4-R7: a message tool's call drawn as the to-human message it sends (derive.ts's `to_human` row), at the call's place
// among the turn's rows; a call that sent nothing stays the engine's own cell. MAWS reads its own tool alone: a call of
// the to-human plugin's tool of the same shape is the ordinary MCP cell it is (the owner's ruling of 2026-10-21), unless
// the host names that tool too (the transcript source's `messageTools`, as the desk's sources do). The recorded P4-R7
// sessions (spikes/protocol-probe/fixtures/p4/p4-r7-*-stages.jsonl, engine 2.1.304) pin the same rows read from disk,
// as C4 backfills a transcript, and from the wire, through the live normaliser.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, SessionId } from '@shared/graph/ids';
import { parseJournalRow, type JournalRow } from '@shared/wire/journal';
import { ChainFollower } from '../../../../engine-host/fs/chain-follower';
import { FIXTURE_DIR } from '../../../../../test/support/fixtures';
import { MemoryFileReader } from '../../../../../test/support/memory-reader';
import { journalToEvents } from '../dev/journal';
import { isPersistentRow, rowsOf, turnPhrases, turnSummary, withAllExpanded } from './derive';
import { rowId, turnId } from './keys';
import { applyEvents, createState, withUi, type TranscriptState } from './reduce';
import type { Row } from './rows';
import { BASH_RESULT, builder, parent, task, tool, uuid, type Builder } from './test-events';

type RowOf<K extends Row['kind']> = Extract<Row, { kind: K }>;
const ofKind = <K extends Row['kind']>(rows: Row[], kind: K) => rows.filter((row): row is RowOf<K> => row.kind === kind);
const reduce = (events: SessionEvent[], agentId: AgentId | null = null) => applyEvents(createState(null, agentId), events);
// A host that reads the to-human plugin's message tool too, as the desk does (its sources' `messageTools`).
const BOTH = ['mcp__maws__message', 'mcp__to-human__message'];
const reduceReadingBoth = (events: SessionEvent[]) => applyEvents(createState(null, null, BOTH), events);
// The session's owner-channel lane on, as the store sets it (a new ui version, every turn re-derived).
const laneOn = (state: TranscriptState) => withUi(state, { ...state.ui, ownerLane: true, version: state.ui.version + 1, global: state.ui.global + 1 });
const expanded = (state: TranscriptState) => rowsOf(withAllExpanded(state));
const folded = (state: TranscriptState) => rowsOf(state);
const kinds = (rows: Row[]) => rows.filter((row) => row.kind !== 'time').map((row) => row.kind);
const allCells = (rows: Row[]) => rows.flatMap((row) => (row.kind === 'group' ? row.cells : row.kind === 'cell' ? [row] : []));

const MAWS = 'mcp__maws__message';
const PLUGIN = 'mcp__to-human__message';
const SENT = [{ type: 'text', text: 'sent' }];
const T1 = turnId.ofMessage(uuid('u1'));

// The probe's shape: a status before the next command goes through the tool, in the same response as that command.
function stagesTurn(name: string, b: Builder = builder()) {
  b.turn('u1');
  b.text('a1', 0, 'Looking first. <message>Starting the stages.</message>');
  b.toolUse('t1', 'Bash', { command: 'sh stage.sh 1' }, 'a2', 0);
  b.result('t1', 'stage 1/2', { structured: BASH_RESULT('stage 1/2') });
  b.toolUse('m1', name, { text: 'Stage 1 is done: **37** labels missing.' }, 'a3', 0);
  b.result('m1', SENT);
  b.toolUse('t2', 'Bash', { command: 'sh stage.sh 2' }, 'a3', 1);
  b.result('t2', 'stage 2/2', { structured: BASH_RESULT('stage 2/2') });
  b.text('a4', 0, '<message>Both stages ran.</message>');
  b.end(['u1']);
  return b;
}

describe('a message tool’s call', () => {
  it('draws the message where the call sits, between the turn’s other rows, and no cell', () => {
    const b = stagesTurn(MAWS);
    const rows = expanded(reduce(b.events));
    expect(kinds(rows)).toEqual(['user', 'divider', 'assistant_text', 'cell', 'to_human', 'cell', 'assistant_text']);
    const call = b.events.find((event) => event.kind === 'tool.use' && event.toolUseId === 'm1')!;
    expect(ofKind(rows, 'to_human')).toEqual([{ id: rowId.toHuman(tool('m1')), turnId: T1, at: call.at, kind: 'to_human', toolUseId: 'm1', text: 'Stage 1 is done: **37** labels missing.', pending: false }]);
    expect(allCells(rows).map((cell) => cell.toolName)).toEqual(['Bash', 'Bash']);
    // a call is work: the text before it is commentary, the text after the last call the answer
    expect(ofKind(rows, 'assistant_text').map((row) => row.phase)).toEqual(['commentary', 'answer']);
  });

  it('waiting for its result in an open turn, it is the message about to be sent, and keeps its row once sent', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('m1', MAWS, { text: 'Heading into stage 2.' });
    const [waiting] = ofKind(expanded(reduce(b.events)), 'to_human');
    expect(waiting).toMatchObject({ id: rowId.toHuman(tool('m1')), pending: true, text: 'Heading into stage 2.' });
    b.result('m1', SENT);
    const [sent] = ofKind(expanded(reduce(b.events)), 'to_human');
    expect(sent).toMatchObject({ id: waiting.id, pending: false });
  });

  it('that sent nothing is the engine’s cell: a refused or failed result, no text, or a turn that closed before its result', () => {
    const cellsOf = (build: (b: Builder) => void) => {
      const b = builder();
      b.turn('u1');
      build(b);
      const rows = expanded(reduce(b.events));
      expect(ofKind(rows, 'to_human')).toEqual([]);
      return allCells(rows).map((cell) => [cell.toolUseId, cell.toolName, cell.status]);
    };
    expect(cellsOf((b) => {
      b.toolUse('m1', MAWS, { text: 'Stage 1 is done.' });
      b.result('m1', 'MCP error: the server went away', { isError: true });
    })).toEqual([['m1', MAWS, 'error']]);
    expect(cellsOf((b) => {
      b.toolUse('m1', MAWS, { text: 'Stage 1 is done.' });
      b.result('m1', "The user doesn't want to proceed with this tool use.", { isError: true, denial: 'user-rejected' });
    })).toEqual([['m1', MAWS, 'denied']]);
    expect(cellsOf((b) => b.toolUse('m1', MAWS, { text: '  \n' }))).toEqual([['m1', MAWS, 'running']]);
    expect(cellsOf((b) => {
      b.toolUse('m1', MAWS, {});
      b.result('m1', 'message: invalid arguments: text: the message is empty', { isError: true });
    })).toEqual([['m1', MAWS, 'error']]);
    expect(cellsOf((b) => {
      b.toolUse('m1', MAWS, { text: 'Stage 1 is done.' });
      b.end(['u1'], { terminalReason: 'aborted_tools' });
    })).toEqual([['m1', MAWS, 'stopped']]);
  });

  it('is no tool call of its turn once accepted; a refused one is, as any refused call', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('m1', MAWS, { text: 'Stage 1 is done.' });
    b.result('m1', SENT);
    b.toolUse('t1', 'Bash', { command: 'sh stage.sh 2' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.toolUse('m2', MAWS, { text: 'Stage 2 is done.' });
    b.result('m2', 'MCP error: the server went away', { isError: true });
    b.text('a1', 0, 'Done.');
    b.end(['u1']);
    const state = reduce(b.events);
    expect(ofKind(expanded(state), 'divider')[0]).toMatchObject({ toolCalls: 2 });
    expect(turnSummary(state.turns.get(T1)!)).toMatchObject({ toolCalls: 2, byCategory: { commands: 1, mcp: 1 } });
  });

  // A message is always addressed to the human, as a `<message>` span is (the presenter draws a span with the lane off
  // and so keeps it), so it stays in view when the work folds whatever the owner lane says.
  it.each([['on', true], ['off', false]])('stays in view in a closed turn whose work folds, the lane %s', (_, lane) => {
    const b = builder();
    b.turn('u1');
    b.text('a1', 0, 'Looking first.');
    b.toolUse('m1', MAWS, { text: 'Stage 1 is done.' }, 'a2', 0);
    b.result('m1', SENT);
    b.toolUse('t1', 'Bash', { command: 'sh stage.sh 2' }, 'a2', 1);
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('a3', 0, 'Done.');
    b.end(['u1']);
    const state = lane ? laneOn(reduce(b.events)) : reduce(b.events);
    const rows = folded(state);
    expect(kinds(rows)).toEqual(['user', 'divider', 'to_human', 'assistant_text']);
    expect(ofKind(rows, 'divider')[0]).toMatchObject({ state: 'completed', expanded: false });
    const [message] = ofKind(rows, 'to_human');
    expect(message).toMatchObject({ toolUseId: 'm1', text: 'Stage 1 is done.', pending: false });
    expect(isPersistentRow(message)).toBe(true);
  });

  // A subagent's text draws in its own transcript and never in its parent's (the parent shows the agent's row); its
  // message call does the same.
  it('a subagent’s call draws in the subagent’s transcript as its text does, and not in its parent’s', () => {
    const AGENT = 'agent-1' as AgentId;
    const b = builder();
    b.turn('u1');
    b.toolUse('a1', 'Agent', { description: 'Survey', prompt: 'p' });
    b.emit('subagent.started', { taskId: task('k1'), toolUseId: tool('a1'), description: 'Survey', subagentType: null, isBackground: false, spawnDepth: 1, prompt: null });
    const childFrom = b.events.length;
    const child = { parentToolUseId: parent('a1') };
    b.emit('assistant.block.complete', { messageUuid: uuid('c1-u0'), apiMessageId: 'c1' as never, blockIndex: 0, block: { type: 'text', text: 'Child looking.' }, model: 'm', supersedes: [], aborted: false, userMessageUuids: [] }, child);
    b.emit('tool.use', { toolUseId: tool('cm'), toolName: MAWS, input: { text: 'Child found it.' }, apiMessageId: 'c2' as never, messageUuid: uuid('c2-u0') }, child);
    b.emit('tool.result', { toolUseId: tool('cm'), content: SENT as never, isError: false, structured: null, spillPath: null, denial: null, safeguard: 'not_evaluated', messageUuid: uuid('cm-result') }, child);
    const childTo = b.events.length;
    b.emit('subagent.finished', { taskId: task('k1'), status: 'completed', summary: null, outputFile: null, reason: null });
    b.result('a1', 'Child found it.');
    b.text('m9', 0, 'Summary.');
    b.end(['u1']);
    const events = b.events.map((event, i) => (i >= childFrom && i < childTo ? { ...event, agentId: AGENT } : event));

    const parentRows = expanded(reduce(events));
    expect(kinds(parentRows)).toEqual(['user', 'divider', 'subagent', 'assistant_text']);
    expect(ofKind(parentRows, 'divider')[0]).toMatchObject({ toolCalls: 0 });

    const childState = reduce(events.slice(childFrom, childTo), AGENT);
    const childRows = expanded(childState);
    expect(ofKind(childRows, 'assistant_text').map((row) => row.markdown)).toEqual(['Child looking.']);
    expect(ofKind(childRows, 'to_human')).toMatchObject([{ toolUseId: 'cm', text: 'Child found it.', pending: false }]);
    // its running turn collapsed by the reader, the commentary folds and the message stays in view: a child transcript
    // has no owner lane, and a message is the human's without one
    const collapsed = withUi(childState, { ...childState.ui, collapsedTurns: new Set(childState.order), version: childState.ui.version + 1, global: childState.ui.global + 1 });
    expect(kinds(folded(collapsed))).toEqual(['divider', 'to_human']);
  });
});

// The owner's ruling of 2026-10-21: in MAWS the to-human plugin's tool is someone else's tool. A call to it, in a session
// whose lane was off or one that began outside MAWS, draws as the MCP row it is, sent or not; a host that reads it too
// (the desk, whose sessions message their owner through it) draws it as MAWS's own is drawn.
describe('a call of the to-human plugin’s message tool', () => {
  it('accepted, is the ordinary MCP cell it is, its turn’s tool call: no message', () => {
    const b = stagesTurn(PLUGIN);
    const state = reduce(b.events);
    const rows = expanded(state);
    expect(ofKind(rows, 'to_human')).toEqual([]);
    expect(allCells(rows).map((cell) => [cell.toolUseId, cell.toolName, cell.status, cell.classification.category])).toEqual([
      ['t1', 'Bash', 'done', 'commands'], ['m1', PLUGIN, 'done', 'mcp'], ['t2', 'Bash', 'done', 'commands'],
    ]);
    expect(ofKind(rows, 'divider')[0]).toMatchObject({ toolCalls: 3 });
    expect(turnSummary(state.turns.get(T1)!)).toMatchObject({ toolCalls: 3, byCategory: { commands: 2, mcp: 1 } });
  });

  it('waiting for its result in an open turn, is a running cell, not the message about to be sent', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('m1', PLUGIN, { text: 'Heading into stage 2.' });
    const rows = expanded(reduce(b.events));
    expect(ofKind(rows, 'to_human')).toEqual([]);
    expect(allCells(rows).map((cell) => [cell.toolUseId, cell.status])).toEqual([['m1', 'running']]);
  });

  it('a host reading it draws it as MAWS’s own: the message where the call sits, its turn’s summary and phrases without it', () => {
    const plugin = reduceReadingBoth(stagesTurn(PLUGIN).events);
    const maws = reduce(stagesTurn(MAWS).events);
    const read = (state: TranscriptState) => expanded(state).map((row) => (row.kind === 'cell' ? `${row.kind}:${row.toolName}` : row.kind === 'to_human' ? `to_human:${row.text}` : row.kind));
    expect(read(plugin)).toEqual(read(maws));
    expect(ofKind(expanded(plugin), 'to_human')).toMatchObject([{ toolUseId: 'm1', pending: false }]);
    expect(turnSummary(plugin.turns.get(T1)!, BOTH)).toEqual(turnSummary(maws.turns.get(T1)!));
    expect(turnPhrases(plugin.turns.get(T1)!, BOTH)).toBe(turnPhrases(maws.turns.get(T1)!));
    expect(turnPhrases(plugin.turns.get(T1)!)).not.toBe(turnPhrases(maws.turns.get(T1)!)); // MAWS's reading: one MCP call more
  });
});

// The probe's journals: the stream-json frames (`direction: "in"`) and, in a meta row `{event: "disk"}`, the session's
// transcript as the engine wrote it, reduced to its user and assistant records in file order with their blocks (a
// thinking block's words under `text`). The records it left out sat on the chain between a tool result and the next
// response, so a record whose parent is not kept is chained to the one before it.
// `as`: the message tool's name the calls carry instead of MAWS's (a renamed copy of the recorded session).
const journal = (name: string, as = MAWS): JournalRow[] =>
  readFileSync(join(FIXTURE_DIR, 'p4', `${name}.jsonl`), 'utf8').replaceAll(MAWS, as).split('\n').filter(Boolean).map((line) => parseJournalRow(JSON.parse(line)));
type DiskRecord = { type: 'user' | 'assistant'; uuid: string; parentUuid: string | null; messageId: string | null; blocks: Record<string, unknown>[] };
const SESSION = 'p4-r7-session';
function transcriptOf(rows: JournalRow[]): string {
  const disk = rows.find((row) => row.direction === 'meta' && (row.frame as { event?: unknown }).event === 'disk')!;
  const records = (disk.frame as { records: DiskRecord[] }).records;
  const kept = new Set(records.map((record) => record.uuid));
  return records
    .map((record, i) => {
      const content = record.blocks.map((block) => (block.type === 'thinking' ? { type: 'thinking', thinking: block.text, signature: '' } : block));
      const parentUuid = record.parentUuid === null || kept.has(record.parentUuid) ? record.parentUuid : records[i - 1].uuid;
      const message = record.type === 'assistant' ? { id: record.messageId, role: 'assistant', model: 'claude-opus-5-5', content } : { role: 'user', content };
      return `${JSON.stringify({ type: record.type, uuid: record.uuid, parentUuid, sessionId: SESSION, message })}\n`;
    })
    .join('');
}
// The transcript backfilled as C4 answers `session.events` for a session with no live process.
async function fromDisk(rows: JournalRow[]): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  const follower = new ChainFollower(new MemoryFileReader(transcriptOf(rows)), SESSION as SessionId, null, (e) => e.t === 'events' && events.push(...e.events), { holders: () => 0 });
  await follower.start();
  follower.stop();
  return events;
}
// What a reader sees of the turn's work and words, in order.
const reading = (rows: Row[]) =>
  rows.flatMap((row): string[] => {
    if (row.kind === 'to_human') return [`message: ${row.text}`];
    if (row.kind === 'assistant_text') return [`${row.phase}: ${row.markdown}`];
    if (row.kind === 'thinking') return [`thinking: ${row.text}`];
    if (row.kind === 'cell' || row.kind === 'group') return (row.kind === 'group' ? row.cells : [row]).map((cell) => (cell.toolName === 'thinking' && cell.detail.kind === 'thinking' ? `thinking: ${cell.detail.text}` : `${cell.toolName}: ${cell.status}`));
    return [];
  });

describe('the recorded P4-R7 sessions', () => {
  const STATUSES = [
    'Stage 1 of 4 is done. It indexed 1,240 call transcripts, and 37 of them are missing their speaker labels.',
    'Stage 2 of 4 is done. It restored 34 of the 37 missing labels from the audio. Calls 0412, 0977 and 1203 could not be restored and need a person to label them. Moving on to stage 3.',
    'Stage 3 of 4 is done. The classifier is trained. Accuracy on the held-out 10% is 91.4%, down from 93.0% last week, a drop of 1.6 points.',
  ];

  it('p4-r7-tool-stages from disk: the three statuses as messages in order between the four commands, the last word a span', async () => {
    const rows = expanded(reduce(await fromDisk(journal('p4-r7-tool-stages'))));
    const read = reading(rows);
    expect(read.slice(0, -1)).toEqual(['Bash: done', ...STATUSES.flatMap((status) => [`message: ${status}`, 'Bash: done'])]);
    expect(read.at(-1)).toMatch(/^answer: <message>Stage 4 of 4 is done, so the whole pipeline has run\./);
    expect(ofKind(rows, 'to_human').every((row) => !row.pending)).toBe(true);
    expect(ofKind(rows, 'divider')).toMatchObject([{ state: 'completed', toolCalls: 4 }]);
  });

  it('p4-r7-tool-stages from the wire: the same rows; each status a pending message until its result, the earlier ones sent', async () => {
    const rows = journal('p4-r7-tool-stages');
    const events = journalToEvents(rows);
    const live = expanded(reduce(events));
    expect(reading(live)).toEqual(reading(expanded(reduce(await fromDisk(rows)))));
    expect(ofKind(live, 'divider')).toMatchObject([{ state: 'completed', toolCalls: 4 }]);

    // each result arrives after the next command's block opened (the first status: its call at seq 84, the command's
    // block at seq 88, its result at seq 91), so the message waits through the start of the next call
    ofKind(live, 'to_human').forEach((message, i) => {
      const result = events.findIndex((event) => event.kind === 'tool.result' && event.toolUseId === message.toolUseId);
      const before = expanded(reduce(events.slice(0, result)));
      expect(ofKind(before, 'to_human').map((row) => [row.text, row.pending])).toEqual(STATUSES.slice(0, i + 1).map((status, j) => [status, j === i]));
      expect(ofKind(before, 'divider')).toMatchObject([{ state: 'working' }]);
    });
  });

  // The same session as if its calls were the to-human plugin's (each call renamed, nothing else): in MAWS every status
  // is the MCP cell its call is, from disk and from the wire; a host that reads the plugin's tool reads the messages.
  it('p4-r7-tool-stages under the plugin’s name, from disk and from the wire: each status an MCP cell and no message', async () => {
    const rows = journal('p4-r7-tool-stages', PLUGIN);
    const commands = ['Bash: done', ...STATUSES.flatMap(() => [`${PLUGIN}: done`, 'Bash: done'])];
    for (const events of [await fromDisk(rows), journalToEvents(rows)]) {
      const shown = expanded(reduce(events));
      expect(ofKind(shown, 'to_human')).toEqual([]);
      expect(reading(shown).filter((line) => line.endsWith(': done'))).toEqual(commands);
      expect(ofKind(shown, 'divider')).toMatchObject([{ state: 'completed', toolCalls: 7 }]);
      expect(reading(expanded(reduceReadingBoth(events)))).toEqual(reading(expanded(reduce(await fromDisk(journal('p4-r7-tool-stages'))))));
    }
  });

  // The same task without the tool: the status the model wrote after stage 2, before stage 3's command, came back as a
  // progress-update thinking block, a paraphrase without its `<message>` tags, so no reader shows it as a message.
  it('p4-r7-loss-stages: the lost status is a thinking block, from disk and from the wire, and no message', async () => {
    const rows = journal('p4-r7-loss-stages');
    for (const events of [await fromDisk(rows), journalToEvents(rows)]) {
      const shown = expanded(reduce(events));
      expect(ofKind(shown, 'to_human')).toEqual([]);
      const read = reading(shown);
      const lost = read.filter((line) => line.startsWith('thinking: '));
      expect(lost).toEqual([expect.stringMatching(/^thinking: Stage 2 restored 34 of the 37 missing labels/)]);
      expect(read.filter((line) => !line.startsWith('Bash') && !line.startsWith('thinking'))).toEqual([
        expect.stringMatching(/^commentary: <message>Stage 1 of 4 done/),
        expect.stringMatching(/^commentary: <message>Stage 3 of 4 done/),
        expect.stringMatching(/^answer: <message>All four stages have run/),
      ]);
    }
  });
});
