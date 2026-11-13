// UX wave U3 (the U3a document, decisions 5, 6 and 21): what one event of a turn is to the turn's head and to whether
// the turn holds anything, one reading for the derivation (where an arrival stands) and the reducer (which provisional
// lines a closing turn loses, and which engine turn is no turn). An arrival (a notice a synthetic message carries, a
// message from another session, a subagent's message to its parent) stands at the head while no work came before it.
// Work is an event the derivation draws a row of the turn's work for (derive.ts, its event switch): it ends the head.
// The rest ends nothing: the turn's own prompt, a hook that got in the way, a notice and what a plugin said draw a row
// that is not work (`quiet`); every other event draws nothing of its own (`silent`): a hook that ran and let things go
// on, and what only updates a row already drawn (a call's result or progress, a task's update or end, a request's
// answer, the host's account of a maws call). head.test.ts holds the table to the rows drawn over every fixture.
import { carriedOf } from '@shared/engine/arrival-schema';
import type { SessionEvent } from '@shared/graph/events';
import { INTERRUPT_CUT } from '@shared/lane-a/interrupt-cut';
import { hookNotice } from './hooks';
import { turnId as turnIdOf } from './keys';
import type { TurnId } from './rows';
import { isInterruptionMarker, isLocalCommand } from './user-text';

export type HeadRole = 'arrival' | 'work' | 'quiet' | 'silent';

// The kinds the derivation draws a row of work for, where their context gives one: a text or thinking block; a call's
// cell, request, message, delivery or subagent row; a subagent's or workflow's row; a request's slot while it waits
// (work, whether or not it still waits, so the head does not move when it is answered); a boundary; a retry or an
// error; a side thread's row; and the turn's end, which reads a call it left without a result as cancelled.
const WORK = new Set<SessionEvent['kind']>([
  'assistant.block.delta', 'assistant.block.complete',
  'tool.use',
  'subagent.started',
  'permission.requested', 'question.requested', 'plan.requested', 'dialog.requested', 'elicitation.requested',
  'boundary.compaction', 'boundary.reset', 'boundary.retraction',
  'api.retry', 'error.raised',
  'side.thread.opened', 'side.thread.summarised',
  'turn.ended',
]);

// The prompt that opens a turn names it by its uuid; the one message the engine wrote from several waiting prompts
// (`joined`, UX wave U4a decision 32 c) opens the first one's turn, where that one stood.
export function opensTurn(event: Extract<SessionEvent, { kind: 'user.message' }>, turn: TurnId): boolean {
  if (event.messageUuid === null) return false;
  return turnIdOf.ofMessage(event.joined?.[0] ?? event.messageUuid) === turn;
}

export function headRole(event: SessionEvent, turn: TurnId): HeadRole {
  switch (event.kind) {
    case 'user.message': {
      // in the derivation's order (derive.ts, its user.message case)
      if (event.isSynthetic && event.arrival !== undefined) return carriedOf(event.arrival).some((entry) => entry.class !== 'consent') ? 'arrival' : 'silent';
      if (event.bash?.part === 'output') return 'silent'; // it completes the command's row
      if (event.origin === INTERRUPT_CUT || event.bash !== null || (isLocalCommand(event.origin, event.content) && !event.isSynthetic)) return 'work';
      if (event.isSynthetic || isInterruptionMarker(event.origin, event.content) || (event.origin !== null && event.origin !== 'human' && event.origin !== 'peer')) return 'silent';
      if (event.origin === 'peer') return 'quiet'; // its companion draws it, or it keeps its bubble
      const own = opensTurn(event, turn) || turnIdOf.ofEvent(event.id) === turn;
      return own ? 'quiet' : 'work'; // the turn's prompt stands above its divider; any other is a steer
    }
    case 'peer.message':
      return 'arrival';
    case 'subagent.message':
      return event.direction === 'from_child' ? 'arrival' : 'work';
    case 'task.started': // a subagent's or a workflow's row; a background command's task only marks its call's cell
      return event.taskType === 'local_agent' || event.taskType === 'local_workflow' ? 'work' : 'silent';
    case 'hook.finished':
      return hookNotice({ started: null, finished: event }) === null ? 'silent' : 'quiet';
    case 'notice.posted':
    case 'plugin.log':
    case 'plugin.load_issue':
      return 'quiet';
    default:
      return WORK.has(event.kind) ? 'work' : 'silent';
  }
}
