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
  // P5 O7 M9: a setup row asked by anyone but the machine's owners, and the setup policy's refusals of a folder
  'owners-only', 'no-folder', 'outside-home', 'symlink-escape', 'protected',
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
 * channel on an `attention` one. P5 O7 M5a: `artifacts`, the machine's artifact and library changes, names none either,
 * and goes only to an endpoint that listed `rl2.artifacts` (an older one reads the value `malformed` and closes).
 */
export type Feed = SessionFeed | MachineFeed;
/**
 * The feeds that name their session: M4's `checkout`, and (P5 O17 M9a, behind `rl2.browser-screencast`; O17's Interfaces
 * §K) `browser.inventory`, the agent's tabs on the session as the machine's tab engine holds them, a snapshot at each
 * change. A device sends the latter only to an endpoint that listed the capability: an older one reads it `malformed`.
 */
export type SessionFeed = 'checkout' | 'browser.inventory';
/**
 * The feeds that name no session: the machine's own (M6's `attention`, M5a's `artifacts`). P5 O8 M7b (behind
 * `rl2.channel`): `channel`, a project's to-human entries on the machine, which names its `project` (sminos's project id)
 * and is the only feed that does. A device sends it only to an endpoint that listed the capability: an older one reads
 * it `malformed` and closes.
 */
export type MachineFeed = 'attention' | 'artifacts' | 'channel';
const MACHINE_FEEDS: readonly string[] = ['attention', 'artifacts', 'channel'] satisfies readonly MachineFeed[];
const SESSION_FEEDS: readonly string[] = ['checkout', 'browser.inventory'] satisfies readonly SessionFeed[];
const FEEDS: readonly string[] = [...SESSION_FEEDS, ...MACHINE_FEEDS];
/** Whether `feed` is one of the machine's own feeds, which name no session. */
export const isMachineFeed = (feed: unknown): feed is MachineFeed => MACHINE_FEEDS.includes(feed as string);
/**
 * A session's stream (no `feed`), or one of its feeds (`checkout`; P5 O17 M9a: `browser.inventory`). 2026-11-06 (behind
 * `rl2.agent-scope`; RL2_PROTOCOL 1.11): a lane A session's `full` stream may name one subagent's transcript, `agentId`
 * as sminos spells an agent id, in place of the main one. A device names one only to an endpoint that listed the
 * capability: an older one passes the field by unread and would serve the main transcript in its place.
 */
export type SessionSubMessage = { t: 'sub'; sub: string; session: SessionRef; view?: 'full' | 'cards'; feed?: SessionFeed; agentId?: string; cursor: Cursor | null; credit: number };
/** One of the machine's own feeds (M6's `attention`, M5a's `artifacts`), which name no session; `channel`'s its `project`. */
export type MachineFeedSubMessage = { t: 'sub'; sub: string; feed: MachineFeed; project?: string; cursor: Cursor | null; credit: number };
export type SubMessage = SessionSubMessage | MachineFeedSubMessage;
/** Whether `m` subscribes to one of the machine's own feeds (no session). */
export const isMachineFeedSub = (m: SubMessage): m is MachineFeedSubMessage => isMachineFeed(m.feed);
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
/**
 * P5 O7 M5b (behind `rl2.read-open`; RL2_PROTOCOL 1.5): the read open, a `streamOpen` that names no `op`, admitted by a
 * stream row of the endpoint's offer table at the row's grade: `http` (one request to the machine's artifact endpoint) and
 * `document` (one endpoint document channel). A device sends one only to an endpoint that listed the capability: an
 * older endpoint reads a missing `op`, or these kinds, as `malformed` and closes the channel. A `pty` or `tcp` open (the act
 * open) still names its act.
 *
 * P5 O17 M9a (behind `rl2.browser-screencast`; RL2_PROTOCOL 1.8; docs/doperpowers/plans/2026-11-01-p5-o17-browser.md,
 * Interfaces §K): the read open's third kind, `browser.screencast`, one viewer of one agent tab on a session (`browser`),
 * its frames in screencast.ts' envelope, its controls (`ack`, `input`) on `streamControl`. A controlling open names its
 * done `machine.browserControl` act in `browser.control.op`, never as the stream's `op`: the stream row admits it, and
 * the act is the grant it carries. A device opens one only on a channel whose endpoint listed the capability, and only
 * such an endpoint answers `streamOpened.browser` or the refusals `engine-changed` and `control-busy`.
 */
