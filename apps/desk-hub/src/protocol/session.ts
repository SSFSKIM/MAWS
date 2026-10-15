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
  /** A background subagent's prompt: when the web's window closes and the prompt is the terminal's alone (§2). */
  deadline?: string;
  mac: Mac;
};

export type SettledOutcome = 'allow' | 'deny' | 'answered' | 'withdrawn';

/** Exactly one per `raised`; `winner` is the side whose answer the engine used. */
export type Settled = {
  request: string;
  winner: 'web' | 'terminal' | 'other';
  outcome: SettledOutcome;
  /** The member id when the web won; otherwise the side's own label. */
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

/** A message the engine is still streaming, as a snapshot carries it. */
export type Streaming = {
  turnId: string;
  agentId: string | null;
  /** The ordinal of the model request within the turn. */
  request: number;
  /** The partial text, through chunk `upTo`. */
  text: string;
  upTo: number;
};

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
  /** n = 0. Rows newest first, up to the last flushed row, as many as fit the frame budget. */
  snapshot: { rows: JsonObject[]; more: boolean; subagents: SubagentMeta[]; presence: SessionPresence; streaming: Streaming[] };
  /** A transcript row verbatim; `agentId` names the subagent whose transcript it is in. */
  row: { row: JsonObject; agentId: string | null };
  /** A `turn.step` chunk verbatim, with its message's identity and its index in that message. */
  chunk: { chunk: JsonObject; turnId: string; agentId: string | null; request: number; index: number };
  /** Older rows, newest first, answering a browser's `rows` request. */
  rows: { rows: JsonObject[]; before: string; more: boolean };
  subagents: { subagents: SubagentMeta[] };
  /** Unified diff of the session's working tree against its base branch. */
  diff: { base: string; text: string };
  /** The subscription is over; the browser subscribes again for a fresh snapshot when it wants one. */
  end: { reason: 'unsubscribed' | 'machine-offline' | 'session-ended' | 'error'; message?: string };
  presence: SessionPresence;
  machine: MachinePresence;
  raised: Raised;
  settled: Settled;
  delivery: Delivery;
};

export type SubagentMeta = { agentId: string; meta: JsonObject };

export type SessionKind = keyof SessionBodies;

/** The kinds that belong to a subscription (`sub` and `n` set); the rest are published to every browser of the project. */
export const SUBSCRIPTION_KINDS = ['snapshot', 'row', 'chunk', 'rows', 'subagents', 'diff', 'end'] as const satisfies readonly SessionKind[];

/** The kinds the hub interprets; it relays every other kind without reading its body. */
export const INTERPRETED_KINDS = ['presence', 'machine', 'raised', 'settled', 'delivery'] as const satisfies readonly SessionKind[];

/**
 * The envelope. `session` is null for `machine`; `sub` and `n` are null outside a subscription. Within one `sub`, `n`
 * is 0 for the snapshot and counts the live messages from 1: a gap makes the browser subscribe again.
 */
export type SessionMessage<K extends SessionKind = SessionKind> = {
  [P in K]: {
    project: string;
    machine: string;
    session: string | null;
    kind: P;
    sub: string | null;
    n: number | null;
    body: SessionBodies[P];
  };
}[K];
