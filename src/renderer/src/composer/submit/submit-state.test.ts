import { describe, expect, it } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, status } from '../../../../../test/support/builders';
import { isBusy, steerPriority, submitState, type SubmitInput } from './submit-state';

const APP = 'app-1';
const entry = (state: QueueEntry['state'], over: Partial<QueueEntry> = {}): QueueEntry => ({
  queueId: `q-${state}`, appSessionId: APP as AppSessionId, content: 'later', createdAt: '2026-09-29T10:00:00.000Z', state, messageUuid: null, submittedAt: null, uncertain: false, steer: false, ...over,
});
const idle = status(APP);
const turning = { ...status(APP, { engineState: 'running', turn: humanTurn }) };
const input = (over: Partial<SubmitInput>): SubmitInput => ({ status: idle, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', holdHeld: false, released: false /* C12 */, ...over });
const row = (over: Partial<SubmitInput>) => {
  const d = submitState(input(over));
  return [d.primary, d.label, d.enabled, d.reason, d.secondaryStop];
};

describe('submitState covers the five states, the caret menu and the unstarted rows', () => {
  it('holds an unstarted session while it starts, while C10 holds its first message, and sends once ready', () => {
    const intent = { starting: false, messageHeld: false };
    expect(row({ status: null, intent: { ...intent, starting: true } })).toEqual(['send', 'Starting…', false, 'Session is starting…', false]);
    expect(row({ status: null, intent: { starting: true, messageHeld: true } })[1]).toBe('Starting…'); // starting outranks held
    expect(row({ status: null, intent: { ...intent, messageHeld: true } })).toEqual(['send', 'Send', false, 'Your first message is with the setup above', false]);
    expect(row({ status: null, intent })).toEqual(['send', 'Send', true, null, false]);
    expect(row({ status: null, intent, empty: true })).toEqual(['send', 'Send', false, null, false]);
    // `!` and `#` wait for the engine
    expect(row({ status: null, intent, mode: 'bash' })).toEqual(['send', 'Send', false, 'Available once the session starts', false]);
    expect(row({ status: null, intent, mode: 'memory' })[3]).toBe('Available once the session starts');
  });

  it("shows C10's setup phase as the disabled-state reason while the setup runs, ahead of the held message", () => {
    const intent = { starting: false, messageHeld: true };
    expect(row({ status: null, intent: { ...intent, phase: 'Creating worktree one…' } })).toEqual(['send', 'Starting…', false, 'Creating worktree one…', false]);
    expect(row({ status: null, intent: { ...intent, phase: 'Trusting /repo…' } })[3]).toBe('Trusting /repo…');
    expect(row({ status: null, intent: { ...intent, starting: true, phase: 'Starting…' } })[3]).toBe('Starting…');
    expect(row({ status: null, intent: { ...intent, phase: null } })[3]).toBe('Your first message is with the setup above');
  });

  it('reads the intent whenever the caller answers one, even beside an exited status (C10: a failed setup keeps its tab and C3 its exited status)', () => {
    const intent = { starting: false, messageHeld: false };
    const exited = { ...idle, process: 'exited' as const };
    expect(row({ status: exited, intent })).toEqual(['send', 'Send', true, null, false]);
    expect(row({ status: exited, intent: { ...intent, messageHeld: true } })[3]).toBe('Your first message is with the setup above');
  });

  it('refuses while no process is ready: starting, or ended (resume is C10’s)', () => {
    expect(row({ status: null })).toEqual(['send', 'Send', false, 'Session ended', false]);
    expect(row({ status: { ...idle, process: 'initializing' } })).toEqual(['send', 'Send', false, 'Session is starting…', false]);
    expect(row({ status: { ...idle, process: 'starting' } })[3]).toBe('Session is starting…');
    expect(row({ status: { ...idle, process: 'exited' } })[3]).toBe('Session ended');
    expect(row({ status: { ...idle, process: 'exiting' } })[3]).toBe('Session ended');
  });

  it('runs `!` and saves `#` whenever the process is ready, with Stop beside them during a turn', () => {
    expect(row({ mode: 'bash' })).toEqual(['send', 'Run', true, null, false]);
    expect(row({ mode: 'bash', status: turning })).toEqual(['send', 'Run', true, null, true]);
    expect(row({ mode: 'bash', empty: true })[2]).toBe(false);
    expect(row({ mode: 'memory', status: turning })).toEqual(['send', 'Save to memory', true, null, true]);
    expect(submitState(input({ mode: 'bash', status: turning })).menu).toEqual([]);
  });

  it('says what `!` does while busy: it runs now and the model sees the output in this turn (architect’s ruling on M6)', () => {
    expect(submitState(input({ mode: 'bash', status: turning })).detail).toBe('Runs now; the model sees the output in this turn');
    expect(submitState(input({ mode: 'bash', queue: { entries: [entry('submitting')], paused: false } })).detail).toBe('Runs now; the model sees the output in this turn');
    expect(submitState(input({ mode: 'bash' })).detail).toBeNull(); // idle: Run is all there is to say
  });

  it('reads busy from the open turn, or an entry in flight before the engine’s started', () => {
    expect(row({ status: turning, empty: true })).toEqual(['stop', 'Stop', true, null, false]);
    // W1: Queue is the `next` steer (Enter), Hold the app queue (⌥ held), each saying when it sends
    expect(row({ status: turning, holdHeld: true })).toEqual(['hold', 'Hold', true, null, true]);
    expect(row({ status: turning })).toEqual(['queue', 'Queue', true, null, true]);
    expect(submitState(input({ status: turning })).detail).toBe('Sends at the next step');
    expect(submitState(input({ status: turning, holdHeld: true })).detail).toBe('Sends when this turn ends');
    // a first entry `submitting` while status.turn is still null: busy
    const submitting = { entries: [entry('submitting')], paused: false };
    expect(row({ queue: submitting, empty: true })).toEqual(['stop', 'Stop', true, null, false]);
    expect(row({ queue: submitting })).toEqual(['queue', 'Queue', true, null, true]);
    expect(row({ queue: { entries: [entry('released')], paused: false }, empty: true })[0]).toBe('stop');
    expect(isBusy(idle, [entry('queued')])).toBe(false);
    expect(isBusy(null, [entry('submitting')])).toBe(true);
  });

  it('resumes a paused queue, queues behind waiting entries, and otherwise sends', () => {
    const paused = { entries: [entry('queued')], paused: true };
    expect(row({ queue: paused, empty: true })).toEqual(['resume', 'Resume', true, null, false]);
    expect(row({ queue: { entries: [], paused: true }, empty: true })).toEqual(['resume', 'Resume', false, null, false]);
    // idle with messages waiting in the app queue: a new one joins them there (the control still reads Queue)
    expect(row({ queue: paused })).toEqual(['hold', 'Queue', true, null, false]);
    expect(row({ queue: { entries: [entry('queued')], paused: false } })).toEqual(['hold', 'Queue', true, null, false]);
    expect(row({ queue: { entries: [entry('queued')], paused: false }, empty: true })).toEqual(['hold', 'Queue', false, null, false]);
    expect(row({})).toEqual(['send', 'Send', true, null, false]);
    expect(row({ empty: true })).toEqual(['send', 'Send', false, null, false]);
    // ⌥ held with no turn open decides as Send (nothing to hold back from)
    expect(row({ holdHeld: true })).toEqual(['send', 'Send', true, null, false]);
  });

  it('offers Queue, Hold until the turn ends and Send now in the caret menu while busy, each labelled with what it does (W1)', () => {
    const menu = submitState(input({ status: turning })).menu;
    expect(menu).toEqual([
      { id: 'queue', label: 'Queue', detail: 'Sends at the next step', chord: 'Enter', enabled: true },
      { id: 'hold', label: 'Hold until the turn ends', detail: 'Sends when this turn ends', chord: '⌥Enter', enabled: true },
      { id: 'interrupt_and_send', label: 'Send now', detail: 'Stops the running turn, then sends this', chord: null, enabled: true },
    ]);
    expect(submitState(input({ status: turning, empty: true })).menu.map((m) => m.enabled)).toEqual([false, false, false]);
    expect(submitState(input({})).menu).toEqual([]);
    expect(submitState(input({ queue: { entries: [entry('queued')], paused: true } })).menu).toEqual([]);
  });

  it('maps Queue to next and Send now to now, in one place', () => {
    expect(steerPriority('queue')).toBe('next');
    expect(steerPriority('interrupt_and_send')).toBe('now');
  });
});

// C12 start: Send-to-resume (C12 execution document, Interfaces "Send-to-resume"). A session released under the memory
// budget sends to resume; every other ended session stays ended, as the brief rules.
describe('a released session resumes on Send; stopped, crashed, archived and exiting sessions do not', () => {
  const exited = (reason: 'budget' | 'stop' | 'crash' | 'archive') => ({ ...idle, process: 'exited' as const, engineState: 'idle' as const, exit: { code: 0, signal: null, reason, at: '2026-09-29T12:00:00.000Z', release: reason === 'budget' ? { limitKiB: 8_388_608, totalKiB: 9_000_000 } : null } });

  it('released + send: Send is enabled, says it resumes the session, and waits for text', () => {
    const d = submitState(input({ released: true, status: exited('budget') }));
    expect([d.primary, d.label, d.enabled, d.reason, d.secondaryStop, d.menu]).toEqual(['send', 'Send', true, null, false, []]);
    expect(d.detail).toBe('Resumes this session');
    expect(row({ released: true, status: exited('budget'), empty: true })).toEqual(['send', 'Send', false, null, false]);
    // no status at all (the host forgot the row after the exited-row cap): the digest's mark still decides
    expect(row({ released: true, status: null })).toEqual(['send', 'Send', true, null, false]);
  });

  it('released + ! or #: disabled, asking for a message first', () => {
    expect(row({ released: true, status: exited('budget'), mode: 'bash' })).toEqual(['send', 'Send', false, 'Send a message to resume this session first', false]);
    expect(row({ released: true, status: exited('budget'), mode: 'memory' })[3]).toBe('Send a message to resume this session first');
  });

  it('stopped and crashed sessions stay ended', () => {
    expect(row({ status: exited('stop') })).toEqual(['send', 'Send', false, 'Session ended', false]);
    expect(row({ status: exited('crash') })).toEqual(['send', 'Send', false, 'Session ended', false]);
  });

  it('an archived-and-unarchived session (its mark dropped with the archive) stays ended, whatever its last exit was', () => {
    expect(row({ released: false, status: exited('budget') })).toEqual(['send', 'Send', false, 'Session ended', false]);
    expect(row({ released: false, status: exited('archive') })[3]).toBe('Session ended');
  });

  it('a release still exiting refuses (the draft stays) until the status reads exited', () => {
    const exiting = { ...idle, process: 'exiting' as const };
    expect(row({ released: true, status: exiting })).toEqual(['send', 'Send', false, 'Session ended', false]);
    expect(row({ released: false, status: exiting })[2]).toBe(false);
  });

  it('a released mark beside a live process (a resume under way) decides as that process', () => {
    expect(row({ released: true, status: { ...idle, process: 'starting' } })[3]).toBe('Session is starting…');
    expect(row({ released: true })).toEqual(['send', 'Send', true, null, false]);
    expect(submitState(input({ released: true })).detail).toBeNull();
  });
});
// C12 end
