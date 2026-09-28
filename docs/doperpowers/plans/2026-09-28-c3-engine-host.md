# C3 — Engine host

Child of the composite spec `docs/charter.md`, child id **C3**, parent pin `87f8c7881119ea670901205dae35917d3751459c`. Design lives in the charter: the C3 section in §12, §4.1 (process model and launch line), §4.2 (engine adapter and the probe-verified facts), §4.4 (process policy, interim never-exit rule), §4.6 (permission broker), contracts X1, X6, X8 in §13, the binding grades in §11, and the Decision Log §19 entries on D-19, the two auto-mode lanes, rewind branching and safeguard attribution. Until C1's code lands, the concrete X1 and X2 definitions this document codes against are the Interfaces section of `docs/doperpowers/plans/2026-09-28-c1-foundations.md`. This document carries the constraints, the interfaces C3 adds, the milestones with their gates, the residue decisions to be pasted into the charter's C3 section, and the record.

## Purpose

After C3, MAWS can hold a real conversation with the pinned Claude Code binary without any UI to speak of. From the renderer, `window.maws.invoke('session.launch', { spec })` starts one `claude` process in the engine-host utility process with exactly the launch contract of §4.1 and D-19: the absolute pinned binary, the fixed flag set, a constructed environment routed through ClaudeUsage's relay after a health check, dialog expiry "never", `perTaskStopAffordance`, the two dialog kinds, and trust attestation when a caller supplies it. Text and thinking stream in as X1 events; a tool call that needs the human arrives as a `permission.requested` event and an attention item, is answered with `session.answer`, and its result comes back attributed to the right tool use; AskUserQuestion, plan approval with its three outcomes, MCP elicitation and host hook callbacks take the same road. A second message typed while a turn runs is queued by the app, survives the process dying, and is released only when the human's turn ends, never into an engine-initiated follow-up. Steer, Stop and Resume behave as the composer labels them. Every structured read the terminal's menus use is a typed call. Every frame in and out is journaled in the probe's format, and replaying that journal through the normaliser yields the same event graph the live run produced. When a process dies with approvals outstanding the broker says so once ("session interrupted, 2 approvals lost"); when it is resumed, its session grants are re-applied so nothing asks twice.

What C3 does not do: render anything (C5, C6, C7, C8), read `~/.claude` (C4), create worktrees or show the trust sheet (C10), or decide when an idle process may exit (C12; the interim rule is never).

## Progress

- [ ] M1 — Launch contract (X6), transport and journal
- [ ] M2 — Control channel, typed controls, normaliser and fixture conformance
- [ ] M3 — Permission broker and the human round trips
- [ ] M4 — Queue, steer, interrupt, rewind, `!` and `#`, process table and stores
- [ ] M5 — X2 surface: `session.*`, `engine.*`, `attention.*`, replay launch, e2e
- [ ] M6 — Live acceptance against the pinned binary through the gateway

## Terms

- **Engine**, **engine process**: one `claude` child process, launched by absolute path `/Users/new/.local/share/claude/versions/2.1.283`, speaking newline-delimited JSON on stdin and stdout. One per live session.
- **Frame**: one JSON object on that wire. **Control request** and **control response**: the request/response envelopes (`control_request`, `control_response`, `control_cancel_request`) both sides use for RPC; a request has a `request_id` chosen by its sender. **Inbound request**: a control request the engine sends us (`can_use_tool`, `hook_callback`, `elicitation`, `request_user_dialog`). **Outbound request**: one we send (`initialize`, `interrupt`, `get_status`, …).
- **Turn**: from the `system/init` frame the engine emits when it starts working on a prompt to the `result` frame that closes it. A **human turn** is one our `user` frame started; an **engine-initiated turn** is one the engine starts on its own after a background task or workflow completes (`result.origin.kind` is `task-notification`). An **echo receipt** is the empty `result` (`num_turns: 0`, no `terminal_reason`) that follows a `shouldQuery: false` user frame; it is not a turn.
- **Journal**: the recording of every frame, one row per line `{seq, direction, at, frame}` with `direction` in `in`, `out`, `meta`, `stderr` (X8). **Fixture**: a journal recorded by the protocol probe under `spikes/protocol-probe/fixtures/` (pass 1) and `fixtures/pass2/` (pass 2); C3 adds `fixtures/pass3/`.
- **Normaliser**: the pure function from journal rows to X1 `SessionEvent`s. **Event graph**: the X1 record of a session (`src/shared/graph/`).
- **Broker**: the permission broker of §4.6, the one pending table for every inbound request that needs a human, with the states pending, delivered, confirmed, retired. **Attention item**: the X1 record a pending broker item produces; the Needs-you section reads these.
- **App queue**: the message queue MAWS owns (§4.2 "Queue ownership"): messages typed while a turn runs, persisted, released one at a time. Distinct from the **engine queue**, the engine's in-memory queue of `user` frames it has accepted but not yet folded into a turn.
- **Steer**: a message sent while a turn runs that bypasses the app queue and reaches the engine immediately with `priority: 'now'`, the engine's highest queue priority, so it folds into the running turn at the next opportunity instead of waiting for the turn to end.
- **Grant**: a session-scoped permission rule MAWS issued by answering a permission with `updatedPermissions` whose `destination` is `session`. **Grant snapshot**: the list of those rules kept app-side so they can be re-applied after a resume (§4.4).
- **Process table**: the engine host's in-memory table of live engine processes and what keeps each alive; exposed as `EngineSessionStatus`.
- **Launch spec** (`LaunchSpec`): the input to `session.launch`; the X6 launch contract in code is the function from a launch spec to a binary path, argument list, environment and cwd.
- **Relay**: ClaudeUsage's loopback gateway at `http://127.0.0.1:8641` (D-19). **Routed** and **direct**: an engine process whose inference goes through the relay, or straight to Anthropic with the engine's own login.
- **Lane** (auto mode): the server lane, where the main model's provider judges tool calls and the verdict arrives as `safeguard_results` on `message_delta`; and the local lane, where the engine's own classifier requests (Sonnet 5, charged as usage) decide. `get_status` reports the lane as the "Auto mode server" row.
- **Engine host**: the utility process `src/engine-host/` that C1 forks; **host protocol**: the main ↔ host envelope of `src/shared/ipc/host-protocol.ts`; **X2 command/event**: the renderer ↔ main IPC of `src/shared/ipc/schema.ts`. A command a host owns is routed to it by main; an event a host emits is re-emitted to the renderer after validation.
- **Replay transport**: a test seam in the engine host that stands in for a process and plays a fixture's `in` rows, advancing when the adapter writes the `out` frame the fixture recorded next. It exists so the whole adapter runs under vitest and Playwright with no engine; it is not the product's replay mode (C4 owns that, X8).

## Constraints

Binding on every milestone, from the charter:

- §4.1 launch line and environment: the flag set `-p --input-format stream-json --output-format stream-json --verbose --permission-prompt-tool stdio --include-partial-messages --forward-subagent-text --replay-user-messages --include-hook-events --setting-sources user,project,local`; absolute pinned binary path, never PATH; constructed environment from a one-time login-shell capture with the allowlist and the exclusions named there; `CLAUDE_CODE_FORK_SUBAGENT=true`; the D-19 gateway variables by default after the relay health check, direct as the exception with the empty-string `--settings` env override; `CLAUDE_CODE_SUBAGENT_MODEL` per session; `ANTHROPIC_DEFAULT_*_MODEL` passed through; `initialize` with `perTaskStopAffordance: true`, `supportedDialogKinds` (at least `auto_mode_server_fallback`, `refusal_fallback_prompt`), `workspaceTrust` when supplied, hooks; dialog expiry "never" through flag settings; engine version recorded per session. (binding, X6 owned here)
- §4.2 adapter semantics and every probe-verified fact listed there and in `spikes/protocol-probe/findings-pass2.md`: raw NDJSON, not the SDK's `query()`; one writer on stdin; unknown fields retained and unknown frames journaled; AskUserQuestion on the permission channel; no history replay on `--resume`; `fork_conversation` unsupported, fork is `--fork-session`; `bash_command` plus the non-querying echo and its empty receipt; interrupt semantics; unsolicited `result` frames accepted without releasing a queued message; `rewind_conversation` with `last_seen_user_message_uuid`, no reset frame, JSONL branches; host hooks round-trip without lifecycle frames; `perTaskStopAffordance`; trust attestation; grants lost on resume and restored by `apply_flag_settings`; ask rules outrank allow rules; a print-mode holder is not guarded, a `--bg` holder is. (binding)
- §4.2 "further engine semantics": app-owned queue with Steer priority; plan approval's three outcomes; `!` and `#` semantics; the revisable log; edit-and-resubmit forks (C7's; C3 supplies fork launch). (binding)
- §4.4 process policy shape and the interim rule: a process never exits on its own; only archive, quit or an explicit stop ends one; the table still computes what would keep a process alive (running turn, background tasks or workflows, session grants, connected MCP servers, held peer message) so C12 can act on it; grants are snapshotted from every `updatedPermissions` we sent and re-applied on resume; exit never silently discards background work. (binding shape, binding interim rule)
- §4.6 broker: one pending table; states pending, delivered, confirmed, retired; delivery truth is a flushed stdin write; confirmation is the earliest frame carrying the item's tool-use id; process exit with pending or delivered items raises one Needs-you entry "session interrupted, N approvals lost" from the broker's own table and re-pends nothing on resume; abort from the engine retires an item; a prompt raised by an ask rule offers no "always allow"; an interrupted call is `user-rejected` paired with an aborted terminal reason. (binding)
- X1 as defined in C1's Interfaces: the event kinds, `EventBase` (`seq` is the journal row), the derivation rules listed under "X1 — events", the session record, the attention item, denial kinds, the safeguard verdict. C3 produces these and never widens an identifier type. The one X1 change C3 makes is additive (`SessionRecord.gateway`, Interfaces below) and is flagged to the coordinator. (binding)
- X2 as defined in C1's Interfaces: entries added only in `src/shared/ipc/schema/session.ts`, `engine.ts` and `attention.ts`; owner `engine-host`; validation on both sides; strict objects; the router's 10 s host-command timeout. (binding)
- X8: the journal row is `{seq, direction, at, frame}`; a scenario is a file; new fixtures C3 records go under `spikes/protocol-probe/fixtures/pass3/` and are loaded through `test/support/fixtures.ts`. (binding)
- D-1: the binary is never patched or wrapped; every wire claim in this document is backed by a fixture row or a SPEC citation, and a claim the live run contradicts is recorded in Surprises and the charter, not worked around silently. (binding)
- D-16: sessions do not survive an app restart in P0; the engine host never relaunches a process on its own (Interfaces, exit policy). (binding)
- C1's conventions: zod 4 (`import * as z from 'zod'`), validators never transform, wire shapes loose and app shapes strict, `Schema` suffix, unit tests beside sources, `@shared/*` alias, CommonJS for the host, no `electron` import outside `src/engine-host/index.ts`. (binding by inheritance)
- Cost: every live test runs on the owner's account through the relay; the suite budgets about 25 short Sonnet turns (under three dollars at pass-2 prices), passes `--max-budget-usd` per process, and is skipped, never failed, when the relay is down. (binding for M6)
- Commit rules from `CLAUDE.md` and the owner's global instructions: no attribution footers.

## Repository map

Files C3 creates or touches; everything else in the tree is another child's. Paths are repository-relative; unit tests sit beside their source as `*.test.ts`.

