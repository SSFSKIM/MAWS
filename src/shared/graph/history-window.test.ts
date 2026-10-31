// The window rule (history-window.ts) over hand-built histories: whole turns within the soft budget, at least the
// newest turn within the hard cap, a cut at the cap when one turn passes it, the session's prelude kept with the oldest
// turn, and a window never starting inside a rewind it carries.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './events';
import { cronHistoryOf, historyWindowStart, soughtIn, type WindowBudget } from './history-window';
import type { MessageUuid } from './ids';

// A history of `kinds`, each event weighing its `size` (sizes are given, not measured, so the budgets read plainly).
function history(spec: readonly (readonly [kind: string, size: number, extra?: Record<string, unknown>])[]): { events: SessionEvent[]; sizeOf: (i: number) => number } {
  const events = spec.map(([kind, , extra], i) => ({ id: `e${i}`, kind, agentId: null, parentToolUseId: null, ...extra }) as unknown as SessionEvent);
  return { events, sizeOf: (i) => spec[i]![1] };
}

const turn = (size: number, uuid?: string): [string, number, Record<string, unknown>?][] => [
  ['turn.started', 1, uuid === undefined ? undefined : { userMessageUuid: uuid }],
  ['user.message', size - 2, uuid === undefined ? undefined : { messageUuid: uuid }],
  ['turn.ended', 1],
];

const budget = (soft: number, hard: number): WindowBudget => ({ soft, hard });

describe('historyWindowStart', () => {
  it('takes whole turns, newest first, while they fit the soft budget', () => {
    const { events, sizeOf } = history([...turn(10), ...turn(10), ...turn(10), ...turn(10)]);
    expect(historyWindowStart(events, events.length, sizeOf, budget(25, 100))).toBe(6); // two turns of 10
    expect(historyWindowStart(events, 6, sizeOf, budget(25, 100))).toBe(0); // the page before them: the rest
  });

  it('keeps the newest turn whole past the soft budget while it fits the hard cap, and cuts one bigger than the cap', () => {
    const { events, sizeOf } = history([...turn(10), ...turn(50)]);
    expect(historyWindowStart(events, events.length, sizeOf, budget(20, 100))).toBe(3);
    const cut = historyWindowStart(events, events.length, sizeOf, budget(20, 30));
    expect(cut).toBe(5); // within the cap only the big turn's end fits: [turn.ended]; its prompt goes to the next page
    expect(historyWindowStart(events, 5, sizeOf, budget(20, 30))).toBe(4); // the prompt alone passes the cap: it goes alone
  });

  it('takes the prelude before the first turn with it', () => {
    const { events, sizeOf } = history([['session.started', 3], ...turn(10), ...turn(10)]);
    expect(historyWindowStart(events, events.length, sizeOf, budget(15, 100))).toBe(4);
    expect(historyWindowStart(events, 4, sizeOf, budget(15, 100))).toBe(0); // session.started rides with the first turn
  });

  it('pulls its start back to the turn a rewind inside it targets, within the hard cap', () => {
    const { events, sizeOf } = history([
      ...turn(10, 'u1'),
      ...turn(10, 'u2'), // the rewind's target
      ...turn(10, 'u3'), // abandoned by the rewind
      ['boundary.rewind', 1, { targetMessageUuid: 'u2' }],
      ...turn(10, 'u4'),
    ]);
    // Within the soft budget alone the window would start at u3's turn (index 6), inside the rewound branch.
    expect(historyWindowStart(events, events.length, sizeOf, budget(22, 100))).toBe(3);
    // A cap too small for the target leaves it out.
    expect(historyWindowStart(events, events.length, sizeOf, budget(22, 25))).toBe(6);
  });
});

