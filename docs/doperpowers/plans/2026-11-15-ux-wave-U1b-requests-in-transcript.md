# UX wave · U1b · requests drawn in the transcript, and the answer row (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U1**, second landing (**U1b**), parent pin master `3f2c4fca1197ea75570d022c05049604320e7ee4`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`: Edges → Landings ("U1b for the placement: l4-approvals-08, -07 and -04, O-17, l2-transcript-10, O-21 and the row of O-22"); Contracts → UC-1 (owned; built by U1a), UC-2, UC-3, UC-6, UC-7, UC-9; acceptance A2, A4 to A9, the parts of A3, A5, A10 and A18 that U1a's edge table leaves to the placement; the items l4-approvals-08 (but Dismiss's act, built by U1a), l4-approvals-07, l4-approvals-04, O-17, l2-transcript-10, O-22 (the row), O-21; "Probes and checks" ("a row that mounts a card far from the end"); "Rulings reversed" (l4-approvals-08's placement, O-17). In the root: Purpose, the wave's laws, UC-1, UC-2, UC-3, UC-6 to UC-11, UC-14, and the Decision Log's "Settled between sections at assembly". Where the child's file and the root differ, the root binds.
> This document holds what the design does not: the landing's edge, what the code holds at the pin, the decisions the section left open, the interfaces, and the execution. It was written against the code at the pin, which is the code of build `2c7044231` (`git diff 2c7044231 3f2c4fca1 -- src apps e2e` is empty: the 22 commits between them are documents). **Branch:** `ux-wave/U1b`. **Board:** ticket 586 (the wave's epic is 573). The first landing's document is `docs/doperpowers/plans/2026-11-12-ux-wave-U1a-requests.md`; its words ("attention item", "the holder", "the controls port", "placement", "a fresh press") are used here as it defines them.

## Purpose

After this landing a request no longer takes the composer away. Today the session's oldest request stands in the composer's place under a frame that reads "… · Composer paused · draft preserved": to say anything the person must first answer, and to stop the turn they must choose "Deny and stop". A question that blocks nothing (a terminal session's asynchronous question) takes the composer all the same, and MAWS's own ask shows three times: a capsule, a notice above the composer, and a side sheet that opens by itself over whatever was open there.

After it:

- **A question's form is in the transcript, in the row of the call that asked it**: the engine's AskUserQuestion, the sminos ask (blocking or not), MAWS's own ask and a plan. Submitting turns the form into the row's answer lines.
- **A permission prompt is one card at the transcript's end**, with the others that wait as one line each under "Also waiting". The call's own row reads "Waiting for approval: `cmd`" with no spinner and no timer.
- **The composer and Stop are there the whole time.** A message sent while a request waits is a message; it answers nothing.
- **What waits out of view is named**: a card "Waiting for you" in the card column lists the session's waiting requests, and the jump button reads "Needs your input". Either one scrolls to the request and puts the keyboard on it.
- **A terminal session's asynchronous question shows its answer on its own row** ("header → answer", or "Dismissed"), on this machine, on another machine and after a reload, in place of the row reading "Not answered" for good.
- **Nothing above the composer reminds of a question, and the Question sheet opens only when the person opens it.**

How to see it working: the unit suites named per milestone, and the Electron e2e groups under "Proof that an executor does not run", whose scenes hold a prompt open and type into the composer beside it, answer a question in its row twenty rows above the end, and find the answer of an asynchronous question on its row after a reload.

## Progress

- [x] (2026-11-15) The child's file checked against the code at `3f2c4fca1`; this document written; the points under "Reported to the architect" handed back with it.
- [ ] The adversarial review of this document, and the architect's rulings on the reported points, folded in.
- [ ] The owner's look at the drawn example ("The look"), before M2 starts.
- [ ] M1 — The rows know what waits and what was answered.
- [ ] M2 — The cutover: forms in their rows, the card at the end, the dock gone.
- [ ] M3 — A prompt's keys from the composer and from no focus.
- [ ] M4 — Finding what waits: the card, the jump button, the way there.
- [ ] M5 — MAWS's ask: nothing opens by itself.
- [ ] M6 — The e2e edits, the record and the acceptance run.
- [ ] Handed back to the architect: the branch review, class 1a, the Electron e2e groups, the pull request.

## What this document assumes of landings in flight

One list, checked again by the executor at step 1 of Concrete Steps and by the builder of M6 after the last merge of master. Each line says what is assumed, and what to do when it no longer holds.

| landing | state at authoring | what this document assumes | if it has changed |
|---|---|---|---|
| **U6d** (`origin/ux-wave/U6d`, built, in review) | edits `transcript/view/markdown/Link.tsx`, `transcript/view/context.tsx` (four lines), `transcript/view/transcript.css` (nine lines), and adds three lines of exports to `transcript/index.ts` with its frozen-surface test `transcript/index.test.ts` | this landing adds **no export** to `transcript/index.ts` and edits neither `Link.tsx` nor `context.tsx`; in `transcript.css` it appends rules of its own and changes none | a conflict in `transcript.css` is two appended blocks, keep both; if this landing is found to need an export after all, it is added to the test's list after U6d's |
| **U6b-1** (`origin/ux-wave/U6b`, in build) | edits `transcript/view/context.tsx` (five lines), `transcript/view/markdown/Link.tsx`, and the tests `request-card/RequestCard.test.tsx` (15 lines), `transcript/view/TranscriptSlot.test.tsx` (4), `panel/summary/Summary.test.tsx` (8) | the same three test files are edited here too (M2, M4); whichever of the two lands second merges master and keeps both sets of cases | read U6b-1's cases in `RequestCard.test.tsx` before rewriting the docked cases there; none of them is deleted |
| **U2b** (`origin/ux-wave/U2b`, document in authoring; no commit at authoring) | the to-human view: its working record folds a turn's work; UC-3 binds it to keep a row that holds a waiting request out of every fold and to ask no mod's site for it | **what this landing needs from U2b:** nothing to land first. A fold U2b builds keeps a row for which `isPersistentRow(row)` holds (`transcript/model/derive.ts`), or tests `row.waiting === true` itself. **What U2b may rely on from this landing:** the rows of kind `question`, `ask` and `plan` carry `waiting: true` exactly while a waiting request joins them (Interfaces §B); `isPersistentRow` answers true for every such row; a row so marked asks no mod's site (the row's own view sees to it, Interfaces §D); the card at the transcript's end is a row with no turn, appended after the view's projection, so no projection of a turn can fold it (Interfaces §C); `SessionPane.tsx` keeps the `ReportBar` mount where it is (U2b removes it, UC-8) | if U2b lands first and its projection no longer calls `isPersistentRow`, M1's test "a waiting plan row stays in view in the to-human view" is written against U2b's projection, and the one condition it needs there is an insertion in U2's file, reported |
| **U1c**, **U1d** | not started | nothing | — |

## The landing's edge

