# UX wave · U4b · the composer's integrations (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U4**, second landing (**U4b**, board ticket 585), parent pin master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U4-composer.md`: acceptance A9 (X-049), A18's sentence on the card column, its Edges, and the consumed contracts UC-2, UC-7, UC-8, UC-9 and UC-14; and the item sections X-049, O-20 ("Where"), l3-input-01 and l3-input-04 where they speak of a session on another machine. In the root: the wave's laws, UC-2, UC-7, UC-8, UC-9, UC-10, UC-11, UC-14 and "Ordering and dependency map" (the line U4b). Where the child's file and the root differ, the root binds.
> The first landing's document is `docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md` (cited as *U4a's document*); its "The landing's edge" says what it left for this one, and its decisions 13, 14, 26 and 30 are built on, not restated.
> This document holds what the design does not: what master holds today, the decisions the section left open, and the execution. Thirteen points were reported to the wave's architect at authoring; an adversarial review found three faults; the architect ruled on all sixteen on 2026-11-15 and the document was revised once to the rulings (Reported to the architect, and ruled; Decision Log).

## Purpose

After this landing three things the first landing left open are closed.

A question the agent asked without waiting, answered while a turn runs, waits in the stack above the composer as what it is: its row reads "Answer to Layout: Grid", where today it reads the opening words of the envelope MAWS sends to the model, "[MAWS ask …".

The `/btw` side chat card stands at the foot of the card column wherever that column is drawn, at the column's bottom right, and the transcript's corner is free; where the column is not drawn the card lies over the pane's corner, as it does today in every state.

For a session MAWS runs on another machine, Send now on a message that waits at the next step, and Esc on such a first row, send it now through that machine's engine and kill nothing; today they are drawn refused with "Not on another machine yet: sending a waiting message now while the agent works". Taking such a message back (↑, Edit, Delete) already works there since the other-machines landing; this landing gives those controls their words, closes them from the first draw on a machine that is too old to take a message back, stops a Delete from starting a session that is not running, and proves the whole of it in scenes on two machines. On a machine whose build does not offer a command, the control is drawn disabled with one sentence and the key that would do the same act says that sentence and does nothing else.

Two faults of the first landing's code are closed on every route, because a machine link makes them common. A take-back whose record could not be asked (the link dropped) no longer loads the message into the box as if the record had answered; it keeps its stored copy and asks again. And "The agent has already read this message" is said only where the session's record says so.

How to see it working: the unit tests named under each milestone; in a running build, the scenes of M4, which only a Mac run gives ("Proof that an executor does not run").

## Progress

- [x] (2026-11-15 11:20Z) Document written against master `63c97b5c0`: the code read, the in-flight branches' diffs read, the two binding builds read with `git show`.
- [x] (2026-11-15 11:52Z) The adversarial review's three findings and the architect's rulings on them and on the thirteen reported points folded in, in one revision.
- [x] (2026-11-15 12:40Z) The probe for M3's conditional step merged from `ux-wave/U4b-probes` at `f7e88d3c1` (a merge commit of its own); its findings pass decision 15's three conditions and the step is built in M3 (the Decision Log's lines on the probe's result).
- [ ] M1 — a waiting answer reads as an answer.
- [ ] M2 — the `/btw` card at the column's foot.
- [ ] M3 — Send now and taking back on another machine (and its conditional step: built, or not, with the reason).
- [ ] M4 — the scenes, the record, the last run.
- [ ] The link's minor, at the chain merge, in a commit of its own.
- [ ] Hand-back; then the architect's proofs, in the order of "Proof that an executor does not run".

## What this document assumes of landings in flight

One list, checked again by the executor at each merge of master (Concrete Steps, 1) and by the architect when each of these is on master. Either side may land first; where both edit a file, the later one resolves the lines at its merge.

