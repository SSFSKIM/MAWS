## Concise summary for the user (under 400 words)

The 2.1.283 headless protocol is substantially more capable than the public SDK surface suggests. The matrix has **67 rows: 35 wire-complete, 24 wire-partial, 4 app-side, and 4 needs-patch**. This includes one additional row for exact custom-status-line parity, because the requested statusLine investigation exposes a separate gap.

The five most consequential findings are:

1. **Cross-session held messages cannot be approved individually by a headless host.** `peer_message_hold` is informational; changing the session-wide acceptance policy is not an equivalent workaround.
2. **Workflow progress is available, but full Workflow control is not.** Runtime `task_progress.workflow_progress` carries phases and agents; native pause, skip-one-agent, and retry-one-agent remain in-process operations.
3. **Auto-mode decisions are only partly observable.** Denials and escalations are exposed; successful classifier verdicts do not have a complete wire event stream.
4. **Exact statusLine telemetry is not exported.** Much of its payload is reconstructible, but internal prompt-cache diagnosis/ledger state is not available as a headless snapshot.
5. **Durable and live state require different readers.** Child transcripts, full spilled results, checklist state, workflow journals, titles, and fleet state need filesystem backfill/watchers in addition to stdout.

Several anticipated gaps are already solved: structured context and quota requests, configuration/status/permission/hook/memory/sandbox panel data, conversation fork/rewind, and export/diff controls exist. **TaskOutput was removed in 2.1.283**; use the reported output file. Fork subagents are disabled by default headless but have a launch-time opt-in, not a patch requirement.

**Top recommendation:** pin the binary and build a versioned raw-wire adapter plus one filesystem-backed state service. Poll the engine’s `get_usage` and `get_context_usage` rather than duplicate its authentication/quota logic. Defer binary patching: the executable contains both source and bytecode, and source-only edits are not proven to affect execution.

--- BEGIN FILE CONTENT ---

# MAWS: Claude Code 2.1.283 SDK/wire gap

## Scope, evidence, and rating rules

MAWS is an Electron host for the **Claude Code 2.1.283** engine. This is a static audit of what its headless wire exposes compared with its in-process terminal UI, checked against Agent SDK **0.3.259**. It is not a claim that every listed feature was exercised in a running process.

Sources:

- `/Users/new/claude-code-bundle/2.1.283/SPEC/00-README.md` and `CONVENTIONS.md` establish scope and source conventions.
- The numbered chapters cited below live under `/Users/new/claude-code-bundle/2.1.283/SPEC/`.
- `chunk-name:line` references point into `/Users/new/claude-code-bundle/2.1.283/cli.pretty.js`.
- SDK references point into `/Users/new/claude-code-bundle/agent-sdk-0.3.259/sdk.d.ts`; its `README.md` documents the executable override/extraction mechanism.
- Packaging evidence also comes from `/Users/new/claude-code-bundle/2.1.283/MAP.md`.

**Baseline:** local, persistent, bidirectional `stream-json`, not a cloud worker or a Remote Control bridge. Feature gates, org policy, authentication, model eligibility, and entrypoint restrictions still apply. A tool appearing in source is not proof that MAWS's session exposes it: inspect the live tool/command lists. Do not set remote-environment flags merely to impersonate a different product surface.

Ratings:

- **wire-complete:** the engine exposes the necessary state/action through launch options, normal conversation/tool records, and/or control requests. MAWS must still implement the renderer. A tool-driven action remains agent-owned unless an explicit host RPC is listed.
- **wire-partial:** useful wire support exists, but full parity also requires disk backfill, app-side orchestration, or a local integration.
- **app-side:** the feature is naturally owned by the desktop app; reproducing the TUI implementation is unnecessary.
- **needs-patch:** exact parity includes in-process state or an action that neither the current wire nor a safe equivalent app-side mechanism exposes. A reduced feature can still ship without that patch.

There are **67 matrix rows: 35 wire-complete, 24 wire-partial, 4 app-side, 4 needs-patch**. Rows group tightly coupled requested features; row 67 explicitly adds exact custom-status-line parity.

## Part 1 — The wire for a GUI builder

### 1.1 Launch and framing

A direct process host uses the equivalent of:

```text
claude -p --input-format stream-json --output-format stream-json --verbose
       --include-partial-messages --forward-subagent-text
       --include-hook-events --replay-user-messages
       --permission-prompt-tool stdio
```

Use SDK `canUseTool` when going through `query()`; the SDK selects the stdio permission-prompt transport for that callback. **Bare print mode without a permission host denies unresolved asks rather than presenting a terminal prompt.** Pin `pathToClaudeCodeExecutable` to the researched engine, rather than silently using an SDK-bundled different version. Explicitly choose the SDK's setting sources if TUI-equivalent user/project/local discovery is intended; do not assume package defaults reproduce terminal startup. [45 §§45.4.2, 45.14.3, 45.27–28; `chunk-xwgs2xvp.js:982110`, `:982155`; SDK lines 1720–1732, 1824, 2070]

Both streams are newline-delimited JSON. Keep stderr separate for diagnostics. Closing stdin means finish the current turn and exit; it is not a pause/reconnect primitive. The input accumulator defaults to 268,435,456 UTF-16 code units per unterminated line, not a 256-MiB byte limit. The GUI should impose its own sensible memory/backpressure limits. [45 §§45.7.2, 45.15; `chunk-q9jwcw4a.js:691407`, `:691636-691639`]

`system/init` is emitted **at every turn**, not just process startup, and is not necessarily the first output frame. Lifecycle, control, and some startup frames can precede it. `result` is a turn result, not process EOF; background work and queued messages can continue. `system/session_state_changed` is the authoritative running/needs-action/idle signal, subject to the documented background-task reporting setting. [45 §§45.10, 45.11, 45.14.2]

### 1.2 Complete stdout catalogue

Except where noted, informational/conversational messages carry `uuid` and `session_id`. Preserve unknown fields and tolerate unknown types/subtypes. The published stdout union is a **lower bound**, not a safe exhaustiveness validator. The five known outside-union system subtypes are `model_fallback`, `model_consent_fallback`, `tool_host_result`, `bridge_state`, and `turn_starting`. [45 §§45.9.1–2, 45.14.9; `chunk-9r9kpwh0.js:278802-278831`]

Field lists below select renderer-relevant fields, not every optional telemetry/provenance property. Each subtype is listed separately.

