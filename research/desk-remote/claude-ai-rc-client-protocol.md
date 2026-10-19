# Client side of Claude Code Remote Control in claude.ai/code and Claude Desktop: protocol reference for MAWS #52

## Build and method

- **Build.** The toolchain run on the installed app succeeded, so everything here comes from the newly regenerated **`app-2.42304.0`** (Electron 44.7.2). The tree is at `~/claude-desktop-re/readable/app-2.42304.0/`.
  - `acquire` → `all` took about 12 minutes (15:53 to 16:05 PDT).
  - `diff` against app-2.16120.0 wrote `readable/app-2.42304.0/CHANGES-app-2.16120.0..app-2.42304.0.md`.
  - MAWS `research/SOURCES.md` still names 2.16120.0 as current; I left the repo untouched.
  - I also noticed a newer CLI bundle at `~/claude-code-bundle/2.1.302/`.
- **Method.** Static analysis only. I wrote question 7 (Desktop main process) and the comparison myself. Six parallel readers covered the other areas, and a seventh mapped a lead that turned up on the way (§8). I re-read each report's load-bearing claims in source (list at the end). Anything not read directly is marked *(inferred)*.

**Citation prefixes.** Expand mechanically to `readable/app-2.42304.0/…`:

| Prefix | File | What it is |
|---|---|---|
| `W/` | `web/app/v1/` | web app chunks |
| `M/` | `main-process/` | Desktop main process |
| `S104` | `W/shared-104-Cqo2-vQh.js` | sessions API, watch, frame builders, attestation |
| `EPI` | `W/c5da7eb42-B8cTG8SI.js` | code-session adapter, internally "epitaxy" |
| `SDK` | `W/c30db9bec-DjF3pT_h.js` | Agent SDK browser build, loaded as `agent_sdk_browser` |
| `STORE` | `W/c06cf64bb-BE5q2vSr.js` | transcript store and reducer |
| `SEND` | `W/c6b8adeaf-C5Aww7gq.js` | send mutation |
| `CC43` | `W/cc43287c9-DAfOi8yP.js` | composer and start flow |
| `S0` | `W/shared-0-ByI5P0CP.js` | fetch and react-query plumbing |
| `MU` | `M/index.chunk-muI2IV6k.js` | main-process core |
| `CF` | `M/index.chunk-CFJssAFf.js` | LocalSessionManager |
| `CZ` | `M/index.chunk-CziVBdux.js` | `rc-serve` folder serving |

---

## 0. Findings that change the design

1. **The browser runs the Agent SDK itself.** claude.ai/code opens every cloud or RC session through `query()` from the browser SDK build, whose `Query` class handles control_request, permission and dialog work. The page is effectively an SDK host over a remote transport (EPI:13173-13174, 13448-13468; SDK:87940-87992).
2. **Remote Control sessions ride the legacy v1 WebSocket, not the v2 SSE stream.**
   - The URL is `wss://<host>/v1/sessions/ws/{id}/subscribe?organization_uuid=…`, and it is called with no options, so it never asks for `replay` or `from_event_id` (EPI:13465; S104:19915-19930).
   - SSE `GET /v1/code/sessions/{cse}/events/stream` is used only when the gate `ccr_v2_subscribe_sse_web` is on and either the session is cloud (`anthropic_cloud`/`byoc`) with no `agent_id`, or the backend lacks WebSocket (Desktop self-hosted mode). The selector is `ow(e) = !websocket || (cloud && !agentId)` (EPI:9499-9501, 10726-10727, 13183-13186).
   - If SSE does not open within 15 s, the client falls back to the WebSocket (EPI:13505-13537).
   - Gaps are filled over HTTP paging, not stream replay (STORE:13506-13510).
3. **Worker liveness does not come from the session stream.** The code-session SSE ignores `session_update` and `security_update`; there is no branch for either (SDK:78503-78676). Liveness comes from three other sources:
   - polling the session resource (15/3/10/30/60 s cadences, EPI:19109-19157);
   - the account-wide `/v1/code/sessions/watch` SSE;
   - a client-side "bridge offline" detector: `connection_status:"disconnected"` plus no non-user frame for 70 s (`W/c5cd1b4dc-jDcYG_fG.js:738-805`).
4. **The web declares no dialog kinds to the worker.** The app passes `supportedDialogKinds`, but the browser SDK's `query()` builds its init config from `promptSuggestions` alone, so `initialize` carries none (SDK:87978-87983 vs 60469). Unknown dialog kinds are actively answered `{behavior:"cancelled"}` (EPI:8038-8048).
5. **RC sessions get less than cloud sessions in the shipped client.** For RC sessions (verified for cancel-queued; the rest from the area reports):
   - the server `unread` value is ignored (RC rows do send `mark_read`, `W/cd54a5401`:1376-1395; corrected 2026-10-19);
   - excluded from Desktop remote-session notifications;
   - no cancel or edit of a sent queued message (`Qw` requires the cloud set, EPI:9591-9597);
   - no fast mode (hidden outright for `environmentKind === "bridge"`, PICK:2036; cloud needs CLI ≥ 2.1.274);
   - no `get_settings`, `get_task_output` or `list_directory`.
   Some capabilities exist **only** for RC among the remote kinds: `fork_conversation` (local sessions fork over IPC), the automatic mid-turn "asides" (the `/btw` side chat itself exists for cloud too, CTX:4039-4054), and "Continue in cloud" (`move-to-cloud`). The per-kind matrix including Desktop-local and SSH sessions is in [desktop-modes-renderer.md](desktop-modes-renderer.md) and [desktop-modes-main.md](desktop-modes-main.md).
6. **Every POSTed event is signed** under gate `ccr_per_message_attestation_web`. The signature is ECDSA P-256 over a domain-separated preimage (verified, S104:8317-8366). A third party can generate and enrol such a key; the server cannot verify hardware backing from what the client sends (§6).
7. **Claude Desktop is an RC host in three separate lanes.** One of them is a full bridge environment like `claude remote-control`: it polls work, takes the work secret from the work item, hands it to the CLI through SDK `remote_control`, and refreshes it by requeueing (`/bridge/reconnect`) (§7).
8. **There is a fourth integration option that the issue doesn't list.** Desktop's undocumented "self-hosted execution" mode forwards the web app's session API to a configured host. MAWS could implement that host contract (about 15 routes plus two SSE streams) and drive its sessions from native Desktop. It is Desktop-only, takes over the Desktop profile (no claude.ai account, no local sessions), and the contract churns (§8).

---

## 1. Endpoints (web client unless marked *main*)

### 1.1 Auth and headers

**The web authenticates with claude.ai cookies.** Every wrapper uses `credentials:"include"` and sends no bearer token (S0:21080-21130, 22701-23090).

Common headers on every request (S0:18656-18686, 18020-18095):
- `anthropic-client-platform`: `web_claude_ai` in a browser, `desktop_app` in Desktop;
- `anthropic-client-version`, `anthropic-client-sha`, `anthropic-client-build`;
- `anthropic-device-id`, `anthropic-anonymous-id`, `x-activity-session-id`;
- `X-Expected-Account` in multi-account mode.

The CCR block `q(org)` (S104:3200-3207):
```
anthropic-version: 2023-06-01
anthropic-beta: ccr-byoc-2025-07-29
anthropic-client-feature: ccr
x-organization-uuid: <org>
```
History and session reads add `Cache-Control: no-cache` and `Pragma: no-cache` with `cache:"no-store"`.

**Desktop's main process uses bearer auth.** Its client `wda` (MU:347053-347140) sends:
- `Authorization: Bearer <oauth>`;
- `anthropic-beta`: `ccr-byoc-2025-07-29` for sessions, **`managed-agents-2026-04-01`** for environments and work (MU:346665-346666);
- `x-environment-runner-version` and `Anthropic-Worker-ID`;
- `X-Trusted-Device-Token`.

It retries a 401 once with a fresh token, and on 403 `untrusted_device` it enrols and retries. *(Inferred)* For a non-browser client, this and the CLI's own `SessionsV2Client` are the right templates, not the cookie path.

### 1.2 Endpoint table

