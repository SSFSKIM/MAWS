// Which drawn answer carries Copy, "Fork from here" and its time, what its Fork passes, and what its Copy takes (UX wave
// U3b, M3; docs/doperpowers/plans/2026-11-15-ux-wave-U3b-transcript-rows-find.md, decisions 12 to 14, Interfaces §C,
// Acceptance 7; ruled R17 and the pre-flight's point (a)). Placement is read from hand-made drawn lists; Copy from the
// store's turn, whatever is drawn.
import type { MessageUuid } from '@shared/graph/ids';
import { describe, expect, it } from 'vitest';
import { aboveLastCompaction, answerActionsOf, answerMarkdownOf } from './answer-actions';
import { turnId as turnIdOf } from './keys';
import { applyEvents, createState } from './reduce';
import type { Row, RowId, TurnId } from './rows';
import { builder, uuid } from './test-events';

const AT = '2026-11-15T10:00:00.000Z';
const turn = (name: string | null) => (name === null ? null : (`turn:${name}` as TurnId));
const base = (id: string, of: string | null) => ({ id: id as RowId, turnId: turn(of), at: AT });

/** The owner's prompt opening turn `of`, its message id `m:<of>` unless given. */
const prompt = (of: string, extra: Partial<Extract<Row, { kind: 'user' }>> = {}): Row => ({
  ...base(`user:${of}`, of), kind: 'user', messageUuid: uuid(`m:${of}`), text: `Look at part ${of}.`, attachments: [], placeholders: [], lines: 1, editable: true, steer: false, dropped: false, ...extra,
});
const command = (of: string, line: string): Row => prompt(of, { text: line });
const answer = (id: string, of: string | null, extra: Partial<Extract<Row, { kind: 'assistant_text' }>> = {}): Row => ({
  ...base(id, of), kind: 'assistant_text', messageUuid: uuid(`a:${id}`), blockIndex: 0, markdown: `The answer ${id}.`, live: false, phase: 'answer', model: null, ...extra,
});
const commentary = (id: string, of: string): Row => answer(id, of, { phase: 'commentary' });
const output = (id: string, of: string | null): Row => ({ ...base(id, of), kind: 'local_command', messageUuid: uuid(`o:${id}`), text: 'Total cost: $0.01', ...(of === null && { lone: true as const }) });
const divider = (of: string, state: 'working' | 'completed' = 'completed', origin: 'human' | 'engine' = 'human'): Row =>
  ({ ...base(`divider:${of}`, of), kind: 'divider', state, origin, startedAt: AT, endedAt: state === 'working' ? null : AT, toolCalls: 1, denied: 0, autoDenied: 0, firstDeniedCell: null, expanded: false, summary: {}, caption: '', parts: [], counts: { added: 0, removed: 0 } }) as unknown as Row;
const thinking = (of: string): Row => ({ ...base(`thinking:${of}`, of), kind: 'thinking', messageUuid: null, text: 'Weighing it.', live: true, durationMs: null, recordedMs: null });
const compaction = (of: string | null): Row => ({ ...base(`boundary:${of ?? 'loose'}`, of), kind: 'boundary', boundaryKind: 'compaction', text: 'Conversation compacted', detail: null, hiddenRows: 0, revealed: false });
// U1c's approval row drawn beside a message (in flight, read at its head; not imported): no message id of its own, the
// person's consent, and the message it stands beside
const besideRow = (of: string, n: number, message: string): Row => ({ ...prompt(of, { messageUuid: null, editable: false, consent: { kind: 'call', subject: 'rm -rf build' } }), id: `grant:${message}:${n}` as RowId, beside: uuid(message) }) as unknown as Row;

/** Each entry as `[answer id, rewindTo, fork]`, in the list's order. */
const entries = (rows: Row[]) => [...answerActionsOf(rows)].map(([id, entry]) => [id, entry.rewindTo, entry.fork]);

