# P4 edit-speed benchmark: grounding

Prepared 2026-10-19 for the P4 tracker row "edit-speed benchmark" (`docs/tech-debt-tracker.md:296`), read-only. Repo `/private/tmp/maws-arch` at master `c395ff0d9`. No app was launched, no GUI was driven and no model was called.

The sources, all read on this MacBook:
- **The note session's transcript**: `~/.claude/projects/-private-tmp-p3-sitting-project/<the note session id>.jsonl`. Engine 2.1.303. It carries `api-request`, `api-request-shape` and `cost-state` records.
- **The note session's MAWS journal (X8)**: `~/Library/Application Support/MAWS/engine-host/journal/<the note session app id>/gstpcfz3.jsonl`. It has every wire frame with an `at` time, stream events included.
- **ClaudeUsage's relay log**: `~/Library/Application Support/ClaudeUsage/gateway-requests.<UTC date>[.n].jsonl`. One row per API request, with `firstByteSeconds`, `totalSeconds`, `upstreamLongestGapSeconds`, `usage` and `session`. It joins the transcript by `requestID`, 185 of 185.
- **The readable sources**:
  - Claude Desktop `~/claude-desktop-re/readable/app-2.42304.0/`. Cited as `CD:`; paths below are relative to it.
  - The engine bundles `~/claude-code-bundle/2.1.302/cli.pretty.js` (`CC302:`), 2.1.292 (`CC292:`) and 2.1.300 (`CC300:`).
  - MAWS paths are relative to the repo.

Every number below was printed by the scripts in `/tmp/maws-review/` (listed in the appendix). The scripts print aggregates only, never content.

---

## 0. Summary

**The sitting's slowness is model time, and MAWS's tool protocol shapes most of it. MAWS's own tool code is not the cause.**

**MAWS's tool code.**
- The journal times MAWS's execution of every `artifact_*` call at 0.02 to 0.19 s. That is the in `tools/call` to the out `control_response`, and it is never more than 0.27 s in a turn.
- The deck's "14 s `artifact_publish`" and "11 s `artifact_reply`" are not MAWS time. The API response stream stayed open, with no bytes, for 14.1 s and 11.1 s after the model finished writing the tool call. MAWS received the call only after that.
- The gap is upstream. The relay's `upstreamLongestGapSeconds` equals the gap.
- The tracker row's "the deck's publish and reply first on the tool-time side" therefore points at the wrong place. §2.3 has the evidence.

**Where a typical edit turn's time went.** The tables below are means over the sitting's edit turns.

Document edits (n = 9), mean wall time 21.6 s:

| Component | Mean | Share |
|---|---|---|
| Waiting for the first byte | 11.0 s | 51% |
| Generation | 8.4 s | 39% |
| Server holds after tool calls | 1.5 s | 7% |
| Tool execution | 0.2 s | 1% |
| Local remainder | 0.6 s | 3% |

These turns made 4.2 API requests each, every one paying the first-byte wait, and wrote 1,142 output tokens, about 40% of them thinking.

Deck and design publishes (n = 3), mean wall time 66.2 s:

| Component | Mean | Share |
|---|---|---|
| Waiting for the first byte | 19.3 s | 29% |
| Generation | 26.1 s | 39% |
| Server holds after tool calls | 18.0 s | 27% |
| Tool execution | 1.1 s | 2% |
| Local remainder | 1.7 s | 3% |

Generation is mostly whole slide or board files written as tool input, at 1,368 to 3,326 output tokens.

**What the owner saw.**
- An edit appeared about halfway through its turn: 6.6 to 22.6 s after send for documents, 31.9 to 56.1 s for decks and designs.
- The rest of the turn was the read-back the guides prescribe, the thread reply and the closing message.

