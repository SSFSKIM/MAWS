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
export function relayText(agent: RelayTarget, text: string): string {
  if (isPeerTarget(agent)) return peerRelayText(agent, text); // E7
  return `Relay to agent ${agent.agentId}${agent.name ? ` (named "${agent.name}")` : ''} with SendMessage, verbatim, then continue what you were doing: ${text}`;
}

// (b): the parent's own SendMessage (a child's is not the relay) addressed to the agent's id or its real name; the
// description never matches.
export function matchesSendMessage(event: SessionEvent, agent: AgentTarget): boolean;
export function matchesSendMessage(event: SessionEvent, peer: PeerTarget, text: string): boolean; // E7
export function matchesSendMessage(event: SessionEvent, agent: RelayTarget, text?: string): boolean {
  if (event.kind !== 'tool.use' || event.agentId !== null || event.toolName !== 'SendMessage') return false;
  if (isPeerTarget(agent)) return matchesPeerSend(event, agent, text ?? ''); // E7
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
export function restoreDraft(draft: string, relay: Relay | PeerRelay | undefined): string {
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

// E7 start: the relay to another session (E7 execution document, Design §4; Decision Log 6). The transcript's Reply under
// a message from another session, and its Message on a `ListAgents` row, ask the session by one `'next'` steer to
// `SendMessage` the owner's text to an address: the envelope's `from` (SPEC 38 §38.24.2: copy it as `to`), or the name
// a listing gave. The observables are the agent relay's (the steer answered, the parent's matching SendMessage) and then
// the send's own result: sent, or failed with the engine's message. An agent target is the C8b shape, unchanged (its
// wording and its key are byte for byte today's: `release()` compares the key with the child transcript's).
export type AgentTarget = { kind?: 'agent'; agentId: AgentId; name: string | null };
export interface PeerTarget {
  kind: 'peer';
  address: string; // what SendMessage's `to` gets
  name: string | null; // the sender's name, which the parent may address it by instead
  mode: 'reply' | 'message'; // answering a message, or a new message from a listing row
}
export type RelayTarget = AgentTarget | PeerTarget;
export const isPeerTarget = (target: RelayTarget): target is PeerTarget => target.kind === 'peer';

export type PeerRelayState =
  // reworded (E11 W-D): the steer's own turn sent to the address in other words, and that send's result once answered
  | { kind: 'asked'; messageUuid: MessageUuid; sentAt: string; parentTurnOpenAtSend: boolean; reworded?: { toolUseId: ToolUseId; outcome: { ok: true; at: string } | { ok: false; message: string } | null } }
  | { kind: 'forwarded'; messageUuid: MessageUuid; sentAt: string; toolUseId: ToolUseId; forwardedAt: string }
  | { kind: 'sent'; sentAt: string; reworded?: true } // the SendMessage's result said it went (reworded: in the session's own words)
  | { kind: 'failed'; message: string }; // the steer refused or dropped, or the send answered `success: false` (or an error)

export interface PeerRelay {
  appSessionId: AppSessionId;
  target: PeerTarget;
  text: string;
  state: PeerRelayState;
}

export const isPeerPending = (state: PeerRelayState) => state.kind === 'asked' || state.kind === 'forwarded';

// M0 ran the reply wording verbatim on the first try (pass3/e7-peer-a seq 160 → 191).
function peerRelayText(target: PeerTarget, text: string): string {
  const tail = `with SendMessage, to: "${target.address}", sending exactly this text, then continue what you were doing: ${text}`;
  if (target.mode === 'message') return `Send a message to ${target.name ?? target.address} ${tail}`;
  return `Reply to the cross-session message from ${target.name ? `${target.name} (${target.address})` : target.address} ${tail}`;
}

// The parent's own SendMessage to the address (or the sender's name) whose message carries the owner's text: the
// envelope's trailer tells the agent to answer the same sender on its own (M0 saw it, seq 130), which must not satisfy
// the owner's relay.
function matchesPeerSend(event: Extract<SessionEvent, { kind: 'tool.use' }>, target: PeerTarget, text: string): boolean {
  const input = (event.input ?? {}) as { message?: unknown; content?: unknown };
  const message = typeof input.message === 'string' ? input.message : typeof input.content === 'string' ? input.content : '';
  return sendsToPeer(event, target) && text !== '' && message.includes(text);
}

// E11 W-D: the parent's own SendMessage to the address (or the sender's name), whatever it carries.
export function sendsToPeer(event: SessionEvent, target: PeerTarget): event is Extract<SessionEvent, { kind: 'tool.use' }> {
  if (event.kind !== 'tool.use' || event.agentId !== null || event.toolName !== 'SendMessage') return false;
  const to = (event.input as { to?: unknown } | null)?.to;
  return to === target.address || (target.name !== null && to === target.name);
}
// E7 end
