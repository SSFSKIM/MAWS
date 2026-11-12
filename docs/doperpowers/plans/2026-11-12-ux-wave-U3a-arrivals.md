# UX wave · U3a · the arrivals reader, its callers and the arrival rows (2026-11-12)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U3**, first landing (**U3a**), parent pin `25942f5d1`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md`: Edges ("Two pull requests": the first is this one); Contracts → "UC-2 · One reading of every arrival (owned)" in full, and the entries UC-1, UC-3, UC-7 and UC-8 as consumed; acceptance A1 to A5 and A14; Design inheritance; the items O-12, O-28, O-34, O-41, X-032 and, of O-18, its reading; "Probes and checks" 1 to 4 and 7; under "Rulings reversed", the rows O-12, O-41 and O-34. In the root: Purpose, the wave's laws, UC-2, UC-3, UC-8, UC-10, UC-11, UC-14, "Ordering and dependency map", and in the Decision Log "Probe results, fourth batch (arrivals)" and "Rulings reversed". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code at the branch's head needs, the decisions the section left open, the names siblings build on, and the execution. **Branch:** `ux-wave/U3a`, from master `85e934368`. **Board:** #576 (the wave's epic is #573; the second landing is #588).

## Purpose

After this landing, what enters a session from elsewhere reads the same whichever way the session reaches the window, and takes one line:

- A message from another session or from a subagent is one dim line led by `›`. A click shows the whole message under it, and the line folds with its turn. A subagent's hand-back report is that one line for its agent's end.
- The owner's own `sminos send` or steer is the owner's bubble with sminos's frame line cut, never a message "from human". A peer's delivery is never the owner's bubble, on any route.
- The end of a background command or of a monitor is one line where the agent was told, in the engine's own sentence, led by a dot in green, red or yellow. A failed background task raises no error card, no Needs you entry and no notification.
- A scheduled prompt's firing is one line. An answer to an asynchronous question and the sminos bridge's wake keep the line they have today on the route that had it, and gain it on the other.
- A slash command's output is an output on every route: in a session MAWS runs it stops reading as an answer paragraph. It keeps today's "Command output" card until the second landing restyles it.
- A turn that a subagent's hand-back opened reads "Continued for …", no longer "Peer session worked for …".

Behind that is one pure reader, `src/shared/engine/arrival.ts`, asked by the three places that turn the engine's frames and rows into events: the engine host's normaliser for a session MAWS runs, the transcript-file backfill for a terminal session on this Mac, and the reader of another machine's rows. Each turns a class into the same events, so the transcript's model cannot tell the routes apart. U1, U2 and U4 build on the names this landing exposes (Interfaces and Dependencies), which is why it lands first in the transcript's model (UC-3).

How to see it working: the table test of the reader over the probes' recorded carriers fails at the commit that adds it and passes at the head; one recorded session, mapped from its journal, from its transcript file and from the same rows as another machine sends them, gives the same arrival rows but for the differences Acceptance 7 lists; in a running build the scenes of Acceptance 13 read as the child's A1 to A5 say.

## Progress

- [x] (2026-11-12 22:44Z) Execution document written; the section checked against the code at `85e934368` and against the probes' fixtures on `origin/ux-wave/probe-arrivals`; the points of Surprises & Discoveries reported to the wave's architect.
- [ ] Adversarial review of this document, dispatched by the architect; its findings and the architect's rulings on the reported points folded in.
- [ ] Master merged into the branch once it holds U6a and U8a (no file of theirs is edited here; Interfaces, H).
- [ ] M1 — the reader, the fixtures it is tested on, X1's field.
- [ ] M2 — the arrival rows: the model and the lines.
- [ ] M3 — the transcript file and another machine's rows ask the reader.
- [ ] M4 — the live wire asks the reader.
- [ ] M5 — the rows ask the mods, and a jump's target is revealed.
- [ ] M6 — no alarm for a failed background task; the e2e edits; the record; acceptance; class 1a once; hand-back.

## The landing's edge

| part of U3 | satisfied by this landing | stays for U3b, or for the child named |
|---|---|---|
| UC-2, the reader (`readArrivals`, `readNext`, `turnOriginOf`, `readAnswerEnvelope`, the `Arrival` union, the six rules of reading) | in full | nothing |
| UC-2, the three callers and what each class becomes | in full | nothing |
| UC-2, X1's optional `arrival` field and its dated line in the charter | in full | nothing |
| UC-2, the rows: the message line for every `agent_message` row, the `notice` row, `opener` on the divider | in full | U2 names a turn from `opener` and decides what the to-human view folds; U1b fills the question's row from the `answer` class and decides whether the `answer` line remains (O-21) |
| UC-2, class `command` (O-18's reading) | every form is read as an output and becomes a `local_command` row in its command's turn; a repeated output is dropped; a command a terminal wrote as a `system` row draws its bubble and opens its turn | O-18's row: the `⎿` line, two lines and "Show more", `<local-command-stderr>` in `--danger`, the line standing alone under the command's name, and `run` reaching the mod's site (U3b; Surprises & Discoveries, 3) |
| UC-2, class `consent` | read, carried on its event and drawn as its one line (decision 10) | U1c sends the message and marks the blocked call's row |
| UC-3, the mounts: arrival rows ask `UserMessage`, the sent-message row asks `ToolUse`; a jump's target is revealed | in full for the rows of this landing | U2 reads `revealed` for its own asks; U3b's find and prompt chords call `jumpTo` |
| UC-6 | nothing: this landing adds no action | U3b adds its five rows to `ACTIONS` and edits nothing in `src/main/menu.ts` (the architect's ruling of 2026-11-12 on U6a's document: a row with its `menu` and `submenu` is placed by the table; U6a's document, Interfaces A, E and G). A new id is not rebindable while build F may read the profile; U3 writes no code for that |
| UC-7, the acts of these rows | opening a line, Reply, Open output: in full | Fork from here (U3b, with U9's act); Dismiss on the errors that remain (U9) |
| UC-8, insertions in files others own | O-34's branch in `src/services/attention/service.ts` (U1's) | the line in `sidebar/HoverCard.tsx` (#331), the tool name in `request-card/tools.ts` (#146), the keymap rows (U3b) |
| A1, A2, A3, A4, A14 | in full | nothing |
| A5 | "not as an answer paragraph"; an output under its own command and never twice; `/effort low` draws nothing, in a session MAWS runs too now that its output is read as an output (`confirmsSettingChange`, kept) | "at most two muted lines", no box, no heading, "Show more" (U3b) |
| A6 to A13 | nothing | U3b |
| "Rulings reversed": O-12, O-41, O-34 | in full | O-08, O-02 (U3b) |
| "Probes and checks": 5, 6 | nothing | U3b |
| "Probes and checks": 7 (builds a version apart) | the unit test of Acceptance 9 | the cross-build e2e run, arranged by the architect |
| The board and the tracker at landing | #576; one tracker row opens (what has no live carrier, O-28); the rows of 2026-10-18 (X-032) and 2026-10-19 (an engine turn names nothing that finished) are named for closing | #330, #331, #146 and #44 close with U3b |

What stays as it is today, on purpose: the look of a command's output; the time, Copy and Edit on the owner's message; an answer's actions; the words of the turn line (U2's), which change here only where a turn's origin changes; request rows (U1's); the task's own row and the subagent's started and finished rows (l2-transcript-14, keep).

## Today, at `85e934368`

Checked on 2026-11-12 after the project registry landed. The section's statements about the code hold at this head, with the additions under Surprises & Discoveries. The parts and how they meet:

- **The envelope parsers.** `src/shared/engine/peer-envelope.ts` holds `parsePeerMessage`, `peerEventsOf`, `handbackReport`, `sminosFrameSender`, `sminosFrameOwners`. The reader goes beside it and uses them.
- **A session MAWS runs.** `Normalizer` in `src/engine-host/normalizer.ts` is a pure function from journal rows to X1 events with explicit state (`NormalizerState`). `userIn` passes every origin but `peer` through as one word; `assistant` maps a command's output frame as an answer; `mapSystemFrame` in `normalizer-system.ts` maps every `system/task_notification` that is not an agent's to `task.notification` without reading `is_backgrounded`; the `command_lifecycle` branch reads no `wakeup_source`. A turn the engine opens is opened at `system/init`, before any frame says what it is for.
- **The transcript file.** `recordToEvents` in `src/engine-host/fs/backfill.ts`, with its own readers (`isPeerPrompt`, `peerMessage`, `peerQueuedMessage`, `parseTaskNotifications`, `localCommandKind`, `noteBridgeRow`, `sminosDelivery`, `isBridgeWake`) and the gate `humanOrigin` in `userEvents`. Its callers are the chain follower (`fs/chain-follower.ts`, which also reads `opensTurn`, `startsTurn`, `isHumanPrompt` and `localCommandKind` for turn boundaries), the replay runner, `src/services/sessions/recent-turns.ts`, and the normaliser's `transcript_reseed`.
- **Another machine's rows.** `eventsOf` in `src/renderer/src/lane-a/plane-transcript.ts` rewrites a row (`deliveryAsDrawn`, `steerAsDrawn`), maps it with `recordToEvents`, then rewrites the events (`withWakeLine`, `withAnswerLines`, `withAppendedTurn`, the re-label of a hand-back's turn). It serves `src/renderer/src/lane-a/remote-source.ts`, and the desk web app's session view (`apps/desk-web`), which imports the same class.
- **The model.** `src/renderer/src/transcript/model/`: `reduce.ts` places events in turns (a turn's origin is `human`, `engine` or `peer`; `close` takes a result's origin only when it is not `human`); `derive.ts` makes rows (`inboundRow`, `agentMessageRow`, `sendMessageRow`, `localCommandRow`, `isPersistentMessage`, and the branch that draws nothing for an engine-origin `user.message`); `rows.ts`, `schema.ts`, `keys.ts`, `copy.ts`, `serialize.ts` hold the row's shape, its snapshot schema, its id, its words and its copy as markdown.
- **The views.** `transcript/view/rows/AgentMessage.tsx` (`PeerMessageRow`, `ReportRow`, `AgentBodyRow`), `Row.tsx` (one row to its component), `transcript.css`. The mods' mounts are `transcript/surface/Rows.tsx`, `adapters.ts` and `Tools.tsx` over `src/renderer/src/engine-surface/SurfaceRow.tsx`; the sites' props are `src/shared/engine/surface-rows.ts`.
- **The alarm.** `src/services/attention/service.ts`, the `task.notification` branch: "Background task failed: …" for a failed notification of any task type.