describe('which answer carries the action row', () => {
  it('is the last drawn answer before each turn-opening prompt, and the list’s last answer, which forks the whole conversation', () => {
    const rows = [prompt('1'), divider('1'), commentary('c1', '1'), answer('a1', '1'), answer('b1', '1'), prompt('2'), answer('a2', '2')];
    expect(entries(rows)).toEqual([['b1', 'm:2', true], ['a2', null, true]]);
    expect(answerActionsOf(rows).get('b1' as RowId)?.turnId).toBe('turn:1');
  });

  it('is on no commentary, no live text and no cut reply; a cut reply leaves it on the answer before it', () => {
    expect(entries([prompt('1'), commentary('c1', '1'), prompt('2')])).toEqual([]);
    expect(entries([prompt('1'), answer('a1', '1', { live: true })])).toEqual([]);
    expect(entries([prompt('1'), answer('a1', '1'), answer('x1', '1', { cut: true }), prompt('2')])).toEqual([['a1', 'm:2', true]]);
  });

  it('is on none while a turn between the answer and the next prompt runs, the answer’s own turn included', () => {
    expect(entries([prompt('1'), answer('a1', '1'), divider('e2', 'working', 'engine'), thinking('e2')])).toEqual([]); // an engine’s turn runs below it
    expect(entries([prompt('1'), divider('1', 'working'), answer('a1', '1')])).toEqual([]); // its own turn still works
    expect(entries([prompt('1'), answer('a1', '1'), prompt('2'), divider('2', 'working'), thinking('2')])).toEqual([['a1', 'm:2', true]]); // the running turn is the next prompt’s
  });

  it('moves to an engine’s turn’s answer between two prompts', () => {
    const rows = [prompt('1'), answer('a1', '1'), divider('e2', 'completed', 'engine'), answer('ae', 'e2'), prompt('3')];
    expect(entries(rows)).toEqual([['ae', 'm:3', true]]);
    expect(answerActionsOf(rows).get('ae' as RowId)?.turnId).toBe('turn:e2');
  });

  it('counts the consent line as a prompt, and no steer, waiting, unread or dropped message', () => {
    expect(entries([prompt('1'), answer('a1', '1'), prompt('2', { consent: { kind: 'command', subject: 'pnpm test' } })])).toEqual([['a1', 'm:2', true]]);
    expect(entries([prompt('1'), prompt('1s', { steer: true, turnId: turn('1') }), answer('a1', '1'), prompt('2')])).toEqual([['a1', 'm:2', true]]);
    expect(entries([prompt('1'), answer('a1', '1'), prompt('2', { dropped: true }), prompt('3', { unread: true }), prompt('4', { pending: 'next' }), prompt('h', { pending: 'held', turnId: null })])).toEqual([['a1', null, true]]);
  });

  it('draws no Fork where the next prompt has no message id', () => {
    expect(entries([prompt('1'), answer('a1', '1'), prompt('2', { messageUuid: null })])).toEqual([['a1', null, false]]);
  });
});

// Ruled R17: a typed command's bubble opens a turn and Fork passes its id; a command's output never does, told by the row
// and not by its place (on the live route an output can be drawn above its command's replay, and on the file’s routes
// it is a loose row after its command's turn).
describe('a typed command after the answer (R17)', () => {
  const table: { name: string; rows: Row[]; want: unknown[] }[] = [
    { name: 'answer, command bubble, output, prompt', rows: [prompt('1'), answer('a1', '1'), command('2', '/rename notes'), output('o2', '2'), prompt('3')], want: [['a1', 'm:2', true]] },
    { name: 'answer, output, command bubble, prompt', rows: [prompt('1'), answer('a1', '1'), output('o2', '2'), command('2', '/rename notes'), prompt('3')], want: [['a1', 'm:2', true]] },
    { name: 'answer, its command’s loose output after the turn, prompt', rows: [prompt('1'), answer('a1', '1'), command('2', '/cost'), output('o2', null), prompt('3'), answer('a3', '3')], want: [['a1', 'm:2', true], ['a3', null, true]] },
    { name: 'answer, an output alone, prompt', rows: [prompt('1'), answer('a1', '1'), output('o0', null), prompt('3')], want: [['a1', 'm:3', true]] },
    { name: 'answer, two commands in a row, prompt', rows: [prompt('1'), answer('a1', '1'), command('2', '/rename notes'), output('o2', '2'), command('3', '/cost'), output('o3', '3'), prompt('4'), answer('a4', '4')], want: [['a1', 'm:2', true], ['a4', null, true]] },
  ];
  for (const { name, rows, want } of table) it(name, () => expect(entries(rows)).toEqual(want));

  it('never passes a command’s output as the message to fork from, over the whole table', () => {
    for (const { rows } of table) {
      const outputs = new Set(rows.flatMap((row) => (row.kind === 'local_command' ? [row.messageUuid] : [])));
      for (const entry of answerActionsOf(rows).values()) expect(outputs.has(entry.rewindTo), String(entry.rewindTo)).toBe(false);
    }
  });
});

describe('rows beside a message (the pre-flight’s point (a))', () => {
  it('a row beside its message opens no turn, wherever it is drawn', () => {
    expect(entries([prompt('1'), answer('a1', '1'), besideRow('2', 0, 'm:2'), prompt('2'), answer('a2', '2')])).toEqual([['a1', 'm:2', true], ['a2', null, true]]);
    expect(entries([prompt('1'), answer('a1', '1'), prompt('2'), besideRow('2', 0, 'm:2'), besideRow('2', 1, 'm:2'), answer('a2', '2')])).toEqual([['a1', 'm:2', true], ['a2', null, true]]);
  });
});

