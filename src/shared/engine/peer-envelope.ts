// The engine's envelope for a message from another session (SPEC 38 §38.23; E7 execution document, Design §4 and
// Decision Log 22), shared by both emission sites (the live normaliser and the disk backfill) and the transcript's
// derive, so a message is recognised the same way live, from disk and in the row that draws it. Pure.
//
// Three texts carry one: the idle form (a header, the envelope, a trailer), the bare envelope (the live mid-turn frame,
// and the `queued_command` attachment's `prompt` on disk) and the disk attachment's `rendered` form (the idle-form
// pieces inside `<system-reminder>`, with the "while you were working" header and a reply suffix) (E7 M0,
// `pass3/e7-peer-a` seq 73 and 258, `e7-peer-transcripts/db45d92e…` line 74). The envelope is `<cross-session-message
// …>` from another session or `<agent-message from="<agentId>">` from an in-process agent's SendMessage to the main
// conversation (C8b, `test/fixtures/engine/handback-pointer.jsonl` seq 207), or `<teammate-message teammate_id="<name>"
// …>` from a teammate to the lead of a team an interactive terminal formed (E11 S2(d), 2.1.293: `pass3/e7-team-terminal`,
// the lead's transcript line 35), which names its sender by name and no address.
//
// A message sminos sends through the engine's messaging socket opens its body with sminos's frame line, naming the
// event, and ends it with a reply line; both are for the model. The body drawn cuts them (the agent_message row already
// names the sender), and `frame` keeps the frame line, by which the desk knows a delivery of its own sends.
import type { ContentBlock, EventPayload } from '../graph/events';
import type { AgentId, MessageUuid } from '../graph/ids';

