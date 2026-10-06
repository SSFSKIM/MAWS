// The engine's envelope for a message from another session (SPEC 38 §38.23; E7 execution document, Design §4 and
// Decision Log 22), shared by both emission sites (the live normaliser and the disk backfill) and the transcript's
// derive, so a message is recognised the same way live, from disk and in the row that draws it. Pure.
//
// Three texts carry one: the idle form (a header, the envelope, a trailer), the bare envelope (the live mid-turn frame,
// and the `queued_command` attachment's `prompt` on disk) and the disk attachment's `rendered` form (the idle-form
// pieces inside `<system-reminder>`, with the "while you were working" header and a reply suffix) (E7 M0,
// `pass3/e7-peer-a` seq 73 and 258, `e7-peer-transcripts/db45d92e…` line 74). The envelope is `<cross-session-message
// …>` from another session or `<agent-message from="<agentId>">` from an in-process agent's SendMessage to the main
// conversation (C8b, `test/fixtures/engine/handback-pointer.jsonl` seq 207).
import type { EventPayload } from '../graph/events';
import type { AgentId, MessageUuid } from '../graph/ids';

export interface PeerEnvelope {
  kind: 'cross-session';
  from: string; // '' when the envelope names no address
  fromSession: string | null;
  fromName: string | null;
  fromMode: string | null;
  fromPlugin: string | null;
  hopChain: string[];
  body: string;
  midTurn: boolean; // the header says "while you were working", or there is none (the bare envelope)
  lineage: 'peer' | 'descendant'; // descendant: the trailer says the sender is an agent inside this same session
  replyable: boolean; // false when the suffix says SendMessage cannot reach the sender (the host-injected lane)
}

export interface AgentMessage {
  kind: 'agent';
  fromAgentId: string;
  body: string;
  handback: boolean; // the body is a `[Subagent hand-back]` frame (handbackReport reads its report)
}

type PeerMessagePayload = Extract<EventPayload, { kind: 'peer.message' }>;
type SubagentMessagePayload = Extract<EventPayload, { kind: 'subagent.message' }>;

// §38.23.2: the two headers assembled from "Another Claude session sent a message" and the standalone peer literal.
const HEADER = /^(Another Claude session sent a message( while you were working)?:|A peer session sent a message while you were working:)\n/;
const SYSTEM_REMINDER = /^<system-reminder>\n([\s\S]*)\n<\/system-reminder>$/;
const OPENING = /^<(cross-session-message|agent-message)((?: [a-z-]+="[^"]*")*)>\n/;
const ATTRIBUTE = / ([a-z-]+)="([^"]*)"/g;
const DESCENDANT_TRAILER = 'That "other Claude session" is an agent working inside this same session';
const HOST_INJECTED = 'is a host session id that SendMessage cannot reach';
const HANDBACK_FRAME = /^\[Subagent hand-back\][^\n]*The report follows:\n/;

export function parsePeerMessage(text: string): PeerEnvelope | AgentMessage | null {
  let rest = text.trim();
  rest = SYSTEM_REMINDER.exec(rest)?.[1] ?? rest;
  const header = HEADER.exec(rest);
  if (header) rest = rest.slice(header[0].length);
  const opening = OPENING.exec(rest);
  if (!opening) return null;
  const tag = opening[1]!;
  // The body is what lies inside the tags: up to the last closing tag, so a lookalike in the body (the engine escapes
  // them, §38.23.1) never cuts it short; what follows is the trailer, read only for its lineage and reply suffix.
  const closing = rest.lastIndexOf(`\n</${tag}>`);
  if (closing < opening[0].length - 1) return null;
  const body = rest.slice(opening[0].length, Math.max(closing, opening[0].length));
  const trailer = rest.slice(closing + tag.length + 4);
  const attributes = new Map([...opening[2]!.matchAll(ATTRIBUTE)].map((match) => [match[1]!, match[2]!] as const));
  if (tag === 'agent-message') {
    const from = attributes.get('from');
    return from ? { kind: 'agent', fromAgentId: from, body, handback: HANDBACK_FRAME.test(body) } : null;
  }
  const from = attributes.get('from') ?? '';
  return {
    kind: 'cross-session', from, fromSession: attributes.get('from-session') ?? null, fromName: attributes.get('from-name') ?? null,
    fromMode: attributes.get('from-mode') ?? null, fromPlugin: attributes.get('from-plugin') ?? null,
    hopChain: attributes.get('hop-chain')?.split(',').filter((hop) => hop.length > 0) ?? [], body,
    midTurn: header === null || header[0].includes('while you were working'),
    lineage: trailer.includes(DESCENDANT_TRAILER) ? 'descendant' : 'peer',
    replyable: !trailer.includes(HOST_INJECTED),
  };
}

// A hand-back's report as the parent received it (C8b): the frame line dropped and each line's two-space indent
// removed (the engine indents every line, so a frame-like line at column zero would be forged). Null for any other body.
export function handbackReport(body: string): string | null {
  const frame = HANDBACK_FRAME.exec(body);
  if (!frame) return null;
  return body.slice(frame[0].length).split('\n').map((line) => line.replace(/^ {2}/, '')).join('\n');
}

// The speaker label the TUI derives (§38.23.5): the envelope's name, else from the address: a `uds:` socket's basename
// without `.sock`, `(untitled)` for `bridge:`, the raw address for any other scheme; `peer` when both are empty.
export function peerLabel(from: string, fromName: string | null): string {
  if (fromName) return fromName;
  if (from.startsWith('uds:')) return from.slice(from.lastIndexOf('/') + 1).replace(/\.sock$/, '');
  if (from.startsWith('bridge:')) return '(untitled)';
  return from || 'peer';
}

// The X1 event a peer `user` frame or record stands for beside its `user.message` (Design §4): `peer.message` for a
// cross-session envelope, `subagent.message` for an in-process agent's. `origin` is the frame's or record's own
// `origin` object, which fills what the text never carries (the hop chain) or lacks (Decision Log 22). Null when the
// text is no envelope: the message then stays a plain bubble. A message with no address to answer is not replyable.
export function peerEventsOf(text: string, messageUuid: MessageUuid | null, origin?: unknown): PeerMessagePayload | SubagentMessagePayload | null {
  const parsed = parsePeerMessage(text);
  if (parsed === null) return null;
  if (parsed.kind === 'agent') return { kind: 'subagent.message', direction: 'from_child', fromAgentId: parsed.fromAgentId as AgentId, toAgentId: null, text: parsed.body };
  const o = typeof origin === 'object' && origin !== null ? (origin as Record<string, unknown>) : {};
  const string = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
  const from = parsed.from || string(o.from) || '';
  const hopChain = Array.isArray(o.hopChain) && o.hopChain.every((hop) => typeof hop === 'string') ? (o.hopChain as string[]) : parsed.hopChain;
  return {
    kind: 'peer.message', messageUuid, from, fromSession: parsed.fromSession, fromName: parsed.fromName ?? string(o.name), fromMode: parsed.fromMode ?? string(o.fromMode),
    fromPlugin: parsed.fromPlugin ?? string(o.plugin), hopChain, text: parsed.body, midTurn: parsed.midTurn, lineage: parsed.lineage,
    replyable: parsed.replyable && from !== '',
  };
}
