# UX wave · U2a · tool runs, thinking and the turn's line (2026-11-13)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U2**, first landing (**U2a**), parent pin `14db1aedbab6b5d555eeb97a5fa80ff5dd8cdbc6`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U2-transcript-structure.md`: the items O-29 (with O-26), O-27 (with O-25), #479, O-15, l2-transcript-04, #351 (deferred), l6-artifacts-12 and O-49; acceptance A1 to A11 and A17, and of A18 the routes MAWS draws; Contracts UC-1, UC-2 and UC-3 as consumed and X1's amendment; Design inheritance; "Probes and checks" 3, 4, 6, 8 and 9; under "Rulings reversed" the rows O-29 (three), O-27, #479 and l6-artifacts-12. In the root: Purpose, the wave's laws, UC-1, UC-2, UC-3, UC-8, UC-10, UC-11, UC-14, "Ordering and dependency map", and in the Decision Log "The thought rule tests duration, not text", "Amended: a run is not opened for a waiting call", "Two answers taken from the drawn example" and "Rulings reversed". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the cut of the child into two landings, what the code at the branch's head needs, the decisions the section left open, the names siblings and the second landing build on, and the execution. **Branch:** `ux-wave/U2`, from master `5c9cfa0c5`. **Board:** #587 (the wave's epic is #573). The second landing (U2b, the to-human view) has no branch and no ticket yet; both are the architect's to open, and so is whether this file and this branch take the suffix `a` (UC-10 gives one to a child with several pull requests; both keep the names the dispatch gave them until then).

## Purpose

After this landing a long turn stops being a wall of rows, on every route by which a session reaches the window.

- Two or more tool calls in a row are one line that says what they did, in Claude Desktop's words: `Read 2 files, edited a file, ran 3 commands (1 failed), searched code +12 −3`. The line is folded while the turn runs and after it. While a call runs the line reads that call; while a call waits for the person's permission it reads `Waiting for approval: …` in the warning tone. A click opens the line onto the rows drawn today, and another closes it.
- Opened, a run shows a thought of ten seconds or more at the place it happened, as the muted `Thought for 12s` line a thought already is, with its text behind the chevron when it has text. "Internal activity" is gone. The time is the engine's own record, so it is the same live, after a restart and in a terminal session.
- A thought in progress reads its tier, the effort and the time (`Still thinking with high effort · 14s`) for as long as it runs; the summary no longer takes the label's place and is read by opening the line.
- A closed turn's line says what the turn did: `Worked for 3m 12s · Edited 2 files, ran 2 agents, ran 5 commands +33 −5`. "N tool calls" is gone. A turn in which nothing was done has no line.
- An artifact call names its artifact (`Edited ‹Q3 memo›`), a failed call carries the first line of its error, and a shell call with no description reads a short form of its command instead of `Ran Bash`.