| landing (branch read) | files it changes that this landing reads or edits | what this document assumes | if it does not hold |
|---|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b` at `0f746a7a5`) | `session/SessionPane.tsx` (the docked request goes), `composer/Composer.tsx`, `composer/Composer.test.tsx`, `stores/composer.ts`, `transcript/model/copy.ts` (`QUESTION`, `ASK`, `askStateCopy`), `transcript/model/serialize.ts` and `transcript/view/rows/AskCapsule.tsx` (seventeen lines over the three), `transcript/model/rows.ts` (the `ask` row), `app/slots.ts` (`requestCard`'s placement) | `SessionPane.tsx` keeps its two mounts of `BtwCard`; `askAnswerCopy(answer)` keeps its signature and words; a row of kind `ask` keeps `askId` and `questions`; the capsule's answer line and the copied form still choose a question's title by `question.header ?? question.question`; `stores/composer.ts` keeps `showStackNotice`, `setSendingNow` and `stackNotices` | this landing edits three of those files, each by one line (M1: one export in `copy.ts`, one call in `AskCapsule.tsx`, one in `serialize.ts`); whichever lands second keeps both sides' lines. If U1b changed the title's expression, the export is that expression |
| U2b, the to-human view (`origin/ux-wave/U2b` at `33434fb2d`) | `session/SessionPane.tsx` (the view's switch), `composer/Composer.tsx`, `composer/Composer.test.tsx`, `transcript/model/serialize.ts` (one other line), `test/lane-b/renderer-guards.test.ts` (one other entry) | the pane still mounts the transcript's scroller inside the positioned box that holds the corner card; the guard test's two entries for `session.steer.sendNow` are still there to remove | the two entries are removed wherever they then stand |
| U6b, the file beside the chat (`origin/ux-wave/U6b` at `74aad04a6`) | `panel/summary/Summary.test.tsx` (one case, the file row), `e2e/cross-build.spec.ts` (its own block) | `Summary.tsx`'s wrapper and its foot slot are as U8b built them | M2's one class in `Summary.tsx` is made on what is there |
| U10b-3, the chat bar over a surface (`origin/ux-wave/U10b-3` at `f05930ca3`) | `composer/Composer.tsx`, `composer/Composer.test.tsx`, `composer/frame/`, `shell/floating.ts`, `shell/FloatingPill.tsx`, `shell/FloatingCard.tsx`, `docs/tech-debt-tracker.md` | `cardSession(layout)` in `shell/floating.ts` keeps its name and meaning (the session the floating card, its pill or the bar draws); the bar mounts the session's pane in its compact form, so the card's `flow` placement is still the one drawn there | M2's `btwPlace` reads whatever names the floated session then |
| U5b, Review as one scroll (`origin/ux-wave/U5b` at `d94d75b8f`) | none of this landing's files | nothing | — |
| U10b-2, the artifact undelete (`origin/ux-wave/U10b-2`; not on the dispatch's list, read because it inserts in the same four files of U9's) | `src/endpoint/offers.ts`, `src/endpoint/capabilities.ts`, `src/shared/ipc/remote-unavailable.ts` and its test, `apps/org-protocol/src/channel.ts`, `apps/org-protocol/test/messages.test.ts` | it holds the link's minor 15 provisionally; each of the two appends its own line to `ENDPOINT_CAPABILITIES`, `REMOTE_NEEDS` and `OFFERS` | the link's minor is taken at the chain merge, in a commit of its own (decision 6), so the number is never chosen on the branch |

This landing adds its new cases for the composer's keys in a file of its own (`composer/Composer.remote-stack.test.tsx`), because three of the branches above edit `composer/Composer.test.tsx`, and it edits neither `composer/Composer.tsx` nor `session/SessionPane.tsx`.

## The landing's edge

| part of U4 | on master today | in this landing | left |
|---|---|---|---|
| A waiting answer (X-049; A9) | its row reads the envelope's opening words; it offers Send now only and ↑ skips it (U4a) | the row's words, for a session MAWS runs here and on another machine | nothing |
| The `/btw` card's place (O-20; A18; UC-9) | over the pane's corner in every state of the card column | the column's foot while the column is drawn for that session; the corner otherwise; the card's start in flight and its refusal kept through a move | nothing |
| Send now on a next-step row of a session on another machine (l3-input-01; A3, A5), and Esc | drawn disabled with "Not on another machine yet: sending a waiting message now while the agent works" | the offer of `session.steer.sendNow` behind a capability of its own, the device's half, the words; enabled where the machine lists the capability | — |
| Send now on an after-the-turn row early in a shell call | the message is submitted at priority `now`, moves nothing, and is delivered when the command ends | built in M3 only if the probe now running passes (decision 15); otherwise as today | the tracker row, if the probe does not pass |
| Taking back a next-step row there (l3-input-04; A7) | works on a machine that lists `rl2.session-acts`; on one that does not, Edit and Delete read "Can’t do this on `<machine>` yet. Update MAWS on `<machine>` and try again." | the act's words in `ACT_WORDS`, each control's own label in its sentence, the scene on two machines; Edit and ↑ closed from the first draw on a machine too old to keep a stage; neither the cancel nor Send now starts a session that is not running | nothing |
| A take-back whose record cannot be asked (every route that has rows) | the message is loaded into the box under "This message may already have been read; …", as for a record that cannot say | the stage and the box's hold are kept and the record is asked again; nothing is loaded until it answers (decision 12) | nothing |
| "The agent has already read this message" | shown whenever Send now is answered `nothing_waiting` and whenever a Delete is answered `already_started` | shown only where the session's record says the agent read it (decision 13) | nothing |
| `/fork` in the palette of a session on another machine (O-48; A20) | greyed by the helper for `session.fork` | greyed by `useForkUnavailable`, which adds the sentence for a running turn | nothing |
| Rulings reversed | all ten, in U4a's pull request | none: nothing here reverses a ruling | — |

Not in this landing: everything the child's file lists under "Not in this child"; any change to what Send now does in the engine host; the card's content and its timer; any new stored value.

## Words used here

*The device* is the app the person sits at; *the machine* is the other machine, whose `mawsd` holds the endpoint, the services and the engine host of the session. *The link* is the machine link (RL2). A *next-step row* is a message the engine holds for the running turn's next tool boundary (a pending steer); an *after-the-turn row* and a *held row* are entries of MAWS's queue on the session's machine. *The stage* is the take-back's stored copy: the session's draft whose document carries `attrs.takeBack` (U4a's document, decision 13). *Build F* is `f1852de3a` and *build G* is master `2c7044231`: the two older builds that whatever this landing stores or sends is stated against. *The helper* is `src/renderer/src/lane-b/remote-unavailable.ts`.

## Today, and what each part needs

Each statement was read at `63c97b5c0`.

**The row of a waiting answer.** `stackRows` in `composer/queue/stack.ts` marks a row `answer: true` when `parseAskSteer(messageText(content))` is not null, and `rowText` gives every row with content `entryDisplay(content)`, which knows pasted blocks and attachments and not the envelope. `readAnswerEnvelope(text)` in `src/shared/engine/arrival.ts` (U3a) reads the same envelope as the reader's class `answer`: `{ class: 'answer', tool: 'maws', call: <askId>, summary: <the whole text>, answers: AskAnswer[], dismissed: false }`. An `AskAnswer` (`src/shared/maws/tools.ts`) holds the question's id and text, its status and its values; it holds no header, and nothing in the class is the answer in words. The words of one `AskAnswer` are `askAnswerCopy(answer)` in `transcript/model/copy.ts`, which the answered capsule and the transcript's copy already use. A question's header is on the ask's own row in the transcript's model (`Row` of kind `ask`: `askId`, `questions`), which stays in view when its turn folds. So the row needs: the class from the one reader, the title from the ask's row where the window holds it, the words from the one function that words an answer.

**The card and the column.** `side/BtwCard.tsx` is mounted twice by `session/SessionPane.tsx`: over the transcript's corner (`placement="corner"`) and, in the compact pane, in the flow above the frame (`"flow"`). U8b's `panel/summary/Summary.tsx` mounts the slot `sessionCardFoot` after the cards' scrolling list, in a wrapper that is as tall as its content (`max-h-full`), so a component registered there stands directly under the last card and not at the column's bottom; nothing is registered. The shell (`app/Shell.tsx`) mounts the column's `aside` while `useCardColumn().placed` holds and draws it for `useCardColumn().session`, the session of the tab in front; `shown` is `placed` while no page is open (`app/shell-view.ts`, `cardColumnNow`, the one source). The drawn example the owner answered on (its frame 16, "Final") has the card at the bottom of the column, clear of the last card, in the cards' own surface. The e2e window is 1280 px wide and the sidebar 240 px, so the column has its 960 px of room and is drawn in every scene that shows a session with no side surface open.

**The two commands over the link.** `session.steer.cancel`: offered by U9 (pull request 650) as `laneB('act')` behind `rl2.session-acts`; in `ENGINE_HOST_ACTS`; in `REMOTE_NEEDS`; no row in `ACT_WORDS` (U9's R8 left it to U4). So on a machine that lacks the capability its controls read the helper's sentence with no act word, "Can’t do this on `<machine>` yet. …". `session.steer.sendNow`: on the wire since minor 45 (U4a), owner `engine-host`, graded `converse`; declared in `REMOTE_UNAVAILABLE`; no offer row; not in `ENGINE_HOST_ACTS`. The stack reads both through `refusalsNow` and `useRefusals` in `composer/queue/stack-acts.ts`, which ask the helper with no label; the helper's labelled form exists only as a hook (`useRemoteUnavailableAs`), and the keys read at the moment of the press, outside a render. `test/lane-b/renderer-guards.test.ts` lists two modules that name `session.steer.sendNow` as a declared command guarded elsewhere; once the command is offered that test calls both entries stale.

**The device's half.** `engineAct` in `src/main/lane-b/remote.ts` seals an engine-host act for the session's live launch and, where the session has none, resumes it first (`session.acquire`); one command is excepted, `maws.pane.answer`. A waiting steer exists only in a live launch (the queue abandons every pending steer at the process's exit, `src/engine-host/queue.ts`), so a Send now that resumed a session would start an engine process on another machine in order to be told that nothing waits. An act carries `REMOTE_NEEDS[name]` as its `requires`; a current channel whose peer lacks it is answered `not-offered` and nothing is sent (`run`).

**Taking back over the link** is U4a's `composer/queue/take-back.ts` as it stands on master, with no branch for the route: the stage is saved to the draft store of the session's machine through the offered `session.drafts.set` (a `machine` act, kept per member there), the withdrawal is `session.steer.cancel` or `session.queue.remove`, the record is `session.promptHistory` (a call, offered on every build read here), and `lane-b/remote-drafts.ts` sends each of the take-back's two saves once, in the session's order. Build F's draft store knows neither the claim nor the fence and answers the claim as stale, which the window remembers per machine from the first press on (`storeRefusesStage`). Build F lists no `rl2.session-acts`; build G lists it and knows the claim (`git show <sha>:src/endpoint/capabilities.ts`, `:src/shared/ipc/schema/session.ts`).

**`/fork`.** `composer/mentions/SlashPalette.tsx` and `widgets/ForkWidget.tsx` ask the helper about `session.fork`; `useForkUnavailable` (U9), which adds "Wait for the turn to end, or stop it first" while the session's turn runs on another machine, is read by `composer/InlineEdit.tsx` alone.

**The record's three "cannot say".** `record()` in `composer/queue/take-back.ts` answers `unknown` for three different things: the record could not be asked (`session.promptHistory` failed: the link is down, the call was refused); the record answered and is incomplete (`complete: false`, which `src/engine-host/prompt-history.ts` gives after pruning, an unreadable journal or an unrecorded end); and the record names the message as pending while the queue's snapshot in this window does not list it. `forward` loads the message into the box on all three, and `settle` then writes the draft without asking again. The first is not an ambiguity but a question not yet asked; over the link it is the common failure. U4a's tests script no failing record call (the harness's `session.promptHistory` always answers), so none pins that case; the two that pin `unknown` are "none of these and not listed: loaded under the line that it may have been read" and "an incomplete record cannot say: loaded under the line" (`take-back.test.ts`), and both are cases that stay.

**The line "The agent has already read this message".** `stackActs` shows it for every `nothing_waiting` from Send now and every `already_started` from a Delete. `MessageQueue.sendNow` answers `nothing_waiting` for a message that was dropped, held or never pending too, and `cancelSteer` answers `already_started` for any uuid that is no pending steer, so neither answer is evidence that the agent read anything. One test pins the first: "says the agent has the message when Send now finds nothing waiting" (`QueueList.test.tsx`). None pins the second.

**The card's start in flight.** `useSideAsk` in `side/BtwView.tsx` keeps `starting` (a session being started for the question) and `refusal` in the component's own state; the card passes it only the field's text from its store (`kept`). The open card and the folded chip are different components, and the corner and the foot will be different mounts, so a start in flight is forgotten by the next mount, which offers Ask again with the same question; both continuations then call `askSide`, which makes an operation each time.

**A host that lacks the handler.** `admit` in `src/engine-host/ops.ts` answers `refused unavailable` for a command the host has no handler for, after the endpoint accepted the act (its `ack`), where the endpoint's own `unavailable` (the host unreachable, the index behind, the decision moved) comes in place of the `ack`. The device's link keeps the difference (`ActHandle.progress()` reads `accepted`), and `reasonOf` in `src/shared/ipc/remote-unavailable.ts` words both "`<machine>` is busy; try again in a moment".

**The shell's edge drag.** During an accepted tab drag toward the main region's edge the shell hides the card column (`yieldCards` in `app/Shell.tsx`: the `aside` gets `hidden` and stays mounted), outside `useCardColumn`.

**Send now on a row that waits after the turn.** `stackActs.sendNow` promotes it at priority `now`. In about the first three seconds of a shell call that moves nothing: the message is submitted to the engine, its row reads "Next step" with no controls, and it is delivered when the command ends (`u4p3-promote-1.jsonl`). The control's title says "Sends this now; what the agent is running keeps running" all the same.

**The desk's web app** (`apps/desk-web`) imports the transcript's view and model and lane A's modules directly, and through them its import closure reaches `composer/queue/stack.ts`, `stack-acts.ts`, `QueueList.tsx`, `take-back.ts`, `composer/mentions/SlashPalette.tsx`, both `remote-unavailable.ts` and `session/controls/lane-b.ts`. It mounts its own composer (`apps/desk-web/src/views/composer/`) and neither `QueueList` nor the renderer's `Composer`, so it draws no stack; it does draw the transcript's ask capsule.

## Decisions settled at authoring

Each is a means the section left open, with its reason and what lost. Decisions 1 to 11 were ruled as written or with the correction each names (2026-11-15; "Reported to the architect, and ruled"); 12 to 16 are the rulings on the adversarial review's three findings and on points 8, 10 and 11.

1. **Four milestones.** The three integrations share no state: the stack's words (M1), the card's place (M2), the link (M3). M1 and M3 both edit `composer/queue/stack-acts.ts` and `QueueList.test.tsx`, so they run in that order; M2 touches neither and may run beside either. M4 holds what no executor can run (the e2e scenes), the record and the landing's one whole-suite run. Lost: one milestone for all three (three verification strategies in one diff); e2e edits inside each milestone (written blind three times, by three workers).

2. **A waiting answer's words are composed in the stack's model from three existing readings, and no second reader is written.** `stack.ts` asks `readAnswerEnvelope` whether a waiting message is an answer (in place of its own call of `parseAskSteer`); takes each question's title from the ask's row in the transcript's model where the window holds that row, by the expression the ask's own capsule uses, exported once as `askQuestionTitle` and called by the capsule, by the copied form and by the stack (ruled: no second expression, so an empty header reads the same in both places); takes the answer's own copy of the question's text where the window holds no such row; and words each answer with `askAnswerCopy`. Lost: reading the headers out of the envelope's numbered lines (a second reader of the envelope beside U3's, and the lines are written for the model); a new field on the reader's class (an edit in U3's reader and in X1's schema for a title the window already holds); a rule of its own for the title ("the first non-empty of …", which would show a title where the capsule shows none).

3. **The exact words.** One question: `Answer to <title>: <words>`. Several: `Answers to <N> questions: <title 1>: <words 1>; <title 2>: <words 2>; …`, every question in the asked order, clamped to two lines like any row and whole in the row's hover title and when the row is opened. The separator between questions is "; " where the child's text writes ", " (ruled a correction of the child's sentence): a multi-select answer's own words already hold ", " ("Grid, List"), and "Layout: Grid, List, Theme: Dark" cannot be read. A title that is empty (the capsule draws an empty label for it) gives `Answer: <words>`, and in a list the bare words.

4. **One function says where a session's card is drawn, and both mounts ask it.** `btwPlace(column, floated, appSessionId)` in a new `side/btw-place.ts` answers `'foot'` exactly when the card column is shown, the column's session is this one, and this session is not the one the floating card (or its pill, or the bar) draws; `'pane'` otherwise. It reads `useCardColumn()` (U8b's one source: `shown` and `session`) and `cardSession(layout)` (`shell/floating.ts`), and decides nothing those two do not already decide. `BtwCard` takes a third placement, `'foot'`: the corner mount draws nothing while the answer is `'foot'`, and the foot mount draws nothing while it is `'pane'`. So the card is drawn once, by one component, and `SessionPane.tsx` is not edited. A split needs no rule: the focused pane's session is the column's, its card is the foot, and the other pane's card stays over its own corner. Lost: a portal from the pane into the foot's element (React remounts a portal whose container changes, so it keeps no more state than two mounts do, and adds a store for the element); the foot claiming the card through an effect (a second source of "is the column drawn", one frame behind the first).

   *What a move must not lose* (the review's third finding, ruled). A move between the two places is a remount, as a fold is. The field's text, the card's view and the promotion in flight already live in the window's stores. The start in flight and its refusal did not: they move to the card's per-session store (`useBtwCards`), where the question lives, and `useSideAsk` reads them from there for the card and keeps its own state for the view outside the card. After that a move loses the field's focus and the log's scroll position, which the mount sets to the newest exchange again, and nothing else.

   *The edge drag* (the review's qualification, ruled: the smaller of the two). `btwPlace` does not read the shell's `yieldCards`. For the length of an accepted edge drag the column is hidden and stays mounted, and the card at its foot is hidden with it; nothing is drawn at the corner meanwhile; at the drag's end the same card is shown again. Reading the drag in `btwPlace` would move the card to the corner and back within one gesture.

5. **The foot is the column's bottom, in the cards' surface.** The registered component is `BtwCardFoot`, registered once in `registerSidePane()` (`side/register.ts`), which the app's composition already calls; no new call in `App.tsx`. Its box: a wrapper `mt-auto shrink-0 px-1 pb-1 pt-0.5` (inset as the cards are, so the card is 272 px wide inside the 280 px column, 6 px clear of the last card when the cards reach it), the open card `w-full`, as tall as its content up to `min(360px, 50vh)`, in the cards' surface (`rounded-md border border-border bg-bg-raised shadow-strip`); the folded chip at the wrapper's right end, in its own surface. For the wrapper's `mt-auto` to reach the column's bottom, the column's own wrapper in `panel/summary/Summary.tsx` must be as tall as the column: its `max-h-full` becomes `h-full`, one class in U8's file (ruled a named insertion, on the condition that follows). Lost: the card directly under the last card (what the slot gives unedited: not the bottom right the owner asked for, and it jumps whenever a card folds); an absolutely placed card at the `aside`'s bottom (the cards would run under it).

   *The condition: with no card open the column draws exactly as today.* The column's wrapper paints nothing: its classes are layout alone (`flex`, a height, a width, `min-h-0`, `flex-col`), with no background, border, shadow or padding. It sits inside the shell's `aside`, which already spans the column's whole height and already takes the pointer over that strip, so a taller transparent wrapper changes neither what is seen nor what is clicked. The cards' scrolling list keeps its own classes and so its content height, and `BtwCardFoot` draws no element while the card is closed. What pins the column today: in jsdom, `Summary.test.tsx`'s two cases of the slots (the tree: the list, then the foot; one child with nothing drawn); on a Mac, `e2e/ux2-shell.spec.ts` ("U8b: three cards …") and `e2e/panel.spec.ts`, which read the region, the cards' titles and folds and no height. So M2 adds the proof that is missing: in jsdom, the `aside`'s children with the slot registered and the card closed are those with nothing registered; on a Mac, M4's scene records the box of the cards' list and of each card before `/btw` is asked and finds the same boxes after the card is closed, and it measures the foot.

6. **The capability is `rl2.send-now`, for the one command.** UC-7.6: an offer inserted later takes a capability of its own. It is not folded into `rl2.session-acts`: build G lists that and has no row for the command. The link's minor is not chosen on the branch: `RL2_PROTOCOL.minor` and the number its test pins are raised to master's plus one at the chain merge, in a commit of its own (ruled; another landing in flight holds the next number provisionally). Until then the branch leaves the minor as master has it.

7. **No wire minor, and no cross-build run.** `session.steer.sendNow` and `session.steer.cancel` are both in the wire's manifest already; this landing adds no command, no event, no property and no socket capability, so `src/shared/ipc/wire-manifest.json` does not change and `WIRE_MINOR` does not move. What moves is the link's minor, which the cross-build group does not read, and no stored form changes ("What is stored or sent"). So no cross-build run is owed, and none is offered as a fallback (ruled).

8. **Neither Send now nor the cancel starts a session on another machine.** `engineAct` refuses a command of `LIVE_ONLY` for a session with no live launch, with `refusal: 'not-live'`; nothing is acquired and no act goes out. The set is `maws.pane.answer` (U9's), `session.steer.sendNow` and `session.steer.cancel` (ruled: starting an engine as a side effect of Delete is a fault; before, the cancel resumed the session and was then told `already_started`). Send now's refusal is shown: "Not sent now: the session isn’t running on `<machine>`". The cancel's is not shown by any control: a Delete that is refused so reads the session's record, as Edit does, and says what the record says in words that exist (decision 13); a take-back's withdrawal already reads the record after any answer.

9. **Each control says its own label; the two acts get their words.** UC-7.5: "`<Act>` is the control's own label". Send now reads the helper with the label `send now`, Edit and ↑ with `edit` (ruled: the key says Edit's sentence), Delete with `delete`; the keys read the same sentences through a new non-hook form of the labelled reader, `remoteUnavailableAsOf`, one export in U9's helper beside `remoteUnavailableOf`. `ACT_WORDS` gains `'session.steer.cancel': { act: 'take back', done: 'taken back' }` and `'session.steer.sendNow': { act: 'send now', done: 'sent now' }`, so a refusal after the act reads "Not taken back: …" and "Not sent now: …" (the owner's card 1 asks whether these are the words). Neither row `closes`: while the link connects or reconnects the act is held under the link's hold, as Send and Stop are.

10. **On a machine too old to keep a stage, Edit and ↑ are closed from the first draw.** `storeRefusesStage` also answers its sentence, "Taking a message back needs a newer MAWS on `<machine>`", for a session reached over the link whose machine's known capabilities lack `rl2.session-acts`, with no claim sent first. The reason it may: the draft store learnt the claim in U4a's landing, which came after U9's on master, so an endpoint that lists no `rl2.session-acts` runs services that do not know the claim; build F is such a build and build G is not (the review read both). This changes "from the first press it refuses" in the child's text to "from the first draw" for that route, and narrows tracker row "The first press on a machine of an earlier build" to this Mac's own services. U4b's own capability cannot do this, as U4a's document hoped: build G takes a stage and lists no `rl2.send-now`.

11. **`/fork`'s row and panel read `useForkUnavailable`.** Two call sites. The typed form (`applyFork`, outside a render) keeps the helper's plain reading: with a turn running there, the machine's own sentence comes back as "Not forked: …" (UC-7.5).

12. **A record that could not be asked is asked again; only a record that cannot say loads the message** (the review's first finding, ruled; it changes U4a's code on master for every route). `record()` gains a fourth answer, `unasked`, for a `session.promptHistory` that failed. On `unasked`, `forward` loads nothing and settles nothing: the stage stays stored and fenced, the box stays read-only under "Taking the message back…", which is what a held take-back shows today, and the record is asked again, by itself with no second withdrawal first, after the wait the loop already uses for a message that stays listed (one second, doubling to thirty) or, for a session over the link, as soon as its machine's link opens again (the roster's `generation` moves), whichever comes first. From the answer on, the table of U4a's decision 13 holds: listed, the withdrawal is tried again; read, the stage is cleared under "The agent has already read this message"; gone, the message is loaded with no line. A record that answers and cannot say (it is incomplete, or it names the message pending while the queue lists it nowhere) is the permanent ambiguity U4a ruled on: the message is loaded under "This message may already have been read; check the transcript before sending it again", and the person is told. The same on this Mac: a local call that fails is as transient. The settle after a load reads the record no more: a load now follows only this caller's own withdrawal, a record that says gone, or a record that cannot say, and none of the three is made better by asking again. No sentence is new, so no second card. Lost: loading on every `unknown` (a message that still waited, or that the agent took meanwhile, became an editable second copy as soon as the settle landed); asking again on an incomplete record as well (it may never complete, and the box would be held for good).

13. **"The agent has already read this message" is said only where the record says so** (point 11, ruled: follow the child). A Send now answered `nothing_waiting` shows nothing: the row's own state says what happened (it left, or it reads "Held", or it still waits). A Delete answered `already_started`, or refused `not-live`, reads the record once (`session.promptHistory` from the row's time, through `readRecord`): where it says the agent read the message, the line is shown; otherwise nothing is, and a record that cannot be asked shows nothing. The take-back's own use of the line, where its record says read, is unchanged.

14. **A host that lacks the handler is not "busy"** (the review's second finding, ruled; no new interface). Where the endpoint accepted a Send now and the engine host answered `refused unavailable`, the adapter words it as what it is, a session still served by an earlier engine host, "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over", under the device's own code `host-older`; an `unavailable` that came in place of the acceptance (the endpoint's own: the host unreachable, the decision moved) keeps "`<machine>` is busy; try again in a moment", which is true of it. The control is not drawn disabled for that case, and Interfaces G says why. One imprecision is accepted: a host whose op ledger is closed answers the same after acceptance, a fault that machine's own status shows and that every other act words as busy today. The sentence is this Mac’s own for the same state (`HOST_UPDATING` in `composer/queue/host-wire.ts`: "The engine host is finishing an update; this works once it has handed the session over") with the machine named, since the state arises only where the endpoint already lists the capability, which is a machine whose app is this build (ruled at this revision’s hand-back, in place of the first ruling’s "needs a newer MAWS" family, which was false of that machine). One place holds it: the `host-older` case of `reasonOf`.

15. **Send now on an after-the-turn row early in a shell call: a conditional step of M3** (point 8, ruled; the probe is being run by another agent). If the probe's findings file records that the request's path moved the command in five runs of five and answers its two other questions as "The conditional step" in M3 requires, M3 builds it there: one branch of `stackActs.sendNow`. If not, nothing is built, the tracker row stays, and the control keeps today's behaviour, which Today states plainly.

16. **The desk's web app is in every milestone's proof, and draws nothing new.** It mounts no stack, so it draws nothing for a waiting answer before or after M1; its ask capsule calls the exported title expression, which is the expression it has today, so its lines do not change. Each milestone's checks add that package's typecheck, build and tests (Concrete Steps, 2). If an executor finds that it does draw a difference, that is a named difference for the pull request, not a silent one.

## Reported to the architect, and ruled

Thirteen points were reported at authoring with the default written for each; an adversarial review of the document found three faults, all in the code as cited. The architect ruled on all sixteen on 2026-11-15, and this document is revised to the rulings once. No ruling was impossible as written; where the code shaped how one is built, the row says so.

| # | the point | ruled | where it stands now |
|---|---|---|---|
| 1 | No wire minor, a link minor, no cross-build run | accepted; the optional fallback command leaves the proofs table | decision 7 |
| 2 | The capability's name and number | `rl2.send-now`; the minor is master's plus one at the chain merge, in a commit of its own | decision 6; Concrete Steps, 5 |
| 3 | One class in U8's `Summary.tsx` | accepted as a named insertion, on the condition that with no card open the column draws exactly as today, stated and proved | decision 5; M2; M4's scene |
| 4 | Send now never resumes a session; the cancel does | accepted; `session.steer.cancel` joins the same set in this pull request, and Delete on a session that is not live answers from the record in words that exist | decisions 8 and 13; Interfaces C and E |
| 5 | The reader's class carries neither title nor words | accepted, with a correction: the title is the capsule's own expression, exported, not a second one | decision 2; Interfaces A |
| 6 | Edit and ↑ closed from the first draw on a machine without `rl2.session-acts` | accepted | decision 10 |
| 7 | "; " between the questions of one answer row | accepted as a correction of the child's sentence | decision 3; the list below |
| 8 | Send now on an after-the-turn row early in a shell call | the probe is arranged; a conditional step of M3 with its one place | decision 15; M3, "The conditional step" |
| 9 | `/fork`'s greying through `useForkUnavailable` | accepted | decision 11 |
| 10 | A take-back whose record cannot be read | the review's first finding: split "could not be asked" from "cannot say" | decision 12; Interfaces F |
| 11 | `nothing_waiting` shows a line the child says is not shown | follow the child: nothing is shown; the line only where the record says read | decision 13 |
| 12 | ↑ says the Edit control's sentence | accepted | decision 9 |
| 13 | The review rung | the xhigh panel; the architect runs it | Size and review |
| F1 | (review) An uncertain take-back can become a sendable second copy | as point 10 | decision 12 |
| F2 | (review) The endpoint's capability does not prove the serving host can send now | no new interface; this act's `unavailable` from the host is worded as a machine that needs updating; Interfaces G says why the control is not disabled | decision 14; Interfaces C, D and G |
| F3 | (review) Moving the side card loses its in-flight Ask guard | the start in flight and its refusal live in the card's store | decision 4; Interfaces B |

From the review's qualifications, also ruled: the edge drag (decision 4); the journals M4's two-app scene runs on (M4); `e2e/p1-live.spec.ts` among the scenes considered (M4); the desk's web app in every milestone's proof (decision 16); and that Interfaces F is no claim of exactly-once across two windows or devices (said there).

How the code shaped two rulings. F2 says "this act's `unavailable` from the host": the refusal's reason alone does not say whose it is, since the endpoint's own `unavailable` and the host's are the same word; what tells them apart is whether the endpoint had accepted the act, which the device's link already keeps (`ActHandle.progress()`), so the adapter reads that and nothing new crosses the link. Point 4 says Delete answers "from the record as Edit does": `session.promptHistory` reads the session's retained journals and needs no live launch (`src/engine-host/ipc.ts`), so the record can be asked of a session that is not running.

Sentences in the spec to correct, none of which changes what is built here: the board ticket and the root's ordering say "its two new commands"; there is one. The child's UC-7 bullet says of `session.steer.cancel` that it "is listed in `remote-unavailable.ts`"; it left that set with pull request 650. The child's UC-2 bullet says the reader's class carries the question's title and the answer in words; it carries the answers and the envelope. The child's X-049 writes ", " between the questions of one row; it is "; ". The child's routes table says Edit and ↑ are refused on a machine of an earlier build "from the first press that machine's draft store refuses"; over the link it is from the first draw. The child's l3-input-04 says that where the record cannot say the message is loaded; that holds for a record that answered, and a record that could not be asked is asked again. M3's conditional step is built (the probe's result, 2026-11-15): the child's table cell for Send now on an after-the-turn row, "that message alone goes now", becomes "it goes now, together with every next-step message already waiting, after them"; and wherever the document or the child says a Send now always cuts the turn, it cuts it only while the call is not yet a task ("Engine facts", row 1). None of these changes what a person reads in the window.

## The owner's card

One sentence a person reads is not settled by the child's text or the register (UC-7.5: "Taking back a waiting message has no `<done>` word yet … its second adds the words").

**Card 1 · What MAWS says when an act on a waiting message fails on another machine.** When you press Edit, Delete or ↑ on a message that waits in a session on another machine, or Send now on it, and that machine cannot do it (it went offline, it is read-only, it is busy), MAWS shows one line that begins "Not …:" and gives the reason, as it already says "Not sent: `<machine>` is offline" for a message. Which words should the line begin with for these two acts?

- **"Not taken back: …" and "Not sent now: …" (recommended).** Each line names the act as the rest of the app names it ("taking a message back", the Send now button). A failed Delete also reads "Not taken back", which is true: the message was not taken out of the queue.
- **"Not withdrawn: …" and "Not sent: …".** Shorter, but "Not sent" is also what a failed Enter says, so the line no longer tells you whether the message itself or only the Send now failed.
- **A word per control: "Not edited", "Not deleted", "Not sent now".** The line always repeats the button you pressed. It costs a second table of words, because the two buttons are one command.

Built by default: the first. The one place: the two rows of `ACT_WORDS` in `src/shared/ipc/remote-unavailable.ts`.

There is no second card. The review's first finding needs no sentence nobody has read: while a record is asked again, the box reads "Taking the message back…", which a held take-back shows today, and the row stays as the queue lists it.

Two sentences are new and are built by ruling, in families the window already uses, not put on a card; both follow card 1's answer for their first words. "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over" (decision 14; this Mac’s own sentence for the same state, with the machine named). "Not sent now: the session isn’t running on `<machine>`" (decision 8, accepted with point 4).

No drawn example is needed before the build: the card at the column's foot is frame 16 of the example the owner answered on 2026-11-13, and the sentences are text. For the owner's look at the built window (M4 lists them for the sitting): the chip at the column's foot; the card's height in a short window; the answer row with several questions.

## Routes (law 5)

| | a session MAWS runs, here | a session MAWS runs, on another machine | a terminal session, here or elsewhere |
|---|---|---|---|
| A waiting answer's row | "Answer to …" | the same: the queue's state arrives over the link and the words are composed in this window from the message's text, whatever that machine's build | not on this route: a terminal session has no rows, and its ask answers travel through the bridge |
| The `/btw` card's place | the column's foot while the column is drawn for the session; else the corner | the same | the same; a terminal session on another machine that is only listed has the column and its foot (U8b) |
| Send now on a next-step row; Esc on such a first row | `session.steer.sendNow`, as U4a built it; under an engine host of an earlier build, disabled with its sentence (U4a, decision 30) | the offered act behind `rl2.send-now` (Interfaces C). Without the capability: disabled, and Esc says the sentence and stops nothing | not on this route: no rows; Esc and Stop interrupt |
| Send now on an after-the-turn or a held row | `session.queue.promote` at `now`, unchanged; while a turn runs, on an after-the-turn row, the conditional step's path if it is built (decision 15) | the same; the conditional path only on a machine that lists `rl2.send-now` | not on this route |
| ↑, Edit on a next-step row | the take-back; a record that could not be asked is asked again (decision 12) | the stage to that machine's draft store, then `session.steer.cancel` behind `rl2.session-acts`, then the record (Interfaces F); the same rule for a record that could not be asked, which is the link's common failure. Without the capability: disabled with the sentence; ↑ says it and walks no history | not on this route: ↑ walks the prompt history |
| Delete on a next-step row | `session.steer.cancel`; "The agent has already read this message" only where the record says so (decision 13) | the same act behind `rl2.session-acts`, which starts no session; the same rule for the line; without the capability, disabled with the sentence | not on this route |
| `/fork` in the palette | unchanged | greyed with the helper's sentence, or with "Wait for the turn to end, or stop it first" while the turn runs | not on this route (U4a) |

## Engine facts

This landing makes no statement about the engine that the first landing did not make; it carries two existing host commands over the link. Each fact a milestone rests on, and where it is recorded:

| fact | recorded in |
|---|---|
| `interrupt { send_now: true, message_uuid }` behind a running shell command answers `delivering` and moves the command, never kills it. While the call is not yet a task (about its first 3 s) the engine waits for the task, moves it, ends the turn `aborted_tools`, and the message is the next turn. Once the call is a task there is no cut: the message is read in the same turn at the tool boundary and the turn ends `completed` (corrected 2026-11-15 to the probe of U4b) | `spikes/protocol-probe/fixtures/uxwave/u4p2-a-1.jsonl` to `-3`; `findings-uxwave-u4-send-now-cases.txt`; `fixtures/uxwave/u4b-pair-1.jsonl` to `-5` (1.5 s) and `u4b-pair-late-1.jsonl` to `-5` (10 s); `findings-uxwave-u4b-send-now-early.txt` |
| while the model only writes it answers `stopped` | `u4p2-k-text-1.jsonl` to `-3` |
| for a uuid never sent, one withdrawn first and one already started it answers `nothing_waiting` and the turn goes on | `u4p2-n-never-*`, `u4p2-n-dropped-*`, `u4p2-n-started-*` |
| every message waiting at the next step goes with the one named, in order, the one named last, at both timings; they are one user message (under the named one's uuid) only while the call is not yet a task, and each its own replay read in the running turn once it is one (corrected 2026-11-15 to the probe of U4b) | `u4p2-two-1-*`, `u4p2-two-2-*`; `u4b-two-1.jsonl` to `-3` (1.5 s), `u4b-two-late-1.jsonl` to `-3` (10 s) |
| a `next` frame for a message followed at once by the request naming it never answers `nothing_waiting`; the request written before the frame answers `nothing_waiting`, moves nothing, and the message then waits for the command's own end; a request for a message already read answers `nothing_waiting` with no effect | `u4b-pair-*`, `u4b-two-*` (no gap, 19/19); `u4b-reqfirst-1.jsonl` to `-3`; `u4b-read-1.jsonl` to `-3`; `findings-uxwave-u4b-send-now-early.txt` |
| a send-now and a `cancel_async_message` written together: the answers and what the turn's end reads | `u4p2-stop-inflight-hold-1.jsonl` to `-3` |
| a Stop that holds, written after the move | `u4p2-stop-moved-hold-*`, `u4p2-stop-after-hold-*` |
| `cancel_async_message` answers `cancelled: true` for a waiting message and the lifecycle reads `cancelled` | `u4p2-n-dropped-1.jsonl` (rows 40 to 42 by the findings file) |
| an engine that does not know `send_now` (2.1.283) performs a plain interrupt | `u4p2-old-1.jsonl` |
| a side question is one round trip and streams nothing | `spikes/protocol-probe/fixtures/pass3/p1-side-question-session.jsonl` |

The answer envelope is MAWS's own text (`askSteerText` in `src/shared/maws/ask.ts`), not the engine's.

## Acceptance

The child's A9 and A18 bind, and A3, A5, A7 and A20 where they say "on another machine". The items below say how each is shown. 1 to 19 are the executor's, by tests that fail before the milestone's code and pass at its head; 20 is the architect's run on a Mac and then the owner's sitting.

1. (A9) A message whose text is MAWS's answer envelope for one question, waiting at the next step, is a row that reads `Answer to <header>: <words>` where the window's transcript holds the ask, and `Answer to <the question's text>: <words>` where it does not; after a Stop holds it the row reads the same, marked "Held".
2. An envelope for three questions reads `Answers to 3 questions: …; …; …` in the asked order; a skipped answer reads "Skipped" and one left to the agent "Decide for me", in `askAnswerCopy`'s words; the row's hover title is the whole line. The title of each is what the ask's capsule shows for that question: one function gives both.
3. The row still offers Send now only, and ↑ still skips it; a folded stack whose first row is an answer reads `3 queued · Next: Answer to …`.
4. (A18) With the card column shown for a session whose card is open, the window holds that card once: inside the column's `aside`, after the cards' list, and nothing over the pane's corner. Folded, the chip is there. With the card closed, the `aside` holds what it holds with nothing registered at the foot.
5. With the column not shown (the cards off, a side surface open, the room too small), the card is over the pane's corner and the column holds none. With a page open, where the column keeps its place and is hidden, the card is with the hidden pane and the hidden column holds none: `shown` is the test, not `placed`.
6. In a split of two sessions the focused pane's card is the column's foot and the other pane's card is over its own corner; moving the focus swaps them. A session drawn in the floating card, in its pill or in the bar keeps its card inside that pane whatever the column shows.
7. With a session that has no ready process, Enter in the card starts it; while that start is unanswered the card is moved (the cards are turned off, and on again) and Enter is pressed again in the card where it now stands: nothing more is asked; when the start answers, exactly one side question was asked. A start that is refused shows its reason, and the reason is still shown after the card is moved and after it is folded and opened.
8. During an accepted edge drag of a tab the card at the column's foot is hidden with the column and none is drawn over the pane's corner; when the drag is cancelled or dropped the card is shown at the foot again, the same element.
9. (A3, A5 on another machine) For a session on a machine whose handshake lists `rl2.send-now`, Send now on a next-step row invokes `session.steer.sendNow` once for that row's message and no `session.interrupt`; main builds it as an engine-host act on the open session, sealed for its live launch, carrying `requires: 'rl2.send-now'`; the endpoint runs it for a member who holds `converse` and refuses `grade` below it, `read-only` on a machine in read-only mode and `context` for a stale launch. Esc on such a first row does the same.
10. On a machine whose handshake does not list it (build G's list, and build F's), Send now is drawn disabled with "Can’t send now on `<machine>` yet. Update MAWS on `<machine>` and try again."; Esc shows that sentence in the stack and invokes nothing; ⌘. and the square still stop; main sends such a machine nothing and answers "Not sent now: update MAWS on `<machine>` and try again" if asked anyway. While the machine is offline the control reads "Send now is unavailable while `<machine>` is offline."
11. For a session with no live launch on the machine, a Send now and a cancel each acquire nothing and send nothing. The Send now answers "Not sent now: the session isn’t running on `<machine>`". A Delete so refused shows no toast and reads the record: where it says the agent read the message the stack says "The agent has already read this message", and otherwise nothing is said.
12. A Send now the endpoint accepted and the engine host answered `refused unavailable` reads "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over"; one refused `unavailable` in place of the acceptance reads "Not sent now: `<machine>` is busy; try again in a moment". At the endpoint, a host with no handler for the command gives exactly the first shape: the act acknowledged, then its outcome refused.
13. (A7 on another machine) ↑ on the newest next-step row of a session on a machine that lists `rl2.session-acts`: the claim's `session.drafts.set` is acknowledged before `session.steer.cancel` is invoked; the settling save is invoked only after the load; each of the two saves is invoked once; the box is read-only from the press to the settle's acknowledgement; a second ↑ meanwhile does nothing. With the claim unanswered, nothing is withdrawn.
14. (Every route that has rows.) With the withdrawal unanswered and the record's call failing: nothing is loaded, no settling save is invoked, the stage is still stored and the box still held. When the call then answers: listed, the withdrawal is invoked again and nothing had been loaded meanwhile; read (the agent took the message between the two reads included), the stage is cleared, the stack says "The agent has already read this message" and the box never held the message; gone, the message is loaded with no line. A record that answers incomplete, with the link up, loads the message under "This message may already have been read; check the transcript before sending it again". For a session over the link, the next ask comes when its machine's link opens again and does not wait for the backoff. After a load, however often the settle is asked again, the record is not asked again.
15. On a machine that lists no `rl2.session-acts`: Edit reads "Can’t edit on `<machine>` yet. Update MAWS on `<machine>` and try again." and Delete "Can’t delete on `<machine>` yet. …" on a next-step row; ↑ on such a newest row shows the Edit sentence and walks no history; Edit and ↑ on an after-the-turn or a held row read "Taking a message back needs a newer MAWS on `<machine>`" with no `session.drafts.set` sent; Delete on those rows works. A refused withdrawal after the act reads "Not taken back: …".
16. A Send now answered `nothing_waiting` shows no line and marks no row "Sending…". A Delete answered `already_started` shows the line only where the record says the agent read the message.
17. (A20) In the palette of a session on another machine whose turn runs, `/fork` is greyed with "Wait for the turn to end, or stop it first"; the panel says the same and forks nothing.
18. The desk's web app typechecks, builds and passes its tests at each milestone's head, and its ask capsule's lines are what they were.
19. (Conditional; M3, "The conditional step".) If built: while a turn runs, Send now on an after-the-turn row invokes `session.queue.promote` at `next` and then `session.steer.sendNow` for the uuid the promote answered, and never a promote at `now`; with no turn running, in a paused queue, under an engine host that does not take the command, and on a machine that does not list `rl2.send-now`, it is the promote at `now`, as today. If not built: the promote at `now` everywhere, as today.
20. On a Mac, two machines: the scenes of M4, and the list for the owner's look.

