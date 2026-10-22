// DX6 — RPCs: the shapes (DC3's). The policy that refuses them is DC7's; the at-most-once ledger is the daemon's.
import type { Settled } from './session';

/** An RPC older than this is not forwarded by the hub and is refused by the daemon (unless its ledger knows the nonce). */
export const RPC_FRESHNESS_MS = 60_000;

/** The request as the browser drew it: `input_sha256` is the lowercase hex SHA-256 of the input's canonical JSON. */
export type Digest = { session: string; request: string; tool: string; input_sha256: string };

export type RpcArgs = {
  /** A user row appended to the running turn, read at the loop's next model request; refused `idle` when no turn runs. */
  steer: { session: string; text: string };
  /** Abort the main loop's turn and stop any Bash the abort moved to the background. */
  interrupt: { session: string };
  /** Answer a pending question; `answers` maps each question's text to the chosen label (labels joined by ", "). */
  answer: { session: string; digest: Digest; answers: Record<string, string> };
  /** Allow or deny a pending permission prompt. */
  decide: { session: string; digest: Digest; decision: 'allow' | 'deny'; message?: string };
  /**
   * This session's main-loop model and effort, from its next request on; at least one is set. `model` is a model id, a
   * family alias the session's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` maps, or `"default"` (the session's own).
   */
  model: { session: string; model?: string; effort?: string };
  /** Compact now, or at the turn's end when asked during one; the outcome follows as the session's `compact` events. */
  compact: { session: string };
  /** A `claude --bg` session in a known checkout of the project on that machine. */
  spawn: { checkout: string; worktree?: string; brief: string; model?: string; effort?: string; permission_mode?: string };
  retire: { session: string };
  /** Bring an ended session back on its machine with the same id. */
  resume: { session: string };
  /**
   * Stop one background shell or monitor of a bridged session (DC10): `TaskStop` through the bridge. `taskId` as the
   * engine spells it, `[A-Za-z0-9_-]{1,64}`.
   */
  stop: { session: string; taskId: string };
  /**
   * Run one slash command in a bridged session (the desk control surface spec, §2–§3): `name` exactly as
   * `$.command.list()` spells it, 1 to 128 characters without a control character (an MCP prompt's ` (MCP)` suffix
   * included); `args` the text after it, at most 4,096 characters. The bridge's route table decides whether it runs;
   * the web never asserts a class.
   */
  command: { session: string; name: string; args?: string };
};

export type RpcName = keyof RpcArgs;

export const RPC_NAMES = ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'spawn', 'retire', 'resume', 'stop', 'command'] as const satisfies readonly RpcName[];

export type RpcResults = {
  /**
   * The uuid of the appended row; null when the session has no bridge and the steer went out another way (a `--bg`
   * seat's supervisor `reply`, or a send), which leaves no row of its own to name.
   */
  steer: { row: string | null };
  /**
   * The aborted turn (null when idle), the background tasks its Bash calls were moved to and TaskStop ended, and those
   * whose stop failed: a non-empty `running` is an incomplete interrupt.
   */
  interrupt: { turnId: string | null; stopped: string[]; running: string[] };
  answer: Record<string, never>;
  decide: Record<string, never>;
  /** The choice now in force; null for the session's own. */
  model: { model: string | null; effort: string | null };
  /** Answered at once: `now` when started, `turn-end` when held for the running turn's end. */
  compact: { at: 'now' | 'turn-end' };
  spawn: { session: string; alias: string };
  retire: Record<string, never>;
  resume: { session: string };
  /** The task asked to stop. Its `stopped` arrives on the session's DX4 body (the `TaskStop` row), not here. */
  stop: { taskId: string };
  /**
   * Answered at once, whether or not a turn runs (a command waits for the turn's end, H-queue): `route` the class the
   * bridge's table gave it, `id` the op's own, which its DX4 `op` start and end name. Its outcome follows as `op`; a
   * refusal of the bridge's is `failed`, the bridge's code the message's first word and its reason after.
   */
  command: { queued: true; route: string; id: string };
};

/**
 * An RPC as the browser seals it. The code (`mac`, the value alone) covers every other field — the RPC without `mac` —
 * under the domain `smns-hub-rpc-v1` and the project id; the nonce is the RPC's id.
 */
export type Rpc<N extends RpcName = RpcName> = {
  [P in N]: {
    rpc: P;
    project: string;
    machine: string;
    member: string;
    created: string;
    nonce: string;
    args: RpcArgs[P];
    mac: string;
  };
}[N];

export type RpcDraft<N extends RpcName = RpcName> = Rpc<N> extends infer R ? (R extends unknown ? Omit<R, 'mac'> : never) : never;

export type RpcErrorCode =
  // The hub's
  | 'machine-offline'
  | 'stale'
  | 'not-member'
  | 'bad-shape'
  // The daemon's (DC7), before execution. Every machine holds the org key, so a daemon binds an RPC to its own enrolled
  // name, project, and session before anything else.
  | 'wrong-machine'
  | 'unknown-project'
  | 'bad-code'
  | 'read-only'
  | 'digest-mismatch'
  | 'not-pending'
  | 'unknown-checkout'
  | 'above-ceiling'
  | 'no-session'
  | 'unsupported'
  | 'session-live'
  | 'idle' // a steer while no turn is running: the web offers Send instead
  | 'unknown-task' // a stop naming a task the session's jobs index does not hold as running (before the claim)
  // The daemon's, after a claim
  | 'copy-started'
  | 'interrupted'
  | 'failed';

/**
 * Why an RPC failed. A decision or answer that reaches the bridge too late is refused there (DX5's 409) and fails at the
 * daemon (DX6's `not-pending` fits; the mapping is DC7's), carrying what the bridge said, so the web draws the request
 * as settled by that side rather than as an error. The request's own `settled` still follows and is the record.
 */
export type RpcError = {
  code: RpcErrorCode;
  message: string;
  /** Another side's answer was used first: the side, as `Settled.winner` names it. */
  winner?: Settled['winner'];
  /** Who decided, as `Settled.by` names it (a member id, `"terminal"`, `"cli"`, or `"bridge"`), when the bridge said. */
  by?: string;
  /** Within 200 ms of a background request's deadline: the window closed, and only the terminal answers it now. */
  terminalOnly?: true;
};

export type RpcOutcome<N extends RpcName = RpcName> =
  | { state: 'done'; result: RpcResults[N] }
  | { state: 'failed'; error: RpcError };

/** The hub's record of an RPC: `forwarded` until a result, `uncertain` when the machine's lease lapsed before one. */
export type RpcState = 'forwarded' | 'done' | 'failed' | 'uncertain';
