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
// UX wave U4a (l3-input-15, l3-input-03; its Interfaces E): the same table decides the glyph the round button draws and
// whether ⌘Enter differs from Enter (it keeps the message for after the running turn); the label stays the button's
// word, its accessible name and its text.
import type { EngineSessionStatus } from '@shared/engine/status';
import type { QueueEntry, QueuePauseReason } from '@shared/engine/session-state-store';
import type { Availability } from '@shared/ipc/schema/session'; // P2-A
import { CHOOSE_PROJECT_FIRST } from '@shared/sessions/intent';

export type SubmitState = 'send' | 'stop' | 'resume' | 'end' /* P5 O16 M3b fix wave 1: session.stop, ending the session */;

// P5 O9 M5: the controls port's `Capability`, spelled here so this module stays free of the port's imports (it is in the
// node project's program, through side/copy.ts)
type DrivenCapability = { available: true } | { available: false; reason: string };

export interface SubmitInput {
  status: EngineSessionStatus | null;
  intent: { starting: boolean; messageHeld: boolean; phase?: string | null; noProject?: boolean } | null; // non-null while the session is unstarted (C10's hook answers); phase: C10's running setup phase in words; noProject: a New chat with no project chosen yet
  queue: { entries: readonly QueueEntry[]; paused: boolean; pauseReason?: QueuePauseReason | null };
  empty: boolean;
  mode: 'send' | 'bash' | 'memory';
  // P2-A: the session's availability (null without a record, an unstarted intent being C10's) and, while a terminal or
  // a background job holds it, the holder in words
  availability: Availability | null;
  heldBy: string | null;
  // P5 O9 M5: a session another process holds and the session's controls port drives (lane A): its turn as that process
  // reports it, and whether Send and Stop may go now, each with its reason. Absent or null: C3's status decides.
  driven?: { running: boolean; send: DrivenCapability; stop: DrivenCapability } | null;
  // P5 O16 M3b fix wave 2: a lane B session on another machine, whose link carries no session.stop
  remote?: boolean;
  // P5 O7 M8: why the mode's command (`!` session.bash, `#` session.memoryAppend) is not offered on the session's machine
  // (lane-b/remote-unavailable.ts); absent or null: it is
  modeUnavailable?: string | null;
  // P5 O7 M8 review: the draft names documents for a session on another machine (uploaded PDFs), so its send is a
  // `session.send` even while a turn runs (a steer carries no uploads) and waits for the turn
  sendsDocuments?: boolean;
  // Board 525: why the member's words don't go to another member's session (its machine refused them at the member's
  // grade), naming whom to ask; absent or null: nothing says so
  closed?: string | null;
  // The UX wave, U9 (S-01): a Stop for the session has been out for more than 300 ms and has not settled
  stopping?: boolean;
  // The UX wave, U9 (the ticket on a pane kept through a link's loss): the session's machine is in its offline phase, with UC-7.5's sentences for Send and Stop;
  // absent or null: it is not (while it connects or reconnects main holds the act, and nothing here changes)
  offline?: { send: string; stop: string } | null;
}

export interface SubmitDecision {
  primary: SubmitState;
  label: string;
  enabled: boolean;
  reason: string | null; // why it is disabled, when that is not just an empty editor
  detail: string | null; // what the primary does, when its label alone would not say
  steer: boolean; // W10: this Send is the `next` steer (`session.steer`), not `session.send`
  glyph: SubmitGlyph; // UX wave U4a: what the button draws (`glyphs.tsx`)
  queues: boolean; // UX wave U4a: ⌘Enter differs from Enter now: a turn runs, the mode is send, and the session keeps MAWS's queue
}

// UX wave U4a (the child's table, l3-input-15): an up arrow to send, a square to stop, the queue mark (the arrow under a
// bar) for a message that will wait, a play triangle to resume, a spinner while the session starts or re-attaches.
export type SubmitGlyph = 'arrow' | 'square' | 'queue' | 'play' | 'spinner';

// UX wave U4a (Interfaces I): the empty box's words while a turn runs, which the composer hands the editor, and the
// refusal of ⌘Enter during a terminal session's turn (MAWS keeps no queue there).
export const PLACEHOLDER_BOTH = 'Enter to send, ⌘Enter to queue for later';
export const PLACEHOLDER_ENTER = 'Enter to send';
export const TERMINAL_KEEPS_NO_QUEUE = 'A terminal session takes a message at its next step; MAWS cannot hold one for after the turn';

