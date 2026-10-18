## Survey of the desk's session view, history, subagents and background jobs

Read-only. I wrote no code, made no commits, and ran nothing against `~/.claude/sminos` or the hub. The one thing I ran was a timing parse of a transcript file, with a standalone `python3 -I` script.

Path roots used below:
- **MAWS** = `/private/tmp/maws-arch`
- **DP** = `/Users/new/.claude/plugins/marketplaces/doperpowers` (installed main, 3e302ef)
- **d.ts** = `/Users/new/claude-code-bundle/2.1.300/modules/claude-code.d.ts-7e7b76be.txt`

### Five findings that change the design
1. **The MAWS report already ships inside the component desk-web renders.** desk-web draws MAWS's `Transcript`. That component's P2-C report projection is switched off only because the desk never passes `ownerLane`. Q1 is mostly wiring, not porting.
2. **The desk cannot be a remote surface.** The remote-surface protocol runs over the engine's stream-json control channel, which only the process's SDK host holds. No `$` call lets a mod render another mod's component.
3. **Pre-join history is missing in the direct channel because that channel reads the log, and the log starts at the join.** The plane already pages the transcript from disk. That paging dies when the session ends, and each page re-parses the whole file on the uplink's main thread.
4. **Earlier subagents are in the tree, but every one has status "unknown".** Only the held rows can give a status. Those agents land in "On disk / status unavailable", and nested ones never resolve. The plane also drops the bridge's agent state.
5. **No `$` API lists background shells, monitors or MCP servers.** The transcript rows do carry the shell and monitor lifecycle. MCP servers appear in the rows only by name.

---

## Q1. The session view

### Current behaviour
- **The direct channel is built from the log.**
  - `MAWS/apps/desk-web/src/views/project/ChannelView.tsx:39-44` runs `buildStream` over verified log events and requests.
  - `conversation/stream.ts:100-121` (`inChannel`) puts in the session's message, question, human, say and lifecycle events.
  - A `work` fold sits before each message or question, bounded by log `src`s (`stream.ts:161-165`). A live session ends with an open-ended `work:live` fold (`:234`).
  - Message text comes from the log event (`:192`), not from the transcript.
- **Unfolding a fold mounts the DX8 `transcript` slot** (`views/conversation/StreamView.tsx:285-305`), which is `FoldTranscript`.
  - Each opened fold is a new plane subscription keyed by its range (`depth/connect.ts:12-14`).
  - Rows are clipped at span granularity by `depth/source/range.ts`.
  - It draws the raw transcript in a box of at most 480 px, with finished turns auto-unfolded (`FoldTranscript.tsx:33,44`).
  - On a phone it shows "Working record · on a computer" (`StreamView.tsx:291-296`).
- **The depth column owns the session's main subscription.**
  - `SessionDepth` creates the main `DeskTranscript` (`depth/view/DepthColumn.tsx:40`), with tabs Transcript, Subagents, Diff and Info (`:77-113`).
  - That subscription carries the subagent tree, usage and diff (`depth/source/desk-transcript.ts:22-31, 401-409`).
  - `TranscriptPane` renders MAWS's `<Transcript>` without `ownerLane` (`depth/view/TranscriptPane.tsx:159`).

### What the MAWS report does that FoldTranscript doesn't
The report is built into `Transcript`. When the store's UI has `ownerLane` set and the view isn't "transcript", it runs `reportRows` (`MAWS/src/renderer/src/transcript/view/Transcript.tsx:286-298`, `owner/report/project.ts:44-73`). That projection:
- puts one `owner_record` row per marked turn, right after its prompt: "Working record · N tool calls · M messages", with running dots (`OwnerRecordRow.tsx:12-29`, `copy.ts:11-15`);
- keeps the persistent rows in view: prompts, questions, asks, boundaries, errors (`transcript/model/derive.ts:126-129`);
- draws marked text as cards through `OwnerReport`, hiding the unmarked words (`transcript/surface/Rows.tsx:61-67,121`; `OwnerReport.tsx:38-94`);
- draws an unmarked turn whole (`project.ts:7-8`) and tracks marks while text is still streaming (`project.ts:33-39`);
- offers a Report · Transcript toggle (`ReportBar.tsx:48-53` → store `setView`).

