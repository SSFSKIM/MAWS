// The sends at a session view's tail (the composite's §9.1; the DC9 plan's M4): every send to the session that no row of
// its transcript is yet known to be — this tab's outbox items on their way to the log, the log's `human`s addressed to
// the session, and the steers this tab issued — each with the state its delivery is in. A delivery's `delivered` says
// the text entered the session's queue, not that its row is on disk, so a send stays at the tail, whatever its state,
// until its own row is observed, and only then gives way to it.
//
// Matching is by identity alone, one to one. sminos pushes a send as its delivery frame, and the prompt's whole first
// line must be the frame sminos writes for that event: `[sminos chat <project> <writer_short>:<seq> from <from> →
// <@you | @all | a broadcast's scope>[ | unread N]]` (`frame_of`, `compose_chat_frame`, `event_ref`, `writer_short` in doperpowers'
// `sminos.py`; a web send's writer, `hub/<member>`, has no session part and stands whole), or `[sminos message from
// <via or from> id=<msg_id>]` for an event that carries a `msg_id` (`compose_frame`). The row must mark a delivery's
// provenance (`delivery-frame.ts`): the bridge's plugin prompt as the user (an idle session), the bridge's row appended
// into the running turn (a busy one: a meta user row from the plugin, its frame the only word that it is a delivery),
// the peer message the engine made of a send through sminos's inbox (its frame the first line of the envelope's body),
// or a peer's or plugin's queued command; never a prompt typed at the terminal, another plugin's row, nor one that marks
// none. A steer's row has the bridge's appended shape too, but no frame: its result names the row it appended, and the
// steer is matched by that uuid. The bridge's wake (`isBridgeWake`) points at a row already there and matches nothing.
// Nothing is matched by text: a typed prompt is never a web send's row, however equal its words, and a send whose row
// never comes (the session ended first) stays, its state saying so.
//
// The log holds every send since the session joined while the view holds the transcript's newest rows until it pages
// further. A send whose row may yet exist (queued, delivered, possibly delivered) is placed only once the transcript is
// in, and only when it is no older than the oldest held row — its row, if any, may be in the history not loaded — or
// the view holds the transcript back to its first row. A send whose journey ended without a row (recorded, refused by
// a read-only machine, failed) stays at the tail whatever history is held.
import type { Delivery, JsonObject, LogEvent, Recipient } from 'desk-hub/protocol';
import { deliveredLines } from './delivery-frame';
import { broadcastLabel } from './stream';
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