Not acceptance of this landing: anything of A3 or A7 on this Mac that the first landing proved and this one does not change.

## Constraints that bind every milestone

- `~/.local/share/maws-ux-wave/briefs/build-common.md` binds as written: no typecheck, lint, test, install, build or Electron on the authoring machine; every check on the wave's build VM through `vmcheck.sh` under a time limit; the guards that read source text (a ticket number in renderer source is written in words); class 1a, the review and the pull request are the architect's.
- UC-7: a control for an act on a session on another machine reads the helper and nothing else (`test/lane-b/renderer-guards.test.ts` holds the renderer to it); the offer table is the only door, and each row is tested where it runs (`test/endpoint/`); `test/lane-b/offer-coverage.test.ts` passes unchanged.
- UC-8 and UC-3: the insertions in files other children own, the transcript's three among them, are those of Interfaces I and no others. An executor who needs another stops and reports.
- UC-11: the repository is public. Test content is invented; no machine, account, path or session text of a person's enters a test, a fixture, a comment or a commit.
- UC-14: nothing is stored that is not stored today; neither settings file, no layout key and no stored tab changes.
- D-1 and law 6: the engine is not patched and not guessed at; no milestone adds an engine statement beyond "Engine facts" and, for the conditional step, the probe's findings file.
- Light theme default; components use tokens only. The foot uses the cards' existing classes.
- Every sentence a person reads is in Interfaces D or A, as written there; an executor adds none.
- The desk's web app imports files of M1 and M3: every milestone's checks include its typecheck, build and tests (decision 16; Concrete Steps, 2).
- The link's minor is not raised on the branch (decision 6).