| Method and path | Request | Response used / notes | Cite |
|---|---|---|---|
| GET `/v1/code/sessions` (sidebar list) | `limit=50`, `statuses=active&statuses=paused`, `tags*`, `cursor=<last_id>` | `data[]`, `next_cursor`, `resume_token`; staleTime 30 s (∞ while the watch is healthy) | S104:15122-15300 |
| Other list variants | `?limit=1` mints a resume token; `?limit=100` seeds the watch; `trigger_id=…&limit=30`; `only_trigger_sessions=true&limit=200&exclude_tags=-`; `/v1/code/sessions/agent_owned` | | S104:14868-15000, 16727-16900, 17576-17645 |
| GET SSE `/v1/code/sessions/watch?exclude_tags=-[&resume_token=][&include_trigger_sessions=true][&keepalive_tolerance_seconds=135]` | `last-event-id` | frames `added`/`changed` (session JSON), `removed {id}`, `sync` (its `id` is the resume token); 410 → reseed; 401/403 → "refused" loop; gate `amber_harbor_beacon` | S104:15758-16426 |
| GET `/v1/code/sessions/{id}` | | `{session}`, `{response_shape}` or `{shared}`; prefetched on hover with a 30 s throttle; legacy `/v1/sessions/{id}` under gate `ccr_epitaxy_disable_native_get_session` | S104:17133-17290, 18117-18202; EPI:622-630 |
| POST `/v1/code/sessions` (create) | `{title, environment_id \| self_hosted_runner_pool_id, config:{sources, outcomes, cwd, model, effort_level, permission_mode, custom_system_prompt, append_system_prompt, allowed_tools, disallowed_tools, mcp_servers…}, events?, tags}` | `session` | S104:18203-18322, 15082-15121 |
| PUT `/v1/code/sessions/{id}` | `{title, remove_tags?}`, `{add_tags, remove_tags}`, `{client_metadata}` or `{client_metadata_patch:[…]}` | optimistic update; a rename also sends a `rename_session` control_request | S104:18934-19129; EPI:14995-15020 |
| DELETE `/{id}`; POST `/{id}/archive`, `/unarchive` | optional `device_attestation{kid,signature}` + `device_attestation_issued_at` (DELETE puts them in the query) | optimistic | S104:17957-18062, 19130-19175, 19800-19904 |
| POST `/{id}/mark_read` | `{event_id}` (omit to mark all) | `{unread}`; durable outbox; cloud only | S104:19224-19340; `W/c5cd1b4dc-jDcYG_fG.js:409-574` |
| GET `/{cse}/events` | `limit` (200 desc for the newest window, 500 otherwise, 20 for a head probe), `sort_order=asc\|desc`, `cursor`, `exclude_types*` | `data[].{event_id, sequence_num, payload, created_at, source, processing_at, sent_by_account_id}`, `next_cursor`, `resume_cursor`; at most 100 pages per walk | S104:17646-17683, 15024-15080; EPI:10992-11270, 12810-12840 |
| GET SSE `/{cse}/events/stream?from_sequence_num=N` | `Last-Event-ID` | §2 | S104:19905-19914 |
| WS `/v1/sessions/ws/{id}/subscribe?organization_uuid=` | | RC sessions, §2 | S104:19915-19932 |
| POST `/{cse}/events` (v2) | `{events:[{payload:{…,uuid}, device_attestation?, mentioned_account_ids?, user_declared_urls?}]}`; no `session_id`; keepalive when ≤32,768 B | `results[i].sequence_num`, `results[i].duplicate` (deduped on `payload.uuid`); gates `ccr_v2_send_events_web` or `ccr_per_message_attestation_web`, otherwise legacy `POST /v1/sessions/{id}/events {events:[payload]}` | S104:18710-18918 |
| POST `/{cse}/client/presence` | `{client_id:<per-tab uuid>, thread_id?, clear?, clear_reason?}` | `{refresh_after_seconds}`; default every 20 s, idle after 30 s, cleared 2 s after the tab hides; gate `ccr_client_presence_enabled` | `W/c0bf48a0a-Bg12D0X9.js:12-118, 423-440` |
| POST `/{id}/ping` | `{cause:"open"\|"viewing"\|"typing"}` | every 30–120 s; skipped when hidden | S104:17428-17445; `W/cca020b37-D8kH2RCh.js:12-32` |
| POST `/v1/code/sessions/heartbeat_check` | `{session_ids:[≤25]}` | `results[{session_id, outcome: fresh\|probe_dispatched\|no_worker\|recently_checked}]`, `checks_enabled`; gate `ccr_sessions_heartbeat_check`; results stored, not rendered | `W/shared-18-D4XxL6Tg.js:10056-10300` |
| WS `/v1/code/sessions/{id}/terminal` (legacy `/v2/ccr-sessions/{id}/terminal`) | sends `{type:"resize",cols,rows}`, `{type:"data",data}`, `{type:"close"}` | receives `opened`, `data` (base64), `exit`, `error`; gate `ccr_v2_terminal_ws_web` | `W/c03935b01-CyJKQj4N.js:158-360` |
| POST `/{cse}/move-to-cloud` | `{environment_id, revision_fallback?, permission_mode?}` | 409 = branch conflict; on 400 `move_permission_mode_refused` retried without the mode | `W/caec4a2d4-Cky7Rmpu.js:995-1095` |
| GET `/{cse}/teleport-events` | `?limit=1`, or `?limit=500&session_agent_id=&cursor=` | subagent transcripts | `W/caec4a2d4-Cky7Rmpu.js:1097-1150`; EPI:11330-11368 |
| PUT `/{id}/mcp-servers` `{mcp_servers}`; POST `/v1/code/mcp-config/prewarm` | | | S104:19415-19440, 17417-17427 |
| share / support-share / debug-export / shared-sessions; `:resolve` `{share_key}` | | | `W/c9106b145-BHRR3YCx.js:43-380`; S104:17198-17225 |
| GET `/{cse}/file?path=`; PUT `/synced_file` | PUT body `{path, content:b64, if_match_sha256?}` | | S104:17684-17804 |
| POST `/{cse}/device` | `{target_device_id, bind_attestation, bind_attestation_issued_at, expected_current_device_id?}`; header `anthropic-client-device-link-intent: user` | | S104:17986-18023 |
| `/v1/code/github/{compare-refs,get-commit,get-file-content}` | | | S104:14370-14436 |
| GET `/v1/code/last_used_environment` | | `{environment_id}` | `W/caec4a2d4-Cky7Rmpu.js:1152-1220` |
| GET `/v1/environment_providers/private/organizations/{org}/environments?limit=1000` | | `{environments[], has_more}`; staleTime 600 s; polled every ≥60 s on code routes (`tengu_ccr_bridge_environment_polling_interval_ms`); every 3 s for up to 2 min while "add a computer" is open | S104:3394-3591 |
| `…/environments/{id}` GET/POST/archive; `…/cloud/create`, `…/cloud/ensure_default` | | | S104:3431-3455, 3599-3778 |
| POST `/api/{org}/upload` (multipart) | | `file_uuid`, `sanitized_name`; §5 | EPI:15392-15630 |
| POST `/api/auth/trusted_devices` | `{device_public_key, reuse_existing?}` | `{device_id, device_binding_kid?}`; §6 | S104:9866-10150 |
| *main* `POST /v1/environments/bridge`, `GET …/work/poll`, `POST …/work/{w}/ack`, `/stop {force}`, `DELETE /bridge/{env}`, `POST /bridge/{env}/offline`, `POST /environments/{env}/bridge/reconnect {session_id}`, `POST /v1/code/sessions/{id}/tool_hosts/refuse {work_id, code}` | | §7 | MU:347447-347727 |

### 1.3 Environments and how a session lands on the user's own machine

**Bridge environment records.** They carry `kind:"bridge"` plus `bridge_info{machine_name, directory, branch, git_repo_url, online, max_sessions, cli_version, device_uuid}` (`W/c27ae24bb-DONhLkb8.js:26-55`).
- Pickers hide bridges with `online === false`.
- Duplicate machine+folder registrations collapse to one. The winner is decided by online, then preapprovable device, then larger `max_sessions`, then newer `cli_version`, then newer `created_at` (`:56-120`).

**Start intents** (verified, CC43:11946-11992):
- **`bridge-spawn`** when the bridge is online and active sessions are below `max_sessions`. It creates a session with `worker:{type:"environment", id}`, which goes on the wire as `environment_id`, and `tags:["remote-control-app"]` (`W/shared-25-DP8p7i1Z.js:25187`; CC43:3600-3640).
- **`bridge-attach`** when `max_sessions === 1` and a session already exists. It posts an optional `set_permission_mode`, then the user frame, to that session.
- Otherwise the start is blocked with `bridge_at_capacity`, `bridge_offline` or `bridge_unavailable`.

After a spawn, the row reads `pending` until a `worker_status` appears. There is no client "wait for worker" endpoint.

**The first send after create** (S104:18381-18468, 19606-19735) is one batch: `set_permission_mode?`, `set_model?`, `apply_flag_settings{effortLevel}?`, `apply_flag_settings{fastMode}?`, then `user`.

---

## 2. Transport

### 2.1 Three stream clients in the bundle

1. **Browser SDK transports**, used for code sessions:
   - `BrowserSSETransport` (SDK:78298-78855);
   - `WebSocketTransport` (SDK:78934-79087);
   - driven by the epitaxy loop `$E.subscribe` (EPI:13011-14142).