```
src/engine-host/
  index.ts                   utility-process entry (C1's ping body replaced): runHost + registerEngineIpc
  ipc.ts                     X2 handlers for session.*, engine.*, attention.*; event batching (session.eventBatch); session.events snapshot
  launch.ts                  X6 in code: buildLaunch(spec, env) → { bin, args, env, cwd, flagSettings }
  shell-env.ts               one-time login-shell environment capture
  relay-health.ts            GET /api/hello with timeout and 5 s cache
  transport.ts               ProcessTransport: spawn, LineSplitter, FrameWriter, stderr lines, exit
  replay-transport.ts        ReplayTransport over a fixture journal (test seam; enabled by MAWS_ENGINE_REPLAY=1)
  rpc.ts                     ControlClient: request ids, pending table, per-class timeouts, cancellation
  controls.ts                one typed function per control subtype (initialize … claim_session)
  session.ts                 EngineSession: lifecycle, initialize handshake, turn tracking, inbound dispatch, exit
  normalizer.ts              Normalizer: JournalRow → SessionEvent[] (pure, replayable)
  broker.ts                  PermissionBroker: pending table, states, answers → wire, attention items
  queue.ts                   MessageQueue: app-owned queue, steer, release rule, pause
  grants.ts                  grant snapshot and re-application
  rewind.ts                  rewind_conversation + rewind_files orchestration
  bash-mode.ts               `!`: bash_command + non-querying echo + receipt
  memory-append.ts           `#`: get_memory_dialog + append
  process-table.ts           EngineSessionStatus per process, keep-alive reasons, memory sampling
  journal.ts                 JournalWriter/JournalReader: X8 rows, rotation, pruning, redaction
  store/file-session-state-store.ts   file-backed SessionStateStore (queue, grants, last launch spec)
  conformance/*.test.ts      fixture replay suites (both passes, pass 3)
src/shared/engine/
  launch-spec.ts             LaunchSpecSchema (zod) and LaunchSpec
  session-state-store.ts     SessionStateStore port, QueueEntry, GrantSnapshot
  status.ts                  EngineSessionStatusSchema, toSessionRecordPatch
  answers.ts                 RequestAnswerSchema (what session.answer carries)
src/shared/ipc/schema/
  session.ts, engine.ts, attention.ts   X2 entries (C1 left session.ts and attention.ts empty; engine.ts had ping)
src/shared/wire/control.ts   typed request/response payloads for every control subtype C3 uses (extends C1's)
src/shared/graph/session.ts  SessionRecord.gateway gains baseUrl and autoModeServer (additive)
test/support/fixtures.ts     FixturePass gains 'pass3'
test/live/                   engine-host.live.test.ts, support/live.ts (vitest project `live`, MAWS_LIVE=1)
e2e/engine-replay.spec.ts    Playwright: session.launch with a replay spec through window.maws
spikes/protocol-probe/fixtures/pass3/   rewind-files.jsonl, plan-outcomes.jsonl (recorded by M6)
vitest.config.ts, package.json          `live` project; scripts test:live
```

Not touched: `src/main/**` (main routes host commands by owner already; quit coordination is C5's and calls `engine.shutdown`), `src/renderer/**`, `src/pty-host/**`, `src/shared/ipc/{schema,host-protocol,common}.ts`, `src/shared/wire/{frames,journal,transcript}.ts`, `src/shared/graph/{ids,enums,events,attention}.ts`, `docs/charter.md`.

## Interfaces and Dependencies

Code below is the code that is itself a decision: names, shapes, states and signatures that C7, C10, C11 and the milestones import. Zod schemas carry the type's name with a `Schema` suffix; types are `z.infer` of their schema unless marked otherwise.

### X6 — launch spec and the launch function (`src/shared/engine/launch-spec.ts`, `src/engine-host/launch.ts`)

```ts
export const EffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max']);
export const LaunchSpecSchema = z.strictObject({
  appSessionId: AppSessionIdSchema,
  cwd: z.string(),                                   // absolute; the engine canonicalises (realpath) and reports it in system/init.cwd
  additionalDirectories: z.array(z.string()),
  model: z.string().nullable(),                      // --model; null = engine default
  effort: EffortSchema.nullable(),                   // via --settings { effortLevel }; null = settings
  permissionMode: PermissionModeSchema.nullable(),   // --permission-mode; null = settings (auto for the owner, D-18)
  gateway: z.enum(['gateway', 'direct']),            // D-19 default is 'gateway'; the caller decides the fallback
  subagentModel: z.string().nullable(),              // CLAUDE_CODE_SUBAGENT_MODEL; null = the captured shell/settings value
  resume: z.strictObject({ sessionId: SessionIdSchema, fork: z.boolean() }).nullable(),
  sessionId: SessionIdSchema.nullable(),             // --session-id for a new session; the host mints one when null
  trust: z.strictObject({ accepted: z.literal(true), directory: z.string() }).nullable(),  // initialize.workspaceTrust (C10 fills)
  mcpConfig: z.record(z.string(), z.unknown()).nullable(),       // --mcp-config JSON (C10/C11 extension; the live tests' elicitation server)
  extraSettings: z.record(z.string(), z.unknown()).nullable(),   // merged into --settings after the host's own keys (tests: ask rules, enableWorkflows)
  maxBudgetUsd: z.number().positive().nullable(),    // --max-budget-usd (live tests; C11 may expose)
  replay: z.string().nullable(),                     // fixture path for ReplayTransport; refused unless MAWS_ENGINE_REPLAY=1
});
export type LaunchSpec = z.infer<typeof LaunchSpecSchema>;

// src/engine-host/launch.ts
export interface LaunchPlan { bin: string; args: string[]; env: Record<string, string>; cwd: string; flagSettings: Record<string, unknown>; launchId: string; sessionId: SessionId }
export function buildLaunch(spec: LaunchSpec, captured: Record<string, string>, opts: { relayUrl: string; engineVersion: string }): LaunchPlan;
export const ENGINE_BIN = '/Users/new/.local/share/claude/versions/2.1.283';   // pinned; the packaged app later moves this to a setting (C11), never to PATH
export const ENGINE_VERSION = '2.1.283';
export const RELAY_URL = 'http://127.0.0.1:8641';
```

`args`, in this order: the §4.1 flag set verbatim; `--model <m>` when `model` is set; `--permission-mode <mode>` when set; one `--add-dir <d>` per additional directory; `--session-id <uuid>` for a new session (`spec.sessionId` or a fresh UUID v4, so the journal file and the session record know the engine id before the first frame); `--resume <id>` and `--fork-session` when `resume` is set (never together with `--session-id`); `--mcp-config <json>` when set; `--max-budget-usd <n>` when set; last, `--settings <json>` where the JSON is `flagSettings`: `{ dialogExpiry: 'never' }`, plus `{ effortLevel }` when `effort` is set, plus `{ env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' } }` when `gateway === 'direct'` (pass 2 verified that unsetting the variables does not defeat the owner's `settings.json` routing), plus `extraSettings` spread last. `--strict-mcp-config` is never passed: the user's MCP servers must load as in the terminal.

`env` is constructed, never `process.env`. From the captured login shell (`shell-env.ts`: `$SHELL -ilc 'env -0'`, 5 s timeout, once per host start, falling back to the host's own `process.env` with a logged warning): `PATH`, `HOME`, `USER`, `LOGNAME`, `SHELL`, `TMPDIR`, `TZ`, `LANG`, every `LC_*`, `SSH_AUTH_SOCK`, `XDG_*`, `HOMEBREW_*`, `GIT_*` (excluding `GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`), `CLAUDE_*`, `ANTHROPIC_*`, `ENABLE_TOOL_SEARCH`, `MCP_TIMEOUT`, `MCP_CONNECT_TIMEOUT_MS`, `MAX_THINKING_TOKENS`, `DISABLE_*`, `OTEL_*`. Excluded whatever the capture holds: `CLAUDE_CODE_SESSION_ID`, `CLAUDE_CODE_CHILD_SESSION`, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PID`, `CLAUDE_CODE_MESSAGING_SOCKET`, `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_CODE_EXECPATH`, `CLAUDE_EFFORT`, `CLAUDECODE`, `CLAUDE_CODE_SSE_PORT`, `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS`, `CLAUDE_CODE_ENTRYPOINT` (set below), `CMUX_*`, `NODE_OPTIONS`, `ELECTRON_RUN_AS_NODE`, `ELECTRON_*`. Set: `CLAUDE_CODE_ENTRYPOINT=sdk-ts` (the probe's identity; pass-2 fixtures were recorded under it), `CLAUDE_CODE_FORK_SUBAGENT=true`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1` (Residue: file checkpointing), `CLAUDE_CODE_SUBAGENT_MODEL` from `spec.subagentModel` when set, `TERM=dumb`; with `gateway === 'gateway'`: `ANTHROPIC_BASE_URL=http://127.0.0.1:8641`, `ANTHROPIC_AUTH_TOKEN=claudeusage-local-gateway`, `ENABLE_TOOL_SEARCH=true`; with `direct`: those three deleted from the result (the `--settings` override above does the rest). Env values are never journaled; the `spawn` meta row lists key names.

`initialize` request, sent before the first user frame on every launch: `{ supportedDialogKinds: ['auto_mode_server_fallback', 'refusal_fallback_prompt'], perTaskStopAffordance: true, hooks: <host hooks or omitted>, workspaceTrust: spec.trust ?? omitted }`. The response's `current_permission_mode`, `models`, `commands`, `agents`, `account`, `hooks_applied`, `workspace_trust_recorded`, `session_state` feed `EngineSessionStatus`. Host hooks: none in P0 production launches; the mechanism (`HostHookRegistry` in `session.ts`: `register(event, matcher, fn, timeoutSec)` → callback id `maws_<event>_<n>`) is exercised by the conformance and live tests. A `hook_callback` the host does not recognise is answered `{}` (no opinion) after a warning.

### Relay health (`src/engine-host/relay-health.ts`)

```ts
export interface RelayHealth { url: string; ok: boolean; status: number | null; latencyMs: number | null; checkedAt: string; error: string | null }
export function checkRelay(url?: string, timeoutMs?: number): Promise<RelayHealth>;   // GET `${url}/api/hello`; ok iff HTTP 200; default timeout 1500 ms; results cached 5 s
```

`session.launch` with `gateway: 'gateway'` calls it first and answers `relay_unreachable` without spawning when `ok` is false; the caller (C11's launch sheet) then offers ClaudeUsage or re-issues with `gateway: 'direct'`. The check never reaches Anthropic (charter §7.4).

### Transport (`src/engine-host/transport.ts`, `replay-transport.ts`)

```ts
export interface EngineTransport {
  readonly pid: number | null;
  frames: AsyncIterable<{ frame: unknown; raw: string }>;   // parsed stdout lines, in order; malformed lines are reported, not thrown
  stderr: AsyncIterable<string>;                            // one line per item
  write(frame: StdinFrame): Promise<void>;                  // resolves when the bytes reached the OS pipe (write callback), rejects on EPIPE/closed
  endInput(): void;                                         // stdin.end()
  kill(signal: 'SIGTERM' | 'SIGKILL'): void;
  readonly exited: Promise<{ code: number | null; signal: NodeJS.Signals | null }>;
}
export function spawnEngine(plan: LaunchPlan, opts: { maxLineChars: number }): EngineTransport;
export function replayEngine(journal: JournalRow[], opts: { answers?: 'recorded' }): EngineTransport;   // plays `in` rows; a row after an `out` control_request/response waits for the adapter's matching write (by subtype + request_id echo); `stderr` rows replay; `meta exit` ends the stream
```

Framing: stdout is decoded with a `StringDecoder('utf8')` so multibyte characters split across chunks survive; the splitter cuts on `\n`, ignores blank lines, strips a leading U+FEFF, and treats an unterminated line over `maxLineChars` (64 Mi characters) as a transport error that kills the process with `error.raised { scope: 'transport' }` (the engine's own budget is 256 Mi; ours protects the host's memory; spilled tool results live on disk and never approach it). A line that fails `JSON.parse` is journaled as `meta { event: 'parse_error', length, typeGuess }` and surfaced as `error.raised { scope: 'transport' }`; the session continues. Writes are serialised through one promise chain (one writer on stdin, §4.2); `write()` is `JSON.stringify(frame) + '\n'` and awaits the socket's write callback, honouring `drain` when `write` returned false, so a caller that awaits `write()` knows the frame left the process. The engine escapes U+2028/2029 on its output for other consumers; its own reader splits on `\n` only, so we do not escape. `keep_alive` is never sent (the engine drops it on input). Stderr is split the same way and journaled as `stderr` rows.

### Control channel (`src/engine-host/rpc.ts`, `controls.ts`)

```ts
export type RequestClass = 'read' | 'mutate' | 'interrupt' | 'long' | 'human';
export const REQUEST_TIMEOUT_MS: Record<Exclude<RequestClass, 'human'>, number> = { read: 15_000, mutate: 30_000, interrupt: 15_000, long: 120_000 };
export class ControlClient {
  constructor(transport: EngineTransport, journal: JournalWriter, launchId: string);
  request<S extends OutboundSubtype>(subtype: S, payload: OutboundRequest<S>, opts?: { timeoutMs?: number; signal?: AbortSignal }): Promise<OutboundResponse<S>>;
  cancel(requestId: RequestId): void;                       // writes control_cancel_request; the promise rejects with ControlCancelled
  respond(requestId: RequestId, response: unknown): Promise<void>;                // success envelope; resolves when flushed
  respondError(requestId: RequestId, error: string): Promise<void>;
  onInbound(handler: (req: ControlRequestFrame) => void): void;                   // engine → host requests
  onInboundCancel(handler: (requestId: RequestId) => void): void;                 // engine withdrew one of its requests
}
export class ControlError extends Error { constructor(public subtype: string, public requestId: RequestId, message: string, public code: string | null) }
export class ControlTimeout extends ControlError {}
export class ControlCancelled extends ControlError {}
```

Request ids we mint: `${launchId}-${n}` with `n` a per-process counter from 1 and `launchId` eight base32 characters minted at spawn; the engine's own ids are UUIDs, so a journal reader tells the two namespaces apart at a glance and ids never collide across a resume within one session's journals. Classes: `read` for every `get_*`, `list_*`, `mcp_status`, `export_conversation`, `get_status`, `rewind_files` dry run; `mutate` for `set_permission_mode`, `set_model`, `set_max_thinking_tokens`, `apply_flag_settings`, `rename_session`, `stop_task`, `background_tasks`, `cancel_async_message`, `set_cwd`, `rewind_conversation`, `rewind_files`, `mcp_reconnect`, `mcp_toggle`, `end_session`; `interrupt` for `interrupt`; `long` for `initialize`, `claim_session`, `generate_session_title`, `side_question`, `reload_plugins`; `human` (no timeout) for the inbound requests we answer. On timeout the promise rejects with `ControlTimeout`, the pending entry moves to a late table for 60 s so a late response is journaled and logged rather than treated as unexpected, and a `control_cancel_request` is written (harmless for uncancellable subtypes; the engine "simply completes the request"). A timeout never proves the mutation did not apply (SPEC 45.16.4); callers that care re-read (`session.setPermissionMode` re-reads through the next `system/status`). An `error` response rejects with `ControlError` carrying `error_code` when present (the auto-mode refusal codes ride here). Response payloads are parsed with the typed schema of `controls.ts`; a parse failure rejects (the wire changed under us) and the raw response stays in the journal.

`controls.ts` exports one function per subtype with the request and response types from `src/shared/wire/control.ts`. C3 types, beyond C1's: `InitializeRequest`/`InitializeResponse` (full), `InterruptRequest`, `SetPermissionModeRequest`, `SetModelRequest`, `SetMaxThinkingTokensRequest`, `ApplyFlagSettingsRequest`, `RenameSessionRequest`/`Response`, `GenerateSessionTitleRequest`/`Response`, `StopTaskRequest`, `CancelAsyncMessageRequest`/`Response`, `SetCwdRequest`/`SetCwdResponse` (the three-arm union), `RewindConversationRequest`, `RewindFilesRequest`/`RewindFilesResponse` (`canRewind`, `error?`, `filesChanged?`, `insertions?`, `deletions?`, `skippedLinks?`), `ClaimSessionRequest`/`Response`, `EndSessionRequest`, `SideQuestionRequest`/`Response`, `ReloadPluginsResponse`, `McpReconnectRequest`, `McpToggleRequest`, and the reads `GetUsageResponse` (`session`, `subscription_type`, `rate_limits_available`, `rate_limits` nullable, `behaviors`), `GetContextUsageRequest`/`Response` (`categories`, `totalTokens`, `maxTokens`, `percentage`, `autoCompactThreshold?`, `isAutoCompactEnabled`, `model`, rest loose), `GetSettingsResponse` (`effective`, `sources`, `applied?`, `errors?`), `ListPermissionRulesResponse` (`state.rules[] {behavior, source, rule, description, editability}`, `workspaceDirectories`, `originalCwd`, `managedOnly`), `GetHooksListingResponse`, `GetMemoryDialogResponse` (`files[] {kind, path, label, description, exists}`, `folders[]`, `memories?`, `auto_memory`, `auto_dream`), `GetSkillsDialogResponse`, `GetSandboxDialogResponse`, `GetWorkspaceDiffResponse` (`diff.stats`, `perFileStats`, `hunks`, …), `ExportConversationResponse` (`text`, `default_filename`), `GetStatusResponse` (`sections[] { title, rows[] { label?, value } }`), `McpStatusResponse`, `ListModelsResponse` (`models[] {value, resolvedModel, displayName, description, supportsEffort, supportedEffortLevels, supportsAdaptiveThinking, supportsFastMode, supportsAutoMode}`), `GetSessionCostResponse`, `GetBinaryVersionResponse`, `PermissionUpdate` (`addRules | replaceRules | removeRules` with `rules[] {toolName, ruleContent?}`, `behavior`, `destination`; `addDirectories | removeDirectories` with `directories`, `destination`; `setMode` with `mode`, `destination`; destinations `session | localSettings | projectSettings | userSettings | cliArg`, loose). All are `z.looseObject`; required fields are those every fixture instance carries.

### Normaliser (`src/engine-host/normalizer.ts`)

```ts
export class Normalizer {
  constructor(ctx: { appSessionId: AppSessionId; sessionId: SessionId | null });
  push(row: JournalRow): SessionEvent[];           // pure w.r.t. inputs seen so far; keeps only the correlation state below
  synthesize(kind: 'session.started' | 'boundary.rewind' | 'session.reconnect' | 'process.exited' | 'error.raised', payload: object): SessionEvent;   // app-synthesised events carry seq: null
  readonly state: { sessionId: SessionId | null; currentTurn: { origin: 'human' | 'engine'; userMessageUuids: MessageUuid[] } | null; toolUseToAgent: Map<ToolUseId, AgentId>; safeguards: Map<ToolUseId, SafeguardVerdict>; lastUserMessageUuid: MessageUuid | null; pendingHumanUuids: Set<MessageUuid> }
}
```

Frame to event mapping (the C1 derivation rules apply; this table is the rest). "none" means journaled, no event, no consumer in P0.

| Frame | Event(s) |
|---|---|
| `system/init` | `session.init`; when no turn is open, also `turn.started` with `userMessageUuid` from the most recent `command_lifecycle started` of a uuid we sent and `origin: 'human'`, else `origin: 'engine'` |
| `system/status` | `status: compacting|requesting` and `permissionMode` changes update `EngineSessionStatus` (`activity`, `permissionMode.effective`); none |
| `system/session_state_changed` | `session.state` |
| `system/commands_changed` | `session.commands` |
| `system/compact_boundary` | `boundary.compaction` |
| `conversation_reset` | `boundary.reset` |
| `system/model_refusal_fallback`, `model_refusal_no_fallback` | `boundary.retraction` (`retractedMessageUuids`, `fallbackModel`) |
| `system/api_retry` | `api.retry` |
| `system/informational`, `system/notification` | `notice.posted` (`level` from the frame; `notification.priority` maps `high → warning`, else `info`; `key` when present) |
| `system/permission_denied` | `notice.posted { level: 'info', key: 'permission_denied:<tool_use_id>' }`; the tool result carries the denial kind |
| `system/hook_started`, `hook_response` | `hook.started`, `hook.finished`; `hook_progress` none |
| `system/task_started` | `subagent.started` when `task_type === 'local_agent'`, else `task.started`; both record `toolUseId → taskId` |
| `system/task_progress` | `subagent.progress` for local agents, `tool.progress`-free; when `workflow_progress` is present also `workflow.progress { progress: <the array, opaque> }` |
| `system/task_updated`, `task_notification` | `task.updated`; `subagent.finished` or `task.notification` by the recorded task type |
| `system/background_tasks_changed` | `tasks.snapshot`; also the process table's `backgroundTasks` |
| `system/peer_message_hold` | none as X1 event; process table `heldPeerMessages` and an attention item `held_peer_message` (Broker) |
| `system/thinking_tokens`, `tool_use_summary`, `prompt_suggestion`, `rate_limit_event`, `auth_status`, `system/elicitation_complete` (retires the item), `system/local_command_output` | none |
| `stream_event` `content_block_delta` | `assistant.block.delta` (`textDelta` / `thinkingDelta` / `inputJsonDelta`) |
| `stream_event` `message_delta` with `safeguard_results` | one `tool.safeguard` per `status.tool_uses` key; `status.type === 'unavailable'` flips the process table's lane to `local` for this turn |
| `assistant` | one `assistant.block.complete` per content block; additionally `tool.use` for each `tool_use` block |
| `user` with `tool_result` blocks | `tool.result` per block: `denial` from `tool_result_meta[].non_execution_kind`, `safeguard` from the map (default `not_evaluated`), `spillPath` (below) |
| `user` otherwise (`in`) | `user.message` with `isReplay`, `isSynthetic`, `origin.kind`, and `bash` filled from the `<bash-input>` / `<bash-stdout>…<bash-exit-code>` tags; an `in` `user` frame whose `uuid` is a host echo uuid is suppressed (deduplicated against the row below) |
| `user` with `shouldQuery: false` (`out`, the host's `!` echo) | `user.message { origin: 'bash_echo', isSynthetic: true, isReplay: false, bash: null }` with the echo's uuid; the only `out` frame that yields an event |
| `result` | `turn.ended` (`isEchoReceipt` per C1's rule; `origin` from `result.origin.kind`) and `usage.sample { source: 'result' }`; closes the open turn |
| `command_lifecycle` | `command.lifecycle` |
| `tool_progress` | `tool.progress` |
| `control_request` (in) | by subtype: `can_use_tool` → `permission.requested` / `question.requested` (AskUserQuestion) / `plan.requested` (ExitPlanMode, `plan` from `input.plan`); `hook_callback` → `hook.callback_requested`; `elicitation` → `elicitation.requested`; `request_user_dialog` → `dialog.requested` |
| `control_response` (out, ours) | the matching `*.resolved` / `*.answered` / `hook.callback_resolved` with `resolvedBy: 'user'` (broker answers) or `'auto'` (host hooks, unknown dialogs) |
| `control_cancel_request` (in) | `permission.resolved { resolvedBy: 'abort' }` (or the dialog/elicitation equivalent) when the id is pending |
| `control_response` (in, to our requests) | none as events (typed callers consume them); `rewind_conversation` success → `boundary.rewind` (synthesised by `rewind.ts`) |
| `meta { event: 'exit' }` / process exit | `process.exited` (synthesised with `reason`, `lostAttentionCount`) |
| unknown `type` or `system` subtype | `frame.unknown` |

`spillPath` (X1 `tool.result.spillPath: string | null`) is the absolute path the engine reports, never a derived name (§4.3), read from two wire keys: `tool_use_result.persistedOutputPath` when the object carries it (the Bash tool's key, SPEC 16 §16.13: set when stdout was too large for inline, with `persistedOutputSize` beside it), else the path captured from the first `text` block of the result whose text begins `Output too large (<size>). Full output saved to: <path>` (the spill notice every other tool's result opens with, SPEC 12 §12.12; the regex is `^Output too large \([^)]*\)\. Full output saved to: (\S+)`), else `null`. The path is under `<projectDir>/<sessionId>/tool-results/<toolUseId>.txt|json`; the event keeps the wire preview as `content`. Background shell output files travel on `task.notification.outputFile`, not on `spillPath`.

Child attribution: any frame with `parent_tool_use_id` carries it on `EventBase.parentToolUseId` (branded `ParentToolUseId`), and `agentId` from `toolUseToAgent`, filled from the Agent launch result's `tool_use_result.agentId` when present and from `task_started` (`task_id` for `local_agent`) otherwise; a child frame whose parent we have not seen keeps `agentId: null`. Child traffic is never merged into the parent turn: `turn.started`/`turn.ended` come only from frames with `parent_tool_use_id: null`.

### Broker (`src/engine-host/broker.ts`, `src/shared/engine/answers.ts`)

```ts
export const RequestAnswerSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('permission'), decision: z.enum(['allow', 'deny', 'deny_and_stop']), scope: z.enum(['once', 'session', 'local_settings']),
                   updatedInput: z.unknown().optional(), message: z.string().optional() }),
  z.strictObject({ kind: z.literal('question'), answers: z.record(z.string(), z.string()) }),      // keyed by question text; multi-select joined ', '
  z.strictObject({ kind: z.literal('plan'), outcome: z.enum(PLAN_OUTCOMES), feedback: z.string().nullable() }),
  z.strictObject({ kind: z.literal('dialog'), behavior: z.enum(['completed', 'cancelled']), result: z.unknown().optional() }),
  z.strictObject({ kind: z.literal('elicitation'), action: z.enum(['accept', 'decline', 'cancel']), content: z.unknown().optional() }),
]);
export type RequestAnswer = z.infer<typeof RequestAnswerSchema>;

export interface BrokerItem { attention: AttentionItem; request: ControlRequestFrame; kind: 'permission' | 'question' | 'plan' | 'dialog' | 'elicitation'; toolUseId: ToolUseId | null; deliveredAt: string | null; confirmedAt: string | null; retiredReason: 'answered' | 'abort' | 'exit' | 'expired' | null }
export class PermissionBroker {
  constructor(deps: { client: ControlClient; store: SessionStateStore; onAttention: (items: AttentionItem[]) => void; onEvent: (e: SessionEvent) => void });
  accept(req: ControlRequestFrame): void;                    // pending; emits the *.requested event and the attention item
  answer(requestId: RequestId, answer: RequestAnswer): Promise<'delivered' | 'not_pending' | 'write_failed'>;
  observe(frame: StdoutFrame): void;                         // confirmation by tool-use id; abort by control_cancel_request; elicitation_complete
  processExited(): { lost: number };                         // retires every pending/delivered item, raises the one 'interrupted' item
  snapshot(): AttentionItem[];
}
```

States and transitions (§4.6): `pending` on `accept`; `delivered` when `answer` resolved the flushed write; `confirmed` on the first stdout frame carrying the item's `tool_use_id` (a `tool_result`, `tool_progress`, `hook_callback` request, `system/permission_denied`, or `result.permission_denials`); `retired` on answer confirmation, on an inbound `control_cancel_request` for the id (reason `abort`), on process exit (`exit`), or on `elicitation_complete`. Delivered is not an alarm state. On exit with `n > 0` pending or delivered items the broker retires them and raises exactly one attention item of kind `interrupted` with summary `Session interrupted, ${n} ${n === 1 ? 'approval' : 'approvals'} lost` (the string is the contract); the resumed process is trusted to have retired the dangling tool calls, so nothing is re-pended, except that an `initialize` response carrying non-empty `pending_permission_requests` or `pending_user_dialog_requests` re-accepts those (cheap, and correct for a process that outlived us).

Answers on the wire:

- permission `allow`: `{ behavior: 'allow', updatedInput: answer.updatedInput ?? request.input, decisionClassification: scope === 'once' ? 'user_temporary' : 'user_permanent' }` plus `updatedPermissions` for scope `session`: the engine's first `permission_suggestions` `addRules` entry with `destination` rewritten to `session`, or, when there is no suggestion, `[{ type: 'addRules', rules: [{ toolName: request.tool_name, ruleContent: <the Bash command, or omitted for other tools> }], behavior: 'allow', destination: 'session' }]` (the pass-2 grant fixtures' shape); for scope `local_settings`: the suggestion as sent by the engine (`destination: 'localSettings'`). The broker refuses scopes other than `once` when `suppress_always_allow_rule` is set, when `decision_reason_type === 'rule'`, or when `matched_ask_rule` is present, answering `not_pending`? No: it answers as `once` and records `scopeDowngraded: true` on the resolved event's `message`; the card (C7) must not offer those scopes in the first place, so this is a guard, not a path. Every `session`-destination `addRules` we send is appended to the grant snapshot (`grants.ts`).
- permission `deny`: `{ behavior: 'deny', message: answer.message ?? 'Denied by the user in MAWS.', decisionClassification: 'user_reject' }`; `deny_and_stop` adds `interrupt: true` (aborts the whole turn, SPEC 45.19.3).
- question: `{ behavior: 'allow', updatedInput: { ...request.input, answers } }` (fixture `question-roundtrip` seq 138).
- plan `implement`: `{ behavior: 'allow', updatedInput: request.input }`; the engine strips `plan`/`planFilePath` and restores the pre-plan mode itself (SPEC 21 §6.7 step 8). `keep_planning`: `{ behavior: 'deny', message: feedback ?? 'Keep planning.' }`. `clear_and_implement`: `{ behavior: 'deny', message: 'Plan approved; MAWS is clearing context and will restart with the plan.' }`, then, after the turn's `result`, `set_permission_mode` to the mode recorded before plan mode (`EngineSessionStatus.prePlanMode`, captured when `permissionMode.effective` became `plan`), then a `user` frame `/clear` (a `local` command the SPEC 28 table marks non-interactive-capable; M6 verifies the `conversation_reset` frame follows), then a `user` frame `Implement this plan:\n\n${plan}` with `origin: { kind: 'human' }`. The reset renders as `boundary.reset`. If `/clear` turns out not to be accepted headless, the fallback is a fresh launch (no resume) seeded with the plan, and the Decision Log says so.
- dialog: `{ behavior, result }` verbatim; a `request_user_dialog` whose `dialog_kind` we did not declare is never answered `cancelled` (that would claim the human dismissed it): it stays pending with a `notice.posted` warning, because we declared only kinds we render (SPEC 45.22.13).
- elicitation: `{ action, content }` verbatim (`dialogs` fixture seq 43).
- hook callbacks are not broker items: `session.ts` runs the registered host hook and answers; an unknown callback id answers `{}`.

Attention items: `kind` from the item kind; `permission` items whose request carries `decision_reason_type` of `automode` family and `tool_result_meta` `automode-unavailable` are raised as `auto_mode_unavailable` when the turn's result carries that denial (X1 rule); `error` items on `turn.ended` with `isError` or a hard-failure `terminalReason` (SPEC 45.25.4's `qpn` set) and on `task.notification { status: 'failed' }`; `interrupted` on exit as above; `held_peer_message` on `peer_message_hold { state: 'held' }` with `expiresAt` five minutes after `createdAt`, retired on `released`/`dropped`. `summary` is one line: `${toolDisplayName}: ${first 80 chars of the command or description}` for permissions, the first question for questions, `Plan ready for review` for plans, the dialog kind or the MCP server name otherwise.

### Queue, steer, interrupt (`src/engine-host/queue.ts`, `src/shared/engine/session-state-store.ts`)

```ts
export const QueueEntrySchema = z.strictObject({ queueId: z.string(), appSessionId: AppSessionIdSchema, content: z.union([z.string(), z.array(ContentBlockSchema)]),
  createdAt: z.string(), state: z.enum(['queued', 'releasing', 'released']), messageUuid: MessageUuidSchema.nullable() });
export type QueueEntry = z.infer<typeof QueueEntrySchema>;
export interface GrantSnapshot { allow: string[] }            // rule strings as list_permission_rules renders them: 'Bash(touch granted.txt)'
export interface SessionStateStore {
  loadQueue(appSessionId: AppSessionId): Promise<{ entries: QueueEntry[]; paused: boolean }>;
  saveQueue(appSessionId: AppSessionId, queue: { entries: QueueEntry[]; paused: boolean }): Promise<void>;
  loadGrants(appSessionId: AppSessionId): Promise<GrantSnapshot>;
  saveGrants(appSessionId: AppSessionId, grants: GrantSnapshot): Promise<void>;
  loadLaunchSpec(appSessionId: AppSessionId): Promise<LaunchSpec | null>;   // the last spec, so a resume can reuse cwd, model, gateway
  saveLaunchSpec(appSessionId: AppSessionId, spec: LaunchSpec): Promise<void>;
  forget(appSessionId: AppSessionId): Promise<void>;
}
export class MessageQueue {
  constructor(deps: { appSessionId; client: ControlClient; store: SessionStateStore; onChange: (q: { entries: QueueEntry[]; paused: boolean }) => void });
  enqueue(content): Promise<QueueEntry>;
  edit(queueId, content): Promise<QueueEntry>; remove(queueId): Promise<void>;
  setPaused(paused: boolean): Promise<void>;
  onTurnEnded(ev: Extract<SessionEvent, { kind: 'turn.ended' }>): Promise<void>;   // the release rule
  onLifecycle(ev: Extract<SessionEvent, { kind: 'command.lifecycle' }>): void;     // queued → 'released' bookkeeping
}
```

Release rule: when a `turn.ended` arrives with `isEchoReceipt: false` and `origin` `human` (or absent) and the queue is not paused, the head entry is written as a `user` frame (`{ type: 'user', uuid, message: { role: 'user', content }, parent_tool_use_id: null, origin: { kind: 'human' } }`), moves to `releasing`, and becomes `released` when its `command_lifecycle queued` arrives (or immediately on the write, if none arrives within 2 s). A `turn.ended` whose `origin` is `task-notification` (or any non-human kind) releases nothing (§4.2). `session.interrupt` sets `paused: true` ("queue paused because you interrupted"); the composer's Resume is `session.queue.setPaused(false)`, which releases the head if the engine is idle. `session.send` while a turn is open enqueues; while idle it writes immediately and returns `disposition: 'sent'`. Steer (`session.steer`, `session.queue.promote`) writes `{ ..., priority: 'now' }` at once, never enters the app queue, and is reported through `command.lifecycle` and the eventual `result.user_message_uuids`. Every change is saved through the store before `onChange` fires, so the queue survives the process and the app (the acceptance's "queued message survives a process exit").

`file-session-state-store.ts`: one JSON file per app session at `<userData>/engine-host/state/<appSessionId>.json` holding `{ version: 1, queue, grants, launchSpec }`, written to a temp file then renamed; the engine host receives `userData` from main through the `hello` message's existing fields or, until C1 exposes it, from `MAWS_USER_DATA`/`process.env` as the supervisor forwards it (M5 decides which and records it). This adapter is the P0 store; C4's index may implement the port over SQLite later (the port is async so a cross-process adapter is possible) without touching the engine host.

### Rewind, `!`, `#` (`rewind.ts`, `bash-mode.ts`, `memory-append.ts`)

```ts
export interface RewindOutcome { rewound: boolean; reason: string | null; error: string | null; prefillText: string | null; precedingAssistantUuid: MessageUuid | null;
  files: null | { canRewind: boolean; filesChanged: number | null; insertions: number | null; deletions: number | null; skippedLinks: number | null; error: string | null } }
export function rewind(session: EngineSession, args: { targetMessageUuid: MessageUuid; lastSeenMessageUuid: MessageUuid; files: boolean }): Promise<RewindOutcome>;
export interface RewindFilesOutcome { ok: boolean; enabled: boolean; message: string | null; filesChanged: number | null; insertions: number | null; deletions: number | null; skippedLinks: number | null }
export function rewindFiles(session: EngineSession, args: { userMessageUuid: MessageUuid; dryRun: boolean }): Promise<RewindFilesOutcome>;
// ok = response.canRewind; enabled = false exactly when response.error is 'File rewinding is not enabled.' (the receipt hides Undo/Reapply then), true otherwise; message = response.error ?? null
```

Order: `rewind_conversation { target_message_uuid, last_seen_user_message_uuid, interrupt_if_running: false }` first; on `rewound: true` the host synthesises `boundary.rewind { targetMessageUuid, precedingAssistantUuid, prefillText }` (the engine emits no reset frame) and then, when `files` is true, `rewind_files { user_message_id: targetMessageUuid }`; a refused conversation rewind (`stale_target`, `unseen_later_turn`, `turn_running`, `commands_queued`, `prompt_pending`, …) returns `rewound: false` with the engine's `reason` and touches no files. `lastSeenMessageUuid` is required from the caller (the transcript knows what the human has seen); the host never substitutes its own latest uuid, because that would defeat the guard against discarding an unseen turn. `session.rewindFiles` is `rewind_files { user_message_id, dry_run }` alone (no conversation rewind): with `dryRun: true` it answers the receipt's "can Undo" question, with `dryRun: false` it restores the checkpoint; the outcome's `enabled` is false only for the engine's `File rewinding is not enabled.` answer, so C6 hides the affordance exactly when the wire path does not exist.

`!`: `session.bash(command)` writes `bash_command { command, cwd: <session cwd>, uuid }`, waits for the two replayed `user` frames (`<bash-input>`, `<bash-stdout>…<bash-exit-code>`) or 30 s, then writes `user { uuid, shouldQuery: false, parent_tool_use_id: null, origin: { kind: 'human' }, message: { role: 'user', content: '<bash-input>${command}</bash-input>\n' + <the replayed stdout frame's content verbatim> } }`; the following empty `result` is the echo receipt (`isEchoReceipt: true`), never a turn and never a queue release. Without the echo the model cannot see the output (`bash-context-alone`). The engine does not replay the echo frame on stdout (only its lifecycle frames, a `system/init` and the empty result follow, `bash-context-echoed` seq 10–14), so the normaliser emits the echo's `user.message` from the host's own `out` row: `{ messageUuid: <echo uuid>, origin: 'bash_echo', isSynthetic: true, isReplay: false, bash: null, content: <the frame's content> }`. On the wire the frame keeps `origin: { kind: 'human' }`: the stdin `origin.kind` vocabulary is the engine's closed union and an absent or unknown origin "fails closed at strict isHuman() trust gates" (SPEC 45.15.1), so the marker lives on the X1 event, where C6 reads it, not on the frame.

`#`: `session.memoryAppend({ text, target })` calls `get_memory_dialog`, chooses `files[]` by `target.kind` (`project` → `kind: 'project'`, `user` → `kind: 'user'`, `path` → the given path, which must be one of the listed files or folders), creates the file when `exists: false`, appends `\n- ${text}\n`, and returns the path. No wire mechanism exists for `#` (§4.2); the engine re-reads CLAUDE.md on the next turn.

### Process table and status (`src/engine-host/process-table.ts`, `src/shared/engine/status.ts`)

```ts
export const EngineSessionStatusSchema = z.strictObject({
  appSessionId: AppSessionIdSchema, engineSessionId: SessionIdSchema.nullable(), pid: z.number().int().nullable(), launchId: z.string(), launchedAt: z.string(),
  process: z.enum(['starting', 'initializing', 'ready', 'exiting', 'exited']),
  exit: z.strictObject({ code: z.number().int().nullable(), signal: z.string().nullable(), reason: z.enum(['quit', 'stop', 'archive', 'crash', 'unknown']), at: z.string() }).nullable(),
  engineState: z.enum(['idle', 'running', 'requires_action', 'unknown']),          // session_state_changed; 'unknown' before the first frame
  activity: z.enum(['compacting', 'requesting']).nullable(),                          // system/status
  turn: z.strictObject({ origin: z.enum(['human', 'engine']), startedAt: z.string(), userMessageUuids: z.array(MessageUuidSchema) }).nullable(),
  model: z.strictObject({ requested: z.string().nullable(), resolved: z.string().nullable() }),
  effort: EffortSchema.nullable(),
  permissionMode: z.strictObject({ requested: PermissionModeSchema, effective: PermissionModeSchema, refusal: z.enum(AUTO_MODE_REFUSAL_CODES).nullable() }),
  prePlanMode: PermissionModeSchema.nullable(),
  gateway: z.strictObject({ mode: z.enum(['gateway', 'direct']), baseUrl: z.string().nullable(), verified: z.enum(['pending', 'routed', 'direct', 'mismatch']),
                            autoModeServer: z.enum(['enabled', 'disabled', 'unknown']), localLaneObserved: z.boolean() }),
  subagentModel: z.string().nullable(), modelOverrides: z.record(z.string(), z.string()),   // ANTHROPIC_DEFAULT_*_MODEL in effect (names and values from the constructed env)
  engineVersion: z.string().nullable(), fileCheckpointing: z.boolean(),
  backgroundTasks: z.array(z.strictObject({ taskId: TaskIdSchema, taskType: z.string(), description: z.string(), ambient: z.boolean() })),
  grants: z.array(z.string()),                                                        // the snapshot's rule strings
  mcpServers: z.array(z.strictObject({ name: z.string(), status: z.string(), source: z.string().nullable() })),
  heldPeerMessages: z.array(z.strictObject({ messageUuid: z.string().nullable(), from: z.string(), fromName: z.string().nullable(), lane: z.string(), heldAt: z.string(), expiresAt: z.string() })),
  pendingRequests: z.number().int(), queue: z.strictObject({ length: z.number().int(), paused: z.boolean() }),
  keepAlive: z.array(z.enum(['turn', 'background_tasks', 'grants', 'mcp_connected', 'held_peer_message'])),   // §4.4: what would keep this process live under a budget; informational under the never-exit rule
  memory: z.strictObject({ rssKiB: z.number().int().nullable(), treeRssKiB: z.number().int().nullable(), sampledAt: z.string().nullable() }),
  journalPath: z.string(), hostHooks: z.array(z.string()), lastEventSeq: z.number().int(),
});
export type EngineSessionStatus = z.infer<typeof EngineSessionStatusSchema>;
export function toSessionRecordPatch(s: EngineSessionStatus): Partial<Pick<SessionRecord, 'engineSessionId' | 'engineVersion' | 'gateway' | 'model' | 'effort' | 'permissionMode' | 'holder'>>;   // what C4's index applies from a status
```

The table is keyed by `appSessionId`; a second `session.launch` for a live `appSessionId` is refused (`already_live`). Memory is sampled every 10 s with `ps -axo pid,ppid,rss` over the whole tree under each engine pid (the probe's `processTree`). "Connected MCP servers" is `mcpServers` from the latest `system/init.mcp_servers`, refreshed by `mcp_status` on demand; "held peer message" is the list above. `keepAlive` is recomputed on every change; nothing acts on it in C3 (never-exit rule), C12 will.

Gateway verification ("verified routed by `get_status`", mechanically): after the `initialize` response and before the first user frame, `session.ts` calls `get_status`, finds the `Session` section's row with label `Anthropic base URL`, and sets `gateway.baseUrl` to its value or null; `verified` is `routed` when `mode === 'gateway'` and `baseUrl === RELAY_URL`, `direct` when `mode === 'direct'` and the row is absent (the direct fixture `routing-flag-override` shows `Login`/`Organization`/`Email` rows and no base URL row), and `mismatch` otherwise, which also posts `notice.posted { level: 'warning' }`. The `Environment` section's `Auto mode server` row (`Enabled`/`Disabled`) sets `autoModeServer`; the read is repeated after each human turn's `result` (cheap, ~1 KB). `localLaneObserved` becomes true when a `message_delta.safeguard_results[].status.type === 'unavailable'` arrives (the gateway's `provider_not_anthropic` answer for a non-Anthropic main) or when a `system/informational` warning whose text names the auto-mode classifier or its usage arrives (the billing notice of §19); both leave the notice as `notice.posted` for the session notice C11 renders, and `toSessionRecordPatch` copies `baseUrl` and `autoModeServer` into `SessionRecord.gateway`.

### X1 extension (`src/shared/graph/session.ts`) — additive, flagged to the coordinator

`SessionRecord.gateway` becomes `{ routed: boolean; baseUrl: string | null; autoModeServer: 'enabled' | 'disabled' | 'unknown' }`. C4 fills `baseUrl: null, autoModeServer: 'unknown'` for sessions it discovers on disk. Nothing else in X1 changes; every frame the engine emits maps onto an existing kind or "none" (table above).

### Journal (`src/engine-host/journal.ts`)

```ts
export class JournalWriter { constructor(dir: string, launchId: string, opts: { maxBytes: number; redact: (s: string) => string }); row(direction: JournalDirection, frame: unknown): JournalRow; readonly path: string; close(): Promise<void> }
export class JournalReader { static rows(path: string): AsyncIterable<JournalRow>; static forSession(dir: string): string[] }   // launch files in order
export function pruneJournals(root: string, opts: { keepPerSession: number; maxAgeDays: number }): Promise<{ removed: number }>;
```

Location `<userData>/engine-host/journal/<appSessionId>/<launchId>.jsonl`, one file per process launch (a resume is a new launch and a new file), rows `{seq, direction, at, frame}` with `seq` from 1 per launch, `direction` `in | out | meta | stderr`, `at` ISO-8601. Meta rows: `spawn` (bin, args with the `--settings` JSON, env key names, cwd, gateway mode, engineVersion, appVersion, charter pin), `relay_health`, `initialize` (the response's `current_permission_mode`, `session_state`, `hooks_applied`, `workspace_trust_recorded`), `status_check` (`baseUrl`, `autoModeServer`, `verified`), `queue` (releases and pauses), `exit` (`code`, `signal`, `reason`, `lostAttentionCount`, `peakTreeRssKiB`). Rotation: at 128 MiB the writer closes the file and continues in `<launchId>.<n>.jsonl`; `seq` continues. Pruning at host start: keep the 20 most recent launches per session and nothing older than 30 days; `session.stop { reason: 'archive' }` and `SessionStateStore.forget` delete the session's directory. Redaction as the probe's `redact`: values of environment keys matching `/TOKEN|KEY|SECRET|PASSWORD/`, `sk-ant-*`, and e-mail addresses. The journal is the source of `EventBase.seq`, the input to the replay transport, and what `session.events` reads when its ring buffer no longer holds the requested range.

### X2 — commands and events (`src/shared/ipc/schema/{session,engine,attention}.ts`)

All owner `engine-host` unless noted. Inputs and outputs are `z.strictObject`; every `session.*` input carries `appSessionId`. `RelayHealthSchema`, `EngineSessionStatusSchema`, `QueueEntrySchema`, `RequestAnswerSchema`, `LaunchSpecSchema`, `RewindOutcomeSchema`, `AttentionItemSchema`, `SessionEventSchema` and the typed control responses are imported from their homes above.

Commands, `engine.*`:

| Name | Input | Output |
|---|---|---|
| `engine.ping` (C1) | void | `HostPing` |
| `engine.hostState` (C1, owner main) | void | `HostState` |
| `engine.binaryInfo` | void | `{ path, expectedVersion, version: string | null, ok: boolean, error: string | null }` (runs `--version` once, cached) |
| `engine.relayHealth` | `{ force: boolean }` | `RelayHealth` |
| `engine.sessions` | void | `EngineSessionStatus[]` |
| `engine.shutdown` | `{ graceMs: number }` | `{ stopped: number; forced: number }` (C5's quit path calls it) |

Commands, `session.*`:

| Name | Input | Output |
|---|---|---|
| `session.launch` | `{ spec: LaunchSpec }` | `{ status: 'launching'; session: EngineSessionStatus } | { status: 'relay_unreachable'; health: RelayHealth } | { status: 'refused'; reason: 'already_live' | 'binary_missing' | 'binary_version' | 'replay_disabled'; message: string }` — returns as soon as the process is spawned; readiness arrives as `session.status` with `process: 'ready'` (keeps the 10 s router timeout out of the launch path) |
| `session.status` | `{ appSessionId }` | `EngineSessionStatus` |
| `session.events` | `{ appSessionId, afterSeq: number | null, limit: number | null }` | `{ events: SessionEvent[]; lastSeq: number; complete: boolean }` — the reload-survival snapshot; from the in-memory ring (last 5,000 events) or the journal |
| `session.send` | `{ appSessionId, content: string | ContentBlock[] }` | `{ messageUuid; disposition: 'sent' | 'queued'; queueId: string | null }` |
| `session.steer` | `{ appSessionId, content }` | `{ messageUuid }` |
| `session.queue.list` | `{ appSessionId }` | `{ entries: QueueEntry[]; paused: boolean }` |
| `session.queue.edit` / `.remove` / `.promote` / `.setPaused` | `{ appSessionId, queueId, content }` / `{ appSessionId, queueId }` / `{ appSessionId, queueId }` / `{ appSessionId, paused }` | `QueueEntry` / void / `{ messageUuid }` / void |
| `session.interrupt` | `{ appSessionId, cancelEngineQueued: boolean }` | `{ stillQueued: string[]; cancelled: string[] }` (`cancel_queued` maps to the engine queue; the app queue pauses either way) |
| `session.answer` | `{ appSessionId, requestId, answer: RequestAnswer }` | `{ outcome: 'delivered' | 'not_pending' | 'write_failed' }` |
| `session.setPermissionMode` | `{ appSessionId, mode }` | `{ effective: PermissionMode; refusal: AutoModeRefusalCode | null; error: string | null }` |
| `session.setModel` | `{ appSessionId, model: string | null }` | `{ ok: boolean; error: string | null; code: string | null }` |
| `session.setEffort` | `{ appSessionId, effort: Effort | null }` | void (`apply_flag_settings { effortLevel }`, null clears) |
| `session.setThinking` | `{ appSessionId, maxThinkingTokens: number | null; display: 'summarized' | 'omitted' | 'highlights' | null }` | void |
| `session.applyFlagSettings` | `{ appSessionId, settings: Record<string, unknown> }` | void (C11: `fastMode`) |
| `session.stopTask` | `{ appSessionId, taskId }` | void |
| `session.rewind` | `{ appSessionId, targetMessageUuid, lastSeenMessageUuid, files: boolean }` | `RewindOutcome` |
| `session.rewindFiles` | `{ appSessionId, userMessageUuid: MessageUuid, dryRun: boolean }` | `RewindFilesOutcome` — C6's `engine.rewindFiles` shape under the `session.*` namespace (Cross-child reconciliation below) |
| `session.bash` | `{ appSessionId, command }` | `{ commandUuid }` |
| `session.memoryAppend` | `{ appSessionId, text, target: { kind: 'user' | 'project' | 'path'; path: string | null } }` | `{ path: string; created: boolean }` |
| `session.setCwd` | `{ appSessionId, path, trust: { accepted: true; directory } | null }` | `SetCwdResponse` (C10) |
| `session.renameSession` | `{ appSessionId, title }` | void (`source: 'host'`) |
| `session.generateTitle` | `{ appSessionId, description, persist: boolean }` | `{ title: string }` |
| `session.reloadPlugins` | `{ appSessionId }` | `ReloadPluginsResponse` |
| `session.mcpReconnect` / `session.mcpToggle` | `{ appSessionId, serverName }` / `{ appSessionId, serverName, enabled }` | void |
| `session.sideQuestion` | `{ appSessionId, question }` | `{ text: string }` (P1 UI; typed now) |
| `session.getUsage`, `session.getContextUsage { detail }`, `session.getSettings`, `session.listPermissionRules`, `session.getHooksListing`, `session.getMemoryDialog`, `session.getSkillsDialog`, `session.getSandboxDialog`, `session.getWorkspaceDiff`, `session.exportConversation`, `session.getStatus`, `session.mcpStatus`, `session.listModels`, `session.getSessionCost`, `session.getBinaryVersion` | `{ appSessionId, … }` | the typed response of the same name from `control.ts` |
| `session.stop` | `{ appSessionId, reason: 'stop' | 'archive' }` | `{ exited: boolean; code: number | null; signal: string | null }` |

Events:

| Name | Payload |
|---|---|
| `session.eventBatch` | `{ appSessionId, events: SessionEvent[] }` — batched per session every 16 ms, at most 500 events per batch (C6's name; C4 emits the same event for backfill and replay) |
| `session.status` | `{ appSessionId, status: EngineSessionStatus }` on every change |
| `session.queue` | `{ appSessionId, entries: QueueEntry[]; paused: boolean }` |
| `attention.changed` | `{ appSessionId, items: AttentionItem[] }` — the session's whole list |

Command, `attention.*`: `attention.list` void → `AttentionItem[]` (every live session). The `attention` namespace module was empty after C1; C3 claims these two entries because the broker is the source of the items (§4.6 "Items are the source of the Needs-you section"); C5 consumes them.

Exit policy: `session.stop` writes `end_session { reason }`, waits up to `graceMs` (5 s) for exit, then `endInput()`, then `SIGTERM` after 5 s, `SIGKILL` after 5 more; `process.exited.reason` is `stop` or `archive`. `engine.shutdown` does the same for every process with `reason: 'quit'`. An exit nobody asked for is `crash` when the code is non-zero or a signal killed it, `unknown` when it exited 0; both raise the broker's exit handling, pause the queue, and mark the status `exited`. The `process.exited` event is exactly `{ kind: 'process.exited', code, signal, reason, lostAttentionCount }` with `lostAttentionCount` the broker's `lost` (0 when nothing was pending or delivered), `seq: null`, `agentId: null`, `parentToolUseId: null`, and `sessionId` the engine id of the process that died. The engine host never relaunches on its own (D-16), so in P0 `session.reconnect` fires only on a user-initiated resume of an app session whose previous process exited, with exactly these payloads: `{ kind: 'session.reconnect', phase: 'attempting', attempt: 1, maxAttempts: 1, trigger: 'user', reason: null }` when `session.launch` with `resume` is accepted; then `{ …, phase: 'reconnected', reason: null }` when the new process's `initialize` response arrives, or `{ …, phase: 'failed', reason: <the launch error message, stderr lines included> }`; `EventBase` carries `seq: null` and `sessionId` = the resumed engine session id. The triggers `process_exit`, `host_restart` and `transport_error` and `attempt > 1` are reserved for C12's supervisor and are never emitted in P0.

### Cross-child reconciliation (C6, `docs/doperpowers/plans/2026-09-28-c6-transcript.md`, "X2 surface C6 consumes")

| C6 asked for | C3's answer |
|---|---|
| event `session.eventBatch { appSessionId, events }` | adopted verbatim (the event table above); C4 emits the same name for backfill and replay |
| command `session.events { appSessionId, afterSeq } → { events, complete }` | adopted; C3's output adds `lastSeq: number` (additive, C6 may ignore it); `afterSeq: null` means "from the start of the current launch" |
| `user.message.origin === 'bash_echo'` stamped on the wire frame | adopted as an X1 value convention, not a wire stamp: the echo `user.message` event carries `origin: 'bash_echo'` and `isSynthetic: true`, emitted from the host's own `out` frame (the engine never replays it), while the frame keeps `origin: { kind: 'human' }` because the stdin `origin.kind` union is the engine's and an unrecognised kind fails closed at its trust gates. C6's renderer reads the event, so nothing changes on its side |
| `engine.rewindFiles { appSessionId, userMessageUuid, dryRun } → { ok, enabled, message }` | adopted as `session.rewindFiles` with the same input and a superset output (`RewindFilesOutcome` adds `filesChanged`, `insertions`, `deletions`, `skippedLinks`). Renamed because every per-session command lives under `session.*` and `engine.*` is the host level (binary, relay, table, shutdown); C6's adapter line changes one string |
| exact `spillPath` shape | `string | null`, the absolute path the engine reports, from `tool_use_result.persistedOutputPath` or the `Output too large (…). Full output saved to: <path>` notice prefix (Normaliser above) |
| exact `session.reconnect` payload | the two-then-one sequence under Exit policy above, `trigger: 'user'` only in P0 |
| `appSessionId` as the field name | adopted in every C3 payload (X1's `AttentionItem` already uses it; `SessionRecord.appId` is C1's and untouched) |

### Dependencies

No new packages. Node built-ins only (`child_process`, `string_decoder`, `fs/promises`, `crypto`, `http`). The engine host imports `electron` in `index.ts` alone (through C1's `runHost`).

## Acceptance

C3 closes when all of the following are observed on the owner's Mac with ClaudeUsage's relay running (`curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8641/api/hello` prints `200`), in this order, from the C3 worktree with C1 merged:

1. `pnpm test` passes and its output includes the suites `launch contract builds the X6 command line and environment`, `transport frames and journals`, `control client ids, timeouts, cancellation`, `normaliser replays every probe fixture into the X1 graph` (one case per journal of pass 1, pass 2 and pass 3, 42 at the time of writing, each asserting every event validates against `SessionEventSchema`, that no `frame.unknown` is produced except for the `meta`/`stderr` rows and the subtypes listed in the test's allowlist, and per-fixture assertions named in M2), `journal round-trips into the same graph` (a live-shaped run through the replay transport is journaled, the journal is re-read through a fresh normaliser, and the two event lists deep-equal after `at` is masked), `permission broker states and the approvals-lost rule`, `queue release never follows an engine-initiated turn`, `plan outcomes map to the wire`, `bash mode echo and receipt`, `rewind sends last_seen and synthesises the boundary`, `grant snapshot re-applies through apply_flag_settings`, `ipc schema validates both directions` (extended with every C3 entry).
2. `pnpm build && pnpm e2e` passes with the new test `e2e/engine-replay.spec.ts`: with `MAWS_ENGINE_REPLAY=1`, `window.maws.invoke('session.launch', { spec: { …, replay: 'spikes/protocol-probe/fixtures/permission-roundtrip.jsonl' } })` returns `status: 'launching'`; the page receives `session.status` with `process: 'ready'`, then `session.eventBatch` batches containing `session.init`, `assistant.block.delta`, `tool.use`, `permission.requested`, and `attention.changed` with one `permission` item in state `pending`; `session.answer` with `{ kind: 'permission', decision: 'allow', scope: 'once' }` returns `delivered`; the replay continues to `tool.result`, the item is `confirmed`, and `turn.ended` arrives with `terminalReason: 'completed'`; `session.events { afterSeq: null }` returns the same events the page received.
3. `MAWS_LIVE=1 pnpm test:live` passes (or is skipped with the message `live tests skipped: relay at http://127.0.0.1:8641 unreachable — start ClaudeUsage` when the relay is down, never failed) and prints, per test, the journal path under the test's temp `userData`. The live suite proves, against `/Users/new/.local/share/claude/versions/2.1.283` through the gateway in auto mode with `--setting-sources user,project,local`:
   1. `session.launch` (gateway, auto, `model: 'sonnet'`, `sessionId` pinned) → `session.status` reaches `ready` within 15 s; `system/init.session_id` equals the pinned id; `permissionMode.effective === 'auto'`; `gateway.verified === 'routed'` with `baseUrl === 'http://127.0.0.1:8641'`; `autoModeServer === 'enabled'`; `engineVersion === '2.1.283'`.
   2. `session.send('Reply with exactly OK, then think briefly about why.')` → `assistant.block.delta` events with `textDelta` and (when the model thinks) `thinkingDelta`; `turn.ended` with `resultText` containing `OK` and `origin: 'human'`.
   3. With `extraSettings: { permissions: { ask: ['Bash(git log:*)'] } }` (auto mode allows the rest): asking for `git log --oneline` → `permission.requested` with `decisionReasonType: 'rule'` and an `attention.changed` `permission` item; `session.answer` allow with scope `once` → `tool.result` for that tool use with `denial: null` and the item `confirmed`.
   4. Asking for two AskUserQuestion questions → `question.requested`; `session.answer { kind: 'question', answers }` → the `tool.result` content contains `Your questions have been answered` with both answers.
   5. Dispatching two general-purpose subagents → `subagent.started` twice, child `assistant.block.complete` events with non-null `parentToolUseId` and `agentId`, `subagent.finished` twice; no `assistant.block.delta` carries a `parentToolUseId`.
   6. A slow prompt (`Count to 8 with separate Bash sleep 1 calls`) then `session.send` → `disposition: 'queued'`, `session.queue` shows one entry; after the turn's `turn.ended` the entry becomes `released` and the second `turn.ended` follows with the reply.
   7. During another slow turn, `session.steer('Stop counting and reply STEERED')` → the `user` frame carries `priority: 'now'` (journal), and a `result` whose `userMessageUuids` includes the steer uuid arrives before any queued message is released.
   8. During a slow turn, `session.interrupt` → `turn.ended` with `terminalReason` `aborted_streaming` or `aborted_tools`, the aborted call's `tool.result.denial === 'user-rejected'`, `session.queue.paused === true`; `session.queue.setPaused(false)` then `session.send('Reply RESUMED')` → `turn.ended` with `RESUMED`.
   9. With one message queued and one session grant issued (item 3's grant re-issued with scope `session`), `session.stop` → `process.exited { reason: 'stop' }`; `session.launch` with `resume` for the same `appSessionId` → `session.reconnect` `attempting` then `reconnected`; `session.queue.list` still shows the entry; the journal shows `apply_flag_settings { settings: { permissions: { allow: ['Bash(git log --oneline)'] } } }` before the first `user` frame; `session.listPermissionRules` shows that rule with `source: 'flagSettings'`; asking for `git log --oneline` again raises no `permission.requested`.
   10. `Run in the background: sleep 5 && echo BG_DONE` with a message queued during the turn → the human turn's `turn.ended` releases the queued message; the background `task.notification` then starts an engine-initiated turn whose `turn.ended` has `origin: 'task-notification'`; the queue released exactly one entry across the two turns and nothing at the engine-initiated one (asserted from the journal's `queue` meta rows).
   11. Two remembered words, then `session.rewind { target: <second>, lastSeen: <second>, files: false }` → `RewindOutcome.rewound === true` with `prefillText` equal to the second prompt, a `boundary.rewind` event, and a following turn that lists only the first word.
   12. File checkpointing: `Write the word ALPHA to notes.txt` (auto mode; the Write tool runs), then `Change notes.txt to say BETA`, then `session.rewind { target: <second>, lastSeen: <second>, files: true }` → `files.canRewind === true`, `filesChanged >= 1`, and `notes.txt` on disk reads `ALPHA`; the run's journal is copied to `spikes/protocol-probe/fixtures/pass3/rewind-files.jsonl` (redacted, provenance meta row added) and the conformance suite gains it.
   13. `session.launch` with `gateway: 'direct'` → `session.status` reaches `ready`, `gateway.verified === 'direct'`, the `get_status` `Session` section has no `Anthropic base URL` row; the journal's `spawn` row lists `--settings` with the empty-string env override and no `ANTHROPIC_BASE_URL` key; no model turn is sent.
   14. With the ask rule of item 3 and a pending `permission.requested`, `kill -9 <pid>` → `process.exited { reason: 'crash', lostAttentionCount: 1 }` and `attention.changed` with one `interrupted` item whose summary is `Session interrupted, 1 approval lost`; resuming and sending `Reply OK` raises no `permission.requested` for the old tool use.
   15. `session.bash('printf MAWS_BASH_LIVE')` → two `user.message` events with `bash.part` `input` and `output` (`stdout === 'MAWS_BASH_LIVE'`, `exitCode === 0`), one `user.message { origin: 'bash_echo', isSynthetic: true }`, then a `turn.ended` with `isEchoReceipt: true`; `session.send('What did my ! command print? Reply with only that text.')` → `MAWS_BASH_LIVE`.
   16. `session.memoryAppend({ text: 'MAWS live test note', target: { kind: 'project' } })` → the returned path is `<cwd>/CLAUDE.md` and the file ends with `- MAWS live test note`.
   17. Every read in the table answers within its class timeout and parses: `getUsage`, `getContextUsage`, `getSettings` (with `effective.dialogExpiry === 'never'`), `listPermissionRules`, `getHooksListing`, `getMemoryDialog`, `getSkillsDialog`, `getSandboxDialog`, `getWorkspaceDiff`, `exportConversation`, `getStatus`, `mcpStatus`, `listModels` (with `supportsAutoMode` per model), `getSessionCost`, `getBinaryVersion` (`version === '2.1.283'`).
   18. A test-only host hook `PreToolUse` on `Bash` → `hook.callback_requested` then `hook.callback_resolved`, the tool runs, and `getHooksListing` does not list it (host callbacks are absent from the listing, pass 2 item 5).
   19. With `mcpConfig` naming `spikes/protocol-probe/scenarios/pass2/elicit-mcp-server.mjs`, asking for `mcp__maws-elicit__ask_color` → `elicitation.requested { mode: 'form' }`; `session.answer { kind: 'elicitation', action: 'accept', content: { color: 'teal' } }` → the tool result contains `teal`.
   20. Plan approval: `session.setPermissionMode('plan')`, a small planning prompt until `plan.requested` arrives; `session.answer { kind: 'plan', outcome: 'keep_planning', feedback }` → `plan.resolved` and the tool result carries the feedback; a second `plan.requested`; `outcome: 'implement'` → `plan.resolved`, the next `system/init` reports the pre-plan mode (`auto`). In a fresh session the same up to `plan.requested`, then `outcome: 'clear_and_implement'` → `boundary.reset` (from `conversation_reset`) and a new `turn.started` whose first `user.message` begins `Implement this plan:`. The run is copied to `spikes/protocol-probe/fixtures/pass3/plan-outcomes.jsonl`.
   21. `engine.shutdown { graceMs: 5000 }` with two live processes → both `process.exited { reason: 'quit' }` within 12 s; `ps -p <pids>` lists neither.
4. `pnpm verify` exits 0 (typecheck, lint, unit tests, build, e2e, packaged build and packaged e2e; the live suite is not part of it).

## Plan of Work

Constraints for every milestone are in Constraints; each milestone says what exists at its end, what it touches, what it exposes and consumes, the decisions that are its alone, its edge, and what it proves. The interfaces are defined once, above.

### M1 — Launch contract (X6), transport and journal

At the end of M1 the engine host can turn a `LaunchSpec` into the exact process the charter describes and talk to it at the frame level: `buildLaunch` produces the pinned binary path, the §4.1 argument list and the constructed environment; `checkRelay` decides gateway or `relay_unreachable`; `spawnEngine` runs the process, splits stdout into frames, captures stderr, writes frames with flush semantics and reports exit; every frame is journaled in the X8 format under the journal directory with rotation and redaction; and a free live check (`initialize` only, no model turn) against the real binary shows the initialize response, a journal file on disk and a `get_status` read with the relay's base URL row.

Touches: `src/engine-host/{launch,shell-env,relay-health,transport,journal}.ts` and tests, `src/shared/engine/launch-spec.ts`, `test/live/support/live.ts`, `test/live/engine-host.live.test.ts` (the M1 case only), `vitest.config.ts` (project `live`, `include: ['test/live/**/*.live.test.ts']`, excluded from the default run), `package.json` (`test:live`: `MAWS_LIVE=1 vitest run --project live`).