How to see it working: the unit suites named in each milestone, run on the build VM over recorded sessions (`spikes/protocol-probe/fixtures/`), draw the same runs from a session's live wire, from its transcript file and from the rows another machine serves; the harness scenes of `e2e/transcript.spec.ts` show the fold, the opened run and the turn's line in the real window (the architect's run); the owner's sitting follows the scenes in "Proof that an executor does not run".

The to-human view (the report bar, "Working record", "To you", the advertisement) is not changed by this landing. It is the second landing's.

## Progress

- [ ] The re-check pass: every statement of "To check again once U3a and U1a are on master", by this document's author, on a master that holds both. No executor starts before it.
- [ ] M1 — The engine's recorded duration of a thought, on every route (X1).
- [ ] M2 — What joins a run, its caption, and the turn's line.
- [ ] M3 — What a row reads: a shell call with no description, an artifact call, a failed call.
- [ ] M4 — The run's row: one line, folded; thoughts in order; the running, the waiting and the thinking line.
- [ ] M5 — The e2e edits and scenes, the routes' proof whole, the record, and the acceptance run.

## One pull request or two

**Two.** The child's file does not cut the child; this document does, and the architect rules on it (Reported, 1).

| part of U2 | this landing (U2a) | the second landing (U2b) |
|---|---|---|
| O-29 (O-26), O-27 (O-25), #479, O-15, l2-transcript-04, l6-artifacts-12, O-49 | in full | consumes their rows (Interfaces §J) |
| #351 | deferred by the section; this landing adds the tracker row and nothing else (M5) | nothing |
| X1's optional number | in full (M1) | nothing |
| O-13 (O-06, l2-transcript-06), O-30, #332 | nothing | in full |
| UC-13: the advertisement 8 → 9, `drawnBy` | nothing: every launch still advertises 8 | in full, in the one change that removes MAWS's own report for sessions it runs |
| Acceptance | A1 to A11, A17; A18 where MAWS draws the plain transcript | A12 to A16; A18 on the mirror and where the mod draws (check 5) |
| Probes and checks | 3 and 4 (the fixture and the rule); 6, 8 and 9 are done | 1 (before any MAWS code depends on the mod's answers), 5, 7 |
| Rulings reversed, recorded in the pull request | O-29 (three rows), O-27, #479, l6-artifacts-12; X1's dated line | O-30 and O-06, O-13 |
| The mod's pull request (doperpowers) | not needed | prepared beside it; gates nothing (Interfaces §K) |

Why two. (1) *Size.* Together the two halves change about seventy files and, by this document's estimate, more than five thousand lines outside the regenerated snapshots, in the surface the owner reads most; no reviewer holds that in one pass. (2) *Two ways of proving.* This half is proved by drawing recorded sessions through three routes and comparing rows. The other half is proved by what a mod answers on a live surface, by combinations of MAWS and mod versions, and by a probe that spends model calls (check 1), which the section puts before any MAWS code that depends on it. (3) *The cutover is not split.* UC-13 binds the raise to 9 to the change that removes MAWS's own drawing; both are wholly in U2b. (4) *Order is natural.* The mirror of U2b is a function over the rows this landing leaves; this landing reads nothing of U2b's. (5) *Blockers differ.* This half needs U3a's `opener` and U1a's predicate. The other half also needs U3a's last milestones (`revealed`, the arrival rows' asks), U4a on master (the switch's mount is in U4's `composer/Composer.tsx`) and check 1.

What the tree is between the two landings: the plain transcript is final. The report (lane on, the default view) is still today's per-turn projection with its bar; an opened working record shows this landing's turn line and collapsed runs. Its closed row still reads "Working record · N tool calls · M messages": that row goes with U2b (O-30), so this landing keeps `toolCalls` on the divider row's data and changes only what a turn's line says. Nothing lands on the owner's machines between the two without the owner's word (UC-10), and the child is accepted as a whole.

## To check again once U3a and U1a are on master

The one list. Each statement was read on the branch or in the document named, not on master. The pass confirms each on master or corrects this document where it points.

| # | statement | read in | this document relies on it in |
|---|---|---|---|
| C1 | The divider row carries `opener?: { class: Arrival['class']; line: string }` (`transcript/model/rows.ts`, `schema.ts`), set in `deriveTurn` only for a turn whose `origin` is not `human` and whose head row is an `agent_message` or a `notice`. | `origin/ux-wave/U3a` at `ebe9b897f` (M2, built, not yet reviewed) | M2's verb rule; Interfaces §H |
| C2 | A turn the answer to an asynchronous question opened has `origin: 'engine'` and `opener.class === 'answer'` (the reader's `turnOriginOf` gives `human` only for `own` and `consent`, `peer` for `peer`, `engine` for the rest; the answer draws a `notice` row at the turn's head). | the same; `src/shared/engine/arrival.ts` | M2: the one override of the verb |
| C3 | After U3a's M3 and M4 a subagent's hand-back gives its turn the engine's origin on all three callers, so `Peer session worked for` is left to a turn a peer's message opened. M3 and M4 were not built when this was written. | U3a's document, Purpose and Interfaces G | M2 adds no re-labelling of its own; acceptance 8 |
| C4 | An engine turn that held nothing is removed in the reducer (`heldNothing`, `Batch.discard`), so no route leaves a turn to draw for the undelivered task notification or the owner's own send. | `origin/ux-wave/U3a`, `transcript/model/reduce.ts` | M2: this landing's rule is the drawing only |
| C5 | In `deriveTurn` the divider is made when `workRows.length > 0 \|\| turn.origin !== 'human' \|\| (turn.accepted && (turn.state === 'open' \|\| dividerState === 'stopped'))`; a schedule's notice and a task's notice with an outcome stand above the divider, every other arrival is the first row under it and folds with the turn. | `origin/ux-wave/U3a`, `derive.ts` | M2 removes the middle clause |
| C6 | Arrival rows (`agent_message`, `notice`) reach `groupItems` as rows, so each ends a run. | the same | M2; acceptance 1 |
| C7 | `test/support/fixtures.ts` exports `loadUxwaveJournal(name)` and `loadUxwaveTranscript(name)`. U3a's M3 and M4 add `src/renderer/src/transcript/model/arrival-routes.test.ts`; if it exports helpers that draw one recording by each route, `run-routes.test.ts` uses them and adds none. | `origin/ux-wave/U3a` (the loaders built; the test not) | Interfaces §F |
| C8 | `selectWaitingByCall(state, appSessionId): ReadonlyMap<ToolUseId, AttentionItem>` in `src/renderer/src/stores/attention.ts`, memoised per list; it holds an item only while `waitsOnAnswer` holds; a terminal request whose bridge gave no call id is in the map under its request id, which no row has. | U1a's document, §A (no code built) | M4; Interfaces §E |
| C9 | The words "Waiting for approval" are in neither U1a's document nor master: the call row's waiting state is U1b's (l4-approvals-04). If U1b has landed and defined the words, this landing reads them from there and adds none. | U1a's document, the edge table | Reported, 2; Interfaces §E |
| C10 | `ATTENTION_HEADINGS.permission` is `{ char: '◐', tone: 'warning', … }` (`src/shared/attention/headings.ts`) and U1a leaves it. | master `5c9cfa0c5`; U1a's document | M4: the waiting line's glyph and tone |
| C11 | While a permission request waits, its `request_slot` row is still made inside the turn at the request's place (`deriveTurn`, the `permission.requested` case), so it stands after the run that holds the call. U1b moves the prompt to the card at the transcript's end. | master `5c9cfa0c5` | M4; Reported, 9 |
| C12 | `WIRE_MINOR` on master. U3a took 37 on its branch and so did U5a; U1a, U4a and U8b each raise it too. | the branches | Concrete Steps, 3 |
| C13 | U3a's M5 adds the arrival rows' asks in `transcript/surface/Rows.tsx` and `adapters.ts` and `TranscriptUi.revealed`; none was built. M4's one edit in `adapters.ts` (`groupInput`) is merged with them. | U3a's document, M5 and Interfaces F | M4; Interfaces §I |
| C14 | Which snapshot files and which scenes of `e2e/transcript.spec.ts` U3a moved; the line numbers this document gives for that spec are master's. | — | M5; Concrete Steps, 4 |

## Words used here

A **run** is the section's tool run; in code it is the `group` row (`transcript/model/groups.ts`). Its **line** is the one line a folded run draws; its **caption** is what that line reads when no call of it runs or waits. The **turn's line** is the `divider` row. A **thought** is one thinking block; a **thought line** is how `view/rows/Thinking.tsx` draws one. A **step** is one thing a caption counts: a call, an agent, a sent message. **Recorded duration** is the number the engine writes for a thought (`thinking_duration_ms` on the wire, `thinkingDurationMs` in the transcript file). The three **routes** are the root's law 5: a session MAWS runs (lane B), a terminal session (lane A), a session on another machine. **Build F** is `f1852de3a`. **The VM** is the wave's build VM, reached with `~/.local/share/maws-ux-wave/tools/vmcheck.sh`.

## Today, at `5c9cfa0c5`

Read in the worktree. Between build F and this master none of the files below differs (`git diff --stat f1852de3a 5c9cfa0c5` over them is empty), so "what F does" is what this code does.

- **A run is modelled and drawn flat.** `groupItems` (`transcript/model/groups.ts`) folds a turn's work items into `group` rows whose `cells` are in event order, thoughts among them as cells (`thinkingCell`, `toolName: 'thinking'`, classed `hidden`). `expanded` already defaults to false (`ui.expandedGroups`), and a jump to a cell already adds its run to that set (`jump` in `stores/transcript.ts`). The view ignores the fold for calls: `view/rows/Group.tsx` draws every visible cell under `row.summary` and puts the hidden cells (thoughts and bookkeeping calls) after them behind one button labelled `Internal activity`, in `.transcript-group-cells`. No test asserts that string.
- **What stands alone.** `classifyTool` makes a call ungroupable when it was denied, when its result is an image, and when `humanDecision` holds (a `permission.resolved` by `user` was seen). That last fact exists only on the live route: a transcript file does not say who allowed a call, so today the same session groups differently live and from its file. The `maws` server's plain artifact calls are `standalone('other')` in `TABLE`; the bookkeeping tools are `grouped('other', true)`.
- **An active run of one call is a group; a finished one is the call's row** (`flush` in `groupItems`: "an active group never unwraps").
- **The caption.** `groupSummary(phrasesOf(cells))` in `copy.ts`, in a fixed category order (X3). `activeGroupLabel` and the row's `activeLabel` are computed and read by no view. `mergeReads` is defined and no longer called; the `cell:reads:` branches that remain read a shape nothing produces.
- **A label is partly the view's.** `cell.label` is the model's (`cellLabel`), but `CellLine.tsx`'s `Label` rewrites it for a shell call (the description inflected by `descriptionLabel`, else the verb and the tool's name: `Ran Bash`) and for `Skill` (`Ran /name`). So "what the row reads" is not one string in the model today.
- **Thoughts.** `blockRow` (`derive.ts`) drops a finished thinking block with no text (W1) and measures a duration only for a block that streamed (`completedAt` less the first delta's time); a block read from a file has `durationMs: null` and reads `Thought`. Nothing in `src/` reads `thinking_duration_ms` or `thinkingDurationMs`. The engine writes both: on the `assistant` frame that holds the block and on the transcript row (fixtures `spikes/protocol-probe/fixtures/pass3/uxwave/uxwave-thinking-*.jsonl`; `uxwave/u3-cron-r1.jsonl` and its `.transcript.jsonl` carry one thought of 10,192 ms before a run of two calls). `AssistantFrameSchema` and the transcript record are loose objects, so both readers can see the key.
- **The live label.** `LiveThinkingLabel` (`view/rows/ThinkingLabel.tsx`) shows the latest line of the block's text when it has one, else `liveThinkingLabel(elapsedMs, effort)`.
- **The turn's line.** `dividerCopy` reads `Worked for 2m 14s · 12 tool calls · 1 denied`; the popover's text (`turnSummaryCopy`) derives the turn again to phrase it (`turnPhrases`, mounted only while the popover is open). A turn the person did not start always has a line (`turn.origin !== 'human'` in `deriveTurn`'s condition).
- **The three routes meet in two functions.** The live wire and a journal read back go through `Normalizer.assistant` (`src/engine-host/normalizer.ts`); a transcript file (a reload past the journal, a terminal session on this Mac, and the rows of a terminal session on another machine, mapped in this window by `eventsOf` in `lane-a/plane-transcript.ts`) goes through `assistantEvents` (`src/engine-host/fs/backfill.ts`, `recordToEvents`). A session MAWS runs on another machine arrives as the events that machine's engine host made.
- **The wire.** `WIRE_MINOR` is 36 (33 at build F). X1's events are strict objects; a peer of another build reads them with `readTolerant` (`src/shared/ipc/tolerant.ts`), which drops a key it does not know and keeps the event. The journal keeps the engine's raw frames, not X1 events; nothing stores an X1 event on disk.
- **The mods' site.** `SurfaceGroupRow` (`transcript/surface/Rows.tsx`) asks `ToolGroup` beside MAWS's group (`drawingOnly`) and `groupInput` (`adapters.ts`) always sends `isExpanded: false`; it sends nothing while a pending request names one of the run's calls.
- **The desk web app draws the same rows.** `apps/desk-web/src/depth/view/TranscriptPane.tsx` mounts the renderer's `Transcript` and `lane-a/view/drawn-rows.ts`; two of its e2e scenes pin today's group (`apps/desk-web/e2e/stream-scroll.spec.ts`, which presses `.transcript-group-header` and scrolls `.transcript-group-cells`; `phone.spec.ts`, which expects `.transcript-tool-block` in an opened record).
- **What is measured.** "Cost on a long transcript" lists it.
- **Tests that pin today's behaviour and change here:** `transcript/model/derive.test.ts`, `classify.test.ts`, `copy.test.ts`, `thinking-duration.test.ts`, `reduce.test.ts` (the peer line; the standalone allowed call), `fixtures.test.ts`, `journals.test.ts`, `disk.test.ts`, `to-human.test.ts` and `revisions.test.ts` (callers of `turnPhrases`), `serialize.test.ts`, `snapshots.test.ts` and its 216 files under `test/snapshots/transcript/`; `transcript/view/rows/work.test.tsx`, `tool-rows.test.tsx`, `rows.test.tsx`, `transcript-parity.test.tsx`, `Divider.test.tsx`, `view/cells/cells.test.tsx`, `view/Transcript.test.tsx`; `transcript/surface/rows.test.tsx`, `adapters.test.ts`, `fixtures.test.ts`, `assistant-ink.test.tsx`; under `owner/` only the two expectations that read an opened record's turn line (`report/report-view.test.tsx`, `to-human/MessageRow.test.tsx`). `view/Transcript-scroll.test.tsx` and `view/rows/User.test.tsx` pass unedited (acceptance 12).

## Decisions settled at authoring

Each is a means the section leaves open. The ones a reader of the transcript would see differently are also under "Reported to the architect", each with the one place a ruling changes.

1. **The recorded duration rides the finished block's event under the file's own name**, `thinkingDurationMs` (Interfaces §A). A producer sets it only on a `thinking` block, only from a finite number that is not negative, and only when the frame or the record holds exactly one thinking block (the engine writes one number per frame; with two blocks it would be a guess). Lost: a separate event, which every reader of the block would have to join.
2. **A thought's time is the recorded one where there is one, and the measured one only for a block that streamed on a build that sent none** (the section's X1 line). A block with neither has no time, as today.
3. **No run opens by itself.** The section asks this document to read Desktop's rows renderer before the default is built. Its group starts open in four cases (`web/app/v1/c96d752d0-CjYhuD9j.js:73934-73964`): a failed `add_repo` call; a group that holds a row its own open-state store already marks open (a reader's or a jump's doing); a group of at most eight calls one of which opens a card of its own (its memory-store cards); and, only behind a flag, a group of at most eight calls with a failed or policy-denied one. The first and third name tools the engine does not send to MAWS, the fourth is gated, and the second is MAWS's jump, which already opens the run. So every run starts folded, a run with a failed call included; its caption says `(1 failed)`.
4. **The state machine keeps its shape.** A run exists from its second call. An active run of one call stays a `group` row, as today, and so draws as a line reading that call; if the turn's work ends with that one call it becomes the call's row, as today. The other choice (the call's row until a second call arrives, then a line) moves the reader's eye in the common case, a run that grows. One thing changes: a run's row id is made from its first call (`rowId.group` of that cell), no longer from a thought that leads it, because a leading thought with no text travels on one host and not on an older one (M4), and a run's id must not differ by route; the site's `instanceId` is already made that way.
5. **One source for what a row reads.** `Skill`'s `Ran /name` moves from the view into `cellLabel`, and the shell label is one exported function the row and the run's line both call, so a caption part made from "its row's label" and a line that "reads that call" cannot differ from the row.
6. **"Lowercased" lowers the first letter only.** The section's own examples keep a title's and a file's capitals (`edited ‹Q3 memo› 12 times`, `Read and edited copy.ts`).
7. **A part counts distinct keys, as Desktop's builder does** (`web/app/v1/c24951e9f-DKQNorfR.js`, its per-category maps): the file's path for the file parts, the recipient for the two message parts, the agent for the agent part, the call itself for everything else. So three messages to one session read `messaged another session`. The section's sentence "everything else is counted by call" holds for every part a run can have.
8. **A turn's steps** are every call of the turn that was not denied (the calls of its runs, its single calls, and the calls drawn as rows of their own that are cells: an image result, the pane-opening call, the computer-use call), each agent of its subagent rows, and each sent message (`agent_message` rows to a subagent or to another session). Denied calls stay in the `· N denied` count. Thoughts, arrivals and questions are not steps.
9. **The turn's caption is computed once, in the turn's derivation, and only for a turn that is not running.** It rides the divider row; no component derives a turn to phrase it, and `turnPhrases` goes. (`assistant-ink.test.tsx` pins that live token batches derive no folded turn.)
10. **`hidden` leaves the classification.** Nothing is hidden inside a run, so the field, its CSS (`data-bookkeeping`) and its readers go; C6's X3 table is amended by the dated line the section gives.
11. **A thought merges before it is tested, and what a merged line sums is the recorded durations of its members.** A live thought counts as live only in an active run; a block left unfinished in a closed turn is a thought with no time.
12. **Inside a run the thought line has 6 px above and below.** The section fixes that the two are equal and leaves the number; 6 px is the run's own bottom rhythm (`.transcript-group`). The label's start is fixed by keeping the chevron's box (12 px and the 7 px gap) empty on a line with nothing to open, in every place the component draws.
13. **The reason of a failed call is a field of the cell** (`error`, the first non-empty line of the result's text with the engine's refusal tags stripped), drawn muted after the label; the two artifact labels that carry the error inside their words today (`listFailed`, `screenshotFailed`) give it up to that field.
14. **A failed artifact call reads `Could not …`**, the form `ARTIFACT_CELL` already uses, and counts in its caption part under the done form's words, so `edited ‹Q3 memo› 12 times (2 failed)` is one part.
15. **The subagent's own transcript is not filled from its file while it runs** (the section asks this document to say). Its forwarded thoughts carry no time, so its runs show no thought lines until it is read from its file. Filling would merge two forms of one history in a live view for a line most readers never open; the tracker gains the row (M5).
16. **The waiting line's session is the row's** (`useRowSession`), so a subagent's own transcript reads its own waiting call; a transcript with no session reads none.
17. **One wording stays open with the owner and has one place.** The words of the live thinking label by elapsed time are `THINKING_TIERS` and `liveThinkingLabel` in `transcript/model/copy.ts`, unchanged by this landing; no other file holds a tier's words and no view test spells one (they call the function), so the owner's answer changes that table and `copy.test.ts`.

## Reported to the architect

Each has the evidence, this document's default, and the one place a ruling changes.

1. **Two landings.** Above. If ruled one: this document becomes the first five milestones of a longer one and U2b's milestones follow M4; nothing in M1 to M4 changes.
2. **Who words "Waiting for approval".** UC-3 gives the waiting state of a call's row to U1; U1a's document leaves l4-approvals-04 to U1b and holds no such string (C9). A3 needs the words in this landing. Default: this landing defines `waitingLabel(cell)` in `transcript/model/copy.ts` with the section's three forms and uses it for the run's line only; the call's own row keeps today's label until U1b calls the same function for it. Place: that one function.
3. **The desk web app is not untouched.** The section says it keeps compiling and is otherwise left alone. Its session view mounts the renderer's `Transcript`, so the run's row changes there too, and two of its e2e scenes fail on the new row (Today). Default: as U3a does for its part, this landing edits those scenes' expectations only (`stream-scroll.spec.ts`, `phone.spec.ts`), changes no file under `apps/desk-web/src/`, and deploys nothing. Place: M5's list of e2e edits.
4. **Where an artifact's title comes from.** The section says "from the library". The label and the caption are built in the pure model (`edited ‹Q3 memo› 12 times` is a caption part), which cannot read the library; giving it a lookup means a state field fed like `agents` (`withAgents`), an edit in `stores/transcript.ts` (U9's file, an insertion the section does not name) and an awaited read per artifact. Default: the title is the one a result in the loaded transcript gave for that artifact (`artifact_create`, `artifact_read`, `artifact_publish`, `artifact_list`, `artifact_search` and `artifact_screenshot` answer with it; an agent that edits a document has read it), else the handle or id the call gave. It is the same on every route, which a library read is not. Place: `artifactTitleOf` (Interfaces §D); a ruling for the library adds one source after the first.
5. **The marks around a title.** The section writes `Edited ‹Q3 memo›` and `Edited ‹title› 12 times`. Default: the marks are drawn, `‹` and `›`, so a title ending in a number is not read into the count. Place: `ARTIFACT_TITLE` in `copy.ts`.
6. **A18's bound.** The section compares against "the render-path bound the P5 phase recorded". No P5 document records a bound on mounted rows; what exists is OX7's delta-to-frame bench (text deltas only), the anchoring scene's `domRows <= 40`, and the derivation budget (Cost). Default: A18 is read against those three. Place: acceptance 13.
7. **Line counts on a running turn's line.** The section: `Working for 1m 12s` with no caption. The drawn example draws the turn's line counts beside it. Default: none while the turn runs (its runs carry them). Place: `dividerCopy`'s caller in `Divider.tsx`.
8. **Which running call the line reads.** The section says "the running call". A command the engine moved to the background stays `running` for minutes while later calls run and end (and, after U4a's decision 33, past its turn's end). Default: a call running in the background never takes the line and does not hold back the line counts; among the others the last started takes it. Place: `runLine` (Interfaces §C).
9. **A waiting prompt before U1b.** A4's "card at the transcript's end" is U1b's. On a master with U1a only, the prompt is still docked at the composer and its `request_slot` row stands after the run that holds the call (C11). The run's line and its fold behave as A3 and A4 say on either master; the scene that shows the card is U1b's.
10. **A turn nobody announced.** With the middle clause gone (C5), an engine's turn that only answers, and whose arrival has no line on that route (U3's O-28: a monitor's event on the live wire), is an answer under the previous turn with no line. The section accepts this ("the arrival's line already names a turn the person did not start"); it is written here because it is the visible cost.
11. **The words of the artifact rows beyond the section's four examples** (Interfaces §D's table) are this document's, in the same pattern.
12. For U2b's author: the mod's main is at 0.7.3, not 0.7.2; the section's list of tests names a desk `report-stream.test.ts` that does not exist (the file of that name is `src/renderer/src/lane-a/view/report-stream.test.ts`; the desk's own are `apps/desk-web/src/views/project/ReportToggle.test.tsx` and its e2e); `e2e/to-human-live.spec.ts` always skips.

## Acceptance

The section's items, as this landing proves them. "Unit" runs on the VM (Concrete Steps); "e2e" and "sitting" are the architect's (Proof that an executor does not run).

1. **One line for a run, on every route** (A1). In a turn with two or more consecutive tool calls and no text between them the transcript draws one line, while the turn runs and after it. A click opens it onto the calls' rows in order; a click on a row opens its input and output; a click on the line closes it. Unit: `run-routes.test.ts` draws `u3-tasks-r1`, `u3-tasks-r2` and `u3-cron-r1` by each route and finds the same runs with the same captions and the same rows; `work.test.tsx` the clicks. E2e: the scene "a run folds, opens onto its rows, and folds again".
2. **The caption** (A2). Unit, `caption.test.ts`: two reads of different files, one edit, three commands of which one failed, and one search read exactly `Read 2 files, edited a file, ran 3 commands (1 failed), searched code`, and the run's row carries the edit's `+N −N`; five kinds read the first three and `and N more actions`, N being the calls left out.
3. **What the line reads while the turn runs** (A3). Unit, `runLine` and `work.test.tsx`: a foreground call running, its running label; none running, the caption so far; a call with a waiting permission request, `Waiting for approval: …` with `◐` in the warning tone and no spinner, timer or line counts; at the answer, the running label or the caption again; a streaming thought, the live label on its own line under the run's line.
4. **A request neither opens nor closes a run** (A4). Unit: with a waiting request on a call of a folded run, `expanded` stays false and the line's click toggles it; on an opened run it stays true. The same sequence held open in the test: request, the reader's click, answer.
5. **Thoughts in order, in the thought's own shape** (A5). Unit, `runSegments` and `rows.test.tsx`: an opened run draws each thought line between the two blocks of calls it fell between, by the component that draws a thought outside a run; no two thought lines are adjacent. `git grep -n "Internal activity" -- src apps e2e test` prints nothing.
6. **The ten-second rule, on the engine's number** (A6). Unit: over `u3-cron-r1` the run of two calls opens to one `Thought for 10s` line with its text behind it, by each route; over a recording whose thoughts are shorter no line is added; a thought with no text is treated the same and its line has nothing to open; a thought with no recorded duration that did not stream gets no line.
7. **The turn's line** (A7). Unit, `copy.test.ts` and `Divider.test.tsx`: `Worked for 3m 12s · Edited 2 files, ran 2 agents, ran 5 commands +33 −5`, the parts for changed files first, then agents, then the rest; no turn line and no popover contains "tool calls"; the popover lists every part.
8. **The verb** (A8). Unit: a turn a subagent's hand-back opened reads `Continued for …` by each route; a peer's message, `Peer session worked for …`; the answer to an asynchronous question, `Worked for …`; a turn with nothing under it has no line.
9. **#351 draws nothing** (A9). The conformance pins of `memory_recall`, `permission_check_status` and `dev_intent` in `src/engine-host/` pass unedited.
10. **An artifact edited twelve times** (A10). Unit: twelve consecutive `artifact_edit` calls on one document are one run, `Edited ‹title› 12 times`, `(2 failed)` when two failed; opened, each row names the document by its title and a failed row carries the first line of its error. The recorded `pass3/p1-maws-artifacts` draws the same artifact rows and the same caption from its journal and from its file.
11. **A shell row** (A11). Unit: with no description it reads the verb and the short form of its command, or `Ran a command` where the rule refuses the command; with a description it reads the description live, from the file and through another machine's rows (`u3-tasks-r1`, whose shell calls all carry one; the test fails if any row falls back).
12. **Keeps** (A17). `view/Transcript-scroll.test.tsx`, `view/rows/User.test.tsx` and the subagent row's cases in `rows.test.tsx` pass with no edit.
13. **Not worse on a long session** (A18, where MAWS draws; Reported, 6). The derivation budget's two readings on the VM before and after are in Surprises & Discoveries; the anchoring scene's unconditional assertions hold with runs folded (e2e); the measured half and OX7 are the architect's.
14. **Two builds.** Unit, `thinking-duration-builds.test.ts`: build F's `assistant.block.complete` reads this build's event with `readTolerant`, drops `thinkingDurationMs` and keeps the event; this build's schema accepts F's event. E2e, both directions: the architect's cross-build run.
15. **The tree.** `pnpm typecheck`, `pnpm exec eslint` over the changed paths and `pnpm test` pass on the VM but for the set known to fail there on master; class 1a is the architect's gate of record.

## Constraints that bind every milestone

- **The laws.** 1: every word of a caption and the short command are Claude Desktop's, read in `~/claude-desktop-re/readable/app-5.1231.2/` at the lines the section and this document cite; a departure is named in the section or under Decisions. 2: MAWS draws nothing in a mod's place; this landing changes no advertisement. 3 and 4: no setting, no view mode, no inner scroller, no cap on an opened run. 5: every milestone's proof draws by all three routes (Interfaces §F). 6: no claim about the engine beyond the fixtures named. 8: l2-transcript-14, -10 and -17 are `keep`.
- **UC-1.** The only reading of "waits" is `selectWaitingByCall`. No comparison of an attention item's state appears in this landing's code.
- **UC-2.** This landing classifies no arrival. It reads `opener` and the turn's `origin`.
- **UC-3.** Requests' rows, the `request_slot` row and the region at the transcript's end are U1's; arrival and message rows and `view/Transcript.tsx` are U3's; `owner/report/project.ts` is this child's and is not edited before U2b. A row that holds a waiting form ends a run and is never inside one.
- **UC-8.** The insertions this landing makes in files another child owns are the two of Interfaces §I, and no other.
- **UC-11.** Fixtures, tests and comments use invented content. Nothing of the drawn example enters the repository: its numbers and words are not copied, and no test names it.
- **UC-14.** Nothing is stored. Neither settings file and no layout key is touched.
- **Tokens only; the light theme is the default.** No colour, radius or font size is written as a value; the warning tone is the token the attention glyphs use.
- **Copy.** Every string a person reads is in `transcript/model/copy.ts` or `caption.ts`, exactly as the section and Interfaces give it.
- **The record.** A reversed ruling is amended where it stands, in this pull request (the last part of Plan of Work).
- **Where checks run.** Nothing is installed, typechecked, linted, tested or built on the MacBook. Every check runs on the VM in a checkout of the pushed head. An executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron.

## Plan of Work

Five milestones, in order. M1, M2 and M3 touch the same model files and are sequential for that reason only; M4 consumes all three; M5 closes. Each ends with the tree green on the VM (typecheck, lint of what changed, the suites named, then the whole unit suite) and with its snapshots regenerated there and committed (Concrete Steps, 4). The e2e specs are edited in M5 and run by the architect; between M2 and M5 the scenes of `e2e/transcript.spec.ts` that pin the flat group are stale, which no gate of an executor's runs.

### M1 — The engine's recorded duration of a thought, on every route (X1)

**What exists at its end.** A finished thought carries the engine's own duration wherever its event is made. A thought read from a transcript file, which reads `Thought` today, reads `Thought for 12s`, with the number the live session shows; so does one in a terminal session on this Mac and one in the rows another machine serves. Nothing else is drawn differently yet.

**What it touches.** `src/shared/graph/events.ts`; the two producers, by one insertion each in U3's files (Interfaces §I): `Normalizer.assistant` in `src/engine-host/normalizer.ts` and `assistantEvents` in `src/engine-host/fs/backfill.ts`; `src/renderer/src/transcript/model/reduce.ts` (`LiveBlock`, `completeBlock`) and `derive.ts` (`blockRow`); `src/shared/ipc/wire.ts` and the two generated wire files; their tests, the new `src/shared/graph/thinking-duration-builds.test.ts` and the new `src/renderer/src/transcript/model/run-routes.test.ts`; the snapshots that hold a thought.

**Interfaces.** Exposes §A to M4 and to U2b. Consumes U3a's fixture loaders (C7).

**Decisions that belong here.** Decisions 1 and 2. *The wire's minor:* an optional key on an event is an additive change that `src/shared/ipc/wire.test.ts` gates; the number is the next free one after master's at the merge, and the generated files are made again after any later merge that moves it (Concrete Steps, 3). *Pitfalls seen in the code:* the normaliser pairs each frame's block with its stream start, and a frame the engine forwards for a subagent's thought has no number and no stream (so its event carries none and its row has no time, by design); a journal read back regains the number because the journal keeps the raw frame; `normalizer-fidelity.test.ts` walks every fixture and will name any event it did not expect. `eventsOf` in `lane-a/plane-transcript.ts` needs no edit: it calls `recordToEvents`, and the number is on the raw row whatever build the other machine runs.

**What it does not touch.** How a thought is drawn inside a run (M4); W1's rule for a thought with no text; the live label; lane A's streaming overlay (`clock: 'wall'`), whose block has no start time from the engine (tracker row 631, not this landing's).

**What it proves.** Acceptance 14. And: over `u3-cron-r1` the last turn's thought has `durationMs` 10,192 from the wire journal, from the transcript file and from the file's rows through `freshSource`; over `uxwave-thinking-*-without-*` a thought with no text has its number on the event and still no row; a frame with two thinking blocks sets none; a frame whose number is a string, negative or not finite sets none; a block that streamed on an event with no number keeps today's measured time, and one that did not stream has none; `thinking-duration.test.ts`'s cases read the recorded numbers.

### M2 — What joins a run, its caption, and the turn's line

**What exists at its end.** In the model every run's `summary` is Desktop's caption and every closed turn's line reads what the turn did. A call the person allowed, a bookkeeping call and a plain artifact call are members of runs on every route. In the window the turn's line is final; the run is still drawn flat under its new caption, with thoughts behind today's button until M4.

**What it touches.** `src/renderer/src/transcript/model/`: `classify.ts`, `groups.ts`, the new `caption.ts`, `copy.ts` (`dividerCopy`, `turnSummaryCopy`, `cellLabel`'s `Skill`; `groupSummary`, `GroupPhraseInput` and `activeGroupLabel` go), `derive.ts` (the divider's fields and its condition; `turnPhrases` goes), `cells.ts` (`thinkingCell`), `rows.ts`, `schema.ts`; `view/rows/Divider.tsx`; `view/rows/Group.tsx` and `view/cells/CellLine.tsx` only as far as the removed fields force; `view/rows/Row.tsx` (`opensTurn`); `owner/report/OwnerRecordRow.tsx` if an export of `Divider.tsx` it imports changes its shape; the tests of Today's list that pin these; the snapshots.

**Interfaces.** Exposes §B (the builder, and the rows' new fields) to M3, M4 and U2b. Consumes `opener` (C1, C2).

**Decisions that belong here.**
- *The classification.* In `TABLE`: every `grouped('other', true)` entry becomes `grouped('other')`; the `maws` entries `artifact_list`, `artifact_describe_type`, `artifact_read`, `artifact_upload_asset`, `artifact_list_assets`, `artifact_export`, `artifact_edit`, `artifact_comments`, `artifact_reply`, `artifact_resolve`, `artifact_dataset` and `artifact_search` become `grouped('other')`; `artifact_screenshot` stays as it is (its result is an image, which stands alone by the image rule on every route); `show_pane` and the two cua names stay `standalone`. In `classifyTool` the line that makes a call the person decided ungroupable goes; `humanDecision` stays a fact of the classification. `ROW_KIND_TOOLS` is not edited. Decision 10 for `hidden`.
- *The caption.* §B, by one builder for a run and a turn. The order within a run is Desktop's; on the turn's line the parts for changed files come first, then agents, then the rest, and the cap applies after that order. Read Desktop's builder before writing it (`web/app/v1/c24951e9f-DKQNorfR.js`: the order at `:1176-1183` and `:1291-1337`, the uncategorised words at `:1103-1123` and `:1313-1334`, the message part at `:576-592` and `:958-972`, the failed and stopped marks in the functions the loop calls).
- *The turn's line.* `{verb and duration} · {caption} {+N −N} · N denied · N auto-denied`. A running turn reads `Working for …` and nothing more (Reported, 7). A stopped or failed turn keeps its verb and gains the caption. Whatever verbs `verb()` holds at the merge stay (U4a's `cause: 'message'` among them, if it has landed): this milestone replaces the call count, not the verb table.
- *The verb.* By `origin` as today, with one override: a turn whose `opener.class` is `answer` reads `Worked for` (C2). No other class is read here (C3).
- *No line for a turn with nothing under it.* The condition loses `turn.origin !== 'human'` (C5). `opensTurn` in `Row.tsx` assumes an engine's or a peer's turn opens with its divider; with this change the "Not in context" mark of a revealed branch goes on the turn's first drawn row.
- *The popover* lists every part, uncapped, with the model, the denied kinds, the auto-mode line, the cost and the tokens as today; the count of subagents goes from it, the agent part says it.
- *Pitfalls.* `summary.toolCalls` and the divider's `toolCalls` stay as data: `owner/report` reads them until U2b. `assistant-ink.test.tsx` pins that live token batches derive no folded turn; decision 9 keeps it. `serialize.ts` writes a turn's line into the copied markdown through `dividerCopy` and follows it.

**What it does not touch.** The fold's view, thought lines, the running and waiting line (M4). Shell and artifact labels (M3). `owner/report/project.ts` and its words. The `request_slot` row. Arrival rows. `stores/transcript.ts`.

**What it proves.** Acceptance 2, 7, 8, and of 1 the model's half. And: a call with `humanDecision` is a member of its run and a denied one a row of its own; a `TodoWrite` between two reads is a member and a part (`updated todos`); two `ToolSearch` calls with different counts are two parts; one file read twice and edited once is the merged part naming it; a part of files counts paths and a part of commands counts calls; `(1 failed)`, `(1 stopped)` and both; exactly four parts are not capped and five are; the turn order moves a merged part that names a changed file to the front; a turn's caption counts an agent of a subagent row, a message to a subagent and a message to another session by recipient; a running turn's row carries no caption; an engine's turn with one answer and no work has no divider; a toggle of one run derives one turn (`turnDerivations`).

### M3 — What a row reads: a shell call with no description, an artifact call, a failed call

**What exists at its end.** A shell row with no description reads `Ran ` and the short form of its command in the code font, or `Ran a command`. A plain artifact call reads what was done to which artifact. A failed call of any tool carries the first line of its error, muted, after its label. Captions follow, because a part of "any other call" is its row's words.

**What it touches.** The new `src/renderer/src/transcript/model/short-command.ts` and its test; `view/cells/CellLine.tsx` (the shell label becomes the exported function of decision 5; the reason's span); `model/cells.ts` (`labelOf`, the `error` field, the titles); `model/copy.ts` (`ARTIFACT_CELL`, the shell fallback's four forms); `model/derive.ts` (the titles a turn's results gave, kept as `knownOfTurn` keeps agents' names); `model/rows.ts`, `schema.ts`; `view/transcript.css`; their tests; the snapshots.

**Interfaces.** Exposes §D to M4 and U2b. Consumes §B (a part's words are the done form of the row's label).

**Decisions that belong here.**
- *The short command* is a port of Desktop's function with its refusals, not a new rule (`web/app/v1/c52b02f3f-C1Vcib4H.js:1675-1714`, called for its Bash label at `:9084-9124`; the helpers it calls are in the same file). Port the helpers it needs and cite each by line in a comment, as `isPersistentRow` cites MAWS's rules. Its unit test holds the cases that function's own branches make: a leading `cd … &&` dropped, four words at most, the cut at the first refused word, `…` when cut, the kept last argument, the refused line.
- *The shell label's order* is unchanged: a denial's diagnostic first, then the description (always, when there is one), then the short form, then `Ran a command` / `Running a command` / `Failed to run a command` / `Stopped a command`.
- *Artifact rows.* §D's table; decision 14 for a failed one; Reported 4 and 5 for the title and its marks. Other MCP servers keep `Used {server} · {tool}`.
- *The reason.* Decision 13. A denied call has none (its label already says why). A shell failure's reason is the same first line as any tool's.

**What it does not touch.** The rows artifact creation and publication draw, the pane-opening call, `ask`, `send_file`. The library (`src/renderer/src/library/`, U10's). `src/shared/maws/tools.ts` (UC-15: no tool text or result shape changes).

**What it proves.** Acceptance 10 and 11. And: an artifact no result in the loaded transcript named reads the handle the call gave; a title learned in an earlier turn names a later turn's call; twelve edits of one document with two failed are one part, `edited ‹…› 12 times (2 failed)`; `u3-tasks-r1`'s shell rows read their descriptions by each route.

### M4 — The run's row: one line, folded; thoughts in order; the running, the waiting and the thinking line

**What exists at its end.** What Purpose says of a run, in the window. `Internal activity`, `.transcript-group-header` and `.transcript-group-cells` are gone.

**What it touches.** `view/rows/Group.tsx` (rewritten), `view/rows/Thinking.tsx`, `view/rows/ThinkingLabel.tsx`, `view/cells/CellLine.tsx` (the thinking cell's branch goes), `view/transcript.css`; `model/groups.ts` (`runSegments`, `runLine`), `model/derive.ts` (`blockRow`, and where a thought leaves the group machine as a row), `model/copy.ts` (`waitingLabel`); `transcript/surface/Rows.tsx` and `adapters.ts` (`groupInput`); their tests; the snapshots a travelling textless thought changes.

**Interfaces.** Consumes §A, §B, §D and U1a's `selectWaitingByCall` (C8). Exposes §C, §E and the components of §J to U2b.

**Decisions that belong here.**
- *The row.* One button, the line, with `aria-expanded` and `aria-controls`; under it, while the run is folded and a thought streams, the live thought line; then the body, mounted only while open (`DisclosureBody` unmounts a closed body, so a folded run mounts no call and asks no `ToolUse` site). The body is `runSegments(row.cells, row.state === 'active')`: a block of calls is today's bordered `.transcript-tool-block`, a thought line stands between two blocks. The line's chevron trails the text, as a call row's does.
- *What the line reads* is `runLine` (§C): the waiting call, else the foreground call that started last, else the caption with the run's line counts.
- *Textless thoughts travel.* `blockRow` emits a finished thinking block with no text when it has a duration, so it can merge and be tested inside a run. Where a thought leaves the group machine as a row (a turn with no tools, the single-call unwrap, after the turn's last work), one with no text is dropped there, so W1 holds outside a run exactly as today.
- *One component.* `ThinkingRow` and the run's thought line are the same component with the same disclosure; a merged line's id is its first member's. Decision 12 for its two style corrections, both in `.transcript-thinking`.
- *The live label.* `LiveThinkingLabel` no longer takes or reads text; `LiveThinkingCellLabel` and its store subscription go with the group's old header. Decision 17.
- *The waiting line.* §E. The words are `waitingLabel` (Reported, 2); the glyph and tone are `ATTENTION_HEADINGS[item.kind]`'s.
- *The mods' site.* `groupInput` sends the run's real `isExpanded`; `SurfaceGroupRow` keeps `drawingOnly` and its rule that an answer can open a run and never closes one. Making the site a full one is U2b's.
- *Sequences a test holds open* (the root's rule for anything that waits on something): a request arrives on a folded run, the reader opens and closes it, the request is answered; a request whose item leaves the list with no answer (the process ended); a thought streams under a folded run and ends at 4 s (no line) and at 12 s (one line, seen on opening); a thought left unfinished when its turn closed (not live, no line); a second call arrives on a live run of one.

**What it does not touch.** `view/Transcript.tsx` (U3's; the row estimates stay). `stores/transcript.ts` (`toggleGroup` and the jump already do what is needed). The `request_slot` row and the docked card. The turn's own fold: a closed turn's work folds under its line and a running turn's work is open, with its runs folded. `FoldedAssistantProbes`. `owner/`.

**What it proves.** Acceptance 1, 3, 4, 5, 6. And: a folded run mounts no `[data-cell-id]`; a jump to a call inside a folded run opens it and lands on the row; `groupInput` reports the open state and still returns null while a pending request names a member; in a run whose every thought is under ten seconds the opened body is one block; two thoughts of 6 s with no call between them are one line of 12 s; a thought of 12 s with no text has no chevron and its label starts where a line with a chevron starts its label; a trailing textless thought of 12 s is a line under the last block, and the same thought after the turn's last work is nothing.

### M5 — The e2e edits and scenes, the routes' proof whole, the record, and the acceptance run

**What exists at its end.** The specs that cross the changed rows say what the window now draws, the record is written, and Acceptance has been executed as written.

**What it touches.**
- `e2e/transcript.spec.ts` (group `transcript`, the harness build), the scenes that pin the flat group or the old words: "anchoring: 500 turns stream while old work is expanded" (it presses rows inside `.transcript-tool-block`: open the run first; its unconditional assertions are not loosened); "a tool detail moves through its disclosure…" (the same); "a streaming reasoning summary stays under the shimmer, warm from 20 s" (the label now, not the summary; the warmth stays); "the denied count jumps to the standalone denied cell" (the turn line's words); the `R3 recorded ToolUse` and `ToolGroup` cases (what a folded run shows; the recorded answer's `isExpanded`); "the report folds work while marked text retains its authored flow and geometry" (the opened record's turn line); "Code-mode transcript rows keep labels, counts and inline diffs…" (open the runs); "child transcript renders the subagent's events only" if its cell sits in a run.
- Three new scenes there: *a run folds, opens onto its rows, and folds again* (a recorded fixture played live: one line while it streams, the running label, the caption at rest, the clicks of acceptance 1); *an opened run draws a thought of ten seconds at its place* (a new event fixture under `test/fixtures/transcript/events/`, invented content, thoughts of 4 s and 12 s, one with no text); *a closed turn's line says what the turn did*. No raw time bound is added (`.github/scripts/gate-plan.test.mjs` refuses one).
- `e2e/code-tools.spec.ts` ("an inline edit discloses its diff…") and `e2e/agent-tools.spec.ts` (the drill-in scene and "G5") where the call they press now sits in a folded run.
- `apps/desk-web/e2e/stream-scroll.spec.ts` and `phone.spec.ts`, in their expectations only (Reported, 3).
- `run-routes.test.ts`, whole (Interfaces §F).
- The record, below, and `docs/tech-debt-tracker.md`.

**Decisions that belong here.** An executor writes these specs and cannot run them; each is run alone on a Mac by the architect before the final gate (UC-10), and a failure there comes back to this milestone. A scene is edited to say the new behaviour, never weakened to pass.

**What it does not touch.** `e2e/to-human.spec.ts` and `to-human-live.spec.ts` (U2b's). Any measured bound.

**What it proves.** Acceptance 1 to 15 as written, by the commands of Concrete Steps, with the outputs recorded in Progress.

### The record (in the same pull request, UC-10)

Each reversed ruling is amended where it stands, dated, with the sentence the child's file gives under "Rulings reversed":

- `docs/doperpowers/plans/2026-10-19-p4-smoothing.md`: Decision Log 76 (O-29's sentence) and Decision Log 85 (O-27's sentence: the line of a thought in progress).
- `docs/charter.md`: a dated Decision Log entry for §5.3 (the section's sentence for O-29 and O-15), and X1's dated line: "`assistant.block.complete` gains the optional `thinkingDurationMs`, the engine's recorded duration of a finished thinking block in milliseconds; a build that does not send it is drawn from the block's start and end events."
- `docs/doperpowers/plans/2026-09-28-c6-transcript.md`, X3's classification: the section's sentence, and that `hidden` leaves the classification.
- `docs/doperpowers/plans/2026-10-01-ux-fundamentals-waves.md`, W1: #479's sentence; the comment in `derive.ts`, `blockRow`, says the same.
- For l6-artifacts-12, the section's sentence in each document the comments in `classify.ts` name: `2026-10-06-e2-deliverables.md` (E2), `2026-10-12-p3-b-documents.md` (P3-B M7), `2026-10-16-p3-e2-dashboard.md` (P3-E) and `2026-10-20-p4-b4-tool-surface.md` (P4-B4); the comments in `classify.ts` are rewritten to match.
- `docs/tech-debt-tracker.md`, two rows: #351 (a memory recall as a step of its run: deferred; it returns when the engine's gate opens or automatic memory is turned on; the frame and the fixtures as the section records them), and decision 15 (a subagent's own transcript, watched live, shows no thought lines inside its runs until it is read from its file).

The register's rows, the board ticket and the tracking map are updated at landing by the sessions that keep them, not by an executor.

## Concrete Steps

All in the worktree of branch `ux-wave/U2`. `vm` below stands for `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U2 --`; it runs its command on the VM in a checkout of the pushed head, prints `vmcheck: ux-wave/U2 at <sha>` first, and exits with the command's status (never pipe it into `tail` or `head` without `set -o pipefail`).

1. **Base** (the controller: before M1, before M4, before M5, and once more before the hand-back). Merge, never rebase:

       git fetch origin master && git merge origin/master
       git cat-file -e origin/master:src/shared/engine/arrival.ts
       git grep -n "opener" origin/master -- src/renderer/src/transcript/model/rows.ts
       git grep -n "loadUxwaveTranscript" origin/master -- test/support/fixtures.ts
       git grep -n "selectWaitingByCall" origin/master -- src/renderer/src/stores/attention.ts

   Each of the four must answer. If one does not, U3a or U1a is not on master: stop and hand back. After a merge that brought in another landing's edits to a file of Interfaces §I, keep both sides' changes, and regenerate rather than resolve by hand whatever is generated (steps 3 and 4).

2. **Checks, per milestone**, after `git push`:

       vm 'pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'      # the renderer
       vm 'pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'     # M1 only: main, services, shared, the engine host
       vm 'pnpm exec eslint <the paths changed>'
       vm 'pnpm exec vitest run <the test files of the milestone>'

   Expect `Test Files  N passed` with no failure. Before a milestone is called done, and before the hand-back: `vm 'pnpm typecheck'` (about five minutes) and `vm 'pnpm test'`. On the VM a known set fails on master too and is not this landing's: `test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts` of the desk hub, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` can fail under the whole suite's load and passes alone. Any other failure is this landing's.

3. **The wire's files** (M1, and again after any merge of master that moved `WIRE_MINOR`). After step 1's merge read `WIRE_MINOR` in `src/shared/ipc/wire.ts`, take the next number and add to its comment "the UX wave, U2: assistant.block.complete's thinkingDurationMs (N)". With the field in `events.ts`, commit and push, then make the two generated files on the VM and bring them back as a patch:

       set -o pipefail
       vm 'pnpm wire:manifest >/dev/null 2>&1; git diff -- src/shared/ipc/wire-manifest.json src/shared/ipc/wire-fingerprint.json; git checkout -q -- src/shared/ipc' | sed -n '/^diff --git/,$p' > /tmp/u2-wire.patch
       git apply /tmp/u2-wire.patch

   Expect a patch that touches those two files only, changes the entries that carry `assistant.block.complete` and the minor, and removes no entry. Commit, push, and run `vm 'pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'`: both pass. If `wire.test.ts` says "breaking change", a schema was narrowed: stop and report. The patch file is never committed.

4. **The snapshots** (M1 to M4, and again after a merge that changed a row). They are never edited by hand. Regenerate on the VM and bring the change back compressed (it is large: `synthetic/500.rows.json` alone is 6.5 MB):

       set -o pipefail
       vm 'pnpm test -- -u src/renderer/src/transcript/model >/dev/null 2>&1; git add -N test/snapshots/transcript; git diff --binary -- test/snapshots/transcript | gzip -c | base64 -w0; echo; git reset -q -- test/snapshots/transcript; git checkout -q -- test/snapshots/transcript; git clean -fdq test/snapshots/transcript' | tail -n 1 | base64 --decode | gunzip > /tmp/u2-snapshots.patch
       git apply /tmp/u2-snapshots.patch

   Then read the diff of a few small files before committing (`test/snapshots/transcript/events/thinking-live-group.rows.json`, `pass1/permission-roundtrip.rows.json`, `pass3/p1-maws-artifacts.rows.json`): each changed field must be one the milestone means to change. Commit, push, and run `vm 'pnpm exec vitest run src/renderer/src/transcript/model/snapshots.test.ts'` without `-u`: it passes. Because recorded files changed, also run `vm 'node --test .github/scripts/maws-app-scan.test.mjs'`; a value it flags that is no credential gets a path-bound entry in `.github/maws-app/gitleaks.toml`, named in the hand-back.

5. **The derivation budget, before and after** (before M1 and in M5; a relative reading, the VM is not the Mac the budget was set on):

       vm 'MAWS_PERF=1 pnpm exec vitest run src/renderer/src/transcript/model/perf.test.ts'

   Run it once after step 1's first merge, before M1's first commit, and once at M5's head; the test prints one line, `perf: events=… rows=… deriveMs=… deltaBatchMedianMs=…`. Write both lines into Surprises & Discoveries. If the head's derivation reads more than a fifth above the base's, stop and report before going on.

6. **Acceptance** (M5). The suites of Acceptance, by name, then `vm 'pnpm typecheck'`, `vm 'pnpm exec eslint src/renderer/src/transcript src/engine-host src/shared/graph src/shared/ipc'` and `vm 'pnpm test'`; and on the MacBook `git grep -n "Internal activity" -- src apps e2e test` (prints nothing) and `git grep -n "'tool call'" -- src/renderer/src/transcript/model/copy.ts` (prints nothing: no line of copy counts calls any more).

7. **Stop and hand back** with: the head's sha; each command above with its result; what was not verified; the decisions made beyond this document; the e2e scenes written and not run; any `gitleaks.toml` entry. The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e.

## Interfaces and Dependencies

§A to §E are what M1 to M4 produce and what U2b and the siblings code against; §F and §G are the routes and the wire; §H to §K are the other landings.

### §A. X1: the recorded duration (M1; `src/shared/graph/events.ts`)

`assistant.block.complete` gains

    thinkingDurationMs: z.number().nonnegative().optional(),

set by `Normalizer.assistant` from the frame's `thinking_duration_ms` and by `assistantEvents` from the record's `thinkingDurationMs`, under decision 1's three conditions. Nothing else in the file changes. In the model, `LiveBlock` gains `recordedMs?: number` (set by `completeBlock`), and a thought's `durationMs` (the `thinking` row's and the thinking cell's) is `recordedMs`, else for a block that streamed the time from its first delta to its completion, else `null`.

### §B. The caption (M2; `src/renderer/src/transcript/model/caption.ts`)

    export interface CaptionPart { text: string; calls: number; changed: boolean; agent: boolean }
    export function stepsOfCells(cells: readonly Cell[]): CaptionStep[];               // thoughts and denied calls give none
    export function captionParts(steps: readonly CaptionStep[]): CaptionPart[];       // a run's order
    export function turnOrder(parts: readonly CaptionPart[]): CaptionPart[];          // changed files, then agents, then the rest; stable
    export function captionText(parts: readonly CaptionPart[], cap: boolean): string; // '' for no part

`CaptionStep` is the builder's own (a kind or none, the key it is counted by, its words, how it ended); a turn adds its agents and sent messages as steps of the kinds `agent`, `peer_message` and `agent_message`. The parts and their words are the section's table under O-29, with these readings:

| step | kind | counted by | words |
|---|---|---|---|
| `Read`, `NotebookRead` | read | path | `read a file`, `read # files` |
| `Write` whose result created the file | create | path | `created a file`, `created # files` |
| `Edit`, `MultiEdit`, `Write` over a file (a deletion too) | edit | path | `edited a file`, `edited # files` |
| `NotebookEdit` | notebook | path | `edited a notebook`, `edited # notebooks` |
| `Bash`, `PowerShell`, `BashOutput`, `KillShell`, `Monitor` | command | call | `ran a command`, `ran # commands` |
| `Grep` | grep | — | `searched code` |
| `Glob`, `LS` | glob | — | `searched for files` |
| `WebSearch` | web search | call | `searched the web`, `searched the web # times` |
| `WebFetch` | web fetch | call | `fetched a page`, `fetched # pages` |
| `TodoWrite` and the `Task*` tools | todos | — | `updated todos` |
| `EnterWorktree`; `ExitWorktree` | each its own | call | `moved to a worktree`, `moved to # worktrees`; `left the worktree`, `left # worktrees` |
| an agent of a subagent row (a turn only) | agent | agent | `ran an agent`, `ran # agents` |
| a message to another session; to a subagent (a turn only) | each its own | recipient | `messaged another session`, `messaged # other sessions`; `messaged a subagent`, `messaged # subagents` |
| any other call | none | call, per label | the row's done label with its first letter lowered; `{label} # times` |

- **Order.** The parts of the kinds, in the order each kind first occurred; then the parts with no kind, in the order each label first occurred.
- **One file.** When every step of the kinds read, create, edit and notebook names the same one path, those parts are one part: the verbs in the order they first occurred, joined by ` and `, then the file's base name (`read and edited copy.ts`). It is `changed` when one of its verbs is not `read`.
- **Marks.** A part with calls that failed reads `(N failed)` after its words, with calls the person's Stop interrupted `(N stopped)`, with both as Desktop's builder joins them. Desktop's `(# blocked)` and its whole-part failed form are left out (the section).
- **The cap.** With five parts or more, the first three, then ` and N more actions` (`1 more action` for one), N the calls of the parts left out. Applied to a run in its order and to a turn after `turnOrder`.
- **Text.** The parts joined by `, `, the first letter raised.
- **`changed`** is true for the kinds create, edit and notebook and for a merged part as above; **`agent`** for the kind agent.

Rows (`transcript/model/rows.ts`, `schema.ts`): the `group` row keeps `kind`, `state`, `cells`, `icon` and `expanded`; its `summary` is `captionText(captionParts(stepsOfCells(cells)), true)`; it gains `counts: { added: number; removed: number }` (the run's finished edits) and loses `activeLabel`. The `divider` row gains `caption: string` (the turn's, ordered and capped; `''` for a running turn and for a turn with no step), `parts: string[]` (every part's text, ordered, uncapped) and `counts` (the main loop's finished edits); it keeps `toolCalls` and everything else.

### §C. The run's segments and its line (M4; `src/renderer/src/transcript/model/groups.ts`)

    export const THOUGHT_LINE_MS = 10_000;
    export type RunSegment =
      | { kind: 'calls'; cells: Cell[] }
      | { kind: 'thought'; id: CellId; at: string; text: string; durationMs: number | null; live: boolean };
    export function runSegments(cells: readonly Cell[], active: boolean): RunSegment[];
    export type RunLine = { kind: 'waiting'; cell: Cell; item: AttentionItem } | { kind: 'running'; cell: Cell } | { kind: 'caption' };
    export function runLine(cells: readonly Cell[], waiting: ReadonlyMap<ToolUseId, AttentionItem>): RunLine;

`runSegments`, in this order: (1) thinking cells with no call between them become one thought: its `durationMs` the sum of its members' recorded durations (`null` when none has one), its `text` the members' texts in order with a blank line between, its `id` and `at` the first member's; (2) a thought that is `running` in an active run is `live` and is kept, as the last segment; (3) every other thought is kept only when `durationMs !== null && durationMs >= THOUGHT_LINE_MS`; (4) the calls between kept thoughts are one `calls` segment each. No two `thought` segments are adjacent, by (1).

`runLine`, in this order: a call of the run whose `toolUseId` is in `waiting` with an item of kind `permission` (the item created first when several; call order between equals); else the foreground call with status `running` that started last; else `caption`. A call the engine runs in the background is not a foreground call (Reported, 8): today a shell cell whose detail has a `backgroundTaskId`, and after U4a's decision 33 any call its moved input marks. While only background calls run, the line is the caption with its line counts.

### §D. What a row reads (M3)

- `src/renderer/src/transcript/model/short-command.ts`: `export function shortCommand(command: string): string | null`, Desktop's rule; `null` where it refuses the line or its first word.
- The shell label, one function the row and the run's line both call: a denial's label; else the description, inflected as today; else with `shortCommand`, ``Ran `…` ``, ``Running `…` ``, ``Failed `…` ``, ``Stopped `…` ``; else `Ran a command`, `Running a command`, `Failed to run a command`, `Stopped a command`.
- `Cell` gains `error?: string` (decision 13).
- The artifact rows. `ARTIFACT_TITLE = (title: string) => '‹' + title + '›'` (Reported, 5). `artifactTitleOf` gives the title a result in the loaded transcript gave for the id or handle the call names (this turn's results, then earlier turns'), else that id or handle as the call wrote it (Reported, 4). `T` below is `ARTIFACT_TITLE(artifactTitleOf(…))`.

| tool | done | running | failed |
|---|---|---|---|
| `artifact_read` | `Read T` | `Reading T` | `Could not read T` |
| `artifact_edit` | `Edited T` | `Editing T` | `Could not edit T` |
| `artifact_comments` | `Listed comments on T` | `Listing comments on T` | `Could not list comments on T` |
| `artifact_reply` | `Replied on T` | `Replying on T` | `Could not reply on T` |
| `artifact_resolve` | `Resolved a comment on T`; with `reopen`, `Reopened a comment on T` | `Resolving a comment on T` | `Could not resolve a comment on T` |
| `artifact_export` | `Exported T` | `Exporting T` | `Could not export T` |
| `artifact_upload_asset` | `Uploaded an asset to T` | `Uploading an asset to T` | `Could not upload an asset to T` |
| `artifact_list_assets` | `Listed assets of T` | `Listing assets of T` | `Could not list assets of T` |
| `artifact_dataset` | `Bound a dataset to T` | `Binding a dataset to T` | `Could not bind a dataset to T` |
| `artifact_describe_type` | `Described the {kind} kind` | `Describing the {kind} kind` | `Could not describe the {kind} kind` |
| `artifact_search` | `Searched artifacts` | `Searching artifacts` | `Could not search artifacts` |
| `artifact_list` | as today (`Listed 3 artifacts`) | `Listing artifacts` | `Could not list artifacts` |
| `artifact_screenshot` | as today | as today | `Could not screenshot T` |

The first, second and fourth rows' done forms and `Listed artifacts` are the section's; the rest are this document's (Reported, 11).

### §E. The waiting line (M4)

`waitingLabel(cell): string` in `copy.ts`: ``Waiting for approval: `{command}` `` for a shell call (the command's first line), `Waiting for approval: {file name}` for a file change (the base name), `Waiting for approval: {tool}` otherwise (the tool's name; for an MCP tool `{server} · {tool}`). The view reads `selectWaitingByCall(state, useRowSession())` from the attention store and hands the map to `runLine`. Per route:

| route | a waiting permission's call can be in the map |
|---|---|
| a session MAWS runs on this Mac | yes, from the publisher's list |
| a session MAWS runs on another machine | yes, through that machine's feed; a machine on build F still lists an answered and unconfirmed item, which the predicate drops here (U1a, §K) |
| a terminal session on this Mac | yes, when the bridge gave the request its call's id; otherwise the entry is under the request's id, no row matches, and the line keeps its caption (the section) |
| a terminal session on another machine | only while a pane of this window shows the session (the window's mirror of the bridge's state; U1a) which is when the line is drawn |

### §F. Three routes, one result

What each route can differ in, per item, and where the sameness is proved. The proof is `src/renderer/src/transcript/model/run-routes.test.ts`: for each recording that exists in both forms it draws the session three ways and compares what is drawn, row by row.

- **live:** the wire journal (`loadUxwaveJournal`) through the `Normalizer`, as the engine host makes events;
- **file:** the transcript file (`loadUxwaveTranscript`) through `recordToEvents`, as a reload past the journal and a terminal session on this Mac do;
- **link:** the same file's rows through `freshSource` of `lane-a/plane-transcript.ts`, as a terminal session on another machine is mapped in this window.

A session MAWS runs on another machine is the live route's events carried over the link and read with `readTolerant`; with the same build at both ends it is the first case, and §G says what an older end does.

What is compared is the drawing, not the events: for every run its caption, its counts and its opened segments (each call's label as the row reads it, each thought line's label and whether it opens); for every single call its label; for every turn's line its words after the duration. Recordings: `uxwave/u3-tasks-r1` and `u3-tasks-r2` (runs of two and three calls, an agent and a command in one message, sent messages, task notices, every shell call described), `uxwave/u3-cron-r1` (a thought of 10,192 ms with text before a run of two), and `pass3/p1-maws-artifacts` with its file form `test/fixtures/transcripts/p1-maws-artifacts.jsonl` (a run of artifact calls; `disk.test.ts` already pairs the two). A probe journal that carries its own file as a `jsonl_snapshot` row (`snapshotRecords` in `test/support/fixtures.ts`) is one more pair wherever it holds a run.

The same file holds a second proof, over every session the snapshot suite walks (the three probe passes, the event fixtures and the 500-turn synthetic session of `test/snapshots/transcript/synthetic/500.rows.json`), which exist in one form only. For each drawn turn: every call of the turn is drawn in exactly one place (a segment of one run, or a row of its own) and in event order; a run's parts count exactly its calls that were not denied; a folded run and the same run opened name the same calls; no two thought lines are adjacent; and no row of a turn is lost or doubled against the rows the same events gave before this landing, other than the ones this landing means to move (listed in the test). It is what makes the regenerated snapshots evidence and not only a new baseline.

| item | what a route lacks or adds | so |
|---|---|---|
| O-29, what joins | only the live route knows the person allowed a call (`permission.resolved`); the file does not say | the fact no longer decides membership; today's difference between live and file ends |
| O-29, the line while it runs | a running or waiting call exists only while the session is live; a session read at rest draws its last turn closed (`restingRows`) | the caption at rest is the same by every route |
| O-27, #479 | the live wire has stream events and the number; the file has the number and no stream; a subagent's forwarded thought has neither | the test and the time shown are the number; decision 15 for the subagent |
| O-15 | the live route has the engine's `turn.ended` duration; a file's turn is timed by its rows | the caption is equal; the duration may differ by the seconds it does today and is left out of the comparison |
| l2-transcript-04 | U3a's reader, the same on its three callers | read, not re-derived (C3) |
| l6-artifacts-12 | the live route also gets `maws.delivery.artifact`; the library differs by machine | the title is read from tool results, which every route has (Reported, 4) |
| O-49 | none: the description is in the call's input everywhere | acceptance 11 |
| the waiting line | by nature only where a request waits | §E's table |

### §G. What is sent, and what build F does with it

Nothing is stored. One optional key is sent.

| direction | what happens |
|---|---|
| this build's engine host → a window of build F (the same machine after a partial update, or F's window on this machine's session over the link) | F's reader is tolerant (`readTolerant`): it drops `thinkingDurationMs`, keeps the event, and draws as F draws: its own measurement for a block that streamed, `Thought` otherwise |
| an engine host of build F → this build's window (either way round) | the key is absent and the schema accepts the event; a block that streamed keeps the measured time, so it can still earn a line in a run; one read from the file by F's host has no time and gets no line inside a run until that machine is updated |
| a terminal session on a machine of build F → this window | nothing changes with the other build: the rows travel raw and this window reads the number from the row |
| this machine's terminal session → a device of build F | F ignores the row's key, as it does today |
| this build, then F, then this build, on one profile | nothing of this landing is on disk; the journal's frames and the transcript file are the engine's, and this build reads the number from them again |

`WIRE_MINOR` rises by one (F is at 33). No command is added, so no offer, no capability and no authorisation changes, and nothing new can be asked by a caller on another machine.

### §H. Consumed from siblings

- **U3a** (`origin/ux-wave/U3a`, document `docs/doperpowers/plans/2026-11-12-ux-wave-U3a-arrivals.md`): the divider's `opener` and the turn's `origin` as its reader's callers set it (C1 to C3); the removal of an engine turn that held nothing (C4); arrival rows as rows that end a run (C6); `loadUxwaveJournal` and `loadUxwaveTranscript` (C7). Not consumed here: `readArrivals`, `ui.revealed`, the arrival rows' asks (U2b's).
- **U1a** (document `docs/doperpowers/plans/2026-11-12-ux-wave-U1a-requests.md` on `origin/ux-wave/U1a`, §A): `selectWaitingByCall`. Nothing else: not `waits`, not `selectPendingOf`.
- **U6a:** nothing. No action and no chord is added.
- **U8a, U8b, U9, U13a:** nothing. U13a's cross-build coverage table gains no row from this landing, because nothing is stored.

### §I. Files other landings in flight also edit

A landing that merges second merges master first and keeps both sides (UC-8). This landing starts from a master that holds U3a (UC-3); the others are in whichever order they land.

| file | who else | who merges after whom |
|---|---|---|
| `src/engine-host/normalizer.ts`, `src/engine-host/fs/backfill.ts` (U3's by UC-8, as callers of its reader) | U3a (M3, M4), U4a (M1, the normaliser), U8b (M5, M6) | this landing after U3a. Its two insertions: in `Normalizer.assistant`, the one key on the emitted `assistant.block.complete`; in `assistantEvents`, the same key. No other line of either file |
| `src/shared/graph/events.ts` | U3a (`arrival`), U4a (`joined`, `endedForMessage`), U8b (`parentTaskId`) | each adds its own key; no conflict but adjacency |
| `src/shared/ipc/wire.ts`, `wire-manifest.json`, `wire-fingerprint.json` | U3a, U1a, U5a, U8b, U4a | whoever merges second takes the next number and makes the files again (Concrete Steps, 3) |
| `transcript/model/derive.ts`, `reduce.ts` | U3a (built), U4a (M1: `cause: 'message'`, the joined message; M3: `unread`), U5a (M5: `comments`) | this landing after U3a; U4a and U5a insert on a master that holds the last landing (UC-3). This landing's places: `blockRow`, the divider's construction and condition, `completeBlock` |
| `transcript/model/copy.ts`, `cells.ts`, `rows.ts`, `schema.ts` | U3a (built), U4a (M1: the divider's `cause` and its words in `verb`; the moved call's label input and `statusOf`'s condition), U5a (M5: the user row's `comments`), one string each from U9, U11, U12 | as above. U4a's moved call is an ordinary member of its run; under its decision 33 it stays `running` past its turn's end, which §C's `runLine` treats as a background call. U4a's decision 32 (a message the engine joined is one user row) and U5a's `comments` are in the `user.message` case and the user row, which this landing does not touch |
| `transcript/view/rows/Row.tsx` | U3a (M2 built; M5's two mounts) | this landing after U3a; its one edit is `opensTurn` |
| `transcript/view/transcript.css` | U3a (built) | after U3a |
| `transcript/surface/Rows.tsx`, `adapters.ts` | U3a (M5) | after U3a; this landing's edit is `groupInput`'s `isExpanded` |
| `e2e/transcript.spec.ts` | U3a (M6), others by scene | whoever merges second re-reads the scenes it edited |
| `apps/desk-web/e2e/` | U3a (M6: `acceptance.spec.ts`) | different files |
| `test/snapshots/transcript/**` | every landing that changes a row | regenerated after each merge, never resolved by hand (Concrete Steps, 4) |
| `docs/charter.md`, `docs/tech-debt-tracker.md` | every landing | appended; both kept |

Not edited by this landing, though near: `stores/transcript.ts` (U9's), `view/Transcript.tsx` (U3's), `view/TranscriptSlot.tsx`, `session/SessionPane.tsx` (U1's), `composer/` (U4's), `request-card/` and `src/shared/attention/` (U1's, read only), `lane-a/plane-transcript.ts` (U3's), `src/renderer/src/library/` (U10's), `owner/report/project.ts` and every file under `src/shared/owner/` and `src/services/owner/` (this child's, U2b's work).

### §J. What the second landing consumes from this one, by name

- The rows: the `group` row as §B and §C leave it (`summary`, `counts`, `cells`, `expanded`) and the `divider` row's `caption`, `parts` and `counts`. In the to-human view a turn's line is drawn with these words and no chevron, and a stretch opened shows runs folded.
- `captionParts`, `turnOrder`, `captionText` (`caption.ts`); `runSegments`, `runLine`, `THOUGHT_LINE_MS` (`groups.ts`); `waitingLabel`.
- The components: `GroupRow` (`view/rows/Group.tsx`), which U2b draws in the place a mod's answer keeps when it makes `ToolGroup` a full site; the thought line of `view/rows/Thinking.tsx`; the exported cell label.
- `groupInput`'s `isExpanded`, which U2b's full site sends unchanged.
- `ui.expandedGroups`, `toggleGroup` and the jump that opens a run (`stores/transcript.ts`, unchanged here).
- X1's `thinkingDurationMs`.
- What U2b removes and this landing leaves in place for it: the `owner_record` row and its words, `ReportBar`, `Presenter`'s label and bar, `FoldedAssistantProbes`, the turn's own fold in the to-human view, the divider row's `toolCalls` once nothing reads it.

### §K. The second landing's edge, the mod's pull request, and an older mod

Written here so that U2b's document starts from it; none of it is built by this landing.

**What U2b holds.** O-13 with O-06 and l2-transcript-06, O-30, #332; UC-13 (`TO_HUMAN_CONTRACT_VERSION` 8 → 9, a constant for the first mod release that draws at 9, the list of releases that failed check 1, `drawnBy` in the lane's published state, decided at launch and after each plugin reload); the mirror as a pure function over derived rows in place of `owner/report/project.ts`; `ToolGroup` as a full site and the message tool's call at `ToolUse`; the reads of `ui.revealed`; the bar's mount out of `session/SessionPane.tsx` and the switch's mount in `composer/Composer.tsx` beside the mods' band (U4's file: U2b merges after U4a); the desk web app's imports of the report projection re-pointed (`lane-a/view/drawn-rows.ts` is the file both apps read it through). Its first step is check 1, a probe under `spikes/protocol-probe/` that records what the rebased mod answers on MAWS's surface at 8 and at 9; no MAWS code that depends on those answers is written before it.

**What the mod's pull request changes** (doperpowers; prepared by the architect beside U2b, merged by the owner; read at the installed 0.7.3, which is the repository's main):

1. `to-human/hooks/mods/to-human.tsx`, the function `native()`. Today it is true, and every hook that calls it passes through, when `MAWS_NATIVE_TO_HUMAN` is set to anything non-empty and the surface is not the terminal. After: true only when the value is non-empty and is not a number of 9 or more. So unset or empty draws (as today); a number below 9, 8 included, steps aside; 9 or more draws; anything that is no number steps aside.
2. Its ten call sites are unchanged in place: the `ui.render` hooks for `UserMessage`, `TurnDuration`, `AssistantMessage`, `ToolUse`, `ToolGroup`, `ToolProgress`, `ToolResult` and `AbovePrompt`, and the two `ui.press` hooks (the fold control `to-human-toggle`, the view switch `to-human-mode`). The three hooks that never called it (`session.start`, `classic.SessionStart`, `session.append`) stay ungated.
3. The sentences of the mod's `README` and `CLAUDE.md` that state the rule, rewritten to UC-13's table.
4. The version, in `to-human/.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json`: 0.8.0.
5. Tests: `to-human/tests/mods/to-human-native.test.ts` keeps its pass-through case and its inventory of ungated hooks and gains the cases at 8 (pass-through), at 9 (the report drawn on `desktop`, `vscode` and `mobile`, the record folded) and unset (drawn); `live-maws-check.py` gains a run at 9 (the tool registers, no notification).

Nothing else changes: `message.tsx` (the tool registers in a headless launch from 8, `MAWS_WITHOUT_TOOL`), `notify.tsx`, the streaming hook, the sminos ask mod and `edits.tsx` are untouched.

**What MAWS's mirror must match in the mod**, each cited at the function it ports: the number 9; the release string of item 4, which is MAWS's constant for "the first release that draws at 9"; `promptRow` with its tables (`DELIVERED`, `TYPED`, the sminos frame patterns, the ask mod's delivery pattern) for what a prompt row is; `isRead` and `isUnsent` for which calls stay in view; `runStart` and `runEnd` for where a stretch begins and ends and which row carries each control; the words `working record`, `fold to report`, `to-human view · `, `full transcript` and `report only`, the marks `›` and `‹`; `spanRows` and `STYLE` for a message (the label `message`, bold, in the theme's `claude` colour, the body indented under it in the normal colour).

**A session whose installed mod is older** (0.7.3 or before: every non-empty value makes its view step aside, and its message tool registers from 8), under U2b's build:

| route | who draws the to-human view |
|---|---|
| a session MAWS runs | MAWS. At launch the install record names a release older than the first that draws at 9, so `drawnBy` is `'maws'` and the launch advertises 8: the mod steps aside and registers its tool, and the mirror draws. Nothing is drawn twice and nothing is missing |
| a terminal session | MAWS, by the mirror, as for every terminal session whatever the mod: no surface is attached, so no mod can draw in the window. In the terminal itself the mod draws as it always has |
| a session on another machine | MAWS, by the mirror, as for every such session. Whether that machine's own window is drawn by the mod is decided there, by its build and its mod |

So the wave's acceptance holds with the mod's pull request unmerged: A12 to A14 by the mirror on every route, and only A15 waits for the merged mod. This landing changes nothing of this: after it, every launch still advertises 8 and MAWS still draws its own report.

## Cost on a long transcript

A turn can hold hundreds of calls. What is measured for the transcript today, and what this landing can move:

| what | where | when it runs | can this landing move it |
|---|---|---|---|
| Derivation: a 500-turn synthetic session derives in under 300 ms; a delta batch's median is under 2 ms (recorded at C6: about 74 ms and 0.06 ms) | `src/renderer/src/transcript/model/perf.test.ts` | only by hand, behind `MAWS_PERF=1`; in no gate | yes, slightly: the caption is one pass over a run's cells where `phrasesOf` was one, plus one pass over a closed turn's cells; the segments are computed in the view, for an opened run only. Concrete Steps 5 reads it before and after on the VM |
| No derivation of a folded turn during live token batches; one turn derived per toggle | `transcript/surface/assistant-ink.test.tsx`, `stores/transcript.test.ts`, `derive.test.ts` (counts of `turnDerivations`, class 1a) | every gate | it must not: decision 9 removes the one place a view derived a turn to phrase it. A failure here is a defect of this landing |
| Anchoring while 500 turns stream: no scroll jump, drift at most 1 px, at most 40 mounted rows | `e2e/transcript.spec.ts`, "anchoring", unconditional | the `transcript` e2e group, on a Mac | possibly the 40: a folded run is about 32 px where a flat group was one tall row, so an opened turn of many short runs puts more rows in a window. The scene's own session opens one old turn; whether it nears 40 is read on the architect's run. An executor does not raise the number |
| The same scene's frame times and load time | the same, behind `MAWS_TRANSCRIPT_PERF=1` | only by hand on a quiet Mac | downward if at all: a folded run mounts one line where it mounted every call |
| Delta to frame, p50 and p95 against the P5 baseline (OX7) | `e2e/local-latency.spec.ts`, `test/support/local-latency.ts` | the measured lane on the home Mac | no: its stub engine sends text deltas only, so no run, thought or caption is in its path |

What does not change: an opened run of N calls is one virtual row that mounts N call rows, which is what a group mounts today, always; the owner's answer is that it is not bounded, and Desktop bounds none (check 8). Folded is strictly less. An opened run asks one `ToolUse` site per call where a surface is attached, as today's group does on mount. The waiting line costs one memoised selector per mounted run and one map lookup per call of it when the list changes.

What U2b must weigh and this landing does not touch: the mirror is a pass over the derived rows per change of them, as `reportRows` is today; where the mod draws, rows it hides have no height, and a virtual list fills a window with as many as fit (the section's check 5).

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The Electron e2e groups the change crosses**, on a Mac under the load rule, each edited or new scene first alone: `transcript` (the edited scenes and the three new ones of M5), `to-human` (it draws an opened record's turn line), `code`, `agents`, `tools` and `remote` (each presses a turn's line or a call's row). Each group's own script builds what it needs (`pnpm e2e:<group>`). And the pool's `desk-web` group for the two desk scenes (Reported, 3).
2. **The measured half of the anchoring scene**, `MAWS_TRANSCRIPT_PERF=1` on a quiet Mac, on master and on the branch, and the reading of mounted rows against 40 (Cost). Needs: about ten minutes of an idle Mac twice.
3. **OX7** on the wave's final build, with the other measured cases (parent acceptance 5). Not expected to move.
4. **Two builds**: this build's window on a session an engine host of build F runs, and F's window on this build's, each through a turn that thinks before a tool: no gap row, no refused event, the thought drawn. It rides the cross-build scene U3a's document names for `arrival`; a skipped scene is not evidence. Nothing is added to U13a's coverage table.
5. **The same session by three real routes** (A1's last sentence as the owner will see it): one session MAWS runs, the same session watched from a terminal's bridge, and from another machine. The unit proof stands in for it until U14's sitting or the owner's.
6. **The look** of an opened run with a thought line that opens and one that does not, a waiting line, and a failed row's reason, on the built window in the light theme, read against the frames the owner answered on (the drawn example stays outside the repository; nothing is copied from it). Needs: the harness build and the M5 event fixture.
7. **The owner's sitting.** Scenes this landing gives the scene script: a long turn while it runs (runs fold; the line follows the running call; a thought's label); the same turn opened (thought lines at their places, none shorter than ten seconds); the closed turns' lines; a permission prompt while its run is folded (the line; the card's place is U1b's); a document edited several times with one failure; a shell call with no description.

No further drawn example is needed before this landing is built: the owner looked at the nine frames on 2026-11-12 and answered all five questions, and the details settled since (Reported, 4, 5, 7, 8 and 11) are words and one glyph, which the sitting shows on the build.

## The pull request

One pull request from `ux-wave/U2` to master, opened by the architect after the review. Its body names: the composite's path, child U2, landing U2a and the parent pin; the class 1a run (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u2a`); the review's verdict with what was dismissed or deferred; the e2e groups run and where; the residue (the tracker rows of the record; anything of "Reported" still open); and that U2b follows. It carries the dated amendments of "The record". It ends with the trailer the build brief gives.

## Surprises & Discoveries

- Observation: the same session groups differently live and from its file today, because only the live route knows that the person allowed a call.
  Evidence: `classifyTool` reads `humanDecision`, which `deriveTurn` sets from `permission.resolved`; `recordToEvents` emits no such event.
- Observation: the desk web app draws the renderer's rows, so the run's row changes there as well.
  Evidence: `apps/desk-web/src/depth/view/TranscriptPane.tsx` imports `Transcript` and `drawnRows`; `apps/desk-web/e2e/stream-scroll.spec.ts` presses `.transcript-group-header`.
- Observation: no bound on mounted rows was recorded by the P5 phase; the nearest are OX7 and the anchoring scene's 40.
  Evidence: `docs/doperpowers/plans/2026-10-27-p5-org.md` (OX7; Decision Log 33 and 269); `e2e/transcript.spec.ts`, "anchoring".
- Observation: U1a does not word a waiting call's row; U1b does.
  Evidence: U1a's document, the edge table's row for l4-approvals-04; no "Waiting for approval" in it or on master.
- Observation: `artifact_edit`'s result names no title, and X9 freezes result shapes.
  Evidence: `ArtifactEditResult` in `src/shared/maws/document-tools.ts`; root UC-15.
- Observation: Desktop's rows renderer opens a group at first sight only for tools MAWS's engine does not send, or behind a flag.
  Evidence: `web/app/v1/c96d752d0-CjYhuD9j.js:73934-73964` and the predicates it imports (`cb27dab29-D71j-cI3.js`, `c52b02f3f-C1Vcib4H.js`).

## Decision Log

- **2026-11-13 · Verification.** This document gets an adversarial review before an executor starts (the architect dispatches it), and one pass by its author over "To check again" once U3a and U1a are on master. The branch gets the xhigh panel of `doperpowers:review-code`: it is over twenty files and two thousand changed lines before the snapshots, it is the surface the owner reads most, and three children write the transcript's model (UC-3). The lenses to give the panel: (1) three routes, one drawing: the same recording by the wire, the file and another machine's rows, and what an engine host of build F changes; (2) the run's state machine and identity: membership, the single call, a run that grows, ids and open state through a stream, a jump's target, the request's slot row; (3) the caption against Desktop's builder at the cited lines: kinds, counting, marks, the merged file, the cap, the turn's order; (4) the wire: the optional key, the tolerant read both ways, the minor and the generated files, nothing stored; (5) cost: no derivation from a view, what a folded and an opened run mount, the selector per run, the virtual list's estimates and the anchoring scene; (6) the mods client: what is asked of `ToolGroup` and `ToolUse` and when, nothing of MAWS's drawn in a mod's place; (7) the record and the keeps: each reversed ruling amended where it stands, l2-transcript-14, -10 and -17 untouched, every string as the section gives it, nothing of the owner's in a fixture; (8) the meeting with landings in flight: U4a's insertions, U5a's row, U3a's rows, the snapshots after a merge. Class 1a on GitHub Actions is the gate of record.

## Outcomes & Retrospective

Pending — written at finish.
