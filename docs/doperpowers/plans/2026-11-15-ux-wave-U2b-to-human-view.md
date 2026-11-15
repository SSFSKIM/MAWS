# UX wave · U2b · the to-human view drawn by the mod, the working record's fold, the mirror (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U2**, second landing (**U2b**), parent pin `3f2c4fca1197ea75570d022c05049604320e7ee4`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U2-transcript-structure.md`: the items O-13 (with O-06 and l2-transcript-06), O-30 and #332; acceptance A12 to A16, and of A18 the mirror and where the mod draws; Contracts UC-13 (owned), UC-1, UC-2, UC-3, UC-6 and UC-8 as consumed; Design inheritance; "Probes and checks" 1, 5 and 7; under "Rulings reversed" the rows O-30 with O-06, and O-13. In the root: Purpose, the wave's laws (2, 5 and 6 above all), UC-3, UC-8, UC-10, UC-11, UC-13, UC-14 and "Ordering and dependency map". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: what the code and the installed mod say today, the decisions the section left open, the names siblings build on, what is stored and sent against both builds on the owner's machines, the mod's pull request as an executor can prepare it, and the execution. **Branch:** `ux-wave/U2b`, from master `3f2c4fca1`. **Board:** #608 (the wave's epic is #573). The first landing is U2a (`docs/doperpowers/plans/2026-11-12-ux-wave-U2a-transcript-structure.md`, on master); its §J and §K are this document's starting point, and "Today" says where they no longer hold.
> **Not yet reviewed.** An adversarial review precedes any executor (Decision Log, the first entry). Fourteen points are reported to the architect for a ruling and seven questions are written for the owner; each has a default this document is written to, and each names the one place its ruling changes.

## Purpose

After this landing a session's messages to the person read the same wherever the session runs, and MAWS draws nothing of its own in the to-human mod's place.

- A message to the person is the mod's drawing: a bold `● message` label in the accent colour over the body in the normal text colour, indented. The bar down the side and the "To you" label are gone (#332 closes on this).
- From a session's first message on, the work between two rows the person reads is one line, `› working record`. One click opens it onto the plain transcript's rows (tool runs folded, as U2a left them), with `‹ fold to report` under the last. There is no second fold in the way: MAWS folds no turn of its own once the view is in force, and a turn's line shows only while a record of that turn is open.
- The "Report · Transcript" bar above the transcript is gone. The switch is one line above the composer: `to-human view · full transcript ›`, and in the full transcript `to-human view · report only ›`.
- In a session MAWS runs, with a release of the mod that draws on MAWS's surface, all of this is the mod's own drawing and MAWS adds none. Everywhere else (a terminal session, a session on another machine, a session at rest, a session under an older mod) MAWS draws it by the mod's rule, ported clause by clause: the mirror.
- Exactly one side draws in every pairing of a MAWS build and a mod release. The number a launch advertises says which: 9 when the mod draws, 8 when MAWS does.

How to see it working: the unit suites named in each milestone draw recorded sessions through the mirror by the three routes and compare the rows; the harness scenes of `e2e/transcript.spec.ts` and `e2e/to-human.spec.ts` show the fold, the message and the switch in the real window; the trial scene (`e2e/to-human-live.spec.ts`, rewritten) runs a session with the changed mod installed and shows the mod's drawing with nothing drawn twice. The Electron scenes, the trial and the cross-build runs are the architect's ("Proof that an executor does not run").

## Progress

- [x] (2026-11-15) This document written, on a tree at master `3f2c4fca1`, with the installed mod read at 0.8.2 and the three landings in flight read at their heads.
- [ ] The adversarial review of this document, and the architect's rulings on "Reported to the architect" (R1 to R14).
- [ ] The owner's look at the drawn example and the answers to the seven cards ("Questions for the owner"). Gates M2's look only.
- [ ] P — the mod's pull request prepared in a worktree of the doperpowers repository, its own suite green (Interfaces §I). Not opened before check 1.
- [ ] Step 0 — check 1, run by the architect ("Checks handed to the architect"). Gates M4 and the two constants of §A.
- [ ] M1 — The mirror: the fold by stretch on every route MAWS draws.
- [ ] M2 — What a message looks like, the switch above the composer, and what goes.
- [ ] M3 — Who draws: 9 and 8, `drawnBy`, the launch's number kept, the wire minor.
- [ ] M4 — Where the mod draws: full sites, the message call's ask, following the lead, the reveal's end; the cutover.
- [ ] M5 — The e2e edits and scenes, the cross-build scenes, the record, and the acceptance run.
- [ ] Proof that an executor does not run (the architect's): the Electron groups, the two cross-build runs, the trial with checks 5 and 7's live half, the measured anchoring scene, the looks on both earlier builds.

## What is assumed of landings in flight

One list, to be read again when each is on master. Step 1 of Concrete Steps repeats the commands.

| landing | read at | what this document assumes | read again |
|---|---|---|---|
| **U6d** (`origin/ux-wave/U6d`, built, in review) | `e6bc2dc19` | It touches no file this landing edits. It adds two runtime exports to `src/renderer/src/transcript/index.ts` (`endsSelection`, `openArtifactMention`) and their two names to the one-line list of `transcript/index.test.ts`, which pins every runtime export. **This landing adds and removes no export of `transcript/index.ts`** (the mirror lives under `src/renderer/src/owner/` and is imported by `view/Transcript.tsx` and `lane-a/view/drawn-rows.ts` directly, as `reportRows` is today), so the two never meet on that line. Under a mod's surface a mention's click is taken by the capture handler of `engine-surface/SurfaceTree.tsx` (`MarkdownNode`), which after U6d calls `openArtifactMention`; a message the mod draws at 9 is Markdown under that handler. This landing edits nothing in `SurfaceTree.tsx` | at each merge of master: `git diff --stat origin/master -- src/renderer/src/transcript/index.ts src/renderer/src/transcript/index.test.ts` on this branch prints nothing. The trial clicks one artifact mention and one path link inside a mod-drawn message and records what opens (Proof, 3) |
| **U6b-1** (`origin/ux-wave/U6b`, in build) | `71570d40b` | It touches no file this landing edits (`view/context.tsx` and `view/markdown/Link.tsx` gain a fourth argument of `openFile`). Its later landings name two things near this one and build neither yet: a path link under a mod's pane or composer site that does nothing today (its U6b-4), and a live region mounted in the composer (its U6b-5, U4's file) | at each merge: nothing to resolve by hand is expected; if `composer/Composer.tsx` moved, the switch's mount stays directly after `PluginBand` |
| **U1b** (`origin/ux-wave/U1b`, its document being written; no commit) | master | Nothing of U1b exists. **This landing needs nothing from it.** If U1b is on master first: (1) a row kind U1b adds is a compile error in the mirror's exhaustive switch (§B) until it is classed, and it is classed `stays` unless U1b's document says the row is the agent's work; (2) if U1b no longer derives the answer's notice, §B's row for `notice` class `answer` matches nothing and stays as written; (3) a condition U1b adds to the question, ask or plan row's own ask ("no ask while its request waits", UC-3) is kept as it is: this landing adds no ask to those rows and changes none. **What U1b may rely on from this landing, whichever lands first:** a `question`, `ask`, `plan` and `request_slot` row is never inside a working record, waiting or answered (§B, with a test that names all four); the mirror only chooses among the list's rows, so a region after the last row (the transcript's end) is neither folded nor moved; a call that waits for permission folds with its record, and the card at the transcript's end is the request's whole drawing there; `jumpTo` opens the record that holds its target where MAWS draws and reveals the target where the mod draws; `ui.view` and `setView` keep their names and values | when U1b's document exists: its statements on the to-human view against this row; at each merge: the exhaustive switch compiles |