export type StreamKind = ActStreamKind | ReadStreamKind;
/** The kinds opened under an act (`op`). */
export type ActStreamKind = 'pty' | 'tcp';
/** The kinds of the read open (no `op`; P5 O7 M5b). */
export type ReadStreamKind = 'http' | 'document' | 'browser.screencast';
const ACT_STREAM_KINDS: readonly string[] = ['pty', 'tcp'] satisfies readonly ActStreamKind[];
const READ_STREAM_KINDS: readonly string[] = ['http', 'document', 'browser.screencast'] satisfies readonly ReadStreamKind[];
/** Whether `kind` is a read open's (no `op`). */
export const isReadStreamKind = (kind: unknown): kind is ReadStreamKind => READ_STREAM_KINDS.includes(kind as string);
/** Why an open is refused: the act doesn't authorize it (`grade`), names nothing the machine still holds (`unknown`: a
 * fresh act may), the port answers no connection (`unreachable`), the channel holds MAX_STREAMS (`busy`), the open is out
 * of shape (`malformed`), or the machine can't say now (`unavailable`: ask again). P5 O7 M5b: `read-only`, an edit open
 * the machine's policy refuses, sent only in answer to a read open, which only a device that listed `rl2.read-open` makes
 * (an older validator would close the channel on it). P5 O17 M9a: `engine-changed` (the open names an epoch the session's
 * tab engine has left) and `control-busy` (another viewer controls the tab), each only in answer to a `browser.screencast`
 * open, which only a device that listed `rl2.browser-screencast` makes. */
export const STREAM_REFUSALS = ['grade', 'unknown', 'unreachable', 'busy', 'malformed', 'unavailable', 'read-only', 'engine-changed', 'control-busy'] as const;
export type StreamRefusal = (typeof STREAM_REFUSALS)[number];
/** The most a `streamData` carries, decoded. */
export const STREAM_CHUNK_BYTES = 64 * 1024;
/** The most credit either side grants a stream at once. */
export const STREAM_CREDIT_MAX = 4 * 1024 * 1024;
/** The most streams one channel holds at once (`busy` past it). */
export const MAX_STREAMS = 32;
/**
 * A pty stream's start: the output offset it reads from (the pty host's), and its input's epoch and offset (the device's).
 * `inputFrom`: the device's earliest input not yet refunded, resent from there. `inputSent`: the end of the input the
 * device already sent in this epoch (absent: `inputFrom`); an endpoint holding no record of the epoch (it restarted, or
 * forgot it) can't tell what of `[inputFrom, inputSent)` it wrote, and drops it: input is at most once.
 */
export type StreamPtyOpen = { ptyId: string; from: number; inputEpoch: string; inputFrom: number; inputSent?: number };
/** An `http` read open (P5 O7 M5b): one request to the machine's artifact endpoint, `url` a `maws-artifact:` URL. */
export type StreamHttpOpen = { url: string; method: 'GET' | 'HEAD'; range?: string };
/** A `document` read open (P5 O7 M5b): one endpoint document channel on the artifact, to edit or to view. */
export type StreamDocumentOpen = { artifactId: string; mode: 'edit' | 'view'; doc?: 'suggestions' };
/**
 * A `browser.screencast` read open (P5 O17 M9a): one tab of the session's agent browser, under the epoch the viewer read
 * it in (`mawsd`'s, opaque); `control.op`, a done `machine.browserControl` act of this channel's member and device on the
 * same session and epoch, for a controlling open (none: read-only).
 */
export type StreamBrowserOpen = { appSessionId: string; epoch: string; tabId: string; control?: { op: string } };
/** A `browser.screencast` answer (P5 O17 M9a): the epoch and tab it views, and whether it takes input. */
export type StreamBrowserOpened = { epoch: string; tabId: string; control: boolean };
/** `op`: the authorizing act's opId, for the act open (`pty`, `tcp`); absent for the read open (`http`, `document`, `browser.screencast`). */
export type StreamOpenMessage = { t: 'streamOpen'; id: string; kind: StreamKind; op?: string; credit: number; pty?: StreamPtyOpen; tcp?: { forward: string }; http?: StreamHttpOpen; document?: StreamDocumentOpen; browser?: StreamBrowserOpen };
/** `pty.ringStart`: where the output this opening delivers starts, max(from, the ring's start); a value past `from` says
 * the ring moved past it. `credit`: the endpoint's, for the device's bytes. `http` (P5 O7 M5b): the artifact endpoint's
 * status and headers; the body follows as `streamData` from offset 0, then `streamClose 'closed'`. `browser` (P5 O17
 * M9a): what a `browser.screencast` open views; its frames follow as `streamData` from offset 0. */