2. **`streamCcrV2ClientEvents`** (S104:13645-14369): the full v2 design with HTTP poll fallback and poison-frame strikes. **It is used only by Cowork-remote**, not by code sessions.
3. **The account watch** (S104:15736-16726).

### 2.2 Code-session SSE

- **URL:** `…/events/stream?from_sequence_num=<last consumed seq>`.
  - The resume point is lowered to just before the earliest unprocessed client prompt (EPI:4738-4760).
  - A 410 forgets it.
  - Without a stored point, a head probe `events?limit=20&sort_order=desc` supplies one (EPI:13251, 11209-11232).
- **Internal redials** add `Last-Event-ID` equal to the highest received `client_event` id.
- **Auth and headers:** cookies, the `q()` headers, `Accept: text/event-stream`, and **no `X-Device-Attestation`** (SDK:78434-78452).
- **Timers:** connect timeout 15 s. Liveness is 45 s without any chunk. Internal reconnect allows 5 tries at 1, 2, 4, 8, 16 s with no jitter. `{401,403,404}` close the transport (SDK:78299-78303, 78690-78717, 78461-78481).
- **No** suspend or drift detection, no `Retry-After` on connect, no auth refresh *(inferred from absence)*.

**SSE event handling** (SDK:78503-78676):

| Event | Handling |
|---|---|
| `client_event` | advances the cursor; envelope kept; source filters below |
| `ephemeral_event` | `stream_event` and `sources_changed` pass through; system `thinking_tokens`, `post_turn_summary`, `task_summary` and `commands_changed` are projected to fixed fields; everything else is dropped |
| `catch_up_truncated` | `onCatchUpTruncated` → `tail_stale` → HTTP gap-fill |
| `delivery_update` `{event_id,status,timestamp?}` | releases held prompts (§3) |
| `session_update`, `security_update`, unknown | ignored silently |

**Source filters on `client_event`:**
- A frame with no `type` is dropped.
- A malformed `control_response` is dropped, from any source.
- A non-worker `user` frame shaped like worker output is dropped. That covers `tool_result` blocks, `tool_use_result`, and text starting with harness markers such as `<bash-stdout`.
- Malformed user content is dropped, from any source.
- A non-worker `control_response` answering this client's own request id is dropped as `forged_reply`. Other non-worker `control_response`s pass with `pending_permission_requests` and `pending_user_dialog_requests` stripped.
- Any other non-worker type outside `{user, env_manager_log}` is dropped.

Drop logging: the first 5 per reason, then 1 in 50.

### 2.3 Code-session WebSocket (RC)

- **URL and auth:** `/v1/sessions/ws/{id}/subscribe?organization_uuid=<org>`, with cookies only.
- **Timers:** connect timeout 15 s; client sends `{"type":"keep_alive"}\n` every 50 s.
- **Framing:** newline-delimited JSON, with `ccr_event` stripped. **No type or source filtering** (SDK:78932-79087).
- **Close codes:** anything other than 1000/1001 is an error; 1012 is classed "server draining" (S104:19931-19982).
- **Reliability is the outer loop's job:** the transport itself has no liveness or reconnect.

### 2.4 The outer epitaxy loop

- **States:** `connecting`, `reconnecting`, `connected`, `disconnected`.
- **"Connected"** means the first frame was delivered. For bridge sessions it means the initialize or attach reply arrived (EPI:13538-13597).
- **Backoff:** `Tx(p) = max(min(1000·2^(p−1), 30000) × U(0.75,1.25), retryAfter)`, for 6 attempts (12 in self-hosted mode). The counter resets after a connection lasted 30 s or delivered 10 frames (EPI:8363-8368, 13966-13992).
- **When the budget runs out:** show "Disconnected from the remote session. Send a message or refresh to reconnect." and redial on `online`, tab visible, or a user send. After 2 rounds only `online` counts (EPI:13993-14050, 8813-8816).
- **A clean end of stream** emits `done` and does not redial (EPI:13794-13816).
- **`wake()` triggers:** opening the view, sending, `pending_action` appearing, answering a permission request (EPI:14129-14140; `W/ca0409d7c-BtSJABpo.js:70-93`).

### 2.5 History versus live tail

**Opening a session:**
- With gate `ccr_pewter_heron` on (the default), the client fetches the newest window `events?limit=200&sort_order=desc`. With it off, it walks ascending pages of 500.
- Older history loads on demand in pages of 500 desc (EPI:12810-12967, 20899-21000). The failure copy is "Couldn’t load earlier messages. Try again."
- Re-opening with cached rows verifies the tail from `afterSeq = max(seq)`. It falls back to a full walk on reset, rewind, or error (EPI:20319-20400).

**Ordering and dedup** (STORE:667-1000):
- Dedup is by `uuid`.
- Remote sessions with the SSE gate switch to `serverSeq` ordering. `headSeq` advances only contiguously, so gaps stay visible.
- Bridge sessions are never sequence-ordered and are ordered by epochs.

**Gap-fill:**
- Triggers: `reconnected`, `connected` in serverSeq mode, and `tail_stale`.
- Request: `events?sort_order=asc&cursor=<headSeq>` (or uuid-based legacy). Up to 3 tries, delay `500·2^(n−1)`.
- On final failure the transcript shows "Some messages may be missing — reload" (STORE:13337-14016).

**Freshness without a stream:**
- When disconnected, each meta poll emits `log_head(updated_at)` and probes the tail if it moved.
- A tail fetch runs whenever the tab becomes visible (EPI:12765-12768; STORE:13442-13459; `W/c5cd1b4dc-jDcYG_fG.js:2158-2196`).

**Caching:**
- react-query keeps meta (stale after 30 s), the transcript and the list.
- A live session is retained 60 s after its last viewer leaves, or 6 min mid-turn. Up to 8 "working" sessions are kept 15 min, trimmed to 200 rows (STORE:9696-9702, 11204-11360).
- IndexedDB `claude-conversation-store` persists only settled cloud transcripts (EPI:15166-15258).
- An in-memory walk cache holds 8 sessions and 24 MiB, with each walk capped at 50k rows (EPI:2541-2633).

### 2.6 Sending and optimistic echo

- **Batching:** one POST carries `set_model?`, then `apply_flag_settings{fastMode}?`, then the `user` event. `set_model` has a deterministic uuid-v5 (namespace `5f0f3a52-6f38-4a55-9d0e-2c1d9b7e4c11`) so a resend is idempotent (EPI:14677-14805, 11793-11809).
- **No retry** on the user send. A failure removes the echo, restores the composer text and shows an error (SEND:2447-2532). The react-query event mutation used for session start retries on 502/503/504 with `min(2400, 400·6^(n−1))` ±30 % (`W/shared-25-DP8p7i1Z.js:23768-23776`).
- **Ordering:** sends to a session are chained per session (SEND:1977-1990).
- **Optimistic echo:** `{…, isOptimisticEcho:true}` is merged by uuid and replaced by the server echo. POST acks (`results[].sequence_num`) give it its real place.
- **Durable sends:** persisted to sessionStorage `session-pending-messages` and retryable after a reload (S104:13352-13560).
- **Queued prompts:** client-sourced `user` frames on SSE are **held off the transcript** until a `delivery_update` with status `PROCESSING` or `PROCESSED` arrives. If none arrives, a `tail_stale` re-check runs at 5 s doubling to 30 s (EPI:4886-4985).
- **Replayed backlog:** frames more than 5 s old are batched and flushed every 100 ms. Permission prompts wait for the flush *(inferred)* (EPI:4974-4996).

---

## 3. Event consumption and session state

### 3.1 The pipeline

transport → SDK `Query.readMessages` (control frames consumed, `keep_alive` dropped, `commands_changed` cached; SDK:60023-60106) → epitaxy loop (strips client-local fields; consumes `rate_limit_event`, `client_event_rejected`, `prompt_suggestion`, `sources_changed`, `conversation_reset`; EPI:13660-13793) → store reducer → transcript reducer `rd()` (STORE:5120-6966).

### 3.2 Frames rendered

