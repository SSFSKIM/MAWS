// The live caller of the arrivals reader (UX wave U3, UC-2; docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md,
// M4 and Interfaces E): what a session MAWS runs carries from elsewhere, read off the main lane's frames in order, and
// how a background task's end is kept until the model is told. A background command's or monitor's end reaches the wire
// as `system/task_notification` when the task ends; the model is told later, at the head of a turn the engine opens (no
// `user` frame says so when the session was idle) or by a replayed `user` frame at a tool boundary. So the end is kept:
// its line is placed when an engine turn opens, settled when that turn's result names its run, withdrawn when it does
// not (a later turn places it anew), and given up when the engine next goes idle after a turn that did not name it.
// "Place" is the notice's synthetic message; "withdraw" is a message under the same uuid with an empty `arrival`
// (decision 8: under one uuid the first carrier stands, so a line is always withdrawn before it is placed again). All of
// it is state in the normaliser's own (`NormalizerState.arrivals`): a journal replayed through a fresh normaliser gives
// the same events. Pure: no clock, nothing outside the rows.
import { nothingOpen, readNext, turnOriginOf, type Arrival, type CarriedArrival, type OpenArrivals } from '@shared/engine/arrival';
import type { EventPayload } from '@shared/graph/events';
import type { MessageUuid } from '@shared/graph/ids';
import type { Attribution, EventSink } from './normalizer-support';

type Task = Extract<Arrival, { class: 'task' }>;

/** A task's end the wire told before the model was: its run, the `system/task_notification` frame's uuid and `seq`. */
export interface KeptNotice {
  runId: string;
  messageUuid: MessageUuid;
  arrival: Task;
  seq: number;
}

export interface LiveArrivals {
  /** What the reader left open after the main lane's frames so far (rule 5). */
  open: OpenArrivals;
  /** The ends not yet told, oldest first. */
  kept: KeptNotice[];
  /** The run of the kept notice whose line stands on the open turn. */
  placed: string | null;
  /** A scheduled fire whose turn has not opened: its `command_uuid` (the uuid of the file's row). */
  fire: MessageUuid | null;
  /** The `seq` at which the last turn opened. */
  turnOpenedAt: number | null;
  /** The command outputs mapped in this launch, by uuid: the engine sends one again under the same uuid. */
  commandOutputs: Set<string>;
  /**
   * The open turn: whether it opened with no prompt of the person's (at `system/init`, or by an arrival when none was
   * open), the arrival at its head (such a turn's only), and whether it has had main-lane model output or a tool frame.
   * Null while no turn is open.
   */
  head: { engine: boolean; arrival: Arrival | null; output: boolean } | null;
}

export const noLiveArrivals = (): LiveArrivals => ({ open: nothingOpen, kept: [], placed: null, fire: null, turnOpenedAt: null, commandOutputs: new Set(), head: null });

const MAIN: Attribution = { parentToolUseId: null, agentId: null };

/** The arrivals one main-lane frame carries, in order; the reader's state moves on. */
export function readFrame(state: LiveArrivals, frame: unknown): Arrival[] {
  const read = readNext(frame, state.open);
  state.open = read.open;
  return read.arrivals;
}

/** A `system/task_notification` frame the reader made an arrival of (a background command or monitor that ended): kept, nothing drawn. */
export function keep(state: LiveArrivals, arrivals: Arrival[], messageUuid: MessageUuid, seq: number): void {
  for (const arrival of arrivals) if (arrival.class === 'task' && arrival.runId !== null) state.kept.push({ runId: arrival.runId, messageUuid, arrival, seq });
}

/** A scheduled fire's `started` lifecycle: its turn opens at the next engine turn. */
export function scheduleFire(state: LiveArrivals, arrivals: Arrival[], commandUuid: MessageUuid): void {
  if (arrivals.some((arrival) => arrival.class === 'schedule')) state.fire = commandUuid;
}

/** `system/init` opened an engine turn: the fire's line, else the oldest kept end's, stands at its head. */
export function engineTurnOpened(state: LiveArrivals, seq: number, out: EventSink): void {
  state.turnOpenedAt = seq;
  state.head = { engine: true, arrival: null, output: false };
  if (state.fire !== null) {
    const arrival: CarriedArrival = { class: 'schedule', prompt: null };
    out.emit(carried(state.fire, '', [arrival]), MAIN);
    state.head.arrival = arrival;
    state.fire = null;
    return;
  }
  const oldest = state.kept[0];
  if (oldest !== undefined) place(state, oldest, out);
}

/**
 * A peer's or the person's message opened a turn when none was open (no `system/init` before it; no recorded session
 * shows one, so this is a guard): the turn's head, and the `seq` the next idle bounds by. Nothing is placed on it.
 */
export function arrivalTurnOpened(state: LiveArrivals, seq: number): void {
  if (state.head !== null) return;
  state.turnOpenedAt = seq;
  state.head = { engine: true, arrival: null, output: false };
}

