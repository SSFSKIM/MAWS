// `ask` (P1 X9, P-13; E1 execution document, M2 decisions, residues 2 and 12): the model's batch of questions for the
// human, held in the session's AskTable until `maws.ask.answer` settles it. The askId is the engine's tool-use id
// (`_meta["claudecode/toolUseId"]`), else the control request id. A blocking ask holds its `tools/call` open: the
// session answers it through the server's `reply` once the human submits, so the call settles here only with what was
// written, or when the engine withdrew it or the process ended (its signal's reason), which cancels the ask with nothing
// written. An async ask is answered `{status: 'asked', askId}` at once and its answers travel later as a steer; a
// withdrawal or an exit before that acknowledgement is written cancels it the same way.
// P2-C3 (the P2 spec's Decision Log 35): a subagent's ask is held as a blocking one whatever its `blocking` said, since
// an async ask's answers travel as a steer into the main conversation, which never asked, while the subagent never hears
// them; its call returns the answers, and its attention item is a `question`.
import { quotesGrant } from '@shared/engine/arrival';
import type { PendingAsk } from '@shared/maws/ask';
import { withQuestionIds } from '@shared/maws/ask';
import { parseRecordedToolArguments, parseToolArguments, TOOL_ERRORS, type AskResult } from '@shared/maws/tools';
import type { AskCancelReason, AskTable } from './asks';
import { defineMawsTool, toolError, toolText, type McpToolDefinition, type McpToolResult } from './server';

// Answers that do not fit the ask's questions: the command's `invalid_input`, never written.
export class AskAnswerMismatch extends Error {
  override readonly name = 'AskAnswerMismatch';
}

// Board ticket 711: an ask may not quote a permission grant. The engine's auto-mode classifier reads the conversation,
// the model's own ask call among it, so an ask whose strings hold the grant's opening (GRANT_OPENING, the consent
// sentence's own) is refused whole, whichever string holds it, by the one test of a string (quotesGrant, beside
// GRANT_OPENING, which says how it reads a string and what it does not claim). The steer's writer is the boundary
// (askSteerText writes no text the model wrote); this guard is the second layer.
const anyQuotesGrant = (value: unknown): boolean =>
  typeof value === 'string' ? quotesGrant(value) : typeof value === 'object' && value !== null && Object.values(value).some(anyQuotesGrant);

// The ask a call's arguments open (its parse error's text when they do not parse, or the refusal of an ask that quotes a
// grant): the one place an ask's arguments are admitted, a blocking or an async one, and where P5 O16 M3's adopter
// restores an async ask the old manager acknowledged from the same call's journaled arguments. Board ticket 420: a live
// call must say `blocking` (`askBlockingRequired`); `admitted` marks an ask an earlier host had already admitted (re-raised
// at a handover, or restored), read with the schema records are read with, so one with no `blocking` keeps waiting.
export function pendingAskOf(args: unknown, ctx: { toolUseId: PendingAsk['toolUseId']; requestId: PendingAsk['requestId']; fromSubagent: boolean; admitted?: true }, openedAt: string): PendingAsk | string {
  const parsed = ctx.admitted ? parseRecordedToolArguments('ask', args) : parseToolArguments('ask', args);
  if (!parsed.ok) return parsed.error;
  if (anyQuotesGrant(parsed.data)) return TOOL_ERRORS.askQuotesGrant;
  const { title, context, questions } = parsed.data;
  return {
    askId: ctx.toolUseId ?? ctx.requestId, toolUseId: ctx.toolUseId, requestId: ctx.requestId, blocking: (parsed.data.blocking ?? true) || ctx.fromSubagent,
    title: title ?? null, context: context ?? null, questions: withQuestionIds(questions), openedAt,
  };
}

export function askTool(deps: { asks: AskTable; cancelled: (ask: PendingAsk, reason: AskCancelReason) => void; now?: () => Date }): McpToolDefinition {
  return defineMawsTool('ask', async (args, ctx) => {
    const ask = pendingAskOf(args, ctx, (deps.now?.() ?? new Date()).toISOString());
    if (typeof ask === 'string') return toolError(ask);
    const { askId, blocking } = ask;
    // While the call is in flight (for an async ask, until its acknowledgement is written), the engine withdrawing it
    // or the process ending cancels the ask: nothing will be written for it, so no one can answer it either. Once the
    // call settled the server never aborts its signal again.
    ctx.signal.addEventListener('abort', () => {
      const reason: AskCancelReason = ctx.signal.reason === 'exit' ? 'exit' : 'withdrawn';
      const cancelled = deps.asks.cancel(askId, reason);
      if (cancelled) deps.cancelled(cancelled, reason);
    }, { once: true });
    if (!blocking) {
      deps.asks.open(ask, { blocking: false });
      const asked: AskResult = { status: 'asked', askId };
      return toolText(asked);
    }
    return new Promise<McpToolResult>((resolve) => deps.asks.open(ask, { blocking: true, resolve }));
  });
}
