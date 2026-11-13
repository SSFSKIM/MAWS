// UX wave U4a (docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md, Interfaces B; decisions 2, 32 and 34): what the
// normaliser reads of a message sent now, from the journal's own rows (nothing new is journaled or stored). Pure functions
// over the normaliser's state, so a page cursor's copy of that state carries them.
//
// The marked end. A message is sent now by the engine's send-now request, or by a `now` frame written while a turn runs
// or an earlier prompt waits to start; it leaves the set when the engine says it is not waiting (the request's error or
// `nothing_waiting`), when it is read in the same turn, and when it is withdrawn or dropped. A main-lane end is marked
// when the set holds a message, the end is an aborted one, and it is not a plain interrupt's own end (decision 34: a
// plain interrupt that arrives after the move does nothing, one before it kills the command and its end is a stop).
//
// The joined message. The engine replays each frame the host wrote; when it writes several waiting prompts as one, the
// replay under the last one's uuid holds all their texts. The replay is told from an echo by its content's length and
// hash (a waiting message may hold a 32 MiB document, so the content itself is not kept), and the prompts it joins are
// the host's whose `started` arrived since the turn's last output.
import type { MessageUuid } from '@shared/graph/ids';

export interface SendNowState {
  sentNow: Set<MessageUuid>;
  stopAsked: boolean;
  written: Map<MessageUuid, string>; // a host-written prompt the engine has not replayed: its content's digest
  startedSinceOutput: MessageUuid[]; // the host's prompts whose `started` arrived since the main lane's last output
}

export const noSendNow = (): SendNowState => ({ sentNow: new Set(), stopAsked: false, written: new Map(), startedSinceOutput: [] });

// An `out` control request: a send-now request adds its message; a plain interrupt while a turn is open is a stop asked.
export function interruptWritten(state: SendNowState, request: { subtype: string; send_now?: unknown; message_uuid?: unknown }, turnOpen: boolean): void {
  if (request.subtype !== 'interrupt') return;
  if (request.send_now === true) {
    if (typeof request.message_uuid === 'string') state.sentNow.add(request.message_uuid as MessageUuid);
  } else if (turnOpen) state.stopAsked = true;
}

// The engine's answer to a send-now request: an error, or `nothing_waiting`, says the message was not waiting.
export function interruptAnswered(state: SendNowState, request: { send_now?: unknown; message_uuid?: unknown }, response: { subtype: string; response?: unknown }): void {
  if (request.send_now !== true || typeof request.message_uuid !== 'string') return;
  const word = (response.response as { send_now?: unknown } | undefined)?.send_now;
  if (response.subtype !== 'success' || word === 'nothing_waiting') state.sentNow.delete(request.message_uuid as MessageUuid);
}

// A host-written querying frame: a `now` frame written while a turn is open or an earlier prompt has not started is sent
// now (a session's first prompt, written at `now` while idle, is not: Surprises 2); every one is kept for its replay.
export function promptWritten(state: SendNowState, uuid: MessageUuid, content: unknown, priority: string | undefined, waiting: boolean): void {
  if (priority === 'now' && waiting) state.sentNow.add(uuid);
  state.written.set(uuid, contentDigest(content));
}

// A `command_lifecycle` naming a sent-now message: read in the same turn (`started` while a turn is open), withdrawn or
// dropped, it no longer ends a turn. A prompt withdrawn or dropped is never replayed, so its digest goes too.
export function lifecycleSeen(state: SendNowState, uuid: MessageUuid, lifecycle: string, turnOpen: boolean): void {
  const gone = lifecycle === 'cancelled' || lifecycle === 'discarded' || lifecycle === 'refused';
  if ((lifecycle === 'started' && turnOpen) || gone) state.sentNow.delete(uuid);
  if (gone) state.written.delete(uuid);
}

// A host-written prompt the engine started.
export function promptStarted(state: SendNowState, uuid: MessageUuid): void {
  state.startedSinceOutput.push(uuid);
}

// The main lane's output: an assistant message, a tool's result, or a turn's result.
export function outputSeen(state: SendNowState): void {
  if (state.startedSinceOutput.length > 0) state.startedSinceOutput = [];
}

// At a main-lane end that is not an echo's receipt: whether it is marked, and the set and the stop emptied.
export function turnEnded(state: SendNowState, terminalReason: string | null, subtype: string): boolean {
  const marked = state.sentNow.size > 0 && terminalReason?.startsWith('aborted') === true && !(state.stopAsked && subtype === 'error_during_execution');
  state.sentNow.clear();
  state.stopAsked = false;
  return marked;
}

// The engine's replay of a frame the host wrote: null when it is an echo, else the other prompts it joins, in their order.
// A replay that differs where no other prompt started is read as an echo, as before: the engine's join is the one case
// recorded (u4p2-two-*, u4p3-end*), and a joined message always holds more than one prompt.
export function replayJoins(state: SendNowState, uuid: MessageUuid, content: unknown): MessageUuid[] | null {
  const written = state.written.get(uuid);
  state.written.delete(uuid);
  if (written === undefined || written === contentDigest(content)) return null;
  const joined = state.startedSinceOutput.filter((other) => other !== uuid);
  return joined.length > 0 ? joined : null;
}

// The content's length and FNV-1a hash over its JSON form (pure: the normaliser also runs in the renderer's tests).
function contentDigest(content: unknown): string {
  const text: string = typeof content === 'string' ? content : JSON.stringify(content);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${text.length}:${hash.toString(16)}`;
}