export interface PeerEnvelope {
  kind: 'cross-session' | 'teammate';
  from: string; // '' when the envelope names no address
  fromSession: string | null;
  fromName: string | null;
  fromMode: string | null;
  fromPlugin: string | null;
  hopChain: string[];
  body: string; // what lies inside the tags, as drawn: sminos's frame line and reply line, when it carries them, dropped
  frame: string | null; // sminos's frame line the body opened with, naming the event it delivers; null for any other
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
const OPENING = /^<(cross-session-message|agent-message|teammate-message)((?: [a-z_-]+="[^"]*")*)>\n/;
const ATTRIBUTE = / ([a-z_-]+)="([^"]*)"/g;
const DESCENDANT_TRAILER = 'That "other Claude session" is an agent working inside this same session';
const HOST_INJECTED = 'is a host session id that SendMessage cannot reach';
const HANDBACK_FRAME = /^\[Subagent hand-back\][^\n]*The report follows:\n/;
const UNKNOWN_SENDER = 'unknown';
// sminos's reply line, the fixed last line of the body of a message it sends through the engine's messaging socket:
// `[To reply, run in Bash: <absolute path to sminos> say "@<project id>/<sender short> <your reply>"]`, literal but for
// the sending machine's path and the address. It tells a model with no sminos context how to answer; no reader is shown
// it, so the body drawn ends before it. Matched whole, as the body's last line only.
const SMINOS_REPLY_LINE = /(?:^|\n)\[To reply, run in Bash: \/[^\n"]*\/sminos say "@[^\s"/]+\/[^\s"/]+ <your reply>"\]$/;
// sminos's frame line, the first line of every event it pushes, followed by the event's text (doperpowers `sminos.py`:
// `compose_chat_frame`, `compose_frame`): `[sminos chat <project> <writer_short>:<seq> from <from> → <target>[ |
// unread N]]`, or `[sminos message from <via or from> id=<msg_id>]` for an event that carries a `msg_id`. The target is
// `@you`, or a broadcast's: `@all`, or from sminos 1.2.0 its scope's label (`scope_label`: `@org`, `@org (<states>)`,
// or `@all in <projects>`, `@all on <machines>` or both, then perhaps ` (<states>)`).
const SMINOS_CHAT_HEAD = /^\[sminos chat .+? \S+:\d+ from /;
const SMINOS_UNREAD = / \| unread [1-9][0-9]*$/;
// sminos's `STATES`, the words `--state` takes.
const SMINOS_STATE = '(?:busy|idle|waiting|stopped|gone|vacant|retired)';
const SMINOS_ORG_TARGET = new RegExp(`@org(?: \\(${SMINOS_STATE}(?:,${SMINOS_STATE})*\\))?$`, 'y');
const SMINOS_MESSAGE_FRAME = /^\[sminos message from (.+) id=\S+\]$/;

/**
 * Whether a chat frame's target starts at `at` and runs to the end of `rest` (the frame between its sender and its
 * unread count). sminos leaves the names in a scope open (a project's name may hold ` → ` or ` on `), so past `@all in `
 * or `@all on ` a target is any text without a `]`; `@org`'s states are sminos's state words, so a project named
 * `ops → @org (later)` opens no second reading.
 */
function chatTargetAt(rest: string, at: number, lastBracket: number): boolean {
  const length = rest.length - at;
  if (length === 4 && (rest.startsWith('@you', at) || rest.startsWith('@all', at))) return true;
  if (rest.startsWith('@all in ', at) || rest.startsWith('@all on ', at)) return length > 8 && lastBracket < at;
  if (!rest.startsWith('@org', at)) return false;
  SMINOS_ORG_TARGET.lastIndex = at;
  return SMINOS_ORG_TARGET.test(rest);
}

/**
 * Who a chat frame line names as its sender, read in one pass. The header is taken at its first place, as a pattern
 * would; the sender then runs to a ` → ` that opens a whole target. A sender's alias and a scope's project names are
 * both open, so a line may split there more than one way (an alias `a → @all in b` saying `→ @you`, a project named
 * `ops → @all`): such a line names no one sender, and is read as no frame rather than credited to a guess.
 */
function chatFrameSender(line: string): string | null {
  const head = SMINOS_CHAT_HEAD.exec(line);
  if (head === null || !line.endsWith(']') || line.includes('\n')) return null;
  const rest = line.slice(head[0].length, -1).replace(SMINOS_UNREAD, '');
  const lastBracket = rest.lastIndexOf(']');
  let sender: string | null = null;
  for (let at = rest.indexOf(' → ', 1); at >= 0; at = rest.indexOf(' → ', at + 1)) {
    if (!chatTargetAt(rest, at + 3, lastBracket)) continue;
    if (sender !== null) return null;
    sender = rest.slice(0, at);
  }
  return sender;
}

/** Who a sminos frame line says sent the event, or null when the line is not a whole frame. */
export function sminosFrameSender(line: string): string | null {
  return chatFrameSender(line) ?? SMINOS_MESSAGE_FRAME.exec(line)?.[1] ?? null;
}

/** A sminos message's text as drawn: its frame line (whole, the first, with the text after it) and its reply line cut. */
function sminosParts(body: string): { frame: string | null; body: string } {
  const first = body.split('\n', 1)[0]!;
  const frame = body.includes('\n') && sminosFrameSender(first) !== null ? first : null;
  return { frame, body: (frame === null ? body : body.slice(frame.length + 1)).replace(SMINOS_REPLY_LINE, '') };
}

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
  const delivery = {
    midTurn: header === null || header[0].includes('while you were working'),
    lineage: trailer.includes(DESCENDANT_TRAILER) ? 'descendant' : 'peer',
    replyable: !trailer.includes(HOST_INJECTED),
  } as const;
  if (tag === 'teammate-message') {
    return { kind: 'teammate', from: '', fromSession: null, fromName: attributes.get('teammate_id') ?? null, fromMode: null, fromPlugin: null, hopChain: [], body, frame: null, ...delivery };
  }
  return {
    kind: 'cross-session', from: attributes.get('from') ?? '', fromSession: attributes.get('from-session') ?? null, fromName: attributes.get('from-name') ?? null,
    fromMode: attributes.get('from-mode') ?? null, fromPlugin: attributes.get('from-plugin') ?? null,
    hopChain: attributes.get('hop-chain')?.split(',').filter((hop) => hop.length > 0) ?? [], ...sminosParts(body), ...delivery,
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

// A message's text as both emission sites read it: the string, or its text blocks joined.
export function messageText(content: string | ContentBlock[]): string {
  return typeof content === 'string' ? content : content.filter((block) => block.type === 'text' && typeof block.text === 'string').map((block) => block.text as string).join('\n');
}

// The X1 event a peer `user` frame or record stands for beside its `user.message` (Design §4): `peer.message` for a
// cross-session or teammate envelope, `subagent.message` for an in-process agent's. `origin` is the frame's or record's own
// `origin` object, which fills what the text never carries (the hop chain) or lacks (Decision Log 22). Null when the
// text is no envelope: the message then stays a plain bubble. A message with no address to answer is not replyable:
// `unknown` is the engine's stand-in for a sender whose envelope gave none (sminos's delivery, `origin.from`), no address.
export function peerEventsOf(text: string, messageUuid: MessageUuid | null, origin?: unknown): PeerMessagePayload | SubagentMessagePayload | null {
  const parsed = parsePeerMessage(text);
  if (parsed === null) return null;
  if (parsed.kind === 'agent') return { kind: 'subagent.message', direction: 'from_child', fromAgentId: parsed.fromAgentId as AgentId, toAgentId: null, text: parsed.body };
  const o = typeof origin === 'object' && origin !== null ? (origin as Record<string, unknown>) : {};
  const string = (value: unknown) => (typeof value === 'string' && value.length > 0 ? value : null);
  const address = (value: unknown) => (string(value) === UNKNOWN_SENDER ? null : string(value));
  const from = address(parsed.from) ?? address(o.from) ?? '';
  const hopChain = Array.isArray(o.hopChain) && o.hopChain.every((hop) => typeof hop === 'string') ? (o.hopChain as string[]) : parsed.hopChain;
  return {
    kind: 'peer.message', messageUuid, from, fromSession: parsed.fromSession, fromName: parsed.fromName ?? string(o.name), fromMode: parsed.fromMode ?? string(o.fromMode),
    fromPlugin: parsed.fromPlugin ?? string(o.plugin), hopChain, text: parsed.body, midTurn: parsed.midTurn, lineage: parsed.lineage,
    replyable: parsed.replyable && from !== '',
  };
}

// E7 M2: what a SendMessage result says about the send, for the transcript's outbound row and the Reply's relay alike.
// The engine reports a send it could not make as data, `{ success: false, message }`, not as an error result (SPEC 38
// §38.24.6; e7-peer-a seq 311); the structured result carries it on both paths, and the JSON text when it is absent. An
// error result (an input the engine refused) is failed with its text, the `<tool_use_error>` tags dropped.
export function sendMessageOutcome(result: { isError: boolean; content: string | ContentBlock[]; structured: unknown }): { ok: true } | { ok: false; message: string } {
  const text = messageText(result.content);
  if (result.isError) return { ok: false, message: text.replace(/<\/?tool_use_error>/g, '').trim() };
  const data = typeof result.structured === 'object' && result.structured !== null ? (result.structured as Record<string, unknown>) : jsonObject(text);
  if (data?.success !== false) return { ok: true };
  return { ok: false, message: typeof data.message === 'string' ? data.message : text };
}

function jsonObject(text: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(text);
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
