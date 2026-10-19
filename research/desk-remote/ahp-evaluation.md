# Agent Host Protocol (AHP) as the desk's remote protocol: an evaluation for MAWS #52

**Question.** How far does Microsoft's Agent Host Protocol fit the desk (a browser client, a per-machine daemon that owns Claude Code sessions, and a Cloudflare Durable Object relay), and should #52 adopt it?

**Sources and pins** (read only; nothing was built or run):
- `microsoft/agent-host-protocol` at `1ef0642965efaa7ef98caff287bca923fbc80ec6` (2026-10-17), cited as `ahp@1ef0642:path:line`. Shallow clone in `/private/tmp/ahp-eval-1019/ahp`.
- `microsoft/vscode` at `c2f7817f9132a822cef2078e1f5fda05b74d785c` (2026-10-19), sparse (`src/vs/platform/agentHost`, `src/vs/sessions`, `src/vs/workbench/contrib/chat/browser/agentSessions`), cited as `vscode@c2f7817:path:line`.
- External repos for §2 are pinned there.
- Claude Code engine: `/Users/new/claude-code-bundle/2.1.300/cli.pretty.js` (cited `cli:line`). Its control-protocol inventory is taken from [rc-parity-research.ko.md §3.2](rc-parity-research.ko.md#L213).
- MAWS: `origin/master` at `bb8b9de7d`, `src/shared/ipc/names/*` read with `git show`; the per-command classification is taken from [maws-web-porting-surface.md](maws-web-porting-surface.md) (read at `e42e6bbd8`).
- GitHub metadata (releases, issues, stars) fetched with `gh` on 2026-10-19.
- **FACT** = read in source or docs at the pin. **INFER** = my reading, not stated anywhere. **NOT FOUND** = searched for, absent.

---

## 0. The answer

**Verdict: adopt AHP's mechanisms, not the protocol.** Copy its connection contract nearly verbatim and shape the desk's session state after AHP's chat model, but keep the desk's own vocabulary as the contract, and keep an AHP-conformant facade on the daemon as a later, cheap add-on rather than the foundation.

Why:
1. **The mechanisms are the best prior art found for the desk's exact problem**, and they are separable from the vocabulary: channel-URI routing on every message, `initialize`/`reconnect` with `replay | snapshot | missing`, action envelopes with `serverSeq` + `origin{clientId, clientSeq}`, write-ahead reconciliation, the session-level `inputNeeded` roll-up, tail-windowed chat snapshots (`view.turns` + `fetchTurns`), and per-subscription credit windows with fragments (§3).
2. **The vocabulary is a display model for an agent-agnostic client, and the desk's client is MAWS's renderer.** MAWS renders from its own normalised event stream (`session.eventBatch`, X1) behind a three-method bridge; AHP would force a lossy double translation (engine → AHP → MAWS view model) or a rewrite of the transcript layer, and still leave roughly half of MAWS's surface (artifacts over Yjs, browser, library, connectors, the engine's `ui_*` mod surface, attention, scm) to `x-` extensions (§1).
3. **The protocol is young and moves with VS Code.** Ten spec releases between 2026-05-28 and 2026-10-02, most with breaking changes; 1.0.0 is 17 days old and 1.1.0 is already pending with an SDK-breaking change; VS Code vendors the types and tracks unreleased `main` with its own deltas; flow control is "1.0 – Early development" and chunking for request results is unresolved (§4).
4. **It leaves the relay's hard problems to the deployment**: no frame cap on request results and snapshots (the 1 MB break in vscode.dev/agents), no specified replay-buffer size or ping cadence, cleartext bearer tokens in frames, unauthenticated `clientId`, and `reconnect` that cannot ask for a bounded snapshot. Microsoft's own relay (Mission Control over Azure Web PubSub) solves chunking, batching and credential sealing in a layer *beneath* AHP (§3).
5. **The reference host shows both the fit and the loss.** VS Code's agent host already runs Claude Code through the Claude Agent SDK (0.3.281, on by default, tagged experimental) and maps stream-json onto AHP well, but drops live compaction, status, retries, hooks, rate limits, cost, "always allow" suggestions and task stop, and cannot run Claude sessions over its relay at all. The ACP route (claude-agent-acp → ahp-acp-gateway) loses more: AskUserQuestion, subagents, steering, fork, and any turn over five minutes (§2).
6. **What adoption would buy, interop with VS Code's agents UI, ahpc, the Swift/Kotlin SDKs, is a bonus, not the owner's goal**, and a facade modelled on VS Code's Claude mapper gets most of it later. The facade becomes the right first step only if interop becomes a goal (§5).

---

## 1. State model and coverage

### 1.1 What AHP models

AHP is "a synchronized, multi-client state protocol for AI agent sessions" (`ahp@1ef0642:README.md:3`). Its doctrine: state-first, host-authoritative and client-responsive, a "client-facing presentation model" that "is not the place to … expose backend-specific tool names as client contract" (`ahp@1ef0642:docs/guide/doctrine.md:9-43`).

Channels (`ahp@1ef0642:docs/specification/subscriptions.md:22-33`), each with a state tree reduced by pure reducers shared by host and client:

| Channel | State | Stability (`versioning.md:37-51`) |
|---|---|---|
| `ahp-root://` | agents and their models, terminal catalogue, host config | 2 Stable |
| `ahp-session:/<uuid>` | title, status bitset, activity, project, working dirs, config schema + values, customizations, active clients, chat catalogue, `defaultChat`, `inputNeeded`, changesets, `_meta` | 2 Stable |
| `ahp-chat:/<id>` | turns, active turn, response parts, tool calls, pending (queued + steering) messages, input requests, draft, background work, changesets, canvases, per-chat config overlay | 2 Stable |
| `ahp-terminal:/<id>` | pty content, claims, cwd, command detection | 2 Stable |
| `ahp-changeset:/…` | file-level diffs, review flags, operations | 1.2 RC |
| annotations, canvas, automations, automation runs, TCP, resource watch, OTLP, MCP | — | 1.0 to 2 |

The pieces that matter for a Claude Code session (all FACT, `ahp@1ef0642:types/channels-chat/state.ts` unless noted):