export const STARTING = 'Session is starting…';
// P5 O16 M3b: a session a successor engine host adopted, waiting for its engine's re-initialize (as long as the step the
// handover found it in may take)
export const REATTACHING = 'Re-attaching to the engine after the update…';
export const reattaching = (status: EngineSessionStatus | null): boolean => status?.process === 'initializing' && status.holder?.adopted === true;
// Fix wave 1: what the re-attaching state's Stop does (an empty editor: no turn to interrupt, the engine not answering)
export const ENDS_REATTACHING = 'Ends the session; its engine has not answered since the update';
// Fix wave 2: on another machine that Stop is not offered (session.stop is not an act its link carries, O7's surface)
export const REATTACHING_STOP_REMOTE = 'Stopping a re-attaching session on another machine is not available yet';
export const MESSAGE_HELD = 'Your first message is with the setup above';
export const ENDED = 'Session ended';
export const NOT_YET = 'Available once the session starts';
// `!` while busy (architect's ruling on M6): the engine runs it inside the turn and folds its output in.
export const RUNS_NOW = 'Runs now; the model sees the output in this turn';
// P2-A start (2026-10-09; the execution document §5.4): a session with a record and no ready process (C12's
// send-to-resume, for every eligible record)
export const STARTS = 'Starts this session';
export const SENDS_WHEN_STARTED = 'Sends once the session has started';
export const ARCHIVED = 'Archived · unarchive it to continue';
// P2-A end
export const MODES_IN_TERMINAL = 'A terminal session runs `!` and `#` in its terminal'; // P5 O9 M5
export const STOPPING = 'Stopping…'; // the UX wave, U9 (S-01)

export const isBusy = (status: EngineSessionStatus | null, entries: readonly QueueEntry[]): boolean =>
  (status?.turn ?? null) !== null || entries.some((e) => e.state === 'submitting' || e.state === 'released');

// What a Send does when it does not simply send (W10), and what the queue rows' own actions do (W1).
export const SENDS_AT_NEXT_STEP = 'Sends at the next step';
export const SENDS_AFTER_THIS_TURN = 'Sends after this turn'; // P5 O7 M8 review: a remote send naming documents, queued behind the turn
export const SENDS_AFTER_QUEUED = 'Sends after the queued messages'; // idle with messages waiting: a send never overtakes them (C3)
export const JOINS_PAUSED_QUEUE = 'Joins the paused queue; Resume sends it';
export const SENDS_AT_TURN_END = 'Sends when this turn ends'; // a waiting steer's Hold
export const SEND_NOW_DETAIL = 'Stops the running turn, then sends this'; // a row's Send now while busy
export const SENDS_NOW = 'Sends this now'; // a held row's Send now with no turn running (a paused queue at idle)

// Fix wave 1: the re-attaching session's Stop with an empty editor; fix wave 2: disabled on another machine
const endReattaching = (remote: boolean | undefined): Decided => (remote ? decide('end', 'Stop', false, REATTACHING_STOP_REMOTE) : decide('end', 'Stop', true, null, ENDS_REATTACHING));

type Decided = Omit<SubmitDecision, 'glyph' | 'queues'>;
const decide = (primary: SubmitState, label: string, enabled: boolean, reason: string | null = null, detail: string | null = null, steer = false): Decided => ({
  primary,
  label,
  enabled,
  reason,
  detail,
  steer,
});

// P5 O7 M8 review: where a send queued behind the running turn goes, in the queue's own words: a paused queue holds it for
// Resume, whatever the pause (an interrupt's lets a fresh send past only at idle: engine-host queue.ts `submitNow` needs
// `!busy`), and messages waiting go before it
function queuedBehindTurn(queue: SubmitInput['queue']): string {
  if (queue.paused) return JOINS_PAUSED_QUEUE;
  return queue.entries.length > 0 ? SENDS_AFTER_QUEUED : SENDS_AFTER_THIS_TURN;
}

export function submitState(i: SubmitInput): SubmitDecision {
  const decided = decideSubmit(i);
  // a turn runs: the holder's for a driven session, C3's busy predicate over a ready process otherwise
  const running = i.intent === null && (i.driven ? i.driven.running : i.status?.process === 'ready' && isBusy(i.status, i.queue.entries));
  const queues = running && !i.driven && i.mode === 'send' && (i.closed ?? null) === null;
  return { ...decided, glyph: glyphOf(decided, running && i.mode === 'send' && !i.empty), queues };
}

function glyphOf(d: Decided, waits: boolean): SubmitGlyph {
  if (d.primary === 'stop' || d.primary === 'end') return 'square';
  if (d.primary === 'resume') return 'play';
  if (d.label === 'Starting…' || d.label === 'Re-attaching…') return 'spinner';
  return waits && d.enabled ? 'queue' : 'arrow'; // the message will wait (at the next step, or after the turn); a closed Send is the greyed arrow
}

