// The owner channel's two pure halves of Design §5: which marks a finalized block carries, and which attention items a
// session's stored marks project. Only finalized text counts: a main-thread text block (`parentToolUseId` null) that is
// neither an interrupted partial (`aborted`) nor the engine's synthetic API-error message; user prompts, tool output and
// subagent text never do. Its questions and essentials are parsed with grammar 2 (src/shared/owner/marks.ts).
import type { AttentionItem } from '@shared/graph/attention';
import type { SessionEvent } from '@shared/graph/events';
import type { AppSessionId, AttentionId, MessageUuid, SessionId } from '@shared/graph/ids';
import { marksOf, type BlockMark } from '@shared/owner/marks';
import type { OwnerMarkRow } from './store';

export function blockMarksOf(event: SessionEvent): BlockMark[] {
  if (event.kind !== 'assistant.block.complete' || event.parentToolUseId !== null || event.aborted || event.isApiErrorMessage === true) return [];
  if (event.block.type !== 'text' || typeof event.block.text !== 'string') return [];
  return marksOf(event.block.text, { messageUuid: event.messageUuid, blockIndex: event.blockIndex });
}

type OwnerKind = 'async_input' | 'essential_unread';
export const ownerItemIdOf = (appSessionId: AppSessionId, kind: OwnerKind, markId: string) => `${appSessionId}:${kind}:${markId}` as AttentionId;

// The summary a Needs-you row and a notification read: the kind's label and the mark's first line. A question holding
// only choices has no head (as in the doperpowers mod); it reads as its label alone.
const LABEL: Record<OwnerKind, string> = { async_input: 'Question', essential_unread: 'Must read' };
const summaryOf = (kind: OwnerKind, head: string) => (head === '' ? LABEL[kind] : `${LABEL[kind]} — ${head}`);

export interface ProjectionContext {
  sessionId: SessionId | null; // the engine session the items name
  foreignHeld: boolean; // a terminal or a background job holds the session
}

/**
 * The items a session's marks raise while its lane is on (Design §5's table): an unanswered question, unless a foreign
 * holder has the session, and an unread essential; only marks at or after the watermark (`item`). `quiet` names the ids
 * no notification may announce: a mark that did not come live from a MAWS process, and every essential of a
 * foreign-held session.
 */
export function ownerItemsOf(appSessionId: AppSessionId, marks: readonly OwnerMarkRow[], ctx: ProjectionContext): { items: AttentionItem[]; quiet: AttentionId[] } {
  const items: AttentionItem[] = [];
  const quiet: AttentionId[] = [];
  for (const mark of marks) {
    if (!mark.item) continue;
    const kind: OwnerKind | null = mark.kind === 'need-input' ? (mark.state === 'unanswered' && !ctx.foreignHeld ? 'async_input' : null) : mark.state === 'unread' ? 'essential_unread' : null;
    if (kind === null) continue;
    const id = ownerItemIdOf(appSessionId, kind, mark.id);
    items.push({
      id, appSessionId, sessionId: ctx.sessionId, kind, request: { requestId: null, toolUseId: null, taskId: null, agentId: null }, summary: summaryOf(kind, mark.head),
      createdAt: mark.at, state: 'pending', stateChangedAt: mark.at, expiresAt: null, anchor: { messageUuid: mark.messageUuid as MessageUuid, blockIndex: mark.blockIndex, span: mark.span },
    });
    if (!mark.live || ctx.foreignHeld) quiet.push(id);
  }
  return { items, quiet };
}
