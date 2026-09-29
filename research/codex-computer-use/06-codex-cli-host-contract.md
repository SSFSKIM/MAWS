# 06: What computer use requires of its MCP host (Codex CLI 0.158.0-alpha.2.1)

> **Correction (2026-09-28, wave 2).** `js` is annotated `readOnlyHint:true` (open question 3), and H3 is moot in practice: the `js` description is 1,511 characters and the API documentation arrives in the first tool result. Bare `elicitation:{}` (H7) is verified live to receive app approvals. See `README.md` §9 and `spikes/computer-use-probe/findings.md` §2.

Researcher 6 of 6. Layer: the Codex CLI (`codex app-server`) as the MCP host of the `cua_repl` plugin server.
Date: 2026-09-28. Purpose: state the contract any other harness (Claude Code first) would have to meet to host OpenAI's
computer-use stack, so MAWS can decide whether a Claude Code agent can reuse the native controller.

**Source pin.** `https://github.com/openai/codex` tag `rust-v0.158.0-alpha.2.1` (commit `0d9c7cbfa6cf`, 2026-09-25), shallow
clone at `~/codex-app-src/codex-src-0.158/`. `codex-rs/Cargo.toml:158` reads `version = "0.158.0-alpha.2.1"`, and the shipped
`codex-package.json` and `codex --version` both report `0.158.0-alpha.2.1`. The source tag and the installed build match exactly.

**Method.** I read the source statically and ran `strings` on the shipped `codex` and `node_repl` binaries
(`/tmp/codex_strings_0158.txt`, `/tmp/node_repl_strings.txt`). Nothing under `/Applications`, `~/.codex` or `~/Library` was
modified. One deviation from the brief: I ran `codex --version` once to confirm the build. It prints a version and exits; no
app-server or MCP server started. The Claude Code column is drawn from the local reverse-engineered spec of
the pinned version (`~/claude-code-bundle/2.1.283/SPEC/`, source `cli.pretty.js`). A subagent read those chapters, and I
spot-checked six load-bearing claims directly in `cli.pretty.js` (marked "spot-checked").

**Citations.** Codex paths are relative to `~/codex-app-src/codex-src-0.158/codex-rs/`. `rmcp` means the crate
`rmcp-3.2.0` in `~/.cargo/registry/src/index.crates.io-*/` (pinned `=3.2.0` at `Cargo.toml:441`). `CC` means Claude Code
2.1.283; `CC L<n>` is a line in `cli.pretty.js`; `CC SPEC <ch> §<n>` is a spec chapter section.
**Verified** = read in source, a shipped file, or a shipped binary. **Inferred** = reasoned from strong evidence, not
observed end to end. **Verified-from-spec** = Claude Code behavior read from its spec/source, not run.

---

## 0. Load-bearing findings

1. **`js` reaches the model as an ordinary, directly listed function tool.** It sits in a Responses-API namespace
   `mcp__cua_repl__` and is neither a Code Mode tool nor deferred behind tool search. That is what
   `omit_tools_from: ["code_mode","deferred"]` buys. `features.code_mode_host` only selects the standalone
   `codex-code-mode-host` process for the model's own `exec` tool; it is default-on and incidental to computer use. (Verified, §3)
2. **Screenshots arrive as `input_image` items inside the `function_call_output`, in the server's order.**
   - Images are never counted against `output_token_limit`, which trims only text.
   - They are resized at history time to at most 2048 px and 2,500 patches of 32×32 ("high"), or up to 6000 px and 10,000
     patches when the server tags `_meta["codex/imageDetail"]:"original"` and the model supports it.
   - A non-null `structuredContent` replaces the content array entirely, which drops the images. (Verified, §2)
3. **The server's "Run JavaScript" elicitation is normally answered by Codex, not by a person.**
   - When the reviewer is the user, Codex auto-accepts node_repl's empty-schema `js` elicitation unless it carries
     `codex_sensitive_action` or `codex_requires_user_input`.
   - With `codex_strict_auto_review:true` and the auto-review (Guardian) reviewer, Codex runs a synchronous Guardian
     review, and anything but an auto-review verdict is converted to a decline.
   - Only unresolved elicitations reach the Electron UI, as the app-server request `mcpServer/elicitation/request`. (Verified, §4)
4. **Every `tools/call` carries a rich `_meta`.** It includes `callId`, `threadId`, `sessionId`, `windowId`, `itemId`,
   `x-codex-turn-metadata` (turn id, model, `node_repl_disabled`, `node_repl_auto_review_required`, ...),
   `openai/confirmation_policies`, `codex/sandbox-state-meta` (permission profile and sandbox cwd), `progressToken` and
   `traceparent`. `node_repl` references most of these keys. (Verified host side, §5; consumer side Inferred from `strings`)
5. **Turn cleanup rides on hooks, not MCP cancellation.**
   - An interrupt aborts the tool task and drops the pending `tools/call` future.
   - Codex's default "legacy" MCP mode sends **no** `notifications/cancelled`; rmcp 3.2.0 `RequestHandle` has no `Drop`
     cancel.
   - Instead, allowlisted plugin hooks of `type:"mcp_tool"` call the model-hidden `cua_repl.turn_ended` tool:
     - on **Stop** and **SubagentStop**: awaited, 600 s default timeout;
     - on **Interrupt**: awaited, 1 s default, 3 s cap; not fired for subagent threads. (Verified, §6)
6. **Codex does not sandbox plugin MCP servers.**
   - `cua_repl` is spawned directly as a child of `codex app-server`, in its own process group, with an allowlisted
     environment plus the plugin's `env`.
   - `node_repl` appears to sandbox its *Node kernel* itself via `CODEX_CLI_PATH` (`codex sandbox macos --allow-unix-socket`),
     driven by the `codex/sandbox-state-meta` the host passes. (Launch Verified; self-sandbox Inferred, §7)
7. **The shipped plugin manifest is a stub; the Electron main process materializes it.** The bundle's `.mcp.json` has
   `command:"node"` and `enabled:false`. Electron rewrites command, args and env into the staged marketplace
   `~/.codex/.tmp/bundled-marketplaces/openai-bundled/`, and the CLI's plugin install then copies it verbatim into
   `~/.codex/plugins/cache/`. (Verified, §7)
8. **`node_repl` probably depends on a Codex CLI binary even outside Codex.** Its strings show it starting `codex app-server`
   through `CODEX_CLI_PATH` (clientInfo "Codex Browser Use") for `config/read`, `configRequirements/read`,
   `config/value/write` and `getAuthStatus`. A foreign host may therefore still need a Codex CLI on disk. (Inferred, §8;
   handed to the node_repl researcher)
9. **Claude Code 2.1.283 meets most of the contract natively.** It supports stdio servers outside the sandbox, form
   elicitation, image results, `mcp_tool` hooks, plugin-bundled servers plus hooks, and `notifications/cancelled` on abort.
   It is missing or weaker on four points:
   - it forwards none of Codex's `_meta` on `tools/call` and drops Codex's elicitation `_meta`;
   - it has no hook that fires on a main-thread interrupt;
   - it truncates tool descriptions and server instructions at 2048 characters;
   - it defers MCP tools behind ToolSearch by default.

   All have workarounds (§1, §9) except the missing `_meta`, which only matters as far as `node_repl` requires it. That
   requirement is the biggest open question.

---

## 1. Harness contract

Each row is one behavior the computer-use stack gets from its host.
- **Ess/Inc**: whether computer use needs the behavior to work (Essential), or it only shapes quality, UX or cost (Incidental).
- **Host without it**: what a host lacking the behavior would see (hard failure, degraded function, or nothing).
- The Claude Code column is Verified-from-spec unless it says otherwise.

