# E7 — Orchestration views: the workflow widget, the topology tree, cross-session rows, the Tasks panel, scheduled loops

> **Parent:** `docs/doperpowers/plans/2026-10-05-p1-extension.md` (the P1 composite spec), child id **E7**, parent pin (git blob) `b7f8abc0ecbfa77123ac735a8e90dfa80e2a6b35` as dispatched (the blob at this branch's head a5e14bec; master's blob at authoring time is `f331e3c0ba3d04e8acc18656a3a8eff6e87369f9`, later landing records only). The design is the parent's §3 E "Orchestration views" [binding: edits through the session, P-11; the widget and tree are in, P-9; advisory: the vault's widget layout and the Codex subagent panel]; the acceptance is §9 E7 gates G1 to G5; the contracts are X1 (extended through the interface ledger, append-only), X5 (consumed unchanged) and X13 (nothing added to the host assumes the host dies with the app). The interface ledger `docs/doperpowers/plans/2026-10-05-p1-interface-ledger.md` reserves `peer.message`, `peer.list` and the `subagent.message` emission (§2) and `tasks.edit` (§5) for this child and names `tasks` as a `show_pane` value whose tool E7 supplies (§1). This document is the child's execution document for a `doperpowers:plan-executor` on Opus (A-21): the constraints, the design residue §3 E leaves open with each decision's reason, the interfaces, the milestones with their proofs and review rungs, and the record. The parent, the ledger and `docs/charter.md` are never edited by this child (A-12); the executor's hand-back writes the one charter §19 line at landing.

## Purpose