| Type / subtype | Renderer-relevant fields and meaning |
|---|---|
| `system/init` | `cwd, model, permissionMode, tools, mcp_servers, slash_commands, terminal_slash_commands?, agents?, skills, plugins, capabilities?, output_style, claude_code_version`; optional effort/fast-mode/memory/scratchpad/error/footer metadata. |
| `assistant` | `message.{id,content,model,usage,stop_reason}`, `parent_tool_use_id`, optional `timestamp, request_id, user_message_uuid(s), supersedes, aborted, subagent_type, task_description, tool_use_meta, narration_block_indexes, narration_hint, context_usage, usage_report, local_command_*`, structured API-error fields. One completed content block per record, not necessarily a complete API message. |
| `user` | `message.content` including `tool_result`, `parent_tool_use_id`, full structured `tool_use_result`, `tool_result_meta?`, `origin?`, `isSynthetic?`, `isReplay?`, child metadata; replay and model-visible results are distinct concepts. |
| `result/success` | `result, is_error, stop_reason, terminal_reason?, structured_output?, deferred_tool_use?, duration_ms, duration_api_ms, num_turns, usage, modelUsage, total_cost_usd, permission_denials, queued_turn_count?, user_message_uuid(s)?, result_index?`, fast-mode/subagent statistics where supplied. `success` can still have `is_error:true`. |
| `result/error_during_execution` | Common result accounting/correlation plus `errors`; may carry `startup_failure_reason`, `runner_exit`, `resume_reason`. |
| `result/error_max_turns` | Common result fields plus `errors`; turn cap reached. |
| `result/error_max_budget_usd` | Common result fields plus `errors`; budget exhausted. |
| `result/error_max_structured_output_retries` | Common result fields plus `errors`; structured-output retries exhausted. |
| `stream_event` | `event` is raw API stream event; `parent_tool_use_id`, optional `ttft_ms, thinking_display, user_message_uuid(s)`; requires partial messages. |
| `system/status` | `status: compacting\|requesting\|null`, optional `permissionMode, compact_result, compact_error`; `requesting` requires partial messages. |
| `system/compact_boundary` | `compact_metadata.{trigger,pre_tokens,post_tokens?,duration_ms?,cumulative_dropped_tokens?,messages_summarized?,preserved_segment?,preserved_messages?,precomputed?}`, `logical_parent_uuid?`, `historical?`. |
| `system/api_retry` | `attempt,max_retries,retry_delay_ms,error_status,error,no_response?`. |
| `system/control_request_progress` | `request_id,status: started\|api_retry`, optional retry counters; currently `side_question`. |
| `system/model_refusal_fallback` | `direction,scope?,original_model,fallback_model,request_id,content`, refusal details and `retracted_message_uuids?`; retract replaced content. |
| `system/model_refusal_no_fallback` | `original_model,request_id,content`, refusal category/explanation and refused-user UUID where supplied. |
| `system/model_fallback` | `trigger,original_model,fallback_model,content`; schema exists but is outside published union. |
| `system/model_consent_fallback` | `choice,original_model,original_model_name?,fallback_model,persisted_as_default,content`; outside union. |
| `system/informational` | Plaintext `content`, `level: info\|notice\|suggestion\|warning`, `tool_use_id?`, `prevent_continuation?`. |
| `system/local_command_output` | `content` for a local slash-command result. |
| `system/hook_started` | `hook_id,hook_name,hook_event`. |
| `system/hook_progress` | Above identifiers plus `stdout,stderr,output`. |
| `system/hook_response` | Above identifiers plus `stdout,stderr,output,exit_code?,outcome: success\|error\|cancelled`. |
| `system/plugin_install` | `status: started\|installed\|failed\|completed`, optional `name,error`. |
| `system/files_persisted` | `files:[{filename,file_id}],failed:[{filename,error}],processed_at`; persistence receipt, not a universal file-delivery event. |
| `system/task_notification` | `task_id,tool_use_id?,status: completed\|failed\|stopped,reason?,output_file,summary,usage?,resource_links?,skip_transcript?,ambient?`. |
| `system/task_started` | `task_id,tool_use_id?,description,subagent_type?,is_backgrounded?,spawn_depth?,task_type?,workflow_name?,prompt?,skip_transcript?,ambient?`. |
| `system/task_updated` | `task_id,patch.{status?,description?,end_time?,total_paused_ms?,error?,is_backgrounded?}`. |
| `system/task_progress` | `task_id,tool_use_id?,description,subagent_type?,usage.{total_tokens,tool_uses,duration_ms},last_tool_name?,summary?`; **runtime extension `workflow_progress?`** contains workflow phases/agents. |
| `system/background_tasks_changed` | `tasks:[{task_id,task_type,description,ambient?}]` replacement snapshot. |
| `system/thinking_tokens` | `estimated_tokens,estimated_tokens_delta,user_message_uuid?`; per-thinking-block progress estimate, not billed usage. |
| `system/session_state_changed` | `state: idle\|running\|requires_action`. |
| `system/worker_shutting_down` | `reason`; live-tail advisory, not proof the session can never resume. |
| `system/commands_changed` | `commands:[{name,description,argumentHint,aliases?,builtin?}]`. |
| `system/notification` | `key,text,priority,color?,timeout_ms?`. |
| `system/memory_recall` | `mode: select\|synthesize`, `memories:[{path,scope,content?}]`. |
| `system/elicitation_complete` | `mcp_server_name,elicitation_id`; closes a pending MCP elicitation. |
| `system/permission_denied` | `tool_name,tool_use_id,agent_id?,decision_reason_type?,decision_reason_code?,decision_reason?,message`; advisory, not all denial paths. |
| `system/mirror_error` | `error,key.{projectKey,sessionId,subpath?}`. |
| `system/code_change_published` | `provider,url,repo,identifier,action?,branch?`; code-host publication/activity. |
| `system/vcs_state_changed` | `kind: commit\|push\|merge\|rebase,cwd,branch?`; not a full dirty-file/branch watcher. |
| `system/tool_host_result` | **Unpublished:** `tool_use_id,host.{name,working_dir?},disposition?,label?,unverified?,lines`. |
| `system/bridge_state` | **Unpublished:** `state,detail?,failure_kind?,bridge_epoch`; headless Remote Control transitions. |
| `system/turn_starting` | **Unpublished:** `mode,task_id?`; remote stdout-tee/activity-FD path only; no normal UUID/session envelope. |
| `system/feedback_draft_queued` | `draft_id,draft_type,title,details_preview`. |
| `system/cloud_session_delta` | `seq,changed,cloud_session`; cloud-client status changes between init frames, not local stdio state. |
| `system/dev_intent` | Schema declares `kind,trigger?`, but **filter 1 drops it in print mode**; no reachable stdout event to rely on. |
| `system/turn_preempted` | `reason: rapid_followup,preempted_by_uuid,preempted_message_uuids`; requires `initialize.rapidFollowupPreempt`. |
| `system/peer_message_hold` | `state: held\|released\|dropped,message_uuid?,lane,from,from_name?,cause?,outcome?`; information only, not an approval request. |
| `system/per_turn_effort_changed` | `per_turn_effort_active:false` when server rejection disables per-turn effort. |
| `system/turn_handoff_available` | `v:1,tools,worker_epoch,staged_files?,no_query_first?,relay_marker?`; cloud-worker handoff advertisement. |
| `system/post_turn_summary` | `summarizes_uuid,status_category,status_detail,needs_action`; internal surface. |
| `system/task_summary` | `detail: string\|null`; internal surface. |
| `system/session_metadata` | `metadata.artifacts?: [{url,title?,favicon?,kind:'frame',updated_at}]\|null`; whole artifact list on change. |
| `tool_progress` | `tool_use_id,tool_name,parent_tool_use_id,elapsed_time_seconds,task_id?,heartbeat?,subagent_type?,subagent_retry?`; not raw child text or shell stdout. |
| `tool_use_summary` | `summary,preceding_tool_use_ids,timestamp?`. |
| `rate_limit_event` | `rate_limit_info`: status, effective window type/reset/utilization, `unifiedWindows?`, overage/grace/credit/scope fields. |
| `prompt_suggestion` | `suggestion`; opt-in and suppression-dependent, not guaranteed after every turn. |
| `auth_status` | `isAuthenticating,output:string[],error?`; opt-in `--enable-auth-status`. |
| `conversation_reset` | `new_conversation_id,trigger?,user_message_uuid?,timestamp?`; clear/plan exit/fresh session and other reset paths. |
| `command_lifecycle` | `command_uuid,state: queued\|started\|completed\|cancelled\|discarded\|refused`. |
| `active_goal` | `value:null\|{condition,iterations,set_at,tokens_at_start,last_reason?}`; local headless installer emits this only with `CLAUDE_CODE_REMOTE`. |
| `autocompact_state` | `value.{enabled,effective_window,threshold,enforced,source}`; `CLAUDE_CODE_REMOTE` only; source is `env\|settings\|clientdata\|experiment\|model-default\|unknown-model\|auto`. |
| `transcript_mirror` | `filePath,entries`; `--session-mirror`, durable transcript records rather than normal chat events. |
| `control_request` | `request_id,request.{subtype,...}`; engine-originated RPC. |
| `control_response` | `response.{subtype,request_id,response?\|error,error_code?,pending_permission_requests?,pending_user_dialog_requests?}`. |
| `control_cancel_request` | `request_id`; withdraws an outstanding request; no reply to cancellation. |
| `keep_alive` | No payload; liveness, not turn progress. |

Catalogue/source: 45 §§45.9–14; `chunk-9r9kpwh0.js:278798`, `:278802`, `:278806`, `:278831`. Unpublished frames: `chunk-7dz9rvcm.js:201904-201906`, `chunk-r4xrzyvn.js:730910`, `chunk-8v60mkqf.js:257582-257586`. Workflow extension: 40 §40.17.2, `chunk-wyjbafrm.js:955010-955011`. Remote-only goal installer: `chunk-r4xrzyvn.js:727810-727815`.

**Internal records that are not stdout:** `permission_retry`, `stop_hook_summary`, `memory_saved`, `agents_killed`, `away_summary`, `thinking`, `file_snapshot`, `scheduled_task_fire`, `turn_duration`, `api_error` have standalone schemas but are not members of the stdout union and are dropped by the headless filter. Likewise arbitrary internal `progress` payloads are not automatically exported. [45 §§45.9.1–2; `chunk-r4xrzyvn.js:722069-722125`]

The dormant `tool_progress.repl_call` converter also has no producer in this build. Bash/PowerShell progress frames require a remote/container condition; heartbeat and subagent-retry frames do not. Hook frames are unconditional for `SessionStart` and `Setup`; other hook events require `--include-hook-events` or remote mode. [45 §§45.14.6, 45.14.8]

### 1.3 Stdin catalogue

| Type | Fields / use |
|---|---|
| `user` | `message:{role:'user',content:string\|blocks}`, `parent_tool_use_id:null`, optional `uuid,timestamp,priority:'now'\|'next'\|'later',shouldQuery,origin`; `session_id` is ignored on input. `shouldQuery:false` appends without starting a turn. Human composer input should explicitly use `origin:{kind:'human'}`. |
| `bash_command` | `command,cwd?,uuid?,session_id?`; direct one-shot shell, no model turn. |
| `control_request` | `request_id,request:{subtype,...}`; host RPC. |
| `control_response` | Success/error envelope answering an engine request. |
| `control_cancel_request` | `request_id`; cancellation of a host-originated request. Only `side_question` and `mcp_call` currently have genuinely cancellable inbound handlers. |
| `keep_alive` | No payload; ignored by receiver. |
| `update_environment_variables` | `variables:Record<string,string>,request_id?`; only `CLAUDE_CODE_SESSION_ACCESS_TOKEN` and `CLAUDE_CODE_OAUTH_TOKEN` are accepted. Nonempty request ID gets a control acknowledgement. Not arbitrary runtime environment mutation. |
| `queued_notification` | Backend-only `notification:{notification_id,origin,content,priority,queued_at}`, optional UUID/session ID; capability gated. |
| `session_notice` | Backend-only `uuid,notice_class,from_session_id,content,isSynthetic:true,inbound_origin:'mcp_session_notice',session_id?`; capability gated. |
| `assistant` | Additionally accepted by transport for history/replay; not an ordinary way to submit user work. |
| `system` | Additionally accepted for history/replay; not an arbitrary command mechanism. |
| `workflow_launch` | Backend workflow handoff/rescue; pointer includes `filestore_path` under `/.workflow/`, `artifact_sha256`, `bundle_size_bytes`; not a general local Workflow RPC. |

The nine published members are the first nine rows; the last three are runtime transport additions. The full `user` schema also accommodates provenance, pasted/file content, plan/summarization metadata and replay fields. Do not copy backend-asserted provenance into normal human input. [45 §§45.7.4, 45.15–16; `chunk-q9jwcw4a.js:691928`, `:691850-691870`; 40 workflow-launch section, `chunk-v476mghm.js:819650-819665`]