Exposes: `LaunchSpecSchema`, `buildLaunch`, `checkRelay`, `spawnEngine`, `EngineTransport`, `JournalWriter`/`JournalReader`, `pruneJournals`. Consumes: C1's `parseStdoutFrame`, `parseStdinFrame`, `parseJournalRow`, `JournalRow`.

Decisions local to M1: the environment allowlist and exclusions, the flag order, `--session-id` pinning, the `sdk-ts` entrypoint, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, `TERM=dumb`, the 64 Mi line budget, the 5 s shell-capture timeout with `process.env` fallback, the journal layout, 128 MiB rotation, 20 launches and 30 days retention, and the probe's redaction rules are all stated in Interfaces (X6, Transport, Journal). The shell capture runs `env -0` and parses NUL-separated pairs so multi-line values survive; a capture that prints anything before the first `KEY=` line (a chatty rc file) is tolerated by scanning for the first `\0`-terminated pair. The `spawn` meta row is written before `spawn()` returns so a launch that dies instantly still leaves a journal. The relay check uses `http.request` with `Connection: close`, never `fetch` (keeps the socket count flat when nine sessions start). The live support file `test/live/support/live.ts` exports `liveGate()` (checks `MAWS_LIVE`, the binary at `ENGINE_BIN` with `--version` equal to `ENGINE_VERSION`, and `checkRelay`; returns a skip reason or a scratch git repository like the probe's `scratch()`), `withSession(spec, fn)` (launch, run, stop, print the journal path), and a `--max-budget-usd 0.50` default per process.