| Frame | Client behaviour | Cite |
|---|---|---|
| `stream_event` (main thread only; subagent deltas ignored) | Text, thinking and `input_json` deltas accumulate per block. Commits every **33 ms** visible, 100 ms with the panel hidden, 200 ms with the document hidden; flushed on block or message stop. The stream row hides once the final `assistant` with the same `message.id` lands. CLI < 2.1.157 sent cumulative `text_delta`s, which are converted | STORE:7428-7907, 8559-8780; EPI:8762-8777 |
| `assistant` | Markdown, tool cards, grouped tool runs, thinking under a toggle. `message.model` updates the model chip; usage tokens update the context meter | STORE:2345-2500, 6395-6558; S104:12576-12975 |
| `user` | Prompt row; `tool_result` merged into its tool; a `/clear` echo inserts "Context cleared"; queued prompts appear as "waiting" bubbles | STORE:3174-3297, 6561-6941 |
| `result` | Turn end: clears stream, phase and queue state. `is_error` produces an error card. Cost and duration go only to localStorage `epitaxy-session-result:<id>` and are never shown | STORE:12402-12520 |
| `system/init` | Reads `model`, `permissionMode`, `effort`, `claude_code_version`, `fast_mode_state`, `slash_commands`, `skills`, `plugins`, `terminal_slash_commands`, `cwd`, `additional_directories`, `memory_paths`, `footer_indicator.text`, `capabilities` (MCP-app UI), `worker_epoch`, `mcp_servers`. Not read: `agents`, `output_style`, `apiKeySource`, `betas` *(inferred)* | S104:12576-12740; EPI:10269-10530, 7490-7520 |
| `system/status` | `requesting` → "Waiting for Claude…"; `compacting` → "Compacting session…"; also `permissionMode` | STORE:8578-8590, 9362-9393 |
| `api_retry` | "{cause} · Retrying ({attempt}/{maxRetries})" | STORE:9394-9410 |
| `compact_boundary` | "Compacted session · saved {tokens} tokens" | STORE:6158-6172 |
| `informational` | Hook notices; `prevent_continuation` → "A hook blocked your prompt" | STORE:6193-6249 |
| `local_command_output` | Command output; `/context` renders a grid | STORE:5759-5870 |
| `thinking_tokens` | "Thinking…" escalating at 15, 30, 45, 60 s; "Thought for {s}s" | STORE:12305-12352 |
| `task_started` / `task_notification` / `task_progress` / `background_tasks_changed` | Task rows and the tasks pane; running rows missing from a snapshot become "stopped" | STORE:5961-6094; `W/c62da1b56-4Yslp259.js:300-331, 1203-1224` |
| `rate_limit_event` | Usage banner, statuses `within_limit`, `approaching_limit`, `exceeded_limit` | EPI:13735-13741; STORE:7165-7244 |
| `client_event_rejected` (server-authored) | Throttled toast | STORE:334-420 |
| `env_manager_log` | Init checklist (provision, clone, setup_script, start_cc) | `W/cf7bdecc3-CHpmGyRF.js:488-520` |
| `queued_notification` | Only `trigger_fire` and `mcp_send_message` | STORE:4915-4925 |

**No consumer in the web client:** `worker_shutting_down`, `control_request_progress` (side questions ignore it), `bridge_state`, `code_change_published`, `vcs_state_changed`, `task_updated`, `session_notice`.
- Unknown types are dropped. The "next" renderer shows a `code.unmodeled` card instead (`W/c96d752d0-BOCqU7c2.js:53412-53415`).
- Ephemeral `post_turn_summary`, `task_summary` and `commands_changed` frames are not rendered on SSE. The list reads the session-record copies (EPI:8926-8933).

### 3.3 `external_metadata` and session-record fields

**Read by the client:**
- `post_turn_summary{status_category, status_detail, needs_action, …}`: list "awaiting" state (unread rows only), blocked reason, notification body.
- `pending_action`/`pending_actions` (cap 20): blocked reason; re-shows prompts on cloud only.
- `current_branches`: branch and PR pills.
- `last_init_error{error_kind}`: session error cards.
- `is_ultraplan_mode`.
- `tool_host_status`: cloud only.
- `container_cc_version`: gates the RC model picker.
- `recap` and `goal`.

**Never read:** `context_usage` (comes from the `get_context_usage` RPC instead), `effort_level`, `worktree_state`, `cross_session_inbound`, `rate_limit_info` (comes from `rate_limit_event`). `permission_mode` is a fallback only.

Sources: S104:25137-25162, 14654-14705; EPI:10570-10657; `W/shared-26-CgdP_nTj.js:8964-9071`.

### 3.4 Derived status

`FT` (verified, S104:14564-14610):
- `archived` → archived; `paused` → paused; `failed` → idle.
- Active with no `worker_status` → **pending**.
- `running` → running only if `connection_status` is connected or absent; otherwise idle.
- `requires_action` and `idle` pass through.

`HE` (EPI:10589-10596): `isLive` = running and connected.

### 3.5 Session-list precedence

`T_` (`W/shared-18-D4XxL6Tg.js:9188-9249`; `W/shared-11-BuQ3CK5I.js:6546-7062`), in order: archived → error → **awaiting** → running → unread hand-marked → PR merged/closed → unread → PR → idle.
- **Awaiting** means a pending approval, or `requires_action`, or the row is unread with summary `blocked`/`need_input`.
- Copy: "Awaiting input", "Running", "Unread response" (blue dot), "Idle", "Archived".

**RC rows:**
- Laptop glyph; LaptopSlash plus "{machine} · Offline" when `connection_status:"disconnected"`, the environment has gone from the active list, or `bridge_info.online === false`.
- Server `unread` is ignored and the server's `status_bucket:"working"` is ignored.

### 3.6 RC offline and error states

`W/shared-14-u0TSV9dR.js:752-2242`; `W/c5cd1b4dc-jDcYG_fG.js:738-805`:
- **"Remote Control disconnected"**: "Claude Code on the computer running this session is offline…". The offline band appears after 25 s: "Reconnecting to your computer…", then "Continue in cloud…".
- **`error_kind` values:** `computer_unreachable` ("Can’t reach your computer"; sends refused while meta is under 60 s old), `host_exit`, `remote_control_disabled` (terminal; composer hidden), `never_connected`, `owner_changed`, `worker_auth_expired`, `environment_deleted`.
- **Header popover:** "Connected to {machineName} via Remote Control". It reflects the client's own stream state, not `connection_status` *(inferred: it can say connected while the worker is offline)* (`W/c73f45bc3-CFrHin0p.js:6685-7570`).

---

## 4. Control requests and the permission/dialog relay

### 4.1 Envelope

- **How requests go out:** the client POSTs `control_request` frames to `/events`. Replies arrive **only on the stream**, matched by `response.request_id`.
- **Registration first:** the expected id is registered before the POST. Early replies are buffered, up to 1024 (SDK:59845, 60540-60575; EPI:11944-11951).
- **`request_id`:** `${subtype}-${Date.now()}-${rand36}` (EPI:11949); `set-perm-mode-<uuid>`, `set-model-<uuidv5>`.
- **Fallback:** if the POST fails with a status other than 403/429, the same frame goes out through the SDK transport (`epitaxy_control_ws_fallback`) (EPI:11980-12023).
- **No SDK-level timeout:** every timeout is an adapter `Promise.race`. `control_cancel_request` is sent only for aborted `list_directory`, `get_task_output` and `side_question`.
- **Refusal detection:** the regex `/not available in a session run by the organization|not available through relay-runner|Unsupported control request subtype|does not handle control_request subtype|is not supported in this context/i`, or `outbound-only`, marks the subtype unsupported (EPI:4663-4680, 9936-9943).

### 4.2 Subtypes sent to cloud and RC sessions

| Subtype | Payload → response used | Trigger | Timeout | Scope |
|---|---|---|---|---|
| `initialize` (SDK) | `{sdkMcpServers?…}` (no dialog kinds) → `claude_code_version`, `commands[]`, `inbound_read_receipts`, `pending_*` | every connect | none (signed rail 60 s) | both |
| `set_model` | `{model}` → verdict | model picker, `/model`, ⌘⇧I; also batched with the next send | none | both |
| `set_permission_mode` | `{mode}` → HTTP status | mode menu, `/plan`, `/permissions` | none | both; bypass never offered |
| `apply_flag_settings` | `{settings:{effortLevel, ultracode}}` or `{fastMode}` | effort menu, `/effort`, ⌘⇧E; fast mode ⌘⌥F | none | both; `fastMode` stripped for RC |
| `interrupt` | `{cancel_queued?}` → `cancelled[]`, `still_queued[]` | Stop, Esc | none; post-stop meta refetch at 0, 2, 6, 12 s | both |
| `stop_task` | `{task_id}` | Tasks pane | none | both |
| `background_tasks` | `{tool_use_id?}` | "Run in background", ⌃B | 15 s | both; RC needs CLI ≥ 2.1.255 |
| `cancel_async_message` | `{message_uuid}` → `cancelled` | remove a queued bubble | 15 s | **cloud only**, CLI ≥ 2.1.76 |
| `file_suggestions` | `{query}` → `suggestions[]`, `cwd` | `@` | **1.5 s** (then `[]`); handle wait 45 s | both |
| `read_file` | `{path, max_bytes?, encoding?}` | file viewer and media | 60 s; 10 MB media cap | both; RC paths not contained |
| `list_directory` | `{path}` | Files pane | 15 s; 120 per minute | cloud only |
| `get_workspace_diff` | `{}` → `{diff}` | `/diff`, ⌘⇧D | 30 s | both |
| `get_context_usage` | `{detail?}` (must contain `rawMaxTokens`) | context meter | 15 s | both |
| `get_settings` | `{}` → `applied.advisor` | `/advisor` | 15 s | not RC |
| `side_question` | `{question, history[]}` → `{response, synthetic?, refusal_fallback?}` | `/btw`, ⌘; | 120 s answer, 45 s handle wait | both; RC mid-turn "asides" |
| `rewind_conversation` | `{target_message_uuid, last_seen_user_message_uuid?}` → `prefillText` | "Rewind to here" | 60 s | both (the REPL bridge refuses it: "This session doesn’t support rewind.") |
| `fork_conversation` | `{target_message_uuid?, title?}` → `{forked, sessionId…}` | "Fork from here", ⌘⌥↵ | 60 s | **RC only** |
| `rename_session` | `{title}` | `/rename` | after the PUT | both |
| `submit_feedback` | `{description, surface}` | `/feedback` | 50 s, only as a fallback after a 404 from POST `/feedback` | both |
| `get_task_output`, `mcp_status`, `mcp_read_resource`, `get_branch_status`, `push_branch` | | tasks pane / MCP-app UI / push panel | 15 / 15 / 60 / 30 / 600 s | cloud only |