| # | Behavior the stack needs from its host | Codex 0.158 evidence | Ess/Inc | Host without it | Claude Code 2.1.283 |
|---|---|---|---|---|---|
| H1 | Spawn the stdio server with its exact `env`, tolerate a slow start (plugin sets 120 s), run it **outside** any sandbox | `rmcp-client/src/stdio_server_launcher.rs:267-300` (direct `Command`, `ProcessMode::NewGroup`, `StdioOnly` fds); env = allowlist + `env_vars` + `env`, `rmcp-client/src/utils.rs:16-58,162-176`; `startup_timeout_sec` `config/src/mcp_types.rs:256`, default 30 s `codex-mcp/src/rmcp_client.rs:103` | Essential | Hard failure: `cua-repl.mjs` throws without `CUA_REPL_NODE_REPL_PATH` / `CUA_REPL_ENABLED_SURFACES`. A sandboxed server could not reach the native service socket (Inferred) | **Yes, with a tweak.** stdio servers are spawned directly, outside seatbelt (CC L841402-841407). `env` supports `${VAR}` expansion (CC L872014-872035). No per-server startup timeout: set `MCP_TIMEOUT=120000` (global, default 30 s). No `cwd` field |
| H2 | List `js` (and `js_reset`) **directly** in the model's tool list, not behind tool search | `omit_tools_from` gives `ToolExposure::DirectModelOnly`, `core/src/tools/spec_plan.rs:189-269`; surfaces enum `protocol/src/config_types.rs:396-407` | Essential (quality) | Degraded: the model must discover `js` through search first, and its long description would not sit in the prompt | **Needs config.** MCP tools are deferred behind ToolSearch by default. Fix per server with `alwaysLoad: true`, or per tool with `_meta["anthropic/alwaysLoad"]` (CC SPEC 31 §11.3, §11.6) |
| H3 | Put the server's `instructions` and the long `js` description in front of the model intact | server instructions become the namespace description, capped at 512 KiB: `codex-mcp/src/rmcp_client.rs:816-851`, `core/src/tools/handlers/mcp.rs:49,488-509` | Essential (quality) | Degraded: truncated operating instructions (surfaces, `nodeRepl.emitImage`, safety rules) | **Degraded by default.** Descriptions and instructions are cut at 2048 chars unless `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` is raised (CC SPEC 31 §11.4, §17.1) |
| H4 | Turn MCP `image` blocks into model image input, keep block order, and never drop images for size | `protocol/src/models.rs:2301-2431` (`image` → `InputImage`, `data:` URL, detail from `_meta["codex/imageDetail"]`, default `high` `:935`); truncation keeps every image `utils/output-truncation/src/lib.rs:115-199`; resize `core/src/image_preparation.rs:211-395`, `utils/image/src/lib.rs:73-83` | Essential | Hard failure for computer use: the model cannot see the screen | **Yes, with caveats.** Images resized to ≤2000×2000 and ≤5 MiB, and recompressed to JPEG above 512 KB. A downscaled image gets a text note giving the coordinate multiplier (CC L843010-843053, L662623-662640; SPEC 12 §12.11.3). Order preserved (CC L843115-843117). Unlike Codex, images **count** against the budget (1,600 tokens each), and a text block that crosses `MAX_MCP_OUTPUT_TOKENS` ends the walk, so later images are lost (CC L985113-985150) |
| H5 | Trim text to the per-tool budget (`js.output_token_limit: 25000`), leaving images alone | policy from `McpServerToolConfig.output_token_limit` `config/src/mcp_types.rs:83-99`, used at `core/src/tools/handlers/mcp.rs:229-234`; ×1.2 allowance `utils/output-truncation/src/lib.rs:16-18`; applied `core/src/tools/context.rs:184-215` | Incidental | Nothing or degraded: bigger or smaller text payloads | **Yes, differently.** Global `MAX_MCP_OUTPUT_TOKENS` defaults to 25,000 (CC L985052-985061); there is no per-tool knob |
| H6 | Handle `structuredContent` so images survive | Codex: a non-null `structuredContent` **replaces** the content array with its JSON text, dropping images (`protocol/src/models.rs:2313-2332`) | Incidental (server-side discipline) | Degraded if the server ever sets it on an image result | **Different.** Text blocks are dropped; non-text blocks are kept, followed by the JSON (CC L843102-843113, spot-checked). Same rule for the server: don't set it |
| H7 | Advertise and serve MCP **form elicitation** during an in-flight `tools/call` | capability `core/src/config/mod.rs:1844-1853` (`{}`, or form+url when `AuthElicitation` is on); handler `rmcp-client/src/elicitation_client_service.rs:136-235`; router `codex-mcp/src/elicitation.rs:269-539` | Essential | Probably hard failure: node_repl gates each `js` run on an approval elicitation, and its strings include "JavaScript execution requires an approval elicitation" and "JavaScript execution did not receive approval" (Inferred) | **Yes, form mode.** Bare `elicitation:{}` on stdio (CC L872196-872223). Interactive: a dialog. Headless stream-json: a `control_request` with subtype `elicitation`, and the host answers `{action, content}` (CC L723709-723770). A missing `requestedSchema` is rejected (CC L411406) |
| H8 | Resolve routine "Run JavaScript" approvals by **policy**, so the user is not asked once per cell | user-reviewer and full-access auto-accept `core/src/session/mcp.rs:749-786`; strict Guardian path `codex-mcp/src/elicitation.rs:365-413` + `core/src/session/mcp.rs:814-890`; Never plus full access auto-accepts `codex-mcp/src/elicitation.rs:415-426` | Incidental to function, essential to UX | Degraded UX: a prompt before every `js` cell | **Partial.** No `_meta`-aware policy. An `Elicitation` hook can auto-answer, but hook input carries no `_meta` (CC L917332-917344), so it must key on server name and message. MAWS, which drives the SDK wire, can answer the `control_request` itself |
| H9 | Carry elicitation `_meta` both ways: request keys (`codex_request_type`, `codex_approval_kind`, `codex_strict_auto_review`, `codex_sensitive_action`, `codex_requires_user_input`, `tool_name`/`tool_params`/`connector_*`, `callId`) and response `_meta` (`persist: session\|always`, `approvals_reviewer`) | keys `protocol/src/mcp_approval_meta.rs:4-31`; request meta lifted from the JSON-RPC `_meta` `rmcp-client/src/elicitation_client_service.rs:373-399`; response `_meta` returned to the server `:425-450`; UI payload keeps `_meta` `app-server-protocol/src/protocol/v2/mcp.rs:776-903` | Incidental (approval fidelity) | Degraded: no remember-for-session/always, no auto-review attribution, no strict-review gate | **No.** Only `_meta["anthropic/permissionDisplay"]` is read; the rest is dropped (CC L723683-723689). The response is `{action, content}` only |
| H10 | Keep human approval time out of the tool-call timeout | `active_time_timeout` pauses while an elicitation is pending, `rmcp-client/src/rmcp_client.rs:234-285, 1464-1478`; tool timeout default 300 s `codex-mcp/src/rmcp_client.rs:104` | Incidental | Degraded: a slow approval can time out the `js` call | **Yes.** The idle watchdog pauses during an elicitation. The hard tool timeout defaults to 1e8 ms (CC L840574-840587) |
| H11 | Send per-turn identity in `tools/call._meta`: `x-codex-turn-metadata` (with `turn_id`, `session_id`, `thread_id`, `model`, `node_repl_disabled`, `node_repl_auto_review_required`), `callId`, `threadId`, `sessionId`, `windowId`, `itemId` | built at `core/src/mcp_tool_call.rs:515-532, 1309-1359, 1393-1425`; turn metadata `core/src/turn_metadata.rs:271-301, 407-457`; payload fields `core/src/responses_metadata.rs:533-592` | **Unknown, likely Essential** | Unknown. `node_repl` parses `x-codex-turn-metadata` into `NodeReplTurnMetadata{model, node_repl_auto_review_required, node_repl_disabled}` and has `NODE_REPL_ENFORCE_MODEL_CHECK`, so a missing header could mean refusal or defaults (Inferred; experiment E4) | **No.** Only `{"claudecode/toolUseId"}` plus `progressToken` (CC L842425, L434694; spot-checked). Session id is available only as the spawn-time env `CLAUDE_CODE_SESSION_ID` (CC L841405) |
| H12 | Pass sandbox state (`codex/sandbox-state-meta`: `permissionProfile`, `sandboxCwd`, `useLegacyLandlock`) when the server advertises the capability | `core/src/mcp_tool_call.rs:837-888`; capability detection `codex-mcp/src/rmcp_client.rs:981-987`; struct `codex-mcp/src/runtime.rs:771-779` | Unknown | Unknown: node_repl may fall back to a default kernel sandbox policy (it has the strings "the node_repl sandbox with denied paths cannot be disabled", `macos_sandbox_failed`) (Inferred) | **No** |
| H13 | Send the model's confirmation policies (`openai/confirmation_policies: {browser_use, computer_use}`) | `core/src/mcp_tool_call.rs:1361-1391` (only for `node_repl`/`cua_repl`, empty object when none) | Incidental | Nothing observable. `node_repl` does not contain the key (`strings` count 0); probably consumed deeper in JS (Inferred) | **No** |
| H14 | Call the hidden `turn_ended` tool when a turn **completes** (Stop / SubagentStop) with `{hook_event_name, session_id, turn_id}` | plugin hooks `plugin.json`; allowlist `plugin/src/bundled_hooks.rs:89-100`; template expansion `hooks/src/engine/mcp_runner.rs:102-166`; executor `core/src/hook_mcp_executor.rs:18-55`; Stop runner `core/src/hook_runtime.rs:392-468`, called at `core/src/session/turn.rs:640-647` | Essential (cleanup) | Degraded: per-turn state is never released on the turn boundary. What that state is (overlay, locks, app-control sessions) is the node_repl researcher's question | **Yes.** `mcp_tool` hooks exist, are awaited, default 600 s (CC L917082-917150, spot-checked). Stop, SubagentStop, and StopFailure (fires in place of Stop when an API error ends the turn). In a plugin the server name is `plugin:<plugin>:<server>` |
| H15 | Signal an **interrupted** turn quickly (Codex: Interrupt hook, 1 s budget) | `core/src/tasks/mod.rs:911-965` (abort, then `run_turn_interrupt_hooks`); `core/src/hook_runtime.rs:502-540`; 1 s default / 3 s cap `hooks/src/engine/discovery.rs:740-763`, `hooks/src/events/session_end.rs:20,23` | Essential (cleanup) | Degraded: an interrupted cell's side effects keep running until the next turn or a timeout | **Gap, partly covered.** No hook fires on a main-thread interrupt; aborted turns return early without Stop (CC L810488-810498, spot-checked). But CC sends `notifications/cancelled` for the in-flight call (row H16). Backup: a `UserPromptSubmit` `mcp_tool` hook calls `turn_ended` for the previous turn |
| H16 | Cancel an in-flight `tools/call` on interrupt | **Codex does not.** Legacy mode (default, `features/src/lib.rs:1365-1370`) uses `send_request_with_option(...).await_response()` (`rmcp-client/src/rmcp_client.rs:862-890`); the dispatch task is aborted (`core/src/tools/parallel.rs:234-265`); rmcp `RequestHandle` has no `Drop` cancel (`rmcp src/service.rs:536-680`) | Incidental under Codex (it relies on H15) | Nothing. `node_repl` does contain `notifications/cancelled` handling strings (Inferred) | **Yes, better than Codex.** An aborted call sends `notifications/cancelled {requestId, reason}` (CC L843362-843366, L434694-434699, spot-checked). Caveat: interactive calls auto-background after 120 s and then ignore interrupts (CC L836082-836093) |
| H17 | Hide `turn_ended` from the model but keep it callable by the host | model visibility filter `codex-mcp/src/connection_manager/tool_catalog.rs:36-59`, `codex-mcp/src/binding.rs:93-98`, `core/src/mcp_tool_exposure.rs:150-155`; hook calls go through the connection, where only `enabled_tools` applies (`codex-mcp/src/connection_manager.rs:944-1006`). `node_repl` marks it ("turn-ended tool metadata", `visibility`) | Incidental | Nothing harmful: the model could see a no-op tool | **Yes.** Tools whose `_meta.ui.visibility` omits `"model"` are hidden but still callable by an `mcp_tool` hook (CC L694366-694377, L842318) |
| H18 | Keep the host's own pre-call approval of `js` quiet (no double prompt next to the server's elicitation) | Codex's own MCP tool approval `core/src/mcp_tool_call.rs:1470-1581`; with no `default_tools_approval_mode` in the plugin, `Auto` mode prompts unless `readOnlyHint` (`:2436-2467`). Codex's node_repl tests use `readOnlyHint:true` + `approve` (`core/tests/suite/guardian_mcp_elicitation.rs:52-57,113`) | Incidental (UX) | Degraded UX: double prompts | **Needs config.** Normal permission rules; allow `mcp__<server>__js` (or the plugin-qualified name) in settings, or answer `can_use_tool` in the SDK (CC SPEC 45) |
| H19 | Give the server a reachable Codex CLI (`CODEX_CLI_PATH`) for config/auth reads and kernel sandboxing | Not a host feature. `node_repl` strings: "codex app-server stdout is unavailable", `config/read`, `configRequirements/read`, `getAuthStatus`, clientInfo "codex-browser-use", "Start the Node kernel directly even when CODEX_CLI_PATH is set" | Unknown | Unknown: possibly degraded (no managed `computer_use` allow/deny policies, no auth, unsandboxed kernel), possibly refusal (Inferred) | Not applicable; a foreign host would ship a Codex CLI path in `env` |
| H20 | Present tool output with a wall-time header and success flag | `core/src/tools/context.rs:184-215` ("Wall time: … seconds\nOutput:" prepended) | Incidental | Nothing | Not applicable |

