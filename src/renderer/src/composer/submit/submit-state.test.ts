import { describe, expect, it } from 'vitest';
import type { QueueEntry } from '@shared/engine/session-state-store';
import type { AppSessionId } from '@shared/graph/ids';
import { humanTurn, status } from '../../../../../test/support/builders';
import { isBusy, REATTACHING_STOP_REMOTE, SENDS_AFTER_THIS_TURN, steerPriority, submitState, type SubmitInput } from './submit-state';

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
    expect(row({ queue: { entries: [], paused: true }, empty: true })).toEqual(['send', 'Send', false, null, false]);
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

  it('l2-transcript-15: an idle fresh Send after Stop says it sends now, without offering to resume older held text', () => {
    for (const entries of [[], [entry('queued')]]) {
      const queue = { entries, paused: true, pauseReason: 'interrupt' as const };
      expect(submitState(input({ queue }))).toMatchObject({ primary: 'send', label: 'Send', enabled: true, steer: false, detail: 'Sends this now' });
      expect(submitState(input({ queue, empty: true }))).toMatchObject({ primary: entries.length > 0 ? 'resume' : 'send', enabled: entries.length > 0 });
    }
  });

  it('decides only Send, Stop and Resume, with a glyph and whether ⌘Enter queues (W10: no hold, no queue primary, no menu, no Stop beside it)', () => {
    const cases: Partial<SubmitInput>[] = [{}, { empty: true }, { status: turning }, { status: turning, empty: true }, { queue: { entries: [entry('queued')], paused: true } }, { queue: { entries: [entry('queued')], paused: true }, empty: true }, { mode: 'bash', status: turning }];
    for (const c of cases) {
      const d = submitState(input(c));
      expect(['send', 'stop', 'resume']).toContain(d.primary);
      expect(Object.keys(d).sort()).toEqual(['detail', 'enabled', 'glyph', 'label', 'primary', 'queues', 'reason', 'steer']); // UX wave U4a: the glyph and ⌘Enter's queue
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

  // P5 O16 M3b: a session a successor engine host adopted waits for its engine's re-initialize, which can take as long
  // as the step it was in; it says so, and a Send joins it as a start's does
  it('re-attaching: an adopted session not yet ready reads Re-attaching…, and Send joins it', () => {
    const adopting = { ...idle, process: 'initializing' as const, holder: { pid: 4100, holderId: 'L-1', adopted: true } };
    expect(decided({ availability: 'starting', status: adopting })).toEqual(['Re-attaching…', true, null, 'Sends once the session has started', false]);
    expect(row({ status: adopting, availability: null })).toEqual(['send', 'Send', false, 'Re-attaching to the engine after the update…', false]);
    // fix wave 1: with the editor empty, Stop ends the session (no turn to interrupt while it re-attaches)
    expect(row({ status: adopting, availability: 'starting', empty: true })).toEqual(['end', 'Stop', true, null, false]);
    expect(row({ status: adopting, availability: null, empty: true })).toEqual(['end', 'Stop', true, null, false]);
    expect(row({ status: { ...idle, process: 'initializing' }, availability: 'starting', empty: true })[0]).toBe('send'); // a plain start keeps its Starting…
    // fix wave 2: a session on another machine has no session.stop on its link: the control says so, disabled
    expect(row({ status: adopting, availability: 'starting', empty: true, remote: true })).toEqual(['end', 'Stop', false, REATTACHING_STOP_REMOTE, false]);
    expect(row({ status: adopting, availability: null, empty: true, remote: true })).toEqual(['end', 'Stop', false, REATTACHING_STOP_REMOTE, false]);
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

// P5 O9 M5: a session another process holds and a port drives (lane A): its turn is the holder's, Send goes in either
// turn state (the bridge reads a message sent while a turn runs at its next model request), Stop interrupts.
describe('a session driven through its holder (lane A)', () => {
  const open = { available: true } as const;
  const shut = (reason: string) => ({ available: false, reason }) as const;
  const driven = (running: boolean, over: Partial<NonNullable<SubmitInput['driven']>> = {}) => ({ running, send: open, stop: running ? open : shut('Nothing is running'), ...over });
  const decided = (over: Partial<SubmitInput>) => {
    const d = submitState(input({ status: null, availability: 'foreign_held', heldBy: 'terminal · 42', ...over }));
    return [d.primary, d.label, d.enabled, d.reason, d.detail, d.steer];
  };

  it('sends while idle, and while a turn runs says the words are read at its next step, never as a steer', () => {
    expect(decided({ driven: driven(false) })).toEqual(['send', 'Send', true, null, null, false]);
    expect(decided({ driven: driven(false), empty: true })).toEqual(['send', 'Send', false, null, null, false]);
    expect(decided({ driven: driven(true) })).toEqual(['send', 'Send', true, null, 'Sends at the next step', false]);
  });

  it('is Stop on an empty box while a turn runs, drawn from interrupt alone: disabled with its reason when the bridge can’t', () => {
    expect(decided({ driven: driven(true), empty: true })).toEqual(['stop', 'Stop', true, null, null, false]);
    expect(decided({ driven: driven(true, { stop: shut('Not in this session’s sminos') }), empty: true })).toEqual(['stop', 'Stop', false, 'Not in this session’s sminos', null, false]);
    // a bridge that interrupts but takes no words: Stop still goes
    expect(decided({ driven: driven(true, { send: shut('Not in this session’s sminos (1.10.0)') }), empty: true })).toEqual(['stop', 'Stop', true, null, null, false]);
  });

  it('says why Send is closed, and that `!` and `#` run in the terminal', () => {
    expect(decided({ driven: driven(false, { send: shut('Not in this session’s sminos (1.10.0)') }) })).toEqual(['send', 'Send', false, 'Not in this session’s sminos (1.10.0)', null, false]);
    expect(decided({ driven: driven(false), mode: 'bash' })).toEqual(['send', 'Run', false, 'A terminal session runs `!` and `#` in its terminal', null, false]);
    expect(decided({ driven: driven(false), mode: 'memory' })[2]).toBe(false);
  });
});

// Board 525: another member's session whose machine refused the member's words at their grade: Send is closed with why
// and whom to ask, on either lane, in every turn state (Stop too: below Converse the machine takes no interrupt either).
describe('a session the member can read but not talk to', () => {
  const closed = 'You can read this session but not talk to its agent. Ask Ana for Converse.';
  it('closes Send with the words, idle or running, empty or not, lane A or lane B', () => {
    const shut = ['send', 'Send', false, closed, false];
    expect(row({ closed })).toEqual(shut);
    expect(row({ closed, status: turning, empty: true })).toEqual(shut);
    expect(row({ closed, status: null, availability: 'foreign_held', driven: { running: true, send: { available: true }, stop: { available: true } } })).toEqual(shut);
    expect(row({ closed: null })).toEqual(['send', 'Send', true, null, false]);
  });
});

// P5 O7 M8 ("The offer audit and its contract"): `session.bash` and `session.memoryAppend` are declared not offered on
// another machine (REMOTE_UNAVAILABLE); the composer answers why for the mode it is in, and Run and Save to memory are
// greyed with those words, ready, busy, or with no ready process to acquire
describe('a mode not offered on the session’s machine', () => {
  const words = 'Not on another machine yet: ! shell commands';
  it('greys Run and Save to memory with the reason, whatever the turn or the process', () => {
    expect(row({ mode: 'bash', modeUnavailable: words })).toEqual(['send', 'Run', false, words, false]);
    expect(row({ mode: 'memory', modeUnavailable: words })).toEqual(['send', 'Save to memory', false, words, false]);
    expect(row({ mode: 'bash', status: turning, modeUnavailable: words })).toEqual(['send', 'Run', false, words, false]);
    expect(row({ mode: 'bash', status: null, availability: 'usable', modeUnavailable: words })).toEqual(['send', 'Run', false, words, false]);
  });

  it('leaves Send and the modes with no reason as they were', () => {
    expect(row({ mode: 'send', modeUnavailable: words })).toEqual(['send', 'Send', true, null, false]);
    expect(row({ mode: 'bash', modeUnavailable: null })).toEqual(['send', 'Run', true, null, false]);
  });
});

// P5 O7 M8 review (the architect's option (a)): a remote send naming uploaded PDFs is a `session.send` even while a turn
// runs (a steer carries no uploads), so it waits for the turn; the control says so, and is not the steer
describe('a send carrying documents while a turn runs', () => {
  it('reads “Sends after this turn”, not the next-step steer', () => {
    const d = submitState(input({ status: turning, sendsDocuments: true }));
    expect([d.primary, d.label, d.enabled, d.reason, d.detail, d.steer]).toEqual(['send', 'Send', true, null, SENDS_AFTER_THIS_TURN, false]);
    expect(SENDS_AFTER_THIS_TURN).toBe('Sends after this turn');
  });

  // review 2: the queue's own words where they say more: a paused queue holds it for Resume, whatever the pause (an
  // interrupt's pause lets a fresh send past only at idle: engine-host queue.ts `submitNow` needs `!busy`), and messages
  // waiting go first
  it('says a paused queue holds it, and that waiting messages go first', () => {
    const detail = (queue: SubmitInput['queue']) => submitState(input({ status: turning, sendsDocuments: true, queue })).detail;
    expect(detail({ entries: [], paused: true, pauseReason: 'user' })).toBe('Joins the paused queue; Resume sends it');
    expect(detail({ entries: [entry('queued')], paused: true, pauseReason: 'user' })).toBe('Joins the paused queue; Resume sends it');
    expect(detail({ entries: [entry('queued')], paused: true, pauseReason: 'interrupt' })).toBe('Joins the paused queue; Resume sends it');
    expect(detail({ entries: [], paused: true, pauseReason: 'interrupt' })).toBe('Joins the paused queue; Resume sends it');
    expect(detail({ entries: [entry('queued')], paused: false })).toBe('Sends after the queued messages');
    expect(submitState(input({ status: turning, sendsDocuments: true, queue: { entries: [entry('queued')], paused: false } })).steer).toBe(false);
  });

  it('changes nothing idle, on an empty box, or without documents', () => {
    expect(submitState(input({ sendsDocuments: true })).detail).toBeNull();
    expect(submitState(input({ status: turning, empty: true, sendsDocuments: true })).primary).toBe('stop');
    expect(submitState(input({ status: turning })).steer).toBe(true);
  });
});

// The UX wave, U9 (S-01 and the ticket on a pane kept through a link's loss; docs/doperpowers/plans/2026-11-12-ux-wave-U9-other-machines.md, M3): a Stop out for
// more than 300 ms reads "Stopping…" and is disabled until it settles, whatever the draft; in its machine's offline phase
// Send and Stop are disabled with UC-7.5's sentence (while it connects or reconnects nothing here changes: main holds the act).
describe('Stopping…, and the offline phase of another machine', () => {
  const offline = { send: 'Send is unavailable while mini is offline.', stop: 'Stop is unavailable while mini is offline.' };

  it('reads Stopping…, disabled, while a Stop is on its way, whatever the turn or the draft', () => {
    expect(row({ status: turning, empty: true, stopping: true })).toEqual(['stop', 'Stopping…', false, 'Stopping…', false]);
    expect(row({ status: turning, empty: false, stopping: true })[1]).toBe('Stopping…');
    expect(row({ status: idle, empty: true, stopping: true })[1], 'the turn ended before the act settled').toBe('Stopping…');
    expect(row({ status: turning, empty: true, stopping: true, offline })[1], 'a Stop held into the offline phase still reads Stopping…').toBe('Stopping…');
  });

  it('closes Stop and Send with the phase’s sentence while the machine is offline', () => {
    expect(row({ status: turning, empty: true, offline })).toEqual(['stop', 'Stop', false, offline.stop, false]);
    expect(row({ status: turning, empty: false, offline })).toEqual(['send', 'Send', false, offline.send, false]);
    expect(row({ status: idle, empty: false, offline })).toEqual(['send', 'Send', false, offline.send, false]);
    expect(row({ status: null, availability: 'usable', empty: false, offline }), 'a released session, which a Send would start there').toEqual(['send', 'Send', false, offline.send, false]);
    const driven = { running: true, send: { available: true } as const, stop: { available: true } as const };
    expect(row({ status: null, availability: 'foreign_held', heldBy: 'terminal · 42', driven, empty: true, offline }), 'a terminal session there').toEqual(['stop', 'Stop', false, offline.stop, false]);
  });

  it('changes nothing without either', () => {
    expect(row({ status: turning, empty: true, stopping: false, offline: null })).toEqual(['stop', 'Stop', true, null, false]);
  });
});

// UX wave U4a (l3-input-15, l3-input-03; the execution document's Interfaces E): the glyph the one button draws, and
// whether ⌘Enter differs from Enter, decided in the same table. The label stays the button's word as before.
describe('the glyph and whether ⌘Enter queues', () => {
  const drawn = (over: Partial<SubmitInput>) => {
    const d = submitState(input(over));
    return [d.glyph, d.label, d.queues];
  };
  const paused = { entries: [entry('queued')], paused: true };

  it('draws the arrow to send, the square to stop, the queue mark for text while a turn runs, play to resume', () => {
    expect(drawn({})).toEqual(['arrow', 'Send', false]);
    expect(drawn({ empty: true })).toEqual(['arrow', 'Send', false]); // nothing to send: the same arrow, greyed
    expect(drawn({ status: turning, empty: true })).toEqual(['square', 'Stop', true]);
    expect(drawn({ status: turning })).toEqual(['queue', 'Send', true]);
    expect(drawn({ queue: { entries: [entry('submitting')], paused: false } })).toEqual(['queue', 'Send', true]); // busy before the turn opens
    expect(drawn({ queue: paused, empty: true })).toEqual(['play', 'Resume', false]);
    expect(drawn({ queue: paused })).toEqual(['arrow', 'Send', false]);
    expect(drawn({ status: turning, queue: paused })).toEqual(['queue', 'Send', true]); // a paused queue holds a ⌘Enter too
  });

  it('keeps the arrow for `!` and `#`, which ⌘Enter does not queue', () => {
    expect(drawn({ mode: 'bash', status: turning })).toEqual(['arrow', 'Run', false]);
    expect(drawn({ mode: 'memory', status: turning })).toEqual(['arrow', 'Save to memory', false]);
    expect(drawn({ mode: 'bash' })).toEqual(['arrow', 'Run', false]);
  });

  it('spins while the session starts or re-attaches, and squares the re-attaching Stop', () => {
    const intent = { starting: true, messageHeld: false };
    expect(drawn({ status: null, intent })).toEqual(['spinner', 'Starting…', false]);
    expect(drawn({ status: null, intent: { starting: false, messageHeld: true, phase: 'Creating worktree one…' } })).toEqual(['spinner', 'Starting…', false]);
    expect(drawn({ status: null, intent: { starting: false, messageHeld: false } })).toEqual(['arrow', 'Send', false]);
    expect(drawn({ status: null, availability: 'starting' })).toEqual(['spinner', 'Starting…', false]);
    const adopting = { ...idle, process: 'initializing' as const, holder: { pid: 4100, holderId: 'L-1', adopted: true } };
    expect(drawn({ status: adopting, availability: 'starting' })).toEqual(['spinner', 'Re-attaching…', false]);
    expect(drawn({ status: adopting, availability: 'starting', empty: true })).toEqual(['square', 'Stop', false]);
    expect(drawn({ status: null, availability: 'resumable' })).toEqual(['arrow', 'Send', false]);
  });

  it('marks a remote send naming documents during a turn with the queue mark: it waits too', () => {
    expect(drawn({ status: turning, sendsDocuments: true })).toEqual(['queue', 'Send', true]);
  });

  it('draws a terminal session’s send during its turn with the queue mark, and never queues ⌘Enter there', () => {
    const open = { available: true } as const;
    const driven = (running: boolean) => ({ running, send: open, stop: open });
    const terminal = (over: Partial<SubmitInput>) => drawn({ status: null, availability: 'foreign_held', heldBy: 'terminal · 42', ...over });
    expect(terminal({ driven: driven(true) })).toEqual(['queue', 'Send', false]);
    expect(terminal({ driven: driven(true), empty: true })).toEqual(['square', 'Stop', false]);
    expect(terminal({ driven: driven(false) })).toEqual(['arrow', 'Send', false]);
    expect(terminal({ driven: { ...driven(true), send: { available: false, reason: 'Not in this session’s sminos' } } })).toEqual(['arrow', 'Send', false]); // closed: greyed, not the mark
  });

  it('closes both on a session the member may only read', () => {
    expect(drawn({ status: turning, closed: 'You can read this session but not talk to its agent.' })).toEqual(['arrow', 'Send', false]);
  });
});