### 1.4 Every control request, in both directions

There are **85 distinct subtypes**: 67 published and 18 unpublished. **73 are client-only, 11 agent-only, and one bidirectional (`mcp_message`).** The CLI dispatches 73 inbound subtypes: the 74 client-capable entries minus declared-but-unimplemented `set_color`. [45 §45.17; `chunk-9r9kpwh0.js:278827-278831`, `chunk-r4xrzyvn.js:729532-731006`]

Envelope examples:

```json
{"type":"control_request","request_id":"maws-1","request":{"subtype":"get_status"}}
{"type":"control_response","response":{"subtype":"success","request_id":"maws-1","response":{"sections":[]}}}
{"type":"control_response","response":{"subtype":"error","request_id":"maws-1","error":"...","error_code":"..."}}
{"type":"control_cancel_request","request_id":"maws-1"}
```

IDs are sender-chosen and unique among that sender's pending requests. Persist pending dialog identity by request ID; a reconnect/reinitialize can redeliver requests. Cancels must dismiss stale host UI. Local stdio has no universal RPC timeout; a client-side timeout does not prove that a mutation was not applied. [45 §§45.16, 45.18.3; SDK lines 2700–2728]

**Client → engine.** `U` means no published request schema in this build. Payload examples select the useful fields; these are not replacements for boundary validation.

| Request | Purpose / important input and result |
|---|---|
| `initialize` | Configure prompts, hooks, agents, skills, SDK MCP servers, dialog capabilities and feature opt-ins; returns commands/models/agents/account/current state. |
| `interrupt` | Abort running turn; optional `reason,cancel_queued`; returns `still_queued` and optionally `cancelled`. |
| `set_permission_mode` | `mode,ultraplan?`; validated mode switch, result echoes applied mode. |
| `set_model` | `model?` resets/defaults when omitted/null/default; optional `system_prompt` has snapshot caveats. |
| `set_max_thinking_tokens` | `max_thinking_tokens?,thinking_display?`; runtime budget/on-off/display control. |
| `rename_session` | `title,source?,session_id?`; use `source:'host'` for a human rename. |
| `set_color` | Published `color` setter **has no CLI handler**; unsupported request error. |
| `mcp_status` | Return `mcpServers` connection/tool metadata. |
| `get_context_usage` | `detail:'summary'\|'full'`; categories, current/resolved windows, threshold and attribution breakdown. |
| `get_session_cost` | Return formatted cost `text`. |
| `list_models` | Return model catalogue/capabilities. |
| `get_usage` | `skip_behaviors?`; session costs, subscription/rate limits and behavioral attribution. |
| `get_memory_dialog` | Return memory files/folders, memory listings and auto-memory/dream state. |
| `get_binary_version` | Return `version,buildTime?`. |
| `mcp_call` | Call an MCP `tool` with `arguments?`, timeout/expiry and optional input/output staging; return content/structured content/meta/staging. |
| `file_suggestions` | `query`; return file-completion suggestions and cwd. |
| `rewind_files` | `user_message_id,dry_run?`; restore tracked filesystem checkpoints, or preview changes. |
| `cancel_async_message` | `message_uuid`; remove queued input where still cancellable, return `cancelled`. |
| `read_file` | `path,max_bytes?,encoding?`; read-permission-gated text or base64 for host viewers. |
| `get_workspace_diff` | Return workspace `diff`. |
| `get_plan` | Return `exists,content?,path?`. |
| `seed_read_state` | `path,mtime`; seed valid prior-read state, not an arbitrary write permission. |
| `mcp_set_servers` | Replace dynamic SDK/runtime MCP-server set; return added/removed/errors; does not remove all plugin/config servers. |
| `register_repo_root` | `directory,reload_claude_md?,reload_plugins?,reload_skills?`; register a directory within allowed registration scope. |
| `reload_plugins` | Reload disk plugins; optional `hold_on_cache_impact`; return refreshed commands/agents/plugins/MCP and possible held/cache-impact result. |
| `reload_skills` | Return freshly loaded skills. |
| `reload_output_styles` | Return refreshed output-style names. |
| `mcp_reconnect` | `serverName`; reconnect configured server. |
| `mcp_toggle` | `serverName,enabled`; enable/disable server. |
| `set_mcp_permission_mode_override` | `serverName,mode`; tighten a server to default/auto or clear override. |
| `set_cwd` | `path,trust_accepted?,trusted_directory?`; returns `ok`, `needs_trust`, or `rejected`. |
| `register_device_hooks` | Register leased device hook instance/templates, epoch and held state. |
| `upload_device_hook_template` | Upload `template,digest,content_base64,worker_epoch?`. |
| `message_rated` | `messageUuid,sentiment,surface?,cleared?`; product-feedback telemetry. |
| `stop_task` | `task_id`; stop a supported running/background task. |
| `background_tasks` | `tool_use_id?`; background one foreground task or all eligible foreground tasks. Not a listing request. |
| `apply_flag_settings` | Merge session-only settings layer; null clears a key. Transport-specific restrictions apply. |
| `get_settings` | Return effective settings, sources/applied state/errors; unavailable on redacted connections. |
| `get_hooks_listing` | Return event catalogue, hook listings, policy and errors. |
| `update_settings` | Local-only persistent writer: `localSettings.outputStyle` or `userSettings.effortLevel`, string values, no deletion. |
| `submit_feedback` | Submit feedback/draft and optional transcript; return ID/status/availability. |
| `remote_tools_announce` | Advertise host/device tools, passthrough and plumbing; return adoption/status/protocol/epoch. |
| `list_permission_rules` | Return rules, workspace directories, original cwd, managed-only status and errors. |
| `get_skills_dialog` | Return skills panel data. |
| `get_chrome_dialog` | Return Chrome availability/installation/connection/pairing/defaults/URLs. |
| `get_chrome_browsers` | List paired browser choices. |
| `select_chrome_browser` | `device_id`; choose paired browser. |
| `set_chrome_browser_hints` | Preferred/local device IDs and host-platform routing hints. |
| `get_sandbox_dialog` | Return support, policy locks, mode/dependencies/restrictions/exclusions/fallback state. |
| `get_status` | Return structured status `sections`. |
| `export_conversation` | Return `text,default_filename`; host saves or copies. |
| `claim_session` | Claim a prewarmed `--await-claim` process with cwd/environment/directories/prompts/agents/trust. |
| `turn_handoff` | Cloud-worker turn transfer: messages/tool-use IDs and optional staged context. |
| `mcp_read_resource` | `serverName,uri`; return resource contents. |
| `set_prompt_suggestions_paused` | `paused`; suppress/resume eligible suggestions. |
| `add_directory` U | **Cloud mount staging**, reads `mount_path`; requires additional-directory CLAUDE.md environment support. Not generic local `/add-dir`. |
| `channel_enable` U | Enable/configure a supported channel surface. |
| `claude_authenticate` U | Begin Claude authentication flow. |
| `claude_oauth_callback` U | Supply OAuth callback to pending Claude login. |
| `claude_oauth_wait_for_completion` U | Wait for pending Claude OAuth login completion. |
| `end_session` U | Abort/shut down session and break message loop; optional reason. |
| `fork_conversation` U | Optional `target_message_uuid,title`; persist a fork, return `forked,sessionId,targetMessageUuid?,prefillText?` or error. |
| `generate_session_title` U | `description,persist?`; return generated or existing title; persistence can reuse custom/AI title. |
| `mcp_authenticate` U | Begin MCP server authentication. |
| `mcp_clear_auth` U | Clear MCP authentication material through the engine. |
| `mcp_oauth_callback_url` U | Deliver MCP OAuth callback URL. |
| `poll_event` U | Backend event/poll delivery plumbing, not a generic task-output polling API. |
| `prefetch_attachments` U | Prefetch up to 16 file-attachment descriptors. |
| `remote_control` U | Enable/disable/manage headless Remote Control bridge. |
| `rewind_conversation` U | `target_message_uuid,interrupt_if_running?,last_seen_user_message_uuid?`; truncate live conversation safely. |
| `side_question` U | `question,history?`; one-shot answer outside main conversation, cancellable with progress frames. |
| `stage_file` U | Cloud/remote file staging. |
| `ultrareview_launch` U | Launch supported cloud review flow. |

**Engine → client, plus the bidirectional subtype:**

| Request | Host responsibility |
|---|---|
| `can_use_tool` | Render tool-specific approval/question/plan card; answer allow/deny with optional rewritten input and permission updates. |
| `hook_callback` | Run registered host callback for `callback_id,input,tool_use_id?`; respect issued/deadline data and cancellation. |
| `mcp_message` **both ways** | Relay JSON-RPC `server_name,message`; answer `mcp_response?`. Used for SDK-hosted MCP. |
| `oauth_token_refresh` | Return refreshed `accessToken` or null and optional reason. |
| `host_auth_token_refresh` | Return host `authToken` or null, optionally `materialUnchanged`. |
| `elicitation` | Render MCP form or URL prompt; answer `action:accept\|decline\|cancel`, `content?`. |
| `request_user_dialog` | Render declared `dialog_kind,payload,tool_use_id?`; answer `behavior:completed\|cancelled,result?`. |
| `remote_tool_call` | Execute announced device tool under host policy; request names instance/host/tool/input/envelope/tool-use ID/deadline; return result. |
| `remote_plumbing_call` | Execute announced host plumbing operation with args/deadline; return result. |
| `remote_tools_probe` | Answer remote host/device liveness probe. |
| `remote_tools_reannounce` | Reannounce after worker epoch change within deadline. |
| `remote_control_work_secret` | Supply work secret for requested session ID or null. |