---

## 2. Q1: MCP tool results to model input

**Conversion.** `CallToolResult::as_function_call_output_payload` (`protocol/src/models.rs:2301-2336`) maps each MCP content
block in order (`convert_mcp_content_to_items`, `:2339-2431`). (Verified)

| MCP block | Model item | Detail |
|---|---|---|
| `text` | `input_text` | If `_meta["codex/encryptedContent"]:true`, becomes `encrypted_content` instead |
| `image` | `input_image` with an inline `data:` URL | `data` is used as-is if it already starts with `data:`; otherwise `data:{mimeType};base64,{data}`, with mime defaulting to `application/octet-stream`. `detail` comes from `_meta["codex/imageDetail"]` ∈ {auto, low, high, original}, default `high` (`DEFAULT_IMAGE_DETAIL`, `:935`) |
| `audio` | `input_audio` (data URL) | |
| `resource`, `resource_link`, anything else | `input_text` holding the raw JSON of the block | |

- **`structuredContent`.** If it is present and non-null, and no block is encrypted, the whole output becomes one text item
  holding the serialized `structuredContent`; content items, including images, are discarded (`:2313-2332`). (Verified)
- **Modality gate.** If the model lacks image or audio input, those blocks become
  `"<image content omitted because you do not support image input>"` and the audio equivalent
  (`core/src/mcp_tool_call.rs:926-963`). (Verified)
