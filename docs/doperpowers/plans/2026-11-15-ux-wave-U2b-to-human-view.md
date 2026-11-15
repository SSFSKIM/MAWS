# UX wave · U2b · the to-human view drawn by the mod, the working record's fold, the mirror (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U2**, second landing (**U2b**), parent pin `3f2c4fca1197ea75570d022c05049604320e7ee4`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U2-transcript-structure.md`: the items O-13 (with O-06 and l2-transcript-06), O-30 and #332; acceptance A12 to A16, and of A18 the mirror and where the mod draws; Contracts UC-13 (owned), UC-1, UC-2, UC-3, UC-6 and UC-8 as consumed; Design inheritance; "Probes and checks" 1, 5 and 7; under "Rulings reversed" the rows O-30 with O-06, and O-13. In the root: Purpose, the wave's laws (2, 5 and 6 above all), UC-3, UC-8, UC-10, UC-11, UC-13, UC-14 and "Ordering and dependency map". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: what the code, the engine and the installed mod say today, the decisions the section left open, the names siblings build on, what is stored and sent against both builds on the owner's machines, the mod's pull request as an executor can prepare it, and the execution. **Board:** #608 (the wave's epic is #573). The first landing is U2a (`docs/doperpowers/plans/2026-11-12-ux-wave-U2a-transcript-structure.md`, on master).
> **Two pull requests** (the architect's ruling R7): the first on branch `ux-wave/U2b`, milestones M1 to M3; the second, the cutover, on a branch the architect opens from a master that holds the first, milestones M4 to M6.
> **Revised once, on 2026-11-15,** at the architect's twelve rulings on the adversarial review's seven findings and on this document's fourteen reported points (Decision Log, the second entry, which lists what changed). The law the rulings serve binds every section: **at every moment one side draws the view, never both and never neither, and no state that is merely unknown is read as "MAWS draws".** The architect pins this text; no further review round follows.

## Purpose

After this landing a session's messages to the person read the same wherever the session runs, and MAWS draws nothing of its own in the to-human mod's place.

- A message to the person is the mod's drawing: a bold `● message` label in the accent colour over the body in the normal text colour, indented. The bar down the side and the "To you" label are gone (#332 closes on this).
- From a session's first message on, the work between two rows the person reads is one line, `› working record`. One click opens it onto the plain transcript's rows (tool runs folded, as U2a left them), with `‹ fold to report` under the last. There is no second fold in the way: MAWS folds no turn of its own once the view is in force, and a turn's line shows only while a record of that turn is open.
- The "Report · Transcript" bar above the transcript is gone. The switch is one line above the composer: `to-human view · full transcript ›`, and in the full transcript `to-human view · report only ›`.
- In a session MAWS runs, with a release of the mod that draws on MAWS's surface, all of this is the mod's own drawing and MAWS adds none. Everywhere else (a terminal session, a session on another machine, a session at rest, a session under an older mod) MAWS draws it by the mod's rule, ported clause by clause: the mirror.
- Exactly one side draws in every pairing of a MAWS build and an installation of the mod. The number a launch advertises says which: 9 when the mod draws, 8 when MAWS does.

How to see it working: the unit suites named in each milestone draw recorded sessions through the mirror by the three routes and compare the rows; the harness scenes of `e2e/transcript.spec.ts` and `e2e/to-human.spec.ts` show the fold, the message and the switch in the real window; the trial scene (`e2e/to-human-live.spec.ts`, rewritten) runs a session with the changed mod installed and shows the mod's drawing with nothing drawn twice. The Electron scenes, the trial and the cross-build runs are the architect's ("Proof that an executor does not run").

## Progress

**The first pull request** (`ux-wave/U2b`): the mirror, the look and the switch on every route; every launch still advertises 8; no wire minor, nothing stored.

- [x] (2026-11-15) This document written at master `3f2c4fca1`, reviewed adversarially, and revised at the rulings.
- [x] (2026-11-15) The owner's look at the drawn example and the answers to the cards ("Questions for the owner", the answer column; the architect's rulings of 2026-11-15 in the Decision Log).
- [x] (2026-11-15T08:22Z) M1 — The mirror: the fold by stretch on every route MAWS draws. Commits `e970b7df8`..`24bb61b67`; reviewed at its frontier (three Important and two Minor findings fixed at `9ff483b8f`..`24bb61b67`, re-review clean).
- [ ] M2 — What a message looks like, the switch above the composer, and what goes.
- [ ] M3 — The first pull request's scenes, the record's first line, and its acceptance run.
- [ ] Its proof an executor does not run ("Proof", the first list).

**The second pull request** (the cutover; waits for check 1 and for the first to be on master).

- [ ] P — the mod's pull request prepared in a worktree of the doperpowers repository, its own suite green (Interfaces §I). Not opened before check 1.
- [ ] Step 0 — check 1, run by the architect ("Checks handed to the architect").
- [ ] M4 — Who draws: the declaration, the reservation, `drawnBy`, the wire minor.
- [ ] M5 — Where the mod draws: an ask for every row, full sites, the reveal's end; the cutover.
- [ ] M6 — The second pull request's scenes, the cross-build scenes, the record's second line, and its acceptance run.
- [ ] Its proof an executor does not run ("Proof", the second list).

## What is assumed of landings in flight

One list, to be read again when each is on master. Step 1 of Concrete Steps repeats the commands.

| landing | read at | what this document assumes | read again |
|---|---|---|---|
| **U6d** (`origin/ux-wave/U6d`, built, in review) | `e6bc2dc19` | It touches no file this landing edits. It adds two runtime exports to `src/renderer/src/transcript/index.ts` and their names to the one-line list of `transcript/index.test.ts`, which pins every runtime export. **This landing adds and removes no export of `transcript/index.ts`** (the mirror lives under `src/renderer/src/owner/` and is imported by `view/Transcript.tsx` and `lane-a/view/drawn-rows.ts` directly, as `reportRows` is today). Under a mod's surface a mention's click is taken by the capture handler of `engine-surface/SurfaceTree.tsx`, which after U6d calls `openArtifactMention`; a message the mod draws is Markdown under that handler. This landing edits nothing in `SurfaceTree.tsx` | at each merge of master: `git diff --stat origin/master -- src/renderer/src/transcript/index.ts src/renderer/src/transcript/index.test.ts` prints nothing. The trial clicks one artifact mention and one path link inside a mod-drawn message and records what opens |
| **U6b-1** (`origin/ux-wave/U6b`, in build) | `71570d40b` | It touches no file this landing edits. Its later landings name a path link under a mod's pane or composer site that does nothing today, and a live region mounted in the composer (U4's file); neither is built | at each merge: if `composer/Composer.tsx` moved, the switch's mount stays directly after `PluginBand` |
| **U1b** (`origin/ux-wave/U1b`, `docs/doperpowers/plans/2026-11-15-ux-wave-U1b-requests-in-transcript.md`, revised; no code) | `e5d34d52b` | **This landing needs nothing from U1b.** **What U1b's document says it gives:** it adds no row kind; the rows of kind `question`, `ask` and `plan` carry `waiting: true` exactly while a waiting request joins them; a waiting row asks no mod's site, by a condition in the row's case of `view/rows/Row.tsx`, and `transcript/surface/` is not edited by it; the `answer` notice is still derived; its end row has no turn and is appended after the view's projection; `isPersistentRow` gains a waiting plan row, which concerns the transcript view's turn fold alone (the mirror does not call it). **What U1b relies on here, and holds whichever lands first:** a `question`, `ask`, `plan` and `request_slot` row is never inside a working record, waiting or answered (§B, with a test that names all four); the mirror only chooses among the list's rows, and the end row is appended after it; a call that waits for permission folds with its record, the card at the end being the request's whole drawing there; `jumpTo` opens the record that holds its target; `ui.view` and `setView` keep their names. **The one point where the two pulled apart, now ruled (R13):** an asynchronous answer is stated once outside the record: the answer's notice folds when its question's row carries the receipt (§B) | at each merge: the exhaustive switch of §B compiles; a test of U1b's that names `reportRows` is written against `mirrorRows` if this landing is on master first, and this landing's test of R13 reads the receipt from the row's own fields as U1b leaves them |

**Files both U1b and this landing edit** (the second to land merges master first and keeps both sides): `composer/Composer.tsx` (adjacent lines: this landing's `ViewSwitch` directly after `PluginBand`, U1b's notice line directly before it) and its test; `session/SessionPane.tsx` (here the bar's mount leaves and `ViewSwitch` comes above `HolderNotice`; there the fallback dock goes and the compact pane's line comes); `transcript/view/Transcript.tsx` (both where the rows are composed and at the row estimates) and `Transcript.test.tsx`; `transcript/view/rows/Row.tsx`; `transcript/model/derive.ts` (`isPersistentRow`: here `owner_record` leaves, there the waiting plan joins), `reduce.ts` (`TranscriptUi`), `rows.ts`, `keys.ts`, `serialize.ts` and the model's suites; `stores/transcript.ts`; `e2e/to-human.spec.ts`; `e2e/cross-build.spec.ts` (the second pull request); `docs/tech-debt-tracker.md`.

