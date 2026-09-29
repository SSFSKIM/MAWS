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
const input = (over: Partial<SubmitInput>): SubmitInput => ({ status: idle, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', steerHeld: false, ...over });
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
    expect(submitState(input({ status: turning })).detail).toBeNull();
  });

  it('reads busy from the open turn, or an entry in flight before the engine’s started', () => {
    expect(row({ status: turning, empty: true })).toEqual(['stop', 'Stop', true, null, false]);
    expect(row({ status: turning, steerHeld: true })).toEqual(['steer', 'Steer', true, null, true]);
    expect(row({ status: turning })).toEqual(['queue', 'Queue', true, null, true]);
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
    expect(row({ queue: paused })).toEqual(['queue', 'Queue', true, null, false]);
    expect(row({ queue: { entries: [entry('queued')], paused: false } })).toEqual(['queue', 'Queue', true, null, false]);
    expect(row({ queue: { entries: [entry('queued')], paused: false }, empty: true })).toEqual(['queue', 'Queue', false, null, false]);
    expect(row({})).toEqual(['send', 'Send', true, null, false]);
    expect(row({ empty: true })).toEqual(['send', 'Send', false, null, false]);
    // ⌥ held with no turn open decides as Send (next on an idle engine runs at once; the app queue keeps its order)
    expect(row({ steerHeld: true })).toEqual(['send', 'Send', true, null, false]);
  });

  it('offers Queue, Steer and Interrupt and send in the caret menu while busy, each labelled with what it does', () => {
    const menu = submitState(input({ status: turning })).menu;
    expect(menu).toEqual([
      { id: 'queue', label: 'Queue', detail: 'Sends when this turn ends', chord: 'Enter', enabled: true },
      { id: 'steer', label: 'Steer', detail: 'Adds this to the running turn at its next step', chord: '⌥Enter', enabled: true },
      { id: 'interrupt_and_send', label: 'Interrupt and send', detail: 'Stops the running turn, then sends this', chord: null, enabled: true },
    ]);
    expect(submitState(input({ status: turning, empty: true })).menu.map((m) => m.enabled)).toEqual([false, false, false]);
    expect(submitState(input({})).menu).toEqual([]);
    expect(submitState(input({ queue: { entries: [entry('queued')], paused: true } })).menu).toEqual([]);
  });

  it('maps Steer to next and Interrupt and send to now, in one place', () => {
    expect(steerPriority('steer')).toBe('next');
    expect(steerPriority('interrupt_and_send')).toBe('now');
  });
});