- **Wrapper.** `McpToolOutput::response_payload` (`core/src/tools/context.rs:184-215`) does three things:
  - demotes `original` detail to `high` when the model cannot request original detail
    (`tools/src/image_detail.rs:23-39`);
  - prepends a `"Wall time: {s} seconds\nOutput:"` text item;
  - applies truncation.

  It is emitted as a `function_call_output` (`:157-162`). (Verified)

**`output_token_limit` truncation.**
- The per-tool value from the plugin's `tools.js.output_token_limit` (`config/src/mcp_types.rs:83-99`) becomes
  `TruncationPolicy::Tokens(25000)` (`core/src/tools/handlers/mcp.rs:229-234`). Without it, the model's default truncation
  policy applies.
- A 20% serialization allowance is added, so the effective budget is 30,000 tokens (`utils/output-truncation/src/lib.rs:16-18`).
- Tokens are approximated as bytes/4 (`utils/string/src/truncate.rs:4,71-74`), so roughly 120 KB of text.
- `truncate_function_output_items_with_policy` (`utils/output-truncation/src/lib.rs:115-199`) walks items in order:
  - **Text** consumes the budget. The item that crosses the limit is middle-truncated, and later text items are counted
    and replaced by one trailing `[omitted N text items ...]`.
  - **Images** are always kept at their original position and cost nothing.
  - **Audio** costs its estimated tokens and is dropped if over budget.

  Text/image ordering is therefore preserved exactly. (Verified)

**Image sizing** happens when the output is recorded into history, not at truncation time
(`Session::prepare_conversation_items_for_history`, `core/src/session/mod.rs:3420-3451` →
`core/src/image_preparation.rs:211-243,358-395`). (Verified)

| Mode | When | Limits |
|---|---|---|
| Detail-based | default | `high`/`auto`/none → `PromptImageMode::HIGH_DETAIL`: max dimension 2048 and ≤2,500 patches of 32 px (for example 2048×2048 → 1600×1600). `original` → `ORIGINAL_DETAIL`: 6000 px / 10,000 patches. `low` is rejected: the image is replaced by the placeholder "image content omitted because detail 'low' is not supported" (`utils/image/src/lib.rs:24-83`, `core/src/image_preparation.rs:31-37,368-383`) |
| Unified budget | feature `UnifiedImageBudget` on and a model supporting original detail or Responses Lite | every image goes to original detail (`core/src/image_preparation.rs:44-51`) |

- Remote `http(s)` image URLs are refused with a placeholder.
- The image may be uploaded to an attachment store and replaced by a `file_id` (`:329-346`).
- An optional `ImageResizeNotice` (feature `ImageResizeNotice`) tells the model an image was resized. (Verified)

**Two copies of the same result.**
- The model sees the full result, subject to the above.
- The UI and rollout copy of the `McpToolCall` item (sent to app-server clients as `item/completed`) is collapsed to a text
  preview when its serialized JSON exceeds 1 MiB (`core/src/mcp_tool_call.rs:965-1007`; cap `utils/pty/src/lib.rs:22`). A
  large screenshot therefore stays visible to the model but can vanish from the UI's copy of the item. (Verified)

**Audio.** Supported end to end when the model advertises audio input (`InputModality::Audio`). `node_repl` has
`nodeRepl.emitAudio` and `NODE_REPL_ENABLE_AUDIO` (strings). (Verified host side; Inferred server side)

---

## 3. Q2: Tool exposure

- **`enabled_tools` / `disabled_tools`** build a `ToolFilter` (`codex-mcp/src/tools.rs:63-103`). The filter applies both to
  the model's tool catalog and to *every* direct call, including hook calls (`codex-mcp/src/connection_manager.rs:964-968`).
  That is why the hook-only `turn_ended` must appear in `enabled_tools`. (Verified)
- **`omit_tools_from`** lists surfaces to remove the server's tools from. The surfaces are `ToolExposureSurface`:
  - `direct`: the initial tool list;
  - `deferred`: discovered later through `tool_search`;
  - `code_mode`: nested tools callable from Code Mode JavaScript as `tools.mcp__…(…)`

  (`protocol/src/config_types.rs:396-407`; field `config/src/mcp_types.rs:244`).
- `apply_mcp_tool_exposure_policy` (`core/src/tools/spec_plan.rs:189-269`) turns this into a `ToolExposure`.
  - Normally, when the model supports tool search, MCP tools are made **deferred**; the "always defer MCP tools" flag is now
    unconditional, `features/src/lib.rs:233-234`.
  - Omitting `deferred` and `code_mode` leaves exposure `{direct}` = `ToolExposure::DirectModelOnly`: present in the
    initial tool list, never searched, never nested in Code Mode. (Verified)
- **Model-facing shape.** Each MCP tool is a `ToolSpec::Namespace` named with the callable namespace (`mcp__cua_repl__`),
  whose description is the server's `initialize.instructions` (≤512 KiB) and which contains one `function` tool `js`
  (`core/src/tools/handlers/mcp.rs:478-510`; `codex-mcp/src/rmcp_client.rs:816-851`). Namespaces merge, so `js` and
  `js_reset` share `mcp__cua_repl__`. The hook name is `mcp__cua_repl__js`.
  - Answer to the brief: **`js` appears as a normal function tool inside a namespace; it is not a Code Mode tool and not
    deferred.** (Verified)
- **Visibility.** Tools whose `_meta.ui.visibility` lacks `"model"` are excluded from the model's catalog and from
  model-initiated calls (`codex-mcp/src/connection_manager/tool_catalog.rs:36-59`, `codex-mcp/src/binding.rs:93-98`).
  `node_repl` defines `turn_ended` with visibility metadata ("turn-ended tool metadata"), so the model never sees it.
  (Host Verified; server Inferred from `strings`)
- **`features.code_mode_host=true`** is a Stable feature, `default_enabled: true` (`features/src/lib.rs:1067-1072`).
  - It makes the thread manager use `ProcessOwnedCodeModeSessionProvider`, which runs Code Mode in the standalone
    `codex-code-mode-host` binary rather than disabling it (`core/src/thread_manager.rs:550-557`). That binary ships at
    `codex-cli/bin/codex-code-mode-host`.
  - Code Mode is the model's `exec`/`wait` JavaScript tool (`code-mode-protocol/src/lib.rs:51-52`).
  - The Desktop flag only pins the default. Because `cua_repl` omits `code_mode`, it is **incidental** to computer use.
    (Verified)
- **Parallel calls.** Codex runs an MCP tool in parallel only if it has `readOnlyHint` or the server sets
  `supports_parallel_tool_calls` (`core/src/tools/handlers/mcp.rs:128-139`). (Verified)

---

## 4. Q3: Elicitation

### 4.1 Wire path

1. **Server to host.** node_repl sends `elicitation/create` (or `openai/elicitation/create`) while its `tools/call` is
   pending. rmcp lifts the JSON-RPC `_meta` into the request context, and Codex merges it back into the elicitation `_meta`,
   dropping `progressToken` (`rmcp-client/src/elicitation_client_service.rs:136-189,373-399`). (Verified)