## Plan of Work

### M1 — A waiting answer reads as an answer

**What exists at its end.** A waiting message that is MAWS's answer envelope is drawn in the stack as "Answer to …" (Acceptance 1 to 3), on both routes that have rows.

**What it touches.** `src/renderer/src/composer/queue/stack.ts` (the row's `answer` becomes its words or null; `answerWords`; `STACK_WORDS.answer`, `.answers`, `.answerBare`; `rowText`), `composer/queue/stack-acts.ts` (`Read` gains `questions`, filled by `readOfEntry` from the entry's rows of kind `ask`), `composer/queue/QueueList.tsx` (the one test of `row.answer`), and their tests `stack.test.ts` and `QueueList.test.tsx`. In the transcript's files (UC-3; Interfaces I): one export in `transcript/model/copy.ts`, `askQuestionTitle`, and one call of it in `transcript/view/rows/AskCapsule.tsx` and in `transcript/model/serialize.ts`, each in place of the expression written there.

**Interfaces.** Exposes Interfaces A. Consumes `readAnswerEnvelope` (U3a), `askAnswerCopy` (`transcript/model/copy.ts`), the `ask` row of `transcript/model/rows.ts`.

**Decisions.** Decisions 2 and 3. `isAnswer` goes; nothing in `composer/` calls `parseAskSteer` afterwards. `newestToTake` and the row's controls test `row.answer !== null`. The `sending` and `handed` rows, which carry text and no controls, take their text through `answerWords` too, falling back to what they read today: a held answer that is sent now is `submitting` for a moment, and a message the transcript holds unread may be an answer whose capsule the window does not hold. A question is matched by the answer's `id` against the row's `questions`; an answer whose id the row does not hold, and every answer where the window holds no such row, takes the answer's own `question` text as its title. The export moves no word: `askQuestionTitle(question)` is `question.header ?? question.question`, the capsule's expression as it stands on master (and on U1b's branch).

**What it does not touch.** `src/shared/engine/arrival.ts`, `src/shared/maws/ask.ts`, the transcript's model and view beyond the three one-line edits, `entry-text.ts`, the envelope sent to the model, the row's controls, the other places that choose a title for another reader (the envelope's line for the model, the engine's own question rows, the sheet).

**What it proves.** Acceptance 1 to 3, and 18. Its tests also pin: a text that is no envelope is no answer (one changed character in the tag); a question with a header reads the header and one with an empty header reads `Answer: <words>`, as the capsule's label is empty for it; an answer with a note reads `askAnswerCopy`'s line with the note; an envelope whose ask the transcript holds under a folded turn still finds its title; the capsule's and the copied form's existing tests pass unchanged.

### M2 — The `/btw` card at the column's foot

**What exists at its end.** The card is the column's foot wherever the column is drawn for its session, and over the pane's corner otherwise; a move loses neither a start in flight nor its refusal (Acceptance 4 to 8).

**What it touches.** New `src/renderer/src/side/btw-place.ts` and its test; `side/BtwCard.tsx` (the placement `'foot'`, `BtwCardFoot`; the card hands `useSideAsk` its start and refusal from the store) and `BtwCard.test.tsx`; `side/BtwView.tsx` (`useSideAsk`'s `kept` takes them) and `side/store.ts` (the card's two fields and their setters); `side/register.ts` (the slot's registration in `registerSidePane`); `panel/summary/Summary.tsx` (one class, U8's file; `Summary.test.tsx` is not edited); `app/Shell.test.tsx` (the cases of Acceptance 4 to 7, on the mounted shell, with the slot registered as the app registers it) and `app/Shell.drag-edge.test.tsx` (Acceptance 8).

**Interfaces.** Exposes Interfaces B. Consumes `useCardColumn` (`app/shell-view.ts`), `cardSession` (`shell/floating.ts`), the slot `sessionCardFoot` (`app/slots.ts`).