function decideSubmit(i: SubmitInput): Decided {
  const { status, intent, queue, empty, mode } = i;
  if (intent !== null) { // C10: the caller answers the intent while unstarted, even beside a failed setup's exited status
    if (intent.starting || (intent.phase ?? null) !== null) return decide('send', 'Starting…', false, intent.phase ?? STARTING); // C10: the setup phase is the reason
    if (intent.messageHeld) return decide('send', 'Send', false, MESSAGE_HELD);
    if (intent.noProject) return decide('send', 'Send', false, CHOOSE_PROJECT_FIRST); // New chat: the project row's chip chooses one
    if (mode !== 'send') return decide('send', 'Send', false, NOT_YET);
    return decide('send', 'Send', !empty);
  }
  if ((i.closed ?? null) !== null) return decide('send', 'Send', false, i.closed); // board 525: Stop too, whatever the turn
  // The UX wave, U9 (S-01): a Stop on its way for more than 300 ms reads so, disabled, until it settles, whatever the draft
  if (i.stopping) return decide('stop', STOPPING, false, STOPPING);
  // The UX wave, U9 (the ticket on a pane kept through a link's loss): in the machine's offline phase Send and Stop are closed with the phase's sentence
  const offline = i.offline ?? null;
  if (offline !== null && mode === 'send') {
    const running = i.driven ? i.driven.running : isBusy(status, queue.entries);
    return running && empty ? decide('stop', 'Stop', false, offline.stop) : decide('send', 'Send', false, offline.send);
  }
  // P5 O9 M5: driven through its holder (lane A). Send goes in either turn state, never as a steer: the bridge reads words
  // sent while a turn runs at the turn's next model request; with the box empty during a turn, Stop interrupts.
  if (i.driven) {
    const { running, send, stop } = i.driven;
    if (mode !== 'send') return decide('send', mode === 'bash' ? 'Run' : 'Save to memory', false, MODES_IN_TERMINAL);
    // Stop and Send each from its own capability: a bridge may interrupt without taking words, or the reverse
    if (running && empty) return stop.available ? decide('stop', 'Stop', true) : decide('stop', 'Stop', false, stop.reason);
    if (!send.available) return decide('send', 'Send', false, send.reason);
    return decide('send', 'Send', !empty, null, running ? SENDS_AT_NEXT_STEP : null);
  }
  // P5 O7 M8: a mode its machine doesn't offer is greyed with the reason, whatever the turn or the process
  if (mode !== 'send' && (i.modeUnavailable ?? null) !== null) return decide('send', mode === 'bash' ? 'Run' : 'Save to memory', false, i.modeUnavailable);
  // P2-A start: with a record and no ready process the submission acquires the session first (the seam, and `!` and `#`
  // before their own dispatch), joining a start in flight; only an archived or a foreign-held session refuses
  if ((status === null || status.process !== 'ready') && i.availability !== null) {
    const label = mode === 'bash' ? 'Run' : mode === 'memory' ? 'Save to memory' : 'Send';
    if (i.availability === 'archived') return decide('send', label, false, ARCHIVED);
    if (i.availability === 'foreign_held') return decide('send', label, false, `Held by ${i.heldBy ?? 'another process'}`);
    if (i.availability === 'starting' && reattaching(status) && empty) return endReattaching(i.remote); // fix wave 1
    if (i.availability === 'starting') return decide('send', reattaching(status) ? 'Re-attaching…' : 'Starting…', !empty, null, SENDS_WHEN_STARTED);
    return decide('send', label, !empty, null, STARTS);
  }
  // P2-A end
  if (status === null || status.process !== 'ready') {
    const starting = status !== null && (status.process === 'starting' || status.process === 'initializing');
    if (reattaching(status) && empty) return endReattaching(i.remote); // fix wave 1
    return decide('send', 'Send', false, reattaching(status) ? REATTACHING : starting ? STARTING : ENDED);
  }
  const busy = isBusy(status, queue.entries);
  if (mode === 'bash') return decide('send', 'Run', !empty, null, busy ? RUNS_NOW : null);
  if (mode === 'memory') return decide('send', 'Save to memory', !empty);
  if (busy && empty) return decide('stop', 'Stop', true);
  if (busy && i.sendsDocuments) return decide('send', 'Send', true, null, queuedBehindTurn(queue));
  if (busy) return decide('send', 'Send', true, null, SENDS_AT_NEXT_STEP, true);
  // Stop holds the older queued text, not a fresh instruction. Other pauses keep new text behind the held entries.
  if (queue.paused && (!empty || queue.entries.length > 0)) return empty ? decide('resume', 'Resume', true) : decide('send', 'Send', true, null, queue.pauseReason === 'interrupt' ? SENDS_NOW : JOINS_PAUSED_QUEUE);
  if (queue.entries.length > 0) return decide('send', 'Send', !empty, null, SENDS_AFTER_QUEUED);
  return decide('send', 'Send', !empty);
}

// The one place the priority of each steer lives: a Send while a turn runs and a held row's "Send at the next step"
// fold into the running turn at its next tool boundary; Esc and a row's Send now end the turn and run the message as
// its own. Always passed explicitly (the command's default is 'now').
export function steerPriority(action: 'queue' | 'interrupt_and_send'): 'next' | 'now' {
  return action === 'queue' ? 'next' : 'now';
}