// Engine facts, 20 (ruled R17): the engine refuses a rewind to anything before a compaction, and accepts the first row
// after it (a typed /compact's own command row, or the next prompt). The prompt that set off an automatic compaction is
// written before it (ruled, M3-4).
describe('above the list’s last compaction boundary', () => {
  it('two answers above a boundary and one below: no Fork for the upper one, the one directly above forks against the first prompt after the boundary, the one below is unchanged', () => {
    const rows = [prompt('1'), answer('u', '1'), prompt('2'), answer('d', '2'), compaction(null), prompt('3'), answer('l', '3')];
    expect(entries(rows)).toEqual([['u', 'm:2', false], ['d', 'm:3', true], ['l', null, true]]);
  });

  it('a typed /compact after an answer: the answer above it forks against the /compact bubble, an answer above that has no Fork', () => {
    const live = [prompt('0'), answer('u', '0'), prompt('1'), answer('a1', '1'), command('2', '/compact'), compaction('2'), output('o2', '2'), prompt('3'), answer('a3', '3')];
    expect(entries(live)).toEqual([['u', 'm:1', false], ['a1', 'm:2', true], ['a3', null, true]]);
    // the file’s routes draw the boundary first, then the command's rows
    const file = [prompt('0'), answer('u', '0'), prompt('1'), answer('a1', '1'), compaction(null), command('2', '/compact'), output('o2', null), prompt('3'), answer('a3', '3')];
    expect(entries(file)).toEqual([['u', 'm:1', false], ['a1', 'm:2', true], ['a3', null, true]]);
  });

  it('an automatic compaction inside the next prompt’s turn: the answer before the prompt that set it off draws no Fork (ruled, M3-4)', () => {
    const rows = [prompt('1'), answer('a1', '1'), prompt('2'), divider('2'), compaction('2'), answer('a2', '2'), prompt('3'), answer('a3', '3')];
    expect(entries(rows)).toEqual([['a1', 'm:2', false], ['a2', 'm:3', true], ['a3', null, true]]);
  });

  it('only the list’s last boundary counts', () => {
    const rows = [prompt('1'), answer('a1', '1'), compaction(null), prompt('2'), answer('a2', '2'), compaction(null), prompt('3'), answer('a3', '3')];
    expect(entries(rows)).toEqual([['a1', 'm:2', false], ['a2', 'm:3', true], ['a3', null, true]]);
  });
});

describe('aboveLastCompaction', () => {
  it('holds for each row drawn above the list’s last compaction boundary, and for none at or below it or with no boundary', () => {
    const rows = [prompt('1'), answer('a1', '1'), compaction(null), prompt('2'), compaction(null), prompt('3')];
    expect(rows.map((_, i) => aboveLastCompaction(rows, i))).toEqual([true, true, true, true, false, false]);
    const none = [prompt('1'), answer('a1', '1')];
    expect(none.map((_, i) => aboveLastCompaction(none, i))).toEqual([false, false]);
  });

  it('leaves out the /compact bubble whose own turn drew the boundary, which the engine writes after it, and no other prompt', () => {
    const rows = [command('1', '/compact'), prompt('2'), command('3', '/compact'), compaction('3'), output('o3', '3')];
    expect(rows.map((_, i) => aboveLastCompaction(rows, i))).toEqual([true, true, false, false, false]);
    const auto = [prompt('1'), prompt('2'), divider('2'), compaction('2')]; // an automatic compaction: its turn’s prompt was written before it
    expect(auto.map((_, i) => aboveLastCompaction(auto, i))).toEqual([true, true, true, false]);
  });
});

describe('what Copy takes', () => {
  function session() {
    const b = builder();
    b.turn('u1', 'Check the gauges.');
    b.text('m1', 0, 'Looking at the log first.');
    b.toolUse('t1', 'Read', { file_path: '/work/gauges.csv' }, 'm1', 1);
    b.result('t1', 'station,offset');
    b.text('m2', 0, 'All five stations are inside the limit.');
    b.text('m2', 1, 'Old quarry moved the most.');
    b.end(['u1']);
    return applyEvents(createState(null, null), b.events);
  }

  it('is the markdown of every answer block of the turn, joined as a copy joins rows; never its commentary', () => {
    expect(answerMarkdownOf(session(), turnIdOf.ofMessage(uuid('u1')))).toBe('All five stations are inside the limit.\n\nOld quarry moved the most.');
  });

  it('reads the turn whole whether or not it is folded', () => {
    const state = session();
    const folded = { ...state, ui: { ...state.ui, collapsedTurns: new Set([turnIdOf.ofMessage(uuid('u1'))]) } };
    expect(answerMarkdownOf(folded, turnIdOf.ofMessage(uuid('u1')))).toBe('All five stations are inside the limit.\n\nOld quarry moved the most.');
  });

  it('is empty for a turn the store does not hold', () => {
    expect(answerMarkdownOf(session(), turnIdOf.ofMessage('missing' as MessageUuid))).toBe('');
  });
});
