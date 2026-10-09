import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { rowsOf } from '../../transcript/model/derive';
import { rowId, turnId } from '../../transcript/model/keys';
import { applyEvents, createState, withUi, type TranscriptState, type TranscriptUi } from '../../transcript/model/reduce';
import type { Row } from '../../transcript/model/rows';
import { api, BASH_RESULT, builder, uuid } from '../../transcript/model/test-events';
import { liveMarkedRowIds, reportRows, reportViewOf } from './project';

const T1 = turnId.ofMessage(uuid('u1'));
const T2 = turnId.ofMessage(uuid('u2'));

// The session's state with the reader's ui changed as a store action would (a new version, every turn re-derived).
function stateOf(events: SessionEvent[], change: (ui: TranscriptUi) => Partial<TranscriptUi> = () => ({})): TranscriptState {
  const state = applyEvents(createState(null, null), events);
  const ui = { ...state.ui, ownerLane: true, ...change(state.ui) };
  return withUi(state, { ...ui, version: state.ui.version + 1, global: state.ui.global + 1 });
}
const kinds = (rows: readonly Row[]) => rows.map((row) => (row.kind === 'assistant_text' ? `text:${row.markdown}` : row.kind));
const project = (state: TranscriptState, live = '') => reportRows(rowsOf(state), state, state.ui, live);

// A marked turn: commentary with a message among unmarked words, a command, then an unmarked answer.
function markedTurn() {
  const b = builder();
  b.turn('u1');
  b.text('m1', 0, 'Looking first. <to-human>The plan is A.</to-human>');
  b.toolUse('t1', 'Bash', { command: 'ls' });
  b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
  b.text('m2', 0, 'All done, unmarked.');
  b.end(['u1']);
  return b;
}