Registry citations: 45 §§45.17–22; `chunk-9r9kpwh0.js:278827-278831`; shared handlers `chunk-kgv54n2e.js:584026-584036`; dispatcher `chunk-r4xrzyvn.js:729532-731006`. Specific directory distinction: `chunk-r4xrzyvn.js:729190-729285`. **Source-detail corrections to the chapter's summary table:** `update_settings` allows two source/key pairs, not only outputStyle; see 45 §45.22.8. The catalogue's published existence of `set_color` does not mean implementation.

`initialize` is optional, but MAWS should send it before user work. A later initialize does not reapply all launch configuration; hooks have ownership/replacement semantics and pending requests can be redelivered. Declare only dialog kinds MAWS can render. An unknown/undeclared dialog must **not** be answered as cancelled: that would falsely mean the person dismissed it. Default dialog expiry is five minutes; `dialogExpiry:'never'` removes the timer. [45 §§45.18, 45.22.13]

### 1.5 `system/init` capability tokens

| Token | Meaning / gate |
|---|---|
| `interrupt_receipt_v1` | Default; interrupt returns `still_queued`. |
| `interrupt_cancel_queued_v1` | Default; `cancel_queued:true` is honored and reports `cancelled`. |
| `msg_lifecycle_v1` | Default; command lifecycle receipts. |
| `queued_notifications` | Conditional backend/local notification-drain capability. |
| `session_notices` | Conditional remote, noninteractive **auto-mode** session with relevant gate and poll channel. |
| `mcp_read_resource_v1` | Present on normal non-redacted headless init. |
| `mcp_tool_ui_meta_v1` | Present on normal non-redacted headless init. |

An explicit capability list can replace the computed list; unknown tokens must be ignored. Features without tokens require version/response/availability checks rather than invented capability names. [45 §45.10.3; `chunk-s1egstww.js:745973`, `chunk-r4xrzyvn.js:724670-724673`]

### 1.6 Child-agent and skill traffic

The internal `progress` case is not a generic progress-to-wire pass-through:

1. `agent_progress` and `skill_progress` go through `fcr`, becoming ordinary top-level `assistant`/`user` records with **non-null `parent_tool_use_id`**.
2. Foreground Agent forwards tool-use/tool-result blocks by default. `--forward-subagent-text` enables its prose and nested progress forwarding.
3. Forked skills already forward substantive kickoff/text/user/assistant records; their behavior is not identical to foreground Agent filtering.
4. Background/asynchronous Agent forwards its own assistant/user blocks regardless of the text-forwarding flag; nested progress still requires the flag.
5. Main `stream_event` is emitted with `parent_tool_use_id:null`; the child converter switches only on assistant/user payloads. **Partial-message opt-in does not provide child token-delta streams.**
6. Unknown progress payloads vanish. Workflow avoids losing all detail through a separate task-progress producer: `workflow_progress` is attached on transitions and, for progress-only batches, at most every ten seconds. `workflow_log` is excluded from it.

[45 §§45.9.4, 45.13; `chunk-7dz9rvcm.js:202040-202095`, `:204241-204252`; `chunk-3qcnxvnw.js:105022-105042`; `chunk-hs2z6qya.js:524813-524838`; 40 §40.17.2, `chunk-ak3102st.js:336592-336602`, `:336710-336712`]

Nested agents are **distinguishable when the parent tool-use chain is observed**: correlate each child stream to its spawning tool-use ID and then that tool-use's parent. Do not flatten everything into “subagent output.” `subagent_type` and `task_description` are labels, not unique identity. `task_started.spawn_depth` helps; full `agentId ↔ parentAgentId ↔ parentToolUseId` lineage is available in sidecars. Missing history/reconnect requires disk backfill.

An asynchronous Agent's launch tool-result closes immediately with `async_launched`; its child records can arrive **after** that result and after a main result. Parent ID is a correlation key, not a positional bracketing guarantee. Child converter output also omits main-path `tool_result_meta`/`is_virtual`, so not all main tool-result metadata survives. [45 §45.9.4]

### 1.7 Resume, fork, rewind, and checkpoints

- **Resume is chiefly launch-time:** SDK `resume`/`continue`/`resumeSessionAt`, CLI `--resume`, `--continue`, `--resume-session-at`. There is no general “resume another session into this running process” RPC. `--resume` accepts UUID/title, `.jsonl` path, or ingress URL, with different ID/load semantics. Bare `--resume` picker is invalid in print mode.
- **Fork:** launch with resume plus `--fork-session`/SDK `forkSession`, or use `fork_conversation` for a persisted live fork. The returned new session ID still needs an appropriately launched/resumed host process. Do not confuse this with `Agent(subagent_type:'fork')`.
- **Conversation rewind:** `rewind_conversation` truncates at a user-message anchor, optionally interrupts first, checks queued/pending/stale state, persists a `last-prompt` rewind anchor and emits reset. Target UUID matching uses the first 24 characters. Supply last-seen user UUID to guard against discarding an unseen later turn.
- **Filesystem rewind:** `rewind_files`/SDK `rewindFiles`, optionally dry-run, restores tracked file checkpoints. Enable checkpointing before edits. It is separate from conversation rewind and does not rewind arbitrary Bash side effects.
- **History:** regular stream messages are not a complete replay/backfill service. Load existing transcript JSONL or use the session-store/mirror surface; reconcile historical vs live records by UUID/chain.
- Cost/model totals can continue from saved transcript totals in **2.1.283**. The older SDK declarations still describe fresh resume totals; trust the pinned binary's behavior, not that stale declaration.

[45 §§45.5.6, 45.11.5, 45.17, 45.22.15; 35 §§35.1–3, 35.10–11; `chunk-r4xrzyvn.js:726141-726232`, `:729938-729975`; SDK lines 2810–2831]

### 1.8 What `--include-partial-messages` adds

It adds raw API `message_start`, `content_block_start/delta/stop`, `message_delta`, `message_stop`, and `ping` inside `stream_event`, plus `system/status:'requesting'`. This enables main-turn incremental text, thinking, and partial tool JSON. Completed `assistant` blocks still follow: avoid rendering both as duplicate permanent messages.

The engine can synthesize close events for interrupted/retracted streams. Refusal fallbacks can retract completed messages through `supersedes`/`retracted_message_uuids`. Treat output as a revisable event log, not append-only rendered text. Preserve thinking signatures/blocks as opaque model content; narration indexes indicate display summaries. The flag does not expose arbitrary in-process progress, raw child token streams, or live Bash output. [45 §§45.12–13; `chunk-r4xrzyvn.js:722007-722018`, `:721938-721994`]

### 1.9 Actual `statusLine` stdin JSON

This is an **in-process TUI-to-command payload**, not a headless stdout message. It is useful as a checklist of what the terminal can know. The actual producer, not only the embedded setup documentation, determines the schema. [41 §41.19.3; `chunk-wyjbafrm.js:917985`, `:894263-894276`, `:894397-894415`]

```ts
interface StatusLineStdin {
  session_id: string;
  transcript_path: string;
  cwd: string;
  scratchpad_dir?: string;
  prompt_id?: string;
  agent_type?: string;
  session_name?: string;
  model: { id: string; display_name: string };
  workspace: {
    current_dir: string;
    project_dir: string;
    added_dirs: string[];
    git_worktree?: string;
    repo?: { host: string; owner: string; name: string };
  };
  version: string;
  output_style: { name: string };
  cost: {
    total_cost_usd: number;
    total_duration_ms: number;
    total_api_duration_ms: number;
    total_lines_added: number;
    total_lines_removed: number;
  };
  context_window: {
    total_input_tokens: number;
    total_output_tokens: number;
    context_window_size: number;
    current_usage: null | {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens: number;
      cache_read_input_tokens: number;
    };
    used_percentage: number | null;
    remaining_percentage: number | null;
  };
  exceeds_200k_tokens: boolean;
  prompt_cache?: {
    warm: boolean;
    caching_observed: boolean;
    ttl: unknown; // Setup docs say '5m' | '1h'; producer is not schema-validated here.
    expires_at: number | null;
    requests: number;
    misses: number;
    expected_rebuilds: number;
    hit_ratio: number | null;
    cache_write_tokens: number;
    miss_recache_tokens: number;
    last_miss_at: number | null;
    last_miss_cause: null | {
      causes: string[];
      tools_added?: number;
      tools_removed?: number;
      system_char_delta?: number;
    };
    miss_causes: Record<string, number>;
    recache_tokens_if_cold: number | null;
  };
  fast_mode: boolean;
  effort?: { level: 'low' | 'medium' | 'high' | 'xhigh' | 'max' };
  thinking: { enabled: boolean };
  rate_limits?: {
    five_hour?: { used_percentage: number; resets_at: number };
    seven_day?: { used_percentage: number; resets_at: number };
    spend_limit?: { used_percentage: number; resets_at: number };
  };
  vim?: { mode: string };
  agent?: { name: string };
  remote?: { session_id: string };
  pr?: { number: number; url: string; review_state?: string; kind?: 'mr' };
  worktree?: {
    name: string; path: string; branch?: string;
    original_cwd: string; original_branch?: string;
  };
}
```

Important details:

- No `hook_event_name`, `permission_mode`, or `agent_id` survives this invocation's serialization. The documented `agent.type` is **not produced**; the real field is top-level `agent_type`.
- `context_window.total_input_tokens`/`total_output_tokens` derive from the last API usage object here, despite “total” in the names; do not substitute cumulative session accounting.
- `rate_limits.*.resets_at` and prompt-cache expiry times are epoch seconds; `/usage` utilization responses use ISO reset strings. Status-line quota is a projection of response-header state, not the persisted usage-query snapshot.
- The status command receives one JSON line and can emit multiple ANSI-bearing stdout lines. Settings are `{type:'command',command,padding?,refreshInterval?,hideVimModeIndicator?}`. Execution needs trust and hooks enabled; refresh is state-driven/debounced, with optional periodic refresh. It is not a native cwd/model/git footer segment.

