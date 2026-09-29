# Protocol probe, pass 3: agent work (nested subagents, relay to a child, stop_task)

Engine 2.1.283 through the relay under a scratch config home. Scenarios `scenarios/pass3/nested-agents.mjs`, `relay-to-child.mjs`, `stop-task.mjs`; fixtures `fixtures/pass3/nested-agents.jsonl` (with `nested-agents-sidecars/`), `relay-to-child.jsonl`, `stop-task.jsonl`. The text below is the entry the C8b execution document (`docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md`, Surprises & Discoveries) carries for this file, saved here by the architect on 2026-09-29 because the executing agents' environment refuses to create `.md` files; the document is the record of any later amendment.

> # Pass-3 findings: agent work (C8b Gate G1: R1, R5, R6)
>
> Child C8b of `docs/charter.md`, execution document `docs/doperpowers/plans/2026-09-28-c8b-agent-work-tools.md`, parent pin `a1596d017618b1ab792f3f7e01d08b7de3d01ee8`. Engine 2.1.283 (the pinned `BIN` of `scenarios/pass2/common.mjs`) through ClaudeUsage's relay, each probe under a fresh scratch `CLAUDE_CONFIG_DIR` under `/tmp` (nothing read from or written to the owner's `~/.claude`), with `--forward-subagent-text --replay-user-messages` as the product launches and `initialize { perTaskStopAffordance: true }`. Recorded 2026-09-29. Spend: US$1.80 over five runs (R6 0.31, R5 0.30, R1 0.49, 0.36 and 0.34; the first two R1 runs were superseded, see R1).
>
> ## R1: relay to a child (`scenarios/pass3/relay-to-child.mjs`, `fixtures/pass3/relay-to-child.jsonl`)
>
> Setup: `mode: 'default'`, parent sonnet. Turn 1 dispatches an unnamed background haiku agent that loops (Read `one.txt`, then one `Bash` of `sleep 4; echo "round N" >> rounds.txt; test -f stop.txt …`, appending any message it receives to `inbox.txt`) until the probe writes `stop.txt` after the last case. The steer is C3's frame with `priority: 'next'` and the draft `relayText` (`Relay to agent <id> with SendMessage, verbatim, then continue what you were doing: <text>`). Every `can_use_tool` is recorded and allowed at once, except the child's next `Bash` in the busy case, which is held.
>
> | Case | Parent at the steer | `SendMessage` seen | Receipt live | Receipt on disk only | No receipt | Turn started by the steer |
> |---|---|---|---|---|---|---|
> | idle (background child) | no turn open, no tool in flight | yes, seq 196, 3.4 s after the steer, 2 parent rounds (`ToolSearch select:SendMessage`, then `SendMessage`) | no | yes: `queued_command` attachment, 0.9 s after the send | no | yes (queued 152, started 153, a new turn) |
> | busy (background child, its `Bash` held) | turn open, its own `sleep 45` in flight | yes, seq 315, 40.9 s after the steer, 1.4 s after the `sleep 45` returned, same turn, 1 parent round | no | yes: `queued_command` attachment, 4.0 s after the release, when the held `Bash` finished; nothing while held 15 s after the send | no | no (folded into the open turn at its tool boundary) |
> | foreground (named "walker" in the prompt, unnamed on the wire) | turn open, blocked in `Agent` | yes, seq 543, only after the walker returned (517), 22.9 s after the steer | yes, on the `agent-stopped` route: the resume `task_started` at seq 548 carries the text as `prompt` (C3: `subagent.started.prompt`); the probe's `relay_verdict` says `receiptLive: false` because its detector looks only for a `user` frame in the child's lane | also on disk: the resumed agent's `isMeta` user record | no | no |
>
> - Wording: the first wording routed in all three cases; the second wording and the `'now'` idle fallback were never needed.
> - `SendMessage` input: `to` (the agent id), `summary`, `message` (the text verbatim), plus keys the model added (`type`, `recipient`, `content`) that the tool accepts. No `can_use_tool` for `SendMessage` in default mode.
> - Reply text, a JSON string on 2.1.283: live child `{"success":true,"message":"Message queued for delivery to <id> at its next tool round.","pin":{"id":…,"name":…,"ref":…}}` (route `agent-live`); finished foreground child `{"success":true,"message":"Resuming agent <7-character id>","resumedAgentId":…,"pin":{…}}` (route `agent-stopped`).
> - Receipt: for a live child (route `agent-live`) never on the wire; for a resumed child (route `agent-stopped`) live as the resume `task_started`'s `prompt` (seq 548, `is_backgrounded: true`, `tool_use_id` the `SendMessage`'s). For a live child the transcript gains `{ type: 'attachment', attachment: { type: 'queued_command', prompt, source_uuid, origin: { kind: 'coordinator' }, isMeta: true } }` at the child's next tool round, rendered to the model as a system reminder ("The coordinator sent a message while you were working: … Address this before completing your current task."). For a resumed child it is a `{ type: 'user', isMeta: true, origin: { kind: 'coordinator' } }` record with the same wording as a plain string. C4's disk path drops `attachment` records (`engine-host/fs/backfill.ts:96`), so no MAWS surface shows the relayed text in a live child's transcript. The live trace there is the child's next assistant message acting on it (seq 222, 341, 580). The probe's `relay_verdict` reads `receiptLive: false` for all three rows because its detector (`relay-to-child.mjs:70`) recognises only a `user` frame in the child's lane; the foreground row's live receipt is the resume start.
> - Rounds: parent rounds from the steer to the `SendMessage`: 2 (idle, the extra round loading the deferred tool), 1 (busy), 1 (foreground). Delivery came at the end of the child's tool call in flight at the send, within one child tool round.
> - Foreground: the steer waits while the parent is blocked in `Agent`; after the child returns the parent sends, and the engine resumes the agent in the background: a second `task_started` for the same id with `tool_use_id` the `SendMessage`'s, `is_backgrounded: true`, `prompt` the relayed text. The resumed agent finishes on its own and the parent gets an engine-origin turn.
> - Also seen: every foreground `Bash` longer than a few seconds registers a `local_bash` task with `is_backgrounded: false` (a child's flagged `owned_by_subagent: true`, which C3 drops); a 30 s `tool_progress` heartbeat for the parent's `sleep 45`; the `Agent` tool has no `name` input.
> - Superseded runs: the first two runs (overwritten) mistook the parent's `result` and the child's permission request, both quoting the text, for receipts. The committed scenario looks for a user frame in the child's lane and records the child's reaction and the disk record separately. Routing, timings and the disk form matched across all three runs.
>
> Verdict: the relay routes (b) in every parent state; for a live child (c) is unobservable on the live wire and in C4's disk transcript on 2.1.283; a foreground child is reached only by resuming it after it returns, and that resume carries the text live as `subagent.started.prompt`.
>
> ## R5: nested agents (`scenarios/pass3/nested-agents.mjs`, `fixtures/pass3/nested-agents.jsonl`, `nested-agents-sidecars/`)
>
> Setup: `mode: 'default'`, `Agent`, `Task`, `Read`, `Bash` allowed for every requester; a sonnet child dispatches a haiku grandchild, both in the foreground.
>
> - The grandchild's `task_started` reaches the parent's stdout (seq 112, `spawn_depth: 2`, `tool_use_id` the child's `Agent` call `toolu_012r…`, no parent field). The child's `Agent` `tool_use` is forwarded in the child's lane (seq 111, `parent_tool_use_id` the child's own `Agent` call), so C3 attributes it to the child (`tool.use.agentId` = the child). The grandchild's frames carry `parent_tool_use_id` = the child's `Agent` call; no frame carries `agent_id`. No refusal: nesting is allowed.
> - Sidecars: the grandchild's `meta.json` has `parentAgentId` = the child's id, `spawnDepth: 2`, `toolUseId`; the child's has no `parentAgentId`. Neither has a `name` key.
>
> Verdict: live nesting, through the issuing `tool.use`'s `agentId` (C3's `subagent.started.parentToolUseId` is null); the sidecar confirms it once written.
>
> ## R6: stop_task (`scenarios/pass3/stop-task.mjs`, `fixtures/pass3/stop-task.jsonl`)
>
> Setup: `mode: 'auto'` (no `can_use_tool` arrived); a background shell, a background haiku agent after its first progress, and a one-phase workflow after its first progress, each stopped with `stop_task { task_id }`.
>
> | Kind | Frames after the request (seq, ms after the request) | Response |
> |---|---|---|
> | shell `ba3cr5gnx` | `background_tasks_changed []` 44 (8), `task_updated killed` 45 (8), `task_notification stopped` with `output_file` 46 (9) | `success {}` at 47, 9 ms |
> | agent `ac2bd8a00d8e492f4` | 136 (3), 137 (3), 138 (3) | 139, 4 ms |
> | workflow `wkmzd07jp` | 231 (3), 232 (3), 233 (3); no frame for its agent, no progress after | 234, 3 ms |
> | missing id `no-such-task` | none | `success {}`, 2 ms |
> | the shell again | none | `success {}`, 2 ms |
>
> - Cascade: moot on this build. The stop went out 10 ms after its agent's `startedAt` and 27 ms after the workflow's `task_started` (seq 223 at 13.406, the first `task_progress` with the agent in state `start` at 229, the `stop_task` at 230, both at 13.433), and a workflow's agents have no task of their own on the wire (pass 2's finding), so no agent-level `task_updated` or `task_notification` could follow; none did.
>
> Verdict: `stop_task` gives the interrupt path's order (snapshot without the task, `killed`, `stopped`) and answers after all three frames, within 10 ms; a missing or already-stopped id is an idempotent success with no frame, so a 2,000 ms settle window before removing such a node holds with a wide margin.