It is one subscription and one virtualized list, and its folds follow the transcript's own turns rather than log `src`s. The parser already reads `<message>` (`MAWS/src/shared/owner/to-human-parser.ts:120-121,164`).

### Can it be shared?
It is already shared. There is no package, and none is needed: desk-web imports MAWS renderer modules by relative path, with `@shared` and `@artifacts` aliases (`apps/desk-web/vite.config.ts`; e.g. `TranscriptPane.tsx:7-10`, `desk-transcript.ts:46-49`). Three pieces don't come along:
- **`ReportBar`** returns null unless the owner-channel store has the lane on, and that store is fed over IPC (`stores/owner-channel.ts:12,26`; `ReportBar.tsx:24-27`). The desk needs its own toggle of about 20 lines calling `useTranscriptStore.getState().setView(key, …)`.
- **Mark states** (answered, read) also come over IPC, so cards draw without state (`OwnerReport.tsx:40-47`).
- **doperpowers' ask tool isn't treated as a question.** MAWS classifies only `AskUserQuestion` and `mcp__maws__ask` (`transcript/model/classify.ts:38,41`), so `mcp__doperpowers__AskUserQuestion` folds into the working record. One entry in that shared table fixes it, but it changes MAWS too.

### Merging what only the log or hub knows
- **Already in the transcript:** the session's marked messages; delivered human messages, which the bridge submits as user rows through `$.prompt.submit({asUser:true})` (`DP/hooks/mods/bridge.tsx:451-476`); agent traffic; question tool calls.
- **Human sends not yet in the transcript.** Outbox items and `human` events not yet `delivered` (recorded, held, failed) become `tail` rows. That is MAWS's held-prompt pattern (`derive.ts:131-135`, `heldRow`), carrying the desk's Deliveries line. Once delivered, the transcript's own user row takes over.
  - Matching a delivered row to its log event works by text containment, since the delivery frame wraps the text.
  - An exact match needs a bridge addition: `delivered {key, outcome:'entered', uuid}` once the prompt's row is noticed.
- **Pending requests.** Smallest route: a band of `RequestCard`s above the composer. Fuller route: synthesize `permission.requested` / `question.requested` events into the source, so MAWS draws `request_slot` rows at the call, with `renderRequest` drawing `RequestCard` (`Transcript.tsx:229`, `derive.ts:1320-1323`).
- **Async ask-mod questions.** Overlay the log's `question` and `answered` events on the question row. The join key is the log event's `src`, which is the tool-use id (`stream.ts:7-8`).
- **Lifecycle lines.** The header and sidebar already show them; keep only ended/retired as an end marker.
- **Offline fallback.** An offline machine serves no transcript (`TranscriptPane.tsx:24`). Today the channel still shows "everything it sent stays here" (`ChannelView.tsx:63-66`). So keep `buildStream` as the fallback for offline machines, and possibly the phone, and keep it for the group chat.

### What the depth column keeps
Subagents, Diff and Info all stay. They are fed by the main subscription, so `DeskTranscript` has to move out of `SessionDepth` (`DepthColumn.tsx:40`) into a per-session owner that both the center view and the column use, as one subscription. MAWS's store already shares one attachment per key (`stores/transcript.ts:49`).
- `openSubagent` (`DepthColumn.tsx:51-64`) needs a small shared store, so an Agent row in the center can open the column's Subagents tab.
- The status word (`:73-75`) moves to the center header.
- With the direct channel's folds gone, these retire: `FoldTranscript`, `range.ts`, `export-marks.ts`, `unfold-turns.ts`, and the DX8 `transcript` slot.

### Smallest design
In desk-web only:
- `SessionView` = `<Transcript ownerLane>` over the shared main controller;
- the Report · Transcript toggle;
- `tail` rows for undelivered sends;
- the request band or slots;
- the log stream as fallback.

Optional additions: the bridge's `delivered.uuid`, and the MAWS classify entry. No hub change.