[41 §§41.15.4, 41.19.1–6; 08 §13.1; `chunk-wyjbafrm.js:894265`, `:919884-919921`]

## Part 2 — Gap matrix

Notation: **A/U** means normal `assistant.message.content[].tool_use` and `user.message.content[].tool_result`, joined by tool-use ID, with `user.tool_use_result` for the structured output. **Tool-driven** means the model invokes the built-in tool; there is no implied host-side `execute_builtin_tool` RPC. In every row, MAWS owns the visual component.

Disk shorthand uses `C = CLAUDE_CONFIG_DIR || ~/.claude`, `P = C/projects/<project-key>`, `S = session ID`. The project key is engine-derived; prefer discovered paths over inventing a slug. Paths apply to the local filesystem backend; storage-v5 does not guarantee identical physical layout. [35 §§35.1–3; A3 §§A3.1.3, A3.2]

| # | GUI feature | Observe over wire | Control over wire | Missing part / best alternative | Rating |
|---:|---|---|---|---|---|
| 1 | Session start with cwd | `system/init.cwd,session_id`; initialize current state | Launch `cwd`; `set_cwd` returns canonical cwd/trust/rejection | MAWS must render trust for exactly the returned directory; no TUI trust-dialog emulation. [45 §§45.10,45.22.6] | wire-complete |
| 2 | Additional directories / add-dir | `list_permission_rules.state.workspaceDirectories`, settings | Launch `additionalDirectories`/`--add-dir`; permission/settings updates; scoped `register_repo_root` | `/add-dir` is not universally noninteractive: its local twin is remote-client conditional. Raw `add_directory` is mount staging, not local add-dir. Persistent settings use the config writer/editor. [24 §24.12;28 §5;45 §45.17; `chunk-r4xrzyvn.js:729190-729285`] | wire-complete |
| 3 | Resume and history | New init/result plus live A/U; historical records where replayed | SDK/CLI launch resume/continue/resume-at | Tail/load `P/S.jsonl` for history, titles and anchors; there is no general running-process resume RPC or guaranteed full stdout history. [35 §§35.1–3,35.10;45 §45.5.6] | wire-partial |
| 4 | Conversation fork | `fork_conversation` response includes new ID/anchor | `fork_conversation`; launch resume+forkSession | Open a new engine session for the returned ID; distinct from fork subagents. [45 §45.17; `chunk-r4xrzyvn.js:726410-726465`] | wire-complete |
| 5 | Rewind / checkpoint restore | Rewind response, reset, dry-run file change list | `rewind_conversation`; separate `rewind_files` | Orchestrate conversation/files choices, checkpoint enablement and UI history. `C/file-history/S/` holds backups; JSONL snapshots anchor message IDs. Not arbitrary shell/VCS undo. [35 §35.15;45 §45.22.15] | wire-partial |
| 6 | Streaming assistant text and thinking | `stream_event.event`, completed assistant blocks, narration metadata, thinking-token estimate | Partial-message/display launch options and runtime thinking control | Honor retractions and empty/redacted thinking; do not promise raw hidden reasoning. [45 §§45.12–13] | wire-complete |
| 7 | Tool pairing, images, large results | A/U IDs, content arrays, full `tool_use_result`, denial/remedy metadata | Normal tool permission round trip; `read_file` for referenced content | Spills need lazy reads: `P/S/tool-results/<toolUseId>.txt` or `.json`; Bash exposes `persistedOutputPath/Size`, with 64-MiB retained cap. Image/document-bearing result blocks are not generically spilled. [12 §§12.11–12.12.5;16 §16.13;35 §35.2] | wire-partial |
| 8 | Tool permissions / Always Allow | `can_use_tool` with input, suggestions, reason, tool/agent ID and UI safety flags | Answer allow/deny; allow may carry `updatedInput,updatedPermissions`, `decisionClassification` | `addRules` destination controls permanence: session vs user/project/local settings. Respect `suppress_always_allow_rule`, `default_to_no`, `matched_ask_rule`, `requires_user_interaction`; no blanket approve UI. [45 §45.19;24 §§24.15–16] | wire-complete |
| 9 | Mid-session default/acceptEdits/plan/auto/bypass/dontAsk | Init permissionMode, `system/status.permissionMode`, RPC result/error code | `set_permission_mode` | Bypass needs launch availability and policy; auto has model/settings/gate restrictions. Do not silently substitute modes. [45 §45.22.3;24 §24.2] | wire-complete |
| 10 | Complete auto-classifier decision trace | Denials via `permission_denied`, authoritative denied-tool list; escalation via `can_use_tool`; allow only inferred from execution | `set_permission_mode`; permission callbacks for actual asks | **No complete successful-verdict stream.** Logs/hooks are not an equivalent stable audit stream for every classifier decision; add an engine event if exact classifier reasoning/outcome attribution is required. [26 §§26.6–7;45 §§45.14.3,45.19] | needs-patch |
| 11 | AskUserQuestion | A/U plus `can_use_tool(tool_name:'AskUserQuestion',input,requires_user_interaction:true)` | Allow with input plus `answers` and optional `annotations`; deny with feedback | Render 1–4 questions, multiselect, free text and safe previews. Preview-card behavior differs from ordinary Other choices. SDK `toolConfig.askUserQuestion.previewFormat` supports markdown/html; extended-question options in the spec are not declared in SDK 0.3.259. [21 §12; SDK 1560–1569,2324–2372] | wire-complete |
| 12 | ExitPlanMode / plan approval | A/U, tool-specific `can_use_tool`, `get_plan`, mode/reset frames | Answer approval; `set_permission_mode`, reset/new-turn orchestration | Native “clear context and implement” is not a simple allow: it denies original call and seeds a fresh turn. Bare allow restores pre-plan mode, not whichever GUI option MAWS displayed. Read plan file via reported path if needed. [21 §§6–7;45 §45.19] | wire-partial |
| 13 | Subagent dispatch and nested identity | Agent A/U, parent tool IDs, task-start/depth metadata | Tool-driven `Agent`; definitions via launch/initialize | With text forwarding, correlate nested tool-use graph rather than labeling all children alike. Standard nesting/depth/model gates still apply. [18 §§18.14,18.20;45 §45.9.4] | wire-complete |
| 14 | Subagent live transcripts | Child assistant/user blocks with parent IDs; task progress | `forwardSubagentText`; normal Agent/SendMessage work | No child raw token-delta feed. Backfill `P/S/subagents/agent-<id>.jsonl` and `.meta.json`; fork-context references must resolve parent prefix. Child denial metadata can be lost by converter. [18 §18.25;35 §35.2;45 §45.9.4] | wire-partial |
| 15 | Message a running local subagent | SendMessage A/U and subsequent child records | Tool-driven `SendMessage` | No standalone host `send_subagent_message` RPC. Keep agent addressing/identity from tool results; a text prompt to the main model is not a deterministic direct-send API. An app-owned agent mailbox is a separate implementation. [18 §18.26] | wire-partial |
| 16 | ListAgents within session | ListAgents structured tool result | Tool-driven `ListAgents` | No direct list-live-agents control. Combine observed task registry with sidecar lineage for a passive GUI list; do not confuse initialize's agent definitions with running agents. [18 §18.26.3;45 §45.18.4] | wire-partial |
| 17 | Fork subagents | Agent A/U, parent IDs; sidecar `isFork` | `Agent(subagent_type:'fork')` when exposed | Off by default in headless/SDK; `CLAUDE_CODE_FORK_SUBAGENT=true` enables eligible local fork mode. Same model/history/tools, separate thread; recursive/remote-isolated forks refused. No patch required for that documented launch choice. [18 §18.20; `chunk-wyjbafrm.js:898724-898748`] | wire-complete |
| 18 | Background agents | Async launch result, task lifecycle/progress/notification, child records after launch result | Agent `run_in_background`; `background_tasks`; `stop_task` | Treat completion as possibly interim when a resumed/parked agent still owns keepalives. Do not end display at parent tool-result. [18 §18.23;20 §§20.8–10;45 §45.9.4] | wire-complete |
| 19 | Background Bash and Monitor live output | A/U, task lifecycle, Monitor event notifications; tool_progress is not stdout | Tool-driven Bash `run_in_background`, Monitor when available; `background_tasks`,`stop_task` | Tail reported `output_file` under temp `claude-<uid>/<cwd-slug>/S/tasks/`, not `C/tasks/`. Monitor is feature/platform gated. Local Bash elapsed progress is not universally emitted. [20 §§20.9,20.13;45 §45.14.8] | wire-partial |
| 20 | TaskOutput, TaskStop, task notifications | Task terminal/progress events, `output_file`, summaries | `stop_task`/TaskStop; Read/app file viewer | **TaskOutput and aliases are removed in 2.1.283.** Replace with output-path viewing/tailing; do not build an obsolete polling control. TaskStop IDs are runtime task IDs, not checklist IDs. [20 §§20.11–12; `chunk-wyjbafrm.js:886887`] | wire-partial |
| 21 | TaskCreate/Update/List checklist | A/U structured task fields | Tool-driven checklist tools | Watch `C/tasks/<list-id>/<decimal-id>.json`; separate from runtime background tasks. Shared list may be env/team/session selected; `.lock` and `.highwatermark` exist. No dedicated change-subscription/CRUD RPC. [20 §§20.1–3;A3 §A3.2.2] | wire-partial |
| 22 | Workflow phases, agents, transcripts, full controls | Task lifecycle and runtime `task_progress.workflow_progress`; phase/agent rows; launch returns run/transcript paths | Tool-driven Workflow; `stop_task`; resume through `Workflow({scriptPath,resumeFromRunId})` | Tail snapshot/journal/agent JSONL for logs/backfill. **Native pause, skip-one-agent and retry-one-agent are in-process controller operations with no host RPC.** Stop+resume is not identical. [40 §§40.15–18; `chunk-gmy8ye92.js:494849-494885`] | needs-patch |
| 23 | `/btw` side questions | `control_request_progress`, final side-question response | `side_question{question,history?}`; cancel request | `/btw` itself is noninteractive-ineligible local-jsx; use the RPC, not user slash text. Does not alter main conversation. [28 §5;45 §45.22.11] | wire-complete |
| 24 | Queued/steered user messages | `command_lifecycle`, replayed users, result user UUID lists and queued count, optional preemption | Send UUID-stamped `user` while running, priority/shouldQuery; `cancel_async_message`; rapid-followup initialize opt-in | Multiple sends can coalesce/fold into one turn. Bind by UUID lists, not one send/one result. [45 §§45.11.4,45.15.1,45.22.9] | wire-complete |
| 25 | Interrupt / Stop | Interrupt receipt, lifecycle cancellations, eventual result/state | `interrupt{cancel_queued:true}` for Stop-everything user sends; plain interrupt preserves queued input | Receipt scope is main-thread queue; engine handles prewait latch. Do not infer process exit from a successful interrupt. [45 §45.22.1] | wire-complete |
| 26 | Model, effort, thinking switching | Init/current-model response; effort/fast state and errors; partial thinking-display metadata | `set_model`; `apply_flag_settings{settings:{effortLevel:...}}`; `set_max_thinking_tokens` | No dedicated `set_effort`. Binary supports `highlights` display, SDK 0.3.259 typed method only summarized/omitted. Snapshot prompt updates may wait until compaction. [45 §§45.22.4–7; SDK 2635–2682] | wire-complete |
| 27 | `/fast` | Init/result `fast_mode_state,fast_mode_disabled_reason` | `/fast [on|off]` is noninteractive-capable; `apply_flag_settings.fastMode` where supported | Account/model/SDK opt-in restrictions are state, not missing protocol. [28 §5;45 §§45.10,45.22.7] | wire-complete |
| 28 | Context usage and autocompact threshold | `get_context_usage` response including threshold/enabled/source; `autocompact_state` only remote | `get_context_usage{detail:'summary'|'full'}`; applicable settings | Poll summary for a local GUI; full analysis may call token-count API. Do not hardcode 80%: compaction window/reserve/threshold/source and reactive mode matter. [13 §§13.2,13.4–5,13.18,13.21;45 §45.17] | wire-complete |
| 29 | Compaction events, `/compact`, `/context` | `status`, `compact_boundary`, assistant `context_usage`/command output | `/compact` and `/context` are noninteractive-capable; context RPC | Show failed compaction and preserved-message ranges. Threshold is not a guarantee the engine compacts exactly there under reactive mode. [13;28 §5;45 §45.14.5] | wire-complete |
| 30 | Usage/rate limits: 5h/7d/reset | `rate_limit_event` plus `get_usage` full structured report | `get_usage`; `/usage` noninteractive twin | Use engine polling first. Endpoint fallback is OAuth subscriber/profile-scoped `GET /api/oauth/usage` and at-wall/cedar variants; handle cache/stale state and null non-subscriber limits. [08 §13;45 §45.17;SDK 2765–2777] | wire-complete |
| 31 | Cost per turn | Cumulative `result.total_cost_usd/modelUsage`; per-turn main-only `usage` | `get_usage`/`get_session_cost` for latest accounting | Difference cumulative samples, retaining restored baseline and resetting on clear. Excludes classifier/token-probe helpers; estimate, not invoice. [45 §45.11.5] | wire-complete |
| 32 | Session title, aiTitle/customTitle, rename | Rename/generate responses; not a comprehensive spontaneous-title event | `rename_session`, `generate_session_title`, initialize title; `/rename` noninteractive | Backfill/watch JSONL `custom-title`/`ai-title` and `P/S/custom-title.json`; custom precedes AI. Don't treat session_metadata.artifacts as title metadata. [35 §§35.5,35.11;45 §45.17] | wire-partial |
| 33 | Slash-command and skill autocomplete | Init lists; initialize `commands` descriptions/hints/aliases; `commands_changed`; skill dialog/reload output | initialize/reinitialize, `reload_skills`,`reload_plugins`,`get_skills_dialog` | Hide terminal-oriented entries and don't assume every discovered command has a headless action. [45 §§45.10.2,45.18.4] | wire-complete |
| 34 | Custom slash command / Skill | A/U Skill calls/results; injected/forked-skill traffic | User `/custom-command args`, tool-driven `Skill` | Prompt commands are allowed unless disableNonInteractive; honor discovery/invocation permissions. Forked skills use child progress route. [28 §§5,20–22;23 §23.7;45 §45.9.4] | wire-complete |
| 35 | `/plugins` content and management | Init plugins/errors, install progress, reload result | `reload_plugins`; tool-driven supported plugin tools | `/plugins` aliases local-jsx `/plugin`: not headless. Read `C/plugins/` manifests/installed state and use supported `claude plugin` commands for management; app panel owns editing/installation UI. [28 §5;30;A3 §A3.2] | wire-partial |
| 36 | `/mcp` panel content | `mcp_status`, init servers/errors, MCP metadata | mcp reconnect/toggle/set/call/auth controls; `/mcp` noninteractive twin | Host renders panel and OAuth browser flow; no TUI replication required. [28 §5;45 §§45.17,45.21] | wire-complete |
| 37 | `/config` content / arbitrary settings editing | `get_settings{effective,sources,applied,errors}` | `apply_flag_settings`; limited `update_settings`; `/config key=value` noninteractive twin | General durable CRUD/deletion is not a general wire setter. App editor for `C/settings.json`, project `.claude/settings.json`/`.local.json`, preserving policy/source semantics; engine watcher reloads. [28 §5;45 §§45.22.7–8;24 §24.8] | wire-partial |
| 38 | `/status` content | `get_status.sections` | `get_status` | Slash `/status` is panel-only; structured RPC is available. [28 §5;45 §45.22.17] | wire-complete |
| 39 | `/doctor` diagnostics | Normal assistant/tool stream from bundled diagnostic skill | `/doctor` (`checkup`) is a noninteractive-capable prompt skill unless disabled | It is a model-driven diagnostic flow, not a machine status schema. [28 §20; `chunk-cajb2b5v.js:390418`] | wire-complete |
| 40 | `/sandbox` content and settings | `get_sandbox_dialog` support/mode/policy/restrictions | Session settings where supported; no native panel RPC action set | Slash is panel-only. Durable sandbox editing belongs to app settings workflow; honor locked fields and backend capability. [28 §5;45 §45.17;17] | wire-partial |
| 41 | `/permissions` content and rule management | `list_permission_rules`; permission requests/denials | Mode control, permission response updates, session flag settings | Slash panel not headless; standalone durable rule CRUD/editor uses settings files, not fabricated can_use_tool responses. [24 §§24.15–16;28 §5;45 §45.17] | wire-partial |
| 42 | `/hooks` content and management | `get_hooks_listing`; hook lifecycle | initialize host callbacks/device registration; reload/settings flow | Slash panel not headless. Persistent hook definition CRUD needs app config editor; do not confuse registered host callbacks with all disk hooks. [27;28 §5;45 §§45.17,45.20] | wire-partial |
| 43 | `/agents` content / authoring | initialize `agents` is definitions; task/list tools are running instances | `/agents` noninteractive stub directs editing; definitions accepted at launch | Wizard was removed. Implement definition editor for project `.claude/agents/*.md`, `C/agents/*.md` and plugin definitions; restart/reload on supported paths. [18;28 §25.7; `chunk-wyjbafrm.js:938857-938864`] | app-side |
| 44 | `/memory` content and editing | `get_memory_dialog`, init memory_paths, memory_recall; `read_file` | Read/control listing; ordinary authorized file tools or app editor | `/memory` panel is not headless. Files/folders come from engine; use reported paths, not a guessed single memory file. [28 §5;45 §45.17;35/A3] | wire-partial |
| 45 | MCP server status/reconnect | `mcp_status` full status; init summaries | `mcp_reconnect`,`mcp_toggle`,`mcp_set_servers`, authentication controls | Availability/auth failures are reported; dynamic-set semantics retain plugin/config ownership. [45 §§45.17,45.21;SDK 2840–2880] | wire-complete |
| 46 | MCP elicitation and resources | `elicitation`, `elicitation_complete`; resource results/links | Elicitation response; `mcp_read_resource`; SDK-hosted `mcp_message`; resource tools | Implement form/URL human interaction. No-handler SDK path declines; never auto-accept unspecified fields. [45 §§45.21,45.22.13;31] | wire-complete |
| 47 | Hooks lifecycle frames | hook_started/progress/response with IDs/output/outcome | includeHookEvents flag; host hook_callback responses | SessionStart/Setup already emit; other events opt-in. This is not arbitrary internal hook-progress forwarding. [45 §§45.14.6,45.20] | wire-complete |
| 48 | SendUserFile / agent-delivered files | A/U input includes paths/caption/status/display; result success/partial/error; related persistence/resource metadata where produced | Tool-driven SendUserFile when eligible | Remote/desktop/bridge/provider/policy gate can exclude tool. MAWS needs file-card/read/open/attach integration or its own file-delivery tool on unsupported local surface; `files_persisted` alone is insufficient. [23 §23.4.2; `chunk-v3kwteqa.js:819167-819270`] | wire-partial |
| 49 | PushNotification | Tool A/U outcome `pushSent/localSent/disabledReason`; ordinary system notifications | Tool-driven push only when provider/config/transport gates allow | Implement MAWS's OS notification policy and delivery. Existing tool's mobile backend is not a generic desktop push API; no-op outcomes are normal. [23 §23.4.3;50; `chunk-c8gdp9zd.js:387832-387878`] | app-side |
| 50 | Enter/ExitWorktree and settings | A/U worktree outputs/cwd; later init; settings; transcript/sidecars | Tool-driven EnterWorktree/ExitWorktree; launch worktree; session settings | App UI manages keep/remove/discard confirmations and persistent settings. `worktree.{symlinkDirectories,sparsePaths,baseRef,bgIsolation}` are engine settings; `worktree.location` is Desktop-only, ignored by CLI. [23 §23.3;47 §§47.11,47.15] | wire-partial |
| 51 | Git branch/status in prompt / toolbar | `vcs_state_changed`, code-change events, tool results are partial signals | No full generic git-state subscription RPC | Run read-only Git queries/watch repository in app. Engine prompt snapshot includes branch/status/log and is not a live GUI status service. [47 §§47.2–3; `chunk-wyjbafrm.js:878480-878499`] | app-side |
| 52 | `/diff` | `get_workspace_diff.diff` | `get_workspace_diff` | `/diff` itself is noninteractive-ineligible; GUI draws diff and handles local file opening. [28 §5;45 §45.17] | wire-complete |
| 53 | `/export` | `export_conversation{text,default_filename}` | `export_conversation` | `/export` slash panel is not headless; host owns save/clipboard dialogs. [28 §5;45 §45.17] | wire-complete |
| 54 | Voice | Only final submitted user text appears on headless conversation stream | Submit transcribed text as normal user message | Mic capture, interim transcript, PTT/tap state and accessibility are app-side. `/voice` is explicitly not noninteractive; native engine voice uses OAuth WebSocket, 16-kHz mono PCM. [43 §§1,4; `chunk-hzevqd7x.js:558702-558722`] | app-side |
| 55 | EndConversation / close session | Tool A/U if exposed; result/abort/session state | Tool-driven two-step EndConversation; GUI close uses `end_session` | EndConversation is gated, reflective and two consecutive calls, not a universal close button. Wire shutdown does not need that tool. [23 §23.6.1;45 §45.22.2] | wire-complete |
| 56 | Cross-session SendMessage/ListAgents and held-message approval | Tool results, user peer provenance, `peer_message_hold`; no content/approval card in that advisory | Tool-driven messaging; local authenticated socket protocol; policy changes are broader configuration | Read `C/sessions/<pid>.json` for discovery. **No per-message approve/deny RPC for headless holds.** Parity holds expire by default after 5min. A broad `crossSessionInbound:'accept'` is not equivalent to reviewing one message. `C/channels` is not a harness-written session inbox. [38 §§38.18–19,38.22.6,38.27] | needs-patch |
| 57 | Teams and fleet | Team/Agent/SendMessage A/U and task events, but not full roster/fleet UI | Tool-driven team operations; stop/runtime controls | Watch `C/teams/<slug>/config.json`, team inbox JSON arrays, shared `C/tasks/<team>/`; Fleet detached jobs use `C/jobs/<session-prefix>/state.json,timeline.jsonl,pins.json`. Teams are opt-in; Fleet is not teams or the session task registry. [39 §§39.1–5,39.32;20 §20.15;A3] | wire-partial |
| 58 | CronCreate / scheduled loops / `/loop` | Cron/tool A/U; resulting user turns/notifications; no scheduled_task_fire stdout | Tool-driven CronCreate/List/Delete; `/loop` is noninteractive-capable prompt skill | Durable jobs in project `.claude/scheduled_tasks.json` plus lock. In-memory jobs/wakeups need reconstruction from tool events; disk alone misses them. `/loops` panel is always disabled. [22 §§22.2–14,22.27;28 §§5,20;45 §45.9.1] | wire-partial |
| 59 | `/goal` | Command output; `active_goal` only on remote-gated installer | Headless `/goal` local twin when available | For ordinary local SDK session, recover `goal_status` transcript records; no general goal-state query/event installed locally. Do not enable remote mode just for this event. [22 §§22.21–25;28 §5; `chunk-r4xrzyvn.js:727810-727815`] | wire-partial |
| 60 | Artifacts and DesignSync | A/U typed tool data; `session_metadata.metadata.artifacts`, URLs/resource links | Tool-driven Artifact family/DesignSync when exposed | App owns safe preview/browser/comments integration and external authorization. Gated services are not generic local attachments; mutating DesignSync uses prior planId. Disk/resource URLs supply assets, not a universal artifact-state RPC. [23 §23.13;44;45 §45.9.1] | wire-partial |
| 61 | ReportFindings review UI | A/U structured findings, file/line/summary/failure scenario/category/verdict | Tool-driven ReportFindings under review contract | Render structured review list; no dedicated stdout ReportFindings type. Maximum 32 findings; tool is not a generic final-response type. [21 §13; `chunk-t4yyetdp.js:774418-774432`] | wire-complete |
| 62 | StructuredOutput | Structured tool call/result plus `result.structured_output`; retry-limit errors | Launch JSON schema / initialize jsonSchema | Schema validation is engine-owned. Ordinary JSON-looking text is not StructuredOutput. [45 §45.24;23 §23.6.2] | wire-complete |
| 63 | request_user_dialog and generic elicitation | Engine control_request with kind/payload or MCP form/URL schema | Declare supportedDialogKinds, answer completed/cancelled; elicitation accept/decline/cancel | Only claim implemented kinds; unknown kind must not be falsely cancelled. Request IDs, timeout/cancel/reconnect must be respected. [45 §45.22.13;SDK 1630–1652,4320–4329] | wire-complete |
| 64 | Remote tools / remote_tool_call | Control calls, tool-host result lines, regular tool records | Announce tools, answer calls/plumbing/probes/reannounce; device hook registration where needed | MAWS must implement the host role, deadlines and policy; catalogue presence does not override deployment gates or local credential policy. [45 §§45.17,45.14.9;31/37] | wire-complete |
| 65 | Bash mode `!` / stdin bash_command | Replayed user command/output frames, no model turn | `bash_command{command,cwd?,uuid?}` | Unlike TUI `!`, output is not appended to transcript and no persistent shell state survives. It bypasses model/sandbox/per-command prompt; expose only as explicit human terminal action. App must separately own terminal history/context-attachment semantics. [45 §45.15.2;42] | wire-partial |
| 66 | keep_alive and environment refresh | Heartbeat; optional env-update control acknowledgement | keep_alive; allowlisted update_environment_variables | Ignore heartbeats for progress. Only two auth/session token variables allowed; no generic env-setting API. [45 §45.15.3] | wire-complete |
| 67 | Exact custom statusLine parity | Many ingredients available from init/context/usage/settings; no complete status-line payload event | No export/execute-statusline RPC | App can build a better toolbar and run compatible commands with a documented subset. **Exact internal prompt-cache diagnosis/ledger and full producer payload require an added read-only snapshot/event**, not guessed values. [41 §41.19.3;45 catalogue] | needs-patch |

