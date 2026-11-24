// The question sheet's attention items (docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md §H; S10, the
// composite's §8.1): one calm `async_input` item, "Question waiting", per open question of a record that has no queued
// answer, made on the spine from the model (src/services/sheet/attention.ts). Its id is `sheet:<session>:<question>`,
// the engine's session id and the question's id. An attention id is lifted to an address on its way to a window, on this
// machine too, so the predicate and the reader take a bare id and an address alike.
//
// A sheet item is listed among the session's waiting requests (the "Waiting for you" card, Needs you, the session's
// row and tab) and placed nowhere in a transcript: no form in a row, no card at the end, no waiting mark on a call, and
// it raises no jump pill (`waiting.ts`, `kinds.ts`). Choosing it opens the session's sheet at its question.
import type { AttentionItem } from '../graph/attention';
import type { AgentId, AppSessionId, AttentionId, RequestId, SessionId, ToolUseId } from '../graph/ids';
import { bareOf, isAddress } from '../machine/address';
import { isSheetSession, type SheetModel } from '../sheet/model';
import { questionSentence } from '../sheet/words';

export const SHEET_ITEM_PREFIX = 'sheet:';

const SESSION_LENGTH = 36; // the engine's session id, the only form `isSheetSession` holds for
const QUESTION_ID = /^q[1-9][0-9]{0,8}$/; // the set's question id (model.ts)

/** The session and question a sheet item stands for, of a bare id or an address; null for any other item. */
export function questionOfItem(id: string): { session: string; questionId: string } | null {
  const bare = isAddress(id) ? bareOf(id) : id;
  if (!bare.startsWith(SHEET_ITEM_PREFIX)) return null;
  const rest = bare.slice(SHEET_ITEM_PREFIX.length);
  const session = rest.slice(0, SESSION_LENGTH);
  const questionId = rest.slice(SESSION_LENGTH + 1);
  if (rest[SESSION_LENGTH] !== ':' || !isSheetSession(session) || !QUESTION_ID.test(questionId)) return null;
  return { session, questionId };
}

/** Whether an attention item (by its bare id or its address) is a sheet question's. */
export const isSheetItem = (id: string): boolean => questionOfItem(id) !== null;

export const sheetItemId = (session: string, questionId: string): AttentionId => `${SHEET_ITEM_PREFIX}${session}:${questionId}` as AttentionId;

/** The items of an app session's record: one per listed question without a queued answer, in the model's order. */
export function sheetItemsOf(appSessionId: AppSessionId, model: SheetModel): AttentionItem[] {
  return model.open
    .filter((question) => question.queued === undefined)
    .map((question) => ({
      id: sheetItemId(model.session, question.id),
      appSessionId,
      sessionId: model.session as SessionId,
      kind: 'async_input',
      request: {
        requestId: question.id as RequestId,
        toolUseId: question.callId as ToolUseId,
        taskId: null,
        agentId: (question.asker === 'main' ? null : question.asker.agentId) as AgentId | null,
      },
      summary: questionSentence(question.question),
      createdAt: question.askedAt,
      state: 'pending',
      stateChangedAt: question.askedAt,
      expiresAt: null,
    }));
}