Does not touch: control requests beyond writing `initialize`/`get_status` raw in the live check, normalisation, broker, queue, X2 entries.

Proves: acceptance item 1's first two suites and item 3.1's routed check in miniature. Pins: for a gateway spec the env has `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`, `ENABLE_TOOL_SEARCH`, `CLAUDE_CODE_FORK_SUBAGENT`, `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING`, `CLAUDE_CODE_ENTRYPOINT=sdk-ts` and lacks every excluded key even when the capture holds them; for a direct spec the three gateway keys are absent and the `--settings` JSON parses to `{ dialogExpiry: 'never', env: { ANTHROPIC_BASE_URL: '', ANTHROPIC_AUTH_TOKEN: '' } }`; `args` starts with exactly the §4.1 flag set and never contains `--strict-mcp-config`; `--resume` and `--session-id` never co-occur; the splitter reassembles a 3-byte UTF-8 character split across two chunks and a frame split across three chunks, drops blank lines, and rejects a 64 Mi + 1 unterminated line; a `write()` after the process exited rejects; `JournalWriter` rows are `parseJournalRow`-valid with consecutive `seq`, a value matching `sk-ant-…` in an `out` frame is redacted, and a 128 MiB file rolls to `.1.jsonl` with `seq` continuing; `pruneJournals` keeps 20 launches and deletes older directories; the live M1 case (`MAWS_LIVE=1 pnpm test:live -t M1`) spawns the real binary with a gateway spec, sends `initialize` and `get_status` raw, sees the initialize response and the `Anthropic base URL` row equal to `RELAY_URL`, and leaves a journal file whose first row is the `spawn` meta row.

