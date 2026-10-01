# Protocol probe, second pass: findings

Child C2 of `docs/charter.md` (parent pin 32b75d61; D-18 follow-up pin 4ff2f2df). Engine 2.1.283 run by absolute path. Fixtures under `fixtures/pass2/`, scenarios under `scenarios/pass2/`; run one with `node run-pass2.mjs <scenario>`. `fixtures.test.mjs` asserts each finding below against its fixture (56 tests, 43 from this pass).

## How this pass differed from the first

- The pinned binary was run by absolute path. Pass 1 went through a cmux wrapper found on PATH.
- The parent session's own variables were scrubbed from the child environment (`CLAUDE_CODE_SESSION_ID`, `CLAUDE_PID`, the messaging socket and token, and similar). The §4.1 `CLAUDE_*` allowlist must exclude these.
- Auto mode ran on Sonnet, because Haiku cannot hold auto mode.
- The harness redacts token, key and secret values and email addresses before writing a fixture.
- About 36 model turns against a budget of roughly 25: one rerun each for rewind and grants, one extra run for item 7.

**Blocker.** The owner's Claude login had expired during this pass: every unrouted model turn failed with "OAuth session expired and could not be refreshed". Unrouted control requests were still recorded. Unrouted model behaviour (items 1 and 13) needs `claude /login`, then `node run-pass2.mjs auto-mode`.

## 1. Usage, models, fork (unrouted)

Observed:
- Unrouted `get_usage` returned `{subscription_type: null, rate_limits_available: false}`. This is the expired login, not the engine. No `rate_limit_event` appeared in any fixture, routed or unrouted.
- Unrouted catalogue: default, opus, fable, sonnet, haiku. Routed adds `claude/astra|sol|luna|terra` and three `claude/<vendor>` entries. Each entry carries `supportsAutoMode` and `supportsFastMode`; Haiku lacks auto, every gateway model claims it.
- `fork_conversation` answers `{forked: false, reason: "unsupported"}` routed and unrouted. It is not a routing quirk.

Design: forking stays the `--fork-session` launch flag. The model picker reads `list_models` and greys auto mode where `supportsAutoMode` is false. Usage windows stay on ClaudeUsage until the unrouted rerun says otherwise.

## 2. Real settings and memory

Observed:
- `system/init` under the owner's settings lists 39 tools (Workflow, Monitor, LSP, SendMessage and MCP tools among them), 80 commands, 44 skills, 21 agents, 3 MCP servers (ptc and advisor over stdio, openaiDeveloperDocs over HTTP) and 11 plugins.
- SessionStart hook frames arrive without `--include-hook-events`.
- Routing: the owner's `settings.json` `env` block sets the gateway URL and token. Removing them from the process environment does not unroute a session that loads user settings. Only `--settings '{"env":{"ANTHROPIC_BASE_URL":"","ANTHROPIC_AUTH_TOKEN":""}}'` does.
- Memory, macOS RSS of the process tree under the engine pid:

| Case | Tree RSS |
|---|---|
| Bare engine, empty settings | 280 to 345 MB peak |
| Real settings, one session idle | 409 MB (engine 252, ptc MCP 51, advisor MCP 107) |
| Same, during a tool call | 455 MB snapshot, 555 MB sampled peak |
| Same, idle after the turn | 420 MB |
| Three concurrent idle sessions, each | 266, 274, 266 MB (startup peaks 526 to 562 MB) |

Stdio MCP servers are about 40 percent of an idle tree.

Design: budget roughly 270 to 420 MB per idle session and about 550 MB at peak. The unrouted launch adds the empty-string env override through flag settings; unsetting variables is not enough. Session info shows the base URL from `get_status`.

## 3. Workflow

Observed frames, in order: `background_tasks_changed`; `task_started {task_type: "local_workflow", workflow_name}`; a tool result `{status: "async_launched", runId, transcriptDir, scriptPath}`; `task_progress.workflow_progress` carrying a `workflow_phase` entry and `workflow_agent` entries (`agentId, model, state, attempt, tokens, toolCalls, durationMs, resultPreview`); `task_updated {status: "completed"}`; `task_notification {output_file, usage}`; then an engine-initiated follow-up turn producing a `result` the host never asked for.