Source: EPI:11738-15018, 12426-12692, 7490-7674; S104:19596-19790.

**Never sent to cloud or RC sessions:** `set_color`, `get_usage`, `mcp_reconnect`, `mcp_authenticate`, `mcp_oauth_callback_url`, `mcp_set_servers`, `set_max_thinking_tokens`, `mcp_toggle`, `mcp_call`, `add_directory`. The last four appear only in Cowork-remote.

**Desktop-local sessions** go over IPC (`window["claude.web"].LocalSessions.*`) to the main process's SDK `Query`, which does send `set_max_thinking_tokens`, `mcp_*`, `mcp_set_servers` and `remote_control`. Rewind there is a resume at a point, not a control request (CF:55475-55598, 84724-84740, 85071-85075).

### 4.3 `can_use_tool`

**Storage and cards:**
- The SDK calls `canUseTool`. The web stores the entry keyed by **`tool_use_id`** and keeps the wire `request_id` for the answer (EPI:6874-7088).
- Cards:
  - generic: "Deny" (Esc), "Allow once" (⌘↵), "Always allow" (⌘⇧↵), "Allow and switch to Auto";
  - ExitPlanMode: Reject, Revise…, Accept, "Accept and allow edits/auto";
  - AskUserQuestion.

**Answer** (`_A`/`UA`, S104:19493-19559, 20011-20069):
```
{type:"control_response", response:{subtype:"success", request_id,
  response:{toolUseID, behavior:"allow", updatedInput, updatedPermissions?} | {toolUseID, behavior:"deny", message}}}
```
- Deny carries a fixed rejection sentence plus any feedback, and **no `interrupt` field**.
- Suggestions are sanitised. **`destination` is forced to `"session"`**, so web "Always allow" is session-scoped. At most 5 rules (`W/shared-78-D6VXYXaQ.js:11065-11114`).
- Plan approval sends `updatedPermissions:[{type:"setMode", mode, destination:"session"}]`.
- AskUserQuestion answers go in `updatedInput.answers`.
- **Misclick guard:** an "always" or "session" decision within 400 ms of the card appearing is downgraded to "once" (EPI:5740, 6330-6340).
- **Missing details:** if the request's input hasn't arrived, the card is deny-only.

**Write path:**
- On SSE the answer is an explicit POST, and the SDK suppresses its own write (`respondedOutOfBand`).
- On an unsigned WebSocket, the SDK also writes the answer to the socket.
- A failed POST re-arms the card: "Failed to send response. You can try again."

### 4.4 Elicitation and dialogs

- **Elicitation:** only verdict-schema forms (`verdict` ⊇ {allow, deny}) and URL-mode asks are answered. Others are left pending (EPI:7090-7232).
- **`request_user_dialog` kinds:** `refusal_fallback_prompt` (choices `edit_prompt`, `retry_fallback`) and `auto_mode_server_fallback` (choices `continue`, `interrupt`). The answer is `{behavior:"completed", result}` or `{behavior:"cancelled"}` (EPI:7829-8360; S104:19571-19595).

### 4.5 First answer wins

- **Worker cancels.** The worker's `control_cancel_request` aborts the SDK signal, and the card detaches **without sending anything** (SDK:60181-60187; EPI:6934-6962).
- **Duplicates.** A duplicate in-flight `request_id` is ignored. A re-asked `tool_use_id` reuses the cached decision (an LRU of 50) and is answered automatically.
- **Answered elsewhere.** History entries answered by another client, via a later `control_response` or `control_cancel_request`, are resolved locally (`W/ce6aaa9ba-DfnDwDn8.js:286-310`).

### 4.6 Re-show on connect (three sources)

1. **`initialize` response.** `pending_permission_requests` and `pending_user_dialog_requests` are replayed through `handleControlRequest`, but only for the SDK's own `initialize` (SDK:60798-60860).
2. **History trailing scan.** An unanswered trailing `can_use_tool` or `elicitation` is re-shown. A newer human message drops trailing permission prompts (`W/c11ebc6ef-BnVzw_EF.js:1-108`; `W/ce6aaa9ba-DfnDwDn8.js:213-560`).
3. **`external_metadata.pending_action`.** Cloud refs only, while `requires_action`. It is shown deny-only until the details arrive (`W/c5cd1b4dc-jDcYG_fG.js:1028-1125`).

Already-answered prompts are suppressed by the localStorage `acknowledged-tool-decisions` cache (TTL 300 s, 10 per session).

---

## 5. Composer

### 5.1 The `user` frame

EPI:14693-14760:
```
{type:"user", uuid, session_id, parent_tool_use_id:null,
 message:{role:"user", content:"<text>" | [image blocks…, {type:"text",text}], mentions?},
 file_attachments?:[{file_uuid, file_name, is_image, image_width?, image_height?, original_name?, mime_type?}],
 priority?:"next"|"later", isSynthetic?}
```
`tool_states` is added for cloud sessions only.

### 5.2 Slash commands

**Where the list comes from** (EPI:10145-10372):
- `system/init.slash_commands`, plus `skills`, `plugins` and `terminal_slash_commands`;
- the `initialize` response `commands`, which supplies descriptions and argument hints;
- `commands_changed`, which replaces the list.

Before init arrives, a static fallback list is shown under "More commands available once the session is running" (`W/shared-5-kdJVRUsT.js:5861-5927`).

**Menu:** Fuse.js matching with threshold 0.3 and no result cap.

**Sending:** a pick inserts a chip that serialises to `/name`. CLI commands go **as plain `user` text**.

**Host-intercepted commands:** `/btw` → `side_question`; `/model`, `/effort`, `/plan` (`set_permission_mode plan`, 15 s ack wait), `/permissions`, `/rename`, `/rewind`, `/fork` (RC only), `/status`, `/diff`, `/tasks`.

**Blocked commands:**
- `/cd` and `/memory` are blocked for remote sessions.
- `!` shell commands are refused for remote sessions: "Shell commands are only available in local sessions." (CC43:44158-44750, 51870-52883, 52829-52863).
- A command that isn't in the CLI's list shows "/{name} isn’t a command here." and is **still sent**.

### 5.3 @-file mentions

- **Request:** `file_suggestions{query}` with **no debounce**. Stale responses are dropped by a sequence counter. Timeout 1.5 s; results cut to 50; VCS and OS junk names filtered.
- **Encoding:** the mention is inserted as unquoted `@<path>`.
- **Side effect:** an `@` query wakes the session (`W/c227f4d5e-Ba-r--Rl.js:6436-6531`; `W/shared-28-DcgD7xXH.js:4797-5190`; EPI:14520-14561).

### 5.4 Attachments

- **Images**, accepted as PNG/JPEG/GIF/WebP and at most 30 MiB:
  1. Compressed client-side to ≤2000 px and ≤512 KB, re-encoded as WebP or JPEG (`W/c98ab6e79-DUMymJb9.js:80-297`).
  2. With gate `ccr_image_attachments` (RC hosts need CLI ≥ 2.1.226), uploaded to `POST /api/{org}/upload` as multipart: concurrency 4, 30 s timeout, at most 16. They become `file_attachments`.
  3. Otherwise sent inline as base64 image blocks. Failures fall back to inline silently (EPI:15392-15630).
