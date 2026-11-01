// RL2's channel messages (RL3's subscriptions and calls, RL4's actions and queries, RL7's device capabilities), sealed
// JSON (Interfaces §B of docs/doperpowers/plans/2026-10-27-p5-o10-endpoint.md). The channel (channel.ts) carries any
// `{ t, … }` and handles `part` and `close` itself; `readMessage` sorts what it delivers into a known message, one of a
// kind this version doesn't know (a newer peer of the same major: ignored, OX1), or a malformed one (which closes).
// A known message's named fields are checked; others it carries pass, as additions within a major do.
import { isAction, type Action } from './action.ts';
import { isBase64urlOf } from './base64url.ts';
import { isIsoMillis } from './names.ts';
import type { Right, DeviceClass, RootTransition, Signed, SignedOrgState } from './types.ts';

/** One vocabulary for `ack`, `result`, `ended` and `close`. */
export const REFUSAL_REASONS = [
  'stale', 'malformed', 'expired', 'replayed', 'context', 'digest-mismatch', 'op-conflict', 'no-ledger', 'not-offered', 'ungraded', 'no-rule',
  'no-target', 'grade', 'step-up', 'class', 'read-only', 'ceiling', 'unknown-checkout', 'spec-field', 'state-too-old', 'act-required',
  'unavailable', 'removed', 'restart', 'busy', 'behind',
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];
export const isRefusalReason = (value: unknown): value is RefusalReason => typeof value === 'string' && (REFUSAL_REASONS as readonly string[]).includes(value);

/** The largest byte credit a subscription holds (M8). */
export const SUB_CREDIT_MAX = 4 * 1024 * 1024;
/** Who runs an act, as a query names it. `machine` (`mawsd`'s services' ledger, `machine.op`) is sent only to a peer whose
 * handshake listed `rl2.executor.machine` (P5 O7 M2; RL2_PROTOCOL 1.1), `pty-host` (the pty host's ledger, `pty.op`)
 * only to one that listed `rl2.executor.pty-host` (P5 O7 M3; 1.3): an older endpoint finds either malformed. */
export type Executor = 'sminos' | 'engine-host' | 'endpoint' | 'machine' | 'pty-host';
const EXECUTORS: readonly string[] = ['sminos', 'engine-host', 'endpoint', 'machine', 'pty-host'] satisfies readonly Executor[];
export type SessionRef = { lane: 'A' | 'B'; id: string };
/** A subscription's cursor: lane A's epoch is the endpoint's upstream subscription, lane B's the launch; `idx`, lane B's
 * only, is the event's index within its journal row. */
export type Cursor = { epoch: string; seq: number; idx?: number };
export type QueryState = 'done' | 'in-progress' | 'refused' | 'not-received' | 'expired' | 'unavailable';

/** `session` (P5 O7 M4, behind `rl2.call-session`): the session a path-class read is made from, which the endpoint's
 * `checkout` target rule reads. An older endpoint passes it by unread, and offers no row that needs it. */
export type CallMessage = { t: 'call'; id: string; name: string; input: unknown; session?: SessionRef };
export type ActMessage = { t: 'act'; action: Action };
export type QueryMessage = { t: 'query'; opId: string; opCreated: string; executor: Executor };
/**
 * A feed (P5 O7 M4 and M6, behind `rl2.feeds`): a subscription to a machine's events that carry no session cursor, every
 * opening a `snapshot`. `checkout` names its session; `attention` names none. A `sub` with a `feed` goes only to an
 * endpoint that listed `rl2.feeds`: an older one would read a `checkout` feed as the session's own stream, and close the
 * channel on an `attention` one.
 */
export type Feed = 'checkout' | 'attention';
const FEEDS: readonly string[] = ['checkout', 'attention'] satisfies readonly Feed[];
/** A session's stream (no `feed`), or its `checkout` feed. */
export type SessionSubMessage = { t: 'sub'; sub: string; session: SessionRef; view?: 'full' | 'cards'; feed?: 'checkout'; cursor: Cursor | null; credit: number };
/** The machine's `attention` feed (M6), which names no session. */
export type MachineFeedSubMessage = { t: 'sub'; sub: string; feed: 'attention'; cursor: Cursor | null; credit: number };
export type SubMessage = SessionSubMessage | MachineFeedSubMessage;
export type CreditMessage = { t: 'credit'; sub: string; bytes: number };
export type UnsubMessage = { t: 'unsub'; sub: string };

