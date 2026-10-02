// The submit control's state (C7 execution document, "Submit control and queue"): one pure table over C3's status, the
// app queue, the editor and C10's setup intent decides the one button (Send, Stop, Resume; Run, Save to memory and
// Starting… where the mode or the setup names it), its label, whether it is enabled and why not, and what it does when
// the label alone would not say. First match wins.
// W10 (charter §4.2 and §5.4 as amended 2026-10-01, the owner's "Just keep 'Send' only"): with text in the box the
// control is Send, which while a turn runs is the `next` steer the engine delivers at the turn's next tool boundary, as
// the terminal does; with the box empty during a turn it is Stop; on a paused queue, Resume. There is no hold, no send
// menu and no Stop beside it: Esc interrupts and sends the queued head now, and the queue rows keep their own actions.
// Busy is C3's predicate as the renderer can read it: a turn is open, or an entry is `submitting` or `released` (C3
// opens the turn at the engine's `started`, so between a write and its start the entry is what makes the session busy).
import type { EngineSessionStatus } from '@shared/engine/status';
import type { QueueEntry } from '@shared/engine/session-state-store';
import { CHOOSE_PROJECT_FIRST } from '@shared/sessions/intent';

export type SubmitState = 'send' | 'stop' | 'resume';

export interface SubmitInput {
  status: EngineSessionStatus | null;
  intent: { starting: boolean; messageHeld: boolean; phase?: string | null; noProject?: boolean } | null; // non-null while the session is unstarted (C10's hook answers); phase: C10's running setup phase in words; noProject: a New chat with no project chosen yet
  queue: { entries: readonly QueueEntry[]; paused: boolean };
  empty: boolean;
  mode: 'send' | 'bash' | 'memory';
  released: boolean; // C12: the session's digest carries the memory budget's released mark (Send resumes it)
}

export interface SubmitDecision {
  primary: SubmitState;
  label: string;
  enabled: boolean;
  reason: string | null; // why it is disabled, when that is not just an empty editor
  detail: string | null; // what the primary does, when its label alone would not say
  steer: boolean; // W10: this Send is the `next` steer (`session.steer`), not `session.send`
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

// What a Send does when it does not simply send (W10), and what the queue rows' own actions do (W1).
export const SENDS_AT_NEXT_STEP = 'Sends at the next step';
export const SENDS_AFTER_QUEUED = 'Sends after the queued messages'; // idle with messages waiting: a send never overtakes them (C3)
export const JOINS_PAUSED_QUEUE = 'Joins the paused queue; Resume sends it';
export const SENDS_AT_TURN_END = 'Sends when this turn ends'; // a waiting steer's Hold
export const SEND_NOW_DETAIL = 'Stops the running turn, then sends this'; // a row's Send now while busy
export const SENDS_NOW = 'Sends this now'; // a held row's Send now with no turn running (a paused queue at idle)

const decide = (primary: SubmitState, label: string, enabled: boolean, reason: string | null = null, detail: string | null = null, steer = false): SubmitDecision => ({
  primary,
  label,
  enabled,
  reason,
  detail,
  steer,
});

export function submitState(i: SubmitInput): SubmitDecision {
  const { status, intent, queue, empty, mode } = i;
  if (intent !== null) { // C10: the caller answers the intent while unstarted, even beside a failed setup's exited status
    if (intent.starting || (intent.phase ?? null) !== null) return decide('send', 'Starting…', false, intent.phase ?? STARTING); // C10: the setup phase is the reason
    if (intent.messageHeld) return decide('send', 'Send', false, MESSAGE_HELD);
    if (intent.noProject) return decide('send', 'Send', false, CHOOSE_PROJECT_FIRST); // New chat: the project row's chip chooses one
    if (mode !== 'send') return decide('send', 'Send', false, NOT_YET);
    return decide('send', 'Send', !empty);
  }
  // C12 start: a released session with no live process sends to resume it through C10's resume; `!` and `#` wait for the
  // process. A release still exiting falls to the rule below (refused, the draft kept) until its status reads exited.
  if (i.released && (status === null || status.process === 'exited')) {
    if (mode !== 'send') return decide('send', 'Send', false, RESUME_FIRST);
    return decide('send', 'Send', !empty, null, RESUMES);
  }
  // C12 end
  if (status === null || status.process !== 'ready') {
    const starting = status !== null && (status.process === 'starting' || status.process === 'initializing');
    return decide('send', 'Send', false, starting ? STARTING : ENDED);
  }
  const busy = isBusy(status, queue.entries);
  if (mode === 'bash') return decide('send', 'Run', !empty, null, busy ? RUNS_NOW : null);
  if (mode === 'memory') return decide('send', 'Save to memory', !empty);
  if (busy) return empty ? decide('stop', 'Stop', true) : decide('send', 'Send', true, null, SENDS_AT_NEXT_STEP, true);
  // Idle with messages waiting in MAWS's queue (paused, or about to be released): Send puts the new one behind them.
  if (queue.paused) return empty ? decide('resume', 'Resume', queue.entries.length > 0) : decide('send', 'Send', true, null, JOINS_PAUSED_QUEUE);
  if (queue.entries.length > 0) return decide('send', 'Send', !empty, null, SENDS_AFTER_QUEUED);
  return decide('send', 'Send', !empty);
}

// The one place the priority of each steer lives: a Send while a turn runs and a held row's "Send at the next step"
// fold into the running turn at its next tool boundary; Esc and a row's Send now end the turn and run the message as
// its own. Always passed explicitly (the command's default is 'now').
export function steerPriority(action: 'queue' | 'interrupt_and_send'): 'next' | 'now' {
  return action === 'queue' ? 'next' : 'now';
}