- **Other files** (gate `ccr_file_attachments`): at most 5 per message and 30 MiB each, with timeout `30 s + 4 s per MiB` (`W/c54bf5722-BWClj0Vx.js:147-358`).
- No `sha256` or `file_size` is sent.

### 5.5 Queued messages

**Sent at once, not held client-side:**
- Enter while Claude is working sends `priority:"next"` (steer).
- ⌘↵ or "Queue for later" sends `priority:"later"` (`W/c227f4d5e-Ba-r--Rl.js:14957-16695`).

**Display:**
- Steered messages are inline rows marked "unread", then "read"/"Sent".
- Queued messages sit in a bar: "N messages queued", with "Send now", "Edit in composer", "Remove from queue", drag reorder and "Clear all" (`W/cf74bc599-D9NZWRyl.js:8068-8400`).

**On RC, a sent queued message is immutable.**
- No cancel, no reorder.
- "Send now" performs an `interrupt`, so the steered message runs next.
- Only the pre-spawn local queue (`zte`, CC43:43734-43846) can be edited.
- A Send click within 500 ms of Stop is ignored.

### 5.6 Other controls

- **Model list:** from bootstrap `model_selector_config`, not from `initialize`.
- **Permission modes:** RC offers default, acceptEdits, plan and auto; never bypass. There is no Shift+Tab cycle.
- **Drafts:** localStorage `composer-draft:epitaxy-<id>`, debounced 400 ms.
- **Dictation:** over `/api/ws/speech_to_text/voice_stream`.

---

## 6. Client security and notifications

### 6.1 Per-event signing

Verified against source; the remaining details are from the security reader.

```
preimage = UTF8("anthropic.ccr.client_event.v1") 0 UTF8(cse_sessionId) 0 UTF8(payload.uuid) 0 UTF8(payload.type) 0
           ‖ SHA-256(JCS(payload minus {uuid,type}))
```
- **Signature:** ECDSA P-256 SHA-256, raw r‖s, base64. It goes on the wire as `device_attestation:{kid, signature}` (S104:8286-8489, 17812-17866).
- **No timestamp or nonce.** Replay protection presumably rests on `uuid` dedup *(inferred)*.

**Two signing arms:**
- **Browser:** a non-extractable WebCrypto key in IndexedDB `claude-device-binding`. It is enrolled with `POST /api/auth/trusted_devices {device_public_key}`, which returns `device_binding_kid`, a `tdcred_…` value *(inferred)*.
- **Desktop:** sessions bound to this Mac are signed by a Secure Enclave key through IPC `DeviceRegistry.signAttestationPreimage`, kid `creg_<rowPk>`. That IPC accepts only the client-event domain tag (MU:307487-307491, 308346-308353).

**`X-Device-Attestation`** is Desktop-only and only for sessions bound to this device. Format `creg_<rowPk>.<issuedAtMs>.<b64url sig>`, over `"anthropic.ccr.stream_connect.v1"‖uuid16(session)‖uuid16(rowPk)‖u64be(ms)`. It is re-minted after 240 s (MU:308259-308363; S104:9426-9519, 13845, 14249).

**The web never reads attestation verdicts.** Zero hits for `device_attestation_status`, `security_update` or `x-ccr-attestation-policy`, and the web never sends `X-Trusted-Device-Token`. What it does react to:
- 403 reasons (`untrusted_device`, `session_stale_relogin`, `device_key_missing`, `bind_attestation_*`), which open a step-up modal (re-login or WebAuthn reattest);
- `attestation_feedback.kid_not_found` in a POST response, which deletes a key older than 30 min.

Sources: S104:6036-6100; `W/shared-18-D4XxL6Tg.js:14440-15320`; EPI:5487-5530.

**Elevated sessions:** on `security_tier:"elevated"` cloud sessions, an unsigned *approve* answer is withheld (`device_key_missing`) (S104:10247-10320).

### 6.2 Trusted device in Desktop main

- **Enrolment:** `POST /api/auth/trusted_devices` with a bearer token and `{display_name:"Claude Desktop on <host> · <platform>"}` returns `device_token`.
- **Storage:** safeStorage key `coworkTrustedDeviceToken:<acct>`.
- **Use:** sent as `X-Trusted-Device-Token` on Desktop's worker-side calls only (MU:380665-380772).

### 6.3 Notifications

- **Browser:** FCM web push.
  - Registration: `POST /api/organizations/{org}/notification/channels {channel_type:"FCM", registration_token, client_app_name:"claude-ai-web"}`.
  - Payload: `{method:"OpenCodeSession", request:{session_id}}`.
  - Categories: `code_requires_action`, `completion`, …
  - Sources: `W/shared-1-CAAiD7E3.js:16744-16753`; `W/shared-182-eT1kXtya.js:21953`.
- **Desktop, remote sessions:** computed in the page from the watch stream. It fires on running → `requires_action` immediately, or → idle after 10 s, via IPC `DesktopNotifications.showNotification`. **Bridge (RC) sessions are excluded** (`W/c101fef3f-DGHEkqgu.js:4628-4950`).
- **Desktop, local and served sessions:** the main process notifies, including "Session started from another device" (MU:231399-232044).

---

## 7. Claude Desktop main process as an RC host (question 7)

Yes. Desktop hosts local Claude Code sessions over the bundled Agent SDK and turns RC on for them with the `remote_control` control_request. There are three lanes.

### Lane A: user toggles RC on a local Code session

- **IPC:** `LocalSessions.toggleRemoteControl(sessionId, enable)` → `applyRemoteControlTransition` → `query.enableRemoteControl(enabled, title)`. **No work secret**: the CLI creates and attaches the CCR session itself (`POST /v1/code/sessions` + `/bridge`, as in SPEC/36 §7) (CF:45897-46140).
- **Timeout:** `oL = 60000` ms (CF:44922).
- **Refusal copy** (CF:45998-46006, gate `RZ("2392971184")`):
  - "Remote Control is not available for this deployment."
  - "…a session your organization's launcher started."
  - "Remote Control is turned off right now. Try again later."
  - "Remote Control requires an active session. Send a message first."
- **Restore:** RC comes back after an app update or sign-in (`restoreBridgesAtLaunch`, `desktop_ccd_remote_control_update_restore(_pass)`; CF:79000-79040, 79251-79268).
- **CLI sessions:** `enableCliRemoteControl` for external CLI sessions is a stub that throws in this build (`M/index.chunk-C-SPwKbM.js:569-571`).

### Lane B: "serve this Mac/folder" (`RemoteControlServing` IPC, `rc-serve`)

**Desktop is a bridge environment.** IPC methods are `requestEnable`, `disable`, `requestAddFolder`, `requestServeSessionFolder`, `requestServeGrantedFolder`, `setFolderPinned`, `setFolderWorktree`, `disconnectCloudSession`, `removeFolder`, with store `remoteControlServeStatus` (`ipc-services.md:1427-1441`; MU:117604, impl MU:364186).

**Registration** (CZ:100-140, 3670-3712; MU:347447-347480): `POST /v1/environments/bridge` with `{machine_name, directory, branch?, git_repo_url?, max_sessions (default 32), environment_id?, metadata:{worker_type:"claude_code", runner:"desktop", spawn_mode, …}}`. A folder-less registration adds `scope:"machine"`. The response is `{environment_id, environment_secret}`.

**Polling** (CZ:3839-4155): `GET /v1/environments/{env}/work/poll`, with tiered fast and slow polling (5 s for up to 3 recent folders, 20 s otherwise) and an optional session watch.
- `healthcheck` items are acked.
- `data.mode === "tool_use"` goes to the tool-host lane.
- `type:"session"` → `startAdmitted` → `sessions.startRemoteSession({cwd, useWorktree, ccrSessionId, credential})` → `ensureRemoteControlSession` (CZ:4155-4600).

**Where the work secret comes from:** the polled work item's `secret`, i.e. `GET /v1/environments/{env}/work/poll` (`holdWorkSecret`, CZ:4791-4801). If the config flag `attachWithWorkSecret` is on (**default false**), `DP()` hands it to the CLI:

```
query.enableRemoteControl(true, undefined, {workSecret, reattachSessionId: ccrSessionId,
   refreshWorkSecret: () => remoteControlCredential.refresh()})
```
→ wire `remote_control{enabled:true, work_secret, reattach_session_id, keep_session_on_exit}` (CF:42083-42106, 46083-46091; SDK in main `M/index.chunk-DNyequwM.js:67863-67900`).

When the spawned CLI predates the work-secret attach, or the credential has been withdrawn, it logs "…attaching through /bridge" and falls back to the CLI's own `/bridge`.

