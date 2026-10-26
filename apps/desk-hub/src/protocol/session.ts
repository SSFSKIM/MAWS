// DX4 — session-plane messages: the envelope (DC3's) and the three shapes the hub interprets. Everything inside a
// body that comes from the engine (transcript rows, `turn.step` chunks, session records, subagent meta) passes through
// verbatim and is typed as an open object.
import type { JsonObject, JsonValue } from './json';
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
  /** The tool's input as the bridge shows it; capped when `truncated`, and the DX6 digest is over this capped input on
   * both sides. */
  input: JsonObject;
  /** The subagent that asked; absent for the main thread. */
  agentId?: string;
  /** The bridge capped the input it shows. */
  truncated?: true;
  /**
   * The transcript's tool-use id of the call this request belongs to, present only when it differs from `request`: the
   * ask mod's blocking question is raised under the engine dialog's `toolu_plugin_…` id while the transcript holds the
   * outer call's `toolu_01…`. The code covers it like every other field.
   */
  toolUseId?: string;
  /**
   * A background subagent's prompt: when the web's window closes (§2's 3 s). After it nothing is settled: the request
   * stays pending, answerable only in the terminal, until the terminal's answer settles it. The web reads that state
   * from DX3's `pending` (`terminal_only`, the hub's clock), never by comparing this time with its own.
   */
  deadline?: string;
  /** An async question of the ask mod's: answered or withdrawn, never denied. */
  async?: true;
  /**
   * The engine's `permission_suggestions` for a permission prompt, verbatim (the desk control surface spec, MW3): a
   * rule, a directory or a mode the engine offers to add with the allow. At most `SUGGESTIONS_MAX`, each at most
   * `SUGGESTION_BYTES_MAX` bytes as canonical UTF-8 JSON; the bridge leaves a list past either bound out whole, and the
   * hub refuses a `raised` that carries one. Absent when the engine suggested nothing, when the list broke the bound, or
   * when the engine's input was not exactly the call the bridge saw (a secrets guard beneath restored a handle, whose
   * value a Bash rule would carry). A scoped allow (`RpcArgs.decide.scope`) names one by its index and hash. The code
   * covers it like every other field.
   */
  suggestions?: PermissionUpdate[];
  mac: Mac;
};

/** How many suggestions a `raised` carries at most, and each one's canonical UTF-8 JSON at most: the bridge's bound,
 * exactly (a `raised` the hub refuses refuses the request with it, and one bad entry a whole pending set). */
export const SUGGESTIONS_MAX = 8;
export const SUGGESTION_BYTES_MAX = 2048;

/** Where a permission update applies: `session` saves nothing; the others are settings files. */
export type PermissionDestination = 'userSettings' | 'projectSettings' | 'localSettings' | 'session' | 'cliArg';

/**
 * One permission update the engine suggests (the SDK's `PermissionUpdate`), passed through as the engine words it. A
 * scoped allow takes only an `addRules` or an `addDirectories` one; the others are shown, never applied from the desk.
 */
export type PermissionUpdate =
  | { type: 'addRules' | 'replaceRules' | 'removeRules'; rules: PermissionRule[]; behavior: 'allow' | 'deny' | 'ask'; destination: PermissionDestination }
  | { type: 'setMode'; mode: string; destination: PermissionDestination }
  | { type: 'addDirectories' | 'removeDirectories'; directories: string[]; destination: PermissionDestination };

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

/**
 * One per log event and recipient, when `deliver_next` settles the event on the recipient's machine; the hub keeps the
 * latest per key. One exception: an event owed to a closed terminal session is reported `recorded` without being
 * settled, and when Resume brings the session back and it is delivered, a `delivered` follows for the same key.
 * `uncertain`: a push whose frame was taken but never answered, settled and drawn as possibly delivered.
 */
