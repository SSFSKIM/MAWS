// The sends at a session view's tail (the composite's §9.1; the DC9 plan's M4): every send to the session that no row of
// its transcript is yet known to be — this tab's outbox items on their way to the log, the log's `human`s addressed to
// the session, and the steers this tab issued — each with the state its delivery is in. A delivery's `delivered` says
// the text entered the session's queue, not that its row is on disk, so a send stays at the tail, whatever its state,
// until its own row is observed, and only then gives way to it.
//
// Matching is by identity alone, one to one. The bridge submits a send as sminos's delivery frame, whose first line
// names the event: `[sminos chat <project> <writer_short>:<seq> from …]` (`compose_chat_frame`, `event_ref`,
// `writer_short` in doperpowers' `sminos.py`; a web send's writer, `hub/<member>`, has no session part and stands whole),
// or `[sminos message from … id=<msg_id>]` for an event that carries a `msg_id` (`frame_of`, `compose_frame`). A steer's
// result names the row it appended. Nothing is matched by text: a prompt typed at the terminal is never a web send's
// row, however equal its words, and a send whose row never comes (the session ended first) stays, its state saying so.
//
// The log holds every send since the session joined while the view holds the transcript's newest rows until it pages
// further, so a send older than every held row is left out — its row, if any, is in the history not loaded — unless
// the view holds the transcript back to its first row. Before the transcript's first snapshot no log send is placed.
import type { Delivery, JsonObject, LogEvent, Recipient } from 'desk-hub/protocol';
import { failureOf, resultOf } from './outcome';
import { failureText } from './words';
import { deliveryKey, type OutboxItem, type RpcEntry } from '../project/conversation';

/** Where a send is: on its way (`sending`, `queued`, `delivered` — its row not seen yet), or a journey ended without one. */
export type FootState = 'sending' | 'queued' | 'delivered' | 'uncertain' | 'recorded' | 'refused-read-only' | 'failed' | 'not-sent';

export type TailSend = {
  /** Its identity: the frame it is named by (`sendRef`), an outbox nonce, or a steer's nonce. */
  key: string;
  via: 'send' | 'steer';
  text: string;
  /** When it was sent, where known. */
  at: string | null;
  state: FootState;
  /** What the machine or the hub said of it, for the foot's tooltip. */
  reason: string | null;
};

export type TailInput = {
  session: string;
  machine: string;
  /** The project's log as the browser holds it, verified. */
  entries: readonly { offset: number; event: LogEvent }[];
  deliveries: Record<string, Record<string, Delivery>>;
  outbox: readonly OutboxItem[];
  rpcs: readonly RpcEntry[];
  /** The transcript's held rows, raw, and whether they reach its first row; null before its first snapshot. */
  transcript: { rows: readonly JsonObject[]; complete: boolean } | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** sminos's `writer_short`: a writer's session part cut to 8, or the whole writer when it names no session. */
const writerShort = (writer: string): string => {
  const last = writer.slice(writer.lastIndexOf('/') + 1);
  return UUID.test(last) ? last.slice(0, 8) : writer;
};

/** The identity a delivery frame names an event by. */
export function sendRef(event: { writer: string; seq: number; msg_id?: unknown }): string {
  return typeof event.msg_id === 'string' && event.msg_id !== '' ? `message:${event.msg_id}` : `chat:${writerShort(event.writer)}:${event.seq}`;
}

const CHAT_FRAME = /^\[sminos chat .*? (\S+:\d+) from /;
const MESSAGE_FRAME = /^\[sminos message from .* id=([^\]\s]+)\]$/;

/** The event a prompt's frame names, from its first line; null for a prompt that is not a delivery. */
export function frameRef(text: string): string | null {
  const line = text.split('\n', 1)[0];
  const chat = CHAT_FRAME.exec(line);
  if (chat) return `chat:${chat[1]}`;
  const message = MESSAGE_FRAME.exec(line);
  return message ? `message:${message[1]}` : null;
}

const object = (value: unknown): JsonObject | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as JsonObject) : null);

/** The prompt texts a row carries: a user row's text or text blocks (never a tool's result), a queued command's prompt. */
function promptsOf(row: JsonObject): string[] {
  if (row.type === 'user') {
    const content = object(row.message)?.content;
    if (typeof content === 'string') return [content];
    if (Array.isArray(content)) return content.flatMap((block) => (object(block)?.type === 'text' && typeof object(block)!.text === 'string' ? [object(block)!.text as string] : []));
    return [];
  }
  const attachment = object(row.attachment);
  return row.type === 'attachment' && attachment?.type === 'queued_command' && typeof attachment.prompt === 'string' ? [attachment.prompt] : [];
}

/** What the held rows say of the sends: the events their frames name, their uuids, and when the oldest was written. */
function heldFacts(rows: readonly JsonObject[]): { refs: Set<string>; uuids: Set<string>; since: string | null } {
  const refs = new Set<string>();
  const uuids = new Set<string>();
  let since: string | null = null;
  for (const row of rows) {
    if (typeof row.uuid === 'string') uuids.add(row.uuid);
    if (typeof row.timestamp === 'string' && (since === null || row.timestamp < since)) since = row.timestamp;
    for (const text of promptsOf(row)) {
      const ref = frameRef(text);
      if (ref !== null) refs.add(ref);
    }
  }
  return { refs, uuids, since };
}