2. **Policy router.** `ElicitationRequestManager::make_sender` (`codex-mcp/src/elicitation.rs:269-539`) decides. Two
   short-circuits come first: `auto_deny` (an Xcode 26.4 client-compat switch,
   `app-server/src/request_processors/turn_processor.rs:1007,1689`) declines, and a `codex_approval_kind: "tool_suggestion"`
   request is declined. Then:
   - **`codex_strict_auto_review: true`** (`:365-413`). Declined if the approval policy is granular without MCP
     elicitations, or if there is no reviewer. Otherwise the reviewer must return `Accept` with `content == {}`, or a
     `Decline`/`Cancel` with no content, **and** `_meta.approvals_reviewer == "auto_review"`. Anything else becomes a decline
     with the message "Automated review of this operation failed. Do not proceed without asking the user for explicit
     approval." A non-bool value is also declined.
   - **Auto-accept.** Approval policy `never` plus unrestricted permissions (disabled, external, or full-disk-write), with
     an empty-`properties` form, is accepted with `{}` (`:415-426`, rule at `codex-mcp/src/mcp/mod.rs:91-110`).
   - **Policy decline.** Policy `never`, or granular without MCP elicitations, declines (`:451-458`, `:552-559`).
   - **Reviewer.** Otherwise the session's `GuardianMcpElicitationReviewer` is asked (`:460-469`). If it returns `None`, the
     request is relayed to the UI (`:472-535`).
3. **Session reviewer.** `review_guardian_mcp_elicitation`, `core/src/session/mcp.rs:734-996`. (Verified)
   - **User CUA fast path** (`:749-786`). The session auto-accepts, with `approvals_reviewer: auto_review` meta, when all of
     these hold:
     - `approvals_reviewer == User`;
     - the server is `node_repl` or `cua_repl`;
     - `_meta.tool_name == "js"`, `_meta.connector_id == "node_repl"` and `codex_approval_kind == "mcp_tool_call"`;
     - `codex_sensitive_action` and `codex_requires_user_input` are not true;
     - the form has an empty schema.

     Full-access turns take the same path. The code comment reads "User approval skips ordinary CUA checks, not separate
     sensitive requests." **In the default user-review mode, a plain "Run JavaScript" elicitation is never shown to a
     person.**
   - **Strict path** (`:814-890`). Requires feature `GuardianApproval`, a requirements layer that allows the `AutoReview`
     reviewer, the per-server/connector reviewer resolving to `AutoReview`, and no `persist` key. It then builds a Guardian
     `McpToolCall` review from `_meta.tool_name` / `tool_params` / `connector_*` / `tool_title`, correlated to the enclosing
     `js` call through `_meta.callId` (`:788-803`).
   - **Non-strict path** (`:891-966`). A request qualifies for review only with `codex_request_type == "approval_request"`,
     `codex_approval_kind == "mcp_tool_call"`, an empty schema and a non-empty `tool_name` (`:998-1091`). Otherwise
     `NotRequested`, meaning it goes to the UI.
     - `codex_sensitive_action: true` forces a synchronous review (`:805-811`).
     - The decision goes through the Guardian extension (`core/src/guardian/decision.rs:45-131`). Whether that returns
       `None` for a user reviewer, and so falls through to the UI, is decided inside `codex_guardian_reviewer`, which I did
       not read. (Inferred)
   - **Mapping a Guardian decision to a response** (`:1150-1202`). Approved → `accept {}` with
     `_meta.approvals_reviewer = "auto_review"`. Denied or timed out → `decline` with `_meta.message`. Abort → `cancel`.
4. **Relay to app-server clients.** A core `EventMsg::ElicitationRequest` has public id `codex-mcp-elicitation-N`
   (`codex-mcp/src/elicitation.rs:159-219`). The app-server turns it into the server-to-client JSON-RPC request
   **`mcpServer/elicitation/request`** (`app-server-protocol/src/protocol/common.rs:1784-1786`;
   `app-server/src/bespoke_event_handling.rs:872-936`). Its params (`app-server-protocol/src/protocol/v2/mcp.rs:409-423,776-828`):

   ```json
   {"method":"mcpServer/elicitation/request","id":9,
    "params":{"threadId":"…","turnId":"…|null","serverName":"cua_repl",
              "mode":"form","_meta":{…server meta verbatim…},
              "message":"…","requestedSchema":{"type":"object","properties":{}}}}
   ```

   Other `mode` values: `url` (plus `url`, `elicitationId`), `openai/form`, `openaiForm`, and the experimental
   `openai/userVerification`. `turnId` falls back to the thread's active turn when core did not attach one
   (`bespoke_event_handling.rs:880-886`). A schema that fails to parse is auto-cancelled (`:888-910`). (Verified)
5. **Answer.** The client replies `{action: "accept"|"decline"|"cancel", content, _meta}` (`v2/mcp.rs:890-903`). The
   app-server submits `Op::ResolveElicitation`; a malformed reply becomes `decline`, and a turn-transition error becomes
   `cancel` (`bespoke_event_handling.rs:1735-1780`). Core routes it to the pending responder (`core/src/session/mcp.rs:628-655`).
   rmcp returns `{action, content, _meta}` to the server, keeping response `_meta` such as `{"persist":"always"}`
   (`rmcp-client/src/elicitation_client_service.rs:400-450`). (Verified)
6. **Timeout interplay.** While any elicitation is pending on a connection, the tool-call timeout clock pauses
   (`rmcp-client/src/rmcp_client.rs:234-285`). If the server cancels the elicitation request itself, Codex answers `cancel`
   (`elicitation_client_service.rs:162-171`). (Verified)

### 4.2 The other approval: Codex's own MCP-tool approval of `js`

This is separate from the server's elicitation. Before sending `tools/call`, Codex may ask for approval of the MCP call
itself (`core/src/mcp_tool_call.rs:1470-1581`). Under the default `AppToolApproval::Auto`
(`config/src/mcp_types.rs:25-33`), approval is required unless `readOnlyHint` is true or `destructiveHint`/`openWorldHint`
are explicitly false (`:2436-2467`). It is skipped when policy `never` plus unrestricted permissions auto-approve, or when
the mode is `approve`.
- The plugin sets no `default_tools_approval_mode`, so whether the Desktop shows a Codex-level "Allow the cua_repl MCP
  server to run tool js?" depends on node_repl's `js` annotations, which I could not read from `strings`.
- Codex's own node_repl fixtures model the server with `readOnlyHint: true` and `default_tools_approval_mode = "approve"`
  (`core/tests/suite/guardian_mcp_elicitation.rs:30-57,113`), which suggests the intended design: no host prompt, with
  approval living in the server's elicitation. (Inferred; experiment E3)
- When that host approval does run with feature `ToolCallMcpElicitation`, Codex sends *itself* an elicitation-shaped
  request with `codex_approval_kind: mcp_tool_call`, `persist`, `tool_title`, `tool_params` and `tool_params_display`
  (`:1950-2081`). This is the same UI channel with different keys.

---

## 5. Q4: `_meta` on `tools/call`

Assembled per call in `handle_approved_mcp_tool_call` (`core/src/mcp_tool_call.rs:515-540`), then extended by the rmcp
client. (Verified)