describe('the report projection (the P2-C document, Design §7)', () => {
  it('level 0: the prompt, one closed working record counting the work, and the marks; everything else folded', () => {
    const state = stateOf(markedTurn().events);
    const rows = project(state);
    expect(kinds(rows)).toEqual(['time', 'user', 'owner_record', 'text:Looking first. <to-human>The plan is A.</to-human>']);
    expect(rows[2]).toEqual({ id: rowId.ownerRecord(T1), turnId: T1, at: rows[1].at, kind: 'owner_record', open: false, working: false, toolCalls: 1, messages: 2 });
  });

  it('level 1: the record opened shows the turn as the full transcript draws it folded, the record above it', () => {
    const state = stateOf(markedTurn().events, () => ({ reportOpenTurns: new Set([T1]) }));
    const rows = project(state);
    expect(kinds(rows)).toEqual(['time', 'user', 'owner_record', 'divider', 'text:Looking first. <to-human>The plan is A.</to-human>', 'text:All done, unmarked.']);
    expect(rows[2]).toMatchObject({ open: true });
    expect(rows[3]).toMatchObject({ kind: 'divider', expanded: false });
  });

  it('level 2: the divider expanded shows the work rows as the full transcript does', () => {
    const state = stateOf(markedTurn().events, () => ({ reportOpenTurns: new Set([T1]), expandedTurns: new Set([T1]) }));
    expect(kinds(project(state))).toEqual(['time', 'user', 'owner_record', 'divider', 'text:Looking first. <to-human>The plan is A.</to-human>', 'cell', 'text:All done, unmarked.']);
  });

  it('a marked commentary block stays in view under the lane even with the turn folded and no drawing reported', () => {
    const state = stateOf(markedTurn().events);
    expect(rowsOf(state).filter((row) => row.kind === 'assistant_text').map((row) => row.kind === 'assistant_text' && row.forHuman)).toEqual([true, undefined]);
  });

  it('a turn without a mark draws as the full transcript, beside a marked one', () => {
    const b = markedTurn();
    b.turn('u2');
    b.toolUse('t2', 'Bash', { command: 'pwd' });
    b.result('t2', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m3', 0, 'Plain answer.');
    b.end(['u2']);
    const state = stateOf(b.events);
    const full = rowsOf(state);
    const rows = project(state);
    expect(rows.filter((row) => row.turnId === T2)).toEqual(full.filter((row) => row.turnId === T2));
    expect(rows.some((row) => row.kind === 'owner_record' && row.turnId === T2)).toBe(false);
  });

  it('a working turn: the record runs and hides the open work, whatever the turn’s own expansion', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, '<essential>Mind the migration.</essential>');
    b.toolUse('t1', 'Bash', { command: 'sleep 20' });
    const state = stateOf(b.events);
    expect(kinds(rowsOf(state))).toEqual(['time', 'user', 'divider', 'text:<essential>Mind the migration.</essential>', 'group']); // the open turn is expanded in the full transcript
    const rows = project(state);
    expect(kinds(rows)).toEqual(['time', 'user', 'owner_record', 'text:<essential>Mind the migration.</essential>']);
    expect(rows[2]).toMatchObject({ working: true, toolCalls: 1, messages: 0 });
  });

  it('a streaming block shows once its text carries a mark, and not before', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.emit('assistant.block.delta', { apiMessageId: api('m9'), blockIndex: 0, blockType: 'text', textDelta: 'Thinking aloud, ', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    const before = stateOf(b.events);
    expect(liveMarkedRowIds(before)).toBe('');
    expect(project(before, liveMarkedRowIds(before)).map((row) => row.kind)).not.toContain('owner_record'); // nothing marked yet: the full transcript
    b.emit('assistant.block.delta', { apiMessageId: api('m9'), blockIndex: 0, blockType: 'text', textDelta: '<to-human>Half a mess', thinkingDelta: null, inputJsonDelta: null, userMessageUuid: null });
    const after = stateOf(b.events);
    const live = liveMarkedRowIds(after);
    expect(live).toBe(rowId.text(api('m9'), 0));
    const rows = project(after, live);
    expect(rows.map((row) => row.kind)).toEqual(['time', 'user', 'owner_record', 'assistant_text']);
    expect(rows[3]).toMatchObject({ id: rowId.text(api('m9'), 0), live: true });
  });

  it('nested marks are one marked text: the block stays in view as a whole', () => {
    const b = builder();
    b.turn('u1');
    b.toolUse('t1', 'Bash', { command: 'ls' });
    b.result('t1', 'ok', { structured: BASH_RESULT('ok') });
    b.text('m1', 0, '<to-human>Plan.\n<insight>Why.</insight>\n<essential>Risk.</essential>\n<need-input>Which?\n<choice recommended>A</choice>\n<choice>B</choice>\n</need-input>\n</to-human>');
    b.end(['u1']);
    const rows = project(stateOf(b.events));
    expect(rows.map((row) => row.kind)).toEqual(['time', 'user', 'owner_record', 'assistant_text']);
    expect(rows[2]).toMatchObject({ toolCalls: 1, messages: 0 });
  });

  it('no record row when nothing is folded: no work and every word marked', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, '<to-human>Done.</to-human>');
    b.end(['u1']);
    expect(kinds(project(stateOf(b.events)))).toEqual(['time', 'user', 'text:<to-human>Done.</to-human>']);
  });

  it('a text-only turn with unmarked words keeps them in a record of their own', () => {
    const b = builder();
    b.turn('u1');
    b.text('m1', 0, 'Preamble.\n<to-human>Done.</to-human>');
    b.end(['u1']);
    const rows = project(stateOf(b.events));
    expect(kinds(rows)).toEqual(['time', 'user', 'owner_record', 'text:Preamble.\n<to-human>Done.</to-human>']);
    expect(rows[2]).toMatchObject({ toolCalls: 0, messages: 1 });
  });

  it('is the report only while the lane is on and the reader has not chosen the transcript', () => {
    const ui = createState(null, null).ui;
    expect(reportViewOf(ui)).toBe(false);
    expect(reportViewOf({ ...ui, ownerLane: true })).toBe(true);
    expect(reportViewOf({ ...ui, ownerLane: true, view: 'transcript' })).toBe(false);
    expect(reportViewOf({ ...ui, ownerLane: false, view: 'report' })).toBe(false);
    expect(reportViewOf(undefined)).toBe(false);
  });
});