describe('soughtIn', () => {
  // Three turns; the second's prompt is `u2`, and its reply's two blocks carry `m2`.
  const { events } = history([...turn(10, 'u1'), ['turn.started', 1, { userMessageUuid: 'u2' }], ['assistant.text', 5, { messageUuid: 'm2' }], ['assistant.text', 5, { messageUuid: 'm2' }], ['turn.ended', 1], ...turn(10, 'u3')]);
  const m = (uuid: string) => uuid as MessageUuid;

  it('places the message by its first event: on the page, on an earlier one and how many events back, or at or after its end', () => {
    expect(soughtIn(events, m('m2'), 3, 7)).toEqual({ at: 'page', behind: 0 });
    expect(soughtIn(events, m('m2'), 5, 7)).toEqual({ at: 'earlier', behind: 1 }); // its first block is before the page
    expect(soughtIn(events, m('u2'), 7, events.length)).toEqual({ at: 'earlier', behind: 4 }); // a prompt: its turn's start
    expect(soughtIn(events, m('u3'), 0, 7)).toEqual({ at: 'newer', behind: 0 });
  });

  it('says a message in none of the history is absent', () => {
    expect(soughtIn(events, m('gone'), 0, events.length)).toEqual({ at: 'absent', behind: 0 });
  });
});

describe('cronHistoryOf', () => {
  // Turns u1..u4: u1 creates a job and runs a Read; a child agent of u1 creates one of its own; u2's create was retracted;
  // u3 deletes and creates; a later rewind to u3 abandons u3 and u4 (u4 creates); the window starts at u4.
  const call = (toolUseId: string, toolName: string, messageUuid: string, extra: Record<string, unknown> = {}) => [
    ['tool.use', 5, { toolUseId, toolName, messageUuid, input: {}, ...extra }] as const,
    ['tool.result', 5, { toolUseId, ...extra }] as const,
  ];
  const child = { parentToolUseId: 'agent-1', agentId: 'a1' };
  const { events } = history([
    ['turn.started', 1, { userMessageUuid: 'u1' }], ...call('c1', 'CronCreate', 'm1'), ...call('r1', 'Read', 'm1'), ...call('c1x', 'CronCreate', 'mx', child), ['turn.ended', 1],
    ['turn.started', 1, { userMessageUuid: 'u2' }], ...call('c2', 'CronCreate', 'm2'), ['boundary.retraction', 1, { retractedMessageUuids: ['m2'] }], ['turn.ended', 1],
    ['turn.started', 1, { userMessageUuid: 'u3' }], ...call('d3', 'CronDelete', 'm3'), ['turn.ended', 1],
    ['turn.started', 1, { userMessageUuid: 'u4' }], ...call('c4', 'CronCreate', 'm4'), ['turn.ended', 1],
    ['boundary.rewind', 1, { targetMessageUuid: 'u3' }],
    ['turn.started', 1, { userMessageUuid: 'u5' }], ['turn.ended', 1],
  ]);
  const ids = (out: readonly { id: string }[]) => out.map((e) => e.id);
  const at = (kind: string, field: string, value: string) => events.findIndex((e) => e.kind === kind && (e as unknown as Record<string, unknown>)[field] === value);

  it('carries the session lane\u2019s cron calls before the window, each with its result and its turn\u2019s start, as the activity reads them', () => {
    const start = at('turn.started', 'userMessageUuid', 'u5');
    const out = cronHistoryOf(events, start);
    // u1's own create (not the Read, not its child's), nothing of u2 (retracted), nothing of u3 or u4 (a rewind abandoned them)
    expect(ids(out)).toEqual([events[at('turn.started', 'userMessageUuid', 'u1')]!.id, events[at('tool.use', 'toolUseId', 'c1')]!.id, events[at('tool.result', 'toolUseId', 'c1')]!.id]);
  });

  it('counts a rewind after the window too, and nothing from the window or after it', () => {
    const start = at('turn.started', 'userMessageUuid', 'u4'); // u3 before the window: the rewind (in the window) still abandons it
    expect(cronHistoryOf(events, start).filter((e) => e.kind === 'tool.use').map((e) => (e as { toolUseId: string }).toolUseId)).toEqual(['c1']);
    expect(cronHistoryOf(events, 0)).toEqual([]);
  });

  it('keeps the newest calls within its byte budget', () => {
    const { events: many } = history(Array.from({ length: 6 }, (_, n) => [['turn.started', 1, { userMessageUuid: `u${n}` }], ...call(`c${n}`, 'CronCreate', `m${n}`), ['turn.ended', 1]] as const).flat());
    const all = cronHistoryOf(many, many.length);
    const one = JSON.stringify(all.slice(0, 3)).length;
    const kept = cronHistoryOf(many, many.length, one * 2 + 10).filter((e) => e.kind === 'tool.use').map((e) => (e as { toolUseId: string }).toolUseId);
    expect(kept).toEqual(['c4', 'c5']);
  });
});