After E7 the owner supervises orchestration without the terminal (P-3's first item, "live workflow progress"). A Workflow run opens from the summary's Background work row or its card into a **widget**: phases on the left with `done/total`, the selected phase's agents on the right with model, state and elapsed; a click on an agent opens its transcript in the Subagents drill-in; Stop stops the run where the engine allows it; the widget draws the same from the live wire and from the engine's files, so a run from yesterday reads as it did while it ran. The Subagents tool's resting state becomes a **tree**: running agents first with their nested children under them, each parent's finished children folded under a count, finished roots under a folded Done section, orphans marked as today. Cross-session traffic becomes legible rows: a `ListAgents` result draws as a list, a `SendMessage` to another session draws as a message between sessions naming the recipient, a message from another session draws with its sender and a **Reply** control whose text the session's agent sends with `SendMessage`; teammates draw under their lead. The **Tasks panel** (`show_pane 'tasks'`) edits a task list through the session: a status change, a reorder or a new task sends one steer the agent executes with the engine's task tools; the edit shows as pending until the task files confirm it, and an edit the agent does not act on is shown as such after a bounded wait; MAWS never writes under `~/.claude` (P-11). **Scheduled loops** the engine exposes in the transcript (`CronCreate` calls and the durable `scheduled_tasks.json` of the project) are listed with their next run and a link to the creating turn. This closes the parent's §2 items 1 and 12.

To see it working: `pnpm dev`, open a live session that ran a Workflow, click the summary's Background work row, then the run's card; open Subagents for the tree; in the Tasks panel change a task's status and watch the row go pending, then confirmed; send the session a message from a second session (`claude` in a terminal, same `~/.claude`, `SendMessage {to: <this session's name>}`) and reply from the row.

## Progress

- [x] (2026-10-06) Grounding against this branch (a5e14bec): the agents tool and its stores, the task graph, the workflow card, the checklist, the relay, the engine host's readers and their IPC, the X1 schema, the transcript's classification and derivation, the X5 contract, E1's in-flight `panes.ts` and its `classify.ts`/`rows.ts`/`events.ts` appends, the fixtures (`nested-agents-sidecars` carries `parentAgentId`), the SPEC library (20, 22, 38, 39, 18, 11, 40), C8b's and C12's findings (Surprises).
- [x] (2026-10-06) This document written.
- [ ] Adversarial review of this document (`doperpowers:adversarial-reviewer`, Opus), findings folded.
- [ ] M0 — Probes and fixtures: peer message and listing, the task-edit steer, cron records; findings; the owner-file delta.
- [ ] M1 — Shared model: the envelope parser, the cron parser, the listing parser; `peer.message` and the `subagent.message` emission in the normaliser.
- [ ] M2 — Transcript rows: the listing row, the `between` and inbound rows, the Reply composer through the relay store.
- [ ] M3 — The workflow widget.
- [ ] M4 — The topology tree and teammates.
- [ ] M5 — The Tasks panel and the edit state machine.
- [ ] M6 — Scheduled loops.
- [ ] M7 — Harness, e2e, gates, evidence, whole-branch review, hand-back.

## Terms

- **Task graph**: the renderer's one reducer over the X1 task and subagent events, the status's background list and the engine store's sidecars and workflow runs (`src/renderer/src/tools/agents/model/task-graph.ts`), kept per session by the task-graph store (`store.ts`) and fed only through the **agent-work client** (`client.ts`).
- **Run**: one workflow execution: the `local_workflow` task on the wire (`task.started`, `workflow.progress`, `task.notification`) and on disk `<session>/workflows/<runId>.json` plus `subagents/workflows/<runId>/journal.jsonl` and the agents' sidecars (`src/engine-host/fs/workflows.ts`, `subagents.ts`).
- **Progress snapshot**: one whole array of `workflow_phase` and `workflow_agent` rows (`model/workflow-progress.ts:9-13`), the wire's `workflow.progress.progress` or the disk snapshot's `workflowProgress`, the same shape (`fs/workflows.ts:4-6`).
- **Widget**: the Background work tool's drill-in view for one run (Design §2). **Tree**: the Subagents tool's resting view (Design §3).
- **Peer message**: a `user` frame whose origin kind is `peer` (SPEC 11 §11.11.5), carrying either the `<cross-session-message from=…>` envelope of another session (SPEC 38 §38.23.1) or the `<agent-message from="<agentId>">` wrapper of an in-process agent's `SendMessage` to the main conversation (C8b's finding, `task-graph.ts:335-348`).
- **Steer**: `session.steer {content, priority: 'next'}` (`src/shared/ipc/schema/session.ts:96`): a user message the engine folds into the running turn at its next tool boundary, or starts a turn with when idle (`pass3/steer-next.jsonl`); the relay composer's mechanism (`relay-store.ts:184`). Every edit E7 asks of the session is one steer.
- **Pending edit**: a Tasks panel edit between its steer and the task files' confirmation (Design §6). **Cron job**: one `CronCreate` record, session-only (in memory, listed from the transcript) or durable (`<project>/.claude/scheduled_tasks.json`, SPEC 22 §22.5).
- **Listing**: the `ListAgents` result's `listing` text, sections `Subagents (n):`, `Teammates (n):`, `Peer sessions (n):`, rows `"  " + [primary, ...extras].join("  ·  ")` (SPEC 38 §38.26.3).

## Constraints

Binding on every milestone:

- **P-11 [binding]**: the Tasks panel edits through the session; an edit sends a steer the agent executes with the engine's task tools; MAWS never writes under `~/.claude` or `~/.claude.json`; the panel shows the pending edit until the file changes. The engine host's task reader stays read-only (`src/engine-host/fs/tasks.ts:4`).
- **P-9 [binding]**: the full widget and the topology tree are in; the drill-in stays C8b's (`DrillIn.tsx`).
- **D-1**: the engine is unmodified and version-pinned (installed 2.1.291; the SPEC library is 2.1.287); every wire or disk claim this document depends on and no fixture shows is recorded first (M0), never asserted.
- **X1** (append-only, the ledger's §6 order): `src/shared/graph/events.ts` gains `peer.message` appended after E1's `maws.*` block at the end of `EVENT_KINDS` and of the union; `peer.list` is released (Decision Log 4); `subagent.message` is emitted, its schema unchanged (`events.ts:193`). Any further name goes to the architect before a sibling uses it.
- **X3** (append-only, ledger §6): `classify.ts`, `rows.ts`, `derive.ts`, `schema.ts`, `serialize.ts` gain E7 blocks (`// E7 start … // E7 end`) appended after E1's; the `agent_message` row gains optional fields; one new row kind `agent_list`. Nothing of C6's or E1's is reordered.
- **X5** (`src/renderer/src/panel/tool.ts:11-45`): one new tool, id `tasks` (E1's `PANES.tasks` already names it, `src/shared/maws/panes.ts:16` on E1's branch); its state is a handle outside React as the agents tools' are (`SubagentsTool.tsx:44-134`), its watches released in `dispose`.
- **X13**: the only host change is the normaliser's emission of two X1 events from frames it already handles (Design §4); no host state, no assumption about the host's lifetime.
- **Standing rules**: `~/.claude` and `~/.claude.json` read-only (reading the owner's task files to learn their shape is allowed and was done; writing never); live probes run under a scratch `CLAUDE_CONFIG_DIR` through ClaudeUsage's relay with the owner-file delta check of A-15 (`spikes/protocol-probe/scenarios/pass3/p1-common.mjs:46-56, 94-118`); no polling waiters; every process a step starts is stopped; no `.md` file is created (findings are `.txt`, A-12); commits are fresh, never amended, no attribution footer of any kind (not overridable; passed to every subagent); heavy commands through the slot (Concrete Steps); at most four workers (A-13); every reviewer on `model: "opus"` (A-22).
- **Tokens and copy**: components use tokens only (`text-fg-muted`, `border-border`, `bg-bg-hover`, `text-danger`, `text-success`, `text-accent`, as the existing agents views do); every sentence a view shows is in `src/renderer/src/tools/agents/copy.ts` or `src/renderer/src/transcript/model/copy.ts` (the repository's `copy.ts` pattern); light theme default; evidence screenshots in both themes.
- **Settings**: none. No settings version and no index migration is needed (Decision Log 12).

## Grounding (what exists, at a5e14bec)

- **The workflow card.** `WorkflowCard.tsx:26-83` draws a run as a card: the task's description, `workflow <name> · <elapsed> · <n> agents · <tokens>` (`BACKGROUND_COPY.workflowLine`, `copy.ts:88-89`), a `Phases` disclosure (expanded by default, `BackgroundTool.tsx:33-35`) over one `<title> <done>/<total>` line and an Agent, Model, Tokens, Time table per phase (`:86-114`), rows with an agent id opening the Subagents drill-in (`:124-159`, through `BackgroundView.openAgent`, `BackgroundTool.tsx:189`), `Stop workflow` while the run runs and the session is live (`:75-79`). The data is `node.workflow.progress` through `phasesOf` (`workflow-progress.ts:40-53`: agents grouped by `phaseIndex`, phase state queued/running/done) and `workflowTotals` (`:72-83`). The wire fills `progress` from `workflow.progress` (`task-graph.ts:292-300`) and the disk from `fs.workflows` snapshots (`mergeRuns`, `:474-502`; one card per run, a run node keyed by run id until its snapshot names the task), re-read 250 ms after each `fs.workflowChanged` (`store.ts:45, 318-327`). The journal rows (`launched`/`started`/`result`, keyed by agent, `src/shared/wire/store.ts:77-85`) are read (`fs/workflows.ts:23-35`) and carried on `WorkflowRun.journal` (`src/shared/ipc/schema/fs.ts:75`) but no view reads them. A workflow's agents are `local_agent` sidecars under `subagents/workflows/<runId>/` with `runId` set (`fs/subagents.ts:19, 65`), in no Subagents list (`task-graph.ts:519`); they have no task of their own on the wire (`spikes/protocol-probe/findings-pass3-agent-work.md` R6), so `session.stopTask` reaches the run, not an agent. The transcript's workflow ref opens Background work with the run selected (`actions.ts:34-37`: `params: { taskId }`), which scrolls to the card (`BackgroundTool.tsx:80-86, 181-186`). `perTaskStopAffordance: true` is declared at every initialize (`src/shared/engine/initialize.ts:9`); `stop_task` on a running workflow gives the interrupt path's three frames and answers success within 10 ms (R6, `pass3/stop-task.jsonl`; `pass2/per-task-stop-workflow-on.jsonl`).
- **The Subagents lists.** Three flat sections, Active, Done, On disk, each from `agentRows(graph, section)` with a `depth` per row (`task-graph.ts:543-569`): a child nests under its parent only when the parent sits in the same section, else it is an orphan at depth 0 with `· nested` and a tooltip naming the parent or "Child of an agent this session does not list" (`AgentList.tsx:90-143`, `copy.ts:15-17`). The parent comes from the wire (the child's own `Agent` call's issuer, `task-graph.ts:60-62, 211-242, 304-313`) or the sidecar meta's `parentAgentId` (`:433`; `src/shared/wire/store.ts:101`), which the fixture shows (`pass3/nested-agents-sidecars/agent-a425e926e506edeb1.meta.json`: `parentAgentId: "a38d4aebfaea9f6b1"`, `spawnDepth: 2`). Active shows four rows and Done ten before `Show N more` (`SubagentsTool.tsx:41`). The drill-in (`DrillIn.tsx:53-103`) and its relay composer (`RelayComposer.tsx`) are unchanged by E7 except where Design §4 says.
- **Messages.** `SendMessage` is presentation `agent_message` (`classify.ts:11`); the derive draws its tool use as `from_child` when `to === 'parent'`, else `to_child`, with `from` and `to` null and `agentMessageCopy` text (`derive.ts:349-353`; `transcript/model/copy.ts:246-250`: `Sent message to <name>: …`, `Message from <name>: …`, `Message from parent: …`); the `between` direction is never produced (parent §8). `subagent.message` is declared with `direction: 'between'` among its values and never emitted (`events.ts:193`; its derive case `derive.ts:437-440` is dead). A peer message arrives as a `user.message` with `origin: 'peer'` (the normaliser passes `frame.origin?.kind` through, `src/engine-host/normalizer.ts:356`); the transcript opens a turn of origin `peer` for it (`reduce.ts:186`, `derive.ts:64, 579-583`) and draws the raw envelope text as a user bubble (`derive.ts:309-312`). The task graph reads a peer `user.message` for a hand-back report (`task-graph.ts:325-329, 335-348`). `ListAgents` is unclassified: a grouped `other` cell. The engine's held-message frame `system/peer_message_hold` is already a status fact (`src/shared/wire/frames.ts:217-226`; `src/engine-host/session-status.ts:207-217`; `heldPeerMessages` on `EngineSessionStatus`, `src/shared/engine/status.ts:50`). The relay store steers the parent once with `priority: 'next'` and walks asked → forwarded → delivered by watching the session's batches (`relay-store.ts:82-119, 169-194`; `model/relay.ts:10-14`); `relayText` addresses an agent by id and real name (`:28-30`); `matchesSendMessage` reads the parent's `SendMessage.to` (`:34-38`).
- **The checklist.** `TaskChecklist.tsx:25-60` reads the list through `agentWorkClient().tasks(listId)` as a TanStack query `['fs.tasks', listId]`, invalidated on `fs.tasksChanged` by `connectAgentWorkEvents` (`src/renderer/src/ipc/events.ts`, mounted at `App.tsx:131`); the list id is C3's `status.taskListId` for a live session, else the record's engine session id labelled `session list` (`model/task-list.ts:16-20`); `checklistOf` orders in_progress, then pending, by numeric id, completed under `N earlier tasks completed` (`:34-38`). Rows are read-only (`:67-89`). The reader is `TaskReader.list` over `<configHome>/tasks/<listId>/<id>.json` (`fs/tasks.ts:16-29`), hiding `metadata._internal`; `fs.tasksChanged {listId}` is emitted by the watcher (`fs/service.ts:543, 553`). The record is `PersistedTask {id, subject, description, activeForm?, owner?, status, blocks, blockedBy, metadata?}` (`src/shared/wire/store.ts:47-58`; SPEC 20 §20.2.4); the owner's own files match it (`~/.claude/tasks/<uuid>/1.json`, read 2026-10-06). `TaskUpdate` updates `status` (`pending` → `in_progress` → `completed`, `deleted` removes), `subject`, `description`, `activeForm`, `owner`, `metadata` (a merge; a key set to null is deleted), `addBlocks`, `addBlockedBy` (SPEC 20 §20.3.3); there is no order field and no dependency removal. The task tools are enabled by `CLAUDE_CODE_ENABLE_TASKS !== false` and a model allowlist (opus 4.x, sonnet 4.x, haiku 4.5 among the fifteen) or `CLAUDE_CODE_ENABLE_TODO_TOOLS=1` (§20.2.1); C12's X6 ruling keeps the variable unset to mirror the owner's terminal, so on the owner's default model MAWS sessions have no TaskCreate or TaskUpdate (`docs/doperpowers/plans/2026-09-29-c12-finish.md:832, 1054-1056`; `pass3/launch-env-todo.jsonl`).
- **Scheduling.** `CronCreate {cron, prompt, recurring?, durable?}` answers `{id, humanSchedule, recurring, durable?}` and a result text `Scheduled recurring job <id> (<humanSchedule>). <Persisted to .claude/scheduled_tasks.json | Session-only (not written to disk, dies when Claude exits)>. Auto-expires after 7 days. …` or `Scheduled one-shot task <id> (…). <…>. It will fire once then auto-delete.` (SPEC 22 §22.9); `CronList` answers `{jobs}` and `CronDelete {id}` answers `Cancelled job <id>.` (§22.10). A session-only job lives in memory; a durable one in `<projectRoot>/.claude/scheduled_tasks.json` as `{tasks: [{id, cron, prompt, createdAt, recurring?, createdBySessionId?, …}]}` (§22.5), a project file outside `~/.claude`. The cron grammar is five fields, `*`, `*/N`, `a-b`, `a-b/N` and literals, day-of-week 7 folded to 0, Vixie OR semantics between day-of-month and day-of-week, a minute-stepping next-match search in local time (§22.3). Recurring fires carry a deterministic delay of up to half the period (30 min cap) and one-shots on :00/:30 fire up to 90 s early (§22.7). On resume the engine resurrects session-only jobs from the transcript's `CronCreate` calls and results, `CronDelete` winning (§22.5, "resume: resurrected N session cron task(s)"). No MAWS fixture holds a `CronCreate`. The viewer reads project files through `files.read` and `files.watch`, confined to the session's allowlist roots (`src/shared/ipc/schema/files.ts:3`; `src/main/files/allowlist.ts:13`).
- **Teams.** Gated by `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` and the `tengu_amber_flint` value (SPEC 39 §39.2.1); off, the `Agent` tool's `name` field is stripped from the wire schema (§39.8.1) and `~/.claude/teams` does not exist on this machine. A teammate is a named agent the lead spawned; the listing's `Teammates` section names them (§39.25). No MAWS fixture holds a team.
- **The harness.** `pnpm e2e:agents` runs `e2e/agent-tools.spec.ts` over the harness build: the `#panel` page, the real agents tools, the fake agent-work client whose wire half `agents.feed(id, fixture)` binds to the loaded fixture's player, `fakeFs` and `fixtureFs` for sidecars, runs and tasks (`src/renderer/src/harness/agents/api.ts:76-116`; `fakeClient.ts`); derived fixtures with recorded tails re-keyed to a journal's ids (`test/support/agents-fixtures.ts`, `agents-fixtures-tail.ts`). Theme evidence uses `otherThemeColours` (`e2e/support/panel-support.ts:104`).
- **E1 (in flight, worktree `agent-acafe2873e45094e5`).** `PANES.tasks = { toolId: 'tasks' }` (`src/shared/maws/panes.ts:12-20`) and `show_pane` passes `{target}` to the tool (ledger §1); until a build registers `tasks`, the renderer answers `paneUnavailableText`. E1 appends `maws.*` after `frame.unknown` in `EVENT_KINDS` and after the `frame.unknown` member in the union, and adds `// E1 start … // E1 end` blocks to `classify.ts` (`Presentation` gains `'ask' | 'delivery'`; `tableRowOf` checks the table before the MCP pattern) and `rows.ts` (`ask`, `delivery` rows). E7's blocks append after them.

## Design (the residue §3 E leaves open, with reasons)

### 1. Ownership and data flow

One renderer owner for every surface: the agents tool (`src/renderer/src/tools/agents/`). The task graph remains the one model of runs, agents and now cron jobs; the transcript's derive remains the one model of rows. The host changes in one place: the normaliser emits two X1 events from the `user` frames it already turns into `user.message` (§4), on the live path and the disk path alike, since both run C3's `Normalizer` (`src/engine-host/fs/register.ts:31-32`). No new IPC command: every edit is `session.steer` from the renderer, as the relay is (`relay-store.ts:184`); every read is an existing `fs.*` or `files.*` command. Pending edits and pending replies live in renderer memory, as pending relays do (`relay-store.ts:1-6`): a reload loses the pending mark and the files and rows remain the record.

### 2. The workflow widget (G1)

**Where.** The Background work tool gains a view, as Subagents has lists and a drill-in: `BackgroundState.view: { kind: 'list' } | { kind: 'run'; taskId: string }`. The widget opens from a card's title (a button) and its new `Open` chevron, from the transcript's workflow ref (`openSubagent` with `kind: 'workflow'` opens the widget rather than selecting the card: `actions.ts:34-37` passes `params: { taskId, view: 'run' }`), and from `BackgroundParams { taskId?, appSessionId?, view?: 'run' }` (additive). Back (`‹ Background work`) returns to the list with its scroll (the Subagents pattern, `SubagentsTool.tsx:100-102`).

**Layout** (the vault's design, advisory, applied): a header with the run's description, the existing line `workflow <name> · <elapsed> · <n> agents · <tokens>`, the status badge once ended or `Stop workflow` while running and live (the existing `StopButton`, no confirmation, `WorkflowCard.tsx:5`); below it two columns. **Left, phases**: one row per `WorkflowPhase` in index order, `<title>` and `<done>/<total>` (or `Queued`) with a state mark (dot, spinner, check), the selected one highlighted; an `All phases` row first. **Right, agents** of the selected phase (all, under `All phases`): glyph when the agent id is known (`SubagentGlyph` by agent id, as rows do), label, model (muted; `model unknown` never shown, just empty), state word as the row gives it (`queued`, `running`, `done`, else the string), elapsed (`durationMs` when reported, else `now − startedAt` ticking once a second while the run runs, `useTicker`), tokens; a row with an agent id is a button opening the Subagents drill-in (`ctx.openTool(AGENT_TOOL_IDS.subagents, { appSessionId, params: { agentId, appSessionId } })`, the card's existing hand-off), a row without one is inert with the title `Not started`. Default selection: the first phase in state `running`, else the last phase. Below 360 px of panel width (a container query on the tool's root) the columns stack, phases above agents. Keyboard: ↑/↓ on the phases column moves the selection; Enter on an agent row opens it.

**Data model.** `runView(node, run): RunView` (pure, `model/workflow-run.ts`): phases from `phasesOf(node.workflow.progress)` (the latest whole snapshot, wire or disk, `task-graph.ts:292-300, 488-497`); each agent row's `agentId` from the progress row, else from the journal (`node.workflow.snapshot` is the disk snapshot; the journal rows come through `TaskGraphEntry.disk.runs` by `runId`: a `started` or `result` row whose `label` or `key` equals the progress row's label gives the id), so a disk-only run's rows still open their sidecar transcripts; totals from `workflowTotals`. The widget subscribes to the same store the card does; nothing new is fetched. **Live and from disk**: a live run updates on each `workflow.progress`; a disk-only run on each `fs.workflowChanged` re-read; replay of `pass2/workflow.jsonl` through the harness draws the same widget frame by frame (M7).

**The card** becomes compact: title (a button to the widget), the line, the badge or `Stop workflow`, and one summary line `<running phase title> · <done>/<total> agents` (`Queued` before any start, `Done` after); the per-phase tables leave the card for the widget (Decision Log 1). `BackgroundSummary` is unchanged; the summary's `Open` opens the list.

**Stop.** On the run only: a workflow's agents have no task of their own on the wire (R6), so there is nothing `session.stopTask` could stop below the run; the drill-in's `Stop agent` for a workflow agent is hidden (its node is disk-born with `runId` set; `DrillIn.tsx:96` already requires `status === 'running'`, which a sidecar-only node never is).

### 3. The topology tree (G2)

**One tree over the listed agents** (`listedAgent`, `task-graph.ts:519`: agents outside workflow runs), replacing the three flat sections with two: **Agents** (the tree) and **On disk** (unchanged: status unknown). Selector `agentTree(graph): TreeRow[]` (memoised on the graph like `agentRows`), rows `{ taskId, depth, parentTaskId, orphan, kind: 'agent' } | { kind: 'done-fold'; parentTaskId; count; depth; expanded }`:

- A node's parent is `agent.parentAgentId` when that id is a listed agent in the graph (wire or sidecar, both already resolved into the graph); else the node is a root. A root whose `parentAgentId` is non-null is an **orphan** and keeps today's `· nested` mark and tooltips (`SUBAGENTS_COPY.childOf`, `childOfUnlisted`).
- A node is **active** if it is running or any descendant is. Active roots come first in first-seen order, then their subtrees; a done root with no running descendant is listed under the **Done · N** section at the end, newest end first, collapsed by default (today's Done), its own children under it when expanded.
- Within a subtree, children in first-seen order, running ones first; a parent's done children are folded under one `done-fold` row `Done · N` (indented under the parent), expanded by click, collapsed by default; a parent that is itself done (under Done, or the done ancestor of a running agent) shows its children unfolded, since the fold would hide the reason it is listed.
- The row content is today's (`AgentRowButton`: glyph, title, elapsed, second line, waiting mark); depth indents by 24 px with the left rule as today (`AgentList.tsx:114-115`). `Show N more` bounds the Agents section at 8 visible rows (the tree's rows counted flat) and Done at 10 (`INITIAL_SHOWN` gains the new section names; the old `active` bound of 4 goes: a tree's first rows are its roots and the owner should see every running root).
- A parent cycle leaves nodes unvisited: they are listed flat at the end, as today (`task-graph.ts:566`).
- Expanded folds live in the tool's state (`SubagentsState.expandedFolds: Set<TaskId>`), reset by `follow`.

The headings read `Agents · N running` and `Done · N` (`SUBAGENTS_COPY`); the footer and the disk-only note are unchanged. `SubagentsSummary` keeps its counts (`counts()` unchanged).

### 4. Cross-session rows: inbound, outbound, the listing, the reply (G3)

**The envelope parser**, shared by host and renderer (`src/shared/engine/peer-envelope.ts`, pure): `parsePeerMessage(text): PeerEnvelope | AgentMessage | null`, where `PeerEnvelope = { kind: 'cross-session'; from: string; fromSession: string | null; fromName: string | null; fromMode: string | null; fromPlugin: string | null; hopChain: string[]; body: string; midTurn: boolean; lineage: 'peer' | 'descendant'; replyable: boolean }` and `AgentMessage = { kind: 'agent'; fromAgentId: string; body: string; handback: boolean }`. It strips a leading preamble header (`Another Claude session sent a message[ while you were working]:`, `A peer session sent a message while you were working:`, SPEC 38 §38.23.2), reads the `<cross-session-message …>` attributes in their fixed order (`from`, `from-session`, `hop-chain`, `from-name`, `from-mode`, `from-plugin`, §38.23.1) or the `<agent-message from="…">` wrapper (`task-graph.ts:339`), takes the body between the tags, and classifies the trailer: `lineage: 'descendant'` when the trailer is the in-session variant; `replyable: false` when the suffix says the `from=` is a host session id `SendMessage` cannot reach (the host-injected lane), else true. The exact texts come from M0's fixture; the parser is tested against the fixture's frames and the SPEC's literals, and tolerates an unknown trailer (the body is what lies inside the tags; the trailer never reaches a row).

**X1.** The normaliser (`normalizer.ts:342-358`), after emitting a `user.message` whose `origin` is `peer` (live `frame.origin.kind`, and the disk record's `origin`, which the resumed child's receipt shows is written to the JSONL, R1), parses the text content: a cross-session envelope emits `peer.message { messageUuid, from, fromSession, fromName, fromMode, fromPlugin, hopChain, text, midTurn, lineage, replyable }`; an agent message emits `subagent.message { direction: 'from_child', fromAgentId, toAgentId: null, text: body }` (the reserved emission). Both carry the frame's attribution and seq; a text that parses as neither emits nothing extra. The `user.message` stays as it is: the task graph's hand-back reader (`task-graph.ts:325-329`) and C7's queue are untouched.

**Rows.** `agent_message` gains optional fields (schema optional, serialize unchanged for the old shape): `peer?: { sender: { name: string | null; address: string; session: string | null } | null; recipient: string | null; body: string; preview: string; replyTo: string | null; toolUseId: ToolUseId | null; messageUuid: MessageUuid | null; result: 'pending' | 'sent' | 'failed' | null; resultText: string | null }`. The derive:

- **Inbound** (`peer.message`): one `agent_message` row, direction `between`, `peer.sender` from the event (`name` the envelope's `from-name`, else a label from `from` as the TUI derives it: the socket basename without `.sock` for `uds:`, `(untitled)` for `bridge:`, the raw address otherwise, SPEC 38 §38.23.5), `preview` the body's first line cut to 120 columns, `replyTo: from` when `replyable`. The `user.message` that carried it draws **no bubble**: the `user.message` case gains, before the bubble branches (`derive.ts:309-314`), `else if (originOf(event.origin) === 'peer' && parsePeerMessage(textOf(event.content)) !== null) { /* the companion event draws it */ }`. The turn keeps its `peer` divider.
- **Inbound from an in-process agent** (`subagent.message`): the existing case (`derive.ts:437-440`) resolves `fromAgentId` to the `SubagentRef` the transcript has seen for that task id (any turn's `subagents`), so the row reads `Message from <title>: <first line>`; a hand-back (`[Subagent hand-back]` frame) reads `Report from <title>` with the report folded under an expander. The raw bubble is suppressed by the same rule.
- **Outbound** (`SendMessage` tool use): `to` is classified against what the transcript knows: `'main'` or `'parent'` → `from_child` (a child's transcript); a task id, agent id or real name of a subagent seen in this transcript → `to_child` with `to` the ref; anything else → `between` with `peer.recipient = to` (a peer session name, a `uds:` or `bridge:` address, a teammate name). The tool result refines `result`: `pending` until it arrives, `sent` on a non-error result, `failed` with the result's text on `isError` (the engine's refusal texts, SPEC 39 §39.16.5). Text: `Sent to <recipient>: <first line of message>`; the `summary` input, when present, is the tooltip.
- **The listing** (`ListAgents`): classification gains presentation `agent_list` (`ROW_KIND_TOOLS`, appended; `Presentation` gains `'agent_list'`); the derive keeps the pair as it keeps cells and emits one row `{ kind: 'agent_list'; toolUseId; self: string | null; sections: { title: 'Subagents' | 'Teammates' | 'Peer sessions'; count: number; rows: { name: string; ref: string | null; extras: string[] }[] }[]; notes: string[]; raw: string; pending: boolean }` from `parseListing(text)` (`src/renderer/src/transcript/model/agent-listing.ts`, pure: the self line, `"<Section> (<count>):"` headers, two-space rows split on `  ·  `, `name [ref]` split, the parenthesised notes and the overflow line as `notes`, SPEC 38 §38.26.3); a result that parses as none of these (the empty states, the messaging-off notice) is one `notes` entry. Before the result arrives the row is `pending` with no sections.

**Views.** `AgentMessageRow` draws a `between` row with the sender or recipient on the left (`@ <name>` as the TUI, muted address in the tooltip), the preview, an expander for the body when it hides something (the TUI's rule), the `result` state for outbound, and for an inbound row with `replyTo` a **Reply** button that opens an inline composer under the row (a textarea, `Send`, ⌘↵ through `useKeyChord('composer.send')` within the row as the relay composer does, `RelayComposer.tsx:112-113`). `AgentListRow` draws the sections as compact lists: the row's `name` bold, the extras muted, the `ref` in a monospace chip; a `Message` button per row opens the same composer targeting that name. The listing's `Teammates` rows also feed the tree (§5).

**The reply** goes through the relay store, generalised: `Relay.target: { kind: 'agent'; agentId; name } | { kind: 'peer'; address: string; name: string | null }` (the existing fields become the `agent` target; `relayKey` becomes `${appSessionId}:${kind}:${id}`); `relayText` for a peer target: `Reply to the cross-session message from <name> (<address>) with SendMessage, to: "<address>", sending exactly this text, then continue what you were doing: <text>` (the SPEC's own rule: copy the envelope's `from` as `to`, §38.24.2); `matchesSendMessage` for a peer compares `to` with the address and, when the sender had a name, the name; a peer relay's observables are asked → forwarded (the parent's `SendMessage` tool use) → **sent** on that tool use's non-error result (the cross-session half answers on delivery to the peer's inbox, §38.24.2; no child receipt exists), `failed` on an error result or a dropped steer; `endedAt` and `followChild` are agent-only. The inline composer shows the relay line under the row (`RELAY_COPY` gains `peer` variants: `Asked <session> to reply · <elapsed>`, `<session> replied with SendMessage`, `Reply failed: <message>`), disabled with a reason when the session is not live here or a reply to the same address is still `asked`. The transcript reaches the store through a registered action: `TranscriptActions.replyToPeer(target: { address; name }, text: string): Promise<void>` (appended, `view/context.tsx:10-19`; `NO_ACTIONS` gets a no-op), registered by the C8b block beside `openSubagent` (`App.tsx:130`); the action resolves the session as `sessionAtClick` does (`actions.ts:19-26`) and calls `useRelays.getState().send`.

### 5. Teammates (G3)

A teammate is a named agent this session spawned (`Agent {name}` under the teams gate, SPEC 39 §39.8.1) that the engine lists under `Teammates` (§39.25.1). The task graph gains `teammates: Map<string, { ref: string | null; agentType: string | null; seenAt: string }>` filled from every `ListAgents` result (the graph already accepts `tool.use` and `tool.result`; it keeps the pending `ListAgents` tool-use ids as it keeps `issuer`), keyed by name. In the tree, listed agents whose `agent.name` is a teammate name are grouped under one synthetic header row `Team · led by this session` placed first among the active roots (the lead is this session: the teammates are its children in the graph already; the header makes the lead explicit), each at depth 1; a teammate the listing names that no sidecar or start event matches is drawn as a `roster` row under the header (`joined <ago>` from `seenAt`, no transcript to open, title only). Without any `ListAgents` result the tree is as §3 says. M0 tries to record a team fixture under the gate; if the engine yields none on 2.1.291 (the gate refused, or `name` was stripped), the grouping ships tested on hand-built listings and the evidence marks it unverified live (Decision Log 7).

### 6. The Tasks panel and the edit state machine (G4)

**The tool.** Id `tasks` (E1's pane target), title `Tasks`, pinnable, single-instance, `TasksParams { appSessionId?: AppSessionId; target?: string }` (`target` a task id to select and reveal, which `show_pane {pane:'tasks', target}` passes; a `target` naming no task selects nothing). State handle `TasksHandle` (the agents tools' pattern): `appSessionId`, `selected`, `showCompleted`, `draft: { subject; description } | null`, `scrollTop`, with `follow` and `dispose`. Data: the same query the checklist uses (`['fs.tasks', listId]`, invalidated on `fs.tasksChanged`), `listIdFor(status, record)` (`task-list.ts:16-20`). The Background work tool's Tasks section stays read-only and its heading gains an `Edit` action opening the Tasks tool (`ctx.openTool('tasks', { appSessionId })`), so the glance and the editor are two surfaces over one list.

**Rows.** Open tasks (`in_progress`, `pending`) in **panel order**: `metadata.order` ascending when numeric, then `in_progress` before `pending`, then numeric id (`taskOrder(tasks)`, pure); completed tasks under `Completed · N`, collapsed by default. A row: a status control (a menu: `Pending`, `In progress`, `Completed`, `Delete…` with an inline confirm), the subject (`activeForm` while in progress, as the checklist shows), the description folded under an expander, `blockedBy` as muted chips, a drag handle; keyboard: ⌥↑/⌥↓ moves the selected row, Space opens the status menu. A `New task` field at the bottom: subject (required), description (optional; the subject when empty), Enter sends.

**Edits as steers.** One steer per edit, `priority: 'next'`, through `agentWorkClient().steer` (the relay's path, `client.ts:23`), content refused up front by `sendContentRefusal` as the relay does (`relay-store.ts:177`). The texts (`TASKS_COPY.steer`, JSON-quoted values):

- status: `[MAWS tasks] Using TaskUpdate, set task #<id> (<"subject">) to status <pending|in_progress|completed|deleted>. Do it now, then continue what you were doing.`
- create: `[MAWS tasks] Using TaskCreate, create a task with subject <"subject"> and description <"description">. Do it now, then continue what you were doing.`
- reorder: `[MAWS tasks] Using TaskUpdate, merge metadata {"order": <n>} into these tasks: #<a> → 1, #<b> → 2, …. Do it now, then continue what you were doing.` (every open task renumbered 1..n in the new order, so one steer carries the whole order and a later move needs no arithmetic over gaps)

The `[MAWS tasks]` prefix mirrors E1's `[MAWS ask <askId>]` steer and tells a reader of the transcript who asked. Reorder is MAWS's `metadata.order` key (Decision Log 3): the engine's record has no order field, `TaskList` sorts by id, and dependency edits (`addBlockedBy`) are irreversible on the wire, so the only reversible, agent-respected place for an order is the metadata merge the engine documents; the agent's own `TaskList` ignores the key, which is harmless.

**The state machine** (`tasks-edit-store.ts`, zustand, memory; pure transitions in `model/task-edit.ts`): `TaskEdit { id; appSessionId; listId; kind: 'status' | 'create' | 'reorder'; taskId: string | null; want: { status } | { subject; description } | { order: Record<taskId, number> }; state; messageUuid; sentAt; startedAt; message }` with states `sending` → `asked` (the steer answered with its uuid) → `started` (`command.lifecycle started` for that uuid) → `confirmed` | `unconfirmed` | `failed`:

- **confirmed**: a re-read list (the query's data after `fs.tasksChanged`, or any later read) satisfies the want: the task's `status` equals the wanted one (a `deleted` want: the id is absent); a created task with the wanted `subject` exists (the newest such id); every task in the order map carries `metadata.order` equal to it. Checked on every list change while the edit is pending, in any state from `asked` on (an idle agent may act before the lifecycle frame reaches the renderer).
- **unconfirmed** ("the agent did not act on it"): in `started`, the parent's turn ends (`turn.ended` with `agentId === null`) without confirmation, or 120 s pass since `startedAt`; or in `asked`, 10 min pass since `sentAt` without `started` (the engine never began it). The bounded wait is the parent's turn when the frame exists, else the clock.
- **failed**: the steer refused by the host (`session.steer` rejected: not ready, content refused), `command.lifecycle` `cancelled` | `discarded` | `refused` before `started` (the relay's rule, `relay-store.ts:96`), or `process.exited` of the parent (`agentId === null`).
- One pending edit per task and one pending reorder per list; a second edit on the same task while one is `sending`, `asked` or `started` is refused by the view (the control is disabled with `Waiting for the last edit`); a `create` is never refused by another create.

The store watches the session's batches through `agentWorkClient().onEventBatch` only while an edit of that session is pending (the relay store's subscribe-while-pending pattern, `relay-store.ts:156-164`), and reads `turn.ended`, `command.lifecycle` and `process.exited` of the parent lane; it reads list changes through the query cache (`queryClient.getQueryData(['fs.tasks', listId])` on `fs.tasksChanged`, the client's `onTasksChanged`).

**What the panel shows.** A pending edit (`sending`, `asked`, `started`) is drawn optimistically: the row in its wanted status with a pending mark (spinner) and the line `Waiting for <session> · <elapsed>`; a reorder shows the rows in the wanted order with the mark on the moved row; a create shows a ghost row at the end. `confirmed` drops the overlay (the list now says it) and the edit leaves the store. `unconfirmed` drops the overlay and shows under the row `<session> did not apply this edit` with `Retry` (a new steer) and `Dismiss`. `failed` shows `Couldn't ask <session>: <message>` with `Retry` and `Dismiss`. Edits are disabled, with the reason as a line under the heading, when the session is not live here (`Editing needs the session running here`), when the list id is not known yet (the checklist's sentence), and when the session's engine offers no task tools: the task-graph entry records `tools` from `session.init` (`session.init` joins `TASK_EVENT_KINDS`' store-level accept; the graph itself is unchanged) and a list without `TaskUpdate` reads `The engine offers no task tools in this session` (the owner's default model is outside the allowlist, Grounding; Residue 2). Reading is never disabled.

### 7. Scheduled loops (G5)

**From the transcript.** The task graph gains `crons: Map<string, CronJob>` and a `pendingCrons: Map<ToolUseId, { cron; prompt; recurring; durable; at }>`: a `tool.use CronCreate` (parent lane) is pending by its tool-use id; its `tool.result` parses `Scheduled (recurring job|one-shot task) <id> \((.+?)\)\. (Persisted to .claude/scheduled_tasks.json|Session-only …)` into `CronJob { id; cron; prompt; recurring; durable; humanSchedule; createdAt (the tool use's `at`); toolUseId; state: 'scheduled' | 'deleted' | 'fired'; lastFiredAt: string | null; deletedAt: string | null }` (an error result drops the pending entry); a `tool.use CronDelete {id}` with a non-error result sets `deleted`. A fire: M0 records what the engine writes when a job fires under MAWS's launch (expected: a `user.message` of origin `task-notification` whose text is the job's prompt, SPEC 11 §11.11.5 `subkind: 'scheduled-trigger'`, a subkind C3 does not pass through); the reducer's fire rule (`lastFiredAt`; a one-shot's `fired`) is written from the fixture in M6, and if no fire is observable the rows show no last-fire fact (Decision Log 9). The graph's existing `tool.use`/`tool.result` acceptance carries this; `TASK_EVENT_KINDS` is unchanged.

**From the project.** `scheduledTasksFile(record)`: `<record.worktree?.path ?? record.directory>/.claude/scheduled_tasks.json`, read through `files.read` and watched through `files.watch` (the viewer's commands, `src/shared/ipc/schema/files.ts`; the file is inside the session's allowlist root; a missing file is the empty list; a file MAWS cannot read shows the reason), parsed leniently as the engine loads it (SPEC 22 §22.5: string `id`, `cron`, `prompt`, number `createdAt`, else the entry is skipped): `DurableJob { id; cron; prompt; createdAt; lastFiredAt; recurring; createdBySessionId }`. The reader is renderer-side (`model/scheduled.ts` plus a hook), never the engine host; MAWS never writes the file.

**The rows.** Background work gains a section `Scheduled · N` after Monitors (`BackgroundSection` gains `'scheduled'`, appended), one row per job, durable rows first then session-only, each: the schedule in words (the result's `humanSchedule` when known, else the cron string), `recurring` or `one-shot`, `durable · this session` (its `createdBySessionId` equals the record's engine session id) or `durable · another session` or `session-only`, the prompt's first line (80 columns, the TUI's cut), **`Next ≈ <local time> (<relative>)`** from `nextCronMatch(cron, now)` with the tooltip `The engine fires recurring jobs up to half a period late (30 min at most) and one-shots on :00 or :30 up to 90 s early` (SPEC 22 §22.7), `Expires <date>` for a recurring job (`createdAt + 7 days`), and **`Open creating turn`** when the job's `CronCreate` is in this transcript (`useTranscriptStore.getState().jumpTo(key, cellId.tool(toolUseId), { align: 'center' })`, which expands the cell's group, `stores/transcript.ts:57`). A `deleted` job is not listed. For a session not live here, session-only jobs are listed greyed with `Resumes with the session` (the engine resurrects them on resume, §22.5) unless expired (recurring, 7 days) or missed (one-shot, next match before now), which are omitted. A one-shot that fired is omitted.

**The cron parser** (`src/shared/engine/cron.ts`, pure): `parseCron(text): ParsedCron | null` per SPEC 22 §22.3 (five fields, the three term forms, bounds, DoW 7 → 0, de-duplicated sorted sets, `null` on any failure) and `nextCronMatch(parsed, fromMs): number | null` per §22.3's algorithm (zero seconds, plus one minute, month → day (OR semantics when both restricted; `length` decides "unrestricted") → hour → minute, bounded to 527,040 iterations, local time through `Date`). Unit tests pin `*/5 * * * *`, `30 14 28 2 *`, `0 9 * * 1-5`, `0 0 1 * 0` (OR), `7` and `0-7`, invalid forms, the February 29 skip and a DST day on the machine's zone.

### 8. Replay parity and the disk path

Every surface derives from X1 events available on both paths plus disk reads both paths share: `workflow.progress` is emitted on the disk path per snapshot change (`fs/workflows.ts:66-80`) and `fs.workflows` is read by both; sidecars and `parentAgentId` come from `fs.subagents` for both; `peer.message` and `subagent.message` are emitted by the one normaliser both paths run; `SendMessage`, `ListAgents`, `CronCreate` and `CronDelete` are tool pairs the JSONL carries; the task list and the durable cron file are files. The e2e replays recorded journals and fixtures with no live engine (M7). What a terminal-resumed session lacks: pending edits and pending replies (renderer memory), by design (§1).

### 9. Failure semantics

- A progress snapshot row that fails the parse is dropped, never thrown (`workflow-progress.ts:3`); a run with no phases shows `Phases arrive with the first progress frame`; a journal that names no agent id leaves the row inert.
- A sidecar meta that cannot be read leaves the agent at its wire facts (today's rule); an unknown parent is an orphan, never a dropped row.
- An envelope the parser refuses leaves the raw user bubble as today (no silent loss); a reply whose steer the engine drops reads `Reply failed: the engine <state> it before starting it` with the text back in the composer (the relay's O1 rule, `RelayComposer.tsx:84-92`).
- A `ListAgents` result the parser does not recognise draws the result's text as one note.
- A task edit never writes a file; its worst case is `unconfirmed` with Retry. A list that fails to read shows `Tasks unavailable: <message>` and no controls. A steer refused by the host is `failed` at once with the host's message.
- A durable cron file that fails to parse shows `Scheduled jobs unavailable: <message>` for the file and keeps the transcript's rows; an invalid cron expression in a record shows the row with `next run unknown`.
- Nothing E7 adds blocks a render: every parser returns `null` or a partial, every read has an unavailable sentence.

### 10. Copy and tokens

New sentences join `src/renderer/src/tools/agents/copy.ts` (`SUBAGENTS_COPY` additions for the tree, `BACKGROUND_COPY` additions for the widget and the compact card, new `TASKS_COPY`, `SCHEDULED_COPY`, and `RELAY_COPY.peer`) and `src/renderer/src/transcript/model/copy.ts` (`peerMessageCopy`, `agentListCopy`); the exact strings are the executor's, in the register of the existing ones (short, no exclamation, the session named by its record title as `<session>`). Classes use tokens only; no new tokens are needed.

## Interfaces and Dependencies

### X1 (`src/shared/graph/events.ts`, append-only after E1's block)

```ts
// E7 start: a message from another session, parsed from the engine's envelope (SPEC 38 §38.23); emitted beside the
// `user.message` that carried it, live and from disk. `replyable` is false when the suffix says SendMessage cannot
// reach the sender (a host-injected message).
'peer.message',
event('peer.message', {
  messageUuid: MessageUuidSchema.nullable(), from: z.string(), fromSession: nullableString(), fromName: nullableString(),
  fromMode: nullableString(), fromPlugin: nullableString(), hopChain: z.array(z.string()), text: z.string(),
  midTurn: z.boolean(), lineage: z.enum(['peer', 'descendant']), replyable: z.boolean(),
}),
// E7 end
```

`subagent.message` (`events.ts:193`) is emitted with `direction: 'from_child'`, `fromAgentId` the wrapper's `from`, `toAgentId: null`, `text` the body. `peer.list` is released to the ledger (Decision Log 4).

### The normaliser (`src/engine-host/normalizer.ts`, the user-frame branch at 342-358)

After the `user.message` emission for a frame whose `origin.kind === 'peer'`: `const parsed = parsePeerMessage(textOf(content)); if (parsed?.kind === 'cross-session') out.emit({ kind: 'peer.message', … }); else if (parsed?.kind === 'agent') out.emit({ kind: 'subagent.message', … });`, same attribution. Unit tests in `normalizer.test.ts` over M0's frames; a disk-path parity test runs the fixture's JSONL through `engineNormalizer` (`fs/register.ts:11`) and asserts the same two events.

### Shared modules (`src/shared/engine/`)

- `peer-envelope.ts`: `parsePeerMessage(text)`, `peerLabel(from, fromName)`; tests from M0's fixture and SPEC 38 §38.23's literals.
- `cron.ts`: `parseCron`, `nextCronMatch`, `cronExpiry(createdAtMs)`; tests as Design §7.

### X3 (`src/renderer/src/transcript/model/`, E7 blocks after E1's)

- `classify.ts`: `Presentation` gains `'agent_list'`; `ROW_KIND_TOOLS` gains `ListAgents: 'agent_list'`; `TABLE` gains `CronCreate`, `CronList`, `CronDelete` as `grouped('other')` (explicit, so the jump target is a known cell).
- `rows.ts`: `agent_message` gains `peer?` (Design §4); new member `{ kind: 'agent_list'; toolUseId; self; sections; notes; raw; pending }`.
- `derive.ts`: the `user.message` suppression branch; the `peer.message` case; the `subagent.message` case resolving the ref; the `SendMessage` classification of `to`; the `ListAgents` pair into `agent_list`; `WORK_ROWS` gains `agent_list` (`derive.ts:551`).
- `schema.ts`: the zod members for both (optional `peer`), `serialize.ts`: `agent_list` as `- Agents: <n> subagents, <n> teammates, <n> peer sessions`; `copy.ts`: the new copy.
- `agent-listing.ts` (new): `parseListing(text)`.
- `view/rows/AgentMessage.tsx` (the Reply composer joins it), `view/rows/AgentList.tsx` (new), `view/rows/Row.tsx` (the `agent_list` case appended), `view/context.tsx`: `TranscriptActions.replyToPeer` appended with a no-op default.

### The agents tool (`src/renderer/src/tools/agents/`)

- `model/task-graph.ts`: `TaskGraph` gains `crons`, `pendingCrons`, `teammates`, `pendingListings` (all `Map`s, copy-on-write in `Draft`); `applyEvent` gains the `CronCreate`/`CronDelete`/`ListAgents` branches on `tool.use` and `tool.result` (parent lane only); selectors `agentTree(graph)`, `crons(graph)`, `teammatesOf(graph)`. Existing selectors and tests unchanged; `agentRows` stays for the On disk section.
- `model/workflow-run.ts` (new): `runView(node, run, now)`. `model/scheduled.ts` (new): the durable file's parser and `scheduledRows(graph, durable, record, now)`. `model/task-edit.ts` (new): the pure state machine (`applyEditEvent`, `confirmEdits(edits, tasks)`, `editSteerText(edit)`, `taskOrder(tasks)`). `model/relay.ts`: `RelayTarget`, `relayText` and `matchesSendMessage` generalised (tests pin the agent wording byte for byte).
- `store.ts`: `TaskGraphEntry.tools: string[] | null` from `session.init`.
- `relay-store.ts`: keys and targets per Design §4; `sent` state for peers.
- `tasks-edit-store.ts` (new): `useTaskEdits` with `send(edit)`, `retry(id)`, `dismiss(id)`.
- `background/BackgroundTool.tsx`: `view`, `BackgroundParams.view`, the `Scheduled` section, the Tasks heading's `Edit`; `background/WorkflowCard.tsx` compact; `background/RunWidget.tsx` (new); `background/ScheduledRows.tsx` (new).
- `subagents/AgentList.tsx`: the tree; `subagents/SubagentsTool.tsx`: `expandedFolds`, the new `shown` names.
- `tasks/TasksTool.tsx`, `tasks/TaskRows.tsx`, `tasks/NewTask.tsx` (new); `tool-ids.ts` gains `tasks: 'tasks'`; `index.ts` registers `tasksTool` and exports `replyToPeer` in `agentTranscriptActions`.
- `actions.ts`: `openSubagent` for a workflow ref passes `view: 'run'`; `replyToPeer`.
- `copy.ts`: the additions of Design §10.

### X5 tools

| Tool id | Title | Params | Notes |
|---|---|---|---|
| `background` (existing) | Background work | `BackgroundParams { taskId?, appSessionId?, view?: 'run' }` | additive |
| `subagents` (existing) | Subagents | unchanged | |
| `tasks` (new) | Tasks | `TasksParams { appSessionId?, target? }` | E1's `PANES.tasks`; `show_pane {pane:'tasks', target}` opens it |

### Harness and e2e

- `src/renderer/src/harness/agents/api.ts` (`AgentsHarnessApi`, additive): `widget()` (header, phases `{title, count, state, selected}`, agents `{label, model, state, time, tokens, openable}`), `tree()` (rows `{agentId, depth, kind, count, expanded}`), `tasks()` (rows `{id, subject, status, pending, note}`, disabledReason, completedCount), `scheduled()` (rows `{schedule, kind, store, next, link}`), `peerRows()` (the column's `between` and `agent_list` rows as shown), `openRun(taskId)`, `selectPhase(n)`, `toggleFold(parentId)`, `setTaskStatus(id, status)`, `moveTask(id, to)`, `createTask(subject)`, `reply(n, text)`, `pushTasks(listId, tasks)` (the fake's `fs.tasksChanged` with new data), `setClock(iso)` (the widget's and the cron rows' `now`), `editWaitMs()` (the store's bounds, shortened under the harness through an injected clock, never a sleep).
- `fakeClient.ts`: `onTasksChanged` emission, `files.read`/`files.watch` answers for the durable file (through the panel harness's files fake if one exists; else a fake on the agents fake client's new `readProjectFile` seam, decided at M7 by what the harness already fakes).
- Derived fixtures (`test/support/agents-fixtures.ts`, tails in `agents-fixtures-tail.ts`): `events/agents-peer` (pass 1's `subagent` history, then M0's peer inbound frame, `ListAgents` pair, the reply steer's `SendMessage` pair re-keyed), `events/agents-cron` (pass 1's history, then M0's `CronCreate` pairs, a fire if recorded, a `CronDelete` pair). The reproducibility suite (`agents fixtures are reproducible`) covers them.
- `e2e/agent-tools.spec.ts` gains an `E7` describe (same group, `pnpm e2e:agents`): widget (replay `pass2/workflow` releasing `AGENTS_STOP_WORKFLOW_TAIL.progress.frames`, `fixtureFs('workflow-disk')` for the disk case, click agent → drill-in, Stop → `calls().stopTask`), tree (`pass3/nested-agents` + `fixtureFs('nested-agents-sidecars')`: depth 1 under the parent, the fold's count after the child's finish), rows (`agents-peer`: the inbound row's sender, `Reply` → `calls().steer` text equals `relayText` for the peer target and the row's line reads sent when the recorded `SendMessage` releases; the listing's sections), tasks (`fakeFs({tasks})`, a status change → the steer text, `pushTasks` with the change → confirmed; a second change with `pushTasks` unchanged and `turn.ended` released → unconfirmed; the create ghost; the reorder steer; `show_pane`-shaped `addTool('tasks', {target})` selects the row), scheduled (`agents-cron` with `setClock`: next run text, `Open creating turn` scrolls the cell into view), both-theme screenshots of each surface into the scratch (`otherThemeColours` empty).
- Unit: `background.test.tsx`, `subagents.test.tsx`, `task-graph.test.ts`, `relay.test.ts`, `relay-store.test.ts` extended; new `workflow-run.test.ts`, `task-edit.test.ts`, `scheduled.test.ts`, `tasks.test.tsx`, `agent-listing.test.ts`, `peer-envelope.test.ts`, `cron.test.ts`, transcript `derive.test.ts` cases for the three rows.

### Probe scenarios and fixtures (M0; `spikes/protocol-probe/scenarios/pass3/`, fixtures under `fixtures/pass3/`)

All run through `node spikes/protocol-probe/run-pass3.mjs <name>` with the relay up, `p1-common.mjs`'s `scratchRun` (a scratch config home and repository under `/tmp`), haiku, `mode: 'default'`, MAWS's environment (`engineEnv`), the owner-file delta before and after (`ownerTmpKeys`), provenance notes (`E7`, this document, the pin), a `--max-budget-usd 0.80` guard; findings appended to `spikes/protocol-probe/findings-pass3-p1-extension.txt` under an `E7` heading; the conformance test (`node --test spikes/protocol-probe/fixtures.test.mjs`) admits every new file.

- `e7-peer-message.mjs` → `e7-peer-a.jsonl`, `e7-peer-b.jsonl`: two `Probe`s under one scratch config home (peers find each other in `<config>/sessions/`, SPEC 38 §38.16). B: one turn so its registry record exists. A: `Call ListAgents and reply with the listing verbatim.` (records the listing with B as a peer session; if the result says messaging is off under this launch, the scenario records it and stops: Design §4 then ships on hand-built frames, flagged in the hand-back). B: `Use SendMessage to send the peer session named <A's listed name> exactly: "E7 probe: hello from B".` A's inbound `user` frame (idle: a turn starts; the header, envelope, trailer and `origin` recorded). A: a steer with the peer `relayText` → A's `SendMessage` tool use (`to`) and result; B's inbound frame. Mid-turn case: A runs `sleep 30` with Bash while B sends again (the `while you were working` header). Notes: the envelope attributes seen, the trailer variant, the reply result text, whether `from-session` was filled, the registry record's fields.
- `e7-tasks.mjs` → `e7-tasks.jsonl`, `e7-tasks-files/` (copies of `<config>/tasks/<listId>/*.json` after each step): haiku (allowlisted; the init's tools must list `TaskCreate`, recorded); `Create two tasks with TaskCreate: "Write the parser" and "Wire up the CLI". Reply DONE.`; then the three steers of Design §6 while idle (status → `in_progress` on #1; the reorder; a create) each followed by `idle()`, recording the `command_lifecycle` frames, the `TaskUpdate`/`TaskCreate` tool uses and the files' deltas; then one steer while a `sleep 20` runs (the boundary case). Notes: whether the agent acted on each wording; the file rewrite's timing relative to the tool result.
- `e7-cron.mjs` → `e7-cron.jsonl`, `e7-cron-durable/scheduled_tasks.json`: `Use CronCreate (find it with ToolSearch) to schedule a recurring job "*/2 * * * *" with prompt "E7 cron tick", then a one-shot at <next minute + 2> with prompt "E7 one-shot", then call CronList and reply with its output.`; wait up to 5 min for a fire (recording the frame that carries the prompt: its type, origin and text); `CronDelete` the recurring job; then `durable: true` on a third job and copy the project's `.claude/scheduled_tasks.json`. Notes: the result texts, whether session-only jobs fire under `-p`, the fire frame's shape, whether the engine's resume resurrects (optional: resume the session with `--resume` for one turn and read `CronList`).
- `e7-team.mjs` (optional, after the three) → `e7-team.jsonl`: `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` in the environment; `Spawn a general-purpose Agent named "scout" in the background, model haiku: read one.txt and reply. Then call ListAgents and reply with the listing.`; notes: whether `name` reached the wire schema, the `Teammates` section, the sidecar's meta keys.

### Ledger names (for the architect)

- Added: X1 `peer.message` (E7, built); `subagent.message` emitted from `<agent-message>` frames (E7); X5 tool id `tasks` with `TasksParams`; `BackgroundParams.view`; X3 row kind `agent_list`, `agent_message.peer?`, `Presentation 'agent_list'`; `TranscriptActions.replyToPeer`; `BackgroundSection 'scheduled'`; harness API additions; derived fixtures `events/agents-peer`, `events/agents-cron`; probe scenarios `e7-*`.
- Released: X1 `peer.list` (the listing draws from the tool pair, on both paths, with no consumer beyond the transcript); IPC `tasks.edit` (the edit is `session.steer` from the renderer; no host state).
- Settings version: none needed.

### Dependencies

None new. `zustand`, `@tanstack/react-query`, `radix-ui` are in use by the agents tools.

## Acceptance

- **G1** A Workflow run opens from Background work into the widget: the summary row → the list → a card → the widget; the transcript's workflow ref opens the widget directly. Phases on the left with `done/total`, agents on the right with model, state and elapsed; a click on an agent opens its drill-in; `Stop workflow` while running and live sends `session.stopTask` for the run (`per-task-stop-workflow-on`'s path). The widget redraws on each `workflow.progress` and on each `fs.workflowChanged` re-read; the e2e replays `pass2/workflow.jsonl` live and `workflow-disk` from disk and reads the same phases and agents. Proof: `background.test.tsx`, `workflow-run.test.ts`, the e2e widget cases, screenshots `g1-widget-{light,dark}.png`.
- **G2** The Subagents resting state is a tree: `pass3/nested-agents` with its sidecars shows the inner agent at depth 1 under the outer; once the inner finishes it folds under `Done · 1` on the outer; running roots first; done roots under `Done · N` collapsed; an orphan reads `· nested` with its tooltip; click opens the drill-in. Proof: `task-graph.test.ts` (`agentTree`), `subagents.test.tsx`, the e2e tree cases, `g2-tree-{light,dark}.png`.
- **G3** `ListAgents` draws as a list with its sections; `SendMessage` to a peer draws `between` with the recipient and the result state; a message from another session draws with its sender and preview and no raw bubble; **Reply** sends the peer `relayText` as a `'next'` steer and the row's line walks asked → replied on the parent's `SendMessage`; teammates the listing names group under the team header. Proof: `peer-envelope.test.ts`, `agent-listing.test.ts`, `normalizer.test.ts` (both paths), `derive.test.ts`, `relay.test.ts`, `relay-store.test.ts`, the e2e rows cases, `g3-rows-{light,dark}.png`; the live half observed in M0's fixtures.
- **G4** The Tasks panel (`show_pane 'tasks'` → tool `tasks`) edits through the session: a status change, a reorder and a new task each send exactly one steer with the documented text; the edit shows pending until `fs.tasksChanged`'s re-read confirms it; an edit the agent does not act on reads unconfirmed when its turn ends or after the bounded wait, with Retry; MAWS writes no task file (no `fs.*` or `files.write` call carries one; `fs/tasks.ts` is unchanged). Proof: `task-edit.test.ts`, `tasks.test.tsx`, the e2e tasks cases, M0's `e7-tasks` fixture (the agent acted on each wording), `g4-tasks-{pending,confirmed,unconfirmed}-{light,dark}.png`.
- **G5** Scheduled jobs are listed: session-only from the transcript's `CronCreate` pairs (`CronDelete` removes), durable from the project's `scheduled_tasks.json`, each with its next run computed by MAWS's cron parser and, when the creating call is in the transcript, `Open creating turn` jumping to the cell. Proof: `cron.test.ts`, `scheduled.test.ts`, `task-graph.test.ts` (crons), the e2e scheduled cases, M0's `e7-cron` fixture, `g5-scheduled-{light,dark}.png`.
- **Gates** on the branch head: `pnpm typecheck`, `pnpm lint`, the full unit suite through the slot, `pnpm e2e:agents`, `pnpm e2e:transcript` and `pnpm e2e:panel` (the shared files changed), the fixture conformance test; the owner-file delta identical across every probe; evidence under `docs/doperpowers/evidence/p1-e7/` (`probe-run.txt`, `owner-file-check.txt`, `e2e-agents.txt`, `gates.txt`, the screenshots above).

## Plan of Work

Each task: build it, run its own units, commit (fresh, no footer), then `doperpowers:task-reviewer` on `model: "opus"` reads the task's diff against this document; verified findings are fixed and re-reviewed, two rounds at most; tiny findings go to the tracker. M7 ends with the whole-branch `doperpowers:reviewer-high` on `model: "opus"` (A-14, A-22), two rounds at most. The executor never edits the parent, the ledger or the charter; it writes its hand-back as its final message (Concrete Steps).

### M0 — Probes and fixtures (first; nothing of E7's product code depends on guessing)

1. Preflight: relay reachable (`p1-common.mjs`'s check), `ownerTmpKeys()` recorded to `docs/doperpowers/evidence/p1-e7/owner-file-check.txt`, engine version read (`claude --version`, expected 2.1.291).
2. `e7-peer-message.mjs` and its two fixtures; findings: the envelope as seen, the listing rows, the reply result text, the mid-turn header, whether `-p` sessions bind an inbox at all (if not: record, and Design §4's live half is unverified; the hand-back flags it).
3. `e7-tasks.mjs`, its fixture and `e7-tasks-files/`; findings: each wording's effect, `command_lifecycle` timing, file rewrite timing; if the agent ignores a wording, adjust the text once and re-run that step (the adopted text goes into `TASKS_COPY.steer` and the Decision Log).
4. `e7-cron.mjs`, its fixture and `e7-cron-durable/`; findings: result texts, the fire frame or its absence, resurrection on resume if tried.
5. `e7-team.mjs` (optional, budget permitting); findings either way.
6. `node --test spikes/protocol-probe/fixtures.test.mjs` green; `ownerTmpKeys()` after equals before (A-15); every scratch process stopped (`p.stop()`), scratch roots removed; the findings `.txt` appended; `probe-run.txt` written (costs, versions, verdicts).
Verification: the fixtures exist and pass conformance; the findings answer each question yes, no or partly with the frame cited. Review: task-reviewer reads the scenarios and findings.

### M1 — Shared model and the host's two emissions

1. `src/shared/engine/peer-envelope.ts` + tests (M0's frames and the SPEC literals; a frame with an unknown trailer; a body with a lookalike closing tag).
2. `src/shared/engine/cron.ts` + tests (Design §7).
3. `events.ts`: `peer.message` appended; the X1 schema tests (`events.test.ts`) and the snapshot suite updated.
4. `normalizer.ts`: the two emissions; `normalizer.test.ts` with live frames and the disk-path parity test through `engineNormalizer`; the conformance suite's expectations if any pin the frame count.
Verification: units green; `pnpm typecheck`. Review: task-reviewer.

### M2 — Transcript rows and the Reply

1. `agent-listing.ts` + tests from M0's listing (and the empty states).
2. `classify.ts`, `rows.ts`, `schema.ts`, `serialize.ts`, `copy.ts` additions; `derive.ts`: the suppression, the `peer.message` and `subagent.message` rows, the `SendMessage` classification, the listing row; `derive.test.ts` cases over M0's frames and the pass 1 `subagent` fixture (a `to_child` row unchanged; a `between` row with recipient).
3. `relay.ts` and `relay-store.ts` generalised to targets (existing tests byte-identical for agents; new peer cases: asked → forwarded → sent; dropped; not live).
4. `AgentMessage.tsx` (sender/recipient, preview, expander, result state, Reply composer), `AgentList.tsx` row view, `Row.tsx` case, `context.tsx` action; the C8b block registers `replyToPeer`; `transcript.spec` snapshot tests for the rows in the harness page if the transcript suite has one (`e2e:transcript` must stay green).
Verification: units; `pnpm e2e:transcript` through the slot. Review: task-reviewer.

### M3 — The workflow widget

1. `model/workflow-run.ts` + tests (phases, selected default, agent ids from the journal for a disk-only run, ticking elapsed, inert rows).
2. `RunWidget.tsx`; `BackgroundTool.tsx` view and params; compact `WorkflowCard.tsx`; `actions.ts` opening the widget; copy; `background.test.tsx` updated (card compact; widget cases).
Verification: units; a manual `pnpm dev` look is optional (the e2e in M7 is the proof). Review: task-reviewer.

### M4 — The topology tree and teammates

1. `agentTree` selector + tests (nesting, orphans, folds, done roots, running descendant of a done parent, cycles, workflow agents excluded).
2. `teammates` in the graph from `ListAgents` pairs + tests (M0's listing; a hand-built `Teammates` section).
3. `AgentList.tsx` tree rendering, folds in state, headings, bounds; `subagents.test.tsx` updated.
Verification: units. Review: task-reviewer.

### M5 — The Tasks panel

1. `model/task-edit.ts` (pure machine, steer texts as adopted in M0, `taskOrder`, confirmation predicates) + tests (every transition; the turn-ends rule; the clock bounds; the one-pending-per-task rule).
2. `tasks-edit-store.ts` (batch subscription while pending, the query cache read on `fs.tasksChanged`) + tests with the fake client.
3. `store.ts`: `tools` from `session.init`.
4. `tasks/TasksTool.tsx`, rows, the New task field, the status menu, drag and keyboard reorder, the pending overlay and notes, disabled reasons; registration (`tool-ids.ts`, `index.ts`); the Background section's `Edit`; copy; `tasks.test.tsx`.
Verification: units; `addTool('tasks', { params: { target } })` selects the row (E1's pane path is E1's to test; the id and params are what it calls). Review: task-reviewer.

### M6 — Scheduled loops

1. Task graph `crons` + the fire rule from M0's fixture + tests.
2. `model/scheduled.ts` (durable file parse, rows, next run, expiry, link) + tests with an injected clock.
3. `ScheduledRows.tsx`, the Background section, the durable file hook (`files.read`/`files.watch`), copy; `background.test.tsx` cases.
Verification: units. Review: task-reviewer.

### M7 — Harness, e2e, gates, evidence, review, hand-back

1. Harness API and fake additions; derived fixtures `agents-peer` and `agents-cron` with their tails; the reproducibility suite.
2. The `E7` e2e block (Interfaces, Harness and e2e), both-theme screenshots copied to `docs/doperpowers/evidence/p1-e7/`.
3. Gates through the slot: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm e2e:agents`, `pnpm e2e:transcript`, `pnpm e2e:panel`; logs to `gates.txt`, `e2e-agents.txt`.
4. Whole-branch `doperpowers:reviewer-high` on `model: "opus"`; verified findings fixed by a fix-wave worker, two rounds at most; tiny ones to the tracker (`tech-debt-tracker.md` or the repository's tracker issue, whichever exists).
5. Progress, Surprises, Decision Log and Outcomes of this document updated (the executor's one `.md` edit is this file); the hand-back (Concrete Steps).

## Concrete Steps

```sh
export pnpm_config_verify_deps_before_run=false
WT=$(git rev-parse --show-toplevel)          # the executor's worktree; absolute paths everywhere, never cd

# M0: probes (relay up; scratch homes under /tmp; the owner's ~/.claude never touched)
node "$WT/spikes/protocol-probe/run-pass3.mjs" e7-peer-message
node "$WT/spikes/protocol-probe/run-pass3.mjs" e7-tasks
node "$WT/spikes/protocol-probe/run-pass3.mjs" e7-cron
node "$WT/spikes/protocol-probe/run-pass3.mjs" e7-team            # optional
node --test "$WT/spikes/protocol-probe/fixtures.test.mjs"

# M1 to M6: targeted units while building (never the full suite outside the slot)
pnpm -C "$WT" exec vitest run src/shared/engine/cron.test.ts src/shared/engine/peer-envelope.test.ts
pnpm -C "$WT" exec vitest run src/renderer/src/tools/agents
pnpm -C "$WT" exec vitest run src/renderer/src/transcript/model
pnpm -C "$WT" typecheck

# M7: the gates, each through the slot once the load allows
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C "$WT" test --maxWorkers=4
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C "$WT" lint
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C "$WT" e2e:agents
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C "$WT" e2e:transcript
/tmp/maws-review/waitload20.sh && /tmp/maws-review/with-slot.sh pnpm -C "$WT" e2e:panel
```

Commits: one per task, fresh, staged by path, message in the repository's register (`E7 M3: the workflow widget …`), no `Co-Authored-By`, no `Generated with`, no session URL, not overridable; passed to every subagent. Hand-back (the executor's final message to the architect): branch and head; the document path; gates with log paths; each G with its proof; the ledger names added and released (Interfaces); residue decisions applied; anything contradicting the spec marked `[parent-impact]`; the §19 line proposed for the architect to write.

## Residue decisions (for the owner to confirm at hand-back)

1. **Reorder through `metadata.order`.** The engine's task record has no order and dependency edits cannot be undone on the wire; MAWS writes an `order` number into each task's metadata through `TaskUpdate` and sorts by it. Alternative: ship status change and new task only, reorder deferred. The author chose metadata (G4 names reorder as binding).
2. **The engine offers no task tools on the owner's default model.** Under C12's X6 ruling `CLAUDE_CODE_ENABLE_TODO_TOOLS` stays unset, mirroring the terminal; on `opus` (outside the allowlist) a MAWS session has no `TaskCreate`/`TaskUpdate`, so the Tasks panel reads such a session's list and refuses edits with the reason. Setting the variable is an X6 change (a charter line) the owner decides; the author did not take it. `[parent-impact]` only if the owner wants MAWS to set it: then C12's ruling is amended.
3. **Delete as a status.** `deleted` is one of `TaskUpdate`'s status values; the panel offers it behind an inline confirm. Alternative: hide it.
4. **Compact workflow cards.** The per-phase tables leave the cards for the widget; a card shows one summary line. Alternative: keep the tables on the card as well.
5. **Teammate grouping unverified live** if M0's team probe yields no fixture (the gate is experimental and off on this machine).

## Surprises & Discoveries

- 2026-10-06, grounding: the nested sidecar's meta already names its parent (`pass3/nested-agents-sidecars/agent-a425e926e506edeb1.meta.json`: `parentAgentId`, `spawnDepth: 2`) and the graph already reads it (`task-graph.ts:433`), so the tree needs no new disk fact; the flat lists were the only thing missing.
- 2026-10-06, grounding: a workflow's agents have no task of their own on the wire (C8b R6), so there is no per-agent Stop below the run; the drill-in's Stop is unreachable for them by its own `running` rule.
- 2026-10-06, grounding: `CronCreate`'s session-only jobs are never written to disk and its durable jobs go to the project's `.claude/scheduled_tasks.json`, not `~/.claude`, so "scheduled loops from the transcript" is literal: the tool pairs are the only record of a session job, and the engine itself re-reads them on resume to resurrect the jobs (SPEC 22 §22.5).
- 2026-10-06, grounding: `ListAgents` answers prose (`{listing: string}`), not a structure; the row list is a parse of a documented format (SPEC 38 §38.26.3).
- 2026-10-06, grounding: on the owner's default model the engine offers no task tools under MAWS's launch (C12's X6 ruling keeps `CLAUDE_CODE_ENABLE_TODO_TOOLS` unset), so G4 is exercisable on allowlisted models (haiku 4.5, sonnet 4.x, opus 4.x) or with the variable; the owner's `~/.claude/tasks` holds twelve lists from sessions that had the tools.
- 2026-10-06, grounding: E1's `panes.ts` already resolves `tasks` to a tool id `tasks`, so the Tasks panel must be its own X5 tool, not a view of Background work.

## Decision Log

| # | Decision | Reason |
|---|---|---|
| 1 | The widget is a view of the Background work tool, opened from a compact card, the transcript's workflow ref and the summary; the cards lose their per-phase tables. | One tool keeps the X5 single-instance rule and the summary's hand-off; two copies of the phase tables would drift. The vault: "click that workflow and the widget opens". |
| 2 | Stop is on the run only. | A workflow's agents have no task on the wire (R6); `stop_task` reaches the run; the engine's `perTaskStopAffordance` names tasks. |
| 3 | Reorder writes `metadata.order` through `TaskUpdate`'s documented metadata merge; the panel sorts by it, then status, then id; one steer renumbers every open task. | No order field exists; `addBlockedBy` has no inverse; metadata is reversible (null deletes a key); a whole renumbering keeps the agent's arithmetic trivial. Residue 1. |
| 4 | `peer.list` and `tasks.edit` are released. | The listing draws from the tool pair, present on both paths, with the transcript as its only consumer; an edit is `session.steer` from the renderer with no host state, as the relay is. |
| 5 | `peer.message` is an X1 event emitted by the normaliser beside the `user.message`, which stays; the transcript suppresses the raw bubble by the same shared parser. | One parser; both paths; the task graph's hand-back reader and C7's queue keep reading the user message; later consumers (attention, notifications) get a typed event. |
| 6 | The Reply reuses the relay store with a target discriminator; a peer relay ends at `sent` on the `SendMessage` result. | Same observables (steer asked, parent's `SendMessage`); no child receipt exists for a peer; the agent wording is pinned byte for byte. |
| 7 | Teammates group under a `Team · led by this session` header from the `ListAgents` listing; unverified live if no team fixture can be recorded. | The gate is experimental and off here; the listing is the engine's own statement of who is a teammate; the lead of agents this session spawned is this session. |
| 8 | A task edit is `unconfirmed` when the parent's turn ends after the steer started without the files confirming it, else 120 s after `started`, else 10 min after `asked` unstarted. | The turn's end is the engine's own statement that the agent finished what it was going to do; the clocks bound a turn that never ends. |
| 9 | The cron fire rule is written from M0's fixture; absent an observable fire, rows carry no last-fire fact. | No fixture exists; C3 passes `origin.kind` only, so a `scheduled-trigger` subkind is not on X1 today. |
| 10 | The `Scheduled` section lives in Background work, after Monitors. | Jobs are background work the session owns; a routines editor is deferred (parent §6). |
| 11 | Next run is MAWS's cron match from now, with the engine's jitter named in a tooltip. | The engine's jitter is deterministic per id but a reimplementation of the exact fire time is more than the row needs; the match is what the owner reads in the cron. |
| 12 | No settings; no versions. | Nothing E7 adds is a preference. |
| 13 | The tree's Agents section bounds at 8 rows, Done at 10; the old Active bound of 4 goes. | A tree's first rows are its roots; hiding running roots behind Show more defeats the resting state. |
| 14 | Probes run on haiku in `default` mode under `p1-common.mjs`'s scratch run. | haiku is allowlisted for the task tools and cheap; default mode records permission frames if any; the owner-file delta is A-15's. |

## Deferred

- A routines editor (create, edit, delete scheduled jobs from MAWS); `CronDelete` from the row (one steer, cheap, held with the editor).
- The dynamic loop (`ScheduleWakeup`): not a `CronCreate`, renders nothing in the TUI, not resurrected; out of G5's text.
- The sminos family chat integration (parent §6).
- Per-agent Stop inside a workflow (no engine affordance today).
- Notifications for inbound peer messages (the `peer.message` event is there for it; the notification kinds are a settings change).
- A teammate session's view of its lead (a session launched with `--agent-id`/`--team-name`): the lead is another session; X11-like lineage would be needed.
- `metadata.order` honoured by the engine's own `TaskList` (an engine matter).

## Outcomes & Retrospective

Pending — written by the executor at landing.