/** RL7's device half: what this device may do on the machine, sent after the handshake and on every change. */
export type CapsMessage = { t: 'caps'; member: string; device: string; clientClass: DeviceClass; machine: { grades: Right[] }; stateVersion: number };
export type ResultMessage = { t: 'result'; id: string; ok: true; output: unknown } | { t: 'result'; id: string; ok: false; error: { code: string; message?: string } };
export type AckMessage = { t: 'ack'; opId: string; state: 'accepted' } | { t: 'ack'; opId: string; state: 'refused'; reason: string };
export type DoneMessage = { t: 'done'; opId: string; outcome: unknown };
/** `reason`: why the endpoint said nothing of the operation (`grade`, `class`), with `state: 'refused'` and no `outcome`;
 * a `refused` with an `outcome` is the operation's own refusal by its executing side. */
export type QueriedMessage = { t: 'queried'; opId: string; state: QueryState; outcome?: unknown; reason?: string };
export type SubbedMessage = { t: 'subbed'; sub: string; mode: 'replay' | 'snapshot' | 'missing'; epoch: string; seq: number; idx?: number };
export type EvMessage = { t: 'ev'; sub: string; epoch: string; seq: number; idx?: number; body: unknown };
export type SnapMessage = { t: 'snap'; sub: string; epoch: string; seq: number; idx?: number; page: number; last: boolean; body: unknown };
export type PausedMessage = { t: 'paused'; sub: string; reason: string };
export type ResumedMessage = { t: 'resumed'; sub: string };
export type EndedMessage = { t: 'ended'; sub: string; reason: string };

/**
 * Streams (P5 O7 M3, behind `rl2.streams`; RL2_PROTOCOL 1.3; O7's Interfaces §N): a byte flow inside the channel, opened
 * by the device under an act it sent (`op`, the act's opId), its bytes base64url (RFC 4648 §5, unpadded) in chunks of at
 * most STREAM_CHUNK_BYTES, each direction within the other side's credit (`streamCredit`, at most STREAM_CREDIT_MAX at
 * once). `id` is the device's, 16 random bytes base64url, unique on its channel. A device opens one only on a channel
 * whose endpoint listed the capability, and the endpoint sends stream kinds only on a stream the device opened, so a
 * device that never listed it never receives one. An older reader would ignore the kinds as unknown (`readMessage`); what
 * closes a channel is a known kind out of shape, which a peer reading these at 1.3 holds them to.
 */
export type StreamKind = 'pty' | 'tcp';
const STREAM_KINDS: readonly string[] = ['pty', 'tcp'] satisfies readonly StreamKind[];
/** Why an open is refused: the act doesn't authorize it (`grade`), names nothing the machine still holds (`unknown`: a
 * fresh act may), the port answers no connection (`unreachable`), the channel holds MAX_STREAMS (`busy`), the open is out
 * of shape (`malformed`), or the machine can't say now (`unavailable`: ask again). */
export const STREAM_REFUSALS = ['grade', 'unknown', 'unreachable', 'busy', 'malformed', 'unavailable'] as const;
export type StreamRefusal = (typeof STREAM_REFUSALS)[number];
/** The most a `streamData` carries, decoded. */
export const STREAM_CHUNK_BYTES = 64 * 1024;
/** The most credit either side grants a stream at once. */
export const STREAM_CREDIT_MAX = 4 * 1024 * 1024;
/** The most streams one channel holds at once (`busy` past it). */
export const MAX_STREAMS = 32;
/** A pty stream's start: the output offset it reads from (the pty host's), and its input's epoch and offset (the device's). */
export type StreamPtyOpen = { ptyId: string; from: number; inputEpoch: string; inputFrom: number };
export type StreamOpenMessage = { t: 'streamOpen'; id: string; kind: StreamKind; op: string; credit: number; pty?: StreamPtyOpen; tcp?: { forward: string } };
/** `pty.ringStart`: where the output this opening delivers starts, max(from, the ring's start); a value past `from` says
 * the ring moved past it. `credit`: the endpoint's, for the device's bytes. */
export type StreamOpenedMessage = { t: 'streamOpened'; id: string; pty?: { info: Record<string, unknown>; ringStart: number; nextOffset: number }; credit: number };
export type StreamRefusedMessage = { t: 'streamRefused'; id: string; reason: StreamRefusal };
/** `offset`: the sender's byte count on this stream (a pty's output: the pty host's; its input: the device's, per epoch) before this chunk. */
export type StreamDataMessage = { t: 'streamData'; id: string; offset: number; data: string };
export type StreamControlMessage = { t: 'streamControl'; id: string; control: Record<string, unknown> };
export type StreamCreditMessage = { t: 'streamCredit'; id: string; bytes: number };
/** `reason`: `closed`, `behind`, `exit`, `removed`, `malformed`, or another short word. */
export type StreamCloseMessage = { t: 'streamClose'; id: string; reason: string };
export type DeviceStreamMessage = StreamOpenMessage | StreamDataMessage | StreamControlMessage | StreamCreditMessage | StreamCloseMessage;
export type EndpointStreamMessage = StreamOpenedMessage | StreamRefusedMessage | StreamDataMessage | StreamCreditMessage | StreamCloseMessage;

