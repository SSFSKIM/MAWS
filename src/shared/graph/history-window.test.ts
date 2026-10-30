// The window rule (history-window.ts) over hand-built histories: whole turns within the soft budget, at least the
// newest turn within the hard cap, a cut at the cap when one turn passes it, the session's prelude kept with the oldest
// turn, and a window never starting inside a rewind it carries.
import { describe, expect, it } from 'vitest';
import type { SessionEvent } from './events';
import { historyWindowStart, type WindowBudget } from './history-window';

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