### M2 — Control channel, typed controls, normaliser and fixture conformance

At the end of M2 the adapter's brain exists without a process: `ControlClient` correlates responses to requests with ids, per-class timeouts and cancellation; `controls.ts` types every control request and response the charter names; `Normalizer` turns journal rows into X1 events by the mapping table; and the conformance suite replays all 40 probe fixtures (both passes) through `ReplayTransport` → `ControlClient` → `Normalizer` and checks the graphs. This is the milestone the reviewer reads first and the one every later milestone consumes, so it is reviewed at its boundary before M3 starts.

Touches: `src/engine-host/{rpc,controls,normalizer,replay-transport}.ts` and tests, `src/shared/wire/control.ts` (typed payloads, additive), `src/engine-host/conformance/fixtures.test.ts`, `test/support/fixtures.ts` (`FixturePass` gains `'pass3'`; `listJournals('pass3')` reads `fixtures/pass3/*.jsonl`, empty until M6).

Exposes: `ControlClient`, `REQUEST_TIMEOUT_MS`, the `controls.ts` functions, `Normalizer`, `replayEngine`. Consumes: M1's transport interface and journal, C1's frame parsers and the fixture loader.

Decisions local to M2: request ids `${launchId}-${n}`, the four timeout classes and the 60 s late table (Interfaces, Control channel); a `control_response` whose payload fails its typed schema rejects the caller's promise with `ControlError` and logs the zod path, never crashing the session; the `Normalizer` is a class with explicit correlation state so a replay can start from any journal row given a saved state (`session.events` after a rotation); event `id`s are `${appSessionId}:${launchId}:${seq}:${i}` (`i` the index within one row's events; synthesised events use `${appSessionId}:${launchId}:s${counter}`), deterministic so a replay reproduces them; `at` is the frame's `timestamp` when present, else the journal row's `at`. The replay transport advances on the adapter's writes: it holds the next `in` row while the fixture's next row is an `out` row, until the adapter writes a frame with the same `type` and (for control frames) the same `subtype`/`request_id` echo, or until a 200 ms grace passes when the adapter answers differently (the mismatch is recorded so a test can assert on it); `out` control_request ids are rewritten on the fly so the fixture's recorded response id matches our minted id (the transport keeps the recorded→minted map). In conformance tests the scripted answerer replays the fixture's recorded `out` responses for inbound requests, so the graph reflects the probe's decisions; per-fixture assertions are the C2 findings restated as graph facts.