On disk: `workflows/wf_<run>.json`, `workflows/scripts/*.js`, `subagents/workflows/<run>/journal.jsonl` plus `agent-*` transcripts. Agents ran on opus because the inherited `CLAUDE_CODE_SUBAGENT_MODEL=opus` applied.

Design: treat each `workflow_progress` as a whole snapshot, backfilled from `wf_*.json` and the journal. Accept unsolicited `result` frames and never release a queued message into one. Surface `CLAUDE_CODE_SUBAGENT_MODEL` as a per-session choice.

## 4. Rewind

Observed:
- `rewind_files` dry run answers "File rewinding is not enabled."
- `rewind_conversation` without `last_seen_user_message_uuid` refuses with `stale_target`. With it, the answer is `{rewound: true, prefillText, precedingAssistantUuid}` and no reset frame appears on stdout. The next turn sees only the pre-target context.
- The JSONL is never truncated. A `last-prompt {rewound: true, leafUuid}` anchor is appended with the next write and the new turn branches from the older leaf.
- The host-supplied `user.uuid` becomes the JSONL record uuid.

Design: the host truncates its own view and pre-fills the composer from `prefillText`. The filesystem service follows parent links from the latest leaf rather than reading records in file order. Always send `last_seen`. File checkpointing is unverified and falls to C3.

## 5. Hooks

Observed:
- `initialize` with hooks returns `hooks_applied: true`.
- `hook_callback {callback_id, input: {hook_event_name, tool_name, tool_input, tool_use_id, permission_mode, effort, ...}}` carries no deadline; `additionalContext` in the response is accepted.
- Settings command hooks emit `hook_started` and `hook_response {stdout, exit_code, outcome}`. Host callback hooks emit neither and are absent from `get_hooks_listing`.

Design: the host owns the UI and the timeout for its own hooks. Lifecycle rows in the transcript cover settings and plugin hooks only.

## 6. Dialogs and elicitation

Observed:
- The stub MCP server's `elicitation/create` arrives as `elicitation {mcp_server_name, mode: "form", requested_schema}`; `accept` plus `content` reaches the server. The engine advertises `capabilities.elicitation`. No `elicitation_complete` frame.
- No reachable producer of `request_user_dialog`.
- `dialogExpiry: "never"` via `--settings` is effective. It is read only from trusted settings sources, and `CLAUDE_CODE_USER_DIALOG_TIMEOUT_MS` overrides it.

Design: set expiry through the launch flag and keep that env var out of the allowlist.

## 7. perTaskStopAffordance

Observed:
- Without the declaration an interrupt kills a running background workflow (`killed`, then `stopped`). With it the workflow survives.
- Background Bash survives an interrupt either way.
- The interrupted foreground call is tagged `non_execution_kind: "user-rejected"`, not `interrupted`. Each background completion triggers a follow-up turn.

Design: declare the affordance and offer per-task `stop_task`. Render `user-rejected` together with an aborted `terminal_reason` as an interruption, not a refusal.

## 8. Trust

Observed:
- Without attestation, project allow rules are ignored with a stderr notice.
- `set_cwd` to an untrusted directory returns `needs_trust {directory}`; retrying with trust accepted returns `ok {changed, transcript_relocated}` and the rules load.
- `workspaceTrust` in `initialize` returns `workspace_trust_recorded: true` and the rules load at once.
- Trust persists in `~/.claude.json`. This pass added three `/private/tmp` entries there.

Design: show the trust dialog before launch. Attest in `initialize`, or in `claim_session.workspace_trust` for prewarmed spares. Surface the stderr notice as a session warning.

## 9. Grant re-application

Observed:
- A session grant suppresses repeat prompts and is gone after `--resume`. `apply_flag_settings` with the allow rule restores it: the call is then not prompted.
- A matching ask rule always outranks an allow rule. Pass 1's claim about precedence was never exercised.
- A host deny is reported as `permission-rule`; an interrupt as `user-rejected`.

Design: persist grants in the index and re-apply them after initialize. Hide "always allow" when the prompt came from an ask rule (`decision_reason_type: "rule"`). Record human provenance app-side.

## 10. Resume while live

Observed:
- Against a live print-mode holder there is no guard: both processes write the same session id into one JSONL as sibling branches.
- Against a `claude --bg` holder the resume is refused ("running as a background session ... --fork-session to branch off a copy"). `--bg` also refuses untrusted directories and runs as a daemon-hosted PTY TUI.

