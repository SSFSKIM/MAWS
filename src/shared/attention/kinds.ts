// Which attention items wait on a human, and which of them ask for an answer (charter §5.7; C5 execution document,
// Derivations). Shared because every reader of the one attention table must agree: the renderer's Needs-you rows and
// glyphs, main's notifier and dock badge, the daemon's publisher and the counts a phone is told.
//
// UX wave U1, contract UC-1 (U1a's Interfaces §A): this is the only definition of waiting. An item waits while it is
// `pending` alone: once its answer is written (`delivered`) it waits nowhere, though the engine has not yet shown that it
// acted. Nothing outside src/engine-host/, which moves items through their states, compares a state to say whether an
// item waits (test/one-predicate.test.ts).
import type { AttentionItem } from '../graph/attention';
import type { AttentionKind } from '../graph/enums';
import type { ToolUseId } from '../graph/ids';

export const ACTIONABLE_KINDS: AttentionKind[] = ['permission', 'question', 'plan', 'dialog', 'elicitation', 'auto_mode_unavailable', 'error', 'interrupted',
  'async_input', 'essential_unread', // P2-C (2026-10-09): the owner channel's question and must-read count in the badge and stand in tier 1
];   // tier 1
const ACTIONABLE = new Set<AttentionKind>(ACTIONABLE_KINDS);

/** Whether an attention item still waits on the person. */
export const waits = (item: Pick<AttentionItem, 'state'>): boolean => item.state === 'pending';

/** A waiting item that stands for a request the person can answer (not a notice). P5 O10: what a remote `cards` view
 * shows, and the count `notify` tells of a lane B session (the engine host's `engine.pendingItems` and the endpoint's
 * live events alike). */
export const waitsOnAnswer = (item: Pick<AttentionItem, 'state'> & { request: Pick<AttentionItem['request'], 'requestId'> }): boolean =>
  waits(item) && item.request.requestId !== null;

export const isActionable = (item: AttentionItem) => ACTIONABLE.has(item.kind);

const at = (item: AttentionItem) => Date.parse(item.createdAt);

/** The waiting requests that name a tool call, by that call's id: a permission prompt's call, a question's, an ask's, a plan's. */
export function waitingByCall(items: readonly AttentionItem[]): ReadonlyMap<ToolUseId, AttentionItem> {
  const byCall = new Map<ToolUseId, AttentionItem>();
  for (const item of items) {
    const call = item.request.toolUseId;
    if (call === null || !waitsOnAnswer(item)) continue;
    const held = byCall.get(call);
    if (held === undefined || at(item) < at(held)) byCall.set(call, item); // two naming one call: the oldest
  }
  return byCall;
}

/** The agents with a request of their own waiting: every agent id, and every id of a background task that runs an agent, named by such a request. */
export function waitingAgents(items: readonly AttentionItem[]): ReadonlySet<string> {
  const agents = new Set<string>();
  for (const item of items) {
    if (!waitsOnAnswer(item)) continue;
    if (item.request.agentId !== null) agents.add(item.request.agentId);
    if (item.request.taskId !== null) agents.add(item.request.taskId);
  }
  return agents;
}