```jsonc
{
  "callId": "<model call_id>",                          // mcp_tool_call.rs:1316-1319
  "x-codex-turn-metadata": {                            // :1321-1332 (an object in _meta, not a header string)
    "session_id": "…", "thread_id": "…", "turn_id": "<sub_id>",
    "model": "<slug>", "reasoning_effort": "…",         // turn_metadata.rs:76-94
    "codex_version": "0.158.0-alpha.2.1",               // :285-288
    "auto_review_enabled": bool,
    "node_repl_auto_review_required": bool, "node_repl_disabled": bool,
    "sandbox": "…", "sandbox_mode": "…", "workspaces": {…git…},
    "thread_source": "…", "turn_trigger": "…", "subagent_kind": "…",
    "forked_from_thread_id"|"parent_thread_id": "…",
    "turn_started_at_unix_ms": n,
    "user_input_requested_during_turn": true,           // only once an elicitation or user input happened this turn
    "…client responsesapi metadata (extra)…": "…"
    // removed for MCP: agent_name, parent_turn_id, root_turn_id, tool_namespaces_info (:277-284)
  },
  "plugin_id": "unified-computer-use@openai-bundled",   // :1347-1352
  "openai/confirmation_policies": {"browser_use"?: "…", "computer_use"?: "…"}, // node_repl/cua_repl only, :1361-1391
  "threadId": "<thread id>", "sessionId": "<root session id>",               // :1393-1411
  "windowId": "<context window id>", "itemId": "<Responses item id of the function_call>", // :1412-1423
  "codex/sandbox-state-meta": {                         // only if the server advertised the capability, :837-888
    "permissionProfile": {…}, "codexLinuxSandboxExe": null, "sandboxCwd": "file:///…", "useLegacyLandlock": false },
  "traceparent": "…", "tracestate": "…",                // rmcp-client/src/trace_context.rs:18-31
  "progressToken": n                                    // rmcp src/service.rs:880-893 (always added)
}
```

- **Identities.** `sessionId` is the identity shared by a root thread and all its descendants (`core/src/session/session.rs:649-652`);
  `threadId` is the concrete thread. For a root thread they are equal (`:917-924`). The turn metadata `turn_id` equals
  the hook `turn_id` (`core/src/session/turn_context.rs:978-985`). (Verified)
- **Consumer side** (Inferred from `strings`). `node_repl` contains `x-codex-turn-metadata`, `NodeReplTurnMetadata`,
  `node_repl_disabled`, `node_repl_auto_review_required`, `callId`, `sessionId`, `threadId`, `codex/sandbox-state-meta`,
  `permissionProfile`/`sandboxCwd`/`useLegacyLandlock`, and exposes `nodeRepl.requestMeta` to JS. It puts `callId` and
  `x-codex-turn-metadata` into its own elicitation `_meta` as well; Codex uses that `callId` to correlate the review.
  `openai/confirmation_policies` does not appear in `node_repl`; it is likely read by the JS layer through `requestMeta`.
- **Model gating flags.** `node_repl_disabled` and `computer_use_review_required` are model-catalog flags
  (`protocol/src/openai_models.rs:491`). Codex does not hide the tool when `node_repl_disabled` is true; it only transmits
  the flag, so enforcement is the server's (`NODE_REPL_ENFORCE_MODEL_CHECK` string). (Host Verified; server Inferred)
- **Hook-initiated calls carry much less `_meta`:** `threadId`, `progressToken` and `traceparent` only. Local hooks run with
  `metadata: None` (`hooks/src/engine/dispatcher.rs:148`), and `CoreHookMcpExecutor` adds only `threadId`
  (`core/src/hook_mcp_executor.rs:21-25`). Only executor-scoped (remote-environment) hooks receive the turn metadata map.
  (Verified)

---

## 6. Q5: Hooks, and what an interrupt does

**Hook handler type.** `HookHandlerConfig::McpTool {server, tool, input, timeout, statusMessage}`
(`config/src/hook_config.rs:186-196`). There is no `async` flag, so it always runs synchronously.
- It is rejected for SessionEnd (`hooks/src/engine/discovery.rs:582-599`).
- Hooks from plugins are normally subject to hash-based user trust. The **allowlisted bundled cleanup hooks** are marked
  `builtin`, which makes them trusted and enabled without user action (`discovery.rs:661-735`).
- The allowlist names `unified-computer-use@openai-bundled` → `cua_repl.turn_ended` on Stop, Interrupt and SubagentStop
  (`plugin/src/bundled_hooks.rs:89-100`). It also covers `browser`, `chrome*` and `computer-use` → `node_repl.turn_ended`,
  and one Apps connector. The file header calls it a temporary exception "until signing lands".
- The allowlist requires no matcher and an exact server and tool (`:117-155`). (Verified)

**When they fire.**

| Event | Trigger | Runner | Notes |
|---|---|---|---|
| **Stop** | End of a root turn, when the sampling loop has no follow-up | `core/src/session/turn.rs:640-647` → `run_turn_stop_hooks` (`core/src/hook_runtime.rs:392-468`) | Awaited before turn completion; can block and continue the turn. Does not fire on interrupt, and not on a turn that errors out. (Verified for interrupt; error path Inferred) |
| **SubagentStop** | Same point, for a thread-spawned subagent thread | Same runner | `agent_id` = the subagent's thread id (`hook_runtime.rs:1053-1060`). Other internal subagents get neither (`:448-450`). (Verified) |
| **Interrupt** | `handle_task_abort` with reason `Interrupted`, after the cancellation token fires, a 100 ms grace wait and `task.handle.abort()`, and before `TurnAborted` is emitted | `core/src/tasks/mod.rs:911-965`; also `:812-816` | **Skipped for any SubAgent session** (`hook_runtime.rs:507-509`). Timeout default 1 s, capped at 3 s (`discovery.rs:740-763`). (Verified) |

**Variable substitution** (`hooks/src/engine/mcp_runner.rs:102-166`). `${a.b}` is resolved by walking the hook-event JSON.
- A string that is exactly one placeholder keeps its JSON type; embedded placeholders are stringified.
- A missing field fails the hook rather than sending an unresolved argument.
- Hook event JSON:
  - **Interrupt:** `{session_id, turn_id, transcript_path, cwd, hook_event_name:"Interrupt", model, permission_mode}`
    (`hooks/src/events/interrupt.rs:75-84`).
  - **Stop / SubagentStop:** `{session_id, turn_id, …, stop_hook_active, last_assistant_message}`, plus
    `agent_id` / `agent_type` / `agent_transcript_path` for SubagentStop (`hooks/src/events/stop.rs:128-210`).
- So cua_repl's `turn_ended` receives `{hook_event_name, session_id, turn_id}`. For SubagentStop, the plugin passes
  `${agent_id}` as `session_id`, keying node_repl's per-"session" state by the ending thread. (Verified)

**Awaited, not fire-and-forget.**
- Local handlers run concurrently in `FuturesUnordered`, and all are awaited (`hooks/src/engine/dispatcher.rs:115-165`).
  Only executor-scoped handlers and command hooks with `async: true` are scheduled in the background.
- The call is `McpRuntime::latest_call_tool(..., wait_for_server: false)`. It fails fast with "MCP server 'cua_repl' is not
  connected" if the server is down (`core/src/hook_mcp_executor.rs:27-37`; `codex-mcp/src/connection_manager.rs:944-1006`).
- The effective timeout is the minimum of the server's tool timeout (default 300 s) and the hook timeout.
- Text blocks of the result are joined and parsed with command-hook output semantics; `isError` fails the hook
  (`hook_mcp_executor.rs:38-52`). (Verified)

**Interrupt versus the in-flight `js` call.**
- The cancellation token fires, and `ToolCallRuntime` aborts the dispatch task (`core/src/tools/parallel.rs:234-265`), which
  drops the `tools/call` future.
