# UX wave · U3b · the rest of the transcript rows, find and navigation (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U3**, what the child still owes after its first landing (**U3b**), parent pin `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80` (master).
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U3-transcript-rows.md`: acceptance A5 to A13; Edges ("Two pull requests": the second is this one, with the one word U8 leaves to it); Contracts → UC-3, UC-6, UC-7 and UC-8 as consumed, and of UC-2 the `command` class and "X1's `user.message` gains one optional field"; the items O-18, O-07, O-08, O-02, l2-transcript-07, #331, #146, l2-transcript-08 and l2-transcript-09; "Probes and checks" 5, 6 and 7; under "Rulings reversed", the rows O-08 and O-02. In the root: Purpose, the wave's laws, UC-3, UC-6, UC-7, UC-8, UC-10, UC-11, UC-14 and "Ordering and dependency map". The register (`docs/doperpowers/evidence/ux-wave-2026-11/register.md`) lists no open question. Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the cut into two landings, what the code at the pin needs, the decisions the section left open, what each sibling in flight is assumed to leave, the names later work builds on, and the execution. **Branches:** `ux-wave/U3b` (the first landing) and `ux-wave/U3b-2` (the second, cut from a master that holds the first). **Board:** #588 for the first landing; the second gets a ticket of its own, registered by the architect (the wave's epic is #573; U3's first landing was #576).
> **Read at** master `63c97b5c0`, the pin. Revised on 2026-11-15 for the adversarial review, the architect's rulings and the probes' results, when master was at `3678e3c00` (since the pin: two unit cases gained a time bound, and the card column's fix for a split added `sessionsInView` to `stores/layout-model.ts`; nothing these landings read changed, and `focusedSession()` and `tabOnScreen` are as they were). Master is not merged here. The probes' fixtures and findings are on `origin/ux-wave/U3b-probes` at `1048cdf89`. Each landing re-reads "The statements to read again" before it is built.

## Purpose

After these two landings the transcript reads the way the owner asked for in nine items, on every route a session reaches the window by.

The first landing changes what rows look like and what a message offers:

- A slash command's output is a dim line under the command, two lines at most, with "Show more" for the rest. The bordered "Command output" card is gone.
- A code block wraps its long lines inside one frame with no empty band over it. A code block and a table are never wider than the text column; a wide table scrolls sideways inside its frame.
- The time, Copy and Edit of the owner's message sit under the bubble and appear on hover, taking no height.
- The last answer before the owner's next prompt offers Copy, "Fork from here" and its time, on hover.
- While a session compacts, a line at the transcript's end reads "Compacting session…" with the time so far, and its hover card in the sidebar says the same.
- A call of the web plugin's fetch tool draws as a web fetch does.

The second landing makes a long session searchable and walkable from the keyboard:

- ⌘F opens a find bar over the transcript. It counts the matches in the whole loaded session, folded parts included, and Enter, ⌘G and ⇧⌘G step through them, opening what holds each. Every match it counts is one it can mark and bring into view.
- ⌥⌘↑ and ⌥⌘↓ bring the previous and next prompt to the top of the pane. With a message focused from the keyboard, ↑ and ↓ move between messages.

How to see it working: the acceptance section's checks, each a unit run on the build VM or a scene on a Mac, and the owner's look at the built window ("Proof that an executor does not run").

## Progress

- [x] (2026-11-15) Execution document written; the section checked against the code at `63c97b5c0`, against the fixtures under `spikes/protocol-probe/fixtures/`, against the pinned engine's bundle where no fixture holds a statement, against Claude Desktop `app-5.1231.2`, and against the seven branches in flight. The points of "Reported to the architect" handed back.
- [x] (2026-11-15) The adversarial review (six findings, each verified by the architect in the code) and the architect's rulings on it, on the eleven reported points, on the cut, the cards and the probes; this document revised once for all of them (Decision Log; "Reported to the architect, and ruled").
- [ ] The re-check pass of "What this document assumes of landings in flight", before the first executor starts.
- [ ] **Landing 1**, branch `ux-wave/U3b`:
  - [ ] M1 — A command's output is a light line.
  - [ ] M2 — Code blocks and tables keep the column; the owner's message actions sit under the bubble.
  - [ ] M3 — An answer's Copy, Fork from here and time.
  - [ ] M4 — A compaction says so.
  - [ ] M5 — The web plugin's fetch, and the word for an agent that ended with its session.
  - [ ] M6 — The scenes, the record, the last run of landing 1.
- [ ] **Landing 2**, branch `ux-wave/U3b-2`:
  - [ ] M7 — The five keys, and moving between prompts and messages.
  - [ ] M8 — Find: one reading of what a row draws.
  - [ ] M9 — Find: what is counted, opened and kept current.
  - [ ] M10 — Find: the bar, the marks and where the view lands.
  - [ ] M11 — The scenes, the measurements, the record, the last run of landing 2.

## The cut: two landings

Counted from the code (the table under "Size and review"), the whole of U3b is about a hundred and ten files and eight thousand changed lines. That is more than three times the size from which a branch gets the review panel, and the two halves share no state:

- **Rows and message actions** (M1 to M6) change what five row kinds draw and what two of them offer. Their state is the row model, one optional entry on an event, the session's status and one act on a session.
- **Find and keyboard navigation** (M7 to M11) add no row and change no row's drawing. Their state is a find controller per mounted transcript, the list's handle, a jump's options and five rows of the action table.

What the second reads of the first is three things, all fixed in this document: how a command's output is drawn and the disclosure `line:<row id>` that opens it (Interfaces §B), the rows' kinds, and where an answer's action row sits. So the cut is two landings, each a pull request, each read by the panel in one pass.

**The first landing is rows and message actions.** Find searches the rows as they are drawn and opens what they fold, so it is designed against their final shape; the first closes three board tickets and carries both reversed rulings; and it is the half the branches in flight meet (a restyled row conflicts by lines, a find bar by nothing), so it should be on master early. The second landing's milestones are written so that a second executor can be handed M7 to M11 with this document and a master that holds the first.

Kept as one was the alternative. It lost on review quality: a panel that reads eight thousand lines of two unrelated concerns reads neither well, and a finding in find would hold back three tickets' worth of finished rows.

## What this document assumes of landings in flight

One list, read at the head of each branch on 2026-11-15, checked again by the executor at each merge of master (Concrete Steps, 1) and by the architect when each of these is on master. Either side may land first; where both edit a file, the later one resolves the lines at its merge.

| landing (branch read) | files it changes that these landings read or edit | what this document assumes | if it does not hold |
|---|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b` at `5c7e17dcc`; its merge-base is 81 commits behind master) | `transcript/view/Transcript.tsx`, `view/rows/Row.tsx`, `view/cells/CellLine.tsx` (24 lines), `view/transcript.css`, `model/derive.ts` (`isPersistentRow`), `model/rows.ts`, `schema.ts`, `reduce.ts`, `keys.ts`, `stores/transcript.ts`, `session/SessionPane.tsx`, `keymap/dispatcher.ts`, `keymap/useKeyChord.ts`; new `view/waiting-view.tsx` | No new row kind. The list is given the store's rows plus one synthetic last row (`END_ROW`, kind `request_slot`, `turnId` null) that is never in the store's rows. `RowFrame` stays focusable (`tabIndex={-1}`). The "Jump to latest" button gains a second state at the same place; nothing is added at the pane's top. `jumpTo`, `revealed` and the scroller are unchanged. A key binding can `claim` a key from inside a text field | Landing 1 places its rows before the end row. Landing 2's prompt and message steps skip `END_ROW`, and its find never counts it (it is not in the store). If U1b's `claims` is on master, nothing of landing 2 uses it: its keys are menu rows and the field's own handlers. Landing 2 moves the words of a call's line into one pure function in `view/cells/CellLine.tsx` (decision 27); whichever lands second keeps the other's lines |
| U2b, the to-human view (`origin/ux-wave/U2b` at `105d08c66`; a second pull request is planned) | `model/rows.ts` (a new row kind `record_fold` replaces `owner_record`; `assistant_text.reportOnly`), `keys.ts`, `serialize.ts`, `reduce.ts` (`ui.openStretches`, `noTurnFold`, `modDraws`; `reportOpenTurns` gone), `stores/transcript.ts` (`jumpTo` opens the closed stretches that hold its target; `toggleStretch`, `mountView`), `view/Transcript.tsx` (the row composition rewritten), `view/rows/Divider.tsx` (`TurnLine` beside the folding divider, both through `useDividerSummary`), `view/rows/AssistantText.tsx`, `view/rows/Row.tsx`, `transcript/shell.tsx`, `shared/keymap/actions.ts` (`transcript.markAllRead`, pinned directly after `transcript.toggleReport`), `settings-tab/keymap.test.ts`; new `owner/view/mirror.ts` with an exhaustive `classOf(row)` | The message's DOM gains a level (`.transcript-answer > .owner-message-ink > .transcript-prose`). `jumpTo` to a row inside a closed stretch opens the stretch; `jumpTo` to a stretch's head text does not show that text's unmarked words. Under `noTurnFold` no turn folds. `useDividerSummary` and `dividerHead` still make the turn line's words | Landing 1's width rule is written against any depth under `.transcript-prose` (decision 9). Its compaction line is a row of its own, appended after the mirror's composition, and no turn line's words change (decision 16). Its new row kind `activity` is classed in `classOf` as a row that stays, at whichever of the two lands second (re-check 6). What Copy takes for an answer, and where its action row stands in a closed stretch, is statement 13. Landing 2's find opens a head's stretch itself (decision 28) and its five action rows stand before `transcript.toggleReport` in the table, so the pinned pair stays adjacent |
| U1c, "Approve and retry" (`origin/ux-wave/U1c` at `4c684cd4e`; a document only) | planned: `src/shared/engine/arrival.ts` (the `consent` class), `view/context.tsx`, `cells/CellLine.tsx`, `model/cells.ts`, `copy.ts`, `derive.ts`, `keys.ts`, `transcript.css` | It relies on `User.tsx` drawing `ConsentLine` in the bubble's place for a row with `consent`, and on `arrival.ts` keeping the `consent` class | Landing 1 keeps both. A consent line gets no action row under it (decision 11) |
| U4b, the composer's integrations (`origin/ux-wave/U4b` at `bc4e5e2dc`) | `model/copy.ts` (a new export `askQuestionTitle(question)`, placed after `askStateCopy`), `model/serialize.ts` (the import line that names the `ask` copy, and the `ask` case), `view/rows/AskCapsule.tsx` | Nothing of landing 1 or 2 reads `askQuestionTitle` | Landing 1 edits the import line above U4b's in `serialize.ts` (it stops importing `LOCAL_COMMAND_HEADER`); the second to land keeps both lines |
| U5b, Review as one scroll (`origin/ux-wave/U5b` at `dcd368046`) | none of these landings' files; its second pull request plans one condition in `AnchorChip` of `view/rows/User.tsx` | `AnchorChip` and its `path` handling stand as they are | Landing 1 does not edit `AnchorChip` |
| U10b-3, the chat bar over a surface (`origin/ux-wave/U10b-3` at `8bada7ae6`) | none of these landings' files | The bar mounts the session's pane in its compact form, which mounts no transcript | A compact pane has no find bar and no prompt to jump to; ⌘F then acts on nothing (decision 32) |
| U8d, a terminal session's subagents (`origin/ux-wave/U8d` at `f35a83874`) | none of these landings' files; its scenes read the agents row by the class `transcript-subagent` and the words "started working" | It leaves the row's word for an agent that ended with its session to this landing | Landing 1 changes that one sentence and neither the class nor "started working" (decision 19) |

**The statements to read again** before an executor starts, and at each merge of master. Each is one `git grep` or one read; where one fails, the fourth column above says what to do, and where that is not enough, stop and report.

1. `src/renderer/src/transcript/view/rows/LocalCommand.tsx` still draws `LOCAL_COMMAND_HEADER` over a `<pre>` in `.transcript-replayed`, and `rows/Bash.tsx` is the only other user of the `.transcript-replayed*` classes.
2. `ArrivalEntrySchema` in `src/shared/engine/arrival-schema.ts` is still a union of `CarriedArrivalSchema` and a loose object for a class outside `CARRIED_CLASSES`, and the reducer still routes a `user.message` of origin `local-command` that is not synthetic before it reads `arrival` (`model/reduce.ts`, the branch `isLocalCommand(event.origin, event.content) && !event.isSynthetic`).
3. `transcript.css` still holds the W2 breakout rule (the four selectors that end in `[data-streamdown="table-wrapper"], [data-streamdown="code-block"]` with `max-width: min(calc(var(--measure-wide) …`), and `e2e/transcript.spec.ts` still pins 864.
4. `view/rows/User.tsx` still draws `.transcript-user-actions` inside `.transcript-user-body`, and `apps/desk-web/src/views/conversation/Bubble.tsx` still writes the same markup by hand.
5. The fork act is still `forkSession(appSessionId, target, first)` with `forkInPlace(appSessionId)` beside it in `src/renderer/src/sessions/record-ops.ts`; whether it can run is still `useForkUnavailable(appSessionId)` in `src/renderer/src/lane-b/remote-unavailable.ts`, whose sentences `src/shared/ipc/remote-unavailable.ts` makes; and `session.fork` is still offered to a machine's owners for an in-place fork behind `rl2.session-acts` (`src/endpoint/offers.ts`).
6. Whether `owner/view/mirror.ts` exists (U2b on master). If it does: `classOf` has a case for every row kind of `model/rows.ts`, and `stretchHolding` still answers null for a stretch's head.
7. Whether `view/waiting-view.tsx` exists (U1b on master). If it does: the end row is still appended last and is still not in the store's rows.
8. `EngineSessionStatusSchema.activity` is still `'compacting' | 'requesting' | null` and `src/engine-host/session-status.ts` still clears it at a `result` and at any status that is not one of the two.
9. `ACTIONS` in `src/shared/keymap/actions.ts` holds no row on ⌘F, ⌘G, ⇧⌘G, ⌥⌘↑ or ⌥⌘↓, and `WAVE_DEFAULTS` in `src/shared/keymap/actions.test.ts` still names the five `transcript.*` ids with those chords.
10. `jumpTo` in `src/renderer/src/stores/transcript.ts` still records `ui.revealed`, still resolves a hidden target against every turn expanded, and the view's jump effect in `Transcript.tsx` still focuses the target in the frame after the scroll.
11. `WIRE_MINOR` in `src/shared/ipc/wire.ts` and what `e2e/cross-build.spec.ts` says of an equal wire, against Interfaces §H.
12. The seven rows of the table above, each against its branch's head or against master once it has landed.
13. **The answer in the to-human view** (when U2b is on master). Copy takes the same rows in either view: every `assistant_text` row of phase `answer` of the answer's turn, read from that turn's complete projection (`expandedTurnRows`), marked or not, folded or not. The action row stands under the last *drawn* row of that turn that is one of those answer blocks or the stretch's head text; a turn that draws neither has no action row until its record is opened. Read `mirrorRows` and `stretchesOf` again and confirm that a closed stretch still leaves its head `assistant_text` in the list; then add the integration case of acceptance 7 over the real mirror (the same answer of two blocks, the second unmarked, copied with its stretch closed and open: the same text).
14. `view/cells/CellLine.tsx` still computes a call's words in `shellLabel`, `FileLabel` (with `shortestFileSuffix` over `FilePathsContext`) and `CodeText`, and `.transcript-cell-label` is still one line cut with an ellipsis; `NoticeRow` still draws `noticeLine(row)` whole in what it opens, and `AgentMessageRow` still opens onto `row.report ?? row.peer?.body ?? row.body ?? row.text`.
15. `origin/ux-wave/U3b-probes` (or master, once it holds them) has the four findings files `spikes/protocol-probe/findings-uxwave-u3b-{autocompact,webfetch,bridge-command,fork-delivered}.txt` and the fixtures "Engine facts" cites from them; landing 1's executor merges that branch as a commit of its own before M4.

## The landing's edge