On master and checked by name (Interfaces §J): U2a, U3a (the revealed row, the arrival rows' asks), U4a (the composer), U1a (UC-3 as amended).

## Words used here

A **message** is a message to the person: a `<message>` span in the agent's text (the older marks `to-human`, `essential`, `need-input` and `insight` read as one, as the mod reads them) or a sent call of the message tool (`mcp__to-human__message`, and `mcp__maws__message` in recorded sessions). The **to-human view** (in code and in older documents: the report) is the view in which only what the person reads stays in sight. It is **in force** in a session while its lane is on and the session holds a message. The **lane** is MAWS's per-session switch for the view (`lane.on` of the owner channel's state). A **stretch** is a maximal run of rows the view folds, between two rows the person reads. Its **record line** is the `› working record` line that stands for it while it is closed. **The mirror** is MAWS's own application of the mod's fold rule. **The mod** is the to-human plugin of the doperpowers marketplace; its **view** is `to-human/hooks/mods/to-human.tsx`. A **site** is a named place of the engine's interface a mod can draw at (`UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `AbovePrompt`); MAWS **asks** a site for a row and draws the answer. An answer **keeps the engine's drawing** when its tree holds the engine's slot, in which MAWS mounts its own row; the mod writes that as `next(e)`. **Build F** is `f1852de3a`; **the installed build** is master `2c7044231`, on the owner's machines since 2026-11-15, with F kept to go back to. **Earlier builds** means both. The **engine host** is the process that runs a session's engine and outlives a relaunch of the app; the **daemon** (`mawsd`) holds the machine's services, the owner channel among them. **The declaration** is the file the mod's pull request adds to the plugin, by which an installation says it draws MAWS's view from 9 (§I). A launch's **advertisement** is what it carried in `MAWS_NATIVE_TO_HUMAN`: 9, 8, or nothing (the lane off); its **reservation** is that fact written to the index before the launch is sent (§A).

## Today, at `3f2c4fca1`

**MAWS.** `TO_HUMAN_CONTRACT_VERSION` is 8 (`src/shared/owner/contract.ts`), written into every lane-on launch's settings env as `MAWS_NATIVE_TO_HUMAN` by `withOwnerChannel` (`src/services/sessions/launch-mapping.ts`) on the decision of `ownerChannelLaunch` (`src/services/owner/launch.ts`). The lane's published state is `OwnerChannelStateSchema` (`src/shared/owner/state.ts`), a strict object whose `lane` is strict too; it is the output of the command `ownerChannel.state` and the payload of the event `ownerChannel.changed`, both owned by `machine` in the wire manifest (`src/shared/ipc/wire-manifest.json`). `WIRE_MINOR` is 46; it is 33 at F and 46 at the installed build, and `src/shared/owner/state.ts`, `contract.ts` and `src/services/owner/` are byte-identical on all three. The last decided launch is a row of `owner_channel_sessions` in the index database (`src/services/owner/store.ts`), written by `recordLaunch` as an update of the columns it names and read with `SELECT *`. The engine's status (`src/shared/engine/status.ts`) carries `launchId`, `process`, and `plugins` with each plugin's `name`, `path`, `source` and `version`, filled from `system/init` and from a `reload_plugins` answer (`src/engine-host/observed-facts.ts`), with `pluginsObservedAt` null until this launch reported them (a start with no prompt sees no init). The recorded fixtures hold a version on both carriers (`spikes/protocol-probe/fixtures/p4/p4-a2p-stub-hooks-group.jsonl`; `fixtures/pass3/e8-plugins-reload.jsonl`).

The renderer draws the report itself: `reportRows` (`owner/report/project.ts`) folds per turn into an `owner_record` row ("Working record · N tool calls · M messages"), composed in `transcript/view/Transcript.tsx` and, for the desk web app and lane A's helpers, in `lane-a/view/drawn-rows.ts`. The tab's choice is `ui.view` with `ui.reportOpenTurns` (`stores/transcript.ts`); `jumpTo` opens a turn's record through `foldedInReport`. `ReportBar` is mounted in `session/SessionPane.tsx` above the transcript. A message is `assistantPresentation` and `messagePresentation` (`owner/to-human/Presenter.tsx`), a decoration of the authored Markdown with `presenter.css`'s bar and "To you". A message-tool call is the `to_human` row, drawn by `ToHumanMessageRow` with no ask. A run asks `ToolGroup` beside MAWS's own row (`SurfaceGroupRow`, `drawingOnly`). The mods' band is `PluginBand` in `composer/Composer.tsx`, mounted when the session has started, drawn inside a bordered frame only while a mod answers `AbovePrompt`. A terminal session that no port drives shows `HolderNotice` in the composer's place (`SessionPane.tsx`, `noticed`), so nothing mounted in `Composer.tsx` is drawn there. For a session on another machine `ownerChannel.state` is refused (`src/shared/ipc/remote-unavailable.ts`, "not yet"), so `useOwnerChannel` holds nothing and `ownerLane` is false: today's report never applies on that route. The desk web app passes `ownerLane` as true for every session view and has a bar of its own (`apps/desk-web/src/views/project/ReportToggle.tsx`).

**The mod, as installed: 0.8.2.** Read in the plugin cache (read only). `native()` (`to-human.tsx`, lines 1450 to 1455) is true when `MAWS_NATIVE_TO_HUMAN` is set to anything non-empty and the event's surface is not the terminal (an event with no surface counts as not the terminal); the value is read once per worker. Eleven places call it and return `next(e)` when it is true: the `command.run` hook of `/to-human-dump`, the `ui.render` hooks of `UserMessage`, `TurnDuration`, `AssistantMessage`, `ToolUse`, `ToolGroup`, `ToolProgress`, `ToolResult` and `AbovePrompt`, and the `ui.press` hooks of `to-human-toggle` and `to-human-mode`. The message tool registers in a headless session at 8 or more (`message.tsx`, `getsTool`, `MAWS_WITHOUT_TOOL = 8`); the notifier is silent for any non-empty value (`notify.tsx`, `isNotifying`); the fold-summary tracker added in 0.8.0 is quiet for any non-empty value (`folds.tsx`, `isQuiet`), so under MAWS a record line reads its fallback, `working record`; the streaming hook (`hooks/to-human-stream.sh`, in the doperpowers plugin) and the sminos ask mod step out for any non-empty value. The view's rule and state are quoted in §B at the lines they stand on.

**Where U2a's §J and §K no longer hold.**

- §J's names all exist on master (`captionParts`, `turnOrder`, `captionText`; `runSegments`, `runLine`, `heldByPermission`, `THOUGHT_LINE_MS`; `stoppedMember`, `continuedAfter`, `denialDisposition`; `waitingLabel`; `Cell.background`; `GroupRow`; `groupInput`'s `isExpanded` and `revealed` rule; `ui.expandedGroups`, `toggleGroup`; `thinkingDurationMs`). Two of its last line's removals are not carried out: `FoldedAssistantProbes` stays, and the divider row's `toolCalls` stays as data (decision 13).
- §K reads the mod at 0.7.3. It is at 0.8.2: the number §K and the child's file give to the release that draws at 9, 0.8.0, is taken (point 1). There are eleven gated places, not ten. The plugin has no README; the sentence that states the rule is in its `CLAUDE.md`. The record line is no longer the literal `working record` on the terminal (point 3). §K's table of an older mod holds with "0.8.2 or before".
- §K says the desk web app's two imports are of the report projection. They are of the bar's words and its stylesheet (`ReportToggle.tsx`); the projection reaches the desk through `drawnRows`, whose name does not change (§L).
- §K puts the lane's field and the number under `src/shared/owner/` and `src/services/owner/` only. The field is on the wire and the decision must outlive a restart of the daemon (points 4 and 5).

**Found at the revision,** each read in the code or in the engine's bundle (`cli.pretty.js` of `2.1.322`), and each a premise of a ruling:

- *A launch's id is the host's.* `launchOnHost` answers with `session.launchId`, and the owner channel's record is written after that answer (`src/services/sessions/resume.ts`, the loop around `launchOnHost`; `setup.ts` the same; `src/services/owner/launch.ts`, `launched`, which catches a failed write and leaves the engine running). So today nothing about a launch is durable before it runs, and a reservation made before the send cannot name the launch's id.
- *The host cannot say what a running launch was given.* The engine's status carries no settings; the host holds the launch's spec only in the session's own object.
- *The engine's render sites are a closed list:* `AskUserQuestion`, `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress`, `CommandOutput`, `Spinner`, `TurnDuration`, `InfoNotice`, `SessionMode`, `PromptHint`, `AbovePrompt`, `Pane`, `Placed`, `Backdrop` (line 1127722). A remote surface may ask `TurnDuration` as a transcript message (the `ui_render` request's `on_screen` lists it). The engine draws a thought's text through `AssistantMessage` with `isSummary: true` (line 923794), and its closing line through `TurnDuration` under the id of the transcript's `turn_duration` row, with the props `word`, `durationMs` and `isExpanded` (line 929014); a headless session writes no such row (`src/shared/graph/events.ts`, the comment on an unseen exit).
- *MAWS's own render command names its sites in a closed set on the wire* (`commands.session.ui.render` in the manifest: twelve names, `TurnDuration` not among them). An added member of that set is a wire major by `src/shared/ipc/wire.ts`'s rule. Its `props` and its `instanceId` (up to 256 characters) are open.
- *With no advertisement the mod draws.* `native()` is false for an unset value, so with the lane off and the plugin enabled the view draws on MAWS's surface once it has seen a mark, whatever the output style (the style gates the message tool alone). Today that drawing is partial: the run's site can only add.
- *A site asks only while it is mounted.* The answers' registry drops an unmounted site's subscription and an invalidation re-asks retained sites alone (`engine-surface/registry.ts`, `retainSite`, `invalidateSession`); the list mounts only its virtual items.
- *The desk web app's streamed rows never enter the store.* They are built from its controller and handed to `Transcript` as `tail`, joined after the stored rows are derived (`apps/desk-web/src/depth/view/TranscriptPane.tsx`; `lane-a/view/streaming-rows.ts`; `transcript/view/Transcript.tsx`).

## The landing's edge

**In.** O-13 with O-06 and l2-transcript-06, O-30 and #332, whole. UC-13: the launch's advertisement (9, 8 or none), its reservation, `drawnBy` in the lane's published state. The mirror in place of `owner/report/project.ts`. The run's row as a full `ToolGroup` site, the message call's ask at `ToolUse`, and an ask of its own for every row the fold can hide. The rule that ends a reveal. The switch's two mounts. The desk web app's two imports re-pointed and its e2e expectations edited. Acceptance A12 to A16, and A18 on the mirror and where the mod draws. Checks 1, 5 and 7 as steps handed to the architect. The record: the rows O-30 with O-06, and O-13, of "Rulings reversed".

**Beside it, not in MAWS.** The mod's pull request (Interfaces §I), which by ruling R1 holds more than the one gate: the gate, the declaration, and what lets the mod answer for MAWS's turn line and for a row with no record of its own. Prepared by an executor in a worktree of the doperpowers repository, opened by the architect after check 1, merged by the owner. MAWS's acceptance holds without it merged: A12 to A14 by the mirror on every route, A16 by the mod's own test; only A15's scene needs the changed mod installed, and the trial installs it from the pull request's checkout into a scratch config home.

**Left.** Nothing of the child. Outside it and named so that nobody builds it here: a to-human look of its own for desktop surfaces (the mod's to decide); fold states carried between the mod and the mirror; the owner channel over the machine link; the desk web app's own bar (card 7); summaries on the record line, ruled into the second pull request by the owner's answer to card 1 (the mod makes them; MAWS brings them in with a setting that turns them off; a tracker row); a sent message as a step of a run (the child's "Waiting").

## Two pull requests

Ruled (R7): cut between M2's work and the cutover.

| | the first (`ux-wave/U2b`) | the second (the cutover) |
|---|---|---|
| milestones | M1, M2, M3 | M4, M5, M6, with P beside it |
| what the owner gets | the mod's look, the fold by stretch and the switch on every route, drawn by MAWS | the mod draws in sessions MAWS runs; `drawnBy`; with the lane off the mod's drawing is whole |
| what it depends on | nothing outside MAWS | check 1; the first on master |
| stored or sent | nothing | one wire minor (an optional key and a command), one added column |
| two-build runs | none: it edits no two-build scene | one against each of `f1852de3a` and `2c7044231` |

**Why the first leaves master releasable by itself under UC-13.** After it every lane-on launch still advertises 8, the value at which every release of the mod steps aside and registers its tool, the release the mod's pull request will make included (it draws only from 9). MAWS draws the view in the sessions it runs, by the mirror, so one side draws there: MAWS. UC-13 forbids advertising 9 before MAWS stops drawing for those sessions; the first advertises no 9 at all, so the rule is untouched, and the mod's pull request may merge before, between or after the two without changing what a session shows. With the lane off a session is as it is today on master: no advertisement, MAWS's turn fold, and the mod's partial drawing where the plugin is enabled (the second makes that case whole, R4). Nothing an earlier build reads or writes changes, so going back from it and coming to it are as from any landing that stores nothing.

## Decisions settled at authoring, as the rulings leave them

1. **A launch carries one of three advertisements,** and the number follows who will draw: 9 when the mod will draw MAWS's view, 8 when MAWS will (every release steps aside and registers its tool), nothing when the lane is off.
2. **Whether an installation draws at 9 is read from its declaration, never from a version** (R1). No constant in MAWS names a release of the mod. A launch advertises 9 only when at least one installation of the mod applies to the launch's folder and every one that applies carries the declaration; an installation without it does not draw at 9, whatever its version. After a reload the declaration is read at the path the engine reports for the loaded plugin.
3. **9 is advertised only once it is reserved** (R2). The advertisement is written to the index before the launch is sent; if that write fails the launch advertises 8. The reservation is bound to the launch's id when the host answers. A reservation that never ran is overwritten by the next launch's. The host cannot say what a running launch was given, so the reservation is the record, and at the daemon's start a reservation that is not yet bound is read as the session's running launch's (§A).
4. **An advertisement that cannot be known is never read as "MAWS draws"** for a live launch (R2). If the row cannot be read, or holds nothing for the running launch, the daemon publishes `mod` while the mod is loaded or not yet reported, and `maws` only when the engine has reported its plugins and the mod is not among them. Why: with the mod loaded the unknown number is 9, 8 or none; reading it as `mod` can at worst leave a launch at 8 with no fold (every row in sight, each message drawn as a message, nothing lost), while reading it as `maws` can draw the view twice. The read is tried again at every status of the session.
5. **With the lane off and the plugin loaded, the mod draws, and `drawnBy` says so** (R4). MAWS's turn fold stands aside there exactly as at 9; MAWS draws no mirror and no switch (the lane is off). With no applicable plugin nobody draws a view and the transcript is as today.
6. **In force is by time, not by place.** Once the session holds a message every stretch folds, those before the first message included (the mod's `isFolding()` tests no row's place).
7. **A session on another machine follows this app's switch** (card 4): its own lane cannot be read over the machine link.
8. **No turn fold while a view is in force:** while (the lane is on or the mod draws) and the session holds a message, in the to-human view and the full transcript alike. One flag of the transcript's view state, `noTurnFold`. **The mirror is applied only while that flag is set** (R5): it never projects rows a closed turn withheld. A message in rows handed to the transcript from outside the store (lane A's streamed reply, the desk web app's stream) reaches the flag through `Transcript` itself, before paint (M1).
9. **A stretch's key does not change while the stretch lives:** the first tool-use id of its first row where that row holds a call, else the row's id.
10. **Rows the child's table does not name** (§B, card 3): a thought folds; a browser action and an agent listing fold as the tool calls they are; the person's own `!` command stays; an error stays at every severity, since no site exists to ask about one and a row the mod is never asked about stays. A row kind the table does not know is a compile error.
11. **A turn's line and a time separator are members of no stretch.** Where MAWS draws: a closed turn's line is drawn in its place while a stretch that holds a row of that turn is open; the running turn's line is always drawn, in its place when that is in sight, else directly after the record line that covers its place; a separator is drawn when the row after it is drawn, a record line counting for its stretch's first row.
12. **An asynchronous answer is stated once outside the record** (R13). The mod leaves a question's call in view (`isRead`, line 605; the `ToolUse` hook returns `next(e)` for it, 1781 to 1826; it hooks no `AskUserQuestion` site) and classes the answer's delivery as the person's row (`ASK_DELIVERY`, 378; `promptRow`, 409 to 411). So where the question's row carries its receipt, row and notice would both stand in view; the notice then folds with the record. Where the row carries no receipt the notice is the one statement and stays.
13. **`FoldedAssistantProbes` stays** (it answers for turns MAWS folds, which still exist with no view in force) and **the divider row keeps `toolCalls` as data** (removing it rewrites every snapshot for no reader's gain; a tracker row). U2a's §J listed both as removed.
14. **Where the mod draws, every row the fold can hide has an ask of its own, alive while the row is mounted** (R3; §E). No row follows the remembered report of another. A thought asks where the engine itself draws one; a listing and a browser action ask as the calls they are; a notice asks as the arrival it is; the turn's line asks `TurnDuration`; a time separator keeps alive the ask of the row after it. The lead rule of this document's first text is withdrawn.
15. **A reveal ends when its containing row leaves the mounted range after that jump has entered it,** or at the next jump (R6). A cell resolves to the row that holds it, looked up again at each change of the rows, so a call that becomes a run keeps its reveal.
16. **One switch component, mounted twice, in the band's frame:** beside the mods' band in `composer/Composer.tsx`, and above the holder notice in `session/SessionPane.tsx` (R8). Drawn only while MAWS draws a view in force (card 6 for the frame).
17. **The words are the mod's, exactly** (§D), in one file. A control's accessible name is its visible text.
18. **The desk web app keeps its own bar** (card 7). Its three words and the bar's stylesheet move to the new folder and are kept for it alone.
19. **`e2e/to-human-live.spec.ts` becomes the trial scene** (it always skips today). It stays in the default group's list and runs only under its switch: no group list and no pinned count of spec files changes.
20. **The action "Toggle report and transcript" keeps its id and title.** In a session the mod draws it changes nothing and says why in a notice (R9; §D). **"Mark all read" stays reachable** as a command of the palette, a new action with no chord, wherever a session holds unread legacy items (R9; §K).
21. **What goes:** `ReportBar` with its count of unread legacy marks and its style-mismatch note; the `owner_record` row and `OwnerRecordRow`; `owner/report/project.ts`; the legacy cards `OwnerReport`, `EssentialCard`, `InsightNote` and `QuestionCard`, which nothing outside their folder mounts; `presenter.css`'s bar and label. `owner/report/answering.ts` stays.
22. **The cutover is one commit, in M5.** M4 builds the decision behind one switch in `contract.ts` that is off, so no launch advertises 9 before the renderer steps aside.

## The rulings, and where each is built

| ruling | what it rules | where |
|---|---|---|
| R1 | the declaration, never a version | decision 2; §A; §I, items 2 and 3; M4; check 1, question B |
| R2 | the reservation before the send; unknown is never "MAWS draws" | decisions 3 and 4; §A; §F; M4's sequences and its restart test |
| R3 | the lead rule withdrawn; an ask alive while the row is mounted | decision 14; §E; §I, items 4 and 5; M5; check 1, questions C |
| R4 | the lane off: no plugin, or a plugin that draws | decision 5; §A; §G; M4, M5; check 1, question D |
| R5 | the first streamed mark from outside the store | decision 8; M1, "The flag" and its three-route test |
| R6 | when a reveal ends | decision 15; §E; M5 |
| R7 | two pull requests | "Two pull requests"; Progress; "Proof" |
| R8 | the wire minor, the stored value, the second mount | §F; §K |
| R9 | the action says why; "Mark all read" stays | decision 20; §D; §K; M2 |
| R10 | points 2, 3, 6, 7, 9, 12 and 13 stand | below |
| R11 | the cards, each with its place | "Questions for the owner" |
| R12 | U1b's document read, the table corrected, shared files named | "What is assumed of landings in flight" |
| R13 | an asynchronous answer stated once | decision 12; §B; M1's test; point 15 |

## Reported points, and how each stands

| | what | how it stands |
|---|---|---|
| 1 | The mod is at 0.8.2 and 0.8.0, the number the design gave the drawing release, is taken; a release number cannot gate an already shipped MAWS | ruled R1: the declaration |
| 2 | The mod has eleven gated places and no README; `hooks/hooks.json` describes the tool as "not under MAWS", stale since 8 | stands (R10): §I |
| 3 | On the terminal the record line reads a summary; under any advertisement the mod makes none, so in MAWS it reads `working record` | stands for the first pull request, whose record line reads `working record`; the summaries in MAWS are ruled into the second pull request by the owner's answer to card 1 |
| 4, 5 | `drawnBy` is on the wire; the launch's advertisement must be stored | permitted as R2 shapes them (R8) |
| 6 | Going back while the mod draws a session shows both drawings until that session's next launch | stands; card 2 |
| 7 | A session on another machine has no readable lane | stands; card 4 |
| 8 | A terminal session nobody drives has no composer | the second mount is permitted (R8) |
| 9 | The desk web app keeps its own bar; eight of its scenes change | stands; card 7 |
| 10 | Rows with no site where the mod draws | ruled R3 |
| 11 | Size | ruled R7 |
| 12 | A16 is looked at on both earlier builds | stands |
| 13 | The mod looks for a first message only since the last compaction at its start; the mirror reads the rows the window holds | stands; a tracker row |
| 14 | The action cannot be hidden per session; "Mark all read" went with the bar | ruled R9 |
| 15 | **New, from R13 and the sibling document.** After U1b the question's row carries the receipt, and §B kept the answer's notice in view as the mod keeps the delivery: one answer would be stated twice | ruled R13: decision 12 |
| 16 | **New, found at the revision.** MAWS's render command names its sites in a closed set on the wire, so asking `TurnDuration` needs a command of its own, not a thirteenth name (§E, §F). And the review's check 5 remedy, not mounting a hidden stretch's rows, would again rest on a row that may not be mounted: it is withdrawn, and an over-the-bound reading comes back to the architect with its numbers (check 5) | built as written; for the architect's eye |

## Questions for the owner

Eight cards, most consequential first, shown with the drawn example before M2 (R11), and a ninth from the drawn example. All answered on 2026-11-15: the answer column holds the owner's words as chosen or typed on each card, or the architect's ruling where the architect decided. Each answer is built at one named place.

| | the question | recommended, and the others | built at | the answer (2026-11-15) |
|---|---|---|---|---|
| 1 | **What should the fold line say?** In the terminal the mod's line now carries a summary of the stretch; in MAWS it cannot yet | *`› working record`* everywhere in MAWS: what the mod itself draws under MAWS, no model call. Others: *what was done, counted* (`› Read 2 files, edited a file, ran 3 commands`), MAWS's words and only where MAWS draws; *the mod's summaries in MAWS*, one model call per stretch, and a terminal session seen in MAWS still reads `working record` | §D, the record line's text (`owner/view/copy.ts`); the third also §I | "we actually recently made changes to how '> working record' shows in terinal -- in short, it no longer shows '> working record', but shows '> <summaries>' instead. and i think that's how we should do it. mods already shipped it and is active already in terminal. it uses haiku call instead of forked call, and is cheap enough to use. But let user be able to disable it if they want to cut that token cost, and in that case it'll just be working record." The architect's ruling: the summaries are the mod's (its run tracker, a model call per closed stretch) and bringing them into MAWS with a setting that turns them off is the second pull request's and the mod's own; in the first the record line reads `working record` at §D |
| 2 | **Going back to an earlier build while the mod draws a session:** that session shows both drawings until it is restarted | *Accept it:* it needs the mod's change merged, this build used, and a going back with such a session still running. Other: *hold the 9*, the mirror on every route until no earlier build is kept | M5's cutover commit (the one switch of `contract.ts`) | Decided by the architect (ruling 2): *accept it*; built in the second pull request, with a tracker row there |
| 3 | **Rows the list of what stays and what folds does not name** | *The person's own `!` command and every error line stay; a browser action and an agent listing fold.* Others: *browser actions stay in sight*, as through a turn's fold today; *a retry line and a plugin's notice fold*, which needs a site for them in the mod's pull request | §B, the rows marked "decided here" | "! command and errors stay (Recommended)" |
| 4 | **A session on another machine: is the view on?** MAWS cannot read that machine's switch | *This app's switch decides.* Others: *always on once the session holds a message*, as the desk web app does; *off there* until the switch can be read | M2, the lane's source in `TranscriptSlot.tsx` | "This app's switch (Recommended)" |
| 5 | **A thought with nothing around it** (the agent thought for fourteen seconds, then messaged) | *It folds* under a record line like any work; where the mod draws, the mod folds it by its own rule already. Others: *it stays in sight* as `Thought for 14s`; *it is not drawn in the report*. Either other answer changes the mod's rule too | §B, the `thinking` row; for another answer also §I | "It folds (Recommended)" |
| 6 | **The frame of the switch where MAWS draws it** | *The same bordered box* the mods' band uses, so the two routes look the same. Other: *a bare line* | §D, `ViewSwitch` | "Bordered box (Recommended)" |
| 7 | **The desk web app keeps its Report · Transcript bar** | *Keep it* and register a desk ticket. Other: *replace it now*, a change to the desk's source and a deploy decision | §L | Decided by the architect (ruling 2): *keep it*; the architect registers the desk ticket; §L as written |
| 8 | **The lane switched off, the plugin still on** (new, from R4): the mod then draws its view in MAWS as it does in a terminal | *Let it draw, whole:* it is what happens today, in part. Other: *a plain transcript there*, which needs the mod to step aside for a value MAWS sends when its lane is off, in the mod's pull request | §A, the rows of `drawnBy` for no advertisement | "Let the mod draw (Recommended)"; built in the second pull request |
| 9 | **The mirror's layout against the mod's** (from the drawn example) | *Evened out for MAWS*: the seven items of the architect's ruling 3 (Decision Log, 2026-11-15) | each item at one place, listed in that ruling's entry | "Evened out for MAWS (Recommended)" |

## The drawn example

**Yes: before M2 is built.** The owner reads this surface all day and wrote the mod, and the frame of 2026-11-12 that showed the folded view (U2a's example, frame 8) was drawn before the message's look, the switch and the mod's 0.8 line were settled. M1 does not wait for it: it has no look. The eight cards are shown with it (R11).

One static page, at the transcript column's real width, in the light theme's tokens, built outside the repository from invented text (UC-11), with the shape of one real exchange: a prompt, work, a message in the middle of the work, more work, an arrival that opens a turn, a final message with unmarked words beside it. Frames:

1. Today, for reference: the bar, "To you" and its bar down the side, "Working record · N tool calls · M messages".
2. The to-human view folded: the prompt, `● message`, `› working record`, no turn line; the switch in its frame above the composer.
3. One record opened: the turn's line with no chevron, the runs folded as U2a draws them, `‹ fold to report`.
4. A message with unmarked words beside its marks: closed (the messages, then one line) and opened.
5. A turn running: its `Working for 1m 12s` line in sight after a closed record.
6. A permission waiting: the record closed, the card at the transcript's end.
7. The full transcript: the switch reading `report only ›`, every turn open, no chevron on a turn's line.
8. The same session as the mod draws it, from check 1's recorded answers drawn through MAWS's own tree renderer, beside frame 2.
9. A terminal session nobody drives: the switch above the holder notice.
10. The options of cards 1, 5 and 6, side by side.

## Acceptance

The child's file states A12 to A16 and A18. What proves each here:

| | proved by | where |
|---|---|---|
| **A12** a message is the mod's drawing | `owner/view/message.test.tsx`: the label, its colour token, the indent, one component for a span and for a call; `transcript/surface/presentation-local.test.tsx` and `output-style.test.tsx` edited; the scenes of `e2e/to-human.spec.ts` | M2, M3 |
| **A13** one fold per stretch, on three routes | `owner/view/mirror.test.ts` (§B row by row, the stretch's edges, the keys) and `lane-a/view-routes.test.ts`: one recorded session drawn from its wire, from its transcript file and from another machine's rows gives the same mirrored rows; the scene "the to-human view folds by stretch" | M1, M3 |
| **A14** no bar; the switch above the composer | `session/SessionPane.test.tsx` (no `[data-owner-bar]`), `owner/view/switch.test.tsx`, `composer/Composer.test.tsx` (the mount beside the band), the scene of `e2e/transcript.spec.ts` | M2, M3 |
| **A15** where the mod draws MAWS adds nothing; the same before and after a relaunch | `transcript/surface/mod-route.test.tsx` over check 1's fixtures: no record line, no switch and no message drawing of MAWS's beside the mod's; the trial scene, which also quits and reopens the session at rest and compares the two readings, fold states aside | M5; the second proof list, 2 |
| **A16** an earlier build is not drawn twice once the mod's change merges | the mod's test at 8 (§I); one look on each earlier build | §I; the second proof list, 5 |
| **A18** not worse on a long session | the derivation budget read before and after with a lane-on session of 500 turns; the anchoring scene's bound of 40 mounted rows in the mirrored view (a new unconditional scene); the measured anchoring scene base against landing; check 5 where the mod draws | M1, M3; both proof lists |

Behaviour this landing must hold that the child's acceptance does not state, each pinned by a test named in its milestone:

- **One side draws, never both and never neither,** in every row of §G, at every step of a reload under each advertisement, across a daemon's restart at any point of a launch, and when the row cannot be read (then: never both).
- **The cutover** (§H): each situation draws what §H says.
- **A waiting request is never inside a record** (UC-3), by row kind, waiting or answered; **an asynchronous answer is stated once outside the record** (R13).
- **A jump lands in sight** on both routes, and its reveal ends only after its row has been in the mounted range and left it.
- **A record stays open while its first row changes shape** (one call becoming a run, one read merged with the next).
- **The mod's full transcript folds nothing:** every row MAWS draws is in sight there, a thought, a listing, a notice and a turn's line included, whichever rows are mounted.
- **With no view in force nothing changes:** the plain transcript with MAWS's turn fold, as U2a left it.

## Constraints that bind every milestone

- **The law of the rulings** (the header). A test that proves "one side draws" also proves it at the instant before and after the event it stages, not only at rest.
- **The laws.** 2: where the mod draws, MAWS adds no record line, no switch and no drawing of a message; where none can, MAWS mirrors, and every clause of the mirror cites the mod's function it ports, at 0.8.2, in a comment (§B). 3 and 4: no setting, no new view mode. 5: every proof of the mirror draws by the three routes. 6: nothing about what the mod answers is coded before check 1 recorded it; nothing about the engine beyond the fixtures and the bundle lines "Today" cites. 7: today's tokens and shapes. 8: l2-transcript-14, -10 and -17 are `keep`.
- **UC-1.** The only reading of "waits" is `selectWaitingByCall`. **UC-2.** This landing classifies no arrival: it reads the row kinds and fields U3a's reader produced. **UC-3.** Requests' rows are U1's, arrival and message rows and `view/Transcript.tsx` are U3's: this landing's edits there are those of §K. **UC-6.** No chord is added; one action id is (§K).
- **UC-8.** The insertions in files another child owns are those of §K and no other.
- **UC-11.** Fixtures, tests and comments use invented text. Nothing of the drawn example enters the repository. Check 1's fixtures are recorded from an invented conversation in a scratch config home.
- **UC-13.** No commit of the first pull request, and none of the second before M5's cutover, makes any launch advertise 9.
- **UC-14.** Neither settings file and no layout key is touched. The one stored value is §F's column, in the second pull request.
- **Tokens.** The tokens guard reads `#` followed by three to eight hex digits as a colour in renderer source: a ticket is written in words there ("ticket 332"). No colour, radius or font size is written as a value.
- **Copy.** Every string a person reads is in `owner/view/copy.ts`, exactly as §D gives it.
- **Where checks run.** Nothing is installed, typechecked, linted, tested or built on the MacBook; every check runs on the build VM in a checkout of the pushed head. An executor runs no `scripts/ci-gate.sh`, opens no pull request, starts no Electron and no engine.
- **The mod's repository and the plugin cache.** Read only from MAWS's side. The mod's pull request is prepared in a worktree of that repository by whoever the architect dispatches for it; nothing is ever written into a plugin cache.

## Plan of Work

Six milestones in two pull requests, one work item beside the second (P, the mod's pull request), and one step that is not an executor's (Step 0, check 1). Each milestone ends with the tree green on the VM by the build brief's rule for a milestone; the whole unit suite runs once per pull request, in M3 and in M6.

### M1 — The mirror: the fold by stretch on every route MAWS draws

**At its end.** In a session whose lane is on and that holds a message, the report folds by stretch: `› working record` at each stretch's first row, one click opens it onto the plain transcript's rows, `‹ fold to report` under the last, no turn is folded by MAWS, a turn's line has no chevron and shows only while a record of its turn is open, and a jump opens the record that holds its target. The same recorded session gives the same rows by the three routes, a session whose first message is still streaming from outside the store included. The bar is still there and still switches the view; a message still looks as it does today. With no view in force nothing has changed.

**What it touches.** New: `src/renderer/src/owner/view/mirror.ts`, `owner/view/RecordFold.tsx`, `owner/view/copy.ts` (the two record strings; M2 adds the rest), `owner/view/view.css`. Changed: `stores/transcript.ts` (the view state, the jump), `transcript/model/reduce.ts` (`TranscriptUi`), `rows.ts`, `keys.ts`, `serialize.ts` (the `record_fold` row in place of `owner_record`), `derive.ts` (a turn derives open under `noTurnFold`; `owner_record` leaves `isPersistentRow`), `transcript/view/Transcript.tsx` (the composition, the flag's outside half, the new row's estimated height), `view/rows/Row.tsx`, `view/rows/Divider.tsx`, `lane-a/view/drawn-rows.ts`. Removed: `owner/report/project.ts`, `owner/report/OwnerRecordRow.tsx` and their tests. Tests rewritten to the new rows: `owner/report/report-view.test.tsx`, `owner/to-human/MessageRow.test.tsx`, `stores/transcript.test.ts`, `lane-a/view/report-stream.test.ts`, `streaming-rows.test.ts`, `older-pages.test.ts`, `lane-a/source/appended-turn.test.ts`, `off-chain.test.ts`, `ask-answer.test.ts`, `attention/anchor.test.tsx`, `transcript/surface/assistant-ink.test.tsx`, `transcript/model/to-human.test.ts`. New tests: `owner/view/mirror.test.ts`, `lane-a/view-routes.test.ts`, one case of `transcript/model/perf.test.ts`, one of `apps/desk-web/src/depth/view/TranscriptPane.test.tsx`.

**Interfaces.** Exposes §B and §C to M2, M5 and the desk web app. Consumes U2a's rows and U3a's row kinds (§J).

**Decisions.** 6, 8, 9, 10, 11, 12, 13; of the architect's rulings of 2026-11-15 (Decision Log), 3's items ii, iii and vii, 5 and 6. Beyond them:
- *The mirror is applied last,* where `reportRows` is today: after the resting rows, the placed rows and the queue's tail, in `Transcript.tsx` and in `drawn-rows.ts` alike, from the same exported function, so the desk web app and lane A's helpers count the rows the list draws. A row appended after the projection today (U1b's end row, when it is on master) is appended after the mirror.
- *The flag* (R5). `noTurnFold` is `(the lane is on) and (the stored events hold a message, or a live block of the store holds an open mark, or the rows handed in from outside hold one)`. The store computes the first two terms in the update that applies the events or the lane. The third is the transcript's: `Transcript` reads whether its `tail` holds a message (`holdsMessage`, over the tail's rows, an open mark included) during render and writes it to the store before paint (a layout effect, through `setToHumanView`), again whenever the key's state starts over (an attach, a source's reset: the pattern by which it re-applies the lane today). The term is not sticky: when the tail no longer holds a message (the stream reset; an interrupt cut a reply the session kept none of) and the stored rows hold none, the flag clears and the turn fold returns. **`mirrorRows` is applied only while the stored flag is set,** in `Transcript.tsx` and in `drawnRows` alike, so the one render that sees a first mark in the tail before the flag is written draws the rows unmirrored, with the turn fold, and is replaced before paint; no pass projects rows a closed turn withheld. No event is added.
- *A streaming message counts.* A live text block whose buffer holds an open `<message>` is a message, by the live grammar `liveMarkedRowIds` reads today (kept, moved into `mirror.ts`).
- *The flip.* The tests that count turn derivations (`transcript/surface/assistant-ink.test.tsx`, `stores/transcript.test.ts`, `transcript/model/derive.test.ts`) keep their rule and gain its other half: one derivation of every turn when the flag changes, none per token batch after it.
- *The jump.* `jumpTo` and the cell jump open the stretch that holds their target (`stretchHolding`) in place of the turn's record, when the view is the report, is in force and MAWS draws it. They still write `ui.revealed` and still open a run the target is in. `attention/anchor.ts` keeps calling `setView(key, 'report')`.
- *Pitfalls seen.* A row with no turn (standalone browser activity, placed by its time) is a row of the flat list like any other. The old projection counted a turn's unmarked messages by deriving the turn again; nothing here derives. `ui.reportOpenTurns`, `toggleReportRecord` and `foldedInReport` go; a test or a caller that still names them is this milestone's to move.

**What it does not touch.** `ReportBar` and how a message looks (M2). Any file under `src/shared/owner/` or `src/services/owner/`, and `transcript/surface/` (the second pull request). `e2e/` (M3). `groups.ts`, `classify.ts`, `caption.ts` and the run's row (final since U2a). The snapshots under `test/snapshots/transcript/`: no row of a lane-off session changes shape, so none changes.

**What it proves.** A13 by unit; A18's derivation half. And: §B's table, one case per row, each named for the row; the stretch's edges (a mixed message heads it; a waiting request's row splits it; a turn boundary does not); decision 9; decision 11; the jump into a closed record; `question`, `ask`, `plan` and `request_slot` never inside a record, waiting or answered; R13's test, "one answer is stated once outside the record", which counts the rows in view that state one asynchronous answer with and without the receipt on the question's row (one each time, outside the record) and both rows inside the opened record; and R5's test on three routes (the store's own live block, lane A's streamed tail, the desk web app's `TranscriptPane`): the only mark is in the stream, an earlier turn is closed, and opening that turn's record at once shows its work; then the stream resets, and the turn fold is back.

### M2 — What a message looks like, the switch above the composer, and what goes

**At its end.** A message is `● message` in the accent colour over an indented body, one drawing for a span and for a message-tool call, with no bar and no "To you". The bar above the transcript is gone, with its unread count and its mismatch note; "Mark all read" is a command of the palette. The switch is one line above the composer, in the band's frame, drawn only while the view is in force; a terminal session nobody drives has it above the holder notice. A session on another machine has the view when this app's switch is on. The legacy cards are gone. The desk web app compiles against the moved words and stylesheet.

**What it touches.** New: `owner/view/Message.tsx`, `owner/view/Switch.tsx`, the rest of `owner/view/copy.ts` and `view.css`. Changed: `owner/to-human/Presenter.tsx`, `message-ink.ts`, `MessageRow.tsx`; `owner/report/answering.ts` (it takes the bar's "mark every item read, or say why not" function); `composer/Composer.tsx`, `session/SessionPane.tsx` and `src/shared/keymap/actions.ts` (§K); `transcript/shell.tsx` (the two actions' handlers), `widgets/plugins/BuiltInMods.tsx` (the mismatch sentence's import), `transcript/view/TranscriptSlot.tsx` (the lane of a session on another machine); `apps/desk-web/src/views/project/ReportToggle.tsx` (two import paths). Removed: `owner/report/ReportBar.tsx`, `OwnerReport.tsx`, `EssentialCard.tsx`, `InsightNote.tsx`, `QuestionCard.tsx`, `report.css`, `owner/to-human/presenter.css`, their tests, and of `owner/report/copy.ts` everything `answering.ts` and the request card do not read. Tests edited: `owner/to-human/Presenter.test.tsx`, `MessageRow.test.tsx`, `owner/report/answering.test.tsx` (its two cases reach "Mark all read" through the action), `transcript/surface/presentation-local.test.tsx`, `output-style.test.tsx`, `transcript/view/TranscriptSlot.test.tsx`, `lane-a/view/streaming-rows.test.ts`, `apps/desk-web/src/views/project/ReportToggle.test.tsx`, the keymap's table test. New: `owner/view/message.test.tsx`, `switch.test.tsx`, cases in `session/SessionPane.test.tsx` and `composer/Composer.test.tsx`.

**Interfaces.** Exposes §D to M5. Consumes §C.

**Decisions.** 7, 16, 17, 18, 20, 21; of the architect's rulings of 2026-11-15 (Decision Log), 2, 3's items i, iv, v and vi, 4 and 6. Beyond them:
- *The message's wrapper keeps its class,* `owner-message-ink`: it is the locator of the message in a dozen unit tests and in the desk web app's scenes. What changes is what it draws: a label element that holds the words `● message`, then the body indented by two columns, the columns and rows of `engine-surface/style.ts` (a column is `1ch`, a row `1lh`; `claude` is `var(--accent)`; bold is weight 600), so the mirror measures as the mod's own tree does when MAWS draws it.
- *The label follows `spanRows`.* The first message of a reply's first text block reads `● message`; a later message of the same block reads `message` under the same indent; a message still streaming reads its label followed by ` …`. A message-tool call reads `● message`.
- *The lane of a session on another machine* is one function in `TranscriptSlot.tsx`: the owner channel's `lane.on` when the channel answers, else, for an address of another machine, this app's `mods.toHuman.enabled`, else off.
- *The switch is absent,* not disabled, with no view in force and in a subagent's transcript.
- *"Mark all read"* is the action `transcript.markAllRead`, registered beside `transcript.toggleReport` in `transcript/shell.tsx`: on the focused pane's session it marks every unread legacy item read, with the failure's notice and its Retry as the bar had them; with none unread it does nothing.

**What it does not touch.** The mirror's rule (M1). Any site ask (M5). The desk web app beyond the two import paths.

**What it proves.** A12 and A14 by unit. And: the switch's absences; its two words for the two views; the second mount above the holder notice; the lane's three sources; "Mark all read" by the action, its failure and its Retry; no element of the old bar, the old record row, a card or "To you" in any mounted pane.

### M3 — The first pull request's scenes, the record's first line, and its acceptance run

**At its end.** Every scene that pinned the bar, the old record row or "To you" states the new behaviour; the new scenes exist, typechecked and not run; the document that held the per-turn report carries its dated line; the whole unit suite is green on the VM.

**What it touches.**
- `e2e/transcript.spec.ts`: "the report folds work while marked text retains its authored flow and geometry" is rewritten to the stretch fold and the switch (its fixture stays); "R3 owner to-human draws every span as Markdown…", "detached owner recording keeps one authored Markdown flow…" and the three "M3 owner sitting preserves…" cases are read again against the message's new drawing (their recorded mod draws a button named `working record`; the mirror's line is absent there, the lane being off). New, unconditional: "the to-human view folds by stretch, opens, folds again, and a jump opens the record that holds its target"; "the mirrored view mounts at most 40 rows while 500 turns stream".
- `e2e/to-human.spec.ts`: the Needs-you jump's assertion on the bar becomes the open record. `e2e/maws-tools.spec.ts` and `e2e/design-systems.spec.ts`: their click on the bar's "Transcript" becomes a press of the switch when it is there. `e2e/library.spec.ts`: its conditional click goes.
- `apps/desk-web/e2e/`: the eight scenes of §L.
- The record's first line (below).

Before the hand-back, because the diff touches `e2e/`, the gate's own script tests run on the VM: they pin how many spec files exist (none is added or removed) and read a time bound in a scene by its form.

**What it does not touch.** Product code, unless a scene shows a defect; then the fix goes to its milestone through the controller. Any measured bound. `package.json`'s scripts. `e2e/cross-build.spec.ts`, `e2e/widgets.spec.ts` and `e2e/to-human-live.spec.ts` (M6).

**What it proves.** It writes the e2e halves of A12 to A14 and A18's mirrored scene; they are proved when the architect's runs are green. By its own run: typecheck, lint and the whole unit suite.

### M4 — Who draws: the declaration, the reservation, `drawnBy`, the wire minor

**Starts when** the first pull request is on master. It does not wait for check 1: nothing here reads a mod's answer.

**At its end.** The owner channel publishes `drawnBy` with a session's lane, decided by §A; a launch's advertisement is reserved in the index before the launch is sent and bound to its id after; an installation's declaration is read at the launch and at the loaded plugin's path after a reload; the wire has one more minor, carrying the optional key and the command `session.ui.renderSite`. `TO_HUMAN_CONTRACT_VERSION` is 9 and the mods list reads "Version 9". Every launch still advertises 8 or nothing: the one switch of `contract.ts` is off, and no released installation carries the declaration.

**What it touches.** `src/shared/owner/contract.ts`, `state.ts`, new `src/shared/owner/draws.ts`; new `src/services/owner/declaration.ts` (the one reader of the file); `src/services/owner/resolve-style.ts` (the applicable installations' paths, and whether hooks load), `launch.ts` (the advertisement, the reservation before the send, the bind), `store.ts` (the column, `reserveLaunch`), `service.ts` and `register.ts` (the status's subscription, the published field, the start's reconciliation); `src/services/sessions/launch-mapping.ts` (what is written into the settings env); `src/services/index/migrations.ts` (`ADDED_COLUMNS`); the command: `src/shared/ipc/schema/session.ts`, `names/session.ts`, `grades/session.ts`, `remote-unavailable.ts`, the engine host's handler beside `session.ui.render`'s (`src/engine-host/ipc.ts` and what it calls), `src/shared/machine/address-paths.json`; `src/shared/ipc/wire.ts` and the two generated files; their tests, and the tests that pin 8 by its digit (`src/shared/owner/contract.test.ts`, `src/services/owner/launch.test.ts`, `src/services/sessions/service.test.ts`), which pin `TO_HUMAN_MIRROR_VERSION` by name afterwards.

**Interfaces.** Exposes §A and the command of §E to M5. Consumes the engine's status (`src/shared/engine/status.ts`).

**Decisions.** 1, 2, 3, 4, 5, 22. Beyond them:
- *Where the reservation is written.* `ownerChannelLaunch` runs before `launchOnHost` in every launch path (`setup.ts`, `resume.ts`); it writes the reservation as its last act and, when the write of a 9 fails, returns the spec with 8 and a decision that records 8. `ownerChannelLaunched` binds it. A resume's second attempt (the engine wrote nothing) reuses the reservation and binds again.
- *Where the service learns the status.* The owner service subscribes to the engine host's `session.status` beside its `session.eventBatch` subscription (`register.ts`), and at its start reads each live session's status once and reconciles: a reservation not yet bound that §A reads as the running launch's is bound then.
- *The declaration's read is asynchronous.* It is read when a launch is decided (each applicable installation) and when a status first shows plugins observed at a new time (the loaded plugin's `path`); a read in flight when a later observation arrives is dropped, and until a read answers the earlier fact stands.
- *Sequences* (each a test that holds the order open, not only the end state): the reservation is written, the host accepts, the daemon stops before the bind, a new service starts: `drawnBy` is `mod` (R2's proof; `src/services/owner/restart.test.ts`); the reservation of a 9 cannot be written: the launch's settings env carries 8; a reserved launch is refused by the host and the session's earlier launch still runs: the reservation is not read as that launch's; the next launch overwrites it; a status of an older launch arrives after a newer launch was bound (ignored: its `launchId` differs); the process exits while a declaration's read is in flight (the exit wins: `maws`); the row cannot be read while a launch is live and the mod is loaded: `mod`, and `maws` once the plugins are reported without it; an earlier build's launch follows a reservation this build left unbound: its `launch_id` is the running launch's, so the advertisement is read from that row's `desired`.
- *Authorization.* `drawnBy` is read-only state published to whoever may already read the session's owner channel. `session.ui.renderSite` is graded and offered exactly as `session.ui.render` is, and refused for a session on another machine with the same sentence; the host checks the component against its own list where the ask runs, not only where the request enters.
- *Tests the ruling names.* An installation with a higher version and no declaration advertises 8; two applicable installations of which one lacks it advertise 8.

**What it does not touch.** The renderer. The switch of `contract.ts`.

**What it proves.** §A's tables case by case (the switch injected); the stored value's round trip through an earlier build's write; the wire's manifest test green with one added optional key and one added command and nothing removed or narrowed; the tolerant reader dropping `lane.drawnBy` for a schema that does not know it; an older host answering `unknown_command` to `session.ui.renderSite`.

### M5 — Where the mod draws: an ask for every row, full sites, the reveal's end; the cutover

**Starts when** check 1 has answered and P's branch exists.

**At its end.** In a session MAWS runs where the mod draws (at 9 with the declaration, or with the lane off and the plugin loaded), the messages, the record lines and the switch are the mod's; MAWS draws no record line, no switch and no message of its own, applies no projection, and folds no turn once the session holds a message. Every row the fold can hide asks a site of its own while it is mounted, so the mod's report hides it and the mod's full transcript shows it, whichever other rows are mounted. The run's row is a full site. A jump's target is revealed, and the reveal ends when its row has entered the mounted range and left it. A launch advertises 9 when §A says so.

**What it touches.** `transcript/surface/Rows.tsx` (`SurfaceGroupRow`; surface rows for `to_human`, `thinking`, `agent_list`, `browser_action` and the turn's line; the separator's probe), `adapters.ts` (their inputs; the arrival rows' asks widened), `transcript/view/rows/Row.tsx`, `Divider.tsx`, `transcript/view/Transcript.tsx` (the mod route's composition; the reveal's end), `TranscriptSlot.tsx` (`modDraws`), `stores/transcript.ts` (`modDraws` in the flag, `clearRevealed`), `engine-surface/site.ts` and `registry.ts` (the second command for `TurnDuration`), `src/shared/engine/surface.ts` and `surface-rows.ts` (`TurnDuration`'s props; `isSummary`), `owner/view/Switch.tsx` (absent where the mod draws; the action's notice), `src/shared/owner/contract.ts` (the switch). Tests: `transcript/surface/rows.test.tsx`, `adapters.test.ts`, `arrivals.test.tsx`, `revealed.test.tsx`, `engine-surface/SurfaceRow.test.tsx` where it pins the drawing-only group; new `transcript/surface/mod-route.test.tsx` over check 1's fixtures.

**Interfaces.** Consumes §A, §B, §C, §D and check 1's fixtures. Exposes §E.

**Decisions.** 14, 15, 20, 22. Beyond them:
- *The asks do not depend on who draws the view.* Every ask is made whenever a surface is attached; a mod that is not the to-human mod can now replace a run too (the child's departure from Desktop). What depends on `modDraws` is only what MAWS adds (the mirror, the switch) and the flag's first term.
- *The cutover's order inside the milestone:* the renderer's part first, then one commit that turns the switch of `contract.ts` on. If check 1 found that the changed mod cannot hide a run, the mod's pull request is not opened with the declaration until it can, and the cutover commit still lands: with no declared installation every launch advertises 8.
- *Sequences* (tests that hold them open): the surface attaches after the mirror has drawn (the mirror goes when `modDraws` turns true, in one update with the first asks); the surface goes while a record is open in the mod's view (the mirror draws, every stretch closed); `drawnBy` turns `maws` under a live surface (a reload to an installation without the declaration: the mirror draws while the asks go on and are answered with the engine's drawing); an ask's answer never comes (the surface row shows its placeholder as it does today; nothing else waits on it); a jump lands while its target's ask is in flight (the target is revealed and draws MAWS's own; the late answer is dropped).
- *The tests R3 names.* Each of a thought, a listing, a notice with no record of its own, a turn's line and a time separator is mounted **with no other row of its stretch mounted**, and is hidden or shown by its own ask: at the first mark's arrival (the invalidation re-asks it), at each of the mode's two switches, and across a plugin reload (the answers are forgotten and asked again).
- *The tests R6 names.* A jump to a target that is not yet mounted keeps its reveal until the row has been mounted and then left; a jump to a call inside an expanded run ends when the run's row leaves, and survives the run's id changing.

**What it does not touch.** `engine-surface/SurfaceRow.tsx` and `SurfaceTree.tsx`. The mirror's rule. The mod.

**What it proves.** A15 by unit, over check 1's fixtures. And: each row of §E's table; the reload rows of §G; the action's notice; with `modDraws` true no element of `RecordFold` or `ViewSwitch` in the document; with the lane off and the mod drawing, no turn fold once a message exists.

### M6 — The second pull request's scenes, the cross-build scenes, the record's second line, and its acceptance run

**What it touches.** `e2e/widgets.spec.ts` ("Version 8" becomes 9); `e2e/to-human.spec.ts` (the literal `'8'` becomes the name of the number a mirrored launch carries); `e2e/transcript.spec.ts` (the R3 `ToolGroup` case states the full site); `e2e/to-human-live.spec.ts`, rewritten as the trial; `e2e/cross-build.spec.ts`, two scenes (§H); the record's second line, the dated line where the owner channel's state is defined, and the coverage table's row in `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md`.

**What it does not touch.** Product code, unless a scene shows a defect. `package.json`'s scripts.

**What it proves.** It writes the e2e halves of A15 and of §H; by its own run, typecheck, lint, the gate's script tests and the whole unit suite.

### P — The mod's pull request

Not a MAWS milestone: a branch in a worktree of the doperpowers repository, holding exactly Interfaces §I, with the mod's own suite green. It is prepared before Step 0 (check 1 runs against it), opened by the architect after check 1, and merged by the owner whenever they choose. Nothing in MAWS reads it but the trial.

### The record (UC-10)

| pull request | reversed | where it stands | the dated sentence |
|---|---|---|---|
| the first | O-30, O-06 | `docs/doperpowers/plans/2026-10-08-p2-c-to-human.md`, Design §7 and §8, and its parent's Decision Log 19 | "2026-11 (UX wave, U2): the report folds by the to-human mod's per-stretch rule, applied by MAWS on every route, and the control at the top is removed; from U2's second pull request the mod itself draws it where it can." |
| the second | O-13 | `docs/doperpowers/evidence/p4/ux-wave/ux-directions.md` (the owner's ruling of 2026-10-24, "MAWS keeps the advertisement unchanged"), and the P2-C document's Design §3 | "2026-11 (UX wave, U2): MAWS advertises 9 at a launch whose view the mod draws, and 8 where MAWS draws it. From 9 the mod's view draws on MAWS's surfaces; below 9 it steps aside. The message tool's rule (8 and up) is unchanged." |

The first also adds tracker rows in `docs/tech-debt-tracker.md` for the divider's unread `toolCalls` (decision 13), the lane of a session on another machine, the desk web app's bar, and "the record line's summary in MAWS", owned by the second pull request (the owner's answer to card 1). The second adds a dated line where the owner channel's state is defined (the P2-C document, X18) for `drawnBy`, the wire minor's own comment in `wire.ts`, and tracker rows for §E's known differences. The register's rows and the board tickets (#608, #332) are the architect's at each landing.

## Concrete Steps

`vm` stands for the build brief's helper with the pull request's branch (`vmcheck.sh <branch> -- '<command>'`): it runs its command on the build VM in a checkout of the pushed head and exits with the command's status. Never pipe it into `tail` or `head` without `set -o pipefail`. The VM is shared with a landing in build: a slow or timed-out check is read against its load first. Every command there runs under `timeout`.

1. **Base** (before each milestone and once more before each hand-back). Merge, never rebase, never force-push:

       git fetch origin master && git merge origin/master
       git grep -n "export function GroupRow" origin/master -- src/renderer/src/transcript/view/rows/Group.tsx
       git grep -n "revealed" origin/master -- src/renderer/src/transcript/model/reduce.ts
       git grep -n "PluginBand" origin/master -- src/renderer/src/composer/Composer.tsx
       git grep -n "selectWaitingByCall" origin/master -- src/renderer/src/stores/attention.ts
       git diff --stat origin/master -- src/renderer/src/transcript/index.ts src/renderer/src/transcript/index.test.ts

   The first four must answer; the last prints nothing. Then read "What is assumed of landings in flight" against what the merge brought. A row kind the merge added fails the typecheck of `mirror.ts` until it is classed (§B). Before M4 also: `git grep -n "mirrorRows" origin/master -- src/renderer/src/owner/view/mirror.ts` answers (the first pull request is on master).

2. **Checks, per milestone**, after `git push`:

       vm 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # M1, M2, M5
       vm 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'    # M4, and M2's and M5's shared files
       vm 'timeout 600 pnpm exec eslint <the paths changed>'
       vm 'timeout 900 pnpm exec vitest run <the folders of the milestone> test/support/tokens-guard.test.ts'

   The folders: M1 and M2, `src/renderer/src/owner src/renderer/src/stores src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/attention src/renderer/src/session src/renderer/src/composer src/renderer/src/widgets src/renderer/src/keymap src/shared/keymap apps/desk-web/src/views/project apps/desk-web/src/depth`; M4, `src/shared/owner src/shared/mods src/shared/ipc src/shared/machine src/services/owner src/services/sessions src/services/index src/engine-host`; M5, `src/renderer/src/transcript src/renderer/src/engine-surface src/renderer/src/owner src/renderer/src/stores src/shared/owner src/shared/engine`. Expect `Test Files  N passed` and no failure. The set that fails on master too is the build brief's list.

3. **The wire's files** (M4, and again after a merge that moved `WIRE_MINOR`). Read `WIRE_MINOR` in `src/shared/ipc/wire.ts` after the merge (46 at this document's base), take the next number, and add to its comment "the UX wave, U2b: the owner channel lane's drawnBy, session.ui.renderSite (N)". Make the two generated files on the VM and bring them back as a patch, by U2a's Concrete Steps 3 with this branch's name. Expect a patch that touches those two files, changes the two `ownerChannel` entries, adds the one command and the minor, and removes nothing. If `wire.test.ts` says "breaking change", a schema was narrowed or a closed set gained a member: stop and report. Then, because a command's and an event's schema changed: `vm 'timeout 600 pnpm exec vitest run src/shared/machine'`.

4. **The derivation budget, before and after** (before M1's first commit and at M3's head; a relative reading):

       vm 'timeout 600 env MAWS_PERF=1 pnpm exec vitest run src/renderer/src/transcript/model/perf.test.ts'

   Write both printed lines into Surprises & Discoveries, and M1's new case's line (a lane-on session of 500 turns with a message in each, mirrored). If the head reads more than a fifth above the base, stop and report.

5. **Check 1's fixtures** (M5). They are on master or on the branch before M5 starts, under `spikes/protocol-probe/fixtures/uxwave/`. `mod-route.test.tsx` loads them by name; it invents no answer. If a recorded file is added or edited on the branch: `vm 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`.

6. **Acceptance** (M3 for the first pull request, M6 for the second). The suites of "Acceptance" for that pull request by name; then

       vm 'timeout 1200 pnpm typecheck'
       vm 'timeout 900 pnpm exec eslint <every folder the pull request changed> e2e apps/desk-web/e2e'
       vm 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vm 'timeout 2400 pnpm test'

   and at M3 on the MacBook, each printing nothing:

       git grep -n '"To you"' -- src apps
       git grep -n "owner_record\|OwnerRecordRow\|ReportBar\|reportOpenTurns" -- src e2e
       git grep -n "Working record ·" -- src/renderer e2e

   The desk web app keeps its own "Working record · …" label in its conversation view and the scenes that read it; they are outside these paths and stay. At M6: `git grep -n "MOD_DRAWS_FROM\|MOD_FAILED" -- src` prints nothing (no constant names a release of the mod).

7. **Stop and hand back** with: the head's sha; each command above with its result; what was not verified; the decisions made beyond this document; the scenes written and not run; any `gitleaks.toml` entry. The executor runs no `scripts/ci-gate.sh`, opens no pull request, and starts no Electron and no engine.

## Interfaces and Dependencies

§A to §E are what the milestones produce; §F to §H are what crosses builds and installations; §I is the mod's pull request; §J to §L are the other landings and the desk web app.

### §A. Who draws (M4; the cutover's switch in M5)

In `src/shared/owner/contract.ts`:

    export const TO_HUMAN_CONTRACT_VERSION = 9;                  // advertised where the mod draws MAWS's view
    export const TO_HUMAN_MIRROR_VERSION = 8;                    // advertised where MAWS draws it: every installation steps aside and registers its tool
    export const TO_HUMAN_MOD_ROUTE: boolean = false;            // M5's cutover turns it on; while it is off no launch advertises 9
    export const TO_HUMAN_DECLARATION = 'maws-surface.json';     // at an installation's root (§I)

In `src/shared/owner/draws.ts` (new, pure, no I/O):

    export type DrawnBy = 'mod' | 'maws';
    export type Advertisement = 9 | 8 | null;                    // null: the launch carried none (the lane off, or a style that carries no tool)
    export function declaresDrawing(file: unknown, at: number): boolean;
    export function advertisementFor(lane: boolean, installations: readonly { declares: boolean }[]): Advertisement;
    export interface Reservation { launchId: string | null; number: Advertisement; plugin: boolean; at: string }
    export type Known = { known: true; number: Advertisement; plugin: boolean | null } | { known: false };
    export function advertisementOf(row: { launchId: string | null; desired: ContractSource | null; advertised: Reservation | null } | null, live: string): Known;
    export function drawnBy(advertisement: Known, status: { launchId: string; process: EngineSessionStatus['process'] } | null, loaded: { present: boolean; declares: boolean } | null): DrawnBy;

`declaresDrawing`: the parsed file is an object whose `toHumanView.drawsFrom` is an integer not above `at`; a missing, unreadable or otherwise shaped file does not declare. `advertisementFor`: nothing when the lane carries nothing; 9 when the switch is on, the list is not empty and every installation declares; else 8. `Reservation.plugin` is whether the launch found an applicable, enabled installation of the mod whose hooks load. `row` is null when the session has no owner row or the row cannot be read.

**`advertisementOf`,** for the session's running launch `live`:

| the row | read as |
|---|---|
| its reservation is bound to `live` | the reservation's number and `plugin` |
| its reservation is not bound, and `live` is not the row's `launch_id` | the reservation's: the host accepted the launch and the bind was never written |
| `live` is the row's `launch_id`, and the reservation is absent, unbound or bound to another launch | an earlier build's launch, or one made before any reservation: nothing when `desired` is `off`, else 8; `plugin` unknown |
| anything else, or no row | not known |

**`drawnBy`** (`loaded` is null until this launch reported its plugins; `present` is a loaded plugin named `to-human`; `declares` is the declaration read at that plugin's reported `path`):

| the advertisement | the engine | drawn by |
|---|---|---|
| any | no status, another launch's, or `process` is `exiting` or `exited` | `maws` (at rest) |
| 8 | live | `maws` |
| 9 | live, plugins not yet reported | `mod` |
| 9 | reported, the mod loaded and declaring | `mod` |
| 9 | reported, the mod loaded without the declaration, or not loaded | `maws` |
| none | live, not yet reported | `mod` when the reservation's `plugin` is true; `maws` when it is false or unknown |
| none | reported, the mod loaded | `mod`: it draws as in a terminal once the session holds a message |
| none | reported, not loaded | `maws`: nobody draws a view |
| not known | live, the mod loaded or not yet reported | `mod` (decision 4) |
| not known | live, reported, not loaded | `maws` |

`OwnerChannelStateSchema.lane` gains `drawnBy: z.enum(['mod', 'maws']).optional()`. This build always sends it; absent reads as `maws`. `ResolvedStyle` gains `toHuman: { paths: string[]; hooksLoad: boolean }`, the install paths `pluginInstallPaths` accepts for the `to-human` plugin and whether no setting keeps its hooks from loading (it already computes both for `messageTool`). `OwnerChannelFlags` carries the advertisement in place of `laneOn`. The store gains `reserveLaunch(appSessionId, reservation)`, written before the send, and `recordLaunch` binds the reservation's `launchId`; both write one added column:

    { table: 'owner_channel_sessions', column: 'advertised', definition: 'TEXT' }   // ADDED_COLUMNS, src/services/index/migrations.ts; the Reservation as JSON

A value that does not parse is no reservation.

**What a window draws under each published value.** `maws`: the mirror while the lane is on and the session holds a message. `mod`, with the session's surface attached in this window: no mirror and no switch; no turn fold once the session holds a message; every ask as §E gives it. `mod` with no surface attached in this window (a session at rest is never published `mod`; a session on another machine publishes nothing here): the mirror. Under decision 4's reading of an advertisement that is not known, a launch that in fact carried 8 shows no fold until the row can be read again or the session's next launch: every row in sight, each message drawn as a message.

### §B. The mirror's rule (M1)

Every clause carries, in a comment, the function of the mod it ports and the release it was read at (0.8.2; lines of `to-human/hooks/mods/to-human.tsx`). The mod's row kinds are `user`, `marked`, `mixed` and `record` (`RowKind`, line 319); here they are `stays`, `stays`, `mixed` and `folds`.

| MAWS's row | class | ports |
|---|---|---|
| `user` (a prompt, a steer, one still waiting in the queue's tail) | stays | `promptRow` (400 to 417): an origin that is not in `DELIVERED` (329) is the person's |
| `bash` (the person's own `!` command) | stays | the person's input; the mod is never asked. *Decided here* |
| `assistant_text` whose words are all inside messages | stays | `AssistantMessage`, `marked`: `spanRows` (1411) |
| `assistant_text` with a message and words outside it | mixed | `mixed`: the messages stay, its own words open with the stretch after it (`runStart`, 430) |
| `assistant_text` with no message (commentary, an unmarked answer, a reply an interrupt cut) | folds | `record` |
| `to_human` (a message-tool call, waiting for its result or sent) | stays | `isRead` (605) for the message tool; drawn by `spanRows` |
| a message-tool call that sent nothing (refused, failed, interrupted, empty): it is a `cell` | folds | `isUnsent` (623) |
| `group`, `cell` | folds | `recordRow` (1187) at `ToolGroup`, `ToolUse` and `ToolResult` |
| `thinking` | folds | the engine draws a thought's text through `AssistantMessage` with `isSummary` ("Today"), where the mod reads a text with no message: `record`. *Decided here* for a thought MAWS alone draws (card 5) |
| `subagent` | stays | `isSpawn` (598): `Agent` and `Workflow` |
| `question`, `ask`, `plan`, `request_slot`, waiting or answered | stays | `isRead` for `AskUserQuestion` and the ask tools; UC-3 for a waiting form |
| `agent_message` (to or from a subagent, between sessions, one the agent sent) | folds | `promptRow`: a row with `from` is `record`; a sent message is a tool call |
| `notice`, class `answer`, where no `question` or `ask` row among the rows with its `toolUseId` carries its receipt (a `question` with answers, an `ask` answered or cancelled) | stays | `ASK_DELIVERY` (378): the person's answer is `user` |
| `notice`, class `answer`, where such a row carries the receipt | folds | R13: the mod leaves the question's call in view (`isRead`, 605), so row and delivery would state one answer twice |
| `notice`, class `task`, outcome `failed`, whose `toolUseId` is the call of a `subagent` row among the rows | stays | `promptRow`'s first clause: a failed task of a spawn the transcript shows is `marked` |
| any other `notice` (a task's end, a scheduled trigger, the bridge's wake) | folds | `promptRow`: a row with `task` is `record`; `DELIVERED` |
| `error`, at every severity | stays | `isApiError` (616): an API error is `marked` and ends a run; a retry line and a plugin's notice have no site, and a row the mod is never asked about stays. *Decided here* (card 3) |
| `boundary`, `gap`, `local_command`, `artifact`, `delivery`, `side_thread` | stays | the child's table: rows MAWS draws that the mod is never asked about |
| `agent_list`, `browser_action` | folds | tool calls: `recordRow` at `ToolUse`. *Decided here* (card 3) |
| `browser_activity` (no call of this session behind it) | stays | never asked |
| `time`, `divider` | member of no stretch | decision 11 |
| `receipt` | draws nothing today | |
| `record_fold` | the mirror's own row | |

The class is one exhaustive `switch` over `Row['kind']` with no default branch.

**In force,** where MAWS draws: the store's `noTurnFold` is set (decision 8), which is: the lane is on and the rows, those handed in from outside the store included, hold a row classed `stays` or `mixed` that is an `assistant_text` or a `to_human`, a live text block with an open mark included (`isFolding`, 1512; `hasSeenMark` set at 1713 to 1718 and 1801 to 1804). **A stretch** is a maximal run of consecutive `folds` rows, the rows of no stretch between them included, headed by the `mixed` row directly before it if there is one; a `mixed` row with nothing folding after it is a stretch of its own (`runStart`, `runEnd`, 430 to 470). **Its key** is decision 9's. **Closed,** it draws its head with only its messages in sight, then one `record_fold` row reading `› working record` in the place of its first folding row. **Open,** it draws its head whole and every row as the plain transcript draws it, then one `record_fold` row reading `‹ fold to report` after its last row. All stretches start closed. In the full transcript nothing is folded.

### §C. The mirror's function and state (M1)

In `src/renderer/src/owner/view/mirror.ts`:

    export type ViewClass = 'stays' | 'folds' | 'mixed' | 'none';
    export const reportViewOf: (ui: Pick<TranscriptUi, 'ownerLane' | 'view'> | undefined) => boolean;        // moved, unchanged
    export function liveMarkedRowIds(state: TranscriptState | undefined): string;                              // moved, unchanged
    export function holdsMessage(rows: readonly Row[], liveMarked?: string): boolean;
    export function stretchKey(row: Row): string;
    export interface Stretch { key: string; head: Row | null; rows: readonly Row[]; turns: ReadonlySet<TurnId> }
    export function stretchesOf(rows: readonly Row[], liveMarked?: string): Stretch[];
    export function stretchHolding(rows: readonly Row[], id: RowId | CellId, liveMarked?: string): string | null;
    export function mirrorRows(rows: readonly Row[], ui: Pick<TranscriptUi, 'openStretches'>, liveMarked?: string): Row[];

`mirrorRows` is pure and is memoised by its callers on the rows' identity, the open set and the live marks. Its callers apply it only while `ui.noTurnFold` is set, the view is the report and `ui.modDraws` is not set; it scans for no message itself.

Rows (`transcript/model/rows.ts`): `{ kind: 'record_fold'; stretch: string; open: boolean }` replaces `owner_record`, its id `rowId.recordFold(stretch, open)`; `assistant_text` gains `reportOnly?: true`, set by the mirror alone on a closed stretch's head.

View state (`TranscriptUi`): `openStretches: Set<string>` replaces `reportOpenTurns`; `noTurnFold?: boolean`; `tailMessage?: boolean` (what `Transcript` reports of the rows handed in from outside); `modDraws?: boolean` (M5). `ownerLane`, `view` and `revealed` stay. Store actions: `toggleStretch(key, stretch)` replaces `toggleReportRecord`; `setToHumanView(key, { lane, tailMessage, modDraws? })` replaces `setOwnerLane` and recomputes `noTurnFold` in the same update; `setView` stays; `clearRevealed(key, id)` (M5). `drawnRows(key, tail, atRest)` and `useDrawnRowCount(key, atRest)` keep their names and signatures.

### §D. The drawing and the words (M1 for the record's two lines, M2 for the rest)

`src/renderer/src/owner/view/copy.ts`, the only place these strings are written:

| what | text |
|---|---|
| a message's label | `● message`; a later message of the same text block, `message`; while it streams, the label and ` …` |
| the record line | `› working record` |
| the line under an opened record | `‹ fold to report` |
| the switch, in the report | `to-human view · full transcript ›` |
| the switch, in the full transcript | `to-human view · report only ›` |
| kept for the desk web app's bar | `Session view`, `Report`, `Transcript` |
| kept for the mods list | the style-mismatch sentence, as it reads today |
| the palette's command (M2) | `Mark all read` |
| the notice when "Toggle report and transcript" is used where the mod draws (M5) | `The to-human mod draws this session's view. Use its switch above the composer.` |

They are `STYLE`, `UNFOLD`, `FOLD` (555 to 564), `'fold to report'` (1218) and the band's caption and labels (1957 to 1963) of the mod. Components: `MessageView` (`owner/view/Message.tsx`: the label in `var(--accent)` at weight 600, the body under it indented two columns, in the normal text colour, as Markdown); `RecordFold` (`owner/view/RecordFold.tsx`: one button, muted, full contrast on hover, at the transcript's ordinary row spacing with no extra row above it and no bullet before it (ruling 3, items ii and iii); `aria-expanded`; the lower line indented two columns); `ViewSwitch` (`owner/view/Switch.tsx`: the caption muted, the label a button, inside the frame `PluginBand` draws; its exported `toggleView` is the handler of `transcript.toggleReport`).

### §E. Where the mod draws (M5; the command in M4)

`modDraws` is true for a tab when the lane's published `drawnBy` is `mod` and the session's surface is attached in this window (`useSurfaceAttached`). A session on another machine never has it: its site asks do not cross the machine link.

**The rule (R3).** Whether a row is in sight where the mod draws comes from an ask that row holds while it is mounted. An invalidation re-asks every mounted ask, so a first mark, a press of the mod's switch and a reload each reach every mounted row by itself; a row that is not mounted is asked when it mounts.

| MAWS's row | the site it asks | with | new here |
|---|---|---|---|
| a run (`group`) | `ToolGroup`, as a full site | as today; `groupInput` unchanged (a run that is a jump's target, holds one, or holds a waiting call asks nothing and is drawn by MAWS) | `drawingOnly` goes: an answer with no engine slot replaces the run, one that keeps it draws MAWS's `GroupRow` there |
| a message-tool call (`to_human`) | `ToolUse` | the call's own props, as a sent message's are built (`sentInput`); MAWS's `MessageView` is its own drawing. No `ToolResult` is asked | yes |
| a marked text, a prompt, a single call, a command's output, a question | as today | `MessageView` as a marked text's own drawing | |
| a thought (`thinking`; outside a run it has text or is still streaming, and one with no text yet asks nothing and is drawn) | `AssistantMessage` | `{ text, isFirstOfReply: false, isSummary: true }`, the engine's own props for a thought; the id is the thought's message uuid qualified by its block, as a text block's is | yes |
| an agent listing, a browser action | `ToolUse` | the call's props | yes |
| an arrival or a notice for which U3a's `engineUserProps` gives props | `UserMessage` | as today | |
| an arrival or a notice for which it gives none (a scheduled trigger, the bridge's wake, a task's end the host made, a message line with no envelope) | `UserMessage` | the row's own line as `text`, and the engine's origin for its class: a task's end `task-notification` with `task` from the row's `taskId`, `outcome` and `toolUseId`; a scheduled trigger `scheduled-trigger`; the wake `plugin` (named `sminos`); a message between sessions or from a subagent `peer` with `from` | yes: U3a's ask widened |
| an answer's notice whose question's row carries the receipt (§B) | `UserMessage` | its line as `text`, origin `plugin`: a delivery, which the mod folds | yes (R13). One whose question's row carries no receipt asks nothing and stays |
| a closed turn's line | `TurnDuration`, through `session.ui.renderSite` | `{ word, durationMs, isExpanded: true }`, the engine's props for its closing line; no chevron | yes |
| the running turn's line | nothing | MAWS draws it: it is what shows that the session works | |
| a time separator | none of its own: it keeps alive the ask of the row after it (a probe at that row's own address, so one ask) | drawn while that answer leaves anything in sight: MAWS's drawing, or a drawing of the mod's with ink | yes |
| an error, a boundary, a gap, a subagent's row, `ask`, `plan`, `request_slot`, an artifact's, a delivered file's and a side thread's row, the person's `!` command, standalone browser activity | nothing | they stay on both routes | |

**An ask's id where the transcript holds no record of the row.** The mod places a row by finding its id in the transcript file. A turn's line and a notice the host made have none (a headless session writes no `turn_duration` row). Their id is `<anchor>~<tag>`: `anchor` is the id under which the nearest row before it asks and which the file holds (a message's uuid, a call's id); `tag` is `turn` for a turn's line and the row's own id otherwise. The mod's pull request places such an ask directly after its anchor (§I). An id is at most 256 characters on MAWS's wire.

**The command.** `session.ui.renderSite` has `session.ui.render`'s input and output, but for its `component`, a string of 1 to 64 characters that the engine host checks against its own list (`TurnDuration` at this landing). It exists because `session.ui.render` names its sites in a closed set on the wire, and an added member there is a wire major. An engine host of an earlier build answers `unknown_command`; the row then draws MAWS's own, always.

**If check 1 answers no** for a site (questions C), that row takes the ruling's second means, and only that row: while mounted it keeps alive, by probes at their own addresses, the asks of the first asked row of each stretch it depends on (a turn's line: of each stretch of its turn), and is drawn while one of them shows MAWS's drawing; and, for a row whose stretch has no asked row, one ask mounted once per transcript reads the mod's mode from the band's answer, where the mod's pull request then marks it with a keyed node (`to-human-view:report` or `to-human-view:full`). If neither can be built for a row, that comes back to the architect as a card for the owner before M5: no tracker row narrows "the full transcript folds nothing".

**The reveal's end (R6).** `Transcript.tsx` keeps, for the current jump, whether its containing row has been in the list's mounted range since that jump; the containing row is found by locating the revealed id among the drawn rows at each change of them (a cell's is the run that holds it). When it has been in the range and no longer is, `clearRevealed` is called. A jump whose row has not yet mounted keeps its reveal.

**Known differences between the mod's view and the mirror,** each a tracker row and a line of the trial's reading: fold states are not carried when a session starts or stops running; a jump opens the record where MAWS draws and reveals the row where the mod does; the mod looks for a session's first message only since the last compaction at its start; the record line's words where a later release of the mod summarises (card 1); in a session whose engine host is of an earlier build, a turn's line is always drawn.

### §F. What is stored and sent, against both earlier builds

`git show f1852de3a:<path>` and `git show 2c7044231:<path>` give the same text, and the same as this document's base, for the three files this table rests on: `src/shared/owner/state.ts`, `src/services/owner/store.ts` and `src/shared/ipc/tolerant.ts`. All of it is the second pull request's; the first stores and sends nothing new.

| what | an earlier build with this build's value | this build with an earlier build's | this build, then an earlier one, then this build |
|---|---|---|---|
| `lane.drawnBy`, on `ownerChannel.state` and `ownerChannel.changed` (the wire; an optional key) | its main reads the supervisor's output with the tolerant reader, drops the key and keeps the state; its renderer draws its own report | absent: `maws` | nothing kept |
| the command `session.ui.renderSite` (the wire; a new command, in the same minor) | never sends it; as a host, answers `unknown_command` | this build's window on an earlier host: a turn's line draws MAWS's own | nothing kept |
| `owner_channel_sessions.advertised` (the index; an added nullable column, `user_version` unmoved) | opens the index; reads the row with `SELECT *` by column name and ignores it; its `recordLaunch` updates the columns it names and leaves it | null: the advertisement is read from the row's `desired` (§A) | the earlier build's launch changed `launch_id`; a reservation bound to another launch, or unbound while `launch_id` is the running launch's, is not read as that launch's |
| `MAWS_NATIVE_TO_HUMAN=9` in a launch's settings env (the engine's process, not MAWS's storage) | a session launched at 9 keeps it until it ends; an earlier window draws its own report beside whatever the mod draws (§H, row 5) | its launches carry 8, or nothing with the lane off | this build's next launch decides again |
| the mods list's version (`mods.list`, an integer) | reads 9 where it read 8 | reads 8 | |
| either settings file, any layout key | untouched | | |

`ui.view`, the open stretches and the revealed row are the tab's, in memory: nothing of the view is stored.

**Two cross-build runs are owed by the second pull request,** one with each earlier build as the exact peer (`--peer-exact f1852de3a`, `--peer-exact 2c7044231`), over §H's two scenes. The row added to the coverage table (U13a's M5):

| stored | the peer reads this build's value, and writes on | this build reads the peer's value |
|---|---|---|
| `owner_channel_sessions.advertised` | *(to-human, to the peer)*: the peer opens the index, lists the session, launches it and records its launch | *(to-human, from the peer)*; the return of *(to-human, to the peer)*: the reservation no longer counts |

### §G. The matrix: no mod, a mod without the declaration, a mod with it; at nothing, at 8 and at 9

One table an executor turns into cases (`src/shared/owner/draws.test.ts`, `src/services/owner/launch.test.ts`, `transcript/surface/mod-route.test.tsx`). "Older" is an installation without the declaration, 0.8.2 and every release before the mod's pull request among them; "newer" is one with it. A version plays no part: a higher version without the declaration is older.

| the lane | the mod, as the launch finds it | the launch advertises | the mod's view | its message tool | `drawnBy` | what the session shows |
|---|---|---|---|---|---|---|
| off, or a style that carries no tool | no applicable installation, or its hooks do not load | nothing | — | — | `maws` | MAWS's transcript as today; a recorded message reads `● message` |
| off, or a style that carries no tool | an applicable installation whose hooks load, older or newer | nothing | draws, as in a terminal, once the session holds a message | not registered (a headless launch with no advertisement) | `mod` | the mod's view; MAWS's turn fold stands aside; no mirror, no switch |
| on | older | 8 | steps aside | registers | `maws` | the mirror |
| on | newer | 9 | draws | registers | `mod` | the mod's view |
| on | two installations apply, one older | 8 | steps aside | registers | `maws` | the mirror |

Under a launch that has advertised, after a reload:

| the launch advertised | the installation now loaded | the mod's view | `drawnBy` | the view |
|---|---|---|---|---|
| 8 | any, or none | steps aside | `maws` | the mirror |
| 9 | newer | draws | `mod` | the mod's |
| 9 | older | steps aside (any non-empty value) | `maws` | the mirror |
| 9 | none | — | `maws` | the mirror |
| nothing | older or newer | draws | `mod` | the mod's |
| nothing | none | — | `maws` | MAWS's transcript |

Not a session MAWS runs: a terminal session, a session on another machine and a session at rest are the mirror in every row where the lane is on.

### §H. The cutover

| | the situation | what is drawn | proved by |
|---|---|---|---|
| 1 | a session running across the update: launched by an earlier build at 8, its engine still running, this build's window and daemon on it | the mirror. The row holds no reservation and its `launch_id` is the running launch's, so the advertisement is read from `desired`: 8, `maws` | *(to-human, from the peer)*, with each peer |
| 2 | a session resumed from a transcript an earlier build's session wrote | at rest, the mirror, from the file's rows (the file is the engine's and does not change with MAWS's build; the older marks and both message tools read as messages). Its resume is this build's launch and is decided by §A | `lane-a/view-routes.test.ts` over a recorded file; `owner/view/mirror.test.ts`'s cases for the older marks and `mcp__maws__message` |
| 3 | this build's window on an earlier build's daemon | the mirror: `drawnBy` is absent, and that daemon's lane-on launches advertise 8 | *(to-human, from the peer)* |
| 4 | an earlier build's window on this build's daemon, a session launched at 8 | that build's own report, once: the key is dropped, the mod steps aside | *(to-human, to the peer)*: nothing refused, the key among the dropped, the peer's bar and record row drawn |
| 5 | the same, a session this build launched at 9 with a declaring installation (or: going back while such a session runs) | both drawings, until that session's next launch, which the earlier build makes at 8 (point 6, card 2) | cannot be staged with a replayed engine: one look by the architect on the trial's Mac |

The two scenes of `e2e/cross-build.spec.ts` (the second pull request), each skipped only by the group's own conditions (a skipped scene is not evidence): *(to-human, from the peer)*, in which the peer keeps a lane-on session whose recorded transcript holds a message and work, this build attaches, and the transcript shows the record line and the switch, no bar, and no refusal in either log; *(to-human, to the peer)*, in which this build launches such a session with a scratch config home whose style and installation are written by `test/support/to-human-plugin.ts`, the installation carrying the declaration (so the launch's spawn row carries 9 and the index holds its bound reservation), quits, the peer opens the profile, draws its bar and its record row, launches the session again, quits, and this build reads the session back with `drawnBy` `maws`.

### §I. The mod's pull request (doperpowers; read at the installed 0.8.2)

By ruling R1 it holds more than the one gate. Exactly this, and nothing else.

1. **The gate.** `to-human/hooks/mods/to-human.tsx`, `native()` (lines 1450 to 1455). Today it is true when the value is non-empty and the surface is not the terminal. After, it is true when the value is non-empty **and is not a number of 9 or more**, and the surface is not the terminal:

       const MAWS_DRAWS_FROM = 9
       let maws: Promise<boolean> | undefined
       const native = async ($: EngineInterface, e: object) =>
         (await (maws ??= $.env.get('MAWS_NATIVE_TO_HUMAN').then(
           (value) => value !== undefined && value !== '' && !(Number(value) >= MAWS_DRAWS_FROM),
         ))) &&
         (!('surface' in e) || e.surface !== 'terminal')

   So unset or empty draws, as today; a number below 9 steps aside; 9 or more draws; anything that is no number steps aside. Its eleven callers are unchanged in place: `command.run` for `/to-human-dump` (1616); `ui.render` for `UserMessage` (1643), `TurnDuration` (1675), `AssistantMessage` (1701), `ToolUse` (1782), `ToolGroup` (1840), `ToolProgress` (1888), `ToolResult` (1921) and `AbovePrompt` (1942); `ui.press` for `to-human-toggle` (1982) and `to-human-mode` (1998).
2. **The declaration.** A file at the plugin's root, `to-human/maws-surface.json`, read by MAWS without running the plugin:

       { "toHumanView": { "drawsFrom": 9 } }

   It says: this installation's view draws on a client's surface when the client advertises this number or more. It ships in the same commit as the gate and only with an implementation check 1 found able to hide a run. A test of the mod reads the file and the gate's constant and fails when they differ.
3. **Nothing in MAWS reads the version.** It moves as the repository's own rule says (`to-human/.claude-plugin/plugin.json` and the to-human entry of `.claude-plugin/marketplace.json`: the next after the main branch's).
4. **A place for an ask with no record.** Where the view finds a row's place (`slotOf`, `see`): a request id of the form `<anchor>~<rest>` is placed directly after the row `<anchor>`, before whatever followed it. Nothing else about such a row changes: a `UserMessage` under such an id is classed by `promptRow` as any other.
5. **MAWS's turn line.** In the `TurnDuration` hook, for a request id that ends `~turn`: when the view is not folding, `next(e)`; when it folds, `next(e)` while a run that begins at or after its place and before the next row of kind `user` is unfolded (the run it stands in included), else an empty `Box`. An ask under the transcript's own row id keeps today's rule.
6. **A thought needs no change,** and gets a test: the `AssistantMessage` hook reads a summary block (`isSummary: true`) as a text with no message, a `record` row, so it folds and unfolds with its run and is kept in the full transcript.
7. **`to-human/CLAUDE.md`:** the clause that says the view reads "any non-empty value" is rewritten (the notifier and the stream hook read any non-empty value; the view steps aside for a non-empty value that is not a number of 9 or more and draws from 9); one sentence states that rule where the file describes the view; one names the declaration and what a client reads from it.
8. **Tests.** `to-human/tests/mods/to-human-native.test.ts` keeps its case (every gated hook passes through off the terminal at `'1'`, the terminal still draws, one read of the setting, the inventory of ungated hooks) and gains: at `'8'` and at `'native'`, the same pass-through on `desktop`, `vscode`, `mobile` and no surface; at `'9'` and `'10'`, on each surface that is not the terminal, a marked `AssistantMessage` draws the report and not `next`'s result, a record row folds, `AbovePrompt` draws the band after a mark, and the two presses act. New cases for items 2, 4, 5 and 6: an ask under `<anchor>~x` folds with the run its anchor is in or begins; a `~turn` ask is hidden in a folded report, shown with a record of its turn open, shown in the full transcript; each of them asked alone, with no other row of its run asked. `to-human/tests/mods/live-maws-check.py` gains a second run at `MAWS_NATIVE_TO_HUMAN=9`, with the same five expectations.

Untouched, and said in the body: `message.tsx` (`getsTool`, the tool from 8 in a headless session), `notify.tsx`, `folds.tsx` (quiet under any non-empty value, so the record line reads `working record` at 9), `reminder.tsx`, `edits.tsx` (the terminal only, by its own test), the doperpowers plugin's `hooks/to-human-stream.sh`, the sminos ask mod, and `hooks/hooks.json`, whose description of the tool ("not under MAWS") has been stale since 8.

Before it opens: `to-human/tests/mods/run.sh` passes, and check 1 has recorded the answers. After it merges, an earlier MAWS build is unchanged (both advertise 8), and so is a MAWS at the first pull request.

### §J. Consumed from siblings, by name

- **U2a** (on master): the `group` row (`summary`, `counts`, `cells`, `expanded`) and the `divider` row's `caption`, `parts`, `counts`; `GroupRow`; `groupInput` with its `isExpanded` and `revealed` rule; `ui.expandedGroups`, `toggleGroup`; `waitingLabel`; its two rules for a fold over its rows: a waiting request's slot stands directly after the run that holds its call, and a run's id does not change while it grows (decision 9 covers the two changes of a row's id that rule does not: one call becoming a run, and a merged read).
- **U3a** (on master): `ui.revealed`, written by `jumpTo`, the cell jump and `jumpToMessage`; the row kinds `agent_message` and `notice` with `class`, `outcome`, `toolUseId`; the asks `arrivalInput`, `sentInput`, `noticeFollows`; `carrier-drawing.ts` as the pattern of §E.
- **U4a** (on master): `composer/Composer.tsx` as it mounts `PluginBand` once the session has started; `withQueueTail` and its tail rows, which are `user` rows and stay.
- **U1a** (on master): `selectWaitingByCall`; UC-3 as amended (a row that holds a waiting request is never inside a fold and asks no site while it waits).
- **The engine host**: `EngineSessionStatus` (`launchId`, `process`, `plugins`, `pluginsObservedAt`, `uiSurface`), and `useSurfaceAttached`.

### §K. Files other children own (UC-8)

| file | owner | the insertion | pull request |
|---|---|---|---|
| `src/renderer/src/composer/Composer.tsx` | U4 | one line: `ViewSwitch` directly after `PluginBand`, under the same condition (the session has started) | first |
| `src/renderer/src/session/SessionPane.tsx` | U1 | the bar's mount and import leave; one line, `ViewSwitch` directly above `HolderNotice` (permitted, R8) | first |
| `src/shared/keymap/actions.ts` | U6 | one row: `'transcript.markAllRead'`, title "Mark all read", no chord, the renderer's sink, no menu, scope `app` (R9). Build F does not know the id, so by U6a's rule it takes no rebinding | first |
| `src/renderer/src/transcript/view/Transcript.tsx`, `TranscriptSlot.tsx` | U3 (UC-3) | the mirror in the place the projection is composed today; the flag's outside half; the new row's estimated height; in the slot, the lane's source. Second: `modDraws`, the mod route's composition, the reveal's end | both |
| `src/renderer/src/transcript/surface/Rows.tsx`, `adapters.ts` | U3's asks, U2's run | the run's site without `drawingOnly`; the surface rows and inputs of §E; U3a's arrival ask widened to the rows it gives no props for | second |
| `src/shared/engine/surface.ts`, `surface-rows.ts`, `src/renderer/src/engine-surface/site.ts`, `registry.ts` | no child | `TurnDuration`'s props and the second command's route; `isSummary` on `AssistantMessage`'s props | second |
| `src/shared/ipc/wire.ts` and the two generated files; `src/shared/ipc/schema/session.ts`, `names/session.ts`, `grades/session.ts`, `remote-unavailable.ts`; the engine host's handler; `src/shared/machine/address-paths.json` | no child | one minor: the optional key and the command `session.ui.renderSite` (permitted, R8, as R2 and R3 shape them) | second |
| `src/services/index/migrations.ts` | no child | one entry of `ADDED_COLUMNS` | second |
| `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md` | U13 | one row of the coverage table | second |
| `apps/desk-web/src/views/project/ReportToggle.tsx`, `apps/desk-web/src/depth/view/TranscriptPane.test.tsx` | the desk | two import paths; one test case (R5) | first |

### §L. The desk web app

Its session view mounts the renderer's `Transcript` with the lane on and counts rows through `drawnRows` (`apps/desk-web/src/depth/view/TranscriptPane.tsx`). So from its next deploy on, whoever makes it, it draws the mirror's rows and the message's new look. **Re-pointed:** the two imports of `ReportToggle.tsx`, from `owner/report/copy` and `owner/report/report.css` to `owner/view/copy` and `owner/view/view.css`, which keep the bar's three words and its classes (`owner-bar`, `owner-view-toggle`) for it. **Unchanged:** every other file under `apps/desk-web/src/`; its own bar, which still switches `ui.view`; its own "Working record · …" label in the conversation view; everything under its deploy. Nothing is deployed by this landing.

Its e2e scenes whose expectations change (group `e2e:desk-web`), all for the old record row or the label, none for the bar:

| spec | scene | what changes |
|---|---|---|
| `acceptance.spec.ts` | "G1: the report over the session's rows…" | the `owner-record:` rows and "Working record · N tool calls" become the record line, one per stretch |
| `session-view.spec.ts` | "the report: the marks and questions, one working record per marked turn…" | the same; its title's "per marked turn" becomes per stretch |
| `session-view.spec.ts` | "a turn no row ended draws at rest…" | `.owner-record` and its running dots become the record line and the running turn's line |
| `session-view.spec.ts` | the scene that excludes row ids by the pattern `owner-record` | the pattern names the new row's id |
| `phone.spec.ts` | "a session's channel on the phone is its session view…" | "Working record · 3 tool calls" becomes the record line |
| `phone.spec.ts` | "the running turn streams on the phone…" | the record row's dots become the running turn's line |
| `depth-info.spec.ts` | "a streaming message stays authored text until closed…" | the "To you" label read from the stylesheet becomes the label element's `● message` in the accent colour |
| `depth.spec.ts` | "older rows page in when the reader reaches the top…" | its anchor's exclusion of `owner-record:` rows names the new row's id |

The scenes that click the desk's own "Report" and "Transcript" buttons, and those that locate a message by `.owner-message-ink`, stand.

## Checks handed to the architect

No engine runs on the MacBook. Each check is a step with what it runs, where, with what, what it records, and what each outcome changes.

### Check 1 · what the mod answers on MAWS's surface (Step 0; before the mod's pull request opens and before M5)

- **What it runs.** A probe scenario under `spikes/protocol-probe/scenarios/` built on the existing mod-surface scenarios (`mods-surface-transcript-common.mjs`, `mods-surface-sitting.mjs`, `owner-mod-source.mjs`): it launches the engine as MAWS does (headless, stream-json both ways, the settings env carrying `MAWS_NATIVE_TO_HUMAN` or not), attaches as MAWS's surface (`desktop`, the client id MAWS uses), and sends the engine's own `ui_render` with the props MAWS would send. Two parts. *Resumed, no model call:* over a seeded transcript of invented text that holds a prompt, a thought with text, a tool run of three calls, an unmarked text, a message-tool call, a text with a message and words beside it, a subagent's message and a task notification, an asynchronous question's call with its delivered answer, and a final marked text. *Live, a few model calls on the smallest model:* one turn per advertisement, to see the tool registered in `system/init` and a real message call's row answered.
- **With which installations.** *Before:* a copy of the installed 0.8.2. *After:* P's checkout. Each installed into a scratch config home with the doperpowers plugin (for the style) and the sminos plugin (the mod's dependency), never the owner's.
- **Where.** A cloud VM or the Mac mini with engine `2.1.322` and model access; no Electron.
- **What it records.** Fixtures under `spikes/protocol-probe/fixtures/uxwave/`, named `u2b-mod-<none|8|9>-<before|after>.jsonl`, `u2b-mod-rows.jsonl` (questions C) and `u2b-mod-reload.jsonl`, each holding the asks and the answers' trees; a findings file `spikes/protocol-probe/findings-uxwave-U2b-mod-answers.txt`; their rows in `spikes/protocol-probe/fixtures.test.mjs`. The secrets scan (`node --test .github/scripts/maws-app-scan.test.mjs`) runs over them.
- **The questions, and what each answer changes.**

  | | the question | expected | if not |
  |---|---|---|---|
  | A1 | At 8, before and after: does every one of the six sites MAWS asks today keep the engine's drawing? | yes | after: P is wrong and is fixed before it opens. Nothing in MAWS changes |
  | A2 | At 9 after: is the message call's answer the mod's own tree; does a folded stretch's first row answer the record line and its other rows nothing; do an opened stretch's rows keep the engine's drawing; does the band answer after the first message; do the two presses change the next answers? | yes | the run's folded answer still keeps the engine's drawing: P does not ship the declaration until a run can be hidden; every launch stays at 8 and on the mirror; the owner is told. The message call's answer keeps the engine's drawing: nothing changes (MAWS's own drawing of it is the same look) |
  | A3 | Under a launch at 9: after, then before, then after, by swapping the scratch home's installation and sending `reload_plugins`: does the loaded mod's answer follow the installation at each step, and does exactly one side draw at each? | yes | the loaded mod keeps the setting it read: §G's reload rows for 9 go, who draws is decided at the launch alone, and a reload under 9 is a tracker row |
  | B | In `system/init` and in a `reload_plugins` answer, is the mod's entry named `to-human`, and is its `path` a directory that holds the plugin's root files, the declaration among them? | yes | another name: §A reads the name the fixture shows. No usable path: the declaration is read at the launch alone (the applicable installations), and §A's "reported" rows read the loaded plugin as declaring exactly when the launch's installations did |
  | C1 | Does the engine run a `desktop` surface's `ui_render` for `TurnDuration` through the hooks, hand `next(e)` the engine's slot, and accept the props `{ word, durationMs, isExpanded }`? | yes (the bundle lists the site among a surface's transcript messages) | the turn's line takes §E's second means (probes of its turn's stretches) |
  | C2 | Does it accept `AssistantMessage` with `isSummary: true` from a surface, and does the mod, before and after, fold that row with its run and keep it when the run is open and in the full transcript? Does an id of the message's uuid qualified by a block place it at that message? | yes | a thought takes §E's second means (a probe of its stretch's first asked row) |
  | C3 | Is an instance id `<anchor>~<tag>` handed to the hook unchanged as `e.requestId`, and with P is such an ask placed after its anchor: a `UserMessage` with origin `scheduled-trigger`, `plugin`, `task-notification` and `peer` folds with the run there, and a `~turn` ask follows item 5 of §I? | yes | the id is changed: P places by a prop the site rule lets through, or those rows take the second means |
  | C4 | Does each of those asks (a thought's, a listing's `ToolUse`, a notice's, a turn's line's), **sent alone on a connection that asked no other row of its stretch,** answer by the fold, and answer again rightly after the mod's invalidation at the first mark, after each press of `to-human-mode`, and after a reload? | yes | a row whose lone ask is wrong takes the second means; if that cannot be built either, a card for the owner before M5 |
  | C5 | Does a `UserMessage` with origin `plugin` and a notice's line as text fold (the answer's notice of R13), while the delivery's own text under any origin stays? | yes | the answer's notice where the mod draws is hidden by a probe of its question's row instead |
  | D | With no advertisement and the plugin enabled: at a launch, and at a resume of a transcript that holds a mark, does the view draw on the `desktop` surface (the band after a mark, the fold); and with hooks disabled, does nothing answer? | yes, yes | it does not draw with no advertisement: §A's rows for "none" read `maws`, and card 8 falls away |

- **What is built before its answer.** The whole first pull request; M4; P with its own suite. What waits: M5.

### Check 5 · rows the mod hides (A18; on the trial)

- **What it runs.** The trial scene's second case: a long seeded session (two hundred turns, a message in each; invented) resumed in a session MAWS runs with P's checkout installed, with no prompt sent, so that no model call is spent while the surface is attached. It scrolls from the end to the top and back and reads the count of mounted rows and of render asks at each stop.
- **Where and with what.** Electron on the Mac mini under the load rule, the trial's scratch config home.
- **What it records.** The two counts per stop, in this document's Surprises & Discoveries; no fixture.
- **Outcomes.** At or under the anchoring scene's bound of 40 mounted rows: nothing changes. Over it: nothing is built by an executor. The child's remedy (not mounting a hidden stretch's rows) would make a row's presence rest on a row that may not be mounted, which R3 forbids; the reading comes back to the architect with its numbers and one candidate, which needs the mod: the band's answer carrying the keys of the unfolded runs, read by one ask alive per transcript.

### Check 7 · U3's rows and the mod (O-30)

- **By reading, done here.** U3a's arrival rows ask `UserMessage` with the engine's props: `origin` (`peer` or `task-notification`), `from` for a message from a session or a subagent, `task` (`id`, `status`, `type`, `toolUseId`, `durationMs`) for a task notification (`transcript/surface/adapters.ts`, `arrivalInput` and `engineUserProps`); its sent-message row asks `ToolUse` (`sentInput`). Those are the fields `promptRow` reads. One gap, by the engine's own design: a scheduled trigger's and a wake's notice, and a task's end the host made, have no carrier the engine draws through `UserMessage`, so they ask nothing today; §E gives them the ask (R3).
- **Live.** Check 1's questions A2 and C3; the trial shows it in the window. No separate run.

## Cost on a long transcript

| what | where | can this landing move it |
|---|---|---|
| Derivation of a 500-turn session, and the median delta batch | `transcript/model/perf.test.ts`, by hand, `MAWS_PERF=1` | yes, for a lane-on session only: with no turn fold every turn's rows are in the flat list, and the mirror is one pass over them per change of the rows. Concrete Steps 4 reads the base, the head, and the new lane-on case |
| No derivation of a turn during token batches | `assistant-ink.test.tsx`, `stores/transcript.test.ts`, `derive.test.ts` | it must not, except once: the flip at a session's first message derives every turn (decision 8) |
| Anchoring while 500 turns stream: at most 40 mounted rows | `e2e/transcript.spec.ts`, "anchoring", lane off | no: lane off, nothing of this landing is in its path but one flag read. Its measured half is read base against landing in one sitting on the Mac mini (the gate-offload plan's Decision Log 162) |
| The same bound in the mirrored view | the new scene of M3 | new: a folded stretch is one row where a folded turn was two or three, so it is expected under today's |
| Mounted rows and site asks where the mod draws | check 5 | the open question of A18; what an over-the-bound reading comes back with is named |

A lane-off session, and any session before its first message, is not moved at all.

## Proof that an executor does not run

Each is a step for the architect, with what it needs. A list per pull request (R7).

**The first pull request.** No two-build run is owed: it edits no two-build scene and stores and sends nothing.

1. **The Electron e2e groups the change crosses,** on a Mac under the load rule, each edited or new scene first alone, by its name in `package.json`: `e2e:transcript` (the rewritten report scene, the two new scenes, the R3 and M3 cases read again), `e2e:to-human` (the Needs-you jump), `e2e:tools` and `e2e:design-systems` (each pressed the bar), `e2e:library` (its conditional press), `e2e:composer` and `e2e:c7` (the switch is mounted in the composer), `e2e:lane-a` and `e2e:remote` (a terminal session's and another machine's pane now carry the view), `e2e:side` (it reads a row for raw message tags), `e2e:settings` (the keymap's table gains a row), and `e2e:desk-web` on the pool for §L's eight scenes.
2. **The measured anchoring scene,** `MAWS_TRANSCRIPT_PERF=1`, base and landing in one sitting on the Mac mini. About ten minutes of an idle Mac twice.
3. **The look on the built window,** light theme, against the drawn example: the message, the record line closed and open, the switch in its frame, the turn's line with no chevron, a running turn, a waiting permission, the switch above the holder notice; "Mark all read" from the palette.
4. **The owner's sitting.** Scenes: a session MAWS runs, a terminal session and a session on another machine, each drawn by the mirror; a relaunch in the middle of a session; the full transcript and back; a jump from Needs you into a folded record.

**The second pull request.**

1. **The Electron e2e groups:** `e2e:transcript` (the R3 `ToolGroup` case; the reveal), `e2e:to-human`, `e2e:widgets` (the mods list's version), `e2e:available` (it reads a lane-off launch's settings env). The default group collects `e2e/to-human-live.spec.ts`, which skips there.
2. **The trial** (A15, check 5, check 7's live half): `e2e/to-human-live.spec.ts` under its switch, on a Mac where Electron may run, with the harness build, an engine binary, a scratch config home holding the doperpowers, sminos and to-human plugins from P's checkout with the to-human style selected, and model access for three short turns under the spec's spend cap (tools then a final message; a message mid-turn then tools; a background task's notification and a peer's message). It must show: the messages, the record lines and the switch drawn by the mod and none by MAWS; nothing drawn twice; a thought, a listing, a notice and a turn's line hidden in the report and all in sight in the mod's full transcript, also after scrolling so that their neighbours unmount; a jump revealing its target; the same session with the lane switched off, drawn by the mod with no turn fold; the same session after a quit and a reopen at rest drawn by the mirror with the same rows, fold states aside; one artifact mention and one path link inside a mod-drawn message, with what each opens. A paid run: once, on the final head (UC-10).
3. **Check 5,** in the same sitting, and its reading against 40.
4. **The two cross-build runs,** `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, on the final head or the last head that changed what §F names. The pull request names both.
5. **Three looks.** With the changed mod installed in a scratch config home: a session build F runs, and one the installed build runs, each looking as it did (A16); and an earlier build's window on a session this build launched at 9, to see §H's row 5 as it is before the owner is asked card 2.
6. **The owner's sitting.** Scenes: a session MAWS runs drawn by the mod, before and after a relaunch; the mod's switch to the full transcript and back; the lane switched off with the plugin on.

## Size and review

Counted from the code at `3f2c4fca1` (files named in each milestone, the tests that pin today's behaviour, the scenes), not from the child's estimate.

| | files | changed lines, about | what it is |
|---|---|---|---|
| M1 | 34 | +1,650 −700 | one new pure function with its table of cases; the store; twelve test files rewritten; the flag's outside half and its three-route test |
| M2 | 33 | +800 −1,300 | two components and a stylesheet; one action; five source files and their tests removed |
| M3 | 15 | +600 −300 | scenes, the desk's eight, the record's first line |
| **the first pull request** | **about 80** | **about 5,300** | |
| M4 | 36 | +1,500 −80 | the decision's pure functions, the declaration's reader, the reservation, the status's subscription, one command through the host, one wire minor |
| M5 | 24 | +1,200 −100 | the surface rows and their inputs, the reveal, the cutover's switch |
| M6 | 9 | +700 −60 | scenes (the trial, two cross-build), the record's second line |
| **the second pull request** | **about 70** | **about 3,600** | |
| P (doperpowers) | 9 | +400 −15 | the gate, the declaration, the placement, the turn line's rule, their tests, the check script, three sentences |

**Each pull request's branch is reviewed by the xhigh panel,** by size and by stakes. The first's lenses: (1) *the port*: §B clause by clause against the mod's source at 0.8.2; (2) *the flag*: no pass projects withheld rows, by the three routes, with resets and interruptions; (3) *cost*: the flip, the flat list with no turn fold, the mounted rows; (4) *UC-8 and UC-3*: the insertions of §K, U1b's rows. The second's: (1) *one side draws*: §A, §G and §H as state machines, the reservation's window, a daemon's restart, a reload, the unreadable row; (2) *across builds*: §F against both earlier builds, the tolerant reader, the added column, the new command on an older host; (3) *an ask per row*: §E against check 1's fixtures, each dependent row mounted alone, the full site, the reveal; (4) *the lane off*: R4's rows. Each milestone's own review at its boundary is a single reviewer, at the high rung for M1, M4 and M5 and the medium rung for the others. P is reviewed in its own repository.

## The pull requests

Each body names: its class 1a run (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u2b` and `u2b-2`); the panel's verdict with what was dismissed or deferred; the e2e groups run and where; its residue (its tracker rows). It carries its dated line of "The record" and ends with the trailer the build brief gives. The first also says: every launch still advertises 8; the desk web app draws the new rows from its next deploy on and keeps its bar; the second follows. The second also names: the two cross-build runs by their peers; the trial's reading and check 5's; check 1's findings file; the mod's pull request beside it, and that nothing here waits for its merge.

## Surprises & Discoveries

- Observation: the installed mod is 0.8.2, two minor lines past the 0.7.3 the first landing's document read, and 0.8.0, the number the design gave to the release that draws at 9, is in use. `native()` is unchanged through all of them; an eleventh caller and a fold-summary tracker were added.
  Evidence: the install record's `version`; the cache's directories 0.7.2 to 0.8.2; `to-human.tsx` lines 1450 to 1455 and 1616; `folds.tsx` line 592.
- Observation: the lane's state is on the wire and its objects are strict, so the published field is a wire minor; and a launch's id is the host's, so nothing about a launch is durable before it runs unless it is reserved first.
  Evidence: `wire-manifest.json`, `commands.ownerChannel.state` and `events.ownerChannel.changed`; `src/services/sessions/resume.ts`, the loop around `launchOnHost`; `src/services/owner/store.ts`, `recordLaunch`.
- Observation: the engine draws a thought's text through `AssistantMessage` with `isSummary: true`, and its closing line through `TurnDuration`, a site a remote surface may ask. So two of the rows this document first called site-less have a site of the engine's own.
  Evidence: `cli.pretty.js` of `2.1.322`, lines 923794, 929014 and 1127722.
- Observation: MAWS's render command names its sites in a closed set on the wire; an added name is a wire major.
  Evidence: `wire-manifest.json`, `commands.session.ui.render`, `component`'s `enum`; the rule at the head of `src/shared/ipc/wire.ts`.
- Observation: with no advertisement the mod draws on MAWS's surface once it has seen a mark, whatever the lane and the style.
  Evidence: `native()` (1452 to 1455): an unset value is not native; the style is read by `message.tsx` alone.
- Observation: for a session on another machine the lane cannot be read, so today's report never applies there.
  Evidence: `src/shared/ipc/remote-unavailable.ts`, `'ownerChannel.state': notYet('the owner channel')`.
- Observation: the mod's fold is in force by time, not by place, and it leaves a question's call in view.
  Evidence: `isFolding = () => hasSeenMark && !isFullTranscript` (line 1512); `isRead` (605).
- Observation: a terminal session no port drives has no composer, so a switch mounted only there is missing on the route the mirror exists for.
  Evidence: `session/SessionPane.tsx`, `noticed`.
- Observation: `e2e/to-human-live.spec.ts` skips on both branches of its own condition.
  Evidence: its `skipReason` returns a reason with and without `MAWS_C_LIVE=1`.

- Observation (M1): the derivation budget, base against head (Concrete Steps 4). Base, alone at `02eed5eb3` (22:57 PST, the branch's VM): `perf: events=43919 rows=1574 deriveMs=215.1 deltaBatchMedianMs=0.090 deltaBatchMaxMs=5.808`. Head `9c368ae54`, alone: `perf: events=43919 rows=1574 deriveMs=253.5 deltaBatchMedianMs=0.106 deltaBatchMaxMs=6.029`. The VM was loaded and single readings moved by a third between runs of the same code, so base and head were then read alternately in one sitting (base from a scratch worktree at `02eed5eb3` on the VM): base `deriveMs` 320.9, 240.2, 315.6; head 308.1, 271.2, 316.3; median delta batch 0.08 to 0.14 ms on both. No difference beyond the noise; the lane-off path gains one flag read per turn derivation. The new lane-on case (`owner/view/perf.test.ts`, 500 turns with a message in each, no turn folded, mirrored): `perf (lane on, mirrored): events=43919 rows=3720 drawn=3198 deriveMs=286.4 deltaBatchMedianMs=0.097 deltaBatchMaxMs=25.894` (in the sitting: 301.8, 274.1, 307.0, 369.6). Under that load the existing case's own bound of 300 ms failed once at the head and the base read above it too: that bound is a wall-time bound on a shared VM.
  Evidence: the four `vmcheck.sh ux-wave/U2b` runs of `MAWS_PERF=1 pnpm exec vitest run` named in M1's report.
- Observation (M1): the node project lists `src/renderer/src/transcript/model/*.ts` and is composite, so a suite of the model's directory cannot import `owner/view/mirror.ts` (an unlisted file). The lane-on case of the budget therefore lives beside the mirror, in `owner/view/perf.test.ts`; Concrete Steps 4's command at M3's head names both files.
  Evidence: `tsconfig.node.json`, the include's comment above `src/renderer/src/transcript/model/*.ts`.
- Observation (M1): no recorded pair of a journal and a transcript under `fixtures/uxwave/` holds a `<message>` or a message-tool call; the recorded session with messages on all three routes is P4-R7's `p4/p4-r7-tool-stages.jsonl` (its stream frames, and its transcript in a `disk` meta row), which `lane-a/view-routes.test.ts` draws. The wire alone carries the process's own error line at its end, which the comparison leaves out (every error stays in sight on every route).
  Evidence: a count of marked texts and message calls over `fixtures/uxwave/*.transcript.jsonl`; the failed first run of `view-routes.test.ts` (`expected [ …(9) ] to deeply equal [ …(10) ]`, the extra row `error`).
- Observation (M1): standalone browser activity is placed by the view (`withBrowserActivityRows`), never by the store, and it stays in sight, so a standalone browser row the view places inside a stretch splits it there and not in the store's rows. M1 first left the store's jump reading the stretches of its own rows, so a jump to a row after such an activity opened the first half's key and left its target folded; M1's review found it and the fix wave reversed that: the jump reads the rows each mounted view composes (`mountView`, decision below).
  Evidence: `Transcript.tsx`, `withBrowserActivityRows`; the review's reproduction; `owner/view/jump.test.tsx`.

## Decision Log

- Decision: the verification call. This document gets an adversarial review before any executor starts (the architect dispatches it). Each pull request's branch gets `doperpowers:review-code` at the xhigh panel, with the lenses of "Size and review"; each milestone a single reviewer at its boundary. Class 1a on GitHub Actions is the gate of record; the Electron groups, the two cross-build runs, the trial and the measured scene are the architect's.
  Rationale: about 150 files in the surface the owner reads most, a wire minor, a stored value, and a cutover between two programs that deploy separately.
  Date/Author: 2026-11-15, this document's author.
- Decision: revised at the architect's rulings R1 to R13 on the adversarial review (seven findings, verdict "needs attention") and on this document's reported points. What changed, by ruling. **R1:** no constant names a release of the mod; an installation's declaration decides, read at the launch and at the loaded plugin's path; the failed-release list of the child's file is not built (a release that cannot hide a run does not carry the declaration); §A, §G, §I. **R2:** the advertisement is reserved before the send and bound after; an advertisement that cannot be known is published `mod` while the mod may be loaded; the host cannot answer for a running launch, so the reservation is the record; decisions 3 and 4, §A, §F, M4. **R3:** the lead rule and its registry are withdrawn; every row the fold can hide asks a site of its own (the first means, taken whole: a thought and a turn's line at the engine's own sites, the latter through one new command; a listing and a browser action as calls; a notice as an arrival; a separator by a probe mounted with it); error rows now stay, having no site; check 5's remedy is withdrawn; §B, §E, §I, check 1's questions C. **R4:** a launch's advertisement has three values, and with none the mod draws when its plugin is loaded; §A, §G, card 8. **R5:** the mirror is applied only while the stored flag is set, and `Transcript` writes the outside rows' part of the flag before paint; M1. **R6:** a reveal ends after its containing row has entered the mounted range and left it; §E. **R7:** two pull requests, six milestones; Progress, "Proof" and "Size and review" are per pull request. **R8:** the wire minor (now an optional key and a command), the stored column and the second mount are in §F and §K as permitted. **R9:** the toggle says why where the mod draws; "Mark all read" is a palette command, one new action id; §D, §K. **R11:** eight cards, each with the place its recommended answer is built. **R12, R13:** U1b's document read at `e5d34d52b`; the table and the shared files corrected; an asynchronous answer is stated once outside the record (decision 12, §B, M1's test).
  Rationale: the law at the head of this document; the review's evidence was read against the code and holds (the launch's order in `resume.ts` and `launch.ts`; the registry's retained sites; the desk's tail). Rejected at the revision: adding `TurnDuration` to the existing command's set (a wire major); asking a site for a retry line or a plugin's notice (none exists: they stay); keeping any rule by which one row follows another's remembered report.
  Date/Author: 2026-11-15, this document's author, at the architect's rulings.

- Decision: the owner's answers to the cards, 2026-11-15 (UTC), recorded verbatim in "Questions for the owner". "Unnamed rows" (card 3): "! command and errors stay (Recommended)". "Lone thought" (card 5): "It folds (Recommended)". "Mod layout" (card 9): "Evened out for MAWS (Recommended)". "Switch frame" (card 6): "Bordered box (Recommended)". "Other machine" (card 4): "This app's switch (Recommended)". "Lane off" (card 8): "Let the mod draw (Recommended)". "Fold line" (card 1), typed: "we actually recently made changes to how '> working record' shows in terinal -- in short, it no longer shows '> working record', but shows '> <summaries>' instead. and i think that's how we should do it. mods already shipped it and is active already in terminal. it uses haiku call instead of forked call, and is cheap enough to use. But let user be able to disable it if they want to cut that token cost, and in that case it'll just be working record."
  Rationale: each chosen answer is the default this document builds. The typed answer to card 1 is read by the architect's ruling of the same date (below): the summaries are ruled into the second pull request; the first's record line reads `working record`. The sentences of "Left", reported point 3 and card 1 that called the summaries out of this landing's scope are corrected to say so, and "The record" gains the tracker row "the record line's summary in MAWS", owned by the second pull request.
  Date/Author: 2026-11-15 (UTC), the owner, recorded by the executor of the first pull request.
- Decision: the architect's rulings after the revision, 2026-11-15 (UTC). **1.** The author's seven departures from the architect's rulings are accepted as this document states them; those concerning M4 to M6 belong to the second pull request. **2.** Card 2 is decided: going back to an earlier build while the mod draws a session is accepted (second pull request; a tracker row there). Card 7 is decided: the desk web app keeps its Report · Transcript bar and the architect registers the desk ticket; §L is built as written (M2, M3). **3.** The mirror's look is "evened out", each item at one named place so the other answer is a small change: (i) a later message's label stands in a fixed two-column bullet slot, so `message` under `● message` keeps the indent (M2, `owner/view/Message.tsx`); (ii) a record line has the transcript's ordinary row spacing, with no extra row above it (M1, `owner/view/RecordFold.tsx` with its rule in `view.css`); (iii) no dim bullet stands before a record line (M1, `RecordFold.tsx`); (iv) no empty row stands above the switch inside its box (M2, `owner/view/Switch.tsx` with its rule in `view.css`); (v) the switch's caption and its button are one text size (M2, `Switch.tsx`/`view.css`); (vi) a message's body has the transcript's line spacing (M2, `Message.tsx`/`view.css`); (vii) a turn's line keeps the indent its chevron gave when the chevron is absent (M1, `transcript/view/rows/Divider.tsx`). The executor of each item names its one place in its report and in this entry's follow-up. **4.** "A reply's first text" (which message carries the bullet, M2's "the label follows `spanRows`") is defined as the engine defines it: M2 reads the rule in the engine bundle the repository pins, states it in this document, and tests it on a recorded fixture under `spikes/protocol-probe/fixtures/`; it is not inferred. **5.** A turn that is running shows, in the folded view, only its line (`Working for …`) after a closed record, as frame 5 of the drawn example has it (M1; decision 11). **6.** The frame with a permission waiting follows U1b only once U1b is on master; it is not, so M1 to M3 build against master as it is (the docked card and its pointer row stay) and build nothing around U1b; "What is assumed of landings in flight" says what each side may rely on.
  Rationale: the architect's dispatch of the first pull request, after the owner's look at the drawn example.
  Date/Author: 2026-11-15 (UTC), the architect, recorded by the executor of the first pull request.
- Decision: base read at the dispatch. The branch's base is master `bc10d2d93` (merged at `285e5d90d`). Since `3f2c4fca1` master gained U6d (the transcript's Markdown link is link text on a span with the role of a button; `show_pane` no longer opens an artifact; `transcript/index.ts` gained `endsSelection` and `openArtifactMention`, and `SurfaceTree.tsx` calls them) and a test bound (`document-perf.test.ts`). Concrete Steps 1's four greps answer at `285e5d90d`; "What is assumed of landings in flight" holds for U6d as written. Any later statement found not to match goes to the architect with its evidence before anything is built around it.
  Date/Author: 2026-11-15 (UTC), the executor of the first pull request.

- Decision (M1): what M1 left open, decided for the milestones after it. **(a)** `reportOnly` is set by the mirror on a closed stretch's head from M1; drawing only its messages there is M2's `MessageView` (until then the head draws whole, as a marked text does today). **(b)** A live text with an open mark is classed `stays` while it streams, never `mixed`: a native live row's markdown is its first delta, so its words outside the mark cannot be read without its buffer, and the native and the outside routes must agree; it is classed by its words once it completes. **(c)** The live marks a caller passes are the store's (`liveMarkedRowIds`) joined with those of the live rows handed in from outside (`liveMarksOf(stored, outside)`, exported beside them), and a live row is marked exactly when its id is among them; `mirrorsView(ui)` (exported) is the one test of "the flag is set, the view is the report, MAWS draws it", read by `Transcript`, `drawnRows` and the store's jump. **(d)** `Transcript`'s outside rows are its `tail` and its `placed` rows. A mount writes `tailMessage` when its own reading changes or the key started over, never merely because the stored value differs, so two mounts of one key cannot undo each other. **(e)** The flag is recomputed in `put` for every new state (`withViewFlag`), so events, a reset, a staged install and the lane all reach it in their own update; `setToHumanView` first guesses it with the lane as it will be, from the turns' rows and, when the lane turns on, from their completed texts' marks (rows the lane-off derivation folded hide a marked commentary), so turning the lane on over a history that holds a message derives every turn once; `put` settles a wrong guess. **(f)** `openStretches` is optional in `TranscriptUi`, as `reportOpenTurns` was; absent reads as empty. **(g)** The rows of no stretch: a running turn's line counts as covered when it lies inside a closed stretch or when the next row of a class is a closed stretch's head or first row, and is then drawn directly after that record line (ruling 5); a closed turn's line drawn because another record of its turn is open, whose own place lies inside a closed stretch, is drawn after that stretch's record line; a separator is drawn when the row after it is. **(h)** `browser_activity` under a call folds with it (`recordRow`); only a standalone one stays. **(i)** A stretch's key is its head's id when a mixed text heads it, else `stretchKey` of its first folding row, so a text completing into a mixed head after its run started does not rekey the run. **(j)** The record line hands keyboard focus to its other line when that line is drawn (the two stand at the two ends of the stretch). **(k)** With no fold, a turn's line is `TurnLine` in `Divider.tsx`, the label in a span set as the disclosure was and the chevron's slot an empty `transcript-chevron` span (ruling 3, item vii).
  Rationale: each follows the nearest decision of this document (8, 9, 11; R5; ruling 5) or the mod's own function it ports; (e) keeps the lane flip's cost at today's single derivation.
  Date/Author: 2026-11-15, the executor of M1.
- Decision (M1): the places of ruling 3's M1 items. **(ii)** the record line's spacing: `owner/view/view.css`, the rule `.owner-record-fold { padding: 2px 0 8px; }` (no margin above; the mod's own line stands one row lower); **(iii)** no bullet before it: `owner/view/RecordFold.tsx`, whose button holds only `RECORD.closed` or `RECORD.open`; **(vii)** a turn's line keeps its chevron's indent: `transcript/view/rows/Divider.tsx`, `TurnLine`'s empty `<span className="transcript-chevron" aria-hidden="true" />`, with `.transcript-turn-line` in `transcript/view/transcript.css`.
  Date/Author: 2026-11-15, the executor of M1.

- Decision (M1, fix wave after M1's review): three of M1's choices amended and two added. **(d), amended:** the outside rows' term is any mounted view's part: each `Transcript` keeps its own reading of its `tail` and `placed` rows (`outsideMessages` in `Transcript.tsx`, by mount) and writes the term (any part true) through `setToHumanView`, whose signature is unchanged; a mount's part goes when it unmounts, and the term is written again then. The rule "a mount writes only when its own reading changes" is withdrawn: it let the last writer win, so a second mount with no message cleared the first's. **(j), amended:** the hand-off is the transcript's own and lapses: a press asks focus for its other line in the mount it was pressed in (scoped by the mount's id prefix, `owner/view/handoff.ts`); the request is taken once and lapses at the next animation frame, so a line the list did not draw in the press's own update, or a line of another pane, is not handed focus. **(l), added:** the store's jump resolves the stretch over the rows each mounted view composes before the mirror (its resting and placed rows, browser activity, queue tail, with its live marks), handed to the store by `mountView(key, compose)` (additive; released on unmount) and read when the jump is asked; with no view mounted, over the key's own rows; mounted views that compose alike name one stretch, and the jump opens the stretch holding its target in each. Item (h)'s standalone browser row stays in sight, so it splits the stretch, and the jump now agrees. **(m), added:** when `noTurnFold` takes effect, a turn fold the reader started and still running is settled at once, before paint (`WorkMotion.settleFolds`): its turn is folded in the store as asked, its close motion skipped, so no row of the view (a record line included) waits on it, and the turn is folded when the view leaves force.
  Rationale: the review's three Important findings and two Minor ones, each reproduced; (d) and (j) as first written did not hold with two mounts of one key; (l) is M1's jump contract, which exempts no row the view places.
  Date/Author: 2026-11-15, the executor of M1.

## Outcomes & Retrospective

Pending — written at finish.