### 2.1 High-value implementation details behind the matrix

#### Permission and question round trips

The wire response is:

```ts
type PermissionAnswer =
  | {
      behavior: 'allow';
      updatedInput?: Record<string, unknown>;
      updatedPermissions?: PermissionUpdate[];
      toolUseID?: string;
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject';
    }
  | {
      behavior: 'deny';
      message: string;
      interrupt?: boolean;
      toolUseID?: string;
      decisionClassification?: 'user_temporary' | 'user_permanent' | 'user_reject';
    };
```

“Always allow” is a real `updatedPermissions` update, not a remembered checkbox in MAWS. Use the engine's suggested rule shape and appropriate destination; `decisionClassification` describes provenance for telemetry and does not itself persist a rule. `result.permission_denials` is authoritative; `system/permission_denied` is best-effort and misses pre-prompt denial paths. [45 §§45.19.2–3,45.14.3]

AskUserQuestion is **can_use_tool**, not request_user_dialog. Return question-text-keyed `answers` in rewritten input, with annotations for preview/notes where supported. A generic approve click without answers does not implement the question. Native previews have safety/length/layout differences; render HTML previews isolated from Electron privileged APIs. ExitPlanMode is likewise tool-specific permission interaction, but requires explicit MAWS orchestration for the richer clear-and-implement choices. [21 §§6–7,12]

