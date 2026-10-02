import type { SessionEvent } from '@shared/graph/events';
import { describe, expect, it } from 'vitest';
import { rowsOf, turnPhrases, turnSummary, withAllExpanded } from './derive';
import { rowId, turnId } from './keys';
import { applyEvents, createState } from './reduce';
import { api, builder, parent, tool, uuid } from './test-events';

const reduce = (events: SessionEvent[]) => applyEvents(createState(null, null), events);

describe('revision regressions', () => {
  it('rewinds a consumed next steer through the turn that absorbed it', () => {
    const b = builder();
    b.turn('one');
    b.text('before', 0, 'Before steer');
    b.emit('user.message', { messageUuid: uuid('steer'), content: 'Change direction', isReplay: false, isSynthetic: false, origin: 'human', bash: null });
    b.emit('command.lifecycle', { commandUuid: uuid('steer'), state: 'started' });
    b.text('after', 0, 'Following answer');
    b.end(['one', 'steer']);
    const before = reduce(b.events);
    expect(rowsOf(before).some((row) => row.kind === 'user' && row.steer && row.editable)).toBe(true);
    const rewind = b.emit('boundary.rewind', { targetMessageUuid: uuid('steer'), precedingAssistantUuid: uuid('before-u0'), prefillText: 'Change direction' });
    const state = applyEvents(before, [rewind]);
    expect(state.hidden?.turns).toEqual([turnId.ofMessage(uuid('one'))]);
    expect(rowsOf(state).filter((row) => row.kind === 'user' || row.kind === 'assistant_text')).toEqual([]);
    expect(rowsOf(withAllExpanded(state)).filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one', 'steer']);
    expect(rowsOf(before).some((row) => row.kind === 'assistant_text' && row.markdown === 'Following answer')).toBe(true);
  });

  it('retracts every owning turn in a removed chain, retaining the untouched turn and one boundary', () => {
    const b = builder();
    for (const id of ['one', 'two', 'three']) {
      b.turn(id);
      b.text(id, 0, `Answer ${id}`);
      b.end([id]);
    }
    const before = reduce(b.events);
    rowsOf(before);
    const retraction = b.emit('boundary.retraction', { retractedMessageUuids: ['two', 'two-u0', 'three', 'three-u0'].map(uuid), reason: 'branch changed', fallbackModel: null });
    const state = applyEvents(before, [retraction]);
    const rows = rowsOf(withAllExpanded(state));
    expect(rows.filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one']);
    expect(rows.filter((row) => row.kind === 'assistant_text').map((row) => row.markdown)).toEqual(['Answer one']);
    expect(rows.filter((row) => row.kind === 'boundary' && row.boundaryKind === 'retraction')).toHaveLength(1);
    expect(rowsOf(before).filter((row) => row.kind === 'assistant_text')).toHaveLength(3);
  });

  it('excludes a retracted completed Bash call from rows, summary and phrases', () => {
    const b = builder();
    b.turn('one');
    b.toolUse('bash', 'Bash', { command: 'pwd' });
    b.result('bash', '/project');
    b.text('answer', 0, 'Done');
    b.end(['one']);
    b.emit('boundary.retraction', { retractedMessageUuids: [uuid('msg-bash-u0')], reason: 'retracted', fallbackModel: null });
    const state = reduce(b.events);
    const turn = state.turns.get(state.order[0])!;
    expect(turnSummary(turn).toolCalls).toBe(0);
    expect(turnPhrases(turn)).not.toContain('command');
    expect(rowsOf(withAllExpanded(state)).filter((row) => row.kind === 'cell' || row.kind === 'group')).toEqual([]);
  });

  it('keeps each successive rewind branch with its own count and independent disclosure', () => {
    const b = builder();
    b.turn('one'); b.text('one', 0, 'Kept'); b.end(['one']);
    b.turn('two'); b.text('two', 0, 'Original'); b.end(['two']);
    const first = b.emit('boundary.rewind', { targetMessageUuid: uuid('two'), precedingAssistantUuid: uuid('one-u0'), prefillText: 'prompt two' });
    const before = reduce(b.events);
    const offset = b.events.length;
    b.turn('three'); b.text('three', 0, 'Replacement'); b.text('three', 1, 'More replacement'); b.end(['three']);
    const second = b.emit('boundary.rewind', { targetMessageUuid: uuid('three'), precedingAssistantUuid: uuid('one-u0'), prefillText: 'prompt three' });
    const state = applyEvents(before, b.events.slice(offset));
    expect(rowsOf(state).filter((row) => row.kind === 'boundary').map((row) => row.hiddenRows)).toEqual([2, 3]);
    let uiVersion = state.ui.version;
    const reveal = (ids: typeof first.id[]) => rowsOf({ ...state, ui: { ...state.ui, revealedBoundaries: new Set(ids.map(rowId.boundary)), global: state.ui.global + 1, version: ++uiVersion } });
    expect(reveal([first.id]).filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one', 'two']);
    expect(reveal([second.id]).filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one', 'three']);
    expect(rowsOf(withAllExpanded(state)).filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one', 'two', 'three']);
    expect(state.hidden?.turns).toEqual([turnId.ofMessage(uuid('two')), turnId.ofMessage(uuid('three'))]);
    expect(rowsOf(withAllExpanded(before)).filter((row) => row.kind === 'user').map((row) => row.messageUuid)).toEqual(['one', 'two']);
  });

  it.each(['process.exited', 'turn.ended', 'turn.started'] as const)('closes unfinished thinking with a duration on %s', (close) => {
    const b = builder();
    b.turn('one');
    const delta = b.emit('assistant.block.delta', { apiMessageId: api('thinking'), blockIndex: 0, blockType: 'thinking', textDelta: null, thinkingDelta: 'Working it out', inputJsonDelta: null, userMessageUuid: uuid('one') });
    const before = reduce(b.events);
    const offset = b.events.length;
    b.tick(1200);
    if (close === 'process.exited') b.emit(close, { code: 1, signal: null, reason: 'crash', lostAttentionCount: 0, budget: null });
    else if (close === 'turn.ended') b.end(['one']);
    else b.turn('two');
    const closedAt = b.events[offset].at;
    const state = applyEvents(before, b.events.slice(offset));
    expect(rowsOf(withAllExpanded(state)).find((row) => row.kind === 'thinking')).toMatchObject({ live: false, durationMs: Date.parse(closedAt) - Date.parse(delta.at), text: 'Working it out' });
    expect(rowsOf(before).find((row) => row.kind === 'thinking')).toMatchObject({ live: true, durationMs: null });
  });
});

it('hydrates 40,000 child events with linear copying and preserves prior batches', () => {
  const b = builder();
  b.turn('one');
  b.toolUse('child', 'Agent', { description: 'Child' });
  const initial = reduce(b.events);
  const offset = b.events.length;
  for (let i = 0; i < 40_000; i += 1) b.emit('user.message', { messageUuid: uuid(`child-${i}`), content: `child message ${i}`, isReplay: true, isSynthetic: false, origin: 'human', bash: null }, { parentToolUseId: parent('child') });
  const childEvents = b.events.slice(offset);
  // Count elements traversed by array spreads, not wall-clock time: shared CI load must not change the budget.
  // Delegate to the real iterator; no production behaviour is stubbed.
  const iterator = Array.prototype[Symbol.iterator];
  let copied = 0;
  Array.prototype[Symbol.iterator] = function (this: SessionEvent[]) {
    if (this[0]?.parentToolUseId === parent('child')) copied += this.length;
    return iterator.call(this);
  };
  let state: typeof initial;
  let first: typeof initial;
  const start = performance.now();
  let firstMs: number;
  try {
    first = applyEvents(initial, childEvents.slice(0, 20_000));
    firstMs = performance.now() - start;
    state = applyEvents(first, childEvents.slice(20_000));
  } finally {
    Array.prototype[Symbol.iterator] = iterator;
  }
  console.log(`child hydration: 20k=${firstMs.toFixed(1)}ms next20k=${(performance.now() - start - firstMs).toFixed(1)}ms traversed=${copied}`);
  expect(state.turns.get(state.order[0])!.children.get(tool('child'))).toEqual(childEvents);
  expect(initial.turns.get(initial.order[0])!.children.size).toBe(0);
  expect(first.turns.get(first.order[0])!.children.get(tool('child'))).toHaveLength(20_000);
  // 40k input visits + at most one copy of the existing 20k list. Quadratic copying visits ~800m.
  expect(copied).toBeLessThanOrEqual(60_000);
});