export type Delivery = {
  event: { writer: string; seq: number };
  session: string;
  outcome: 'delivered' | 'recorded' | 'refused-read-only' | 'uncertain' | 'failed';
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
   * Every block of the request, named or not (the desk open-fast spec, 2026-10-20, section 9). A block whose
   * `block-row` the producer (the bridge's endpoint; the fake machine) applied stays here until its step ends or its
   * turn completes, carrying `uuid` (the row it was named by) and `namedAt`, since the engine writes a message's rows
   * only when the message ends and its text has no other copy until then; the plane drops a named block whose row is in
   * the snapshot's history, and sends one `block-row` per named block it keeps right after the snapshot, before anything
   * else of the subscription. A consumer draws a block the snapshot carries, named or not: a named one takes no later
   * chunk and is drawn until its row lands, on a first snapshot and through a reconnect alike. A producer older than
   * this removes a block when it applies its `block-row` and never sends `uuid`. An entry whose `blocks` is empty can
   * remain until its step ends, and is skipped.
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
  /** The row the block's `block-row` named, once the producer applied it: the block is drawn until that row lands. */
  uuid?: string;
  /** When the block was named: the notice's `t`, ms on the machine's clock. */
  namedAt?: number;
  /** The producer kept only the block's last characters as `text` (its catch-up copy is bounded; chunks stay whole). */
  truncated?: true;
};

/**
 * The row that settles a streaming block: sent when the engine writes the row for content block `index` of that step,
 * before the row itself arrives. Two moments: the producer marks the block in its snapshot state with the row's `uuid`
 * when it applies the `block-row` (a producer older than the open-fast spec dropped it, so its later snapshots leave it
 * out); the browser keeps drawing the block's partial text until the `row`
 * whose `uuid` the `block-row` named arrives, which settles the block, and drops it then. Chunks for a settled block are
 * ignored. A row no `block-row` named (a server tool's) settles nothing and is simply drawn.
 * The hub relays it uninterpreted.
 */
export type BlockRow = { uuid: string; turnId: string; agentId: string | null; step: number; index: number };

/**
 * That model request ended — finished, aborted, or cut off by its turn's end — from DX5's `step end` or `turn complete`.
 * Sent after every `block-row` of the step, so a block of it still without one never gets one: the browser drops its
 * partial text, and no partial text outlives its request. The hub relays it uninterpreted.
 */
export type StepEnd = { turnId: string; agentId: string | null; step: number };

export type SessionPresence = {
  /** `status`, `waitingFor`, and `needs` of `~/.claude/sessions/<pid>.json` verbatim; null when no process is live. */
  record: JsonObject | null;
  bridge: boolean;
  /**
   * What the session's bridge can do, from its `GET /status` (the desk control surface spec, 2026-10-22, §4): absent
   * from a daemon older than that spec's M0, and from a session whose mod loaded before its machine's update (a stale
   * session, until `/reload-plugins` or a restart). A sibling of `bridge`, never under it: the hub refuses a non-boolean
   * `bridge`, and passes this field through unread.
   */
  capabilities?: Capabilities;
  /** The bridge's reading of the session's permission mode and when it was read (M3); absent before any reading. */
  mode?: ModeReading;
};

/**
 * A bridge's capabilities (DX5 `GET /status`): the loaded mod's own plugin version, its protocol, the engine's release
 * base, the ops it answers, the read kinds it serves, and the engine base its route table was measured on (behind
 * `engine` when the engine is newer than every table it carries). `controls` (sminos 1.11.0, the machine-side wave's
 * MW1) is each desk control's capability; absent from an older bridge.
 */
export type Capabilities = {
  sminos: string;
  protocol: number;
  engine: string;
  ops: string[];
  reads: string[];
  routes: { measured: string };
  controls?: ControlCapabilities;
};

/** The desk's controls by the names of remote-architecture's lane map (`lane-b-control-map.md`), path-neutral: a path-B
 * daemon fills the same keys from the SDK's control requests, and the web greys a control by its key, never by lane. */
export const CONTROL_KEYS = [
  'read.usage', 'read.config', 'read.settings', 'read.mcp',
  'btw', 'compact', 'model',
  'mcp.enable', 'mcp.disable', 'mcp.reconnect',
  'decide', 'decide.scope', 'decide.interrupt',
  'decide.addDirectory', 'stop-agent', 'tell',
  'media', 'forget', 'rewind-files', 'elicitation.answer',
] as const;
export type ControlKey = (typeof CONTROL_KEYS)[number];

/** Whether this session's bridge can do a control, and why not (said to the person). */
export type ControlCapability = { available: boolean; reason?: string };

/** Each control's capability. A key that is missing (a control a newer desk names) is unavailable. The bridge sends
 * every key it knows, its unavailable ones with their reasons. */
export type ControlCapabilities = Partial<Record<ControlKey, ControlCapability>>;

/** A permission mode as the bridge last read it, `at` epoch ms on the machine's clock. */
export type ModeReading = { mode: string; at: number };

/**
 * What a machine's daemon can do itself (the machine presence's `desk`): the plugin's version on the machine, the RPC
 * names it executes, the read kinds the plane answers without a bridge. A hub older than the desk control surface's M0
 * rebuilds the machine body without it; the web then names an older plugin without its number.
 */
export type DeskCapabilities = { sminos: string; rpcs: string[]; reads: string[] };

/** Why a read was not answered: no bridge to ask, a kind it does not serve, the machine's wait ran out, too many in
 * flight on the sub, or the call failed. */
export type ReadErrorCode = 'no-bridge' | 'unsupported' | 'timeout' | 'busy' | 'failed';

/** The answer to a browser's DX3 `read`, on the sub that asked: `result` or `error`, never both. */
export type ReadAnswer = { id: string; what: string; result?: JsonValue; error?: { code: ReadErrorCode; message: string } };

/** `read status`'s result: the engine and where the session runs, from the bridge's `$` (the repository's remote
 * stripped of any userinfo). */
export type StatusRead = {
  version: { version: string; base?: string; builtAt?: string };
  model: string | null;
  cwd: string;
  root: string;
  repo: { remote?: string; branch?: string } | null;
  surfaces: string[];
  override: { model: string | null; effort: string | null } | null;
  mode?: ModeReading;
};

/**
 * `read usage`'s result (MW1; args `{breakdown?: 'summary' | 'full'}`, the summary unless `full` is asked, which calls
 * the token-count API): the session's usage, the context window broken down in the SDK's `get_context_usage` shape, and
 * which count it is. Lane A (the bridge) answers the engine's `$.session.usage`, so `startedAt`, `window`,
 * `rateLimits` (empty off a claude.ai subscription) and `cost` are always present there; `rateLimitsAvailable` and
 * `sessionTotals` are a path-B daemon's.
 */
export type UsageRead = {
  startedAt?: number;
  context: { tokens?: number; window?: number; percent?: number; breakdown?: ContextBreakdown };
  rateLimits?: Array<{ kind: string; percentUsed?: number; resetsAt?: string }>;
  cost?: { usd: number };
  breakdownDetail: 'summary' | 'full';
  rateLimitsAvailable?: boolean;
  sessionTotals?: JsonObject;
};

/** The context window by category as `/context` draws it: the SDK's `get_context_usage` reply (categories, grid rows,
 * memory files, MCP tools, agents, skills, …), carried as the engine gives it. */
export type ContextBreakdown = JsonObject;

/** One `/config` row as the engine's `$.config.list()` gives it. A plugin's `text` row has no `value`: a plugin's
 * `userConfig` field may hold a credential. `isLocked` is the engine's policy lock; the desk writes no config. */
export type ConfigRow = {
  key: string;
  label: string;
  description?: string;
  kind: 'boolean' | 'choice' | 'text' | 'number';
  value?: boolean | string | number | string[];
  options?: string[];
  provider: { plugin: string; tier: string };
  isLocked: boolean;
};

/** `read config`'s result (MW1): the rows in the engine's order; `readOnly`, the desk's own policy (F1). */
export type ConfigRead = { rows: ConfigRow[]; readOnly: true };

/** A permission rule as the engine's `PermissionRuleValue` holds it (`Bash(npm test:*)` is `{toolName: 'Bash',
 * ruleContent: 'npm test:*'}`). */
export type PermissionRule = { toolName: string; ruleContent?: string };
export type PermissionRules = { allow: PermissionRule[]; ask: PermissionRule[]; deny: PermissionRule[] };

/**
 * `read settings`'s result (MW1): the permission rules, merged and by source, and each hook's event, matcher and how
 * many commands it runs — never a command's text (*terminal: /hooks*), never `env` or any other key. Lane A projects the
 * settings files, so `permissionsExact` is false there (a session's own allows and the plugins' hooks are not in them);
 * `livePermissions` is a path-B daemon's native view. Source names are extensible; the engine's `flag` is `cliArg`.
 */
export type SettingsRead = {
  permissionsExact: boolean;
  permissions: PermissionRules & {
    additionalDirectories: string[];
    defaultMode: string | null;
    /** `user`, `project`, `local`, `policy`, `cliArg`; lane A sends all five. */
    bySource: Record<string, PermissionRules>;
  };
  hooks: Record<string, Array<{ matcher: string | null; commands: number }>>;
  livePermissions?: JsonObject;
};

/** An MCP server's state; a status this version does not know is drawn as `unknown`. */
export type McpServerStatus = 'connected' | 'disabled' | 'pending' | 'failed' | 'needs-auth' | 'unknown';

/**
 * `read mcp`'s result (MW1): never a server's configuration. Lane A says `exact: false`: the bridge names the servers
 * whose tools the model has (`connected`, with the count, the name spelled as the tools spell it: `my server` is
 * `my_server`), and the plane adds those the project disables (`disabled`, the configured name); a server failed,
 * pending or awaiting sign-in is not seen. A path-B daemon's engine snapshot is `exact: true`, with the other fields.
 */
export type McpRead = {
  exact: boolean;
  servers: Array<{
    name: string;
    status: McpServerStatus;
    tools?: number;
    source?: string;
    scope?: string;
    transport?: string;
    serverInfo?: JsonObject;
    error?: string;
    errorCode?: string;
  }>;
};

/** A command's class in the bridge's route table (the desk control surface spec, §2). */
export type RouteClass = 'run' | 'run-prompt' | 'routed' | 'follow' | 'panel' | 'local' | 'drop';

/** One route of the table (Interfaces, "The route table"): `otherwise` is the route taken when `forms.pattern` misses. */
export type Route = {
  class: RouteClass;
  to?: string;
  reason?: string;
  forms?: { args: 'none' | 'required' | 'optional'; pattern?: string; hint?: string };
  outlives?: string;
  confirm?: true;
  enabled: boolean;
  measured: 'M' | 'I';
  otherwise?: Route;
};

/** A session's command catalog (M1): every command `$.command.list()` lists, with the route each gets, and its models. */
export type Catalog = {
  fingerprint: string;
  /** Engine-listed skill names, fully qualified; absent from bridges before sminos 1.8.1. */
  skills?: string[];
  commands: Array<{ name: string; description: string; source: string; plugin?: string; route: Route; withArgs?: Route }>;
  models: { options: string[]; aliases: Record<string, string | null> };
  measured: string;
};

/** What a command's run reports back about its effect (§6): the settled text, the linked transcript row, the effect the
 * daemon checked, or nothing linkable (*ran, unconfirmed*). */
export type Readback = { how: 'text' | 'row' | 'effect' | 'none'; text?: string; uuid?: string };

/**
 * An async op's outcome, outside any subscription, to every browser of the project (§3): `rpc` the nonce of the DX6 RPC
 * that asked, or null for an op started elsewhere (the CLI). A `command`'s `start` carries `name` and `args`; its `end`
 * adds `settled` (the engine's promise: `{ok: true, text?}` or `{ok: false, error}`) and `readback`. A `btw`'s `end`
 * carries the answer — `text` (at most 64 KiB of UTF-8; `truncated: true` when cut) and `usage: {input, output,
 * cacheRead, cacheWrite}` — or a `reason`: `nothing-to-fork`, `api-error` (with `status` when the API gave one, and
 * `error`, its kind), `empty-reply`, `aborted`, or `failed` (with `error`); `usage` comes with every reason but
 * `nothing-to-fork` and `failed`. The hub relays it without reading it. Lane A's `stop-agent` and `tell` send none:
 * their RPC's answer is the outcome (MW4); the names stay for a lane whose stop or message settles later. A `media`
 * upload's (MW5) is `MediaOpBody`, one per attachment's change.
 */
export type OpBody = { rpc: string | null; op: 'command' | 'btw' | 'stop-agent' | 'tell' | 'media'; phase: 'start' | 'end'; id: string; [field: string]: JsonValue };

/**
 * An upload's attachment as the bridge can observe it (MW5): `read` a Read result of its tool-use id holding its
 * `image` or `document` block; `forwarded` the next main-loop step passed the conversation on (a hook beneath the bridge
 * may still answer that step without a model request, so it does not prove the model received it); `aborted` its claim
 * was cancelled (an Esc, the turn's end, a reload that found no result: never streamed again); `failed` a denied or
 * error result, or a file no longer inside its root, with the result's text as `reason`. `pending` and `claimed` are the
 * bridge's own and appear only in `attachments`.
 */
export type MediaState = 'pending' | 'claimed' | 'read' | 'forwarded' | 'aborted' | 'failed';

/**
 * A `media` op (MW5): one attachment's change, `rpc` and `id` both the upload (the RPC's nonce), `index` the
 * attachment's (not `n`: every line of the bridge's stream carries its own), `attachments` the whole upload as it stands,
 * so the latest message is the whole picture. `phase` is `end` once every attachment has ended (`forwarded`, `aborted`
 * or `failed`); the RPC's `queued` answer is the start, and no `start` precedes the first state. Idempotent by
 * `(upload, index, state)`.
 */
export type MediaOpBody = {
  rpc: string;
  op: 'media';
  phase: 'start' | 'end';
  id: string;
  upload: string;
  index: number;
  state: Exclude<MediaState, 'pending' | 'claimed'>;
  toolUseId?: string;
  reason?: string;
  attachments: Array<{ index: number; state: MediaState; toolUseId?: string; reason?: string }>;
  t?: number;
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
  /** What the daemon itself can do (`DeskCapabilities`); absent from a daemon or a hub older than the desk control
   * surface's M0. */
  desk?: DeskCapabilities;
};

export type SessionBodies = {
  /**
   * n = 0. Rows of the sub's transcript (the main one, or one subagent's), newest first, up to the last flushed row, as
   * many as fit the frame budget. A main-scope sub's `subagents` is the session's tree and its `streaming` every
   * agent's; an agent-scope sub's are that agent's own. `usage` is the bridge's last `usage` on a main-scope sub (null
   * without a bridge or before the first one) and absent on an agent-scope sub.
   */
  snapshot: {
    rows: JsonObject[];
    more: boolean;
    subagents: SubagentMeta[];
    presence: SessionPresence;
    streaming: Streaming[];
    usage?: Usage | null;
    /** The main session's pushed command catalog; absent from pre-M1 producers and agent subs. */
    catalog?: Catalog;
    /** The loop's background jobs, as `subagents` carries them; absent from a producer older than DC8. */
    jobs?: Job[];
    /** The loop's MCP servers by name, as `subagents` carries them; absent from a producer older than DC8. */
    mcp?: McpServer[];
    /**
     * The uuids among `rows` off the transcript's live chain: rows a branch left behind (an Esc's, a `/rewind`'s, a
     * response the engine dropped), which the engine no longer reads. Absent from an older producer, which marks none.
     */
    offChain?: string[];
  };
  /**
   * A transcript row verbatim; `agentId` names the subagent whose transcript it is in. `offChain`: the rows of the
   * sub's transcript its write took off the live chain (those a branch it starts left behind, oldest first, and itself
   * when it was written off the chain), held by the browser or not yet; `onChain`: the rows it put back on. Each present
   * only when not empty, and from a producer that marks. The latest message about a row says.
   */
  row: { row: JsonObject; agentId: string | null; offChain?: string[]; onChain?: string[] };
  /** A `turn.step` chunk object verbatim under `chunk`, nested beside its message's identity and its index in that
   * message from 0 (DX5's chunk event). `t`: when the session's bridge took the chunk (DX5's event stamp, ms since the
   * epoch on the machine's clock), for the web's latency readout; absent from a producer older than MAWS #57. */
  chunk: { turnId: string; agentId: string | null; step: number; chunkIndex: number; chunk: JsonObject; t?: number };
  'block-row': BlockRow;
  'step-end': StepEnd;
  /** Older rows of the sub's transcript, newest first, answering a browser's `rows` request; `offChain` as the snapshot's. */
  rows: { rows: JsonObject[]; before: string; more: boolean; offChain?: string[] };
  /**
   * The subagent tree with each agent's status, the loop's background jobs, and its MCP servers' names: in the snapshot
   * and again whenever any of it changes. A producer older than DC8 sends `subagents` with each agent's id and meta
   * alone, and no `jobs` or `mcp`.
   */
  subagents: { subagents: SubagentMeta[]; jobs?: Job[]; mcp?: McpServer[] };
  /** Unified diff of the session's working tree against its base branch, answering a browser's `diff` (main-scope subs
   * only; computed on request, never pushed). The daemon answers no `base` when the session's directory is no git
   * working tree, and adds `error` when git failed: a field beyond these, carried as received. */
  diff: { base: string; text: string; error?: string };
  /** A background task's output tail, answering a browser's `output` (DX3): read on request, never pushed. */
  output: TaskOutput;
  /** After each main turn, on main-scope subs only: the one source of a session's context use and cost on the web. */
  usage: Usage;
  /** The answer to a browser's `read` (DX3), on the sub that asked, by its `id`: relayed unread. */
  read: ReadAnswer;
  /** The session's command catalog when it changes (M1), on main subs only: relayed unread. */
  catalog: Catalog;
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
  /** An async op's start and end (`OpBody`), keyed by its RPC's nonce, as `compact` is: relayed unread. */
  op: OpBody;
  machine: MachinePresence;
  raised: Raised;
  settled: Settled;
  delivery: Delivery;
};

/**
 * One agent of the tree: its id and its `subagents/*.meta.json` verbatim, and, from a producer of DC8 or later, its
 * status with what that rests on. A producer older than DC8 sends the id and the meta alone, and the web shows such an
 * agent as it did before; one of DC8 or later sends `status` and `evidence` always, the rest where it holds them.
 */
export type SubagentMeta = { agentId: string; meta: JsonObject } & (SubagentStatusFacts | { [K in keyof SubagentStatusFacts]?: never });

/**
 * MAWS's `TaskStatus` words, so the web patches its task graph without a mapping. The machine normalizes every raw word
 * the engine writes through one table (DX4): `completed`; `failed`, `error` → `failed`; `stopped`, `killed`,
 * `cancelled`, `interrupted` → `stopped`; `running`, `pending` → `running`; any other word changes nothing. `exited`
 * is known process death without a terminal word; `unknown` only where no evidence exists.
 */
export type SubagentStatus = 'running' | 'completed' | 'failed' | 'stopped' | 'exited' | 'unknown';

/**
 * What a status rests on: the bridge's account of an agent it holds, a terminal or running word in the rows, the parent
 * agent's end (`exited`), the session's process gone (`exited`), or nothing (`unknown`).
 */
export type StatusEvidence = 'bridge' | 'rows' | 'parent' | 'session' | 'none';

export type SubagentStatusFacts = {
  status: SubagentStatus;
  evidence: StatusEvidence;
  /** The bridge's word, present while the bridge holds the agent: true from its spawn, the seed or a refresh; false
   * from its stop. */
  running?: boolean;
  /** The bridge's spawn record, present when it holds one. */
  spawn?: SubagentSpawn;
  /** The terminal or running word the rows carry: the loop's, or a nested agent's in its parent agent's transcript. */
  outcome?: SubagentOutcome;
  /** The agent transcript's file facts, read only when its size or mtime changed. */
  file?: AgentFile;
};

/**
 * DX5's `agent` spawn, or, for an agent the module did not see spawn, what the `$.agent.list()` seed gives: the parent,
 * the type, and the description, with no `name`, `background`, `model`, or `toolUseId`.
 */
export type SubagentSpawn = {
  /** The agent that spawned it; null for one the main loop spawned. */
  parentAgentId: string | null;
  subagentType: string;
  description: string;
  /** The spawn's name, null when it had none; absent from a seed. */
  name?: string | null;
  background?: boolean;
  model?: string;
  toolUseId?: string | null;
};

export type SubagentOutcome = {
  /** `raw` through the normalization table. */
  status: SubagentStatus;
  /** The engine's own word, before the table. */
  raw: string;
  /** When the row that carries it was written (ISO 8601). */
  at: string;
  summary?: string;
  outputFile?: string;
};

/** An agent transcript's facts on disk; `firstAt` and `lastAt` are its first and last rows' timestamps, null while it
 * holds none. */
export type AgentFile = { size: number; mtimeMs: number; firstAt: string | null; lastAt: string | null };

/** A job's status: running from its start row, so never `unknown`. */
export type JobStatus = Exclude<SubagentStatus, 'unknown'>;

/**
 * A background shell or monitor of the loop, read from its rows: a Bash result with `backgroundTaskId`, a Monitor
 * result's `taskId`, then its notification, `task_status`, or `TaskStop`. It is `exited` once the session's process is
 * gone without a terminal word.
 */
export type Job = {
  taskId: string;
  kind: 'shell' | 'monitor';
  /** The call that started it. */
  toolUseId: string;
  startedAt: string;
  description: string;
  /** A shell's command. */
  command?: string;
  /** The output file as the rows named it; null until a row names one (a monitor's start names none). */
  outputFile: string | null;
  status: JobStatus;
  endedAt?: string;
  summary?: string;
};

/** An MCP server the loop's `mcp_instructions_delta` attachments added and did not remove: its name only. */
export type McpServer = { name: string };

/**
 * A background task's output, answering an `output` request, by `result`. The machine serves only a task its index
 * holds, only at the path the session's rows named for it, and only when that path carries
 * `<session>/tasks/<taskId>.output` and its realpath as opened (symlinks resolved) is a regular file equal to
 * `<realpath of a root>/<taskId>.output` for one of the session's canonical tasks roots, as the machine derives them
 * from its own state (DX4's containment rule).
 */
export type TaskOutput =
  /** `text` is the last `tail` bytes decoded as UTF-8 with replacement, cut forward to the first line break inside the
   * window when the window does not start the file; `from` the byte offset it starts at; `truncated` whether anything
   * precedes it. */
  | { taskId: string; result: 'ok'; path: string; size: number; from: number; text: string; truncated: boolean }
  /** No file is there: the path passed containment and is gone (the engine writes under the temporary directory); or
   * `path` null, a known task no row has named a file for yet, which may be asked again once a `subagents` names one. */
  | { taskId: string; result: 'missing'; path: string | null }
  /** The path the rows named fails containment; `reason` is a sentence for the human. Not to be asked again. */
  | { taskId: string; result: 'refused'; path: string; reason: string }
  /** The machine's index holds no such task: the request may have raced the index's next `subagents`. */
  | { taskId: string; result: 'unknown-task' };

export type SessionKind = keyof SessionBodies;

/** The kinds that belong to a subscription (`sub` and `n` set); the rest are published to every browser of the project. */
export const SUBSCRIPTION_KINDS = ['snapshot', 'row', 'chunk', 'block-row', 'step-end', 'rows', 'subagents', 'diff', 'usage', 'output', 'read', 'catalog', 'end'] as const satisfies readonly SessionKind[];
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
export const SESSION_WIDE_KINDS = ['presence', 'compact', 'op', 'raised', 'settled', 'delivery'] as const satisfies readonly SessionKind[];

/**
 * Every session kind this hub lists, as its `welcome` names them to a machine (DX2 `welcome.kinds`): a daemon sends a
 * kind the desk control surface adds (`read`, `op`, `catalog`) only to a hub whose welcome lists it, since an older hub
 * refuses an unlisted kind `bad-shape`.
 */
export const SESSION_KINDS: readonly SessionKind[] = [...SUBSCRIPTION_KINDS, ...SESSION_WIDE_KINDS, 'machine'];

/**
 * The envelope, discriminated by `kind`. A subscription's kinds carry `session`, `sub`, and `n`: 0 for the snapshot,
 * then n = 1, 2, … (`end` may come first, at n 0: a subscription ended before its snapshot could be taken, with the
 * reason it would carry later); a gap makes the browser subscribe again. `presence`, `compact`, `op`, `raised`,
 * `settled`, and `delivery` carry `session` with `sub` and `n` null; `machine` carries all three null.
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