Does not touch: the process transport (M1), broker behaviour (M3, the conformance answerer is a stub), queue, X2.

Proves: acceptance item 1's `control client` and `normaliser replays every probe fixture` suites. Pins, one line each: a `read` request with no response rejects with `ControlTimeout` after 15 s (fake timers) and a `control_cancel_request` for it is written; a late response after timeout is journaled and does not throw; an `error` response with `error_code: 'auto_mode_model'` rejects with `ControlError.code === 'auto_mode_model'` (fixture `auto-haiku`); `pass1/init` yields exactly one `session.init`, one `turn.started { origin: 'human' }`, `assistant.block.delta` thinking and text deltas, two `assistant.block.complete`, one `turn.ended { origin: 'human', isEchoReceipt: false }`; `pass1/permission-roundtrip` yields three `permission.requested` with `decisionReasonType: 'rule'`, resolutions allow, deny, allow, and a `tool.result { denial: 'permission-rule' }` for the denied id; `pass1/question-roundtrip` yields `question.requested` with two `Question`s and `question.answered` whose `answers` has two keys; `pass1/queue-and-interrupt` yields four `tool.result { denial: 'user-rejected' }` inside a `turn.ended { terminalReason: 'aborted_streaming' }`, then a `turn.ended` with `RESUMED`, then two `user.message` with `bash.part` `input` and `output`; `pass1/subagent` yields two `subagent.started`, child events with `parentToolUseId` set and `agentId` equal to the launch result's `agentId`, two `turn.ended { origin: 'task-notification' }` after the first; `pass2/workflow` yields `task.started { taskType: 'local_workflow' }`, three `workflow.progress`, `task.notification { status: 'completed' }`, and a `turn.ended { origin: 'task-notification' }`; `pass2/rewind` yields no `boundary.rewind` from the normaliser alone (it is synthesised by `rewind.ts`) and the typed `RewindConversationResponse` parses for both refusal and success; `pass2/auto-classifier` yields `tool.safeguard { verdict: 'not_flagged' }` for `toolu_01PGaV2Yy3rJAGQwn445u9iH` and the matching `tool.result.safeguard === 'not_flagged'`; `pass2/hooks` yields `hook.callback_requested { callbackId: 'maws_pre_bash' }`, `hook.callback_resolved`, `hook.started`/`hook.finished` for `PostToolUse:Bash` only; `pass2/dialogs` yields `elicitation.requested { mode: 'form' }` and `elicitation.resolved { action: 'accept' }`; `pass2/bash-context-echoed` yields two bash-tagged `user.message`s, then one `user.message { origin: 'bash_echo', isSynthetic: true }` derived from the `out` row (seq 9) with no duplicate from an `in` row, then a `turn.ended { isEchoReceipt: true }` before the real turn; `pass2/per-task-stop-off`'s background Bash result has `spillPath: null` and a synthetic result whose text starts `Output too large (12 KB). Full output saved to: /tmp/x/tool-results/toolu_1.txt` yields `spillPath: '/tmp/x/tool-results/toolu_1.txt'`; `pass2/per-task-stop-on` yields `tool.result { denial: 'user-rejected' }` in a `turn.ended { terminalReason: 'aborted_streaming' }` and a later `task.notification { status: 'completed' }`; `pass2/trust-attested` types `InitializeResponse.workspace_trust_recorded === true`; `pass2/prewarm` types `ClaimSessionResponse.status === 'ok'`; `pass2/routing-flag-override` and `pass2/auto-routed` type `GetStatusResponse` and the base-URL row is absent in the first and equal to `RELAY_URL` in the second; every `in` frame across all fixtures maps to an event or to a "none" row of the table, and `frame.unknown` appears for no fixture frame (the fixtures hold only known types; the test's allowlist is empty and fails if a new subtype appears).

### M3 — Permission broker and the human round trips

At the end of M3 every inbound request that needs a human is a broker item with the §4.6 states, an X1 attention item, and a typed answer that becomes the right wire response: permissions with their scopes and the guard against "always allow" on ask-rule prompts, AskUserQuestion answers, plan approval's three outcomes, dialogs and elicitations; host hooks are registered at `initialize` and answered; the grant snapshot records every session grant we issue; process exit raises "N approvals lost" once. `EngineSession` exists as the object that wires transport, client, normaliser and broker for one process and runs the initialize handshake, the gateway verification read and turn tracking.

Touches: `src/engine-host/{broker,grants,session}.ts` and tests, `src/shared/engine/answers.ts`, `src/engine-host/conformance/broker.test.ts`.

Exposes: `PermissionBroker`, `RequestAnswerSchema`, `GrantSnapshot` handling (`grants.ts`: `recordFromResponse(updatedPermissions)`, `reapply(client, snapshot)`), `EngineSession` (`start()`, `send()`, `answer()`, `stop()`, `status()`, `events()`, `on(event)`), `HostHookRegistry`. Consumes: M1 transport and journal, M2 client and normaliser, C1's `AttentionItemSchema`.

Decisions local to M3: everything under Interfaces, Broker; in addition: an inbound request that arrives while the process is `exiting` is retired at once with reason `exit` (no answer); `EngineSession.start()` order is spawn → `initialize` → `get_status` (gateway verification) → grant re-application when `resume` is set → mark `ready`; a failed `initialize` (error response, timeout, or exit before response) marks the process `exited { reason: 'crash' }` with the message in `error.raised { scope: 'process' }`, and the stderr lines seen so far are attached to the message (the `--resume` refusals arrive there: "is running as a background session", "No conversation found"); the pre-plan mode is captured when `permissionMode.effective` transitions into `plan` from any source (`initialize` response, `system/init`, `system/status`), so `clear_and_implement` knows what to restore even when the user entered plan mode through the composer chip. Attention items are recomputed from the broker table and emitted as a whole list per session; consumers replace, never merge.

Does not touch: the app queue (M4; `EngineSession.send` writes immediately in M3), X2 handlers, memory sampling.

Proves: acceptance item 1's `permission broker` and `plan outcomes` suites. Pins: over `pass1/permission-roundtrip` with a scripted human answering allow once, deny, allow with scope `session`, the third answer's wire frame carries `updatedPermissions` with `destination: 'session'` and `grants.ts` snapshot equals `['Bash(git status --short)']`; an item is `pending` at `accept`, `delivered` after the write resolves, `confirmed` at the `tool_result` frame with its id, `retired` afterwards; a `control_cancel_request` for a pending id retires it with `abort` and emits `permission.resolved { resolvedBy: 'abort' }`; `processExited()` with two pending and one delivered item returns `lost: 3` and emits one `interrupted` item with summary `Session interrupted, 3 approvals lost`, and with zero items emits nothing; a permission request with `decision_reason_type: 'rule'` answered with scope `session` is sent as `once` and the resolved event's `message` says `scope downgraded: ask rule`; a `question` answer produces `updatedInput.answers` keyed by the exact question strings of `pass1/question-roundtrip`; a plan `implement` answer is a bare allow with the request's input; `keep_planning` is a deny with the feedback; `clear_and_implement` produces, in order after the turn's result, `set_permission_mode { mode: <prePlanMode> }`, a `user` frame `/clear`, and a `user` frame starting `Implement this plan:`; an undeclared `request_user_dialog` kind stays pending and a `notice.posted { level: 'warning' }` is emitted; an `initialize` response with one `pending_permission_requests` entry re-accepts it; `reapply` writes `apply_flag_settings { settings: { permissions: { allow: [...] } } }` exactly as `pass2/grant-reapply-resume` seq 7 and nothing when the snapshot is empty; a `hook_callback` for a registered id runs the function and answers its return value, an unknown id answers `{}`.

### M4 — Queue, steer, interrupt, rewind, `!` and `#`, process table and stores

At the end of M4 the session behaves as the composer will label it: `send` queues during a turn and releases at the human turn's end, never into an engine-initiated turn; `steer` goes now; `interrupt` stops and pauses the queue; the queue and grants persist through the file-backed store and come back on a resume; `rewind` sends `last_seen`, synthesises the boundary and optionally rewinds files; `!` and `#` work; the process table computes status, keep-alive reasons, memory, MCP servers and held peer messages; stop and shutdown end processes cleanly and unexpected exits are classified.

Touches: `src/engine-host/{queue,rewind,bash-mode,memory-append,process-table}.ts`, `src/engine-host/store/file-session-state-store.ts`, `src/shared/engine/{session-state-store,status}.ts`, `src/engine-host/session.ts` (wiring), tests, `src/engine-host/conformance/queue.test.ts`.