/** The person's prompt opened a turn: nothing is placed on it. */
export function personsTurnOpened(state: LiveArrivals, seq: number): void {
  state.turnOpenedAt = seq;
  state.head = { engine: false, arrival: null, output: false };
}

/** Main-lane model output or a tool frame: what arrives after it is no longer at the turn's head. */
export function output(state: LiveArrivals): void {
  if (state.head !== null) state.head.output = true;
}

/** Whether an arrival now stands at the head of a turn the engine opened. */
export const atEngineHead = (state: LiveArrivals): boolean => state.head !== null && state.head.engine && !state.head.output;

/**
 * Whether an arrival at the head opens the turn of its class in the place of the engine's: only while that turn holds
 * no arrival yet (decision 6 replaces a turn that held nothing). A second arrival at the head joins the turn the first
 * one opened: one engine init, reply and result is one turn.
 */
export const opensAtHead = (state: LiveArrivals): boolean => atEngineHead(state) && state.head!.arrival === null;

/** Records the arrival at the head of the engine's turn, the first one only. */
export function headed(state: LiveArrivals, arrival: Arrival): void {
  if (opensAtHead(state)) state.head!.arrival = arrival;
}

/**
 * A main-lane `user` frame that is no tool result, before its own events (Interfaces E, the two rows of a replayed frame).
 * A task end it tells is no longer kept; the placed line is withdrawn when it is that end's, or when the turn has had no
 * output, which makes the turn this frame's (the notice that was placed stays kept for a later turn).
 */
export function userFrame(state: LiveArrivals, arrivals: Arrival[], out: EventSink): void {
  const told = new Set(arrivals.flatMap((arrival) => (arrival.class === 'task' && arrival.runId !== null ? [arrival.runId] : [])));
  if (state.placed !== null && (told.has(state.placed) || state.head?.output === false)) withdraw(state, out);
  if (told.size > 0) state.kept = state.kept.filter((notice) => !told.has(notice.runId));
}

/**
 * A main-lane `result`, before its `turn.ended`: the placed line is settled when the result names its run, else
 * withdrawn; a kept end the result names that no line stood for is placed now, at the end of that turn's work (the wire
 * gave no earlier proof). Returns the word `turn.ended` carries for the arrival at the head of the engine's turn (the
 * reader's `turnOriginOf`), or null for today's word.
 */
export function resultReached(state: LiveArrivals, runId: string | null, out: EventSink): string | null {
  if (state.placed !== null) {
    if (state.placed === runId) {
      state.kept = state.kept.filter((notice) => notice.runId !== runId);
      state.placed = null;
    } else withdraw(state, out);
  }
  const named = runId === null ? undefined : state.kept.find((notice) => notice.runId === runId);
  if (named !== undefined) {
    state.kept = state.kept.filter((notice) => notice !== named);
    out.emit(carried(named.messageUuid, '', [named.arrival]), MAIN);
  }
  const word = state.head?.arrival ? turnOriginOf(state.head.arrival) : null;
  state.head = null;
  return word;
}

/**
 * The engine went idle (its queue is empty): an end kept before the last turn opened was not told by it, and never will
 * be. The end whose line stands is not given up: its turn's result settles or withdraws that line.
 */
export function idle(state: LiveArrivals): void {
  const opened = state.turnOpenedAt;
  if (opened !== null) state.kept = state.kept.filter((notice) => notice.seq >= opened || notice.runId === state.placed);
}

/** The launch's exit row, before its `process.exited`: a line placed and not settled is withdrawn, and the state ends with the launch (decision 21). */
export function launchEnded(state: LiveArrivals, out: EventSink): void {
  if (state.placed !== null) withdraw(state, out);
  Object.assign(state, noLiveArrivals());
}

type UserMessage = Extract<EventPayload, { kind: 'user.message' }>;

/** The synthetic message of the carried classes (Interfaces C): never a prompt, its turn the one that runs. */
export function carried(messageUuid: MessageUuid | null, content: UserMessage['content'], arrival: CarriedArrival[]): UserMessage {
  return { kind: 'user.message', messageUuid, content, isReplay: false, isSynthetic: true, origin: 'task-notification', bash: null, arrival };
}

function place(state: LiveArrivals, notice: KeptNotice, out: EventSink): void {
  out.emit(carried(notice.messageUuid, '', [notice.arrival]), MAIN);
  state.placed = notice.runId;
  if (state.head !== null) state.head.arrival = notice.arrival;
}

function withdraw(state: LiveArrivals, out: EventSink): void {
  const notice = state.kept.find((kept) => kept.runId === state.placed);
  state.placed = null;
  if (notice === undefined) return;
  out.emit(carried(notice.messageUuid, '', []), MAIN);
  if (state.head?.arrival === notice.arrival) state.head.arrival = null;
}