#### Workflow progress is not wholly missing

`workflow_progress` is a runtime field absent from the published task-progress schema. Its entries include:

```ts
type WorkflowProgress =
  | { type: 'workflow_phase'; index: number; title: string; kind?: 'child' }
  | {
      type: 'workflow_agent'; index: number; label: string;
      phaseIndex?: number; phaseTitle?: string; agentId?: string; agentType?: string;
      isolation?: 'worktree' | 'remote'; remoteSessionId?: string;
      model?: string; fallbackModel?: string;
      state: 'start' | 'progress' | 'done' | 'error';
      blocked?: boolean; skipped?: boolean; cached?: boolean; error?: string;
      queuedAt?: number; startedAt?: number; lastProgressAt?: number; durationMs?: number;
      tokens?: number; toolCalls?: number; attempt?: number; lastAttemptReason?: string;
      lastToolName?: string; lastToolSummary?: string;
      promptPreview?: string; resultPreview?: string;
    };
```

Internal `workflow_log` entries are not in that wire projection. Read `P/S/workflows/<runId>.json` for snapshot/log history; `P/S/subagents/workflows/<runId>/journal.jsonl` records launched/started/result/failed entries and adjacent agent JSONL/sidecars hold transcripts. Snapshot paths are code-derived in the spec, not confirmed by a running MAWS fixture. [40 §§40.15–17; `chunk-bnxe9qjb.js:382785-382820`, `chunk-ak3102st.js:335128-335218`]

