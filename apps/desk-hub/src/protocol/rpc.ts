// DX6 — RPCs: the shapes (DC3's). The policy that refuses them is DC7's; the at-most-once ledger is the daemon's.
import type { Settled } from './session';

/** An RPC older than this is not forwarded by the hub and is refused by the daemon (unless its ledger knows the nonce). */
export const RPC_FRESHNESS_MS = 60_000;

/** The request as the browser drew it: `input_sha256` is the lowercase hex SHA-256 of the input's canonical JSON. */
export type Digest = { session: string; request: string; tool: string; input_sha256: string };

/**
 * A scoped allow (§7, §11): `suggestion` the index into the pending request's `suggestions` as drawn, `sha256` the
 * lowercase hex SHA-256 of that suggestion's canonical JSON (as `input_sha256` is of an input), `destination`
 * `session` (nothing saved, whatever the suggestion named) or `localSettings` (the checkout's
 * `.claude/settings.local.json`, only where the suggestion itself names it). The daemon resolves the rule from the
 * request its bridge still holds, never from the browser: a hash that no longer matches is `not-pending` (the
 * suggestions changed); a suggestion but an `addRules` or `addDirectories` one, or a `localSettings` it did not offer, is
 * `bad-shape`. A daemon older than sminos 1.13.0 ignores `scope` and allows as asked, so the web offers it only where
 * the session's `controls['decide.scope']` (or `decide.addDirectory`) is available.
 */
export type SuggestionScope = { suggestion: number; sha256: string; destination: 'session' | 'localSettings' };

/** The media an upload takes (MW5): the stored file's extension, and the native Read's image or PDF handling, follow it. */
export const MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf'] as const;
export type MediaType = (typeof MEDIA_TYPES)[number];

/**
 * One file of an upload (MW5): `name` for display only, `[A-Za-z0-9][A-Za-z0-9._-]{0,127}` (the stored name is the
 * daemon's, `<nonce>.<n>.<ext>`, so a missing or mismatched suffix, or the same name twice, is no matter); `mediaType`
 * one of MEDIA_TYPES and matching the bytes' signature; `data` the bytes in standard base64.
 */
export type MediaAttachment = { name: string; mediaType: MediaType; data: string };

export type RpcArgs = {
  /** A user row appended to the running turn, read at the loop's next model request; refused `idle` when no turn runs. */
  steer: { session: string; text: string };
  /** Abort the main loop's turn and stop any Bash the abort moved to the background. */
  interrupt: { session: string };
  /** Answer a pending question; `answers` maps each question's text to the chosen label (labels joined by ", "). */
  answer: { session: string; digest: Digest; answers: Record<string, string> };
  /**
   * Allow or deny a pending permission prompt. `scope` (an allow's; sminos 1.13.0, the desk control surface spec's MW3)
   * also adds one of the request's own suggestions (`Raised.suggestions`).
   */
  decide: { session: string; digest: Digest; decision: 'allow' | 'deny'; message?: string; scope?: SuggestionScope };
  /**
   * This session's main-loop model and effort, from its next request on; at least one is set. `model` is a model id, a
   * family alias the session's `ANTHROPIC_DEFAULT_<FAMILY>_MODEL` maps, or `"default"` (the session's own).
   */
  model: { session: string; model?: string; effort?: string };
  /**
   * Compact now, or at the turn's end when asked during one; the outcome follows as the session's `compact` events.
   * `instructions`, at most 4,096 characters, tell the summary what to keep (`/compact <instructions>`).
   */
  compact: { session: string; instructions?: string };
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
  /**
   * A side question of a bridged session (the desk control surface spec, §9): one tool-less completion over the
   * session's transcript as the main thread last sent it, nothing written into the conversation. `prompt` is the
   * person's question, 1 to 8,192 characters and not blank; the bridge frames it.
   */
  btw: { session: string; prompt: string };
  /**
   * Stop one running subagent of a bridged session (the desk control surface spec, §9; MW4): `agentId` an agent's id or
   * the name its Agent call gave it, never its description, 1 to 128 characters, not blank, without a control character
   * (a path-neutral name may hold a space; 2.1.310's Agent tool admits none). The daemon refuses one the session's
   * subagent tree does not hold as running, `unknown-agent`, before the claim, resolving an id first, then the name of
   * exactly one running agent (a name two running agents hold is `ambiguous-agent`); the bridge stops the agent the
   * daemon resolved, and no other, with `TaskStop`, and leaves its parent's loop a note that the person stopped it and it
   * is not to be started again or redone.
   */
  'stop-agent': { session: string; agentId: string };
  /**
   * A message to one running subagent of a bridged session (§9; MW4): `agentId` as `stop-agent`'s, `text` not blank. The
   * bridge sends it with the engine's own delivery, under a line saying the person wrote it; the agent reads it at its
   * next step. An agent the tree does not hold as running is `unknown-agent`: a message would revive one that ended; a
   * name two running agents hold, `ambiguous-agent`.
   */
  tell: { session: string; agentId: string; text: string };
  /**
   * Image and PDF intake (the desk control surface spec, MW5): 1 to 4 attachments, all within the RPC's 1 MiB (the hub's
   * frame bound, not an engine limit). The daemon saves them inside the session's live working directory, under
   * `.claude/desk-uploads/<session>/`, without following a link, and the bridge reads each into the conversation with a
   * native Read of its own at the main loop's next step, so the next model request carries it as an `image` block, or a
   * `document` for a PDF (read whole). `delivery` is `queued-turn`, the one delivery there is: an idle session is woken
   * for it. Lane A refuses `text` (`bad-shape`): the words go as a Send, the browser's sealed `human` event.
   */
  media: { session: string; attachments: MediaAttachment[]; delivery: 'queued-turn' };
};