export type StreamOpenedMessage = { t: 'streamOpened'; id: string; pty?: { info: Record<string, unknown>; ringStart: number; nextOffset: number }; http?: { status: number; headers: Record<string, string> }; browser?: StreamBrowserOpened; credit: number };
export type StreamRefusedMessage = { t: 'streamRefused'; id: string; reason: StreamRefusal };
/** `offset`: the sender's byte count on this stream (a pty's output: the pty host's; its input: the device's, per epoch) before this chunk. */
export type StreamDataMessage = { t: 'streamData'; id: string; offset: number; data: string };
export type StreamControlMessage = { t: 'streamControl'; id: string; control: Record<string, unknown> };
export type StreamCreditMessage = { t: 'streamCredit'; id: string; bytes: number };
/** `reason`: `closed`, `behind`, `exit`, `removed`, `malformed`, or another short word. */
export type StreamCloseMessage = { t: 'streamClose'; id: string; reason: string };
export type DeviceStreamMessage = StreamOpenMessage | StreamDataMessage | StreamControlMessage | StreamCreditMessage | StreamCloseMessage;
export type EndpointStreamMessage = StreamOpenedMessage | StreamRefusedMessage | StreamDataMessage | StreamCreditMessage | StreamCloseMessage;

/**
 * The client port across the channel (P5 O7 M5c, behind `rl2.client-port`; RL2_PROTOCOL 1.6; O7's Interfaces §M): a
 * request of the machine's services for an effect only the asking device can perform (`openExternal {url}`: a connector's
 * consent page), posted to the channel that asked, and its answer. `id` is the machine's, unique among its pending
 * requests; `kind` one of the port's kinds (`openExternal`, `reveal`, …), read by the device, which answers a kind it
 * does not serve `{noClient: true}`; `request` and `answer` are the port's own shapes (`src/shared/client/port.ts`). The
 * endpoint sends `client` only to a device whose `h1` listed the capability, and the device answers only a `client` it
 * was sent, so an older peer never meets either kind.
 */
export type ClientMessage = { t: 'client'; id: string; kind: string; request: unknown };
export type ClientAnswerMessage = { t: 'clientAnswer'; id: string; answer: unknown };

export type StateMessage = { t: 'state'; states: SignedOrgState[]; transitions: Signed<RootTransition>[] };
export type PingMessage = { t: 'ping'; at: number };
/**
 * `at` echoes the ping's. P5 O7 M7 (`rl2.pong-clock`; RL2_PROTOCOL 1.6): the endpoint's clock at the ping's arrival
 * (`received`) and at the pong's send (`sent`), milliseconds, from which the remote bench estimates the machine's clock
 * offset. An older reader passes them by (named fields only are checked), so they need no gate; the capability tells a
 * device they are meant.
 */
export type PongMessage = { t: 'pong'; at: number; received?: number; sent?: number };
/** `stateVersion` rides with `behind` only (§A's catch-up). */
export type CloseMessage = { t: 'close'; reason: string; stateVersion?: number };

export type EitherMessage = StateMessage | PingMessage | PongMessage | CloseMessage;
export type DeviceMessage = CallMessage | ActMessage | QueryMessage | SubMessage | CreditMessage | UnsubMessage | DeviceStreamMessage | ClientAnswerMessage | EitherMessage;
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
  | ClientMessage
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
/** An agent id as sminos's plane takes one (`AGENT_ID`, sminos_plane.py). */
const AGENT_ID = /^[A-Za-z0-9_-]{1,128}$/;

// A stream's fields, read whole: an id or an epoch is exactly 16 bytes' canonical base64url, a chunk 1 to
// STREAM_CHUNK_BYTES bytes of base64url (its alphabet and a length some encoding has; the receiver decodes it), credit
// within STREAM_CREDIT_MAX, a pty open's start and a tcp open's forward each present for their kind only.
const isStreamId = (v: unknown) => isBase64urlOf(v, 16);
const CHUNK_TEXT = /^[A-Za-z0-9_-]+$/;
const CHUNK_TEXT_MAX = Math.ceil((STREAM_CHUNK_BYTES * 4) / 3);
const isChunk = (v: unknown) => typeof v === 'string' && v.length >= 2 && v.length <= CHUNK_TEXT_MAX && v.length % 4 !== 1 && CHUNK_TEXT.test(v);
const isPtyOpen = (v: unknown) =>
  isObject(v) && isText(v.ptyId, 128) && isCount(v.from) && isStreamId(v.inputEpoch) && isCount(v.inputFrom) && (v.inputSent === undefined || (isCount(v.inputSent) && v.inputSent >= v.inputFrom));
