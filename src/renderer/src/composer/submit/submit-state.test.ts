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
const input = (over: Partial<SubmitInput>): SubmitInput => ({ status: idle, intent: null, queue: { entries: [], paused: false }, empty: false, mode: 'send', availability: 'usable' /* P2-A */, heldBy: null, ...over });
// the last column: whether this Send is the `next` steer (W10)
const row = (over: Partial<SubmitInput>) => {
  const d = submitState(input(over));
  return [d.primary, d.label, d.enabled, d.reason, d.steer];
};

describe('submitState covers Send, Stop, Resume and the unstarted rows (W10: one button)', () => {
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

  // New chat (2026-10-01): Send waits for the project row's choice, whatever is typed
  it('holds a New chat with no project chosen with "Choose a project first"', () => {
    const intent = { starting: false, messageHeld: false, noProject: true };
    expect(row({ status: null, intent })).toEqual(['send', 'Send', false, 'Choose a project first', false]);
    expect(row({ status: null, intent, mode: 'bash' })[3]).toBe('Choose a project first');
    expect(row({ status: null, intent: { ...intent, starting: true } })[1]).toBe('Starting…');
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

  it('refuses a session with no record while no process is ready: starting, or ended (P2-A: a record’s availability decides)', () => {
    expect(row({ status: null, availability: null })).toEqual(['send', 'Send', false, 'Session ended', false]);
    expect(row({ status: { ...idle, process: 'initializing' }, availability: null })).toEqual(['send', 'Send', false, 'Session is starting…', false]);
    expect(row({ status: { ...idle, process: 'starting' }, availability: null })[3]).toBe('Session is starting…');
    expect(row({ status: { ...idle, process: 'exited' }, availability: null })[3]).toBe('Session ended');
    expect(row({ status: { ...idle, process: 'exiting' }, availability: null })[3]).toBe('Session ended');
  });

  it('runs `!` and saves `#` whenever the process is ready, through their own modes, never as a steer', () => {
    expect(row({ mode: 'bash' })).toEqual(['send', 'Run', true, null, false]);
    expect(row({ mode: 'bash', status: turning })).toEqual(['send', 'Run', true, null, false]);
    expect(row({ mode: 'bash', empty: true })[2]).toBe(false);
    expect(row({ mode: 'memory', status: turning })).toEqual(['send', 'Save to memory', true, null, false]);
  });

  it('says what `!` does while busy: it runs now and the model sees the output in this turn (architect’s ruling on M6)', () => {
    expect(submitState(input({ mode: 'bash', status: turning })).detail).toBe('Runs now; the model sees the output in this turn');
    expect(submitState(input({ mode: 'bash', queue: { entries: [entry('submitting')], paused: false } })).detail).toBe('Runs now; the model sees the output in this turn');
    expect(submitState(input({ mode: 'bash' })).detail).toBeNull(); // idle: Run is all there is to say
  });

  it('reads busy from the open turn, or an entry in flight before the engine’s started', () => {
    expect(row({ status: turning, empty: true })).toEqual(['stop', 'Stop', true, null, false]);
    // W10: with text it is Send, the `next` steer, saying when it goes
    expect(row({ status: turning })).toEqual(['send', 'Send', true, null, true]);
    expect(submitState(input({ status: turning })).detail).toBe('Sends at the next step');
    expect(submitState(input({ status: turning, queue: { entries: [entry('queued')], paused: true } })).steer).toBe(true); // a paused queue does not hold a steer back
    // a first entry `submitting` while status.turn is still null: busy
    const submitting = { entries: [entry('submitting')], paused: false };
    expect(row({ queue: submitting, empty: true })).toEqual(['stop', 'Stop', true, null, false]);
    expect(row({ queue: submitting })).toEqual(['send', 'Send', true, null, true]);
    expect(row({ queue: { entries: [entry('released')], paused: false }, empty: true })[0]).toBe('stop');
    expect(isBusy(idle, [entry('queued')])).toBe(false);
    expect(isBusy(null, [entry('submitting')])).toBe(true);
  });

  it('resumes a paused queue, sends behind waiting entries saying so, and otherwise sends', () => {
    const paused = { entries: [entry('queued')], paused: true };
    expect(row({ queue: paused, empty: true })).toEqual(['resume', 'Resume', true, null, false]);
    expect(row({ queue: { entries: [], paused: true }, empty: true })).toEqual(['resume', 'Resume', false, null, false]);
    // idle with messages waiting in the app queue: Send, and C3 puts the new one behind them (W10: no Queue label)
    expect(row({ queue: paused })).toEqual(['send', 'Send', true, null, false]);
    expect(submitState(input({ queue: paused })).detail).toBe('Joins the paused queue; Resume sends it');
    expect(row({ queue: { entries: [entry('queued')], paused: false } })).toEqual(['send', 'Send', true, null, false]);
    expect(submitState(input({ queue: { entries: [entry('queued')], paused: false } })).detail).toBe('Sends after the queued messages');
    expect(row({ queue: { entries: [entry('queued')], paused: false }, empty: true })).toEqual(['send', 'Send', false, null, false]);
    expect(row({})).toEqual(['send', 'Send', true, null, false]);
    expect(submitState(input({})).detail).toBeNull(); // idle with nothing waiting: Send is all there is to say
    expect(row({ empty: true })).toEqual(['send', 'Send', false, null, false]);
  });

  it('decides only Send, Stop and Resume (W10: no hold, no queue primary, no menu, no Stop beside it)', () => {
    const cases: Partial<SubmitInput>[] = [{}, { empty: true }, { status: turning }, { status: turning, empty: true }, { queue: { entries: [entry('queued')], paused: true } }, { queue: { entries: [entry('queued')], paused: true }, empty: true }, { mode: 'bash', status: turning }];
    for (const c of cases) {
      const d = submitState(input(c));
      expect(['send', 'stop', 'resume']).toContain(d.primary);
      expect(Object.keys(d).sort()).toEqual(['detail', 'enabled', 'label', 'primary', 'reason', 'steer']);
    }
  });

  it('maps a next-step send to next and Send now to now, in one place', () => {
    expect(steerPriority('queue')).toBe('next');
    expect(steerPriority('interrupt_and_send')).toBe('now');
  });
});

// P2-A start (2026-10-09; the execution document §5.4's table): a session with a record and no ready process sends by
// acquiring it, whatever ended its last process (C12's send-to-resume, for every eligible record); `!` and `#` acquire
// too. Only an archived or a foreign-held session refuses.
describe('a session with a record and no ready process: its availability decides Send', () => {
  const exited = (reason: 'budget' | 'stop' | 'crash' | 'archive') => ({ ...idle, process: 'exited' as const, engineState: 'idle' as const, exit: { code: 0, signal: null, reason, at: '2026-09-29T12:00:00.000Z', release: null } });
  const decided = (over: Partial<SubmitInput>) => {
    const d = submitState(input(over));
    return [d.label, d.enabled, d.reason, d.detail, d.steer];
  };

  it.each(['resumable', 'failed', 'needs_trust', 'missing_directory'] as const)('%s: Send is enabled, says it starts the session, and waits for text', (availability) => {
    for (const status of [null, exited('budget'), exited('stop'), exited('crash'), { ...idle, process: 'exiting' as const }]) {
      expect(decided({ availability, status })).toEqual(['Send', true, null, 'Starts this session', false]);
    }
    expect(decided({ availability, status: null, empty: true })).toEqual(['Send', false, null, 'Starts this session', false]);
  });

  it('starting: Send reads Starting… and stays enabled, joining the start in flight', () => {
    expect(decided({ availability: 'starting', status: null })).toEqual(['Starting…', true, null, 'Sends once the session has started', false]);
    expect(decided({ availability: 'starting', status: { ...idle, process: 'initializing' } })).toEqual(['Starting…', true, null, 'Sends once the session has started', false]);
    expect(decided({ availability: 'starting', status: null, empty: true })[1]).toBe(false);
  });

  it('foreign_held: disabled with the holder’s words', () => {
    expect(decided({ availability: 'foreign_held', heldBy: 'terminal · 42', status: null })).toEqual(['Send', false, 'Held by terminal · 42', null, false]);
  });

  it('archived: disabled, nothing unarchived', () => {
    expect(decided({ availability: 'archived', status: exited('archive') })).toEqual(['Send', false, 'Archived · unarchive it to continue', null, false]);
  });

  it('`!` and `#` acquire too, under their own labels', () => {
    expect(decided({ availability: 'resumable', status: null, mode: 'bash' })).toEqual(['Run', true, null, 'Starts this session', false]);
    expect(decided({ availability: 'needs_trust', status: exited('budget'), mode: 'memory' })).toEqual(['Save to memory', true, null, 'Starts this session', false]);
    expect(decided({ availability: 'starting', status: null, mode: 'bash' })).toEqual(['Starting…', true, null, 'Sends once the session has started', false]);
    expect(decided({ availability: 'archived', status: null, mode: 'bash' })[1]).toBe(false);
  });

  it('a ready process decides as before, whatever the digest still says', () => {
    expect(row({ availability: 'resumable' })).toEqual(['send', 'Send', true, null, false]);
    expect(submitState(input({ availability: 'starting' })).detail).toBeNull();
  });
});
// P2-A end
