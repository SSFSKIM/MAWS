// The approval race on a terminal session's request (P5 O9 M6, "The race"; the owner's Q3): whether the terminal asks it
// too, who settled it and with what, and whether it is the terminal's alone to answer (a background request past its
// window, less 200 ms).
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId } from '@shared/graph/ids';
import { applyLaneAState, resetLaneAStore } from '../stores/lane-a';
import { laneAState } from './test-support/lane-a-state';
import { pastWindow, raceOf, RACE, settledWords, useRace } from './race';

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
    expect(raceOf(state, null, 'r1', T).settled).toEqual({ where: 'terminal', outcome: 'allow', by: 'terminal' });
    expect(raceOf(laneAState(A), { winner: 'web', outcome: 'deny', by: 'maws' }, 'r1', T).settled).toEqual({ where: 'maws', outcome: 'deny', by: 'maws' });
    expect(raceOf(laneAState(A), { winner: 'other', outcome: 'answered', by: 'cli' }, 'r1', T).settled).toEqual({ where: 'elsewhere', outcome: 'answered', by: 'cli' });
    expect(raceOf(laneAState(A), { winner: null, outcome: null, by: 'terminal' }, 'r1', T).settled).toEqual({ where: 'terminal', outcome: null, by: 'terminal' });
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
    expect(settledWords({ where: 'terminal', outcome: 'allow', by: 'terminal' })).toBe('Answered in the terminal: Allowed');
    expect(settledWords({ where: 'terminal', outcome: 'deny', by: 'terminal' })).toBe('Answered in the terminal: Denied');
    expect(settledWords({ where: 'terminal', outcome: 'answered', by: 'terminal' })).toBe('Answered in the terminal');
    expect(settledWords({ where: 'elsewhere', outcome: 'withdrawn', by: 'bridge' })).toBe('No longer asked');
    expect(settledWords({ where: 'maws', outcome: 'allow', by: 'maws' })).toBe('Answered in MAWS: Allowed');
    expect(RACE.asked).toBe('Also asked in the terminal: the first answer wins');
    expect(RACE.terminal).toBe('Answer this in the terminal');
  });
});

// U1a §G: a withdrawn asynchronous question was dismissed, by whom the settlement names; withdrawn by the bridge (a
// `/clear`, the session's end), or any other request withdrawn, is no longer asked
describe('the words of a withdrawn request', () => {
  it('reads a dismissal of an asynchronous question by who made it, and anything else withdrawn as no longer asked', () => {
    const withdrawn = (by: string) => raceOf(laneAState(A), { winner: null, outcome: 'withdrawn', by }, 'r1', T).settled!;
    expect(settledWords(withdrawn('terminal'), { asyncQuestion: true })).toBe('Dismissed in the terminal');
    expect(settledWords(withdrawn('maws'), { asyncQuestion: true })).toBeNull(); // this app's: the card leaves at once
    expect(settledWords(withdrawn('cli'), { asyncQuestion: true })).toBe('Dismissed elsewhere');
    expect(settledWords(withdrawn('member-0042'), { asyncQuestion: true })).toBe('Dismissed elsewhere');
    expect(settledWords(withdrawn('bridge'), { asyncQuestion: true })).toBe('No longer asked');
    for (const by of ['terminal', 'cli', 'bridge']) expect(settledWords(withdrawn(by))).toBe('No longer asked');
  });
});

describe('useRace', () => {
  afterEach(() => {
    resetLaneAStore();
    vi.useRealTimers();
  });

  it('reads a request whose window closed before its state arrived as the terminal’s at once', () => {
    vi.useFakeTimers({ now: T });
    const item = { appSessionId: A, request: { requestId: 'r1', toolUseId: 'r1', taskId: null, agentId: 'a1' } } as unknown as AttentionItem;
    const { result } = renderHook(() => useRace(item));
    vi.setSystemTime(T + 5_000); // the state hydrates late, its window already past
    act(() => applyLaneAState(A, laneAState(A, { pending: [raised('r1', { agentId: 'a1', deadline: new Date(T + 2_000).toISOString() })] })));
    act(() => void vi.advanceTimersByTime(0));
    expect(result.current).toEqual({ asked: true, settled: null, terminalOnly: true });
  });
});