### Risks and unknowns
- **The phone is bound by an owner decision.** §4 says "[binding — owner, 2026-10-15] Session depth (the transcript stream, the subagent tree, the diff) stays desktop-only" (`MAWS/docs/doperpowers/specs/2026-10-15-desk-design.md:499-504`). A transcript-driven channel on the phone also pulls in MAWS's Markdown and shiki chunk.
- Removing the slot changes the DX8 contract (`desk-design.md:3094-3117`).
- **The folds differ from the terminal.** P2-C folds per turn and draws unmarked turns whole. The to-human mod folds runs between rows the human reads, across turns.
- Question-card actions are inert in the desk because the mark is null. I have not confirmed that they make no IPC call when they mount.
- History-loading cost moves into the center view (see Q2).

### The remote-surface route (your added question)
**Where the mods client lives in MAWS**
- **Host side:** `MAWS/src/engine-host/surface.ts:1-75`. It attaches as surface `"desktop"` via `ui_attach`, only when `system/init.capabilities` includes `ui_surface_v1`.
- **Control requests:** `engine-host/controls.ts:107-119` — `ui_attach`, `ui_render`, `ui_panes`, `ui_press`, `ui_input`, `ui_select`, `ui_pane_show`, `ui_pane_focus`, `ui_close`, `ui_scroll`, `ui_focus`, `ui_prompt_edit`.
- **Wire shapes:** `shared/wire/control.ts:381-407`. Sites and the render answer `{tree, props, rewritten, hooked}` are in `shared/engine/surface.ts`.
- **Renderer:** `renderer/src/engine-surface/*`. `site.ts:15-55` asks per (session, component, instanceId) while attached; `SurfaceTree` validates nodes; `SurfaceRow` and the panes code draw them. Transcript rows ask for `AssistantMessage` per row (`surface/Rows.tsx:98`).
- **Engine to host:** pushes `ui_invalidate`, `ui_log`, `ui_toast`, `ui_status`, `ui_panes`, `ui_scroll`, `ui_focus`; requests `ui_copy` and `ui_prompt_read/fill/suggest` (`MAWS/docs/doperpowers/evidence/ux-2026-10-01/r6-claude-mods.txt:282-300`).

**Why the desk can't use it**
- The protocol is "part of the engine's stream-json control channel" (r6:21). The capability is advertised only when "the session is not on a remote transport" (r6:279-280).
- Only the process's SDK host has that channel: MAWS, for sessions it launched. A terminal `claude` session or a seat exposes nothing the uplink can attach to.
- From inside the session, the bridge can't stand in. `$.ui` has `invalidate`, `blit`, `resolve`, `log`, `ask`, `toast`, `notify`, `status`, `open`, `close`, `panes`, `scroll`, `focus`, `copy`, `selection`, `view` and others, but no `render` (d.ts ~2380-2700). `ui.render` exists only as an event in `EventCalls` (d.ts:4826, 4881), not as a method on `$`.

**Cost if it were possible:** a `ui_render` round trip per row through browser → hub → uplink → engine; live sessions only, so no history for ended or offline ones; and `ui_press` would run mod handlers from the web, a new trust surface under §6.

**Verdict:** reuse the MAWS model already in the bundle. The remote surface becomes worth revisiting only if the engine adds a render call a mod can make, or a surface transport for terminal sessions.

---

## Q2. History from before the session joined

### Current behaviour
- **The log starts at the join.**
  - SessionStart sets the export position to the transcript's end (`DP/skills/sminos/scripts/sminos.py:2244-2263`).
  - With no position set, Stop exports only the trailing run of assistant records (`:2266-2290`).
  - The bridge exports spans only as they are written after it loads.
  - So the direct channel begins at `joined`. Pre-join work shows up at most inside the first fold, the one with `from: null`.
