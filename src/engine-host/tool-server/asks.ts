// The pending-ask table one session holds (E1 execution document, Interfaces "The host", residue 12; G6): host memory,
// listed and answered by command, never renderer state, so a renderer reload loses nothing. An ask is pending until a
// submit claims it (answering); the claim is committed only once the answer's write settled, and a refused write
// releases it to pending again, so no one ever sees an answer the model did not receive. A blocking ask also holds the
// engine's `tools/call` open: committing it settles that call with what was written; cancelling it (the engine
// withdrew the call, or the process ended) settles it with a text nobody writes, since no one waits any more.
import type { AttentionItem } from '@shared/graph/attention';
import type { AppSessionId, AttentionId, SessionId } from '@shared/graph/ids';
import type { AskCancelReason, PendingAsk } from '@shared/maws/ask';
import { TOOL_ERRORS } from '@shared/maws/tools';
import { toolError, type McpToolResult } from './server';

export type AskSettle = { blocking: true; resolve: (result: McpToolResult) => void } | { blocking: false };
export type { AskCancelReason } from '@shared/maws/ask';

// What a cancelled blocking call settles with; never written, since its call was aborted and no one waits for it.
const CANCELLED: Record<AskCancelReason, string> = { exit: TOOL_ERRORS.sessionEnded, withdrawn: 'ask: the engine withdrew the call' };

interface Entry {
  ask: PendingAsk;
  settle: AskSettle;
  state: 'pending' | 'answering';
}

export class AskTable {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly deps: { onChange?: () => void } = {}) {}

  open(ask: PendingAsk, settle: AskSettle): void {
    this.entries.set(ask.askId, { ask, settle, state: 'pending' });
    this.deps.onChange?.();
  }

  // Pending and answering asks, in the order they were asked.
  list(): PendingAsk[] {
    return [...this.entries.values()].map((entry) => entry.ask);
  }

  get(askId: string): PendingAsk | null {
    return this.entries.get(askId)?.ask ?? null;
  }

  // The async asks held: a blocking ask is a call in flight, which the server already counts.
  get asyncCount(): number {
    return [...this.entries.values()].filter((entry) => !entry.ask.blocking).length;
  }

  // pending → answering; null when the ask is absent or already being answered (the command's `not_pending`).
  claim(askId: string): PendingAsk | null {
    const entry = this.entries.get(askId);
    if (entry?.state !== 'pending') return null;
    entry.state = 'answering';
    return entry.ask;
  }

  // The answer's write settled: the ask is gone, and a blocking call is settled with what was written.
  commit(askId: string, written?: McpToolResult): void {
    const entry = this.entries.get(askId);
    if (entry?.state !== 'answering') return;
    this.entries.delete(askId);
    if (entry.settle.blocking && written !== undefined) entry.settle.resolve(written);
    this.deps.onChange?.();
  }

  // The answer's write failed: answering → pending, so the human can retry.
  release(askId: string): void {
    const entry = this.entries.get(askId);
    if (entry?.state === 'answering') entry.state = 'pending';
  }

  cancel(askId: string, reason: AskCancelReason): PendingAsk | null {
    const entry = this.entries.get(askId);
    if (!entry) return null;
    this.entries.delete(askId);
    if (entry.settle.blocking) entry.settle.resolve(toolError(CANCELLED[reason]));
    this.deps.onChange?.();
    return entry.ask;
  }

  cancelAll(reason: 'exit'): PendingAsk[] {
    return [...this.entries.keys()].flatMap((askId) => this.cancel(askId, reason) ?? []);
  }
}

// E1 M4b (the architect's ruling 1): a blocking ask waits on the human as an AskUserQuestion does, so while it is held
// it is a `question` attention item beside the broker's (the broker itself never sees it: the ask is no `can_use_tool`).
// Keyed like the broker's items by the engine's control request id (the `mcp_message` that carries the call), which is
// what `session.pendingRequest` answers the ask's `maws.ask.opened` event for. An async ask is none.
export function askAttentionItem(ask: PendingAsk, appSessionId: AppSessionId, sessionId: SessionId | null): AttentionItem {
  return {
    id: `${appSessionId}:${ask.requestId}` as AttentionId, appSessionId, sessionId, kind: 'question',
    request: { requestId: ask.requestId, toolUseId: ask.toolUseId, taskId: null, agentId: null },
    summary: ask.title ?? ask.questions[0]?.question ?? 'Questions', createdAt: ask.openedAt, state: 'pending', stateChangedAt: ask.openedAt, expiresAt: null,
  };
}
