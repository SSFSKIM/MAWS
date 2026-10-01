// The submit control's state (C7 execution document, "Submit control and queue"): one pure table over C3's status, the
// app queue, the editor and C10's setup intent decides the primary action (Send, Queue, Hold, Stop, Resume), its
// label, whether it is enabled and why not, whether a Stop sits beside it, and the caret menu. First match wins.
// W1 (charter §4.2 and §5.4 as amended 2026-10-01): while a turn runs the control reads Queue, and Enter sends the
// message as a `next` steer, which the engine delivers at the turn's next tool boundary as the terminal does; ⌥ held
// turns it into Hold, which keeps the message in MAWS's queue until the turn ends; Send now (the caret menu) stops the
// turn and sends it at once.
// Busy is C3's predicate as the renderer can read it: a turn is open, or an entry is `submitting` or `released` (C3
// opens the turn at the engine's `started`, so between a write and its start the entry is what makes the session busy).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { QueueEntry } from '@shared/engine/session-state-store';

export type SubmitState = 'send' | 'queue' | 'hold' | 'stop' | 'resume'; // queue: a `next` steer; hold: MAWS's queue (W1)

export interface SubmitInput {
  status: EngineSessionStatus | null;
  intent: { starting: boolean; messageHeld: boolean; phase?: string | null } | null; // non-null while the session is unstarted (C10's hook answers); phase: C10's running setup phase in words
  queue: { entries: readonly QueueEntry[]; paused: boolean };
  empty: boolean;
  mode: 'send' | 'bash' | 'memory';
  holdHeld: boolean; // ⌥ held over the control, or ⌥Enter (W1: Hold until the turn ends)
  released: boolean; // C12: the session's digest carries the memory budget's released mark (Send resumes it)
}

export interface SubmitMenuItem {
  id: 'queue' | 'hold' | 'interrupt_and_send';
  label: string;
  detail: string;
  chord: string | null;
  enabled: boolean;
}

export interface SubmitDecision {
  primary: SubmitState;
  label: string;
  enabled: boolean;
  reason: string | null; // why it is disabled, when that is not just an empty editor
  detail: string | null; // what the primary does, when its label alone would not say
  secondaryStop: boolean;
  menu: SubmitMenuItem[];
}

export const STARTING = 'Session is starting…';
export const MESSAGE_HELD = 'Your first message is with the setup above';
export const ENDED = 'Session ended';
export const NOT_YET = 'Available once the session starts';
// `!` while busy (architect's ruling on M6): the engine runs it inside the turn and folds its output in.
export const RUNS_NOW = 'Runs now; the model sees the output in this turn';
// C12 start: a session released under the memory budget (C12 execution document, "Send-to-resume")
export const RESUMES = 'Resumes this session';
export const RESUME_FIRST = 'Send a message to resume this session first';
// C12 end

export const isBusy = (status: EngineSessionStatus | null, entries: readonly QueueEntry[]): boolean =>
  (status?.turn ?? null) !== null || entries.some((e) => e.state === 'submitting' || e.state === 'released');

// The caret menu while busy: the three ways a message can join a running session, each saying what it does (W1).
export const SENDS_AT_NEXT_STEP = 'Sends at the next step';
export const SENDS_AT_TURN_END = 'Sends when this turn ends';
export const SEND_NOW_DETAIL = 'Stops the running turn, then sends this';
const busyMenu = (enabled: boolean): SubmitMenuItem[] => [
  { id: 'queue', label: 'Queue', detail: SENDS_AT_NEXT_STEP, chord: 'Enter', enabled },
  { id: 'hold', label: 'Hold until the turn ends', detail: SENDS_AT_TURN_END, chord: '⌥Enter', enabled },
  { id: 'interrupt_and_send', label: 'Send now', detail: SEND_NOW_DETAIL, chord: null, enabled },
];

const decide = (primary: SubmitState, label: string, enabled: boolean, reason: string | null = null, secondaryStop = false, menu: SubmitMenuItem[] = []): SubmitDecision => ({
  primary,
  label,
  enabled,
  reason,
  secondaryStop,
  menu,
  detail: null,
});

export function submitState(i: SubmitInput): SubmitDecision {
  const { status, intent, queue, empty, mode } = i;
  if (intent !== null) { // C10: the caller answers the intent while unstarted, even beside a failed setup's exited status
    if (intent.starting || (intent.phase ?? null) !== null) return decide('send', 'Starting…', false, intent.phase ?? STARTING); // C10: the setup phase is the reason
    if (intent.messageHeld) return decide('send', 'Send', false, MESSAGE_HELD);
    if (mode !== 'send') return decide('send', 'Send', false, NOT_YET);
    return decide('send', 'Send', !empty);
  }
  // C12 start: a released session with no live process sends to resume it through C10's resume; `!` and `#` wait for the
  // process. A release still exiting falls to the rule below (refused, the draft kept) until its status reads exited.
  if (i.released && (status === null || status.process === 'exited')) {
    if (mode !== 'send') return decide('send', 'Send', false, RESUME_FIRST);
    return { ...decide('send', 'Send', !empty), detail: RESUMES };
  }
  // C12 end
  if (status === null || status.process !== 'ready') {
    const starting = status !== null && (status.process === 'starting' || status.process === 'initializing');
    return decide('send', 'Send', false, starting ? STARTING : ENDED);
  }
  const turnOpen = status.turn !== null;
  if (mode === 'bash') return { ...decide('send', 'Run', !empty, null, turnOpen), detail: isBusy(status, queue.entries) ? RUNS_NOW : null };
  if (mode === 'memory') return decide('send', 'Save to memory', !empty, null, turnOpen);
  if (isBusy(status, queue.entries)) {
    if (empty) return decide('stop', 'Stop', true, null, false, busyMenu(false)); // the menu stays, each item waiting for text
    return i.holdHeld ? { ...decide('hold', 'Hold', true, null, true, busyMenu(true)), detail: SENDS_AT_TURN_END } : { ...decide('queue', 'Queue', true, null, true, busyMenu(true)), detail: SENDS_AT_NEXT_STEP };
  }
  // Idle with messages waiting in MAWS's queue (paused, or about to be released): a new one joins them there.
  if (queue.paused) return empty ? decide('resume', 'Resume', queue.entries.length > 0) : decide('hold', 'Queue', true);
  if (queue.entries.length > 0) return decide('hold', 'Queue', !empty);
  return decide('send', 'Send', !empty);
}

// The one place the priority of each steer lives: Queue (Enter while a turn runs) folds into the running turn at its
// next tool boundary; Send now ends the turn and runs the message as its own. Always passed explicitly (the command's
// default is 'now').
export function steerPriority(action: 'queue' | 'interrupt_and_send'): 'next' | 'now' {
  return action === 'queue' ? 'next' : 'now';
}