- **The bridge seeds its cut from the transcript tail.** The child seeds each loop's cut with its last row at hello (`sminos_bridge.py:353-362`, `last_row` at `282-317`), and the mod adopts it (`bridge.tsx:561-567`, `bridge-stream.tsx:195-203`).
- **Plane `open`.** `Tail` reads the whole file from offset 0. History is the rows through the cut (`sminos_plane.py:419-434`); with no bridge, it is all rows (`:434`). The snapshot carries the newest rows that fit `ROWS_BUDGET` of 512 KB (`:86, 165-175, 440`).
- **Plane `page()`.** It re-reads and parses the whole file (`rows_of`), finds `before`, and returns rows within the limit and 512 KB (`:605-613`).
- **Web.** `loadOlder` asks for `rows(oldest.uuid, 100)` (`desk-transcript.ts:300-306`). Each page is prepended and the whole source rebuilt (`:446-454, 470-474`). `older-pages.ts:35-59` asks when the reader is at the top or the list doesn't fill the pane. The hub relays the request (`hub/project-client.ts:193-195`).

### Where the history stops
1. **Direct channel:** at the join, because it reads the log.
2. **An ended session: at the newest 512 KB.**
   - The plane ends the subscription with `session-ended` after a 1 s grace (`finish`, `:590-603`), and `tick` drops it.
   - `rows` for an unknown subscription returns nothing (`:957-962`).
   - The web clears its subscription on `end` (`desk-transcript.ts:354-357`), and `loadOlder` needs one (`:303`).
   - Nothing retries for a session that isn't reachable (`TranscriptPane.tsx:90`).
3. **A live session: reachable, but too slow in practice.**
   - Each page re-parses the whole file synchronously on the uplink's main thread (plane module doc `:6-9`; uplink `:687`).
   - I measured 2.15 s per full parse of this coordinator session's 156 MB transcript (12,704 rows).
   - At 512 KB per page, about 40 rows of ~12 KB each, reaching the start takes about 300 pages, roughly 11 minutes of stalled uplink.
   - The web also re-maps every held row on each page, so the total work grows with the square of the row count.
4. **The first fold** pages older rows automatically only when its end bound is missing (`FoldTranscript.tsx:28-31`).

### What serving older pages from disk would take
The plane already serves from disk; it needs three changes:
- **Plane: an offset index.** Record uuid → byte offset during the `Tail` parse, so `page(before)` seeks there and reads backward in blocks, as `rows_after` and `last_row` already do in the bridge child. Run pages on a thread, as `diff` does (`:964-981`).
- **Plane: keep an ended session's subscription pageable.** Send its last rows, then stay idle and answer `rows` until unsubscribed. Liveness then comes from presence, which the web already reads (`TranscriptPane.tsx:21`). This changes the DX4 meaning of `end{session-ended}` (`desk-hub/src/protocol/session.ts:177`).
- **Web:** stop treating `session-ended` as the end.

### Sessions with no bridge
Covered, under two conditions: the session joined from that machine, since the plane's `here` set comes from the log (`sminos_plane.py:832-845, 924-928`), and the machine runs the current daemon. With no endpoint the subscription is transcript-only: reader None (`:931-936`), empty streaming, null usage. The transcript is found by session id (`sminos.py:3734-3746`).

Not covered: an offline machine, an old daemon, or history left under an old session id after `/clear`. A session without the to-human style has no marks, so it draws as a full transcript.

### Risks
- `open()` also parses the full file for every subscription and keeps every uuid (`:303-337, 419-438`).
- The hub allows at most 32 subscriptions per socket (`desk-hub/src/objects/project.ts:52`) if ended ones stay open.
- DX4 belongs to DC3, so this is a contract amendment.

---

## Q3. Subagents that ran before