On master and checked by name (Interfaces §J): U2a, U3a (the revealed row, the arrival rows' asks), U4a (the composer), U1a (UC-3 as amended).

## Words used here

A **message** is a message to the person: a `<message>` span in the agent's text (the older marks `to-human`, `essential`, `need-input` and `insight` read as one, as the mod reads them) or a sent call of the message tool (`mcp__to-human__message`, and `mcp__maws__message` in recorded sessions). The **to-human view** (in code and in older documents: the report) is the view in which only what the person reads stays in sight. It is **in force** in a session while its lane is on and the session holds a message. The **lane** is MAWS's per-session switch for the view (`lane.on` of the owner channel's state). A **stretch** is a maximal run of rows the view folds, between two rows the person reads. Its **record line** is the `› working record` line that stands for it while it is closed. **The mirror** is MAWS's own application of the mod's fold rule. **The mod** is the to-human plugin of the doperpowers marketplace; its **view** is `to-human/hooks/mods/to-human.tsx`. A **site** is a named place of the engine's interface a mod can draw at (`UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup`, `AbovePrompt`); MAWS **asks** a site for a row and draws the answer. An answer **keeps the engine's drawing** when its tree holds the engine's slot, in which MAWS mounts its own row; the mod writes that as `next(e)`. **Build F** is `f1852de3a`; **the installed build** is master `2c7044231`, on the owner's machines since 2026-11-15, with F kept to go back to. **Earlier builds** means both. The **engine host** is the process that runs a session's engine and outlives a relaunch of the app; the **daemon** (`mawsd`) holds the machine's services, the owner channel among them.

## Today, at `3f2c4fca1`

**MAWS.** `TO_HUMAN_CONTRACT_VERSION` is 8 (`src/shared/owner/contract.ts`), written into every lane-on launch's settings env as `MAWS_NATIVE_TO_HUMAN` by `withOwnerChannel` (`src/services/sessions/launch-mapping.ts`) on the decision of `ownerChannelLaunch` (`src/services/owner/launch.ts`). The lane's published state is `OwnerChannelStateSchema` (`src/shared/owner/state.ts`), a strict object whose `lane` is strict too; it is the output of the command `ownerChannel.state` and the payload of the event `ownerChannel.changed`, both owned by `machine` in the wire manifest (`src/shared/ipc/wire-manifest.json`). `WIRE_MINOR` is 46; it is 33 at F and 46 at the installed build, and `src/shared/owner/state.ts`, `contract.ts` and `src/services/owner/` are byte-identical on all three. The last decided launch is a row of `owner_channel_sessions` in the index database (`src/services/owner/store.ts`), written by `recordLaunch` as an update of the columns it names and read with `SELECT *`. The engine's status (`src/shared/engine/status.ts`) carries `launchId`, `process`, and `plugins` with each plugin's `name`, `path`, `source` and `version`, filled from `system/init` and from a `reload_plugins` answer (`src/engine-host/observed-facts.ts`), with `pluginsObservedAt` null until this launch reported them (a start with no prompt sees no init). The recorded fixtures hold a version on both carriers (`spikes/protocol-probe/fixtures/p4/p4-a2p-stub-hooks-group.jsonl`; `fixtures/pass3/e8-plugins-reload.jsonl`).

The renderer draws the report itself: `reportRows` (`owner/report/project.ts`) folds per turn into an `owner_record` row ("Working record · N tool calls · M messages"), composed in `transcript/view/Transcript.tsx` and, for the desk web app and lane A's helpers, in `lane-a/view/drawn-rows.ts`. The tab's choice is `ui.view` with `ui.reportOpenTurns` (`stores/transcript.ts`); `jumpTo` opens a turn's record through `foldedInReport`. `ReportBar` is mounted in `session/SessionPane.tsx` above the transcript. A message is `assistantPresentation` and `messagePresentation` (`owner/to-human/Presenter.tsx`), a decoration of the authored Markdown with `presenter.css`'s bar and "To you". A message-tool call is the `to_human` row, drawn by `ToHumanMessageRow` with no ask. A run asks `ToolGroup` beside MAWS's own row (`SurfaceGroupRow`, `drawingOnly`). The mods' band is `PluginBand` in `composer/Composer.tsx`, mounted when the session has started, drawn inside a bordered frame only while a mod answers `AbovePrompt`. A terminal session that no port drives shows `HolderNotice` in the composer's place (`SessionPane.tsx`, `noticed`), so nothing mounted in `Composer.tsx` is drawn there. For a session on another machine `ownerChannel.state` is refused (`src/shared/ipc/remote-unavailable.ts`, "not yet"), so `useOwnerChannel` holds nothing and `ownerLane` is false: today's report never applies on that route. The desk web app passes `ownerLane` as true for every session view and has a bar of its own (`apps/desk-web/src/views/project/ReportToggle.tsx`).

**The mod, as installed: 0.8.2.** Read in the plugin cache (read only). `native()` (`to-human.tsx`, lines 1450 to 1455) is true when `MAWS_NATIVE_TO_HUMAN` is set to anything non-empty and the event's surface is not the terminal (an event with no surface counts as not the terminal); the value is read once per worker. Eleven places call it and return `next(e)` when it is true: the `command.run` hook of `/to-human-dump`, the `ui.render` hooks of `UserMessage`, `TurnDuration`, `AssistantMessage`, `ToolUse`, `ToolGroup`, `ToolProgress`, `ToolResult` and `AbovePrompt`, and the `ui.press` hooks of `to-human-toggle` and `to-human-mode`. The message tool registers in a headless session at 8 or more (`message.tsx`, `getsTool`, `MAWS_WITHOUT_TOOL = 8`); the notifier is silent for any non-empty value (`notify.tsx`, `isNotifying`); the fold-summary tracker added in 0.8.0 is quiet for any non-empty value (`folds.tsx`, `isQuiet`), so under MAWS a record line reads its fallback, `working record`; the streaming hook (`hooks/to-human-stream.sh`, in the doperpowers plugin) and the sminos ask mod step out for any non-empty value. The view's rule and state are quoted in §B at the lines they stand on.

**Where U2a's §J and §K no longer hold.**

- §J's names all exist on master (`captionParts`, `turnOrder`, `captionText`; `runSegments`, `runLine`, `heldByPermission`, `THOUGHT_LINE_MS`; `stoppedMember`, `continuedAfter`, `denialDisposition`; `waitingLabel`; `Cell.background`; `GroupRow`; `groupInput`'s `isExpanded` and `revealed` rule; `ui.expandedGroups`, `toggleGroup`; `thinkingDurationMs`). Two of its last line's removals are not carried out: `FoldedAssistantProbes` stays (decision 11), and the divider row's `toolCalls` stays as data (decision 12).
- §K reads the mod at 0.7.3. It is at 0.8.2: the number §K and the child's file give to the release that draws at 9, 0.8.0, is taken (R1). There are eleven gated places, not ten. The plugin has no README; the sentence that states the rule is in its `CLAUDE.md`. The record line is no longer the literal `working record` on the terminal (R3). §K's table of an older mod holds with "0.8.2 or before".
- §K says the desk web app's two imports are of the report projection. They are of the bar's words and its stylesheet (`ReportToggle.tsx`); the projection reaches the desk through `drawnRows`, whose name does not change (§L).
- §K puts the lane's field and the number under `src/shared/owner/` and `src/services/owner/` only. The field is on the wire and the decision must outlive a restart of the daemon (R4, R5).

## The landing's edge

**In.** O-13 with O-06 and l2-transcript-06, O-30 and #332, whole. UC-13: the launch's number (9 or 8), `drawnBy` in the lane's published state, the two constants. The mirror in place of `owner/report/project.ts`. The run's row as a full `ToolGroup` site, and the message call's ask at `ToolUse`. The rule that ends a reveal (left by U3a and U2a). The switch's two mounts. The desk web app's two imports re-pointed and its e2e expectations edited. Acceptance A12 to A16, and A18 on the mirror and where the mod draws. Checks 1, 5 and 7 as steps handed to the architect. The record: the rows O-30 with O-06, and O-13, of "Rulings reversed"; UC-13's raise recorded where the advertisement is defined; one row of the cross-build coverage table.

**Beside it, not in MAWS.** The mod's pull request (Interfaces §I): prepared by an executor in a worktree of the doperpowers repository, opened by the architect after check 1, merged by the owner. MAWS's acceptance holds without it merged: A12 to A14 by the mirror on every route, A16 by the mod's own test; only A15's scene needs the changed mod installed, and the trial installs it from the pull request's checkout into a scratch config home.

**Left.** Nothing of the child. Outside it and named so that nobody builds it here: a to-human look of its own for desktop surfaces (the mod's to decide); fold states carried between the mod and the mirror; the owner channel over the machine link (R7); the desk web app's own bar (card 7); summaries on the record line (card 1); a sent message as a step of a run (the child's "Waiting").

## One pull request or two

Written as one landing, as the child's file and the brief draw it: the raise to 9 and the end of MAWS's own report are one change (UC-13). My count from the code is about 120 files and about 7,000 changed lines ("Size and review"), where the child's file expected about seventy for both of U2's halves. So the recommendation, for the architect's ruling (R11), is a cut at the boundary the milestones already have:

| | first pull request | second pull request |
|---|---|---|
| milestones | M1, M2, and M5's scenes for them | M3, M4, and the rest of M5 |
| what the owner gets | the mod's look, the fold by stretch and the switch on every route, drawn by MAWS; every launch still advertises 8 | the mod draws in sessions MAWS runs; 9; `drawnBy` |
| what it depends on | nothing outside MAWS: no check 1, no wire minor, no stored value | check 1, the mod's pull request prepared, two cross-build runs |
| how it is proved | recorded sessions drawn by three routes (U2a's way) | the mod's answers on a live surface, the trial |

UC-13 holds under the cut: after the first, MAWS still draws the view in the sessions it runs (by the mirror, at 8, where every release of the mod steps aside), and the raise never comes before MAWS steps aside. A ruling for the cut changes this section, Progress and the last paragraph of M5; no milestone's content moves.

## Decisions settled at authoring

Each is the default this document is written to. Where a decision is also a point for the architect it carries its R number.

1. **The number follows the decision, and there are two numbers.** A lane-on launch advertises 9 when MAWS decides the mod will draw, and 8 otherwise. 8 is not "the old number": it is the value at which every release of the mod steps aside and still registers its tool, so it is what MAWS advertises whenever it draws itself. Rejected: advertising 9 always and letting MAWS step aside by observation; an older mod under 9 steps aside too, which is safe, but a release on the failed list could not be kept from drawing.
2. **A launch advertises 9 only when every applicable installation of the mod draws at 9.** The style resolver already finds the installations that apply to the launch's folder (`pluginInstallPaths`); the install record of each carries a `version`. MAWS does not know which of several the engine loads, and under 8 every one steps aside, so one older installation among them means 8. An installation whose version is missing or is not a dotted number counts as older.
3. **Who draws is a pure function of two facts** (§A, `drawnBy`): the number the session's current launch advertised, and the engine's status for that launch. Under 8: MAWS. Under 9: the mod, unless the status shows the launch is over, or its plugins were reported and the loaded to-human release is absent or older. Before the launch's plugins are reported (a start with no prompt) the launch's own decision stands, because a release that draws is already answering the band above the composer then. It is computed again at every change of the engine's status, which is how a plugin reload reaches it.
4. **The launch's number is kept in the index, with its launch's id** (R5). The engine outlives the daemon, and a daemon that starts again must not read a session the mod is drawing as its own to draw. A nullable column added without a migration (`ADDED_COLUMNS`), holding the launch id and the number together: an earlier build's launch updates only the columns it names and would leave a bare number stale, so a value whose launch id is not the row's is read as 8.
5. **In force is by time, not by place** (R13). Once the session holds a message, every stretch folds, those before the first message included. That is the mod's rule: `isFolding()` is `hasSeenMark && !isFullTranscript`, with no test of where a row stands. "From the session's first message on" in the child's file is read so.
6. **A session on another machine follows this app's switch** (R7): its own lane cannot be read over the machine link, so the view is in force there while `mods.toHuman.enabled` is on here and the session holds a message.
7. **No turn fold while the lane is on and the session holds a message,** in the to-human view and in the full transcript alike (O-30: "turns are not folded either"). One flag of the transcript's view state, `noTurnFold`, written by the store in the same update that applies the events or the lane, so that no frame draws the turn fold and the stretch fold together. It reaches every turn's rows, as the lane does today; the session's first message therefore derives every turn once.
8. **A stretch's key does not change while the stretch lives:** the first tool-use id of its first row where that row holds a call, else the row's id. A row's id changes when a single call becomes a run and when a read is merged with the next; a tool-use id does not.
9. **Rows the child's table does not name** (§B, card 3): a thought folds; an error stays only at severity `error`; a browser action and an agent listing fold as the tool calls they are; the person's own `!` command stays. A row kind the table does not know is a compile error, not a default.
10. **A turn's line and a time separator are members of no stretch.** A closed turn's line is drawn in its place while a stretch that holds a row of that turn is open. The running turn's line is always drawn: in its place when that is in sight, else directly after the record line that covers its place. A time separator is drawn when the row after it is drawn, a record line counting for its stretch's first row.
11. **`FoldedAssistantProbes` stays.** It answers for turns MAWS folds, which still exist with the lane off and before a session's first message, and it already draws nothing for a turn that is not folded. U2a's §J listed it as removed.
12. **The divider row keeps `toolCalls` as data.** Nothing in the renderer reads it after this landing; removing it rewrites every recorded snapshot for no reader's gain. A tracker row.
13. **Where the mod draws, a row that asks no site follows its stretch's lead** (R10; §E). A thought, a notice the engine draws through no site, a turn's line: none can be asked about, so each is drawn while the first asked row of its stretch shows MAWS's own drawing. A stretch with no asked row at all is folded by MAWS, by the mirror, with its own record line (law 2: where no mod can draw, MAWS mirrors). The precedent is U3a's `carrier-drawing.ts`, where a notice follows the drawing another notice of its carrier applied.
14. **A reveal ends when its row leaves the rows the list has mounted,** or at the next jump. Read from the list's own range, never from a row's unmount: a row remounts when its key changes.
15. **One switch component, mounted twice, in the band's frame.** Beside the mods' band in `composer/Composer.tsx` (UC-8's insertion), and above the holder notice in `session/SessionPane.tsx` where that notice stands in the composer's place (R8). It is drawn only while the view is in force and MAWS draws it, inside the same bordered frame the mods' band uses, so the two routes look the same (card 6).
16. **The words are the mod's, exactly** (§D), in one file. A control's accessible name is its visible text.
17. **The desk web app keeps its own bar** (R9, card 7). Its three words and the bar's stylesheet move to the new folder and are kept for it alone.
18. **`e2e/to-human-live.spec.ts` becomes the trial scene.** It always skips today. It stays in the default group's list and runs only under its environment switch, so no group list and no pinned count of spec files changes.
19. **The action "Toggle report and transcript" keeps its id and title** (build F knows the id). It does nothing in a session the mod draws (R14).
20. **What goes:** `ReportBar` with its count of unread legacy marks, its "Mark all read" and its style-mismatch note; the `owner_record` row and `OwnerRecordRow`; `owner/report/project.ts`; the legacy cards `OwnerReport`, `EssentialCard`, `InsightNote` and `QuestionCard`, which nothing outside their folder mounts (confirmed: the folder's only importers are named in M2); `presenter.css`'s bar and label. `owner/report/answering.ts` stays: the request card marks a single legacy item read through it.
21. **The cutover is one commit, in M4.** M3 builds the decision with the constant for the first drawing release unset, so every launch still advertises 8; M4 sets it in the commit in which the renderer steps aside.
22. **Releases compare as dotted numbers,** part by part; anything else is not a release that draws.

## Reported to the architect

Each with its evidence, the default this document is written to, and the one place a ruling changes.

| | what | evidence | default | a ruling changes |
|---|---|---|---|---|
| R1 | **The mod is at 0.8.2 and 0.8.0 is taken.** The child's file and U2a's §K name 0.8.0 as the release that draws at 9. A MAWS that took 0.8.0 for it would advertise 9 under the installed mod, which steps aside for every non-empty value: nothing would draw the view. And the number is only fixed when the mod's pull request merges: if the mod's main reaches the pull request's number first with other work, the same happens | the install record names 0.8.2; the cache holds 0.7.2 to 0.8.2; `native()` is unchanged through all of them | The constant is the mod's pull request's number, 0.9.0 as proposed, and is unset until M4. The pull request is opened before this branch's gate; if the mod's main takes that number first, pull request and constant move together before either merges. Stronger, and outside the child's edge ("nothing in the doperpowers repository beyond the one gate"): the mod declares the number it draws from in a file MAWS reads at the install path, and MAWS stops comparing releases | §A, `TO_HUMAN_MOD_DRAWS_FROM`; §I, item 5 |
| R2 | **The mod's pull request holds eleven gated places, and the plugin has no README.** Since 0.7.4 the `/to-human-dump` command calls `native()` too. `hooks/hooks.json` still describes the tool as "not under MAWS", stale since 8 | `to-human.tsx` at 0.8.2, the eleven lines listed in §I | The pull request changes `native()` alone, which moves all eleven; the rule's sentence goes into the plugin's `CLAUDE.md`; the stale description is named in the pull request's body and left | §I |
| R3 | **On the terminal the record line now reads a summary; in MAWS it reads `working record`.** 0.8.0 added a tracker that labels a stretch with a summary a model call writes (`folds.tsx`); it is quiet under any non-empty advertisement, so at 9 the mod's own line in MAWS is the fallback. The mirror cannot have a summary at all: it lives in the engine's plugin state | `foldLabel` (lines 1164 to 1171), `isQuiet` (`folds.tsx`, line 592) | `working record`, the child's words, on both routes. The owner's card 1 offers the alternatives | §D, `VIEW.record` |
| R4 | **`drawnBy` is on the wire, so this landing takes a wire minor.** The root's UC-8 row for `src/shared/ipc/wire.ts` does not name U2b | `commands.ownerChannel.state` and `events.ownerChannel.changed` are in the manifest with `additionalProperties: false` on `lane` | One optional key, one minor, the two generated files made again before the gate; two cross-build runs owed (§F) | §F; the root's UC-8 row |
| R5 | **The launch's number must be stored.** The child's file gives UC-13 "one number and one field". Without the stored number a restarted daemon publishes `maws` for a session the mod is drawing, and both draw | the owner service keeps a launch only in `owner_channel_sessions`; the engine host outlives the daemon (`e2e/cross-build.spec.ts`, "(update, mawsd restart)") | A nullable added column, no migration, with a row in the cross-build coverage table | §A; §F |
| R6 | **Going back while the mod draws a session.** An earlier build's window on a session this build launched at 9, with a drawing release installed, shows its own bar and report and the mod's drawing together, until that session's next launch (which the earlier build makes at 8). Nothing in an earlier build can prevent it | F and the installed build draw their report without consulting any mod (the child's file, "Not a removal"); the engine keeps its launch's environment | Accepted and said in the going-back note; restarting such a session ends it. It can only arise after the owner merges the mod's pull request. Card 2 | §H, row 5 |
| R7 | **A session on another machine has no readable lane.** A12 and A13 name that route, but `ownerLane` is false there today and the report never applies | `remote-unavailable.ts`: `ownerChannel.state` "not yet"; `TranscriptSlot.tsx` reads the lane from `useOwnerChannel` alone | This app's switch (decision 6). The desk web app already treats every session view as lane-on. Card 4 | M2, "The lane of a session on another machine" |
| R8 | **A terminal session nobody drives has no composer.** UC-8 names one mount, in `composer/Composer.tsx`; the holder notice stands in the composer's place, so that session would have no switch and no way to the full transcript | `SessionPane.tsx`, `noticed ? <HolderNotice …/> : <Composer …/>` | A second mount of the same component in `SessionPane.tsx` (U1's file), one line, in the hunk the bar's mount leaves | §K |
| R9 | **The desk web app is more than two imports.** It has its own bar, which stays; its session view draws the mirror from its next deploy on; eight of its e2e scenes pin today's rows | §L lists the files and the scenes | The bar's words and stylesheet are kept for it; the scenes' expectations are edited; no other file under `apps/desk-web/src/` changes; nothing is deployed. Card 7 | §L |
| R10 | **Where the mod draws, some rows cannot be asked about.** The child's file has MAWS "ask the mod about every row it would otherwise decide alone" and says MAWS cannot read the mod's fold. A thought, an agent listing, a scheduled trigger's and a wake's notice (the engine draws them through no `UserMessage` site, so U3a's rows ask nothing for them) and the turn's line have no site. Left alone they stand in sight inside a folded record | `transcript/view/rows/Row.tsx` (which rows mount a surface row); `adapters.ts`, `engineUserProps` returns null for a carrier with no envelope | Decision 13. Check 1 records what the lead's answer looks like in each state, which is what the rule reads | §E, "Following the lead" |
| R11 | **Size.** About 120 files | "Size and review" | One landing as briefed; two pull requests recommended | "One pull request or two" |
| R12 | **A16 names build F; the owner's machines run `2c7044231`.** | the brief | The look of A16 is taken on both, and the mod's test at 8 covers both (each advertises 8) | Proof, 6 |
| R13 | **Two places where the mirror and the mod read "in force" differently.** At start the mod looks for a message only since the last compaction; the mirror reads the rows the window holds. And the mirror's reading is the loaded history, so a session whose only messages are in pages not yet loaded reads as a plain transcript until they load | `sentMark` and `$.session.messages()` (lines 1271 to 1282); the store's paged history | Accepted; both are in §E's list of known differences | §E |
| R14 | **Two small losses.** The action cannot be hidden per session (the action registry is global), so where the mod draws it is listed and does nothing; UC-6 says "not offered". And "Mark all read" goes with the bar: it was the only place that marked every legacy item read at once | `keymap/actions-runtime.ts`; `ReportBar.tsx`, `markAllReadOrSay` | As written (decisions 19 and 20) | M2 |

## Questions for the owner

Seven cards, most consequential first. Each names what its answer changes; none blocks M1 or M3.

1. **What should the fold line say?** In the terminal the mod's line now carries a summary of the stretch. In MAWS it cannot yet.
   - *`› working record`* everywhere in MAWS (recommended): what the mod itself draws under MAWS today; no model call; every stretch reads the same.
   - *What was done, counted:* `› Read 2 files, edited a file, ran 3 commands`, from the caption MAWS already builds for a turn. More to read at a glance, at no cost; but they are MAWS's words in the mod's place, and only where MAWS draws.
   - *The mod's summaries in MAWS:* the mod's pull request lets the tracker run at 9. Sessions the mod draws read as the terminal does; a terminal session seen in MAWS still reads `working record`; every stretch costs a model call on the owner's account.
   Changes: §D, `VIEW.record` and the record line's label; the third also §I.
2. **Going back to an earlier build while the mod is drawing a session.** That session then shows both drawings until it is restarted.
   - *Accept it* (recommended): it needs the mod's change merged, this build used, and a going back with such a session still running; restarting the session ends it.
   - *Hold the 9:* this build draws every route itself, by the mirror, until no earlier build is kept to go back to. Nothing is ever drawn twice; the mod draws nothing in MAWS until then.
   Changes: M4's last step (the constant stays unset).
3. **Rows the list of what stays and what folds does not name.** Recommended: the person's own `!` command stays; a browser action and an agent listing fold (they are tool calls); a retry line and a plugin's notice fold; an error stays.
   - *As recommended.*
   - *Browser actions stay in sight,* as they do through a turn's fold today.
   - *Every error line folds except an API error,* the mod's own rule to the letter.
   Changes: §B's table, the rows marked "decided here".
4. **A session on another machine: is the view on?** MAWS cannot read that machine's switch.
   - *This app's switch decides* (recommended).
   - *Always on once the session holds a message,* as the desk web app does.
   - *Off there* until the switch can be read: a plain transcript.
   Changes: M2, one function.
5. **A thought with nothing around it** (the agent thought for fourteen seconds, then messaged).
   - *It folds* under a record line like any work (recommended): the rule has no exception, and the report shows only what the person reads.
   - *It stays in sight* as `Thought for 14s`.
   - *It is not drawn in the report at all,* and is read in the full transcript.
   Changes: §B, the `thinking` row.
6. **The frame of the switch where MAWS draws it.** The mod's own switch sits inside the mods' band, a bordered box above the composer.
   - *The same box* (recommended): the two routes look the same.
   - *A bare line:* lighter, and different from a session the mod draws.
   Changes: §D, the switch's frame.
7. **The desk web app keeps its Report · Transcript bar.** Its source is out of this wave's scope.
   - *Keep it* (recommended) and register a desk ticket.
   - *Replace it now* with the same switch line: a change to the desk's source and a deploy decision.
   Changes: §L.

## The drawn example

**Yes: before M2 is built.** The owner reads this surface all day and wrote the mod, and the frame of 2026-11-12 that showed the folded view (U2a's example, frame 8) was drawn before the message's look, the switch and the mod's 0.8 line were settled. M1 and M3 do not wait for it: they have no look.

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
| **A12** a message is the mod's drawing | `owner/view/message.test.tsx`: the label, its colour token, the indent, one component for a span and for a call; `transcript/surface/presentation-local.test.tsx` and `output-style.test.tsx` edited; the scenes of `e2e/to-human.spec.ts` | M2, M5 |
| **A13** one fold per stretch, on three routes | `owner/view/mirror.test.ts` (§B's table row by row, the stretch's edges, the keys) and `lane-a/view-routes.test.ts`: one recorded session drawn from its wire, from its transcript file and from another machine's rows gives the same mirrored rows; the scene "the to-human view folds by stretch" | M1, M5 |
| **A14** no bar; the switch above the composer | `session/SessionPane.test.tsx` (no `[data-owner-bar]`), `owner/view/switch.test.tsx`, `composer/Composer.test.tsx` (the mount beside the band), the scene of `e2e/transcript.spec.ts` | M2, M5 |
| **A15** where the mod draws MAWS adds nothing; the same before and after a relaunch | `transcript/surface/mod-route.test.tsx` over check 1's fixtures: no record line, no switch and no message drawing of MAWS's beside the mod's; the trial scene, which also quits and reopens the session at rest and compares the two readings, fold states aside | M4; Proof, 3 |
| **A16** an earlier build is not drawn twice once the mod's change merges | the mod's test at 8 (§I); one look on each earlier build | §I; Proof, 6 |
| **A18** not worse on a long session | the derivation budget read before and after with a lane-on session of 500 turns; the anchoring scene's bound of 40 mounted rows in the mirrored view (a new unconditional scene); the measured anchoring scene base against landing; check 5 where the mod draws | M1, M5; Proof, 2, 3 and 4 |

Behaviour this landing must hold that the child's acceptance does not state, each pinned by a test named in its milestone:

- **Exactly one side draws** in every row of §G, and at every step of a reload sequence under a launch at 9 (a drawing release, an older one, a drawing one again).
- **The cutover** (§H): a session running across the update, a session resumed from a file of an earlier build, this build's window on an earlier daemon, and an earlier window on this build's daemon each draw what §H says.
- **A waiting request is never inside a record** (UC-3), by row kind, waiting or answered.
- **A jump lands in sight** on both routes: where MAWS draws, the record that holds the target opens; where the mod draws, the target is revealed, and the reveal ends when its row leaves the mounted rows.
- **A record stays open while its first row changes shape** (one call becoming a run, one read merged with the next).
- **Before the first message, and with the lane off, nothing changes:** the plain transcript with MAWS's turn fold, as U2a left it.

## Constraints that bind every milestone

- **The laws.** 2: where the mod draws, MAWS adds no record line, no switch and no drawing of a message; where none can, MAWS mirrors, and every clause of the mirror cites the mod's function it ports, at 0.8.2, in a comment (§B). 3 and 4: no setting, no new view mode. 5: every proof of the mirror draws by the three routes. 6: nothing about what the mod answers is coded before check 1 recorded it; nothing about the engine beyond the fixtures. 7: today's tokens and shapes; no colour, radius or font size written as a value. 8: l2-transcript-14, -10 and -17 are `keep`.
- **UC-1.** The only reading of "waits" is `selectWaitingByCall`. **UC-2.** This landing classifies no arrival: it reads the row kinds and fields U3a's reader produced. **UC-3.** Requests' rows are U1's, arrival and message rows and `view/Transcript.tsx` are U3's: this landing's edits in `Transcript.tsx` are the composition that `reportRows` has today, and the reveal's end. **UC-6.** No chord and no action id is added.
- **UC-8.** The insertions in files another child owns are those of §K and no other.
- **UC-11.** Fixtures, tests and comments use invented text. Nothing of the drawn example enters the repository. Check 1's fixtures are recorded from an invented conversation in a scratch config home.
- **UC-13.** No commit before M4's cutover makes any launch advertise 9.
- **UC-14.** Neither settings file and no layout key is touched. The one stored value is §F's column.
- **Tokens.** The tokens guard reads `#` followed by three to eight hex digits as a colour in renderer source: a ticket is written in words there ("ticket 332").
- **Copy.** Every string a person reads is in `owner/view/copy.ts`, exactly as §D gives it.
- **Where checks run.** Nothing is installed, typechecked, linted, tested or built on the MacBook; every check runs on the build VM in a checkout of the pushed head. An executor runs no `scripts/ci-gate.sh`, opens no pull request, starts no Electron and no engine.
- **The mod's repository and the plugin cache.** Read only from MAWS's side. The mod's pull request is prepared in a worktree of that repository by whoever the architect dispatches for it; nothing is ever written into a plugin cache.

## Plan of Work

Five milestones in MAWS, one work item beside them (P, the mod's pull request), and one step that is not an executor's (Step 0, check 1). M1, M2 and M3 depend on nothing outside the repository and are built before check 1 answers. M4 waits for check 1 and for P's branch to exist. M5 closes. Each milestone ends with the tree green on the VM by the build brief's rule for a milestone (the typecheck of each project it changed, eslint on its files, vitest over the folders it touched and those that import what it changed, the tokens guard with any renderer source); the whole unit suite runs once, in M5.

**Step 0 — check 1** is "Checks handed to the architect", 1. Its answer fixes two constants of §A and confirms what §E reads. Until it answers, no code reads a mod's answer for anything it does not read today.

### M1 — The mirror: the fold by stretch on every route MAWS draws

**At its end.** In a session whose lane is on and that holds a message, the report folds by stretch: `› working record` at each stretch's first row, one click opens it onto the plain transcript's rows, `‹ fold to report` under the last, no turn is folded by MAWS, a turn's line has no chevron and shows only while a record of its turn is open, and a jump opens the record that holds its target. The same recorded session gives the same rows by the three routes. The bar is still there and still switches the view; a message still looks as it does today. Before a session's first message and with the lane off nothing has changed.

**What it touches.** New: `src/renderer/src/owner/view/mirror.ts`, `owner/view/RecordFold.tsx`, `owner/view/copy.ts` (the two record strings; M2 adds the rest), `owner/view/view.css`. Changed: `stores/transcript.ts` (the view state, the jump), `transcript/model/reduce.ts` (`TranscriptUi`), `rows.ts`, `keys.ts`, `serialize.ts` (the `record_fold` row in place of `owner_record`), `derive.ts` (a turn derives open under `noTurnFold`; `owner_record` leaves `isPersistentRow`), `transcript/view/Transcript.tsx` (the composition, the new row's estimated height), `view/rows/Row.tsx`, `view/rows/Divider.tsx`, `lane-a/view/drawn-rows.ts`. Removed: `owner/report/project.ts`, `owner/report/OwnerRecordRow.tsx` and their tests. Tests rewritten to the new rows: `owner/report/report-view.test.tsx`, `owner/to-human/MessageRow.test.tsx`, `stores/transcript.test.ts`, `lane-a/view/report-stream.test.ts`, `streaming-rows.test.ts`, `older-pages.test.ts`, `lane-a/source/appended-turn.test.ts`, `off-chain.test.ts`, `ask-answer.test.ts`, `attention/anchor.test.tsx`, `transcript/surface/assistant-ink.test.tsx`, `transcript/model/to-human.test.ts`. New tests: `owner/view/mirror.test.ts`, `lane-a/view-routes.test.ts`, one case of `transcript/model/perf.test.ts`.

**Interfaces.** Exposes §B and §C to M2, M4 and the desk web app. Consumes U2a's rows and U3a's row kinds (§J).

**Decisions.** 5, 7, 8, 9, 10, 12. Beyond them:
- *The mirror is applied last,* where `reportRows` is today: after the resting rows, the placed rows and the queue's tail, in `Transcript.tsx` and in `drawn-rows.ts` alike, from the same exported function, so the desk web app and lane A's helpers count the rows the list draws.
- *A streaming message counts.* A live text block whose buffer holds an open `<message>` is a message, by the live grammar that `liveMarkedRowIds` reads today (kept, moved into `mirror.ts`); a live row that is not the store's own block is read from its own text. So the view comes into force, and a streaming message comes into sight, at the mark's first characters, as today.
- *The flip.* `noTurnFold` and the first message arrive in one store update. The tests that count turn derivations (`transcript/surface/assistant-ink.test.tsx`, `stores/transcript.test.ts`, `transcript/model/derive.test.ts`) keep their rule and gain its other half: one derivation of every turn at the flip, none per token batch after it.
- *The jump.* `jumpTo` and the cell jump open the stretch that holds their target (`stretchHolding`) in place of the turn's record, when the view is the report, is in force and MAWS draws it. They still write `ui.revealed` and still open a run the target is in. `attention/anchor.ts` keeps calling `setView(key, 'report')`.
- *Pitfalls seen.* A row with no turn (standalone browser activity, placed by its time) is a row of the flat list like any other: the mirror reads no turn boundary except for a turn's line. The old projection counted a turn's unmarked messages by deriving the turn again; nothing here derives. `ui.reportOpenTurns`, `toggleReportRecord` and `foldedInReport` go; a test or a caller that still names them is this milestone's to move. The record line's first row can be a time separator's neighbour: decision 10's rule keeps the separator.

**What it does not touch.** `ReportBar` and how a message looks (M2). Any file under `src/shared/owner/` or `src/services/owner/` (M3). `transcript/surface/` (M4). `e2e/` (M5). `groups.ts`, `classify.ts`, `caption.ts` and the run's row (final since U2a). The snapshots under `test/snapshots/transcript/`: no row of a lane-off session changes shape, so none changes; a changed snapshot means a row changed that should not have.

**What it proves.** A13 by unit; A18's derivation half. And: §B's table, one case per row, each named for the row; the stretch's edges (a mixed message heads it; a waiting request's row splits it; a turn boundary does not); decision 8 (a record stays open while one call becomes a run and one read merges with the next); decision 10 (the running turn's line; a closed turn's line with and without an open record; the time separator); the jump into a closed record; the flip at the first streamed mark; nothing folded with the lane off, before the first message, and in the full transcript; `question`, `ask`, `plan` and `request_slot` never inside a record, waiting or answered.

### M2 — What a message looks like, the switch above the composer, and what goes

**At its end.** A message is `● message` in the accent colour over an indented body, one drawing for a span and for a message-tool call, with no bar and no "To you". The bar above the transcript is gone, with its unread count, its "Mark all read" and its mismatch note. The switch is one line above the composer, in the band's frame, drawn only while the view is in force; a terminal session nobody drives has it above the holder notice. A session on another machine has the view when this app's switch is on. The legacy cards are gone. The desk web app compiles against the moved words and stylesheet.

**What it touches.** New: `owner/view/Message.tsx`, `owner/view/Switch.tsx`, the rest of `owner/view/copy.ts` and `view.css`. Changed: `owner/to-human/Presenter.tsx`, `message-ink.ts`, `MessageRow.tsx`; `composer/Composer.tsx` and `session/SessionPane.tsx` (§K); `transcript/shell.tsx` (the action's handler), `widgets/plugins/BuiltInMods.tsx` (the mismatch sentence's import), `transcript/view/TranscriptSlot.tsx` (the lane of a session on another machine); `apps/desk-web/src/views/project/ReportToggle.tsx` (two import paths). Removed: `owner/report/ReportBar.tsx`, `OwnerReport.tsx`, `EssentialCard.tsx`, `InsightNote.tsx`, `QuestionCard.tsx`, `report.css`, `owner/to-human/presenter.css`, their tests, and of `owner/report/copy.ts` everything `answering.ts` and the request card do not read. Tests edited: `owner/to-human/Presenter.test.tsx`, `MessageRow.test.tsx`, `owner/report/answering.test.tsx` (its two cases that render the bar go), `transcript/surface/presentation-local.test.tsx`, `output-style.test.tsx`, `transcript/view/TranscriptSlot.test.tsx`, `lane-a/view/streaming-rows.test.ts`, `apps/desk-web/src/views/project/ReportToggle.test.tsx`. New: `owner/view/message.test.tsx`, `switch.test.tsx`, cases in `session/SessionPane.test.tsx` and `composer/Composer.test.tsx`.

**Interfaces.** Exposes §D to M4. Consumes §C.

**Decisions.** 6, 15, 16, 17, 19, 20. Beyond them:
- *The message's wrapper keeps its class,* `owner-message-ink`: it is the locator of the message in a dozen unit tests and in the desk web app's scenes. What changes is what it draws: a label element that holds the words `● message`, then the body indented by two columns, the columns and rows of `engine-surface/style.ts` (a column is `1ch`, a row `1lh`; `claude` is `var(--accent)`; bold is weight 600), so the mirror measures as the mod's own tree does when MAWS draws it.
- *The label follows `spanRows`.* The first message of a reply's first text block reads `● message`; a later message of the same block reads `message` under the same indent; a message still streaming reads its label followed by ` …`. A message-tool call reads `● message`.
- *The lane of a session on another machine* is one function in `TranscriptSlot.tsx`: the owner channel's `lane.on` when the channel answers, else, for an address of another machine, this app's `mods.toHuman.enabled`, else off.
- *The switch is absent,* not disabled, before the first message, with the lane off, in a subagent's transcript, and (from M4) where the mod draws.
- *Pitfall.* `answering.test.tsx` renders the bar to reach "Mark all read"; that path goes with the bar (R14), and `ownerChannel.markRead` keeps its single-item caller in the request card.

**What it does not touch.** The mirror's rule (M1). Any site ask (M4). The desk web app beyond the two import paths. `src/shared/keymap/actions.ts`.

**What it proves.** A12 and A14 by unit. And: the switch's four absences; its two words for the two views; the second mount above the holder notice; the lane's three sources; no element of the old bar, the old record row, a card or "To you" in any mounted pane.

### M3 — Who draws: 9 and 8, `drawnBy`, the launch's number kept, the wire minor

**At its end.** The owner channel publishes `drawnBy` with a session's lane, decided by §A's two pure functions; a launch's advertised number is kept with its launch in the index; the wire has one more minor. `TO_HUMAN_CONTRACT_VERSION` is 9 and the mods list reads "Version 9". Every launch still advertises 8, because the constant for the first drawing release is unset: nothing a person sees changes but that version.

**What it touches.** `src/shared/owner/contract.ts`, `state.ts`, new `src/shared/owner/draws.ts`; `src/services/owner/resolve-style.ts` (the releases of the applicable installations), `launch.ts` (the number, in the decision and in the record), `store.ts` (the column), `service.ts` and `register.ts` (the status's subscription, the published field); `src/services/sessions/launch-mapping.ts` (the number written); `src/services/index/migrations.ts` (`ADDED_COLUMNS`); `src/shared/ipc/wire.ts` and the two generated files; their tests, and the tests that pin 8 by its digit (`src/shared/owner/contract.test.ts`, `src/services/owner/launch.test.ts`, `src/services/sessions/service.test.ts`), which pin `TO_HUMAN_MIRROR_VERSION` by name afterwards.

**Interfaces.** Exposes §A to M4. Consumes the engine's status (`src/shared/engine/status.ts`).

**Decisions.** 1, 2, 3, 4, 21, 22. Beyond them:
- *Where the service learns the status.* The owner service subscribes to the engine host's `session.status` beside its `session.eventBatch` subscription (`register.ts`), and reads a session's current status once when it first publishes for it, so a daemon that has just started is right before the next status event. It publishes again only when `drawnBy` changed.
- *Sequences* (each a test that holds the order open, not only the end state): the launch is recorded before its first status arrives, and the reverse; a status of an older launch arrives after a newer launch was recorded (ignored: its `launchId` differs); a reload's status arrives while the launch record is being written; the process exits while a reload's answer is in flight (the exit wins: `maws`); the store cannot be read (the published field is `maws`, and the launch that could not be recorded advertised what it advertised: the next read of the row decides).
- *Authorization.* `drawnBy` is read-only state published to whoever may read the session's owner channel already; no new command, nothing a remote caller can set.
- *Pitfall.* An earlier build's `recordLaunch` leaves the added column as it was. The reader compares the stored launch id with the row's `launch_id` and treats a mismatch as no value.

**What it does not touch.** The renderer. Any constant's value that would make a launch advertise 9.

**What it proves.** The rows of §G that M3 can reach (the constant is injected in tests); `advertisedFor` and `drawnBy` case by case; the stored value's round trip through an earlier build's write (the launch id mismatch); the wire's manifest test green with one added optional key and nothing removed; the tolerant reader dropping `lane.drawnBy` for a schema that does not know it.

### M4 — Where the mod draws: full sites, the message call's ask, following the lead, the reveal's end; the cutover

**Starts when** check 1 has answered and P's branch exists.

**At its end.** In a session MAWS runs with a release that draws at 9, the messages, the record lines and the switch are the mod's; MAWS draws no record line, no switch and no message of its own, applies no projection, and folds no turn. The run's row is a full site: an answer without the engine's drawing replaces the run, an answer that keeps it draws MAWS's run in that place. The message call asks `ToolUse`. A thought and a turn's line follow their stretch's lead. A jump's target is revealed, and the reveal ends when its row leaves the mounted rows. A launch advertises 9 when §A says so.

**What it touches.** `transcript/surface/Rows.tsx` (`SurfaceGroupRow`; a surface row for `to_human`), `adapters.ts` (the message call's input), new `transcript/surface/stretch-drawing.ts` (what each asked row last reported), `transcript/view/Transcript.tsx` (the mod route's composition; the reveal's end), `view/rows/Row.tsx`, `transcript/view/TranscriptSlot.tsx` (`modDraws`), `stores/transcript.ts` (`modDraws`, `clearRevealed`), `owner/view/Switch.tsx` (absent where the mod draws; the action's no-op), `src/shared/owner/contract.ts` (the constant, and the failed list if check 1 filled it). Tests: `transcript/surface/rows.test.tsx`, `adapters.test.ts`, `revealed.test.tsx`, `engine-surface/SurfaceRow.test.tsx` where it pins the drawing-only group; new `transcript/surface/mod-route.test.tsx` over check 1's fixtures.

**Interfaces.** Consumes §A, §B, §C, §D and check 1's fixtures. Exposes §E.

**Decisions.** 13, 14, 21. Beyond them:
- *The asks do not depend on who draws the view.* Every ask is made whenever a surface is attached, as today; a mod that is not the to-human mod can now replace a run too (the child's departure from Desktop). What depends on `modDraws` is only what MAWS adds: the mirror, the switch.
- *The cutover's order inside the milestone:* the renderer's part first, with `modDraws` false everywhere because no launch advertises 9; then one commit that sets `TO_HUMAN_MOD_DRAWS_FROM` (and `TO_HUMAN_MOD_FAILED` if check 1 says so). If check 1's verdict is that the release cannot hide a run, that commit puts the release on the failed list and sets the constant all the same: sessions stay on the mirror, and the owner is told (the child's file, check 1).
- *Sequences* (tests that hold them open): the surface attaches after the mirror has drawn (the mirror goes when `modDraws` turns true, in one update with the first asks, and the rows it had hidden are mounted to ask); the surface goes while a record is open in the mod's view (the mirror draws, every stretch closed: fold states are not carried); `drawnBy` turns `maws` under a live surface (a reload to an older release: the mirror draws while the asks go on and are answered with the engine's drawing); a lead's answer never comes (the surface row shows its placeholder as it does today and its stretch counts as not shown: nothing of the stretch that asks no site is drawn until an answer arrives or the surface goes, and when the surface goes the mirror draws); a jump lands while its target's ask is in flight (the target is revealed and draws MAWS's own; the late answer is dropped, as `revealed.test.tsx` pins for the existing asks).

**What it does not touch.** `engine-surface/SurfaceRow.tsx` and `SurfaceTree.tsx` (the full site is the existing component without `drawingOnly`). The mirror's rule. The mod.

**What it proves.** A15 by unit, over check 1's fixtures. And: each row of §E's table; the reload sequence of §G at each step; decision 14 by the list's range; the action's no-op; that with `modDraws` true no element of `RecordFold` or `ViewSwitch` is in the document.

### M5 — The e2e edits and scenes, the cross-build scenes, the record, and the acceptance run

**At its end.** Every scene that pinned the bar, the old record row, "To you" or the digit 8 states the new behaviour; the new scenes exist, typechecked and not run; the documents that held the reversed rulings carry their dated lines; the whole unit suite is green on the VM.

**What it touches.**
- `e2e/transcript.spec.ts`: "the report folds work while marked text retains its authored flow and geometry" is rewritten to the stretch fold and the switch (its fixture stays); "R3 owner to-human draws every span as Markdown…", "detached owner recording keeps one authored Markdown flow…" and the three "M3 owner sitting preserves…" cases are read again against the message's new drawing (their recorded mod draws a button named `working record`; the mirror's line is `› working record` and is absent there, the lane being off); the R3 `ToolGroup` case states the full site. New, unconditional: "the to-human view folds by stretch, opens, folds again, and a jump opens the record that holds its target"; "the mirrored view mounts at most 40 rows while 500 turns stream".
- `e2e/to-human.spec.ts`: the Needs-you jump's assertion on the bar becomes the open record; the literal `'8'` becomes the name; the message's locator stays.
- `e2e/widgets.spec.ts` ("Version 8" becomes 9). `e2e/maws-tools.spec.ts` and `e2e/design-systems.spec.ts`: their click on the bar's "Transcript" becomes a press of the switch when it is there. `e2e/library.spec.ts`: its conditional click goes.
- `e2e/to-human-live.spec.ts`: rewritten as the trial (Proof, 3).
- `e2e/cross-build.spec.ts`: two scenes (§H).
- `apps/desk-web/e2e/`: the eight scenes of §L.
- The record (below), and the row of the cross-build coverage table in `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md`.

**Decisions.** 18. Before the hand-back, because the diff touches `e2e/`, the gate's own script tests run on the VM (the build brief names them): they pin how many spec files exist (none is added or removed) and read a time bound in a scene by its form.

**What it does not touch.** Product code, unless a scene shows a defect; then the fix goes to its milestone through the controller. Any measured bound. `package.json`'s scripts.

**What it proves.** It writes the e2e halves of A12 to A15 and A18; they are proved when the architect's runs are green. By its own run: typecheck, lint and the whole unit suite.

Under a ruling for two pull requests (R11), the scenes of `e2e/transcript.spec.ts`, `to-human.spec.ts`, `maws-tools.spec.ts`, `design-systems.spec.ts`, `library.spec.ts` and the desk web app's go with the first; `widgets.spec.ts`, `to-human-live.spec.ts`, `cross-build.spec.ts`, the R3 `ToolGroup` case and the record go with the second.

### P — The mod's pull request

Not a MAWS milestone: a branch in a worktree of the doperpowers repository, holding exactly Interfaces §I, with the mod's own suite green. It is prepared before Step 0 (check 1 runs against it), opened by the architect after check 1, and merged by the owner whenever they choose. Nothing in MAWS reads it but the trial.

### The record (in the same pull request, UC-10)

| reversed | where it stands | the dated sentence |
|---|---|---|
| O-30, O-06 | `docs/doperpowers/plans/2026-10-08-p2-c-to-human.md`, Design §7 and §8, and its parent's Decision Log 19 | "2026-11 (UX wave, U2): the report is the to-human mod's view: drawn by the mod where it can draw, and by MAWS applying the mod's per-stretch rule elsewhere; the control at the top is removed." |
| O-13 | `docs/doperpowers/evidence/p4/ux-wave/ux-directions.md` (the owner's ruling of 2026-10-24, "MAWS keeps the advertisement unchanged"), and the P2-C document's Design §3 | "2026-11 (UX wave, U2): MAWS advertises 9 at a launch whose view the mod draws, and 8 where MAWS draws it. From 9 the mod's view draws on MAWS's surfaces; below 9 it steps aside. The message tool's rule (8 and up) is unchanged." |

Also: a dated line where the owner channel's state is defined (the P2-C document, X18), for `drawnBy`; the wire minor's own comment in `wire.ts`; and tracker rows in `docs/tech-debt-tracker.md` for the divider's unread `toolCalls` (decision 12), the lane of a session on another machine (R7), the known differences of §E, and the desk web app's bar. The register's rows and the board tickets (#608, #332) are the architect's at landing.

## Concrete Steps

All in the worktree of branch `ux-wave/U2b`. `vm` stands for the build brief's helper with this branch's name (`vmcheck.sh ux-wave/U2b -- '<command>'`): it runs its command on the build VM in a checkout of the pushed head and exits with the command's status. Never pipe it into `tail` or `head` without `set -o pipefail`. The VM is shared with a landing in build: a slow or timed-out check is read against its load first. Every command there runs under `timeout`.

1. **Base** (before M1, before M4, before M5, and once more before the hand-back). Merge, never rebase, never force-push:

       git fetch origin master && git merge origin/master
       git grep -n "export function GroupRow" origin/master -- src/renderer/src/transcript/view/rows/Group.tsx
       git grep -n "revealed" origin/master -- src/renderer/src/transcript/model/reduce.ts
       git grep -n "PluginBand" origin/master -- src/renderer/src/composer/Composer.tsx
       git grep -n "selectWaitingByCall" origin/master -- src/renderer/src/stores/attention.ts
       git diff --stat origin/master -- src/renderer/src/transcript/index.ts src/renderer/src/transcript/index.test.ts

   The first four must answer; the last prints nothing. Then read "What is assumed of landings in flight" against what the merge brought. A row kind the merge added fails the typecheck of `mirror.ts` until it is classed (§B).

2. **Checks, per milestone**, after `git push`:

       vm 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # M1, M2, M4
       vm 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'    # M3, and M4's one constant
       vm 'timeout 600 pnpm exec eslint <the paths changed>'
       vm 'timeout 900 pnpm exec vitest run <the folders of the milestone> test/support/tokens-guard.test.ts'

   The folders: M1 and M2, `src/renderer/src/owner src/renderer/src/stores src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/attention src/renderer/src/session src/renderer/src/composer src/renderer/src/widgets apps/desk-web/src/views/project apps/desk-web/src/depth`; M3, `src/shared/owner src/shared/mods src/shared/ipc src/shared/machine src/services/owner src/services/sessions src/services/index`; M4, `src/renderer/src/transcript src/renderer/src/engine-surface src/renderer/src/owner src/renderer/src/stores src/shared/owner`. Expect `Test Files  N passed` and no failure. The set that fails on master too is the build brief's list and is not this landing's.

3. **The wire's files** (M3, and again after a merge that moved `WIRE_MINOR`). Read `WIRE_MINOR` in `src/shared/ipc/wire.ts` after the merge (46 at this document's base), take the next number, and add to its comment "the UX wave, U2b: the owner channel lane's drawnBy (N)". Make the two generated files on the VM and bring them back as a patch, by U2a's Concrete Steps 3 with this branch's name (`pnpm wire:manifest` there, `git diff` of `src/shared/ipc/wire-manifest.json` and `wire-fingerprint.json`, `git apply` here). Expect a patch that touches those two files, changes the two `ownerChannel` entries and the minor, and removes nothing. If `wire.test.ts` says "breaking change", a schema was narrowed: stop and report. Then, because a command's and an event's schema changed: `vm 'timeout 600 pnpm exec vitest run src/shared/machine'`.

4. **The derivation budget, before and after** (before M1's first commit and at M5's head; a relative reading):

       vm 'timeout 600 env MAWS_PERF=1 pnpm exec vitest run src/renderer/src/transcript/model/perf.test.ts'

   Write both printed lines into Surprises & Discoveries, and M1's new case's line (a lane-on session of 500 turns with a message in each, mirrored). If the head reads more than a fifth above the base, stop and report.

5. **Check 1's fixtures** (M4). They are on master or on this branch before M4 starts, under `spikes/protocol-probe/fixtures/uxwave/`. `mod-route.test.tsx` loads them by name; it invents no answer. If a recorded file is added or edited on this branch: `vm 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'`.

6. **Acceptance** (M5). The suites of "Acceptance" by name; then

       vm 'timeout 1200 pnpm typecheck'
       vm 'timeout 900 pnpm exec eslint src/renderer/src/owner src/renderer/src/transcript src/renderer/src/stores src/shared/owner src/services/owner e2e apps/desk-web/e2e'
       vm 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vm 'timeout 2400 pnpm test'

   and on the MacBook, each printing nothing:

       git grep -n '"To you"' -- src apps
       git grep -n "owner_record\|OwnerRecordRow\|ReportBar\|reportOpenTurns" -- src e2e
       git grep -n "Working record ·" -- src/renderer e2e

   The desk web app keeps its own "Working record · …" label in its conversation view and the scenes that read it; they are outside these paths and stay.

7. **Stop and hand back** with: the head's sha; each command above with its result; what was not verified; the decisions made beyond this document; the scenes written and not run; any `gitleaks.toml` entry. The executor runs no `scripts/ci-gate.sh`, opens no pull request, and starts no Electron and no engine.

## Interfaces and Dependencies

§A to §E are what M1 to M4 produce; §F to §H are what crosses builds and versions; §I is the mod's pull request; §J to §L are the other landings and the desk web app.

### §A. Who draws (M3; the cutover's constant in M4)

In `src/shared/owner/contract.ts`:

    export const TO_HUMAN_CONTRACT_VERSION = 9;                        // advertised where the mod draws the view
    export const TO_HUMAN_MIRROR_VERSION = 8;                          // advertised where MAWS draws it: every release steps aside and registers its tool
    export const TO_HUMAN_MOD_DRAWS_FROM: string | null = null;        // the first release whose view draws at 9; M4 sets it to the mod's pull request's number ('0.9.0' as proposed)
    export const TO_HUMAN_MOD_FAILED: readonly string[] = [];          // releases check 1 found unable to hide a run; read at launch only

In `src/shared/owner/draws.ts` (new, pure, no I/O):

    export type DrawnBy = 'mod' | 'maws';
    export function drawsAtNine(release: string | null): boolean;
    export function advertisedFor(installed: readonly (string | null)[]): 8 | 9;
    export function drawnBy(
      launch: { launchId: string; advertised: number } | null,
      status: Pick<EngineSessionStatus, 'launchId' | 'process' | 'plugins' | 'pluginsObservedAt'> | null,
    ): DrawnBy;

`drawsAtNine`: false while the constant is null, for null, and for anything that is not dotted numbers; else a part-by-part comparison with the constant. `advertisedFor`: 9 when the list is not empty, every entry draws at nine and none is on the failed list; else 8. `drawnBy`:

| the launch's number | the engine's status | drawn by |
|---|---|---|
| none kept, or below 9 | any | `maws` |
| 9 | none, or of another `launchId`, or `process` is `exiting` or `exited` | `maws` |
| 9 | this launch's, plugins not yet reported (`pluginsObservedAt` null) | `mod` |
| 9 | reported, a plugin named `to-human` whose `version` draws at nine | `mod` |
| 9 | reported, a plugin named `to-human` whose `version` is null or no dotted number | `mod` (the launch decided on parsed releases; an unreadable report does not overturn it) |
| 9 | reported, `to-human` at an older release | `maws` |
| 9 | reported, no plugin named `to-human` | `maws` |

The failed list is not read here: a listed release that a reload loads under a launch at 9 does draw, and MAWS must not draw beside it (the child's file, O-13).

`OwnerChannelStateSchema.lane` gains `drawnBy: z.enum(['mod', 'maws']).optional()`. This build always sends it; absent reads as `maws`. `ResolvedStyle` gains `toHumanReleases: (string | null)[]`, the `version` of each install record `pluginInstallPaths` accepts for the `to-human` plugin. `OwnerChannelFlags` gains the number to write (`advertise: 8 | 9`), which `withOwnerChannel` writes in place of the constant. `LaunchDecision` and `LaunchRecord` gain `advertised: number`. `OwnerSessionRow` gains `advertised: { launchId: string; number: number } | null`, read from one added column:

    { table: 'owner_channel_sessions', column: 'advertised', definition: 'TEXT' }   // ADDED_COLUMNS, src/services/index/migrations.ts; JSON {"launchId": "...", "number": 9}

A value that does not parse, or whose `launchId` is not the row's `launch_id`, is no value.

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
| `thinking` | folds | no site; the agent's work. *Decided here* (card 5) |
| `subagent` | stays | `isSpawn` (598): `Agent` and `Workflow` |
| `question`, `ask`, `plan`, `request_slot`, waiting or answered | stays | `isRead` for `AskUserQuestion` and the ask tools; UC-3 for a waiting form |
| `agent_message` (to or from a subagent, between sessions, one the agent sent) | folds | `promptRow`: a row with `from` is `record`; a sent message is a tool call |
| `notice`, class `answer` | stays | `ASK_DELIVERY` (378): the person's answer is `user` |
| `notice`, class `task`, outcome `failed`, whose `toolUseId` is the call of a `subagent` row among the rows | stays | `promptRow`'s first clause: a failed task of a spawn the transcript shows is `marked` |
| any other `notice` (a task's end, a scheduled trigger, the bridge's wake) | folds | `promptRow`: a row with `task` is `record`; `DELIVERED` |
| `error`, severity `error` | stays | `isApiError` (616): an API error is `marked` and ends a run; the mod is never asked about another error |
| `error`, severity `transient` or `notice` | folds | *Decided here* (card 3) |
| `boundary`, `gap`, `local_command`, `artifact`, `delivery`, `side_thread` | stays | the child's table: rows MAWS draws that the mod is never asked about |
| `agent_list`, `browser_action`, `browser_activity` | folds | tool calls. *Decided here* (card 3) |
| `time`, `divider` | member of no stretch | decision 10 |
| `receipt` | draws nothing today | |
| `record_fold` | the mirror's own row | |

The class is one exhaustive `switch` over `Row['kind']` with no default branch.

**In force:** the lane is on and the rows hold a row classed `stays` or `mixed` that is an `assistant_text` or a `to_human`, a live text block with an open mark included (`isFolding`, 1512; `hasSeenMark` set at 1713 to 1718 and 1801 to 1804). **A stretch** is a maximal run of consecutive `folds` rows, the rows of no stretch between them included, headed by the `mixed` row directly before it if there is one; a `mixed` row with nothing folding after it is a stretch of its own (`runStart`, `runEnd`, 430 to 470). **Its key** is decision 8's. **Closed,** it draws its head with only its messages in sight, then one `record_fold` row reading `› working record` in the place of its first folding row. **Open,** it draws its head whole and every row as the plain transcript draws it, then one `record_fold` row reading `‹ fold to report` after its last row. All stretches start closed. In the full transcript nothing is folded.

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

`mirrorRows` is pure and is memoised by its callers on the rows' identity, the open set and the live marks, as the projection is today. It returns the rows unchanged when they hold no message.

Rows (`transcript/model/rows.ts`): `{ kind: 'record_fold'; stretch: string; open: boolean }` replaces `owner_record`, its id `rowId.recordFold(stretch, open)`; `assistant_text` gains `reportOnly?: true`, set by the mirror alone on a closed stretch's head.

View state (`TranscriptUi`): `openStretches: Set<string>` replaces `reportOpenTurns`; `noTurnFold?: boolean`; `modDraws?: boolean` (M4). `ownerLane`, `view` and `revealed` stay. Store actions: `toggleStretch(key, stretch)` replaces `toggleReportRecord`; `setToHumanView(key, { lane, modDraws })` replaces `setOwnerLane`; `setView` stays; `clearRevealed(key, id)` (M4). `drawnRows(key, tail, atRest)` and `useDrawnRowCount(key, atRest)` keep their names and signatures.

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

They are `STYLE`, `UNFOLD`, `FOLD` (555 to 564), `'fold to report'` (1218) and the band's caption and labels (1957 to 1963) of the mod. Components: `MessageView` (`owner/view/Message.tsx`: the label in `var(--accent)` at weight 600, the body under it indented two columns, in the normal text colour, as Markdown); `RecordFold` (`owner/view/RecordFold.tsx`: one button, muted, full contrast on hover, one row above it; `aria-expanded`; the lower line indented two columns); `ViewSwitch` (`owner/view/Switch.tsx`: the caption muted, the label a button, inside the frame `PluginBand` draws; its exported `toggleView` is the handler of `transcript.toggleReport`).

### §E. Where the mod draws (M4)

`modDraws` is true for a tab when the lane's published `drawnBy` is `mod` and the session's surface is attached in this window (`useSurfaceAttached`). A session on another machine never has it: its site asks do not cross the machine link.

| row | where the mod draws |
|---|---|
| a run (`group`) | asks `ToolGroup` as a full site: `SurfaceRow` without `drawingOnly`, MAWS's `GroupRow` as its own drawing. An answer with no engine slot replaces the run; one that keeps it draws the run there. `groupInput` is unchanged: a run that is a jump's target, holds one, or holds a waiting call asks nothing and is drawn by MAWS |
| a message-tool call (`to_human`) | asks `ToolUse` with the call's own props, built as a sent message's are (`sentInput`); MAWS's `MessageView` is its own drawing, so no hook, or a hook that keeps the engine's drawing, leaves the same look. No `ToolResult` is asked: MAWS draws no result row for it |
| a marked text, a prompt, an arrival, a sent message, a single call, a command's output, a question | as today (U3a's and earlier asks), with `MessageView` as a marked text's own drawing |
| a row classed `folds` that asks no site (a thought; a notice or a message line whose carrier the engine draws through no site; an agent listing; a browser row; a retry line) | drawn while its stretch is **shown** |
| a turn's line | drawn while a stretch that holds a row of its turn is shown, or the turn runs; no chevron |
| a stretch none of whose rows asks a site | folded by MAWS, by §B, with `RecordFold` and `openStretches` (law 2) |
| the switch, a record line of an asked stretch, a message | the mod's; MAWS draws none |

**Following the lead.** A stretch's lead is its first row that asks a site and is not the revealed row (its `mixed` head, when it has one). The lead's surface row reports through `onInk` whether MAWS's own drawing of it is in sight; `transcript/surface/stretch-drawing.ts` keeps each row's last report per session, as `carrier-drawing.ts` keeps a carrier's, and forgets a session's when its surface goes. A stretch is shown when its lead last reported its own drawing in sight; before the lead's first report it is not. So a folded stretch (the lead answered with the mod's line), a stretch the reader opened in the mod's view, the mod's full transcript and a session the mod is not yet folding all read correctly from one fact. Check 1 records the lead's answer in each of those states; if an opened stretch's answer does not hold the engine's slot, this rule cannot read it, and the default becomes: such rows and a turn's line are always drawn where the mod draws, said in Surprises & Discoveries and told to the owner.

**If check 5 reads over the bound,** the asked rows after the lead of a stretch that is not shown are not mounted either: one condition in the same composition (the child's remedy, "a hidden first row means a hidden stretch").

**The reveal's end.** `Transcript.tsx` reads the list's mounted range; when the revealed row's index is outside it, it calls `clearRevealed`. On both routes.

**Known differences between the mod's view and the mirror,** each a tracker row and a line of the trial's reading: fold states are not carried when a session starts or stops running; a jump opens the record where MAWS draws and reveals the row where the mod does; the mod looks for a session's first message only since the last compaction at its start; a stretch with no asked row keeps MAWS's record line in the mod's full transcript until it is opened; the record line's words where a later release of the mod summarises (card 1).

### §F. What is stored and sent, against both earlier builds

`git show f1852de3a:<path>` and `git show 2c7044231:<path>` give the same text, and the same as this document's base, for the three files this table rests on: `src/shared/owner/state.ts`, `src/services/owner/store.ts` and `src/shared/ipc/tolerant.ts`.

| what | an earlier build with this build's value | this build with an earlier build's | this build, then an earlier one, then this build |
|---|---|---|---|
| `lane.drawnBy`, on `ownerChannel.state` and `ownerChannel.changed` (the wire; one minor) | its main reads the supervisor's output with the tolerant reader, drops the key and keeps the state; its renderer draws its own report | absent: `maws` | nothing kept |
| `owner_channel_sessions.advertised` (the index; an added nullable column, `user_version` unmoved) | opens the index; reads the row with `SELECT *` by column name and ignores it; its `recordLaunch` updates the columns it names and leaves it | null: 8, `maws` | the earlier build's launch changed `launch_id`; the kept value's launch id no longer matches and reads as none |
| `MAWS_NATIVE_TO_HUMAN=9` in a launch's settings env (the engine's process, not MAWS's storage) | a session launched at 9 keeps it until it ends; an earlier window draws its own report beside whatever the mod draws (§H, row 5) | its launches carry 8 | this build's next launch decides again |
| the mods list's version (`mods.list`, an integer) | reads 9 where it read 8 | reads 8 | |
| either settings file, any layout key | untouched | | |

`ui.view`, the open stretches and the revealed row are the tab's, in memory, as `ui.view` is today: nothing of the view is stored.

**Two cross-build runs are owed,** one with each earlier build as the exact peer (`--peer-exact f1852de3a`, `--peer-exact 2c7044231`), over §H's two scenes. The row added to the coverage table (U13a's M5):

| stored | the peer reads this build's value, and writes on | this build reads the peer's value |
|---|---|---|
| `owner_channel_sessions.advertised` | *(to-human, to the peer)*: the peer opens the index, lists the session, launches it and records its launch | *(to-human, from the peer)*; the return of *(to-human, to the peer)*: the kept number no longer counts |

### §G. The matrix: an older mod, a newer mod, no mod, at 8 and at 9

One table an executor turns into cases (`src/shared/owner/draws.test.ts`, `src/services/owner/launch.test.ts`, `transcript/surface/mod-route.test.tsx`). "Drawing release" is one at or after `TO_HUMAN_MOD_DRAWS_FROM`.

| the mod, as the launch finds it installed | the lane | the launch advertises | the mod's view | its message tool | `drawnBy` | the view in a session MAWS runs |
|---|---|---|---|---|---|---|
| none installed, or not enabled, or the style is another | off | nothing | — | — | `maws` | no fold; a recorded message still reads `● message` |
| older than the drawing release (0.8.2 and before) | on | 8 | steps aside | registers | `maws` | the mirror |
| the drawing release, or a newer one | on | 9 | draws | registers | `mod` | the mod's |
| a release on the failed list | on | 8 | steps aside | registers | `maws` | the mirror |
| two installations apply, one older | on | 8 | steps aside | registers | `maws` | the mirror |

Under a launch that has advertised, after a reload:

| the launch advertised | the release now loaded | the mod's view | `drawnBy` | the view |
|---|---|---|---|---|
| 8 | any | steps aside | `maws` | the mirror |
| 9 | a drawing release | draws | `mod` | the mod's |
| 9 | an older release | steps aside (any non-empty value) | `maws` | the mirror |
| 9 | none | — | `maws` | the mirror |
| 9 | a release on the failed list | draws | `mod` | the mod's, until the session's next launch, which advertises 8 |

Not a session MAWS runs: a terminal session, a session on another machine and a session at rest are the mirror in every row.

### §H. The cutover

| | the situation | what is drawn | proved by |
|---|---|---|---|
| 1 | a session running across the update: launched by an earlier build at 8, its engine still running, this build's window and daemon on it | the mirror. No number is kept for the launch, so `maws`; the mod, whatever its release, steps aside at 8. The switch above the composer, no bar | *(to-human, from the peer)*, with each peer |
| 2 | a session resumed from a transcript an earlier build's session wrote | at rest, the mirror, from the file's rows (the file is the engine's and does not change with MAWS's build; the older marks and both message tools read as messages). Its resume is this build's launch and is decided by §A | `lane-a/view-routes.test.ts` over a recorded file; `owner/view/mirror.test.ts`'s cases for the older marks and `mcp__maws__message` |
| 3 | this build's window on an earlier build's daemon | the mirror: `drawnBy` is absent, and that daemon's launches advertise 8 | *(to-human, from the peer)* |
| 4 | an earlier build's window on this build's daemon, a session launched at 8 | that build's own report, once: the key is dropped, the mod steps aside | *(to-human, to the peer)*: nothing refused, the key among the dropped, the peer's bar and record row drawn |
| 5 | the same, a session this build launched at 9 with a drawing release installed (or: going back while such a session runs) | both drawings, until that session's next launch, which the earlier build makes at 8 (R6, card 2) | cannot be staged with a replayed engine: one look by the architect on the trial's Mac (Proof, 6) |

The two scenes of `e2e/cross-build.spec.ts`, each skipped only by the group's own conditions (a skipped scene is not evidence): *(to-human, from the peer)*, in which the peer keeps a lane-on session whose recorded transcript holds a message and work, this build attaches, and the transcript shows the record line and the switch, no bar, and no refusal in either log; *(to-human, to the peer)*, in which this build launches such a session with a scratch config home whose style and install record are written by `test/support/to-human-plugin.ts`, the record naming a drawing release (so the launch's spawn row carries 9 and the index keeps it), quits, the peer opens the profile, draws its bar and its record row, launches the session again, quits, and this build reads the session back with `drawnBy` `maws`.

### §I. The mod's pull request (doperpowers; read at the installed 0.8.2)

Exactly this, and nothing else.

1. `to-human/hooks/mods/to-human.tsx`, `native()` (lines 1450 to 1455). Today it is true when the value is non-empty and the surface is not the terminal. After, it is true when the value is non-empty **and is not a number of 9 or more**, and the surface is not the terminal:

       const MAWS_DRAWS_FROM = 9
       let maws: Promise<boolean> | undefined
       const native = async ($: EngineInterface, e: object) =>
         (await (maws ??= $.env.get('MAWS_NATIVE_TO_HUMAN').then(
           (value) => value !== undefined && value !== '' && !(Number(value) >= MAWS_DRAWS_FROM),
         ))) &&
         (!('surface' in e) || e.surface !== 'terminal')

   So unset or empty draws, as today; a number below 9 steps aside; 9 or more draws; anything that is no number steps aside. The comment above it says so.
2. Its eleven callers are unchanged in place: `command.run` for `/to-human-dump` (1616); `ui.render` for `UserMessage` (1643), `TurnDuration` (1675), `AssistantMessage` (1701), `ToolUse` (1782), `ToolGroup` (1840), `ToolProgress` (1888), `ToolResult` (1921) and `AbovePrompt` (1942); `ui.press` for `to-human-toggle` (1982) and `to-human-mode` (1998). The hooks that never called it stay as they are.
3. `to-human/CLAUDE.md`: the clause that says the view reads "any non-empty value" (its paragraph on the notifier) is rewritten so that the notifier and the stream hook read any non-empty value while the view steps aside for a non-empty value that is not a number of 9 or more and draws from 9; and one sentence states that rule where the file describes the view.
4. The version, in `to-human/.claude-plugin/plugin.json` and the to-human entry of the repository's `.claude-plugin/marketplace.json`: the next after the main branch's at the time (0.9.0 as proposed, main being at 0.8.2). The pull request's body says that MAWS reads this number as the first release that draws at 9.
5. `to-human/tests/mods/to-human-native.test.ts` keeps its case (every gated hook passes through off the terminal at `'1'`, the terminal still draws, one read of the setting, the inventory of ungated hooks) and gains: at `'8'`, the same pass-through on `desktop`, `vscode`, `mobile` and no surface; at `'native'`, the same; at `'9'` and `'10'`, on each surface that is not the terminal, a marked `AssistantMessage` draws the report and not `next`'s result, a record row folds, `AbovePrompt` draws the band after a mark, and the two presses act.
6. `to-human/tests/mods/live-maws-check.py` gains a second run at `MAWS_NATIVE_TO_HUMAN=9`, with the same five expectations (the tool is listed, no permission request, one request for a final message, the made-up response kept, no notification).

Untouched, and said in the body: `message.tsx` (`getsTool`, the tool from 8 in a headless session), `notify.tsx`, `folds.tsx` (quiet under any non-empty value, so the record line reads `working record` at 9), `reminder.tsx`, `edits.tsx` (the terminal only, by its own test), the doperpowers plugin's `hooks/to-human-stream.sh`, the sminos ask mod, and `hooks/hooks.json`, whose description of the tool ("not under MAWS") has been stale since 8.

Before it opens: `to-human/tests/mods/run.sh` passes, and check 1 has recorded the answers at 8 and at 9. After it merges, an earlier MAWS build is unchanged: both advertise 8.

### §J. Consumed from siblings, by name

- **U2a** (on master): the `group` row (`summary`, `counts`, `cells`, `expanded`) and the `divider` row's `caption`, `parts`, `counts`; `GroupRow`; `groupInput` with its `isExpanded` and `revealed` rule; `ui.expandedGroups`, `toggleGroup`; `waitingLabel`; its two rules for a fold over its rows: a waiting request's slot stands directly after the run that holds its call, and a run's id does not change while it grows (decision 8 covers the two changes of a row's id that rule does not: one call becoming a run, and a merged read).
- **U3a** (on master): `ui.revealed`, written by `jumpTo`, the cell jump and `jumpToMessage`; the row kinds `agent_message` and `notice` with `class`, `outcome`, `toolUseId`; the asks `arrivalInput`, `sentInput`, `noticeFollows`; `carrier-drawing.ts` as the pattern of §E.
- **U4a** (on master): `composer/Composer.tsx` as it mounts `PluginBand` once the session has started; `withQueueTail` and its tail rows, which are `user` rows and stay.
- **U1a** (on master): `selectWaitingByCall`; UC-3 as amended (a row that holds a waiting request is never inside a fold and asks no site while it waits).
- **The engine host**: `EngineSessionStatus` (`launchId`, `process`, `plugins`, `pluginsObservedAt`, `uiSurface`), and `useSurfaceAttached`.

### §K. Files other children own (UC-8)

| file | owner | the insertion |
|---|---|---|
| `src/renderer/src/composer/Composer.tsx` | U4 | one line: `ViewSwitch` directly after `PluginBand`, under the same condition (the session has started). Named by the root |
| `src/renderer/src/session/SessionPane.tsx` | U1 | the bar's mount and import leave (named by the root); and one line, `ViewSwitch` directly above `HolderNotice` (R8, not yet named by the root) |
| `src/renderer/src/transcript/view/Transcript.tsx`, `TranscriptSlot.tsx` | U3 (UC-3) | the mirror in the place the projection is composed today; the estimated height of the new row; the reveal's end; in the slot, the lane's source and `modDraws` |
| `src/renderer/src/transcript/surface/Rows.tsx`, `adapters.ts` | U3's asks, U2's run | the run's site without `drawingOnly`; one surface row and one input for the message call; the reports of §E |
| `src/shared/ipc/wire.ts` and the two generated files | no child | one minor (R4, not yet named by the root's row) |
| `src/services/index/migrations.ts` | no child | one entry of `ADDED_COLUMNS` |
| `docs/doperpowers/plans/2026-11-12-ux-wave-U13a-one-strip.md` | U13 | one row of the coverage table |
| `apps/desk-web/src/views/project/ReportToggle.tsx` | the desk | two import paths |

`src/shared/keymap/actions.ts` (U6's) is not edited.

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

### Check 1 · what the mod answers on MAWS's surface (Step 0; before the mod's pull request opens and before M4)

- **What it runs.** A probe scenario under `spikes/protocol-probe/scenarios/` built on the existing mod-surface scenarios (`mods-surface-transcript-common.mjs`, `mods-surface-sitting.mjs`, `owner-mod-source.mjs`): it launches the engine as MAWS does (headless, stream-json both ways, the settings env carrying `MAWS_NATIVE_TO_HUMAN`), attaches as MAWS's surface (`desktop`, the client id MAWS uses), and asks sites with the props MAWS sends. Two parts. *Resumed, no model call:* over a seeded transcript of invented text that holds a prompt, a tool run of three calls, an unmarked text, a message-tool call, a text with a message and words beside it, a delivered arrival (a subagent's message and a task notification), and a final marked text; it asks `UserMessage`, `AssistantMessage`, `ToolUse`, `ToolResult`, `ToolGroup` and `AbovePrompt` for each row, presses `to-human-toggle` and `to-human-mode`, and asks again. *Live, a few model calls on the smallest model:* one turn per number, to see the tool registered in `system/init` and a real message call's row answered.
- **With which versions of the mod.** *Before:* a copy of the installed 0.8.2. *After:* P's checkout. Each installed into a scratch config home with the doperpowers plugin (for the style) and the sminos plugin (the mod's dependency), never the owner's.
- **The combinations.** MAWS at 8 and at 9 against the mod before and after (four); the fallback (the after release listed as failed, so the launch is at 8); and one sequence of reloads under a launch at 9: after, then before, then after, by swapping the scratch home's installation and sending `reload_plugins`. At every step it asserts that exactly one side would draw.
- **Where.** A cloud VM or the Mac mini with engine `2.1.322` and model access; no Electron.
- **What it records.** Fixtures under `spikes/protocol-probe/fixtures/uxwave/`, named `u2b-mod-<8|9>-<before|after>.jsonl`, `u2b-mod-fallback.jsonl` and `u2b-mod-reload.jsonl`, each holding the asks and the answers' trees; a findings file `spikes/protocol-probe/findings-uxwave-U2b-mod-answers.txt`; their rows in `spikes/protocol-probe/fixtures.test.mjs`. The secrets scan (`node --test .github/scripts/maws-app-scan.test.mjs`) runs over them.
- **What each outcome means.**

  | it finds | then |
  |---|---|
  | at 8, before and after: every answer keeps the engine's drawing | as expected; A16's unit half stands |
  | at 8 after, an answer that does not | the pull request is wrong: P is fixed before it opens. Nothing in MAWS changes |
  | at 9 after: the message call's answer is the mod's own tree; a folded stretch's first row answers the record line, its other rows answer nothing; an opened stretch's rows keep the engine's drawing; the arrival folds; the band answers after the first message; the presses change the next answers | as expected; M4 as written; `TO_HUMAN_MOD_DRAWS_FROM` is P's number |
  | at 9 after: the run's folded answer still keeps the engine's drawing | the release goes on `TO_HUMAN_MOD_FAILED` (§A); sessions MAWS runs stay on the mirror; the owner is told; A15 waits for a release that hides a run |
  | at 9 after: an opened stretch's answer does not hold the engine's slot | §E, "Following the lead", takes its stated default |
  | at 9 after: the message call's answer keeps the engine's drawing | nothing changes: MAWS's own drawing of it is the same look; noted |
  | in `system/init` and in a `reload_plugins` answer, the mod's entry is not named `to-human` or carries no version | §A's `drawnBy` reads the name the fixture shows; with no version, R1's stronger form is needed before the cutover |
  | after a reload to the older release, the loaded mod still draws (its worker kept the setting it had read) | §A's table loses its reload rows: who draws is decided at launch alone, and a reload under 9 is a tracker row |

- **What is built before its answer.** M1, M2, M3, and P with its own suite. What waits: M4 and the two constants' values.

### Check 5 · rows the mod hides (A18; on the trial)

- **What it runs.** The trial scene's second case: a long seeded session (two hundred turns, a message in each; invented) resumed in a session MAWS runs with P's checkout installed, with no prompt sent, so that no model call is spent while the surface is attached. It scrolls from the end to the top and back and reads the count of mounted rows and of `session.ui.render` asks at each stop.
- **Where and with what.** Electron on the Mac mini under the load rule, the trial's scratch config home.
- **What it records.** The two counts per stop, in this document's Surprises & Discoveries; no fixture.
- **Outcomes.** At or under the anchoring scene's bound of 40 mounted rows: nothing changes. Over it: §E's "If check 5 reads over the bound" is built (one condition), and the scene is read again.
- **Before its answer:** everything; it can only add that one condition.

### Check 7 · U3's rows and the mod (O-30)

- **By reading, done here.** U3a's arrival rows ask `UserMessage` with the engine's props: `origin` (`peer` or `task-notification`), `from` for a message from a session or a subagent, `task` (`id`, `status`, `type`, `toolUseId`, `durationMs`) for a task notification (`transcript/surface/adapters.ts`, `arrivalInput` and `engineUserProps`); its sent-message row asks `ToolUse` (`sentInput`). Those are the fields `promptRow` reads. One gap, by the engine's own design: a scheduled trigger's and a wake's notice, and a task's end the host made, have no carrier the engine draws through `UserMessage`, so they ask nothing and the mod cannot fold them; §E's rule covers them (R10).
- **Live.** Check 1's resumed part asks the two arrival rows with exactly those props and expects them to fold at 9; the trial shows it in the window. No separate run.

## Cost on a long transcript

| what | where | can this landing move it |
|---|---|---|
| Derivation of a 500-turn session, and the median delta batch | `transcript/model/perf.test.ts`, by hand, `MAWS_PERF=1` | yes, for a lane-on session only: with no turn fold every turn's rows are in the flat list, and the mirror is one pass over them per change of the rows. Concrete Steps 4 reads the base, the head, and the new lane-on case |
| No derivation of a turn during token batches | `assistant-ink.test.tsx`, `stores/transcript.test.ts`, `derive.test.ts` | it must not, except once: the flip at a session's first message derives every turn (decision 7) |
| Anchoring while 500 turns stream: at most 40 mounted rows | `e2e/transcript.spec.ts`, "anchoring", lane off | no: lane off, nothing of this landing is in its path but one flag read. Its measured half is read base against landing in one sitting on the Mac mini (the gate-offload plan's Decision Log 162) |
| The same bound in the mirrored view | the new scene of M5 | new: a folded stretch is one row where a folded turn was two or three, so it is expected under today's |
| Mounted rows and site asks where the mod draws | check 5 | the open question of A18; its remedy is named |

A lane-off session, and any session before its first message, is not moved at all.

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The Electron e2e groups the change crosses,** on a Mac under the load rule, each edited or new scene first alone, by its name in `package.json`: `e2e:transcript` (the rewritten report scene, the two new scenes, the R3 and M3 cases read again), `e2e:to-human` (both scenes), `e2e:widgets` (the mods list's version), `e2e:tools` and `e2e:design-systems` (each pressed the bar), `e2e:library` (its conditional press), `e2e:composer` and `e2e:c7` (the switch is mounted in the composer), `e2e:lane-a` and `e2e:remote` (a terminal session's and another machine's pane now carry the view), `e2e:side` (it reads a row for raw message tags), and `e2e:desk-web` on the pool for §L's eight scenes. The default group collects `e2e/to-human-live.spec.ts`, which skips there.
2. **The measured anchoring scene,** `MAWS_TRANSCRIPT_PERF=1`, base and landing in one sitting on the Mac mini. Needs about ten minutes of an idle Mac twice.
3. **The trial** (A15, check 5, check 7's live half): `e2e/to-human-live.spec.ts` under its switch, on a Mac where Electron may run, with the harness build, an engine binary, a scratch config home holding the doperpowers, sminos and to-human plugins from P's checkout with the to-human style selected, and model access for three short turns under the spec's spend cap (tools then a final message; a message mid-turn then tools; a background task's notification and a peer's message). It must show: the messages, the record lines and the switch drawn by the mod and none by MAWS; nothing drawn twice; a thought and a turn's line following their record; a jump revealing its target; the same session after a quit and a reopen at rest drawn by the mirror with the same rows, fold states aside; one artifact mention and one path link inside a mod-drawn message, with what each opens. A paid run: once, on the final head (UC-10).
4. **Check 5,** in the same sitting, and its reading against 40.
5. **The two cross-build runs,** `e2e:cross-build` with `--peer-exact f1852de3a` and with `--peer-exact 2c7044231`, on the final head or the last head that changed what §F names. The pull request names both.
6. **Three looks.** With the changed mod installed in a scratch config home: a session build F runs, and one the installed build runs, each looking as it did (A16); and an earlier build's window on a session this build launched at 9, to see §H's row 5 as it is before the owner is asked card 2.
7. **The look on the built window,** light theme, against the drawn example: the message, the record line closed and open, the switch in its frame, the turn's line with no chevron, a running turn, a waiting permission, the switch above the holder notice.
8. **The owner's sitting.** Scenes this landing gives the script: a session MAWS runs, drawn by the mirror (before the mod's change is installed) and by the mod (after); a terminal session; a session on another machine; a relaunch in the middle of a session; the full transcript and back; a jump from Needs you into a folded record.

## Size and review

Counted from the code at `3f2c4fca1` (files named in each milestone, the tests that pin today's behaviour, the scenes of M5), not from the child's estimate.

| | files | changed lines, about | what it is |
|---|---|---|---|
| M1 | 32 | +1,500 −700 | one new pure function with its table of cases; the store; twelve test files rewritten |
| M2 | 30 | +700 −1,300 | two components and a stylesheet; five source files and their tests removed |
| M3 | 24 | +700 −60 | two pure functions, one column, one wire key; the tests of the launch |
| M4 | 16 | +900 −80 | the surface rows; one small registry; the cutover's constant |
| M5 | 22 | +900 −350 | scenes and the record |
| **in MAWS** | **about 120** | **about 7,000** | |
| P (doperpowers) | 6 | +150 −10 | one function, one test file, one check script, two sentences, two version strings |

**The branch's review is the xhigh panel,** by size (six times the twenty files, more than three times the two thousand lines) and by stakes: a wire minor, a stored value an earlier build writes beside, a cutover in which a wrong decision draws the owner's main surface twice or not at all. Its lenses: (1) *the port*: §B clause by clause against the mod's source at 0.8.2, and what a later release would break; (2) *one side draws*: §A, §G and §H as state machines, the sequences of M3 and M4, a daemon's restart, a reload; (3) *across builds*: §F against both earlier builds, the tolerant reader, the added column, the two scenes; (4) *the mod route*: §E's rule against check 1's fixtures, the full site, the reveal; (5) *cost*: the flip, the flat list with no turn fold, the mounted rows; (6) *UC-8 and UC-3*: the insertions of §K, U1b's row. Each milestone's own review at its boundary is a single reviewer, at the high rung for M1 and M4 and the medium rung for the others. P is reviewed in its own repository by the single reviewer its size calls for.

Under the cut of "One pull request or two" each pull request is still of panel size.

## The pull request

Its body names: the class 1a run (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u2b`); the panel's verdict with what was dismissed or deferred; the e2e groups run and where; the two cross-build runs by their peers; the trial's reading and check 5's; check 1's findings file; the residue (the tracker rows of "The record", the known differences of §E); that the mod's pull request is beside it, with its number, and that nothing here waits for its merge; that the desk web app draws the new rows from its next deploy on and keeps its bar. It carries the dated amendments of "The record". It ends with the trailer the build brief gives.

## Surprises & Discoveries

- Observation: the installed mod is 0.8.2, two minor lines past the 0.7.3 the first landing's document read, and 0.8.0, the number the design gave to the release that draws at 9, is in use. `native()` is unchanged through all of them; an eleventh caller and a fold-summary tracker were added.
  Evidence: the install record's `version`; the cache's directories 0.7.2 to 0.8.2; `to-human.tsx` lines 1450 to 1455 and 1616; `folds.tsx` line 592.
- Observation: the lane's state is on the wire and its objects are strict, so the published field is a wire minor; and the decision is lost at a daemon's restart unless the launch's number is stored.
  Evidence: `wire-manifest.json`, `commands.ownerChannel.state` and `events.ownerChannel.changed`; `src/services/owner/store.ts`, `recordLaunch`.
- Observation: for a session on another machine the lane cannot be read, so today's report never applies there.
  Evidence: `src/shared/ipc/remote-unavailable.ts`, `'ownerChannel.state': notYet('the owner channel')`.
- Observation: the mod's fold is in force by time, not by place: once a mark is seen every record row folds.
  Evidence: `isFolding = () => hasSeenMark && !isFullTranscript` (line 1512).
- Observation: a terminal session no port drives has no composer, so a switch mounted only there is missing on the route the mirror exists for.
  Evidence: `session/SessionPane.tsx`, `noticed`.
- Observation: `e2e/to-human-live.spec.ts` skips on both branches of its own condition.
  Evidence: its `skipReason` returns a reason with and without `MAWS_C_LIVE=1`.

## Decision Log

- Decision: the verification call. This document gets an adversarial review before any executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` at the xhigh panel, with the six lenses of "Size and review"; each milestone a single reviewer at its boundary. Class 1a on GitHub Actions is the gate of record; the Electron groups, the two cross-build runs, the trial and the measured scene are the architect's.
  Rationale: about 120 files in the surface the owner reads most, a wire minor, a stored value, and a cutover between two programs that deploy separately.
  Date/Author: 2026-11-15, this document's author.

## Outcomes & Retrospective

Pending — written at finish.
