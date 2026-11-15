# UX wave · U8d: a terminal session's subagents on this Mac (2026-11-15)

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U8 (`docs/doperpowers/specs/2026-11-12-ux-wave/U8-card-column-working-folder.md`, cited below as *the child's file*), its fifth landing, **U8d** (board ticket 599). **Parent pin:** master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`, the commit every statement about the code below was checked against; the root, the child's file and the register (`docs/doperpowers/evidence/ux-wave-2026-11/register.md`) are read at that commit.
>
> **The design is in this document.** The child's file says what the person sees on this route (acceptance A2, A4 and A7, UC-9's Subagents row, O-05's Routes paragraph) and leaves the way open: "a follow-on landing, U8d, gives that route its source". Board ticket 599 names two ways and asks this document to decide. "The design" below decides, states what was rejected, and is this landing's record until the child's file gains it in the spec's next batch, which is the architect's. A builder reads this document and the code, nothing else.
>
> **Branch:** `ux-wave/U8d`, from master `63c97b5c0`; it depends on master alone (U8b, pull request 637, and U3a are in the pin). **Items:** the gap O-05 and #359 leave on one route (the owner's answer of 2026-11-12, "Land now, gap after"). **Not in this landing:** anything a session that is not running here reads; the word the transcript's own agents row uses (U3's second landing); a terminal session's shells counted under the agent that started them (DX4's jobs name no starter); the rules sminos derives by.

## Purpose

A person who starts Claude Code in a terminal on this Mac can watch and drive that session from MAWS, through the bridge the sminos plugin runs inside it. When that session dispatches subagents, MAWS shows them badly today: the transcript's own row says an agent is working, but the card column has no Subagents card, and the Subagents panel lists every agent of the session under "On disk" with "status unavailable" under the sentence "Status is known only while the session runs here". The same session opened from another machine shows its agents correctly, because that machine's sminos derives each agent's status and sends it. So the one place where the person sits next to the terminal is the one place that cannot say what the terminal is running.

After this landing a terminal session on this Mac shows its subagents as a session MAWS runs does. While an agent runs, the Subagents card stands in the column with "N running", its first-level agents, and "(+N)" on a row that has agents running under it; the panel lists Running, then Done with each agent's own outcome ("finished", "finished with errors" in the danger colour, "stopped", "ended with the session"); the card leaves when the last agent ends; and when the terminal's process goes while an agent was still running, that agent ends too. Nothing is stored, no surface is added, and no word is added.

How to see it working: in a terminal session on this Mac that MAWS drives, ask the agent to dispatch two subagents in the background, one of which dispatches its own. The column shows a Subagents card that reads "2 running", then "3 running" once the nested one starts; the row of its parent reads "(+1)", and a press on that control shows the nested agent beneath it. Close the terminal while one still runs: the card leaves and the panel's Done reads "ended with the session" for it. Acceptance below gives the unit tests and the e2e scenes that prove each step.

## Progress

- [x] (2026-11-15 10:27Z) This document written at the pin: the design decided, every statement about the code checked at `63c97b5c0`, the two older builds read with `git show`, sminos's ledger read as the port's source, the reference app read for a counterpart.
- [ ] The adversarial review of this document (the architect dispatches it) and the rulings on "Reported to the architect".
- [ ] The probes P1 to P4 and the owner's answer to card C1, as far as the architect holds the build for them (P1 and P3 bear on M4).
- [ ] M1 — the ledger's agents half and the derivation.
- [ ] M2 — the driver: the three inputs, the body, what it costs.
- [ ] M3 — the window: the statuses laid over the graph.
- [ ] M4 — the e2e scenes, the record, and the acceptance run.
- [ ] The proofs an executor does not run (the Mac runs of `lane-a` and `agents`; class 1a; the branch's review).

## Words used here

- **A terminal session; driven.** A session whose engine runs in a terminal (root law 5, in code lane A). MAWS *drives* it while the bridge of the sminos plugin inside it answers on its socket and offers controls (`classify` in `src/services/lane-a/state.ts` answers `live`); the renderer then gives it lane A's controls (`controlsFor`). A terminal session with no such bridge is read-only, and for this document it is a session *not running here*.
- **The bridge.** The plugin's part inside the terminal's engine process and its child process: a Unix socket with `GET /status`, `GET /events` (one JSON line per event, a snapshot first) and `POST /command`. Main's lane A driver (`src/services/lane-a/driver.ts`) holds one `/events` stream per driven session (the *state stream*) and one more per watch.
- **A watch.** One page's subscription to one driven session (`laneA.watch`, `src/renderer/src/lane-a/watches.ts`): main reshapes the bridge's events into the messages sminos's own plane sends for a session on another machine (`src/services/lane-a/reshape.ts`), and emits them as `laneA.plane`. A watch exists only while something on the page holds it.
- **DX4; the `subagents` body.** DX4 is the name the repository gives the session-plane vocabulary a machine sends about one session (`desk-hub/protocol`, `apps/desk-hub/src/protocol/session.ts`). Its `subagents` body is `{ subagents, jobs, mcp }`: each subagent with its status and what the status rests on, the loop's background shells and monitors, its MCP servers' names.
- **The ledger.** `Ledger` in `src/services/lane-a/jobs.ts`: one transcript's rows, reduced to the words they say about tasks. It is a port of sminos's `sminos_jobs.py`, jobs only, pinned by the shared vectors `test/fixtures/lane-a/dx4-jobs.json` (a contract between the two repositories; `dx4-jobs.PROVENANCE.md` beside it).
- **A sidecar; the listing.** Beside a session's transcript the engine keeps a folder `<session>/subagents/` with, for each subagent, its own transcript `agent-<id>.jsonl` and a small file `agent-<id>.meta.json` (the *meta*: its type, description, the tool-use id of the call that started it, its parent agent's id when it is nested). The engine host lists them (`src/engine-host/fs/subagents.ts`), answers `fs.subagents`, and says `fs.subagentsChanged` when the set or a meta changes.
- **The task graph.** One graph of agents and background tasks per session in the renderer (`tools/agents/model/task-graph.ts`, held by `tools/agents/store.ts`); the Subagents card, the Subagents panel and the summaries read it and nothing else.
- **A session MAWS runs** is lane B; **a session on another machine** is reached over the machine link (root, "Words used in this document").

## The landing's edge

**In.** For a terminal session on this Mac whose bridge is live (in code: a *driven* session, one whose controls are lane A's, `session/controls/controls-for.ts`): the status of each of its subagents, derived in main by the rules sminos derives it by for a session on another machine, carried to the window on the watch that already carries its background shells, and laid over the session's task graph, so that the Subagents card, the Subagents panel, the panel's drill-in and the tools' one-line summaries read it with no change of their own. One sentence of the panel stops being drawn where it is no longer true (R3).

**Not in.**

- *A session that is not running here* (any session whose process is gone and that this page did not watch while it ran; a terminal session with no bridge, or with a bridge that cannot be driven). It reads as today: its agents under On disk with "status unavailable", no card. The second way the ticket names would have changed this; it lost ("What was weighed").
- *The transcript's agents row.* It keeps today's reader (the engine host's backfill) and today's words; its word for an agent that ended with its session is U3's second landing's. So that row and the card can still part in the cases "What each route shows" names, as they already can for a session on another machine.
- *Shells under an agent.* DX4's jobs are the main loop's and name no starter (U8b's document, M5 decision 1), on this Mac and on another machine alike. So on a terminal session "(+N)" counts agents, and #359's "· N background tasks running" has nothing to count.
- *What this Mac answers when it is the remote one.* A caller on another machine reads this Mac's terminal sessions through this Mac's sminos, not through MAWS's driver ("Routes and other machines"). Nothing new is offered.
- *The rules.* The port follows sminos's rules as they are; where a rule reads oddly here it reads the same on another machine, and it is reported, not changed (C1, R7, R9).

## Assumed of the landings in flight

One list, to be checked again when each is on master; either side can land first. Checked on 2026-11-15 against each branch's head with `git diff <merge-base>..origin/<branch>`.

| landing | what it touches that this one meets | what this document assumes | check when it is on master |
|---|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b`) | None of this landing's files. It fills the slot `sessionCardWaiting` by registration (`request-card/WaitingCard.tsx`) and edits neither `panel/summary/Summary.tsx` nor `tools/agents/`. | The column's order holds: the waiting card first, the two running cards last. An agent's "Approval needed" still reads `selectPendingOf` by agent, which this landing does not touch. | `panel/summary/Summary.tsx` still mounts `SubagentsCard` and `BackgroundTasksCard` last; M4's card scene still finds the Subagents card by its heading with a "Waiting for you" card above it. |
| U2b, the to-human view (`origin/ux-wave/U2b`) | None of this landing's files. It folds transcript rows; a `subagent` row stays on both routes. | The transcript's agents row is drawn as today on a terminal session; M4's scenes read it by the class `transcript-subagent`. | The scenes' locator for that row, and its words ("started working"), still hold; if U2b renamed either, the scenes follow. |
| U6b, the file beside the chat (`origin/ux-wave/U6b`) | `e2e/cross-build.spec.ts` (+176: a coverage row and a scene at the file's end), `panel/summary/Sources.tsx`, `panel/summary/Summary.test.tsx`, and one line of `tools/agents/subagents/subagents.test.tsx` (a drill-in file link's fourth argument). | This landing adds nothing to `e2e/cross-build.spec.ts` ("Stored and sent"). Its edits in `subagents.test.tsx` are in the cases of a driven session, not the file-link case. | A merge of master in `subagents.test.tsx` is textual only; the side column's tabs (`panel/host.ts`) still open the Subagents panel through `panelHost.addTool`, which the card uses. |

## Reported to the architect

Each point has the default this document builds and the one place a ruling changes. None of them is resolved by an executor.

**Rulings asked.**

- **R1. Where the derivation lives.** *Default:* the agents half is ported into `src/services/lane-a/jobs.ts` from `sminos_jobs.py`, beside the jobs half. *What a ruling could prefer:* the repository already holds a whole TypeScript derivation of the same body, agents included, pinned by the same vectors, in the desk's test double (`apps/desk-hub/fake-machine/jobs.ts`). Using it would end with one TypeScript reading in the tree instead of two, at the price of the product importing a double's code from another workspace package, or of moving that module to where both can import it, which edits files outside the wave. *One place:* M1, decision 1.
- **R2. An agent's start time.** *Default:* the driver adds `startedAt` (the call row's timestamp) to each entry; DX4's body has no such key. *Alternative:* read the first row of each agent's own file once and send DX4's `file`, which is the fallback a window on another machine uses; it costs one read per agent and a `file` whose other three facts would be stale or absent. *One place:* Interfaces §B, the key, and `patchedNode` in `lane-a/agents/task-feed.ts`.
- **R3. The panel's sentence.** "Status is known only while the session runs here" is drawn above every driven session's lists, where the statuses are in fact known. *Default:* it is not drawn while the session's machine reports at least one agent's status, by one condition for a terminal session of this Mac and of another machine. This removes the sentence from another machine's terminal session too, which the child's file does not mention. *Alternative:* this Mac only. *One place:* the condition beside `live` in `tools/agents/subagents/AgentList.tsx`.
- **R5. A bridge that goes while the terminal lives.** *Default:* as for jobs today, the driver takes it as the process gone, so the agents read "ended with the session" until the bridge answers again. *Alternative:* keep the agents as they were until the holder itself ends; that would make agents and jobs of one session read differently. *One place:* `unbridge` in `src/services/lane-a/driver.ts`.
- **R8. No cross-build scene.** *Default:* none, by the rule (no minor, no stored form); the two pairings of window and driver are held by unit tests and by the two builds' sources. *One place:* "Stored and sent".
- **R9. A gap in the rules, found in the bundle.** At a resume the engine can name several orphaned agents in one notification block ("Engine facts" 10). DX4's rule, and so the port, reads one `<task-id>` per block, so every orphan but the first keeps its launch row's `running` until the process goes: after such a resume the Subagents card would list agents that no longer exist. Today nothing on this Mac shows them; a window on another machine already would. *Default:* the port stays in step with sminos (the contract's change is the other repository's, and then a re-sync here). *Alternative:* the port reads every `<task-id>` of a block now, ahead of sminos, and the two machines differ until sminos follows. *One place:* `notification` in `src/services/lane-a/jobs.ts`. P1 decides how much this matters.
- **R10. The edge "reads U3a's arrivals reader where it applies".** It applies nowhere here: the ledger's own reading of a notification is pinned by the vectors and kept in step with sminos, and the root already rejected changing the ledger to meet U3's reader (Decision Log, 2026-11-12, "The documents of U3a and U8b", U3a's point 8: "Rejected: changing the ledger, which is kept in step with sminos"). The two readers can part for an agent as U8b's document says they can for a job (its M8, decision 7).
- **R11. The spec's sentences this landing makes false.** They are the architect's to amend at landing: the child's A2 ("it shows the Background tasks card and no Subagents card"), A7's last sentence ("On a terminal session of this Mac the panel reads as today until U8d") and its "which is a session on another machine", UC-9's Subagents row, O-05's Routes paragraph, the Advice paragraph's "It does not serve a terminal session's agents on this Mac", #359's Routes line; in the root, the lines on U8d under Children, UC-9's summary, the Ordering map and "Deferred and out of scope"; and U8b's document M6 decision 6.

**Stated, no ruling asked.**

- **R4** is card C1 below.
- **R6.** A running row's line reads "Working" on a terminal session, where a session MAWS runs says what the agent is doing: nothing reports an activity line for a terminal's agent. A window on another machine reads the same today.
- **R7.** An agent the engine wakes after it ended is not shown running again on a terminal session (the vectors: "DX4's accepted residual"). A session MAWS runs continues the same row. A tracker row at landing.

**For the owner, in card form.**

> **C1. What a row says for an agent that is known to have ended, with no record of how.**
> In a terminal session, MAWS can learn that an agent no longer runs without learning its outcome: the terminal's own bridge says it has stopped running and the transcript holds no result for it, or the agent that started it has ended. The session itself is still running. What should that agent's row say in the Subagents panel?
> 1. **"ended with the session"** (recommended to build now). It is the word such an agent already gets when the session is on another machine. No new word. In use: an agent you stopped, in a terminal that is still open, can read "ended with the session".
> 2. **"ended".** A new, plain word for these two cases, on this Mac and for another machine's session alike; "ended with the session" is kept for an agent whose terminal has really gone. In use: every word is true, and Done has one more word to learn.
> 3. **"stopped".** In use: right after Stop agent it reads as expected, but an agent that crashed, or went with its parent, is also called "stopped".
> *Recommended:* 2, once P2 has shown how often the case arises; until the answer, 1 is built, because it adds nothing. *The one place the default is built:* `outcomeOf` and `outcomeWord` in `tools/agents/subagents/shared.ts` (the drill-in's `disabled.exited` reads the same status). Choosing 2 also needs the status's evidence kept on the node by `withStatuses`.

**Probes to arrange** (no engine runs on the MacBook; each is one session of engine `2.1.322` in a terminal with the bridge, or headless where the transcript alone is read, the transcript and the sidecar folder kept as fixtures).

- **P1.** *Question:* a session's process ends while two agents launched in the background still run; the session is then resumed in a terminal. What does the engine write to the main transcript for each orphan, and when: one block per agent or one block naming both, with which `<status>`; or does it restart one under the same id; and does either meta change? *Default written:* as the bundle reads ("Engine facts" 10). *One place its answer changes:* M4's scene of the gone terminal, the rows it writes at the resume; and the weight of R9.
- **P2.** *Question:* an agent launched in the background is stopped by the bridge's `stop-agent` (a `TaskStop` a plugin calls); and an agent the main loop waits for is stopped the same way. Which rows reach the main transcript (a queue record with `<status>killed</status>`, a result row, none), and what does the meta gain? *Default written:* none is assumed; the agent then reads C1's word. *One place:* the table's "stopped" row for this route, and the last step of M4's scene of the controls.
- **P3.** *Question:* the terminal is closed (and, separately, the process is sent a termination signal) while an agent launched in the background runs. Does any row that names the agent reach the main transcript or the agent's file, and is its meta rewritten? *Default written:* nothing is written ("Engine facts" 9), so the agent reads "ended with the session". *One place:* the word in acceptance 6 and in M4's scene of the gone terminal; a `killed` row would make it "stopped".
- **P4.** *Question:* an agent the main loop waits for completes, fails, and is interrupted by the person. What does each result row in the main transcript carry (`toolUseResult.status`, `is_error`)? *Default written:* the ledger's rule reads all three (`completed`; an error as failed). *One place:* none in code; an interrupted agent reading "finished with errors" would be reported.

## What the code holds today

Read at the pin. Each line is something a milestone rests on.

1. **Who feeds the task graph.** `tools/agents/store.ts` binds a session one of two ways. `bindRemote`, when `lane-a/remote-agents.ts` answers for it (a listed terminal session of another machine with no record here): the graph is the remote transcript's own tree, replaced whole at each change. `bindLocal`, for every other session: the engine's status and journal while the session has an engine status, and the sidecars (`fs.subagents`, then each `fs.subagentsChanged`) and workflow runs from disk. A terminal session on this Mac has no engine status of its own (one MAWS kept from an earlier run of the same session is not read as live, item 7), so its graph is the disk reading: `mergeSidecars` makes a node per agent with status `unknown`, which the lists put under On disk (`sectionOf`), and `runningAgents(graph)` is zero, so `SubagentsCard` returns null.
2. **The ledger derives no agents, on purpose.** `src/services/lane-a/jobs.ts`, header: "What the vectors' `subagents` and `mcp` pin (agents' outcomes, MCP names) is not ported"; `derive` answers `{ subagents: [], jobs, mcp: [] }`; `CALLS` is `Bash`, `Monitor`, `TaskStop`; `notification` returns early for "a notification naming only a call". `jobs.test.ts` replays the vectors' `jobs` and asserts `subagents: []`.
3. **The driver follows the main transcript only while watched.** `followJobs` in `driver.ts` starts a `TranscriptJobs` (`transcript-jobs.ts`) at a session's first watch and reads it every `jobsPollMs` (1000): one `open`, one `stat`, and a read of the bytes appended since the last. `jobsChanged` sends a `subagents` message to a watch only when the jobs' JSON differs from what that watch last carried. `unbridge` and `drop` call `jobsChanged(s, false)` first, so each watch hears its running jobs `exited` before it ends. The last watch's end drops the ledger.
4. **The bridge already says which agents run, and the driver drops it.** The state stream's snapshot line carries `agents`, and `agent` events follow (sminos's bridge child, `sminos_bridge.py`, builds both; the repository's own double sends `agents: []`, `test/support/fake-bridge.ts`). `SessionFold.event` in `state.ts` reads neither, and `Reshaper.event` lists `agent` among the events that are "the state's or nobody's".
5. **The window keeps only the jobs.** `receive` in `lane-a/watches.ts` reads `body.jobs` of a `snapshot` or a `subagents` message into `useLaneA`'s `jobs` (`noteLaneAJobs`); `laneAJobsWatchEnded` drops them at a watch's end unless none still runs. `PlaneMessageSchema` is `z.looseObject({ kind, body: z.unknown() })`, so a body's content is not part of the wire's schema.
6. **The overlay for another machine exists and is pure.** `withStatuses(held, metas)` in `lane-a/agents/task-feed.ts` lays each DX4 entry that carries a `status` over the node of the same id: status, end time and summary from its `outcome`, parent, type, name and model from its `spawn`, a start time from `file.firstAt` where the node has none. It returns the same graph when nothing changes. `plane-transcript.ts` keeps the graph it patches apart from the patched one.
7. **A driven session reads as not live in the panel.** `AgentList.tsx`: `live = (controls === null || controls.turn() === null) && ctx.status !== null`; `!live` draws `SUBAGENTS_COPY.diskOnly`. So the sentence is drawn for every driven session, another machine's included, where the rows under it carry reported statuses today.
8. **The drill-in already drives a terminal session's agent.** `DrillIn.tsx` offers Stop agent for a driven session "while the agent has not ended" (`laneA.stopAgent`), and `RelayComposer.tsx` sends through `laneA.tell`; both read the node's status, which is `unknown` there today, so Stop is offered for every agent, ended or not.
9. **The exit of a gone terminal reaches the transcript alone.** U8b's M6 has the transcript follower supply `process.exited` when a terminal session's last process goes (`src/engine-host/fs/service.ts`, `chain-follower.ts`); its decision 6 says the graph of a terminal session on this Mac "holds no running agent, so there the exit reaches the transcript alone".
10. **A second derivation of the same body is in the repository.** `apps/desk-hub/fake-machine/jobs.ts` (436 lines) is the desk's test double of a machine: `LoopIndex` and `derive`, agents included, pinned by a second copy of the same vectors (`apps/desk-hub/fake-machine/dx4/dx4-jobs.json`, byte for byte the copy under `test/fixtures/lane-a/`). `lane-a/agents/dx4-statuses.test.ts` replays those vectors through the remote overlay and holds, as a named case, that MAWS's backfill alone reads an older launch `completed` where DX4's body says `exited`.
11. **The tests and scenes that pin today's reading and change:** `src/services/lane-a/jobs.test.ts` (`subagents: []`), `reshape.test.ts` (the `subagents` message's body), `driver.test.ts` (the jobs block), `lane-a/watches.test.ts`, `tools/agents/store.test.ts`, `tools/agents/subagents/subagents.test.tsx` ("reads the lists as not live here once a terminal drives the session, whatever engine status was kept"), `panel/summary/running-cards.test.tsx` ("a terminal session this Mac drives: … there is no Subagents card"); in `e2e/lane-a.spec.ts` the agents-tool part of "each control reaches the bridge…" (On disk, folded) and the scene "the card column of a terminal session this Mac drives: … no Subagents card…".

## The design

### The fact, and its one reading

The fact is "which subagents of a terminal session run, and how each one that ended, ended". It already has one reading in the product: the status sminos derives for each agent of a session (DX4, "Jobs and agent status", "Precedence"), which a window on another machine draws through `withStatuses`. Its rules are written down in the shared vectors' `about` and pinned by sixteen of their cases. They join four things: the words the transcript's rows say about an agent (its call's result, a task notification that names it, a `task_status`, a stop), the bridge's own account of which agents it holds as running, the parent agent's end for a nested agent, and whether the session's process still runs.

This landing gives a terminal session on this Mac that same reading, by the same rules, and draws it by the same function. Main's ledger gains the agents half of the module it was ported from; the driver feeds it the bridge's agents, the sidecars' metas and the parents' transcripts; the body rides the watch that already carries the jobs; the task-graph store lays `withStatuses` over the graph it built from this Mac's disk. A terminal session then reads the same wherever its terminal is, and the same from either machine: the person at this Mac and a person looking at this Mac's session from another machine see one status, because both come from the same rules over the same files and the same bridge.

### What was weighed

1. **Port the agents half of the ledger (chosen).** It is the reading the other machine's route already uses, it has a conformance fixture already vendored and already replayed for jobs, and the existing overlay draws it. Its cost is real and bounded: about 150 lines in `jobs.ts`, a small fold of the bridge's agent events, and a follower for each agent that has a nested agent still running.
2. **Feed the task graph the transcript's disk-form events (the ticket's second way). Rejected.** Three reasons, each from the code. (a) It would be a second reading of the same fact, and the two are known to differ: `lane-a/agents/dx4-statuses.test.ts` holds a recorded case where the backfill alone reads an agent `completed` and DX4 reads it `exited`, and the remote route exists in its present form because the body corrects the events. A session would then read one way at this Mac and another way from another machine. (b) A nested agent's call and result are in its parent agent's transcript, never in the main one, so the main transcript's events give a nested agent no start and no end; the "(+N)" this landing is for would stay unknown. (c) The follower sends one bounded window of a long transcript at a time, so an agent that started before the window has no start event either; and feeding these events to the graph also changes what every session that is not running here reads, which the child's file does not ask for and the owner was not shown.
3. **The bridge's agent list alone. Rejected.** It says running or not, never how an agent ended, so Done could say only "ended"; and an agent that ended before the bridge loaded is not in it.
4. **Ask this Mac's sminos for the body, as a remote caller does. Rejected.** It is the same derivation with no port, but it makes a terminal session on this Mac depend on the sminos daemon running here, which driving a session does not (P5 O9's decision of 2026-10-28 on derived jobs rejected "a full local DX4 plane" for the same reason), and it would put the machine link's phases between the person and a terminal on the same Mac.
5. **Use the derivation the repository already has in TypeScript** (`apps/desk-hub/fake-machine/jobs.ts`, "What the code holds today" 10). **Not taken, and reported (R1).** It is the desk's test double of a machine, in another workspace package, and the product would import a double's runtime code; the jobs half of the product's ledger would be deleted for it or live beside it. The vectors were written so that independent producers agree ("every expected body is written by hand from the rules, never computed by either implementation"), and the product's producer is `src/services/lane-a/jobs.ts`. The double is a second reading aid for the port's builder, beside the Python source.

### The inputs on this Mac

| DX4's input | where it comes from here | when it changes |
|---|---|---|
| the main loop's rows | the follow the driver already holds for the session's jobs (`TranscriptJobs` over the main transcript), the ledger now keeping `Agent` and `Task` calls and the words said about them | read every `jobsPollMs` while the session has a watch, as today; and at once after a bridge `agent` event |
| the metas, one entry per agent | the engine host's listing: one `fs.subagents` read when the session's follow starts, then each `fs.subagentsChanged`; only the entries the lists can show (`runId === null`: a workflow's agents are in no list) | the host says when the set or a meta changed; the driver adds no reader and no watch of the sidecar folder |
| the bridge's agents | the state stream the driver already holds: the snapshot's `agents`, then each `agent` event merged as the bridge's own child merges it (every key but `type`, `phase`, `n`; `running` is `phase !== 'stop'`) | an `agent` event; a fresh snapshot replaces the whole map; the map is kept while the stream reconnects |
| the parents' rows | for each agent some listed meta (else the bridge's record) names as `parentAgentId`: a follower of that agent's own transcript (its path is the listing's), feeding a ledger of its own; null where the file cannot be read | read in the same tick as the main follow, only while the parent has a nested agent that has not ended |
| whether the session's process runs | what the jobs already use: true while the session is driven; false from `unbridge` (its bridge went) and `drop` (its holder ended) | as today |

Not taken from DX4's inputs: an agent file's facts (`file`: size, mtime, first and last timestamps). sminos re-reads them whenever a file's size or mtime moves, which is a stat of every agent file twice a second; nothing here reads them but one fallback for a start time, and "The start time" below gives that another source.

### What is derived, and when it is sent

`derive` in `jobs.ts` answers DX4's body: for each meta, `{ agentId, meta, status, evidence }` with `running` and `spawn` where the bridge holds the agent and `outcome` where the rows say a word. The order of the rules is DX4's, the first that holds: (1) the rows' outcome is terminal: that status, evidence `rows`; (2) the session's process is gone: `exited`, `session`; the parent has ended: `exited`, `parent`; the bridge holds the agent as not running: `exited`, `bridge`; (3) the bridge holds it as running: `running`, `bridge`; the rows say running (a background launch): `running`, `rows`; (4) `unknown`, `none`. Interfaces §A gives the signatures and §B the body.

*The start time.* DX4's body has no start time of its own; a window on another machine takes it from the start row it holds, else from `file.firstAt`. Here the driver adds one key DX4 does not have to each entry, `startedAt`: the timestamp of the row that holds the agent's `Agent` or `Task` call, read from the ledger of the loop that made the call (the main one, or the parent's). That is the moment a session MAWS runs and the disk-form reader both call an agent's start, it costs no read, and `withStatuses` takes it before `file.firstAt` (R2). An agent whose call is in no ledger this Mac follows (its parent's transcript is unreadable; a forked skill with no call) has none, and its running row reads "elapsed unavailable" in the panel and no time on the card, which are today's words for that.

*When.* The body is derived when an input changed and at no other time: after a tick's read that brought new bytes, after a bridge `agent` event (which first asks for a read at once, so the row that says how the agent ended is usually in hand before the bridge's "not running" is applied), after a listing arrives, and when the session's process goes. It goes out in each watch's snapshot (DX4's snapshot carries `subagents` beside `jobs`) and afterwards as a `subagents` message to each watch whose last body differs, by JSON, as the jobs go today. Nothing in an entry changes while an agent merely works (no file size, no last timestamp), so a session whose agents run and say nothing new sends nothing.

*Order, when things arrive between.* Every input lands in memory first and the derivation is one synchronous pass over what is held; two passes cannot interleave. A bridge event that arrives while a read is in flight waits for that read (`TranscriptJobs.read` already serializes) and derives after it. A spawn the bridge reports before the host has listed the agent's meta gives no entry yet (DX4 emits one entry per meta); the listing's change, a tenth of a second later by the host's own settle time, derives again. A stop the bridge reports before the engine has written the result row reads `exited` (evidence `bridge`) until the row is read, by the read the event asked for or by the next tick's; the card is not affected (the row leaves it either way), and in the panel the agent is in Done, folded by default, under the word of C1 for that moment. A listing that fails to read leaves the last one standing and is logged, as the jobs' read is. When the last watch ends, the followers, the ledgers and the listing are dropped together; the bridge's agents stay with the state stream.

### What the window does with it

`lane-a/watches.ts` keeps a watch's `subagents` beside its `jobs` in the lane A store. The task-graph store, when the session it watches is one this Mac drives, holds the session's watch while it is watched and publishes its own graph with `withStatuses` laid over it, again at each change of either; its own reductions never read the patched graph (Interfaces §C). The card, the panel, the drill-in and the summaries are not edited: they read the graph. Two things follow without code of their own. Stop agent is offered only while the agent has not ended, because the node's status is now known. And the transcript's agents row keeps its own reader.

When the watch ends, the store keeps the last statuses only if none of them is `running` (the rule the jobs already follow): the driver sends the body of a gone process before it ends the watch, so an ended terminal's agents stay "ended with the session" in the panel for as long as the page lives; a watch that ends unheard-of drops them, and the graph reads from disk again.

One sentence changes place. "Status is known only while the session runs here" is drawn today above every driven session's lists. It is not drawn where the lane A store holds, for the session, at least one agent with a reported status (R3).

### What each route shows afterwards

The words are the ones the child's file and `SUBAGENTS_COPY` already hold. "Terminal, this Mac" is a session this Mac drives; "not running here" is every session whose process this Mac does not hold or drive now, a terminal session with no drivable bridge included.

| state | a session MAWS runs | a terminal session on this Mac (after this landing) | a terminal session on another machine | a session not running here |
|---|---|---|---|---|
| **running** | Running; on the card. Line: what the agent is doing, else "Working". Source: the engine's frames. | Running; on the card. Line: "Working" (the bridge reports no activity line; R6). Known when the bridge holds the agent as running, or when the rows hold a background launch with no end. Time since its call's row. | The same, from that machine's body; time from the start row the window holds, else the agent file's first row. | Nothing runs. Every agent is under On disk, "status unavailable"; no card. |
| **"(+N)", agents running under a row** | The parent from the engine's frames, else the sidecar. | The parent is the sidecar meta's `parentAgentId`, else the bridge's record. N counts running agents at any depth. | The same. | Not drawn (no agent is known to run). |
| **an agent ended, something under it still runs (#359)** | Stays under Running with its ended word; "(+N)" for agents, "· N background tasks running" for tasks. | Does not arise. Its nested agents read ended with it (DX4's parent rule), and its shells are not listed (DX4's jobs are the main loop's). | Does not arise, for the same two reasons. | — |
| **finished** | Done, "finished · 3m ago", then the summary. | Done, the same words: the rows say `completed` (the call's result for an agent the loop waited for; the task notification for one in the background). | The same. | On disk, "status unavailable". |
| **finished with errors** | Done, danger colour. | The same: the rows say `failed` or `error`. | The same. | On disk, "status unavailable". |
| **stopped** | Done, "stopped · 3m ago". | The same, when the rows say `stopped`, `killed`, `cancelled` or `interrupted`, or hold a `TaskStop` call that names the agent. An agent stopped from MAWS's Stop agent: see C1 and P2. | The same. | On disk, "status unavailable"; in Done as "stopped", with no time, where the sidecar itself says `stoppedByUser`, as today. |
| **"Ended with the session"** | Done, when the engine process exits while the agent runs. | Done, when the session's process is gone and the rows hold no end for the agent (evidence `session`). The same word today for an agent the rows hold no end for whose parent ended (`parent`) or which the bridge holds as not running (`bridge`): C1. Kept while the page lives. | The same; U8b's M6 holds it there. | On disk, "status unavailable": after a reload the page no longer holds what the watch said. |
| **cannot be known** | — | On disk, "status unavailable" (DX4's `unknown`): the cases of "Where the source cannot know". | The same. | Every agent. |
| **"Approval needed"** | The agent's own waiting request. | The same: the bridge's request names its agent, and the row reads it through `selectPendingOf` as today. | The same. | — |
| **the card leaves** | When no agent runs. | When no agent runs, and when the terminal goes. | The same. | Never drawn. |
| **the panel's sentence** "Status is known only while the session runs here" | Not drawn. | Not drawn once an agent's status is reported (R3). | Not drawn once reported (R3); drawn today. | Drawn, as today. |

Where a terminal session and a session MAWS runs still differ, by DX4's rules and so on both machines alike: a running row's line is "Working" (no source for an activity line); an agent the engine wakes after it ended keeps its ended word and is not on the card again while it runs the second time (the vectors call it "DX4's accepted residual": a terminal word in the rows outranks a later running; R7); and the transcript's agents row, which keeps the backfill's reading, can say "working" for an agent the panel lists under On disk (the first case below) or Done.

### Where the source cannot know

1. **An agent the main loop is waiting for, with a bridge that reports no agents.** Its call has no result row yet, so the rows say nothing; only the bridge can say it runs. A bridge old enough to send no `agents` in its snapshot and no `agent` events leaves it `unknown`: On disk, "status unavailable", while the transcript's row says it works. When it ends, its result row gives its outcome and it is in Done. Background agents are unaffected (their launch is in the rows). Nothing detects such a bridge: this document found no capability key for agent reports in what the bridge says of itself, and an absent or empty list derives the same as a bridge that holds no agent.
2. **A nested agent whose parent's transcript cannot be read** (deleted, or unreadable): its call and result are there. With the bridge's word it reads running or ended; without it, `unknown`.
3. **An agent with no call** (the engine's forked skill: its meta has no `toolUseId`): the bridge's list is its only source; without it, `unknown`.
4. **An agent that started before MAWS watched the session.** Nothing is lost: the ledger is fed the whole transcript at the first read, and the bridge's snapshot holds every agent the bridge knows, those it found in the engine's own list when it loaded included.
5. **An agent that ended, and left the engine's list, before the bridge loaded, with no end in the rows.** It reads `running` from its launch row until the session's process goes. This follows from the order of DX4's rules, on both machines; no vector holds this exact case.
6. **A terminal session with no bridge, or with one that cannot be driven.** The session is not driven: no watch, so no body. It reads as a session not running here.
7. **A bridge that goes while the terminal's process lives.** The driver takes a session with no bridge as gone (`unbridge`), for its jobs today and for its agents now: they read "ended with the session" until the bridge answers again and a fresh watch says otherwise (R5). The transcript's own row follows the holder registry (U8b's M6), not the bridge, so for that stretch the row can still say the agent works while the panel says it ended.
8. **A session whose process is gone.** Every agent the rows hold no end for reads "ended with the session", once, before the watch ends. After the page is reloaded the session is one not running here.
9. **A workflow's agents.** In no list on any route; no entry is derived for them.

### Engine facts

Each statement says what holds it: a fixture under `spikes/protocol-probe/fixtures/` (or a recorded transcript under `test/fixtures/`), or the pinned engine's bundle read as a reference (`cli.pretty.js` of `2.1.322`, cited as B:line). No sidecar was ever recorded on `2.1.322`: the sidecar fixtures are from `2.1.283` and `2.1.300`, so a fact about a sidecar on the pinned engine is the bundle's unless it says otherwise. The shared vectors are hand-written rules, not recordings, and are cited as rules only.

1. **Start.** The meta is written when the agent's run starts, beside its first rows, and neither write is awaited (B:239599, B:239609), so which reaches the disk first is not fixed. It carries `agentType`, `requestShape` (`background` for an agent run in the background, B:239896), and, where they apply, `description`, `name`, `toolUseId`, `parentAgentId`, `spawnDepth`, `model` (B:239609). Fixtures of the older engines show the same keys (`fixtures/subagent-sidecars/agent-ad286defbc77bc090.meta.json`, `2.1.283`; `test/fixtures/lane-a/subagents/`, `2.1.300`). The driver therefore takes an agent to exist when the host lists it, not when the bridge names it.
2. **Where an agent's rows go.** Only to its own file. Fixture, `2.1.322`: `fixtures/uxwave/u3-tasks-r1.transcript.jsonl` holds 304 rows and none with `isSidechain: true` or an `agentId`; bundle: B:380572 routes such a row to the agent's file. So the main transcript holds, about an agent, its call, the call's result, and its notifications, and nothing of its progress. No fixture of `2.1.322` holds a `task_status` attachment; the ledger reads one if it is there. This design needs no progress.
3. **A background agent's start in the rows.** Fixture, `2.1.322`: `u3-tasks-r1.transcript.jsonl` line 95, the `Agent` call's result with `toolUseResult.status: "async_launched"`, `agentId` and `outputFile`; the call's input carries `run_in_background` as the string `"true"`. The ledger's launch rule reads exactly this.
4. **A background agent's end in the rows.** Fixture, `2.1.322`, same file: the engine's queue record (line 102, `type: "queue-operation"`, `operation: "enqueue"`, no `uuid`, its `content` the `<task-notification>` block), a user row with `origin.kind: "task-notification"` (lines 114 and 133), and an attachment `queued_command` with `commandMode: "task-notification"` (line 190). Each block carries `<task-id>` (the agent's id), `<tool-use-id>` and `<status>`. The status words recorded on disk for an agent are `completed` only; `failed` and `killed` are recorded for shells in the same file and built for agents by the bundle (B:241015, B:241183, B:241193).
5. **An agent the loop waits for.** No disk fixture on any version holds such a call's result row in a main transcript. The bundle returns `status: "completed"` for it (B:1140945) and keeps `toolUseResult` on a main-loop row (B:1146825); the wire fixture `fixtures/pass3/nested-agents.jsonl` (`2.1.283`, seq 127) shows the same object. The ledger reads `completed` for such a row with or without the status, `error` when the row is an error. P4 records it.
6. **A nested agent's parent.** Fixture, `2.1.283`: `fixtures/pass3/nested-agents-sidecars/agent-a425e926e506edeb1.meta.json` carries `parentAgentId` (the parent's id) and `spawnDepth: 2`; its parent's own file (`agent-a38d4aebfaea9f6b1.jsonl`, rows 10 and 11) holds the nested `Agent` call and its result, and that result row has no `toolUseResult` key. Bundle: B:239609 (`parentAgentId` from the calling agent), B:1146825 (a subagent's row drops `toolUseResult`); both agents' files were recorded from the one `subagents/` folder, and only a workflow's agents get a subfolder (B:316410). So a nested agent's outcome is read from its parent's file, and a nested launch is known by its text; both are the ledger's rules.
7. **A background agent that outlives its turn.** Fixture, `2.1.322`: in `u3-tasks-r1.transcript.jsonl` the turn that launched the agent ends (line 99), and the agent's hand-back and notification arrive as queue records (lines 100 to 103) and open a new turn (line 104). The ledger reads the queue record whichever turn runs.
8. **An agent the engine wakes after it ended.** Fixture, `2.1.322`: same file, line 125 (`SendMessage`'s result names the same agent id as resumed) and line 133 (a second notification with the same `<task-id>`). Between the two the rows' last word for it is `completed`.
9. **The process dies while a background agent runs.** No fixture holds it for an agent. Bundle only: the exit path aborts each running task and sends its end on the wire alone (B:11271, the call at B:11284; the wire-only sender is B:1329811); no transcript row is written and the meta is not rewritten. DX4's rule (the process is gone and the rows hold no end: `exited`) rests on exactly that, and so does this landing's "ended with the session". P3 records it.
10. **The session is resumed after that.** Bundle only: at a resume the engine looks for background agents with a launch and no completion record ("orphaned by previous process exit", B:941370) and queues a task notification for each: `stopped` or `failed` (B:941370 to B:941412), `completed` for one that had finished unreported (B:941440), or it restarts the agent under the same id (B:941421). A queued notification is written as a queue record (item 4). When several orphans fall in one group the engine queues **one** block that names every one of them, several `<task-id>` elements and one `<status>` (B:941450; the tags are `task-id` and `status`, B:110582, B:110594). The ledger, as sminos's rules do, reads the first `<task-id>` of a block. P1 records what reaches the disk; R9 reports the gap.
11. **An agent is stopped.** Bundle: the sidecar's meta gains `stoppedByUser: true` when a host or the person stops it (B:378462), and a `killed` notification is built for an agent (item 4). Whether a stop that a plugin calls, which is how the bridge's `stop-agent` stops one, writes any row is not held by a fixture. P2 records it.
12. **What the bridge is told.** Bundle only: the engine's `SubagentStop` hook carries `agent_id` and `agent_type` (B:464382) and is also run from the agent's cleanup when its loop was interrupted (B:239783). The repository holds no recording of the bridge's own `agent` events; their shape here is read from sminos's bridge (`sminos_bridge.py`, which folds them, and its mod, which emits them) and from the vectors' statement of `input.bridge`.

### Routes and other machines (law 5)

- **A session MAWS runs:** untouched. Its graph reads the engine's frames; the store lays nothing over it, because no watch of it carries a body.
- **A terminal session on this Mac:** this landing.
- **A session on another machine, either kind:** untouched in what it derives and sends. One thing moves there, by the same line as here: the panel's sentence (R3).
- **This Mac, read from another machine.** A caller on another machine reaches a terminal session of this Mac through this Mac's endpoint, whose lane A rows are executed by sminos (`src/endpoint/offers.ts`: `sminos.rows`, `sminos.read` and the acts, `executor: 'sminos'`); the body it receives is derived by sminos's own plane on this Mac, from the same transcript, sidecars and bridge. MAWS's driver answers only this Mac's own windows (`laneA.watch` is `owner: 'machine'`, and for a session of another machine main's remote adapter, `src/main/lane-a/remote.ts`, takes the command instead). So this landing changes nothing this Mac answers to another machine, for a peer on this build or on either older one; no act crosses a machine link; there is no offer row, no grade and no link test to add. What it does change is that this Mac's own window now agrees with what the other machine was already shown.

### Stored and sent, and the two builds (root UC-14)

**Stored: nothing.** No layout key, no settings key, no index column, no file. The ticket's expectation holds. What the window keeps of a watch (the lane A store's agents) lives for the page's run, as the jobs do.

**Sent: one body, on an event that exists.** The `laneA.plane` event's `snapshot` and `subagents` messages gain entries in `subagents` (and the snapshot gains the key). `PlaneMessageSchema` types a message as `{ kind, body: unknown }` and is the same at the pin, at `2c7044231` and at `f1852de3a` (`git show <sha>:src/shared/ipc/schema/lane-a.ts`), so no schema changes, `WIRE_MINOR` stays 48, and neither generated wire file moves. Two more things are consumed, both existing: the command `fs.subagents` and the event `fs.subagentsChanged`, now also read by the spine's driver.

A window and the spine can be of different builds, so both pairings are stated against both builds the person's machines can run:

| pairing | `2c7044231` (what the machines run) | `f1852de3a` (the build to go back to) |
|---|---|---|
| that build's window on this build's driver | Its `receive` in `lane-a/watches.ts` reads `body.jobs` of a `snapshot` or `subagents` message and nothing else of the body (`git show 2c7044231:src/renderer/src/lane-a/watches.ts`, lines 114-115); the entries are ignored. It shows a terminal session's agents as it does today. | The same two lines, the same reading. |
| this build's window on that build's driver | That driver sends `subagents: []` (`git show 2c7044231:src/services/lane-a/reshape.ts`, `jobs`) and no `subagents` in its snapshot. This build reads no entry, lays nothing over the graph, and draws the sentence: today's reading. | The same (`git show f1852de3a:src/services/lane-a/reshape.ts`). |
| this build, then that build, then this build on one profile | Nothing was stored, so nothing is left to read. | The same. |

**Cross-build runs owed: none.** No wire minor is taken, and no stored form changes, so neither the two-run rule nor the equal-wire run of `e2e/cross-build.spec.ts` applies; this landing adds no row to that file's coverage table (U6b adds one of its own). The two pairings above are proved by unit tests instead (M3: an older driver's body; M2: the body's shape is DX4's, which an older window's two lines read past), and by the reading of the two builds' sources cited in the table. R8 asks the architect to confirm that no cross-build scene is wanted.

### What repaints, and what it costs with nobody looking

The measurement of an unattended window (item 566) is why the cards do not tick. The same standard applies to the source.

- **Main, per watched driven session, per second:** one read of the main transcript, which exists today (`jobsPollMs`, 1000: one `open`, one `stat`, and only the appended bytes); plus one such read for each *open parent*, an agent that has a nested agent which has not ended. A session with no nested agent running adds no read at all. A parent whose nested agents have all ended is not read again until a new meta names it.
- **Per event, not per second:** one extra read of the followed files after each bridge `agent` event (two per agent: its spawn and its stop); one `fs.subagents` listing when a session's follow starts.
- **File watches added: none.** The sidecar folder is watched by the engine host's one store watcher, as today; the driver reads its change event.
- **Derivations:** one pass over the listed agents after a tick that read new bytes, after a bridge `agent` event and after a listing; none over files that did not grow.
- **Messages:** a `subagents` message leaves only when the body's JSON differs from the one that watch last carried: about two per agent over its life (it starts, it ends), and none while agents merely run.
- **The window:** `withStatuses` returns the same graph object when a body changes no node, and the store writes nothing then, so no selector recomputes and no card repaints. A card's running row reads the slow clock (`useCardClock`, 30 s), as today; a panel's row ticks each second only while the panel is visible, as today.

*How a test pins it, by counts* (M2 and M3): with a driver whose poll is short and whose `transcript` and `subagents` dependencies count their calls, a watched session with two running first-level agents and an idle transcript, over N ticks, makes exactly N main reads, zero parent reads, one listing read and zero `subagents` messages; with one nested agent running it makes at most N more reads, all of that one parent, and after the nested agent's end row is read the parent's count stops growing; a bridge `agent` event adds exactly one round of reads and at most one message. In the window, the store's entry for the session is the same object after a second identical body.

### The look

No new surface, no new control, no new word. The card and the panel were drawn, shown and answered on (the child's file, "Shown to the owner before its interface is built"; the frame "a terminal session of this Mac" among the seven). A drawn example before the build is not needed: after this landing that frame shows what the frames of a session MAWS runs show. One word is carried onto a meaning it was not written for, and that is the owner's to settle: card C1 under "Reported to the architect".

### The reference

Claude Desktop `app-5.1231.2` has no counterpart for this route. A session started in a terminal is read-only there: its adapter sets `capabilities.backgroundTasks: false` and tails the transcript only (`readable/app-5.1231.2/web/app/v1/c5da7eb42-BxyuhJSN.js:3816-4007`, the capability at `:3874`, the refusals "Terminal sessions are read-only in the desktop app." at `:3814` and `:3985-3994`), and its Background tasks card is drawn only where that capability holds (`cb6930dae-Byq01zrW.js:3745-3752`). It shows a terminal session's task state only after importing the session as its own. So law 1 has nothing to follow here; the benchmark is this product's own other routes, and law 5 is the rule that binds.

### What is not proven

- Items 5, 9, 10, 11 and 12 of "Engine facts" rest on the bundle, not on a recording. Items 5, 9, 10 and 11 each have a probe under "Reported to the architect"; the design's default for each is DX4's rules as they stand, and each probe's answer changes one named place. Item 12 is read from sminos's own source and from the vectors' statement of the bridge's input; M2's tests drive the driver with the repository's double.
- That the host says `fs.subagentsChanged` for every session a page holds a watch of. It says it for a session a client "holds open" or follows (`agentsRead` in `src/engine-host/fs/service.ts`); a page that holds a lane A watch shows the session, and the window's own task graph already depends on the same event for the same session. M2 holds it with a test through the driver's dependency, not through the host.
- The cost bounds are counts in unit tests, not a measurement on a Mac. The unattended measurement itself (item 566's method) is not repeated by this landing; "Proof that an executor does not run" says what the architect may add.
- Nothing here was run: the document was written on a machine where no check runs, from the code at the pin.

## Acceptance

Behaviour a person can check, each with the proof that holds it. Unit commands run on the build VM (Concrete Steps); the e2e scenes run on a Mac and are the architect's to start. The child's acceptance items A2, A4 and A7 are the ones this landing completes for this route.

1. **The rules are sminos's** (M1). `vmcheck 'timeout 600 pnpm exec vitest run src/services/lane-a/jobs.test.ts'`: every case of `test/fixtures/lane-a/dx4-jobs.json` fed to the port gives the case's expected `subagents` (each entry without its `file`) and `jobs`. Sixteen cases expect agents; before this landing the test asserts `subagents: []` for all of them. Expect every case to pass and the count of cases with agents to be asserted as sixteen.
2. **A running agent shows** (A2; M2, M3, M4). In a terminal session this Mac drives, the agent launches a subagent in the background: within a second the column shows a Subagents card with the heading "Subagents" and "1 running" and that agent's row; the panel's Running lists it; the sentence "Status is known only while the session runs here" is not drawn. Proof: the driver's test (a watch's snapshot carries the agent `running`, evidence `rows`, with its `startedAt`); `panel/summary/running-cards.test.tsx` (the case of a terminal session this Mac drives, which today asserts no Subagents card); the scene of the card column in `e2e/lane-a.spec.ts`.
3. **A nested agent is under its "(+N)"** (A2, A4). That subagent dispatches its own: the heading reads "2 running", its row shows "(+1)" and the arrow, a press on that control shows the nested agent beneath it, and a press elsewhere on the row opens the agent in the panel. Proof: the driver's test with a nested meta and the parent's transcript; the same two renderer tests; the same scene.
4. **An ended agent reads its own outcome** (A7). The background agent's notification says `completed`: its row leaves the card and is in Done as "finished"; one whose notification says `failed` reads "finished with errors" in the danger colour and Done's heading names "1 failed"; one the rows say was stopped reads "stopped". When the last one ends the card leaves and nothing above it moves. Proof: M1's vectors for the words; `tools/agents/subagents/subagents.test.tsx` (the driven session's cases); the scene.
5. **The source costs nothing while nothing changes** (M2, M3). The counting test of "What repaints": N ticks, N main reads, no parent read without a running nested agent, no message; one round of reads and at most one message per bridge event; the same graph object after an identical body.
6. **A gone terminal ends its agents** (A7's test, on this route). The terminal's process goes while a background agent runs: the Subagents card leaves; the panel's Done reads "ended with the session" for that agent and keeps the outcomes of the others; the transcript's row no longer stays in view as working (U8b's M6, unchanged). Proof: the driver's test (the body sent before the watch ends has no running agent and that agent `exited`, evidence `session`); the store's test (the statuses are kept after the watch ends, and dropped when a watch ends with one still running); the scene of the gone terminal. This test fails before the landing: the graph holds the agent as `unknown`.
7. **Where the source cannot know, the row says so.** An agent the loop waits for, with a bridge that sends no agents: under On disk, "status unavailable"; when its result row comes, in Done. Proof: the driver's test with a bridge whose snapshot has no `agents`.
8. **The other routes are as they were.** A session MAWS runs, a session on another machine and a session not running here pass their existing unit tests and scenes unchanged, with one named exception: the panel's sentence on another machine's terminal session (R3). Proof: `e2e/agent-tools.spec.ts`, whose case "a disk-only session shows the same agents with wire facts unavailable" still holds word for word; `lane-a/remote-agents.test.ts`, `lane-a/agents/dx4-statuses.test.ts` and `lane-a/plane-transcript.test.ts` unchanged; a terminal session MAWS takes over reads its own frames (the store's test).
9. **An older window and an older driver.** A body with no entries (an older driver) leaves today's reading; the body this build sends is read past by the two older builds' windows ("Stored and sent"). Proof: the store's and `watches.test.ts`'s cases for an empty and an absent `subagents`.

## Constraints that bind every milestone

1. **Where work and checks happen** (root UC-10; `~/.local/share/maws-ux-wave/briefs/build-common.md`, which binds as written). On the MacBook: edit, commit, push; no `pnpm install`, typecheck, eslint, vitest, build or Electron. Every check runs on the build VM in a checkout of the pushed head through `vmcheck.sh` (Concrete Steps); the VM is shared, so a slow or timed-out check is read against its load first, and every command runs under `timeout`. An executor starts no Electron e2e, no `scripts/ci-gate.sh` and no pull request. Every commit message ends with `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)` and carries no other attribution. Never commit to master or to `ux-wave-spec`; never rebase or force-push; master is taken by merge.
2. **Nothing is stored** (root UC-14). No layout key, settings key, index column or file is added or changed. An executor that finds a behaviour here needs a stored value stops and reports.
3. **No wire change.** No command, event or schema under `src/shared/ipc/` is added or edited, `WIRE_MINOR` stays as master has it, and the two generated wire files are not regenerated. What crosses is the content of a body the schema types as unknown. An executor that finds a schema must change stops and reports: a minor is never taken to pass a gate.
4. **The port stays in step with sminos.** `src/services/lane-a/jobs.ts` follows `sminos_jobs.py` rule for rule; the vectors under `test/fixtures/lane-a/` are never edited; a rule the vectors do not pin, or one that reads wrongly, is reported, not improved (R9 is the known one). The one addition beside the rules is `Ledger.callAt` (R2).
5. **Files other children own** (root UC-8). This landing's files are `src/services/lane-a/`, `src/renderer/src/lane-a/` (the agents feed, the watches), `src/renderer/src/tools/agents/` (U8's), `src/renderer/src/stores/lane-a.ts`, and `src/shared/lane-a/agents.ts` (new). Its edits elsewhere are these and no others, each the smallest insertion: `src/services/spine-root.ts` (nobody's: two dependencies handed to the driver, M2); `test/support/fake-bridge.ts` (nobody's: the double folds the `agent` events it is told to emit into its snapshot, M2); `e2e/lane-a.spec.ts` and `e2e/support/lane-a.ts` (the lane's own scenes, M4). No file under `src/renderer/src/transcript/` (UC-3) or `src/engine-host/` is edited, and under `src/renderer/src/panel/` only the test `summary/running-cards.test.tsx`; `apps/desk-hub/` is read, never edited.
6. **The repository is public** (root UC-11). Test content is invented: ids, descriptions, paths, prompts. Nothing is sized or reproduced by reading a real session's transcript, sidecars, journal or settings; nothing about any person's machines goes into code, tests, comments or commit messages.
7. **The wave's laws.** Law 3: no setting. Law 5: each milestone says what holds on each route. Law 6: an engine fact a milestone newly depends on, beyond "Engine facts", is stopped on and reported. Law 7: no new colour, shape or word; the copy is `SUBAGENTS_COPY` as it stands.
8. **One meaning of "waiting"** (root UC-1). "Approval needed" keeps reading `selectPendingOf`; nothing here adds a predicate.
9. **Renderer source and the tokens guard.** A ticket or item number in renderer source is written in words ("ticket 599"), never with a number sign; `test/support/tokens-guard.test.ts` runs with M3's tests.
10. **A stop is a stop.** Stop and hand back, with the evidence, when the code contradicts a statement of the child's file, the root or this document; when a contract or another child would have to change; or when a change would alter what the person sees beyond "What each route shows afterwards".

## Plan of Work

Four milestones, in order. Each stands on this document and the code, has its own proof, and leaves the tree green. M1 is pure and is reviewed before M2 consumes it; M2 produces the body M3 reads, and the body's shape is fixed here (Interfaces §B), so M3 could be built from the interface alone; M4 writes the scenes over all three.

### M1 — The ledger's agents half and the derivation

**What exists at its end.** `derive` answers DX4's `subagents` entries for a session's agents from a ledger, the metas, the bridge's agents, the parents' ledgers and whether the process runs, and every vector case that expects agents passes. Nothing calls it yet; no behaviour changes.

**What it touches.** `src/services/lane-a/jobs.ts`, `src/services/lane-a/jobs.test.ts`, `test/fixtures/lane-a/dx4-jobs.PROVENANCE.md` (its last paragraph: what the port now covers and still leaves out), `src/shared/lane-a/agents.ts` (new: the types of Interfaces §A and §B).

**Interfaces.** Exposes §A to M2. Consumes nothing.

**Decisions.**

1. *A port, of the same module the jobs half came from* (R1). The source is `sminos_jobs.py`: `Ledger._call` and `_result` for `Agent` and `Task`, `_said`'s index by tool-use id, `_notification` for a block that names a call, `agent_outcome`, and `derive`'s `entry`. The Python is the authority; the vectors' `about` states the same rules in prose; `apps/desk-hub/fake-machine/jobs.ts` is a second reading aid and is not imported. The copy of `sminos_jobs.py` read for this document has the sha256 the PROVENANCE file records, so the vendored vectors are in step and need no re-sync.
2. *What is ported:* an `Agent` or `Task` call and whether its input asks for the background (`run_in_background` true, or the string `"true"`, as the engine writes either); its result row as a word (`async_launched` for a launch, by `toolUseResult.status` or, on a row with no `toolUseResult` that is no error, by the engine's two launch texts matched exactly; else `error` for an error row, else the status string, else `completed`); a notification that names the agent's id or its call; a `task_status` and a `TaskStop` that name it; the fold; the rule that a background agent's result row counts only as its launch; and the precedence of "What is derived".
3. *What stays out:* `mcp` (answered empty: this Mac's MCP widget has its own source), the vectors' `outputCases`, `jobs_body`'s `also`, `view` and `copy`, and an entry's `file` (decision 4). The header and the PROVENANCE note say so.
4. *The vectors' `file`.* The cases that give `agentFiles` expect a `file` on each such entry. The port derives none ("The inputs on this Mac"), so the test compares each expected entry without its `file` and says why in a comment; it does not edit the fixture. The test builds `parents` from the case's `agentFiles`: a ledger fed that agent's rows for each agent a meta or a bridge record names as a parent, null where the case gives null.
5. *One addition beside the rules:* `Ledger.callAt(toolUseId)` (R2). sminos forgets a call at its result; the port keeps the call row's timestamp for `Agent` and `Task` calls. It is not part of `derive` and no vector reads it; it has its own two-line test.
6. *The size.* P5 O9 set a stop at about 300 lines for the jobs port; the file is 284 today and ends near 430. This document is that stop's answer: the agents half is this landing's purpose.

**What it does not touch.** The driver, the reshaper, anything in the renderer. `Ledger.jobsBody` and the jobs' expected bodies: every existing assertion on jobs still passes unchanged.

**What it proves.** Acceptance 1. Beyond it, each one line: a block that names only a call (`<tool-use-id>`, no `<task-id>`) ends that call's agent and no job; a background agent's non-launch result row is not its end; a nested agent with no parent ledger and no bridge record is `unknown`; a parent cycle in the metas ends (each agent derived once); `callAt` survives the call's result.

### M2 — The driver: the three inputs, the body, what it costs

**What exists at its end.** A watch of a terminal session this Mac drives carries the session's agents with their statuses, in its snapshot and again whenever they change, and says them ended when the session's process goes. The window still ignores them (M3), so nothing is drawn differently; an older window ignores them for good.

**What it touches.** `src/services/lane-a/driver.ts`, `transcript-jobs.ts`, `reshape.ts`, a new `src/services/lane-a/agents.ts` (the fold of the bridge's agents), their tests (`driver.test.ts`, `reshape.test.ts`, a new `agents.test.ts`), `src/services/spine-root.ts` (the two dependencies), `test/support/fake-bridge.ts` (the double keeps the agents it is told of).

**Interfaces.** Consumes §A. Exposes §B to M3 and M4.

**Decisions.**

1. *One follow per session, as today, holding three things:* the main transcript's follower, the listing, and the parents' followers. It starts at the session's first watch and is dropped whole at its last (`followJobs`, `unfollowJobs`); a listing or a read that answers after the drop is ignored (a generation check, as the store's own reads use).
2. *The listing* comes through two new optional dependencies of the driver (§A): one read when the follow starts, then the host's change event for a session that has a follow. Only entries with `runId === null` are derived; a meta that could not be read is `{}`. A read that fails is logged once and leaves the last listing; with neither dependency (a test, a diagnostic run) there are no entries.
3. *The bridge's agents* are folded on the state stream, where the snapshot and the events already arrive (`openState`): the snapshot replaces the map, an `agent` event merges into it, every key but `type`, `phase`, `n` and `t` (the bridge's child keeps `t`, its mod drops it; a time that differs on every event would make every event a change), and `running` is `phase !== 'stop'`. The map is null before the first snapshot and is kept while the stream reconnects. The reshaper keeps ignoring `agent` on a watch's stream: one holder.
4. *A parent* is an agent some derived entry names as its parent (the meta's `parentAgentId`, else the bridge record's). Its follower is the main one's class over the parent's own transcript, whose path is its listing entry's; a parent the listing does not hold, or whose file cannot be read, is null. It is read whole once when it becomes a parent, then in each tick while it is *open*: while the last derivation left one of its nested agents not ended. A parent that closes keeps its ledger and costs nothing until a new entry names it.
5. *A tick* (every `jobsPollMs`, as today) reads the main follower and every open parent, then derives if any of them read a new byte (a tick over files that did not grow derives nothing). *A bridge `agent` event* asks for a read at once, coalesced with one in flight, and derives after it. *A listing* derives at once. *The process going* (`unbridge`, `drop`) derives with `sessionRunning` false before the watches end, where `jobsChanged(s, false)` is called today.
6. *The body and when it leaves:* §B. Each watch remembers the JSON of the last body it carried, as it does for jobs today, and hears a `subagents` message only when that differs; its snapshot carries `subagents` beside `jobs`. `startedAt` is added to each entry from `callAt` of the ledger that holds its call.
7. *A bridge that goes* is the process gone, for agents as for jobs (R5).
8. *What it does not decide:* whether a stopped agent's rows say so (P2), and what a resume writes (P1). The driver applies the rules to whatever the rows hold.

**What it does not touch.** The session's state (`LaneAState`), its attention items, the controls, `laneA.*` schemas, the engine host. `stopTask`'s refusal for an ended job keeps reading the jobs.

**What it proves.** Acceptance 2, 3, 6 and 7 at the driver, and 5's main half. Each sequence is held open, not only read at its end: a bridge event that arrives while a read is in flight derives once, after it; a spawn the bridge reports before the listing names the agent gives no entry, and the listing's arrival gives it; a stop the bridge reports before the result row is read gives `exited` with evidence `bridge`, and the row's arrival gives `completed` with evidence `rows`; a listing that answers after the last watch ended sends nothing and leaves no timer; a watch opened while another watch of the session is open gets the agents in its own snapshot; the state stream's fresh snapshot after a reconnect replaces the map; a session with a bridge whose snapshot has no `agents` derives from the rows alone. And the counts of acceptance 5.

### M3 — The window: the statuses laid over the graph

**What exists at its end.** In the window, a terminal session this Mac drives shows the Subagents card, the panel's Running and Done with each agent's outcome, and Stop agent only for an agent that has not ended; the sentence about status is drawn only where no status is reported.

**What it touches.** `src/renderer/src/stores/lane-a.ts`, `lane-a/watches.ts`, `tools/agents/store.ts`, `lane-a/agents/task-feed.ts`, `tools/agents/subagents/AgentList.tsx`, and the tests `lane-a/watches.test.ts`, `tools/agents/store.test.ts`, `lane-a/agents/task-feed.test.ts`, `tools/agents/subagents/subagents.test.tsx`, `panel/summary/running-cards.test.tsx`.

**Interfaces.** Consumes §B. Exposes §C.

**Decisions.**

1. *The watch keeps the agents beside the jobs.* `receive` reads `body.subagents` of a `snapshot` or a `subagents` message of the session's own watch, when it is an array, into the lane A store; a watch's end drops them unless none is `running`. It does so for every lane A session, another machine's included, so that one condition serves the panel's sentence on both (R3); nothing else reads another machine's from there.
2. *The store lays them over its own graph, for a session bound to this Mac's reads.* A session bound to another machine's feed is not touched: that feed's graph already carries them. The overlay is `withStatuses`, unchanged but for the start time (§C). The store keeps the graph its own reads built apart from the one it publishes, so a later body is laid over the reads' graph and never over an earlier overlay, and every reduction of its own (events, sidecars, runs, a stop) starts from the reads' graph.
3. *Only while the session is a terminal's.* The overlay is laid while the session has a lane A state or no engine status. A session MAWS runs (an engine status and no lane A state), which includes a terminal session the person took over here, reads its own frames whatever a watch said earlier.
4. *The graph's watch holds the session's watch.* While something watches the session's graph and its lane A state says the bridge is live or starting, the store holds `watchLaneA` for it, so the Subagents panel alone (the column is not drawn while a side surface is open) still keeps the body coming. Released with the graph's last watcher and when the state goes.
5. *The start time:* `patchedNode` takes the node's own start, else the entry's `startedAt`, else `file.firstAt`.
6. *The sentence* (R3): not drawn when `live` is false and the lane A store holds, for the session, an agent with a `status`.
7. *Nothing else is edited.* The card, the rows, the drill-in, the relay box and the summaries read the graph. C1's word is today's.

**What it does not touch.** `panel/summary/Subagents.tsx`, `Summary.tsx`, `AgentRow.tsx`, `DrillIn.tsx`, `RelayComposer.tsx`, `copy.ts`, `model/task-graph.ts`; `lane-a/remote-agents.ts` and `plane-transcript.ts`; anything under `transcript/`.

**What it proves.** Acceptance 2, 3, 4, 6, 8 and 9 in the window, and 5's second half. Each one line: sidecars then a body, and a body then sidecars, publish the same graph; an identical second body publishes the same object; a body with one agent ended and one running moves one row; the watch ends after a body with none running and the statuses stay; it ends with one running and the graph reads from disk again; a session taken over here stops reading the kept statuses; a pinned Subagents tab that follows from a driven session to another releases the first session's watch; Stop agent is absent for an ended agent of a driven session and present for a running one; the sentence is absent with a reported status and present with an empty body.

### M4 — The e2e scenes, the record, and the acceptance run

**What exists at its end.** The `lane-a` group's scenes hold the new reading end to end, the tracker rows this document names are written for the architect, and the whole unit suite has run once on the final tree.

**What it touches.** `e2e/lane-a.spec.ts`, `e2e/support/lane-a.ts` (a helper for a nested agent's rows and sidecars, beside `backgroundAgentRecords` and `backgroundAgentSidecars`), this document's record.

**Interfaces.** Consumes §B through the app. Exposes nothing.

**Decisions.**

1. *Three scenes change and none is added.* No spec file is added, so the gate's script tests that count spec files and groups are unaffected.
   - *"each control reaches the bridge with its body…"*, its agents part: the background agent the transcript launched is listed under **Running** ("Running 1"), not under On disk; the row opens the drill-in; `tell` and `stop-agent` reach the bridge as today. Nothing is asserted about the row after the stop until P2 is answered.
   - *"the card column of a terminal session this Mac drives…"*, retitled for what it now holds: while the shell and the background agent run, both cards stand, Subagents before Background tasks, with "1 running" each; the double emits a nested agent's spawn, its sidecars are added and the parent's file gains the nested call: the heading reads "2 running", the row shows "(+1)", a press on it shows the nested row; the nested agent's and then the agent's notifications arrive and the Subagents card leaves; the shell ends and the Background tasks card leaves; the Connectors card has not moved at either leaving.
   - *"X-168: an agent started in the background whose terminal goes…"*: when the terminal goes, there is no Subagents card and the panel's Done reads "ended with the session" for the agent, beside the transcript row's fold the scene already holds. At the resume the scene writes what the engine writes for an orphan ("Engine facts" 10, as P1 confirms it) before the second agent starts, so the card counts the second agent alone; when that terminal goes too, the same.
2. *The acceptance run.* Acceptance 1 to 9's unit commands as written, then the whole unit suite once, then the script tests (the diff touches `e2e/`).
3. *The record.* The tracker rows for R7 and R9 and the list of R11 are handed to the architect as text; an executor edits no spec file, no register and no board.

**What it does not touch.** `e2e/agent-tools.spec.ts`, `e2e/remote.spec.ts`, `e2e/cross-build.spec.ts`, `package.json`, `.github/`.

**What it proves.** Acceptance 2, 3, 4 and 6 end to end, once the architect runs the group on a Mac; the scenes are typechecked and linted on the VM, not run.

## Concrete Steps

Commands run from the worktree of branch `ux-wave/U8d`; `vmcheck` stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U8d --`. Each call tests the pushed head and is its own call, so that its exit status is read; never pipe it into `tail` or `head`. The first call for the branch installs dependencies and can take twenty minutes. Every command inside is given a time limit.

1. **Base** (before M1, and again at any milestone boundary where master holds a new landing of the wave): `git fetch origin master && git merge origin/master`, then push. Merge, never rebase. After a merge, check "Assumed of the landings in flight" for each landing that arrived, and run the current milestone's set again.
2. **While a milestone is built:** the TypeScript project it changed (`vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'` for `src/services`, `src/shared`, `src/main` and `test/`; `-p tsconfig.web.json` for the renderer), `vmcheck 'timeout 600 pnpm exec eslint <the changed paths>'`, and the milestone's suites:
   - M1: `vmcheck 'timeout 600 pnpm exec vitest run src/services/lane-a src/shared/lane-a'`. Expect every vector case by name, the sixteen with agents among them, and the existing jobs cases unchanged.
   - M2: `vmcheck 'timeout 900 pnpm exec vitest run src/services/lane-a src/services/spine-root src/main/lane-a src/shared/lane-a'`. The double `test/support/fake-bridge.ts` is also imported by the e2e specs, which the VM does not run: `vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'` holds them compiling. The renderer's test support imports it too (`src/renderer/src/lane-a/test-support/lane-a-state.ts`): run the renderer's project once as well.
   - M3: `vmcheck 'timeout 900 pnpm exec vitest run src/renderer/src/lane-a src/renderer/src/tools/agents src/renderer/src/panel/summary src/renderer/src/stores test/support/tokens-guard.test.ts'`.
   - M4: `vmcheck 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.e2e.json --tsBuildInfoFile /dev/null'`, `vmcheck 'timeout 600 pnpm exec eslint e2e'`, and, because the diff touches `e2e/`, `vmcheck 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'`.
   Expect each to pass whole. On the VM a known set fails on master too and is not this landing's (`build-common.md` lists it). A run whose log stops growing while a process sits at full CPU is a loop: stop it, check `pgrep -fa vitest` leaves nothing, find the case with one file at a time, and report the loop.
3. **Node 22.** The driver's tests use sockets and timers; run them once under the gate's Node: `vmcheck 'timeout 900 npx -y -p node@22 node node_modules/vitest/vitest.mjs run src/services/lane-a'` (M2).
4. **M4, the last milestone, once:** `vmcheck 'timeout 1800 pnpm typecheck'`, then `vmcheck 'timeout 3600 pnpm test'` (the whole unit suite; an earlier milestone does not run it). Expect no failure outside the known set.
5. **Stop and hand back.** After M4's checks the executor stops and hands back to the architect: the head's sha, each command run with its result, the decisions made, anything that contradicts this document, and what was not verified. Class 1a (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u8d`), the branch's review, the Mac runs and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The derivation (M1; `src/services/lane-a/jobs.ts`, types in `src/shared/lane-a/agents.ts`)

```ts
// src/shared/lane-a/agents.ts
import type { SubagentStatusFacts } from 'desk-hub/protocol';

/** One listed agent: its id and its sidecar meta ({} when the meta cannot be read). */
export interface AgentMeta { agentId: string; meta: Record<string, unknown> }

/** The bridge's record of one agent as folded: its spawn's keys, and `running`. */
export type BridgeAgent = { agentId: string; running: boolean } & Record<string, unknown>;

/** DX4's entry as this Mac derives it: every fact but `file`. */
export type DerivedAgent = AgentMeta & Omit<SubagentStatusFacts, 'file'>;

/** What a watch of this Mac carries: DX4's entry and, beside it, when the agent's call was made (§B). */
export type LaneAAgent = DerivedAgent & { startedAt?: string };
```

```ts
// src/services/lane-a/jobs.ts
export interface DeriveInput {
  metas: readonly AgentMeta[];                    // one entry out per meta, in this order
  bridge: readonly BridgeAgent[] | null;          // null: no bridge state is held
  parents: ReadonlyMap<string, Ledger | null>;    // by parent agent id; null or absent: its transcript is not readable
  sessionRunning: boolean;
}
export function derive(ledger: Ledger, input: DeriveInput): { subagents: DerivedAgent[]; jobs: Job[]; mcp: [] };

// on Ledger, beside feed, add, running and jobsBody:
agentOutcome(agentId: string, toolUseId: string | null, background: boolean): Outcome | null;
callAt(toolUseId: string): string | null;   // the timestamp of the row holding that Agent or Task call, kept after its result
```

The status and its evidence, the first that holds (DX4, "Precedence"; the vectors' `about`):

| # | condition | status | evidence |
|---|---|---|---|
| 1 | the rows' outcome for the agent is terminal | that status | `rows` |
| 2 | the session's process is gone | `exited` | `session` |
| 3 | its parent has a meta and has ended (`completed`, `failed`, `stopped`, `exited`) | `exited` | `parent` |
| 4 | the bridge holds it with `running` false | `exited` | `bridge` |
| 5 | the bridge holds it with `running` true | `running` | `bridge` |
| 6 | the rows' outcome is running (a launch) | `running` | `rows` |
| 7 | none | `unknown` | `none` |

The bridge counts only while the session's process runs. `running` is on an entry while the bridge holds the agent and the process runs; `spawn` is the bridge record's keys among `parentAgentId`, `subagentType`, `description`, `name`, `background`, `model`, `toolUseId`, kept after the process is gone; `outcome` is the rows' word, `{ status, raw, at, summary?, outputFile? }`. An agent's loop is the main ledger when it has no parent, else its parent's ledger; its call is the meta's `toolUseId`, else the bridge record's; it is a background agent when the meta's `requestShape` is `background`, the bridge record's `background` is true, or its call asked for it.

```ts
// src/services/lane-a/agents.ts (M2): the bridge's agents, folded as the bridge's own child folds them
export class BridgeAgents {
  snapshot(agents: unknown): void;               // the state stream's snapshot: replaces the map (not an array: an empty map)
  event(e: Record<string, unknown>): boolean;    // an `agent` event; whether the map changed
  list(): readonly BridgeAgent[] | null;         // null before the first snapshot
}

// LaneADeps gains, both optional (M2; src/services/spine-root.ts hands them the engine host's):
subagents?(appId: AppSessionId): Promise<SubagentEntry[]>;                                             // `fs.subagents`
onSubagentsChanged?(listener: (appId: AppSessionId, agents: SubagentEntry[]) => void): () => void;     // `fs.subagentsChanged`
```

### §B. The body (M2 writes it, M3 and M4 read it)

On `laneA.plane`, for a watch of a session this Mac drives:

```ts
// kind 'snapshot' (n 0): body gains `subagents`
{ streaming, usage, jobs: Job[], subagents: LaneAAgent[] }
// kind 'subagents': sent to a watch whenever its JSON differs from the last body that watch carried
{ subagents: LaneAAgent[], jobs: Job[], mcp: [] }
```

An entry is `{ agentId, meta, status, evidence, running?, spawn?, outcome?, startedAt? }`. Everything but `startedAt` is DX4's, so a reader of DX4 reads it. `startedAt` is an ISO timestamp, absent when no ledger this Mac follows holds the agent's call. No entry carries `file`. An older driver sends `subagents: []` in the message and no `subagents` in the snapshot; a reader takes an absent or empty list as "no status reported".

### §C. The window (M3)

```ts
// stores/lane-a.ts, beside the jobs
agents: ReadonlyMap<AppSessionId, readonly LaneAAgent[]>;
export function noteLaneAAgents(appSessionId: AppSessionId, agents: readonly LaneAAgent[]): void;
export function laneAAgentsWatchEnded(appSessionId: AppSessionId): void;   // drops them unless none is `running`
export const useLaneAAgents: (appSessionId: AppSessionId) => readonly LaneAAgent[] | null;

// lane-a/agents/task-feed.ts: the same function for another machine's entries and this Mac's
export function withStatuses(held: TaskGraph, metas: readonly (SubagentMeta & { startedAt?: string })[]): TaskGraph;
// a node's start: its own, else the entry's `startedAt`, else `file.firstAt`
```

What `tools/agents/store.ts` guarantees, for a session bound to this Mac's reads:

- `entries.get(id).graph` is the graph the store's reads built with the session's lane A agents laid over it, while the session has a lane A state or no engine status; otherwise it is the reads' graph.
- It is the same object after a change that alters no node.
- No reduction of the store's own starts from a published graph that carries an overlay.
- While the graph has a watcher and the session's bridge is live or starting, the session's lane A watch is held.

Nothing else is exposed to a sibling. The card and the panel are not edited, so U1b's slot, U2b's rows and U6b's tabs meet nothing new here.

### §D. What this landing consumes

| from | what, by the name it is exposed under |
|---|---|
| U8b (on master) | the task graph's readings (`runningAgents`, `firstLevelAgents`, `nestedOf`, `onCard`, `agentsRunningUnder`), `SubagentsCard`, the panel's sections, `useOpenAgents`, `SUBAGENTS_COPY`; all read, none edited |
| U8b's M6 (on master) | the follower's supplied `process.exited`, which ends the transcript's own agents row on this route; unchanged, and independent of the body this landing sends |
| P5 O9 (on master) | the driver's follow and `jobsChanged`, `Reshaper`, `watchLaneA`, the lane A store's jobs, `withStatuses` |
| U3a (on master) | nothing: `readArrivals` is not called (R10) |
| the engine host | `fs.subagents`, `fs.subagentsChanged`, as they are |

## Proof that an executor does not run

| proof | who, when | what it needs | what it shows |
|---|---|---|---|
| **Class 1a** (static, unit, probes) on GitHub Actions | the architect, once, on the head the pull request will carry | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u8d`, in the background | the gate of record; the pull request names the run |
| **`e2e:lane-a`** on a Mac under the load rule | the architect; the three changed scenes alone first, then the group, on the final head | a Mac with the build; no account and no engine (the group drives a double of the bridge and writes its own transcript) | acceptance 2, 3, 4 and 6 end to end: the driver, the socket, the host's listing and the window together. Only a Mac run shows that the host's change event reaches the driver for a session a page watches, and that the card's coming and going moves no card above it |
| **`e2e:agents`** and **`e2e:remote`**, unchanged scenes | the architect, with the final Mac runs | as today | acceptance 8: a session not running here reads word for word as before (`agent-tools.spec.ts`, the disk-only case); another machine's session still draws its agents. If R3 stands as written and a scene of `remote.spec.ts` reads the sentence, that scene follows; at the pin none does |
| **No cross-build run** | the architect confirms (R8) | — | by the rule: no minor, no stored form |
| **Probes P1 to P4** | the architect arranges, off the MacBook | engine `2.1.322` in a terminal with the bridge for P1 to P3 (P1 and P3 need the process ended from outside), headless suffices for P4; the main transcript and the `subagents/` folder kept as fixtures with a findings file | what "Reported to the architect" says each answers. P1 and P3 bear on M4's scene of the gone terminal and should be in before M4; P2 bears on C1; none holds M1 to M3 |
| **The owner's answer to C1** | the architect asks | the card as written; P2's finding beside it | the word for an agent ended with no record of how; until then today's word is built |
| **The branch's review** | the architect | "Size and review" | the verdict the pull request carries |
| **An unattended reading**, optional | the architect, if the counts of acceptance 5 are not thought enough | a Mac, a driven terminal session with agents running, the window left alone; item 566's method | reads and repaints per second with nobody looking |

## The pull request

Opened by the architect when the branch is complete, its review clean and class 1a green. Its body names the class 1a run, the review's verdict with what was dismissed or deferred, the Mac runs with the head each ran on, and the residue: the tracker rows of R7 and R9, the probes still open, and C1 if unanswered. This landing reverses no ruling, so it carries no dated amendment of one; the sentences of R11 become false at landing and are amended by the architect in the spec's batch. The register's row for O-05 reads "built in part"; this landing is the part that was left, and the row's update at landing is the architect's. It ends with the line `Sminos-Session: ux-wave#10d85d03 (MAWS on macbook)`.

## Size and review

Counted from the code at the pin, per milestone; lines are added plus changed.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 165 (`jobs.ts` 284 to about 430; the types file) | about 95 (`jobs.test.ts` 58 to about 150) | — | 4 (with the PROVENANCE note) |
| M2 | about 245 (`driver.ts` +170, `agents.ts` +45, `transcript-jobs.ts` +15, `reshape.ts` +8, `spine-root.ts` +8) | about 360 (`driver.test.ts` +260, `agents.test.ts` +70, `reshape.test.ts` +15, the double +12) | — | 9 |
| M3 | about 95 (`store.ts` +55, `stores/lane-a.ts` +22, `watches.ts` +8, `task-feed.ts` +6, `AgentList.tsx` +4) | about 320 (`store.test.ts` +130, `running-cards.test.tsx` +70, `subagents.test.tsx` +60, `watches.test.ts` +40, `task-feed.test.ts` +20) | — | 10 |
| M4 | — | — | about 210 (`e2e/lane-a.spec.ts` +170, `e2e/support/lane-a.ts` +40) | 2, and this document |
| **whole** | about 505 | about 775 | about 210 | about 25 files, about 1,500 lines |

**The e2e groups whose scenes cross what moves** (by their names in `package.json`), and the scenes that change:

| group | what of this landing its scenes cross | scenes that change |
|---|---|---|
| `e2e:lane-a` | the driver, the body, the watch, the store, the card and the panel on a driven terminal session | three (M4, decision 1); none added |
| `e2e:agents` | `tools/agents/store.ts`, `AgentList.tsx` (`agent-tools.spec.ts`, on the harness) | none; its disk-only case is acceptance 8's proof |
| `e2e:remote` | `lane-a/watches.ts`, `lane-a/agents/task-feed.ts`, `AgentList.tsx` on another machine's session | none at the pin (no scene reads the sentence of R3) |
| `e2e:layout`, `e2e:panel` | the card column and the side column mount the store (`ux2-shell.spec.ts`, `shell.spec.ts`, `panel.spec.ts`) | none |
| `e2e:cross-build` | nothing: no stored form, no minor | none; not owed (R8) |

Only a Mac run gives: the three `lane-a` scenes end to end, and the unchanged groups' passes on the final head. The set of groups run again on the final head follows the root's rule (UC-10, "The final Mac runs") and is the architect's to fix.

**The document's review.** An adversarial review before any executor starts (the architect dispatches it). Where it should push: whether the port is the right holder (R1); whether the driver's ordering has a sequence the tests do not hold; whether "nothing while nothing changes" is true of every input; whether any state of the route table is wrong for another machine today.

**Each milestone's review** at its boundary, before the next consumes it: M1 by a single reviewer against the Python and the vectors; M2 by a single reviewer at the high rung (ordering, lifetimes, timers); M3 by a single reviewer.

**The branch's review: the xhigh panel** of `doperpowers:review-code`, run by the architect. Why: the branch is past twenty files; its centre is a loop that runs every second for every watched terminal session, in the process that holds every session; and a wrong status here is shown as fact. Neither the root nor the child's file calls the landing delicate, and it stores nothing, so the panel is warranted by size and by where the code runs, not by a stored form. Lenses: (1) fidelity to the contract, the port read against `sminos_jobs.py` and the vectors rule by rule; (2) the driver's ordering and lifetimes: reads in flight, events between, follows dropped, timers and listeners left behind; (3) cost with nobody looking: reads, derivations, messages, repaints, each against "What repaints"; (4) routes and builds: that a session MAWS runs, one on another machine and one not running here are untouched, and the two older builds' pairings; (5) the window's overlay: the store's invariants of §C and a session that changes hands.

## Surprises & Discoveries

- Observation: the bridge already tells main which agents run, and main drops it.
  Evidence: the state stream's snapshot has `agents` and `agent` events follow (sminos's `sminos_bridge.py` builds both; the repository's double sends `agents: []`, `test/support/fake-bridge.ts`); `Reshaper.event` in `src/services/lane-a/reshape.ts` lists `agent` among the events that are "the state's or nobody's", and `SessionFold.event` has no case for it.
- Observation: the repository holds two TypeScript readers of the shared vectors, and only one of them derives agents.
  Evidence: `src/services/lane-a/jobs.ts` (jobs only, the product's) and `apps/desk-hub/fake-machine/jobs.ts` (the whole body, the desk's test double); the two copies of `dx4-jobs.json` are byte for byte the same (`cmp`). R1.
- Observation: MAWS's own disk-form reader and DX4 are recorded as disagreeing, which is why the ticket's second way would have made a second reading.
  Evidence: `src/renderer/src/lane-a/agents/dx4-statuses.test.ts`, the case "draws an older launch exited where MAWS's backfill alone reads it completed".
- Observation: at a resume the engine can end several orphaned agents with one notification block that names them all, and the shared rules read one task id per block.
  Evidence: `cli.pretty.js` of `2.1.322`, B:941450 (one block, a `<task-id>` per agent, one `<status>`); `notification` in `src/services/lane-a/jobs.ts` and `_notification` in `sminos_jobs.py` read the first. Bundle only; P1. R9.
- Observation: the panel's sentence "Status is known only while the session runs here" is drawn today for another machine's terminal session, above rows whose statuses that machine reports.
  Evidence: `AgentList.tsx`, `live = (controls === null || controls.turn() === null) && ctx.status !== null`; every lane A port answers a `turn()`. R3.
- Observation: no disk fixture on any engine version holds the result row of an agent the main loop waited for; in the recorded sessions every `Agent` call, with or without `run_in_background`, was launched in the background.
  Evidence: the `Agent` results in `fixtures/uxwave/u3-tasks-*.transcript.jsonl` (`2.1.322`), `test/fixtures/transcripts/subagent-parent.jsonl` (`2.1.283`) and `test/fixtures/lane-a/session.jsonl` (`2.1.300`) all carry `status: "async_launched"`. P4.
- Observation: on `2.1.322` the engine's code marks a background agent's meta `finished` when its run ends; no reader in MAWS or in the shared rules takes it.
  Evidence: `cli.pretty.js`, B:241225 (bundle only; no sidecar was recorded on `2.1.322`). It could one day let a session that is not running here say how its agents ended; not this landing's.
- Observation: Claude Desktop shows no task state for a terminal session.
  Evidence: `readable/app-5.1231.2/web/app/v1/c5da7eb42-BxyuhJSN.js:3874` (`capabilities.backgroundTasks: false` on the terminal adapter).

## Decision Log

1. **2026-11-15 · The verification call (authoring).** This document gets an adversarial review before an executor starts; the architect dispatches it. Each milestone is reviewed at its boundary (M1 and M3 by a single reviewer, M2 at the high rung). The branch gets the xhigh panel of `doperpowers:review-code`, run by the architect, with the five lenses of "Size and review", because it is past twenty files and its centre runs every second in the process that holds every session. Class 1a on GitHub Actions is the gate of record; the Mac runs of `lane-a`, `agents` and `remote` are the architect's; no cross-build run is owed (R8).
2. **2026-11-15 · The design's decisions, each recorded where it shapes the work.** The reading and what was rejected: "The design", "What was weighed". The inputs: "The inputs on this Mac". The body, its start time and when it leaves: "What is derived, and when it is sent", Interfaces §B. The overlay and its guard for a session that changes hands: M3, decisions 2 and 3. The points held for the architect: "Reported to the architect". No decision has changed since the writing.

## Outcomes & Retrospective

Pending — written at finish.