What the first landing (U3a, pull request #643) built was read from master, not from the child's text.

| part of U3 | on master today (U3a) | landing 1 | landing 2 | not here |
|---|---|---|---|---|
| A5, O-18 (with #330) | a command's output is read as an output on every route, placed in its command's turn, never twice; `/effort low` draws nothing; a command a terminal wrote as a `system` row draws its bubble. It is still drawn as the "Command output" card (`view/rows/LocalCommand.tsx`) | the light line, two lines and "Show more", `<local-command-stderr>` in `--danger`, the line standing alone under the command's name, `run` reaching the row and the mod's site (M1) | — | telling a command the sminos bridge ran from one the person typed: no recorded carrier tells them apart (Probes, 2) |
| A6, O-07 | nothing | M2 | — | line numbers; "Run in terminal"; the frame's radius and tint |
| A7, O-08 | nothing; `e2e/transcript.spec.ts` pins the 864 px breakout | M2, with the scene reversed in M6 | — | Desktop's "Expand table" |
| A8, O-02 | nothing | M2 | — | "Rewind to here" on the owner's message; a context menu |
| A9, l2-transcript-07 | nothing; U9's fork act is on master (`forkSession`, `rl2.session-acts`) | M3 | — | an action row on a turn with no answer; "Copy turn as markdown"; Pin, Read aloud, ratings |
| A10, #331 | the engine host keeps `activity`; nothing in the renderer reads it | M4 | — | progress within a compaction; a compaction a terminal starts by itself |
| A11, #146 | nothing | M5 | — | other plugins' fetch tools |
| the word U8 leaves (Edges) | the transcript's agents row reads "was stopped" for an agent that ended with its session | M5 | — | the panel's words (U8's) |
| A12, l2-transcript-08; UC-6's three find rows; check 6 | nothing; `jumpTo` and `ui.revealed` are there to build on | — | M7 (the rows), M8, M9, M10, M11 | find in a subagent's transcript; match case, whole word, regular expressions; tool output and thinking |
| A13, l2-transcript-09; UC-6's two prompt rows | nothing | — | M7 | a chapter rail; a "Jump to prompt…" list; a tab stop of the transcript's own for messages |
| "Rulings reversed" | O-12, O-41, O-34 amended | O-08 and O-02 amended where they stand (M6) | — | — |
| X1's dated line | `arrival` recorded in the charter's §13 | one more dated line for the `command` entry (M6) | — | — |
| check 5 (#330's other symptoms) | — | a scene and a look at the built window (M6; Proof) | — | — |
| check 7 (builds a version apart) | U3a's unit test | the same test, extended to the `command` entry (M1); one scene in the cross-build spec and a run against each older build (M6; Interfaces §H) | — | — |
| the board at landing | #576 closed | #330, #331, #146 close; #44 closes with its first item pointed at O-02 | #588 closes | — |
| U9's A4, "searched during an outage" | a remote pane stays mounted while its machine is unreachable | — | find reads what the window holds, so it works there (Acceptance 21) | — |

## Words used here

- **Paths.** A path that begins with `view/`, `model/` or `surface/` is under `src/renderer/src/transcript/`; one that begins with another folder of the renderer (`transcript/`, `stores/`, `lane-a/`, `lane-b/`, `composer/`, `keymap/`, `sessions/`, `session/`, `sidebar/`, `request-card/`, `owner/`, `settings-tab/`) is under `src/renderer/src/`; every other path is from the repository's root. Fixtures named without a root are under `spikes/protocol-probe/fixtures/`.
- **Row:** one entry of the transcript's presentation model (`Row`, `src/renderer/src/transcript/model/rows.ts`), drawn by one component. **The store's rows** are what `rowsOf` derives for a session (`src/renderer/src/stores/transcript.ts`); **the drawn list** is what one mounted `Transcript` gives its list after it adds its own rows (a waiting tail, a placed row).
- **Fold:** anything that takes rows or text out of view until opened: a closed turn (the turn line folds its work), a closed tool run (a `group` row), a message or notice line that opens onto its body, a bubble past nineteen lines, a pasted block's chip, and, once U2b is on master, a closed stretch of the to-human view.
- **Disclosure:** the open or closed flag of a fold that the view alone holds, by a string key, per mounted transcript (`Disclosures`, `view/context.tsx`).
- **Jump:** `jumpTo(key, id, options)` of the transcript store: it opens the folds the store owns around a row or a cell, records the target as the tab's *revealed* row, and asks the view to scroll to it.
- **Build F** is `f1852de3a` and **build G** is `2c7044231`: the two older builds a profile or a peer can still be. What this work sends is stated against both.
- **The desk** is the desk's web app, `apps/desk-web`, another package of the workspace that imports the transcript's files by relative path.
- **Menu row, renderer row:** a row of `ACTIONS` whose `sink` is `menu` is an accelerator of the macOS application menu, which tells the page to run it; a `renderer` row is matched by the page's own key dispatcher.

## Today, at `63c97b5c0`

Each statement was read in the code; the ones the child's text has differently are marked.

- **A command's output.** `LocalCommandRow` draws the header `LOCAL_COMMAND_HEADER` ("Command output") over a `<pre>`, in the `.transcript-replayed` frame it shares with the `!` shell row (`rows/Bash.tsx`). The row is `{ kind: 'local_command', messageUuid, text }`: nothing says whether the text came from `<local-command-stderr>`, and nothing names the command. The mod's site gets its `command` and `args` from `commandInput` (`surface/adapters.ts`), which sorts and walks every event of the session on each call and sends `isErrored: false` always. The reader already reads `run` from the live frame's `local_command_run`; it does not read the file row's `commandRun`, which the fixtures hold (Engine facts, 6).
- **A code block** is Streamdown 2.6's: an outer frame (`[data-streamdown="code-block"]`, padded, with `content-visibility: auto`), a header 32 px tall that holds the language name, a copy control pulled up over the header by a negative margin and `position: sticky`, and the body in a second bordered frame with `overflow-x: auto`. Each source line is a `display: block` span. The copy control copies the fence's source from context, not from the DOM, and is disabled while the block streams.
- **A table** is Streamdown's wrapper: a frame, a row that holds only its copy control, and an inner frame with `overflow-x: auto` and `overflow-y: auto` under `tableMaxHeight: 320`.
- **The breakout.** One rule of four selectors in `transcript.css` lets a completed answer's or commentary's table or code block grow to `--measure-wide` less two pads, centred. The selectors name direct children of `.transcript-prose` at fixed depths.
- **The owner's message.** `.transcript-user-actions` (time, Copy, Edit) is absolutely positioned to the left of the bubble's foot inside `.transcript-user-body`, shown on hover or focus within. `.transcript-user-meta` is a line in flow under the bubble that exists only with a caption or "Not sent". Edit is drawn when `row.editable && !row.pending`. `editable` is set in `userRow` (`model/derive.ts`): true for a turn's opening message that has a message id, and for a steer; false for an opener with no id, for a held message and for a message of several comments. Edit calls `editAndResubmit`, which the composer registers (`composer/index.tsx`): the bubble becomes an editor in place, and Send rewinds this session to that message and sends the edit; the editor's own Fork forks from before the message. A mount that registers nothing gets a no-op: in the desk the button is drawn and does nothing (a defect that is there today; Surprises, 6).
- **An answer.** `AssistantTextRow` draws markdown and nothing else. A turn's text blocks after its last work are its answer (`phase: 'answer'`, set in `deriveTurn`); there can be more than one row of them. `serializeRows` (`model/serialize.ts`) is exported and called by nothing.
- **The turn line.** The child says the line that reads "Working for …" is at the transcript's end. In the code it is the turn's `divider` row, which stands at the head of the turn's work, directly under the prompt: it is the last row only while the turn has no work under it, and, once U2b is on master, in the folded to-human view (Reported, 2).
- **A compaction.** `EngineSessionStatus.activity` is `'compacting'` from the engine's status frame until the next status or the turn's `result` (`src/engine-host/session-status.ts`); the renderer's sessions store holds the status (`engine`, `stores/sessions.ts`) and no component reads `activity`. The sidebar's hover card draws the digest's activity line, another field. A terminal session's plane carries the bridge's `compact` messages with their phase, kept by operation id (`lane-a/watches.ts`, `keepOps`); nothing draws them.
- **A web fetch.** Nine places name `WebFetch` alone. The child lists seven; the two it does not list are U2a's `model/caption.ts` (the `web_fetch` step of a caption) and the second place in `model/cells.ts` that words the row. `cellLabel` (`model/copy.ts`) tests for an MCP name before it reaches its `WebFetch` case, so a `mcp__web__fetch` call reads "Used web · fetch".
- **A call's line** computes its words in the view, not in the model. `CellLabel` (`view/cells/CellLine.tsx`) draws a shell call through `shellLabel` (the call's description in place of its command, or a short form of the command), a file call as its verb and the shortest suffix of its path that tells it from the run's other paths (`shortestFileSuffix` over `FilePathsContext`, which the run gives as `row.cells.flatMap((cell) => cell.paths)` and a standalone call as none), and removes code marks through `CodeText`; a failed call's reason follows. So `cell.label` is not what is drawn. The label is one line cut with an ellipsis (`.transcript-cell-label`), and what a call opens onto does not repeat it.
- **A message's and a notice's line** is one line cut with an ellipsis (`.transcript-line-text`), inside the button that opens it (`ArrivalLine`, `view/rows/Line.tsx`). What a notice opens onto begins with its whole sentence, `noticeLine(row)`, then its detail (`view/rows/Notice.tsx`). What a message opens onto is the whole message or report, `row.report ?? row.peer?.body ?? row.body ?? row.text` (`wholeOf`, private to `view/rows/AgentMessage.tsx`): it repeats the line's preview and not its lead words (who it is from or to). The consent line is cut the same way and opens onto nothing.
- **An answer's own drawing** is not only its markdown: with the owner's channel on, MAWS draws it through the to-human presenter (`assistantPresentation`, in the unattached branch of `SurfaceAssistantRow`, `surface/Rows.tsx`), which draws the text's `<message>` spans as messages and never draws the tags.
- **Find.** None. `jumpTo` opens a folded turn and a closed run and, in the report view, a closed working record; it focuses its target in the next frame, which would take the keyboard from a find field. `Disclosures` has `toggle` and no way to open. `expandedTurnRows(state, id)` (`model/derive.ts`) already derives one turn with its work open, at that turn's cost alone.
- **Keys.** `ACTIONS` has no row on any of the five chords, and `actions.test.ts` already expects the five ids with their chords once they are rows. The application menu lists only `menu` rows; its Edit menu takes table rows after Select All, in the submenu a row names. Rows of an id build F does not know are not rebindable. Four places already use ⌘F for themselves: the file viewer (CodeMirror's search keymap, which also holds ⌘G and ⇧⌘G), the Settings view, the document editor (its scene presses it, `e2e/document-editor.spec.ts`), and a page of the in-app browser (taken in main before the page or the menu sees it). In an editable file CodeMirror's default keymap holds ⌥⌘↑ and ⌥⌘↓ (add a cursor above, below).
- **Rows are focusable, not tab stops.** Every row's wrapper has `tabIndex={-1}`: a jump or a click on its bare area can focus it, Tab cannot.

## Decisions settled at authoring

Each is a means the section or a ruling left open, with its reason and what lost. Numbers are cited from the milestones. Where a decision carries a ruling, it says so, and "Reported to the architect, and ruled" has the ruling.

**Landing 1**

1. **Two landings.** "The cut", above.
2. **What travels with a command's output.** One entry of `user.message.arrival`, `{ class: 'command', run?: { command, args }, plain?: true }`, on the output's own event, present only where it says something: `run` where the carrier named the command the engine ran, `plain` where the carrier's text held a terminal's escape sequences before the reader removed them. The entry is *not* added to `CarriedArrivalSchema`: it passes the event's schema through the member that takes an entry of any other class, and its one reader, `commandOf`, holds it to a strict schema of its own (Interfaces §A). Reason: the wire's own classifier counts a new member of that union as a breaking change that takes a major (ruled, point 1), and build G already passes such an entry while build F drops the key. A property of its own on the event lost: it is additive and takes a minor, which buys nothing an older build can use. The reader also reads the file row's `commandRun`, so the file and remote routes carry `run` wherever the engine wrote one.
3. **The row.** `local_command` keeps `text`, the whole output as today, and gains four optional fields: `error: true` when all of the output came in `<local-command-stderr>`; `run` and `plain`, from decision 2; `lone: true` when its turn holds no bubble of a command (Interfaces §B). An output that mixes the two tags is drawn muted: no fixture holds one, and colouring part of a line needs a second model for it.
4. **The line is one drawing, cut when closed** (ruled, F1b: "the closed line is the first two lines of the text the opened state draws"). A dim `⎿`, then the output in muted small text on the bubble's side. The output is drawn once: through the transcript's `Markdown`, or, for a `plain` row, as preformatted text (a terminal's grid is not markdown, and the row knows it by decision 2's mark). Closed, that same drawing is clipped to two lines of its type by a height bound and a fade, as the owner's bubble is clipped at nineteen; "Show more" is offered when the drawing is measured as cut, by the bubble's technique, and removes the bound; "Show less" restores it. The open state is the disclosure `line:<row id>`, the key message and notice lines use. So a command's output has one text in both states, and find searches that one. A `lone` line reads `⎿ /<run.command> · ` before the output, or nothing where no run is known. Two drawings (plain when closed, markdown when open) lost: a string found in one would not exist in the other, which the recorded `/context` output shows (`### MCP Tools` is in its source and not in its drawing). Plain in both states lost: the one command whose output is the point, `/context`, sends markdown.
5. **The mod's site.** `commandInput` takes `command` and `args` from `row.run`, else from the command line of the row's own turn's opening message, else empty; `isErrored` is `row.error === true`. The walk over every event of the session goes: it was O(session) on each call, and the name it found on the live wire was the same one `run` carries.
6. **A command the sminos bridge ran** stays drawn as the person's command bubble. Its output carries the same run as a typed command's and no mark (Engine facts, 6); the mark that exists is on the command's own rows (Engine facts, 15), and drawing such a command as a line is a follow-on with its own tracker row, not part of these landings.
7. **A code block is restyled, not replaced.** CSS over Streamdown's markup, in `transcript.css`: the header is not drawn; the block has one border and one ground, and which of Streamdown's two boxes carries them is fixed on the drawn example (frame 2); `pre` wraps (`white-space: pre-wrap; overflow-wrap: break-word`), and the body no longer scrolls sideways; the copy control keeps its sticky place at the top right, without the negative margin that pulled it over the header; the first two source lines keep room at their end for the control (Desktop's rule; a wrapped line carries its padding on every drawn line). Copy is untouched: it reads the fence's source, so no wrapped line gains a line end. A selection copied by hand has a line end between source lines only, because each is a block and a soft wrap is not a character. A component of our own in Streamdown's place lost: it would re-own highlighting, the streaming state and the copy control for what five rules do. `codeBlockMaxHeight: 480` and the mermaid renderer are not touched.
8. **A table has one frame.** The wrapper is the frame; the inner scroller loses its border; the row that holds the copy control takes no height, and the control is placed at the frame's top right, shown on hover or focus within. Sideways scroll and the 320 px height bound are Streamdown's and stay.
9. **The width rule is one rule at any depth.** The four breakout selectors are removed and nothing replaces them but `max-width: 100%` on a table wrapper and a code block anywhere under `.transcript-prose`. It names no chain of direct children, so the level U2b adds under an answer changes nothing. `--measure-wide` stays in `tokens.css` for the pages that use it.
10. **The owner's message actions.** One line under the bubble, at the bubble's side, holds the caption when there is one (always shown, as today) and then the time, Copy and Edit (shown on hover or focus within the message). With no caption the line is laid out inside the 16 px the message already has under its bubble, so the row's height is what it was. The desk's own chat bubble (`apps/desk-web/src/views/conversation/Bubble.tsx`) writes the old markup by hand and is styled by the old rule, so that rule stays, narrowed to an actions group that is a child of `.transcript-user-body`, and the new line is new markup with a rule of its own (ruled, point 3: no desk file is edited).
11. **Which messages.** As today: a bubble has the line; MAWS's "You approved …" line has none; Edit is drawn by today's test (`row.editable && !row.pending`). Nothing about `editable` changes.
12. **Which answer gets the action row** is decided by one function over the drawn list (`answerActionsOf`, Interfaces §C): for each of the owner's turn-opening prompts, and for the list's end, the last drawn `assistant_text` row of phase `answer` before it and after the prompt before, provided no turn between them is running, the row is not live and is not a cut reply. It decides *placement* only. It is computed in the view once per change of the list, as the other row projections of `Transcript.tsx` are, and handed to rows through a store of the mount, so a change re-renders only the rows whose entry changed. Deriving it per turn lost: a turn cannot know the prompt that follows it. The row is always laid out and only its opacity changes, so nothing moves on hover; an answer that has it is 8 px taller than one that has not.
13. **What Copy takes never depends on what is folded, closed or mounted** (ruled, F4). At the press, it reads the answer's turn whole from the store (`expandedTurnRows`), takes every `assistant_text` row of phase `answer` in it, and joins their markdown as `serializeRows` joins rows. It is the function that already says what a row's text is for a copy, and the press is the only time it runs. In U2b's to-human view the same rows are taken, and the action row stands as "The statements to read again", 13, says.
14. **Fork from here** is offered through one optional entry of the transcript's actions, `forkFrom` (Interfaces §D): a mount that gives none draws no button. The app's adapter is U9's own two names and decides nothing: `useForkUnavailable` for the disabled sentence and `forkInPlace`, which gains an optional `rewindTo`. `rewindTo` is the message id of the prompt that follows the answer, or null under the session's last answer; an answer whose next prompt has no message id draws no Fork. A next prompt that was delivered and not typed (the owner's own send through sminos, a message that waited in the queue) is a prompt like any other: the engine's rewind accepts it (Engine facts, 13). The fork fills no composer; the frame line of a delivered prompt is kept out of the one place the rewind's text shows (Probes, 5). A fork is therefore always cut at the start of one of the owner's turns: text between a turn's tool calls is commentary and has no action row, and a steer is never the message forked from. While a fork is out its button is disabled and a second press does nothing; a refusal is the toast every fork in place shows.
15. **The time** is the answer row's own `at` in `formatClock`, last in the row.
16. **A compaction is said at the transcript's end** (ruled, point 2: the section's "line at the transcript's end that reads Working for …" rests on a premise the code does not hold, since that line is the divider at the head of the turn). While the session compacts, one row at the end of the drawn list reads `Compacting session… <elapsed>`; under one second it reads `Compacting session…`. No turn line's words change: the open turn keeps reading "Working for …", which stays true. The clock is the window's: it starts when this window first sees the session compacting and is not restarted by the engine's repeat of the status every thirty seconds (Engine facts, 2). Its tick re-renders that one row once a second, as "Working for" ticks today. A field on the status lost: the status schema is strict on the wire and build G would refuse it. Nothing chooses between two places any more, so no `compactingPlace` is built; the one place is `compactingRow` in `view/compacting.ts`.
17. **One row kind is added, `activity`,** placed by the view and never derived: `{ kind: 'activity', activity: 'compacting', since }`, last in the drawn list (before U1b's end row when that is there; after U2b's mirror has composed its rows). A line outside the list lost: it would sit over the last row's text or change the scroller's size, and no existing kind is a ticking line with no turn.
18. **One helper answers "is this a web fetch":** `isWebFetch(toolName)` in `src/shared/engine/web-fetch.ts`, true for `WebFetch` and `mcp__web__fetch`. The nine places ask it (Interfaces §F). `mcp__web__fetch` joins the read-only list.
19. **An agent that ended with its session** reads `<names> ended with the session` on the transcript's agents row, U8's words for the same fact. The row gains `exited: true` where every agent it names ended that way.

**Landing 2**

20. **The five rows.** `transcript.find` ⌘F "Find in session…", `transcript.findNext` ⌘G "Find next", `transcript.findPrevious` ⇧⌘G "Find previous", all `menu: 'edit', submenu: 'Find'`; `transcript.previousPrompt` ⌥⌘↑ "Jump to previous prompt", `transcript.nextPrompt` ⌥⌘↓ "Jump to next prompt", in `menu: 'go'`. All are `sink: 'menu', scope: 'app'`. Titles are in the table's sentence case, and the first names the session because the palette and the shortcut sheet show a title without its submenu. None is rebindable while build F knows no such id; nothing is written for that.
21. **Which pane a key acts on** is one function, `sessionPaneForKeys()` (Interfaces §I). It answers nothing while another web contents has the keyboard, while a dialog owns the focus, while focus is inside the side column, the card column or an open page, and while the focused pane's tab on screen is not a session; otherwise the focused pane, whose session is what `focusedSession()` says.
22. **The keys' routing is proven before anything is built on it.** Whether a focused region that handles ⌘F keeps it from a menu row is said two ways in the code's own comments (Surprises, 7). Only real key presses in Electron on a Mac answer it: Playwright's keys reach the page and never the menu (`e2e/support/menu.ts`), so no scene can (Reported, 11). So M7 begins with the five rows and handlers that only log; a person, or the computer-use tool, presses the keys in that build; and the rest of M7 waits for the answer (Probes, 1).
23. **A prompt** for the two chords is a row of kind `user` in the drawn list that is a bubble: not MAWS's "You approved" line, not a message still waiting. A steer counts: it is the owner's words at the place they were read. A message from another session is an `agent_message` row and does not count; neither does the `!` shell row. This is Desktop's test (a user entry that is not synthetic and has text) in this model's terms.
24. **Where a prompt jump starts and lands.** It steps from the prompt last jumped to while the list's offset is what that jump left; otherwise from the first row in view. The prompt is brought to 20 px under the pane's top (under the find bar when it is open), at once, and its bubble is marked by an accent tint that fades in 1.2 s (none under reduced motion). Past the last prompt ⌥⌘↓ goes to the list's end; at the first loaded prompt ⌥⌘↑ goes to the top of what is loaded. Pressed with focus in the composer or in a field, the jump leaves the focus where it is; pressed with focus in the transcript or on nothing, the row takes it. Desktop's smooth scroll lost: over rows the virtualiser has not measured, a smooth scroll lands wrong.
25. **↑ and ↓ between messages** act only when the focused element is itself the wrapper of a message row (a bubble, or an answer row) and that focus was not given by a pointer press on that row in the 500 ms before it (Desktop's test). They move to the previous or next such row, bring its top into view and focus it; at either end they do nothing. No row becomes a tab stop: a focus "from the keyboard" is one a jump gave (Reported, 9).
26. **What a jump may leave alone.** `jumpTo` gains `focus: false`: the target is opened, revealed and scrolled to and the keyboard stays where it is. Find and a prompt jump from the composer use it. The list's handle gains what the three callers need and nothing else (Interfaces §G).
27. **A counted match is a markable match** (ruled, F1). Find's words for a row are the words that row draws, by one reading that the row's component and find share, never a second derivation:
    - *A line of words the view computes* (a call's line, a message's whole text): the computation is one exported pure function, and the component and `findPartsOf` both call it. A call's line becomes `cellLineWords(cell, peers)` in `view/cells/CellLine.tsx`, which holds what `shellLabel`, `FileLabel`, the edit counts' removal, `CodeText`'s code marks and the failed call's reason do today; `CellLabel` draws from its result and find takes its text, with the same `peers` the run gives its context. A message's whole text becomes `messageWhole(row)` in `model/rows.ts`, which `AgentMessageRow` draws.
    - *A part the view draws through a library* (markdown: an owner's bubble, an answer, a message to the person, a command's output): no pure function gives a library's drawing short of assembling its pipeline a second time, and for an answer MAWS's own drawing is the to-human presenter's, which never draws the `<message>` tags its source holds. So the words are read from the component's own drawing: where the row is not mounted, its body is rendered once into a container outside the document, in MAWS's own drawing (`presentation: 'local'`, no store key, so no mod's site is asked), with its disclosures open and without its images, and its text is read by the walker the marks use; the result is kept by the row's content. `marked`'s lexer, the first design, lost: it is a second reader of markdown, it counts `<message>` as a word of every message, and where it and the drawing disagree a match is counted and cannot be marked.
    - *What is searched* (Interfaces §J has the table): the owner's bubbles with their pasted blocks, answers, commentary and cut replies, a message tool's message, what a message's and a notice's line opens onto, a command's output, and each call's line. *Not searched:* thinking, tool output, request rows, turn lines and run captions, time separators, boundaries, errors, any row the view places, a mermaid diagram and a formula (their drawing is not their source), the lead words of a message's line (who it is from or to; they are MAWS's label, as a turn line is), and the consent line (it is cut with an ellipsis and opens onto nothing). A text block still streaming is searched when it completes.
    - *Each searched part has a scope in the DOM* (`data-find-part`), and marks are registered inside scopes only, so an opened call's output, which is not counted, is not marked either. Within a scope the walker skips only chrome that is named one by one (Interfaces §K).
    - *The contract.* For every searched kind a test mounts the row, counts by the model and registers marks, and asserts that the ranges equal the matches. A kind that cannot meet it is not searched. No match is ever counted with no range to show: the earlier fallback is gone.
    Matching folds case and Unicode form and nothing else. A search runs when the query is longer than two characters or holds a Han, Hiragana, Katakana or Hangul character.
28. **What a match opens, what brings it into view, and what closes it** (ruled, F2 and point 7). Going to a match:
    - *Folds the store owns:* its turn and its tool run, through `jumpTo`; on a master that holds U2b, a closed stretch, including the stretch of a head text whose unmarked words hold the match (find calls `toggleStretch` for that one, since `jumpTo` does not).
    - *The disclosure a part is wholly under:* a pasted block's chip; a message's or a notice's line, since their words are searched once, in what the line opens onto, and never in the cut preview.
    - *Every clipping ancestor between the match and the list, innermost first:* a fold that cuts it is opened (a bubble past nineteen lines, a command's line past two, and a call's label, which is drawn whole while it holds the current match through a disclosure of the view's own, `label:<cell id>`, that only find opens); a nested scroller is scrolled so that the match is inside it (a tall code block's own viewport, a table's sideways and downward scroll, a pasted block); then the list is positioned.
    Find remembers what it opened for the current match. Moving to another match closes those again, except what the next match needs and what the reader has toggled since; closing the bar closes nothing. This is Desktop's hold. A match is never counted twice for one drawn text and never left behind an ellipsis or outside a viewport.
29. **What is recomputed, and what bounds it** (ruled, F5). The claim that every slice is at most 8 ms is withdrawn: two units cannot be split, and a design can only promise to yield between units and be measured.
    - *The first pass is resumable.* It goes turn by turn through `expandedTurnRows(state, id)`, the entry point that already derives one turn alone (so `rowsOf` is not driven, and nothing is added to `derive.ts`), keeping each turn's rows by that turn's version; then part by part, reading each markdown-drawn part's words once (decision 27) and keeping them by the row's content; the per-query scan runs over the kept words part by part. Between units the pass reads the clock and, past 8 ms, yields to the event loop. After a yield it reads the store again and goes on with the turns its cache does not hold at their current version; it never holds a row across a yield. The count reads nothing until the pass ends.
    - *The units that cannot be split:* one turn's derivation, and one part's drawing. A session with one enormous turn or one enormous answer pays that unit in one task, as the transcript itself does when it derives that turn or mounts that row.
    - *On a new row:* the changed turn is derived once more than the store derives it, and its new parts are read; nothing else. While rows arrive the recount runs at most every 250 ms. *On a keystroke*, after 250 ms of quiet: the kept words are scanned, in slices; nothing is derived or drawn. Nothing runs per frame, per token or per tick, and nothing at all while the bar is closed.
    - *The budgets*, measured on a Mac by scenes the architect runs (Acceptance 26; Proof, 14), each the longest single task: at the first open of the bar on the harness's 500-turn session, 50 ms; with one very large turn, that turn's own derivation as the same scene measures it in the store, plus 16 ms; with one very large markdown part, that row's own first mount as the same scene measures it, plus 16 ms; a keystroke's scan, 16 ms; an update while the bar is open, 16 ms beyond the store's own task for that batch. 50 ms is the line a browser calls a long task; 16 ms is one frame; the two relative budgets say that find may not cost more than the transcript already pays for the same unit. With the bar closed the transcript's own frame bound is untouched, which the anchoring scene shows base against landing.
    - *The fallback, if a budget is not met:* the index (the kept words and the scan) moves off the main thread. It is named here and not built unless a measurement asks for it.
30. **The current match.** A new query's current match is the first match at or below the view's top edge, else the last above it (ruled, point 8; this sentence is the rule's one statement). Desktop takes the first of the session, which sends a reader at the end of a long session to its start. Next and Previous wrap. The current match is kept by its row, its part and its place among that part's matches, so it stays on the same words while matches arrive around it; when its own match goes (the row changed), the next one takes its place.
31. **The marks** are the CSS Custom Highlight API, two named highlights (every match; the current one), coloured from tokens (`--accent-soft`; `--accent` with `--bg-raised` text). A mounted row that has matches finds them in its scopes' drawn text, by the walker and the fold the count used, and registers ranges; it does so again when a scope's subtree changes (a code block's highlighting arrives late and changes no text). Since the count was read from the same drawing, the ranges are the matches (decision 27's contract). Where a mod draws a row, that row has no scope and carries no mark until it is the current match: the jump reveals it, MAWS draws it, and its marks are then registered. So a match in a mod-drawn row is counted and is marked when gone to.
32. **The bar.** A box at the top right of the transcript, 320 px wide, over the text, with the parts and tokens of the in-app browser's bar (the owner's card 1 has the alternative). Its field reads "Find in session…"; the count reads `3 / 17 results`, `0 results`, or nothing below the minimum; then Previous, Next, Close, each with its chord in its tooltip. ⌘F opens it or, when open, selects its text; Enter and ⇧Enter step; Esc first stops a search of earlier messages and then closes the bar and returns the focus to where it was. ⌘G and ⇧⌘G step from anywhere in the pane and reopen a closed bar on its last query, which the mount keeps in memory only. A pane that mounts no transcript (the compact pane of U10b-3's bar, an unstarted session) has no bar: the key does nothing there. The bar is not a dialog and is not portalled.
33. **Earlier messages.** Where the session has older pages not loaded, the bar shows the button "Search earlier messages". It asks one page after another until the count grows or no page remains, reading "Searching earlier messages…" meanwhile. A new query, Esc or closing the bar stops it; a page that fails stops it and the pager's own line says why; a page in flight when it stops lands as any older page does.
34. **Find's code loads at first use.** The bar, the index and the marks are a chunk of their own behind a dynamic import, so a transcript that is never searched, the desk's included, loads none of it.

**What each part costs while a long session streams.** Landing 1: a command's line measures itself once when it mounts and when its width changes, as the bubble does (M1); the block and width rules are CSS, and a wrapped block is measured by the virtualiser like any row (M2); the answer-row rule is one pass over the drawn list per change of the list, with no derivation, a row re-renders only when its own entry changed, and Copy derives one turn at the press (M3); a compaction is one subscription to the sessions store and one row re-rendered a second while it lasts (M4); the web fetch helper is a comparison (M5). Landing 2: nothing runs until a key is pressed; a prompt or message step is one pass over the drawn list (M7); find is decision 29 with its measured budgets, and a mounted row looks up its marks only when it has matches, when its row or the query changes or a scope's subtree mutates (M10). Nothing is added per frame, per token or per tick.

## Reported to the architect, and ruled

The eleven points this document's first version handed back, each with the architect's ruling of 2026-11-15, and after them the six findings of the adversarial review with the rule each was given. "Reported, N" elsewhere points here.

1. **The `command` entry cannot be a member of the carried union.** Evidence: `src/shared/ipc/wire-manifest.json` renders `arrival.items` as `anyOf[ oneOf[five classes], loose ]`; `classifyWireChange` (`src/shared/ipc/wire.ts`, `SUBSCHEMA_LISTS`) counts a list whose length changed as breaking; `wire.test.ts` then refuses with "it takes a major … no minor can carry it". U3a's decision 20 planned the member. *Ruled:* accepted. The entry travels through the existing loose member and is read strictly on arrival by one function (`commandOf`, decision 2); no wire minor; with F6's two runs.
2. **The turn line is not at the transcript's end.** The child's A10 and #331 place "the line that reads Working for …" at the end; it is the turn's `divider` row, at the head of the turn's work. *Ruled, without a card:* "Compacting session…" shows at the transcript's end (decision 16). It is in the drawn frames for the owner's look. The card this document's first version had for it is withdrawn.
3. **The desk follows, with named differences.** After landing 1 its session view shows the light command line, wrapped code, tables inside the column, the owner's message actions under the bubble, an answer's Copy and time (no Fork: it gives no `forkFrom`), and the web plugin's fetch as a web row. Its own chat bubble is unchanged (decision 10). It shows no compaction line (it gives none) and nothing of landing 2. *Ruled:* accepted, with no desk file edited; every milestone that changes a file the desk imports keeps the desk's typecheck, build and tests in its proof, and both landings' gate sets hold `e2e:desk-web`. The Edit button that does nothing in the desk (Surprises, 6) is a ticket of the architect's, not this work's.
4. **Whether a cross-build run is owed.** The first version said none: nothing is stored, and the manifest does not change. *Overruled* (F6): the wave's rule is that a changed message owes a run against each build, and a manifest that did not change does not lift it. The scene is part of landing 1 (M6) and landing 1's gate set holds `e2e:cross-build` twice (Interfaces §H; Proof, 13).
5. **⌘G in a page of the in-app browser does nothing.** Main takes ⌘F for the browser's bar and lets ⌘G through to the menu; the row's handler then sees that another web contents has the keyboard and does nothing (decision 21). *Ruled:* accepted, with one tracker row that names the browser bar's owner, U12 (M11).
6. **Find searches the drawn text, not the markdown source.** *Ruled:* accepted, under F1: decision 27.
7. **Moving to another match closes what find opened for the last one; closing the bar closes nothing.** *Ruled:* accepted (decision 28).
8. **A new query starts near the view, not at the session's start.** *Ruled:* accepted, with the tie rule stated in one place (decision 30).
9. **No tab stop for messages; the arrows arm after a jump that focused a message.** *Ruled:* accepted, with its tracker row (M11).
10. **Two details of the child's reading of Desktop's code block** differ from its source and change nothing built: its toolbar can hold a language label (`web/app/v1/c19e90103-DTzzk017.js:9290-9296`), and it keeps room for the toolbar on the first two lines only (`:9022-9028`). *Ruled:* noted for the spec's next batch; nothing to build.
11. **The child's check 6 cannot be an e2e scene for the keys themselves** (`e2e/support/menu.ts`: a scene's keys never reach the macOS menu). *Ruled:* accepted. Acceptance 22 is the scene of the handler's region rule; the real keys are a hands-on check that the architect arranges at M7's spike commit, and M7 does not go past the spike until the architect reports its answer.

The smaller decisions are accepted as named insertions in the pull requests' lists: the titles in sentence case; the view-placed row kind `activity`, which U2b's exhaustive classifier classes at whichever lands second; `forkInPlace`'s optional `rewindTo`; `modalOwnsFocus` exported; the helper in `caption.ts` and `classify.ts`.

**The review's findings, each verified by the architect in the code, and the rule each was given:**

- **F1, find counted text its target does not draw.** *Rule:* a counted match is a markable match: one reading of what a row draws; a command's output has one text; no counted match without a range, and a contract test per searched kind. *Applied:* decisions 4 and 27; Interfaces §B, §J and §K; M1, M8 and M10; acceptance 1, 16 and 27.
- **F2, a revealed row does not reveal a match behind inner clipping.** *Rule:* every clipping ancestor between the match and the list is handled, innermost first; a line's words are searched once and never behind an ellipsis. *Applied:* decision 28; Interfaces §G and §K; "Today" (what each line opens onto); M10 and M11; acceptance 18.
- **F3, the skip rule removed content.** *Rule:* `data-find-skip` only on chrome named one by one; every searched part has a DOM scope. *Applied:* decision 27; Interfaces §K (the list); M8 and M10; acceptance 27.
- **F4, Copy's membership came from the drawn list.** *Rule:* what Copy takes is computed from the turn's complete projection; only placement reads the drawn list. *Applied:* decisions 12 and 13; Interfaces §C; statement 13 of "The statements to read again"; M3; acceptance 7.
- **F5, the 8 ms slices had no boundary.** *Rule:* a resumable pass, measured budgets, a named fallback. *Applied:* decision 29; Interfaces §K; M9 and M11; acceptance 19 and 26; Proof, 14.
- **F6, the newly sent entry and the two older builds.** *Rule:* the cross-build scene is part of landing 1 and its gate set holds `e2e:cross-build` twice. *Applied:* point 4 above; Interfaces §H; M6; acceptance 14; Proof, 13.

**Three things the code added to the rulings**, told to the architect with this revision:

- *A call's label is itself cut with an ellipsis* (`.transcript-cell-label`: `overflow: hidden; white-space: nowrap; text-overflow: ellipsis`), and what a call opens onto does not repeat it. F2 names the message's and the notice's line; by its rule ("never left behind an ellipsis") the label is drawn whole while it holds the current match (decision 28). Built at that default; the one place is the `label:<cell id>` disclosure in `view/cells/CellLine.tsx`.
- *For markdown there is no pure function to share* (F1a asks for one per kind): the component draws through a library, and an answer's own drawing is the to-human presenter's. The means chosen is the component's own drawing, read once (decision 27). The one place is `drawnWordsOf` in `view/find/words.ts`.
- *`expandedTurnRows` already is the one-turn entry point* F5a asks for, so nothing is added to `derive.ts` and the first version's `rowsWithEveryTurnOpen` is withdrawn.

## The reference: Claude Desktop `app-5.1231.2`

Read in its readable source (`research/SOURCES.md` says where). Paths are relative to the build's directory; `C96` is `web/app/v1/c96d752d0-CjYhuD9j.js` (the Code tab's transcript), `S100` is `web/app/v1/shared-100-DB34lze4.js` (the find engine), `FIP` is `renderer/find_in_page/app/FindInPage-DfUfVJXu.js` (the find bar), `MAIN` is `main-process/index.chunk-BV3uOqbK.js`.

- **The minimum.** The child's citation stands: `FIP:5187-5189`, `e.length > 2 || Zo.test(e)` with the four scripts; main refuses a request that fails it (`MAIN:267711-267714`).
- **What find searches.** The transcript registers itself as the find's provider (`C96:146110-146126`); main falls back to the browser's own find only with no provider. Matches are counted on the items' text, where an answer's text is the text its markdown draws, not its source (`C96:137240-137452`), and marked by a range search in the mounted row's DOM (`S100:5214-5300`), with the CSS Custom Highlight API (`S100:5407-5522`). Thinking is not searched; a tool call is searched only while its body is open. *Taken:* count on the text a row draws, mark in the DOM, the Highlight API. Desktop counts on its model's text and marks in the DOM by a second search, so the two can disagree there; here the count is read from the drawing itself (decision 27). *Not taken, by the child:* a call's line is searched whether or not its run is open.
- **Folds.** A folded group that holds the current match is held open; the hold is replaced at the next match, so the earlier fold closes unless the reader toggled it; when the query ends, what is held stays open (`web/app/v1/c80ec48f8-DL54lXC3.js:2651-2752`; `C96:145103-145107`). *Taken* (decision 28).
- **Where the view lands.** A row not mounted is scrolled to the centre; then the current mark is moved to the centre only when it lies outside the band between the top inset and the composer (`C96:146009-146013`; `S100:5776-5849`). *Taken* (Interfaces §K).
- **The count** is typed after a 250 ms pause and recounted at most every 250 ms while items change; the current match is held by its row and its place in it (`FIP:5305-5311`; `S100:6621`, `6745-6775`, `6862-6880`). A new query takes the session's first match and steps wrap (`S100:6240-6242`). *Taken:* both delays, the held match, the wrap. *Departed:* the first match (decision 30).
- **Earlier history** is loaded by find itself while a query stands (`C96:146080-146102`). *Departed, by the child:* MAWS asks first.
- **The bar** is a box at the window's top right, 320 by 44, with a field, the count, Previous, Next and Close; it reopens empty (`MAIN:267698-267722`; `FIP:5401-5580`). *Taken:* the box and its parts (card 1). *Departed, by the child:* the words are the in-app browser bar's, and ⌘G reopens the last query.
- **Routing.** Edit ▸ Find ▸ Find…, Find Next, Find Previous (`MAIN:324014-324048`); a pane that has a find of its own claims the key while focus is inside it, and the transcript serves it otherwise (`MAIN:324086-324110`). *Taken* as the region rule of decision 21.
- **Prompt jumps** (`web/app/v1/c73f45bc3-CS022dPs.js:2195-2296`; `web/app/v1/cf74bc599-BVVr4KcU.js:11535-11640`) stop at a user entry that is not synthetic and has text; start from the last one jumped to, or from the view; land 20 px under the top inset with a 1.2 s accent flash; do nothing at either end; work from the composer and never move the focus. *Taken:* the stops, the offset, the flash. *Departed, by the child:* the two ends go to the list's end and to the top of what is loaded; a jump from the transcript focuses the row, which is what arms the arrows here.
- **Arrows between messages.** `C96:142430-142451`: they move only when a message has focus that no pointer press gave in the 500 ms before it. *Taken.* Its messages are one roving tab stop (`C96:142738-142763`). *Not taken* (Reported, 9).
- **The action rows.** Under a reply, once per turn at the turn's tail, hidden while the last turn responds (`C96:39858-39870`; `web/app/v1/cee0f6656-CSoaozEt.js:103-122`); Fork from a reply passes the next real prompt (`C96:39351`, `141985-142000`). *Taken.* Its Copy takes the whole run and its time is relative. *Departed, by the child:* the answer; the clock.
- **A code block** wraps by default (`web/app/v1/c19e90103-DTzzk017.js:7556`, `9029`), with a sticky toolbar at the top right and room for it on the first two lines (`:9022-9028`, `9300-9306`). A table scrolls sideways in its wrapper. *Taken.*
- **A compaction** reads "Compacting session…" with the elapsed counter on the working line, from the status `compacting` (`C96:134380`, `134965-134972`, `135291`). *Taken:* the words and the counter. Desktop's working line is at its transcript's end; MAWS's "Working for …" line is not, so the words stand in a row at the end (decision 16).

## Engine facts

Every statement the work rests on, with what holds it. Fixtures are under `spikes/protocol-probe/fixtures/`; those named `uxwave/u3b-…` are the probes of 2026-11-15, on `origin/ux-wave/U3b-probes` at `1048cdf89` with their findings files (`spikes/protocol-probe/findings-uxwave-u3b-<topic>.txt`), which landing 1's executor merges as a commit of its own before M4. The bundle is the pinned engine's, `2.1.322`, read as a reference. Nothing is built on a statement marked "bundle only".

| # | statement | held by |
|---|---|---|
| 1 | A typed compaction begins with `system/status` `status: 'compacting'` and ends with a status whose `status` is null and whose `compact_result` is `success` or `failed` (with `compact_error` on a failure) | fixture: `uxwave/u3-commands-r1.jsonl` seq 150, 151, 400, 404; `p4/p4-r7y-stub-command.jsonl` seq 31, 34 |
| 2 | During a typed compaction the engine repeats `compacting` every thirty seconds until the end, each with a new uuid and nothing else; no status frame carries a time | fixture: `uxwave/u3-commands-r2.jsonl` seq 333 to 337 (recorded 30.0 s apart); `uxwave/u3-commands-bare.jsonl` seq 280 to 283. Whether it repeats in a long automatic compaction is not recorded (none lasted thirty seconds); the clock's rule does not depend on it |
| 3 | An interrupted compaction: `compacting`, the failed status, then the output "Compaction canceled." as the command's assistant frame with no `local_command_run`, then the command's replay | fixture: `uxwave/u3-commands-r1.jsonl` seq 400 to 409 |
| 4 | `/compact` with nothing to compact sends no status frame, only its output in `<local-command-stderr>` | fixture: `uxwave/u3-commands-r1.jsonl` seq 19 to 31 |
| 5 | A status with `status: null` also arrives outside any compaction (with `permissionMode`), so a compaction's end is "the next status that is not `compacting`", which is what `session-status.ts` already reads | fixture: `permission-roundtrip.jsonl` seq 286 |
| 6 | The live frame of a command's output carries `local_command_run: { command, args }`, and the transcript file's `system` row of subtype `local_command` carries the same as `commandRun`; `/cost` runs as `usage`. A command the sminos bridge ran carries exactly the same run as a typed one, with no `plugin` key and no other mark on the output | fixture: `uxwave/u3-commands-r1.jsonl` seq 167, 179, 191, 204, 216, 228; its transcript file's lines 5, 55, 60, 75, 80, 85; `uxwave/u3-terminal-commands-r1.transcript.jsonl` lines 6, 57, 67, 71, 78. The bridge's: `uxwave/u3b-bridge-command-r1.transcript.jsonl` lines 41 (typed) and 48 (the bridge's), the same field for field; `uxwave/u3b-bridge-command-headless-bridge.jsonl` seq 54 and 64 |
| 7 | An output with no run: "Compaction canceled.", and every output that is a `user` frame or row (a `/compact` that succeeds; in a terminal's file also `/effort`). Each stands in its command's turn | `uxwave/u3-commands-r1.jsonl` seq 406, 155; the terminal file's lines 50, 76, 119 |
| 8 | Of the recorded outputs only `/cost` (7 lines) and `/context` are longer than two lines. `/context` on the live wire and in a headless session's file is 61 lines of markdown (headings, bold, tables); in a terminal's file it is a 19-line grid with ANSI colour sequences and no markdown. No output on the live wire holds an escape sequence | the same fixtures: seq 167 and 179; the terminal file's line 57 |
| 9 | An automatic compaction sends, in one turn: `requesting` for the prompt; `compacting` once, carrying `compact_output_chars: 0`; 5.7 to 8.0 s later `{ status: null, compact_result: 'success' }`; the replay of the prompt that set it off; `compact_boundary` with trigger `auto`; the summary; then the model's answer. No command row and no command output, on the wire or in the file (3 of 3) | fixture: `uxwave/u3b-autocompact-r2.jsonl` seq 96 to 110; `uxwave/u3b-autocompact-r1-resumed.jsonl` seq 30 to 43; `uxwave/u3b-autocompact-window100k.jsonl` seq 121 to 131; `findings-uxwave-u3b-autocompact.txt`. An end with no `compact_result`, which the bundle has for a skipped or aborted automatic compaction (`cli.pretty.js:433215`, `439512`), did not occur and is bundle only; row 5's rule covers it either way |
| 10 | A subagent's own compaction sends no status frame | **bundle only** (`cli.pretty.js:435127`); no rule is built on it |
| 11 | A call of the web plugin's fetch tool is named `mcp__web__fetch`; its input is `{ url }` or `{ url, prompt }`; its `tool_result` content is a plain string, not an array of text blocks, the same string as the frame's `tool_use_result` and the file row's `toolUseResult` (4 of 4). The tool is deferred, so a `ToolSearch` call of its own row precedes a session's first fetch | fixture: `uxwave/u3b-webfetch-r1.jsonl` seq 72 and 76 (with a prompt), 156 and 158 (without); its transcript file's lines 39, 40, 54, 55; `uxwave/u3b-webfetch-r2.jsonl`; `findings-uxwave-u3b-webfetch.txt` |
| 12 | The bridge of a terminal session reports a compaction asked through it as `compact` messages of phase `start` and `end` under the operation's id | the sminos bridge's, not the engine's: `docs/doperpowers/plans/2026-10-28-p5-o9-lane-a.md` (the table of bridge events) and `src/services/lane-a/reshape.ts` with its test; no recording of a `start` |
| 13 | The engine's rewind accepts a prompt that was delivered and not typed: one the sminos bridge delivered into a terminal session, and one that waited in the queue (by the id it was sent with and by its file row's id), each in a fork of its own (5 of 5). The fork then holds the conversation before that prompt | fixture: `uxwave/u3b-fork-delivered.jsonl` seq 26; `uxwave/u3b-fork-queued-sent.jsonl` and `u3b-fork-queued-row.jsonl` seq 24; `uxwave/u3b-fork-typed.jsonl` seq 25; `findings-uxwave-u3b-fork-delivered.txt` |
| 14 | The rewind's answer carries `prefillText`, the target prompt's whole text; for a prompt the bridge delivered that text opens with sminos's frame line (`[sminos message from human id=…]`) | fixture: `uxwave/u3b-fork-delivered.jsonl` seq 26 |
| 15 | A command the bridge ran is marked elsewhere than on its output: in a headless session, an origin `{ kind: 'plugin', name: 'sminos' }` on the replayed command frame and on the file's command rows; in a terminal's file, on the meta row the command leaves and by a queue-operation pair before it. In a session MAWS runs the bridge refuses to run a command at all (`code: 'lane-b'`) | fixture: `uxwave/u3b-bridge-command-headless-bridge.jsonl` seq 65, 66; `uxwave/u3b-bridge-command-r1.transcript.jsonl` lines 45 to 49; `uxwave/u3b-bridge-command-headless-maws.jsonl`; `findings-uxwave-u3b-bridge-command.txt`. It serves the follow-on only (decision 6) |

## Probes

One question is still open, and four were answered on 2026-11-15.

1. **Does a focused region keep a key from a menu row?** (open; the architect arranges it at M7's spike commit, and M7 does not go past the spike until the architect reports the answer.) *Question:* on a Mac, in a build that has a menu row on ⌘F, ⌘G, ⇧⌘G, ⌥⌘↑ and ⌥⌘↓: with the caret in a file tab's editor, does ⌘F open the editor's own search and leave the row's handler uncalled, and likewise ⌘G with the search open and ⌥⌘↑ in an editable file; with focus in the Settings view, does ⌘F focus its search and leave the handler uncalled; with the caret in a document, does ⌘F still reach the document editor's own find; with a page of the in-app browser focused, is the handler uncalled for ⌘F and called for ⌘G? *How:* M7's first commit, built and run on a Mac, with real key presses by a person or through the computer-use tool; not a Playwright scene, whose keys never reach the menu (Proof, 7). *Default:* yes to each: the page sees a key first and the menu acts on what the page let pass, as the header of `src/shared/keymap/actions.ts` and `src/main/menu.ts` say. *If no for the editor, the document or Settings:* the rest of M7 does not start; the rows cannot be menu rows and stay out of the menu, and where Edit ▸ Find then comes from is the architect's ruling. *The one place:* the `sink` of the five rows.
2. **A command the sminos bridge ran** (answered; Engine facts, 6 and 15). The output carries no mark, so the default stands: no rule, and such a command draws as the person's. The mark that exists is on the command's own rows, and it arises only in sessions MAWS reads from a file. *The one place, for the follow-on and not for these landings:* `userRow` in `model/derive.ts`.
3. **An automatic compaction** (answered; Engine facts, 9). It sends the same statuses, so acceptance 10 covers typed and automatic compactions as written and nothing in the code tells them apart. One thing follows for the drawing: an automatic compaction begins inside a running turn, after the prompt's `requesting`, which is the case the ruling on the compaction's place serves.
4. **The web plugin's fetch on the wire** (answered; Engine facts, 11). The name and the input are as the default read them. One shape is added to M5's tests: the result's content is a string. M5's tests read the two recorded calls from the fixture, not hand-written shapes. *The one place:* `isWebFetch` and `webFetchUrl` in `src/shared/engine/web-fetch.ts`, unchanged.
5. **A fork that rewinds to a delivered prompt** (answered; Engine facts, 13 and 14). The premise this document's first version named as unprobed holds: "Fork from here" is drawn under an answer whose next prompt was delivered, and the fork is cut before that prompt. One consequence is ruled here: the rewind's `prefillText` holds the bridge's frame line. "Fork from here" fills no composer (it sends no first message, and the fork's setup drops the rewind's answer: `rewindFork`, `src/services/sessions/setup.ts`), so the one place that text reaches the fork's window is the rewind boundary's row, whose tooltip is the event's `prefillText`. The frame line is not shown to the person as their own words: the boundary row's `detail` is the words alone, cut by `ownWordsOf` (Interfaces §D). *The one place:* the `boundary.rewind` case of `looseRows` in `model/derive.ts`. One reader of the same text is not this work's and is reported: the `/rewind` widget fills the composer from `prefillText` for an editable target (`widgets/RewindWidget.tsx`), so a rewind to a prompt the bridge delivered puts the frame line in the draft, today; one tracker row, with `ownWordsOf` as its fix (M6).

## The owner's card, and the drawn example

One thing a person sees is not settled by the child's text, the register or a ruling. Every other sentence and look is fixed in this document as written ("The words", Interfaces §L). Where the compaction's words show was ruled without a card (ruled, point 2).

**Card 1 · Where the find bar sits** (landing 2; it goes to the owner with the drawn frames, before M10). When you press ⌘F in a session, a small bar opens over the transcript with a field, a count such as "3 / 17 results", Previous, Next and Close. Where should it sit?

- **A box at the top right corner of the transcript, about 320 px wide (recommended).** It covers a corner of the text and leaves the rest readable while you step through matches. Claude Desktop, VS Code and Chrome put it there.
- **A strip across the whole top edge of the transcript.** It looks like the find bar of the in-app browser. It covers one line of text across the pane, and in a wide pane its field is very long.

Built by default: the first. The one place: the bar's container in `view/find/FindBar.tsx` and its rule in `transcript.css`.

**A drawn example is needed before M2, M3 and M10 are built**, at real sizes, light theme, with invented content, for the owner to look at once per landing; the architect dispatches it, landing 1's frames first.

*Landing 1's frames.* (1) A command's output: one line; a long output closed at two lines with its fade and "Show more", and open, drawn as markdown with a table in it; a terminal's grid, open; an error in the error colour; one standing alone under its command's name. (2) A code block with a 300-character line wrapped in its one frame, with the copy control and the room beside it, and a tall one at its height bound. (3) A table wider than the column, scrolled sideways in its frame, with its copy control. (4) The owner's message at rest and hovered, with and without a caption, at one line and at twenty. (5) An answer at rest and hovered, with Fork enabled and disabled with its sentence. (6) "Compacting session… 12s" as the last row of the transcript: under a running turn's last row, with that turn's own line reading "Working for …" above; and alone after `/compact` in an idle session.

*Landing 2's frames.* (7) The find bar in each place of card 1, with a count, with "0 results", and with "Search earlier messages". (8) A paragraph with three matches marked and one current, in prose, in inline code and in a code block; a call's line drawn whole because it holds the current match, beside its neighbours cut at the column's edge. (9) A prompt just jumped to, at the start of its fade.

## Routes (law 5), and other machines

| what | a session MAWS runs here | a session MAWS runs on another machine | a terminal session, here or on another machine | the desk's session view |
|---|---|---|---|---|
| a command's light line (M1) | from the live frame, with `run`; from the file once read from disk, with `run` where the engine wrote `commandRun`; drawn through markdown (no live output holds an escape sequence) | the same events, made by that machine's host: with `run` and `plain` once that machine runs this build, without them until then (the name then comes from the turn's command, and a grid is drawn through markdown as it is today) | from the file's rows through the same reader, with `run` on the `system` rows and `plain` where the terminal wrote colours | the same row |
| the mod's site for it | asked with `run`'s name and arguments | no mod draws | no mod draws | no mod draws |
| code blocks, tables, the owner's message actions (M2) | the one markdown component and the one row | the same | the same | the same; its own chat bubble is unchanged |
| Edit under the owner's message | unchanged: the composer's in-place edit, Send rewinds this session | unchanged (`session.rewind` is offered) | unchanged | unchanged: drawn, and does nothing there today (Surprises, 6) |
| an answer's Copy and time (M3) | this window's own | the same | the same | the same |
| Fork from here (M3) | `forkInPlace(id, rewindTo)`: the fork's tab opens; a refusal (a turn running, no engine conversation yet) is its toast | the same act; U9's offer carries it (below); the button is disabled with U9's sentence while that machine is offline, connecting, on an older build, not the member's own, or while the session works | on this Mac: the same act (a fork resumes the file's conversation). On another machine: no button, because the link finds a session by a MAWS session id, which a terminal session there has none of (U9's rule for its session menu, `remoteSessionActions`) | no button: it gives no `forkFrom` |
| a compaction's line at the end (M4) | from the session's status, for a typed and an automatic compaction alike | the same status, carried by the link as today | between the bridge's `compact` messages of phase `start` and `end`, for a compaction asked from MAWS; nothing for one the terminal starts (nothing tells MAWS it began) | none: it gives no `compacting` |
| the hover card's line | the same source | the same | the same | — |
| the web plugin's fetch (M5) | the same cell from the same call | the same | the same | the same |
| find (M8, M10) | the store's rows; older pages through the source's pager | the same; with the link down it searches what the window holds, and "Search earlier messages" stops at the pager's own line | the same; older rows through the plane's pager | none: no key reaches it and its chunk never loads |
| the prompt chords and the arrows (M7) | the drawn list | the same | the same | none |

**The one act that crosses a machine link** is the fork. Nothing about it is new here: the offer, its grade and its sentences are U9's and on master.

- *Its offer row:* `'session.fork': { kind: 'act', executor: 'machine', target: 'appSessionId', owners: true, accepts: isInPlaceFork }` (`src/endpoint/offers.ts`), behind the capability `rl2.session-acts`. *Its grade:* `spawn`, stepped up and budgeted in `src/main/lane-b/remote.ts`. `isInPlaceFork` takes exactly `{ appSessionId, target: { kind: 'inPlace' }, message, rewindTo }`, which is what the button sends, with `message: null`.
- *Where it is authorised:* on the session's machine, by the offer's `owners` and by `forkFromAnotherMachine` (the permission ceiling), on the request it runs. The window's disabled sentence is a courtesy, never the check. `rewindTo` is checked where it is used: the fork's setup issues the engine's rewind to that message and fails with the engine's refusal if it is not one of that conversation's.
- *A peer on this build or on build G:* lists the capability and takes the act; G's row is master's.
- *A peer on build F:* lists no such capability, so nothing is sent and the button is disabled with "Can’t fork on `<machine>` yet. Update MAWS on `<machine>` and try again."
- *A prompt that was delivered:* accepted by the engine's rewind on every route that can hold one (Engine facts, 13).
- *Its test here:* that the button sends what `isInPlaceFork` accepts, read against that function itself, and that it is disabled with the sentence `useForkUnavailable` gives in each of its states (M3). The link's own tests are U9's and are not repeated.

## The desk's web app

Files these landings touch that `apps/desk-web` imports or reaches (the list of record; the last section of the build brief gives the command that finds importers):

- *Imported by name:* `transcript/view/Transcript.tsx` (`Transcript`, `TranscriptListHandle`, `TranscriptProps`), `view/context.tsx` (`TranscriptActions`, `TranscriptActionsProvider`), `view/markdown/Markdown.tsx`, `view/rows/parts.tsx`, `model/rows.ts` (`Row`, `RowId`, `SubagentRef`), `model/copy.ts` (`QUESTION`), `model/classify.ts` (`presentationOf`), `model/keys.ts` (`rowId`), `stores/transcript.ts`, `lane-a/plane-transcript.ts`, `request-card/tools.ts` (`toolVerb`, `toolClass`, `field`, `filePath`), `src/shared/graph/events.ts`.
- *Reached through those:* `view/transcript.css`, `view/rows/Row.tsx`, `User.tsx`, `AssistantText.tsx`, `LocalCommand.tsx`, `Divider.tsx`, `view/markdown/options.ts`, `surface/Rows.tsx`, `surface/adapters.ts`, `model/derive.ts`, `cells.ts`, `serialize.ts`, `user-text.ts`, `src/shared/keymap/actions.ts`, `src/shared/engine/arrival.ts`, `arrival-schema.ts`, `src/engine-host/fs/backfill.ts`.
- *Not reached:* `transcript/shell.tsx`, `session/SessionPane.tsx`, `sidebar/HoverCard.tsx`, `src/shared/attention/read-only-tools.ts`, `src/services/sessions/digest.ts`, `src/engine-host/normalizer.ts`. The app-side wiring of both landings lives in the first of these, which is why it lives there.

**What its view shows after each landing** is ruled (point 3): after landing 1 the six named differences in its session view and nothing else; after landing 2, nothing but one: a call's line and a message's opened text are drawn from the shared functions of decision 27, with the same words as before. Three rules keep it so. No exported name of the files above is removed or changes its type: every addition to `TranscriptProps`, `TranscriptActions`, `Row` and `TranscriptListHandle` is optional or additive. No module that `Transcript.tsx` reaches statically may import the app's IPC client, its layout or sessions stores, the composer or the key runtime (the desk bundles what it reaches); what needs them is given through `TranscriptActions` or a prop by `transcript/shell.tsx` and the two slots. And the old rule for `.transcript-user-actions` stays for the desk's own bubble (decision 10).

Its proof is in every milestone: the desk's typecheck, its build and its unit project (Concrete Steps, 2), and `e2e:desk-web` in each landing's gate set, whose scenes `session-view.spec.ts` ("the jump to the latest row sits in a gutter clear of every row, wide tables and code included") and `stream-scroll.spec.ts` cross the stylesheet M2 changes. A difference the desk draws beyond the six is reported, not fixed in passing.

## Acceptance

Each is behaviour someone can see or a test can hold. "Unit" runs on the build VM; "scene" is an Electron e2e scene on a Mac, written and typechecked by the executor and run by the architect (Proof). The child's line is named in brackets.

**Landing 1**

1. **A command's light line** [A5]. Unit, from the fixture `uxwave/u3-commands-r1.jsonl` and its transcript file through each route's caller: `/reload-plugins` and `/rename` draw one muted line led by `⎿` under their bubble, with no frame and no "Command output"; `/cost` and `/context` are clipped at two lines and offer "Show more", which removes the bound and offers "Show less"; the closed and the open state hold the same text, in the same order (the row's `textContent` is equal in both); `/context` draws its tables as tables and no heading marker; `/effort low` draws nothing; the interrupted `/compact` shows "Compaction canceled." under itself once and the later one "Compacted" under itself once. From `uxwave/u3-terminal-commands-r1.transcript.jsonl`: the terminal's `/context` grid is a `plain` row, drawn preformatted with no escape sequence in it. Scene: the same in the harness, with the closed row's height at two lines of its type.
2. **Its error and its name** [A5]. Unit: the output of `/compact` with nothing to compact is in `--danger`; `/model`'s error, which the engine sends as ordinary output, is muted; an output whose turn holds no command bubble reads `⎿ /usage · …` when its event carries a run and `⎿ …` when not; the copied markdown of the row is `⎿ <output>` with no heading.
3. **The mod's site** [O-18]. Unit: `commandInput` gives `command: 'usage', args: ''` for `/cost`'s output from the row alone, `isErrored: true` for the stderr output, and reads no event outside the row's turn.
4. **A code block** [A6]. Scene, at 768, 960 and 1280: a fence with one 300-character line is one frame no wider than the text column, with no band over it and no sideways scroll; the copy control's box and the first line's text do not intersect; the control puts the one original line on the clipboard; a selection of the whole block copied by hand holds exactly the source's line ends. Unit: a streaming fence's control is disabled.
5. **Widths** [A7]. Scene, at 768, 960 and 1280, for an answer, a commentary block and a message to the person: a wide table and a wide code block are exactly as wide as the text column; the table's inner scroller scrolls sideways and its frame does not; a narrow table keeps the text's left edge. The 864 px assertion is gone.
6. **The owner's message** [A8]. Scene: hovering a message shows its time, Copy and Edit under the bubble, their right edge at the bubble's, inside the row; the row's height is the same at rest, hovered and focused, and is the bubble's height plus 16 px; a message with a caption shows the caption always and the actions after it on hover; a message of twenty lines still folds with "Show more". Unit: the same structure; Edit absent where `editable` is false or the message waits; the consent line has no such line.
7. **An answer's row, and what Copy takes** [A9]. Unit, over hand-made lists: the row is on the last drawn answer before each of the owner's turn-opening prompts and on the last answer of the list; on none while a turn between that answer and the next prompt runs, on no live or cut text, on no commentary; an engine's turn between two prompts moves it to that turn's answer. Copy's clipboard is the markdown of every answer block of that turn, read from the store: the same text when a block of the answer is not in the drawn list as when it is (the test removes the answer's second block from the drawn list and copies, then restores it and copies). On a master that holds U2b the same test runs over the real mirror, with the stretch closed and open (statement 13). Scene: hovering that answer shows Copy, Fork from here and the time; nothing moves; the clipboard holds both blocks of a two-block answer.
8. **Fork from here** [A9]. Unit: under an answer that a prompt follows, the act is called with that prompt's message id; under the last answer, with null; while it is out the button is disabled and a second press calls nothing (the test holds the act's promise open and asserts in between); a refusal shows the act's toast and enables the button again; an answer whose next prompt has no message id draws no Fork; a mount with no `forkFrom` draws none. A next prompt that sminos delivered is forked from as any other; in the fork, the rewind boundary's tooltip holds the prompt's words without sminos's frame line (from the recorded answer, `uxwave/u3b-fork-delivered.jsonl` seq 26, through the normaliser and the row).
9. **Fork on the other routes** [A9; UC-7]. Unit: for a session on another machine the button is disabled and described by each sentence `useForkUnavailable` gives (offline, connecting, an older build, not an owner, a turn running) and enabled when it gives none; what it sends satisfies `isInPlaceFork`; another machine's terminal session draws no Fork.
10. **A compaction, in a session MAWS runs** [A10, as ruled: at the transcript's end]. Unit, from `uxwave/u3-commands-r1.jsonl`, `u3-commands-r2.jsonl` and `uxwave/u3b-autocompact-r2.jsonl` through the engine host and the store: from the first `compacting` status the drawn list's last row reads `Compacting session…` and, a second later, `Compacting session… 1s`; a running turn's own line still reads `Working …`; four repeated statuses leave the clock running from the first; the row is gone at the next status that is not `compacting`; after the interrupted one no row remains and "Compaction canceled." is the command's output; `/compact` with nothing to compact never shows it; an automatic compaction shows it from its `compacting` status (seq 97) to its end (seq 98), inside the running turn; a process that exits while compacting removes it. The hover card's line reads `Compacting session…` for the same span.
11. **A compaction, in a terminal session** [A10]. Unit: a bridge message `compact` of phase `start` shows the row, and the same operation's `end`, the watch's reset or end, the bridge leaving `live`, or a compaction boundary arriving in the transcript removes it; a `start` for one operation is not ended by another's `end`.
12. **The web plugin's fetch** [A11]. Unit, from the recorded calls (`uxwave/u3b-webfetch-r1.jsonl` seq 72 and 76, 156 and 158): a `mcp__web__fetch` call with `{ url }` or `{ url, prompt }` is in the web group, reads "Fetched `<host>`" (and "Fetching `<host>`" in the digest), has its URL in the cell's detail and in the turn's caption step, shows its string result as a web call's output, is a `fetch` in the request card, and is in the read-only list; each assertion stands beside the same one for `WebFetch`. The `ToolSearch` call before a session's first fetch stays a row of its own.
13. **An agent that ended with its session** [Edges]. Unit: the agents row of an agent whose session's process went reads `<name> ended with the session`; one that was stopped still reads `was stopped`.
14. **Older builds** [check 7; UC-14; ruled, F6]. Unit, in `src/shared/graph/arrival-builds.test.ts`: an output event with exactly the entry this landing sends (`{ class: 'command', run }`, and with `plain`) read by build F's schema keeps the event and drops `arrival`; read by build G's schema it is kept whole and `carriedOf` gives nothing; this build reads an output event with no entry and draws its line. `wire.test.ts` and `wire-fingerprint.test.ts` pass with `WIRE_MINOR` untouched. Scene, in `e2e/cross-build.spec.ts`, run once against each older build as the exact peer: a command's output that a host of one build produced is drawn by a window of the other with no gap row, as that window's build draws an output (Interfaces §H).
15. **The desk** draws the six named differences and nothing else: its typecheck, build and unit project pass unedited, and `e2e:desk-web` is green.

**Landing 2**

In a scene a menu row is fired by its item's id (`e2e/support/menu.ts`), because a scene's keys never reach the macOS menu; where an item below says a scene presses ⌘F, ⌘G, ⇧⌘G, ⌥⌘↑ or ⌥⌘↓, it fires that row. The field's Enter, ⇧Enter and Esc and the arrows are page keys and are pressed. The real keys are the hands-on check of Proof, rows 7 and 12.

16. **The bar and its count** [A12]. Scene: with focus in the transcript, and again in the composer, ⌘F opens the bar with the caret in its field; typing two Latin letters shows no count and marks nothing; a third shows `1 / 17 results` or `0 results`; one Hangul character searches. Unit: the minimum rule; case and Unicode form folded; a phrase that runs across inline code, bold and a link's text is found; a URL that is only a link's target is not; in the recorded `/context` output, `### MCP Tools` (which is in the source's markup and not in the drawing) counts nothing, `MCP Tools` counts, and a string below the two-line clamp counts.
17. **Stepping** [A12]. Scene: Enter and ⌘G go to the next match and ⇧Enter and ⇧⌘G to the previous, with the count following, and wrap at either end; the field keeps the keyboard throughout; Esc closes the bar and the element that had the focus has it again; with the bar closed ⌘G opens it on the last query and goes to the next match.
18. **A match is brought into view, whatever holds it** [A12; ruled, F2]. Scene, each asserting that the current match's rectangle lies inside every clipping ancestor between it and the list and inside the list's visible band under the bar, never only that its row is mounted: a match in a folded turn (the turn opens), in a closed run (the run opens), in a message's body and in a notice's detail (the line opens), past a bubble's fold (the bubble opens), below a command's two-line clamp (the line opens); in a table's far right column and a row below its height bound (the table's own scroller moves on both axes); below a tall code block's viewport (the block's scroller moves); in a pasted block; in the part of a call's line that a narrow column cuts (the label is drawn whole); and, in a narrow column, in a message whose line is cut (the match is counted once, in the opened message, and marked there). Stepping on closes what the step before opened and leaves open what the reader toggled meanwhile; after Esc the last one stays open. Unit: the same order on the controller with a fake of the DOM's clipping chain; on a master that holds U2b, a match in a closed stretch and in a head's unmarked words.
19. **While the session streams** [A12]. Unit: a row that arrives with a match raises the total within 250 ms and leaves the current match on the same words; a text block still streaming is not counted and is counted when it completes; over a stream of batches into one turn, no other turn is derived (the derivation counter `turnDerivations` moves by one per batch for find) and no part outside the changed rows is read again; a first pass interrupted by a yield goes on from the turns it has, derives none twice, and drops its result when the query changed meanwhile (the test holds the yield open); with the bar closed nothing of find runs.
20. **Earlier messages** [A12]. Unit, with a pager whose pages the test releases one at a time: the button shows only while the source says older pages remain; pressed, it asks a page, shows "Searching earlier messages…", asks the next when the count has not grown, and stops when it has, with the current match the newest of the new ones; a keystroke, Esc or closing the bar in between stops it and the page in flight still lands; a page that fails stops it.
21. **A link that is down** [U9's A4]. Unit: over a remote source whose pager fails, find counts and steps through what the store holds, and "Search earlier messages" ends at the pager's failure.
22. **One region only** [A12; check 6]. Scene, run alone on a Mac, in two halves. *The rule:* the row `transcript.find` fired with the caret in a file tab's editor, with focus in a side surface (a terminal included), with Settings open and with a page of the in-app browser focused opens no bar in any session pane; fired with focus in the sidebar or on nothing it opens the focused session pane's bar; in a split each pane opens its own; the two prompt rows fired from a side surface move no transcript. *The regions' own keys:* ⌘F sent to the page with the caret in the editor opens the editor's search; in the Settings view, its search; in a document, its find; and main's handler opens the browser's bar for a page. *By hand* (Proof, 7 and 12): the real ⌘F, ⌘G and ⇧⌘G in each of those regions reach that region and no session pane; in a browser's page ⌘G does nothing; ⌥⌘↑ in an editable file adds a cursor and moves no transcript.
23. **The prompt chords** [A13]. Scene: ⌥⌘↑ brings the previous prompt's bubble to 20 px under the pane's top and tints it; repeated, it walks up one prompt at a time; ⌥⌘↓ walks down and, past the last prompt, goes to the end; at the first loaded prompt ⌥⌘↑ goes to the top of what is loaded; after a wheel scroll the next press starts from the first row in view. Pressed from the composer the caret stays in the draft. Unit: the stops (a steer counts; the consent line, a waiting message, a peer's message and the end row do not).
24. **The arrows** [A13]. Scene: after a prompt chord pressed in the transcript, ↓ moves the focus to the next message (the answer), ↑ back; after a click on a message ↑ and ↓ scroll as today; in the composer and with nothing focused they do what they do today. Unit: the 500 ms test, and Home, End and the page keys untouched.
25. **The table's rows** [UC-6]. Unit: the five ids with their chords, titles and placements; Edit ends "Select All, —, Find ▸" with the three items; Go holds the two jumps; none is rebindable; the palette and the sheet list all five.
26. **Find's cost, measured** [ruled, F5]. Scenes, behind the measurement switch `MAWS_TRANSCRIPT_PERF=1` and run by the architect on a quiet Mac, each reading the longest task the harness's observer saw: at the first open of the bar on the 500-turn session, at most 50 ms; on a session with one very large turn (2,000 tool calls), at most that turn's own derivation as the scene measures it in the store, plus 16 ms; on a session with one very large answer (200,000 characters of markdown with tables and fences), at most that row's own first mount as the scene measures it, plus 16 ms; a keystroke's scan on the 500-turn session, at most 16 ms; an update while the bar is open with a query that matches, at most 16 ms beyond the same batch's task with the bar closed. A budget that is not met stops the landing for the fallback of decision 29.
27. **Every counted match is a markable one** [ruled, F1 and F3]. Unit, one contract case per searched kind (Interfaces §J's table): the row is mounted, find counts by its parts, the marks are registered, and the registered ranges are the counted matches, one for one and in order. Among the cases: a shell call whose description replaces its command (the command's words count nothing); a file call whose path is drawn as a shortened suffix (a folder that is not drawn counts nothing; the same call alone and beside a namesake in its run count by what each draws); a call's line whose words carry code marks (the marks count nothing); a failed call's reason; a call whose line and whose opened output both hold the query (one match, on the line, and no mark in the output); a message's line and its opened body (the preview's words count once, in the body); a notice; a bubble with a pasted block; an answer with a table, a fence, a link and a `<message>` span drawn by the presenter (the tag counts nothing); a command's output of each drawing. No row's time, action row, Reply, copy control or "Show more" is ever marked.

## Constraints that bind every milestone

- **The design binds.** The child's file and the root, at the places the header names, and the decisions above. A point where the code or a fixture contradicts this document, where the work needs an edit in another child's file beyond the insertions of Interfaces §M, where a contract would have to change, or where the owner would see something neither the section nor this document says: stop on it and hand it back with the evidence. Everything else is decided in the spirit of the nearby decisions and recorded in the Decision Log.
- **The engine is unmodified (charter D-1) and not guessed at (law 6).** "Engine facts" is the list; a statement marked bundle only is not built on.
- **A counted match is a markable match** (landing 2). No part is searched whose words are not read from what its row draws, and no match is counted that cannot be marked and brought into view (decisions 27 and 28).
- **UC-3.** U3 owns the arrival and message rows and `transcript/view/Transcript.tsx`. These landings change `local_command`, `user`, `assistant_text` and the view, and add one view-placed row kind. Landing 2 moves the words of a call's line and of a message's opened text into exported pure functions, with no change to what is drawn. They change nothing in `groups.ts`, the group row's own caption, a request row, the turn line, or `src/renderer/src/owner/`. A row that folds must still open under `jumpTo`.
- **UC-6.** The five keys are five rows of `ACTIONS` and nothing else: `src/main/menu.ts` is not edited, and no key is read from a `keydown` listener but the find field's own Enter, ⇧Enter and Esc and the arrows of decision 25.
- **UC-7.** No control is drawn enabled where its act cannot run now; the sentence is `useForkUnavailable`'s, never one written here.
- **UC-8.** Interfaces §M is the whole list of edits in files another child owns.
- **UC-14.** Neither landing stores anything: no key, no version, no settings schema, no stored layout. The open bar, its query, what find opened and the compaction clock live in the window's memory. No wire minor is taken (Interfaces §H); if `wire.test.ts` fails, something reached the wire by mistake: stop and report, and never raise the minor to pass. One entry is newly sent, and it owes its two cross-build runs (acceptance 14).
- **Law 8.** l2-transcript-17 (a long message folds at nineteen lines), l2-transcript-14, l2-transcript-01, -02 and -03 are next to code these landings change; a change that would alter one stops and reports.
- **The scroller.** `TranscriptList`'s follow, anchoring and measurement code is not rewritten. It gains the handle methods of Interfaces §G and one option of the virtualiser, and nothing in it runs per frame that did not before.
- **Light theme first; tokens only.** No new token. Renderer source, comments and test names included, writes a ticket as "ticket 331", never with a hash sign (the tokens guard reads it as a colour).
- **The desk.** "The desk's web app", above: additive exports, no app-only import in what `Transcript.tsx` reaches, no edit in `apps/desk-web`.
- **UC-11, and privacy.** The repository is public. Test content is invented. Nothing is sized or reproduced by reading a person's session, transcript, journal or settings; fixtures come from `spikes/protocol-probe/fixtures/` or are written by hand in the shapes "Engine facts" cites, under the allowlisted fixture folders when they must be files.
- **Where checks run (UC-10).** In the worktree nothing is installed, typechecked, linted, tested, built or launched. Every check an executor runs is on the build VM in a checkout of the pushed head. An executor starts no gate on GitHub Actions and no Electron e2e and opens no pull request.
- **Git.** Commit as you go and push the landing's branch. Merge master, never rebase or force-push. Every commit message ends with the `Sminos-Session:` line the dispatch gives, and carries no other attribution.

## Plan of Work

Ten milestones, one executor each, in order; M1 to M6 are landing 1 on `ux-wave/U3b`, M7 to M11 are landing 2 on `ux-wave/U3b-2`. Every executor reads this whole document and the child's file first; a milestone points at them and restates nothing. Paths are written as "Words used here" says.

One rule for all of them. The suites that map whole recorded sessions (`model/fixtures.test.ts`, `snapshots.test.ts`, `journals.test.ts`, `disk.test.ts`, `src/renderer/src/lane-a/arrival-routes.test.ts`, the engine host's conformance suites) and the 217 row snapshots under `test/snapshots/transcript/` move only where a row gains a field of this document. Each moved expectation is read and tied to a decision in the commit that changes it; one that ties to none is a defect, not a snapshot to refresh.

### M1 — A command's output is a light line

**What exists at its end.** On every route a slash command's output is the dim line of decision 4 under its command, and the "Command output" card is gone. The event of an output names the command the engine ran, where the engine said, and the row and the mod's site read it from there.

**What it touches.** `src/shared/engine/arrival.ts` (the file row's `commandRun`), `src/shared/engine/arrival-schema.ts` (`commandEntry`, `commandRunOf`), the two producers `src/engine-host/normalizer.ts` (`commandOutput`) and `src/engine-host/fs/backfill.ts` (both places that make a `user.message` of origin `local-command`); `model/rows.ts` and `schema.ts` (the row's three fields), `model/derive.ts` (`localCommandRow`, in a turn and loose), `model/copy.ts`, `model/serialize.ts`; `view/rows/LocalCommand.tsx`, `view/transcript.css`; `surface/adapters.ts` (`commandInput`). Tests beside each, `src/shared/graph/arrival-builds.test.ts`, and the row snapshots that hold a command's output.

**Interfaces.** Exposes §A and §B. Consumes U3a's reader and its `command` class.

**Decisions.** 2 to 6. The other machine's rows ride the backfill (`recordToEvents`), so `lane-a/plane-transcript.ts` needs no edit; a test says so. `LOCAL_COMMAND_HEADER` is deleted with its last reader. The `.transcript-replayed*` rules stay: the `!` shell row still uses them. A setting change's confirmation still draws nothing (`confirmsSettingChange`), and an empty output still draws nothing.

**What it does not touch.** The reducer's routing of a command's output and of its repeat; `CarriedArrivalSchema` and `CARRIED_CLASSES`; `WIRE_MINOR`; the command's bubble; `rows/Bash.tsx`.

**What it proves.** Acceptance 1 (its unit half), 2, 3 and 14. Beyond them its tests pin: an entry whose `run` is malformed is ignored and the event still reads; the entry is on no synthetic message; `carriedOf` never returns it.

### M2 — Code blocks and tables keep the column; the owner's message actions sit under the bubble

**What exists at its end.** A fenced block wraps in one frame, a wide table scrolls inside its frame, neither leaves the text column, and the owner's time, Copy and Edit are a line under the bubble that costs no height.

**What it touches.** `view/transcript.css`; `view/rows/User.tsx`; `view/rows/User.test.tsx` and the row tests that name `.transcript-user-actions` or `.transcript-user-meta`; a new structure test for a fence and a table under `view/markdown/`.

**Interfaces.** None exposed. The class names the scenes of M6 and M11 select are fixed in §B and §L.

**Decisions.** 7 to 11. jsdom has no layout: this milestone's unit tests hold structure (what is rendered, what is absent, which element holds which control, that a streaming fence's control is disabled) and the widths, heights and non-overlap are M6's scenes. The frames are drawn from the example the owner has looked at (the cards' section), not invented at build time.

**What it does not touch.** `view/markdown/options.ts` and `Markdown.tsx` (the Streamdown options stay as they are); the mermaid renderer; `tokens.css`; `apps/desk-web`; the bubble's fold at nineteen lines; `AnchorChip`.

**What it proves.** The unit halves of acceptance 4 and 6; with M6's scenes, 4, 5 and 6.

### M3 — An answer's Copy, Fork from here and time

**What exists at its end.** Hovering the last answer before the owner's next prompt shows Copy, "Fork from here" and the time. Fork opens a fork that ends with that answer, on this Mac and, through U9's offer, on another machine, and says why when it cannot.

**What it touches.** New `model/answer-actions.ts` and `view/rows/AnswerActions.tsx` with their tests; `view/rows/Row.tsx` (`RowView` renders the action row after the row's body; no case of `body()` changes); `view/Transcript.tsx` (the projection and its store); `view/context.tsx` (`forkFrom`, the store's place in the context); `model/copy.ts` (the words); `view/transcript.css`; `transcript/shell.tsx` (the adapter's registration); `lane-a/view/RemoteTranscriptSlot.tsx` (it gives no `forkFrom`); `sessions/record-ops.ts` (`forkInPlace`'s optional `rewindTo`).

**Interfaces.** Exposes §C and §D. Consumes U9's `forkSession`, `forkInPlace` and `useForkUnavailable`.

**Decisions.** 12 to 15. The async sequence, fixed here: *press* → the button disabled and `aria-busy` → the act settles → enabled. A press while disabled does nothing. The act opens the fork's tab itself; the button does nothing on success. On a refusal the act has already shown its toast. If the row leaves the list while the act is out, the act still completes and its tab still opens. If the act never settles the button stays disabled for that mount of the row only; the act's own budget (`command-budgets.ts` for the link) ends it.

**What it does not touch.** `src/endpoint/offers.ts`, `src/shared/ipc/remote-unavailable.ts`, `src/renderer/src/lane-b/remote-unavailable.ts`; the composer's Edit and its Fork; the turn line's menu; `serializeRows` itself.

**What it proves.** Acceptance 7 (unit), 8 and 9.

### M4 — A compaction says so

**What exists at its end.** While a session compacts, its open turn's line reads "Compacting session…" with the time so far, a row at the list's end says the same when no turn is open, and the sidebar's hover card says it too; nothing remains when it ends, however it ends.

**What it touches.** New `stores/compacting.ts` and `view/compacting.ts` with tests; `transcript/shell.tsx` (the store's subscription to the sessions store); `lane-a/watches.ts` (one call where `compact` messages are kept); `model/copy.ts` (`dividerHead`, the words), `model/rows.ts`, `schema.ts`, `serialize.ts` (the `activity` kind); `view/Transcript.tsx` (the prop, the row, `ESTIMATES`), `view/context.tsx`, `view/rows/Divider.tsx` (`useDividerSummary`), `view/rows/Row.tsx` (the kind's case), new `view/rows/Activity.tsx`; `view/TranscriptSlot.tsx` and `lane-a/view/RemoteTranscriptSlot.tsx` (they pass the prop); `sidebar/HoverCard.tsx` (one line).

**Interfaces.** Exposes §E.

**Decisions.** 16 and 17, and "Reported, 2" for the place. The transitions, fixed here; `since` is the window's clock in milliseconds:

| event | from | to |
|---|---|---|
| the session's status has `activity: 'compacting'` and its process is `ready` | off | on, `since` = now |
| the same again (the engine's repeat) | on | on, `since` unchanged |
| a status with any other `activity`; a status whose process is `exiting` or `exited`; the session's status removed | on | off |
| a bridge message `compact` with phase `start` and operation id R | off | on, `since` = now, held by R |
| `compact` with phase `end` and id R; the session's watch resets or ends; its bridge is no longer `live`; a row of kind `boundary` and `boundaryKind: 'compaction'` later than `since` reaches the store | on, held by R | off |
| `compact` `end` with another id | on, held by R | on |

A session has one state; the two sources never both feed one session (one is a session MAWS runs, the other a terminal session). The elapsed time ticks once a second through the ticker the turn line already uses.

**What it does not touch.** `src/engine-host/session-status.ts` and the status schema; the digest and the sidebar row's glyph; `PluginStatusLine`; the turn line's caption, counts and menu.

**What it proves.** Acceptance 10 and 11. Beyond them: with a plugin's Spinner text set, the line keeps the plugin's text; the `activity` row is never in the store's rows, never copied (`partOf` gives null) and is the last row before U1b's end row when that exists.

### M5 — The web plugin's fetch, and the word for an agent that ended with its session

**What exists at its end.** A call of the web plugin's fetch tool draws, groups, captions, digests and is asked about exactly as `WebFetch` is. The transcript's agents row says "ended with the session" where that is what happened.

**What it touches.** New `src/shared/engine/web-fetch.ts` with its test; `model/classify.ts`, `model/caption.ts`, `model/cells.ts` (two places), `model/copy.ts` (`cellLabel`, before its MCP test), `model/derive.ts` (the turn's used tools); `request-card/tools.ts`; `src/services/sessions/digest.ts`; `src/shared/attention/read-only-tools.ts`; the tests beside each. For the word: `model/copy.ts` (`subagentSentence`), `model/derive.ts` (`endedByExit`), `model/rows.ts`, `schema.ts`.

**Interfaces.** Exposes §F.

**Decisions.** 18 and 19. Each of the nine places asks the helper; none compares a tool's name itself afterwards (a test greps the renderer and the two services for the literal `'WebFetch'` outside the helper, its tests and `READ_ONLY_TOOLS`' own list). The hand-written call shapes in the tests are replaced by the probe's fixture when it exists (Probes, 4).

**What it does not touch.** `WebSearch`; any other MCP tool; `view/cells/WebDetail.tsx` (it draws the same detail); U8's panel and its words.

**What it proves.** Acceptance 12 and 13.

### M6 — The scenes, the record, the last run of landing 1

**What exists at its end.** Landing 1's scenes are written, the two reversed rulings and X1's line are amended where they stand, and the branch is handed back green on the VM.

**What it touches.** `e2e/transcript.spec.ts` (the breakout scene becomes acceptance 5's; new scenes for 1, 4, 6 and 7), `e2e/composer.spec.ts` (the W2 scene's assertion on where the actions sit; the Edit scenes still find the button), `e2e/side.spec.ts` (scene 9's selector), and the harness fixtures those scenes replay; `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md` and `docs/charter.md` (the amendments below); `docs/tech-debt-tracker.md`.

**Decisions.** No new spec file: a guard pins the number of spec files and which group runs each. A bound a scene asserts on a time takes one of the forms the gate's guard lists (`.github/scripts/gate-plan.test.mjs`, above `LIVENESS_BOUNDS`); these scenes assert pixels and text, not times. The amendments, each dated and appended where the ruling stands:

- O-08, in `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md`, Decision Log, 2026-10-01 (W2 residue), "Wide blocks break out to `--measure` + 128px", and at the charter's Decision Log entry of 2026-10-01 (W2 executor) that names `--measure-wide`: "Reversed 2026-11-12 (UX wave, U3, O-08): an answer's table or code block keeps the text column's width; a code block wraps and a table scrolls sideways in its frame. `--measure-wide` stays for the Projects and Library pages. The owner: 'longer boxes escape transcript ratio. I'd fix the size.'"
- O-02, in the same plan, item B2's direction: "Amended 2026-11-12 (UX wave, U3, O-02): the time, Copy and Edit sit under the bubble, not beside it, in the space the message already has there; no height is added. The owner: 'move copy, edit, time to be below message component, not next to it.'"
- X1, appended to its entry in `docs/charter.md` §13: "Amended 2026-11-15 (UX wave, U3b; UC-2), additive: on a `user.message` of origin `local-command`, `arrival` may hold one entry `{ class: 'command', run: { command, args } }`, the command as the engine ran it. It is not one of the classes the event's schema holds strictly: it passes as an entry of a class the schema does not name and is read by `commandRunOf` (`src/shared/engine/arrival-schema.ts`), which ignores an entry that does not fit. A build that does not know it draws the output as before."

Tracker rows opened: a command the sminos bridge ran is drawn as the person's (Probes, 2); an output that mixes stdout and stderr is drawn muted; a terminal's `/context` grid is drawn through markdown with its colours removed; a mode change in the middle of a compaction restarts the words' clock (Surprises, 10); the desk draws Edit where nothing answers it (Surprises, 6).

**What it does not touch.** The register and the board (the architect's, at landing); `e2e/cross-build.spec.ts` unless "Reported, 4" is ruled the other way.

**What it proves.** Every acceptance item of landing 1, as written, in "Concrete Steps", 4; the scenes are handed over unrun.

### M7 — The five keys, and moving between prompts and messages

**What exists at its end.** The five rows are in the menu, the palette and the shortcut sheet. ⌥⌘↑ and ⌥⌘↓ walk the owner's prompts, and ↑ and ↓ walk messages once a message has a keyboard-given focus. ⌘F, ⌘G and ⇧⌘G reach the right pane and do nothing yet.

**What it touches.** `src/shared/keymap/actions.ts` and `actions.test.ts`; `src/main/menu.test.ts` and `settings-tab/keymap.test.ts` (their expectations of the Edit menu's end and of the rows that take no rebinding); new `transcript/keys.ts` (the app's side: the pane rule and the five handlers) and `view/pane-controls.ts` (what a mounted transcript offers the keys) with tests; `transcript/shell.tsx`; new `model/navigation.ts` with its test; `stores/transcript.ts` (`focus: false`, `gap`); `keymap/shell-navigation.ts` (one export); `view/Transcript.tsx` (the handle, the jump effect, the arrows, the tint), `view/rows/Row.tsx` (`RowFrame` marks a message row), `view/transcript.css`.

**Interfaces.** Exposes §G and §I. Consumes U6a's table shape and `focusedSession()`.

**Decisions.** 20 to 26. **Its first step is a spike** (decision 22): one commit with the five rows and handlers that write one console line each; then stop and hand back for the hands-on check of the real keys (Proof, 7). *Promote:* a focused editor, the Settings view, a document and a browser page keep ⌘F, and an editable file keeps ⌥⌘↑; the milestone goes on. *Discard:* any of them loses its key to the menu; the rows are reverted and the architect rules (Probes, 1). Where the rows stand in `ACTIONS` is the executor's, under three conditions: Edit ▸ Find lists Find in session…, Find next, Find previous in that order; the two jumps follow `attention.next` in Go; and none of the five stands between `transcript.toggleReport` and the row after it (U2b pins that pair).

**What it does not touch.** `src/main/menu.ts`, `src/shared/keymap/build-f.ts`, the key dispatcher and `useKeyChord`; `src/main/browser/keys.ts`; the composer; the follow and anchoring code of `TranscriptList`.

**What it proves.** Acceptance 23, 24 and 25 (their unit halves; the scenes are M11's), and by the spike's check that the five chords can be menu rows.

### M8 — Find: what is searched, counted and opened

**What exists at its end.** A find controller per mounted transcript that, given a query, knows every match in the loaded session, which one is current, what to open for it and what to close after it, keeps that true while the session streams, and can walk older pages. No bar yet: it is driven by its tests.

**What it touches.** New `model/find.ts` (the minimum, the fold, the text of a part, the parts of a row, the matches of a part) and `view/find/controller.ts`, with tests; `model/derive.ts` (the rows with every turn open, on a memo the caller keeps; the store's own `allExpandedRows` calls it); `view/context.tsx` (`Disclosures` gains `open` and `close`).

**Interfaces.** Exposes §J and the controller's half of §K. Consumes §B's key, §G's jump option, and the pager's shape (`OlderPagesController`, `lane-a/view/older-pages.ts`).

**Decisions.** 27 to 30 and 33. The states of a search, fixed here: *idle* (no bar, or a query under the minimum) → *indexing* (the first pass, in slices) → *ready* (matches, a current one or none) ⇄ *walking* (older pages being asked). A new query from any state cancels the pass or the walk in flight by a generation number; a result that carries an older generation is dropped. The linearization points are the store's own: find reads the store's state when its throttled recount runs and never holds a row across a store change.

**What it does not touch.** Any view; the store's `jumpTo` (it is called, not changed); `rowsOf` and the store's memo; thinking and tool output, which stay unread.

**What it proves.** The unit halves of acceptance 16 to 21, and the bounds of acceptance 19 by the derivation counter and a lexing counter of its own.

### M10 — Find: the bar, the marks and where the view lands

**What exists at its end.** ⌘F opens the bar; the count, the marks and the view follow the controller; Esc gives the focus back.

**What it touches.** New `view/find/FindBar.tsx`, `view/find/marks.ts` and `view/find/index.ts` (the chunk's entry), with tests; `view/Transcript.tsx` (the lazy host, the handle's `reveal`, the padding under an open bar, the pager given to find), `view/rows/Row.tsx` (`RowFrame` registers its marks when find is loaded), `view/transcript.css` (the bar; the two `::highlight` rules), `model/copy.ts` (`FIND`), `transcript/keys.ts` (the three handlers call the controller), `lane-a/view/RemoteTranscriptSlot.tsx` (it hands the plane's pager to the transcript).

**Interfaces.** Exposes the view's half of §K.

**Decisions.** 31, 32 and 34, and card 1 for the bar's place. `CSS.highlights` does not exist in the unit environment: `marks.ts` takes its registry as an argument, the unit tests give it a fake and assert the ranges, and that the two highlights paint is M11's scene. The field ignores Enter while an input method composes, as the in-app browser's bar does.

**What it does not touch.** The in-app browser's bar and its words; the dispatcher; `apps/desk-web`.

**What it proves.** The remaining unit halves of acceptance 16 to 18; with M11's scenes, 16 to 18 and 22.

### M11 — The scenes, the record, the last run of landing 2

**What exists at its end.** Landing 2's scenes are written and the branch is handed back green on the VM.

**What it touches.** `e2e/transcript.spec.ts` (scenes for acceptance 16, 17, 18, 23 and 24, on the harness's long synthetic session and a session with folded turns), acceptance 22's scene in the spec that already opens a session, a file and Settings in one app, and its browser case beside the browser's own find scene (`e2e/browser.spec.ts`); the harness fixtures they replay; `docs/tech-debt-tracker.md`.

**Decisions.** No new spec file. No ruling is reversed and no contract amended by landing 2. Tracker rows opened: a tab stop of the transcript's own for messages ("Reported, 9"); ⌘G in a page of the in-app browser ("Reported, 5"); diacritics are not folded, where Desktop folds them; find in a subagent's transcript.

**What it does not touch.** The register and the board.

**What it proves.** Every acceptance item of landing 2, as written, in "Concrete Steps", 4.

## Concrete Steps

From the landing's worktree. `vmcheck.sh` is `~/.local/share/maws-ux-wave/tools/vmcheck.sh`; `<branch>` is `ux-wave/U3b` for M1 to M6 and `ux-wave/U3b-2` for M7 to M11. The VM is shared with landings in build: a slow or timed-out check is read against its load first. Every command there runs under a time limit sized to what it should take.

1. **Master first**, before each milestone.

       git fetch origin master && git merge origin/master

   Merge, never rebase or force-push. Then read what the work stands on:

       git grep -n "LOCAL_COMMAND_HEADER" -- src/renderer/src/transcript
       git grep -n "UnknownEntrySchema" -- src/shared/engine/arrival-schema.ts
       git grep -n "measure-wide" -- src/renderer/src/transcript/view/transcript.css e2e/transcript.spec.ts
       git grep -n "export async function forkInPlace\|export async function forkSession" -- src/renderer/src/sessions/record-ops.ts
       git grep -n "export function useForkUnavailable" -- src/renderer/src/lane-b/remote-unavailable.ts
       git grep -n "'transcript.find'\|'transcript.previousPrompt'" -- src/shared/keymap
       git grep -n "WIRE_MINOR: number" -- src/shared/ipc/wire.ts
       ls src/renderer/src/owner/view/mirror.ts src/renderer/src/transcript/view/waiting-view.tsx 2>/dev/null
       ls spikes/protocol-probe/fixtures/uxwave/u3-commands-r1.jsonl spikes/protocol-probe/fixtures/uxwave/u3-commands-r1.transcript.jsonl spikes/protocol-probe/fixtures/uxwave/u3-terminal-commands-r1.transcript.jsonl

   Before M1 the first prints the header's three uses and after M1 nothing; the second prints the loose member; the keymap line prints only `actions.test.ts` until M7. The first `ls` says which of U2b and U1b is on master (neither file: neither). Then go through "The statements to read again" for every file the merge changed (`git diff --name-only <the head before the merge> HEAD`); where one fails, do what its table row says, and where that is not enough, stop and report. Landing 2's branch is cut from a master that holds landing 1: `git grep -n "commandRunOf" -- src/shared/engine/arrival-schema.ts` prints a line, or stop.

2. **The checks**, on the VM. Push before every check: the VM sees only what is on origin.

       git push -u origin <branch>
       vmcheck.sh <branch> -- 'timeout 900 pnpm exec vitest run <the milestone's paths>'
       vmcheck.sh <branch> -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # the renderer
       vmcheck.sh <branch> -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'    # shared, main, services, the engine host (M1, M5, M7)
       vmcheck.sh <branch> -- 'timeout 600 pnpm exec eslint <the paths changed>'

   The first call for a branch installs dependencies there; allow it twenty minutes. A call's exit status is the command's, so it is never piped into `tail` or `head` without `set -o pipefail`. A filter given to vitest is a substring of file paths: give it paths, never a bare word. At a milestone's tests-first commit the run fails on the new assertions (for M1, a line such as `expected '*Command output*\n…' to be '⎿ Session renamed to: …'`); at its head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing.

   The paths, per milestone:
   - M1: `src/shared/engine src/shared/graph src/engine-host/normalizer.test.ts src/engine-host/normalizer-arrivals.test.ts src/engine-host/fs src/renderer/src/lane-a src/renderer/src/transcript test/support/tokens-guard.test.ts`
   - M2: `src/renderer/src/transcript/view src/renderer/src/side src/renderer/src/composer test/support/tokens-guard.test.ts`
   - M3: `src/renderer/src/transcript src/renderer/src/lane-a/view src/renderer/src/sessions src/renderer/src/lane-b test/lane-b test/support/tokens-guard.test.ts`
   - M4: `src/renderer/src/stores src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/sidebar src/renderer/src/owner test/support/tokens-guard.test.ts`
   - M5: `src/shared/engine src/shared/attention src/services/sessions src/renderer/src/request-card src/renderer/src/transcript src/renderer/src/panel/summary test/support/synth-transcript.test.ts`
   - M7: `src/shared/keymap src/main/menu.test.ts src/renderer/src/keymap src/renderer/src/settings-tab src/renderer/src/palette src/renderer/src/transcript src/renderer/src/stores test/support/tokens-guard.test.ts`
   - M8: `src/renderer/src/transcript src/renderer/src/stores src/renderer/src/lane-a/view`
   - M10: `src/renderer/src/transcript src/renderer/src/lane-a/view test/support/tokens-guard.test.ts`

   A row snapshot that a decision moves is rewritten on the VM and comes back as that run's diff, applied in the worktree and committed:

       vmcheck.sh <branch> -- 'timeout 900 pnpm exec vitest run -u src/renderer/src/transcript/model/snapshots.test.ts src/renderer/src/transcript/model/fixtures.test.ts; git diff --binary -- test/snapshots' > /tmp/u3b-snapshots.patch

   Read the patch before applying it: every changed row is one this document changes.

   And at every milestone's head, the desk, which reaches files of every milestone:

       vmcheck.sh <branch> -- 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck.sh <branch> -- 'timeout 900 pnpm --filter desk-web build'
       vmcheck.sh <branch> -- 'timeout 900 pnpm exec vitest run --project desk-web'

   Each ends with no error and with no file of `apps/desk-web` edited. A test of the desk's that fails is read first as a difference the desk draws: if it is one of the six of "Reported, 3", report it for the coordinator; if it is another, it is this milestone's defect.

3. **The wire does not change.** After M1, and again in each landing's last run:

       vmcheck.sh <branch> -- 'timeout 300 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts src/shared/machine'

   passes with `WIRE_MINOR` and both manifest files untouched. If it fails, something was added to the wire by mistake: stop and report.

4. **The last run of a landing** (M6, M11), after a fresh merge of master and a push:

       vmcheck.sh <branch> -- 'timeout 1200 pnpm typecheck'
       vmcheck.sh <branch> -- 'timeout 1200 pnpm build'
       vmcheck.sh <branch> -- 'timeout 900 pnpm exec eslint $(git diff --name-only origin/master...HEAD -- "*.ts" "*.tsx" | tr "\n" " ")'
       vmcheck.sh <branch> -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck.sh <branch> -- 'timeout 2400 pnpm test'
       vmcheck.sh <branch> -- 'timeout 900 pnpm test:probes'

   On the VM these fail on master too and are not this work's: the desk-hub `test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts`, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` can fail under the whole suite's load and pass alone. Any other failure is this landing's. A run whose log has stopped growing while a process sits at full CPU is a loop: stop it, check that no worker is left (`pgrep -fa vitest`), find the case one file at a time, and report the loop itself. The whole suite runs once per landing, here; an earlier milestone does not run it. A suite whose behaviour could depend on the Node version (none is expected) is run once under Node 22 as the build brief says.

5. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The hand-back says: what exists, with the command and the result that showed it; what is not verified (every scene, by file and name, written and typechecked but not run, with its group); the decisions made; anything that contradicts this document or the child's file; what deserves a ticket.

6. **M7's spike** stops once before that: after its first commit and a push, the executor hands back the head and waits for the hands-on check (Proof, 7).

7. **The architect's, after a hand-back.** "Proof that an executor does not run", in its order.

## Proof that an executor does not run

| # | the proof | when | what it needs | what comes back |
|---|---|---|---|---|
| 1 | **The owner's look at the drawn example** | before M2 (frames 1 to 6) and before M10 (frames 7 to 9) | the frames listed under the cards, drawn at real sizes with invented content; the two cards | each frame called a clear improvement or reworked; the answers to card 1 and card 2 |
| 2 | **Class 1a**, landing 1 | on the head M6 hands back, and again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u3b`, in the background | each job's conclusion and the run's URL |
| 3 | **The branch's review**, landing 1 | once class 1a is green | the xhigh panel of `doperpowers:review-code`, with the lenses of "Size and review", the base and head shas and the worktree | its verdict and findings; findings are settled by a fix wave, never inline |
| 4 | **Landing 1's scenes alone, then their groups** | after the review's findings are settled | a Mac under the load rule. Alone: the changed and new scenes of `e2e/transcript.spec.ts`, the W2 scene and the two Edit scenes of `e2e/composer.spec.ts`, scene 9 of `e2e/side.spec.ts`. Then the groups `e2e:transcript`, `e2e:c7`, `e2e:side`, `e2e:panel`, `e2e:agents`, `e2e:to-human`, `e2e:lane-a`, `e2e:remote`, `e2e:desk-web` and the default group | each scene and group named as run and green; a skipped scene is not evidence. What only this run shows: every width, height and overlap of acceptance 4, 5 and 6; that hovering moves nothing; that the clipboard holds what the acceptance says |
| 5 | **The measured anchoring scene** | with 4, on a quiet Mac | `MAWS_TRANSCRIPT_PERF=1 pnpm e2e:transcript -g "anchoring: 500 turns"`, twice on master's tree and twice on the landing's, read base against landing as the gate-offload plan's Decision Log 162 says (every p95 within 0.5 ms of every other) | the four readings. It is owed because the answer-row projection runs once per change of the list during that scene's stream, and because fenced blocks and tables measure differently |
| 6 | **#330's other symptoms** (the child's check 5) | on the built window of landing 1, with a live engine and a terminal session | in a terminal session `/rename x` then `/effort low`, then the reverse order, then a command that prints nothing; in a session MAWS runs, an interrupted `/compact` and then one that succeeds | no output under another command, no "(no content)" row; or the symptom, which is fixed before landing |
| 7 | **The keys' routing** (Probes, 1) | after M7's first commit, before the rest of M7 | a Mac that runs the spike's head; real key presses, by a person or through the computer-use tool: ⌘F, ⌘G and ⇧⌘G with the caret in a file's editor, in the Settings view, in a document and in a browser's page; ⌥⌘↑ in an editable file; each of the five from a session pane | per press, which side answered (the region's own search, or the handler's console line); the verdict of M7's promote or discard |
| 8 | **Class 1a**, landing 2 | on the head M11 hands back, and on the final head | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u3b-2` | as 2 |
| 9 | **The branch's review**, landing 2 | once class 1a is green | as 3 | as 3 |
| 10 | **Landing 2's scenes alone, then their groups** | after the review | a Mac under the load rule. Alone: the new scenes of `e2e/transcript.spec.ts`, acceptance 22's scene, its browser case. Then `e2e:transcript`, `e2e:c7`, `e2e:panel`, `e2e:code`, `e2e:browser`, `e2e:settings`, `e2e:document`, `e2e:side`, `e2e:lane-a`, `e2e:remote`, `e2e:desk-web` and the default group | as 4. What only this run shows: that the highlights paint, that a match is in view under the bar, where focus is after each key, and all of acceptance 22 |
| 11 | **The measured anchoring scene** | with 10 | as 5 | the four readings. It is owed because `RowFrame` and the list's handle changed; with the bar closed the scene must read as master does |
| 12 | **The owner's look at the built window** | at the wave's next sitting after each landing | landing 1: a command's line, a wrapped fence, a wide table, the two action rows, a compaction in a long turn, a fetch by the web plugin, a command the sminos bridge ran (the child's residue for O-18). Landing 2: find over a long session with folded turns, the prompt chords from the composer and from the transcript, and the real keys of acceptance 22 in each region once more | each called a clear improvement, or reworked |

No paid live group is owed: neither landing changes a scene of `e2e:p1-live` or what it proves. Until row 4 is green no build that holds landing 1 is offered to a machine a person uses, and likewise row 10 for landing 2.

## The pull requests

Two, each opened by the architect after its hand-back, each opening with the root's path, "U3, second landing, part 1 of 2" or "part 2 of 2", and the parent pin.

- **Landing 1's body** names: its class 1a run on the final head; the review's verdict and what was dismissed or deferred; the Mac runs of rows 4 to 6 by scene and group; the rulings it reverses, O-08 and O-02, amended where they stand, and X1's dated line; that no wire minor is taken and nothing is stored, with "Reported, 4"; the insertions of Interfaces §M (U1's two files, U2's two, U7's one, U9's one) for their owners; the six differences the desk draws; that `mcp__web__fetch` is now read-only for one-click allows, for U1; the tracker rows of M6; the probes still open (2, 3, 4). The board at landing: #330, #331 and #146 close; #44 closes with its first item pointed at O-02.
- **Landing 2's body** names: its class 1a run, review and Mac runs (rows 8 to 11); the spike's verdict (row 7); the five rows added to U6's table and the two test expectations of U6's that moved; that it reverses no ruling, stores nothing and sends nothing; the departures from Claude Desktop of "The reference"; the tracker rows of M11. The board at landing: #588 closes.

Each ends with the session line the build brief gives.

## Interfaces and Dependencies

What these landings expose and consume is defined here once. Signatures bind; file-private helpers are the executor's.

### §A. The `command` entry and its reader (M1)

In `src/shared/engine/arrival-schema.ts`, beside `carriedOf`:

```ts
/** The command the engine ran for an output, as the entry of `arrival` that carries it; absent where the carrier named none. */
export function commandEntry(run: { command: string; args: string } | null): ArrivalEntry[];   // [] for null

/** The run a `user.message` of origin `local-command` carries, or null: its first entry of class `command` whose `run`
 *  is exactly `{ command: string; args: string }`. An entry that does not fit is ignored, never an error. */
export function commandRunOf(arrival: readonly ArrivalEntry[] | undefined): { command: string; args: string } | null;
```

`CarriedArrivalSchema`, `CARRIED_CLASSES`, `ArrivalEntrySchema` and `carriedOf` are not changed. The comment over the loose member is corrected: a class outside the closed set passes as sent, and `command` is read by `commandRunOf`.

The producers attach `arrival: commandEntry(run)` only when it is not empty, to the `user.message` of origin `local-command` that carries the output (never to a synthetic message): `Normalizer.commandOutput`, and the backfill's two places. In `src/shared/engine/arrival.ts`, the reading of a file's `system` row of subtype `local_command` that holds an output gives `run` from the row's `commandRun` (`{ command: string; args?: string }`, read as `local_command_run` is read on the frame); every other carrier keeps `run: null`.

### §B. The command's row and its line (M1)

```ts
// model/rows.ts
| { kind: 'local_command'; messageUuid: MessageUuid | null; text: string;
    error?: true;                               // all of it came in <local-command-stderr>
    run?: { command: string; args: string };    // commandRunOf(event.arrival)
    lone?: true }                               // its turn holds no bubble of a command, or it has no turn
```

`RowSchema`'s arm gains the three optional fields. `lone` is set in `deriveTurn` when the turn's user row is absent or its text is not a slash command line (`slashCommandLine`, the function that already says so), and for every loose row.

The view's contract: the row's root is `.transcript-command` with `data-error` when `error`; the lead `⎿` is `aria-hidden`; the closed text is plain; the disclosure is **`line:<row.id>`**; the buttons read "Show more" and "Show less" and carry `aria-expanded`. `partOf` gives `⎿ <text>`, or `⎿ /<run.command> · <text>` for a `lone` row with a run.

`commandInput(row, state, revealed)` keeps its signature and gives `{ command, args, text: row.text, isErrored: row.error === true }` by decision 5.

### §C. The answer's action row (M3)

```ts
// model/answer-actions.ts
/** For each answer row that gets the action row, the message to fork from: the id of the owner's next turn-opening
 *  prompt, or null under the list's last answer. Rows not in the map get no action row. */
export function answerActionsOf(rows: readonly Row[]): Map<RowId, { rewindTo: MessageUuid | null; fork: boolean; copy: RowId[] }>;
```

A *turn-opening prompt of the owner's* is a `user` row with `steer: false`, no `pending`, no `unread` and `dropped: false`; the consent line counts (it is the owner's prompt). The answer is the last `assistant_text` row with `phase: 'answer'`, `live: false` and no `cut`, after the prompt before and before this one. A turn is running when its `divider` row reads `state: 'working'` or one of its rows is `live`; there is no entry when a running turn has a row between that answer and the next prompt (or the list's end). `fork` is false where the next prompt has `messageUuid: null`. `copy` is the ids of the `answer` rows of that answer's turn, in order.

`Transcript.tsx` computes it from the list it draws in a `useMemo` on the rows, and publishes it through a store created per mount and carried in the context (`answerActions?: { subscribe(listener): () => void; get(id: RowId): … | undefined }`); `get` returns the same object until its value changes. `RowView` renders `<AnswerActions row={row} />` after the body of an `assistant_text` row; the component reads the store and renders nothing without an entry.

The row's contract: `.transcript-answer-actions`, always laid out, opacity 0 until `.transcript-row:hover` or `:focus-within`; in order Copy, Fork from here, the time.

### §D. Fork from here (M3)

```ts
// view/context.tsx, in TranscriptActions; optional, with no default
forkFrom?: {
  /** Why the fork cannot run now for this session, in U9's words; null when it can. A hook. */
  useUnavailable(appSessionId: AppSessionId): string | null;
  /** Forks in place from before `rewindTo` (null: the whole conversation). Opens the fork's tab or says why not; never throws. */
  run(appSessionId: AppSessionId, rewindTo: MessageUuid | null): Promise<void>;
};
```

The app's adapter, registered in `connectTranscript()` (`transcript/shell.tsx`): `{ useUnavailable: useForkUnavailable, run: forkInPlace }`, where `forkInPlace(appSessionId: AppSessionId, rewindTo: MessageUuid | null = null): Promise<void>` in `sessions/record-ops.ts` passes `{ message: null, rewindTo }` to `forkSession`. `RemoteTranscriptSlot` (another machine's terminal session) gives its `Transcript` actions without `forkFrom`. A child's transcript (`variant: 'child'`) draws no Fork whatever the actions hold: a subagent's rows are not the session's prompts.

The button: with a sentence from `useUnavailable`, `disabled` with the sentence as its `title` and `aria-description`; while `run` is out, `disabled` and `aria-busy`.

### §E. A compaction (M4)

```ts
// stores/compacting.ts (the app's)
export function noteCompacting(appSessionId: AppSessionId, source: { kind: 'engine' } | { kind: 'bridge'; rpc: string }, on: boolean): void;
export function clearCompacting(appSessionId: AppSessionId): void;                 // a watch reset or ended, a bridge gone
export function useCompactingSince(appSessionId: AppSessionId | null): number | null;   // ms since the epoch, this window's clock
export function connectCompacting(): () => void;                                    // follows the sessions store's engine statuses

// view/compacting.ts (the transcript's; no app import)
export function compactingPlace(turnOpen: boolean): 'line' | 'end';                 // 'line' while a turn is open, else 'end' (Reported, 2)
```

`Transcript` gains the prop `compacting?: number | null`, which `TranscriptSlot` and `RemoteTranscriptSlot` give from `useCompactingSince`, and carries it in the context. `dividerHead` gains an optional `compactingMs?: number | null`: with a number and `state: 'working'` it returns the compaction words of §L. The row kind: `{ kind: 'activity'; activity: 'compacting'; since: string }`, id `activity:compacting`, `turnId: null`; `ESTIMATES.activity` is the divider's; `partOf` returns null; it is in no fold and asks no mod's site. The transitions are M4's table.

### §F. The web fetch helper (M5)

```ts
// src/shared/engine/web-fetch.ts
export const WEB_FETCH_TOOLS = ['WebFetch', 'mcp__web__fetch'] as const;
export function isWebFetch(toolName: string): boolean;
/** The page a web fetch asked for, or null. */
export function webFetchUrl(input: unknown): string | null;
```

The nine places that ask it: `model/classify.ts` (the web group), `model/caption.ts` (`web_fetch`), `model/cells.ts` (the `web` detail; the label's host), `model/copy.ts` (`cellLabel`, before its MCP test: "Fetched `<host>`"), `model/derive.ts` (the URL of the turn's used tools), `request-card/tools.ts` (`toolClass` gives `fetch`), `src/services/sessions/digest.ts` ("Fetching `<host>`"), `src/shared/attention/read-only-tools.ts` (`READ_ONLY_TOOLS` gains `mcp__web__fetch`).

### §G. A jump's options and the list's handle (M7)

```ts
// stores/transcript.ts
jumpTo(key: string, id: RowId | CellId, options?: { align?: JumpRequest['align']; turnId?: TurnId; focus?: false; gap?: number }): void;
// JumpRequest gains `keepFocus?: true` and `gap?: number`. With `keepFocus` the view scrolls and marks the jump handled
// without moving the focus; a jump re-resolved at a staged restart treats it as shown once it has scrolled. `gap` is the
// pixels kept above a row brought to `start`.

// view/Transcript.tsx
export interface TranscriptListHandle {
  // …today's four members; scrollToIndex gains an optional third parameter:
  scrollToIndex(index: number, align: 'start' | 'center' | 'end', gap?: number): void;   // with 'start', the row's top lands `gap` px under the top inset
  /** The index in the drawn list of the first row whose box reaches below the pane's top inset; -1 for an empty list. */
  firstVisibleIndex(): number;
  /** Scrolls so that the rectangle lies a third down the visible band when it is not wholly inside it; releases follow as scrollToIndex does. */
  reveal(target: Range | Element): void;
  /** Pixels at the pane's top that an overlay covers: a jump to `start` lands under them. */
  setTopInset(px: number): void;
}
```

With no gap and no inset `scrollToIndex` does what it does today, so the desk's landings do not move. The prompt chords jump with `align: 'start', gap: 20`. These are additions: the desk's uses of `TranscriptListHandle` compile unchanged.

### §H. What is stored or sent, against both builds (UC-14)

Neither landing stores anything, and one thing is newly sent.

| value | these landings | build F (`f1852de3a`) | build G (`2c7044231`) |
|---|---|---|---|
| on a `user.message` of origin `local-command`, the entry `{ class: 'command', run }` in `arrival`, from a host of this build to an app of another, and over the machine link | sent by landing 1 where the carrier named a run | its event schema has no `arrival`; its tolerant reader (`readTolerant`, `src/shared/ipc/tolerant.ts`) drops the key and keeps the event; the output draws as F draws it | its schema passes the entry through the loose member; `carriedOf` ignores it; the output draws as G draws it |
| the same event from a host of F or G to an app of this build | no entry | — | — |
| X1 events on disk | none are stored: the journal holds engine frames (`src/engine-host/journal.ts`) and the reading build's normaliser makes its own events. This build, then F or G, then this build on one profile leaves nothing different | reads the same frames and makes its own events | the same |
| `session.fork` with a `rewindTo`, over the link | sent by "Fork from here" only to a peer that lists `rl2.session-acts`; the command and its offer are U9's and on master | lists no such capability: nothing is sent, the button is disabled with U9's sentence | takes it: its row is master's |
| the session's status, the bridge's `compact` messages | read, as they are sent today; nothing added | — | — |
| the five action ids | rows of the table; never stored (no rebinding is offered for an id F does not know) | — | — |
| find's query, what it opened, a pane's last query; the compaction clock | the window's memory | — | — |

So the cross-build coverage table (`e2e/cross-build.spec.ts`, the comment table "A later landing that stores something new adds its row here") gains no row, and no cross-build run is owed ("Reported, 4"). The wire's manifest and `WIRE_MINOR` are untouched (Concrete Steps, 3).

### §I. The five rows, and which pane a key acts on (M7)

```ts
// src/shared/keymap/actions.ts
'transcript.find':           { title: 'Find in session…',        chord: 'Cmd+F',        sink: 'menu', menu: 'edit', submenu: 'Find', scope: 'app' },
'transcript.findNext':       { title: 'Find next',               chord: 'Cmd+G',        sink: 'menu', menu: 'edit', submenu: 'Find', scope: 'app' },
'transcript.findPrevious':   { title: 'Find previous',           chord: 'Cmd+Shift+G',  sink: 'menu', menu: 'edit', submenu: 'Find', scope: 'app' },
'transcript.previousPrompt': { title: 'Jump to previous prompt', chord: 'Cmd+Alt+Up',   sink: 'menu', menu: 'go',   scope: 'app' },
'transcript.nextPrompt':     { title: 'Jump to next prompt',     chord: 'Cmd+Alt+Down', sink: 'menu', menu: 'go',   scope: 'app' },

// transcript/keys.ts (the app's side; registered from connectTranscript)
/** The session pane a transcript key acts on now, or null (decision 21). */
export function sessionPaneForKeys(): PaneControls | null;

// view/pane-controls.ts (the transcript's side; no app import)
export interface PaneControls {
  readonly root: HTMLElement;                        // the mounted transcript's root
  prompt(direction: -1 | 1, from: 'transcript' | 'elsewhere'): void;
  find: { open(): void; step(direction: -1 | 1): void } | null;   // null until M10
}
export function registerPaneControls(controls: PaneControls): () => void;
export function paneControlsIn(pane: HTMLElement): PaneControls | null;   // the registered transcript inside that pane
```

A `Transcript` of `variant: 'session'` registers its controls while mounted; the desk's registers too and nothing ever asks. `sessionPaneForKeys` answers null when `document.hasFocus()` is false; when a modal dialog owns the focus (the test `shell-navigation.ts` uses, exported from there); when `document.activeElement` is inside `#region-panel`, `[data-region="cards"]` or `#region-page`; and when `focusedSession()` is null. Otherwise it answers `paneControlsIn` of the focused pane's element (`paneDomId` of the layout's focused pane). `from` is `'transcript'` when the active element is inside the controls' root or is the page itself, else `'elsewhere'`.

`model/navigation.ts` holds the two pure tests and the step:

```ts
export function isPromptStop(row: Row): boolean;      // decision 23
export function isMessageStop(row: Row): boolean;     // a prompt stop, or an assistant_text row of phase 'answer' or forHuman, not live
export function stepFrom(rows: readonly Row[], is: (row: Row) => boolean, from: number, direction: -1 | 1): number;   // an index, or -1 past either end
```

`RowFrame` sets `data-message=""` on a row for which `isMessageStop` holds; the arrows' handler reads that attribute and nothing else to know a message's wrapper.

### §J. Find's model (M8)

```ts
// model/find.ts (pure; imported only by the find chunk)
export function searchable(query: string): boolean;                 // longer than two characters, or holds Han, Hiragana, Katakana or Hangul
export function fold(text: string): { folded: string; at: Uint32Array };   // case and NFC folded; `at[i]` is the offset in `text` of folded character i
export function textOfMarkdown(markdown: string): string;           // the text the markdown draws, blocks and table cells parted by '\n'

export interface FindPart {
  target: RowId | CellId;       // what jumpTo is given
  text: string;                 // already the drawn text
  opens: string | null;         // a disclosure this part is wholly under, opened before the jump: 'line:<row id>', 'pasted:<row id>:<n>'
  clip: string | null;          // a disclosure that cuts this part while closed, opened only when the current match is cut off
                                // or not drawn: 'bubble:<row id>' for a bubble's text, 'line:<row id>' for a command's output
}
export function findPartsOf(row: Row): FindPart[];                   // a case for every Row kind, no default
export function matchesIn(part: FindPart, foldedQuery: string): { start: number; end: number }[];   // offsets in part.text, left to right, not overlapping
```

`findPartsOf`, kind by kind:

| kind | parts |
|---|---|
| `user` (a bubble) | one per text segment, through `textOfMarkdown`, with `clip: 'bubble:<row id>'`; one per pasted block, its text as it is, `opens: 'pasted:<row id>:<n>'`; a message of several comments, one per comment's text. The consent line: its sentence and subject |
| `assistant_text` | `textOfMarkdown(row.markdown)`; none while `live` |
| `to_human` | `textOfMarkdown(row.text)`; none while `pending` |
| `agent_message` | the line's words (`row.text`); then what the line opens onto (`messageMore(row)`), `opens: 'line:<row id>'` |
| `notice` | `noticeLine(row)`; then `row.detail`, `opens: 'line:<row id>'` |
| `local_command` | `row.text` as it is (the closed line draws it plain), with `clip: 'line:<row id>'` |
| `cell` (standalone) | `row.label`, `target` the cell's id; none for a cell whose detail is `thinking` |
| `group` | one per cell as for `cell`; nothing for the run's own caption |
| every other kind (`time`, `divider`, `thinking`, `plan`, `question`, `request_slot`, `ask`, `error`, `gap`, `boundary`, `bash`, `receipt`, `subagent`, `delivery`, `side_thread`, `agent_list`, `artifact`, `browser_action`, `browser_activity`, `owner_record`, `activity`, and U2b's `record_fold`) | none |

In `model/derive.ts`: `export function rowsWithEveryTurnOpen(state: TranscriptState, memo: TranscriptState['memo']): Row[]`, which is `rowsOf` over the given memo with every turn of `state.order` and of the hidden branches expanded; the store's `allExpandedRows` becomes a call of it with a fresh memo. Find keeps one memo per controller and searches the turns of `state.order` and the loose rows only: a row of a rewound branch is searched when its boundary is revealed, since `jumpTo` cannot show it otherwise.

### §K. Find's controller, bar and marks (M8, M10)

```ts
// view/find/controller.ts
export interface FindState {
  open: boolean;
  query: string;
  phase: 'idle' | 'indexing' | 'ready' | 'walking';
  total: number;             // matches in what is loaded
  current: number;           // 1-based; 0 when total is 0
  earlier: boolean;          // the source says older pages remain
}
export interface FindController {
  subscribe(listener: () => void): () => void;
  state(): FindState;
  open(): void;  close(): void;                    // close keeps the query as the pane's last
  setQuery(query: string): void;                   // debounced 250 ms inside
  step(direction: -1 | 1): void;                   // wraps; on a closed bar, opens it on the last query first
  searchEarlier(): void;  stopEarlier(): void;
  matchesOf(row: RowId): readonly { part: number; start: number; end: number; current: boolean }[];   // the same array until it changes
}
export function createFindController(deps: {
  storeKey: string;
  store: Pick<typeof useTranscriptStore, 'getState' | 'subscribe'>;
  disclosures: Disclosures;
  list: () => TranscriptListHandle | null;
  drawn: () => readonly Row[];                     // the mount's drawn list, for the first row in view
  pages: () => OlderPagesController | null;
}): FindController;
```

`Disclosures` gains `open(id)` and `close(id)`, each a no-op when already so. What the controller holds open for the current match is its own set: turns it expanded (through `toggleTurn`, only when the turn was closed), runs (`toggleGroup`), disclosures, and on a master with U2b stretches (`toggleStretch`). It drops an entry from the set when it sees that fold closed by someone else. `releaseHeld(next)` closes the entries the next match does not need.

Going to a match, in order: release what the last one held; open this one's disclosures; `jumpTo(key, target, { align: 'center', turnId, focus: false })`; when the row is mounted and its marks are registered, `list.reveal(currentRange)`; for a part with a `clip` whose current range is cut off by the closed fold or is not in the drawn row, open that disclosure and reveal again. A match that still has no range in the drawn row leaves the row centred.

`marks.ts`: `registerRowMarks(element, matches, parts, registry)` walks the row's text nodes, skipping any subtree marked `data-find-skip` (the action rows, the time, buttons), folds the drawn text with `fold`, finds the query, and adds `Range`s to the two highlights `transcript-find` and `transcript-find-current`; it returns a disposer and re-runs from a `MutationObserver` on that row only. The rules: `::highlight(transcript-find) { background-color: var(--accent-soft); }` and `::highlight(transcript-find-current) { background-color: var(--accent); color: var(--bg-raised); }`.

The bar's contract: `role="search"`, `aria-label` and placeholder from §L, `data-transcript-find`; the count is `role="status"`; it sets the list's top inset to its height while open. The lazy host in `Transcript.tsx` imports `view/find/index.ts` on the first `open()` or `step()` and not before.

### §L. The words

Every sentence a person reads that these landings add, as written. All live in `model/copy.ts` unless a place is named.

| where | words |
|---|---|
| a command's line | `⎿` then the output; `Show more`; `Show less`; alone: `⎿ /<command> · <output>` |
| the owner's message | the time (`formatClock`); `Copy`; `Edit`, with today's title "Edit here · Send rewinds this session to this message" |
| an answer | `Copy`; `Fork from here`, title "Starts a new session from this point. This one stays as it is."; the time |
| Fork disabled | U9's sentence, unchanged, from `useForkUnavailable` |
| a compaction | `Compacting session…`; with a figure, `Compacting session… <duration>` in the turn line's duration format |
| the hover card | `Compacting session…` |
| an agent ended with its session | `<names> ended with the session` |
| a web fetch by the plugin | `Fetched <host>`; in the digest `Fetching <host>` |
| the menu, the palette, the sheet | `Find in session…`, `Find next`, `Find previous`, `Jump to previous prompt`, `Jump to next prompt`; the submenu `Find` |
| the find bar | placeholder and label `Find in session…`; `<n> / <total> results`; `0 results`; tooltips `Previous match (⇧⌘G)`, `Next match (⌘G)`, `Close (Esc)`; `Search earlier messages`; `Searching earlier messages…` |

### §M. Insertions in files other children own (UC-8)

| file | owner | the insertion | milestone |
|---|---|---|---|
| `request-card/tools.ts` | U1 | `toolClass` asks `isWebFetch` before its table; one import | M5 |
| `src/shared/attention/read-only-tools.ts` | U1 | one name in `READ_ONLY_TOOLS`; with it `mcp__web__fetch` can be allowed in one click from a hover card or a notification, which U1 is told at landing | M5 |
| `model/classify.ts` | U2 | the web group's entry reads `WEB_FETCH_TOOLS` | M5 |
| `model/caption.ts` | U2 | the `web_fetch` case asks `isWebFetch` | M5 |
| `sidebar/HoverCard.tsx` | U7 | one line: the activity line reads the compaction words while `useCompactingSince` gives a number | M4 |
| `sessions/record-ops.ts` | U9 (the fork act) | `forkInPlace` gains an optional second parameter, passed through | M3 |
| `src/shared/keymap/actions.ts` | U6 | five rows | M7 |
| `src/main/menu.test.ts`, `settings-tab/keymap.test.ts` | U6 | expectations only: the real table's Edit menu now ends with Find ▸; the labels' order and the list of rows that take no rebinding gain the five | M7 |
| `keymap/shell-navigation.ts` | U6 | `modalOwnsFocus` is exported | M7 |
| `lane-a/watches.ts`, `lane-a/view/RemoteTranscriptSlot.tsx` | P5 O9's, no wave child | one call where `compact` messages are kept; the prop, the pager and the actions it hands its `Transcript` | M3, M4, M10 |

Not edited: `src/main/menu.ts`, `src/shared/keymap/build-f.ts`, `src/endpoint/offers.ts`, `src/shared/ipc/remote-unavailable.ts`, `lane-b/remote-unavailable.ts`, `src/main/browser/keys.ts`, `src/renderer/src/app/slots.ts`, `owner/`, `model/groups.ts`, `apps/desk-web`.

### §N. One reading of each fact

| the fact | the one function that decides it | who reads it today | what these landings do |
|---|---|---|---|
| what a row's text is for a copy | `partOf`, through `serializeRows` (`model/serialize.ts`) | nothing calls `serializeRows`; `copiedUserText` is the owner's bubble's | the answer's Copy calls `serializeRows`; the bubble's Copy is unchanged |
| what a row's text is for find | `findPartsOf` (`model/find.ts`), built from the readers copy already uses: `placeholdersOf` (the bubble's segments), `row.markdown`, `cell.label`, `noticeLine`, `messageMore` | none: new | one function; the marks search the DOM with the same `fold` |
| whether a command's output is one, and its run | `readArrivals` (`src/shared/engine/arrival.ts`) on the carrier; `commandRunOf` on the event | the three callers; `localCommandOutput` and `isLocalCommand` (`model/user-text.ts`) on the event's text | the reader gains `commandRun`; no second parser of the tags |
| whether a user row is a slash command | `slashCommandLine` (`@shared/wire/local-command`) | the backfill, `userTextOf`, `localCommandRow` | `lone` asks it |
| what a prompt of the owner's is | `isPromptStop` (`model/navigation.ts`) for the chords; `answerActionsOf` uses the narrower "turn-opening" test of §C | none: new | two named tests, stated side by side in §C and §I; no third |
| whether a message can be rewound to or edited | `userRow`'s `editable` (`model/derive.ts`) | `User.tsx` | unchanged; Fork reads `messageUuid` only |
| whether a fork can run now | `useForkUnavailable` (`lane-b/remote-unavailable.ts`) | the inline editor, the session menus, the fork widget, the slash palette | the answer's button, through `forkFrom` |
| which session the focused pane shows | `focusedSession()` (`composer/ComposerAppKeys.tsx`) | Stop, Focus, the three composer menus, the report toggle, the resubmit seam | `sessionPaneForKeys` |
| whether a dialog owns the focus | `modalOwnsFocus` (`keymap/shell-navigation.ts`) | region stepping | exported and asked by `sessionPaneForKeys` |
| whether a session compacts | `EngineSessionStatus.activity`, set in `src/engine-host/session-status.ts`; for a terminal session, the bridge's `compact` phases | nothing | `stores/compacting.ts`, the one place both are read |
| whether a call is a web fetch | `isWebFetch` | nine comparisons with `'WebFetch'` | each asks it |
| the rows with every turn open | `rowsWithEveryTurnOpen` (`model/derive.ts`) | the store's `allExpandedRows`, privately | both call it |
| how a turn line words itself | `dividerHead` (`model/copy.ts`) | the divider, and U2b's turn line | gains the compaction words |
| a duration's and a clock's format | `duration` (`model/time.ts`), `formatClock` (`@shared/app/date-format`) | the turn line; the owner's bubble | reused |

### §O. What a sibling reads from these landings, and what they consume

- **Exposed.** For U2b: the row kind `activity` (class it as a row that stays); `data-message` on a message's wrapper; `forkFrom` and `answerActions` in the context; that find opens a stretch through `jumpTo` and a head's through `toggleStretch`. For U1b: the `activity` row stands before the end row; find's bar is no dialog and is not portalled; a message row focused by a jump is not the end row, so the prompt's keys do not claim. For U1c: `User.tsx` keeps `ConsentLine`. For U8d: the agents row keeps its class and "started working". For U6b and U12: ⌘F, ⌘G, ⇧⌘G, ⌥⌘↑ and ⌥⌘↓ are taken as menu rows; a region that wants one handles the key itself (focus first).
- **Consumed.** From U3a: the reader's `command` class, the loose member of `ArrivalEntrySchema`, `jumpTo` and `ui.revealed`, the key `line:<row id>`. From U6a: the table's shape (`menu: 'edit'`, `submenu`), and that a new id takes no rebinding. From U9: `forkSession`, `forkInPlace`, `useForkUnavailable`, the offer of `session.fork` and its sentences. From U2a: `dividerHead` and the turn line's counts. From the long-transcript window and lane A: `OlderPagesController`. From U13a: nothing; the coverage table gains no row.

## Size, and the review each landing gets

Counted from the code at `63c97b5c0`: the files are the ones each milestone names, and the lines are estimates from the functions and the test blocks read, not from a diff.

| milestone | source | tests | scenes, fixtures and documents | files |
|---|---|---|---|---|
| M1 | about 230 lines in 12 files | about 430 in 11 | 8 row snapshots rewritten | 31 |
| M2 | about 180 in 2 | about 210 in 4 (one new) | — | 6 |
| M3 | about 310 in 10 (two new) | about 480 in 6 (two new) | — | 16 |
| M4 | about 300 in 17 (three new) | about 470 in 8 (two new) | — | 25 |
| M5 | about 110 in 13 (one new) | about 260 in 12 (one new) | — | 25 |
| M6 | — | — | about 500 in 3 specs and their fixtures; about 40 in 3 documents | 8 |
| **landing 1** | about 1,130 | about 1,850 | about 540 | about 70 distinct files, about 3,500 changed lines |
| M7 | about 330 in 11 (three new) | about 560 in 9 (three new) | — | 20 |
| M8 | about 520 in 5 (two new) | about 750 in 3 (two new) | — | 8 |
| M10 | about 430 in 9 (three new) | about 420 in 4 (three new) | — | 13 |
| M11 | — | — | about 530 in 3 specs and their fixtures; about 15 in 1 document | 6 |
| **landing 2** | about 1,280 | about 1,730 | about 625 | about 40 distinct files, about 3,600 changed lines |

**The e2e groups whose scenes cross this work** (the group's name in `package.json`; every one is a Mac run but `e2e:desk-web`):

| group | scenes that change, or are new | scenes crossed and expected unchanged |
|---|---|---|
| `e2e:transcript` | changed in M6: "a completed answer’s wide table and code break out to the wide measure, centred, and a narrow table keeps the text" becomes acceptance 5. New in M6: acceptance 1, 4, 6 and 7. New in M11: acceptance 16, 17, 18, 23 and 24 | the anchoring and follow scenes; "the streaming caret follows the last word of a one-paragraph answer"; "theme switch re-themes highlighted code without reload"; "a long token in prose wraps in a narrow transcript"; "M2 commentary uses answer typography…"; the R3 scene that reads the one `[data-kind="local_command"]` row; U2b's scenes that expect a jump's target focused |
| `e2e:c7` | changed in M6: "W2: the shared column, the 14px prose, Codex's bubble and Codex's composer box" (where the actions sit; the 16 px under the bubble stays) | "edit in place: Cancel and Esc put the bubble back…" and the U4a Stop scene (they hover and click Edit); "board 505…"; "sending while reading old work follows the new turn…" |
| `e2e:side` | changed in M6: scene 9, the comment row's actions inside the narrow card | the rest |
| `e2e:panel`, `e2e:agents`, `e2e:to-human`, `e2e:lane-a`, `e2e:remote` | none | every scene that scrolls a transcript or reads its rows (`e2e:lane-a`: the cut text is not an answer) |
| `e2e:desk-web` | none | `session-view.spec.ts`, "the jump to the latest row sits in a gutter clear of every row, wide tables and code included…"; `stream-scroll.spec.ts`; `acceptance.spec.ts` (its working line still reads "Working": the desk gives no compaction) |
| `e2e:code`, `e2e:browser`, `e2e:settings`, `e2e:document` (landing 2) | new in M11: acceptance 22's cases beside the file viewer, the browser's find bar and the Settings search | their own ⌘F and ⌘G scenes: the file viewer's search, "Find in page", the Settings search, the document's find |
| the default group | none | `e2e/shell.spec.ts` and `e2e/smoke.spec.ts` (menu items by id), `e2e/cross-build.spec.ts` |

**Measured bounds.** One is crossed: the anchoring scene's frame bound in `e2e/transcript.spec.ts` (p95 of the frame interval at most 17 ms, asserted only under `MAWS_TRANSCRIPT_PERF=1`), by landing 1's answer-row pass and by landing 2's changes to `RowFrame` and the list's handle. Both landings owe the measured run, base against landing (Proof, 5 and 11). No new time bound is asserted by any scene of this work.

**Each landing gets the xhigh panel** of `doperpowers:review-code`, on size: both are past twenty files and two thousand changed lines. Neither is named delicate by the root or the child.

*Landing 1's lenses.* (1) One reading: the `command` entry from each of the three callers to the row and to each older build, with no second parser of the tags and the wire untouched (§A, §H, §N). (2) Drawing with no layout test: the rules over Streamdown's markup, that they hold at the depth U2b adds, that the streaming caret's rules and the copy control still find their elements, and the desk's own bubble (decisions 7 to 10). (3) The answer-row rule against every shape of a list: engine turns, steers, the consent line, waiting and dropped messages, cut and live text, a list that ends in a running turn; and what it costs per change (§C). (4) The fork button: the sequence with its test held open, each of UC-7's states, what is sent against `isInPlaceFork`, and that authorisation is where the act runs (§D; "Routes"). (5) The compaction's table, transition by transition, the one that never ends included, and the clock (M4). (6) The insertions of §M, and the guards that read source text.

*Landing 2's lenses.* (1) The keys: the pane rule against focus-first, the spike's evidence, nothing stored (§I). (2) Find's bounds: what runs on a new row and on a keystroke, the memo against a rebuild and a staged restart, a generation that drops a stale pass (decision 29; M8's states). (3) Folds: each kind opens, what is held is released rightly, a reader's toggle is respected, U2b's stretches; what `revealed` does to a mod-drawn row (decision 28). (4) The marks: offsets where folding changes a string's length, ranges disposed when the virtualiser unmounts a row, no observer that feeds itself (§K). (5) The scroller: the handle's three additions change nothing of follow or anchoring; the measured scene (Proof, 11). (6) Focus: where it is after every key, how the arrows arm, a composing input method.

Each milestone's own review, at its boundary, reads that milestone's diff against its entry above.

## Surprises & Discoveries

- Observation (authoring, 1): the wire's own rule refuses the member U3a's decision 20 planned for `arrival`.
  Evidence: `src/shared/ipc/wire-manifest.json`, `…arrival.items.anyOf[0].oneOf` has five members; `classifyWireChange` in `src/shared/ipc/wire.ts` pushes a `SUBSCHEMA_LISTS` key whose arrays differ in length to `breaking`; `wire.test.ts`: "it takes a major … no minor can carry it". Decision 2; Reported, 1.
- Observation (authoring, 2): the turn line the child places "at the transcript's end" is at the head of the turn's work.
  Evidence: `deriveTurn` builds `[...above, user, divider, ...rows]` (`model/derive.ts`). Reported, 2; card 2.
- Observation (authoring, 3): the transcript file carries the command the engine ran, which the child's text and U3a's document did not know.
  Evidence: `fixtures/uxwave/u3-commands-r1.transcript.jsonl` line 55, `"commandRun":{"command":"usage","args":""}`; the bundle maps `local_command_run` to `commandRun` (`cli.pretty.js:237738`). Decision 2.
- Observation (authoring, 4): two places name `WebFetch` that the child's list does not: `model/caption.ts` (built by U2a after the child was written) and the label's host in `model/cells.ts`.
  Evidence: `git grep -n "WebFetch" -- src apps`. §F.
- Observation (authoring, 5): Claude Desktop's find counts on the text its markdown draws, holds a fold open only for the current match, and its code block's toolbar can hold a language label and reserves room on two lines only.
  Evidence: "The reference". Decisions 27 and 28; Reported, 6, 7 and 10.
- Observation (authoring, 6): in the desk, the owner's message draws an Edit button that does nothing, today: its mount registers no `editAndResubmit`, the default is a no-op, and `editable` is true for a turn's opening message.
  Evidence: `apps/desk-web/src/depth/view/actions.ts` (`DESK_ACTIONS`); `NO_ACTIONS` in `view/context.tsx`. Not fixed here (the desk is outside the wave); one tracker row (M6).
- Observation (authoring, 7): the code's comments say two things about whether a page keeps a key from the menu, and no scene can settle it.
  Evidence: the header of `src/shared/keymap/actions.ts` and `src/main/menu.ts` ("A page that cancels ⌘Z … keeps the key from the menu") against `src/main/settings/capture-chords.ts` ("the application menu takes its key equivalents … before the page sees them") and the `file.save` row's comment; `e2e/support/menu.ts` (a scene's keys never reach the menu). Decision 22; Probes, 1; Reported, 11.
- Observation (authoring, 8): X1 events are not stored anywhere; master's wire is two minors past build G's.
  Evidence: `src/engine-host/journal.ts` (rows of engine frames); `WIRE_MINOR` 48 at the pin, 46 at `2c7044231`, 33 at `f1852de3a`. §H; Reported, 4.
- Observation (authoring, 9): the desk's chat bubble copies the owner's row's markup by hand and is styled by the transcript's stylesheet, so a rule moved there moves the desk with no type error.
  Evidence: `apps/desk-web/src/views/conversation/Bubble.tsx`; `apps/desk-web/src/styles/app.css` (the rule for `.transcript-user-actions` of the other side). Decision 10.
- Observation (authoring, 10): the engine repeats the `compacting` status every thirty seconds, and a status with a null `status` also arrives for a mode change.
  Evidence: Engine facts, 2 and 5. Decision 16 (the clock is not restarted); a mode change in the middle of a compaction would clear the words until the next repeat, at most thirty seconds, and restart the clock: left as it is, one tracker row (M6).

## Decision Log

- Decision: the verification this work gets. This document gets an adversarial review before an executor starts, arranged by the architect, and a re-check of "The statements to read again" against master as the branches in flight land. Each milestone is reviewed at its boundary. Each landing's branch gets the xhigh panel of `doperpowers:review-code` with the lenses of "Size, and the review each landing gets", on size. Class 1a on GitHub Actions (`static`, `unit`, `probes`) is the gate of record for each. The Electron scenes, the measured anchoring scene, the keys' routing spike and the owner's look are "Proof that an executor does not run". Each pull request's body names its class 1a run, its review verdict and its residue; landing 1's carries the dated amendments of O-08, O-02 and X1.
  Rationale: the common brief's record; the sizes counted above.
  Date/Author: 2026-11-15, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