**`remote_control_work_secret` refresh:**
1. The CLI asks the host with a `remote_control_work_secret{session_id}` request.
2. The SDK's `workSecretAnswerer` checks that the session id matches the one attached ("remote_control_work_secret names a session this host did not attach.") and calls `refreshWorkSecret` (`M/index.chunk-DNyequwM.js:~67300`).
3. Desktop hands over a newer held secret if it has one (`takeIfNewer`).
4. Otherwise it starts a renewal: `POST /v1/environments/{env}/bridge/reconnect {session_id}` requeues the session, and the next poll delivers a work item with a fresh secret. `holdWorkSecret` then resolves the renewal.
5. It waits `st = 30000` ms, and refuses to requeue again within `dt = 120000` ms ("requeued_recently").
6. It returns `null` if the lease has ended ("abandoned (lease ended)").

Sources: CZ:4814-4916, 1839, 1878; MU:347570-347590.

**Tuning:** a remote dynamic config (hashed id `1410651677`) with schema `nua` (MU:346146-346182, 382076, 382117): `fastPollMs` 5000, `slowPollMs` 20000, `capacity` 32, `toolHostCapacity` 4, `idleMs` 4 h, `watchSessions` false, `attachWithWorkSecret` false, `stopEndedSessionResumes` true, `defaultServeOn` false, ….

**Environment API headers** use `anthropic-beta: managed-agents-2026-04-01` (the CLI uses `environments-2025-11-01`) plus `Anthropic-Worker-ID` and `X-Trusted-Device-Token` (MU:347067-347077). Capacity refusals are written to `client_metadata.desktop_rc_refusal` (MU:347031).

### Lane C: Cowork

This lane is separate from Code. Cowork ("Dispatch") registers a `directory:"/cowork"`, `worker_type:"cowork"` bridge environment (MU:348689-348697). It acts as the **worker** itself through the SDK bridge export `attachBridgeSession`, using the work secret's `session_ingress_token` (`createBridgeTransport`, MU:349380-349405; `M/index.chunk-BK7H67PL.js:534-600`). The `[outbound-ccr]` mirror uploads Cowork sessions to CCR (`M/index.chunk-FzAnk-i9.js:47-260`).

---

## 8. Additional lead: Desktop "self-hosted execution" as a MAWS integration path

**Activation** (P = `M/index.pre.js`; verified P:34130-34232, MU:55222-55253, MU:171658):
- Keys `selfHostedUrl` plus a credential (`selfHostedToken`/static, `helper-script` or `external-idp`, or none). Scope `3p`, `visibility:"public-undocumented"`, since 2.16120.0.
- Setting them puts Desktop into **3P mode**: "3P mode active (self-hosted execution; no inference on this device)". The `self-hosted-only` rule denies `device` and `sshHost` execution on every surface, and no claude.ai account is used.
- Config comes from MDM plists or the local `Claude-3p/configLibrary`, authored in "Configure Third-Party Inference…", which needs Developer Mode.

**Routing:**
- `protocol.handle("app")` forwards exactly `/v1/code/sessions`, `/v1/code/triggers` and the prefixes `/v1/code/sessions/`, `/v1/environment_providers/`, `/v1/code/triggers/`, `/v1/code/runners/self-hosted/sessions/` to the host (MU:61262-61300, 166308-166443).
- Headers are allowlisted and Desktop adds `Authorization: Bearer`. Cookies and `X-Device-Attestation` are dropped.
- SSE streams through. The **WebSocket does not**, so the session-host profile is SSE-only, and the terminal and share-resolve break.
- Desktop forces the gates `ccr_v2_subscribe_sse_web` and `ccr_v2_send_events_web` on.

**The host contract** a MAWS server would implement:
- `…/capabilities` (`{version:1, repositories:[], models, permission_modes, …}`);
- environments;
- sessions list, get, create, update, archive, delete, mark_read, ping;
- `events` GET paged by `sequence_num`, and POST;
- `events/stream` SSE (`client_event` with `source:"worker"`, `delivery_update`, `session_update`, heartbeat ≤30 s);
- `sessions/watch` SSE.

Payloads are SDK stream-json, so the core work is an envelope translator *(inferred)*.

**Judgement:** feasible as a Desktop-only second client, at about one milestone. It is **not** a route to phone or claude.ai parity. It takes over a Desktop profile, and the contract changes per release (`host_report` and `diagnostic_counts` are new since 2.16120). Worth a time-boxed dynamic spike: a mock host plus a Desktop pointed at `http://127.0.0.1:<port>`.

---

## 9. How the web client differs from the CLI's `SessionsV2Client`/`RemoteSessionManager` (question 8)

| Aspect | CLI client (SPEC/36 §14–15) | claude.ai web / Desktop page |
|---|---|---|
| Auth | OAuth bearer, `onAuth401` refresh, `X-Trusted-Device-Token` | claude.ai cookies; no trusted-device header; device trust through key enrolment and step-up |
| Stream | always v2 SSE `events/stream`, optional `control_only=1` | SSE only for cloud sessions behind a gate; **RC uses v1 WS subscribe** with no replay; 15 s SSE→WS fallback |
| Resume | `from_sequence_num` and `Last-Event-ID` on every dial | URL cursor = last *consumed* seq; `Last-Event-ID` only on internal SSE redials; gaps filled by HTTP paging |
| Connect / liveness | 30 s connect; 45 s per frame; 5 s wall-clock drift watch | 15 s connect; 45 s per chunk on SSE; none on WS beyond a 50 s client keepalive; no drift watch |
| Reconnect | `min(1000·2^(n−1), 30000)`, budget 5, optional flat 30 s redial | 5 internal SSE tries, then 6 outer tries with ±25 % jitter, then parked until online, visible or send |
| `session_update` | worker live/gone | ignored; liveness from meta polling, watch and a 70 s client offline detector |
| `security_update` | elevated tier callback | ignored; `security_tier` read from the session record |
| `delivery_update` | ignored | holds and releases queued prompts |
| `catch_up_truncated` | callback | `tail_stale` → gap-fill → "Some messages may be missing — reload" |
| Own control_request echo | read as the device-proof verdict; `renewDeviceProof` on unverified | dropped as `expected_echo`; no verdict reading |
| Service clock | `Date` header; `replayed` flag | none; "replayed" = `created_at` more than 5 s old (batched rendering) |
| Send | one signed event per POST with `session_id`; outcomes accepted / session_inactive / failed; 401 retry | several events per POST, no `session_id`, per-event `device_attestation`, `results[].sequence_num` acks, server dedup by uuid, no retry on the user send |
| Control RPC | 75 s default (`side_question` 600 s); progress frames reset the timer | per-subtype races (1.5 s to 600 s); `control_request_progress` ignored; no cancel on timeout |
| Dialog kinds | declared in `initialize` | none declared (dropped by the browser SDK) |
| Pending prompts | rearm, undelivered-answer retention, retry 1/5/15/45 s | three re-show sources (initialize, trailing history, `pending_action`); a failed answer re-arms the card manually; acknowledged cache |
| Background tasks | mirror from `task_*` and `background_tasks_changed` | same events feed the tasks pane; `stop_task`, `get_task_output` (cloud) |

---

## 10. Performance constants (question 9; most load-bearing)

