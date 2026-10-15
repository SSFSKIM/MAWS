// DX4 — session-plane messages: the envelope (DC3's) and the three shapes the hub interprets. Everything inside a
// body that comes from the engine (transcript rows, `turn.step` chunks, session records, subagent meta) passes through
// verbatim and is typed as an open object.
import type { JsonObject } from './json';
import type { Mac } from './log';

/** A pending permission prompt or question, as the bridge reports it. */
export type Raised = {
  /**
   * The request's id, opaque to every consumer (the DX6 digest carries it as given): the call's tool-use id where the
   * engine gives one (`toolu_…`; an ask-mod question's `toolu_plugin_…` raise id), otherwise a synthetic `request-…`.
   */
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
  /** An async question of the ask mod's: answered or withdrawn, never denied. */
  async?: true;
  mac: Mac;
};

/** `withdrawn`: the request ended with no answer used (the turn aborted, the session ended, the call settled another way). */
export type SettledOutcome = 'allow' | 'deny' | 'answered' | 'withdrawn';

/**
 * Exactly one per `raised`; `winner` is the side whose answer the engine used (DC2's semantics): `web` with `by` the
 * member id; `terminal` with `by` `"terminal"`; `other` with `by` `"cli"` for a local CLI answer, or `"bridge"` with
 * `outcome` `withdrawn` when no answer was used. `"terminal"` and `"bridge"` are reserved: no member id is either.
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
 * identified by `(turnId, agentId, step)`, with its content blocks still unsettled. One response is several transcript
 * rows, one per content block, so streaming is tracked per block.
 */
export type Streaming = {
  turnId: string;
  agentId: string | null;
  /** The model request's ordinal in the turn. */
  step: number;
  /** What the request was sent with; absent when its start was not seen. */
  model?: string;
  /**
   * The watermark: the `chunkIndex` of the last chunk applied to the message (-1 for none). `chunkIndex` counts across
   * the whole message, so a chunk at or below it is already in the text, whichever block it belongs to.
   */
  upTo: number;
  /**
   * Only blocks without a `block-row` yet. The producer (the bridge's endpoint; the fake machine) removes a block from
   * its snapshot state when it applies the block's `block-row`, under the same lock that takes snapshots, so no
   * snapshot holds a block whose `block-row` was already sent. An entry whose `blocks` is empty can remain until its
   * step ends, and is skipped.
   */
  blocks: StreamingBlock[];
};

/** One content block's partial text. */
export type StreamingBlock = {
  /** The content block's index, the same `index` its chunks and its `block-row` carry. */
  index: number;
  /** `thinking` includes redacted thinking; a `tool` block's text is its argument JSON streamed so far, unparsed. */
  kind: 'text' | 'thinking' | 'tool';
  text: string;
  /** The last chunk this block's text includes: informational only (the entry's `upTo` is the watermark). */
  upTo: number;
  /** A tool block's call: its `tool_use_id` and tool name. */
  id?: string;
  name?: string;
};

/**
 * The row that settles a streaming block: sent when the engine writes the row for content block `index` of that step,
 * before the row itself arrives. Two moments: the producer drops the block from its snapshot state when it applies the
 * `block-row` (so later snapshots leave it out); the browser keeps drawing the block's partial text until the `row`
 * whose `uuid` the `block-row` named arrives, which settles the block, and drops it then. Chunks for a settled block are
 * ignored. A row no `block-row` named (a server tool's) settles nothing and is simply drawn.
 * The hub relays it uninterpreted.
 */
export type BlockRow = { uuid: string; turnId: string; agentId: string | null; step: number; index: number };

export type SessionPresence = {
  /** `status`, `waitingFor`, and `needs` of `~/.claude/sessions/<pid>.json` verbatim; null when no process is live. */
  record: JsonObject | null;
  bridge: boolean;
};

/**
 * A session's context use and cost: the bridge's `usage` event (DX5) verbatim, after each main turn, from the engine's
 * `$.session.usage()`. `tokens` and `percent` are absent until a response reported the window's fill; `cost` is null
 * where the engine keeps no ledger.
 */
export type Usage = {
  context: { tokens?: number; window: number; percent?: number };
  cost: { usd: number } | null;
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
   * agent's; an agent-scope sub's are that agent's own. `usage` is the bridge's last `usage` on a main-scope sub (null
   * without a bridge or before the first one) and absent on an agent-scope sub.
   */
  snapshot: { rows: JsonObject[]; more: boolean; subagents: SubagentMeta[]; presence: SessionPresence; streaming: Streaming[]; usage?: Usage | null };
  /** A transcript row verbatim; `agentId` names the subagent whose transcript it is in. */
  row: { row: JsonObject; agentId: string | null };
  /** A `turn.step` chunk object verbatim under `chunk`, nested beside its message's identity and its index in that
   * message from 0 (DX5's chunk event). */
  chunk: { turnId: string; agentId: string | null; step: number; chunkIndex: number; chunk: JsonObject };
  'block-row': BlockRow;
  /** Older rows of the sub's transcript, newest first, answering a browser's `rows` request. */
  rows: { rows: JsonObject[]; before: string; more: boolean };
  subagents: { subagents: SubagentMeta[] };
  /** Unified diff of the session's working tree against its base branch, answering a browser's `diff` (main-scope subs
   * only; computed on request, never pushed). */
  diff: { base: string; text: string };
  /** After each main turn, on main-scope subs only: the one source of a session's context use and cost on the web. */
  usage: Usage;
  /**
   * The subscription is over; the browser subscribes again for a fresh snapshot when it wants one. `discontinuity`:
   * the bridge's own stream lost events (DX5's `gap`), so the live part no longer follows the snapshot.
   */
  end: { reason: 'unsubscribed' | 'machine-offline' | 'session-ended' | 'discontinuity' | 'error'; message?: string };
  presence: SessionPresence;
  /**
   * A compaction of the session, outside any subscription, to every browser (the bridge's `compact` events, DX5): its
   * start, then its end with the counts (null where the engine recorded none), a `skip` (why a hook vetoed it), or an
   * `error` (the engine refused it). `rpc` is the nonce of the DX6 `compact` that asked for it, or null when the session
   * compacted on its own. The hub relays it without reading it.
   */
  compact: {
    rpc: string | null;
    phase: 'start' | 'end';
    tokensBefore?: number | null;
    tokensAfter?: number | null;
    skip?: string;
    error?: string;
  };
  machine: MachinePresence;
  raised: Raised;
  settled: Settled;
  delivery: Delivery;
};

export type SubagentMeta = { agentId: string; meta: JsonObject };

export type SessionKind = keyof SessionBodies;

/** The kinds that belong to a subscription (`sub` and `n` set); the rest are published to every browser of the project. */
export const SUBSCRIPTION_KINDS = ['snapshot', 'row', 'chunk', 'block-row', 'rows', 'subagents', 'diff', 'usage', 'end'] as const satisfies readonly SessionKind[];
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

/** The kinds published to every browser of the project, outside any subscription, naming a session. */
export const SESSION_WIDE_KINDS = ['presence', 'compact', 'raised', 'settled', 'delivery'] as const satisfies readonly SessionKind[];

/**
 * The envelope, discriminated by `kind`. A subscription's kinds carry `session`, `sub`, and `n`: 0 for the snapshot,
 * then n = 1, 2, … (`end` may come first, at n 0: a subscription ended before its snapshot could be taken, with the
 * reason it would carry later); a gap makes the browser subscribe again. `presence`, `compact`, `raised`, `settled`, and
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