### Current behaviour
- **Where the plane gets the list.** Not from `$.agent.list()`. `metas()` globs `<session>/subagents/agent-*.meta.json` (`sminos_plane.py:195-216`), sends it in the snapshot (`:455`), and re-checks every 0.5 s (`:581-588`).
- **The bridge's agent state is dropped.** The bridge emits agent spawn and stop (`bridge.tsx:1059-1088`); its child keeps them and puts `agents` in its snapshot (`sminos_bridge.py:481, 617, 661-667, 773`). The plane drops both: `event()` handles only chunk, block-row, row-seen, step, turn, usage and gap (`:485-527`).
- **The web gives a disk-only agent status "unknown".** The web builds `taskGraphOf(metas, events of the held rows)` (`depth/agents/task-feed.ts:28-29`). `mergeSidecars` creates disk-only nodes with status `unknown` (`MAWS/src/renderer/src/tools/agents/model/task-graph.ts:416-421`).
  - `agentTree` leaves those out (`:594`). They show only under "On disk / status unavailable" (`SubagentTree.tsx:41-45, 139-140`; `sectionOf` at `:538`).
  - A nested agent's spawn row is in its parent agent's transcript, never in the main rows, so it can never resolve.
  - Sidecar size, mtime and path are zeroed (`task-feed.ts:19`).

### What's on disk
Read-only look at this coordinator session: 158 pairs of `agent-<id>.jsonl` and `agent-<id>.meta.json`, plus a `workflows/` directory. The subagent files total 1.1 GB; the main transcript is 156 MB.

A meta file holds `agentType`, `description`, `toolUseId`, `parentAgentId`, `spawnDepth`, `requestShape` (e.g. "background"), `spawnedWithWorktree`, `inheritedWorktreePath` and similar. It has no status and no times.

Opening one agent already works: a per-agent subscription on the agent's file (`sminos_plane.py:189-192`), with Q2's paging limits.

### Design
- **Plane: add disk facts to each `subagents` entry.** The hub relays these bodies without reading them, so this needs no hub change, only a wider `SubagentMeta` type at `session.ts:200`. Add:
  - `size`, `mtimeMs`, and first and last row timestamps, cached by (size, mtime);
  - an outcome from the main transcript, collected during the parse `open` already does: a non-async tool_result for the meta's `toolUseId`, task-notifications, and `task_status` attachments (`{taskId, taskType, status, outputFilePath}`, present in this transcript);
  - `running`, from the bridge's agent state, forwarded instead of dropped.
- **Nested agents:** running per the bridge; otherwise ended if the session isn't running.
- **Bridge (optional):** poll `$.agent.list()` as `agents.tsx:328-345` does, to report live agents that predate the module.
- **Web:** `task-feed` patches unknown-status nodes from these facts. Do it on the desk side, not in MAWS's `mergeSidecars`, which MAWS's own store uses.

### Risks
- Re-reading 158 agent files every 0.5 s needs the cache.
- `list()` keeps an agent only briefly after it ends (d.ts:3265-3267).
- The `workflows/` directory isn't covered by the glob.

---

## Q4. Background jobs

### What a mod can read
Per d.ts. I read the `$.ui` and `$.session` members myself. The other line references come from a sub-survey I delegated; I did not re-read them.
- There is no `$` namespace for shells, monitors, tasks or MCP servers. `$.mcp` has only `call` and `connect` (d.ts:2746-2784); `connect` returns connection state as a side effect (d.ts:6024).
- `$.agent.list()` returns `{id, description, type, status, parentId, spawnedBy, name}` (d.ts:124-183, 3248-3290). A `waiting` agent is one idle on its own background work, which is an indirect signal.
- `classic.SubagentStop.background_tasks` gives `{id, type: shell|subagent|monitor|workflow, status, description, command?, …}` (d.ts:819-850, 12808-12825), but only when a subagent stops.
- doperpowers today: the bridge regexes Bash results for a background id only to stop them on interrupt (`bridge.tsx:105, 316-322`). `agents.tsx` uses `$.agent.list()` plus a disk seed (`:328-345, 618-632`).

### What the transcript rows carry
Verified in this coordinator session's transcript:
- **Bash in the background:** the result's `toolUseResult.backgroundTaskId`, plus "Output is being written to: …" in the text (MAWS's `parseOutputPath`, `task-graph.ts:201-205`).
- **Monitor:** `toolUseResult {taskId, timeoutMs, persistent}`.
- **Job ends:** a `queued_command` attachment with `commandMode:"task-notification"` (`<task-id>`, `<tool-use-id>`, `<output-file>`, `<status>`, `<summary>`), and `task_status` attachments.
- **MCP:** `mcp_instructions_delta.addedNames` and `deferred_tools_delta` give server and tool names. No status.