**Decisions.** Decisions 4 and 5. The foot's mount reads the same on-screen rule as the corner's for the unseen dot (`useOnScreen`: the column's session is the focused pane's, so it is on screen while the column is shown). While a page is open the column is not shown, so the card goes with the pane behind the page, as it is today. `data-btw-card` and `data-btw-chip` take the value `foot`. The foot's wrapper is a plain `div`: the `aside` is already the landmark and the card is its own labelled `section`. In the store the start in flight is set before `startForSide` is awaited and cleared when it answers, by the continuation that began it, whichever mount is drawn by then; the refusal is cleared at the next start and at the next promotion, as the component's own is today. The view outside the card (a side thread's questions) passes no `kept` start and keeps its own state.

**What it does not touch.** `session/SessionPane.tsx`, `app/Shell.tsx`, `app/slots.ts`, `app/slot-fallbacks.tsx`, `app/shell-view.ts`, `app/shell-geometry.ts`, the cards, the card's exchanges and timer, `askSide` and the side-question operations, the Side pane.

**What it proves.** Acceptance 4 to 8, in jsdom, which has no layout: where the card is in the tree and how many there are. That it stands at the column's bottom, that the cards end above it, that it covers neither the composer nor the jump control, and that the cards' boxes are what they were with the card closed, is M4's scene on a Mac. Its tests also pin: with the card closed the foot draws no element (the column's wrapper has one child, as U8b's test says); `btwPlace`'s whole table (Interfaces B); the test of Acceptance 7 holds `startForSide` unanswered across the move and counts the `session.sideQuestion` invocations at the end; a fold while a start is in flight is the same case and has the same answer.

### M3 — Send now and taking back on another machine

**What exists at its end.** Acceptance 9 to 17, and 19 as the probe decides.

**What it touches.** U9's four files, by the insertions of Interfaces I: `src/endpoint/offers.ts`, `src/endpoint/capabilities.ts`, `src/shared/ipc/remote-unavailable.ts`, `src/main/lane-b/remote.ts`; the helper `src/renderer/src/lane-b/remote-unavailable.ts` (one export). This child's own: `composer/queue/stack-acts.ts` (`Refusals`; what Send now and Delete show; `stackActs`' third argument), `composer/queue/QueueList.tsx` (the three titles read the new fields; it hands its `client` to `stackActs`), `composer/queue/take-back.ts` (decision 10's condition; decision 12's `unasked`; `recordSaysRead`), `session/controls/lane-b.ts` (its header comment: the command is offered), `composer/mentions/SlashPalette.tsx` and `widgets/ForkWidget.tsx` (decision 11). Tests: `src/shared/ipc/remote-unavailable.test.ts`, `src/main/lane-b/remote.test.ts`, `test/endpoint/session-acts.test.ts`, `src/renderer/src/lane-b/remote-unavailable.test.ts`, `composer/queue/QueueList.test.tsx` (the block "the stack’s refused controls", and the case "says the agent has the message when Send now finds nothing waiting", which becomes its opposite), new `composer/Composer.remote-stack.test.tsx`, `composer/queue/take-back.test.ts` and `take-back-lifecycle.test.tsx`, `session/controls/lane-b.test.ts`, `composer/mentions/SlashPalette.test.tsx`, `widgets/ForkWidget.test.tsx`, and `test/lane-b/renderer-guards.test.ts` (its two entries for `session.steer.sendNow` go).

**Interfaces.** Exposes Interfaces C, D and E. Consumes U9's `disabledWords`, `refusalWords`, `failureWords`, `REMOTE_NEEDS`, `ACT_WORDS`, `useRemoteUnavailableAs`, `useForkUnavailable`, `remoteStandingOf`; U4a's `QueueControls.sendNow`, `stackActs`, `takeBack`, `readRecord`.

**Decisions.** Decisions 6 to 15. The order of edits that keeps `test/lane-b/offer-coverage.test.ts` green at every commit: the row in `OFFERS`, the name in `ENGINE_HOST_ACTS`, the capability in `ENDPOINT_CAPABILITIES`, the entry in `REMOTE_NEEDS` and the removal from `REMOTE_UNAVAILABLE` are one commit. `apps/org-protocol/` is not edited on the branch (decision 6). `session.steer.sendNow` is not a send: it is not added to `SENDS`, so it never waits behind a `session.send` that is still out, as an interrupt does not. The port's `sendNow` in `session/controls/lane-b.ts` is unchanged in code: a session on another machine was never gated there, and now its invocation reaches the adapter. `SESSION_ACTS` in `remote.test.ts` is the capability list the existing cases relink with; the new cases relink with build G's list (it, without `rl2.send-now`) and build F's (neither), written out in the test as constants read from the two builds. The take-back's change is made for every route in one place, `record()` and `forward` in `take-back.ts`, and the harness of `take-back.test.ts` gains a scripted failure of `session.promptHistory`, which it has never had; its two cases of a record that cannot say stay as they are.

**The conditional step** (decision 15). Before M3 starts, the executor looks for the probe's result: a dated section of `spikes/protocol-probe/findings-uxwave-u4-send-now-cases.txt` (or a findings file beside it that the architect names) on master, with its fixtures, answering the question of "Probes". The step is built only if all three hold in it: (i) the request, written at once after a `next` frame for a message during a shell call that is not yet a task, waited for the task and moved the command in five runs of five; (ii) it records whether another message already waiting at the next step is delivered with it, either way; (iii) the request never answered `nothing_waiting` for a message whose frame had just been written. Built, it is one branch at the head of `stackActs.sendNow`: for a row of kind `after`, while a turn runs, where the row's own next-step Send now would not be refused (`sendNowRefusal` for a next-step row is null: this Mac's host takes the command, or the machine lists `rl2.send-now`), the act is `session.queue.promote` at `next` and then, with the uuid it answers, `session.steer.sendNow`; a promote that fails is said as today and nothing follows; a send-now that fails after the promote leaves the message waiting at the next step, which is the safe side, and is said as any Send now's failure. Everywhere else it stays the promote at `now`. If (ii) is yes, the control's title on such a row counts the next-step messages with it (`STACK_WORDS.sendNowAll`) and the architect corrects the child's cell "that message alone goes now"; if no, the title is today's. Its tests replay the probe's fixtures as U4a's replay its own. If the result is not on master when M3 starts, or any of the three fails, the step is not built: `stackActs.sendNow`'s branch for a row that is not at the next step stays as it is, and M4's tracker edit says so. The executor records which in Progress.

**What it does not touch.** `src/engine-host/` (the command, the queue, the normaliser, the op ledger), `src/services/` (the draft store), `src/endpoint/actions.ts` and `authorize.ts`, `src/shared/ipc/schema/` and the wire's manifest, `apps/org-protocol/`, `lane-b/remote-drafts.ts`, the take-back's claim, withdrawal, load and settle, `composer/Composer.tsx`, lane A.

**What it proves.** Acceptance 9 to 17, and 19. Its tests also pin, each by holding the sequence open and not by the final state alone:
- a Send now over the link whose act is not yet answered: that row's controls are disabled, the other rows' are not; its answer `delivering` marks every next-step row "Sending…"; `nothing_waiting` shows nothing; an answer that never comes ends at main's bound as a toast, "`<machine>` took the request but hasn’t confirmed it", with the row left as it was;
- a second fresh Esc while the first Send now is out invokes the command a second time and never `session.interrupt`;
- a Send now handed to main while a `session.send` of the same session is still out goes at once;
- the take-back's three crossings in order (Interfaces F), with the claim held open, then the cancel held open, then the settle held open, and at each hold: what is invoked so far, that the box is read-only, and that a second ↑ and a press of Edit do nothing;
- the record's call held failing (Acceptance 14): at each point of the wait, what has been invoked, that nothing is loaded and that the stage is stored; then each of its four answers in turn; and the message taken by the agent between the failed read and the next one, which ends cleared with the box never having held it;
- `storeRefusesStage` for a machine whose capabilities are not yet known (the link not up) answers null, and the first press then goes by the claim's answer, as today;
- the two shapes of `unavailable` at the device (Acceptance 12), and at the endpoint a host with no handler for the command: the act acknowledged, then its outcome `refused unavailable` (`src/engine-host/ops.test.ts` already pins the host's side, a name with no handler; that case is pointed at, not added).

### M4 — The scenes, the record, the last run

**What exists at its end.** The e2e scenes below, written and typechecked and not run; the record; the landing's one whole-suite run green on the VM.

**What it touches.** `e2e/composer.spec.ts`, `e2e/side.spec.ts`, `e2e/remote.spec.ts` and whatever of `e2e/support/` the three need; `docs/tech-debt-tracker.md`; `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (two dated sentences); this document's Progress, Surprises and Outcomes.

**The scenes.**

| spec (group in `package.json`) | scene | what it shows |
|---|---|---|
| `e2e/composer.spec.ts` (`e2e:composer`, `e2e:c7`) | new: "U4b, a waiting answer" | on the replay that keeps a turn running (`steerStopJournal`), the envelope `askSteerText` builds for one invented question is handed to the running turn through `session.steer` (the replay matches a user write by its type, not its text); the stack's row reads "Answer to `<the question>`: `<the label>`", offers Send now and neither Delete nor More; ↑ in the empty box walks the history and takes nothing back; after the square's Stop the row reads the same, marked "Held" |
| `e2e/side.spec.ts` (`e2e:side`) | changed: scene 5 | before `/btw` is asked, the boxes of the cards' list and of each card are recorded. The card it then asks for is `[data-btw-card="foot"]` inside the "Session cards" region, and `[data-btw-card="corner"]` has count 0; the card's box lies inside the column's, its bottom edge within 8 px of the column's, and it intersects neither the composer's frame nor the jump control; each card's box is what was recorded. The "Session cards" icon pressed off moves the card to the corner, and pressed on moves it back; folded, the chip is in the column. After Close the list's and the cards' boxes are those recorded. After "Continue as a side thread" the Side pane is open, the column is gone and the card, where still open, is at the corner |
| `e2e/side.spec.ts` (`e2e:side`) | unchanged, to be confirmed green: scene 8 | a side surface is open throughout, so its `[data-btw-card="corner"]` stands |
| `e2e/remote.spec.ts` (`e2e:remote`) | new: "U4b, Send now, a take-back and a Delete on B" | B's replay list (`MAWS_E2E_REPLAY_FIXTURES`, one journal per launch, in order) holds three journals this scene writes with the writers U4a added, no new one: `sendNowJournal(dir, 'u4b-b-now')`, `steerStopJournal(dir, 'u4b-b-back')`, `steerStopJournal(dir, 'u4b-b-delete')`. The first holds a send-now's request and answer; each of the other two holds one steer and the engine's answer to its `cancel_async_message`, which is all a take-back and a Delete write. Three sessions MAWS runs on B are opened from A in that order, one step each. First: A types a message and presses Enter, a "Next step" row; Send now; B's journal holds an outgoing `interrupt` with `send_now` and that message's uuid and no `cancel_async_message`; the row leaves; A's transcript reads "Ended for your message". Second: a message, Enter, then ↑: the box holds it; B's journal holds the `cancel_async_message` for its uuid; and the draft kept for the member on B, read from A through `session.drafts.get` once the box takes typing again, is the message as an ordinary draft, with no `takeBack` (the order of the two saves and the cancel is M3's unit proof, not this scene's). Third: a message, Enter, Delete on its row: the row leaves, B's journal holds the cancel, and no line is said. While the second session's turn runs, its `/fork` row in A's palette is greyed with "Wait for the turn to end, or stop it first"; once a session there is idle, `/fork` picked in A's palette opens the fork's tab on B (the fork's own launch takes one more journal on B's list, the one U9's fork scene in this spec uses). Each step asserts that B's turn was not stopped by it |
| `e2e/remote.spec.ts` (`e2e:remote`) | new: "U4b, a machine that does not offer Send now" | the first session's opening with B's endpoint started under `MAWS_E2E_ENDPOINT_WITHOUT: 'rl2.send-now'`: the row's Send now is disabled with the sentence; Esc shows it in the stack; B's journal holds no outgoing `interrupt`; ⌘. stops B's turn. A second run of the block with `'rl2.send-now,rl2.session-acts'`: Edit and Delete disabled with their sentences, ↑ says Edit's and the box stays empty |
| `e2e/remote.spec.ts` (`e2e:remote`) | unchanged, to be confirmed green: the M8 scene's `/btw` step | it finds `[data-btw-card]` inside the main region, which holds the column |
| `e2e/p1-live.spec.ts` (`e2e:p1-live`, a paid live group) | considered, not changed and not run by an executor: S3, case 4 | it asks `/btw` while an artifact surface is open, so the column is not shown and the card stays over the pane's corner, where the case looks for it. This landing changes neither that group's scenes nor what it proves, so no paid run is owed (UC-10); if the surface is ever closed before that step, the case finds the card at the foot |

Groups whose scenes cross what this landing moves and gain nothing, to be run as they are: `e2e:layout` and `e2e:panel` (the column's wrapper), `e2e:lane-a` (a terminal session's `/btw`), `e2e:widgets` (the palette's `/btw` and `/fork`), `e2e:tools` (the async ask and its capsule), and the default group.

**The record** (in the same pull request, UC-10).
- No ruling is reversed and no contract of the charter is amended, so `docs/charter.md` is not edited.
- `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md`: at the two places U9's amendment of 2026-11-13 stands ("From the UX wave (U9), behind `rl2.session-acts`: …"), this sentence is appended: "Amended `<date>` (the UX wave, U4b; `docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md`): behind `rl2.send-now`, sending now a message that waits at the next step (`session.steer.sendNow`) is offered; it and taking back a waiting message (`session.steer.cancel`) are sealed for the session's live launch and never resume a session." `<date>` is the landing date.
- `docs/tech-debt-tracker.md`: the row "No e2e scene drives a take-back … or a `/fork` of a session on another machine" is closed (its closing column names the new scene). The row "The first press on a machine of an earlier build" is reworded to this Mac's own services, with the sentence that a machine over the link is closed from the first draw. The row "A Send now on an after-the-turn row in about the first 3 s" is closed if M3's conditional step was built, naming the probe's file; if it was not, it loses "U4b is where it would go" and gains what the probe found, or that its result had not landed. No row is added: the two faults this document first proposed to log (the record that could not be asked, and the line over a row that reads "Held") are fixed in M3.
- The register's rows (X-049, O-20), the board ticket, the tracker rows this landing closes on the board and the root's tracking map are updated at landing by the sessions that keep them, not by the executor.

**What it does not touch.** Any source file. `e2e/cross-build.spec.ts` and the coverage table (nothing new is stored). `e2e/p1-live.spec.ts`.

**What it proves.** Nothing by running: the scenes are the architect's to run. The whole unit suite, the whole typecheck (which covers the e2e specs' project and the desk's web app), the root build, eslint over the branch's paths, and the gate's script tests (the diff touches `e2e/`).

## Concrete Steps

From the worktree of branch `ux-wave/U4b`. `vmcheck.sh` is `~/.local/share/maws-ux-wave/tools/vmcheck.sh`; on the VM `<paths>` are repository paths. The VM is shared with landings in build: a slow or timed-out check is read against its load first.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Merge, never rebase or force-push. Then check what this landing stands on:

       git grep -n "sessionCardFoot" -- src/renderer/src/app/slots.ts src/renderer/src/panel/summary/Summary.tsx
       git grep -n "export function readAnswerEnvelope" -- src/shared/engine/arrival.ts
       git grep -n "'session.steer.cancel': SESSION_ACTS_CAPABILITY" -- src/shared/ipc/remote-unavailable.ts
       git grep -n "'session.steer.sendNow': notYet" -- src/shared/ipc/remote-unavailable.ts
       git grep -n "question.header ?? question.question" -- src/renderer/src/transcript/view/rows/AskCapsule.tsx src/renderer/src/transcript/model/serialize.ts
       ls spikes/protocol-probe/ | grep -i "u4"

   Each of the first five prints a line (the fifth, two: the expression M1 exports; if a sibling changed it, the export is what stands there). The last lists the findings files of the composer's probes: M3's executor reads them for the conditional step (M3, "The conditional step"). Then, for every file "What this document assumes of landings in flight" names that the merge changed (`git diff --name-only 63c97b5c0 HEAD`), read it again against that table's third column before building on it; where an assumption fails, do what the fourth column says, and where that is not enough, stop and report.

2. **The checks**, on the VM. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U4b
       vmcheck.sh ux-wave/U4b -- 'timeout 600 pnpm exec vitest run <the milestone's test files>'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # the renderer
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'    # main, the endpoint, shared (M3)
       vmcheck.sh ux-wave/U4b -- 'timeout 600 pnpm exec eslint <the paths changed>'

   The first call for the branch installs dependencies there; allow it twenty minutes. Each call's exit status is the command's, so it is never piped into `tail` or `head` without `set -o pipefail`. At a milestone's tests-first commit the vitest run fails on the new assertions (for M1, a line such as `expected '[MAWS ask a-1] The user answered …' to be 'Answer to Layout: Grid'`); at its head it prints `Test Files … passed` with no failure, `tsc` prints nothing and eslint prints nothing.

   Per milestone, the test files: M1 `src/renderer/src/composer/queue`, `src/renderer/src/composer/Composer.test.tsx`, `src/renderer/src/transcript` (the capsule and the copied form), `test/support/tokens-guard.test.ts`. M2 `src/renderer/src/side`, `src/renderer/src/panel/summary`, `src/renderer/src/app/Shell.test.tsx`, `src/renderer/src/app/Shell.drag-edge.test.tsx`, `src/renderer/src/session`, `test/support/tokens-guard.test.ts`. M3 `src/shared/ipc/remote-unavailable.test.ts`, `src/shared/machine`, `src/main/lane-b`, `test/endpoint`, `test/lane-b`, `src/renderer/src/lane-b`, `src/renderer/src/composer`, `src/renderer/src/session/controls`, `src/renderer/src/widgets`, `src/renderer/src/sessions`, `src/engine-host/ops.test.ts`.

   And at every milestone's head, the desk's web app, which imports files of M1 and M3 (decision 16):

       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm --filter desk-web build'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm --filter desk-web test'

   Each ends with no error. Its tests of the transcript's ask capsule pass unchanged; a change in what it draws is reported, not fixed in passing.

3. **The wire's manifest** does not change. After M3, `vmcheck.sh ux-wave/U4b -- 'timeout 300 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'` passes with `WIRE_MINOR` untouched. If it fails, something was added to the wire by mistake: stop and report; never raise the minor to pass.

4. **The last run** (M4), after a fresh merge of master and a push:

       vmcheck.sh ux-wave/U4b -- 'timeout 1200 pnpm typecheck'
       vmcheck.sh ux-wave/U4b -- 'timeout 1200 pnpm build'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec eslint $(git diff --name-only origin/master...HEAD -- "*.ts" "*.tsx" | tr "\n" " ")'
       vmcheck.sh ux-wave/U4b -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck.sh ux-wave/U4b -- 'timeout 2400 pnpm test'

   On the VM these fail on master too and are not this landing's: the desk-hub `test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts`, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` can fail under the whole suite's load and pass alone. Any other failure is this landing's. A run whose log has stopped growing while a process sits at full CPU is a loop: stop it, find the case one file at a time, and report the loop itself.

5. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The hand-back says: what exists, with the command and result that showed it; what is not verified (every scene of M4, by file and name, written and typechecked but not run, with its group); the decisions made; anything that contradicts this document or the child's file; what deserves a ticket.

6. **The link's minor**, not the executor's: at the chain merge, in a commit of its own, `RL2_PROTOCOL.minor` in `apps/org-protocol/src/channel.ts` and the number and title `apps/org-protocol/test/messages.test.ts` pins are raised to master's plus one, naming `rl2.send-now` (decision 6). The branch as handed back leaves both as master has them; its endpoint already lists the capability, which a peer checks without reading the minor.

7. **The architect's, after the hand-back.** "Proof that an executor does not run", in its order.

## Proof that an executor does not run

| # | the proof | when | what it needs | what comes back |
|---|---|---|---|---|
| 1 | **Class 1a** on GitHub Actions | on the head the executor hands back, and again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u4b`, in the background | each job's conclusion and the run's URL; the pull request's body names the run on the final head |
| 2 | **The branch's review** | once class 1a is green | the xhigh panel of `doperpowers:review-code` with the lenses of "Size and review", given the base sha, the head sha and the worktree; U9's keeper reads the insertions of Interfaces I against U9's list (UC-7.6) | its verdict and findings; the findings are settled by a fix wave, never inline |
| 3 | **The new and changed scenes alone, then their groups** (C4; UC-10) | after the review's findings are settled | a Mac under the load rule. Alone, in this order: the new scene of `e2e/composer.spec.ts`; scene 5 of `e2e/side.spec.ts`; the two new scenes of `e2e/remote.spec.ts` (each starts two apps; the first gives B three journals, or four with the fork's). Then the groups: `e2e:c7`, `e2e:side`, `e2e:remote`, `e2e:layout`, `e2e:panel`, `e2e:lane-a`, `e2e:widgets`, `e2e:tools`, and the default group | each scene and group named as run and green; a skipped scene is not evidence. What only this run shows: that the card stands at the column's bottom and covers neither the composer nor the jump control, and that the cards' boxes are what they were with the card closed (jsdom has no layout); that the column is in fact drawn at the e2e window's width in scene 5; that an act crosses a real link and reaches the other machine's engine host |
| 4 | **The owner's look at the built window** | at the wave's next sitting | the card at the column's foot, open and folded, in a tall and a short window; an answer's row with one and with several questions; a refused Send now on a machine of build G, with its sentence | each called a clear improvement, or reworked; the answer to card 1 if it was not given before the build |
| 5 | **Older peers of the link, by hand** | with 3, if a second machine on build G is at hand | this build's app against a machine that runs build G: a next-step row there shows Send now disabled with the update sentence and Edit, Delete and ↑ working; nothing is sent that the machine refuses (its endpoint's log holds no `not-offered` for these acts) | the observation, recorded. No `e2e:cross-build` run is owed and none is offered as a fallback (decision 7) |
| 6 | **The paid live group** `e2e:p1-live` | not owed by this landing | — | its S3 case 4 asks `/btw` with a surface open, so the card stays over the pane's corner where the case looks; this landing changes neither that group's scenes nor what it proves (M4) |

Until row 3 is green, no build that holds this landing is offered to a machine a person uses. Between the first landing and this one, Send now on a session of another machine is refused with a sentence (the root's UC-10, "Landing"); this landing ends that.

## The pull request

Its body names: the class 1a run on the final head; the review's verdict and what was dismissed or deferred; the Mac runs of row 3 by scene and group; the residue (the tracker rows of M4); that no ruling is reversed and no wire minor is taken; the link's minor, taken at the chain merge in its own commit; the insertions in U9's files, for U9's review, the cancel's new refusal among them; the one class in U8's file and the three one-line edits in the transcript's; that the take-back's reading of its record changed on every route (decision 12); whether M3's conditional step was built, with the probe's file; and, if the desk's web app draws any difference, that difference by name. It ends with the session line the build brief gives.

## Interfaces and Dependencies

What must exist at the end, by name. An executor who needs to change a name or a sentence here stops and reports.

### A. The words of a waiting answer (M1)

In `src/renderer/src/transcript/model/copy.ts`, beside `askAnswerCopy`:

    /** A question's title as its ask's capsule shows it: the header, else the question. */
    export const askQuestionTitle = (question: { header?: string; question: string }): string => question.header ?? question.question;

`transcript/view/rows/AskCapsule.tsx` (the answer line's label) and `transcript/model/serialize.ts` (the `ask` case) call it in place of the expression each writes today. No other reader is moved.

In `src/renderer/src/composer/queue/stack.ts`:

    // the two waiting kinds: `answer` is the row's words when the message is an answer, else null
    | { kind: 'next'; key: string; messageUuid: MessageUuid; content: SendContent; createdAt: string; answer: string | null }
    | { kind: 'after' | 'held'; key: string; queueId: string; content: SendContent; createdAt: string; answer: string | null }

    export interface Read {
      unread: readonly Unread[];
      started(messageUuid: MessageUuid): boolean;
      /** The questions of the ask `call` names, from its row in the transcript's model; null where the window holds no such row. */
      questions(call: string): readonly AskQuestion[] | null;
    }

    /** A waiting answer's words, from the reader's class; null for any message that is no answer envelope. */
    export function answerWords(text: string, questions: Read['questions']): string | null;

    // in STACK_WORDS
    answer: (title: string, words: string) => `Answer to ${title}: ${words}`,
    answerBare: (words: string) => `Answer: ${words}`,
    answers: (pairs: readonly string[]) => `Answers to ${pairs.length} questions: ${pairs.join('; ')}`,   // a pair is `${title}: ${words}`, or the bare words

`answerWords`: `readAnswerEnvelope(text)`; null gives null. Its `answers` are taken in the asked order: where `questions(call)` holds the ask, in the order of those questions, and any answer whose id none of them holds after them in its own order; where the window holds no such row, in the array's own order, the only order the window has without reading the envelope's lines (revised 2026-11-15, the Decision Log). For each: the question is `questions(call)?.find((q) => q.id === answer.id)`; the title is `askQuestionTitle(question)` where there is one, and the answer's own `question` where there is none; the words are `askAnswerCopy(answer)`. One answer: `answer(title, words)`, or `answerBare(words)` where the title is empty. Any other number: `answers(pairs)`. (An envelope with no answers cannot be sent, `askAnswersProblem` in `src/shared/maws/ask.ts`; no case is built for it.)

`rowText(row)` is the row's `answer` where it has one, else as today. `stackRows` fills `answer` with `answerWords(messageText(content), read.questions)`, and gives a `sending` and a `handed` row the same words as its `text` where the function answers some. `readOfEntry` in `stack-acts.ts` answers `questions` from the entry's rows: the row of kind `ask` whose `askId` is the call, its `questions`. `NOTHING_READ.questions` answers null.

### B. Where the card is drawn, and what it keeps (M2)

In a new `src/renderer/src/side/btw-place.ts`:

    export type BtwPlace = 'foot' | 'pane';
    /** Where a session's `/btw` card is drawn: the card column's foot, or the session's own pane. */
    export function btwPlace(column: { shown: boolean; session: AppSessionId | null }, floated: AppSessionId | null, appSessionId: AppSessionId): BtwPlace;
    /** The same, followed in a render: `useCardColumn()` and `useLayout(cardSession)`. */
    export function useBtwPlace(appSessionId: AppSessionId): BtwPlace;

| the column is shown | the column's session is this one | the floated session is this one | place |
|---|---|---|---|
| no | any | any | `pane` |
| yes | no | any | `pane` |
| yes | yes | yes | `pane` |
| yes | yes | no | `foot` |

It does not read the shell's edge drag (decision 4): the column is hidden for the drag's length with the card inside it.

In `src/renderer/src/side/BtwCard.tsx`:

    export type BtwCardPlacement = 'corner' | 'flow' | 'foot';
    export function BtwCard(props: { appSessionId: AppSessionId; placement?: BtwCardPlacement }): JSX.Element | null;   // 'corner' by default
    /** The card column's foot (`Slots['sessionCardFoot']`): the session's card while its place is the foot. */
    export function BtwCardFoot(props: { appSessionId: AppSessionId }): JSX.Element | null;

| mount | draws |
|---|---|
| `corner` (the pane, over the transcript) | while the card is not closed and the place is `pane` |
| `flow` (the compact pane) | while the card is not closed, as today |
| `foot` (`BtwCardFoot`) | while the card is not closed and the place is `foot`: the wrapper of decision 5 holding the open card or the chip; else no element |

`data-btw-card` and `data-btw-chip` carry the placement, `foot` included. `registerSidePane()` in `side/register.ts` calls `registerSlot('sessionCardFoot', BtwCardFoot)`. In `panel/summary/Summary.tsx` the wrapper of `SessionCards` reads `flex h-full w-70 max-w-full min-h-0 flex-col`.

In `src/renderer/src/side/store.ts`, the card's per-session state (`BtwCard`, beside `view`, `focus`, `question`, `seen`) gains

    starting: boolean;        // a start of the session for a side question is in flight
    refusal: string | null;   // why the last start, or the last promotion, was refused

with `setBtwStarting(parent, on)` and `setBtwRefusal(parent, words)`; a closed card keeps both, as it keeps its question. In `side/BtwView.tsx`, `useSideAsk`'s second argument becomes

    type Kept = {
      question: string; setQuestion(next: string | ((current: string) => string)): void;
      starting: boolean; setStarting(on: boolean): void;
      refusal: string | null; setRefusal(words: string | null): void;
    };

all of it the caller's where `kept` is given (the card: its store), the component's own state where it is not (the view under a side thread). Nothing else of the hook changes: `canAsk` still reads `starting`, and `ask`, `retry` and `promote` still set what they set.

### C. The offer of `session.steer.sendNow` (M3; UC-7.2's five facts and the words)

| fact | value |
|---|---|
| the command | `session.steer.sendNow { appSessionId, messageUuid } → { outcome: 'delivering' \| 'stopped' \| 'nothing_waiting' }`, as U4a declared it (`src/shared/ipc/schema/session.ts`); unchanged |
| the grade | `converse` (`src/shared/ipc/grades/session.ts`); unchanged. It carries no content; what it adds is ending the running turn, which `session.interrupt` and `session.steer.cancel` allow at `converse` |
| the row | `'session.steer.sendNow': laneB('act')` in `OFFERS`: an act, run by the engine host, placed by `appSessionId`; no `accepts` (a remote caller may send the whole schema, which is two ids) and no `owners` |
| the device's half | the name in `ENGINE_HOST_ACTS`; and the two rules below |
| the capability | `export const SEND_NOW_CAPABILITY = 'rl2.send-now'` beside `SESSION_ACTS_CAPABILITY`; appended to `ENDPOINT_CAPABILITIES` with its comment (the offer, U4b, this document, and that a device sends a machine the act only when its `h2` listed it); `REMOTE_NEEDS['session.steer.sendNow'] = SEND_NOW_CAPABILITY`. The link's minor moves at the chain merge (decision 6) |
| the words | D; and the command's row leaves `REMOTE_UNAVAILABLE` |

**Never resumed for.** In `src/main/lane-b/remote.ts`:

    /** Engine-host acts that act on a live launch alone: with none, nothing is acquired and nothing is sent. */
    const LIVE_ONLY: ReadonlySet<CommandName> = new Set(['maws.pane.answer', 'session.steer.sendNow', 'session.steer.cancel']);

read where `engineAct` today tests the one name, before anything is acquired or waited for: with no live context a command of the set is refused with `issues.refusal: 'not-live'`. The pane answer keeps today's sentence; the other two say `failureWords(name, \`the session isn’t running on ${link.name}\`)`, which is "Not sent now: the session isn’t running on `<machine>`" and "Not taken back: the session isn’t running on `<machine>`". The second is the command's error and is shown by no control (decision 8).

**A host that lacks the handler.** In the same function, for `session.steer.sendNow` alone: where the act's outcome is `refused` with the reason `unavailable` and the endpoint had accepted the act (the handle's progress reached `accepted` before the outcome), the result is `refusalResult(name, link.name, 'host-older')`; in every other case as today. `reasonOf` in `src/shared/ipc/remote-unavailable.ts` gains the case `'host-older'`: `the engine host on ${machine} is finishing an update; this works once it has handed the session over`. `host-older` is the device's own word, as `offline` and `not-live` are; it does not cross the link.

**Where it is authorised, and on what value.** (1) The endpoint (`src/endpoint/authorize.ts`): the caller's grade on the session the act names, `converse` or above, and the machine's read-only mode. (2) The endpoint's lane B branch (`src/endpoint/actions.ts`): the session's status is read, and the context the act was sealed for must be the session's launch and engine session now. (3) The engine host (`src/engine-host/ops.ts`): the input is held to the command's schema, the op is claimed in the ledger, and the context is checked again in the turn of the claim. (4) The act (`MessageQueue.sendNow`): the session is found by the same `appSessionId` the endpoint placed and the ledger claimed, and the uuid must be a pending steer of that session's own queue; any other uuid answers `nothing_waiting` without a word to the engine. So a caller cannot reach another session's message by naming its uuid, and the answer is one word that says nothing of any message's content. Each of (1) to (3) has its refusal tested at the endpoint (Acceptance 9); (4) is U4a's test of the queue, unchanged.

### D. The words (M3)

In `ACT_WORDS`:

    'session.steer.cancel': { act: 'take back', done: 'taken back' },
    'session.steer.sendNow': { act: 'send now', done: 'sent now' },

Before the act, the control is drawn disabled with (the helper, each control passing its own label):

| when | Send now (label `send now`) | Edit, and ↑ (label `edit`) | Delete (label `delete`) |
|---|---|---|---|
| the machine's known capabilities lack the command's | "Can’t send now on `<machine>` yet. Update MAWS on `<machine>` and try again." | "Can’t edit on `<machine>` yet. Update MAWS on `<machine>` and try again." | "Can’t delete on `<machine>` yet. Update MAWS on `<machine>` and try again." |
| the machine is offline | "Send now is unavailable while `<machine>` is offline." | "Edit is unavailable while `<machine>` is offline." | "Delete is unavailable while `<machine>` is offline." |
| the link connects or reconnects, or the capabilities are not yet known | enabled: the act waits under the link's hold and is judged on the channel it goes out on | the same | the same |
| the machine lists no `rl2.session-acts` (decision 10), any row | — | "Taking a message back needs a newer MAWS on `<machine>`" (today's sentence), after the helper's on a next-step row | — |

A key says the sentence of its control in the stack's notice line and does nothing else: Esc on a first row whose Send now is refused, ↑ on a newest row whose Edit is refused.

After the act, main words a refusal as `Not <done>: <reason>` (UC-7.5's second table, with one reason more), and the window shows it as it is, as a toast: "Not sent now: `<machine>` is offline", "Not sent now: update MAWS on `<machine>` and try again", "Not sent now: you can read this session but not act on it", "Not sent now: `<machine>` is in read-only mode", "Not sent now: `<machine>` is busy; try again in a moment" (the endpoint's own `unavailable`), "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over" (the host's, decision 14), "Not sent now: the session isn’t running on `<machine>`"; and the same reasons after "Not taken back: " for a Delete that was refused, but for `not-live`, which a Delete answers from the record. A take-back's own withdrawal shows no such line: what became of the message is read from the record (U4a's decision 13). An act the link carried whose answer has not come by main's bound keeps today's sentence, "`<machine>` took the request but hasn’t confirmed it".

Of the answers that are not refusals: `delivering` and `stopped` mark the next-step rows "Sending…" until each starts; `nothing_waiting` shows nothing (decision 13). "The agent has already read this message" is shown in two places and no third: by a take-back whose record says read, and by a Delete answered `already_started` or `not-live` whose record says read.

### E. The stack's refusals and acts (M3)

In `src/renderer/src/composer/queue/stack-acts.ts`:

    export interface Refusals {
      sendNowNext: string | null;   // Send now on a next-step row: the helper's (label 'send now') on another machine; HOST_UPDATING under another build's engine host here
      editNext: string | null;      // Edit and ↑ on a next-step row: the helper's for `session.steer.cancel`, label 'edit'
      deleteNext: string | null;    // Delete on a next-step row: the same, label 'delete'
      takeBack: string | null;      // Edit and ↑ on any row: the machine's draft store keeps no stage
    }
    sendNowRefusal(refusals, row)   // row.kind === 'next' ? refusals.sendNowNext : null
    takeBackRefusal(refusals, row)  // row.kind === 'next' ? (refusals.editNext ?? refusals.takeBack) : refusals.takeBack
    deleteRefusal(refusals, row)    // row.kind === 'next' ? refusals.deleteNext : null

    export function stackActs(appSessionId: AppSessionId, controls: SessionControls | null, client: MawsBridge = ipc): Acts;

`useRefusals` reads `useRemoteUnavailableAs`; `refusalsNow` reads, in `src/renderer/src/lane-b/remote-unavailable.ts`:

    /** The labelled answer read now, for a key pressed outside a render. */
    export function remoteUnavailableAsOf(label: string, appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null;

`composer/Composer.tsx` calls `sendNowRefusal(refusalsNow(…), first)`, `takeBackRefusal(refusalsNow(…), row)` and `stackActs(appSessionId, controls).sendNow(…)` today and is not edited; `QueueList.tsx` hands `stackActs` the client it was given.

What the two acts on a next-step row show (decision 13):

| act | the answer | shown |
|---|---|---|
| `sendNow` | `delivering`, `stopped` | "Sending…" on every next-step row |
| | `nothing_waiting` | nothing |
| | a failure | its sentence, as a toast |
| `remove` | `cancelled` | nothing; the row leaves |
| | `already_started`, or a failure whose `issues.refusal` is `not-live` | no toast; `recordSaysRead` is asked, and where it answers true the stack's line reads "The agent has already read this message" |
| | any other failure | its sentence, as a toast |

In `composer/queue/take-back.ts`:

    /** Whether the session's record says the agent read the message: `readRecord` over `session.promptHistory` from `since`; false where the record could not be asked. */
    export async function recordSaysRead(client: MawsBridge, appSessionId: AppSessionId, since: string, messageUuid: MessageUuid): Promise<boolean>;

    type Said = { kind: 'gone' } | { kind: 'read' } | { kind: 'unknown' } | { kind: 'unasked' } | { kind: 'listed'; name: Name };

`record()` answers `unasked` where `session.promptHistory` failed, and `unknown` where it answered incomplete or names the message pending while the queue lists it nowhere; the rest as today. `refusalIn` answers the machine's sentence first where `remoteStandingOf(appSessionId)` is not null, its `capabilities` are not null and they lack `SESSION_ACTS_CAPABILITY`; then as today.

### F. The sequences over the link (M3)

This section says what one window does and what is true at each of its steps. It is not a claim of exactly-once across two windows or two devices: the stage's fence is per reader, and after the settle the message is an ordinary draft that two mounts share last-writer-wins, which the tracker already holds (U4a's row "A save from another mount after a take-back has settled").

**Send now.** The press (the row's button, or a fresh Esc) → the window invokes `session.steer.sendNow` → main's adapter: the tab holds the session, the peer's capabilities allow it, the session has a live launch → one engine-host act, sealed for that launch, `requires: 'rl2.send-now'`, never behind a send → the endpoint's four checks (C) → the engine's `interrupt { send_now }` → the engine's word back as `outcome`.

| at this point | the person acts in between | the awaited thing fails or never comes |
|---|---|---|
| the act is out, unanswered | the row's own controls are disabled; a second Esc sends the command again, which the engine answers `delivering` again or `nothing_waiting` (never a stop); a press of Stop is a `session.interrupt` that the machine may decide first: the message is then held, the Send now answers `nothing_waiting` (nothing is shown; the row reads "Held") or is rejected as already being withdrawn (said as a toast), and the turn stops, which is what Stop asked for | the link drops before the act went: it waits under the link's hold and ends "Not sent now: `<machine>` is offline"; the message still waits there. The act went and its answer is lost: main's bound answers "`<machine>` took the request but hasn’t confirmed it"; if the engine did deliver, the row leaves at its `started` |
| the answer is `delivering` | every next-step row reads "Sending…" with no controls until its own `started` arrives over the session's stream | the stream is cut: the rows keep "Sending…" until the stream reopens and the queue's state is read again, which lists what still waits |

**Taking back a next-step row** (↑ or Edit; U4a's five steps, with what crosses the link, and step 3 as decision 12 has it). The window is the only actor; the machine's draft store holds the stage; no step is rolled back.

| # | step | crosses as | a complete copy is in | if it fails, or the person acts |
|---|---|---|---|---|
| 1 | the stage is built and the box held read-only | nothing | the machine's engine (the message waits) | a second ↑ or Edit does nothing while one is in hand |
| 2 | the claim: the stage saved whole, acknowledged | `session.drafts.set { draft: <stage>, replaces: 'claim:no-document' }`, a `machine` act, once, after the session's saves handed before it | the engine; and, once acknowledged, the machine's draft store | refused "a draft with a document is kept": "A draft is kept for this session, so the message was left waiting". Refused as stale (a store before U4a): the machine's sentence, remembered. Refused "a message being taken back is kept": that stage is read and carried forward first. Not sent (the link would cut an attachment), failed, or the link down: "Could not keep the message as a draft, so it was left waiting". In every one of these nothing was withdrawn. Its answer lost at main's bound while the save did land: the same line; the stage is kept there with the message still waiting, the store fences other saves, and the next ↑ or the next mount carries it forward |
| 3 | the withdrawal, then the record | `session.steer.cancel { messageUuid }`, an engine-host act, `requires: 'rl2.session-acts'`, for which the window waits five seconds; then `session.promptHistory`, a call | the machine's draft store (the stage); the engine until the cancel is done | `cancelled`: step 4. Any other answer, none in five seconds, or a refusal (`not-live` included): the record is asked. It says gone: step 4. It says read: step 4's clearing. It lists the message: the withdrawal again, after the loop's wait where the name is the same. It answers and cannot say: step 4 under "This message may already have been read; check the transcript before sending it again". **It could not be asked** (the link is down, the call was refused): nothing is loaded; the stage stays stored, the box stays read-only under "Taking the message back…", and the record alone is asked again after the loop's wait or as soon as the machine's link opens again; the row stays as the queue lists it, and Delete on it still acts |
| 4 | the load, then the settle | the load is the window's; the settle is `session.drafts.set { draft: <the box's draft>, replaces: 'settle:<the stage's revision>' }`, once per attempt | the box; the machine's draft store (the stage until the settle is taken, the draft after) | the agent has the message: the box stays empty, the stage is cleared by a settling save of `null`, and the stack says "The agent has already read this message". The settle fails: it is asked again with a growing wait, the box stays read-only, and after three tries the box's own writer names the form too; the record is not asked again. The settle is refused as stale: another mount settled first; what is kept is read and taken |
| 5 | whoever meets a stored stage carries it forward | steps 3 and 4 | as there | never rolled back |

The order is fixed by awaiting: the cancel is not invoked before the claim's answer, and the settle not before the load. `lane-b/remote-drafts.ts` sends each of the two saves once and reads nothing on their behalf (U4a). Delete is step 3's cancel alone; what it shows is E's table.

### G. Builds: what each side shows when the other does not know a command

Read from the two builds with `git show`: build F lists neither capability, has no `session.steer.sendNow`, declares `session.steer.cancel` unavailable, and its draft store knows no claim; build G lists `rl2.session-acts`, offers `session.steer.cancel`, declares `session.steer.sendNow` unavailable, and its draft store knows the claim.

| the device | the machine | Send now on a next-step row | ↑, Edit, Delete on a next-step row | ↑, Edit on an after-the-turn or a held row |
|---|---|---|---|---|
| this build | this build | works | work | work |
| this build | build G | disabled, "Can’t send now on `<machine>` yet. Update MAWS …"; Esc says it; nothing is sent | work | work |
| this build | build F | disabled, the same sentence | disabled, "Can’t edit …" and "Can’t delete …"; ↑ says Edit's | disabled from the first draw, "Taking a message back needs a newer MAWS on `<machine>`"; Delete works (`session.queue.remove`) |
| build G | this build | disabled in G's window, "Not on another machine yet: sending a waiting message now while the agent works"; G sends nothing | work, as between two machines of build G (the rule that a cancel starts no session is the device's, so a device of build G still resumes for one) | work |
| build F | this build | F has no such command: its Send now and its Esc are `session.interrupt`, which is offered and stops the turn, as F does everywhere | F's next-step row offers Send now and Hold alone, and F declares the cancel unavailable | F has no take-back: its held row's own Edit and Delete are `session.queue.edit` and `session.queue.remove`, both offered |

**A machine of this build whose engine host is still an earlier build's.** After an update a machine's earlier engine host serves its live sessions until they are idle or handed over, under an endpoint that already lists `rl2.send-now`. A retained host of build G has the handler and runs the act. A retained host of build F has none: the endpoint accepts the act, the host answers `refused unavailable`, nothing is stopped, and the device says "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over" (decision 14). The control is not drawn disabled for that case, for two reasons. The fact is not carried over the link: a device learns an endpoint's capabilities from its handshake and nothing of which host serves a session, and no interface is added to carry it (ruled). And the pairing does not arise from the builds in use: it needs a machine updated straight from build F with sessions alive, where every machine at this writing runs build G or later, whose host has the handler. On this Mac the same state is known before the act and the control is drawn disabled (U4a's decision 30).

The proofs: the device's cases at both older lists and at both shapes of `unavailable` (`src/main/lane-b/remote.test.ts`), the endpoint's case of a host with no handler (`test/endpoint/session-acts.test.ts`), the window's cases at both lists (`QueueList.test.tsx`, `Composer.remote-stack.test.tsx`), and M4's scene with the capability withheld. The rows whose device is an older build are those builds' own behaviour and are stated, not run.

### H. What is stored or sent (UC-14)

This landing stores nothing that is not stored today, and both older builds read everything it leaves.

| value | this landing | build F and build G |
|---|---|---|
| a take-back's stage in a machine's draft store (a member's draft whose document carries `attrs.takeBack`) | written exactly as U4a writes it; reachable for a next-step row on another machine since pull request 650; no field, key or form changes. It can now stay stored for as long as its record cannot be asked, where before it was settled at once | F's store refuses the claim as stale, so nothing is staged there; G's store is this build's. A device of build F that opens such a session reads the stage as an ordinary draft, and its saves are fenced by a store of this build or of G (U4a's row of the cross-build coverage table). A window of build G that meets a stage carries it forward by G's own rule, which loads on a record it could not ask |
| the card's state (its start in flight and refusal included), and where it is drawn | the window's memory; never stored | — |
| the endpoint's capability list | one more name in the `h2` | a device of F or G does not know the name and passes it by: a peer checks a capability, never the minor (`apps/org-protocol/src/channel.ts`) |
| `session.steer.sendNow` as an act on the link | sent only on a channel whose peer listed `rl2.send-now` | never received by F or G from this build; if one arrived, neither has a row for it and answers `not-offered` with nothing run |
| the wire between an app and its hosts | unchanged: no command, event, property or socket capability | — |

A run of this build, then build F or G on the same profile, then this build again leaves nothing different: no key is written. So the cross-build coverage table gains no row.

### I. Insertions in files other children own (UC-8, UC-3)

| file | owner | the insertion |
|---|---|---|
| `src/endpoint/offers.ts` | U9 | one row and its comment |
| `src/endpoint/capabilities.ts` | U9 | one entry and its comment |
| `src/shared/ipc/remote-unavailable.ts` | U9 | the declared row removed; `SEND_NOW_CAPABILITY`; one entry of `REMOTE_NEEDS`; two rows of `ACT_WORDS`, and the comment above it that says taking back has no words yet; one case of `reasonOf`, `host-older` |
| `src/main/lane-b/remote.ts` | U9 | one name in `ENGINE_HOST_ACTS`; `LIVE_ONLY`, three names, in place of the one-name test in `engineAct` (it changes what U9 built for `session.steer.cancel`: no resume); the `host-older` reading of one outcome; one sentence in the header comment |
| `src/renderer/src/lane-b/remote-unavailable.ts` | U9 | one export, `remoteUnavailableAsOf` |
| `test/endpoint/session-acts.test.ts`, `src/main/lane-b/remote.test.ts`, `src/shared/ipc/remote-unavailable.test.ts`, `src/renderer/src/lane-b/remote-unavailable.test.ts` | U9 | new cases; the assertion that `ACT_WORDS['session.steer.cancel']` is undefined is replaced by its words; any case of `remote.test.ts` that expects a cancel to resume a released session is replaced by its refusal |
| `test/lane-b/renderer-guards.test.ts` | U9 | two entries removed |
| `apps/org-protocol/src/channel.ts`, `apps/org-protocol/test/messages.test.ts` | the link's (P5); UC-7.2 asks for it | the minor and the number its test pins, at the chain merge, in a commit of its own; not on the branch |
| `src/renderer/src/panel/summary/Summary.tsx` | U8 | one class; its test file is not edited, and its two cases of the slots pass as they are |
| `src/renderer/src/app/Shell.test.tsx`, `app/Shell.drag-edge.test.tsx` | U8 | new cases only |
| `src/renderer/src/transcript/model/copy.ts` | the transcript's model (UC-3) | one export, `askQuestionTitle` |
| `src/renderer/src/transcript/view/rows/AskCapsule.tsx`, `transcript/model/serialize.ts` | the transcript's (UC-3) | one call each, in place of the same expression |
| `src/renderer/src/side/register.ts` | U5's folder | one registration |
| `src/renderer/src/widgets/ForkWidget.tsx` and its test | U11 by the root's table | one hook in place of another |
| `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` | P5 | two dated sentences (M4) |

This child's own: `src/renderer/src/composer/` (but `composer/docked/`), `composer/queue/take-back.ts` among it, whose record reading changes for every route (decision 12); the `/btw` files in `side/` (`BtwCard.tsx`, `BtwView.tsx`, the card's part of `store.ts`, the new `btw-place.ts`, their tests). In files the root's table gives to no child: `session/controls/lane-b.ts` (a comment).

### J. One reading of each fact

| the fact | the one function that decides it | who reads it today | this landing |
|---|---|---|---|
| a message's text is MAWS's answer envelope, and what it answers | `parseAskSteer` (`src/shared/maws/ask.ts`), as the class `answer` through `readAnswerEnvelope` (`src/shared/engine/arrival.ts`) | `composer/queue/stack.ts` (`isAnswer`, by `parseAskSteer`), `transcript/model/derive.ts` (`askSteerOf`), `transcript/model/reduce.ts`, `arrival.ts` itself (twice), `e2e/maws-tools.spec.ts` | `stack.ts` reads `readAnswerEnvelope`; no other reader moves |
| one answer in words | `askAnswerCopy` (`transcript/model/copy.ts`) | `transcript/view/rows/AskCapsule.tsx`, `transcript/model/serialize.ts`. (The envelope's own line is `answerText` in `ask.ts`, written for the model; the sheet's `AnswerValue` draws controls) | `stack.ts` reads it too |
| a question's title as its ask shows it | until now an expression written in place, `question.header ?? question.question`, at `AskCapsule.tsx` and `serialize.ts`; from M1 `askQuestionTitle` (`transcript/model/copy.ts`) | those two. (Other readers word a title for another audience and are not moved: the envelope's line for the model in `ask.ts`, the engine's own question rows in `transcript/view/rows/Question.tsx` and `transcript/model/answered.ts`, the sheet's section label) | the capsule, the copied form and `answerWords` call the one function |
| what a waiting answer's row says | `answerWords` (new) | — | its only place |
| whether an act is offered on a session's machine, and the sentence that closes its control | `disabledWords` (`src/shared/ipc/remote-unavailable.ts`), through the helper | `stack-acts.ts`, `SlashPalette.tsx`, `ForkWidget.tsx`, `InlineEdit.tsx`, the session menus, the side panels, the widgets | the stack through the labelled forms; `/fork` through `useForkUnavailable` |
| the sentence of an act that ended without its effect | `refusalWords` and `failureWords`, called by main (`src/main/lane-b/remote-outcomes.ts`) | the window shows `error.message` as it is (`said` in `stack-acts.ts`) | unchanged; two more commands have words, and one more reason |
| whether a refusal `unavailable` is the endpoint's or the host's | whether the endpoint had accepted the act: `ActHandle.progress()` (`src/main/machines/remote/acts.ts`) | `bounded` in `remote.ts`, for the pending bound | `engineAct`, for the one act |
| what the window knows of a session's machine | `remoteStandingOf` and `useRemoteStanding` (`lane-b/remote-standing.ts`) | the helper | `take-back.ts`'s one new condition |
| whether this Mac's serving engine host takes the command | `hostHasThisWire` (`src/shared/sessions/host-wire.ts`) | `composer/queue/host-wire.ts`, `stack-acts.ts`, `session/controls/lane-b.ts` | unchanged |
| whether a machine's draft store keeps a stage | `storeRefusesStage` and `useStoreRefusesStage` (`composer/queue/take-back.ts`) | `stack-acts.ts` | one condition inside it |
| what became of a waiting message | `readRecord` (`take-back.ts`), over `session.promptHistory` | `take-back.ts` (`record`) | also `recordSaysRead`, for Delete; and `record` tells "could not be asked" from "cannot say" |
| whether the card column is drawn, and for which session | `cardColumnNow` (`app/shell-view.ts`), through `useCardColumn` and `useCardColumnShown` | `app/Shell.tsx`, `panel/SurfaceRow.tsx`, `toggleSessionCards` | `btw-place.ts` |
| which session the floating card, its pill or the bar draws | `cardSession` (`shell/floating.ts`) | `shell/FloatingCard.tsx`, `shell/FloatingPill.tsx`, `panel/PanelHeader.tsx`, `main/Pane.tsx` | `btw-place.ts` |
| whether a side question's start is in flight for a session's card | until now each mount's own state in `useSideAsk`; from M2 the card's entry in `useBtwCards` | `side/BtwView.tsx` | the card reads the store; the view under a side thread keeps its own |

### K. What a sibling reads from this landing, and what it consumes

Exposed: `SEND_NOW_CAPABILITY`; `remoteUnavailableAsOf`; `askQuestionTitle`; `recordSaysRead`; `BtwCardFoot`, `btwPlace`, `useBtwPlace` and the attribute value `data-btw-card="foot"`, which a scene of any sibling that asks `/btw` beside a shown column now finds in place of `corner`; `answerWords`. Changed for callers: `session.steer.cancel` over the link no longer resumes a session; `stackActs` takes an optional client.

Consumed, each by the name it is exposed under: from U3a's document, `readAnswerEnvelope` (its Interfaces A and G). From U8b's, the slot `sessionCardFoot` and `useCardColumn` (its Interfaces C.1 and C.2). From U9's, the insertion list of its Interfaces 2, and `REMOTE_NEEDS`, `ACT_WORDS`, `disabledWords`, `refusalWords`, `failureWords`, `useRemoteUnavailableAs`, `useForkUnavailable` (its Interfaces 3 to 5). From U4a's, `QueueControls.sendNow`, `stackActs`, `Refusals`, `takeBack`, `readRecord`, `storeRefusesStage`, `BtwCard`, `StackRow.answer` (its Interfaces D, G and L). Nothing of U6a's, U8a's or U13a's: this landing adds no key, no action id and no stored value.

## Size and review

Counted from the code at `63c97b5c0`; changed lines are estimates from the functions and the test blocks read, not from a diff. The revision to the rulings added about 350 lines to the first count, most of them tests.

| milestone | source | tests | scenes and docs | files |
|---|---|---|---|---|
| M1 | about 55 lines in 6 files | about 115 in 2 | — | 8 |
| M2 | about 100 in 6 (one new) | about 230 in 4 (one new) | — | 10 |
| M3 | about 140 in 11 | about 680 in 13 (one new) | — | 24 |
| M3's conditional step, if built | about 15 in 1 | about 60 in 2 | — | (in M3's) |
| M4 | — | — | about 400 in 3 specs and their support; about 30 in 3 documents | 7 |
| the landing | about 310 | about 1,085 | about 430 | about 46 distinct files, about 1,800 changed lines |

**The review rung** is the xhigh panel of `doperpowers:review-code`, which the architect runs (ruled), on two grounds: the landing is past twenty files, and it adds a row to the offer table, which the root calls delicate ("U9's offers", UC-10). Its lenses: (1) the offer, checked where the act runs and on the value the act uses (Interfaces C), that a peer without the capability is sent nothing, and that neither act starts a session; (2) the sequences, with each test that holds a sequence open read as a sequence and not as a final state (Interfaces F): the link's, and the take-back's record on every route, since that changes code on master; (3) one reading of each fact (Interfaces J): no second reader of the envelope, of a title, of a refusal or of the column's state; (4) the card's two mounts: drawn once in every state of the column, a split, a float, a page and a drag; what a move keeps; focus, the inert column, the unseen dot; and the column unchanged with the card closed; (5) the insertions in others' files against Interfaces I, the transcript's three among them, and the guards that read source text. U9's keeper reads lenses 1 and 5 against U9's own list (UC-7.6).

## Probes

None is needed for what M1, M2 and the unconditional part of M3 build: every engine statement they rest on is recorded ("Engine facts").

One is being run, arranged by the architect, for M3's conditional step (decision 15). Its question: *on engine 2.1.322 under MAWS's launch environment, with a foreground shell command less than two seconds old (not yet a task): a `user` frame at priority `next` is written for a message M, as `session.queue.promote` at `next` writes it, and `interrupt { send_now: true, message_uuid: M }` is written at once after it. (i) Does the request wait for the task and move the command, in every run of five? (ii) With another message already waiting at the next step, are the two delivered as one? (iii) What does the request answer when it is written before the engine has queued M?* What each outcome changes is one place, the head of `stackActs.sendNow`, as "The conditional step" in M3 says: built where (i) is five of five, (ii) is recorded either way and (iii) is never `nothing_waiting`; otherwise not built, and the control keeps today's behaviour, which is that the message is submitted and is not delivered until the command ends.

The probe ran on 2026-11-15 (`findings-uxwave-u4b-send-now-early.txt`, 22 runs) and the step is built (the Decision Log's lines on the probe's result). What it did not record, and so what is not proven: a gap longer than one tick between the frame and the request; the request written first at the late timing; a call other than a shell command.

## Surprises & Discoveries

Found while reading the code for this document, and by its adversarial review; each is where a later reader would otherwise look twice.

- (M2, 2026-11-15.) With the card open in the main region, the card's own `<header>` (U4a's markup) is a second "banner" to Testing Library's role query, so `getByRole('banner')` finds two; the Shell tests find the title bar by `[data-toolbar]`, and a scene that opens the card beside such a query meets the same. Its role in the real accessibility tree was not checked.
- (M2, 2026-11-15.) `app/slots.ts`'s comment on `sessionCardFoot` still says the card stands "under the last card"; it now stands at the column's bottom. That file is outside M2, so the comment is left for whoever next edits it.
- (M2, 2026-11-15.) The renderer's vitest runs every file in two projects (`renderer`, `renderer-compiled`), so each failing case counts twice in a run's totals.
- (M1, 2026-11-15.) A row of kind `uncertain` (an entry whose submission may not have been delivered) carries no `answer` field and is not among the rows M1 words, so an answer envelope in that state still reads as the envelope's text. The state is rare (an uncertain submission of an answer); left as the document scopes M1 and reported to the architect. Evidence: `stackRows` in `composer/queue/stack.ts`.
- (At the build edge, 2026-11-15.) Concrete Steps 1's fifth check prints one line, not two: `transcript/model/serialize.ts` writes the capsule's expression with the variable `q` (`q.header ?? q.question`, the `ask` case), so the literal `question.header ?? question.question` matches `AskCapsule.tsx` alone. The expression is the same; Interfaces A's export replaces both. Evidence: `git grep -n "header ?? q" -- src/renderer/src/transcript/model/serialize.ts`.
- The reader's class `answer` holds the structured answers and the whole envelope and neither a title nor words. Evidence: `readAnswerEnvelope` in `src/shared/engine/arrival.ts`; `AskAnswerSchema` in `src/shared/maws/tools.ts`. Hence decision 2.
- The foot slot stands under the last card, not at the column's bottom. Evidence: `SessionCards` in `panel/summary/Summary.tsx`. Hence decision 5.
- Taking back a next-step row on another machine has worked since pull request 650 with no code of this child's; what was missing is words, labels and a scene. Evidence: `OFFERS`, `REMOTE_NEEDS`, `take-back.ts`'s `setDraft` and `withdraw`.
- Both commands are on the wire already, so the landing takes a link minor and no wire minor. Evidence: `src/shared/ipc/wire-manifest.json`.
- U4b's own capability cannot say that a machine's draft store keeps a stage: build G keeps one and lists no `rl2.send-now`. `rl2.session-acts` can, by the order the two landings reached master. Evidence: the two builds' `capabilities.ts` and `drafts.ts`.
- Every engine-host act but a pane's answer resumes a released session first, the cancel included: a Delete could start an engine and then be told `already_started`. Evidence: `engineAct` in `src/main/lane-b/remote.ts`. Hence decision 8.
- The keys read the helper outside a render, and the helper's labelled form was a hook alone. Evidence: `refusalsNow` in `stack-acts.ts`; `lane-b/remote-unavailable.ts`.
- Once the command is offered, the renderer guard calls its two entries for it stale. Evidence: "declares nothing the code no longer needs" in `test/lane-b/renderer-guards.test.ts`.
- At the e2e window's width the card column is drawn in every scene with no side surface open, so a scene that asks `/btw` there finds the card at the foot. Evidence: `e2e/support/launch.ts` (1280 px), the default sidebar width (240 px) and `CARD_COLUMN_ROOM` (960 px).
- Claude Desktop's lines the child cites for these items still say what the child says: the side chat's waiting state (`web/app/v1/c9bd7af9c-DlJ4cmuC.js:21474` on), its place as a side pane (`c73f45bc3-CS022dPs.js:3484`), the take-back's restaging (`cc43287c9-CQ79M14o.js:86651` on), and the two sentences UC-7.5 follows (`i18n-web.json:4129`, `:17751`).
- (The review, first finding.) `record()` gives one answer for a record that could not be asked, one that is incomplete, and one that disagrees with the queue's snapshot, and `forward` loads on all three; `settle` never asks again. Evidence: `take-back.ts`; `src/engine-host/prompt-history.ts` for when a record is incomplete. No test of U4a's scripts a failing record call. Hence decision 12.
- (The review, second finding.) The endpoint's own `unavailable` and a host's with no handler are the same word to the device, worded "busy"; the acceptance before the outcome is what tells them apart, and the device's link keeps it. Evidence: `admit` in `src/engine-host/ops.ts`; the lane B branch of `src/endpoint/actions.ts`, where every refusal of the endpoint's precedes `accept()`; `ActProgress` in `src/main/machines/remote/acts.ts`. Hence decision 14.
- (The review, third finding.) `useSideAsk` keeps a start in flight in the component, so any remount of the card forgets it; a fold already does today. Evidence: `side/BtwView.tsx`. Hence decision 4.
- `session.promptHistory` reads the retained journals and needs no live launch, so a Delete on a session that is not running can still be answered from the record. Evidence: the handler in `src/engine-host/ipc.ts`.
- The desk's web app reaches the stack's files through its import closure and mounts none of them. Evidence: its direct imports under `apps/desk-web/src`, which are the transcript's and lane A's.

## Decision Log

- **2026-11-15 (UTC) · The probe's result: M3's conditional step is built (P1).** The probe's findings (`spikes/protocol-probe/findings-uxwave-u4b-send-now-early.txt`, merged from `ux-wave/U4b-probes` at `f7e88d3c1` in a merge commit of its own before M3) answer decision 15's three conditions as built requires: the frame-first pair answered `delivering` in 19 of 19 runs and moved the command, never killed it, at 1.5 s (5/5) and at 10 s (5/5); another next-step message goes with it, first (6/6); the pair as built never answered `nothing_waiting`. So M3 builds "The conditional step": while a turn runs, Send now on an after-the-turn row is `session.queue.promote` at `next`, then `session.steer.sendNow` for the uuid the promote answered. The order is the rule: the send-now is not invoked until the promote has answered with the uuid (the request written before the frame answered `nothing_waiting` 3/3 and moved nothing), and a promote that fails or answers no uuid invokes no send-now and shows what a failed promote shows today. Tests pin both: the count and order of invocations with the promote held open, and no send-now after a refused promote. A `nothing_waiting` after the pair shows nothing (decision 13); a second press is harmless and shows nothing. Since (ii) is yes, the control's title on such a row counts the next-step messages that go with it (`STACK_WORDS.sendNowAll`), as "The conditional step" says. Ruled by the architect; this replaces the build-edge line on the probe below.
- **2026-11-15 (UTC) · The probe's result: what the turn reads afterwards, and replay cases over it (P2, P3).** The probe found what no earlier recording showed: how the turn reads after the move depends on the timing. While the call is not yet a task (about its first 3 s) the turn is cut (`aborted_tools`), the message is the next turn, and a message already waiting and the named one are one user message under the named one's uuid. Once the call is a task there is no cut: both are read in the same turn at the tool boundary, each its own replay, and the turn ends `completed`. "Engine facts" rows 1 and 4 are corrected in place and the request-first result is a row of its own. The architect read master's `src/engine-host/normalizer-send-now.ts` against the late timing (`lifecycleSeen` takes a message read in the same turn out of the sent-now set; `replayJoins` reads a replay with its own text as an echo), so today's code should draw both timings rightly, but no test replays a late recording. M3 adds replay cases over the new fixtures, through the normaliser and the transcript's model, one early and one late of each of `u4b-pair` and `u4b-two`: early, the turn's end is marked for the message, the message is a turn of its own, and (two) the two messages are one bubble; late, no marked end, the two messages are rows of the running turn in that order, nothing joined; in all four the stack's rows leave at their own `started`. If any of these fails on the code as master holds it, the executor stops and sends the architect the failing case and the fixture's seqs: that is a fault on master with a ticket of its own, not a repair inside this step. Ruled by the architect.
- **2026-11-15 (UTC) · M2: the means.** The foot's wrapper is `mt-auto shrink-0 px-1 pb-1 pt-0.5` and also `flex flex-col`, so the folded chip stands at its right end by the class it already takes (`self-end`); the open card's `w-full` is unchanged. A closed card returns null before it reads the layout: only an open or folded corner or foot mount calls the place's hook, since every pane mounts a corner card and `useCardColumn` subscribes to the whole layout store. `BtwCardFoot` is `<BtwCard placement="foot" />`, one component. The `flow` mount does not read the place (Interfaces B's mount table); a session in the pill is the floated one, so the foot draws nothing for it. `btwPlace`'s first parameter is typed `Pick<CardColumn, 'shown' | 'session'>`, U8b's type, so the two cannot drift. Tests reach the foot only through `registerSidePane()`, as the app registers it. Acceptance 8's drop is pinned by dropping the tab of the session the column speaks of: dropping another tab focuses the pane it opens, the column then speaks of that session, and the watched card rightly goes to its own pane's corner; M4's scene drops the tab whose card it watches, or expects the card at its pane's corner. The column's tree is compared with the ids `useId` generates removed (`id`, `aria-controls`, `aria-labelledby`, `aria-describedby`).
- **2026-11-15 (UTC) · M1's review: the answers in the asked order.** Interfaces A said `answerWords` takes the envelope's `answers` "in order", and Acceptance 2 says the asked order; the two differ, because an `AskAnswer[]` may come in any order (`askAnswersProblem` admits a reversed list, `ask.test.ts`; the host passes it through, and `askSteerText` stores it as given while its lines follow the questions). The intent is the asked order, as the capsule shows it, so Interfaces A is revised: where the window holds the ask's row the pairs follow its questions' order (an answer whose id no question holds comes after, in its own order); where it does not, the array's order stands, since the only other record of the asked order is the envelope's lines, which decision 2 does not read. No word changes. A test pins a reversed answer list.
- **2026-11-15 (UTC) · M1: the reader's class types `answers` as nullable.** `readAnswerEnvelope`'s class `answer` types `answers` nullable (the shape of another tool's envelope, `arrival-schema.ts`); MAWS's own envelope always carries its answers. `answerWords` reads `envelope.answers ?? []`, so a null still reads as an answer and never turns the row into an ordinary message with Delete and Edit. Unreachable for MAWS's envelope. Also: `QueueList.test.tsx` builds the ask's row through the transcript's real reducer with the turn closed and folded, which is how "an envelope whose ask the transcript holds under a folded turn still finds its title" is pinned; `take-back.test.ts`'s row literals follow the field's type (`answer: null`).
- **2026-11-15 (UTC) · At the build edge: owner card 1 is built at its default.** Card 1 ("Failed act") is out and unanswered. Its recommended option is built, at the one place the document names: the two rows of `ACT_WORDS` in `src/shared/ipc/remote-unavailable.ts`, `'session.steer.cancel': { act: 'take back', done: 'taken back' }` and `'session.steer.sendNow': { act: 'send now', done: 'sent now' }`. An answer may change those two rows and nothing else; the architect sends it when it comes. Ruled by the architect at dispatch.
- **2026-11-15 (UTC) · At the build edge: M3's conditional step and its probe** (superseded the same day by the line on the probe's result above: the findings came before M3 and the step is built). The engine probe for decision 15 is run by another agent; its findings land on branch `ux-wave/U4b-probes`, and the architect sends the commit to merge and the architect's reading of it. M3 does not wait for it. If the findings have not come when M3's other work is reviewed, M3 is ticked without the step and Progress says so, and M4 goes on; whether the step is then built, as a small task of its own, is the architect's ruling when the findings come. Nobody builds the step from the engine bundle's reading alone. This replaces "on master" in M3's "The conditional step" and in Progress: the findings arrive by a merge the architect names.
- **2026-11-15 (UTC) · At the build edge: merges of master are named by the architect.** Concrete Steps 1 and 4 say the executor merges `origin/master` first; on this run nothing is merged on the branch until the architect names the head to merge (the wave's chain-merge brief describes such a merge). Master stood at `63c97b5c0`, the document's pin, at dispatch, so M1 builds on the pin. The gate (`scripts/ci-gate.sh`) is the architect's, as "Proof that an executor does not run" already says.

- **2026-11-15 (UTC) · The sentence for an earlier engine host.** The sentence for a Send now that a machine’s endpoint accepted and its earlier engine host refused is "Not sent now: the engine host on `<machine>` is finishing an update; this works once it has handed the session over". The first ruling gave it the "needs a newer MAWS on `<machine>`" family; the author showed at the revision’s hand-back that the state arises only on a machine whose app is already this build (its endpoint lists `rl2.send-now`) while an earlier engine host still serves the session, so "needs a newer MAWS" would send a person to update a machine that is up to date. This Mac already says the true thing of the same state (`HOST_UPDATING`); the machine is named because the reader is elsewhere. One place: the `host-older` case of `reasonOf`. Ruled by the wave’s lead.

- **2026-11-15 · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets the xhigh panel of `doperpowers:review-code` ("Size and review" says why and names its lenses). Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue; it carries no amendment of a reversed ruling, because this landing reverses none.
- **2026-11-15 · The adversarial review, and the rulings.** The review found three faults, each in the code it cited: an uncertain take-back could become a sendable second copy; an endpoint's capability does not prove that the serving host can send now, and the refusal was worded as busy; moving the side card loses its in-flight Ask guard. The architect ruled on the three and on the thirteen reported points the same day, and the document was revised once to all sixteen ("Reported to the architect, and ruled"). What the revision changed: the take-back asks again where its record could not be asked and loads only where the record answers and cannot say (decision 12, for every route); the cancel joins Send now in never starting a session, and a Delete answers from the record (decisions 8 and 13); `nothing_waiting` shows nothing (decision 13); a host without the handler reads as a machine that needs updating (decision 14); the card's start in flight and refusal live in its store, and the card is hidden with the column during an edge drag (decision 4); the title is the capsule's own expression, exported (decision 2); the column unchanged with the card closed is stated and proved (decision 5); the link's minor is taken at the chain merge in a commit of its own, and no cross-build fallback is offered (decisions 6 and 7); Send now on an after-the-turn row early in a shell call is a conditional step of M3 on a probe now running (decision 15); the desk's web app is in every milestone's proof (decision 16). No ruling was impossible as written.

## Outcomes & Retrospective

Written at the landing.
