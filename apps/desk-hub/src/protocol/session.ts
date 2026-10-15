// DX4 — session-plane messages: the envelope (DC3's) and the three shapes the hub interprets. Everything inside a
// body that comes from the engine (transcript rows, `turn.step` chunks, session records, subagent meta) passes through
// verbatim and is typed as an open object.
import type { JsonObject } from './json';
import type { Mac } from './log';

/** A pending permission prompt or question, as the bridge reports it. */
export type Raised = {
  /** The tool-use id. */
  request: string;
  session: string;
  tool: string;
  input: JsonObject;
  /**
   * A background subagent's prompt: when the web's window closes (§2's 3 s). After it nothing is settled: the request
   * stays pending, answerable only in the terminal, until the terminal's answer settles it. The web reads that state
   * from DX3's `pending` (`terminal_only`, the hub's clock), never by comparing this time with its own.
   */
  deadline?: string;
  mac: Mac;
};

/** `withdrawn`: the request ended with no answer used (the turn aborted, the session ended, the call settled another way). */
export type SettledOutcome = 'allow' | 'deny' | 'answered' | 'withdrawn';

/**
 * Exactly one per `raised`; `winner` is the side whose answer the engine used (DC2's semantics): `web` with `by` the
 * member id; `terminal` with `by` `"terminal"`; `other` with `by` `"cli"` for a local CLI answer, or `"bridge"` with
 * `outcome` `withdrawn` when no answer was used.
 */
export type Settled = {
  request: string;
  winner: 'web' | 'terminal' | 'other';
  outcome: SettledOutcome;
  by: string;
  mac: Mac;
};

/** One per log event and recipient, when `deliver_next` settles the event on the recipient's machine. */
export type Delivery = {
  event: { writer: string; seq: number };
  session: string;
  outcome: 'delivered' | 'recorded' | 'refused-read-only' | 'failed';
  reason: string;
  mac: Mac;
};

/**
 * A model request still streaming, as the bridge's snapshot carries it (DX5's `streaming` entries, passed through):
 * identified by `(turnId, agentId, step)`, with its content blocks that no row has settled yet. One response is
 * several transcript rows, one per content block, so streaming is tracked per block.
 */
export type Streaming = JsonObject & {
  turnId: string;
  agentId: string | null;
  /** The model request's ordinal in the turn. */
  step: number;
  /** Only unsettled blocks: a block leaves once a `block-row` named its row and the row arrived. */
  blocks: StreamingBlock[];
};

/** One content block's partial text, through chunk `upTo` (the `chunkIndex` of the last chunk it includes; -1 for none). */
export type StreamingBlock = JsonObject & {
  /** The content block's index, the same `index` its chunks carry. */
  index: number;
  /** The block's type as the bridge names it (text, thinking, a tool call's input). */
  kind: string;
  text: string;
  upTo: number;
};

/**
 * The row that settles a streaming block: sent when the engine writes the row for content block `index` of that step,
 * before the row itself arrives. A `row` whose `uuid` a `block-row` named settles that block's partial text; chunks for
 * a settled block are ignored. The hub relays it uninterpreted.
 */
export type BlockRow = { uuid: string; turnId: string; agentId: string | null; step: number; index: number };

export type SessionPresence = {
  /** `status`, `waitingFor`, and `needs` of `~/.claude/sessions/<pid>.json` verbatim; null when no process is live. */
  record: JsonObject | null;
  bridge: boolean;
};

export type MachinePresence = {
  /** Set by the hub from the machine's lease; a producer sends `true`. */
  online: boolean;
  policy: { read_only: boolean; ceiling: string };
  checkouts: Array<{ path: string; branch: string }>;
};

export type SessionBodies = {
  /**
   * n = 0. Rows of the sub's transcript (the main one, or one subagent's), newest first, up to the last flushed row, as
   * many as fit the frame budget. A main-scope sub's `subagents` is the session's tree and its `streaming` every
   * agent's; an agent-scope sub's are that agent's own.
   */
  snapshot: { rows: JsonObject[]; more: boolean; subagents: SubagentMeta[]; presence: SessionPresence; streaming: Streaming[] };
  /** A transcript row verbatim; `agentId` names the subagent whose transcript it is in. */
  row: { row: JsonObject; agentId: string | null };
  /** A `turn.step` chunk object verbatim under `chunk`, nested beside its message's identity and its index in that
   * message from 0 (DX5's chunk event). */
  chunk: { turnId: string; agentId: string | null; step: number; chunkIndex: number; chunk: JsonObject };
  'block-row': BlockRow;
  /** Older rows of the sub's transcript, newest first, answering a browser's `rows` request. */
  rows: { rows: JsonObject[]; before: string; more: boolean };
  subagents: { subagents: SubagentMeta[] };
  /** Unified diff of the session's working tree against its base branch. */
  diff: { base: string; text: string };
  /**
   * The subscription is over; the browser subscribes again for a fresh snapshot when it wants one. `discontinuity`:
   * the bridge's own stream lost events (DX5's `gap`), so the live part no longer follows the snapshot.
   */
  end: { reason: 'unsubscribed' | 'machine-offline' | 'session-ended' | 'discontinuity' | 'error'; message?: string };
  presence: SessionPresence;
  machine: MachinePresence;
  raised: Raised;
  settled: Settled;
  delivery: Delivery;
};

export type SubagentMeta = { agentId: string; meta: JsonObject };

export type SessionKind = keyof SessionBodies;

/** The kinds that belong to a subscription (`sub` and `n` set); the rest are published to every browser of the project. */
export const SUBSCRIPTION_KINDS = ['snapshot', 'row', 'chunk', 'block-row', 'rows', 'subagents', 'diff', 'end'] as const satisfies readonly SessionKind[];
export type SubscriptionKind = (typeof SUBSCRIPTION_KINDS)[number];

/** The kinds the hub interprets; it relays every other kind without reading its body. */
export const INTERPRETED_KINDS = ['presence', 'machine', 'raised', 'settled', 'delivery'] as const satisfies readonly SessionKind[];

type Envelope<K extends SessionKind, Session extends string | null, Sub extends string | null, N extends number | null> = {
  project: string;
  machine: string;
  session: Session;
  kind: K;
  sub: Sub;
  n: N;
  body: SessionBodies[K];
};

/**
 * The envelope, discriminated by `kind`. A subscription's kinds carry `session`, `sub`, and `n` (0 for the snapshot,
 * then the live messages from 1: a gap makes the browser subscribe again); `presence`, `raised`, `settled`, and
 * `delivery` carry `session` with `sub` and `n` null; `machine` carries all three null.
 */
export type SessionMessage<K extends SessionKind = SessionKind> = {
  [P in K]: P extends 'snapshot'
    ? Envelope<P, string, string, 0>
    : P extends SubscriptionKind
      ? Envelope<P, string, string, number>
      : P extends 'machine'
        ? Envelope<P, null, null, null>
        : Envelope<P, string, null, null>;
}[K];
