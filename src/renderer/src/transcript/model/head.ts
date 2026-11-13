// UX wave U3 (the U3a document, decisions 5, 6 and 21): what one event of a turn is to the turn's head and to whether
// the turn holds anything, one reading for the derivation (where an arrival stands) and the reducer (which provisional
// lines a closing turn loses, and which engine turn is no turn). An arrival (a notice a synthetic message carries, a
// message from another session, a subagent's message to its parent) stands at the head while no work came before it.
// Work (the model's output, a call and what follows it, a request, a steer, a boundary, an error) ends the head. The
// rest ends nothing: the turn's own prompt, a hook, a notice and what a plugin said draw a row that is not the model's
// work (`quiet`); every other event draws nothing (`silent`), a hook that ran and let things go on among them.
import { carriedOf } from '@shared/engine/arrival-schema';
import type { SessionEvent } from '@shared/graph/events';
import { INTERRUPT_CUT } from '@shared/lane-a/interrupt-cut';
import { hookNotice } from './hooks';
import { turnId as turnIdOf } from './keys';
import type { TurnId } from './rows';
import { isInterruptionMarker, isLocalCommand } from './user-text';

export type HeadRole = 'arrival' | 'work' | 'quiet' | 'silent';

const WORK = new Set<SessionEvent['kind']>([
  'assistant.block.delta', 'assistant.block.complete',
  'tool.use', 'tool.result', 'tool.progress', 'tool.safeguard', 'tool.summary',
  'subagent.started', 'subagent.progress', 'subagent.finished', 'task.started', 'task.updated', 'task.notification', 'workflow.progress',
  'permission.requested', 'permission.resolved', 'question.requested', 'question.answered', 'plan.requested', 'plan.resolved',
  'dialog.requested', 'dialog.resolved', 'elicitation.requested', 'elicitation.resolved',
  'boundary.compaction', 'boundary.reset', 'boundary.retraction', 'boundary.rewind',
  'api.retry', 'error.raised',
  'maws.ask.opened', 'maws.ask.answered', 'maws.ask.cancelled', 'maws.browser.action', 'maws.delivery.file', 'maws.delivery.artifact',
  'side.thread.opened', 'side.thread.summarised',
]);

export function headRole(event: SessionEvent, turn: TurnId): HeadRole {
  switch (event.kind) {
    case 'user.message': {
      // in the derivation's order (derive.ts, its user.message case)
      if (event.isSynthetic && event.arrival !== undefined) return carriedOf(event.arrival).some((entry) => entry.class !== 'consent') ? 'arrival' : 'silent';
      if (event.origin === INTERRUPT_CUT || event.bash !== null || (isLocalCommand(event.origin, event.content) && !event.isSynthetic)) return 'work';
      if (event.isSynthetic || isInterruptionMarker(event.origin, event.content) || (event.origin !== null && event.origin !== 'human' && event.origin !== 'peer')) return 'silent';
      if (event.origin === 'peer') return 'quiet'; // its companion draws it, or it keeps its bubble
      const own = (event.messageUuid !== null && turnIdOf.ofMessage(event.messageUuid) === turn) || turnIdOf.ofEvent(event.id) === turn;
      return own ? 'quiet' : 'work'; // the turn's prompt stands above its divider; any other is a steer
    }
    case 'peer.message':
      return 'arrival';
    case 'subagent.message':
      return event.direction === 'from_child' ? 'arrival' : 'work';
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