export type StateMessage = { t: 'state'; states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
export type PingMessage = { t: 'ping'; at: number };
export type PongMessage = { t: 'pong'; at: number };
/** `stateVersion` rides with `behind` only (§A's catch-up). */
export type CloseMessage = { t: 'close'; reason: string; stateVersion?: number };

export type EitherMessage = StateMessage | PingMessage | PongMessage | CloseMessage;
export type DeviceMessage = CallMessage | ActMessage | QueryMessage | SubMessage | CreditMessage | UnsubMessage | DeviceStreamMessage | EitherMessage;
export type EndpointMessage =
  | CapsMessage
  | ResultMessage
  | AckMessage
  | DoneMessage
  | QueriedMessage
  | SubbedMessage
  | EvMessage
  | SnapMessage
  | PausedMessage
  | ResumedMessage
  | EndedMessage
  | EndpointStreamMessage
  | EitherMessage;

type Fields = Record<string, unknown>;
const isObject = (v: unknown): v is Fields => typeof v === 'object' && v !== null && !Array.isArray(v);
const isText = (v: unknown, max = 256): v is string => typeof v === 'string' && v !== '' && v.length <= max;
const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isPositive = (v: unknown, max: number): v is number => isCount(v) && v >= 1 && v <= max;
const optional = (v: unknown, check: (v: unknown) => boolean) => v === undefined || check(v);
const OP_ID = /^[A-Za-z0-9_-]{16,128}$/;
const isOpId = (v: unknown) => typeof v === 'string' && OP_ID.test(v);
const position = (m: Fields) => isText(m.epoch) && isCount(m.seq) && optional(m.idx, isCount);

function isCursor(v: unknown, lane: 'A' | 'B'): boolean {
  return v === null || (isObject(v) && isText(v.epoch) && isCount(v.seq) && (v.idx === undefined || (lane === 'B' && isCount(v.idx))));
}

const isSessionRef = (v: unknown): v is SessionRef => isObject(v) && (v.lane === 'A' || v.lane === 'B') && isText(v.id);

// A stream's fields, read whole: an id or an epoch is exactly 16 bytes' canonical base64url, a chunk 1 to
// STREAM_CHUNK_BYTES bytes of base64url (its alphabet and a length some encoding has; the receiver decodes it), credit
// within STREAM_CREDIT_MAX, a pty open's start and a tcp open's forward each present for their kind only.
const isStreamId = (v: unknown) => isBase64urlOf(v, 16);
const CHUNK_TEXT = /^[A-Za-z0-9_-]+$/;
const CHUNK_TEXT_MAX = Math.ceil((STREAM_CHUNK_BYTES * 4) / 3);
const isChunk = (v: unknown) => typeof v === 'string' && v.length >= 2 && v.length <= CHUNK_TEXT_MAX && v.length % 4 !== 1 && CHUNK_TEXT.test(v);
const isPtyOpen = (v: unknown) => isObject(v) && isText(v.ptyId, 128) && isCount(v.from) && isStreamId(v.inputEpoch) && isCount(v.inputFrom);
const isTcpOpen = (v: unknown) => isObject(v) && isText(v.forward, 128);
const streamOpen = (m: Fields) =>
  isStreamId(m.id) &&
  STREAM_KINDS.includes(m.kind as string) &&
  isOpId(m.op) &&
  isPositive(m.credit, STREAM_CREDIT_MAX) &&
  (m.kind === 'pty' ? isPtyOpen(m.pty) && m.tcp === undefined : isTcpOpen(m.tcp) && m.pty === undefined);
const STREAM_EITHER: Record<string, (m: Fields) => boolean> = {
  streamData: (m) => isStreamId(m.id) && isCount(m.offset) && isChunk(m.data),
  streamCredit: (m) => isStreamId(m.id) && isPositive(m.bytes, STREAM_CREDIT_MAX),
  streamClose: (m) => isStreamId(m.id) && isText(m.reason, 64),
};

const EITHER: Record<string, (m: Fields) => boolean> = {
  state: (m) => Array.isArray(m.states) && Array.isArray(m.transitions),
  ping: (m) => isCount(m.at),
  pong: (m) => isCount(m.at),
  close: (m) => isText(m.reason, 64) && optional(m.stateVersion, isCount),
};

const FROM_DEVICE: Record<string, (m: Fields) => boolean> = {
  ...EITHER,
  call: (m) => isText(m.id, 128) && isText(m.name, 128) && 'input' in m && optional(m.session, isSessionRef),
  act: (m) => isAction(m.action),
  query: (m) => isOpId(m.opId) && isIsoMillis(m.opCreated) && EXECUTORS.includes(m.executor as string),
  sub: (m) =>
    isText(m.sub, 128) &&
    isPositive(m.credit, SUB_CREDIT_MAX) &&
    (m.feed === undefined
      ? isSessionRef(m.session) && optional(m.view, (v) => v === 'full' || v === 'cards') && isCursor(m.cursor, m.session.lane)
      : // A feed's cursor is `(epoch, seq)`, as lane A's; it has no view. `checkout` names its session, `attention` none.
        FEEDS.includes(m.feed as string) && m.view === undefined && isCursor(m.cursor, 'A') && (m.feed === 'attention' ? m.session === undefined : isSessionRef(m.session))),
  credit: (m) => isText(m.sub, 128) && isPositive(m.bytes, SUB_CREDIT_MAX),
  unsub: (m) => isText(m.sub, 128),
  ...STREAM_EITHER,
  streamOpen,
  streamControl: (m) => isStreamId(m.id) && isObject(m.control),
};

const GRADES = ['spawn', 'shell', 'machine-admin'];
const FROM_ENDPOINT: Record<string, (m: Fields) => boolean> = {
  ...EITHER,
  caps: (m) =>
    isText(m.member) &&
    isText(m.device) &&
    (m.clientClass === 'native-mac' || m.clientClass === 'web-cards') &&
    isObject(m.machine) &&
    Array.isArray(m.machine.grades) &&
    m.machine.grades.every((g) => GRADES.includes(g as string)) &&
    isCount(m.stateVersion),
  result: (m) => isText(m.id, 128) && (m.ok === true ? 'output' in m : m.ok === false && isObject(m.error) && isText(m.error.code, 64) && optional(m.error.message, (v) => typeof v === 'string')),
  ack: (m) => isOpId(m.opId) && (m.state === 'accepted' || (m.state === 'refused' && isText(m.reason, 64))),
  done: (m) => isOpId(m.opId) && 'outcome' in m,
  queried: (m) => isOpId(m.opId) && ['done', 'in-progress', 'refused', 'not-received', 'expired', 'unavailable'].includes(m.state as string) && optional(m.reason, (v) => isText(v, 64)),
  subbed: (m) => isText(m.sub, 128) && (m.mode === 'replay' || m.mode === 'snapshot' || m.mode === 'missing') && position(m),
  ev: (m) => isText(m.sub, 128) && position(m) && 'body' in m,
  snap: (m) => isText(m.sub, 128) && position(m) && isCount(m.page) && typeof m.last === 'boolean' && 'body' in m,
  paused: (m) => isText(m.sub, 128) && isText(m.reason, 64),
  resumed: (m) => isText(m.sub, 128),
  ended: (m) => isText(m.sub, 128) && isText(m.reason, 64),
  ...STREAM_EITHER,
  streamOpened: (m) =>
    isStreamId(m.id) && isPositive(m.credit, STREAM_CREDIT_MAX) && optional(m.pty, (v) => isObject(v) && isObject(v.info) && isCount(v.ringStart) && isCount(v.nextOffset)),
  streamRefused: (m) => isStreamId(m.id) && (STREAM_REFUSALS as readonly string[]).includes(m.reason as string),
};

/**
 * A delivered message, read as the vocabulary of the side that sent it: `message` when it is a known kind in its shape,
 * `unknown` for a kind this version doesn't know (ignore it), `malformed` for a known kind out of shape (close).
 */
export function readMessage(from: 'device', value: unknown): { kind: 'message'; message: DeviceMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' };
export function readMessage(from: 'endpoint', value: unknown): { kind: 'message'; message: EndpointMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' };
export function readMessage(from: 'device' | 'endpoint', value: unknown): { kind: 'message'; message: DeviceMessage | EndpointMessage } | { kind: 'unknown'; t: string } | { kind: 'malformed' } {
  if (!isObject(value) || typeof value.t !== 'string') return { kind: 'malformed' };
  const table = from === 'device' ? FROM_DEVICE : FROM_ENDPOINT;
  const check = Object.hasOwn(table, value.t) ? table[value.t] : undefined;
  if (check === undefined) return value.t === 'part' ? { kind: 'malformed' } : { kind: 'unknown', t: value.t };
  return check(value) ? { kind: 'message', message: value as DeviceMessage } : { kind: 'malformed' };
}