| part of U1 | this landing | left to |
|---|---|---|
| l4-approvals-08, "Two places", "One list", "The composer while a request waits", "Several at once", "The waiting-requests card", "What goes", "A pane with no transcript", "Unchanged placements" | in full | — |
| l4-approvals-08, "Dismiss" | the row's receipt "Dismissed" on every route that has a row; a message sent while a blocking question waits (A18's first sentence), which the free composer makes possible | the act itself is U1a's and is not changed; the dismissal of a terminal session's asynchronous question on another machine stays a debt row (two repositories) |
| l4-approvals-07 | in full | — |
| l4-approvals-04 | the call's own row; the folded run's line is U2a's and is not edited | a running call's timer counting from the approval (the child's "Not included") |
| O-17 | in full, with U8b's transitional code in `tools/maws/ask/connect.ts` removed | tabs in the side column (U8, built) |
| l2-transcript-10 | in full; the follow behaviour is a keep and is not changed | — |
| O-22 | "its form is drawn in the row of the call", "the composer is free", "never docked" | making the sminos ask available in a session MAWS runs (O-19; U1d and a later ticket) |
| O-21 | in full; the answer's own line (U3a's `answer` notice) stops staying in view through a fold, U3a's hand-over | whether that line is derived at all where the row carries the answer (Reported, 3) |
| A3, the guards U1a left | focus in the composer or on nothing, ⌘↩ yielding to a draft, a prompt out of view, Esc ahead of the composer's own | — |
| #358's third point | the answers the person just gave, on the row, until the transcript's own row carries them | — |
| UC-1's line "Waiting for you · N" where a session is shown without its transcript | in full | — |
| "Probes and checks": a row that mounts a card far from the end | a scene on a Mac, before the pull request (Proof, 3) | — |
| "Rulings reversed" | l4-approvals-08's placement (charter §13 X4; C7's "Placements"); O-17 (E1's M4b) | — |
| A15, l4-approvals-12 | nothing | U1c |
| O-19, #420 | nothing | U1d |

Acceptance lines by number, with their routes, are under "Acceptance".

## Words used here

- **The list:** a session's waiting requests: every attention item of the session for which `waitsOnAnswer` holds (`src/shared/attention/kinds.ts`: it waits, and it names a request), oldest first. It is the predicate U8b's column already uses to decide whether the waiting-requests card is present.
- **A form:** what a question, MAWS's ask or a plan is answered in. **A prompt:** a permission prompt. **A card:** the one request card component (`src/renderer/src/request-card/RequestCard.tsx`), whatever it shows.
- **The call's row:** the transcript row of the tool call that raised a request: a `question` row (the engine's AskUserQuestion and the sminos ask), an `ask` row (MAWS's ask; its view is the capsule, `transcript/view/rows/AskCapsule.tsx`) or a `plan` row. **A waiting row** is such a row while a request of the list joins it by the call's id.
- **The end row:** one row with no turn, appended after every other row of a transcript while a request of the list has its place at the end. It is the child's "region at the transcript's end".
- **A place:** where a request of the list is drawn in one transcript: `row` or `end` (Interfaces §A).
- **The host seam:** the transcript's one way to let its host draw a row: a row of kind `request_slot` is drawn by the function the host gave as `renderRequest` (`TranscriptProps`, `registerRequestRenderer`). Desk web draws the tail of its session view through it.
- **The dock:** `DockedCardFrame` in the composer's place (`src/renderer/src/composer/docked/`). After this landing only the trust, relay-down and failed-start cards use it (`sessions/SetupCard.tsx`).
- **A mod's site:** an ask of the engine's surface for a component (`SurfaceRow`, `src/renderer/src/engine-surface/`), by which a mod can rewrite or draw a row (law 2).
- **The routes** (law 5): *runs* (a session MAWS runs on this machine), *terminal* (a terminal session, through its sminos bridge), *remote* (a session on another machine, of either kind). **Build F** is `f1852de3a`; **the master build** is `2c7044231`; the owner's machines run the second and keep the first to go back to.

## Constraints that bind every milestone

- **The build brief's rules** (`~/.local/share/maws-ux-wave/briefs/build-common.md`) bind as written: no typecheck, lint, test, install, build or Electron on the MacBook; every check runs on the wave's build VM through `~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- '<command>'` on the pushed head, under a time limit; commits end with the trailer the brief gives; an executor opens no pull request, runs no `scripts/ci-gate.sh` and starts no Electron e2e. The VM is shared with a landing in build: a slow or timed-out check is read against its load first.
- **UC-1.** Whether a request waits is said by the session's list alone. No row, card, button or component keeps a mark of its own that a request was answered; what is drawn after an answer is a receipt, never a request (Interfaces §D, "After the answer").
- **UC-3.** The files under `src/renderer/src/transcript/` have one writer at a time. This landing's parts are the question, ask and plan rows, the end row, the waiting state of a call's row and the request state of the jump button. `transcript/model/groups.ts`, `classify.ts`, the group row and `src/renderer/src/owner/` are U2's and are not edited; `transcript/view/markdown/` and `transcript/index.ts` are not edited (see the list of landings in flight).
- **Law 2.** A question's form and its receipt each pass through the engine's `AskUserQuestion` site once: the form through the card's own ask (`RequestCardFor`, as today), the receipt through the row's (`SurfaceQuestionRow`). A waiting row asks no site of its own, so one instance is never asked twice at once.
- **Law 5.** Every acceptance line is in the routes table under "Acceptance"; "not on this route" has its reason there.
- **Law 6.** Nothing here rests on engine behaviour that is not recorded: the deliveries of an asynchronous answer on the fixtures U3a's reader is tested against (`src/shared/engine/arrival.test.ts`, `renderer/src/lane-a/arrival-routes.test.ts`); the bridge's dismissal and its settlement on the contract of sminos 1.47.0 (U1a's Interfaces §G). No engine runs on the MacBook; a fact the fixtures under `spikes/protocol-probe/fixtures/` do not hold goes to the architect as a probe to arrange.
- **Law 8, keeps.** l4-approvals-03 (Deny with a reason, Deny and stop), -06 (the Question sheet's form), -10 (answering from the Overview card), -14 (who asks, how many wait), l2-transcript-10 (the follow behaviour: when the list follows and when it stops). A change that would alter one stops and reports.
- **UC-6.** A key is a row of `ACTIONS` (`src/shared/keymap/actions.ts`) delivered by the dispatcher. This landing adds no row and no listener of its own; it adds two options of a binding in U6's files (Interfaces §F, §I).
- **UC-7.** No command, offer or capability is added, and no schema of one changes (Interfaces §H).
- **UC-8.** Every edit in a file another child owns is in Interfaces §I, with its owner.
- **UC-11.** Tests, fixtures and scenes use made-up commands, questions, paths and names. A fault is never reproduced by reading the content of a person's session, transcript, journal or settings file: structure and counts only, and none of it enters the repository.
- **UC-14.** Nothing is stored: no layout key, neither settings file, no wire minor (Interfaces §H).
- **Desk web stays as it is.** `apps/desk-web` imports the card's parts from `src/renderer/src/request-card/` and draws its session tail through the host seam: their exports and props stay, and a transcript with no waiting input draws exactly what it draws today.
- **Light theme and tokens only**; today's shapes (law 7). The tokens guard reads `#` followed by three to eight hex digits as a colour in renderer source: a ticket is written in words there.
- **The renderer's guard on source text.** Run `test/support/tokens-guard.test.ts` with the tests of any milestone that adds renderer source.

## What the code holds at the pin (read at `3f2c4fca1`)

The child's file was grounded on an earlier master. Each statement this landing rests on, as the code has it now. "✓" holds as the child says; **changed** says what differs.

| | statement | where | holds |
|---|---|---|---|
| C1 | The session's oldest answerable request takes the composer's place: `swapOf` picks it, `Composer.tsx` hides the editor behind it ("the docked swap", `docked = card !== null \|\| settling !== null`), `DockedCardFrame` titles it "… · Composer paused · draft preserved", and "N more waiting" stands under it | `composer/docked/swap.ts`, `composer/Composer.tsx`, `composer/docked/DockedCardFrame.tsx` | ✓ |
| C2 | While a card is docked the composer's ports answer for a covered box: `draftShown`, the prompt port's `fill`, dictation's `begin`, a take-back's `load`, all through `promptState.current.docked` | `composer/Composer.tsx` | ✓; they keep answering for the three setup cards |
| C3 | A session with no registered composer docks its request in the pane itself (`DockedRequest`, the fallback path) | `session/SessionPane.tsx` | ✓ |
| C4 | Only the engine's live request events make a row for a request: `deriveTurn` emits a `request_slot` row at each of the five `*.requested` events while `state.pending` holds the request, and the loose-event walk does the same; while it is pending the question or plan row itself is withheld (`requestOrHistoricalRow` returns null) | `transcript/model/derive.ts` | ✓ |
| C5 | The slot row is drawn by the registered renderer: the pointer "Waiting for you · … · answer below ↓" while a dock of its session shows that request, else the full inline card | `request-card/inline.tsx`, `request-card/InlinePointer.tsx` | ✓ |
| C6 | **The row kind `request_slot` cannot be retired.** Desk web builds rows of that kind itself, with no turn, for the tail of its session view, and draws them through `renderRequest` ("the one seam MAWS's list offers for a row of the host's own") | `apps/desk-web/src/views/project/tail/session-tail.tsx`, `apps/desk-web/src/depth/view/TranscriptPane.tsx` | **changed** against the child's "the slot row made from the engine's request events is retired": the derivation is retired, the kind and the seam stay (decision 3) |
| C7 | MAWS's blocking ask is a notice above the composer; its sheet opens by itself, at once when its session is shown and later when the person arrives there; U8b's transitional code remembers the tab the sheet replaced and gives it back; U7b's `asked: 'agent'` rides the automatic `addTool` | `composer/docked/swap.ts`, `tools/maws/ask/connect.ts` | ✓ |
| C8 | The words "Waiting for approval: …" are `waitingLabel(cell)`; a folded run's line already reads them, from the session's waiting calls read in the view (`selectWaitingByCall` through `useRowSession`) | `transcript/model/copy.ts`, `transcript/view/rows/Group.tsx` | ✓ (U2a). No call's own row reads them yet |
| C9 | A waiting request's slot that arrives while a run is open is carried past the run | `transcript/model/groups.ts` | ✓ (U2a's decision 18). After this landing no slot is made inside a turn, the carry finds nothing, and it stays (U2a's C11 says so) |
| C10 | **The delivery of an asynchronous answer is already read on every route.** U3a's reader gives class `answer` (`call`, `summary`, `dismissed`) from the plugin's prompt and from a hook's context, the file reader and the reader of another machine's rows both call it, and the transcript draws one `notice` row "answered: …" for it, kept in view through a fold "until U1b" | `src/shared/engine/arrival.ts`, `ask-delivery.ts`; `transcript/model/derive.ts` (`noticeOf`, `isPersistentNotice`) | **changed** against the child's O-21 "Today (2)": the bubble with the engine's framing text is gone since U3a. What remains is (1): the question's own row reads "Not answered" for good |
| C11 | A turn's line reads "Worked for" for a turn an answer opened, by reading `opener.class`, which is taken from the turn's head row | `transcript/model/copy.ts`, `derive.ts` | ✓ (U2a). This landing keeps the `answer` notice derived, so the head row and `opener` are untouched (decision 9; ticket 586's first comment) |
| C12 | An ask whose result is a refusal that reads stopped is `cancelled` with `cancelReason: 'withdrawn'` | `transcript/model/derive.ts` (`resultOfAsk`, `askRow`) | ✓ (U2a's insertion; kept: ticket 586's second comment) |
| C13 | `question` and `ask` rows stay in view when their turn folds; a `plan` row does not | `transcript/model/derive.ts` (`isPersistentRow`); the to-human projection reads the same function (`owner/report/project.ts`) | ✓ |
| C14 | The card column mounts the slot `sessionCardWaiting` first, only while `selectPendingOf(…).some(waitsOnAnswer)`; nothing is registered in it | `app/slots.ts`, `panel/summary/Summary.tsx` | ✓ (U8b) |
| C15 | The dispatcher is one capture listener on the window and tries the table's rows in order; a pane-scope row is refused when the key's target is a text field, inside a key sink, or a button or link, and its binding must contain both the target and the focused element. `request.allowOnce` stands before `composer.queue` in the table; the composer's Esc and Enter are `fixed` rows its editor handles itself | `renderer/src/keymap/dispatcher.ts`, `shared/keymap/actions.ts` | ✓. So no prompt key can come from the composer or from an unfocused page today (Interfaces §F) |
| C16 | A terminal session's settlements are in its lane A state (`settled`, the last hundred: `request`, `winner`, `outcome`, `by`), on this machine and mirrored for another machine's; `settledWords` words them | `shared/ipc/schema/lane-a.ts`, `renderer/src/lane-a/race.ts` | ✓ |
| C17 | For an asynchronous question the bridge's request id is the ask's id, which is the tool-use id of the call (`id: e.tool_use_id ?? …`; raised under `note.id`); MAWS's item takes `toolUseId` from the raise, else the request id | the installed sminos 1.47.0, `hooks/mods/ask.tsx`, `hooks/mods/bridge-requests.tsx`; `shared/lane-a/attention-entry.ts` | ✓; so a settlement names the question's row by `request` alone (decision 8) |
| C18 | The compact composer of a closed floating card shows no transcript (`SessionPane`'s `compact`); a new request of kind permission, question, plan, elicitation or dialog opens the card | `shell/FloatingPill.tsx`, `session/SessionPane.tsx`, `shell/floating.ts` (`RAISING`) | ✓ |
| C19 | A thread's transcript mounted without the session's pane (the comment card's thread, the Side pane's thread view, a subagent's drill-in) draws its requests through the same slot row and renderer | `side/card/`, `tools/agents/subagents/DrillIn.tsx` (`renderInlineRequest`) | ✓; they follow the cutover without an edit of their own, by the same seam |
| C20 | The card harness page has a `docked` placement of its own, which the scenes of `e2e/requests.spec.ts` stand in | `renderer/src/harness/`, `e2e/requests.spec.ts` | ✓; M6 gives the page the placement at a transcript's end |
| C21 | The installed sminos plugin (1.47.0) declares `decide.dismiss` available, its decision route takes `behavior: "dismiss"`, and its daemon's `decide` takes allow or deny only, as MAWS's `RpcArgs.decide` does | `~/.claude/plugins/cache/doperpowers/sminos/1.47.0/hooks/mods/bridge-controls.tsx`, `skills/sminos/scripts/sminos_bridge.py`, `sminos_rpc.py`; `apps/desk-hub/src/protocol/rpc.ts` | ✓. No change in that repository is owed by this landing; the dismissal on another machine stays the debt row U1a logged |

## Decisions settled at authoring

Means the child's file leaves open. Each with its reason and the alternative that lost.

1. **The transcript's end is a row.** The end row is appended after every other row and drawn by the virtual list like any row, so the list measures it, follows it and anchors around it by the rules it already has. The alternative, an element after the list's sizer inside the scroller, lost: the follow rule reads the sizer as the scroller's first child and compares its committed height with the virtualiser's total (`pinEnd` in `transcript/view/Transcript.tsx`), and a second height beside it would have to be taught to each of those comparisons, in the code the owner marked keep.
2. **The mark is in the model; the drawing is read from the list.** Which rows are waiting rows is an input of the transcript's derivation (`ui.waitingForms`, Interfaces §B), so that every fold decides from the row alone (C13). What the row then draws is the card for the list's item, read in the view as the run's line already reads it (C8). The alternative, the view alone, lost: a plan row inside a turn the reader collapsed, or inside the to-human view's working record, would be folded away with its form.
3. **One seam, unchanged.** The form of a waiting row and the end row are both drawn through the host seam that exists (C6): the row's view hands the renderer a slot value for its request; the end row is a slot row with a reserved request id. No export is added to `transcript/index.ts` and `TranscriptProps` does not change, so desk web and U6d's frozen-surface test are untouched. The alternative, a second registered renderer for forms and a component slot for the end, lost: two more public names for the same act.
4. **The list is `waitsOnAnswer`.** One predicate decides the list, the column's presence line (C14) and the jump button, so the card is never mounted with nothing to show. An item of the to-human view (a question left there, a must-read) names no request and is not in the list: its card stands at its mark, as today.
5. **A request's place** is decided per transcript: `row` when this transcript draws a waiting row for the call it names; else `end` (Interfaces §A). So a question whose row's page is not loaded, a subagent's question seen from its parent, and a request the bridge gave no call id are at the end without a rule of their own, and move to their row when it is drawn.
6. **The keyboard goes to the request's row, not to a control inside it.** "Puts focus on it" is the transcript row that holds the request (the waiting row, or the end row), which is focusable already and is the element the store's jump focuses. From there every key of the request acts, and Tab enters its controls. The child says "the open card's primary button, or the form's first option"; that lost because the dispatcher refuses a request's key from a button or a radio by design (C15), so Esc, the digits and ↩ would be dead exactly after a jump (Reported, 2).
7. **A prompt's keys stay in the keymap.** The three chords reach a prompt from the composer and from an unfocused page through two options of a binding (Interfaces §F), an insertion in U6's dispatcher like U1a's `fresh`. The alternative is Claude Desktop's own capture listener on the card; it lost because it would be a second path beside the one keymap (UC-6): a rebinding would not follow it, and the order between it and the composer's keys would rest on which listener was added first.
8. **Between the answer and the transcript's own row, the row says what is known**, in this order: the transcript's answer; the answers this window sent; for a terminal session, the bridge's settlement, found by the call's id (C17): withdrawn by other than the bridge reads "Dismissed", answered elsewhere reads the settlement's own words ("Answered in the terminal"); else "Not answered". The settlement survives a reload and is the same in every window of the machine, which is why it is read before giving up; the window's own answers are the only source of the answer's text before the delivery. All three reach the row as one value in the attention store (Interfaces §G), because a row's view must not import the lane A store: it imports MAWS's IPC client, and desk web bundles the rows.
9. **The answer's own line stays derived and folds with its turn.** U3a's `answer` notice leaves the rows a fold keeps (the hand-over) and nothing else about it changes: it stands at the head of the turn in which the answer reached the agent, visible when that turn is open. Not deriving it where the row carries the answer is what the child recommends to U3; it lost here because the notice is the head row a turn's `opener` is read from (C11), because a page of history loaded later would have to take a line away from a turn already drawn, and because where the answer reached the agent is a fact the row above cannot say (Reported, 3).
10. **A question dismissed or declined whole keeps its lines, each reading "Dismissed".** An answered receipt is one line per question; a dismissed one keeps the shape and says the one word (the owner's card 2 can change it to a single line). On MAWS's ask the capsule's state word reads "Dismissed" and its lines read "Skipped", as the child says.
11. **The frame's later-commit focus hand-over goes with the dock.** U1a's decision 17 kept a mark alive for a frame so that the next prompt's frame could take the focus a commit later. No request mounts a frame now; the three setup cards keep the same-commit hand-over C7 built. The tracker row of 2026-11-13 on that mark is closed as moot.
12. **`state.pending` stays** in the transcript's state (U2's `groupInput` reads it); only the rows made from it go.
13. **Which card is open at the end** is the component's own state: the oldest by default; a line the person chose stays open until it is answered; then the oldest remaining. It is not stored and not shared between two panes of one session.
14. **What the composer still shows above itself** is the oldest waiting notice that names no request: an error, an interruption, "auto mode unavailable". A request the app cannot read or answer (an undeclared dialog, a request whose read failed) is in the list and is drawn at the end, with the card's own "The request could not be read" and Retry.
15. **A child's transcript lists its own agent's requests only**; the parent's lists all of the session's, the agents' among them at its end, named "from <agent>" by the card as today.
16. **The harness's `docked` placement for a request becomes a transcript's end** (C20), so that `e2e:requests` stands where the app draws.
17. **A card's delivery is held by the request, not by the element.** The answer in flight, its failure with Retry and "Already answered elsewhere" live in the attention store under the item's id (Interfaces §G). A row of the list unmounts when it is scrolled far away, and a card whose answer was in flight would otherwise come back looking unanswered, or lose a failed write without a word. The alternative, pinning every waiting row mounted in the virtualiser, lost: it changes which rows the list mounts, in the code whose behaviour is a keep, to save a move of three values into a store.

## Reported to the architect

Each with its evidence, the default this document builds, and the one place a ruling changes.

1. **Insertions in files other children own that UC-8's table does not name.** The table gives U1 one kind of insertion in U6's keymap files (`fresh`) and none in U4's composer beyond two test gestures. The placement needs more, because the composer is U4's and stays mounted: in `composer/Composer.tsx` the request half of "the docked swap" is removed (the editor is no longer hidden for a request) and the composer's port gains one member; in `composer/docked/` (U1's) the swap shrinks. In U6's `keymap/useKeyChord.ts` and `dispatcher.ts` a binding gains two options (Interfaces §F). In `attention/navigation.ts` (no child) the open of a Needs-you row calls `showWaiting`. The full list is Interfaces §I. *Default:* built as listed. *A ruling changes:* §I's rows, and for the keys, decision 7.
2. **Where the keyboard lands.** The child: "puts focus on it: the open card's primary button, or the form's first option". Evidence: `refused()` in `keymap/dispatcher.ts` refuses a pane-scope key whose target is a button, a link or a button-like input, so with the keyboard on "Allow once" Esc would not deny, and on a radio ↩ and the digits would not act. *Default:* decision 6, the request's row. *A ruling changes:* `showWaiting`'s last step (Interfaces §E).
3. **The answer's own line.** The child leaves it to U3 and recommends none where the row is in the transcript; U3a draws one and handed its staying-through-a-fold to this landing; ticket 586 asks that `opener` survive. *Default:* decision 9: derived as today, no longer kept through a fold. *A ruling changes:* M1's one term in `isPersistentNotice`, and, if the line is to go where the row is held, a new decision there with `opener` read from the arrival.
4. **The child's O-21 "Today" is half built already** (C10), and "the slot row … is retired" cannot hold for the row kind (C6). No ruling asked: the spec's sentences are the architect's to correct.
5. **A dismissed asynchronous question after a reload, before its delivery.** The row reads "Dismissed" from the bridge's settlement while the lane A state still lists it (the last hundred settlements); a session that ends before the delivery raises the question again (the plugin's rule, a debt row since U1a), and the row then holds a form again. Nothing to rule; said so that the sitting script expects it.
6. **The allow chords and the buttons' row.** The child: a key acts when "the card is in view and has been for 400 ms", and says its guards are Claude Desktop's. Desktop holds ⌘↩ further: unless the row of decision buttons is wholly visible (`shared-192`:22950-22981; `ccbc7e432-C0cBrkw9.js:338-344`). With the card at the end of a scrolling transcript a sliver of its top can be in view while its buttons are below the fold. *Default:* Desktop's rule for the two chords that allow (Interfaces §F); Esc keeps the sliver rule. *A ruling changes:* one clause of `when`.

## The reference: how Claude Desktop places a request in its transcript

Read in `app-5.1231.2` for this document (paths under `web/app/v1/`), in the layout the owner chose: the one behind the gate `claudeai_cc_epitaxy_session_presets_main`, which the code reads as off while its value is unknown (`shared-39-DHE4OJ5E.js:744-747, 1723-1750`). What it does, and what MAWS does with it:

| | Claude Desktop | MAWS, this landing |
|---|---|---|
| where a permission card stands | inside the scroller, after the last row: a slot element (`data-inline-approval-slot`, `shared-41`:7825-7833) handed to the list as its trailing content and drawn in `data-testid="transcript-after-rows"` after the rows, inside the list's sizer (`c4a9ee384-Cvn3dOsn.js:6642-6652`). It is not one of the virtualised rows, and it scrolls away with them | the same place for the reader. **Built differently:** as the last row of the virtual list (decision 1), because MAWS's list has no trailing region and its follow rule reads one sizer |
| how the card gets there | one host element is created once and moved between the dock and the slot, the card portalled into it, so the card keeps its state as it moves (`shared-41`:7715-7733; `cc43287c9-CQ79M14o.js:76150-76182`) | **cannot do the same:** a row of MAWS's list unmounts when it is scrolled far away, and its card with it. So every state of a card that must outlive its element is held in a store by the request: the draft and the picked step (already so), and from this landing the delivery in flight and its failure (decision 17) |
| how a row knows it holds a question | by id: the call is running or awaiting approval and the pending request's `requestId` or `toolUseId` is the call's id, else by an equal input fingerprint; only the front request counts (`c96d752d0-CjYhuD9j.js:48336-48347`). The row draws a slot (`data-question-card-slot`, :48544-48548) and the dialog host portals the full card into it (`cc32965c2-Ckh25wN6.js:28927, 29059-29078`) | by the call's id alone (`request.toolUseId`); every waiting question is live at once, each in its row (the child's rule); with no id the request is a card at the end. No fingerprint: two calls with equal input would be one |
| the row after the answer | question and answer pairs; with no real answer one note: "Skipped", "Replied in chat" or "Not answered" (`c96d752d0`:48478-48521; `cb6930dae-Byq01zrW.js:608-624, 674-690`) | one line per question, "header → answer"; "Dismissed" (decision 10); a message never answers a question (the owner's answer of 2026-11-12, the child's departure) |
| "Also waiting" | each queued request a collapsed call row reading "Needs approval", with no answer controls: answered in order only (`c96d752d0`:120198-120248, 47963-47967) | one line each; any line can be opened and answered first (the child's departure: the first may be one only a terminal can answer) |
| the jump pill | "Needs your input" after a small accent dot; accessible name "Needs your input. Scroll to the request"; no tooltip; shown only away from the end; a click scrolls to the bottom and moves no focus (`cc44b66a7-OiiuFDK3.js:186-235`; `cc43287c9`:101850-101857, 102127-102179; `c9543da06-DAeewRbi.js:1235-1275`) | the same words; the waiting glyph for the dot; shown at the end too and going to the request, because a question can wait twenty turns up (the child's departures); and the keyboard goes to the request's row, which Desktop does not do (the child: "puts focus on it") |
| focus | nothing takes focus when a card appears; its arrival is announced through a status element for screen readers (`cc32965c2`:27064). After an answer, focus goes to the next card's root when it was in the card, else to the composer (`cd7e96be5`:199-245, 283-345) | the same: nothing takes focus. After an answer the keyboard stays where it was; when the element that held it leaves (the last card at the end, a form), it goes to the session's composer, as the dock's frame gave it back |
| the keys' guards | off-screen when the card's rect, clipped by every scrolling ancestor and the window, is empty: any visible sliver is in view (`shared-192`:22930-23031); a grace of 400 ms from the later of the card coming into view and an overlay over it closing (`ccbc7e432-C0cBrkw9.js:186-193, 323-328`); and ⌘↩ alone is held unless the row of decision buttons is wholly visible and has been for 400 ms (`shared-192`:22950-22981; `ccbc7e432`:338-344) | the sliver rule and the 400 ms from coming into view are the child's and are built. **The child's sentence is looser than its reference on one point**, the allow chords and the buttons' row; this document builds Desktop's (Interfaces §F; Reported, 6) |
| the composer | fully usable; it loses only the keys the card claims, Esc and ⌘↩ (`cc43287c9`:75834, 76002, 79188-79201) | the same, through the table's order (Interfaces §F) |
| the key hints at the tail | hidden outside the dock (`cc32965c2`:25466, 25550) | shown wherever the card is (the child's departure in l4-approvals-02) |

Not taken from Desktop, and not asked by the child: typed letters on a focused card going to the composer; the card's entry animation; clicks swallowed while the card moves; a height cap computed from the scroller's room (the card keeps U1a's own bounds).

## The sminos plugin

Nothing in that repository is owed by this landing. Read in the installed plugin's source (1.47.0; nothing was run): the bridge declares `decide.dismiss` available (`hooks/mods/bridge-controls.tsx`), its decision route takes `behavior: "dismiss"` for an asynchronous question (`skills/sminos/scripts/sminos_bridge.py`), and U1a sends it (`src/services/lane-a/decisions.ts`). Two things stay as U1a logged them, each a debt row that needs both repositories: the daemon's `decide` takes allow or deny only (`skills/sminos/scripts/sminos_rpc.py`; MAWS's `RpcArgs.decide` in `apps/desk-hub/src/protocol/rpc.ts`), so a terminal session on another machine has Dismiss drawn disabled with its reason; and a dismissal whose session ends before its delivery is raised again on resume.

A session keeps the bridge it started with. Until a session's bridge is 1.47.0, Dismiss on its asynchronous question is drawn disabled with "Dismiss it in the terminal" (U1a), nothing is sent, and the form stays in its row. A dismissal made in that terminal still settles `withdrawn` by `terminal`, so the row reads "Dismissed" there too (decision 8).

## Acceptance

Each is behaviour a person or a test can see. The child's line it satisfies is in brackets. Unit proofs are named in the milestones; scenes in "Proof that an executor does not run".

1. **A prompt at the end** [A2, A9, A16]. In a mode that asks, the agent runs a shell command. One card stands after the transcript's last row; the composer takes text and Stop is there; the call's row reads "Waiting for approval: `cmd`" with the waiting glyph and no spinner, timer or line counts; when the call is inside a folded run the run stays folded and its line reads the same (U2a's, unchanged). There is no pointer row, and "Composer paused" is drawn for no request. A message typed and sent while the prompt waits joins the composer's stack as at any time a turn runs and the prompt still waits. Stop withdraws the prompt and its card leaves. Deny with a reason and Deny and stop work as before, and the card for a one-line command is at most 200 px tall at the column's width (U1a's scene, now at the end).
2. **Keys on a prompt** [A3]. With the prompt in view for 400 ms and the composer empty: ⌘↩ allows once, ⇧⌘↩ gives the lasting scope its button names, Esc denies, whether the keyboard is in the composer, on the prompt's row, or on nothing. With text in the composer ⌘↩ is the composer's and the prompt stays. The two chords that allow act only while the prompt's buttons are wholly in view. No key answers a prompt scrolled out of view, one that appeared less than 400 ms ago, or while a menu, a dialog, the composer's own popup or an input method has the keyboard. A key held through one answer answers nothing else. ⌘. stays Stop.
3. **A question from MAWS's ask** [A4]. With a file open in the side column the agent asks. The capsule's row holds the Question sheet's form under its title line; nothing appears above the composer; the side column still shows the file. Submit turns the form into the capsule's answer lines. "Open beside" on the row opens the sheet with the same form and the same draft.
4. **A terminal session's asynchronous question** [A5]. Its form is in the row of the call; the composer is free and the agent works on; the session reads "Question waiting". A Skip that would leave every question unanswered is disabled with its reason; Esc ends nothing; Dismiss is there (enabled on this Mac where the bridge declares it). Stop ends the turn and leaves the question open.
5. **Its answer** [A6]. Answered in MAWS: the row reads "header → answer" at once and after a reload. Answered in the terminal: the row reads "Answered in the terminal" until the delivery lands, then "header → answer". No bubble holds the engine's framing text. With the turn that received the answer folded, no "answered: …" line stands outside the fold.
6. **Finding what waits** [A7]. An asynchronous question is asked and the agent produces a screenful more. The card column shows "Waiting for you" with the question's line; the jump button reads "Needs your input" though the reader is at the end. Either one scrolls to the form and puts the keyboard on its row. Once answered the card is absent and the button is gone. With nothing waiting the card is never present.
7. **Several wait** [A8]. With two prompts and a question waiting: one card is open at the end and one line stands under "Also waiting"; the question's form is in its row; the column's card lists three, oldest first; choosing the line opens that prompt, folds the other, and it can be answered first.
8. **Dismiss** [A18]. While a blocking question waits, a message sent from the composer is delivered as a message and the question still waits. Dismiss on the form closes it and the row reads "Dismissed"; MAWS's ask reads "Dismissed" on its capsule with its lines "Skipped". A terminal session's asynchronous question dismissed in MAWS or in the terminal reads "Dismissed" at the press and after the delivery.
9. **Double-click** [A10] acts in the row's forms as U1a built it for the docked ones.
10. **A session shown without its transcript.** The compact composer of a closed floating card shows one line above itself, "Waiting for you · N", while N requests wait; a click opens the card.
11. **Outside the session nothing changes** [l4-approvals-07, "Unchanged placements"]: the Overview card answers in place, the hover card previews and answers by U1a's rule, the project channel's waiting cards answer MAWS's ask in place, Needs you lists what it listed.
12. **After the answer** [UC-1, S-07]. At the write of an answer the card or form is gone and no "Answered" line stands in its place; a failed write leaves it with "Couldn't deliver the answer" and Retry; a request the terminal answered first says so for three seconds where it stood.
13. **A far row** [the child's check]. In a transcript of several hundred rows, a form that mounts in a row above the viewport does not move what the reader sees, and a waiting row scrolled out and back returns with its draft.
14. **Nothing else moves.** A transcript with no waiting input derives the rows it derives today (the fixture and snapshot suites of `transcript/model/` pass unedited but for the cases that pinned the slot row), desk web's session view draws its tail as before, and the three setup cards dock as before.

### Routes (law 5)

| line | runs | terminal | remote | where a route does not carry it |
|---|---|---|---|---|
| 1, 2, 12 | ✓ | ✓, with "Also asked in the terminal: the first answer wins" and the three-second note | ✓ through `session.answer` and `sminos.answer` | while the link is down the card is drawn with every answer closed by the session's port and its reason, and is not counted (the attention store's `greyed`, unchanged). A request the bridge gave no call id: the call's row keeps its ordinary label and the end card is the only sign |
| 3 | ✓ | — | ✓ (a session another machine runs), through `maws.ask.answer` | MAWS's ask exists only in sessions MAWS runs |
| 4, 5 | — | ✓ | ✓ (a terminal session on another machine): the form, the words, the answer row from that machine's rows; Dismiss is drawn disabled with "Dismiss it in the terminal on <machine>" (U1a) | sminos offers its asynchronous question only in an interactive session, so none reaches a session MAWS runs; MAWS's non-blocking ask is line 3 there. Under an engine host of build F still serving this Mac's terminal sessions after an update, no row carries the answer class: the row reads "Not answered" and the delivery draws as that host maps it, until the host is replaced |
| 6, 7, 10 | ✓ | ✓ | ✓ | the card needs the card column, which is not drawn while a side surface or a destination is open (UC-9); the jump button is the signal that always shows |
| 8 | ✓ (the engine's question, MAWS's ask) | ✓ (blocking: the decline; asynchronous: the bridge's dismissal where declared) | ✓ but for the asynchronous question's Dismiss | as U1a's routes table; the receipt is drawn wherever the row is |
| 9, 11, 13, 14 | ✓ | ✓ | ✓ | — |

**Nothing new is offered to a caller on another machine.** This landing changes no file under `src/endpoint/`, `src/main/`, `src/services/`, `src/engine-host/`, `src/shared/ipc/` or `apps/`, adds no command, event, offer or capability, and leaves both generated wire files as they are. Every answer still travels by the three offers UC-7 names for this child. M6 proves it by an empty `git diff --stat origin/master...HEAD` over those paths and by `test/lane-b/offer-coverage.test.ts` and the wire manifest's test passing unedited.

## The look

**A drawn example should be shown to the owner before M2 is built.** The child fixes the words and the places; it does not fix how the end card, "Also waiting", the column's card and the pill sit on the page, and the owner sees this surface all day. The architect draws it (an HTML page beside the wave's earlier ones, outside the repository); this document only says what it shows. M1 does not wait for it.

Frames:

1. **A question in its row.** A transcript mid-session: the stepper form in the row of the call (the 480 px card it is inline today), two rows of later work under it, the composer free below with a draft in it. Beside it the same row after Submit: two lines "header → answer".
2. **A prompt at the end.** The last rows of a running turn: a folded run whose line reads "Waiting for approval: `cmd`" in the warning tone, then the end card (U1a's card: first line, preview, three buttons with their keys), then the composer, empty, with Stop.
3. **Several wait.** The end card open on the oldest prompt and under it "Also waiting" with two lines (glyph, summary, who asked).
4. **The column's card.** "Waiting for you · 3" first in the card column, three lines (glyph in its tone, summary, "from <agent>" on one, age), above Environment.
5. **The jump button's four states** in one strip: none (at the end, nothing out of view); the round arrow; the round dots; the pill "Needs your input" with the waiting glyph, once with the reader at the end and once scrolled away.
6. **Receipts.** An asynchronous question's row reading "header → answer"; the same row reading "Dismissed" on each line; the interim "Answered in the terminal"; MAWS's ask capsule reading "Dismissed" with its lines "Skipped".
7. **MAWS's ask in its row**: the capsule's title line, its state word, "Open beside", and the sheet's form under it.
8. **The compact composer** of a closed floating card with the line "Waiting for you · 2" above it.

Choices in those frames that the child's words do not settle, as cards for the owner, the most consequential first. The default built is the recommended option; each names the one place an answer changes. Cards 2 and 3 are about a receipt M1 builds at its default; an answer that differs is applied in M2.

- **Card 1 · How wide is the prompt at the end?** (a) *The transcript's column, edge to edge, bordered and raised* (recommended): the card the owner knows from the dock, in the same width as the composer under it, so a command or a diff has the room it has today. (b) *A 480 px card at the left*, like a question's form: lighter, and every request in the transcript has one width, but a diff's lines wrap sooner and a long command scrolls. (c) *No border, set off by space alone*: reads as part of the transcript, and is the easiest to miss. Changes: the end row's wrapper class (Interfaces §C).
- **Card 2 · What does a dismissed question's row read?** (a) *Its lines, each "header → Dismissed"* (recommended): the receipt keeps the shape of an answered one and still says what was asked. (b) *One line, "Dismissed · 3 questions"*, the questions in its tooltip: less on screen for a question that no longer matters. Changes: the question row's receipt (Interfaces §D).
- **Card 3 · While the terminal has answered and the answer has not yet reached the agent, what does the row read?** (a) *"Answered in the terminal"* on each line until the answer's text arrives (recommended): true, and it is the sentence the card shows for three seconds today. (b) *"Not answered"* until the text arrives: one state fewer, and false for those seconds or, for an idle session, minutes. Changes: decision 8's third source.
- **Card 4 · Does the pill carry the waiting glyph or Desktop's dot?** The child says the glyph (◐, warning tone), the mark of the waiting row and of the column's first line; asked only because the frame shows it beside the round button for the first time. (a) *The glyph* (recommended, the child's word). (b) *A small accent dot*, as Claude Desktop. Changes: the button's markup (Interfaces §D).

## Plan of Work

Six milestones on one branch, one pull request. M1 is additive and changes nothing a person sees but the fold of one notice. M2 is the cutover and cannot be split: the transcript starts drawing requests in the commit range in which the composer stops. M3 to M5 each add one thing a person can see on top of it. M6 is the scenes, the record and the acceptance run. The owner's look at the drawn example comes before M2.

### M1 — The rows know what waits and what was answered

**What exists at its end.** The transcript's model can be told which calls hold a waiting form, and marks their rows; a waiting plan row stays in view through every fold. A terminal session's asynchronous question whose answer was delivered carries that answer on its own row, "header → answer" or dismissed, on the file route and from another machine's rows, across turns and whatever order the pages load in. The "answered: …" line no longer stays outside a folded turn. No row draws a form yet and the dock is untouched, so the one visible change is O-21's row and the fold.

**What it touches.** `src/shared/attention/waiting.ts` (new) with its test; `stores/attention.ts` (the two selectors, `receipts`); `request-card/` (the follower of settlements, started by `connectRequestCard()`, and the card's write of its own receipt); `stores/transcript.ts` (`setWaitingForms`); `transcript/model/reduce.ts`, `rows.ts`, `schema.ts`, `derive.ts`, `copy.ts` (`QUESTION.dismissed`), `serialize.ts` if a waiting row's text needs a word; `transcript/view/rows/Question.tsx` (the receipt reads `dismissed` and the attention store's receipt) and `AskCapsule.tsx` with `copy.ts` (the state word "Dismissed"); their tests.

**Interfaces.** Exposes §A, §B, §G's receipt and the question's receipt of §D. Consumes U3a's `carriedOf`, U1a's `waitsOnAnswer`, `settledWords`.

**Decisions.** 2, 4, 5, 8, 9, 10, 12. The derivation's rule 1 and rule 3 (the withheld row, the slot row) are **not** built here: they are M2's, with the drawing that replaces them. Pitfalls seen in the code: `askModAnswers` returns null for the asynchronous call's own result (the fixed sentence), which is what leaves `answers` null for the join to fill; the reducer's registries are shared along the lineage and applying to a state that is not the latest throws, so `index.answers` is written where `index.arrivals` is; a turn derives again only when its memo is invalidated, so the join must invalidate the call's turn, which is rarely the turn the delivery landed in; a row's view may import `stores/attention.ts` (it imports no IPC client, and the run's line reads it already) and must not import `stores/lane-a.ts` or `lane-a/race.ts`.

**What it does not touch.** The dock, the composer, what the request card draws, `Transcript.tsx`, the slot row, the keys, `groups.ts`, `owner/`.

**What it proves.** Acceptance 5 on the model, and the model half of 8 and 14. Its tests pin: (a) `waitingRequests`, `waitingForms` and `placeWaiting` over a list with every kind, an item that names no request, two agents, and a call drawn and not drawn; (b) with `waitingForms` set, exactly the rows of those calls carry `waiting`, the other turns keep their rows by reference, and an equal set changes nothing; (c) a waiting plan row survives its turn's fold and the to-human projection (`reportRows`), and a plan row that does not wait folds as today; (d) the join on three recorded shapes, each on the file route and from another machine's rows (the model of `lane-a/arrival-routes.test.ts`): a plugin's prompt that answers one call, a hook's context on a tool result that answers one, a prompt that carries an answer and a dismissal for two calls; the answer applied before the page that holds its call, and after it; (e) the answer notice is derived and folds with its turn, and a turn it opened still reads "Worked for"; (f) the receipt's order of sources, each alone and the earlier winning; a settlement by the bridge writing nothing; a `settled` receipt never replacing an answer; the follower rebuilding a dismissal's receipt from a lane A state as a reload gives it; a declined blocking question reads "Dismissed"; (g) the model's fixture, journal and snapshot suites pass unedited.

### M2 — The cutover: forms in their rows, the card at the end, the dock gone

**What exists at its end.** A question, MAWS's ask and a plan are answered in the row of their call; a permission prompt, an engine dialog, an MCP server's form and any request with no row here are one card at the transcript's end with "Also waiting" under it; the call that waits says so on its own row. The composer is never hidden by a request. On every route and in every transcript that shows a session (the pane, the floating card, a comment card's thread, the Side pane's thread, a subagent's drill-in). A request's keys act while the keyboard is on its row.

**What it touches.** `transcript/model/derive.ts` (rules 1 and 3), `keys.ts`; `transcript/view/Transcript.tsx`, `waiting-view.tsx` (new), `rows/Row.tsx`, `rows/Question.tsx`, `rows/AskCapsule.tsx`, `rows/Plan.tsx`, `cells/CellLine.tsx`, `transcript.css`; `request-card/inline.tsx`, `EndRegion.tsx` (new), `RequestCard.tsx` (its delivery read from the store), `variants/Question.tsx` (its key owner), `InlinePointer.tsx` (removed), `index.ts`; `stores/attention.ts` (`deliveries`, `deliver`); `composer/docked/swap.ts`, `DockedCardFrame.tsx`, `composer/Composer.tsx`, `stores/composer.ts`; `session/SessionPane.tsx`; the harness pages that dock a request; every test that pins the dock for a request or the slot row (the child's list, and found at the pin: `transcript/view/rows/requests.test.tsx`, `request-card/inline.test.tsx`, `session/SessionPane.test.tsx`, `transcript/view/TranscriptSlot.test.tsx`, `side/card/CardHost.test.tsx` and `CommentCard.test.tsx`, `harness/panel/childTranscriptTool.test.ts`, the three `request_slot` cases of `transcript/model/derive.test.ts` and `reduce.test.ts`).

**Interfaces.** Exposes §C, §D (but the jump button and `showWaiting`'s callers, M4), §E's `EndRegion` and the card's `inline` keys, §G's delivery. Consumes M1 whole.

**Decisions.** 1, 3, 6, 11, 13, 14, 15, 16 (the harness page; its scenes are M6's), 17. The owner's cards 1 to 3 are answered before this milestone starts; each changes one named place. Order of work inside it: build the row forms and the end row first, with the dock still standing (a request is then drawn twice, in the tests only), then take the dock's request half out; the tree is green at both points. Pitfalls seen in the code: the composer's ports answer "covered" through `promptState.current.docked` (C2), which must stay true for a setup card and become false for a request; `DockedCardFrame` unmounting gives the focus back to the editor, and with no request frame that path runs only for the three setup cards; the card's `useProposedFile` read and its draft are keyed by the item, so a card that moves from one transcript's end to another's keeps both; a waiting row's form and the Overview card can show one question at once, and they share one draft already; the virtual list keeps a row's last measured height by row id, so the end row's id is constant; a card is not wrapped in a live region (its controls changing would be announced), which the slot row's view already respects.

**What it does not touch.** The Overview card, the hover card, the project channel's cards, Needs you; `groups.ts` and its carry (C9); `owner/`; the Question sheet's opening (M5); the jump button and the column's card (M4); a prompt's keys from the composer (M3).

**What it proves.** Acceptance 1 (but the keys from the composer), 3 (the form in the row; "Open beside"), 4, 7 (but the column's card), 8, 9, 12, 14. Its tests pin: (a) for each form kind, a waiting row draws the card for its item and its receipt once the item leaves, and asks the `AskUserQuestion` site once at each moment, never twice; (b) the end row is last, after the tail and the projection, present exactly while something is placed at the end, and absent in a transcript with no session; (c) `EndRegion`: the oldest open, the others as lines, a chosen line opening its card, the next opening at an answer, a settled request staying three seconds; (d) the card's delivery states at the end and in a row (sending, "Couldn't deliver the answer" with Retry, "Already answered elsewhere" for two seconds), and four sequences held open, each with the write's promise kept pending by the test: an answer in flight while the item leaves the list; one in flight while a second request arrives, which it does not answer; one in flight while its row unmounts and mounts again, which comes back sending and answers once; one whose write fails while its row is unmounted, which comes back with "Couldn't deliver the answer" and a Retry that sends the same answer; (e) a waiting call's cell reads `waitingLabel` with no counts, an allowed one reads as running, a call the bridge gave no id keeps its label; (f) the composer: with a request waiting the editor is shown, takes text, `draftShown()` is true, Send queues, Stop is there; with a trust card docked it is covered as before; ⌘L focuses the editor; (g) a subagent's question is in its own transcript's row and at its parent's end, and one answer settles both; (h) no pointer row and no "Composer paused" for a request anywhere (a text search over the rendered pane); (i) desk web's tail rows still draw through the seam (its own unit suite passes unedited).

### M3 — A prompt's keys from the composer and from no focus

**What exists at its end.** With a prompt in view for 400 ms, ⌘↩ on an empty composer, ⇧⌘↩ and Esc answer it from the composer and from an unfocused page, ahead of the composer's own keys, and from nowhere else.

**What it touches.** `keymap/useKeyChord.ts`, `keymap/dispatcher.ts`, `keymap/key-dispatch.test.tsx`; `request-card/RequestCard.tsx` (`keys="pane"`), `EndRegion.tsx`; `stores/composer.ts` and one line of `composer/Composer.tsx` (`empty()`); tests.

**Interfaces.** Exposes §F. Consumes M2's `EndRegion` and `WaitingView.inViewSince`.

**Decisions.** 7. The states and the one transition that matters, fixed here: a key is *taken* (prevented, and either answers or, for a repeat, answers nothing) only when the chord matched, the binding was found and `when` held; in every other case it is *passed* and the next row of the table sees it. There is no third outcome: a key is never swallowed without `when` holding. Pitfalls: the editor's popup lives in an element the editor portals and marks `data-key-sink="composer"` with `role="listbox"` (`composer/mentions/popup.tsx`), so "the popup is open" is read from the page, not from the composer's store; `fresh` is checked after the binding is found, so a held ⌘↩ that passed `when` once is taken and answers nothing on its repeats, as U1a built it.

**What it does not touch.** The table's rows and their titles; the composer's editor and its own keys; the Overview card's keys; a question's and a plan's keys (M2).

**What it proves.** Acceptance 2. Its tests pin, through the dispatcher with a real composer mounted: each of the three chords from the composer, from the prompt's row and from the body; ⌘↩ with a draft reaching `composer.queue` and leaving the prompt; Esc with the composer's popup open closing the popup; each refusal (out of view, under 400 ms since it came into view, a menu open, another text field, an input method composing, another pane holding the keyboard), each leaving the key to the next row of the table; an allow chord refused while the card's buttons are cut by the viewport's edge, and Esc acting then; a held chord answering one prompt of two; with no prompt in view, the composer's Esc, ⌘↩ and Enter exactly as before (the composer's own key suites pass unedited).

### M4 — Finding what waits: the card, the jump button, the way there

**What exists at its end.** The card column's first card lists the session's waiting requests; the jump button reads "Needs your input" while one is out of view; the card's lines, the pill, a Needs-you row and ⇧⌘J all land the keyboard on the request's row; a closed floating card's compact composer says how many wait.

**What it touches.** `request-card/WaitingCard.tsx`, `show-waiting.ts` (new), `index.ts`; `transcript/view/Transcript.tsx` (the button), `transcript.css`; `attention/navigation.ts`; `session/SessionPane.tsx` (the compact line); tests, `panel/summary/Summary.test.tsx` among them.

**Interfaces.** Exposes §E's `WaitingCard` and `showWaiting`, §D's jump button. Consumes M2.

**Decisions.** The compact line is drawn by `SessionPane` in its compact branch, above the composer: a button "Waiting for you · N" for N > 0 that opens the card (`openCard`) and then calls `showWaiting`. What awaits and can fail: `showWaiting` for a session whose transcript is not mounted waits for its mount; if the request is answered meanwhile it does nothing; if the row leaves between the scroll and the focus the keyboard stays where it was. The jump button reads visibility from the observer, so it changes a frame after a scroll, never during one.

**What it does not touch.** The column's layout and presence line (U8's); Needs you's rows and counts; the follow rule.

**What it proves.** Acceptance 6, 7 (the column's card), 10. Its tests pin: the card's title, count, order, lines and tooltip, and its absence with nothing waiting; the button's table, state by state, with a request in a row above a reader at the end; the pill's click going to the oldest out-of-view request, by row and by the end, and the keyboard landing on the row; `showWaiting` before the transcript mounts, and with the request answered in between; ⇧⌘J landing on the oldest request of the session it opens; the compact line's count and click. The scroll suite (`transcript/view/Transcript-scroll.test.tsx`) passes unedited.

### M5 — MAWS's ask: nothing opens by itself

**What exists at its end.** The Question sheet opens only on "Open beside" and "View answers". An ask that arrives opens, activates and closes nothing, in the session on screen or in one the person comes to later; the tab that was in view stays in view.

**What it touches.** `tools/maws/ask/connect.ts` (the automatic open, the deferred open, the automatic close, U8b's transitional code and U7b's `asked` on that call, all removed; `connectAsks` keeps feeding the store and reloading it when the host is back), `tools/maws/ask/` callers of `settleWaitingAsks`, their tests (`store.test.ts`, `AskSheetTool.test.tsx`), and any panel-host test that pinned the sheet taking a tab's place.

**Interfaces.** None new. `openAsk` (the transcript action) is the one opener.

**Decisions.** The sheet's own form, its drafts and its submit guard are a keep and are not edited; the row's form and the sheet share the ask store's draft, as the hover card and the sheet do today. A blocking ask's item stays a `question` item, so Needs you, the Overview card and the notifier are unchanged.

**What it does not touch.** `AskSheetTool.tsx`'s form; the ask store's shape; the panel host.

**What it proves.** Acceptance 3 (the side column still shows the file; nothing above the composer). Its tests pin: an ask opened in the session on screen with a file tab in view leaves that tab in view and adds no sheet tab; one opened in a session not shown opens nothing when the person arrives; "Open beside" opens the sheet with the row's draft; a submitted ask closes no tab.

### M6 — The e2e edits, the record and the acceptance run

**What exists at its end.** Every scene that stood on the dock, the slot row or the sheet opening by itself stands on the new placement; the new scenes exist; the documents this landing amends are amended; the whole unit suite and the acceptance section have been run.

**What it touches.** `e2e/` and `e2e/support/` as "Proof that an executor does not run" lists them; the harness's card page; `docs/charter.md` (§13 X4), `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md` ("Placements"), `docs/doperpowers/plans/2026-10-05-e1-tool-server.md` (M4b), `docs/tech-debt-tracker.md`; this document's record.

**Decisions.** The amendments' sentences are the child's ("Rulings reversed"), dated, where each ruling stands. Tracker: the row of 2026-11-13 on the frame's hand-over mark closes (decision 11); the row of 2026-11-13 on the answer notice kept through a fold closes (M1); the register's row X-061 is re-read against Proof 3's result and closed or kept by the architect. A scene's time bound takes one of the forms the gate's guard lists (`.github/scripts/gate-plan.test.mjs`, above `LIVENESS_BOUNDS`).

**What it proves.** The acceptance section as written, by the commands of Concrete Steps 6 to 8, and the whole unit suite.

## Interfaces and Dependencies

Paths are under `src/renderer/src/` unless they start with `src/`. Signatures are binding; bodies, file-internal names and test placement are the executor's.

### §A. The list, and a request's place (M1)

`src/shared/attention/waiting.ts` (new; pure; no wire). The one definition every drawing reads.

```ts
/** A session's waiting requests, oldest first (`createdAt`, then id): its items for which `waitsOnAnswer` holds. */
export function waitingRequests(items: readonly AttentionItem[]): AttentionItem[];

/** The kinds answered in a form in the call's row: `question`, `plan`, `async_input`. Every other kind of the list is a card at the end. */
export const FORM_KINDS: ReadonlySet<AttentionItem['kind']>;

/** The calls a transcript marks as waiting rows: the call each form-kind request of the list names. */
export function waitingForms(items: readonly AttentionItem[]): ReadonlySet<ToolUseId>;

export interface Placed { item: AttentionItem; place: 'row' | 'end' }
/**
 * The list with each request's place in one transcript.
 * `drawn`: the calls whose waiting row that transcript draws now (after its view's projection and its first-row cut).
 * `agent`: null for a session's own transcript, which lists every request of the session; an agent's id for that
 * agent's transcript, which lists only the requests whose `request.agentId` or `request.taskId` is the id.
 * A form-kind request is at `row` when `drawn` has its call, else at `end`; every other kind is at `end`.
 */
export function placeWaiting(items: readonly AttentionItem[], drawn: ReadonlySet<ToolUseId>, agent: string | null): Placed[];
```

`stores/attention.ts` gains, beside `selectWaitingByCall` and memoised per list the same way: `selectWaitingRequests(state, appSessionId): AttentionItem[]` and `selectWaitingForms(state, appSessionId): ReadonlySet<ToolUseId>`.

### §B. The model (M1)

- **The input.** `TranscriptUi.waitingForms?: ReadonlySet<ToolUseId>` (`transcript/model/reduce.ts`; absent: none). The transcript store gains `setWaitingForms(key: string, calls: ReadonlySet<ToolUseId>): void` (`stores/transcript.ts`): a set equal to the one held changes nothing; else it is replaced and the turns that hold a call that entered or left the set derive again (found through `index.toolUses`), every other turn keeping its rows by reference. A key whose state starts over (an attach, a reset, a re-hydration) is told again by its transcript, as `ownerLane` is.
- **The rows** (`transcript/model/rows.ts`, `schema.ts`): `question` gains `waiting?: true` and `dismissed?: true`; `ask` and `plan` gain `waiting?: true`. Optional, written only when true, so a transcript with no waiting input and no asynchronous dismissal serialises as before.
- **The derivation** (`transcript/model/derive.ts`):
  1. A `question`, `ask` and `plan` row is derived for its call whether or not a request for it is pending: `requestOrHistoricalRow` no longer withholds it.
  2. Such a row carries `waiting: true` exactly when `ui.waitingForms` has its `toolUseId`. Nothing else decides it: not the request events, not whether the row has answers.
  3. No `request_slot` row is derived from an event: the five `*.requested` cases of `deriveTurn` and of the loose-event walk still record the request id on the pending call and emit nothing; `slotRow` goes. `state.pending` stays.
  4. `isPersistentRow(row)` also holds for `row.kind === 'plan' && row.waiting === true` (question and ask rows are persistent already).
  5. `isPersistentNotice` loses its `answer` term (U3a's hand-over; decision 9). The notice is derived as before.
  6. An asynchronous answer joins its question across turns (below).
- **The answer's join.** `TranscriptState.index` gains `answers: Map<ToolUseId, { summary: string; dismissed: boolean }>`, shared along the lineage like the other registries; a later delivery for a call replaces an earlier one. It is filled when a synthetic `user.message` is applied whose `carriedOf(event.arrival)` holds an entry of class `answer` with `tool: 'sminos'` (one entry per answered call: a row can carry several). Applying it derives again the turn that holds the call, when the state holds one. In the derivation, a `question` call whose own result gave no answers and that `index.answers` names reads: `dismissed: true` when the entry says so; else `answers` as `askModAnswers` reads that summary (the reading the blocking call's result already gets; a summary that is the engine's refusal reads as a decline, an empty map). MAWS's own envelope (`tool: 'maws'`) is not read here; its ask is filled from `maws.ask.answered`, as today. The order of arrival does not matter: a page of history that brings the call after its answer was applied finds the entry.

### §C. The seam, and the end row (M2)

The host seam is unchanged: `TranscriptProps.renderRequest`, `registerRequestRenderer`, the row kind `request_slot` and its view `transcript/view/rows/RequestSlot.tsx`. Two things pass through it.

- **A waiting row's form.** The row's view hands the renderer a slot value: `{ kind: 'request_slot', id: rowId.slot(requestId), turnId: row.turnId, at: row.at, requestId, toolUseId: row.toolUseId, requestKind: 'question' | 'plan', toolName: null, requestedAt: item.createdAt }`, with `requestId` the item's. It is a value, never a row of the list.
- **The end row.** `transcript/model/keys.ts` gains the end row's id and the reserved request id that names the transcript it ends:

  ```ts
  export const END_ROW: RowId;
  export function endRequestId(appSessionId: AppSessionId, agentId: AgentId | null): RequestId;
  export function endRequestOf(requestId: RequestId): { appSessionId: AppSessionId; agentId: AgentId | null } | null; // null for any other id
  ```

  The encoding is the executor's; it round-trips any session id and agent id, and no request id the engine or a bridge makes can read as one (a test pins both). `Transcript` appends `{ id: END_ROW, kind: 'request_slot', turnId: null, at: '', requestId: endRequestId(…), toolUseId: null, requestKind: 'permission', toolName: null, requestedAt: '' }` as the last row, after the tail, the view's projection and the first-row cut, exactly while `placeWaiting` gives a request the place `end`. Its row estimate is 220.
- **The renderers** (`request-card/inline.tsx`). `renderSessionRequest(slot)`: for a slot `endRequestOf` reads, `<EndRegion appSessionId agentId />`; else the waiting item found by request id and call id (today's search) as `<RequestCard item request={null} placement="inline" askInPlace paneIndex={null} />`; nothing when no item waits. `renderInlineRequest(appSessionId)` is the same, searching that session only. No pointer is drawn; `InlinePointer.tsx` goes.

### §D. The transcript's views (M2, M4)

- **`transcript/view/waiting-view.tsx`** (new). A context `Transcript` provides to its rows and that the host's drawing reads from inside a row:

  ```ts
  export interface WaitingView {
    placed: readonly Placed[];                                  // this transcript's list with places (§A)
    track(id: AttentionId, element: HTMLElement | null): void;   // the element a request is drawn in; null when it unmounts
    inViewSince(id: AttentionId): number | null;                 // `performance.now()` at which it last came into view; null while out of view or not mounted
  }
  export function useWaitingView(): WaitingView;                 // outside a transcript: nothing placed, nothing in view
  ```

  *In view* is the child's: the tracked element intersects the list's scroll element (an `IntersectionObserver` rooted there, any intersection). A row the virtual list has not mounted is out of view.
- **A waiting row** (`transcript/view/rows/Row.tsx` and the three row views). For a row with `waiting: true` whose call the session's `selectWaitingByCall` names with an item that is no permission, and with a renderer present, the row draws the form (§C) inside an element it tracks, and asks no mod's site of its own. Otherwise it draws its receipt as before, through its site. By kind:
  - *question*: the form in place of the receipt.
  - *ask*: the capsule's top line stays (glyph, title, count, state word); its button reads "Open beside" and opens the sheet (`actions.openAsk`, as "Open" does today); the form stands under the line.
  - *plan*: the form in place of the receipt (the card's plan body shows the plan and its buttons).
- **A question's receipt** (`transcript/view/rows/Question.tsx`), per question line, the first that applies: the row's own answer; "Dismissed" when the row is `dismissed` or its answer map is present and empty (decision 10; today's "Skipped" for a request declined whole goes); then the call's receipt in the attention store (§G): the answer this window gave, "Dismissed", or a settlement's words (decision 8); "Not answered". The receipt is the row's one source outside the transcript: a row's view imports the attention store and never the lane A store or `lane-a/race.ts`, which import MAWS's IPC client, and desk web bundles the rows. `QUESTION` in `transcript/model/copy.ts` gains `dismissed: 'Dismissed'`.
- **MAWS's ask's state word.** An answered ask every one of whose answers has status `skipped` reads "Dismissed" (`askStateCopy`, `ASK.state`), its lines "Skipped" as today.
- **A call that waits** (`transcript/view/cells/CellLine.tsx`). A cell whose `toolUseId` the session's `selectWaitingByCall` names with an item of kind `permission` draws `waitingLabel(cell)` as its label (in code marks, as the run's line does), carries `data-waiting`, and draws no line counts; `transcript.css` gives it the waiting glyph (◐, warning tone) in place of the status mark. The session is `useRowSession()`'s, so a subagent's transcript reads its parent's list (U2a's decision 16); a transcript with no session reads none.
- **`Transcript`** (`transcript/view/Transcript.tsx`). It tells the store its session's waiting forms (`setWaitingForms(storeKey, selectWaitingForms(…))`, before paint, again whenever the key's state starts over); computes `placed` from the session's list, the waiting rows among the rows it draws, and its agent (`variant === 'child'`: the source's agent id); appends the end row (§C); provides the `WaitingView`. A transcript whose store key names no session (desk web's) reads no list and does none of it.
- **The jump button**, same file. `needsInput`: some request of `placed` is out of view.

  | following | needsInput | drawn |
  |---|---|---|
  | yes | no | nothing, as today |
  | no | no | the round button: the arrow, or the dots while the turn works; "Jump to latest", as today |
  | either | yes | the pill: the waiting glyph and **Needs your input**; `aria-label` and `title` "Needs your input. Scroll to the request"; `data-state="input"`; no count |

  A click on the pill goes to the oldest request of `placed` that is out of view: a row's by `scrollToIndex(index, 'center')`, the end's by `scrollToEnd()` (following resumes); then the keyboard goes to that row's element (decision 6).

### §E. The request card's side (M2, M4)

- **`request-card/EndRegion.tsx`** (new): `EndRegion({ appSessionId, agentId })`. Reads `useWaitingView().placed` for the requests at `end`. Draws one element `[data-request-end]` in the transcript's column (the owner's card 1 decides its frame; default bordered and raised, the column's width) that it tracks for each request it holds; inside, the open card (`<RequestCard placement="inline" keys="pane" …>`), and, when more than one waits, the label "Also waiting" and one button per other request: its kind's glyph in its tone, `item.summary`, "from <agent>" when an agent asked. Choosing a line opens that card and folds the open one (decision 13). A request its terminal answered first stays three seconds, settled in place, as the composer kept it (`useSettling`).
- **`request-card/WaitingCard.tsx`** (new): `WaitingCard({ appSessionId })`, registered in the slot `sessionCardWaiting` by `connectRequestCard()`. Title "Waiting for you", with " · N" when more than one waits. One line per request of the list, oldest first: the kind's glyph in its tone (`ATTENTION_HEADINGS`), the summary, "from <agent>", its age (`itemAge`); the full text as the line's tooltip. A line is a button that calls `showWaiting`. No answer controls. It draws in the column's own card chrome and holds no fold.
- **`request-card/show-waiting.ts`** (new): `showWaiting(appSessionId: AppSessionId, attentionId?: AttentionId): void`, the one way to a request from outside its transcript (the column's card, Needs you and ⇧⌘J, the compact composer's line). With no id, the session's oldest waiting request. It does not bring the session to the front; its callers do. For a request whose waiting row the session's transcript holds: the store's `jumpTo(key, rowId, { align: 'center' })`, which scrolls and focuses the row. Otherwise: the store's request that every list of the key go to its end (the one an accepted send makes), then the keyboard to the end row's element in the pane that shows the session. A session whose transcript is not mounted yet is served when it mounts (the request is remembered once, as `markFocusOnMount` is for the composer).
- **`RequestCard`**. `placement: 'inline'` binds a request's keys as `'card'` does, to the nearest ancestor that takes focus (the transcript's row), live only: a question's and a plan's ↩ and Esc and the digits act while the keyboard is on that row. A new optional prop `keys?: 'pane'` (the end row's open card) binds a prompt's three chords by §F instead. The card no longer wraps itself in `DockedCardFrame`, and the composer store's docked marks (`markDocked`, `isDocked`) go. Wherever it is drawn outside the hover card, a request's card is a `group` named by its kind's heading (`ATTENTION_HEADINGS[kind].text`: "Approval needed", "Question", "Plan review", "Input requested"), the name the docked frame gave it. When the element that holds the keyboard leaves with its request (a form answered, the last card at the end), the keyboard goes to the session's composer (`focusEditor`), as the frame gave it back; when it did not hold the keyboard, nothing moves. `Placement` keeps `'docked'`: the composer still draws a notice with it (decision 14).

### §F. A prompt's keys (M3)

The rule is the child's (UC-6, "A permission prompt's keys"). The mechanism:

- **Two options of a binding** (`keymap/useKeyChord.ts`, `keymap/dispatcher.ts`; U6's files, §I):

  ```ts
  // ChordBinding, and useKeyChord's options
  reach?: 'pane';          // a pane-scope binding that also answers from its element's composer and from no focus at all
  when?: () => boolean;    // asked at the press, once the chord matched and the binding was found; false: the binding is passed over
  ```

  For a binding with `reach: 'pane'` the dispatcher, and only there: does not refuse the key for a target inside a `[data-key-sink="composer"]` element that the binding's element contains; and takes the binding as a candidate when nothing holds the focus (the active element is the body or none), whatever the target. Every other refusal stands: an input method composing, an open menu, dialog or popover, any other text field, a button or a link, the chord capture. A binding whose `when` answers false is passed over as if it were not bound: the dispatcher prevents nothing and goes on to the next row of the table, so the key reaches the composer's own row or the page.
- **The binding** (`RequestCard` with `keys="pane"`): `request.allowOnce`, `request.allowLasting`, `request.decline`, each `fresh`, `reach: 'pane'`, `within` the nearest `[data-pane]` element (a transcript outside a pane: its own root), enabled as today (live; the key bound by the variant; no allow key on a request flagged "default to no"; no key for an answer the port cannot carry).
- **`when`**, for all three: the card's element is in view and has been for 400 ms (`useWaitingView().inViewSince`, and the card's own mount for the Overview placement, as U1a built it); the composer's own popup (mentions, slash commands, history search) is not open; and, when nothing holds the focus, the binding's pane is the one the shell says holds the keyboard. For the two chords that allow, also: the card's row of buttons lies wholly inside the list's viewport at the press (a rect test against the scroll element; Reported, 6). For `request.allowOnce` alone: the session's composer is empty, read through one new member of the composer's port, `FocusTarget.empty(): boolean` (`stores/composer.ts`; registered in `composer/Composer.tsx` as the box's own emptiness, the one that greys Send; no composer mounted: empty).
- **Order.** The dispatcher runs before the composer's editor (C15). `request.allowOnce` stands before `composer.queue` in the table, so with a prompt in view and an empty box ⌘↩ allows, and with a draft `when` is false and the composer's row takes it. Esc reaches `request.decline` before the editor's own Esc, so with a prompt in view it denies and the composer's Esc does not run; with none in view `when` is false and the editor handles it as today. ⌘. is untouched.

### §G. What the attention store holds for a request (M1, M2)

**The receipt** (M1; decision 8). What is known of a question's answer before the transcript's own row carries it:

```ts
export type Receipt = { answers: Record<string, string> } | { dismissed: true } | { settled: string };
// stores/attention.ts
receipts: ReadonlyMap<ToolUseId, Receipt>;
recordReceipt(call: ToolUseId, receipt: Receipt): void;   // a `settled` receipt never replaces an `answers` or a `dismissed` one
```

Two writers. The card, at a delivered answer to a question request: the answers it sent (question text to answer text, as the wire takes them), or `dismissed` for the decline and for the bridge's dismissal. And one follower of the lane A store, started by `connectRequestCard()` (`request-card/`, so MAWS alone runs it): for each settlement a terminal session's state lists, under the settlement's `request` read as the call's id (C17): `withdrawn` by other than `bridge` is `dismissed`; `withdrawn` by `bridge` (a `/clear`, the session's end) writes nothing; any other outcome is `settled` with `settledWords`. Memory only, per window; the follower rebuilds the settlements' receipts from the lane A state after a reload, which is why a dismissal reads the same there. A session's entries go when its list is dropped from the store. The one reader is the question's receipt (§D).

**The delivery** (M2; decision 17). The card's delivery moves from the component into the store: `deliveries: ReadonlyMap<AttentionId, { phase: 'answering' | 'sent' | 'not_pending' } | { phase: 'failed'; detail: string | null; answer: RequestAnswer }>` and one action, `deliver(item, answer): Promise<Outcome>`, which is the card's `submit` of today: one answer in flight per item (a second call while one is in flight does nothing), `sent` kept until the item leaves the session's list, `not_pending` for two seconds (or back to pending where the request is the terminal's alone to answer), `failed` until Retry sends the same answer again. An entry goes when its item leaves the list. Every mounted card of an item reads the one entry, so two placements of one request (a row's form and the Overview card) show one state. `onAnswered` and the outcome a caller awaits are unchanged.

### §H. What the landing stores or sends, against both builds

| | this landing | build F (`f1852de3a`) | the master build (`2c7044231`) |
|---|---|---|---|
| layout keys, settings files, the index database | none read or written | — | — |
| the wire (commands, events, their schemas, the minor) | unchanged: no file under `src/shared/ipc/`, `src/shared/graph/` or `src/shared/wire/` is edited | — | — |
| answers sent | the same answers through the same commands as the master build (`session.answer`, `sminos.answer`, `maws.ask.answer`, the lane A answer) | accepts what it accepts today | identical code |
| what it reads from a session's machine on an older build | an item of kind `question` for a terminal session's asynchronous question from a machine on F (F's `laneAEntryOf`): its form is drawn in its row all the same, in the blocking tone, as that machine says it; an item still listed as `delivered` by a machine on F: drawn by no placement (U1a) | — | the same items as this build |

So no cross-build run is owed by this landing: it takes no wire minor and changes no stored form. `e2e:cross-build` still runs in the final set because two of its scenes stage a request (Proof, 1).

### §I. Insertions in files other children own (UC-8)

| file | owner | the insertion |
|---|---|---|
| `composer/Composer.tsx` | U4 | the request half of "the docked swap" goes: no item docks, `settling` and "N more waiting" go, the notice above the frame is the oldest notice that names no request (decision 14), and the composer no longer reads or loads requests; `docked` is true only for a card another child docked. One line registers `empty()` on the focus target. Reported, 1 |
| `composer/Composer.test.tsx` | U4 | the cases that dock a request become cases of a free composer beside a waiting request; the trust card's cases stay |
| `stores/composer.ts` | no child (U4a edits it) | `FocusTarget.empty()`; the docked marks removed |
| `keymap/useKeyChord.ts`, `keymap/dispatcher.ts`, `keymap/key-dispatch.test.tsx` | U6 | `reach` and `when` (§F). Reported, 1 |
| `stores/transcript.ts` | U9's row (O-11b) | `setWaitingForms` |
| `transcript/model/reduce.ts`, `rows.ts`, `schema.ts`, `keys.ts`, `derive.ts`, `copy.ts`; `transcript/view/Transcript.tsx`, `rows/Row.tsx`, `cells/CellLine.tsx`, `transcript.css` | per UC-3 (U3 owns `Transcript.tsx`; U4 and U2 inserted in the model files) | the parts UC-3 gives U1: the three rows, the end row, the waiting state of a call's row, the jump button's request state; `index.answers`; one term removed from U3a's `isPersistentNotice`. U2a's insertion in `askRow` (C12) is kept as it is |
| `attention/navigation.ts` | no child | the open of a Needs-you row and ⇧⌘J call `showWaiting` once the session is in front |
| `session/SessionPane.tsx` | U1 (U2b removes the `ReportBar` mount; U4, U10, U11, U12 hold one line each) | the fallback `DockedRequest` goes; the compact pane's line (M4) |
| `app/slots.ts`, `panel/summary/Summary.tsx` | U8 | none: the slot is filled by registration, and the presence line stays |
| `shell/floating.ts`, `shell/FloatingPill.tsx` | U10 | none: the raise rule is unchanged |
| `harness/` (the card page, the composer and panel harnesses), `e2e/support/` | shared test support | the `docked` placement of the card page (decision 16); `pendingRequests` of the child-transcript probe counts waiting rows and the end row |

### §J. Consumed from siblings, by name

- **U1a:** `waits`, `waitsOnAnswer`, `waitingByCall` (`src/shared/attention/kinds.ts`); `selectPendingOf`, `selectWaitingByCall` (`stores/attention.ts`); the card and its keys (`RequestCard`, `CardKeys`, the `fresh` option); `answerCapability` on the controls port; `settledWords`, `useSettling`, `useRace` (`lane-a/race.ts`).
- **U3a:** `carriedOf` and the `answer` entries of `user.message.arrival` (`src/shared/engine/arrival-schema.ts`); the reader's `dismissed`; the split of several deliveries in one row (one entry each).
- **U2a:** `waitingLabel` (`transcript/model/copy.ts`); the run's line, unchanged; the rule that a row ends a run.
- **U8b:** the slot `sessionCardWaiting` and its presence line; the column's card chrome.
- **U4a:** the composer's port (`FocusTarget`), `TranscriptSlot`'s `waiting` prop, which is passed on unchanged.
- **U7:** Needs you and its rows, unchanged; `attention/navigation.ts`'s "not on screen" rule for a page, unchanged.

## Size, and the review it gets

Counted from the code at the pin: the files each milestone names, and the lines of the tests that pin today's placement.

| milestone | files | changed lines (source / tests) | what the count rests on |
|---|---|---|---|
| M1 | about 14 | about 330 / 570 | one new shared module; five model files; two row views; the join's route tests |
| M2 | about 40 | about 1,000 / 1,500 | the dock's request half removed in `Composer.tsx`, `swap.ts` (64 lines to about 20), `DockedCardFrame.tsx`, `SessionPane.tsx`, `stores/composer.ts`; `InlinePointer.tsx` and its cases gone; three new view modules; `RequestCard.test.tsx` (1,351 lines, 61 mentions of the docked placement), `DockedCardFrame.test.tsx` (355), `swap.test.ts` (110), `inline.test.tsx` (173), `requests.test.tsx` (400), `lane-a-card.test.tsx` (326), `SessionPane.test.tsx`, `Composer.test.tsx` |
| M3 | about 8 | about 120 / 330 | two options in the dispatcher; the binding; the dispatcher's suite |
| M4 | about 11 | about 300 / 350 | two new modules, the button, one line of navigation, the compact line |
| M5 | about 6 | about 110 (most of it removed) / 240 | `connect.ts` from 128 lines to about 45 |
| M6 | about 24 | about 900 | fifteen scenes of `requests.spec.ts`, nine of `maws-tools.spec.ts`, and those listed under Proof 1; four documents |
| **whole** | **about 85 distinct** | **about 5,700** | |

**The branch review is the xhigh panel** (`doperpowers:review-code`), on three counts: it is over twenty files and two thousand lines; it writes in the transcript's model and its virtual list, which the root keeps to one writer at a time; and it moves the keys that answer a permission prompt, where a fault is an Allow nobody gave. Lenses: (1) **consent**: every path by which a key or a click answers a prompt, the guards of §F state by state, a key held or repeated, a request replaced while an answer is in flight, what a caller on another machine can reach; (2) **the list**: follow, anchoring and measurement with the end row and with a tall row above the reader, the jump, the scroll suite; (3) **one list on three routes**: the terminal's race and settlement, a link down, a subagent, a reload, a page not loaded, the moment between an answer and its row; (4) **what was removed**: the composer's ports and focus without the dock, the three setup cards, ⌘L, desk web's seam; (5) **law 2 and the folds**: one site ask per instance, none while a row waits, a waiting row in every fold, U2's files untouched.

## Concrete Steps

Working directory for every git command: the worktree `ux-wave/U1b`. Every check runs on the build VM; nothing is installed, type-checked, linted, tested or built on the MacBook.

1. **Start.** `git fetch origin master && git merge origin/master` (merge; never rebase, never force-push). Read "What this document assumes of landings in flight" against the merged tree and record what changed in Surprises & Discoveries. Push. The first VM call installs dependencies there (a few minutes).
2. **Per milestone, while building.** Commit the tests first and run them once to see them fail for the reason the milestone names (a missing export or an assertion, not a crash); then build. After each push:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 600 pnpm exec eslint <the files changed>'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 900 pnpm exec vitest run <the folders of the milestone>'

   The helper's exit status is the command's; do not pipe it into `tail` without `set -o pipefail`. M1 also type-checks `tsconfig.node.json` (it adds a file under `src/shared/`). The folders, by milestone: M1 `src/shared/attention src/renderer/src/stores src/renderer/src/transcript/model src/renderer/src/transcript/view/rows src/renderer/src/lane-a src/renderer/src/owner test/support/tokens-guard.test.ts`; M2 adds `src/renderer/src/transcript src/renderer/src/request-card src/renderer/src/composer src/renderer/src/session src/renderer/src/side src/renderer/src/sessions src/renderer/src/shell src/renderer/src/tools/agents src/renderer/src/harness src/renderer/src/panel` and, for the seam's other host, which imports the card's parts and the rows, `pnpm --filter desk-web typecheck` and `pnpm --filter desk-web test`; M3 `src/renderer/src/keymap src/renderer/src/request-card src/renderer/src/composer src/renderer/src/settings-tab src/renderer/src/palette`; M4 `src/renderer/src/request-card src/renderer/src/transcript/view src/renderer/src/attention src/renderer/src/session src/renderer/src/panel src/renderer/src/shell`; M5 `src/renderer/src/tools/maws src/renderer/src/panel`. Expect each run to end `Test Files  N passed`; on the VM the brief's known set fails on master too and is not this landing's.
3. **A milestone is done** when its proofs pass, its entry in Progress is ticked with the commit range, and its decisions and discoveries are in the record. Its review happens at its boundary; the next starts from the reviewed head.
4. **Before M2:** the owner's answers to cards 1 to 3 are in the Decision Log, or the architect has said to build the defaults.
5. **After any merge of master:** run the same set again for the milestones already built, not the whole suite.
6. **M6, the whole checks, once**, by its builder:

       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 1500 pnpm typecheck'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 900 pnpm lint'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 3000 pnpm test'
       ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1b -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'

   The last because `e2e/` changed: it pins which group runs each spec file and how a scene states a time bound. If a fixture or a recorded file was added, also `node --test .github/scripts/maws-app-scan.test.mjs`.
7. **M6, nothing offered that was not** (from the worktree, no VM):

       git diff --stat origin/master...HEAD -- src/endpoint src/main src/services src/engine-host src/shared/ipc src/shared/graph src/shared/wire apps

   Expected output: nothing. A line there is a finding: stop and report it.
8. **M6, the acceptance section** is read line by line against the unit proofs named in the milestones, and each line's proof (a test's name) is written beside it in Outcomes' draft. Lines 1 to 8, 10 and 13 also need a scene on a Mac: those are handed over (Proof), not run.
9. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The hand-back says: what exists and the commands that showed it; what is not verified; the decisions made; anything that contradicts the child's file; the e2e scenes edited, by group, none of them run; what deserves a ticket. If a command fails with "No space left on device": stop, say so, delete nothing.

## Proof that an executor does not run

Each is a step for the architect, with what it needs.

1. **The Electron e2e groups, on a Mac, on the final head.** `e2e:requests` runs only on the Mac mini's own lane. The scenes that change, by group (line numbers at the pin):

   | group (`package.json`) | file | scenes that change | new |
   |---|---|---|---|
   | `e2e:requests` (and `e2e:c7`) | `requests.spec.ts` | 110, 153, 215, 232, 270, 301, 397, 460, 506, 563, 690, 718, 791, 846, 941: every one that stands a card in the harness's `docked` placement or reads `[data-docked-frame]`. 563 reverses (the editor stays shown beside the card; focus does not come back because it never left); 506's premise changes (an undeclared dialog is a card at the end, not absent); 301's "more waiting" becomes "Also waiting" | a prompt at the end with a message typed, sent and queued beside it, then Stop (acceptance 1); the three chords from the composer, the row and no focus, and each refusal (2); several wait (7); the column's card and the pill (6) |
   | `e2e:composer` (and `e2e:c7`) | `composer.spec.ts` | none (597 docks the trust stub, which stays; 1313 reads the button's first state) | a prompt waits while the editor takes text; ⌘↩ with a draft queues and with none allows |
   | `e2e:lane-a` | `lane-a.spec.ts` | 671, 735 (the card's lookup is main-wide and should hold; "docked in the pane" is now "at the end"); 786 (a question the bridge raised: in its row); 849, both runs (focuses `[data-docked-frame]`) | an asynchronous question answered in MAWS and in the terminal, its row before and after a reload, and dismissed (4, 5, 8). Where the scene's stand-in bridge cannot write the delivery into the transcript file, the reload half rests on M1's route tests and the scene says so |
   | `e2e:tools` | `maws-tools.spec.ts`, `support/maws-tools.ts` | 125, 273, 326, 350, 395, 411, 429, 496, 571: each reads the sheet with no click ("the sheet opened by itself"); 350's title reverses. `allowNext` finds the card by its group name in the pane and should hold | the ask's form in its capsule's row with a file tab in view; "Open beside" (3) |
   | `e2e:to-human` | `to-human.spec.ts` | 135 (the sheet with no click; the question's card is in its row) | — |
   | `e2e:side` | `side.spec.ts` | 705, 851, 907, 969 (a thread's request: inline in the card's thread, and in the Side pane's thread view) | — |
   | `e2e:browser-comment` | `browser-comment.spec.ts` | 580, 730 (the same thread view) | — |
   | `e2e:panel` | `panel.spec.ts` | 819 (counts `request_slot` rows and reads `.transcript-slot-placeholder`); 1321 (`[data-docked-frame] button`); 1424 reads the button's first state and should hold | the compact composer's line (10) |
   | `e2e:agents` | `agent-tools.spec.ts` | 215 (a child's permission: at its transcript's end) | — |
   | `e2e:layout` | `shell.spec.ts` | 56, the step "Item 2" (the composer's frame "behind the docked card") | — |
   | `e2e:remote` | `remote.spec.ts` | 443 (the prompt by its group name, then hidden: should hold); 1878 (the sheet with no click) | — |
   | `e2e:cross-build` | `cross-build.spec.ts` | 3056 and 3111 (a take-back's stage: their premise reads whether a request's card holds the composer's box, which this build no longer does and both peers do) | — |
   | `e2e:design-systems` | `design-systems.spec.ts` | 664 (the sheet with no click) | — |
   | `e2e:transcript` | `transcript.spec.ts` | none (141, 240, 344, 372, 407 read the button's first state; 240 asserts it round) | the far row (Proof 3) |
   | the default group (`e2e`) | `c7-shots.spec.ts` (behind `MAWS_C7_SHOTS=1`), `computer-use.spec.ts`, `sessions.spec.ts`, `c12-prerun.spec.ts` (behind its own flag, a real engine) | `c7-shots` 116 (its pictures); `computer-use` 176 should hold; `sessions` 300 and 364 dock the trust card and stay; `c12-prerun` 1361 carries a comment that the card replaced the composer | — |
   | through `allowNext` alone | `e2e:dashboard`, `e2e:deliverables`, `e2e:design`, `e2e:document-app`, `e2e:presentations` | none expected | — |
   | `e2e:desk-web` | `apps/desk-web/e2e/` | none expected: five specs read the button's first state ("Jump to latest") and `session-view-tail.spec.ts` reads the tail drawn through the host seam; it runs because `Transcript.tsx` and the seam's row are touched | — |

   The lookups that should hold do so because a request's card, wherever it is drawn, is a `group` named by its kind's heading ("Approval needed", "Question", "Plan review", "Input requested"), as the docked frame named it: M2 keeps that name on the card. The full set is every group of this table; a group's earlier run stands only under UC-10's rule.
2. **`e2e:cross-build`, once with each peer** (`--peer-exact f1852de3a`, and the master build `2c7044231`): not for anything stored or sent (§H), but because the two scenes above read the peer's composer.
3. **A row that mounts a card far from the end** (the child's check; acceptance 13): a new scene in `e2e:transcript` on a transcript of several hundred rows: with the reader mid-transcript, a question raised for a call above the viewport and one below it leaves the reader's first visible row where it was, to the pixel; the form scrolled out and back holds its draft. Run alone on a Mac before the final set. On the Mac mini the transcript's frame bound is read as base against landing (the gate-offload plan's Decision Log 162): every call's row now reads the attention store, so that reading is part of this proof. The register's row X-061 is re-read against the result.
4. **Paid live groups** (UC-10: once per landing, when the landing changed the group's scenes or what it proves). `maws-tools-live.spec.ts` asserts the sheet opening by itself and is edited in M6, unrun; `p1-live.spec.ts`, `composer-live.spec.ts` and `to-human-live.spec.ts` find a card or the sheet in the pane. The architect decides which of `e2e:tools-live` and `e2e:p1-live` runs once on the final head.
5. **The owner's look.** Before M2: the drawn example and cards 1 to 4 ("The look"). In the built window, for the sitting script: typing while a prompt waits; Esc in the composer with a prompt in view denying it (the root's settled rule, which cannot be drawn); the pill with the reader at the end; an asynchronous question twenty turns up; the answer's line at the head of the turn that received it (Reported, 3); a dismissed question after a reload (Reported, 5).
6. **The pictures of `c7-shots`** (`MAWS_C7_SHOTS=1`), for the architect's look after M6.
7. **The branch review** (the xhigh panel, above), **class 1a** on GitHub Actions (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u1b`, once, on the final head) and **the pull request**.

## The pull request

Opened by the architect when its predecessor in the chain is on master. Its body names its class 1a run, the panel's verdict with what was dismissed or deferred, the Mac runs with UC-10's three answers after any merge, and its residue: what is not verified; the debt that stays (the dismissal of a terminal session's asynchronous question on another machine; the plugin's dismissal coming back when a session ends before its delivery; U2a's carry in `groups.ts`, which now carries nothing). It carries the dated amendments, each where its ruling stands, in the child's sentences:

| ruling reversed | where | sentence |
|---|---|---|
| l4-approvals-08, the placement | `docs/charter.md` §13 X4 ("placed docked at the composer"); `docs/doperpowers/plans/2026-09-28-c7-composer-requests.md`, "Placements" | "Amended (the owner's answer of 2026-11-12): a session's request is drawn in its transcript, a question and a plan in the row of the call that raised them and a permission prompt at the transcript's end, and the composer is never replaced by a request. Only the trust, relay-down and failed-start cards take the composer's place. A permission prompt is answered with ⌘Enter, ⇧⌘Enter and Esc." |
| O-17 | `docs/doperpowers/plans/2026-10-05-e1-tool-server.md`, M4b | "Amended (the owner's observation O-36 and answer of 2026-11-12): the Question sheet opens only when the person opens it; an ask's form is drawn in the row of its call." |

At landing the architect updates the register's rows and closes ticket 586 through the board scripts.

## Surprises & Discoveries

- Observation: the row kind the child retires is the seam desk web draws its session tail through, so only its derivation from request events can go.
  Evidence: `apps/desk-web/src/views/project/tail/session-tail.tsx` builds rows `{ kind: 'request_slot', turnId: null, … }` and `TranscriptPane.tsx` passes `renderRequest` (C6).
- Observation: half of O-21 is on master already: U3a's reader maps the delivery on every route and draws one notice for it; the row's own answer is what is left.
  Evidence: `src/shared/engine/arrival.ts` (`answersOf`), `transcript/model/derive.ts` (`noticeOf`, `isPersistentNotice`: "until U1b") (C10).
- Observation: for an asynchronous question the bridge's request id is the call's tool-use id, so a settlement names the question's row with no memory kept in the window.
  Evidence: the installed sminos 1.47.0, `hooks/mods/ask.tsx` (`id: e.tool_use_id ?? …`) and `hooks/mods/bridge-requests.tsx` (`raise({ id: note.id, … isAsync: true })`) (C17).
- Observation: no prompt key can reach a prompt from the composer or from an unfocused page through the dispatcher as it stands; the child's guards assume it can.
  Evidence: `refused()` and `owner()` in `renderer/src/keymap/dispatcher.ts` (C15).
- Observation: Claude Desktop keeps one card alive by moving its host element between the dock and the transcript; a row of MAWS's virtual list unmounts, so a card's delivery in flight cannot live in the component.
  Evidence: `shared-41`:7715-7733 of the reference; `OVERSCAN = 6` and the virtualiser's mounted range in `transcript/view/Transcript.tsx`; `useDelivery`'s component state in `request-card/RequestCard.tsx` (decision 17).
- Observation: Desktop holds ⌘↩ unless the prompt's row of buttons is wholly visible; the child's guard is "in view".
  Evidence: `shared-192`:22950-22981, `ccbc7e432-C0cBrkw9.js:338-344` (Reported, 6).
- Observation: the pin's code is the master build's; nothing here is stored or sent, so no cross-build run is owed for storage, and one is owed with each peer for two scenes that read the composer.
  Evidence: `git diff 2c7044231 3f2c4fca1 -- src apps e2e` is empty; `e2e/cross-build.spec.ts` 3056, 3111.

## Decision Log

- Decision: the verification this landing gets. This document gets an adversarial review before an executor starts (the architect dispatches it). Each milestone is reviewed at its boundary. The branch gets the xhigh panel of `doperpowers:review-code` with the five lenses under "Size, and the review it gets". Class 1a on GitHub Actions is the gate of record; the Mac runs of "Proof that an executor does not run" are the architect's. The pull request's body names the class 1a run, the verdict and the residue, and carries the two amendments.
  Rationale: over twenty files and two thousand lines; the transcript's model and list; the keys that answer a permission prompt.
  Date/Author: 2026-11-15, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