/** A send's identity among the tail's rows: the event a delivery frame names. */
export function sendRef(event: { writer: string; seq: number; msg_id?: unknown }): string {
  return typeof event.msg_id === 'string' && event.msg_id !== '' ? `message:${event.msg_id}` : `chat:${writerShort(event.writer)}:${event.seq}`;
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A stand-in for each project name in a scope's label: escaped as itself, then opened. */
const OPEN = '\u0000';

/**
 * The first line sminos writes when it pushes this event, as a pattern over a whole line: `compose_frame`'s
 * `[sminos message from <via or from> id=<msg_id>]` for an event with a `msg_id`, else `compose_chat_frame`'s
 * `[sminos chat <project> <writer_short>:<seq> from <from> → <target>[ | unread N]]`, the target `@you`, or for a
 * broadcast (`wake`) its scope's label (`scopeLabel`), `@all` for a bare one. Only the project's name, the scope's
 * project names (each the machine's own for it) and the unread count are open.
 *
 * The scope's names stand side by side in its label, so they are one open run, with no `]`: an open run per name
 * backtracked exponentially over a long list. The line up to them is taken at its first place, through a lookahead,
 * which is atomic, so the two open runs never retry each other's splits.
 */
export function framePattern(event: { writer: string; seq: number; from?: unknown; via?: unknown; msg_id?: unknown; wake?: unknown; scope?: unknown }): RegExp {
  const str = (value: unknown) => (typeof value === 'string' ? value : '');
  if (str(event.msg_id) !== '') return new RegExp(`^${escape(`[sminos message from ${str(event.via) || str(event.from)} id=${str(event.msg_id)}]`)}$`);
  const fixed = escape(` ${writerShort(event.writer)}:${event.seq} from ${str(event.from)} → `);
  const end = '(?: \\| unread [1-9][0-9]*)?\\]$';
  const parts = event.wake === true ? escape(broadcastLabel(event.scope, () => OPEN)).split(OPEN) : ['@you'];
  if (parts.length === 1) return new RegExp(`^\\[sminos chat .+${fixed}${parts[0]}${end}`);
  return new RegExp(`^(?=(\\[sminos chat .+?${fixed}${parts[0]}))\\1[^\\]\\n]+${parts[parts.length - 1]}${end}`);
}

/** What the held rows say of the sends: the first lines that may be deliveries, the uuids, the oldest row's time. */
function heldFacts(rows: readonly JsonObject[]): { lines: string[]; uuids: Set<string>; since: string | null } {
  const lines: string[] = [];
  const uuids = new Set<string>();
  let since: string | null = null;
  for (const row of rows) {
    if (typeof row.uuid === 'string') uuids.add(row.uuid);
    if (typeof row.timestamp === 'string' && (since === null || row.timestamp < since)) since = row.timestamp;
    for (const line of deliveredLines(row)) if (line.startsWith('[sminos ')) lines.push(line);
  }
  return { lines, uuids, since };
}

/** Outcomes after which no row comes: the send stays at the tail whatever history the view holds. */
const NO_ROW: ReadonlySet<FootState> = new Set(['recorded', 'refused-read-only', 'failed']);

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
  /** Each held delivery line takes one send at most. */
  const taken = new Set<number>();

  const sends: TailSend[] = [];
  for (const { event } of input.entries) {
    if (event.kind !== 'human' || !addressedTo(event, session)) continue;
    const delivery = input.deliveries[deliveryKey(event)]?.[session];
    const state: FootState = delivery?.outcome ?? 'queued';
    // A send whose row may yet exist is placed only where the view could know: once the transcript is in, and, unless
    // it holds the transcript back to its first row, not older than the oldest row held.
    if (!NO_ROW.has(state) && (!transcript || !held || (!transcript.complete && (held.since === null || event.ts < held.since)))) continue;
    if (held) {
      const pattern = framePattern(event);
      const at = held.lines.findIndex((line, i) => !taken.has(i) && pattern.test(line));
      if (at >= 0) {
        taken.add(at);
        continue;
      }
    }
    sends.push({ key: sendRef(event), via: 'send', text: typeof event.text === 'string' ? event.text : '', at: event.ts, state, reason: delivery?.reason || null });
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

/**
 * What a foot says of its send, in words that name no session (the view names it, through `SessionLabel`): whether
 * the session runs, has ended, could be resumed.
 */
export type FootContext = { running: boolean; ended: boolean; resumable: boolean };

/** A send's foot: its state, its short words, and the reason behind them in full, for the tooltip. */
export function footOf(send: TailSend, ctx: FootContext): { state: FootState; words: string; reason: string | null } {
  const { state, reason } = send;
  return { state, words: send.via === 'steer' ? steerWords(state, reason) : sendWords(state, reason, ctx), reason };
}

/** The visible part of a reason: its first line, cut to a foot's width; the tooltip has the whole. */
const REASON_MAX = 60;
function quoted(reason: string | null): string {
  if (!reason) return '';
  const line = reason.split('\n', 1)[0].trim();
  return ` · “${line.length > REASON_MAX || line !== reason.trim() ? `${line.slice(0, REASON_MAX).trimEnd()}…` : line}”`;
}

function sendWords(state: FootState, reason: string | null, ctx: FootContext): string {
  switch (state) {
    case 'sending':
      return 'Sending…';
    case 'not-sent':
      return 'Not sent · the hub refused it';
    case 'queued':
      return ctx.running ? 'Queued · delivers when the session is idle' : 'Queued';
    case 'delivered':
      return ctx.ended ? 'Delivered · not seen in the transcript before the session ended' : 'Delivered · waiting in the session’s queue';
    case 'uncertain':
      return 'Possibly delivered';
    case 'recorded':
      return ctx.resumable ? 'Recorded, not delivered · Resume delivers it' : 'Recorded, not delivered';
    case 'refused-read-only':
      return 'Not delivered · the machine is read-only';
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