const isTcpOpen = (v: unknown) => isObject(v) && isText(v.forward, 128);
// The read open's fields (P5 O7 M5b): the URL's own shape is the endpoint's to read (`malformed` there, as a refusal).
const isHttpOpen = (v: unknown) => isObject(v) && isText(v.url, 4096) && (v.method === 'GET' || v.method === 'HEAD') && optional(v.range, (r) => isText(r, 256));
const isDocumentOpen = (v: unknown) => isObject(v) && isText(v.artifactId, 128) && (v.mode === 'edit' || v.mode === 'view') && optional(v.doc, (d) => d === 'suggestions');
// P5 O17 M9a: a screencast open's session, epoch and tab (their own shapes the endpoint's to read), and its act's opId.
const isBrowserOpen = (v: unknown) => isObject(v) && isText(v.appSessionId, 512) && isText(v.epoch) && isText(v.tabId) && optional(v.control, (c) => isObject(c) && isOpId(c.op));
/** Each kind's own field and its check; an open carries its kind's and no other's. */
const STREAM_OPEN_FIELDS: Readonly<Record<StreamKind, readonly [string, (v: unknown) => boolean]>> = {
  pty: ['pty', isPtyOpen],
  tcp: ['tcp', isTcpOpen],
  http: ['http', isHttpOpen],
  document: ['document', isDocumentOpen],
  'browser.screencast': ['browser', isBrowserOpen],
};
const streamOpen = (m: Fields) => {
  if (!isStreamId(m.id) || !isPositive(m.credit, STREAM_CREDIT_MAX)) return false;
  // The act open names its act; the read open names none.
  if (ACT_STREAM_KINDS.includes(m.kind as string) ? !isOpId(m.op) : !READ_STREAM_KINDS.includes(m.kind as string) || m.op !== undefined) return false;
  const [own, check] = STREAM_OPEN_FIELDS[m.kind as StreamKind];
  return check(m[own]) && Object.values(STREAM_OPEN_FIELDS).every(([field]) => field === own || m[field] === undefined);
};
/** An answer's `http` (P5 O7 M5b): an HTTP status and headers whose values are strings. */
const isHttpAnswer = (v: unknown) =>
  isObject(v) && Number.isSafeInteger(v.status) && (v.status as number) >= 100 && (v.status as number) <= 599 && isObject(v.headers) && Object.values(v.headers).every((h) => typeof h === 'string');
const STREAM_EITHER: Record<string, (m: Fields) => boolean> = {
  streamData: (m) => isStreamId(m.id) && isCount(m.offset) && isChunk(m.data),
  streamCredit: (m) => isStreamId(m.id) && isPositive(m.bytes, STREAM_CREDIT_MAX),
  streamClose: (m) => isStreamId(m.id) && isText(m.reason, 64),
};

const EITHER: Record<string, (m: Fields) => boolean> = {
  state: (m) => Array.isArray(m.states) && Array.isArray(m.transitions),
  ping: (m) => isCount(m.at),
  pong: (m) => isCount(m.at) && optional(m.received, isCount) && optional(m.sent, isCount),
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
      ? isSessionRef(m.session) &&
        optional(m.view, (v) => v === 'full' || v === 'cards') &&
        isCursor(m.cursor, m.session.lane) &&
        // `rl2.agent-scope`: one subagent's transcript, of a lane A session's `full` stream alone
        optional(m.agentId, (a) => typeof a === 'string' && AGENT_ID.test(a) && (m.session as SessionRef).lane === 'A' && m.view !== 'cards')
      : // A feed's cursor is `(epoch, seq)`, as lane A's; it has no view and names no agent. `checkout` names its session,
        // the machine's none.
        FEEDS.includes(m.feed as string) && m.view === undefined && m.agentId === undefined && isCursor(m.cursor, 'A') && (isMachineFeed(m.feed) ? m.session === undefined : isSessionRef(m.session))) &&
    // P5 O8 M7b: `channel` names its project, and no other sub names one.
    (m.feed === 'channel' ? isText(m.project, 512) : m.project === undefined),
  credit: (m) => isText(m.sub, 128) && isPositive(m.bytes, SUB_CREDIT_MAX),
  unsub: (m) => isText(m.sub, 128),
  ...STREAM_EITHER,
  streamOpen,
  streamControl: (m) => isStreamId(m.id) && isObject(m.control),
  clientAnswer: (m) => isText(m.id, 128) && 'answer' in m, // P5 O7 M5c
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
    isStreamId(m.id) &&
    isPositive(m.credit, STREAM_CREDIT_MAX) &&
    optional(m.pty, (v) => isObject(v) && isObject(v.info) && isCount(v.ringStart) && isCount(v.nextOffset)) &&
    optional(m.http, isHttpAnswer) &&
    optional(m.browser, (v) => isObject(v) && isText(v.epoch) && isText(v.tabId) && typeof v.control === 'boolean'),
  streamRefused: (m) => isStreamId(m.id) && (STREAM_REFUSALS as readonly string[]).includes(m.reason as string),
  client: (m) => isText(m.id, 128) && isText(m.kind, 64) && 'request' in m, // P5 O7 M5c
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