const addressedTo = (event: LogEvent, session: string) => Array.isArray(event.to) && (event.to as Recipient[]).some((r) => typeof r === 'object' && r !== null && r.session === session);

/** A steer's state as its RPC stands; null once there is nothing to wait for (done, with no row of its own). */
function steerState(entry: RpcEntry, machine: string): { state: FootState; reason: string | null; row: string | null } | null {
  switch (entry.state) {
    case 'sending':
    case 'forwarded':
      return { state: 'sending', reason: null, row: null };
    case 'uncertain':
      return { state: 'uncertain', reason: `${machine} dropped before answering: it may or may not have happened`, row: null };
    case 'not-connected':
      return { state: 'not-sent', reason: 'the project socket was down; nothing was sent', row: null };
    case 'failed': {
      const failure = failureOf(entry.outcome);
      return { state: 'failed', reason: failure ? failureText(failure, machine) : null, row: null };
    }
    case 'done': {
      const row = resultOf(entry.outcome)?.row;
      return typeof row === 'string' ? { state: 'delivered', reason: null, row } : null;
    }
  }
}

export function tailSends(input: TailInput): TailSend[] {
  const { session, machine, transcript } = input;
  const out: TailSend[] = [];
  const held = transcript ? heldFacts(transcript.rows) : null;

  const sends: TailSend[] = [];
  if (transcript && held) {
    for (const { event } of input.entries) {
      if (event.kind !== 'human' || !addressedTo(event, session)) continue;
      if (!transcript.complete && (held.since === null || event.ts < held.since)) continue;
      const key = sendRef(event);
      if (held.refs.has(key)) continue;
      const delivery = input.deliveries[deliveryKey(event)]?.[session];
      sends.push({ key, via: 'send', text: typeof event.text === 'string' ? event.text : '', at: event.ts, state: delivery?.outcome ?? 'queued', reason: delivery?.reason || null });
    }
  }
  for (const entry of input.rpcs) {
    const { rpc } = entry;
    if (rpc.rpc !== 'steer' || rpc.machine !== machine || rpc.args.session !== session) continue;
    const steer = steerState(entry, machine);
    if (steer === null || (steer.row !== null && held?.uuids.has(steer.row))) continue;
    sends.push({ key: `steer:${entry.nonce}`, via: 'steer', text: rpc.args.text, at: rpc.created, state: steer.state, reason: steer.reason });
  }
  // The log's sends and the steers in the order they were sent (a stable sort keeps each one's own order).
  out.push(...sends.sort((a, b) => (a.at ?? '').localeCompare(b.at ?? '')));
  for (const item of input.outbox) {
    if (item.to === '*' || !item.to.some((r) => r.session === session)) continue;
    out.push({ key: `outbox:${item.nonce}`, via: 'send', text: item.text, at: null, state: item.state === 'refused' ? 'not-sent' : 'sending', reason: item.reason ?? null });
  }
  return out;
}

/** What a foot says of its send: the session's name and machine, and whether it runs, has ended, could be resumed. */
export type FootContext = { name: string; machine: string; running: boolean; ended: boolean; resumable: boolean };

/** A send's foot: its state, its short words, and the reason behind them for the tooltip. */
export function footOf(send: TailSend, ctx: FootContext): { state: FootState; words: string; reason: string | null } {
  const { state, reason } = send;
  return { state, words: send.via === 'steer' ? steerWords(state, reason) : sendWords(state, reason, ctx), reason };
}

const quoted = (reason: string | null) => (reason ? ` · “${reason}”` : '');

function sendWords(state: FootState, reason: string | null, ctx: FootContext): string {
  switch (state) {
    case 'sending':
      return 'Sending…';
    case 'not-sent':
      return 'Not sent · the hub refused it';
    case 'queued':
      return ctx.running ? `Queued · delivers when ${ctx.name} is idle` : 'Queued';
    case 'delivered':
      return ctx.ended ? 'Delivered · not seen in the transcript before the session ended' : `Delivered · waiting in ${ctx.name}'s queue`;
    case 'uncertain':
      return 'Possibly delivered';
    case 'recorded':
      return ctx.resumable ? 'Recorded, not delivered · Resume delivers it' : 'Recorded, not delivered';
    case 'refused-read-only':
      return `Not delivered · ${ctx.machine} is read-only`;
    case 'failed':
      return `Not delivered${quoted(reason)}`;
  }
}

function steerWords(state: FootState, reason: string | null): string {
  switch (state) {
    case 'sending':
    case 'queued':
      return 'Steer · sending';
    case 'delivered':
      return 'Steer · read at the next model request';
    case 'uncertain':
      return 'Steer · possibly delivered';
    case 'not-sent':
      return 'Steer not sent · the project socket was down';
    default:
      return `Steer not delivered${quoted(reason)}`;
  }
}