Exposes: `MessageQueue`, `SessionStateStore`, `FileSessionStateStore`, `rewind`, `bashCommand`, `memoryAppend`, `ProcessTable` (`get(appSessionId)`, `list()`, `onChange`), `EngineSessionStatusSchema`, `toSessionRecordPatch`. Consumes: M3's `EngineSession` and broker, M2's client and normaliser events.

Decisions local to M4: the release rule, steer priority, pause semantics, store layout and the exit policy are in Interfaces; in addition: a queue release that fails to write (EPIPE) leaves the entry `queued` and pauses the queue with `error.raised { scope: 'transport' }`; `session.send` content longer than 1 MiB is refused at the schema (renderer attaches files instead, C7); the memory sampler runs one `ps` per 10 s for all processes, not one per process; `heldPeerMessages` expire from the table five minutes after `heldAt` even without a `released` frame, retiring the attention item; `keepAlive` includes `grants` whenever the snapshot is non-empty and `mcp_connected` whenever any `mcpServers[].status === 'connected'`; `memoryAppend` refuses a `path` target outside the files and folders `get_memory_dialog` listed (no arbitrary writes through this command); `toSessionRecordPatch` sets `holder: { kind: 'self' }` while `process` is not `exited` and leaves `holder` out otherwise.

Does not touch: X2 handlers, renderer, the never-exit decision (nothing exits a process except stop, archive, shutdown).

Proves: acceptance item 1's `queue release`, `bash mode`, `rewind` and `grant snapshot` suites. Pins: with a turn open, `send` returns `queued` and the store file holds the entry; a `turn.ended { origin: 'human' }` releases it and the written `user` frame has `origin.kind === 'human'` and no `priority`; a `turn.ended { origin: 'task-notification' }` releases nothing (replayed from `pass2/workflow` seq 108 and `pass1/subagent` seq 424); `isEchoReceipt` results release nothing (`pass2/bash-context-echoed`); `steer` writes `priority: 'now'` immediately with one entry still queued; `interrupt` writes `interrupt { reason: 'user-cancel', cancel_queued }`, sets `paused`, and a following `turn.ended` releases nothing until `setPaused(false)`; a `FileSessionStateStore` round trip after a simulated crash (write the file, new store instance) returns the same entries, `paused` and grants; `rewind` writes `rewind_conversation` with `last_seen_user_message_uuid` set, synthesises `boundary.rewind` with the fixture's `prefillText` on success and nothing on `stale_target`, and writes `rewind_files` only when `files` is true and the conversation rewind succeeded; `bashCommand` writes `bash_command` then the `shouldQuery: false` echo whose content contains the replayed stdout and whose wire `origin` is `{ kind: 'human' }`, emits `user.message { origin: 'bash_echo', isSynthetic: true }` for it, and marks the following empty result `isEchoReceipt`; `rewindFiles({ dryRun: true })` against the `pass2/rewind` refusal returns `{ ok: false, enabled: false, message: 'File rewinding is not enabled.' }` and against a synthetic `{ canRewind: true, filesChanged: 2 }` returns `{ ok: true, enabled: true, filesChanged: 2 }`; `memoryAppend` appends `\n- text\n` to the `project` file from `pass1/reads`'s `get_memory_dialog` shape and creates it when `exists: false`; the process table reports `keepAlive` containing `background_tasks` after `background_tasks_changed` with one task and drops it when the list empties; `stop` writes `end_session` and, with a transport that never exits, escalates to `SIGTERM` then `SIGKILL` at the stated delays (fake timers); an unexpected exit code 1 classifies `crash`, exit 0 classifies `unknown`.

### M5 — X2 surface: `session.*`, `engine.*`, `attention.*`, replay launch, e2e

At the end of M5 the engine host is reachable from the renderer: every command and event of Interfaces X2 is registered in the schema modules and handled in `src/engine-host/ipc.ts`; events are batched per 16 ms; `session.events` answers the reload-survival snapshot; `session.launch` with a `replay` spec runs a fixture through the whole stack under `MAWS_ENGINE_REPLAY=1`; the Playwright test drives a permission round trip through `window.maws` with no engine and no UI.