export type RpcName = keyof RpcArgs;

export const RPC_NAMES = ['steer', 'interrupt', 'answer', 'decide', 'model', 'compact', 'spawn', 'retire', 'resume', 'stop', 'command', 'btw', 'stop-agent', 'tell', 'media'] as const satisfies readonly RpcName[];

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
  /**
   * Answered at once, whether or not a turn runs: `id` the op's own, which its DX4 `op` start and end name (`op:
   * 'btw'`). The answer follows as that end: `text` (at most 64 KiB of UTF-8, `truncated: true` when cut) and `usage`,
   * or a `reason`. A side question asked before the session's first model request (or after `/clear`) is refused at
   * once: `failed`, its message `nothing-to-fork: …`.
   */
  btw: { started: true; id: string };
  /**
   * The agent stopped: `agentId` the spelling asked, `resolvedAgentId` the id a name resolved to (absent when an id was
   * asked). The answer is the outcome: `TaskStop` answers at once, so no `op` follows; the agent's end reaches the web in
   * the session's subagent tree. A refusal of the bridge's after the claim (the agent ended meanwhile) is `failed`, its
   * code the message's first word. `noteError`, present only when the parent's note was not kept (a hook refused it, its
   * loop had ended): the agent is stopped, but its parent was not told, and may start it again.
   */
  'stop-agent': { agentId: string; accepted: true; resolvedAgentId?: string; noteError?: string };
  /** The message is in the agent's queue (not yet read). The answer is the outcome: no `op` follows. */
  tell: { sent: true };
  /**
   * Answered once the session's bridge holds the upload (one it already held counts), not when the files are saved:
   * `upload` is the RPC's nonce, which every `op` of it names (`op: 'media'`, `id` the upload); `root` the absolute
   * directory the files were saved in, pinned there (a later `/cd` does not move it); `paths` each file's name in `root`,
   * in the order sent. Each attachment's state then follows as `op` (`MediaOpBody`). A refusal of the bridge's is
   * `failed`, its code the message's first word, and the files are removed.
   */
  media: { queued: true; upload: string; intake: 'native-read'; root: string; paths: string[] };
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
  | 'unknown-agent' // a stop-agent or tell naming no agent the session's subagent tree holds as running (before the claim)
  | 'ambiguous-agent' // a stop-agent or tell naming by name two agents the session's subagent tree holds as running (before the claim)
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
