# C1 — Foundations

Child of the composite spec `docs/charter.md`, child id **C1**, parent pin `722440a039c252c2c1b5578b75a25f391f33d397` (the charter blob that carries C2's pass-2 findings, D-19, and C1's own residue decisions under §12 C1; the dispatch pin was `32b75d61`, see the Decision Log). Design lives in the charter: the C1 section in §12 with its "Residue decisions (C1, 2026-09-28)" list, contracts X1, X2, X7 in §13, the binding grades in §11. This document carries the constraints, the concrete X1 and X2 definitions the wave-2 children (C3, C4, C5, C6, C9) code against, the milestones with their gates, and the record.

## Purpose

After C1, a developer on the owner's Mac clones the repository, runs `pnpm install` and `pnpm dev`, and a MAWS window opens in the light theme with the three empty regions of the shell (sidebar, main, right panel). Behind that window the process model of the charter is already real: a privileged main process, a sandboxed and context-isolated renderer that can reach main only through a validated command/event bridge, and two utility processes (the engine host that will own Claude Code processes, the PTY host that will own terminals) that main forks, supervises and talks to over message ports. The renderer's diagnostics strip shows both hosts' pids answering pings, and a shell spawned in the PTY host echoes text back. `pnpm verify` runs typecheck, lint, unit tests, the Electron end-to-end smoke and an unsigned local build in one command, and every wave-2 child can import the shared types for the event graph, the session record, the attention item and the IPC schema, with runtime validators that already accept every frame recorded by the protocol probe and reject malformed ones.

What nobody can do yet, and C1 does not attempt: talk to a real engine (C3), read `~/.claude` (C4), render a transcript (C6), or show a terminal (C9). C1 is the floor they stand on.

## Progress

- [ ] M1 — Scaffold, window and tokens
- [ ] M2 — X1 shared types and validators against the probe fixtures
- [ ] M3 — X2 IPC schema, transport and theme switching end to end
- [ ] M4 — Utility processes: engine host and PTY host
- [ ] M5 — End-to-end smoke, packaging, `pnpm verify`, acceptance run

## Terms

- **Main process**: the one privileged Node/Electron process; owns windows and the IPC boundary. Lives in `src/main/`.
- **Renderer**: the Chromium page that shows the UI. Lives in `src/renderer/`. Runs with **sandbox** (no Node, restricted OS access) and **context isolation** (page scripts and the preload script have separate JavaScript worlds).
- **Preload**: the script Electron runs in the renderer before the page, the only place that sees both `ipcRenderer` and the page's `window`. It publishes the bridge `window.maws`. Lives in `src/preload/index.ts`.
- **Utility process**: an Electron-managed Node child process (`utilityProcess.fork`) with a message-port channel to main. MAWS has two: the **engine host** (`src/engine-host/`) and the **PTY host** (`src/pty-host/`).
- **Command** and **event**: the two IPC shapes of X2. A command is renderer → main request/response (`ipcRenderer.invoke`); an event is main → renderer notification (`webContents.send`).
- **Frame**: one JSON object on the engine's stdout or stdin wire. **Journal**: the probe's recording, one row per line `{seq, direction, at, frame}` (X8). Fixtures are journals under `spikes/protocol-probe/fixtures/` (pass 1) and `spikes/protocol-probe/fixtures/pass2/` (pass 2, C2). **Transcript record**: one line of the engine's own on-disk JSONL under `~/.claude/projects/`, a different shape from a frame (it carries `uuid`, `parentUuid`, `isSidechain`); sidecar copies sit under `fixtures/subagent-sidecars/` and `fixtures/pass2/workflow-disk/`.
- **Event graph** (X1): the app's normalised record of a session, keyed separately by the eight identifiers of §13 X1; produced by C3 (live) and C4 (disk), consumed by everyone.
- **Token** (X7): a CSS custom property such as `--bg`, the only way a component may name a colour, font, size or radius.
- **N-API**: Node's ABI-stable native-addon interface; an N-API `.node` binary built once runs under any Node or Electron of the same platform and architecture without rebuilding.
- **asar**: the archive Electron packs the app into; `asarUnpack` keeps named files as real files beside it so native binaries can be loaded and executed.

## Constraints

Binding on every milestone, from the charter:

- §4.1 process model: renderer sandboxed and context-isolated, talks to main only through the validated command/event schema, never receives shell, git or engine handles; engine host and PTY host are utility processes; main owns windows, settings persistence and the IPC boundary. (binding)
- X1: the eight identifiers stay distinct types and are never flattened; the event kinds, session record, attention item, permission mode as requested and effective with the refusal code when they differ, the attention kind `auto_mode_unavailable`, the denial-kind enum, and the safeguard verdict on tool events (`not_evaluated`, `not_flagged`, `flagged`, attributed from `message_delta.safeguard_results` keyed by tool-use id), all as defined in Interfaces below. How the safeguard verdict is shown (cell detail and turn summary, never a per-cell badge) is X3, C6's. (binding)
- §4.3 as revised by C2: the engine's JSONL is append-only across rewind; the current transcript is the parent chain from the latest leaf, with `last-prompt` anchors carrying `rewound: true`. Any transcript-record type C1 ships models that chain; C4 owns the tailer. (binding)
- X6 and §4.1 launch environment (the constructed allowlist and its exclusions `CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, the messaging socket and token, `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`; the D-19 gateway variables; the empty-string `--settings` override for direct launches) are C3's. C1 ships no launch or environment helper of any kind; the engine host in C1 answers `engine.ping` and nothing else, so nothing here can drift from X6. (binding boundary)
- X2: namespaced commands and events under `session.*`, `engine.*`, `fs.*`, `git.*`, `pty.*`, `layout.*`, `attention.*`, `settings.*`; runtime validation on both sides. (binding)
- X7: token names are those in `mockups/tokens.css`; light is the default (D-4, §10 item 10); components use tokens only. Values are advisory. (binding names, advisory values)
- D-1: nothing here touches or wraps the Claude Code binary; C1 ships no engine launch code. (binding)
- D-11: macOS arm64 only; no Windows or Linux paths are built or tested. (binding)
- §4.7 library picks are advisory; the pins in Interfaces and Dependencies follow the charter's §12 C1 residue decisions, which also carry the reasoning and the rejected alternatives for the package manager, Electron and toolchain, module format, directory layout, validation library, state wiring, test runners, utility-process build and start, node-pty, theme switching, window security defaults, packaging and `pnpm verify`. A milestone below points at a residue decision by its italic title rather than restating it. (advisory unless the residue says binding)
- Wire facts verified by the probe (§4.2) are binding for the wire-frame validators: every frame in `spikes/protocol-probe/fixtures/*.jsonl` is a valid frame; unknown frame types and unknown fields are tolerated and retained, never dropped.
- Commit rules from `CLAUDE.md` and the owner's global instructions: no attribution footers in commits.

## Repository map

The layout the charter's §12 C1 residue fixes (*Directory layout*), with the file each milestone creates or touches, so path references below resolve. `shared/` is importable from every target through the alias `@shared/*`; unit tests sit beside their source as `*.test.ts(x)`.

```
src/main/            index.ts (app lifecycle), window.ts, ipc/router.ts, ipc/events.ts,
                     hosts/supervisor.ts, settings/store.ts
src/preload/         index.ts
src/renderer/        index.html, src/main.tsx, src/App.tsx, src/app/Shell.tsx,
                     src/app/Diagnostics.tsx, src/ipc/client.ts, src/ipc/query.ts,
                     src/stores/settings.ts, src/styles/tokens.css, src/styles/app.css
src/engine-host/     index.ts (utility process entry; C3 fills)
src/pty-host/        index.ts (utility process entry; C9 extends)
src/shared/          ipc/{schema,host-protocol,errors,validate}.ts
                     graph/{ids,enums,events,session,attention}.ts
                     wire/{frames,control,journal,transcript}.ts
                     host/runtime.ts
test/support/        fixtures.ts (X8 journal and transcript loader), tokens-guard.ts
e2e/                 smoke.spec.ts, support/launch.ts
```

## Interfaces and Dependencies

Everything below is the code that is itself a decision: names, fields, enums and signatures that C3 to C9 import. Zod schemas carry the same name as their type with a `Schema` suffix (`SessionEventSchema` validates `SessionEvent`) and every type is `z.infer` of its schema, so there is one source of truth per shape.

### X1 — identifiers (`src/shared/graph/ids.ts`)

Runtime strings, branded at the type level with zod's `.brand<>()`. A function that takes a `ToolUseId` does not accept a `TaskId` even though both are strings; that is the whole point of X1's "never flattened".

```ts
export type SessionId    = string & z.$brand<'SessionId'>;    // engine session id (`session_id` on frames)
export type AppSessionId = string & z.$brand<'AppSessionId'>; // MAWS's own id for a session record
export type MessageUuid  = string & z.$brand<'MessageUuid'>;  // `uuid` on stdout frames and stdin user frames
export type ApiMessageId = string & z.$brand<'ApiMessageId'>; // `message.id` (msg_…)
export type ToolUseId    = string & z.$brand<'ToolUseId'>;    // toolu_…
export type TaskId       = string & z.$brand<'TaskId'>;       // `task_id` on task frames
export type AgentId      = string & z.$brand<'AgentId'>;      // sidecar `agentId` (agent-<id>.jsonl)
export type RequestId    = string & z.$brand<'RequestId'>;    // `request_id` on control frames
export type ProjectId    = string & z.$brand<'ProjectId'>;
export type AttentionId  = string & z.$brand<'AttentionId'>;
export type EventId      = string & z.$brand<'EventId'>;      // app-assigned, unique within a session
```

Observed in the fixtures and recorded so nobody "simplifies" it away: for local agents the engine's `task_id` and the sidecar's `agentId` carry the same string (`ad286defbc77bc090` in `subagent.jsonl` and `subagent-sidecars/`). They remain two fields of two types; equality is a fact about this engine version, not a schema.

### X1 — enums (`src/shared/graph/enums.ts`)

```ts
export const PERMISSION_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'bypassPermissions', 'dontAsk'] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];

export const AUTO_MODE_REFUSAL_CODES = [
  'auto_mode_settings', 'auto_mode_circuit_breaker', 'auto_mode_fast_mode',
  'auto_mode_model', 'auto_mode_unavailable',
] as const;
export type AutoModeRefusalCode = (typeof AUTO_MODE_REFUSAL_CODES)[number];

// Values match the wire's `tool_result_meta[].non_execution_kind` where the engine emits one
// (`permission-rule` and `user-rejected` appear in the fixtures); the rest are named the same way.
export const DENIAL_KINDS = [
  'user-rejected', 'permission-rule', 'automode-blocked', 'automode-unavailable',
  'automode-parsing-error', 'interrupted', 'cancelled',
] as const;
export type DenialKind = (typeof DENIAL_KINDS)[number];

export const ATTENTION_KINDS = [
  'permission', 'question', 'plan', 'dialog', 'elicitation', 'error', 'interrupted',
  'held_peer_message', 'auto_mode_unavailable',
] as const;
export type AttentionKind = (typeof ATTENTION_KINDS)[number];

export const ATTENTION_STATES = ['pending', 'delivered', 'confirmed', 'retired'] as const;   // §4.6
export type AttentionState = (typeof ATTENTION_STATES)[number];

// Server-lane auto-mode verdict, from `stream_event` `message_delta.safeguard_results[].status.tool_uses[<tool_use_id>]`
// (`{type: 'evaluated', outcome: 'not_flagged'}` in the pass-2 fixtures). `not_evaluated` when no verdict named the tool use.
export const SAFEGUARD_VERDICTS = ['not_evaluated', 'not_flagged', 'flagged'] as const;
export type SafeguardVerdict = (typeof SAFEGUARD_VERDICTS)[number];

export const TITLE_SOURCES = ['user', 'generated', 'tool', 'none'] as const;
export const SESSION_STATES = ['idle', 'running', 'requires_action'] as const;               // system/session_state_changed
export const COMMAND_LIFECYCLE_STATES = ['queued', 'started', 'completed', 'cancelled', 'discarded', 'refused'] as const;
export const PLAN_OUTCOMES = ['implement', 'clear_and_implement', 'keep_planning'] as const; // §4.2 plan approval
```

### X1 — events (`src/shared/graph/events.ts`)

Every event is `EventBase & EventPayload`, a discriminated union on `kind`. `SessionEventSchema` is `z.discriminatedUnion('kind', [...])` of strict objects: the app's own record has no unknown fields (the raw frame is always reachable through `seq` in the journal, so nothing is lost by being strict here).

```ts
export interface EventBase {
  id: EventId;
  sessionId: SessionId;
  at: string;                         // ISO-8601: the frame's timestamp when it has one, else receive time
  seq: number | null;                 // journal row the event derives from (X8); null for app-synthesised events
  agentId: AgentId | null;            // the child agent this belongs to, when known
  parentToolUseId: ToolUseId | null;  // non-null for child-agent traffic; the parent conversation is never joined
}

export const EVENT_KINDS = [
  // session lifecycle
  'session.started', 'session.init', 'session.state', 'session.commands',
  // turn lifecycle and the engine's command receipts
  'turn.started', 'turn.ended', 'command.lifecycle',
  // assistant output
  'assistant.block.delta', 'assistant.block.complete',
  // user input (replayed, bash-tagged, synthetic)
  'user.message',
  // tools (safeguard verdicts arrive separately and are folded onto the result)
  'tool.use', 'tool.safeguard', 'tool.result', 'tool.progress',
  // hooks: settings and plugin hooks emit lifecycle; host callback hooks are requests to us
  'hook.started', 'hook.finished', 'hook.callback_requested', 'hook.callback_resolved',
  // requests to the human (all arrive as can_use_tool or dedicated control requests)
  'permission.requested', 'permission.resolved',
  'question.requested', 'question.answered',
  'plan.requested', 'plan.resolved',
  'dialog.requested', 'dialog.resolved',
  'elicitation.requested', 'elicitation.resolved',
  // child agents and background work
  'subagent.started', 'subagent.progress', 'subagent.finished', 'subagent.message',
  'task.started', 'task.updated', 'task.notification', 'tasks.snapshot',
  'workflow.progress',
  // the revisable log
  'boundary.compaction', 'boundary.reset', 'boundary.retraction', 'boundary.rewind',
  // accounting
  'usage.sample', 'context.sample',
  // trouble
  'error.raised', 'api.retry', 'notice.posted', 'process.exited',
  // retention of the unknown
  'frame.unknown',
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export type ContentBlock = { type: string } & Record<string, unknown>;   // an API content block, unknown keys kept
export interface TokenUsage { inputTokens: number; outputTokens: number; cacheReadInputTokens: number; cacheCreationInputTokens: number; thinkingTokens: number | null }

export type EventPayload =
  | { kind: 'session.started'; cwd: string; engineVersion: string | null; resumedFrom: SessionId | null; forked: boolean }
  | { kind: 'session.init'; cwd: string; model: string; permissionMode: PermissionMode; tools: string[];
      slashCommands: string[]; agents: string[]; skills: string[]; plugins: { name: string; source: string }[];
      mcpServers: unknown[]; capabilities: string[]; engineVersion: string; outputStyle: string | null }
  | { kind: 'session.state'; state: 'idle' | 'running' | 'requires_action' }
  | { kind: 'session.commands'; commands: { name: string; description: string; argumentHint: string | null; builtin: boolean }[] }   // system/commands_changed
  | { kind: 'turn.started'; userMessageUuid: MessageUuid | null; origin: string | null }
  | { kind: 'turn.ended'; result: string; isError: boolean; terminalReason: string | null; resultText: string | null;
      durationMs: number; numTurns: number; costUsd: number; usage: TokenUsage;
      permissionDenials: { toolName: string; toolUseId: ToolUseId; toolInput: unknown }[];
      errors: string[]; userMessageUuids: MessageUuid[];
      origin: string | null;          // `result.origin.kind`: 'human' for a turn we started, 'task-notification' for an engine-initiated turn (workflow or background completion)
      resultIndex: number | null;
      isEchoReceipt: boolean }        // true for the empty result (num_turns 0, null terminal_reason) that follows a shouldQuery:false frame; not a turn
  | { kind: 'command.lifecycle'; commandUuid: MessageUuid; state: (typeof COMMAND_LIFECYCLE_STATES)[number] }
  | { kind: 'assistant.block.delta'; apiMessageId: ApiMessageId | null; blockIndex: number; blockType: string;
      textDelta: string | null; thinkingDelta: string | null; inputJsonDelta: string | null; userMessageUuid: MessageUuid | null }
  | { kind: 'assistant.block.complete'; messageUuid: MessageUuid; apiMessageId: ApiMessageId; blockIndex: number;
      block: ContentBlock; model: string; supersedes: MessageUuid | null; aborted: boolean; userMessageUuids: MessageUuid[] }
  | { kind: 'user.message'; messageUuid: MessageUuid | null; content: string | ContentBlock[]; isReplay: boolean;
      isSynthetic: boolean; origin: string | null;
      bash: null | { part: 'input'; command: string } | { part: 'output'; stdout: string; stderr: string; exitCode: number } }
  | { kind: 'tool.use'; toolUseId: ToolUseId; toolName: string; input: unknown; apiMessageId: ApiMessageId | null; messageUuid: MessageUuid | null }
  | { kind: 'tool.safeguard'; toolUseId: ToolUseId; verdict: 'not_flagged' | 'flagged'; lane: 'server' }   // one per tool use named in a message_delta.safeguard_results entry
  | { kind: 'tool.result'; toolUseId: ToolUseId; content: string | ContentBlock[]; isError: boolean; structured: unknown;
      spillPath: string | null; denial: DenialKind | null; safeguard: SafeguardVerdict; messageUuid: MessageUuid | null }
  | { kind: 'tool.progress'; toolUseId: ToolUseId; toolName: string; elapsedSeconds: number; taskId: TaskId | null; heartbeat: boolean }
  | { kind: 'hook.started'; hookId: string; hookName: string; hookEvent: string }
  | { kind: 'hook.finished'; hookId: string; hookName: string; hookEvent: string; outcome: 'success' | 'error' | 'cancelled'; exitCode: number | null; stdout: string; stderr: string }
  | { kind: 'hook.callback_requested'; requestId: RequestId; callbackId: string; hookEvent: string; toolUseId: ToolUseId | null; input: unknown }
  | { kind: 'hook.callback_resolved'; requestId: RequestId; callbackId: string; response: unknown }
  | { kind: 'permission.requested'; requestId: RequestId; toolUseId: ToolUseId; toolName: string; displayName: string | null;
      input: unknown; description: string | null; decisionReasonType: string | null; suggestions: unknown[]; blockedPath: string | null }
  | { kind: 'permission.resolved'; requestId: RequestId; toolUseId: ToolUseId; behavior: 'allow' | 'deny'; message: string | null;
      updatedInput: unknown; updatedPermissions: unknown[]; resolvedBy: 'user' | 'rule' | 'auto' | 'abort' | 'exit' }
  | { kind: 'question.requested'; requestId: RequestId; toolUseId: ToolUseId; questions: Question[] }
  | { kind: 'question.answered'; requestId: RequestId; toolUseId: ToolUseId; answers: Record<string, string> }
  | { kind: 'plan.requested'; requestId: RequestId; toolUseId: ToolUseId; plan: string; input: unknown }
  | { kind: 'plan.resolved'; requestId: RequestId; toolUseId: ToolUseId; outcome: (typeof PLAN_OUTCOMES)[number]; feedback: string | null }
  | { kind: 'dialog.requested'; requestId: RequestId; dialogKind: string; payload: unknown; toolUseId: ToolUseId | null }
  | { kind: 'dialog.resolved'; requestId: RequestId; behavior: 'completed' | 'cancelled'; result: unknown }
  | { kind: 'elicitation.requested'; requestId: RequestId; mcpServerName: string; elicitationId: string | null; mode: string; payload: unknown }
  | { kind: 'elicitation.resolved'; requestId: RequestId; action: 'accept' | 'decline' | 'cancel'; content: unknown }
  | { kind: 'subagent.started'; taskId: TaskId; toolUseId: ToolUseId | null; description: string; subagentType: string | null;
      isBackground: boolean; spawnDepth: number; prompt: string | null }
  | { kind: 'subagent.progress'; taskId: TaskId; description: string; usage: { totalTokens: number; toolUses: number; durationMs: number }; lastToolName: string | null; summary: string | null }
  | { kind: 'subagent.finished'; taskId: TaskId; status: 'completed' | 'failed' | 'stopped'; summary: string | null; outputFile: string | null; reason: string | null }
  | { kind: 'subagent.message'; direction: 'to_child' | 'from_child' | 'between'; fromAgentId: AgentId | null; toAgentId: AgentId | null; text: string }
  | { kind: 'task.started'; taskId: TaskId; toolUseId: ToolUseId | null; taskType: string; description: string; isBackground: boolean; workflowName: string | null }
  | { kind: 'task.updated'; taskId: TaskId; patch: { status?: string; description?: string; endTime?: number; error?: string; isBackground?: boolean } }
  | { kind: 'task.notification'; taskId: TaskId; toolUseId: ToolUseId | null; status: 'completed' | 'failed' | 'stopped'; summary: string; outputFile: string | null; reason: string | null }
  | { kind: 'tasks.snapshot'; tasks: { taskId: TaskId; taskType: string; description: string; ambient: boolean }[] }
  | { kind: 'workflow.progress'; taskId: TaskId; workflowName: string | null; progress: unknown }   // shape fixed by C2's findings; kept opaque here
  | { kind: 'boundary.compaction'; trigger: string; preTokens: number; postTokens: number | null; logicalParentUuid: MessageUuid | null; historical: boolean }
  | { kind: 'boundary.reset'; newConversationId: string; trigger: string | null }
  | { kind: 'boundary.retraction'; retractedMessageUuids: MessageUuid[]; reason: string; fallbackModel: string | null }
  | { kind: 'boundary.rewind'; targetMessageUuid: MessageUuid; precedingAssistantUuid: MessageUuid | null; prefillText: string | null }   // app-synthesised from a successful rewind_conversation; the engine emits no reset frame
  | { kind: 'usage.sample'; costUsd: number; usage: TokenUsage; modelUsage: Record<string, unknown>; source: 'result' | 'get_usage' }
  | { kind: 'context.sample'; totalTokens: number; maxTokens: number; percentage: number; autoCompactThreshold: number | null; isAutoCompactEnabled: boolean; model: string }
  | { kind: 'error.raised'; scope: 'turn' | 'task' | 'process' | 'transport' | 'request'; message: string; code: string | null;
      toolUseId: ToolUseId | null; taskId: TaskId | null; requestId: RequestId | null }
  | { kind: 'api.retry'; attempt: number; maxRetries: number; retryDelayMs: number; errorStatus: number | null; error: string }
  | { kind: 'notice.posted'; level: 'info' | 'notice' | 'suggestion' | 'warning'; text: string; key: string | null }
  | { kind: 'process.exited'; code: number | null; signal: string | null; reason: 'quit' | 'stop' | 'archive' | 'crash' | 'unknown'; lostAttentionCount: number }
  | { kind: 'frame.unknown'; frameType: string; subtype: string | null };

export interface Question { question: string; header: string; options: { label: string; description: string | null; preview: string | null }[]; multiSelect: boolean }
export type SessionEvent = EventBase & EventPayload;
```

Derivation rules that are part of the contract (C3 and C4 implement them; C1 only pins them here because the consumers' behaviour depends on them): a `can_use_tool` control request becomes `question.requested` when `tool_name` is `AskUserQuestion`, `plan.requested` when it is `ExitPlanMode`, and `permission.requested` otherwise (the probe verified AskUserQuestion travels on the permission channel, §4.2); a `user` frame whose string content is wrapped in `<bash-input>` or `<bash-stdout>…<bash-exit-code>` tags becomes `user.message` with the `bash` field filled and the tags stripped; `tool_result_meta[].non_execution_kind` maps onto `denial`, and per pass-2 item 7 a `user-rejected` denial inside a turn whose result has an aborted `terminal_reason` is an interruption, not a refusal (consumers render it so; the event keeps the wire's value); each `message_delta.safeguard_results[].status.tool_uses` entry becomes one `tool.safeguard`, and the `tool.result` for that tool use carries the verdict as `safeguard` (`not_evaluated` when none arrived); a `result` with `origin.kind` other than `human` is an engine-initiated turn and never releases a queued message; a `result` with `num_turns: 0` and null `terminal_reason` directly after a `shouldQuery: false` frame is the echo's receipt (`isEchoReceipt: true`); a successful `rewind_conversation` response becomes `boundary.rewind`, after which the consumer's view is the parent chain from `precedingAssistantUuid`; a frame whose `type`, or `system` `subtype`, no schema knows becomes `frame.unknown` and is never dropped.

### X1 — session record and attention item (`src/shared/graph/session.ts`, `attention.ts`)

```ts
export interface SessionRecord {
  appId: AppSessionId;
  engineSessionId: SessionId | null;                // null until the first frame carrying session_id
  projectId: ProjectId | null;
  directory: string;                                 // realpath, from the first JSONL record (§4.3)
  additionalDirectories: string[];
  worktree: { path: string; branch: string | null } | null;
  branch: string | null;
  title: { text: string; source: (typeof TITLE_SOURCES)[number] };
  pinned: boolean;
  archived: boolean;
  holder:
    | { kind: 'self' }
    | { kind: 'terminal'; pid: number }
    | { kind: 'background_job'; pid: number | null; jobId: string | null }
    | { kind: 'none' };
  lastSeen: { messageUuid: MessageUuid | null; at: string | null };
  unread: boolean;
  engineVersion: string | null;
  gateway: { routed: boolean };
  model: { requested: string | null; resolved: string | null };
  effort: string | null;
  permissionMode: { requested: PermissionMode; effective: PermissionMode; refusal: AutoModeRefusalCode | null };
  createdAt: string;
  updatedAt: string;
}

export interface AttentionItem {
  id: AttentionId;
  appSessionId: AppSessionId;
  sessionId: SessionId | null;
  kind: AttentionKind;
  request: { requestId: RequestId | null; toolUseId: ToolUseId | null; taskId: TaskId | null; agentId: AgentId | null };
  summary: string;                                   // the one line a Needs-you row shows
  createdAt: string;
  state: AttentionState;
  stateChangedAt: string;
  expiresAt: string | null;                          // held peer messages expire (§5.7)
}
```

`SessionRecordSchema` refines `permissionMode`: `refusal` must be null when `requested === effective`.

### X1 — transcript records (`src/shared/wire/transcript.ts`)

The engine's on-disk JSONL, which C4 tails and backfills from. Loose objects; the only required field is `type`, because anchor rows have no `uuid`.

```ts
export interface TranscriptRecord { type: string; uuid?: string; parentUuid?: string | null; sessionId?: string; isSidechain?: boolean;
  agentId?: string; timestamp?: string; message?: unknown; [k: string]: unknown }
export interface LastPromptAnchor extends TranscriptRecord { type: 'last-prompt'; lastPrompt: string; rewound?: boolean; leafUuid?: string }
export interface AgentMeta { agentType: string; description: string; toolUseId: string; spawnDepth: number; requestShape?: string; requestNonInteractive?: boolean; model?: string; [k: string]: unknown }   // agent-<id>.meta.json

export function parseTranscriptRecord(line: unknown): TranscriptRecord;
export function currentChain(records: TranscriptRecord[]): TranscriptRecord[];
// The transcript the model sees: start from the latest record that has a uuid, follow `parentUuid` to the root, return in
// root-to-leaf order. Records off that chain (earlier branches left behind by a rewind) are excluded. File order is not the
// transcript; the pass-2 `rewind.jsonl` snapshots show a `last-prompt {rewound: true}` anchor appended and the next turn's
// user record pointing at an older parent.
```

### X1 — wire frames (`src/shared/wire/frames.ts`, `control.ts`, `journal.ts`)

The shapes the engine emits and accepts, as loose objects (unknown keys retained). These are what the round-trip test validates against the fixtures, and what C3's transport parses before normalising.

```ts
export type JournalDirection = 'in' | 'out' | 'meta' | 'stderr';
export interface JournalRow { seq: number; direction: JournalDirection; at: string; frame: unknown }   // X8 row

// Stdout (`in`) frames. Discriminated on `type`; `system` nests a union on `subtype` with a loose catch-all.
export type StdoutFrame =
  | SystemFrame | AssistantFrame | UserFrame | ResultFrame | StreamEventFrame
  | ToolProgressFrame | ToolUseSummaryFrame | RateLimitEventFrame | PromptSuggestionFrame | AuthStatusFrame
  | ConversationResetFrame | CommandLifecycleFrame
  | ControlRequestFrame | ControlResponseFrame | ControlCancelRequestFrame | KeepAliveFrame
  | UnknownFrame;
// Stdin (`out`) frames.
export type StdinFrame = UserInputFrame | BashCommandFrame | ControlRequestFrame | ControlResponseFrame | ControlCancelRequestFrame | KeepAliveFrame;

export interface UnknownFrame { type: string; [k: string]: unknown }                  // accepted, journaled, surfaced as frame.unknown
export interface SystemFrame { type: 'system'; subtype: string; session_id?: string; uuid?: string; [k: string]: unknown }
export interface SystemInitFrame extends SystemFrame { subtype: 'init'; cwd: string; session_id: string; model: string; permissionMode: string;
  tools: string[]; slash_commands: string[]; agents?: string[]; skills?: string[]; plugins?: { name: string; source: string }[];
  mcp_servers: unknown[]; capabilities?: string[]; claude_code_version: string; output_style?: string }
// Typed system subtypes with required fields: init, status, compact_boundary, api_retry, informational, task_started,
// task_updated, task_progress (with optional `workflow_progress: unknown[]`), task_notification, background_tasks_changed,
// session_state_changed, thinking_tokens, commands_changed, hook_started, hook_progress, hook_response,
// model_refusal_fallback, model_refusal_no_fallback, notification, permission_denied, peer_message_hold,
// elicitation_complete. Every other subtype matches the loose SystemFrame. Subtypes present in the fixtures (both passes):
// init, status, thinking_tokens, background_tasks_changed, task_started, task_progress, task_updated, task_notification,
// hook_started, hook_response, commands_changed; the rest are typed from `research/sdk-wire-gap.md` §1.2.
export interface AssistantFrame { type: 'assistant'; message: { id: string; role: 'assistant'; content: ContentBlock[]; model: string; [k: string]: unknown };
  parent_tool_use_id: string | null; session_id: string; uuid: string; [k: string]: unknown }
export interface UserFrame { type: 'user'; message: { role: 'user'; content: string | ContentBlock[]; [k: string]: unknown };
  parent_tool_use_id?: string | null; session_id?: string; uuid?: string; isReplay?: boolean; isSynthetic?: boolean;
  origin?: { kind: string; [k: string]: unknown }; tool_use_result?: unknown;
  tool_result_meta?: { id: string; non_execution_kind?: string; [k: string]: unknown }[]; [k: string]: unknown }
export interface ResultFrame { type: 'result'; subtype: string; session_id: string; is_error: boolean; duration_ms: number; num_turns: number;
  total_cost_usd: number; usage: Record<string, unknown>; permission_denials: unknown[]; [k: string]: unknown }
export interface StreamEventFrame { type: 'stream_event'; event: { type: string; [k: string]: unknown }; session_id: string; parent_tool_use_id: string | null; uuid: string; [k: string]: unknown }
// `event.type === 'message_delta'` may carry `delta.safeguard_results`, typed loosely as
export interface SafeguardResult { type: string; status: { type: string; tool_uses?: Record<string, { type: string; outcome?: string; [k: string]: unknown }>; [k: string]: unknown }; [k: string]: unknown }
export interface CommandLifecycleFrame { type: 'command_lifecycle'; command_uuid: string; state: (typeof COMMAND_LIFECYCLE_STATES)[number]; [k: string]: unknown }
export interface ControlRequestFrame { type: 'control_request'; request_id: string; request: { subtype: string; [k: string]: unknown } }
export interface ControlResponseFrame { type: 'control_response'; response:
  | { subtype: 'success'; request_id: string; response?: unknown; [k: string]: unknown }
  | { subtype: 'error'; request_id: string; error: string; error_code?: string; [k: string]: unknown } }
export interface ControlCancelRequestFrame { type: 'control_cancel_request'; request_id: string }
export interface KeepAliveFrame { type: 'keep_alive' }
export interface UserInputFrame { type: 'user'; uuid?: string; message: { role: 'user'; content: string | ContentBlock[] }; parent_tool_use_id: null;
  origin?: { kind: string }; priority?: 'now' | 'next' | 'later'; shouldQuery?: boolean }
export interface BashCommandFrame { type: 'bash_command'; command: string; cwd?: string; uuid?: string }

// Control payloads typed in C1 (the rest are loose; C3 types each read as it exposes it):
export interface CanUseToolRequest { subtype: 'can_use_tool'; tool_name: string; display_name?: string; input: unknown; description?: string;
  tool_use_id: string; requires_user_interaction?: boolean; decision_reason_type?: string; permission_suggestions?: unknown[]; blocked_path?: string }
export type CanUseToolResponse =
  | { behavior: 'allow'; updatedInput?: unknown; updatedPermissions?: unknown[] }
  | { behavior: 'deny'; message: string; interrupt?: boolean };
export interface HookCallbackRequest { subtype: 'hook_callback'; callback_id: string; tool_use_id?: string;
  input: { hook_event_name: string; session_id?: string; cwd?: string; tool_name?: string; tool_input?: unknown; tool_use_id?: string; permission_mode?: string; [k: string]: unknown } }
export interface ElicitationRequest { subtype: 'elicitation'; mcp_server_name: string; message?: string; mode: string; requested_schema?: unknown; url?: string; [k: string]: unknown }
export type ElicitationResponse = { action: 'accept'; content?: unknown } | { action: 'decline' | 'cancel' };
export interface InterruptResponse { still_queued: string[]; cancelled?: string[] }
export interface SetPermissionModeResponse { mode: string }
export type ControlErrorResponse = { subtype: 'error'; request_id: string; error: string; error_code?: string }   // `error_code` carries the auto-mode refusal codes
export interface RewindConversationResponse { rewound: boolean; targetMessageUuid?: string; prefillText: string | null; precedingAssistantUuid: string | null; error?: string; reason?: string }
export interface InitializeResponse { commands: unknown[]; agents?: unknown[]; models?: unknown[]; account?: unknown; current_permission_mode: string; session_state?: string;
  hooks_applied?: boolean; workspace_trust_recorded?: boolean; [k: string]: unknown }

export function parseStdoutFrame(frame: unknown): StdoutFrame;   // throws ZodError; never transforms
export function parseStdinFrame(frame: unknown): StdinFrame;
export function parseJournalRow(row: unknown): JournalRow;      // `meta` and `stderr` rows keep `frame` opaque
```

Required fields are the ones every fixture frame of that type carries and the consumers depend on; everything else is optional and retained. This is deliberately a lower bound: a new engine release adding a field or a subtype passes; a frame missing `request_id`, `session_id` on a result, or `message.role` fails. The sets above were checked mechanically against all 40 fixture journals (10 pass-1, 30 pass-2) on 2026-09-28 with no violation (Surprises & Discoveries); the executor re-runs that check as the round-trip test.

### X2 — IPC schema (`src/shared/ipc/schema.ts`)

One registry for commands and one for events. A registry entry carries its input and output schemas and its owner, so main routes `engine.*` to the engine host and `pty.*` to the PTY host without a second registry.

```ts
export type Owner = 'main' | 'engine-host' | 'pty-host';
export interface CommandSpec<I extends z.ZodType, O extends z.ZodType> { input: I; output: O; owner: Owner }

export const ThemeSettingSchema = z.enum(['light', 'dark', 'system']);
export const SettingsSchema = z.strictObject({ version: z.literal(1), theme: ThemeSettingSchema });
export const SettingsPatchSchema = SettingsSchema.omit({ version: true }).partial();
export const SettingsStateSchema = z.strictObject({ settings: SettingsSchema, resolvedTheme: z.enum(['light', 'dark']) });
export const HostPingSchema = z.strictObject({ pid: z.number().int(), uptimeMs: z.number(), hostVersion: z.string() });
export const HostStateSchema = z.strictObject({ state: z.enum(['starting', 'ready', 'crashed', 'restarting']), pid: z.number().int().nullable(), restarts: z.number().int() });
export const PtyIdSchema = z.string().brand<'PtyId'>();

export const commands = {
  'settings.get':  { input: z.void(), output: SettingsStateSchema, owner: 'main' },
  'settings.set':  { input: SettingsPatchSchema, output: SettingsStateSchema, owner: 'main' },
  'engine.ping':   { input: z.void(), output: HostPingSchema, owner: 'engine-host' },
  'pty.ping':      { input: z.void(), output: HostPingSchema, owner: 'pty-host' },
  'pty.spawn':     { input: z.strictObject({ shell: z.string().optional(), args: z.array(z.string()).optional(), cwd: z.string(),
                     cols: z.number().int().positive(), rows: z.number().int().positive(), env: z.record(z.string(), z.string()).optional() }),
                     output: z.strictObject({ ptyId: PtyIdSchema, pid: z.number().int() }), owner: 'pty-host' },
  'pty.write':     { input: z.strictObject({ ptyId: PtyIdSchema, data: z.string() }), output: z.void(), owner: 'pty-host' },
  'pty.resize':    { input: z.strictObject({ ptyId: PtyIdSchema, cols: z.number().int().positive(), rows: z.number().int().positive() }), output: z.void(), owner: 'pty-host' },
  'pty.kill':      { input: z.strictObject({ ptyId: PtyIdSchema, signal: z.string().optional() }), output: z.void(), owner: 'pty-host' },
} as const satisfies Record<`${Namespace}.${string}`, CommandSpec<z.ZodType, z.ZodType>>;

export const events = {
  'settings.changed': SettingsStateSchema,
  'engine.hostState': HostStateSchema,
  'pty.hostState':    HostStateSchema,
  'pty.data':         z.strictObject({ ptyId: PtyIdSchema, data: z.string() }),
  'pty.exit':         z.strictObject({ ptyId: PtyIdSchema, exitCode: z.number().int().nullable(), signal: z.number().int().nullable() }),
} as const satisfies Record<`${Namespace}.${string}`, z.ZodType>;

export const NAMESPACES = ['session', 'engine', 'fs', 'git', 'pty', 'layout', 'attention', 'settings'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export type CommandName = keyof typeof commands;
export type EventName = keyof typeof events;
export type CommandInput<N extends CommandName>  = z.input<(typeof commands)[N]['input']>;
export type CommandOutput<N extends CommandName> = z.output<(typeof commands)[N]['output']>;
export type EventPayload<N extends EventName>    = z.output<(typeof events)[N]>;

export interface IpcError { code: 'invalid_input' | 'invalid_output' | 'unknown_command' | 'forbidden_sender' | 'host_unavailable' | 'timeout' | 'internal'; message: string; issues?: unknown }
export type CommandResult<N extends CommandName> = { ok: true; value: CommandOutput<N> } | { ok: false; error: IpcError };

// The whole surface the preload exposes as `window.maws`; nothing else is bridged.
export interface MawsBridge {
  invoke<N extends CommandName>(name: N, input: CommandInput<N>): Promise<CommandResult<N>>;
  on<N extends EventName>(name: N, listener: (payload: EventPayload<N>) => void): () => void;   // returns unsubscribe
}
export const commandChannel = (name: CommandName) => `maws:cmd:${name}`;
export const eventChannel   = (name: EventName)   => `maws:evt:${name}`;
```

Validation on both sides, concretely: main validates every command input on receipt and every event payload before sending; the renderer client (`src/renderer/src/ipc/client.ts`) validates every command output and every event payload on receipt and drops an invalid event with a `console.error` naming the event and the issues, so a bad payload never reaches a listener; the preload refuses names not in the registries. Timeouts: a command owned by a host fails with `timeout` after 10 s. Children extend the registries by adding entries in their own namespaces; C9 owns the `pty.*` entries from here on and may change `pty.data` to binary with backpressure, provided the smoke's echo still passes.

### Host protocol (`src/shared/ipc/host-protocol.ts`, `src/shared/host/runtime.ts`)

The main ↔ utility-process wire, validated at both ends with the same schemas.

```ts
export type HostMessage =
  | { t: 'hello' }                                                        // main → host, carries the MessagePort in `ports`
  | { t: 'req'; id: string; name: CommandName; input: unknown }           // main → host
  | { t: 'res'; id: string; ok: true; value: unknown }                    // host → main
  | { t: 'res'; id: string; ok: false; error: IpcError }
  | { t: 'evt'; name: EventName; payload: unknown };                      // host → main, re-emitted to the renderer after validation

// Host side, used by both entries:
export function runHost(hostVersion: string, register: (on: <N extends CommandName>(name: N, handler: (input: CommandInput<N>) => Promise<CommandOutput<N>>) => void,
                                                        emit: <N extends EventName>(name: N, payload: EventPayload<N>) => void) => void): void;
```

`src/engine-host/index.ts` in C1 registers only `engine.ping`; C3 replaces its body. `src/pty-host/index.ts` registers `pty.ping`, `pty.spawn`, `pty.write`, `pty.resize`, `pty.kill` over node-pty and emits `pty.data` and `pty.exit`.

### X7 — theme tokens (`src/renderer/src/styles/tokens.css`, `app.css`)

Binding names, taken verbatim from `mockups/tokens.css`: `--bg`, `--bg-raised`, `--bg-overlay`, `--bg-hover`, `--bg-active`, `--border`, `--border-strong`, `--fg`, `--fg-muted`, `--fg-faint`, `--accent`, `--accent-soft`, `--success`, `--warning`, `--danger`, `--info`, `--diff-add-bg`, `--diff-del-bg`, `--font-ui`, `--font-prose`, `--font-mono`, `--text-ui`, `--text-ui-sm`, `--text-prose`, `--lh-prose`, `--measure`, `--text-code`, `--radius-sm`, `--radius`, `--radius-lg`, `--space`, `--row-h`, `--toolbar-h`, `--sidebar-w`, `--panel-w`. The semantic words in charter §6 (surface, foreground, diff-added…) describe the roles these names carry; the names themselves are the contract.

Values: `:root, [data-theme="light"]` takes the colour values of `mockups/tokens-light.css` and the structural values (fonts, sizes, radii, widths) of `mockups/tokens.css`; `[data-theme="dark"]` takes the colour values of `mockups/tokens.css`. Advisory; §7.5 (fonts and final tokens) may change them without touching a component. The `@theme inline` map in `app.css` (charter §12 C1 residue, *Theme switching*; the exact block is in M1) exposes each token as the utility of the same name (`bg-bg-raised`, `text-fg-muted`, `border-border-strong`, `text-accent`, `font-mono`, `text-ui`, `text-prose`, `rounded-sm`, `rounded-md` for `--radius`, `rounded-lg`); components may use those utilities or `var(--token)` in a style, nothing else.

### Fixture loader (`test/support/fixtures.ts`)

```ts
export const FIXTURE_DIR: string;                                   // <repo>/spikes/protocol-probe/fixtures
export type FixturePass = 'pass1' | 'pass2';                        // pass1 = top-level *.jsonl, pass2 = pass2/*.jsonl
export function listJournals(pass: FixturePass): string[];          // e.g. ['init', 'permission-roundtrip', …] or ['auto-classifier', …]
export function loadJournal(pass: FixturePass, name: string): JournalRow[];   // parsed and validated with parseJournalRow
export function framesOf(rows: JournalRow[], direction: 'in' | 'out'): { seq: number; frame: unknown }[];
export function listTranscripts(): string[];                        // subagent-sidecars/agent-*.jsonl and pass2/workflow-disk/journal.jsonl
export function loadTranscript(relPath: string): TranscriptRecord[];
```

C3's and C4's conformance tests import this rather than re-reading files. Both passes are first-class; a test that names one pass only is a test of that pass.

### Dependencies

Pins follow the charter's §12 C1 residue (*Electron*, *Toolchain around it*, *Validation library*, *State wiring*, *Test runners*, *node-pty native module*, *Packaging skeleton*); the reasoning and the rejected alternatives are there.

| Package | Pin | Note |
|---|---|---|
| electron | 44.4.5 exact | Chromium 152, Node 24.18; macOS 13+ |
| electron-vite / vite / @vitejs/plugin-react | ^5.0.0 / ^7.3.6 / ^5.2.0 | plugin-react 6 needs Vite 8, which electron-vite 5 does not accept |
| react, react-dom, babel-plugin-react-compiler | ^19.3.0, ^19.3.0, ^1.0.0 | §4.1; compiler through plugin-react's `babel.plugins`, enabled globally |
| tailwindcss, @tailwindcss/vite | ^4.3.3 | §4.1 |
| zod | ^4.6.5 | `import * as z from 'zod'` |
| zustand, @tanstack/react-query | ^5.0.15, ^5.104.0 | scaffolding only |
| node-pty | 1.1.0 exact | tarball ships the darwin-arm64 N-API prebuild |
| vitest, happy-dom, @testing-library/react | ^5.0.2, ^20, ^16.3 | two vitest projects: node and happy-dom |
| @playwright/test | ^1.63.0 | `_electron` only; no browsers installed |
| electron-builder | 26.15.3 exact | raise to the first 26.16.x containing the pnpm-collector fix for issue #10228 when it ships |
| typescript, typescript-eslint, eslint, eslint-plugin-react-hooks | ^5.9.3, ^8.70, ^10.11, ^7.1 | typescript-eslint caps TypeScript below 6.1 |
| @types/node | ^24 | Electron 44 runs Node 24 |

Not in C1 on purpose: Radix, Streamdown, TanStack Virtual, CodeMirror, Tiptap, better-sqlite3, ghostty-web, electron-updater. Each arrives with the child that uses it.

## Acceptance

C1 closes when all of the following are observed on the owner's Mac, in this order, from a clean checkout (`git clean -fdx` then `pnpm install`):

1. `pnpm dev` opens a window titled "MAWS" within ten seconds showing three regions side by side (sidebar, main, right panel, each labelled by a `data-region` attribute) on the light theme: `<html data-theme="light">`, body background `#faf9f6`.
2. In that window the diagnostics strip in the main region reads `engine host · ready · pid N` and `pty host · ready · pid M` with two distinct pids, both different from the main process pid, and `Activity Monitor` (or `ps -o pid,command -g $(pgrep -f 'MAWS|electron' | head -1)`) shows two Electron helper processes named `maws-engine-host` and `maws-pty-host`.
3. Clicking "Spawn echo test" in the diagnostics strip spawns `/bin/sh` in the PTY host, writes `printf MAWS_ECHO_OK\n`, and the strip shows the returned line containing `MAWS_ECHO_OK` within two seconds.
4. `pnpm test` passes, and its output includes the suites `wire frames round-trip every probe fixture` (one case per journal under `spikes/protocol-probe/fixtures/*.jsonl` and one per journal under `spikes/protocol-probe/fixtures/pass2/*.jsonl`, 40 cases at the time of writing, each asserting every `in` frame parses as a `StdoutFrame`, every `out` frame as a `StdinFrame`, every row as a `JournalRow`, and that each parsed value deep-equals its input), `transcript records chain from the leaf` (the sidecar and workflow-disk JSONL files parse, and `currentChain` over the pass-2 rewind snapshot excludes the abandoned branch), `wire frames reject malformed input`, `graph schemas accept and reject`, `ipc schema validates both directions`, and `renderer uses tokens only`.
5. `pnpm build && pnpm e2e` passes: Playwright launches `out/main/index.js` with `MAWS_E2E=1` and a temporary `userData` directory, asserts items 1 to 3 through the page and `window.maws`, switches the theme to dark through `settings.set` and sees `data-theme="dark"` with body background `#131313`, then quits cleanly with no lingering helper processes.
6. `pnpm build:app` produces `dist/mac-arm64/MAWS.app`; `open dist/mac-arm64/MAWS.app` shows the same window as item 1 with the hosts ready; `pnpm e2e:packaged` runs the same smoke against `dist/mac-arm64/MAWS.app/Contents/MacOS/MAWS` and passes, proving the utility entries and node-pty resolve inside the packaged app.
7. `pnpm verify` runs items 4 to 6 in sequence and exits 0.

## Plan of Work

Constraints for every milestone are in Constraints above; each milestone below says what exists at its end, what it touches, what it exposes and consumes, the decisions that are its alone, its edge, and what it proves.

### M1 — Scaffold, window and tokens

At the end of M1 `pnpm dev` opens the MAWS window: a sandboxed, context-isolated renderer showing three empty regions in the light theme, built by electron-vite with React 19, the React Compiler and Tailwind 4 mapped to the X7 tokens, and `pnpm typecheck`, `pnpm lint`, `pnpm test` run green with the tokens guard as the first test. No IPC beyond what Electron does on its own, no utility processes yet.

Touches: `package.json`, `pnpm-workspace.yaml`, `.npmrc`, `electron.vite.config.ts`, `tsconfig*.json`, `eslint.config.js`, `vitest.config.ts`, `src/main/index.ts`, `src/main/window.ts`, `src/preload/index.ts` (exposes an empty `window.maws` placeholder object so the shape exists), `src/renderer/**`, `test/support/tokens-guard.ts`, `.gitignore` (add `dist/`, `out/`, `test-results/`, `playwright-report/`).

Exposes: the alias `@shared/*`; the `data-region` attributes `sidebar`, `main`, `panel` on the three region elements (C5 builds real regions on them); the token utilities. Consumes: `mockups/tokens.css`, `mockups/tokens-light.css`.

Decisions local to M1 (the choices are the charter's §12 C1 residue *Package manager*, *Electron*, *Toolchain around it*, *Module format*, *Directory layout*, *Theme switching* (tokens and Tailwind part) and *Window security defaults*; what follows is their execution):

- `pnpm-workspace.yaml` carries `nodeLinker: hoisted` and `allowBuilds: { electron: true, node-pty: true, esbuild: true, '@tailwindcss/oxide': true }`; `.npmrc` carries `node-linker=hoisted` and `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; `package.json` has `packageManager: pnpm@11.23.0`, `engines.node: ">=22.12"`, no `"type": "module"`.
- `webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true, preload: join(__dirname, '../preload/index.js') }`; `setWindowOpenHandler` returns `{ action: 'deny' }`; `will-navigate` is prevented; production CSP, set from main through `session.defaultSession.webRequest.onHeadersReceived`, is exactly `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'`, and dev adds the Vite dev-server origin and its `ws:` HMR socket to `connect-src`; `titleBarStyle: 'hiddenInset'`.
- `app.css` opens with `@import "tailwindcss"; @theme { --color-*: initial; --font-*: initial; --text-*: initial; --radius-*: initial; --spacing: 4px; }` followed by `@theme inline { … }` mapping every X7 token: `--color-<name>: var(--<name>)` for the colour tokens, `--font-ui|prose|mono`, `--text-ui|ui-sm|prose|code`, `--radius-sm: var(--radius-sm); --radius-md: var(--radius); --radius-lg: var(--radius-lg)`. `inline` is required because the values reference custom properties that change per `data-theme`.
- `tokens-guard.ts` reads `src/renderer/**/*.{ts,tsx,css}` except `styles/tokens.css` and fails on `#[0-9a-fA-F]{3,8}\b`, `rgb(`, `rgba(`, `hsl(`, `oklch(`, and on `\b(bg|text|border|fill|stroke|ring|outline|from|to|via)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}\b`.
- `Shell.tsx` is a CSS grid with the mockups' widths (`--sidebar-w`, `--panel-w`) and no resizers (C5). The preload exposes `{ invoke, on }` that reject with `unknown_command` until M3 fills them, so the renderer is typed against `MawsBridge` from the start. `vitest.config.ts` defines both projects even though only the node one has a test yet.

Does not touch: any IPC command or event, settings persistence, utility processes, node-pty, packaging, Playwright.

Proves: acceptance item 1 (the light theme and the regions; the diagnostics strip arrives in M4) and the `renderer uses tokens only` suite of item 4. Pin in tests: the guard rejects a fixture string containing `#fff`, `rgb(1,2,3)` and `bg-red-500`, and accepts `bg-bg`, `var(--fg)`.

### M2 — X1 shared types and validators against the probe fixtures

At the end of M2 the event graph, session record, attention item, transcript-record and wire-frame schemas of Interfaces exist in `src/shared/graph/` and `src/shared/wire/`, with the fixture loader, and `pnpm test` shows every frame in every probe fixture of both passes round-tripping through the wire validators while a table of malformed frames is rejected. Nothing runs in Electron; this milestone is pure TypeScript and is what C3, C4, C5 and C6 read first.

Touches: `src/shared/graph/{ids,enums,events,session,attention}.ts`, `src/shared/wire/{frames,control,journal,transcript}.ts` and their tests, `test/support/fixtures.ts`.

Exposes: everything under X1 in Interfaces, `parseStdoutFrame`, `parseStdinFrame`, `parseJournalRow`, `parseTranscriptRecord`, `currentChain`, the fixture loader. Consumes: nothing from M1 except the toolchain.

Decisions local to M2: the required-field sets of each wire frame are exactly those every fixture frame of that type carries across both passes (the executor derives them from the fixtures and the §1.2 catalogue in `research/sdk-wire-gap.md`, not from memory; the sets written in Interfaces already hold); `SystemFrame` is a discriminated union on `subtype` whose last member is the loose catch-all, so an unknown subtype still parses as a `system` frame; `meta` and `stderr` rows from the probe (`spawn`, `provenance`, `exit`, `response_shape`, `jsonl_snapshot`, `{text}`, …) are opaque `unknown` in `JournalRow.frame`; `ContentBlockSchema` is `z.looseObject({ type: z.string() })`; `safeguard_results` stays loose beyond `status.tool_uses[id].outcome`. Event schemas are `z.strictObject`; the union is `z.discriminatedUnion('kind', …)`. Branded ids use `.brand<>()` on `z.string().min(1)`. `currentChain` is implemented over `uuid`/`parentUuid` only and ignores `last-prompt` rows except to expose them for C4's anchor handling.

Does not touch: normalisation from frames to events (C3), any reading of `~/.claude` (C4), IPC.

Proves: acceptance item 4's first four suites. Pins beyond acceptance, one line each: `{ type: 'wibble', x: 1 }` parses as `UnknownFrame` (tolerance is a contract); `{ type: 'control_request', request: { subtype: 'can_use_tool' } }` is rejected for the missing `request_id`; `{ type: 'control_response', response: { subtype: 'success' } }` is rejected; `{ type: 'user', message: { role: 'assistant', content: 'x' } }` is rejected; `{ type: 'stream_event', event: {} }` is rejected; `{ type: 'command_lifecycle', command_uuid: 'x', state: 'exploded' }` is rejected; a `tool.result` event with `denial: 'because'` is rejected while each of the seven `DENIAL_KINDS` passes, and one with `safeguard: 'approved'` is rejected while the three `SAFEGUARD_VERDICTS` pass; a `SessionRecord` with `permissionMode: { requested: 'auto', effective: 'default', refusal: null }` is rejected by the refinement and passes with `refusal: 'auto_mode_model'`; an `AttentionItem` of kind `auto_mode_unavailable` passes; the `question-roundtrip` fixture's `can_use_tool` request parses as `CanUseToolRequest` with `requires_user_interaction === true` and the matching `out` response parses as `CanUseToolResponse` carrying `updatedInput.answers`; the `queue-and-interrupt` fixture's interrupt response parses as `InterruptResponse` with one cancelled uuid; `pass2/auto-classifier` seq 34's `message_delta` parses and its `safeguard_results[0].status.tool_uses` has one key whose `outcome` is `not_flagged`; `pass2/auto-haiku` seq 7 parses as `ControlErrorResponse` with `error_code === 'auto_mode_model'`; `pass2/hooks` seq 26 parses as `HookCallbackRequest`; `pass2/dialogs` seq 41 parses as `ElicitationRequest` with `mode === 'form'`; `pass2/rewind`'s third `rewind_conversation` response parses as `RewindConversationResponse` with `rewound === true` and a `prefillText`; `pass2/workflow` seq 108's result has `origin.kind === 'task-notification'`; `pass2/bash-context-echoed`'s first result has `num_turns === 0`.

### M3 — X2 IPC schema, transport and theme switching end to end

At the end of M3 the renderer talks to main only through `window.maws`, whose two methods are typed by the X2 registries and validated on both sides, and the first real feature crosses it: the theme. `settings.get` returns the persisted setting and the resolved theme; `settings.set({ theme: 'dark' })` flips `data-theme`, native chrome and the persisted file; restarting `pnpm dev` comes back dark; `system` follows the OS. Host-owned commands exist in the registry but answer `host_unavailable` until M4.

Touches: `src/shared/ipc/{schema,errors,validate}.ts` and tests, `src/preload/index.ts`, `src/main/ipc/{router,events}.ts`, `src/main/settings/store.ts`, `src/renderer/src/ipc/{client,query}.ts`, `src/renderer/src/stores/settings.ts`, `src/renderer/src/app/Diagnostics.tsx` (theme control only at this point), `src/main/window.ts` (`backgroundColor` from the resolved theme, sender check hook).

Exposes: X2 in full, `MawsBridge`, the renderer client and `useCommand`, the settings store, the router's `registerMainHandler(name, handler)` and `emit(name, payload)` for later children. Consumes: M1's preload placeholder (replaced), M2's toolchain conventions (zod naming).

Decisions local to M3 (the choices are the charter's §12 C1 residue *Theme switching* (switching part), *Validation library* and *State wiring*, plus the validation and sender rules under X2 in Interfaces; what follows is their execution). Theme: main sets `nativeTheme.themeSource` to the setting, resolves `system` from `nativeTheme.shouldUseDarkColors`, emits `settings.changed` on start, on `settings.set` and on `nativeTheme`'s `updated` event; the renderer sets `document.documentElement.dataset.theme` from the settings store; `index.html` ships `data-theme="light"`; the window's `backgroundColor` is `#faf9f6` or `#131313` by resolved theme. The router registers one `ipcMain.handle` per command name at startup from the registry, so an unregistered channel simply has no handler (Electron rejects it) and the preload's allowlist is the second gate; it checks `event.senderFrame === win.webContents.mainFrame` and that the frame URL's origin is the app's (`file:` in production, the dev-server origin in dev) before dispatch. Commands owned by a host are routed by the supervisor interface `dispatchToHost(owner, name, input)`, which M3 stubs to return `host_unavailable`. The settings file is `settings.json` in `userData`, read once at start, written with write-to-temp-then-rename; an unreadable or invalid file is replaced by defaults with a logged warning, never a crash. `MAWS_USER_DATA`, when set, overrides `userData` before `app.whenReady` (the smoke relies on it).

Does not touch: utility processes (beyond the stub), node-pty, packaging, any command outside `settings.*` and the registry entries.

Proves: the `ipc schema validates both directions` suite of acceptance item 4 and the theme half of item 5. Pins: `settings.set({ theme: 'sepia' })` returns `{ ok: false, error: { code: 'invalid_input' } }`; `window.maws.invoke('nope.thing')` rejects at the preload with `unknown_command`; the renderer client drops a `pty.data` event whose `data` is a number and logs the issue; an invoke from a frame whose URL origin is not the app's returns `forbidden_sender` (unit-tested against the router with a fake event).

### M4 — Utility processes: engine host and PTY host

At the end of M4 main forks two utility processes at startup, supervises them and speaks the host protocol to them; `engine.ping` and `pty.ping` return pids; `pty.spawn` starts `/bin/sh` through node-pty inside the PTY host, `pty.write` sends keystrokes and `pty.data` streams output back to the renderer; the diagnostics strip shows both hosts' state and pid and has the "Spawn echo test" control. Killing a host from the terminal (`kill -9 <pid>`) shows `crashed` then `restarting` then `ready` with a new pid.

Touches: `src/shared/ipc/host-protocol.ts`, `src/shared/host/runtime.ts`, `src/main/hosts/supervisor.ts`, `src/engine-host/index.ts`, `src/pty-host/index.ts`, `src/main/ipc/router.ts` (real `dispatchToHost`), `src/renderer/src/app/Diagnostics.tsx`, `electron.vite.config.ts` (nothing if `?modulePath` works; otherwise the explicit rollup-input fallback named in the charter's residue *Utility processes, build and start*), `pnpm-workspace.yaml` (`node-pty` in `allowBuilds`).

Exposes: `runHost`, the supervisor's `HostSupervisor` with `start()`, `stop()`, `dispatch(owner, name, input)`, `onState(owner, cb)`; the `pty.*` implementation C9 extends. Consumes: X2 from M3, the router.

Decisions local to M4 (the choices are the charter's §12 C1 residue *Utility processes, build and start* and *node-pty native module*; what follows is their execution). `supervisor.ts` imports `engineHostPath from '../../engine-host/index?modulePath'` and `ptyHostPath from '../../pty-host/index?modulePath'`, forks each with `utilityProcess.fork(path, [], { serviceName: 'maws-engine-host' | 'maws-pty-host', stdio: 'pipe' })` after the window's `did-finish-load`, forwards the child's stderr to main's log, creates a `MessageChannelMain` per host and posts `{ t: 'hello' }` with `port1` in the transfer list; the host runtime waits for that message on `process.parentPort`. Restart backoff is 0.5 s, 2 s, 5 s; three unexpected exits within sixty seconds leave the host `crashed`. node-pty stays external to the bundle (electron-vite's default for main-side dependencies). Host state is emitted as `engine.hostState` and `pty.hostState` on every transition, and `settings.get`-style snapshot is not needed because the renderer subscribes before `start()` completes (main forks after the window's `did-finish-load`). Ptys are keyed by a random `PtyId`; a `pty.write` to an unknown id fails with `internal` and message `unknown pty`; on host crash every pty is gone and the renderer receives `pty.exit` with `exitCode: null, signal: null` for each id the supervisor knew, so C9 can show "terminal lost". `pty.spawn` defaults `shell` to `process.env.SHELL || '/bin/zsh'`, and the constructed environment is the host's own `process.env` for now (the allowlisted environment of §4.1 is X6, C3's, and C9 aligns terminals to it). A vitest under Node loads node-pty and spawns `/bin/sh -c 'printf ok'`, proving the prebuild loads at all; the Electron-runtime proof is the dev run and the M5 smoke.

Does not touch: the engine binary, any `engine.*` command other than `ping`, terminal rendering, packaging.

Proves: acceptance items 2 and 3 in `pnpm dev`. Pins: host protocol messages are validated on both ends (a `req` with an unknown name is answered `unknown_command`; a `res` for an unknown id is logged and dropped); three crashes in sixty seconds leave the state `crashed` and pending requests fail with `host_unavailable`.

### M5 — End-to-end smoke, packaging, `pnpm verify`, acceptance run

At the end of M5 the whole of C1's acceptance runs unattended: Playwright drives the built app through the diagnostics strip and `window.maws`, electron-builder produces an unsigned `MAWS.app` whose hosts and node-pty work, and `pnpm verify` chains everything. This milestone executes the Acceptance section as written, item by item, and records the run in Progress.

Touches: `playwright.config.ts`, `e2e/smoke.spec.ts`, `e2e/support/launch.ts` (launch helper honouring `MAWS_E2E_EXECUTABLE`), `electron-builder.yml`, `package.json` scripts (`build`, `e2e`, `e2e:packaged`, `build:app`, `verify`, `rebuild:native`), `src/main/index.ts` (`MAWS_E2E` handling: no first-run dialogs, `MAWS_USER_DATA`), `.gitignore`.

Exposes: the smoke as the template for later children's end-to-end tests (launch helper, temp `userData`, `window.maws` access). Consumes: everything.

Decisions local to M5 (the choices are the charter's §12 C1 residue *Test runners* (Playwright part), *Packaging skeleton* and *Run-everything script*; what follows is their execution). `electron-builder.yml`: `appId: dev.maws.app` (placeholder the owner renames), `productName: MAWS`, `directories.output: dist`, `files: ['out/**', 'package.json']`, `asarUnpack: ['node_modules/node-pty/**']`, `npmRebuild: false`, `mac: { target: [{ target: dir, arch: [arm64] }], identity: null, hardenedRuntime: false, category: public.app-category.developer-tools }`; the `build:app` script is `CSC_IDENTITY_AUTO_DISCOVERY=false electron-builder --mac dir`; `verify` is `pnpm typecheck && pnpm lint && pnpm test && pnpm build && pnpm e2e && pnpm build:app && pnpm e2e:packaged`. Playwright config: `testDir: 'e2e'`, `workers: 1`, `retries: 0`, `timeout: 60_000`, `reporter: [['list'], ['html', { open: 'never' }]]`; browsers are not installed (`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` in `.npmrc`). The smoke uses `_electron.launch({ args: ['out/main/index.js'], env })` in dev-build mode and `{ executablePath: process.env.MAWS_E2E_EXECUTABLE, env }` for the packaged run; both pass `MAWS_E2E=1` and a fresh `MAWS_USER_DATA` under `os.tmpdir()`. "CI-style headless" means: no interactive prompt, no reliance on a pre-existing profile, and a clean exit; the window itself is shown because Electron on macOS has no headless mode and Playwright's `firstWindow()` needs it. The run assumes a macOS session with a window server (a logged-in user or a GitHub-hosted macOS runner); Linux `xvfb` is out of scope per D-11. After `electronApp.close()` the test asserts no `maws-engine-host` or `maws-pty-host` process survives (`pgrep -f`), which catches the leaky-IPC hang class Playwright reports on other platforms.

Does not touch: signing, notarization, DMG, updater, CI workflow files, anything in `src/shared`.

Proves: acceptance items 5, 6 and 7, then the full list 1 to 7 executed in order and ticked in Progress with timestamps. Pins: the packaged smoke asserts `pty.spawn` succeeds (node-pty resolved from `app.asar.unpacked`) and `engine.ping` answers (utility entry resolved from the asar).

## Concrete Steps

Working directory for everything: `/Users/new/Developer/GitHub/MAWS`.

Bootstrap (M1):

```
pnpm --version                     # 11.23.0
pnpm install                       # first run must show electron and node-pty install scripts running (allowBuilds); no "Ignored build scripts" warning
pnpm dev                           # electron-vite dev; a window "MAWS" opens; DevTools console has no red errors
pnpm typecheck && pnpm lint && pnpm test
```

Expected tail of `pnpm test` after M1:

```
 ✓ test/support/tokens-guard.test.ts  renderer uses tokens only
 Test Files  1 passed
```

Contracts (M2):

```
pnpm test -- src/shared
```

Expected: one passing case per fixture, named `<pass>/<file>`, under `wire frames round-trip every probe fixture`: pass 1 `init`, `permission-roundtrip`, `question-roundtrip`, `queue-and-interrupt`, `reads`, `resume-fork-cli`, `resume-fork-no-replay`, `resume-fork-replay`, `resume-fork-start`, `subagent`; pass 2 `auto-classifier`, `auto-haiku`, `auto-routed`, `auto-unrouted`, `bash-context-alone`, `bash-context-echoed`, `dialogs`, `grant-askrule-resume`, `grant-askrule-start`, `grant-reapply-resume`, `grant-reapply-start`, `hooks`, `per-task-stop-off`, `per-task-stop-on`, `per-task-stop-workflow-off`, `per-task-stop-workflow-on`, `prewarm`, `real-settings`, `real-settings-idle-1`, `real-settings-idle-2`, `real-settings-idle-3`, `resume-live-bg`, `resume-live-holder`, `resume-live-second`, `rewind`, `routing-flag-override`, `routing-user-settings`, `trust-attested`, `trust-no-attestation`, `workflow` (the list is whatever `listJournals` finds; new C2 fixtures join automatically); plus `transcript records chain from the leaf`, `wire frames reject malformed input` and `graph schemas accept and reject`. A failure prints the pass, the fixture name, the `seq` of the offending row and the zod issues path, which is how a future engine release announces a wire change.

IPC and theme (M3):

```
pnpm dev
# in the window: toggle Dark in the diagnostics strip → chrome and page turn dark immediately
cat "$HOME/Library/Application Support/MAWS/settings.json"     # {"version":1,"theme":"dark"}
# quit, pnpm dev again → opens dark; set Light → back to light
pnpm test -- src/shared/ipc src/main
```

Hosts (M4):

```
pnpm dev
# diagnostics strip: "engine host · ready · pid N", "pty host · ready · pid M"
ps -o pid,command -ax | grep -E 'maws-(engine|pty)-host' | grep -v grep     # two lines
# click "Spawn echo test" → strip shows a line containing MAWS_ECHO_OK
kill -9 <pty pid>                # strip: crashed → restarting → ready with a new pid
pnpm test -- src/pty-host src/shared/host
```

Smoke, packaging, verify (M5):

```
pnpm build && pnpm e2e
```

Expected:

```
Running 1 test using 1 worker
  ✓  e2e/smoke.spec.ts  MAWS opens light, hosts answer, pty echoes, theme switches, exits clean
  1 passed
```

```
pnpm build:app                   # electron-builder --mac dir; ends with "building  target=dir"; dist/mac-arm64/MAWS.app exists
open dist/mac-arm64/MAWS.app     # window as in item 1, hosts ready
MAWS_E2E_EXECUTABLE=dist/mac-arm64/MAWS.app/Contents/MacOS/MAWS pnpm e2e:packaged
pnpm verify                      # exits 0; last lines are the packaged smoke's "1 passed"
```

If `pnpm build:app` fails with a missing nested dependency version (electron-builder #10228 with pnpm 11 hoisted): confirm `.npmrc` has `node-linker=hoisted`, then raise `electron-builder` to the first 26.16.x containing the pnpm-collector fix and record the change in the Decision Log.

If the PTY host logs `Error: dlopen … pty.node` under Electron: run `pnpm rebuild:native` (`electron-rebuild -f -w node-pty`), rerun M4's steps, and record it twice: a dated line under the charter's §12 C1 residue *node-pty native module* (the fallback is now the default) and a Surprises & Discoveries entry here with the dlopen error as evidence.

## Surprises & Discoveries

- Observation: `@vitejs/plugin-react` 6.x peers on Vite 8 only, while electron-vite 5.0.0 peers on Vite 5 to 7; the scaffold therefore uses Vite 7.3.x with plugin-react 5.2.x.
  Evidence: `npm view @vitejs/plugin-react@latest peerDependencies` → `"vite": "^8.0.0"`; `npm view electron-vite@latest peerDependencies` → `"vite": "^5.0.0 || ^6.0.0 || ^7.0.0"` (2026-09-28).
- Observation: npm's `latest` TypeScript is 7.0.2; typescript-eslint 8.70 caps at `<6.1.0`, so C1 pins TypeScript 5.9.3.
  Evidence: `npm view typescript version` → `7.0.2`; `npm view typescript-eslint@latest peerDependencies` → `"typescript": ">=4.8.4 <6.1.0"`.
- Observation: node-pty 1.1.0 ships N-API prebuilds for darwin-arm64 (`pty.node`, `spawn-helper`), so no Electron rebuild is needed.
  Evidence: `npm pack node-pty@1.1.0` listing contains `package/prebuilds/darwin-arm64/pty.node` and `package/prebuilds/darwin-arm64/spawn-helper`; install script `node scripts/prebuild.js || node-gyp rebuild`.
- Observation: for local agents the engine's `task_id` equals the sidecar `agentId`; X1 keeps them as two typed fields regardless.
  Evidence: `subagent.jsonl` seq 172 `task_id: "ad286defbc77bc090"`; sidecar file `agent-ad286defbc77bc090.jsonl`.
- Observation: the wire already names denial kinds the way the coordinator's X1 update does.
  Evidence: `permission-roundtrip.jsonl` `tool_result_meta: [{ non_execution_kind: "permission-rule" }]`; `queue-and-interrupt.jsonl` `non_execution_kind: "user-rejected"`.
- Observation: `!` bash mode replays as two `user` frames with `isReplay: true`, the first wrapping the command in `<bash-input>`, the second `<bash-stdout>…</bash-stdout><bash-stderr>…</bash-stderr><bash-exit-code>0</bash-exit-code>`; X1's `user.message.bash` is shaped to those two forms.
  Evidence: `queue-and-interrupt.jsonl` seq 234 to 237.
- Observation: the required-field sets written for each wire frame type hold across every `in` and `out` frame of all 40 fixture journals (10 pass-1, 30 pass-2; 3,300 frames, 11 `system` subtypes, no frame without a string `type`), so the round-trip suite is expected to pass on first run.
  Evidence: mechanical check on 2026-09-28: `MISSING: none`; counts `in:stream_event 1832, in:system 748, in:command_lifecycle 134, in:assistant 119, in:control_response 117, out:control_request 118, in:user 60, in:result 49, in:system/init 49, in:control_request 11, out:control_response 11, out:user 44, out:bash_command 3`.
- Observation: the server-lane safeguard verdict is nested three levels deep and keyed by tool-use id, and an empty `tool_uses` map arrives on messages with no tool call.
  Evidence: `pass2/auto-classifier.jsonl` seq 34: `[{"type":"dangerous_tool_use","status":{"type":"available","tool_uses":{"toolu_01PGaV2Yy3rJAGQwn445u9iH":{"type":"evaluated","outcome":"not_flagged"}}}}]`; seq 43: `"tool_uses":{}`.
- Observation: an engine-initiated turn is distinguishable by `result.origin.kind`, and the echo receipt after a `shouldQuery: false` frame is a `result` with zero turns.
  Evidence: `pass2/workflow.jsonl` seq 108 `origin: {"kind":"task-notification"}, result_index: 1`; `pass2/bash-context-echoed.jsonl` first result `num_turns: 0, duration_ms: 13, total_cost_usd: 0`, no `terminal_reason`.
- Observation: a rewind appends rather than truncates; the abandoned branch stays in the file.
  Evidence: `pass2/rewind.jsonl` `jsonl_snapshot` rows: 26 lines before, 26 after rewind, 31 after the next turn, with `{"type":"last-prompt","rewound":true,…}` appended and the new user record's `parentUuid` pointing at the pre-rewind leaf.

## Decision Log

- Decision: Verification for C1 is a task review at each milestone boundary under subagent-driven execution, with dependency-frontier reviews after M2 (X1, read by four sibling children before anything in C1 consumes it), after M3 (X2, consumed by M4) and after M5, and one whole-branch independent review through `doperpowers:reviewer-medium` at the end, per the charter's §19 call (reviewer-medium for plan children other than C3 and C4).
  Rationale: X1 and X2 are read by every wave-2 child; a wrong shape found after wave 2 starts costs five rewrites, so the interfaces get their own review before the branch review.
  Date/Author: 2026-09-28, C1 author.
- Decision: This document is authored against parent pin `722440a039c252c2c1b5578b75a25f391f33d397`, three charter revisions after the dispatch pin `32b75d61`. From the first (`a1441542`, D-18 follow-up) it absorbs requested versus effective permission mode with refusal code on the session record, the `auto_mode_unavailable` attention kind, and the denial-kind enum on tool results. From the second (`5ffe01f0`: C2 landed, D-19) it absorbs the safeguard verdict on tool events with its own `tool.safeguard` event, the append-only JSONL with branch anchors (`TranscriptRecord`, `currentChain`, `boundary.rewind`), hook lifecycle and callback events, `session.commands`, the `origin` and echo-receipt fields on `turn.ended`, typed `hook_callback`, `elicitation`, `rewind_conversation` and control-error payloads, and the pass-2 fixtures as first-class inputs to the round-trip acceptance. The third revision is C1's own: the residue decisions this document first carried moved into the charter's §12 C1 as "Residue decisions (C1, 2026-09-28)", X1/X2/X7 gained their canonical source pointers and X1 the kinds listed above, and §19 records it; this document then moved from `docs/doperpowers/execplans/` to `docs/doperpowers/plans/` and was reduced to constraints, interfaces, milestones and record per the living-spec reference for a child of a composite. Nothing in D-19 or the X6 environment rules changes C1, which ships no launch or environment code.
  Rationale: coordinator instructions during authoring. The pin therefore covers the residue the milestones point at; a later charter edit changes the blob but not this document's basis. `CLAUDE.md` and the charter's tracking map both name `docs/doperpowers/plans/`; the tracking map's pin column still reads `32b75d61` and can be brought to this pin when the document is committed.
  Date/Author: 2026-09-28, C1 author.

## Outcomes & Retrospective

Pending — written at finish.