Design: MAWS detects holders itself and opens them read-only. The engine's refusal is authoritative for `--bg`.

## 11. `bash_command` context

Observed:
- Alone, the replayed bash-input, stdout, stderr and exit-code user records never reach the model's context (it answered "NONE" when asked).
- A following `shouldQuery: false` user frame does reach it, and emits an empty `result` with a null `terminal_reason`.

Design: keep the §4.2 design (`bash_command`, then the echo). Treat that empty `result` as the echo's receipt, not a turn.

## 12. Prewarm

Observed:
- A parked spare emits `commands_changed` and sits at 255 MB.
- `claim_session` takes 88 ms and returns `{status: "ok", session_id, parked_ms, sdk_mcp_settled, initialize}`. The first turn after a claim took 1.56 s.
- A cold `initialize` takes 0.34 to 0.40 s with empty settings and 0.8 to 1.1 s with the owner's settings.

Design: a one-spare pool is enough. Pass trust at claim time. Spares must use the session's settings sources.

## 13. Auto mode

Observed:
- Effective mode: on Sonnet, `current_permission_mode` and every `system/init.permissionMode` read `auto`. On Haiku the mode is silently `default`, and switching to auto fails with `auto_mode_model`.
- `claude/astra` through the gateway accepts auto. Fast mode did not produce `auto_mode_fast_mode` (fast mode needs SDK opt-in, `sdk_opt_in_required`).
- Server classifier through the gateway: `get_status` reads "Auto mode server: Enabled" with no refusal, latch, dialog, warning or stop text.
- Allow verdicts are visible. Each `stream_event` `message_delta.safeguard_results` carries `evaluated/not_flagged` keyed by `tool_use_id`. Allows produce no control frames. This contradicts X1's "allow verdicts are not attributable" for the server lane.
- Only ask rules escalated (`can_use_tool {decision_reason_type: "rule"}`). No classifier denial was provoked: the model refused the force push itself, so the `automode-*` denial kinds were not seen.

Design: attribute server allows from `safeguard_results`. The permission chip trusts only the effective mode and shows the `error_code` on refusal.

## W1 probes (2026-10-01): steers, hooks, `/compact`

Recorded live on the pinned 2.1.283 under a scratch `CLAUDE_CONFIG_DIR` through the relay, Sonnet, by the `W1 …` cases of `test/live/engine-host.live.test.ts` and `scenarios/pass3/terminal-queued.mjs`; about US$2 in all. Wire journals under `fixtures/pass3/`, the same sessions' transcripts under `test/fixtures/transcripts/w1-*.jsonl`.