- In the default legacy MCP mode (`Feature::Mcp20260728` is `UnderDevelopment`, default off, `features/src/lib.rs:1365-1370`;
  `core/src/config/mod.rs:1866-1872`), the call is `send_request_with_option(...).await_response()`
  (`rmcp-client/src/rmcp_client.rs:862-890`). rmcp sends `notifications/cancelled` only on its own timeout option (unused
  here) or an explicit `cancel()`, and `RequestHandle` has no `Drop` impl (`rmcp src/service.rs:536-680`).
- Codex's own timeout wraps the future and drops it the same way (`rmcp_client.rs:1464-1478`).
- **Result: an interrupt (or a Codex-side timeout) sends no `notifications/cancelled`.** node_repl learns of the interrupt
  only through the Interrupt-hook `turn_ended` call, about 100 ms later, with a 1 s budget. Its late response to the
  abandoned request is discarded. (Verified from source; experiment E2 would confirm on the wire)

---

## 7. Q6: Plugin lifecycle, server launch, sandbox

**Bundle → cache.**
1. The app bundle ships `Contents/Resources/plugins/openai-bundled/{.agents/plugins/marketplace.json, plugins/*}`. The
   unified-computer-use `.mcp.json` there is a stub: `command:"node"`, `args:[]`, `enabled:false`, the tool policy, and no env.
2. On launch, the Electron main process stages the marketplace into `~/.codex/.tmp/bundled-marketplaces/openai-bundled/`. It
   **rewrites** the `cua_repl` entry: `command` = `cua_node/bin/node`, `args` = `[…/@oai/cua-repl/bin/cua-repl.mjs]`, `enabled`,
   `env_vars`, and `env` including `CUA_REPL_NODE_REPL_PATH`, `CUA_REPL_ENABLED_SURFACES` and `NODE_REPL_TRUSTED_SERVICES`.
   It writes via temp-file-then-rename. (`~/codex-app-src/extracted/chatgpt-26.924/.vite/build/main-C5425b_s.js`: strings
   `CUA_REPL_ENABLED_SURFACES:e.surfaces.join(...)`, `@oai/cua-repl/bin/cua-repl.mjs`, and
   `join(e.codexHome,".tmp","bundled-marketplaces",…)`.)
3. It registers `[marketplaces.openai-bundled] source_type="local"` (seen in `~/.codex/config.toml`); the CLI treats that
   path as a managed, reserved marketplace (`core-plugins/src/marketplace_policy.rs:457-515`).
4. CLI plugin install (`core-plugins/src/manager.rs:2210-2262`) copies the staged directory verbatim into
   `~/.codex/plugins/cache/openai-bundled/unified-computer-use/<version>/` and sets
   `[plugins."unified-computer-use@openai-bundled"] enabled = true`.

The staged and cached `.mcp.json` are byte-identical (checked with `diff`). (Verified; see also report 05 §1.4)

**Server config and start.**
- Plugin `.mcp.json` servers are parsed into the same `McpServerConfig` as user servers (`codex-mcp/src/plugin_config.rs:66-124`).
  Plugin policy from config.toml can override `enabled`, tool lists and approval modes, and can only *tighten*
  `output_token_limit` (`core-plugins/src/loader.rs:966-985`, `config/src/mcp_types.rs:95-98`).
- Host-local plugin servers:
  - resolve a relative command against the session cwd;
  - default `cwd` to the session's local process cwd (`codex-mcp/src/plugin_config.rs:66-70`;
    `rmcp-client/src/stdio_server_launcher.rs:282`);
  - build their environment from `DEFAULT_ENV_VARS` (HOME, LOGNAME, PATH, SHELL, USER, `__CF_USER_TEXT_ENCODING`, LANG,
    LC_ALL, TERM, TMPDIR, TZ), plus names listed in `env_vars` copied from Codex's own environment, plus custom CA vars,
    plus the literal `env` map (`rmcp-client/src/utils.rs:16-58,162-176`).
- Startup timeout comes from `startup_timeout_sec` (default 30 s) and covers `initialize` plus the initial `tools/list`
  (`config/src/mcp_types.rs:252-256`; `codex-mcp/src/rmcp_client.rs:103,342`). Tool timeout `tool_timeout_sec` defaults
  to 300 s (`:104`). (Verified)

**Sandbox: outside.**
- Local stdio servers are spawned with a plain `Command` in a **new process group**, with only stdio file descriptors
  inherited on Unix. There is no seatbelt wrapper (`rmcp-client/src/stdio_server_launcher.rs:267-300`). On shutdown the
  group gets SIGTERM, then SIGKILL (`:417-450`).
- `cua_repl` therefore runs with the user's full privileges, as a child of `codex app-server`, which is itself a child of
  ChatGPT.app.