| Value | Meaning | Cite |
|---|---|---|
| 33 / 100 / 200 ms | stream-delta commit (visible / panel hidden / document hidden) | STORE:7538-7540 |
| 15 s / 45 s / 1,2,4,8,16 s | SSE connect / liveness / internal reconnect | SDK:78299-78303 |
| 15 s / 50 s | WS connect / client keepalive | SDK:78932-78933 |
| 15 s | SSE-open → WS fallback | EPI:8846 |
| 6 (12) × `min(1000·2^(p−1),30000)·U(.75,1.25)` | outer reconnect | EPI:8363-8368, 13966-13992 |
| 200 / 500 / 20 / 100 pages | newest window / page / head probe / walk cap | EPI:12814, 633, 11213, 11003 |
| 5 s / 100 ms | replay threshold / batch flush | EPI:4683-4684 |
| 5 s → 30 s | held-prompt re-check | EPI:4794-4795 |
| 3 × `500·2^(n−1)` | gap-fill retries | STORE:13407 |
| 60 s / 6 min / 15 min × 8 | session retention | STORE:9696-9702 |
| 15 / 3 / 10 / 30 / 60 s | meta poll (running / starting / pool pending / bridge / tool host) | EPI:19109-19157 |
| 70 s / 120 s / 180 s / 25 s | bridge offline: no-frame window / pending-turn age / established / band debounce | `W/c5cd1b4dc-jDcYG_fG.js:739-772`; `W/cccc2cf0a-B0D--VZp.js:16373` |
| 50 / 30 s | list page / staleTime | S104:15122, 15225 |
| 2 s → 60 s ×[0.5,1.5]; 16 s floor; 30 s stable; refused 60 s → 15 min ×100 | watch backoff | S104:15758-15778 |
| 135 s | watch keepalive tolerance | S104:15765 |
| 240 s / 30 s | resume-token freshness / mint throttle | S104:14808-14920 |
| 20 s / 30 s idle / 2 s | presence refresh / idle / clear on hide | `W/c0bf48a0a-Bg12D0X9.js:29-33` |
| 30–120 s | ping | `W/cca020b37-D8kH2RCh.js:13-23` |
| ≤25 ids, 15 s tick, 60 s per session | heartbeat_check | `W/shared-18-D4XxL6Tg.js:10056-10066` |
| 600 s (min 60 s); 60 s poll; 3 s × 2 min | environments stale / poll / add-computer | S104:3394-3591 |
| 1.5 s, 50 results, no debounce | `file_suggestions` | EPI:9560; `W/c227f4d5e-Ba-r--Rl.js:6488` |
| 32,768 B | keepalive POST cap | S104:18765 |
| `min(2400, 400·6^(n−1))` ±30 % | events POST retry (session start) | `W/shared-25-DP8p7i1Z.js:23768-23776` |
| 400 ms | permission misclick downgrade | EPI:5740 |
| 300 s, 10 per session | acknowledged-decision cache | `W/shared-11-BuQ3CK5I.js:4330-4331` |
| 2000 px / 512 KB / 16 / 4 parallel / 30 s | image compress / upload cap / concurrency / timeout | `W/c98ab6e79-DUMymJb9.js:9-43`; EPI:15512-15554 |
| 400 ms | draft save debounce | `W/c0fbbe82d-BOWKSems.js:1502` |
| 60 s / 30 s / 120 s | *main* RC toggle timeout / work-secret renewal wait / requeue cooldown | CF:44922; CZ:1839, 1878 |
| 5 s / 20 s / 32 | *main* serving fast / slow poll, advertised capacity | MU:346147-346170 |

---

## 11. UX behaviours a parity client must reproduce

1. **Session list:** one org-wide live list from a list seed (`resume_token`) plus the `sessions/watch` SSE.
   - Apply added/changed/removed in batches; reseed on 410; throttle reconnect refetches to 30 s.
   - Rank rows by the `T_` precedence with the `FT` status mapping ("pending" = no worker yet).
2. **Status and notification badges:** awaiting from a pending approval, `requires_action`, or an unread `blocked`/`need_input` summary.
   - Blue dot for unread; read-on-view `mark_read` after 750 ms (cloud).
   - Notify on → `requires_action` immediately and → idle after 10 s.
   - Unlike the native client, also notify for RC (Desktop skips RC sessions).
3. **Starting on a machine:** pick from online bridges with duplicates collapsed; spawn with `remote-control-app`; attach to single-slot sessions; block when at capacity or offline with the native copy.
   - Send mode, model, effort and fast mode before the first user event, in the same batch.
4. **Streaming and turn state:**
   - Stream at about 30 fps and flush on block stop; hide the stream row when the final assistant lands; clear live state on `result`.
   - Working line: "Waiting for Claude…", "Thinking…" escalating at 15/30/45/60 s, "{n} tokens", "Retrying (n/m)", "Compacting session…".
5. **Connection lifecycle:** connecting / reconnecting / connected / disconnected with the native backoff.
   - When the retry budget runs out, show "Disconnected… Send a message or refresh to reconnect."
   - Reconnect on open, send, online or visible. Catch up silently through a tail gap-fill. Show "Some messages may be missing — reload" when a gap can't be filled.
6. **RC offline:** detect it on the client (disconnected + 70 s quiet) and show "Remote Control disconnected" with "Continue in cloud".
   - Refuse sends with "Can’t reach your computer" while `computer_unreachable` is fresh.
   - Disable fork and rewind while offline; hide the composer on terminal `error_kind`s.
7. **Optimistic echo** by uuid, replaced by the server echo.
   - On failure, restore the text and show an error.
   - Durable outbox across reloads.
   - Show queued prompts as "Queued…" until a `delivery_update` PROCESSING/PROCESSED arrives.
8. **Composer:** Enter while working steers (`next`); ⌘↵ queues (`later`).
   - Inline steered rows and a queue bar.
   - Native RC cannot edit or cancel sent queued items; "Send now" interrupts. A MAWS client can do better through `cancel_async_message`, which the RC worker implements.
   - Escape recalls, then stops; ignore Send within 500 ms of Stop.
9. **Slash commands:** fuzzy menu fed by init, `initialize` and `commands_changed`, with a static fallback list.
   - Intercept host commands locally (`/btw`, `/model`, `/effort`, `/plan`, `/rename`, `/rewind`, `/fork`); send everything else as plain text.
   - Native RC refuses `!`. MAWS can choose to support it, since the worker accepts text.
10. **@-mentions:** no debounce, drop stale responses, cap 50, filter junk names, insert unquoted `@path`, wake the session.
11. **Images:** compress (2000 px / 512 KB), upload as `file_attachments` where supported, fall back to inline base64, cap 16.
12. **Permission cards:** keyed by `tool_use_id`, answered by `request_id` with `toolUseID`.
    - Session-scoped "Always allow"; 400 ms misclick guard; deny-only until details arrive.
    - Plan approval through `setMode`; AskUserQuestion answers in `updatedInput`.
    - Dismiss silently on the worker's `control_cancel_request`.
    - Re-show from the `initialize` pending lists, the trailing history scan and `pending_action`; suppress already-acknowledged prompts.
13. **Side panes:** context meter (`get_context_usage`), diff pane (`get_workspace_diff`), tasks pane (`task_*`, `stop_task`, `background_tasks`), file viewer (`read_file`), side chat (`side_question`), fork/rewind (`fork_conversation`/`rewind_conversation` with `prefillText`).

---

## 12. What static code cannot tell us

- **Server semantics:** catch-up and replay windows and when `catch_up_truncated` fires; precedence of `Last-Event-ID` vs `from_sequence_num`; the full `delivery_update` status set; how `unread`, `status_bucket`, `connection_status`, `bridge_info.online` and `last_init_error.error_kind` are computed; what the v1 WS subscribe sends with no replay.
- **Live gate and dynamic-config values,** so we cannot tell which transport RC users actually get today: `ccr_v2_subscribe_sse_web`, `ccr_v2_send_events_web`, `ccr_per_message_attestation_web`, `ccr_pewter_heron`, `amber_harbor_beacon`, the many `__gb__<hash>` gates, and the rc-serve config `1410651677` (including whether `attachWithWorkSecret` is on in production).
- **Whether the v2 SSE stream serves bridge sessions** to a bearer-auth client (the CLI's client uses it for cloud and teleport). Whether cookie-less bearer auth is accepted on every `/v1/code/sessions*` path the web uses *(Desktop's main process proves it for some)*.
- **How the server verifies signatures** and maps them to `device_attestation_status`; the `X-Device-Attestation` validity window; whether `is_hardware_backed` is checked (no hardware key-attestation evidence is sent).
- **Whether the RC worker forwards `request_user_dialog`** to a client that declared no kinds, and whether the web's `cancelled` answer to unknown kinds can beat a terminal answer.
- **Server push triggers** and the FCM service-worker source, which is absent from the bundle.
- **Copy for hashed message ids** missing from `i18n-web.json` (fetched at runtime).

---

## 13. Verification and inference notes

**What I re-read in source myself:**
- the SSE/WS selector and the no-replay WS call (EPI:9445-9502, 13448-13468; `Dr` = `IA` from S104:19915);
- `FT` status;
- the bridge-spawn/attach intents and the `remote-control-app` tag;
- the client-event preimage;
- `Qw` cancel-queued gating;
- the browser SDK dropping `supportedDialogKinds`;
- the bridge-offline constants;
- the self-hosted config keys and execution denial;
- every question 7 citation.

**Inferences** are marked inline. The main ones:
- bearer auth suitability for a third-party client;
- the absence of suspend detection (read from absence);
- the purpose of some gates;
- the self-hosted host's minimal viable contract.

One correction between readers: one report described the RC WebSocket URL as carrying optional `replay`/`from_event_id`. The builder supports them, but the only call site passes none, so it never sends them.

## 14. Suggested next steps

1. **Run a dynamic probe** before relying on any server-side assumption above. Watch which transport a real RC session gets in claude.ai today, check whether `events/stream` serves a bridge session to a bearer client, and record `delivery_update` statuses. The `spikes/protocol-probe/` convention in MAWS fits. Approving any probe that uses a logged-in account is the owner's call.
2. **Settle option (d) for #52 fork 1** with a time-boxed self-hosted-host spike (§8): a mock host plus native Desktop.
3. **Record app-2.42304.0 in MAWS `research/SOURCES.md`** as the current Claude Desktop build. Optionally re-map the worker side against `~/claude-code-bundle/2.1.302/`.
