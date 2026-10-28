// The approval race on a terminal session's request (P5 O9 M6, "The race"; the owner's Q3): whether the terminal asks it
// too, who settled it and with what, and whether it is the terminal's alone to answer (a background request past its
// window, less 200 ms).
import { describe, expect, it } from 'vitest';
import type { AppSessionId } from '@shared/graph/ids';
import { laneAState } from './test-support/lane-a-state';
import { pastWindow, raceOf, RACE, settledWords } from './race';

const A = 'app-a' as AppSessionId;
const T = Date.parse('2026-10-28T10:00:00.000Z');
const raised = (request: string, more: Record<string, unknown> = {}) => ({ request, session: 'eng-1', tool: 'Bash', input: {}, ...more });

describe('the race', () => {
  it('is no race for a request no bridge raised', () => {
    expect(raceOf(null, null, 'r1', T)).toEqual({ asked: false, settled: null, terminalOnly: false });
    expect(raceOf(laneAState(A), null, 'r1', T)).toEqual({ asked: false, settled: null, terminalOnly: false });
  });

  it('is asked in the terminal too while the bridge holds it pending', () => {
    expect(raceOf(laneAState(A, { pending: [raised('r1')] }), null, 'r1', T)).toEqual({ asked: true, settled: null, terminalOnly: false });
  });

  it('names who settled it, from the state or from what an answer was told', () => {
    const state = laneAState(A, { settled: [{ request: 'r1', session: 'eng-1', winner: 'terminal', outcome: 'allow', by: 'terminal' }] });
    expect(raceOf(state, null, 'r1', T).settled).toEqual({ where: 'terminal', outcome: 'allow' });
    expect(raceOf(laneAState(A), { winner: 'web', outcome: 'deny', by: 'maws' }, 'r1', T).settled).toEqual({ where: 'maws', outcome: 'deny' });
    expect(raceOf(laneAState(A), { winner: 'other', outcome: 'answered', by: 'cli' }, 'r1', T).settled).toEqual({ where: 'elsewhere', outcome: 'answered' });
    expect(raceOf(laneAState(A), { winner: null, outcome: null, by: 'terminal' }, 'r1', T).settled).toEqual({ where: 'terminal', outcome: null });
  });

  it('is the terminal’s alone past a background request’s window, less 200 ms, or when an answer was told so', () => {
    const deadline = new Date(T + 1000).toISOString();
    const state = laneAState(A, { pending: [raised('r1', { agentId: 'a1', deadline })] });
    expect(raceOf(state, null, 'r1', T + 799).terminalOnly).toBe(false);
    expect(raceOf(state, null, 'r1', T + 800).terminalOnly).toBe(true);
    expect(pastWindow({ deadline }, T + 800)).toBe(true);
    expect(pastWindow({}, T + 10_000)).toBe(false);
    expect(raceOf(laneAState(A, { pending: [raised('r1')] }), { winner: null, outcome: null, by: null, terminalOnly: true }, 'r1', T)).toEqual({ asked: true, settled: null, terminalOnly: true });
  });

  it('says a settlement in the owner’s words', () => {
    expect(settledWords({ where: 'terminal', outcome: 'allow' })).toBe('Answered in the terminal: Allowed');
    expect(settledWords({ where: 'terminal', outcome: 'deny' })).toBe('Answered in the terminal: Denied');
    expect(settledWords({ where: 'terminal', outcome: 'answered' })).toBe('Answered in the terminal');
    expect(settledWords({ where: 'elsewhere', outcome: 'withdrawn' })).toBe('No longer asked');
    expect(settledWords({ where: 'maws', outcome: 'allow' })).toBe('Answered in MAWS: Allowed');
    expect(RACE.asked).toBe('Also asked in the terminal: the first answer wins');
    expect(RACE.terminal).toBe('Answer this in the terminal');
  });
});