Touches: `src/shared/ipc/schema/{session,engine,attention}.ts` and the registry test, `src/engine-host/{ipc,index}.ts`, `e2e/engine-replay.spec.ts`, `e2e/support/launch.ts` (pass `MAWS_ENGINE_REPLAY=1`), `src/main/index.ts` only if the supervisor does not already forward `userData` to hosts (M5 checks C1's supervisor; if the `hello` message carries no paths, the engine host reads `MAWS_USER_DATA` or `app.getPath('userData')` forwarded as an env variable by main; the executor records which and why in the Decision Log — one line, no other main changes).

Exposes: the X2 entries of Interfaces; `registerEngineIpc(on, emit, deps)`. Consumes: everything from M1 to M4, C1's `runHost`, router, `dispatchToHost`, `HostSupervisor`.

Decisions local to M5: batching is per session, flushed every 16 ms or at 500 events, and a batch is flushed immediately before any `session.status` emission so a consumer never sees a status ahead of the events that caused it; the in-memory ring keeps the last 5,000 normalised events per live session and `session.events` reads the journal through a fresh `Normalizer` when `afterSeq` precedes the ring (`complete: false` when the range spans a rotated file that was pruned); a command for an unknown `appSessionId` fails with `IpcError { code: 'internal', message: 'unknown session <appSessionId>' }`; `session.launch` validates `replay` against `MAWS_ENGINE_REPLAY === '1'` and refuses with `replay_disabled` otherwise, so a packaged app cannot be pointed at a fixture; `attention.list` and `attention.changed` are the broker's list per session, whole-list replace; `engine.shutdown` is idempotent and answers before the processes are gone when `graceMs` is exceeded (`forced` counts the SIGKILLs). The registry test from C1 (prefix and count) is extended and a second test pins that every `session.*` command input has `appSessionId`.

Does not touch: renderer sources (no UI in C3), the PTY host, `src/shared/ipc/schema.ts` (the merge is C1's and needs no change), main's router.

Proves: acceptance item 2 and the `ipc schema validates both directions` extension of item 1. Pins: the e2e steps of item 2 in order; `session.events { afterSeq: <mid> }` returns exactly the events after that seq; a second `session.launch` for the same `appSessionId` while live returns `refused: already_live`; `session.answer` for an unknown request id returns `not_pending`; `engine.sessions` lists the replay session with `process: 'ready'` and `gateway.verified: 'routed'` (the fixture's `get_status` row); after `session.stop`, `engine.sessions` shows `process: 'exited'` with `reason: 'stop'`; reloading the page (`page.reload()`) and calling `session.events { afterSeq: null }` returns the same events as before the reload, because they live in the host.

### M6 — Live acceptance against the pinned binary through the gateway

At the end of M6 C3's acceptance has run as written: the live suite has passed on the owner's Mac through the relay in auto mode, the two new fixtures are recorded under `fixtures/pass3/` and the conformance suite covers them, the Surprises and Decision Log carry what the real engine said, and the branch is ready for its reviewer-high review.

Touches: `test/live/engine-host.live.test.ts` (all cases), `test/live/support/live.ts`, `spikes/protocol-probe/fixtures/pass3/{rewind-files,plan-outcomes}.jsonl` (copied from the runs' journals with the probe's redaction and a `provenance` meta row `{ charter: 'docs/charter.md', child: 'C3', pin: '87f8c788…' }`), `src/engine-host/conformance/fixtures.test.ts` (pass-3 assertions), this document's Progress, Surprises and Decision Log.

Exposes: the pass-3 fixtures to C4, C6, C7 (a real `rewind_files` success and the three plan outcomes on the wire). Consumes: everything.

Decisions local to M6: one live process per numbered case except where the case says otherwise, each with `maxBudgetUsd: 0.50`, model `sonnet`, the owner's real setting sources, a fresh scratch git repository per case (`git init` with one commit, as the probe's `scratch()`), `extraSettings` limited to what the case needs (the ask rule, `enableWorkflows` is not needed); cases that need no model turn (3.13 direct, 3.17 reads, 3.16 memory) send none; the suite runs serially (`workers: 1`) to keep the machine within the memory budget; the total is expected under three dollars and the executor records the actual `total_cost_usd` sum in Surprises. Case 3.12 is the charter's open item (rewind with file checkpointing): if `rewind_files` answers `canRewind: false` with `File rewinding is not enabled.` despite `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING=1`, the executor records the exact error, tries the `--settings { fileCheckpointingEnabled: true }` variant once, and, if both fail, marks the case skipped with the finding and writes a `[parent-impact]` line in the Decision Log for the coordinator (the receipt's Undo in §5.3 would then have no engine backing in print mode). Case 3.20's `/clear` follows the same protocol with the fresh-launch fallback named in Interfaces. Every live case prints its journal path; the executor keeps the two that become fixtures.

Does not touch: anything under `src/` except test support; the charter.

Proves: acceptance items 3 and 4, then the whole list 1 to 4 executed in order and ticked in Progress with timestamps.

## Concrete Steps

Working directory for everything: the C3 worktree (`git worktree add ../MAWS-c3 -b c3-engine-host master` after C1 lands), shown here as `/Users/new/Developer/GitHub/MAWS-c3`.

M1:

```
cd /Users/new/Developer/GitHub/MAWS-c3
pnpm install
pnpm test -- src/engine-host src/shared/engine
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8641/api/hello      # 200 when ClaudeUsage is running
MAWS_LIVE=1 pnpm test:live -t 'M1'
```

Expected tail of the live M1 case:

```
 ✓ test/live/engine-host.live.test.ts > M1 initialize only, routed
   journal: /var/folders/…/maws-live-…/engine-host/journal/<appSessionId>/<launchId>.jsonl
   get_status Anthropic base URL = http://127.0.0.1:8641
```

When the relay is down the same command prints `↓ live tests skipped: relay at http://127.0.0.1:8641 unreachable — start ClaudeUsage` and exits 0.

M2:

```
pnpm test -- src/engine-host/conformance src/engine-host/rpc src/engine-host/normalizer
```

Expected: one passing case per fixture under `normaliser replays every probe fixture into the X1 graph`, named `<pass>/<file>` (pass 1: `init`, `permission-roundtrip`, `question-roundtrip`, `queue-and-interrupt`, `reads`, `resume-fork-cli`, `resume-fork-no-replay`, `resume-fork-replay`, `resume-fork-start`, `subagent`; pass 2: the thirty files C1's document lists; pass 3: none yet), plus the per-fixture assertion cases named in M2's pins. A failure prints the fixture, the `seq` of the frame and either the zod issue path or the missing event kind.

M3, M4:

```
pnpm test -- src/engine-host
```

Expected: the suites `permission broker states and the approvals-lost rule`, `plan outcomes map to the wire`, `queue release never follows an engine-initiated turn`, `bash mode echo and receipt`, `rewind sends last_seen and synthesises the boundary`, `grant snapshot re-applies through apply_flag_settings` and `journal round-trips into the same graph` pass.

M5:

```
pnpm test -- src/shared/ipc
pnpm build && MAWS_ENGINE_REPLAY=1 pnpm e2e
```

Expected:

```
Running 3 tests using 1 worker
  ✓  e2e/smoke.spec.ts  preload bundle has no external runtime imports
  ✓  e2e/smoke.spec.ts  MAWS opens light, hosts answer, pty echoes, survives reload, theme switches, exits clean
  ✓  e2e/engine-replay.spec.ts  a replayed permission round trip crosses the X2 surface and survives reload
  3 passed
```

M6:

```
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8641/api/hello      # must print 200
MAWS_LIVE=1 pnpm test:live
```

Expected: 21 passing cases named `3.1 launch routed auto` … `3.21 shutdown`, each followed by its journal path; the run ends with a line `live cost: total_cost_usd sum = $N.NN across K turns`. Then:

```
cp <journal of 3.12> spikes/protocol-probe/fixtures/pass3/rewind-files.jsonl      # after the redaction script in test/live/support/live.ts has run on it
cp <journal of 3.20> spikes/protocol-probe/fixtures/pass3/plan-outcomes.jsonl
pnpm test -- src/engine-host/conformance                                          # 42 fixtures now
pnpm verify
```

If `pnpm test:live` fails on 3.12 with `File rewinding is not enabled.`: rerun that case with `MAWS_LIVE_CHECKPOINT_SETTING=1` (adds `fileCheckpointingEnabled: true` to `extraSettings`), and follow M6's protocol for the outcome.

If a live case fails because the engine's frames differ from the fixtures (a new subtype, a renamed field): the conformance suite's allowlist is not widened; the frame is added to the journal-backed evidence in Surprises and the charter's C3 section gets a dated line through the coordinator.

## Residue decisions

Ready to paste into the charter's C3 section as "**Residue decisions (C3, 2026-09-28):** what the design left to the child, settled here; the execution document `docs/doperpowers/plans/2026-09-28-c3-engine-host.md` carries the interfaces, milestones and gates. Grades: binding where a sibling codes against the outcome, advisory where a later child may overturn with a dated line here."

- *Transport framing and backpressure*: stdout is decoded with a UTF-8 `StringDecoder`, split on `\n`, blank lines dropped, a leading BOM stripped; an unterminated line over 64 Mi characters is a transport error that kills the process (the engine's own budget is 256 Mi; ours protects the host); a line that fails to parse is journaled and surfaced as `error.raised { scope: 'transport' }`, never fatal. Stdin has one serialised writer; a write resolves when the OS accepted the bytes (write callback, `drain` honoured), which is the §4.6 delivery truth for a `control_response`. No `keep_alive` is sent (the engine drops it on input); U+2028/2029 are not escaped (the engine's reader splits on `\n` only). Alternative: Node `readline`, rejected because it hides the budget and the decoder boundary. Advisory.
- *Request ids and timeouts*: host-minted ids are `${launchId}-${n}` (eight base32 characters per spawn, then a counter), distinguishable at a glance from the engine's UUIDs. Four timeout classes: `read` 15 s (`get_*`, `list_*`, `mcp_status`, `export_conversation`, `get_status`, `rewind_files` dry run), `mutate` 30 s (`set_*`, `apply_flag_settings`, `rename_session`, `stop_task`, `cancel_async_message`, `set_cwd`, `rewind_conversation`, `rewind_files`, `mcp_reconnect`, `mcp_toggle`, `end_session`), `interrupt` 15 s, `long` 120 s (`initialize`, `claim_session`, `generate_session_title`, `side_question`, `reload_plugins`); inbound human-facing requests have none (dialog expiry is never). A timeout rejects the caller, writes a `control_cancel_request` (harmless for uncancellable subtypes), and parks the id for 60 s so a late answer is journaled, not treated as unexpected; a timeout never proves the mutation did not apply, so callers re-read. Alternative: one 30 s timeout, rejected because `initialize` under the owner's settings and MCP prewait legitimately exceeds it. Advisory.
- *X2 surface*: the engine host owns `engine.binaryInfo`, `engine.relayHealth`, `engine.sessions`, `engine.shutdown`; `session.launch` (returns `launching` at spawn, readiness by event, or `relay_unreachable` / `refused`), `session.status`, `session.events` (reload snapshot with `afterSeq`), `session.send`, `session.steer`, `session.queue.{list,edit,remove,promote,setPaused}`, `session.interrupt`, `session.answer` (one discriminated `RequestAnswer` for permission, question, plan, dialog, elicitation), `session.setPermissionMode`, `session.setModel`, `session.setEffort`, `session.setThinking`, `session.applyFlagSettings`, `session.stopTask`, `session.rewind`, `session.rewindFiles` (C6's `engine.rewindFiles` shape, dry run included, under `session.*`), `session.bash`, `session.memoryAppend`, `session.setCwd`, `session.renameSession`, `session.generateTitle`, `session.reloadPlugins`, `session.mcpReconnect`, `session.mcpToggle`, `session.sideQuestion`, one `session.get*`/`list*` command per structured read, `session.stop`; events `session.eventBatch` (C6's name; batched 16 ms / 500; C4 emits the same for backfill and replay), `session.status`, `session.queue`, `attention.changed`; command `attention.list`. Every per-session payload names the session `appSessionId`. The `attention` namespace entries are C3's because the broker is the source of the items. Payloads in the execution document's Interfaces. Binding (C6, C7, C10, C11 code against the names; C5 against `attention.*`).
- *Bash echo convention*: the `!` echo frame is sent with `origin: { kind: 'human' }` (the engine's closed origin vocabulary; verified in pass 2) and is never replayed by the engine, so the host emits its `user.message` event itself from the `out` row with `origin: 'bash_echo'` and `isSynthetic: true`; renderers hide it and treat the following empty `result` as the receipt. Alternative: C6's proposal to stamp `origin.kind: 'bash_echo'` on the wire, rejected because an unrecognised kind fails closed at the engine's human-trust gates. Binding.
- *Spill path*: `tool.result.spillPath` is the absolute path the engine reports, from Bash's `tool_use_result.persistedOutputPath` or the `Output too large (…). Full output saved to: <path>` prefix of any other tool's result text; null otherwise; background shell output files ride `task.notification.outputFile`. Binding (C4 reads the file, C6 shows the affordance).
- *Reconnect and exit payloads*: `process.exited` carries `lostAttentionCount` from the broker; `session.reconnect` fires only for a user-initiated resume in P0 (`trigger: 'user'`, `attempt: 1`, `maxAttempts: 1`), `attempting` at accept, `reconnected` at the initialize response, `failed` with the error text; the other triggers are reserved for C12. Binding on the payloads, advisory on the P0 restriction.
- *Journal*: `<userData>/engine-host/journal/<appSessionId>/<launchId>.jsonl`, one file per process launch, X8 rows with `seq` from 1, `meta` rows for spawn (args with the `--settings` JSON, env key names only), relay health, initialize summary, gateway verification, queue releases and exit; rotation at 128 MiB to `<launchId>.<n>.jsonl` with `seq` continuing; pruning at host start to the 20 most recent launches per session and 30 days; archive deletes the session's directory; the probe's redaction (secret-looking env values, `sk-ant-*`, e-mail addresses). Alternative: one file per session across launches, rejected because a resume is a new process with its own id space and exit row. Advisory.
- *Queue and grant storage port*: `SessionStateStore` in `src/shared/engine/session-state-store.ts` with async `load/save` for the queue (entries plus paused flag), the grant snapshot (rule strings) and the last launch spec, and `forget`; P0 ships `FileSessionStateStore` at `<userData>/engine-host/state/<appSessionId>.json` (temp file then rename) and uses it in production until C4 or C12 provides an index-backed adapter; the port is async so a cross-process adapter is possible without touching the engine host. Alternative: the engine host writing SQLite directly, rejected because two writers on the index from two processes is C4's decision to make. Advisory (binding on the port's shape).
- *Process table*: `EngineSessionStatus` per live process (Interfaces): process state, engine state, activity, current turn with origin, model, effort, permission mode as requested and effective with refusal, pre-plan mode, gateway (`mode`, `baseUrl`, `verified`, `autoModeServer`, `localLaneObserved`), subagent model and model overrides, engine version, file checkpointing, background tasks, grants, MCP servers with status from the latest `system/init` (a "connected MCP server" is one whose status is `connected`), held peer messages from `peer_message_hold` with a five-minute expiry, pending request count, queue length and paused flag, `keepAlive` reasons (§4.4's list, computed, not acted on under the interim rule), memory (own and tree RSS sampled every 10 s with one `ps`), journal path, host hooks, last event seq. `toSessionRecordPatch` maps it onto the X1 session record for C4's index. Binding on the field names (C8's Session info and C12's budget read them), advisory on sampling.
- *Conformance tests in plain Node*: the adapter's modules import no Electron; a `ReplayTransport` plays a fixture's `in` rows and advances on the adapter's matching `out` writes (recorded request ids rewritten to the minted ones), and a scripted answerer replays the probe's recorded responses; the suite replays every fixture of every pass into the X1 graph, validates each event, forbids `frame.unknown` for fixture frames, and asserts C2's findings as graph facts; a journal written by a replayed run re-normalises to a deep-equal event list. Runs under vitest's node project in `pnpm test`. Binding (the charter's compatibility gate for engine upgrades).
- *Live tests*: a vitest project `live` (`pnpm test:live`, `MAWS_LIVE=1`) outside `pnpm test` and `pnpm verify`; gated by the binary at the pinned path answering `--version 2.1.283` and by `GET /api/hello` → 200, otherwise skipped with a message naming the relay; every process launched with the real X6 contract (gateway, auto mode, the owner's setting sources, Sonnet, `--max-budget-usd 0.50`), one scratch git repository per case, serial execution, journals printed, the cost sum reported. Advisory.
- *"Verified routed by `get_status`"*: after the `initialize` response and before the first user frame, `get_status` is read; the `Session` section's `Anthropic base URL` row must equal `http://127.0.0.1:8641` for `verified: 'routed'`; a direct launch is `verified: 'direct'` when that row is absent; anything else is `mismatch` and posts a warning notice; re-read after each human turn. The `Environment` section's `Auto mode server` row is the lane. Binding (the acceptance and C11's Session info depend on the mechanics).
- *Relay health check*: `GET http://127.0.0.1:8641/api/hello` over `http.request` with a 1500 ms timeout, success iff HTTP 200, cached 5 s, run before every gateway launch and on demand (`engine.relayHealth`); an unreachable relay answers `session.launch` with `relay_unreachable` before any spawn, and the launch sheet decides. Binding on the endpoint and outcome, advisory on timeout and cache.
- *File checkpointing in print mode*: the engine disables checkpointing in `-p` mode unless `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` is set (SPEC 15.12.1; the `fileCheckpointingEnabled` setting alone does not apply headless), so the X6 environment sets it to `1` and `rewind_files` becomes usable; M6 verifies a real file restore and records the fixture `pass3/rewind-files.jsonl`. Binding (X6).
- *Auto-mode lanes in the session record*: X1's `SessionRecord.gateway` gains `baseUrl` and `autoModeServer` (`enabled`/`disabled`/`unknown`), filled from `get_status`; `EngineSessionStatus.gateway.localLaneObserved` becomes true on a `safeguard_results[].status.type === 'unavailable'` (the gateway's `provider_not_anthropic` answer) or the engine's `system/informational` warning about the classifier, which also surfaces as `notice.posted` for C11's session notice. Binding (X1 additive change; C4 fills `null`/`unknown` for disk sessions).
- *Plan outcomes on the wire*: implement = bare allow (the engine strips the injected `plan`/`planFilePath` and restores the pre-plan mode itself); keep planning = deny with the feedback as `message`; clear context and implement = deny, then after the result `set_permission_mode` to the recorded pre-plan mode, a `user` frame `/clear` (a `local` command marked non-interactive-capable; M6 verifies the `conversation_reset`), then a `user` frame `Implement this plan:` with the plan body. Fallback if `/clear` is refused headless: a fresh launch seeded with the plan, recorded as a dated line. Binding on the three outcomes (§4.2), advisory on the `/clear` mechanism.
- *Steer*: a `user` frame written immediately with `priority: 'now'` (the engine queue's highest priority), never entering the app queue; ordinary sends during a turn enter the app queue with no `priority`. Binding (§4.2 Steer priority).
- *Exit policy*: `session.stop` and `engine.shutdown` write `end_session`, wait 5 s, close stdin, `SIGTERM` after 5 s, `SIGKILL` after 5 more; an exit nobody asked for is `crash` (non-zero or signal) or `unknown` (zero), pauses the queue and raises the broker's approvals-lost item; the engine host never relaunches on its own (D-16), and a user-initiated resume emits `session.reconnect { trigger: 'user' }`. Advisory.
- *Session id pinning*: new sessions launch with `--session-id <uuid>` minted by the host so the journal, the state file and the session record know the engine id before the first frame; never combined with `--resume`. Advisory.
- *Entrypoint and host hooks*: `CLAUDE_CODE_ENTRYPOINT=sdk-ts` (the probe's identity; all fixtures were recorded under it); no host hooks are registered in production launches in P0, the registry exists and is exercised by tests. Advisory.
- *Reload survival*: normalised events live in the engine host (a 5,000-event ring per session, the journal beyond it) and `session.events { afterSeq }` re-delivers them, so a renderer reload rebuilds its view without touching the process (§4.1). Binding.

## Surprises & Discoveries

- Observation: file checkpointing is off in print/SDK mode regardless of `fileCheckpointingEnabled`; only `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING` turns it on headless. This is why pass 2 saw `File rewinding is not enabled.` under the owner's settings, which have `fileCheckpointingEnabled: true`.
  Evidence: SPEC 15.12.1 `mT()`: `if (Ae()) return xsr();` where `xsr()` is `CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING && !CLAUDE_CODE_DISABLE_FILE_CHECKPOINTING`; `pass2/rewind.jsonl` seq 38 `{"canRewind":false,"error":"File rewinding is not enabled."}`; owner's `~/.claude/settings.json` `fileCheckpointingEnabled: true` (read 2026-09-28).
- Observation: the local stdio transport has no per-request timeout at all; the only wall-clock bounds are four constants for engine-originated subtypes, so every host-side timeout is a UI decision, not a protocol fact.
  Evidence: SPEC 45.16.4 "The local stdio transport applies no per-request deadline."
- Observation: `get_status` is answerable before any user turn, and its `Session` section carries `Anthropic base URL` only when a custom base URL is in effect; a direct process shows `Login`, `Organization` and `Email` rows instead.
  Evidence: `pass2/routing-flag-override.jsonl` seq 11–12 (no user frame; rows `Login: Expired — log in again`, no base URL row); `pass2/auto-routed.jsonl` seq 145 (`Anthropic base URL: http://127.0.0.1:8641`, `Auto mode server: Enabled`).
- Observation: the relay was up during authoring and answers the health check exactly as D-19 assumes.
  Evidence: `curl -s -m 2 -i http://127.0.0.1:8641/api/hello` → `HTTP/1.1 200 OK` (2026-09-28).
- Observation: `/clear` is a `local` slash command marked non-interactive-capable in the command catalogue, which is the basis for the plan outcome "clear context and implement" over the wire; the pass-2 probe never sent it, so M6 verifies.
  Evidence: SPEC 28 command table row `| /clear | reset, new | local | Start a new session with empty context … | ✓ | post-text | | ✓ | ✓ |`.
- Observation: the engine's own queue priority `now` exists and is what "steer" needs; the default for an enqueued command is `next`.
  Evidence: SPEC 11 `QueuedCommand.priority?: "now" | "next" | "later"; // default "next" for enqueue`, `promoteToNow(uuid)`.
- Observation: AskUserQuestion multi-select answers travel as one comma-joined string per question.
  Evidence: `question-roundtrip.jsonl` seq 138 `"answers":{"Which color do you prefer?":"Red","Which fruits do you like?":"Apple, Pear"}`.
- Observation: the engine never replays the host's `shouldQuery: false` echo frame on stdout even with `--replay-user-messages`; only its lifecycle frames, a `system/init` and the empty result follow, so the `bash_echo` marker C6 needs has to be synthesised from the host's own `out` row.
  Evidence: `pass2/bash-context-echoed.jsonl` seq 9 (`out user shouldQuery:false`) followed by seq 10–14 `command_lifecycle queued`, `started`, `system/init`, `result` (`num_turns: 0`), `command_lifecycle completed`; the probe's meta row seq 15 lists exactly those five frames.
- Observation: spilled results have two different wire keys, which is why `spillPath` is read from a structured field for Bash and from a text prefix for everything else.
  Evidence: SPEC 16 §16.13 `persistedOutputPath?: string; // "Path to the persisted full output in tool-results dir (set when output is too large for inline)"`; SPEC 12 §12.12 notice `` `Output too large (${Ut(e.originalSize)}). Full output saved to: ${e.filepath}\n\n` ``.

## Decision Log

- Decision: Verification for C3 is a task review at each milestone boundary under subagent-driven execution, with dependency-frontier reviews after M2 (the typed controls and the normaliser, consumed by every later milestone and, through the fixtures, by C4 and C6) and after M5 (the X2 surface, consumed by C7, C10, C11), and one whole-branch independent review through `doperpowers:reviewer-high` at the end, per the charter's §19 verification call (reviewer-high for C3 and C4).
  Rationale: the normaliser fixes the meaning of every wire frame for the rest of P0, and the X2 names are what three later children code against; both deserve a review before anything downstream consumes them.
  Date/Author: 2026-09-28, C3 author.
- Decision: This document is authored against parent pin `87f8c7881119ea670901205dae35917d3751459c`, the charter blob that carries D-19, the two-lane classifier entry, rewind branching, safeguard attribution and C1's residue. C1's code has not landed at authoring time; the concrete X1 and X2 names come from C1's execution document, which the charter designates as the interim canonical source. If C1's landed code renames anything named here, the executor follows the code and records the rename in this log.
  Rationale: coordinator instructions; the four wave-2 documents are authored in parallel against the same pin.
  Date/Author: 2026-09-28, C3 author.
- Decision: The X1 session record's `gateway` field is extended additively (`baseUrl`, `autoModeServer`) rather than adding a separate lane event kind, and the two auto-mode lanes surface through that field plus `notice.posted`.
  Rationale: the lane is state about the session, not a transcript event; the charter's C3 consequence is "renders the `system` warning as a session notice", which `notice.posted` already carries. Alternative rejected: a new event kind `session.lane`, which every consumer would have to learn for one row of Session info.
  Date/Author: 2026-09-28, C3 author.
- Decision: Reconciled with C6's "X2 surface C6 consumes" (coordinator request during authoring): adopted `session.eventBatch` (event), `session.events` (snapshot, plus an additive `lastSeq`), the `appSessionId` field name, and the `bash_echo` value on the X1 `user.message` event; renamed C6's `engine.rewindFiles` to `session.rewindFiles` with a superset output; specified `spillPath` and the `session.reconnect` and `process.exited` payloads exactly so C6's event fixtures can be built against them.
  Rationale: one namespace for every per-session command keeps C7, C10 and C11 consistent; stamping an app value onto the engine's `origin.kind` union would risk the frame's human attribution. Alternative rejected: keeping C3's original `session.events` for both the event and the snapshot (C1's host-state pattern), which C6 found confusing for a stream with a distinct snapshot.
  Date/Author: 2026-09-28, C3 author.
- Decision: The app queue and grant snapshot persist through a file-backed adapter in the engine host in P0, behind the `SessionStateStore` port.
  Rationale: the release decision needs turn-end knowledge that only the engine host has; the index lives in main under C4, which runs in parallel; a port keeps both children unblocked. Alternative rejected: a host→main request in the host protocol, which would touch C1's envelope while five children extend it.
  Date/Author: 2026-09-28, C3 author.

## Outcomes & Retrospective

Pending — written at finish.