Observed:
- A `next` steer still waiting when the turn is interrupted (`steer-next-interrupted`) is not dropped: the interrupt answers `still_queued: [steer]` (seq 33), the turn ends `aborted_tools` naming only the first prompt (seq 37), and the engine at once starts the steer as a turn of its own with no further frame (`started` seq 41, result seq 55 naming only it). On disk it is an ordinary user record whose parent is the interrupt marker. So Esc (an interrupt) sends a waiting steer now, as the owner's ruling wants, while MAWS's plain stop (⌘., the Stop button) first withdraws waiting steers into its own paused queue (`session.interrupt { holdEngineQueued: true }`), so nothing runs after it.
- A `next` steer then a `now` steer while a tool runs (`steer-next-then-now`): the `now` steer aborts the call (`aborted_tools`) and runs first as its own turn, then the `next` one runs as another turn; neither folds into the other. On disk both are ordinary user records.
- A delivered `next` steer (`steer-next-disk-live`, the same run as `w1-steer-next-disk.jsonl`) is written to the main transcript only as an attachment `{ type: 'queued_command', prompt, source_uuid: <the steer's uuid>, commandMode: 'prompt', origin: { kind: 'human' }, humanTurn: true }` (line 32), the child of the tool result it followed, with queue-operation records `enqueue` and `remove { reason: 'absorbed_mid_turn' }`. No user record carries the steer's uuid. A prompt the interactive terminal queued mid-turn (`w1-terminal-queued.jsonl` line 26) takes the same path with the same keys (`entrypoint: 'cli'`, an extra `session_id`, its parent a `prompt_snapshot` attachment): the engine's mid-turn fold takes queued commands of priority `next` or higher, and the terminal enqueues with the default `next` (`cli.pretty.js` 810567-810612, 640247). C4's backfill now maps a human `queued_command` in a main transcript to the prompt's `user.message` under `source_uuid` and a `command.lifecycle started`, so a reloaded session folds the steer where the live stream did. Before, it dropped every main-transcript attachment and the steer vanished on reload (it did not split the turn, as the study guessed).
- `cancel_async_message { message_uuid }` withdraws a waiting `next` steer (`steer-next-cancelled` seq 34-36): `command_lifecycle cancelled` for it, then `{ cancelled: true }`; the running turn finishes as if it was never sent (no replay, no `queued_command`, the result names only the first prompt). A uuid already delivered answers `{ cancelled: false }` with no frame (the engine remembers the stale cancel; no visible effect seen). The engine reads `message_uuid`; C1's `CancelAsyncMessageRequest` declared `uuid` and is corrected. On disk a withdrawn steer leaves only `enqueue` and a bare `dequeue`. This is MAWS's "Hold until the turn ends".
- Blocking hooks (`hooks-blocking`, hooks in the scratch user settings): a UserPromptSubmit hook runs after `started` and before `system/init`; exiting 2 it reads `outcome: 'error'`, `exit_code: 2`, the reason on stderr, followed by `system/informational` "UserPromptSubmit operation blocked by hook: …" with `prevent_continuation: true` and a `result` with `num_turns: 0` and no `terminal_reason`; no replay, no assistant message, and on disk no user record. A Stop hook answering `{"decision":"block","reason":…}` on stdout reads `outcome: 'success'`, exit 0; the engine then sends a synthetic user frame "Stop hook feedback: …", a `notification` keyed `stop-hook-error` ("Stop hook error occurred · ctrl+o to see"), and the model answers again inside the same turn (one result, `num_turns` 2). On disk: an `isMeta` user record with the feedback, a `hook_blocking_error` attachment and `stop_hook_summary` system records.
- `/compact` (`compact`, `w1-compact.jsonl`): it opens a turn of its own (`queued`, `started`), then `status` compacting and `compact_result: "success"`, `system/init`, `compact_boundary` with `compact_metadata { trigger: 'manual', pre_tokens, post_tokens, … }` and `logical_parent_uuid`, a synthetic user frame carrying the summary (no `isCompactSummary` on the wire), the replayed `<local-command-stdout>Compacted …`, the replayed `<command-name>/compact</command-name>…` under the send's uuid, and a result with `num_turns: 0` and `result: ""`. On disk, consecutively: the `compact_boundary` system record (`parentUuid: null`), the summary user record with `isCompactSummary: true` and `isVisibleInTranscriptOnly: true`, an `isMeta` `<local-command-caveat>`, the `<command-name>/compact</command-name>` record under the send's uuid, and the `<local-command-stdout>` record. No `local_command` system records.

Design: Enter while a turn runs is a `next` steer; MAWS publishes waiting steers with its queue and withdraws one into its own queue through `cancel_async_message`; the transcript places a taken steer at its delivery position, live and from disk alike; hook outcomes are read from `hook_response` (exit code 2, or `decision: block` / `continue: false` on stdout), and the engine's terminal words for them give way to MAWS's notice.

Not verified here: what the engine's memory of a stale `cancel_async_message` does to a later frame with the same uuid; a blocked prompt and a Stop hook's re-prompt after a reload (no hook events on disk, and the blocked prompt has no user record).

## Not verified

- Unrouted model turns, the unrouted classifier lane, and the engine's own usage windows (expired login).
- The `automode-blocked` and `automode-unavailable` denial kinds and the `auto_mode_fast_mode` code.
- Any producer of `request_user_dialog`.
- Rewind with file checkpointing enabled.

## Files

- Modified: `harness.mjs` (options for binary path, routing, settings sources, strict MCP, permission mode and extra env; redaction; process-tree RSS), `fixtures.test.mjs`.
- New: `run-pass2.mjs`; `scenarios/pass2/*.mjs` (17 scenarios, `common.mjs`, a stub MCP server); `fixtures/pass2/*.jsonl` (29 files) and `fixtures/pass2/workflow-disk/`.
