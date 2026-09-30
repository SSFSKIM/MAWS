// The submit control's state (C7 execution document, "Submit control and queue"): one pure table over C3's status, the
// app queue, the editor and C10's setup intent decides the primary action (Send, Queue, Steer, Stop, Resume), its
// label, whether it is enabled and why not, whether a Stop sits beside it, and the caret menu. First match wins.
// Busy is C3's predicate as the renderer can read it: a turn is open, or an entry is `submitting` or `released` (C3
// opens the turn at the engine's `started`, so between a write and its start the entry is what makes the session busy).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { QueueEntry } from '@shared/engine/session-state-store';

export type SubmitState = 'send' | 'queue' | 'steer' | 'stop' | 'resume';

export interface SubmitInput {
  status: EngineSessionStatus | null;
  intent: { starting: boolean; messageHeld: boolean; phase?: string | null } | null; // non-null while the session is unstarted (C10's hook answers); phase: C10's running setup phase in words
  queue: { entries: readonly QueueEntry[]; paused: boolean };
  empty: boolean;
  mode: 'send' | 'bash' | 'memory';
  steerHeld: boolean; // ⌥ held over the control, or ⌥Enter
  released: boolean; // C12: the session's digest carries the memory budget's released mark (Send resumes it)
}

export interface SubmitMenuItem {
  id: 'queue' | 'steer' | 'interrupt_and_send';
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

// The caret menu while busy: the three ways a message can join a running session, each saying what it does.
const busyMenu = (enabled: boolean): SubmitMenuItem[] => [
  { id: 'queue', label: 'Queue', detail: 'Sends when this turn ends', chord: 'Enter', enabled },
  { id: 'steer', label: 'Steer', detail: 'Adds this to the running turn at its next step', chord: '⌥Enter', enabled },
  { id: 'interrupt_and_send', label: 'Interrupt and send', detail: 'Stops the running turn, then sends this', chord: null, enabled },
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
    return i.steerHeld ? decide('steer', 'Steer', true, null, true, busyMenu(true)) : decide('queue', 'Queue', true, null, true, busyMenu(true));
  }
  if (queue.paused) return empty ? decide('resume', 'Resume', queue.entries.length > 0) : decide('queue', 'Queue', true);
  if (queue.entries.length > 0) return decide('queue', 'Queue', !empty);
  return decide('send', 'Send', !empty);
}

// The one place the priority of each steer lives: Steer folds into the running turn at its next tool boundary;
// Interrupt and send ends the turn and runs the message as its own. Always passed explicitly (the command's default is
// 'now').
export function steerPriority(action: 'steer' | 'interrupt_and_send'): 'next' | 'now' {
  return action === 'steer' ? 'next' : 'now';
}