## Decisions settled at authoring

Each is a point the section leaves to this document. The reason and the alternative that lost are with it; the exact shapes are in Interfaces and Dependencies.

1. **The fixtures arrive by merging `origin/ux-wave/probe-arrivals`, whole, as M1's first commit.** It merges cleanly into `85e934368` (55 files, 10,754 lines: the 36 files of `spikes/protocol-probe/fixtures/uxwave/`, four findings files, the scenarios, the VM launcher and its four small journals). Lost: copying the fixture files alone, which would leave the findings the section and the reader's comments cite, and the scenarios that say how each fixture was recorded, off master. If the architect lands the probe branches by themselves first, the merge is empty and nothing else changes.
2. **The reader is shared code.** `src/shared/engine/arrival.ts` imports nothing from `src/renderer/` or `src/engine-host/`. The parsers it needs move under `src/shared/engine/` and the modules that held them call them; an export another module imports stays where it is as a thin caller (the desk web app imports `askAnswers` and `deliveredLines`; `deliveryFrame`, `supersededDeliveries`, `isBridgeRow`, `bridgeRowKind` and `BRIDGE_PLUGINS` serve placement). Lost: the reader importing the renderer's modules, which the engine host cannot load.
3. **`arrival` on X1 is a list.** One carrier can hold several arrivals (rule 3), so the field is a list of the carried classes, absent when the carrier holds none. An empty list has one meaning (decision 8).
4. **An arrival that is not the person's is never a prompt.** Every caller emits a `user.message` that carries `arrival` under an origin other than `human`, and every `user.message` of origin `task-notification` whether or not it carries one, with `isSynthetic: true`. Today the live caller passes the frame's own flag, and a replayed notification frame opens a turn in the model that waits for ever, unseen. Messages of the other origins (`local-command`, the interrupt marker, a channel's or a coordinator's) keep the flag they have today. Lost: a new branch in the reducer for arrival-bearing messages, where the existing rule for a synthetic message already keeps it on the running turn.
5. **Where a row sits is read from the events' order, not from a new field.** An arrival that stands before all of its turn's work is at the turn's head; one after work began stands at that point. At the head, a `task` notice with an outcome and a `schedule` notice go above the divider (in a turn the person's prompt opened, directly above the prompt), and every other class is the first row under it. This one rule gives the child's "Where a row sits" on all three routes: a turn's opener, a task the host stopped (delivered at the head of the person's next turn), and what a running turn took in.
6. **An engine turn that held nothing is no turn.** The reducer removes a turn the engine opened that held nothing (no event that draws a row and no model output; in both recorded cases it holds its own start alone), in two cases: its end says it ran nothing (`numTurns` 0), or another turn starts over it. The first is the empty turn the engine reports after an idle hand-back (rule 5: "no turn beyond the one the arrival opens"). The second is what lets the owner's own send, which reaches a session MAWS runs through the inbox, open the person's turn although `system/init` had already opened the engine's (pitfall 5 of the section). Lost: holding `turn.started` back in the normaliser until the next frame says what the turn is, which would send every event between `init` and that frame to the model with no turn open; leaving both to U2's "a turn in which nothing happened draws no line", which would leave the callers disagreeing until U2 lands (Surprises & Discoveries, 5).
7. **How the live caller keeps a task's end until the model is told** (the state, the transitions and the points where a line is placed, settled, withdrawn or given up) is the table of Interfaces, E. Three choices in it are this document's: only a `local_bash` task that was in the background is kept, the two forms the probe ran (a workflow run, an MCP task and a remote agent were not run, and by law 6 nothing here depends on their frames; their lines appear once the session is read from its file); a scheduled fire is held from its `command_lifecycle` frame to the `init` after it and no kept notice is placed on that turn; and a kept notice is given up when the engine next goes idle after a turn opened that did not name it. The last is the bound that keeps a line the engine never tells from being placed on every later turn; `system/session_state_changed` with `state: 'idle'` is sent only when the engine's queue is empty: where a turn follows a result with nothing new between them, no `idle` stands between (`u3-tasks-r1`, seq 157 to 159, 354 to 355, 739 to 740, 752 to 753, 762 to 763; `u3-tasks-r2`, 589 to 590, 599 to 600, 609 to 610), and where an `idle` does stand, what opens the next turn arrived after it (`u3-tasks-r1`, the `idle` at 56 and the frame at 58).
8. **A placed line is withdrawn by a second event, not by a new event kind.** Two arrival-bearing synthetic messages under one `messageUuid` are one arrival: the later stands where it arrives, and one whose `arrival` is empty stands for nothing. Lost: an event kind for the withdrawal (a build that does not know it draws a gap, UC-2); drawing only at the `result` (the root's Decision Log rejects it).
9. **The words of the `answer` line are the model's.** The event carries the arrival (`call`, `summary`); `derive.ts` words the line from `summary` and the questions of the call it finds in the transcript, with the function that words it on the remote route today (`answeredWords`), which moves beside the model. Lost: wording it in the caller, which would put the model's words in three places.
10. **The `consent` line is a `user` row with a `consent` field, and this landing draws it.** UC-2's table fixes its look ("You approved `<subject>`", never a bubble, in view through a fold as the person's words are) and UC-3 gives the `user` row to U3. The `notice` row cannot hold it: its classes are the four the contract lists, and a notice is the engine's fact where this is the person's act. U1c then only sends the sentence, built by `consentMessage` so that the sentence has one definition. Lost: leaving the line to U1c, which would have U1 edit U3's row.
11. **A notice's id is what both forms of a session share.** `notice:<run id>` when the arrival names a run, else its message's uuid with its place in the carrier. The model already drops a row whose id is shown, which is what keeps one line when a session's history reaches the store from its journal and from its file.
12. **An unlisted `<status>` word claims no end.** `error` stays `failed`, as the parser that moves reads it today; a word rule 6 does not list gives `outcome: null`. Lost: today's default of `completed`, which the section's pitfall 1 names.
13. **Task state is not an arrival.** A notification still ends its task for the task graph and for the subagent's row (`subagent.finished`, `task.notification`) whether or not the reader yields an arrival for it; a block with no outcome ends nothing. The notification rule 5 leaves out after a hand-back therefore still finishes its agent on the file and remote routes.
14. **`revealed` lands here.** UC-3 has U3 write it and U2 read it; this landing's own asks must honour it, and U2 starts from this landing. It is one optional field of the tab's `ui` (Interfaces, F).
15. **Which rows ask a site.** A row asks only when its event came from a frame or row the engine wrote (its text is the site's `text`): an arrival the engine host made itself (a task's end told while idle, a scheduled fire) asks none, as the section says. The classes asked are the ones the engine's own transcript passes through its `UserMessage` site, read in the engine's bundle before the mounts are written (M5).
16. **The tail's proof in two e2e specs changes its vehicle.** `e2e/supervisor.spec.ts` and `e2e/cross-build.spec.ts` prove that events journaled while no app ran reach main's listeners by the "Background task failed" item, which O-34 removes. They take another item that only that derivation raises and that every build of a cross-build pair raises (M6).
17. **`own` keeps the guard of pitfall 3 as today's code has it.** When the words alone are the engine's interrupt marker, `words` keeps the frame line before them; the caller emits them with origin `human`, which the model never reads as a marker.
18. **A dismissed question is an `answer` whose `summary` is the dismissal's sentence, and its line says `dismissed`.** The sminos bridge's dismissal (doperpowers pull request #497, to ship as sminos 1.47.0; verified live by its author on 2026-11-12, not by U3's probes) delivers, by the same carriers as an answer, the head every answer has and then "The human dismissed these questions without answering them; no answer will come. Do not wait for one." The reader needs no rule for it: it splits a carrier by the head and takes what follows as `summary`. Only the line's words know the sentence, and they use the root's word for it (UC-2, "or 'dismissed'"). The child's file words no line for a dismissal (Surprises & Discoveries, 4).

## Acceptance

Numbers are this document's; each names the child's item it serves. 1 to 12 are the executors' to show; 13 is the architect's run and the owner's sitting.

1. **The reader's table (A14).** `src/shared/engine/arrival.test.ts`, one table of carriers: for each, the fixture file and its line or `seq` (or "written by hand", with invented content), and the arrivals `readNext` yields in order. It holds every carrier A14 lists: a peer's message and the owner's own send by the inbox, idle and during a turn (`u3-sminos-r1-maws`); the bridge's submitted row, its appended row with the mirror line after it, a steer's appended row with its mirror line (`u3-sminos-r1-terminal`); a peer's submitted row and a peer's appended row with its mirror line, the steer by the inbox fallback (by hand, in those shapes); a hand-back as a `user` frame and row and as a `queued_command` row, each with the task notification of the same task after it (`u3-tasks-r1`, `u3-tasks-r2`); a task notification of each outcome in each carrier (the `system/task_notification` frame with the `result` that names its run, the replayed `user` frame, the file's `user` row, the `queued_command` row), a monitor's event, the stall notice and the check-in with `outcome: null`, a monitor's end that carries its last event as `detail`, and a foreground command's frame, which yields nothing (`u3-tasks-r1`, `u3-tasks-fg`, `u3-terminal-checkin-r1`); a block with no `<summary>` and an agent's stopped block with no `<status>` (by hand, rule 6); a scheduled fire in its three carriers (`u3-cron-r1`, `u3-terminal-cron-r1`); a command's output in each form (the assistant frame with `local_command_source`, the `user` frame and row holding `<local-command-stdout>`, the file's `system` row), and the `system` row that holds the command and an unknown command, each of which yields nothing (`u3-commands-r1`, `u3-terminal-commands-r1`); an answer by the hook's context, by the plugin's prompt (by hand, in the shape `src/renderer/src/lane-a/source/ask-answer.test.ts` records) and MAWS's own envelope; a dismissal by the hook's context, and a plugin's prompt that holds an answer and a dismissal, which yields two arrivals in order (by hand, decision 18); a hook's context that is no answer, which yields nothing (`u3-hookctx`); the consent sentence for a command and for a call, and the same sentence with one word changed, which yields nothing; a frame line pasted into a typed prompt, which yields nothing. It fails at the commit that adds it and passes at the head.
2. **A peer's message and the owner's own (A1; O-41, X-032).** From `u3-sminos-r1-maws`'s journal and from its transcript file: a peer's message is an `agent_message` row with no `user` row for it, and the turn it opens is a peer's; the owner's send is a `user` row whose text has no frame line, in a turn of the person's, idle, and a steer row captioned "Sent during this turn" when it entered a running turn. From `u3-sminos-r1-terminal`'s file and from the same rows through `freshSource`: the bridge's submitted row from `human` is the owner's bubble without the frame line; the appended row is the owner's steer row and its mirror line draws nothing. From the hand-written rows on both of those routes: a peer's submitted row and a peer's appended row are `agent_message` rows, never `user` rows, and no text opens with "From"; the fallback's steer is the owner's bubble.
3. **The message line (A2; O-12).** Component tests of the one message-line component: one line that never wraps (the preview is one text node in a container that clips with an ellipsis); a leading `@address` token is not in the preview and is in the opened message; a click, Enter and Space open and close it; there is no "Show the whole message" button; Reply shows on hover or focus where `replyTo` is set and stays while its composer is open; a hand-back reads `Report from <agent>: <first line>`; a sent message reads `Sent to …` with its state at its end. Model tests: with its turn folded, an inbound message and a report are not among the rows; a subagent's started and finished rows are as before (l2-transcript-14).
4. **The task notice (A3; O-28).** From `u3-tasks-r1`'s journal: `Background command "uxw ok" completed (exit code 0)` and `Background command "uxw fail" failed with exit code 1` are `notice` rows above the divider of the turn the engine opened for each, drawn when the turn opens; the two commands that ended during a turn are notices at the point their `user` frames arrived; the stopped task's notice is directly above the person's next prompt with `outcome: 'stopped'`; `Monitor "uxw monitor" stream ended` ends on the turn whose `result` names its run and on no other turn, in `u3-tasks-r1` and in `u3-tasks-r2` (where it is placed and withdrawn twice first); no notice has a duration but an agent's; a foreground command's frame makes no row. With the turn folded a notice with an outcome is among the rows and one without is not. From the file of the same session: the same notices, and the three the live wire does not carry (Acceptance 7).
5. **No alarm (A4; O-34).** `src/services/attention/service.test.ts`: a failed `task.notification`, of a background task and of a foreground one, derives no item; a failed turn, an API error and "auto mode unavailable" derive theirs as before.
6. **A command's output is read as an output (A5, in part; O-18).** From `u3-commands-r1`'s journal: the output of `/cost`, `/context`, `/reload-plugins`, `/rename`, the `/model` that fails and the `/compact` with nothing to compact is a `local_command` row in its command's turn, and no `assistant_text` row holds any of them; `/effort low`'s output makes no row; after the interrupted `/compact` and the one that succeeds, "Compaction canceled." (seq 406, sent again at 422 under the same uuid) is in the first one's turn once and nowhere else. From `u3-terminal-commands-r1`'s file: a command the terminal wrote as a `system` row has its `user` row and its turn, and its output is in that turn; no row shows an ANSI escape.
7. **The routes agree (A14, last sentence; law 5).** `src/renderer/src/transcript/model/arrival-routes.test.ts` maps `u3-tasks-r1`, `u3-sminos-r1-maws`, `u3-cron-r1` and `u3-commands-r1` three ways (the journal through `Normalizer`; the transcript file through `recordToEvents`; the same rows through `freshSource`) and compares the arrival rows of each (`agent_message`, `notice`, `local_command`, a `user` row an arrival made, and each turn's origin and `opener`). The file and the remote lists are equal, but for a difference the two callers' placement code makes on purpose (an interrupted turn's end, for one), which the test states with its reason. The live list equals the file's but for a list the test states row by row, which is exactly: a monitor's event, the stall notice and the withheld report's `Agent "…" finished` told while idle (in the file only); the prompt's text on a scheduled fire's line (in the file only).
8. **The mods (UC-3).** Component tests with a surface attached: an inbound message's row and a task notice made from a replayed frame ask `UserMessage` with the engine's props, a sent message's row asks `ToolUse`; an answer that keeps the engine's drawing, and no hook, leave MAWS's line; an answer that draws without it replaces the line; a notice the host made itself asks nothing; the row `ui.revealed` names asks nothing and is drawn by MAWS. A store test: `jumpTo` sets `ui.revealed` to its target and the next jump replaces it; a jump to an arrival row inside a folded turn opens the turn.
9. **Builds a version apart (the child's check 7).** A test in `src/shared/graph/` (beside the tolerant reader's existing cases): a `user.message` that carries `arrival`, read with `readTolerant` against the schema as it is at `85e934368` (kept in the test as a literal copy of that one member), is accepted with `arrival` dropped; the wave's schema accepts the event without the field.
10. **Keep (law 8).** l2-transcript-14 (Acceptance 3), l2-transcript-17 (a message of 19 lines or more still folds; its existing test passes unchanged), and l2-transcript-01, -02 and -03 (their existing tests pass unchanged).
11. **The record.** The documents of "The record" below carry their sentences.
12. **Nothing gated got worse.** On the VM: `pnpm typecheck`, eslint on the changed paths, `pnpm test` and `pnpm test:probes` pass. Class 1a on GitHub Actions is green on the branch's head.
13. **In a running build** (the architect's runs on a Mac under the load rule, then the owner's sitting; not the executors'): the child's A1 to A4 as written, and of A5 that `/rename x` in a session MAWS runs draws a command's output and not an answer; the e2e groups of M6; on a session of a machine on build F, the transcript draws as today with no gap row.

## Constraints that bind the work

- **The design binds.** The child's file and the root, at the places the header names, and the decisions above. A point where the code or a fixture contradicts the section, where the work needs an edit in another child's file beyond the insertions named below, where a contract would have to change, or where the owner would see something the section does not say: stop on it and hand it back to the architect with the evidence. Everything else is decided in the spirit of the section and recorded in the Decision Log.
- **The engine is unmodified (charter D-1) and not guessed at (law 6).** Every claim about a frame or a row is checked against `spikes/protocol-probe/fixtures/uxwave/` or the fixtures already on master. A case the probes list as not run (the child's "Probes and checks", 1 to 4) is not built on: the reader leaves it alone (rule 4) and the hand-back names it.
- **X1 changes by one optional field.** No event kind is added and no existing field changes its type. An older build that reads the wave's events drops `arrival` and draws as today.
- **UC-3, one writer at a time.** U3 lands first in `src/renderer/src/transcript/model/` and `view/`. This landing changes the arrival and message rows (`agent_message`, the new `notice`, `local_command`'s events, `user` for `own` and `consent`), adds `opener` to the divider row's data, and adds the rules of decisions 5, 6 and 8 to the derivation and the reducer. It changes nothing else of the divider or its words, nothing in `groups.ts`, `classify.ts` or the group row (U2's), and draws no request row (U1's).
- **UC-8, ownership.** U3's: `src/shared/engine/arrival.ts` and its three callers. The one insertion in another child's file is the removal of the `task.notification` branch in `src/services/attention/service.ts` (U1's), with its tests. A test under `src/renderer/src/owner/` (U2's) that pins a peer's message staying through a fold is changed in its expectation only, and named in the hand-back. Not edited: `src/renderer/src/request-card/`, `src/renderer/src/composer/docked/`, `src/endpoint/offers.ts`, `src/shared/ipc/remote-unavailable.ts`, `src/shared/keymap/`, `src/main/menu.ts`, `src/renderer/src/sidebar/`, `src/services/lane-a/jobs.ts` (the job list's own reader of notification rows; not a caller of UC-2).
- **UC-14, as the architect extended it on 2026-11-12.** This landing stores nothing new: no key and no version change in either settings file's schema or in the stored layout, and no action id. What it adds to a tab (`ui.revealed`, a line's open state) lives in memory.
- **Law 8.** l2-transcript-14 and l2-transcript-17 are next to code this landing changes; a change that would alter either stops and reports.
- **Light theme first; tokens only.** The dot's colours are `--success`, `--danger`, `--warning`, `--fg-muted`. Geometry and tints stay today's (law 7).
- **UC-11, the repository is public.** Nothing of the owner's enters code, tests, fixtures, comments, commit messages, documents or pull-request text. Rows written by hand use invented names, addresses and words. The probes' fixtures were scanned at authoring for home paths, email addresses, account names and tailnet hosts and hold none (emails are the harness's `owner@redacted.invalid`); the scan is repeated on the merged tree before the pull request.
- **Where checks run (UC-10).** On the MacBook the worktree carries no `node_modules` and nothing is installed, typechecked, linted, tested, built or launched. Every check runs on the wave's build VM in a checkout of the pushed head (Concrete Steps). Class 1a on GitHub Actions is the gate of record: once, when the branch is complete, started in the background. Its runs are never polled in a loop. Electron e2e is not the executors' to start.
- **Git.** Commit as you go and push `ux-wave/U3a`. Never commit to master or to `ux-wave-spec`, and never edit the spec's files. No attribution trailer but the `Sminos-Session:` line the dispatch gives, which ends every commit message and the pull request's body. A pull request is opened only when the dispatch says so; its body opens with the root's path, "U3, first landing" and the parent pin, and names its class 1a run, its review verdict and its residue.

## Plan of Work

Six milestones, one executor each, in order. M3 and M4 do not depend on each other; both need M1 and M2. Every executor reads this whole document and the child's file first; a milestone below points at them and restates nothing.

One rule for all of them. The suites that map whole recorded sessions (`src/renderer/src/transcript/model/fixtures.test.ts`, `snapshots.test.ts`, `journals.test.ts` and `disk.test.ts`, the engine host's conformance and fidelity suites, `plane-transcript.test.ts`) will move with this landing. Each moved expectation is read and tied to an item of this landing in the commit that changes it; one that ties to none is a defect to fix, not a snapshot to refresh.

### M1 — The reader, the fixtures it is tested on, and X1's field

**What exists at its end.** `origin/ux-wave/probe-arrivals` is merged. `src/shared/engine/arrival.ts` exports the names of Interfaces, A, and its table test (Acceptance 1) passes. `user.message` accepts the optional `arrival` (Interfaces, B; Acceptance 9). No caller asks the reader yet and nothing on screen changes.

**What it touches.** `src/shared/engine/` (the reader, its test, the parsers that move in); `src/shared/graph/events.ts` and its tests; `test/support/fixtures.ts` (a loader for `fixtures/uxwave/` journals and transcript files, beside `loadP5Journal`); the modules the parsers move out of, as thin callers: `src/renderer/src/lane-a/conversation/delivery-frame.ts` and `ask-answer.ts`, `src/renderer/src/lane-a/source/bridge-rows.ts`, `src/engine-host/fs/backfill.ts` (`parseTaskNotifications`), `src/engine-host/normalizer-support.ts` and `src/renderer/src/transcript/model/user-text.ts` (the local-command and interrupt-marker patterns), `src/shared/maws/ask.ts` (`parseAskSteer`, called, not moved).

**Decisions that belong here and nowhere above.**

- *Move, do not rewrite* (the section's advice). The proof is that every existing test of the moved functions passes unchanged at this milestone's head: `peer-envelope.test.ts`, `delivery-frame.test.ts`, `bridge-rows.test.ts`, `bridge-wake.test.ts`, `src/renderer/src/lane-a/source/ask-answer.test.ts`, `backfill.test.ts`, `normalizer.test.ts`, `user-text.test.ts`. A test that has to change here means something was rewritten. One parser changes its reading with this landing (`parseTaskNotifications`: a block with no `<status>`, decision 12): the reader gets its copy with the new reading here, the backfill keeps its own until M3 replaces it with the reader's, and nothing else is in two places.
- *What `readArrivals` knows alone.* It is `readNext` from `nothingOpen`. A carrier that needs an earlier frame to be an arrival (a `system/task_notification` frame needs its task's `task_started` or `task_updated` to say it was in the background) yields nothing alone. `readNext` is given every frame or row of a session in order, also the ones that carry no arrival, so that it sees those marks.
- *What `OpenArrivals` holds* is the module's own. It must be enough for rule 5's three pairs and for the background test: which tasks were in the background and of which type; which runs' `system/task_notification` said `handback: 'send'`; which hand-backs still wait for the notification of their task (a hand-back claims the next one and no later one); the last fire row; the appended delivery a mirror line may follow. It is an immutable value: `readNext` returns the next one.
- *Both plugins the bridge has run in* (`sminos`, and `doperpowers` before sminos 1.0.0) are read wherever today's parsers read both.
- *Several deliveries in one row.* A plugin's prompt and a hook's context can each hold more than one delivery (an answer beside a dismissal, decision 18): the carrier is split at each head, as `answersIn` splits it today, and each part is one `answer` arrival (rule 3).
- *A row no class claims* keeps today's reading (rule 4), among them a steer an older bridge appended with no steer line and the bridge's interrupt and stop records. The reader yields nothing for them; the callers keep what they do today (M3).
- *The consent sentence* is one template with two words (Interfaces, A). `consentMessage` builds it and the reader matches the whole text against it, reading the quoted string with `JSON.parse`.
- *The schema of the carried classes* is beside the reader's types and `events.ts` imports it. The reader's imports from `src/shared/graph/events.ts` are types only, so no module cycle forms at run time.
- *Pitfalls.* The probes' journals were recorded on engine `2.1.322`; a frame there that `parseStdoutFrame` or `parseJournalRow` refuses is reported, not worked around. The `.terminal.json` files are pane captures for reference and are not parsed. The origin object of an inbox message from the owner says `name: 'human'` and its frame line says `from human`: the frame line decides (rule 2), and a test holds a row where only the frame line is there.

**What it does not touch.** The three callers' behaviour; the transcript's model and views; `spikes/` beyond the merge.

**What it proves.** Acceptance 1 and 9. Beyond them its tests pin: `turnOriginOf` for every class; `readAnswerEnvelope` on MAWS's envelope and on any other text; `readNext` is pure (the same input and state give the same output, and the state passed in is not changed); a carrier with two `<task-notification>` blocks yields two arrivals in order.

### M2 — The arrival rows: the model and the lines

**What exists at its end.** Given events as Interfaces, C defines them, the model makes the rows of Interfaces, D and the views draw them: the message line for every `agent_message` row, the `notice` row, the `consent` line, `opener` on the divider, the placement of decision 5, the fold rule, and the reducer's rules of decisions 6 and 8. With today's callers, what changes on screen is O-12: a message from another session or a subagent is one line and folds with its turn.

**What it touches.** `src/renderer/src/transcript/model/` (`rows.ts`, `schema.ts`, `keys.ts`, `copy.ts`, `reduce.ts`, `derive.ts`, `serialize.ts` and their tests; `answeredWords` moves here from `src/renderer/src/lane-a/conversation/ask-answer.ts`, which keeps a re-export); `src/renderer/src/transcript/view/rows/` (`AgentMessage.tsx` becomes the one message line; a new `Notice.tsx`; `User.tsx` for the consent line; `Row.tsx`; `peer.test.tsx` and a notice test) and `transcript.css`; `src/renderer/src/harness/agents/agentsProbes.ts` (`peerRowOf`, which reads this row's DOM for the e2e harness).

**Decisions that belong here and nowhere above.**

- *One component* draws every `agent_message` row (inbound, report, a subagent's message, a sent message): the lead `›`, the line of Interfaces, D, the owners after the name by today's rule (`useSenderOwners`), the address as the name's tooltip. The line is the control (a `button`, or `role="button"` with `tabIndex` 0; Enter and Space toggle it). Its root keeps the class `transcript-peer` and the attribute `data-peer` with today's values, which live e2e specs select by.
- *A notice* is led by `●` in its outcome's token. It opens only when it has `detail` or an output file; "Open output" calls the same action the background work list's Output button calls (`ShellRow`'s `onOutput` in `src/renderer/src/tools/agents/background/TaskRows.tsx`), reached through the transcript's actions (`TranscriptActions`, `transcript/view/context.tsx`). A notice's duration uses the turn line's duration words.
- *Open state* of a message line or a notice is the view's disclosure under the key `line:<row id>` (Interfaces, D).
- *The bubble branch.* An origin-`peer` `user.message` draws no bubble when its turn holds a companion for it (`peer.message` by `messageUuid`; `subagent.message` by today's envelope test); owners are read from sminos's frame line wherever it stands, in the envelope's body or as the text's own first line. A peer text no reader claims keeps its bubble, as today.
- *Work and answer.* A notice or a message line that arrives in the middle of a turn counts, for where the answer starts, as an inbound message does today (it is in `WORK_ROWS`); at the head it does not matter.
- *Persistence.* `isPersistentMessage` goes. `isPersistentRow` gains: a `notice` of class `task` with an outcome, and one of class `schedule`. A `user` row with `consent` is in view as a `user` row is.
- *The reducer.* Decision 6 in the two places it names (`turn.ended`, and a `turn.started` over an open turn). Decision 8 beside the rule for a synthetic message: the reducer remembers which turn holds each arrival-bearing synthetic message by its `messageUuid`, and a later one takes the earlier out of its turn before it is placed (or not placed, when its `arrival` is empty).
- *`opener`* is set when the turn's origin is not `human` and a row stands at its head; its `line` is that row's words without the lead mark and without the owners.
- *Pitfalls.* `schema.ts` holds the snapshot schema of every row kind and `Row.tsx`'s switch is exhaustive: both gain `notice`. `serialize.ts` gives a notice its line and, when opened text exists, its detail. `src/renderer/src/owner/report/project.ts` (U2's) reads `isPersistentRow`: its tests may pin a peer's message staying in the report; change the expectation only. The 120-column cut of a preview stays in the model; the ellipsis at the column's edge is CSS.

**What it does not touch.** The divider's view and words, `groups.ts`, `classify.ts`, the group row, `src/renderer/src/owner/` but for a pinned expectation; `LocalCommand.tsx` and `.transcript-replayed` (U3b); the actions on the owner's message and on an answer (U3b); the callers.

**What it proves.** Acceptance 3 and 10; of Acceptance 4, the rows a hand-made event list gives (a notice at a turn's head above the divider, in a human turn above the prompt, in mid-turn at its point; a withdrawal removes the line and a later event under the same uuid places it on the later turn; an unknown uuid's withdrawal changes nothing). Beyond them its tests pin: an engine turn whose end says `numTurns` 0 and that holds nothing is not among the turns, and one that holds a row is; a `turn.started` over an empty engine turn replaces it and over one with rows closes it as today; a consent event draws the line, with no Copy and no Edit; a jump to a message row inside a folded turn opens the turn.

### M3 — The transcript file and another machine's rows ask the reader

**What exists at its end.** A terminal session on this Mac, any session read from disk, and a terminal session on another machine draw their arrivals from the one reader: Acceptance 2, 4 and 6 on these two routes, and the file half of Acceptance 7. The desk web app's session view, which draws through the same class, changes with it.

**What it touches.** `src/engine-host/fs/backfill.ts` and its test; `fs/chain-follower.ts` only if a boundary predicate it imports changes its answer (below); `src/renderer/src/lane-a/plane-transcript.ts`, `conversation/delivery-frame.ts`, `conversation/ask-answer.ts`, `source/bridge-rows.ts`, `source/bridge-wake.ts`, `source/ask-answer.ts`, `source/appended-turn.ts` and their tests, with `plane-transcript.test.ts`; `src/renderer/src/transcript/model/arrival-routes.test.ts` (new: the file and remote halves); the unit tests under `apps/desk-web/src/` that pin the old drawing, in their expectations only.

**Decisions that belong here and nowhere above.**

- *One cutover for both callers.* The remote reader ends in `recordToEvents`, and `withWakeLine` and `withAnswerLines` add a line to what it returns; with the backfill asking the reader those would draw each line twice. So `eventsOf` stops rewriting what the reader now classes, in the same milestone: `deliveryAsDrawn`'s and `steerAsDrawn`'s rewrites of a row a class claims, `withWakeLine`, `withAnswerLines` and the re-label of a hand-back's turn go, and the row passes through raw.
- *What stays with each caller is placement* (the section's binding line). In the backfill: words the bridge delivered while no turn ran wait for the turn that starts next (`withWaitingWords`, with the wake opening the turn of the words when some wait). In the remote reader: the rows off the live chain (`off-chain.ts`), the later copy of a re-appended delivery (`supersededDeliveries`), the turn that takes rows appended while none ran (`withAppendedTurn`), the interrupt's end (`interrupt.ts`). That code asks the reader for the class and decides nothing about sender or kind.
- *The gate goes.* `humanOrigin` no longer reads every origin but `human` on a plain user row as the person's: the reader is asked first, and a row no class claims keeps today's mapping.
- *An appended delivery is drawn at its own row* (rule 5), not at the mirror line as `sminosDelivery` does today; a mirror line that follows no appended arrival stays the notice it is today.
- *A scheduled fire.* The headless file has the meta `user` row alone: it opens the engine's turn and carries the arrival. A terminal's file has the fire row first: the arrival is read there and the caller places it on the turn the `user` row after it opens; a fire row with no such row after it is placed where it stands.
- *A command the terminal wrote as a `system` row* (`subtype: 'local_command'` whose content is the `<command-name>` block) is the person's command: it maps as the `user` row of a command does today (its bubble, its turn, the turn's end). `localCommandKind` answers `echo` for it.
- *The follower's predicates.* `opensTurn` is defined as "a record that opens a turn on this mapping" and follows it: it becomes true for every row that now opens a turn (a scheduled fire's meta row, the wake, the plugin's answer prompt). `startsTurn` and `isHumanPrompt` serve the follower's rewind and barrier rules, which are about what the engine treats as the person's prompt and not about drawing: read each use in `fs/chain-follower.ts` before changing either, change one only where a use is shown to need it, with its test (`chain-follower.test.ts`, `chain-follower-fx8.test.ts`), and name in the hand-back any place where the drawing changed and the predicate did not.
- *Task state* (decision 13): the block parser the reader uses is exported for the callers' `subagent.finished` and `task.notification`; an `outcome: null` block emits neither.
- *A subagent's own transcript* is mapped by the same function, and the reader is asked there too (its notification rows carry the engine's preamble, which the parser that moves already strips); what today's mapping does for a child alone (`coordinatorMessage`) stays.
- *The tests that change, and why.* `delivery-frame.test.ts`, `delivery-frame.render.test.tsx`: the "From <name>" label goes (O-41). `bridge-wake.test.ts`, `source/ask-answer.test.ts`: the line is a `notice` row, no longer a `plugin.log`. `bridge-rows.test.ts`: a marked steer is `own`; the kinds of the other appended rows are as before. `backfill.test.ts`: a row submitted as the user from a peer is a peer's; a notification with no `<status>` ends nothing. Each changed expectation names its item in the test's title or comment.

**What it does not touch.** The live caller (M4). `src/services/lane-a/`. The desk web app's source beyond a pinned expectation; its e2e file is M6's. What sminos writes.

**What it proves.** Acceptance 2, 4 and 6 on the file and remote routes; Acceptance 7's comparison of the file and remote lists. Beyond them its tests pin: an `own` send whose words are the interrupt marker is a bubble and stops no turn, on both routes; a hand-back claims the next notification of its task and not the one after a resume (`u3-tasks-r1`'s agent and agent-resume cases); the row marked `queueTranscriptOnly` after an idle hand-back yields no row and no turn, and its agent still reads finished; an answer by the hook's context is a `notice` of class `answer` in the turn that took it, and its event carries the arrival for U1.

### M4 — The live wire asks the reader

**What exists at its end.** A session MAWS runs draws its arrivals as they happen: Acceptance 2, 4 and 6 from the journals, and the live half of Acceptance 7 with its stated differences.

**What it touches.** `src/engine-host/normalizer.ts`, `normalizer-system.ts`, `normalizer-support.ts` and their tests (`normalizer.test.ts`, `normalizer-fidelity.test.ts`, the conformance suite where a pinned event changes); `arrival-routes.test.ts` (the live half).

**Decisions that belong here and nowhere above.**

- *The transition table of Interfaces, E is the design.* Build it as written; a case it does not cover is added to the table in this document with a dated line in the Decision Log, not handled in passing.
- *All new state is in `NormalizerState`*, so that a journal replayed through a fresh `Normalizer` gives the same events (the file's first comment). No timer, no clock, nothing outside the rows.
- *Where each class is read.* `userIn`: after the tool-result branch and the replay of MAWS's own frame, the reader is asked before `engineUserMarkerOf` and `bashPartOf`; a frame no class claims maps as today. `assistant`: a frame with `local_command_source` is set aside where `isMadeUpFinalAnswer` is, told by that field and never by the model name. `userOut` (MAWS's own prompt as it is written): the reader is asked for `consent` and for MAWS's own answer envelope; only `consent` adds `arrival`. The `command_lifecycle` branch and the `task_notification` case feed the table. The reader is asked for main-lane frames only; a child lane's frames map as today.
- *A turn's origin, twice* (pitfall 5). The normaliser remembers the arrival at the head of the turn the engine opened. `turn.ended` carries the word for `turnOriginOf` of that arrival when there is one; when there is none it carries today's word, and a `result` with no `origin` on a turn the person did not open stays the engine's. For `peer` and `own` at the head of an engine-opened turn the caller emits the `turn.started` of Interfaces, C, which the model places over the empty engine turn (decision 6); the normaliser's own record of the open turn takes that origin, and for `own` that message's uuid, so that what follows in the turn names it. For a class whose turn is the engine's nothing more is emitted.
- *Idle or during a turn* is whether the open turn has had any main-lane model output or tool frame since it opened. An arrival frame in a turn that has had none is at its head.
- *The task graph's events stay* (`subagent.finished`, `task.notification`, `task.started`, `task.updated`), for foreground commands too: the task graph reads them, and O-34's fix is in the attention service (M6).
- *Pitfalls.* Every replayed frame this milestone reads exists only because MAWS launches the engine with `--replay-user-messages` (`src/engine-host/launch.ts`; `u3-tasks-bare`, `u3-commands-bare` show the wire without it): a test maps the bare fixtures and expects no arrival row and no error. The interrupted `/compact`'s "Compaction canceled." carries no `local_command_run`. The `system/task_notification` frame's `summary` is the engine's sentence only for a background command and a monitor's end; for a foreground command and a stopped task it is the description, and for an agent the note. A hand-back and the notification of its run can arrive at one tool boundary (`u3-tasks-r1`, seq 666 and 667): the second yields nothing. A `command_lifecycle` frame of state `started` also precedes the turn of an inbox message, with a `command_uuid` MAWS never wrote and no `wakeup_source` (`u3-sminos-r1-maws`, seq 51, before the `init` at 52 and the message at 54); a hand-back's turn and a notification's have none. `promptLifecycle` ignores such a frame today and goes on doing so: only `schedule_wakeup` marks a fire.

**What it does not touch.** `src/engine-host/launch.ts` and the launch flags; the broker; `session-status.ts` (#331 is U3b's); the backfill.

**What it proves.** Acceptance 2, 4 and 6 on the live route and Acceptance 7. Beyond them its tests pin, each on the fixture named: the transitions of Interfaces, E one by one (`u3-tasks-r1`: keep and place at seq 58 to 61, settle at 118; keep across the person's turn at 148, place at 159; spent by the replayed frame at 578; the stopped frame at 216 never kept; placed at 753, withdrawn at 762, placed at 763, settled at 780. `u3-tasks-r2`: withdrawn twice before 624. `u3-cron-r1`: the fire at seq 70 drawn at the `init` at 71, and its turn's end, which has no origin, leaves the turn the engine's); a kept notice no turn names is gone after the next `idle` and stands on no turn; replaying a journal twice gives equal event lists; a session with the owner's inbox send while idle has one turn for it, the person's, and no empty turn before it.

### M5 — The rows ask the mods, and a jump's target is revealed

**What exists at its end.** In a session whose mods surface is attached, an arrival's row asks the engine's `UserMessage` site and a sent message's row asks `ToolUse`, so that a mod can fold or draw them as it does in the terminal; with no hook, or a hook that keeps the engine's drawing, MAWS's line stands. `jumpTo` records its target in `ui.revealed`, and a revealed row asks no site (Acceptance 8).

**What it touches.** `src/renderer/src/transcript/surface/` (`Rows.tsx`, `adapters.ts`, their tests), `transcript/view/rows/Row.tsx` (the two mounts), `src/renderer/src/transcript/model/reduce.ts` (`TranscriptUi.revealed`), `src/renderer/src/stores/transcript.ts` (the jump paths) and its test.

**Decisions that belong here and nowhere above.**

- *Read the engine first.* Which messages the engine's own transcript passes through `UserMessage`, and with which `text`, `origin`, `from` and `task`, is read in the engine's bundle for `2.1.322` (`cli.pretty.js`: `useUserMessageSite` near line 93250 and its callers, one near line 291620; cite as `research/SOURCES.md` prescribes). The props sent are those, checked against the schemas of `src/shared/engine/surface-rows.ts`. A class the engine does not pass through the site asks none, and the hand-back says which.
- *The mounts follow `SurfaceUserRow`'s pattern* in `surface/Rows.tsx`: an adapter returns the instance id and the props or null, and `SurfaceRow` draws MAWS's line as the native child. The adapter returns null for a row whose event the host made (its `content` is empty: there is no text to give the site), for a row with no turn, and for the row `ui.revealed` names.
- *The sent message* asks `ToolUse` with its call's props, built as `toolInputs` builds a cell's (`adapters.ts`), from the turn's tool record of `peer.toolUseId` or of the row's call.
- *Every jump path writes `revealed`:* `jumpTo`, the cell jump and `jumpToMessage`. It bumps what a turn's rows depend on only for the turns of the old and the new target.

**What it does not touch.** U2's asks (the run at `ToolGroup`, the message tool's call), which read `revealed` when U2 builds them; `engine-surface/` itself; the to-human mod.

**What it proves.** Acceptance 8.

### M6 — No alarm for a failed background task; the e2e edits; the record; acceptance

**What exists at its end.** A failed background task raises nothing (Acceptance 5). The e2e specs that pinned what this landing changes are edited and typecheck. The record is written. Every acceptance item an executor can show is shown on the VM, class 1a is green, and the hand-back is written.

**What it touches.** `src/services/attention/service.ts` and its test; `src/main/attention/notifier.test.ts` (its sample summary only, if the words are no longer anyone's); `e2e/support/supervisor-scratch.ts`, `e2e/supervisor.spec.ts`, `e2e/cross-build.spec.ts`; `e2e/agent-tools.spec.ts` (the scene "G3"); `e2e/transcript.spec.ts` only where a list of row kinds must gain `notice`; `apps/desk-web/e2e/acceptance.spec.ts` (the "From fakepeer" step); the documents of "The record"; `docs/tech-debt-tracker.md`; this document.

**Decisions that belong here and nowhere above.**

- *O-34 is one removal.* The `task.notification` case of the attention service's derivation goes, with nothing in its place. The section's fallback is withdrawn (the child's O-34), so no entry is kept for any case.
- *The tail's vehicle (decision 16).* `tailFixture` in `e2e/support/supervisor-scratch.ts` inserts, before the permission request, a frame whose derived item is one this landing keeps and that every build of a cross-build pair derives. The candidate is a tool result marked `non_execution_kind: 'automode-unavailable'` (the item "Auto mode unavailable: …", derived in the same function and present at build F, `f1852de3a`). The two specs' checks of the item's id and words follow it. `e2e/supervisor.spec.ts` also checks that a tail error retires once its session is shown (the owner's ruling of 2026-10-30): if the new item does not retire that way, that one check leaves the scene and the hand-back says so; the unit suite holds the ruling for a turn's error.
- *The other e2e edits.* `e2e/agent-tools.spec.ts`, "G3": a closed turn no longer keeps the message from another session in view, the sender reads `@name`, and the rows are read through the updated probe. `apps/desk-web/e2e/acceptance.spec.ts`: a peer's delivery by the bridge is a message line naming its sender, not a bubble opening "From fakepeer". Every edited e2e file must typecheck (`pnpm typecheck` covers `tsconfig.e2e.json` and the desk web app's); none is run by the executor.
- *The tracker row* (the child's O-28, "What has no live carrier"), added to the table of `docs/tech-debt-tracker.md`: logged 2026-11-12; owner "UX wave U3 (O-28)"; item: in a session MAWS runs that is idle, a monitor's event, the engine's notice that a command seems to wait for input, and an agent's end whose report was withheld draw their line only once the session is read from its file, and a background workflow run, an MCP task and a remote agent's end are not kept for a live line at all, since none was probed; evidence: `spikes/protocol-probe/findings-uxwave-u3-tasks.txt` and Acceptance 7's list; closes when the engine sends a frame that carries the sentence for them, or a probe shows one does.
- *The acceptance run* is Concrete Steps, "At the end".

**What it does not touch.** `src/renderer/src/request-card/variants/Notice.tsx`, `composer/docked/` (U1's: the notice card stays for the errors that remain); the offers for `attention.acknowledge` (U9).

**What it proves.** Acceptance 5, 11 and 12, and that 1 to 10 hold together on the branch's head.

### The record (in the same pull request, UC-10)

Each reversed ruling is amended where it stands, with the sentence the child's file gives under "Rulings reversed", exactly:

- **O-12:** appended to the "Persistence" paragraph of Design §4 in `docs/doperpowers/plans/2026-10-06-e7-orchestration.md`.
- **O-41:** appended to the entry "Decision (M6, as built)" in the Decision Log of `docs/doperpowers/plans/2026-10-17-desk-dc9-session-view.md`.
- **O-34:** in `docs/charter.md`, §5.7's sentence reads "when a turn ends in error" and the child's sentence is appended to that paragraph and to the Decision log entry of 2026-10-30 ("the owner's ruling on error attention") in §19.

X1 is amended by a dated line, appended to the X1 entry of `docs/charter.md` §13:

> Amended 2026-11-12 (UX wave, U3; UC-2), additive: `user.message` gains one optional field, `arrival`, the arrivals its carrier holds of class `task`, `schedule`, `answer`, `wake` or `consent` (`src/shared/engine/arrival.ts`). A build that does not know the key drops it and keeps the event. Two synthetic messages that carry it under one `messageUuid` are one arrival, the later standing, and an empty list withdraws it.

The register's rows, the board tickets, the tracker rows this landing closes and the tracking map are updated at landing by the sessions that keep them, not by an executor.

## Concrete Steps

From the worktree of branch `ux-wave/U3a`. Push before every check: the VM sees only what is on origin.

Before M1, once:

    git fetch origin
    git merge origin/master           # a master that holds U6a and U8a; no file of theirs is edited here
    git merge --no-ff origin/ux-wave/probe-arrivals -m "Merge the U3 probes' fixtures and findings (ux-wave/probe-arrivals)"
    git push -u origin ux-wave/U3a

Each merge commit's message ends with the `Sminos-Session:` line like every other commit's. The branch is merged with master, never rebased: it is pushed from its first commit, and the landing is a merge. If master already holds the probe branch the second merge says "Already up to date". Master is merged in once more before the gate.

During a milestone, the tests it touches, then the types and the lint of what changed (paths are per milestone):

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/shared/engine src/shared/graph src/renderer/src/lane-a/conversation src/renderer/src/lane-a/source src/engine-host/fs/backfill.test.ts src/engine-host/normalizer.test.ts src/renderer/src/transcript/model/user-text.test.ts'      # M1
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm test:probes'                                                                                             # M1, after the merge
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/renderer/src/transcript src/renderer/src/owner src/renderer/src/stores src/renderer/src/harness'   # M2, M5
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/engine-host/fs src/renderer/src/lane-a src/renderer/src/transcript/model src/services/sessions apps/desk-web/src'   # M3
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/engine-host src/renderer/src/transcript/model'                                        # M4
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/services/attention src/main/attention'                                               # M6
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm typecheck'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec eslint <the paths the milestone changed>'

The first call for the branch installs dependencies on the VM and takes a few minutes. Each call prints `vmcheck: ux-wave/U3a at <short sha>` and then the command's output; its exit status is the command's. At the commit that adds a milestone's tests they fail (M1's first, with the module `@shared/engine/arrival` not found); at the milestone's head vitest prints `Test Files … passed` with no failure, `pnpm typecheck` prints no error and eslint prints nothing.

At the end (M6), the acceptance run, in this order:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec vitest run src/shared/engine/arrival.test.ts src/renderer/src/transcript/model/arrival-routes.test.ts src/services/attention/service.test.ts src/renderer/src/transcript/view/rows src/renderer/src/transcript/surface'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm typecheck'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm exec eslint src/shared src/engine-host src/services/attention src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/stores src/renderer/src/harness e2e apps/desk-web/e2e test/support'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm test'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U3a -- 'pnpm test:probes'

Each must pass whole. Then, once, in the background, waiting for its notification (up to half an hour):

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u3a

It prints each job's conclusion and the run's URL and exits 0 only when the run is green. That run is the one the pull request's body names.

The hand-back says: what exists and the command and result that showed it; what is not verified (Acceptance 13; the e2e files, written and typechecked but not run: `e2e:supervisor-daemon`, `e2e:cross-build`, `e2e:agents`, `e2e:desk-web`, and `e2e:transcript`, `e2e:lane-a` and `e2e:remote`, whose scenes cross the code changed; the live specs that select the message line, `e2e:p1-live` and `e2e:agents-live`); the scenes the landing should gain (below); the decisions made; anything that contradicts the spec; and the residue. Scenes for the architect to arrange, each with invented content: a peer's message and the owner's own send to a session MAWS runs, idle and working; a background command that exits 0 and one that exits 1, each ending idle and during a turn, with no error card; a subagent's hand-back whose turn reads "Continued for"; a scheduled fire; a recorded terminal session with a peer's row the bridge submitted, drawn as the peer's line.

## Interfaces and Dependencies

What this landing exposes to its siblings is defined here once. A to D and F are what U1, U2, U4 and U3b code against; E is the live caller's design; G says who reads what; H is what this landing consumes.

### A. The reader (`src/shared/engine/arrival.ts`)

The exports the child's file gives (Contracts, UC-2, "The reader"), with its doc comments and the `Arrival` union copied field for field:

    export function readArrivals(row: unknown): Arrival[];
    export function readNext(row: unknown, open: OpenArrivals): { arrivals: Arrival[]; open: OpenArrivals };
    export const nothingOpen: OpenArrivals;
    export function turnOriginOf(arrival: Arrival): 'human' | 'peer' | 'engine';
    export function readAnswerEnvelope(text: string): Extract<Arrival, { class: 'answer' }> | null;
    export type Arrival = …;        // the nine classes: peer, subagent, task, schedule, answer, command, own, wake, consent
    export type OpenArrivals = …;   // opaque

and three additions of this document:

    /** The classes that travel on `user.message.arrival` (B). */
    export type CarriedArrival = Extract<Arrival, { class: 'task' | 'schedule' | 'answer' | 'wake' | 'consent' }>;
    export const CarriedArrivalSchema: z.ZodType<CarriedArrival>;   // strict, field for field

    /** The one definition of the consent sentence: U1c sends it, the reader matches it whole. */
    export function consentMessage(kind: 'command' | 'call', subject: string): string;

`consentMessage(kind, subject)` returns, with `<q>` standing for `JSON.stringify(subject)` and `<kind>` for the word:

    Permission granted for this exact <kind> only, as one whole string: <q>. This does not approve any other <kind>, any part of this one, or running it with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry this exact <kind> if you would like.

That is the sentence the engine's own "Recently blocked" sends for one call (`cli.pretty.js` of `2.1.322`, the template near line 521386 that ends "if you would like.") and the one U1's file gives under l4-approvals-12. The reader's `consent` arrival has `subject` as `JSON.parse` of the quoted string.

Notes on fields siblings read: `answer.call` is the id the carrier names: the tool-use id of the call for a sminos answer, and for MAWS's own envelope the ask id, which is the call's tool-use id wherever the engine gave the call one (`src/engine-host/tool-server/ask.ts`). `answer.answers` is set only for MAWS's envelope. The union has no separate mark for a question that was not answered; `summary` says it, in one of two sentences: the engine's refusal when the person declined the terminal's dialog ("The user doesn't want to proceed with this tool use.", which `answeredWords` reads today), and the bridge's dismissal (decision 18; Surprises & Discoveries, 4). `task.outcome` is `null` exactly when the block claims no end.

### B. X1 (`src/shared/graph/events.ts`)

`user.message` gains `arrival: z.array(CarriedArrivalSchema).optional()`. Nothing else in the file changes. The rules of reading it, for every consumer:

- absent: the message carries no arrival of the five classes;
- on a message whose origin is not `human`: the message is synthetic and never a prompt; each entry is one row;
- on a message whose origin is `human`: only `consent`, on the person's own prompt or steer;
- two synthetic messages with one `messageUuid`: one arrival, the later standing where it arrives; an empty list withdraws it.

### C. What each class becomes, the same from every caller

The task graph's events a frame or row yields today (`subagent.finished`, `task.notification`, `task.*`) are unchanged and are not in this table. "uuid" is the carrier's own; for a `queued_command` row it is the attachment's `source_uuid` when it has one. The third column is the `turn.started` that precedes the message when the arrival opens a turn. On the live wire `system/init` has already opened the engine's turn by then: there the caller emits that `turn.started` only when the turn is not the engine's (`peer`, `own`), and the model puts it in the empty engine turn's place (decision 6).

| class | events | the turn |
|---|---|---|
| `peer` | `user.message {messageUuid: uuid, content: the carrier's text as written, origin: 'peer'}` with `isSynthetic` as that carrier has it today; then `peer.message` as an inbox message makes it today. For a row the bridge delivered: `from: ''`, `fromName` the sender's alias from the frame line, `text` the words after the frame line, `midTurn` true for an appended row, `replyable: false` | when it opens one: `turn.started {userMessageUuid: null, origin: 'peer'}` before it |
| `subagent` | `user.message` as today, then `subagent.message {direction: 'from_child', fromAgentId, toAgentId: null, text}` as today | when it opens one: the engine's (the word a caller writes today for an engine turn) |
| `task`, `schedule`, `wake`, and `answer` from sminos | `user.message {messageUuid, content, isSynthetic: true, origin: 'task-notification', bash: null, arrival: [...]}`. `content` is the carrier's text, and `''` where the engine host makes the event itself. `messageUuid` is the carrier's uuid; for a scheduled fire on the live wire the frame's `command_uuid` (the uuid of the file's row); for a kept notice the `system/task_notification` frame's `uuid` | when it opens one: the engine's. On the file route the row that opens the turn names itself in `turn.started.userMessageUuid`, as a notification row does today |
| `answer` from MAWS's envelope | today's steer events, unchanged; no `arrival` | unchanged |
| `command` | `user.message {messageUuid: uuid, content, origin: 'local-command', isSynthetic: false}` where `content` is the output inside the engine's own tag, `<local-command-stdout>…</local-command-stdout>` or `<local-command-stderr>…</local-command-stderr>`, ANSI escapes removed. Never an assistant block. A uuid already mapped in the launch emits nothing | none: it joins the turn that is running, which is its command's |
| `own` | idle: `turn.started {userMessageUuid: uuid, origin: 'human'}`, then `user.message {messageUuid: uuid, content: words, origin: 'human', isSynthetic: false}`. Into a running turn: that `user.message`, then `command.lifecycle {commandUuid: uuid, state: 'started'}`, the shape of a prompt taken into a turn | the person's |
| `consent` | the events the same message makes today as the person's prompt or steer, with `arrival: [consent]` on its `user.message` | the person's |

A second carrier of an arrival already read (rule 5) emits no `user.message`. A replayed `user` frame or a row of origin `task-notification` that carries no arrival is still emitted with `isSynthetic: true` (decision 4).

### D. The model (`src/renderer/src/transcript/model/`)

Rows (`rows.ts`), the first two as the child's file gives them:

    | { kind: 'notice'; class: 'task' | 'schedule' | 'answer' | 'wake';
        outcome: 'completed' | 'failed' | 'stopped' | null;
        text: string; durationMs: number | null; detail: string | null;
        taskId: TaskId | null; toolUseId: ToolUseId | null; outputFile: string | null }

    // on the divider row of a turn the person did not start
    opener?: { class: Arrival['class']; line: string }

    // on the user row (decision 10)
    consent?: { kind: 'command' | 'call'; subject: string }

`agent_message` keeps its shape; its `text` is the line below. `local_command` keeps its shape.

The lines (the lead mark, `›` or `●`, is the view's and is not in `text` or in `opener.line`):

| row | `text` |
|---|---|
| a peer's message | `Message from @<name>: <preview>` |
| a subagent's message | `Message from <agent>: <preview>` |
| a hand-back | `Report from <agent>: <first line of the report>` |
| a message the agent sent | `Sent to @<name>: <preview>` to a peer, `Sent to <agent>: <preview>` to a subagent; its state (`Sending`, `Not sent`, `Never answered`) is drawn at the line's end and is not in `text` |
| `notice`, `task` | the arrival's `summary`, verbatim; the view adds ` · <duration>` when `durationMs` is set |
| `notice`, `schedule` | `Running scheduled task · <first line of the prompt>`, and `Running scheduled task` when `prompt` is null |
| `notice`, `answer` | `answered: ` and then what `answeredWords` gives for the arrival's `summary` and the call's questions; for the bridge's dismissal sentence those words are `dismissed` (decision 18) |
| `notice`, `wake` | `sminos bridge woke the session to read a message it had not read` |
| `user` with `consent` | drawn as ``You approved `<subject>` ``, the subject as inline code |

`<preview>` is the body's first line, without a leading `@address` token, cut at 120 columns as today. `<name>` is `peerLabel`'s. Ids (`keys.ts`): `rowId.notice` gives `notice:<run id>` for a `task` with a run id, else `notice:<message uuid, or the event's id when it has none>:<index in arrival>`. The open state of a message line or a notice is the disclosure `line:<row id>`; the reply composer's stays `peer-reply:<row id>`.

Where a row sits (decision 5), from the turn's events in order:

| the arrival's event stands | class | the row sits |
|---|---|---|
| before all of the turn's work, or is the message the turn was opened with | `task` with an outcome, `schedule` | above the divider; in a turn the person's prompt opened, directly above the prompt |
| the same | any other | first under the divider |
| after work began | any | at that point among the work |

What stays through a fold: a `task` notice with an outcome; a `schedule` notice; a `user` row, `consent` included. What folds: every `agent_message` row; a `task` notice with no outcome; `answer`; `wake`. `local_command` is as today.

`opener` is set on the divider of a turn whose origin is not `human` when a row stands at the turn's head: its `class` is that arrival's, its `line` that row's `text`.

The reducer's two rules. *An engine turn that held nothing is no turn* (decision 6): a turn of origin `engine` that holds no event that draws a row and no model output (in the recorded cases, its own `turn.started` alone) is removed from the turns when a `turn.ended` with `numTurns` 0 closes it (the end is kept as a loose event, as an echo's receipt is) or when a `turn.started` arrives while it is the running turn. *One arrival per uuid* (decision 8, and B).

### E. The live caller: keeping a task's end until the model is told

State added to `NormalizerState` (the names are the executor's):

- the reader's `OpenArrivals`;
- `kept`: the notices not yet told, oldest first, each with its run id, its message uuid, its `task` arrival and the `seq` of its frame;
- `placed`: the run id of the kept notice whose line stands on the open turn, or none;
- `fire`: the `command_uuid` of a scheduled fire whose turn has not opened, or none;
- the `seq` at which the last turn opened;
- the uuids of the command outputs mapped;
- on the open turn: the arrival at its head, if any, and whether it has had output.

"Place" emits the notice's synthetic message (C). "Withdraw" emits a synthetic message with the same `messageUuid` and an empty `arrival`. Both are emitted on the row that causes them, a withdrawal before that row's own events. Main lane only.

| on | do |
|---|---|
| any `in` frame | give it to `readNext` |
| `system/task_notification` | today's event. If `readNext` yields a `task` arrival (a `local_bash` task that was in the background, status `completed` or `failed`, with a `run_id`): append it to `kept`. Nothing is drawn yet |
| `command_lifecycle`, `state: 'started'`, `wakeup_source: 'schedule_wakeup'` | today's event; `fire` is its `command_uuid` |
| a turn opens with the person's prompt | record the `seq`; place nothing |
| `system/init` opens an engine turn | today's `turn.started`; record the `seq`. If `fire` is set: emit the `schedule` message and clear `fire`. Else if `kept` is not empty: place the oldest; `placed` is its run |
| a replayed `user` frame that is a `task` arrival | if its origin's `runId` is in `kept`: remove it, and if it is `placed`, withdraw and clear `placed`. Then emit the frame's own message with its arrivals |
| any other replayed `user` frame, in a turn that has had no output | if `placed` is set: withdraw and clear `placed` (the notice stays in `kept`): the turn is that frame's. Then the frame's own events |
| `result` | if `placed` is set: when the result's origin names that run, remove it from `kept` (settled); otherwise withdraw. Clear `placed`. Then, if the origin names another run in `kept`: remove it and place it now (its line stands at the end of that turn's work: the wire gave no earlier proof). Then today's `turn.ended`, with the origin's word as M4 says |
| `system/session_state_changed`, `state: 'idle'` | drop every kept notice whose `seq` is lower than the `seq` at which the last turn opened |
| the launch ends | the state ends with it |

What holds at every row: at most one notice is placed; a notice has at most one line standing; a line is placed only on a turn the engine opened; a frame of a task that was never in the background, of status `stopped`, or of an agent is never kept.

### F. A jump's target (`src/renderer/src/transcript/model/reduce.ts`, `src/renderer/src/stores/transcript.ts`)

    // TranscriptUi
    revealed?: RowId | CellId;   // the target of the tab's last jump; absent before the first

Written by `jumpTo`, by the cell jump and by `jumpToMessage`, each replacing the last. A row or cell it names asks no mod's site and is drawn by MAWS. U2 reads it for its own asks and may clear it by its own rule ("when the reader leaves the row's page"); this landing adds no clearing but the next jump.

### G. What each sibling reads

| sibling | reads |
|---|---|
| U1b (the placement, O-21) | `event.arrival` entries of class `answer` on the file and remote routes (`call`, `summary`), to fill the question's row; the `notice` row of class `answer`, which it may stop deriving; MAWS's own answers stay on `maws.ask.answered`, as today |
| U1c ("Approve and retry") | `consentMessage` to build what it sends; the `consent` line is already drawn |
| U2 | the row kinds `agent_message`, `notice`, `local_command`; the fold table of D; `opener` on the divider; a turn's origin, which for a hand-back's turn is now the engine's; `ui.revealed`. The empty turn after an idle hand-back is already no turn (decision 6) |
| U4b (X-049) | `readAnswerEnvelope(text)` on a waiting message's text |
| U8b | the `task` notice and the report line as the trace of work that left its card |
| U3b | the `local_command` row and its event (C: the tag says stdout or stderr); `jumpTo` and `revealed`; the disclosure key `line:<row id>`, which find opens; `ACTIONS` rows only, for its five chords |
| U9, U6b | nothing |

### H. What this landing consumes

- **U6a** (`docs/doperpowers/plans/2026-11-12-ux-wave-U6a-keymap.md`, branch `ux-wave/U6a`): nothing. No action is added here.
- **U8a** (`…-U8a-working-folder.md`, branch `ux-wave/U8a`): nothing. It edits one line of `transcript/view/TranscriptSlot.tsx`, which this landing does not touch.
- Both only set the base: the master that holds them is merged into the branch before M1, and master once more before the gate.
- **The probes** (`origin/ux-wave/probe-arrivals`): decision 1. The landing's tests read `spikes/protocol-probe/fixtures/uxwave/`: every journal with its `.transcript.jsonl` of `u3-tasks-r1`, `-r2`, `-fg`, `-bare`, `u3-sminos-r1-maws`, `u3-cron-r1`, `u3-commands-r1`, `-bare`, `u3-hookctx`, and the transcript files of `u3-sminos-r1-terminal`, `u3-terminal-cron-r1`, `u3-terminal-commands-r1` and `u3-terminal-checkin-r1`.
- **Code reused, not rewritten:** `parsePeerMessage`, `peerEventsOf`, `handbackReport`, `sminosFrameSender`, `sminosFrameOwners`, `peerLabel` (`src/shared/engine/peer-envelope.ts`); `parseAskSteer` (`src/shared/maws/ask.ts`); `stripAnsi` (`src/shared/wire/ansi.ts`); `slashCommandLine` (`src/shared/wire/local-command.ts`); `SurfaceRow` (`src/renderer/src/engine-surface/SurfaceRow.tsx`); `readTolerant` (`src/shared/ipc/tolerant.ts`).

## Surprises & Discoveries

Found while checking the section against the code at `85e934368` and the fixtures on `origin/ux-wave/probe-arrivals`, before any building. Each was reported to the wave's architect on 2026-11-12; none is resolved here beyond what the entry and the decision it names say.

1. Observation: the remote reader has a second consumer the section does not name. The desk web app draws its session view through the same `PlaneTranscript` and `eventsOf`, so O-41 and the `notice` lines change its drawing too, and its e2e pins the label O-41 reverses.
   Evidence: `apps/desk-web/src/depth/source/desk-source.ts` (`new PlaneTranscript`), `apps/desk-web/src/conversation/asked.ts` and `tail.ts` (imports of `askAnswers` and `deliveredLines`); `apps/desk-web/e2e/acceptance.spec.ts`, `toHaveText('From fakepeer')`. The ruling O-41 reverses (DC9's "Decision (M6, as built)") was made for that view.
2. Observation: the section's list of tests that pin today's behaviour misses four places, and two e2e specs use the failed-task item as the means of another proof.
   Evidence: `e2e/agent-tools.spec.ts`, "G3" ("closed turns keep the message from another session, with Reply"; `who: '@ <name>'`), read through `peerRowOf` in `src/renderer/src/harness/agents/agentsProbes.ts`; `e2e/p1-live.spec.ts` selects `.transcript-peer[data-peer="inbound"]`; `apps/desk-web/e2e/acceptance.spec.ts` as above. `e2e/support/supervisor-scratch.ts` (`tailFixture`, `TASK_FAILED`): `e2e/supervisor.spec.ts` and `e2e/cross-build.spec.ts` prove that a tail journaled while no app ran reaches main's listeners by the item O-34 removes (decision 16).
3. Observation: UC-2 says the `command` class needs no `arrival` on its event, and O-18's "After" has the row and the mod's site read `run` (the command as the engine ran it) from the reader. X1's `user.message` has no field for `run`. This landing keeps the engine's tag in the event's content, which carries stdout or stderr, and carries no `run`; where `run` travels is U3b's to add under the architect's word.
   Evidence: the child's file, Contracts, "X1's `user.message` gains one optional field … (`command` and `own` need none)"; O-18, "it now gets the command's name and arguments from `run`" and "The name is `run.command`".
4. Observation: the root's UC-2 says an answer carries "the answer in words, or 'dismissed'"; the child's `answer` class has no mark for a dismissal, and its row table words the `answer` line for an answer only. The type is built as the child gives it and the line's words for a dismissal are decision 18's. Two facts from the bridge's side, told by the architect on 2026-11-12, bear on what a reader of the transcript can say: no row carries a dismissal when it is pressed (it rides as context on the model's next tool result or the person's next prompt, and it can be lost if the session ends first), so the `answer` arrival for it exists only once that delivery lands; and a dismissal reaches a plugin's prompt only beside another question's answer, in one row.
   Evidence: the root, UC-2, "Classes"; the child's `Arrival` union and "The rows"; `answeredWords` in `src/renderer/src/lane-a/conversation/ask-answer.ts` (`DECLINED`); the report of doperpowers pull request #497 (sminos 1.47.0), "Where MAWS's design text and the plugin disagree", 2 and 7.
5. Observation: on the live wire a turn the engine opens exists in X1 before any frame says what it is for, and the model cannot turn an engine's turn into the person's. Rule 5's "no turn" for the empty turn after an idle hand-back, and the person's turn for the owner's own inbox send, both need the model to drop an engine turn that held nothing (decision 6). The section gives the empty turn's line to U2; this landing removes the turn, which leaves U2's rule nothing to do for these two cases.
   Evidence: `Normalizer.systemInit` emits `turn.started {origin: 'engine'}` at `system/init`; `Batch.close` in `reduce.ts` takes a result's origin only when it is not `human`; `u3-tasks-r1.jsonl`, seq 355 and 356 (an `init` and a `result` with `num_turns: 0`, adjacent, in both runs); `u3-sminos-r1-maws.jsonl` (the owner's send arrives as a replayed `user` frame after the `init`).
6. Observation: a replayed notification frame opens a turn in the model today that never starts and never shows. It is not drawn, which is why it went unseen (decision 4 ends it).
   Evidence: `Normalizer.userIn` passes `isSynthetic: frame.isSynthetic ?? false`; the `user.message` case of `apply` in `reduce.ts` opens a pending turn for a message that is not synthetic and has no turn; `u3-tasks-r1.jsonl`, seq 578 (`isReplay: true`, no `isSynthetic`).
7. Observation: in the second run a monitor's end is kept across two turns that are not its own, not one, so its line is placed and withdrawn twice before it settles.
   Evidence: `u3-tasks-r2.jsonl`: the frame at seq 580, `init` at 590, 600 and 610, results at 599 and 609 with no run, and at 624 with the run. In `u3-tasks-r1.jsonl` it is once (743, then 753 to 762, then 763 to 780).
8. Observation: `result.queued_turn_count` is 0 on every result of both task fixtures, also where another turn follows, so it cannot bound a kept notice. `session_state_changed: idle` can (decision 7).
   Evidence: `u3-tasks-r1.jsonl`, the results at seq 739, 752 and 762, each followed by an `init` with no `idle` between; the `idle` frames at 56, 119, 178, 781.
9. Observation: `src/services/lane-a/jobs.ts`, and its copy in `apps/desk-hub/fake-machine/jobs.ts`, hold another reader of `<task-notification>` rows, for a terminal session's job list. It is not a caller of UC-2 and is not touched. Whether its reading of a block with no `<status>` matters to U8's cards is not checked here.
   Evidence: `plainNotification` and the `queued_command` branch in that file.
10. Observation: O-41's entry says the session of the owner's sighting "is traced before the first pull request". No executor can do it: the files are the owner's (UC-11). It is the architect's, and it decides which scene the owner is shown, not what is built.
    Evidence: the child's O-41, "Which carrier can produce what the owner saw".
11. Observation: `apps/desk-web/e2e/acceptance.spec.ts` on master holds a home path in a recorded reply line (a string beginning `/Users/`). It is outside this landing; it is named because UC-11 binds the repository.
    Evidence: the line that defines `reply` in the peer's inbox step of that file.

## Decision Log

- Decision: verification for this landing. This document gets an adversarial review before the executors start, dispatched by the wave's architect. The branch gets `doperpowers:review-code` at the xhigh panel: the rule is medium, or the panel at about twenty changed files or a couple of thousand changed lines, and this landing is expected to change 70 to 85 files and 6,000 to 8,000 lines (about 30 product files, 35 unit-test files, 6 e2e and harness files, 4 documents and this one), apart from the probe branch's merge (55 files, 10,754 lines of fixtures, findings and probe scripts, which the review reads for provenance and not as code). Class 1a on GitHub Actions (`static,unit,probes`) is the gate of record, once, on the branch's head. Electron e2e is run by the architect on a Mac under the load rule: the landing edits `e2e/supervisor.spec.ts` and `e2e/cross-build.spec.ts` with `e2e/support/supervisor-scratch.ts` (groups `e2e:supervisor-daemon`, `e2e:cross-build`), `e2e/agent-tools.spec.ts` (`e2e:agents`) and `apps/desk-web/e2e/acceptance.spec.ts` (`e2e:desk-web`); it adds no spec file; the scenes it should gain are listed in Concrete Steps, and a reworked scene runs alone on a Mac before a final gate. The pull request's body names its class 1a run, its review verdict and its residue, and the pull request carries the dated amendments of the rulings it reverses where they stand ("The record").
  Rationale: the root's UC-10 and its Decision Log, "Verification"; the size is several times the panel's mark, and the live caller's state table and the reducer's two rules are the parts a single pass would miss.
  Date/Author: 2026-11-12, the author of this document, for the wave's architect.

## Outcomes & Retrospective

Pending — written at finish.