### What the MAWS app shows, and from where
- **Source:** it is the SDK host, so it receives stream-json system frames: `task_started`, `task_updated`, `task_progress`, `task_notification`, `background_tasks_changed` (`MAWS/src/shared/wire/frames.ts:88-138`). These are normalized in `engine-host/normalizer-system.ts:141-187` into the task graph (`kindOf` `:74-80`, `shells()` `:656`, `monitors()` `:660`).
- **MCP:** `system/init.mcp_servers` plus the `mcp_status` control request (`controls.ts:78`).
- **Components:** `panel/summary/BackgroundWork.tsx`, `tools/agents/background/BackgroundTool.tsx`, `TaskRows.tsx` (`ShellRow` `:72` opens the output log, `MonitorRow` `:83`), `widgets/McpWidget.tsx`, `subagents/AgentList.tsx`.
- **Gap in MAWS's own backfill:** it emits task events only for agents (`engine-host/fs/backfill.ts:255-284`). It has no shell or monitor starts and ignores `task_status`.
- **The desk today shows no background jobs.** Its graph comes from that same backfill, and a result carrying `backgroundTaskId` only patches an existing node (`task-graph.ts:314-320`).

### Design
- **Shells and monitors, from the rows.** Map:
  - a Bash result with `backgroundTaskId` → `task.started` (`local_bash`, background, command, output file);
  - a Monitor result's `taskId` → `task.started` (monitor);
  - a task-notification or `task_status` → terminal status;
  - a `TaskStop` call → stopped.

  Prefer putting this in MAWS's backfill so MAWS gains it too. Combine it with the plane-side index from Q3, so jobs older than the held rows still appear. Draw with `ShellRow` / `MonitorRow`, which import no IPC.
- **Output.** A plane request in the style of `diff`: `output {taskId, tail}`, reading the task's output file, with the path checked to sit under the session's `tasks/` directory. This needs a new browser frame and a new DX4 kind. The hub refuses unknown kinds (`project.ts:391-392`; `SUBSCRIPTION_KINDS` at `session.ts:205`), so the hub must ship first.
- **Stop (optional).** A DX6 RPC → bridge command → `$.tool.call({tool:'TaskStop', task_id})`, which the bridge already uses (`bridge.tsx:322`).
- **MCP.** Names only, from the delta attachments. Status needs the SDK host, so defer it.

### Risks
- These attachment shapes are engine internals, absent from the public typings, and may change between releases.
- The output files live in tmp and may be gone.
- Serving files needs the path containment check.

---

## Coupling that should shape the cut
1. **Q1 depends on Q2's machine fixes.** Q1 moves the main subscription into the center view, which makes history paging something the owner sees all the time. Land the plane's offset index, threaded pages and pageable ended sessions with Q1 or before it.
2. **Q3 and Q4 are one problem with one fix:** status for things whose start lies outside the held rows. One plane-side jobs index (agents, shells, monitors), built from the full parse the plane already does at subscribe, kept current from live rows, merged with the bridge's agent state, and carried in an existing DX4 body, solves both. Deriving it from rows on the web can't.
3. **Deployment order.** Any new DX4 kind or browser frame, such as Q4's output fetch, needs a hub release before the uplink sends it. Extending existing bodies is invisible to the hub.
4. **Owner decisions come first.** The phone question in Q1 (the binding §4 decision) and the per-turn versus cross-turn fold shape need the owner before the web unit is cut.
5. **Shared MAWS edits affect the desktop app.** The classify entry for the ask tool and the shell/monitor events in the backfill should be coordinated with MAWS.

**Suggested units:**
- **(a) Machine:** plane paging fixes, the jobs index, and forwarding the bridge's agent state.
- **(b) Web:** the session view (report lane, toggle, lifted controller, merge of log items, offline fallback).
- **(c) Web:** the depth column's agents and background jobs, read from the index.
- **(d) Optional:** the bridge's `delivered.uuid` and the `$.agent.list()` poll.