**Claude Desktop has no faster edit primitive on the same engine** (§1).
- Its local HTML artifacts are full rewrites behind an approval, followed by a verify call that sleeps 3 s.
- Its server-hosted Slides, Design, Docs and Dashboard types (the engine's `Artifact` tool) publish whole files over the network. One-call `old_str`/`new_str` edits arrive only in engine 2.1.300.
- What feels fast in Claude's products is claude.ai chat artifacts. These are one `update` call (`old_str`/`new_str`), drawn while the model is still writing it. They are server-run, though, and not the same engine.
- Desktop's sessions also run leaner than the sitting's: no user-scope plugins in Cowork, effort `medium` by default, eager tool streaming.
- So the benchmark's real question is less "is MAWS slower than Desktop's agent?" than "does MAWS's edit cost the fewest calls and tokens the engine allows, and does it show the edit as it is written?"

**The biggest levers, with my confidence in each** (§5 ranks them):
1. Patch, not rewrite, for decks and designs. Saves about 7 to 19 s per edit. High confidence.
2. Fewer requests per edit: no prescribed read-back, the reply folded into the edit call, core tools always loaded. Saves about 3 to 5 s per request removed, about 6 to 9 s per document edit. High confidence on the cost, medium on whether the model will follow.
3. Small contexts. The note session ran at 527K to 555K tokens. About 82K of that was duplicated guide payload from a MAWS defect (§2.1). Large contexts lengthen every first-byte wait and add 16 to 31 s tails after idle. Medium confidence.
4. Show the edit while it streams. The deltas already reach MAWS and go unused. High confidence on felt speed; it does not shorten turn time.
5. Launch-profile effects: xhigh effort from the owner's settings, user-scope Stop hooks and detours. Low to medium confidence; the benchmark has to measure them.

**Where to run.** The benchmark of record should run on the Mac mini under the CI runner's quiet flag, followed by one confirmation pass on the MacBook at its usual load (§4.7).

---

## 1. Claude Desktop's agent edit path

Desktop is build 2.42304.0. It pins engine 2.1.295, at `~/Library/Application Support/Claude/claude-code/2.1.295/`, which is not extracted, so engine-side claims below cite 2.1.292 or 2.1.300. This section builds on `research/p3-claude-artifacts-suite.md` (the server-hosted suite MAWS's tools were modeled on) and `research/claude-desktop-ux-and-engine.md` B4.

### 1.1 Kinds, modes and which engine runs them

| Kind | Where it lives | Engine | Edit primitive | Calls per typical edit |
|---|---|---|---|---|
| claude.ai chat artifacts | Chat; the tool `{type:"artifacts_v0"}` (`CD:web/app/v1/shared-4-CJsHhp5n.js:9690`) | Server-run model, **not** the MAWS engine | `update {old_str,new_str}` string replace (retried on trimmed `old_str`), or `create`/`rewrite` whole (`CD:web/app/v1/shared-104-Cqo2-vQh.js:21893-21911, 22259-22277`) | 1 |
| Server-hosted types: Slides, Design, Docs, Dashboard (the engine's `Artifact` tool) | Cowork with feature `cobalt_plinth` (`CD:web/app/v1/shared-6-Cby4X-ms.js:11981-11985`; env `CLAUDE_CODE_COWORK_FRAME_ARTIFACTS=1`, `CD:main-process/index.chunk-CB6cNSrW.js:19577-19584`). Code sessions get it for entrypoint `claude-desktop` (`CC292:1009077-1009146`). | Same engine as MAWS | Whole files over `POST /api/frame/deploy/direct` (`CC292:426843-426846, 427240-427330`). 2.1.300 adds `edits:[{old_str,new_str}]` on publish, applied on the client and then published whole (`CC300:459519-459527`). Docs are a hosted MCP connector (`/v1/pages/mcp`, tools `read/create/batch/update/delete`, schemas fetched at runtime; `research/p3-claude-artifacts-suite.md` §3). | Same conversation, 2.1.292/2.1.295: Edit, then publish ("no read is needed", `CC292:340282`). Earlier conversation: about 5. 2.1.300: 1 |
| Cowork local HTML artifacts (dashboards, trackers) | `~/Documents/Claude/Artifacts/<id>/index.html` with `versions/` (`CD:main-process/index.chunk-muI2IV6k.js:340152-340155`). Turned off when frame artifacts are on (`CD:main-process/index.chunk-CB6cNSrW.js:13463-13475`). | Same engine, through the in-process MCP server `cowork` | Full rewrite. The agent Writes the whole HTML to a file, then calls `update_artifact {id, html_path, update_summary}` (`CD:main-process/index.chunk-1hvUlSmO.js:1791-1886`). The mount is read-only in VM mode (`CB6cNSrW.js:19958-19962`). | `list_artifacts` → Read → Write → `update_artifact` (approval card) → `verify_artifact` (sleeps 3 s, `1hvUlSmO.js:1953`): 4 to 6 |
| Plain files (.md/.html/.svg/.docx/.pptx) | Cowork outputs or a connected folder | Same engine | Write or Edit | 1, plus `present_files` |
| `show_widget` visuals | Built-in `visualize` server (`CD:main-process/index.chunk-BaLvO2wi.js:108-190`) | Same engine | The whole widget is re-emitted on every call | 1, plus a `read_me` on first use |

**Gates.** The Cowork sessions on this Mac (55 `audit.jsonl` files, April to July 2026, engines 2.1.92 to 2.1.142) list `mcp__cowork__create_artifact`/`update_artifact`, `mcp__visualize__show_widget`, a PowerPoint add-in server and a Claude Design MCP server in their `init` tools. None is recent. Which gates the owner's account gets today (local HTML artifacts, `cobalt_plinth`, eager streaming, host loop) cannot be read from static code. The benchmark's setup reads them from the first session's `init` record (§4.4).

### 1.2 Visible while the model writes?

- **Desktop forwards streamed tool input.** Cowork runs with `includePartialMessages: true` (`CD:CB6cNSrW.js:19324`). The stream coalescer forwards `input_json_delta` to the renderer in 16 ms batches (`CD:main-process/index.chunk-B5tintml.js:25725-25752`).
- **It turns on eager tool streaming.** Desktop sets `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1` behind gate `714014285` (`CD:CB6cNSrW.js:19623-19625`), which marks every tool `eager_input_streaming` (`CC292:725831-725856`).
- **Progressive rendering exists only where Desktop is not the same engine, or for widgets:**
  - claude.ai chat artifacts are rebuilt from partial JSON on every delta (`CD:web/app/v1/shared-25-DP8p7i1Z.js:17162-17182`).
  - MCP-app widgets get `tool-input-partial` (`CD:web/app/v1/cd9b7fccf-C8-F2T2b.js:944-958`).
  - `show_widget` "renders SVG or HTML content progressively as it streams" (`CD:BaLvO2wi.js:184`). That this renderer also works inside Cowork is inferred.
- **The same-engine artifacts appear only after the call completes:**
  - Cowork HTML artifacts reload with `reloadIgnoringCache()` after the `updated` event (`CD:muI2IV6k.js:340638-340643, 342936-342947`).
  - Plain files appear on `fs.watch` with a 150 ms debounce (`CD:CB6cNSrW.js:4012, 4030-4050`).
  - Server-hosted publishes appear after the deploy finishes; the live-edit modules are null stubs (`CC292:115662, 337742`).

### 1.3 Local and server along the path

- **Inference** always goes direct to Anthropic's API. Cowork's `ANTHROPIC_BASE_URL` comes from `apiHost` (`CD:muI2IV6k.js:256962-256985`).
  - Desktop's Code sessions on this Mac did not go through the owner's relay either. Their session ids (2026-09-25 and 2026-10-01) appear in none of that day's relay logs, although Code sessions load the user's settings, whose `env` names the relay. This is inferred to be direct.
- **Cowork HTML artifacts** are handled entirely locally: an SDK MCP call into the main process, then a file read, a version copy and an atomic rename. The optional share publish is not awaited (`CD:muI2IV6k.js:340643, 340701-340744`).
- **The server-hosted types** pay a network round trip on every publish.

### 1.4 How Desktop launches the engine

**Cowork** (`CD:CB6cNSrW.js:18625-19650`):
- Model: the session's model.
- Effort: a session override, otherwise a server config, otherwise `medium` (`CD:muI2IV6k.js:210238-210244`).
- `maxThinkingTokens` is 31999.
- `includePartialMessages` is on.
- `settingSources: ["user"]`, but under a per-session `CLAUDE_CONFIG_DIR`, so the owner's `~/.claude` plugins, hooks and output style are not loaded.
- An explicit tool list.
- Env: `ENABLE_PROMPT_CACHING_1H`, `CLAUDE_CODE_PROMPT_CACHE_TTL=1h`, `DISABLE_MICROCOMPACT=1`, plus eager tool streaming.
- A custom system prompt of about 47K characters (stored in `local_<id>.json`), not the `claude_code` preset.

**Code sessions** (`CD:main-process/index.chunk-CFJssAFf.js:84697-84746, 85580-85590`):
- `model: i.model || "default"`, the session's effort, `thinking: {type:"adaptive"}`.
- `settingSources: ["user","project","local"]`, so the owner's settings and plugins **are** loaded, as in MAWS.
- The `claude_code` preset, plus Desktop's append.

### 1.5 Where Desktop records timing

**Cowork.** Each session has `~/Library/Application Support/Claude/local-agent-mode-sessions/<account>/<org>/local_<id>/audit.jsonl`. It holds every SDK message except `stream_event` (`CD:CB6cNSrW.js:10445-10447`), each with `_audit_timestamp`. Its `result` record carries:
- `duration_ms`, `duration_api_ms`
- `ttft_ms`, `ttft_stream_ms`, `time_to_request_ms`
- `num_turns`, `usage`, `modelUsage`

Its `init` record lists the model, the tools and the MCP servers. The engine's own transcript sits under the session's private `CLAUDE_CONFIG_DIR` (`local_<id>/.claude/projects/<slug>/<id>.jsonl`), with per-block timestamps, `usage` and the tool_use/tool_result pairs.

**Code sessions** write `~/.claude/projects/<slug>/<id>.jsonl` with `entrypoint:"claude-desktop"`.

**Logs.** `~/Library/Logs/Claude/` (`main.log`, `mcp*.log`, `cowork_*`) has one-second resolution and no per-call durations.

The MAWS parser below reads the engine transcripts of both apps unchanged. Whether 2.1.295's transcripts carry `api-request` records, which 2.1.303's do, has to be checked at setup; without them the parser groups by `requestId`.

---

## 2. MAWS's edit path

### 2.1 The tools and what they cost in context

**The tools.**
- 17 MAWS tools (`src/shared/maws/tools.ts:29-37`; `tools/list` at `tools.ts:533-538`), 14 of them `artifact_*`.
- Schemas: `tools.ts:170-265`, `src/shared/maws/document-tools.ts:31-60` and `src/shared/maws/dashboard-tools.ts:44-69`.
- At the sitting, the `tools/list` answer was 24,455 characters: 22,689 in API shape (about 5.7K tokens), of which 10,394 are descriptions.
- The largest are:

  | Tool | Description chars | Schema chars |
  |---|---|---|
  | `artifact_edit` | 1,018 | 2,171 |
  | `artifact_dataset` | 1,651 | 1,254 |
  | `artifact_create` | 1,328 | 822 |
  | `artifact_publish` | 1,010 | 618 |

  These are master's figures.

**They are deferred.**
- On the gateway route MAWS sets `ENABLE_TOOL_SEARCH=true` (`src/engine-host/launch.ts:135`, charter D-19), so the model loads their schemas through `ToolSearch`.
- The sitting paid 9 ToolSearch calls, each one an extra API request. The first artifact call of a fresh session always pays one.
- The engine honours an MCP tool's `_meta["anthropic/alwaysLoad"] === true` (`CC302:39026`), which would keep the core edit tools out of search.

**Guides arrive by tool call, not in the system prompt** (`src/artifacts/types/guides.ts:1-34`).
- `artifact_describe_type` returns them (`src/engine-host/tool-server/artifact-tools.ts:110-120`).
- `artifact_create` also attaches them the first time a session creates a kind (`artifact-tools.ts:185, 219`).
- Sizes, `SKILL.md` + `format.md`:

  | Kind | Bytes |
  |---|---|
  | document | 5,276 + 7,717 |
  | presentation | 8,490 + 17,913 |
  | design | 6,626 + 6,819 |
  | dashboard | 4,840 + 7,323 |

  The governing system's `DESIGN.md` adds 13,577 bytes.

**Defect: guides arrive twice.**
- `artifact_describe_type` never marks the kind as guided. Its deps are `Pick<ArtifactToolDeps,'artifacts'>`, with no session (`artifact-tools.ts:111`), while create checks `deps.session.guided` (`artifact-tools.ts:185`).
- So describe-then-create returns the guide twice for every kind the session creates.
- In the note session, guide payload totalled about 326K characters (about 82K tokens), including about 90K duplicated characters and seven copies of `DESIGN.md`.

**Results are pretty-printed.** `JSON.stringify(value, null, 2)` (`src/engine-host/tool-server/server.ts:52`) adds whitespace tokens to every result. In the transcript, `artifact_read` results had a median of 2,756 characters, and `describe_type` and `create` 28K each.

### 2.2 What a typical edit is, per kind

The guides prescribe these patterns, and the journal and transcript confirm them.

**Document: patch ops.**
- `artifact_edit` takes `replace_text {old,new}` (preferred), `replace_block`, `insert`, `delete`, `move` and `set_cell` (`document-tools.ts:31-38`; `src/artifacts/types/document/SKILL.md:17-21`).
- The guide says "Read before you edit" (`document/SKILL.md:15`) and "Read back what you changed" (`document/SKILL.md:38`).
- So the sitting's document edits were read → edit → read-back → closing text: **3 tool calls and 4 API requests**, 8 times out of 9.
- Edit inputs had a median of 178 characters.
- A comment answer is `artifact_edit` with `answering`, or one `artifact_reply`.

**Presentation: whole-file rewrite.**
- `artifact_publish` takes `files`, mapping a path to "a slide's whole new text" (`tools.ts:236-243, 494`; `presentation/SKILL.md:22`).
- The host merges property by property (`src/artifacts/slides/publish.ts:1-11`), but the model still writes whole slides.
- `artifact_edit` refuses decks and designs (`src/engine-host/tool-server/documents.ts:133-145`).
- A comment-driven deck edit is read → publish → read-back (`presentation/SKILL.md:61`) → `artifact_reply` (`presentation/SKILL.md:48`): 4 tool calls and 5 requests.
- Slide elements already carry ids (`presentation/SKILL.md:20`), so an element-level patch has its addresses.

**Design:** the same pattern with whole board files (`src/artifacts/types/design/SKILL.md:22, 44, 61`). The sitting's design edit also made one needless ptc call, a user-scope plugin detour.

**Dashboard:** prose and views use document ops. A view is rewritten whole with `replace_block` (`dashboard/SKILL.md:20`), and data is rebound whole with `artifact_dataset` (`dashboard/SKILL.md:22`).

### 2.3 The deck's 14 s publish and 11 s reply

| Call (UTC) | tool_use → tool_result (transcript) | Stream open after the tool_use block (journal: block stop → `tools/call`; relay: stream end) | MAWS time (journal) |
|---|---|---|---|
| publish 09:33:39 | 15.4 s | 15.1 s / 15.2 s | 0.15 s |
| publish 12:07:09 | 14.4 s | 14.3 s / 14.1 s | 0.05 s |
| reply 12:07:35 | 11.4 s | 11.1 s / 11.1 s | 0.19 s |
| read-back 09:34 | 7.6 s | 7.5 s / 7.4 s | 0.04 s |
| read-back 12:07 | 3.3 s | 3.3 s / 3.2 s | 0.02 s |

**What the table shows.**
- The relay records the same gap as the upstream's longest silence (`upstreamLongestGapSeconds` = 14.2, 15.2, 11.1, 7.5, 3.2 s).
- The tool result followed the stream's end by 0.26 to 0.33 s.
- During each hold the engine reported `permission_check_status: checking`. It announces "checking" only after 4 s (`CC302:759975-760030`).

**Nothing MAWS-side runs before `tools/call`.**
- The handler starts on the `mcp_message` (`src/engine-host/tool-server/server.ts:1-12`).
- MAWS registers no hooks (`src/shared/engine/initialize.ts:8-15`; `src/engine-host/host-hooks.ts:1-3`).
- The journal has no `can_use_tool` frames for MAWS tools.
- Publish's real costs are a parse and merge, a second merge for the session's base, SQLite reads and the group commit (`src/artifacts/slides/publish.ts:446-630`; `src/engine-host/tool-server/artifact-publish.ts:209-276`; `src/engine-host/documents/service.ts:11-14`). They total 0.05 to 0.15 s.
- No path renders, rasterises or calls the renderer.

**How rare the hold is, and its cause.**
- Across all 175 tool-calling requests of the sitting's six sessions, the hold had a median of 0.43 s and p90 0.68 s. Only 2.9% exceeded 3 s, and all of those are the five deck calls above.
- The design's publish, 5,121 characters of HTML, held 0.3 s.
- Across 69K Opus 5.5 tool_use responses in the relay logs of 18 and 19 October, the gap distribution is the same with and without the request's `safeguards` field (median 0.82 s; 0.24% and 0.35% over 10 s).
- So the hold is a server-side end-of-response check, and the auto-mode check (`CC302:582575-582579`) is not shown to be the one.
- Why only the deck content triggered it is not known.

**What MAWS can do about it.**
- MAWS cannot remove the hold, but it can stop it from delaying the edit.
- In the 2.1.302 engine, auto mode waits for the server verdict only when the rules' answer is "ask" (`CC302:760565, 760632`). In the journal, rule-allowed tools (Bash 13 of 18, ptc 2 of 20) ran before the stream ended; none of the 88 MAWS calls did.
- An allow rule for `mcp__maws__*`, passed through the launch's `--settings` (`launch.ts:149-189` passes non-protected keys through), would let the edit land during the hold. This is inferred from the code and journal, not probed.
- The turn would still not end sooner, because the next request waits for the stream.

### 2.4 When an agent edit becomes visible

- **At the tool call only.** The host write commits through the group commit and is broadcast to the editor ports (`src/engine-host/documents/service.ts:11-14`).
- **Agent presence** is published at commit (D11, `docs/doperpowers/plans/2026-10-12-p3-b-documents.md:109-111`; `src/engine-host/tool-server/documents.ts:73-75, 348-377`, held 4 s). The deck path publishes it after the publish (`artifact-publish.ts:276`).
- **The tracker row `S-DOC-AGENT-PRESENCE-LIVE`** (`docs/doperpowers/evidence/p3-finish/new-debt.json:453`) closes when presence is shown at stream time, without revealing anything of a refused batch.

**The deltas are already on hand.**
- MAWS launches with `--include-partial-messages` (`launch.ts:54`). The engine marks every tool `eager_input_streaming` (every tool in the sitting's request shapes except the deferred-tool placeholder), and the owner's env also sets `CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING=1`.
- The journal holds 9,465 `input_json_delta` frames, about 17 characters every 50 ms.
- The normaliser forwards them (`src/engine-host/normalizer.ts:271-285`), but drops the tool name from `content_block_start` (`normalizer.ts:265-269`).
- The only consumer is the transcript's live row (`src/renderer/src/transcript/model/reduce.ts:544-560`).

**What that cost at the sitting.** The 12:06 deck edit started streaming its slide at 12:07:01, finished writing it at 12:07:09.4 and appeared at about 12:07:23.7.

**What a progressive edit would take** (no engine change, within D-1):
1. Keep the tool name.
2. Read `"artifact"` from the partial JSON (it was the first key in every observed call) and set presence. This alone closes the row.
3. For content, feed a tolerant streaming JSON parse into a provisional overlay that is not a Y write, dropped on refusal and committed at the call.

Step 3 conflicts with the architect's reading of D11 and needs a ruling.

### 2.5 What the session was launched with

**Flags** (`launch.ts:48-59`):
- `--include-partial-messages`
- `--setting-sources user,project,local`
- `--permission-mode auto` (`src/main/sessions/launch-mapping.ts:30`; D-18)
- `--append-system-prompt` (702 characters at the sitting: `TO_HUMAN_SUPPLEMENT`, `src/shared/owner/contract.ts:93-101`)
- `--disallowedTools AskUserQuestion`
- `--settings` carrying `env` plus `dialogExpiry`

MAWS passed no `--model`, no effort and no `--mcp-config`.

**Model and effort came from the owner's `~/.claude/settings.json`:**
- `model: opus`, so `claude-opus-5-5[1m]`.
- `modelSettings.claude-opus-5-5.effortLevel: xhigh`, over a top-level `high`.
- Every one of the 192 requests carried `output_config.effort: xhigh` and `thinking: {type: adaptive, display: updates}`.
- All 312 responses report `speed: standard` and `service_tier: standard`.

**The route** was the ClaudeUsage gateway (`ANTHROPIC_BASE_URL=http://127.0.0.1:8641`, `launch.ts:132-135`). Local overhead on the request path is small: the relay's wait on the client (`clientWaitSeconds`) has a median of 0.01 s, and the transcript's prompt-to-request and result-to-request gaps have medians of 0.45 s and 0.08 s. The relay's own forwarding delay is not logged separately; arm M1 (direct) measures it.

**User scope**, per the S-SESSION-SCOPE ruling (`docs/tech-debt-tracker.md:270`):

| Item | Value |
|---|---|
| Tools in `init` | 131 (only 9 to 33 sent eagerly per request) |
| MCP servers | 7 |
| Skills | 47 |
| Plugins | 13 |
| Output style | `doperpowers:to-human` |
| Instructions attachment | 18,847 characters |
| Skill listing | 11,471 |
| Deferred-tool list | 8,773 |
| MCP instructions | 5,717 |
| Output-style instructions | 4,448 |

- The engine system prompt was 7,254 characters. The first request wrote 28,450 cached tokens.
- Stop hooks ran at every turn end and delay the result. The owner's `notify.sh` took 0.2 to 5.3 s, 31 s across 33 turns; the smns record took 11 s in total.
- There were also PreToolUse hooks on Bash and ptc, the ptc detour, and the cua self-driving (sitting candidates 6 and 74).

---

## 3. The sitting's own timings

### 3.1 The edit turns

The table below is generated by `research/p4-edit-speed/sitting.py` (also at `research/p4-edit-speed/sitting-table.md`). Times are seconds.
- **Turn** 22 and later are the owner's N.1 block; earlier turns are agent-operated steps of the same session.
- **First-byte wait** is the relay's `firstByteSeconds`, summed over the turn's requests.
- **Generation** is the rest of each response stream, minus the hold.
- **Hold** is the time the stream stayed open after the tool_use block.
- **Tool exec** runs from stream end to tool_result.

| turn (UTC) | edit | send→first block | send→edit landed | send→turn end | API calls | first-byte wait | generation | post-tool hold | tool exec | output tok | thinking tok | context (k tok) | tool sequence |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2 (08:36) | edit | 4.5 | 16.3 | 34.6 | 6 | 9.8 | 21.8 | 2.2 | 0.2 | 2550 | 1462 | 133-140 | read → edit → read → read → read |
| 3 (08:37) | edit | 2.5 | 12.9 | 21.4 | 4 | 10.7 | 8.5 | 1.7 | 0.1 | 1369 | 614 | 141-144 | read → edit → read |
| 4 (08:39) | edit | 2.8 | 10.2 | 18.9 | 4 | 9.7 | 6.7 | 1.9 | 0.1 | 1382 | 382 | 145-149 | read → edit → read → read |
| 6 (08:43) | edit | 2.2 | 9.2 | 17.7 | 4 | 7.0 | 9.0 | 1.1 | 0.1 | 1057 | 461 | 151-154 | read → edit → read |
| 7 (08:48) | edit | 3.2 | 10.0 | 19.7 | 4 | 5.6 | 11.6 | 1.3 | 0.2 | 1278 | 606 | 154-157 | read → edit → read |
| 8 (08:49) | edit | 2.8 | 6.6 | 14.5 | 4 | 10.1 | 2.8 | 1.2 | 0.2 | 537 | 0 | 158-161 | read → edit → read |
| 11 (09:32) | publish | 16.7 | 56.1 | 76.9 | 4 | 12.3 | 38.7 | 23.1 | 0.4 | 5163 | 1297 | 243-255 | read → publish → read |
| 20 (10:21) | edit | 3.3 | 8.5 | 16.0 | 4 | 10.9 | 3.1 | 1.1 | 0.2 | 521 | 0 | 515-518 | read → edit → read |
| 22 (11:44) | edit | 16.4 | 22.6 | 30.7 | 4 | 24.3 | 4.0 | 1.7 | 0.2 | 637 | 136 | 526-530 | read → edit → read |
| 25 (11:52) | edit | 6.9 | 12.3 | 20.8 | 4 | 11.1 | 7.6 | 1.4 | 0.1 | 945 | 349 | 532-536 | read → edit → read |
| 26 (12:06) | publish | 22.2 | 49.6 | 77.0 | 5 | 29.9 | 15.7 | 28.9 | 0.8 | 2313 | 389 | 536-542 | read → publish → read → reply |
| 28 (12:10) | publish | 4.6 | 31.9 | 44.6 | 6 | 15.8 | 23.8 | 1.9 | 1.9 | 3674 | 254 | 543-553 | read → ptc exec → publish → read → reply |

**This reproduces the owner-results line.**
- N.1's edit turns ran 21 to 77 s from send to last output: 20.8, 30.7, 77.0 and 44.6 s.
- First output came after 5 to 22 s: 4.6 to 22.2 s.
- The line's "MAWS tool time 0 to 4 s" was measured from tool_use to tool_result, so it includes the holds. Without them, tool execution was 0.1 to 1.9 s per turn, and the 1.9 s is the ptc detour.

**Notes on single turns.**
- **Turn 22's first request** waited 15.3 s for its first byte. The cache had expired after 71 minutes idle, and 526,780 tokens were written again.
- **Turn 26's first request** waited 19.1 s on a warm cache, after 14 minutes idle.
- **The deck turns' generation** is mostly the slide file streaming as tool input: 3,326 tokens in about 20 s (09:33), 1,368 in about 8.5 s (12:07). The design wrote 2,730 tokens in about 17.8 s (12:10), roughly 150 to 165 output tokens per second.

### 3.2 The per-request model behind the turns

From 78,161 Opus 5.5 requests (4,413 sessions, every app on the relay, 18 and 19 October), using `research/p4-edit-speed/gap-all.py`:

**First byte, warm cache** (median / p90):

| Context | First byte |
|---|---|
| Under 100K | 1.3 / 3.1 s |
| 100K to 200K | 1.4 / 3.2 s |
| 200K to 450K | 1.5 / 3.7 s |
| 450K and up | 1.9 / 5.7 s |

**After an idle gap of 10 to 60 minutes, cache still read:**

| Context | Median | p75 | p90 |
|---|---|---|---|
| Under 100K | 2.6 s | | 6.3 s |
| 450K and up | 2.2 s | 9.4 s | 16.0 s |

At the sitting, four such requests at 518K to 559K tokens, after 12 to 26 minutes idle, waited 16.0 to 30.6 s on a warm cache (cache writes of 367 to 2,427 tokens). Two more were full rewrites: 15.3 s after 70 minutes, and 23.5 s after 26 minutes, which is inside the 1-hour TTL, for a reason not determined. The warm-cache stalls look like a slower cache tier being reloaded. That cause is inferred; the tail itself is measured.

**Cold cache, write over half the context:**

| Context | Median | p90 |
|---|---|---|
| Under 100K | 1.4 s | 3.7 s |
| 200K to 450K | 4.9 s | 14.5 s |

**Output rate** after the first byte: median 112 tokens per second (p25 102, p75 128; n = 17,418). Tool-input streaming in the sitting's deck and design turns ran faster than that, at about 150 to 165.

**The per-request end hold** has a median of about 0.4 s after a tool call, with rare 10 to 15 s outliers (§2.3).

So with Opus 5.5, every request a turn makes costs about 1.5 to 2.7 s before the first token plus about 0.4 s of hold, before any thinking or output. Every thousand output tokens, thinking included, costs about 9 s.

---

## 4. Proposed benchmark

### 4.1 What it must answer

For the same tasks on the same model and effort:
- How long MAWS and Desktop take to the first visible change and to turn end.
- How that time splits into model time (requests, first-byte waits, generation, holds) and tool time.
- What each app's protocol costs in requests, output tokens and context.
- Which MAWS lever, switched on one at a time, removes how much.

The harness stays in the repo as a regression bench, so each improvement is verified with it.

### 4.2 Tasks

Each task runs on a seeded fixture whose content is identical across the apps, each in that app's native form:
- A **document**: about 1,200 words, three headings, a five-item task list, an owner/due table and a link.
- A **deck**: six slides; every element has an id on the MAWS side.
- A **design** board.
- A **dashboard**: a 200-row dataset and three views.

| # | Task (prompt is verbatim across apps) | Kind | Edit size | Ideal calls | Sitting analogue |
|---|---|---|---|---|---|
| B1 | Change "Thursday" to "Friday" in the schedule paragraph | doc | one word | 1 edit + text | |
| B2 | Add a sixth task: "Archive the sitting exports." | doc | one block | 1 + text | turn 22 |
| B3 | Rewrite the introduction paragraph to be warmer, about the same length | doc | paragraph (about 120 words of output) | 1 + text | |
| B4 | A comment on a phrase asks for a change; edit and answer in the thread | doc | patch + reply | 1 (edit with `answering`) + text | turns 5, 25 |
| B5 | On slide 2, change the Session lead's date to 21 October | deck | one text run | 1 + text | turn 26 |
| B6 | Use Verdana for every slide heading | deck | one property on six slides | 1 + text | turn 11 |
| B7 | Add a slide after slide 2: title and three bullets | deck | new slide | 1 + text | |
| B8 | On the desktop board, make the to-do line Korean | design | one element | 1 + text | turn 28 |
| B9 | Group the bar chart by month instead of week and filter to 2026 | dashboard | query or binding | 1 + text | turn 18 |

**Correctness and kinds.**
- Each task has a checker, and a run counts only if its edit is correct. The checker reads the final artifact: the requested change is present and nothing else changed (block or element text and style diff).
- On Desktop, B5 to B8 need the server-hosted Slides and Design types (the engine's `Artifact` tool), and B9 needs Dashboard or a Cowork HTML artifact.
- If a gate is off for the account, that task runs on the nearest kind Desktop offers (a Cowork HTML artifact or a plain file), and the report says so.
- B1 to B4 can also run as claude.ai chat markdown artifacts. That arm is the felt-speed reference: one call, drawn while it streams. It is a different engine and has no effort control, so it is reported apart from the same-engine comparison.

### 4.3 Arms

| Arm | App and configuration | What it isolates |
|---|---|---|
| M0 | MAWS as the sitting ran it: owner scope, gateway, auto mode, Opus 5.5 xhigh | the owner's lived baseline |
| M1 | MAWS, clean profile (scratch `CLAUDE_CONFIG_DIR` as the live specs use; P4's per-session profile once it exists), direct route | user-scope and relay cost |
| M2 | M1 at effort medium | effort; matches Desktop Cowork's default |
| D1 | Desktop Code session (same engine, `claude-desktop`, owner scope), Opus 5.5 xhigh, `Artifact` tool | same-engine parity, same scope as M0 |
| D2 | Desktop Cowork, Opus 5.5, effort xhigh and medium | Desktop's lean profile |
| C | claude.ai chat artifacts, Opus 5.5 | felt-speed reference (B1 to B4) |
| M3+ | M1 plus one lever per arm: no read-back in the guides; publish `edits`/element ops; reply folded into the edit; `alwaysLoad` core tools; streaming presence or overlay; `mcp__maws__*` allow rule | the attribution of each §5 lever |

M3 and later arms run as the levers are built. The first run is M0, M1, M2, D1 and D2.

### 4.4 Driving and timing each app

**MAWS: no GUI automation.**
- Extend the live-spec harness: `e2e/presentations-live.spec.ts` and its siblings use `launchMaws`'s quiet window, the real composer, the relay health check, a scratch config dir and `--max-budget-usd`.
- Add `e2e/bench-edit-live.spec.ts`, parameterised by arm, task and repetition, run only under `MAWS_LIVE=1`, as the live specs are.
- Its timing sources are the X8 journal (`src/engine-host/journal.ts:1-11`), which carries every frame's `at`:
  - **send** is the composer's user frame.
  - **First token** is the first `content_block_delta`.
  - **Hold** is the `content_block_stop` of a tool_use block to its `message_delta`.
  - **MAWS time** is `tools/call` in to `control_response` out.
  - **Turn end** is `result`.
- **First visible change** needs a renderer-side mark: the editor applying the agent's update, or, once it exists, the streamed overlay's first paint. Timestamp it in the main process's clock.
- On the gateway arm the relay log adds first byte and upstream gaps per request.

**Desktop: through cua, because only its GUI can send.**
- cua types the verbatim prompt and presses Send.
- All timing comes from the engine's own records, so the driver's latency drops out: the transcript's user record is send, and the transcript and `audit.jsonl` (`result.ttft_ms`, `duration_api_ms`) give the rest.
- Pre-grant `update_artifact` ("always") and the `Artifact` tool in each session before timing, so no approval click is measured.
- Holds cannot be separated from tool time on Desktop without stream events (the audit log omits `stream_event`). Report the symmetric measure for both apps, the tool span from tool_use block to tool_result, and add MAWS's split as detail.

**First visible change, for both apps.**
- Record the screen at 60 fps with ScreenCaptureKit over the artifact region, and diff frames against the pre-send frame.
- Align with the engine clock through the send frame. Both apps' timestamps are the host's clock.
- On MAWS, calibrate this measure against the renderer mark on a subset.

**Setup reads** before the first timed run:
- each app's first-session `init` (tools, MCP servers, model, plugins), to record the gates and the scope;
- `api-request` params where present (model, `output_config.effort`, thinking, `safeguards`), to verify the controls held.

### 4.5 Measures, per run

**Times:**
- send → first token
- send → first visible change
- send → edit landed (the edit tool's result)
- send → turn end

**Model time:**
- the number of requests
- first-byte wait, generation and hold, summed and per request
- thinking and output tokens
- cache read and write per request
- context per request

**Tool time:**
- MAWS or engine execution per call
- tool calls by name
- tool-input characters (what the model had to write) and tool-result characters (what came back into context)

**Correctness:** the checker's pass or fail, and any human edit lost.

**Environment:**
- 1-, 5- and 15-minute load before and after
- route (gateway or direct)
- app and engine versions
- `service_tier` and `speed`
- the idle gap since the session's previous request

**Report:** median and p90 per task, arm and measure. Also the decomposition stack per task, as in §3.1, for each app side by side.

### 4.6 Controls

- **Model and effort.** `claude-opus-5-5` in every arm, at the effort the arm names (xhigh as at the sitting; medium as Desktop Cowork's default). Verify from `api-request` (`output_config.effort`) or the transcript's `effort` field. Thinking is adaptive throughout; record `thinkingDisplay`.
- **Prompt cache.** Each task runs in a fresh session on its seeded fixture, so context starts at each app's baseline. Record that baseline: 28K tokens for M0's first request; Desktop's has to be measured.
  - *Cold*: a fresh session after more than 1 hour without that prefix.
  - *Warm*: a second run within 2 minutes of an identical-prefix request.
  - Run both, and record the gap and the cache read/write that prove which one ran.
- **Long-session arm.** One session runs B1 to B9 in order after a 300K-token preload, to measure what context growth does (the sitting's shape).
- **Host load.** Start a run only after the 1-minute load has been below 0.5 per core for 2 minutes (5 on the MacBook's 10-core M1 Max), and record it. Model time is remote: the relay's client overhead is ≤ 0.1 s, and MAWS's execution was ≤ 0.19 s even at load 108 to 126. So load mainly moves the visible-change measure and rendering.
- **Permissions.** Both apps must not stop for a human. MAWS stays in auto mode, as shipped, in M0 to M2. Desktop's artifact tools are pre-granted. The allow-rule lever is its own arm.
- **Order.** Interleave apps per task (MAWS, Desktop, MAWS, Desktop), randomise task order per round, and run at least 5 repetitions per cell. Server-side first-byte p90 runs to 3 to 6 s, so fewer runs cannot separate a 2 s difference.
- **Same account class and network.** The gateway picks among the owner's accounts and Desktop uses its own login. Record the account each request used: the relay's `account`, and Desktop's org from the session's `local_<id>.json`.

### 4.7 Where to run

**The record run: the Mac mini, under the CI runner's quiet flag.**
- Take the runner offline with nothing queued, the procedure used for the cua #117 sitting (`docs/doperpowers/plans/2026-10-14-gate-offload.md`, Decision Log 78).
- Allow about 4 hours, or two windows. 9 tasks × (M0, M1, M2, D1, D2) × 5 repetitions is 225 runs, at about 1 minute each including setup, plus the cold and long-session arms.
- **Prerequisites**, each to check before booking the window:
  - Claude Desktop installed and signed in to the owner's account on the mini;
  - a MAWS build;
  - cua access to Desktop;
  - the relay, for M0.

**Then a confirmation pass on the MacBook at its usual load.** The MacBook is at 90 to 126 on 10 cores, and the owner lives there. Run M0, M1 and D1 on B2, B5 and B8, three repetitions each, to show what load adds on top. That should be mostly rendering and visible-change time, with model time unchanged.

**Cost.** At Opus 5.5 list price ($4/$20 per Mtok; $0.20 cache read), a fresh-session run of 3 to 6 requests at 30K to 60K context costs about $0.3 to $0.5. That makes about $100 for the record run. Both apps run on the owner's subscription accounts, so in practice this is quota rather than money. Size the live budget cap (`MAWS_LIVE_MAX_USD`) for it, not at the live specs' $0.75.

### 4.8 Closing the tracker row

The row closes when M0, M1, D1 and D2 have run on an idle host, with the decomposition per task, and each improvement in §5 is routed. The row's routing should change, because the evidence moves "the deck's publish and reply first on the tool-time side" (§2.3):
- **The tool-time side becomes:** the describe_type guide defect, compact results and alwaysLoad.
- **The model-time side becomes:** publish patches, the read-back and reply round trips, session size, and the streamed overlay.

---

## 5. What MAWS controls, and the levers

### 5.1 MAWS controls

- **Requests per edit.**
  - The guides prescribe the read-first and read-back calls (`document/SKILL.md:15,38`; `presentation/SKILL.md:48,61`).
  - The reply is a separate call (`artifact_reply`).
  - Deferred tools cost ToolSearch round trips (`launch.ts:135`).
- **Output tokens per edit.** Whole-file publishes for decks and designs, versus patches.
- **Context per request.**
  - Guide payload, including the duplication defect (`artifact-tools.ts:111`).
  - Pretty-printed results (`server.ts:52`).
  - Read sizes.
  - The session's shape: one long session, as at the sitting, versus per-artifact sessions or compaction.
- **Launch defaults.**
  - Effort and model: MAWS passes none, so the owner's settings decide.
  - Permission mode and allow rules.
  - The user-scope profile: hooks, plugins, output style (P4's S-SESSION-SCOPE profile).
  - The route.
- **Showing progress while the model writes**: deltas, presence, a provisional overlay, and marking the edit as landed while the turn goes on.
- **Its own tool execution.** Already 0.02 to 0.19 s per call; not a lever.

### 5.2 MAWS does not control

- The API's per-request first byte (about 1.3 to 2.7 s warm) and its tails after idle on large contexts.
- The generation rate (about 110 tokens/s, about 150 for tool input).
- Server-side end-of-response holds (0.4 s typical, 11 to 15 s for the deck content).
- How much the model chooses to think at a given effort, and whether it re-reads. MAWS steers this only through prompts and tool results.
- Host load from other work.

### 5.3 The levers, ranked by expected effect on what the owner feels

| # | Lever | Mechanism and evidence | Expected effect | Confidence |
|---|---|---|---|---|
| 1 | **Patch publish for decks and designs.** An `edits:[{path, old, new}]` field on `artifact_publish` (the 2.1.300 Artifact-tool pattern, `CC300:459519-459527`), or element ops by id, applied to the base files before the existing property merge. | The sitting's deck and design edits wrote 1,368 to 3,326 output tokens for a date, a font and one line, at about 150 tokens/s. | Saves about 7 to 19 s per deck or design edit. B5, B6 and B8 should drop from 45 to 77 s to about 15 to 25 s, together with lever 2. | High on the arithmetic; medium on the build (the merge exists, `publish.ts:243-310`). |
| 2 | **Two requests per edit, not four or five.** Drop the read-back from the guides; let edit and publish results say what landed (changed blocks or elements, warnings), so the model need not re-read. Fold the thread reply into publish (documents already have `answering`). Mark core tools `_meta["anthropic/alwaysLoad"]` (`CC302:39026`). For comment-driven edits, the comment message already carries the element's text, so the pre-read can go too. | Each request costs about 1.5 to 2.7 s of first byte, about 0.4 s of hold and its own thinking and output; at the sitting, 3 to 5 s per request. | Document edits from about 21.6 s to about 10 to 13 s; one to three fewer requests on decks. | High on the per-request cost; medium on compliance (the read-back is a quality check, so the results must carry what it checked). |
| 3 | **Small contexts.** Fix the describe_type `guided` defect (about 82K tokens in the note session). Use compact JSON results. Offer per-artifact sessions; let a long session compact. The owner's env caps context at 500K, and the session still reached 555K uncompacted. | The N.1 requests carried 527K to 555K tokens. At that size the first byte has a median of 1.9 s (p90 5.7 s) against 1.3 to 1.4 s, and after a 10 to 60 minute idle p90 is 16 s. At the sitting, 4 of the 13 turn-first requests at that size waited 16 to 31 s on a warm cache, and 2 more waited 15 and 24 s on full cache rewrites. | Around 0.5 s per request typically; removes 15 to 30 s first-output stalls after idle. | Medium (the tail is measured in aggregate; its cause is server-side and inferred). |
| 4 | **Show the edit while it is written.** Presence from the first delta (closes S-DOC-AGENT-PRESENCE-LIVE). A provisional overlay of the streamed text, slide or board (needs a D11 ruling). A visible "landed" state while the agent finishes its turn. Batch deltas at about 16 ms as Desktop does (`CD:B5tintml.js:25725-25752`). | The deltas already arrive (9,465 in the journal); the 12:06 slide streamed 22 s before it appeared. Documents land at 45 to 60% of the turn. | First visible change at about first-token time (3 to 6 s) instead of 7 to 56 s. Turn time unchanged. | High on felt speed. This is what makes claude.ai chat artifacts feel fast. |
| 5 | **Allow rule for `mcp__maws__*`** in the launch's `--settings`. | Rule-allowed tools ran during the hold, MAWS tools never did; the engine waits for the verdict only on "ask" (`CC302:760565`). | The deck edit lands about 14 s earlier when a hold happens; the turn does not end sooner. | Medium (inferred from the code and journal, not probed). Needs a security reading: the allow rule takes the server classifier's verdict out of the gate for MAWS's own tools. |
| 6 | **An edit-session profile** (P4 S-SESSION-SCOPE). Effort high or medium for artifact edits. No user Stop hooks or detour plugins. | Thinking was 0 to 57% of output tokens on edit turns (§3.1). Stop hooks delayed turn end by 0.2 to 5.3 s. The ptc detour cost one request (about 5 s). | About 1 to 4 s per turn from effort; up to 5 s at turn end from hooks. | Low to medium. The effort question is the owner's taste (quality versus speed), and M2 measures it. |
| 7 | **Investigate the deck hold.** A probe republishing the 12:06 slide's HTML through the relay, with and without `safeguards` and in another permission mode. Report to Anthropic if it reproduces. | 54 s across two turns, all on deck content. | Removes up to 15 s per request when it happens. | Low (cause unknown). |

**Not levers:** MAWS tool execution and the relay.

**Expected end state, if levers 1 to 4 land:**
- A document edit at 8 to 12 s to turn end, with the change visible at 3 to 6 s.
- A deck or design edit at 12 to 25 s, visible as it streams.

That puts MAWS at or below Desktop's same-engine paths, which pay 2 to 6 requests and full rewrites. It also puts MAWS near the felt speed of claude.ai chat artifacts. The benchmark's M3 and later arms confirm each step.

---

## 6. Not determined

- **The cause of the 11 to 15 s holds**, and why only the deck content triggered them.
- **The cause of the warm-cache first-byte stalls after idle on large contexts.** Inferred to be a slower cache tier.
- **Which Desktop gates the owner's account has today** (`cobalt_plinth`, local HTML artifacts, eager streaming, host loop). Desktop's Cowork data on this Mac ends in July (engines 2.1.92 to 2.1.142, Opus 4.x), so it is not a comparison baseline.
- **Server-delivered parts of Desktop:** the 1P Cowork system prompt (only its stored size, about 47K characters, was read), the `doc_*` and Docs connector schemas, and the claude.ai `artifacts_v0` schema.
- **Whether engine 2.1.295 writes `api-request` records**, and the 2.1.303 bundle itself. Engine line numbers above are from 2.1.302, 2.1.300 and 2.1.292.
- **Whether an allow rule shortens anything beyond landing time.** Inferred: no.
- **Whether fast mode (`speed`) is offered for Opus 5.5 on the owner's plan.** Every response was `standard`. It is a cost lever outside MAWS's protocol and was not examined further.

---

## Appendix: scripts (in `/tmp/maws-review/`, run with `python3 -I`)

| Script | What it prints |
|---|---|
| `research/p4-edit-speed/parse.py <transcript>` | per turn: first output, wall, tool union, model remainder, requests, output/thinking tokens, cache, Stop hook, tools with durations and input sizes (also writes `research/p4-edit-speed/turns.json`) |
| `research/p4-edit-speed/calls.py <transcript>` | per request: context, first block, duration, tokens; buckets by context and cache state |
| `research/p4-edit-speed/relay.py <transcript> <session> <relay logs>` | the relay join: first byte, total, gaps, output rate, tool count, system bytes |
| `research/p4-edit-speed/split2.py <transcript> <relay logs>` | per turn: first-byte wait / generation / post-tool hold / tool exec / local |
| `research/p4-edit-speed/sitting.py <transcript> <relay logs>` | the §3.1 table (also `research/p4-edit-speed/sitting-table.md`) |
| `research/p4-edit-speed/tail.py --logs … --tr …` | the post-tool hold per tool across transcripts |
| `research/p4-edit-speed/gap.py` / `research/p4-edit-speed/gap-all.py <relay logs>` | first byte against idle gap and context: one session, and every relay session |

The MAWS-side agent's journal scripts are in `/tmp/maws-review/maws-scratch/` (`turns.py`, `blocks.py`, `decomp.py`). The Desktop agent's scratch is in `/tmp/maws-review/cd-scratch/`.