- The sandbox *policy* still reaches the server as data (`codex/sandbox-state-meta`, §5).
- `node_repl`'s strings indicate it confines its Node kernel itself:
  - "the node_repl sandbox with denied paths cannot be disabled", `macos_sandbox_failed`, `sandbox-exec:`,
    `NODE_REPL_ENABLE_NETWORK_ISOLATION`;
  - a `--disable-sandbox` flag ("Start the Node kernel directly even when CODEX_CLI_PATH is set");
  - `--allow-unix-socket`, which matches `codex sandbox macos --allow-unix-socket <path> -- <cmd>` ("Full command args to run
    under seatbelt", `cli/src/lib.rs:84-99`). (Inferred)
- The Screen Recording and Accessibility grants belong to the separately launched native service (report 05), not to this
  process tree. Whether any TCC prompt is attributed to the `codex` → `node` chain is out of this layer's scope.

---

## 8. Q7: Other computer-use-specific code in the CLI

- **`is_node_repl_backed_server`** matches `"node_repl" | "cua_repl"` (`protocol/src/mcp.rs:38-40`). It gates:
  - the confirmation-policy meta (§5);
  - retaining the invocation for elicitation correlation (`core/src/mcp_tool_call.rs:1215-1221`);
  - the user-CUA auto-accept (§4.1);
  - Guardian evidence capture (`core/src/tools/handlers/mcp.rs:297-415`, which captures text and images of Code-Mode-sourced
    node_repl results for the Guardian reviewer; direct calls return early at `:303-305`). (Verified)
- **Guardian.** When `computer_use_review_required()` is set on the model, review sessions keep client developer messages
  and add a "node_repl policy" developer fragment (`core/src/guardian/review.rs:154-163`,
  `core/src/context/guardian_node_repl_policy.rs`). Evidence mode becomes multimodal
  (`core/src/context/node_repl_review_evidence.rs:28-40`). A step cannot switch to a model with different node_repl flags
  mid-turn (`core/src/session/step_activation.rs:111-133`). (Verified)
- **`[computer_use]` config and requirements** (macOS `bundle_ids` allow/deny, `default_app_access`,
  `allow_locked_computer_use`, `allow_persistent_approval`, `allow_browser_and_computer_use`) are parsed
  (`config/src/computer_use.rs`, `config/src/browser_computer_use_requirements.rs:84-113`,
  `config/src/config_requirements.rs:185,1052-1055`) but **ignored by core** (`computer_use: _`,
  `core/src/config/mod.rs:3279`). They are exposed through app-server `config/read` and `configRequirements/read`, which
  node_repl calls through `CODEX_CLI_PATH` (strings). So the app allow/deny policy is enforced in the server or JS, fed by
  a Codex app-server. (Host Verified; consumer Inferred)
- **Model output templates.** `ResolvedModelMessages::confirmation_policies()` supplies per-model `browser_use` /
  `computer_use` confirmation text (§5). (Verified)
- **Shipped-binary check.** These strings are present in the shipped `codex`: `unified-computer-use@openai-bundled`,
  `codex_strict_auto_review`, `codex_sensitive_action`, `codex_requires_user_input`, `openai/confirmation_policies`,
  `x-codex-turn-metadata`, `node_repl_disabled`, `Wall time:`, `codex/imageDetail`, `mcpServer/elicitation/request`,
  `codex/sandbox-state-meta`, "hook input placeholder", "Automated review of this operation failed", and `cua_repl` (10
  occurrences). Short keys such as `windowId` are not greppable because LLVM inlines ≤16-byte literals as immediates, so
  their absence proves nothing. (Verified)

---

## 9. Reading the contract for a Claude Code host

What a MAWS-hosted Claude Code agent would do to run `cua_repl` unmodified (Verified-from-spec facts; the plan is a proposal):

1. **Register the server** as a project or plugin stdio server with the same `command`/`args`/`env` Electron writes, and
   set `MCP_TIMEOUT=120000`.
   - Set `alwaysLoad: true` so `js` isn't deferred.
   - Raise `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` so the `js` description and server instructions survive.
   - Allow the `js` tool in permissions so there is no pre-call prompt.
2. **Elicitations.** Answer node_repl's per-cell elicitation. Under stream-json, MAWS receives `control_request` with
   subtype `elicitation` and can apply Codex's policy itself: accept the plain `js` gate, and surface anything that looks
   like a sensitive or app-access request. The server's `_meta` classification is not forwarded to MAWS, so the decision
   must key on server name and message text.
3. **Turn cleanup.** `mcp_tool` hooks on Stop, SubagentStop and StopFailure call `turn_ended` with
   `{hook_event_name, session_id: ${session_id}, turn_id: ${prompt_id}}`. For interrupts, rely on CC's
   `notifications/cancelled`, plus a `UserPromptSubmit` hook that ends the previous turn.
4. **Two things Claude Code cannot supply.**
   - `x-codex-turn-metadata` and `codex/sandbox-state-meta` on each call. Whether node_repl refuses, degrades or defaults
     without them decides reuse versus fork, and is the first experiment below.
   - A Codex CLI for node_repl's config, auth and sandbox calls. Pointing `CODEX_CLI_PATH` at the bundled binary may be
     enough, since node_repl starts its own `codex app-server`.

---

## 10. Open questions

1. Does `node_repl` require `x-codex-turn-metadata` (and a known `model`) to execute `js`? What does it do without
   `codex/sandbox-state-meta`? (`NODE_REPL_ENFORCE_MODEL_CHECK`, `NODE_REPL_FORCE/DISABLE_STRICT_AUTO_REVIEW` hint at
   switches.) Decisive for reuse from Claude Code.
2. Is "JavaScript execution requires an approval elicitation" the elicitation `message`, or the error returned to clients
   that don't advertise elicitation? `form_elicitation_supported` suggests node_repl branches on client capability.
3. What are the `js` tool's annotations? This decides whether Codex adds its own pre-call approval (§4.2) and whether Codex
   runs `js` calls in parallel.
4. What exactly does `turn_ended` release (overlay, app-control sessions, locks, Node processes), and what breaks if it is
   never called or arrives late? This is for the node_repl / JS researchers. It determines whether H14 and H15 are hard
   or soft requirements.
5. Does node_repl itself start `codex app-server` through `CODEX_CLI_PATH` for every session, and does it fail closed when
   `CODEX_CLI_PATH` is absent (H19)?
6. How does the server interpret response `_meta` (`persist: session|always`, `approvals_reviewer`)? Claude Code would lose it.
7. Does `codex_guardian_reviewer` return `None` (→ UI) for a user reviewer on non-strict approval requests? I did not read
   that crate.
8. Claude Code: does `CLAUDE_CODE_SESSION_ID` in the server env go stale after `/clear` or resume? node_repl keys state by
   session id.

---

## 11. Proposed wave-2 experiments

All experiments run against a **scratch `CODEX_HOME`** (for example `/tmp/cx-home`) and a scratch Claude Code project, so
`~/.codex` and the Desktop's state are untouched.

- **E1: wire tap under Codex.**
  - Setup: a tiny stdio tee proxy (a Python script that spawns the real `cua_node/bin/node cua-repl.mjs`, forwards stdin and
    stdout, and logs every JSON-RPC line both ways). Register it as `cua_repl` in `/tmp/cx-home/config.toml` with the same env
    as the cached `.mcp.json`, the same `enabled_tools`, `omit_tools_from` and `tools.js.output_token_limit`, and the
    three `mcp_tool` hooks in a user `hooks.json`.
  - Drive with `codex exec --json -c features.code_mode_host=true` or with `codex app-server` and
    `codex-app-server-test-client`.
  - Capture:
    - `initialize` (server capabilities, including `codex/sandbox-state-meta` and the instructions length);
    - `tools/list` (annotations, `_meta.ui.visibility` of `turn_ended`, `js` description length);
    - one `tools/call` `_meta`;
    - the elicitation params and our response;
    - the `turn_ended` call and its `_meta`.
- **E2: interrupt semantics.**
  - Run `js` with `await new Promise(r => setTimeout(r, 20000))`; interrupt after 2 s.
  - Expect: no `notifications/cancelled`; an Interrupt-hook `tools/call turn_ended {hook_event_name:"Interrupt",…}` within
    about 100 ms to 1 s; node_repl's late `tools/call` response ignored.
  - Repeat inside a spawned subagent: expect no Interrupt hook.
- **E3: approval routing matrix.**
  - Vary approval_policy ∈ {on-request, never} × approvals_reviewer ∈ {user, auto_review} × permissions ∈ {workspace-write,
    danger-full-access}.
  - For each, record:
    - whether `mcpServer/elicitation/request` reaches the app-server client;
    - whether a Codex pre-call approval appears;
    - the response `_meta` node_repl receives.
  - Add one JS cell that raises `nodeRepl.createElicitation({…, _meta:{codex_sensitive_action:true}})`.
- **E4: Claude Code 2.1.283 hosting probe** (the decisive one).
  - Same tee proxy, as a project `.mcp.json` server named `cua_repl`, with `alwaysLoad: true`, `MCP_TIMEOUT=120000` and
    `CLAUDE_CODE_MAX_MCP_DESCRIPTION_LENGTH` raised.
  - Run `claude -p --output-format stream-json --input-format stream-json` from a harness that answers `control_request`
    elicitations with accept.
  - Record:
    1. whether `js` runs at all without `x-codex-turn-metadata` / sandbox meta;
    2. whether screenshots reach the model, and whether the coordinate note appears;
    3. that `notifications/cancelled` arrives on interrupt;
    4. that a Stop `mcp_tool` hook reaches `turn_ended`.
  - Then re-run with the proxy **injecting** a synthetic `x-codex-turn-metadata` + `callId` + `codex/sandbox-state-meta`
    into each `tools/call`. This tests whether a thin shim proxy closes the gap.
- **E5: `CODEX_CLI_PATH` dependency.** Run E4 with `CODEX_CLI_PATH` unset, then pointed at the bundled `codex`. Watch for
  node_repl spawning `codex app-server` (process list) and the `config/read` / `getAuthStatus` traffic on that child's
  stdio. Coordinate with the node_repl researcher.
- **E6: image budget.** In one `js` cell, emit 4 full-resolution Retina screenshots plus 200 KB of text.
  - Codex: confirm resize to ≤1600×1600 at high detail, text truncated at about 30k tokens, all 4 images present, and the
    app-server `item/completed` copy collapsed to a text preview (>1 MiB).
  - Claude Code: confirm which images survive `MAX_MCP_OUTPUT_TOKENS`.