- **Turns and messages.** `Turn {id, startedAt, duration, message, responseParts[], usage, state: complete|cancelled|error}` and `ActiveTurn` (`:749-791`). `Message {text, origin.kind: user|agent|tool|automation|systemNotification, attachments, model, agent, _meta}` (`:799-875`). Attachments: simple, embedded base64, resource ref, annotations, bounded chat transcript (`:731-1052`).
- **Response parts**: markdown, content ref (large content by reference), tool call, reasoning, system notification, input request, error (`:1062-1212`). Streaming is `chat/responsePart` then `chat/delta` / `chat/reasoning` appends (`types/channels-chat/actions.ts:96-111`).
- **Tool calls**: a state machine `streaming → pending-confirmation → running ⇄ auth-required → pending-result-confirmation → completed | cancelled` (`:1223-1236`, `:1477-1635`), with `toolName`, `displayName`, `intention`, `invocationMessage`, `toolInput` (inline or by ref), `partialInput`, `confirmationTitle`, `edits` preview, `editable`, `options[]` (id, label, approve/deny, group), `riskAssessment`, `pastTenseMessage`, MCP-shaped `content[]`/`structuredContent`, and cancellation `reason` + `userSuggestion`.
- **Tool result content** adds file edits, terminal references (live subscribable, retained after exit) and subagent references (`:1666-1816`).
- **Permissions and approvals** are tool-call confirmations; the first `chat/toolCallConfirmed` wins and later ones are rejected (`docs/guide/ahp-and-acp.md:67`, `docs/specification/chat-channel.md:370`). The session channel aggregates every outstanding block across chats as `inputNeeded` (`chatInput | toolConfirmation | toolClientExecution | toolAuthentication`), answerable without subscribing to the chat (`docs/specification/session-channel.md:103-120`).
- **Questions and elicitations**: `ChatInputRequest {id, message, url, questions[], answers}` with text, number, boolean, single- and multi-select (with free-form values), draft/submitted/skipped answers synced across clients by `chat/inputAnswerChanged` (`:479-708`).
- **Pending input**: one list of `queued` and `steering` entries with set / remove / reorder; the host consumes queued entries as new turns and injects steering mid-turn; "repeated identical upserts MUST NOT cause duplicate provider delivery" (`docs/specification/chat-channel.md:380-410`).
- **Subagents**: a worker is its own chat with `origin {kind: tool, chat, toolCallId}` and `interactivity: full | read-only | hidden`; the spawning tool result carries `ToolResultSubagentContent` (`:323-415`, `:1786-1796`). Background shells and subagents that outlive their tool call are `backgroundWork` entries (`:242-315`).
- **Forks and side chats**: `createChat` with `source {kind: fork | sideChat, chat, turnId, selection?}` (`docs/specification/chat-channel.md:112-163`). Truncation (`chat/truncated`) supports edit-and-resend (`docs/guide/state-model.md:627-653`).
- **Errors**: durable `ErrorResponsePart` with `resumable`, and `chat/turnResume` (`docs/specification/chat-channel.md:303-322`).
- **Models and modes**: `AgentInfo.models[] {id, name, maxContextWindow, configSchema, vendor, _meta}`; `ModelSelection {id, config}` rides on each message (`types/channels-root/state.ts:56-261`). There is **no first-class mode** (permission mode, plan mode): modes go in the session config schema, whose properties can be `sessionMutable` and `chatMutable` (`types/channels-session/state.ts:614-660`).
- **Usage**: per turn `{inputTokens, outputTokens, model, cacheReadTokens, _meta}` (`types/common/state.ts:413-426`). No cost, cache-write tokens, context-window fill or rate limits.
- **Files and diffs**: `resourceRead/Write/List/Copy/Delete/Move/Resolve/Mkdir`, `createResourceWatch`, either direction (`docs/specification/root-channel.md:61-70`); changesets per session, chat or turn with host-defined operations (`invokeChangesetOperation`).
- **Customizations**: plugins, directories, agents, skills, prompts, rules, hooks and MCP servers with load and enablement state; MCP start/stop/background requests and OAuth (`types/channels-session/state.ts:742-1530`).
- **Completions**: `completions` on a chat for `@` and `/`, with `InitializeResult.completionTriggerCharacters`; `terminalCommandPrefix: "!"` for shell escapes (`types/common/commands.ts:244-330`).
- **Multi-client**: `activeClients[]` (each may contribute tools and plugins; client-contributed tools are executed by the owning client), drafts, read and archived flags.

### 1.2 Claude Code against that model

