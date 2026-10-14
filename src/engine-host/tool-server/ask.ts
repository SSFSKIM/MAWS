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
import type { PendingAsk } from '@shared/maws/ask';
import { withQuestionIds } from '@shared/maws/ask';
import { parseToolArguments, type AskResult } from '@shared/maws/tools';
import type { AskCancelReason, AskTable } from './asks';
import { defineMawsTool, toolError, toolText, type McpToolDefinition, type McpToolResult } from './server';

// Answers that do not fit the ask's questions: the command's `invalid_input`, never written.
export class AskAnswerMismatch extends Error {
  override readonly name = 'AskAnswerMismatch';
}

export function askTool(deps: { asks: AskTable; cancelled: (ask: PendingAsk, reason: AskCancelReason) => void; now?: () => Date }): McpToolDefinition {
  return defineMawsTool('ask', async (args, ctx) => {
    const parsed = parseToolArguments('ask', args);
    if (!parsed.ok) return toolError(parsed.error);
    const { title, context, questions } = parsed.data;
    const blocking = (parsed.data.blocking ?? true) || ctx.fromSubagent;
    const askId = ctx.toolUseId ?? ctx.requestId;
    const ask: PendingAsk = {
      askId, toolUseId: ctx.toolUseId, requestId: ctx.requestId, blocking, title: title ?? null, context: context ?? null,
      questions: withQuestionIds(questions), openedAt: (deps.now?.() ?? new Date()).toISOString(),
    };
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
