// The relay's pure half (C8b execution document, Interfaces *The relay*; owner ruling 1 as the review read it; Gate G1
// verdicts (1)-(6); the architect's rulings O1 and O3). The drill-in composer asks the parent, by one `'next'` steer,
// to `SendMessage` the child; three observables are kept apart: (a) the steer answered, (b) the parent's `SendMessage`
// row naming the child, (c) the child's own stream showing the message. On engine 2.1.283 a live child's receipt never
// reaches the wire: its receipt is the `queued_command` attachment in its transcript, which C4 surfaces as a disk-form
// `user.message` once the relay store follows the child (debt wave 4); a resumed child's receipt is its resume start.
import type { SessionEvent } from '@shared/graph/events';
import type { AgentId, AppSessionId, MessageUuid, ToolUseId } from '@shared/graph/ids';

export type RelayState =
  | { kind: 'asked'; messageUuid: MessageUuid; sentAt: string; sentSeq: number | null; parentTurnOpenAtSend: boolean; childEndedAt: string | null } // (a) session.steer answered with the uuid; whether the parent had a turn open when it was sent (the line's clause); childEndedAt: the agent turned terminal or exited before the parent forwarded (the line then warns that the forward may resume it)
  | { kind: 'forwarded'; messageUuid: MessageUuid; sentAt: string; toolUseId: ToolUseId; forwardedAt: string; parentRounds: number; childEndedAt: string | null } // (b) the parent's SendMessage tool.use with `to` the agent; stays here for good when no receipt is ever observed; childEndedAt kept from `asked` (a forward to an ended agent resumes it, and its resume start is the receipt)
  | { kind: 'delivered'; deliveredAt: string } // (c) the child's stream shows it; cleared from the store on the next render
  | { kind: 'failed'; message: string }; // session.steer refused (the composer shows it, the draft is kept), or, from `asked`, the engine dropped the steer before starting it (O1)

export interface Relay {
  appSessionId: AppSessionId;
  agentId: AgentId;
  name: string | null; // the sidecar's real `name` or null; the display name (name ?? description) is the view's, not the relay's
  text: string; // what the owner typed, which the child's receipt carries verbatim
  state: RelayState;
}

export const isPending = (state: RelayState) => state.kind === 'asked' || state.kind === 'forwarded';

// R1 routed this wording first time in the idle, busy and foreground cases (verdict (1)). 2.1.283's `Agent` tool takes
// no `name`, so the named clause fires only for a sidecar that carries one.
export function relayText(agent: { agentId: AgentId; name: string | null }, text: string): string {
  return `Relay to agent ${agent.agentId}${agent.name ? ` (named "${agent.name}")` : ''} with SendMessage, verbatim, then continue what you were doing: ${text}`;
}

// (b): the parent's own SendMessage (a child's is not the relay) addressed to the agent's id or its real name; the
// description never matches.
export function matchesSendMessage(event: SessionEvent, agent: { agentId: AgentId; name: string | null }): boolean {
  if (event.kind !== 'tool.use' || event.agentId !== null || event.toolName !== 'SendMessage') return false;
  const to = (event.input as { to?: unknown } | null)?.to;
  return to === agent.agentId || (agent.name !== null && to === agent.name);
}

function textOf(content: string | { type: string; [key: string]: unknown }[]): string {
  if (typeof content === 'string') return content;
  return content.map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n');
}

// (c): a child `user.message` carrying the text, any origin, live form or disk form (O3: so C4's tracked ask, surfacing
// the `queued_command` attachment as a disk-form message, needs no change here); or the resume start of the agent whose
// `prompt` carries it, the `agent-stopped` route's live receipt (relay-to-child.jsonl seq 548).
export function matchesReceipt(event: SessionEvent, relay: Relay): boolean {
  if (event.kind === 'user.message') return event.agentId === relay.agentId && textOf(event.content).includes(relay.text);
  if (event.kind === 'subagent.started') return (event.taskId as string) === relay.agentId && (event.prompt ?? '').includes(relay.text);
  return false;
}

// A failed relay's text returns to the composer's box when the box is empty, never over a draft typed since (O1).
export function restoreDraft(draft: string, relay: Relay | undefined): string {
  return relay?.state.kind === 'failed' && draft.trim() === '' ? relay.text : draft;
}

// After this long in `asked` with the turn clause shown, the clause becomes the long-wait string: the parent reaches no
// tool boundary while one call runs.
export const RELAY_LONG_WAIT_MS = 30_000;

// A parent round is one parent assistant message carrying at least one tool_use block: distinct messageUuid among the
// parent's (agentId null) tool_use block completions with fromSeq < seq < toSeq.
export function parentRoundsBetween(events: SessionEvent[], fromSeq: number, toSeq: number): number {
  const rounds = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'assistant.block.complete' || e.agentId !== null || e.block.type !== 'tool_use' || e.seq === null) continue;
    if (e.seq > fromSeq && e.seq < toSeq) rounds.add(e.messageUuid);
  }
  return rounds.size;
}