The engine side is stream-json out, control requests in (96 subtypes), and 16 host-bound requests (`can_use_tool`, `request_user_dialog`, `hook_callback`, `elicitation`, …) ([rc-parity-research.ko.md §3.2](rc-parity-research.ko.md#L213)). `system/init` advertises tools, MCP servers, model, permission mode, slash and terminal-only slash commands, skills, plugins and agents (`cli:169436`). `can_use_tool` carries `permission_suggestions`, `blocked_path`, `decision_reason*`, `tool_use_id`, `agent_id` (`cli:80851`).

**Maps cleanly** (the host translates; no extension needed):

| Claude Code | AHP |
|---|---|
| user prompt; `--replay-user-messages` echo | `chat/turnStarted` (client-dispatched, echoed with `origin`) |
| `stream_event` text and thinking deltas | `chat/responsePart` + `chat/delta`, `chat/reasoning` |
| `tool_use` (streamed input) → `tool_result` | `chat/toolCallStart` / `toolCallDelta` (`partialInput`) / `toolCallReady` / `toolCallComplete` |
| `result` | `chat/turnComplete` + `chat/usage` (partial, see below) |
| API error, `max_turns`, retryable failure | `chat/error` with `resumable`, `chat/turnResume` |
| `interrupt` | `chat/turnCancelled` |
| `can_use_tool` | tool call → `pending-confirmation`, `options[]` (allow once, allow always per suggestion, deny), `editable` → updated input, deny-with-guidance → `userSuggestion`; `inputNeeded` roll-up |
| AskUserQuestion, MCP elicitation (form and URL), `request_user_dialog` | `chat/inputRequested` / `inputAnswerChanged` / `inputCompleted` |
| MAWS queue: `session.queue.*`, `session.steer`, `session.steer.cancel`, `cancel_async_message` | `chat/pendingMessageSet/Removed`, `chat/queuedMessagesReordered` with `kind: queued | steering` |
| Task / Agent tool, `task_started/progress/notification` | worker chat (`origin.kind: tool`, read-only), `ToolResultSubagentContent`, `backgroundWork` |
| Bash `run_in_background` | `backgroundWork {kind: shell, terminal}` + terminal channel |
| `side_question` (`/btw`) | `createChat {source: sideChat}` |
| `rewind_conversation`; edit and resend | `chat/truncated` + new `chat/turnStarted` |
| `--resume --fork-session` | `createChat {source: fork}` or `moveChat {newSession}` |
| `rename_session`, `generate_session_title` | `session/titleChanged` |
| `set_model`; effort, thinking budget | `Message.model` / `ModelSelection.config` against the model's `configSchema` |
| `mcp_status/toggle/reconnect`, MCP OAuth | MCP customizations, `session/mcpServerStart/StopRequested`, `authenticate` |
| plugins, skills, agents, hooks from `system/init`; `reload_plugins/skills` | `session/customizations*` |
| `file_suggestions`, slash-command menu | `completions` |
| `read_file`, MAWS `files.*` | `resourceRead/List/Write`, `createResourceWatch` |
| `get_workspace_diff`, MAWS `git.diff`, `scm.status` | changesets |
| `bash_command` (`!`) | `terminalCommandPrefix` |
| MAWS `pty.*` | terminal channel (`createTerminal`, `terminal/input`, `terminal/resized`, `disposeTerminal`), windowed credit |
| MAWS drafts, archive, read state | `chat/draftChanged`, `*/isArchivedChanged`, `*/isReadChanged` |
| MAWS session list and status | `listSessions` (paged) + `root/session*` notifications, status bitset |

**Fits only through extension points.** AHP has four, all FACT:
- `_meta` on nearly everything: root, session, chat, message, action, tool call, usage, error, system notification, model (`ahp@1ef0642:types/channels-chat/state.ts:182`, `:1417`; `types/common/state.ts:413-447`). Clients must ignore unknown keys. Session `_meta` changes by full replacement through `session/metaChanged` (`types/channels-session/actions.ts:622-634`); **chat `_meta` has no change action** (NOT FOUND in `ActionType`, `types/common/actions.ts:154-262`), so per-chat side state must ride on actions or parts.
- Config schemas: session (`sessionMutable`, `chatMutable`, `enumDynamic` with `sessionConfigCompletions`), model `configSchema`, root config.
- `x-` names for channel schemes, commands, notifications and action types, "by prior agreement between peers" (`docs/specification/overview.md:9-13`). Stock reducers drop unknown actions (`types/channels-chat/reducer.ts:982-984`), so an `x-` action never changes a standard channel's state: real extension state needs its own `x-` channel with its own reducer.
- `InitializeResult._meta` for host capability advertisement (`docs/specification/lifecycle.md:69`).

| Claude Code / MAWS | Extension route |
|---|---|
| permission mode (default, acceptEdits, plan, auto, bypass) | session config property, `sessionMutable` (VS Code does this; see §2) |
| plan mode, ExitPlanMode approval | tool confirmation with options; the plan text as markdown; no plan state |
| `compact_boundary`, `/compact` | `SystemNotificationResponsePart` + `_meta`; `/compact` as a message or `x-` command |
| `system/status`, `api_retry`, `session_state_changed` | `chat/activityChanged` + status bits; detail in `_meta` |
| hook events | system notifications or `_meta`; no typed hook-run state |
| context usage, session cost, cache-write tokens, `rate_limit_event` | `UsageInfo._meta`, session `_meta`, or `x-` requests |
| `get_settings`, `list_permission_rules`, hooks/memory/skills/sandbox dialogs, `export_conversation`, `get_status` | `x-` requests |
| `stop_task` | no stop action for `backgroundWork` (NOT FOUND); `x-` action or cancel the owning tool call |
| `rewind_files` | a changeset operation (host-defined verb) |
| permission suggestions that add rules or directories | option ids the host maps back; the structured update itself stays host-side |
| `prompt_suggestion`, `tool_use_summary` | `_meta` |
| MAWS queue hold, pause, promote | not modelled; `x-` |
| MAWS engine mod surface (`session.ui.*`, 12 commands) | an `x-maws-ui:` channel with its own state |
| MAWS attention, owner channel | session `_meta` or an `x-` channel |
| engine and host status (`engine.*`, `host.*`) | root `_meta` / root config |

**Does not fit the model at all** (it would be a second protocol carried inside the first):
- **Artifacts as Yjs documents** (`artifacts.*`, the y-protocols frames outside X2). AHP is host-authoritative reducers with server-wins conflicts, not a CRDT. You can tunnel y-protocols frames in an `x-` channel's notifications, but AHP adds nothing. The nearest typed concepts, canvases (experimental) and the session-artifacts RFC ([#507](https://github.com/microsoft/agent-host-protocol/issues/507), links only), do not cover editing.
- **The in-app browser, library, connectors broker, voice, layout and presentations**: machine-app services, not agent-session state; most are client-local on the web anyway ([maws-web-porting-surface.md §2, §6](maws-web-porting-surface.md#L456)).
- **Raw engine fidelity.** AHP is lossy by design: the host renders each tool call into display strings, and the raw tool input survives only as `toolInput` with `toolName` "for debugging/logging" (`types/channels-chat/state.ts:1387-1401`). MAWS's renderer consumes normalised engine events (X1) with per-tool renderers. Feeding it from AHP means either an AHP→X1 adapter in the browser (which cannot recover what the host dropped) or carrying X1 in `_meta` (doubling payloads).
- **Binary pty bytes.** `terminal/data` is a JSON string counted in UTF-16 bytes; MAWS sends binary chunks stamped with offsets ([maws-web-porting-surface.md §0](maws-web-porting-surface.md#L10)). It works, at a cost in size and escaping.

**Coverage, roughly** (INFER, by namespace counts in `src/shared/ipc/names/*` at `bb8b9de7d`): of the `session` namespace, the turn, permission, question, queue, subagent, fork, rewind, rename, model, MCP, diff, file and terminal commands map (about two thirds); the dialog reads, settings, replay fixtures, intents, deletions and `ui.*` need `x-`. Of the other 24 namespaces only `pty`, `files`, `fs`, `git`, `scm` (via changesets), `plugins` (customizations, not install) and `engine/host` (as `_meta`) touch AHP at all.

---

## 2. Claude Code in the AHP ecosystem today

Pins for this section: `agentclientprotocol/claude-agent-acp` (formerly `zed-industries/claude-code-acp`, which redirects) at `7bcbfc7` (package v0.94.0), `formulahendry/ahp-acp-gateway` at `9bcd0d4`, `smagnuso/hydra-ahp` at `a92e675`; shallow clones under `/private/tmp/ahp-eval-1019/ext/`. In VS Code cites, `AH/` is `src/vs/platform/agentHost/`. This section was read by a delegated reader; the constants and the claims marked ✓ were re-checked at the pin.

### 2.1 VS Code's agent host runs Claude Code, through the Claude Agent SDK

- **Package.** `"@anthropic-ai/claude-agent-sdk": "0.3.281"` (`vscode@c2f7817:package.json:175`), next to `@github/copilot-sdk` and `@openai/codex`. Shipped builds download a per-platform SDK tarball at first use (`AH/node/claude/phase15-plan.md:84,164`), which is what `root/progress` "Downloading Claude agent…" in the spec reflects (`ahp@1ef0642:docs/specification/root-channel.md:170-186`).
- **Process.** The host calls the SDK's `query()`; the SDK owns its bundled CLI subprocess (`AH/node/claude/CONTEXT.md:538`). Options: `includePartialMessages: true`, `forwardSubagentText: true`, `enableFileCheckpointing: true`, `settingSources: ['user','project','local']`, `disallowedTools: ['WebSearch']` (`AH/node/claude/claudeSdkOptions.ts:177-199`). That the SDK speaks stdio stream-json and the control protocol to the CLI is INFER (VS Code never names that wire); it is how the SDK works.
- **"Transport mode" is the model backend, not the pipe.** `proxy` (default) points the CLI at a local `127.0.0.1` Anthropic-Messages proxy that forwards to GitHub Copilot's API; `native` uses the user's own `ANTHROPIC_API_KEY` or `CLAUDE_CODE_OAUTH_TOKEN` (`AH/node/claude/claudeTransportMode.ts:13,62`; `claudeSdkOptions.ts:136-142`).
- **Status.** `chat.agentHost.claudeAgent.enabled` defaults to `true` but is tagged `experimental`, behind the policy `Claude3PIntegration` ✓ (`AH/common/agentHostStarter.config.contribution.ts:326-334`). The roadmap's Phase 14, "ready to enable for external preview", is not ticked (`AH/node/claude/roadmap.md:1580-1593`).
- **Agent seam.** Every backend implements `IAgent` (`AH/common/agent.ts:1611` onward): `onDidChatProgress`, `setPendingMessages`, `truncateChat`, `respondToPermissionRequest(id, approved: boolean)`, `respondToUserInputRequest`, `resolveChatConfig`. Claude advertises `multipleChats: {fork, sideChat}` (`AH/AGENTS.md:536-546`).

### 2.2 How it adapts Claude events and requests to AHP

| Claude SDK | AHP | Cite (`AH/node/claude/`) |
|---|---|---|
| `stream_event` `content_block_start` text / thinking / tool_use | `chat/responsePart` markdown / reasoning, `chat/toolCallStart` | `claudeMapSessionEvents.ts:599-667` |
| `text_delta`, `thinking_delta`, `input_json_delta` | `chat/delta`, `chat/reasoning`, `chat/toolCallDelta` | `:686-723` |
| `content_block_stop` (tool) | `chat/toolCallReady` (`confirmed: not-needed`) | `:733-765` |
| part ids | `${turnId}#${messageId}#${index}`, because `index` resets per `message_start` | `:775-805` |
| `user` `tool_result` | `chat/toolCallComplete`, after file-edit and shell-output capture | `claudeSdkMessageRouter.ts:75-84` |
| `result` success / error | `chat/usage` (input, output, cache-read, model; `total_cost_usd` ignored) / `chat/error`; `chat/turnComplete` once the prompt queue drains | `claudeMapSessionEvents.ts:482-545`; `claudeSdkPipeline.ts:686-701` |
| `canUseTool` | tool call → `pending-confirmation`; **answer is binary** allow/deny; `suggestions` accepted but never forwarded, so "always allow" is not bridged ✓ | `claudeCanUseTool.ts:40-50,117-176` |
| AskUserQuestion, MCP `onElicitation` | `chat/inputRequested`; answers return as `updatedInput.answers` | `claudeCanUseTool.ts:275-300`; `CONTEXT.md:632-695` |
| ExitPlanMode | two-button Approve/Deny; Approve sets `permissionMode = acceptEdits` | `claudeCanUseTool.ts:246-266`; gap stated at `roadmap.md:990-1008` |
| permission mode, model, effort | session config, hot-swapped at the prompt boundary (`setPermissionMode`, `setModel`, `applyFlagSettings({effortLevel})`); "deliberately no mid-turn mutation path" | `claudeSdkPipeline.ts:369,393,520`; `CONTEXT.md:603`; modes at `AH/common/claudeSessionConfigKeys.ts:30` |
| steering / queued | steering → `SDKUserMessage {priority: 'now'}`; queued held by the host and sent as later turns | `claudeAgentSession.ts:1293`; `CONTEXT.md:1444-1470` |
| interrupt | `AbortController`, "NOT `Query.interrupt()`" | `claudeAgent.ts:2441` |
| subagents | worker chat at `<parent>/subagent/<toolCallId>`; inner content arrives only as canonical messages ("0 inner stream_events"); `toolCallId → agentId` needs a four-step heuristic because the SDK has no API for it | `CONTEXT.md:979-1057` |
| restore checkpoint / start over / fork | `resumeSessionAt` / `deleteSession` + recreate / `forkSession({upToMessageId})`; `rewindFiles` never called | `claudeAgent.ts:1121,1159,1686-1692`; `roadmap.md:733-747,892` |
| resume | `getSessionMessages` + `getSubagentMessages` → `Turn[]`; raw-CLI sessions are listable and importable; `CLAUDE_CODE_DISABLE_PRECOMPACT_SKIP` set because the SDK otherwise returns only post-compaction history for transcripts over ~5 MB | `claudeSavedChatReader.ts:55,68`; `claudeAgent.ts:2079`; `claudeAgentSdkService.ts:31-42` |
| slash commands | discovered via `supportedCommands()` + a disk scan (the SDK gives names only), sent as prompt text (INFER) | `claudeSdkPipeline.ts:110-117`; `roadmap.md:1689-1700` |
| MCP | host servers → `Options.mcpServers`; client tools via an in-process SDK MCP server; `toggleMcpServer`, `reconnectMcpServer` | `claudeSdkPipeline.ts:151-158` |
| file edits | edit `tool_use`/`tool_result` pairs tracked into `fileEdit` content; Bash edits (`sed -i`) not tracked | `CONTEXT.md:51-59`; `roadmap.md:1027` |

**What it drops.** Live `compact_boundary`, `task_progress`, `status`, `api_retry`, `rate_limit_event`, `tool_progress`, hook events, `local_command_output` and `prompt_suggestion` "fall through with `[]`" ✓ (`AH/node/claude/claudeSubagentSignals.ts:96-98`; `CONTEXT.md:1130`). On replay only `compact_boundary` and `notification` survive, as system notifications (`claudeReplayMapper.ts:204-207`), and usage is absent because `result` is not in the JSONL (`CONTEXT.md:950-955`). Not surfaced at all: `interrupt`, `rewindFiles`, `stopTask` (so `backgroundWork` cannot be stopped), `getContextUsage`, `setMcpServers`, cost. Embedded attachments are dropped and images are not rendered yet (`claudePromptResolver.ts` header).

**Read for the desk** (INFER): the AHP vocabulary is workable for Claude Code, and VS Code's mapper is the template to copy for any facade. But the reference host keeps exactly the parts AHP can type and drops much of what MAWS renders today: compaction, status, retries, hooks, rate limits, cost, rule suggestions, task stop. That is the coverage gap of §1.2 made concrete.

### 2.3 The ACP route: Claude Code → claude-agent-acp → ACP → ahp-acp-gateway → AHP

The chain exists and is configured by default: the gateway's `claude` provider runs `npx --yes @agentclientprotocol/claude-agent-acp` (`ahp-acp-gateway@9bcd0d4:ahp-acp-gateway.default.json:41`); the adapter drives the SDK (0.3.303) through `query()` (`claude-agent-acp@7bcbfc7:package.json:68-69`). Neither project tests the full chain (the gateway's integration test uses a fake ACP agent).

The root cause of most losses is the gateway's minimal handshake: it declares only `clientCapabilities: {session: {configOptions: {boolean: {}}}}` (`ahp-acp-gateway@9bcd0d4:src/acp.ts:196-207`), so the adapter disables AskUserQuestion ("Without form-elicitation support there is no way to present it over ACP", `claude-agent-acp@7bcbfc7:src/acp-agent.ts:11113-11124`) and flattens subagents. Every `session/prompt` also runs under a 300 s request timeout (`src/acp.ts:289-297`; `default.json:20`), so a turn longer than five minutes, including time waiting on a permission prompt, fails.

| Feature | Hop 1: SDK → ACP (adapter) | Hop 2: ACP → AHP (gateway) | Net |
|---|---|---|---|
| text, thinking | deltas kept; tool-input deltas and redacted thinking dropped | `chat/delta`, `chat/reasoning`; no `toolCallDelta` | streams; tool arguments arrive whole |
| subagents | child sessions only if the client declares support | not declared | flattened (INFER) |
| permission choices | allow once, allow always, reject once; rich ExitPlanMode options | `{id, label}`, typed only approve/deny | usable; meaning in labels |
| plan / todos | ACP `plan` | flattened into markdown | structure lost |
| AskUserQuestion | needs `elicitation.form` | not declared | **lost** |
| slash commands | `available_commands_update` | completions | kept |
| usage, cost, context window | `usage_update` | opaque `_meta.acpContext` | degraded |
| compaction | `compaction_update` | last value in session `_meta` | effectively lost |
| resume, fork, history import | load, resume, fork, list | `session/load` on rebind only; lists only its own SQLite sessions | fork and CLI-history import lost |
| reconnect | n/a | `serverSeq` ring of 10,000 + snapshot fallback (`src/gateway.ts:419-441`) | good |
| persistence | CLI JSONL | SQLite; the active turn ends as `host_restarted` on restart | turns in flight don't survive |
| cancel | `interrupt` + `stopTask` | `session/cancel`, then kill | works; per-subagent stop lost |
| steering, queueing | supported | "a turn is already active" rejection (`src/gateway.ts:899`) | lost |
| terminals | display-only, opt-in | not opted in | output as tool-result text only |
| client MCP servers | supported | always `mcpServers: []` | lost |
| model, effort | config options | model picker + config | kept |
| diffs | ACP `diff` | `fileEdit` + changesets | kept |
| rewind | dry-run previews | none | lost |
| multi-client | single client | broadcast to many observers | good |

hydra-ahp (v0.1.7, skimmed) puts an AHP view on a persistent multi-client ACP daemon on `127.0.0.1:55590`. Its shape (a daemon owns the sessions, AHP is a view) is the closest to the desk, but it reaches Claude Code only through ACP and inherits hop 1's losses.

**Conclusion.** The ACP path costs more fidelity than it saves work; a desk host should map stream-json directly, as VS Code does. The adapter also confirms which control requests a richer bridge uses that VS Code doesn't: `interrupt`, `stopTask`, `getContextUsage`, `rewindFiles` (dry-run) (`claude-agent-acp@7bcbfc7:src/acp-agent.ts:4397,8730,10487`; `src/file-change-audit.ts:205`).

---

## 3. Wire behaviour, and what a Durable Object relay would have to do

### 3.1 What the spec says

- **Transport.** Any reliable, ordered, bidirectional stream of complete messages; WebSocket text frames with one JSON-RPC message each are the common choice, and the server is the WebSocket server (`ahp@1ef0642:docs/specification/transport.md:3-26`). The transport is fixed out of band, not negotiated.
- **Routing.** Every request and notification carries `params.channel`; a receiver "or an intermediate proxy" can route on `(method, params.channel)` alone, checked at compile time (`docs/guide/what-is-ahp.md:11`; `docs/specification/subscriptions.md:42-69`). This is the property a relay needs.
- **Handshake.** `initialize {protocolVersions[], clientId, clientInfo, initialSubscriptions[], locale, capabilities}` → `{protocolVersion, serverSeq, snapshots[{resource, state, fromSeq}], _meta, completionTriggerCharacters, terminalCommandPrefix, …}` (`docs/specification/lifecycle.md:5-73`; `types/common/commands.ts:165-330`).
- **Sequencing.** `serverSeq` is **one counter per host connection-wide**, not per channel: `InitializeResult.serverSeq` is "Current server sequence number" and `reconnect` sends a single `lastSeenServerSeq` (`types/common/commands.ts:252`, `:452-453`). Snapshots carry `fromSeq`; every later action on that channel has a higher `serverSeq` (`subscriptions.md:75-81`).
- **Reconnect** (`lifecycle.md:91-156`; `types/common/commands.ts:432-564`): `reconnect {clientId, lastSeenServerSeq, subscriptions[], windows?}` returns **either** `replay {actions[], missing[]}` **or** `snapshot {snapshots[]}`, one choice for the whole connection. `missing` lists disposed or no-longer-permitted channels. Protocol notifications (`root/sessionAdded`, telemetry, progress) are not replayed; the client re-lists. On reconnect the client "resets `confirmedState` accordingly and clears `pendingActions`" (`docs/guide/reconciliation.md:81`).
- **Replay-buffer size**: unspecified (NOT FOUND; only "if the gap exceeds the replay buffer", `lifecycle.md:128`). The `activeClients` grace period is "host-defined" (`types/channels-session/actions.ts:261`).
- **`reconnect` has no `view`.** `subscribe` can ask for the last N turns (`view.turns`) with older turns paged by `fetchTurns` (`subscriptions.md:172-196`), but `ReconnectParams` has no view (`types/common/commands.ts:448-466`), and without a view the host "MUST return all turns that it retains" (`subscriptions.md:193-195`). INFER: a snapshot-type reconnect of a long chat is unbounded unless the host chooses otherwise.
- **Write-ahead reconciliation** (`docs/guide/reconciliation.md:5-60`): confirmed state + pending actions; own echo pops, foreign actions rebase pending, rejected echo drops. Client actions go up as `dispatchAction`, a **notification with no response**; the echo is the only receipt. `pendingMessageSet` is idempotent by id (`chat-channel.md:410`); a duplicate `chat/turnStarted` with the same `turnId` is not specified (NOT FOUND).
- **Delivery preferences.** `subscribe.delivery.maxLatencyMs` lets the host coalesce updates (two `chat/delta`s into one) only if the result is the same state (`subscriptions.md:155-170`).
- **Windowed delivery** (stability **1.0 – Early development**, `docs/specification/windowed-delivery.md:3`): opt-in per subscription; `windowBytes` (soft target) and `maximumFrameBytes` (hard, ≥ 1024) per direction, measured in UTF-16 bytes (`:37-80`, `:314`); oversize data messages split into `channel/frame` fragments, one in-flight fragmented message per subscription and direction, interleavable with other subscriptions (`:230-312`); credit via `channel/credit`; a full window means pause the source or merge deltas, never queue without bound (`:482-496`). On reconnect each windowed subscription recovers alone with its own `lastAppliedServerSeq` and `recovery: snapshot | replay | live`, counters reset (`:498-571`). **It does not limit request results, `initialize` snapshots or `resourceRead`** (`:655-666`). The SDKs carry the types but not the scheduling (`:670-676`).
- **Size limits and chunking.** The base spec has no message-size limit. [RFC #138](https://github.com/microsoft/agent-host-protocol/issues/138) (open since 2026-05-19, no comments) proposes `ahp/messageSegment` with base64 segments and per-direction limits negotiated at `initialize`/`reconnect`, motivated by Azure Web PubSub's 1 MB frame cap in GitHub's `copilot-host`; resumable transfer and compression are out of scope. Windowed delivery's `channel/frame` (from [#492](https://github.com/microsoft/agent-host-protocol/issues/492)) covers subscription data only; #492 itself asks to bring snapshots and replay under bounded delivery, so the gap is acknowledged and open.
- **Ping.** A `ping` request the server must answer even before `initialize`; interval and timeout are "implementation-specific" (`transport.md:34-38`). The TypeScript SDK's reconnect supervisor has backoff (250 ms → 30 s, 25 % jitter, retry forever: `clients/typescript/src/client/hosts/policy.ts:121-133`) but no liveness timer (INFER from `grep` of `client/hosts/runtime.ts`, `client/client.ts`, `ws/transport.ts`).
- **Auth.** Endpoint access is a transport concern (`transport.md:40-44`). The `authenticate` command pushes a bearer token **in cleartext inside the frame** for agent-level protected resources ([#268](https://github.com/microsoft/agent-host-protocol/issues/268) proposes sealing it to a host key). `clientId` is an unauthenticated string, so whoever learns it can `reconnect` as that client and replay its stream ([#259](https://github.com/microsoft/agent-host-protocol/issues/259), proposal).
- **Versioning.** SemVer offered as a list, host picks; baselines `>=1.0.0 <2.0.0` and `>=0.9.0 <0.10.0`; capabilities first, then required; unknown action types ignored (`docs/specification/versioning.md:59-120`). Channel stability levels separate stable channels from experimental ones (`:5-51`).
- **Multi-host client.** Rust, Swift, Go and .NET (and TypeScript `MultiHostClient`) talk to several hosts at once (`README.md:24`; `docs/guide/implementations.md:12`). Each host is its own connection with its own `serverSeq`; there is no cross-host session namespace (INFER from the types).

### 3.2 Does AHP assume a direct connection?

Yes. The wire assumes **one logical end-to-end connection** between client and host: `clientId`, `serverSeq` and the replay buffer belong to the host, and the spec gives an intermediary nothing to do beyond routing. Microsoft's deployments relay frames, not AHP state, and put their relay fixes **outside** the protocol:
- **Local and SSH.** A WebSocket server on a Unix socket or named pipe, token in `?tkn=`, 403 otherwise, then `initialize` (`vscode@c2f7817:AH/LOCAL_ENDPOINT.md:3,85-95`; `AH/` = `src/vs/platform/agentHost/`); SSH relays wait 60 s to reconnect (`AH/node/sshRemoteAgentHostService.ts:132`).
- **vscode.dev/agents** reaches the host through a **VS Code tunnel** (dev tunnels; `chat.agentHost.remoteConnections` defaults to `devTunnel`, port 31546: `AH/common/missionControlEnvironment.ts:16`, `AH/common/tunnelAgentHost.ts:21-24`). A 1,055,731-byte unbounded chat snapshot made it disconnect and reconnect deterministically ([vscode#335232](https://github.com/microsoft/vscode/issues/335232), open since 2026-09-09).
- **Mission Control** exposes the same host and protocol handler over **Azure Web PubSub**: "remote clients use the same authoritative session state and protocol handler, not a separate daemon"; default-off, experimental (`AH/node/missionControl/MISSION_CONTROL.md:3-11`). It adds, in a transport layer beneath AHP: base64 chunking at 900 KiB per segment (32 MiB per message, 30 s reassembly; `AH/common/webPubSub/chunking.ts:24-51`), batch frames of up to 256 items negotiated by a `{"kind":"capabilities","accepts":["batch"]}` frame (`AH/common/webPubSub/framing.ts:188`; `MISSION_CONTROL.md:55`), sealed credentials (NaCl/HPKE), client-id binding and read-only passive clients. **Claude sessions are visible over Mission Control but cannot run there**, because remote execution requires `supportsScopedCredentials`, which only the Copilot agent sets ✓ (`MISSION_CONTROL.md:59-63`; `AH/node/copilot/copilotAgent.ts:1087`). Its own gaps list unfinished relay reliability and load qualification (`MISSION_CONTROL_PRODUCTION_GAPS.md:29`).
- **GitHub's copilot-host** uses Azure Web PubSub too (RFC #138, citing the private `github/copilot-host#105`).

VS Code's reference numbers, all ✓ at the pin:

| Constant | Value | Cite |
|---|---|---|
| replay buffer | **1,000 envelopes, one ring for the whole host** | `AH/node/protocolServerHandler.ts:116`, `:3689-3691` |
| replay rule | replay if `lastSeenServerSeq >= oldestBuffered` and no requested channel still owes a baseline; else snapshots | `:1256-1262` |
| client tool disconnect, action-ack timeouts | 30 s each | `:118-120` |
| client ping / liveness verdict | 5 s after inbound silence / 20 s, then force-close and reconnect | `AH/browser/agentHostProtocolClient.ts:96,107` |
| relay keep-alive | host advertises 15 min; client pings every min(60 s, window/3) | `AH/node/missionControl/missionControlProtocolServer.ts:64,87` |
| Web PubSub chunk | 900 KiB, 4 chunk frames in flight | `AH/common/webPubSub/chunking.ts:24-51`; `missionControlProtocolServer.ts:67` |

INFER: with one global 1,000-envelope ring and one envelope per token delta, a reconnect after a few seconds of busy streaming on any session already falls back to snapshots, which is why snapshot size, not replay, decides reconnect cost. The ahp-acp-gateway keeps 10,000 (`src/gateway.ts:419-441`).

### 3.3 What a Durable Object relay between AHP client and host would have to do

Two shapes, both INFER.

**A. Transparent pipe (each browser is a logical AHP client of the daemon).** The DO multiplexes browser sockets over the daemon's uplink, tags frames by browser, and routes on `params.channel`. Cheap, and the daemon stays the only sequencer. But every open, reconnect and new viewer reaches the machine, nothing is readable while the machine is offline, and the daemon pays per-viewer fan-out over its uplink: the costs [rc-parity-research.ko.md §0.4](rc-parity-research.ko.md#L31) already flags.

**B. Caching proxy (the DO is a host to browsers and one client of the daemon).** This is what Remote-Control-grade open and reconnect needs, and AHP makes it unusually easy because the reducers are pure and published (`@microsoft/agent-host-protocol`): the DO subscribes upstream once per channel, keeps reduced state and a bounded tail of envelopes, and answers `initialize`, `subscribe` and `reconnect` itself. It must:
1. **Keep the daemon's `serverSeq`** unchanged, so a browser can move between pipe and proxy paths and the daemon remains the ordering authority.
2. **Re-map origins.** Upstream, the DO is one client; it must rewrite each browser's `dispatchAction {clientSeq}` to its own upstream `clientSeq` and restore `origin {clientId, clientSeq}` on the echo before fan-out, or write-ahead reconciliation breaks.
3. **Own the replay decision per browser**: a bounded tail per session in DO SQLite (by bytes), `replay` within it, `snapshot` beyond it, `missing` for gone channels; and **cap snapshots** itself (a tail of turns even on `reconnect`, large tool output as `ContentRef`), since the spec does not.
4. **Enforce a frame cap below every hop** (browser, Cloudflare, proxies) and fragment, using windowed delivery for subscription data and something like #138 for results and snapshots until AHP settles it.
5. **Bind `clientId` to the authenticated browser identity** at the edge; reject a `reconnect` whose `clientId` belongs to another member.
6. **Answer pings without waking the object**: if clients send a fixed-id ping (`{"jsonrpc":"2.0","id":"p","method":"ping","params":{"channel":"ahp-root://"}}`), `setWebSocketAutoResponse` can return the fixed result string (INFER; the DO matches exact strings).
7. **Re-list on reconnect**: protocol notifications are not replayed, so the DO must serve `listSessions` from its own catalogue.
8. **Survive DO restarts**: every deploy drops every socket; the DO rebuilds from SQLite or from the daemon with a snapshot subscribe ([remote-dev-prior-art.md §4.4](remote-dev-prior-art.md#L216)).
9. **Keep tokens off the wire**: Claude Code's credentials live on the machine, so the desk should never use `authenticate` for the agent, and must forbid MCP OAuth tokens in frames unless sealed (#268).

Shape B stores reduced session state in the hub. That collides with the desk's binding principle that the hub never stores transcripts ([maws-web-porting-surface.md §5](maws-web-porting-surface.md#L681)); an in-memory-only cache with SQLite holding only the bounded tail is the middle ground, and the choice is the owner's.

---

## 4. Maturity and risk

- **Cadence and churn** (FACT, `gh release list`; `ahp@1ef0642:CHANGELOG.md`): spec releases 0.2.0 (2026-05-28), 0.3.0, 0.4.0, 0.5.0, 0.5.1, 0.5.2, 0.6.0, 0.7.0, 0.8.0, 0.9.0 (2026-08-28), **1.0.0 (2026-10-02)**: about one every two weeks. Before 1.0 nearly every minor release removed or renamed something: input requests moved into response parts (0.6.0), session-level forking removed and `creationFailed` renamed `failed` (0.9.0), terminal content shapes replaced (0.7.0). 1.0.0 itself changed `FileEdit` SDK APIs. 1.1.0 is "Unreleased" but already has the mixed steering/queued list, which requires reducer, display and Rust struct changes (`docs/specification/chat-channel.md:412-420`).
- **Coupling to VS Code.** The contributors are mostly VS Code and GitHub staff (connor4312 345 commits, colbylwilliams 133, roblourens, rebornix, sandy081, lszomoru, DonJayamanne; `gh api …/contributors`). VS Code vendors the types by a sync script, **pinned to unreleased `main`** (`5d542f9`, 2026-10-15, nine commits behind the pin above) and carries VS Code-only deltas and backports on top (`vscode@c2f7817:src/vs/platform/agentHost/common/state/AGENTS.md:8,28-34`; `…/protocol/.ahp-version`). Changesets, canvases, automations, annotations, BYOK and Copilot-specific `_meta` keys track VS Code and Copilot product features. INFER: the spec will keep moving at VS Code's pace, and the releases lag the reference host.
- **No host SDK.** The SDKs are clients plus types and reducers; a host must reimplement dispatch, initialize/reconnect, replay buffering, subscriptions and reverse requests. VS Code's `ProtocolServerHandler` does it but is coupled to VS Code services ([#422](https://github.com/microsoft/agent-host-protocol/issues/422), open). `@ahpd/sdk` is a third-party alternative.
- **Who uses it beyond VS Code** (stars and creation dates on 2026-10-19): pi-ahp ★25 (2026-07-29), ahp-acp-gateway ★9 (2026-10-15), hydra-ahp ★0 (2026-10-05), ahpd ★3 and ahpc ★3 (2026-09-06), AHPX ★7, WeChat AHP ★11. The protocol repo: ★408, 144 forks, created 2026-03-12. GitHub's `copilot-host` is the one other substantial host (private, inferred from #138 and #507).
- **Open issues that bear on the desk**: #138 chunking; #492 fair delivery and bounded snapshots; #259 verified client identities; #268 sealed values through relays; #266 isolating privileged approvals; #426 status flicker while queued messages are pending; #507 session artifacts; #297 canvases; #422 server package; #281 client-executed terminals.

---

## 5. Verdict for #52

**Adopt AHP's mechanisms, not the protocol.**

Reasons, against the owner's goals:
1. **Remote-Control-grade latency and concurrency come from the mechanisms**, and AHP's are sound and close to what the prior-art sweep already recommended ([remote-dev-prior-art.md §7](remote-dev-prior-art.md#L291)). Take them verbatim: channel-URI routing on every message; `initialize` with initial subscriptions and snapshots; `reconnect {clientId, lastSeen…, subscriptions}` → `replay | snapshot | missing`; envelopes with a daemon-assigned `seq` and `origin {clientId, clientSeq}`; write-ahead reconciliation with server-wins and first-confirmation-wins; `inputNeeded` as a session-level roll-up for lists, badges and phones; `view.turns` + cursor paging for snapshots; `delivery.maxLatencyMs`; per-subscription windows with fragments and pausing producers.
2. **"MAWS's functionality on the web, as fully as possible" argues against AHP's vocabulary.** The renderer's seam is the three-method `MawsBridge` over X2 commands and X1 events ([maws-web-porting-surface.md §6](maws-web-porting-surface.md#L728)); AHP's display-ready, agent-agnostic model loses what MAWS renders, and half of MAWS sits outside it. Adopting AHP would mean the AHP envelope plus a large `x-` vocabulary: at that point the desk is using AHP's mechanisms anyway, while paying its churn.
3. **The protocol's maturity is below what a foundation needs**: 17 days at 1.0, VS Code tracking unreleased `main`, flow control experimental, chunking unsettled, no host SDK.
4. **The relay problems are the desk's to solve either way** (§3.3); AHP's spec does not solve frame caps, bounded reconnect snapshots, identity binding or token exposure, and Microsoft solved them beneath AHP in Mission Control.
5. **Running VS Code's agent host as the daemon is not a shortcut.** It routes model traffic through a Copilot proxy by default, is experimental for Claude, cannot run Claude over its own relay, drops the event classes MAWS renders, and knows nothing of MAWS's other services (§2).

Two numbers to carry over from VS Code regardless (§3.2): a 5 s ping after inbound silence with a 20 s verdict, and a replay ring sized well above its 1,000 global envelopes: per session, by bytes, in DO SQLite.

What to take as **shape**, not just mechanism: model the desk's session plane on AHP's chat state where Claude Code agrees with it (pending messages with `queued | steering`, input requests with drafted answers, the tool-call state machine with confirmation options, worker chats for subagents with `origin` and `interactivity`, `backgroundWork`, side chats, truncation, resumable errors). That keeps an **AHP facade** on the daemon thin: a translator from the desk's session plane to standard root/session/chat/terminal channels, so VS Code's agents UI, ahpc and the mobile SDKs can attach to a machine. Build it when interop becomes a goal.

**When the other choices win.**
- *Adopt AHP outright* becomes right if the web client is a new AHP-native session UI rather than MAWS's renderer, or if interop with VS Code and vscode.dev/agents becomes a product goal, and once 1.x stays non-breaking for a few releases.
- *Reference only* would be right if the desk kept SSE + POST and per-RPC done/failed semantics, which §7 of the prior-art note already argues against.

### What a desk-shaped AHP host (the facade, or a full adoption) would need beyond the spec

1. A host runtime: JSON-RPC dispatch, initialize/reconnect, replay buffer, subscription bookkeeping, reverse requests (#422), with a stated replay bound by bytes and age.
2. The Claude Code mapper (§1.2 and §2), modelled on VS Code's `claudeMapSessionEvents` and fixing its gaps: forward permission suggestions as "always allow" options; surface live compaction, status, retries and rate limits as system notifications; persist `result` usage so replay has it; join subagent `toolCallId` to `agentId` (the SDK gives no API for it); handle the ~5 MB pre-compaction replay cut; wire `stopTask`, `interrupt`, `getContextUsage`.
3. Decided conventions for what AHP leaves open: permission and plan mode as config properties; compaction, hooks, status and retries as system notifications with `_meta`; context, cost and rate limits in `_meta`; `x-` requests for dialogs and settings; an `x-` channel for the engine mod surface.
4. A single controller per Claude Code process (the bridge mod versus the SDK host race in [maws-web-porting-surface.md §5](maws-web-porting-surface.md#L681)): the host must own `can_use_tool` and the stdin queue.
5. Relay hardening: frame cap and fragmentation for results and snapshots; bounded `reconnect` snapshots; `clientId` bound to member identity; no cleartext tokens; machine policy on `!`, permission-mode escalation and bypass ([rc-parity-research.ko.md §3.2](rc-parity-research.ko.md#L213)).
6. Liveness: a ping cadence and death verdict on every hop (the spec leaves both open), and a reconnect classifier that retries for the whole grace window.
7. Idempotent resend for `chat/turnStarted` keyed by `turnId`, since `dispatchAction` has no receipt and reconnect clears pending actions.
8. A multi-machine namespace above `MultiHostClient`: session ids qualified by machine, one `serverSeq` per daemon.
9. A version policy: pin a spec release, advertise a range, and gate the experimental channels (windowed delivery, canvas, TCP) behind capabilities.