#### Quota and cost do not require a second auth implementation

`get_usage` already provides the engine's structured usage report; SDK 0.3.259 names its wrapper `usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET()`. Its instability is a versioning concern, not evidence that the engine has no quota API.

For reference, the underlying subscriber/profile-scoped endpoints are:

```text
GET /api/oauth/usage
GET /api/oauth/usage?at_wall=1&skip_spend=1
GET /api/oauth/usage?cedar_ember=1&skip_spend=1
```

They use a five-second timeout and one OAuth-refresh/retry on 401. Expected response windows include five_hour, seven_day, OAuth-app/Opus/Sonnet windows and newer limits/extra_usage fields. The cache in `~/.claude.json.cachedUsageUtilization` is `{fetchedAtMs,accountUuid?,utilization}`; a matching under-one-minute snapshot can satisfy another request, while an older fallback seed can be accepted up to one hour. Surface unavailable/stale information honestly. [08 §§13.1–13.1.1; `chunk-hzevqd7x.js:550384-550409`, `chunk-wyjbafrm.js:887904-887938`]

For cost, never sum successive `result.total_cost_usd` or `modelUsage`; they are cumulative. `result.usage` is per-turn **main loop only**. Background/auxiliary query-pipeline calls are included in model totals, but permission-classifier and token-count probes outside that pipeline are not. A delta between samples measures spend in that interval; concurrent background work makes exclusive attribution to a single visible user turn imperfect. [45 §45.11.5]

## Part 3 — Recommended integration mechanisms and patch boundary

### 3.1 Smallest useful app-side mechanism set

**1. One versioned engine adapter in Electron's privileged process.**

Own process lifetime, NDJSON framing, request IDs, cancellation, pending human interactions, queue receipts, version/capability discovery and unknown-field retention. Normalize raw events into a graph keyed by session ID, message UUID, API message ID, tool-use ID, task ID and agent ID. Do not flatten those into one identifier. Pin the executable version and separately track the SDK version.

Use public SDK helpers where they faithfully expose the needed operation, but do not make its TypeScript union the protocol's completeness boundary. The 0.3.259 public Query interface lacks wrappers for many 2.1.283 controls. Either own the raw transport or build one deliberate extension layer; avoid competing uncontrolled writers on the SDK's stdin. Record unrecognized frames for compatibility diagnosis without discarding the whole session.

**2. One filesystem state service, combining a watcher and JSONL tailers.**

It closes most read-side wire-partial gaps:

| Store | Read purpose / format |
|---|---|
| `C/projects/<project-key>/<S>.jsonl` | Main transcript, titles, goal status, compaction/rewind anchors and backfill; JSONL. [35] |
| `P/S/custom-title.json` | Durable title sidecar. [35 §35.5] |
| `P/S/subagents/agent-<id>.jsonl` plus `.meta.json` | Child transcript and lineage/model/worktree metadata. [18 §18.25;35] |
| `P/S/tool-results/*.{txt,json}` | Full retained spilled tool results; lazy-load, don't eagerly ingest. [12 §12.12.5] |
| Reported temp `.../tasks/<taskId>.output` | Live background shell/monitor output; may be an agent-transcript symlink. [20 §20.9;A3 §A3.7] |
| `C/tasks/<list-id>/<id>.json` | Persisted checklist, distinct from runtime task lifecycle. [20 §20.2] |
| `P/S/workflows/<runId>.json` and `subagents/workflows/<runId>/...` | Workflow snapshot/logs/journal/per-agent history. [40 §§40.15–16] |
| `C/sessions/<pid>.json` | Live peer discovery; separate authenticated socket protocol for delivery. [38 §38.18] |
| `C/teams/.../config.json`, `inboxes/*.json` | Team roster and mailbox arrays; roster/inbox slug functions differ. [39 §§39.4–5] |
| `C/jobs/<session-prefix>/state.json`, `timeline.jsonl`, `pins.json` | Detached fleet/background-session state. [20 §20.15;39 §39.32] |
| Project `.claude/scheduled_tasks.json` | Durable cron jobs only; not all in-memory timers. [22 §22.5] |
| User/project/local settings, agent/skill/plugin files | Definition/configuration management with explicit reloads. [24,27–30;A3] |

Respect `CLAUDE_CONFIG_DIR`, engine-provided paths, no-persistence sessions and storage-v5. Use append-aware JSONL parsing, tolerate a partial final line, deduplicate IDs, and rebuild from the persisted anchor after rewind/reset. Filesystem observation should not mutate engine-owned locks/mailboxes/journals to simulate missing control APIs.

**3. Sample the engine's structured read APIs rather than clone its internals.**

Poll `get_context_usage{detail:'summary'}` and `get_usage{skip_behaviors:true}` at a modest UI-driven cadence; use full context analysis on demand. Refresh settings/status/MCP/rules/dialog data when the relevant panel opens or a known change occurs. Use raw rate-limit events for immediate feedback, then structured queries for complete windows. Prefer these over direct OAuth endpoint polling; no separate token-copying implementation is needed for the normal local host.

**4. Implement host interaction and desktop integrations once.**

A request router handles tool permission cards, AskUserQuestion, plan approval, declared generic dialogs, MCP elicitation, host hooks, remote tools and cancellation/reconnect. A small desktop-services layer owns file previews/save/open/clipboard, notifications, microphone dictation, read-only Git state and settings/definition editors. Unsupported built-in SendUserFile/PushNotification surfaces can be replaced by explicitly app-owned tools where appropriate, rather than falsifying engine capability or silently changing permission policy.

These are four mechanisms, not one custom subsystem for every matrix row. They close the practical display/backfill/control needs of the **24 wire-partial** and **4 app-side** rows, subject to each row's explicitly bounded semantics. In-memory state with no read RPC can be reconstructed only for the process history MAWS actually observed; do not label an inferred snapshot authoritative after a gap.

### 3.2 Rows that genuinely require an engine extension for exact parity

1. **Row 56 — per-message held-peer review.** Add a safe pending-message content/read plus approve/reject operation, reusing the engine's existing ingress-policy/race checks. `peer_message_hold` currently lacks an approval mechanism. A global accept-policy change is not a substitute.
2. **Row 22 — native Workflow pause/skip/retry.** Expose the existing in-process task/agent controller operations with stable run/task/agent identifiers and state checks. Existing stop/resume and progress events remain useful without this extension.
3. **Row 10 — complete classifier decision telemetry.** Emit a structured, correlated decision event for relevant allow/deny/escalate outcomes, without pretending tool execution proves which internal path approved it. This is needed only for a faithful classifier audit UI; ordinary permissions work already.
4. **Row 67 — exact statusLine snapshot/ledger.** Export the existing producer payload or an equivalent read-only structured snapshot, including prompt-cache diagnostics. A purpose-built MAWS toolbar does not need exact custom-command compatibility and can avoid this patch.

There are other desirable extensions, such as child token deltas or direct built-in-tool action RPCs, but the inspected evidence does not justify calling every such enhancement a necessary TUI-parity patch. Do not patch simply because a slash command is local-jsx: its underlying structured read/control API often already exists.

### 3.3 Is patching the Bun standalone binary realistic?

**Not as a dependable source-only edit.** This Darwin arm64 build is approximately a 225-MB Mach-O with a 156,351,109-byte `__BUN,__bun` payload and 2,388 module records. Source contents and bytecode are separate fields in each record. **2,150 JavaScript records have precompiled bytecode, totaling 86,926,512 bytes**, alongside roughly 40.1 MB of JavaScript source. The source carve is excellent for analysis, but its existence does not prove it is the executable representation chosen at runtime. [01 §§1,2.4,4.5–6; `MAP.md`]

A string/source-only patch can leave executing bytecode unchanged. Changing payload sizes/offsets, bytecode compatibility, native assets and Mach-O signing/loading creates a reproducibility burden. A marker such as `// @bun @bytecode` alone is not sufficient evidence about a module's actual bytecode record. No successful patch/rebuild experiment was performed in this audit.

The realistic order is:

1. Ship the raw-wire + filesystem-backed host against an unmodified pinned binary.
2. Write fixture-based protocol conformance tests for the actual MAWS launch configuration, including runtime-only fields and reconnect/cancel behavior.
3. If literal full parity remains a requirement, run a small isolated proof that a chosen engine extension changes execution—not merely extracted source—before committing to a patched distribution/update strategy.
4. Prefer an upstream/exported protocol addition or a reproducible rebuild path over byte-offset patch maintenance.

### 3.4 Verification limits and next step

This audit verifies catalogues, producer/filter behavior, controller availability and documented disk formats against the pinned spec and selected source windows. It does **not** verify account gates, actual startup option combinations, storage-v5 paths, live OAuth responses or a Bun patch in a running MAWS process. SDK/binary drift was observed in resume accounting, thinking-display vocabulary, and persistent-setting writer support.

The next valuable step is a **version-pinned protocol fixture probe**, not an Electron UI prototype: capture initialize, unknown-field preservation, one permission/question round trip, nested/background child traffic, workflow progress, usage/context queries, queue interruption, rewind/fork and a held peer message under MAWS's intended local launch options. That turns the remaining deployment assumptions into executable compatibility tests before UI architecture depends on them.

--- END FILE CONTENT ---