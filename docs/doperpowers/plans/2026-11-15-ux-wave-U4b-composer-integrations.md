# UX wave · U4b · the composer's integrations (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U4**, second landing (**U4b**, board ticket 585), parent pin master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`.
> **The design** is the child's file, `docs/doperpowers/specs/2026-11-12-ux-wave/U4-composer.md`: acceptance A9 (X-049), A18's sentence on the card column, its Edges, and the consumed contracts UC-2, UC-7, UC-8, UC-9 and UC-14; and the item sections X-049, O-20 ("Where"), l3-input-01 and l3-input-04 where they speak of a session on another machine. In the root: the wave's laws, UC-2, UC-7, UC-8, UC-9, UC-10, UC-11, UC-14 and "Ordering and dependency map" (the line U4b). Where the child's file and the root differ, the root binds.
> The first landing's document is `docs/doperpowers/plans/2026-11-12-ux-wave-U4a-composer.md` (cited as *U4a's document*); its "The landing's edge" says what it left for this one, and its decisions 13, 14, 26 and 30 are built on, not restated.
> This document holds what the design does not: what master holds today, the decisions the section left open, the points reported to the wave's architect with the default written for each, and the execution.

## Purpose

After this landing three things the first landing left open are closed.

A question the agent asked without waiting, answered while a turn runs, waits in the stack above the composer as what it is: its row reads "Answer to Layout: Grid", where today it reads the opening words of the envelope MAWS sends to the model, "[MAWS ask …".

The `/btw` side chat card stands at the foot of the card column wherever that column is drawn, at the column's bottom right, and the transcript's corner is free; where the column is not drawn the card lies over the pane's corner, as it does today in every state.

For a session MAWS runs on another machine, Send now on a message that waits at the next step, and Esc on such a first row, send it now through that machine's engine and kill nothing; today they are drawn refused with "Not on another machine yet: sending a waiting message now while the agent works". Taking such a message back (↑, Edit, Delete) already works there since the other-machines landing; this landing gives those controls their words, closes them from the first draw on a machine that is too old to take a message back, and proves the whole of it in scenes on two machines. On a machine whose build does not offer a command, the control is drawn disabled with one sentence and the key that would do the same act says that sentence and does nothing else.

How to see it working: the unit tests named under each milestone; in a running build, the scenes of M4, which only a Mac run gives ("Proof that an executor does not run").

## Progress

- [x] (2026-11-15 11:20Z) Document written against master `63c97b5c0`: the code read, the in-flight branches' diffs read, the two binding builds read with `git show`.
- [ ] The architect's rulings on "Reported to the architect" folded in.
- [ ] The adversarial review of this document, and its findings folded in.
- [ ] M1 — a waiting answer reads as an answer.
- [ ] M2 — the `/btw` card at the column's foot.
- [ ] M3 — Send now and taking back on another machine.
- [ ] M4 — the scenes, the record, the last run.
- [ ] Hand-back; then the architect's proofs, in the order of "Proof that an executor does not run".

## What this document assumes of landings in flight

One list, checked again by the executor at each merge of master (Concrete Steps, 1) and by the architect when each of these is on master. Either side may land first; where both edit a file, the later one resolves the lines at its merge.

| landing (branch read) | files it changes that this landing reads or edits | what this document assumes | if it does not hold |
|---|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b` at `0f746a7a5`) | `session/SessionPane.tsx` (the docked request goes), `composer/Composer.tsx`, `composer/Composer.test.tsx`, `stores/composer.ts`, `transcript/model/copy.ts` (`QUESTION`, `ASK`, `askStateCopy`), `transcript/model/rows.ts` (the `ask` row), `app/slots.ts` (`requestCard`'s placement) | `SessionPane.tsx` keeps its two mounts of `BtwCard` (the positioned box around the transcript, and the compact flow); `askAnswerCopy(answer)` keeps its signature and words; a row of kind `ask` keeps `askId` and `questions`; `stores/composer.ts` keeps `showStackNotice`, `setSendingNow` and `stackNotices` | this landing edits none of those five files, so there is nothing to merge; if `askAnswerCopy` or the `ask` row changed shape, M1's `answerWords` follows the new shape and nothing else moves |
| U2b, the to-human view (`origin/ux-wave/U2b` at `33434fb2d`) | `session/SessionPane.tsx` (the view's switch), `composer/Composer.tsx`, `composer/Composer.test.tsx`, `test/lane-b/renderer-guards.test.ts` (one other entry) | the pane still mounts the transcript's scroller inside the positioned box that holds the corner card; the guard test's two entries for `session.steer.sendNow` are still there to remove | the two entries are removed wherever they then stand |
| U6b, the file beside the chat (`origin/ux-wave/U6b` at `74aad04a6`) | `panel/summary/Summary.test.tsx` (one case, the file row), `e2e/cross-build.spec.ts` (its own block) | `Summary.tsx`'s wrapper and its foot slot are as U8b built them | M2's one class in `Summary.tsx` is made on what is there |
| U10b-3, the chat bar over a surface (`origin/ux-wave/U10b-3` at `f05930ca3`) | `composer/Composer.tsx`, `composer/Composer.test.tsx`, `composer/frame/`, `shell/floating.ts`, `shell/FloatingPill.tsx`, `shell/FloatingCard.tsx`, `docs/tech-debt-tracker.md` | `cardSession(layout)` in `shell/floating.ts` keeps its name and meaning (the session the floating card, its pill or the bar draws); the bar mounts the session's pane in its compact form, so the card's `flow` placement is still the one drawn there | M2's `btwPlace` reads whatever names the floated session then |
| U5b, Review as one scroll (`origin/ux-wave/U5b` at `d94d75b8f`) | none of this landing's files | nothing | — |
| U10b-2, the artifact undelete (`origin/ux-wave/U10b-2`; not on the dispatch's list, read because it inserts in the same four files of U9's) | `src/endpoint/offers.ts`, `src/endpoint/capabilities.ts`, `src/shared/ipc/remote-unavailable.ts` and its test, `apps/org-protocol/src/channel.ts`, `apps/org-protocol/test/messages.test.ts` | it holds the link's minor 15 provisionally; each of the two appends its own line to `ENDPOINT_CAPABILITIES`, `REMOTE_NEEDS` and `OFFERS` | whichever lands second takes the next number of `RL2_PROTOCOL.minor` and rewrites the one test's title to name both |

This landing adds its new cases for the composer's keys in a file of its own (`composer/Composer.remote-stack.test.tsx`), because three of the branches above edit `composer/Composer.test.tsx`, and it edits neither `composer/Composer.tsx` nor `session/SessionPane.tsx`.

## The landing's edge

| part of U4 | on master today | in this landing | left |
|---|---|---|---|
| A waiting answer (X-049; A9) | its row reads the envelope's opening words; it offers Send now only and ↑ skips it (U4a) | the row's words, for a session MAWS runs here and on another machine | nothing |
| The `/btw` card's place (O-20; A18; UC-9) | over the pane's corner in every state of the card column | the column's foot while the column is drawn for that session; the corner otherwise | nothing |
| Send now on a next-step row of a session on another machine (l3-input-01; A3, A5), and Esc | drawn disabled with "Not on another machine yet: sending a waiting message now while the agent works" | the offer of `session.steer.sendNow` behind a capability of its own, the device's half, the words; enabled where the machine lists the capability | Send now on an after-the-turn row early in a shell call (tracker row; Reported, 8) |
| Taking back a next-step row there (l3-input-04; A7) | works on a machine that lists `rl2.session-acts`; on one that does not, Edit and Delete read "Can’t do this on `<machine>` yet. Update MAWS on `<machine>` and try again." | the act's words in `ACT_WORDS`, each control's own label in its sentence, the scene on two machines; Edit and ↑ closed from the first draw on a machine too old to keep a stage | nothing |
| `/fork` in the palette of a session on another machine (O-48; A20) | greyed by the helper for `session.fork` | greyed by `useForkUnavailable`, which adds the sentence for a running turn | nothing |
| Rulings reversed | all ten, in U4a's pull request | none: nothing here reverses a ruling | — |

Not in this landing: everything the child's file lists under "Not in this child"; any change to what Send now does in the engine host; any change to the take-back's steps; the card's content, its timer and its state; any new stored value.

## Words used here

*The device* is the app the person sits at; *the machine* is the other machine, whose `mawsd` holds the endpoint, the services and the engine host of the session. *The link* is the machine link (RL2). A *next-step row* is a message the engine holds for the running turn's next tool boundary (a pending steer); an *after-the-turn row* and a *held row* are entries of MAWS's queue on the session's machine. *The stage* is the take-back's stored copy: the session's draft whose document carries `attrs.takeBack` (U4a's document, decision 13). *Build F* is `f1852de3a` and *build G* is master `2c7044231`: the two older builds that whatever this landing stores or sends is stated against. *The helper* is `src/renderer/src/lane-b/remote-unavailable.ts`.

## Today, and what each part needs

Each statement was read at `63c97b5c0`.

**The row of a waiting answer.** `stackRows` in `composer/queue/stack.ts` marks a row `answer: true` when `parseAskSteer(messageText(content))` is not null, and `rowText` gives every row with content `entryDisplay(content)`, which knows pasted blocks and attachments and not the envelope. `readAnswerEnvelope(text)` in `src/shared/engine/arrival.ts` (U3a) reads the same envelope as the reader's class `answer`: `{ class: 'answer', tool: 'maws', call: <askId>, summary: <the whole text>, answers: AskAnswer[], dismissed: false }`. An `AskAnswer` (`src/shared/maws/tools.ts`) holds the question's id and text, its status and its values; it holds no header, and nothing in the class is the answer in words. The words of one `AskAnswer` are `askAnswerCopy(answer)` in `transcript/model/copy.ts`, which the answered capsule and the transcript's copy already use. A question's header is on the ask's own row in the transcript's model (`Row` of kind `ask`: `askId`, `questions`), which stays in view when its turn folds. So the row needs: the class from the one reader, the title from the ask's row where the window holds it, the words from the one function that words an answer.

**The card and the column.** `side/BtwCard.tsx` is mounted twice by `session/SessionPane.tsx`: over the transcript's corner (`placement="corner"`) and, in the compact pane, in the flow above the frame (`"flow"`). U8b's `panel/summary/Summary.tsx` mounts the slot `sessionCardFoot` after the cards' scrolling list, in a wrapper that is as tall as its content (`max-h-full`), so a component registered there stands directly under the last card and not at the column's bottom; nothing is registered. The shell (`app/Shell.tsx`) mounts the column's `aside` while `useCardColumn().placed` holds and draws it for `useCardColumn().session`, the session of the tab in front; `shown` is `placed` while no page is open (`app/shell-view.ts`, `cardColumnNow`, the one source). The drawn example the owner answered on (its frame 16, "Final") has the card at the bottom of the column, clear of the last card, in the cards' own surface. The e2e window is 1280 px wide and the sidebar 240 px, so the column has its 960 px of room and is drawn in every scene that shows a session with no side surface open.

**The two commands over the link.** `session.steer.cancel`: offered by U9 (pull request 650) as `laneB('act')` behind `rl2.session-acts`; in `ENGINE_HOST_ACTS`; in `REMOTE_NEEDS`; no row in `ACT_WORDS` (U9's R8 left it to U4). So on a machine that lacks the capability its controls read the helper's sentence with no act word, "Can’t do this on `<machine>` yet. …". `session.steer.sendNow`: on the wire since minor 45 (U4a), owner `engine-host`, graded `converse`; declared in `REMOTE_UNAVAILABLE`; no offer row; not in `ENGINE_HOST_ACTS`. The stack reads both through `refusalsNow` and `useRefusals` in `composer/queue/stack-acts.ts`, which ask the helper with no label; the helper's labelled form exists only as a hook (`useRemoteUnavailableAs`), and the keys read at the moment of the press, outside a render. `test/lane-b/renderer-guards.test.ts` lists two modules that name `session.steer.sendNow` as a declared command guarded elsewhere; once the command is offered that test calls both entries stale.

**The device's half.** `engineAct` in `src/main/lane-b/remote.ts` seals an engine-host act for the session's live launch and, where the session has none, resumes it first (`session.acquire`); one command is excepted, `maws.pane.answer`. A waiting steer exists only in a live launch (the queue abandons every pending steer at the process's exit, `src/engine-host/queue.ts`), so a Send now that resumed a session would start an engine process on another machine in order to be told that nothing waits. An act carries `REMOTE_NEEDS[name]` as its `requires`; a current channel whose peer lacks it is answered `not-offered` and nothing is sent (`run`).

**Taking back over the link** is U4a's `composer/queue/take-back.ts` unchanged: the stage is saved to the draft store of the session's machine through the offered `session.drafts.set` (a `machine` act, kept per member there), the withdrawal is `session.steer.cancel` or `session.queue.remove`, the record is `session.promptHistory` (a call, offered on every build read here), and `lane-b/remote-drafts.ts` sends each of the take-back's two saves once, in the session's order. Build F's draft store knows neither the claim nor the fence and answers the claim as stale, which the window remembers per machine from the first press on (`storeRefusesStage`). Build F lists no `rl2.session-acts`; build G lists it and knows the claim (`git show <sha>:src/endpoint/capabilities.ts`, `:src/shared/ipc/schema/session.ts`).

**`/fork`.** `composer/mentions/SlashPalette.tsx` and `widgets/ForkWidget.tsx` ask the helper about `session.fork`; `useForkUnavailable` (U9), which adds "Wait for the turn to end, or stop it first" while the session's turn runs on another machine, is read by `composer/InlineEdit.tsx` alone.

## Decisions settled at authoring

Each is a means the section left open, with its reason and what lost. Where a decision is also a point for the architect's ruling it says so; "Reported to the architect" gives the one place a ruling changes.

1. **Four milestones.** The three integrations share no state: the stack's words (M1), the card's place (M2), the link (M3). M1 and M3 both edit `composer/queue/stack-acts.ts` and `QueueList.test.tsx`, so they run in that order; M2 touches neither and may run beside either. M4 holds what no executor can run (the e2e scenes), the record and the landing's one whole-suite run. Lost: one milestone for all three (three verification strategies in one diff); e2e edits inside each milestone (written blind three times, by three workers).

2. **A waiting answer's words are composed in the stack's model from three existing readings, and no second reader is written.** `stack.ts` asks `readAnswerEnvelope` whether a waiting message is an answer (in place of its own call of `parseAskSteer`), takes each question's title from the ask's row in the transcript's model where the window holds that row (`header`, else the question's text) and from the answer's own copy of the question's text where it does not, and words each answer with `askAnswerCopy`. Lost: reading the headers out of the envelope's numbered lines (a second reader of the envelope beside U3's, and the lines are written for the model); a new field on the reader's class (an edit in U3's reader and in X1's schema for a title the window already holds). The child's UC-2 bullet says the class carries the title and the answer in words; as built it carries neither (Reported, 5).

3. **The exact words.** One question: `Answer to <title>: <words>`. Several: `Answers to <N> questions: <title 1>: <words 1>; <title 2>: <words 2>; …`, every question in the asked order, clamped to two lines like any row and whole in the row's hover title and when the row is opened. The separator between questions is "; " where the child's text writes ", ": a multi-select answer's own words already hold ", " ("Grid, List"), and "Layout: Grid, List, Theme: Dark" cannot be read (Reported, 7). An answer with no title (an empty header and an empty question) reads `Answer: <words>`.

4. **One function says where a session's card is drawn, and both mounts ask it.** `btwPlace(column, floated, appSessionId)` in a new `side/btw-place.ts` answers `'foot'` exactly when the card column is shown, the column's session is this one, and this session is not the one the floating card (or its pill, or the bar) draws; `'pane'` otherwise. It reads `useCardColumn()` (U8b's one source: `shown` and `session`) and `cardSession(layout)` (`shell/floating.ts`), and decides nothing those two do not already decide. `BtwCard` takes a third placement, `'foot'`: the corner mount draws nothing while the answer is `'foot'`, and the foot mount draws nothing while it is `'pane'`. So the card is drawn once, by one component, and `SessionPane.tsx` is not edited. A split needs no rule: the focused pane's session is the column's, its card is the foot, and the other pane's card stays over its own corner. Lost: a portal from the pane into the foot's element (React remounts a portal whose container changes, so it keeps no more state than two mounts do, and adds a store for the element); the foot claiming the card through an effect (a second source of "is the column drawn", one frame behind the first). The card's state is the window's store (`useBtwCards`, `useSidePane`), so a move between the two places loses nothing but the field's focus, as a fold does.

5. **The foot is the column's bottom, in the cards' surface.** The registered component is `BtwCardFoot`, registered once in `registerSidePane()` (`side/register.ts`), which the app's composition already calls; no new call in `App.tsx`. Its box: a wrapper `mt-auto shrink-0 px-1 pb-1 pt-0.5` (inset as the cards are, so the card is 272 px wide inside the 280 px column, 6 px clear of the last card when the cards reach it), the open card `w-full`, as tall as its content up to `min(360px, 50vh)`, in the cards' surface (`rounded-md border border-border bg-bg-raised shadow-strip`); the folded chip at the wrapper's right end, in its own surface. For the wrapper's `mt-auto` to reach the column's bottom, the column's own wrapper in `panel/summary/Summary.tsx` must be as tall as the column: its `max-h-full` becomes `h-full`, one class in U8's file (Reported, 3). With nothing drawn at the foot the column looks as it does today: the cards' list is unchanged and the taller wrapper is transparent inside an `aside` that already spans the column's height. Lost: the card directly under the last card (what the slot gives unedited: not the bottom right the owner asked for, and it jumps whenever a card folds); an absolutely placed card at the `aside`'s bottom (the cards would run under it).

6. **The capability is `rl2.send-now`, for the one command.** UC-7.6: an offer inserted later takes a capability of its own. It is not folded into `rl2.session-acts`: build G lists that and has no row for the command. `RL2_PROTOCOL.minor` moves by one above whatever master holds at the merge (Reported, 2).

7. **No wire minor.** `session.steer.sendNow` and `session.steer.cancel` are both in the wire's manifest already; this landing adds no command, no event, no property and no socket capability, so `src/shared/ipc/wire-manifest.json` does not change and `WIRE_MINOR` does not move. What moves is the link's minor, which the cross-build group does not read. So no cross-build run is owed: not the two a wire minor owes, and not the equal-wire run a changed stored form owes, since no stored form changes ("What is stored or sent"; Reported, 1).

8. **Send now never resumes a session on another machine.** `engineAct` refuses `session.steer.sendNow` for a session with no live launch, as it refuses `maws.pane.answer`, with `refusal: 'not-live'` and the sentence "Not sent now: the session isn’t running on `<machine>`"; nothing is acquired and no act goes out. This is one more condition in U9's adapter beside the name in the set (Reported, 4). `session.steer.cancel` resumes first, as U9 built it; that is reported and not changed.

9. **Each control says its own label; the two acts get their words.** UC-7.5: "`<Act>` is the control's own label". Send now reads the helper with the label `send now`, Edit and ↑ with `edit`, Delete with `delete`; the keys read the same sentences through a new non-hook form of the labelled reader, `remoteUnavailableAsOf`, one export in U9's helper beside `remoteUnavailableOf`. `ACT_WORDS` gains `'session.steer.cancel': { act: 'take back', done: 'taken back' }` and `'session.steer.sendNow': { act: 'send now', done: 'sent now' }`, so a refusal after the act reads "Not taken back: …" and "Not sent now: …" (the owner's card 1 asks whether these are the words). Neither row `closes`: while the link connects or reconnects the act is held under the link's hold, as Send and Stop are.

10. **On a machine too old to keep a stage, Edit and ↑ are closed from the first draw.** `storeRefusesStage` also answers its sentence, "Taking a message back needs a newer MAWS on `<machine>`", for a session reached over the link whose machine's known capabilities lack `rl2.session-acts`, with no claim sent first. The reason it may: the draft store learnt the claim in U4a's landing, which came after U9's on master, so an endpoint that lists no `rl2.session-acts` runs services that do not know the claim; build F is such a build and build G is not. This changes "from the first press it refuses" in the child's text to "from the first draw" for that route, and narrows tracker row "The first press on a machine of an earlier build" to this Mac's own services (Reported, 6). U4b's own capability cannot do this, as U4a's document hoped: build G takes a stage and lists no `rl2.send-now`.

11. **`/fork`'s row and panel read `useForkUnavailable`.** Two call sites. The typed form (`applyFork`, outside a render) keeps the helper's plain reading: with a turn running there, the machine's own sentence comes back as "Not forked: …" (UC-7.5). In this landing by U4a's edge table, beyond the dispatch's three parts (Reported, 9).

12. **The take-back's steps are not changed.** What holds at each failure over the link is stated in Interfaces F and pinned by tests that hold each step open; one behaviour is reported for a ruling and left as built (Reported, 10).

## Reported to the architect

Each has the default this document builds, and the one place a different ruling changes.

| # | the point | evidence | the default written | the one place |
|---|---|---|---|---|
| 1 | **No wire minor, a link minor, and no cross-build run.** The dispatch expected a wire minor and two cross-build runs | `src/shared/ipc/wire-manifest.json` holds both commands at `63c97b5c0`; `WIRE_MINOR` 48; `RL2_PROTOCOL` `{1, 14}`; the gate adds `e2e:cross-build` only where the tree and the peer differ in `WIRE_MINOR` | decision 7: none taken, none owed; older peers of the link are proved by unit cases at the two older builds' capability lists and by one `e2e:remote` scene with the capability withheld | "Proof that an executor does not run", row 5 |
| 2 | **The capability's name and number** | `ENDPOINT_CAPABILITIES`; `apps/org-protocol/test/messages.test.ts` pins minor 14; U10b-2 holds 15 provisionally | `rl2.send-now`; the minor is master's plus one at the merge | `SEND_NOW_CAPABILITY` in `src/shared/ipc/remote-unavailable.ts` |
| 3 | **One class in U8's `Summary.tsx`.** The slot as built stands under the last card; the drawing the owner answered on has the card at the column's bottom | `Summary.tsx`: `flex max-h-full w-70 … flex-col`, then `<Foot>`; the example's frame 16, "Final" | decision 5: `max-h-full` becomes `h-full` | that class; ruled the other way, it reverts and the card stands under the last card with no other change |
| 4 | **A condition in U9's adapter beyond the name in the set**, and a finding in U9's built code | `engineAct`: `context === null && name === 'maws.pane.answer'`; every other engine-host act resumes; `MessageQueue` abandons pending steers at exit | decision 8: Send now never resumes. `session.steer.cancel` still resumes a released session before it is told `already_started`; recommended, for U9's review in this pull request: add it to the same condition | the set `LIVE_ONLY` in `src/main/lane-b/remote.ts` (Interfaces C) |
| 5 | **The reader's class does not carry what the child's UC-2 bullet says it needs** (the question's title and the answer in words) | `readAnswerEnvelope` returns `answers: AskAnswer[]` and `summary`; `AskAnswerSchema` has no header | decision 2: the title from the ask's row, the words from `askAnswerCopy`; the child's bullet is corrected by the architect | `answerWords`' second argument |
| 6 | **Edit and ↑ closed from the first draw on a machine without `rl2.session-acts`**, where the child's text says from the first press | `git show f1852de3a:src/endpoint/capabilities.ts` (no such capability), `:src/services/index/drafts.ts` (no claim); the same two at `2c7044231` (both there) | decision 10: built | the first condition of `refusalIn` in `composer/queue/take-back.ts` |
| 7 | **"; " between the questions of one answer row** where the child's text writes ", " | `askAnswerCopy` joins a multi-select's labels with ", " | decision 3 | `STACK_WORDS.answers` |
| 8 | **Send now on an after-the-turn row early in a shell call is not built here.** The root's Decision Log (2026-11-13, "U4's section brought to its first landing's document …", point 3) calls sending such a row down the request's path "U4b's, after a probe"; the dispatch does not name it | tracker row of 2026-11-13, "A Send now on an after-the-turn row in about the first 3 s"; `u4p3-promote-1.jsonl`, `u4p3-mirror-1.jsonl` (one run) | not built; the row stays, reworded to name no landing; the probe it needs is stated under "Probes" | the first line of `stackActs.sendNow` |
| 9 | **`/fork`'s greying is in this landing**, beyond the dispatch's three parts | U4a's document, "The landing's edge", the row of the slash palette; U9's document, Interfaces 5 | decision 11 | the two call sites; dropped, tracker row "No e2e scene drives a take-back … or a `/fork`" keeps its `/fork` half |
| 10 | **A take-back whose record cannot be read because the link dropped loads the message under "This message may already have been read; check the transcript before sending it again", while the message may in fact still wait on the machine.** No copy is lost; the person may send it a second time | `record()` in `take-back.ts`: a failed `session.promptHistory` is `unknown`; U4a's decision 13, the table's last row, names an incomplete record and not a failed read | unchanged, and pinned by a test that holds the sequence open (M3). The alternative: for a failed read, keep the stage and the box's hold and ask again when the link opens | `record()`'s first line |
| 11 | **`nothing_waiting` shows "The agent has already read this message"; the child's text says nothing is shown.** Over the link a Stop pressed after a Send now can be decided first on the machine, and the line then stands over a row that reads "Held" | `stackActs.sendNow`; U9's adapter sends engine-host acts that are not sends at once, and the machine decides acts concurrently | unchanged; one new tracker row (M4) | the `nothing_waiting` branch of `stackActs.sendNow` |
| 12 | **↑ says the Edit control's sentence** ("Can’t edit on `<machine>` yet. …"), since the key has no label of its own | UC-7.5: the control's own label | as written | the label in `refusalsNow` |
| 13 | **The review rung** | "Size and review" | the xhigh panel | Decision Log |

Sentences in the spec to correct, none of which changes what is built: the board ticket and the root's ordering say "its two new commands"; there is one. The child's UC-7 bullet says of `session.steer.cancel` that it "is listed in `remote-unavailable.ts`"; it left that set with pull request 650.

## The owner's card

One sentence a person reads is not settled by the child's text or the register (UC-7.5: "Taking back a waiting message has no `<done>` word yet … its second adds the words").

**Card 1 · What MAWS says when an act on a waiting message fails on another machine.** When you press Edit, Delete or ↑ on a message that waits in a session on another machine, or Send now on it, and that machine cannot do it (it went offline, it is read-only, it is busy), MAWS shows one line that begins "Not …:" and gives the reason, as it already says "Not sent: `<machine>` is offline" for a message. Which words should the line begin with for these two acts?

- **"Not taken back: …" and "Not sent now: …" (recommended).** Each line names the act as the rest of the app names it ("taking a message back", the Send now button). A failed Delete also reads "Not taken back", which is true: the message was not taken out of the queue.
- **"Not withdrawn: …" and "Not sent: …".** Shorter, but "Not sent" is also what a failed Enter says, so the line no longer tells you whether the message itself or only the Send now failed.
- **A word per control: "Not edited", "Not deleted", "Not sent now".** The line always repeats the button you pressed. It costs a second table of words, because the two buttons are one command.

Built by default: the first. The one place: the two rows of `ACT_WORDS` in `src/shared/ipc/remote-unavailable.ts`.

No drawn example is needed before the build: the card at the column's foot is frame 16 of the example the owner answered on 2026-11-13, and the sentences are text. For the owner's look at the built window (M4 lists them for the sitting): the chip at the column's foot; the card's height in a short window; the answer row with several questions.

## Routes (law 5)

| | a session MAWS runs, here | a session MAWS runs, on another machine | a terminal session, here or elsewhere |
|---|---|---|---|
| A waiting answer's row | "Answer to …" | the same: the queue's state arrives over the link and the words are composed in this window from the message's text, whatever that machine's build | not on this route: a terminal session has no rows, and its ask answers travel through the bridge |
| The `/btw` card's place | the column's foot while the column is drawn for the session; else the corner | the same | the same; a terminal session on another machine that is only listed has the column and its foot (U8b) |
| Send now on a next-step row; Esc on such a first row | `session.steer.sendNow`, as U4a built it; under an engine host of an earlier build, disabled with its sentence (U4a, decision 30) | the offered act behind `rl2.send-now` (Interfaces C). Without the capability: disabled, and Esc says the sentence and stops nothing | not on this route: no rows; Esc and Stop interrupt |
| Send now on an after-the-turn or a held row | `session.queue.promote` at `now`, unchanged | the same command, offered on every build | not on this route |
| ↑, Edit on a next-step row | the take-back, unchanged | the stage to that machine's draft store, then `session.steer.cancel` behind `rl2.session-acts` (Interfaces F). Without it: disabled with the sentence; ↑ says it and walks no history | not on this route: ↑ walks the prompt history |
| Delete on a next-step row | `session.steer.cancel` | the same act behind `rl2.session-acts`; without it, disabled with the sentence | not on this route |
| `/fork` in the palette | unchanged | greyed with the helper's sentence, or with "Wait for the turn to end, or stop it first" while the turn runs | not on this route (U4a) |

## Engine facts

This landing makes no statement about the engine that the first landing did not make; it carries two existing host commands over the link. Each fact a milestone rests on, and where it is recorded:

| fact | recorded in |
|---|---|
| `interrupt { send_now: true, message_uuid }` behind a running shell command answers `delivering`, moves the command and ends the turn `aborted_tools`; the message is the next turn | `spikes/protocol-probe/fixtures/uxwave/u4p2-a-1.jsonl` to `-3`; `findings-uxwave-u4-send-now-cases.txt` |
| while the model only writes it answers `stopped` | `u4p2-k-text-1.jsonl` to `-3` |
| for a uuid never sent, one withdrawn first and one already started it answers `nothing_waiting` and the turn goes on | `u4p2-n-never-*`, `u4p2-n-dropped-*`, `u4p2-n-started-*` |
| every message waiting at the next step goes with the one named, as one user message | `u4p2-two-1-*`, `u4p2-two-2-*` |
| a send-now and a `cancel_async_message` written together: the answers and what the turn's end reads | `u4p2-stop-inflight-hold-1.jsonl` to `-3` |
| a Stop that holds, written after the move | `u4p2-stop-moved-hold-*`, `u4p2-stop-after-hold-*` |
| `cancel_async_message` answers `cancelled: true` for a waiting message and the lifecycle reads `cancelled` | `u4p2-n-dropped-1.jsonl` (rows 40 to 42 by the findings file) |
| an engine that does not know `send_now` (2.1.283) performs a plain interrupt | `u4p2-old-1.jsonl` |
| a side question is one round trip and streams nothing | `spikes/protocol-probe/fixtures/pass3/p1-side-question-session.jsonl` |

The answer envelope is MAWS's own text (`askSteerText` in `src/shared/maws/ask.ts`), not the engine's.

## Acceptance

The child's A9 and A18 bind, and A3, A5, A7 and A20 where they say "on another machine". The items below say how each is shown. 1 to 12 are the executor's, by tests that fail before the milestone's code and pass at its head; 13 is the architect's run on a Mac and then the owner's sitting.

1. (A9) A message whose text is MAWS's answer envelope for one question, waiting at the next step, is a row that reads `Answer to <header>: <words>` where the window's transcript holds the ask, and `Answer to <the question's text>: <words>` where it does not; after a Stop holds it the row reads the same, marked "Held".
2. An envelope for three questions reads `Answers to 3 questions: …; …; …` in the asked order; a skipped answer reads "Skipped" and one left to the agent "Decide for me", in `askAnswerCopy`'s words; the row's hover title is the whole line.
3. The row still offers Send now only, and ↑ still skips it; a folded stack whose first row is an answer reads `3 queued · Next: Answer to …`.
4. (A18) With the card column shown for a session whose card is open, the window holds that card once: inside the column's `aside`, after the cards' list, and nothing over the pane's corner. Folded, the chip is there.
5. With the column not shown (the cards off, a side surface open, the room too small), the card is over the pane's corner and the column holds none. With a page open, where the column keeps its place and is hidden, the card is with the hidden pane and the hidden column holds none: `shown` is the test, not `placed`.
6. In a split of two sessions the focused pane's card is the column's foot and the other pane's card is over its own corner; moving the focus swaps them. A session drawn in the floating card, in its pill or in the bar keeps its card inside that pane whatever the column shows.
7. (A3, A5 on another machine) For a session on a machine whose handshake lists `rl2.send-now`, Send now on a next-step row invokes `session.steer.sendNow` once for that row's message and no `session.interrupt`; main builds it as an engine-host act on the open session, sealed for its live launch, carrying `requires: 'rl2.send-now'`; the endpoint runs it for a member who holds `converse` and refuses `grade` below it, `read-only` on a machine in read-only mode and `context` for a stale launch. Esc on such a first row does the same.
8. On a machine whose handshake does not list it (build G's list, and build F's), Send now is drawn disabled with "Can’t send now on `<machine>` yet. Update MAWS on `<machine>` and try again."; Esc shows that sentence in the stack and invokes nothing; ⌘. and the square still stop; main sends such a machine nothing and answers "Not sent now: update MAWS on `<machine>` and try again" if asked anyway. While the machine is offline the control reads "Send now is unavailable while `<machine>` is offline."
9. A Send now for a session with no live launch on the machine acquires nothing, sends nothing and answers "Not sent now: the session isn’t running on `<machine>`".
10. (A7 on another machine) ↑ on the newest next-step row of a session on a machine that lists `rl2.session-acts`: the claim's `session.drafts.set` is acknowledged before `session.steer.cancel` is invoked; the settling save is invoked only after the load; each of the two saves is invoked once; the box is read-only from the press to the settle's acknowledgement; a second ↑ meanwhile does nothing. With the claim unanswered, nothing is withdrawn. With the cancel unanswered and the record unreadable, the message is in the box under the "may already have been read" line, the stage is still stored, and nothing was rolled back.
11. On a machine that lists no `rl2.session-acts`: Edit reads "Can’t edit on `<machine>` yet. Update MAWS on `<machine>` and try again." and Delete "Can’t delete on `<machine>` yet. …" on a next-step row; ↑ on such a newest row shows the Edit sentence and walks no history; Edit and ↑ on an after-the-turn or a held row read "Taking a message back needs a newer MAWS on `<machine>`" with no `session.drafts.set` sent; Delete on those rows works. A refused withdrawal after the act reads "Not taken back: …".
12. (A20) In the palette of a session on another machine whose turn runs, `/fork` is greyed with "Wait for the turn to end, or stop it first"; the panel says the same and forks nothing.
13. On a Mac, two machines: the scenes of M4, and the list for the owner's look.

Not acceptance of this landing: anything of A3 or A7 on this Mac, which the first landing proved.

## Constraints that bind every milestone

- `~/.local/share/maws-ux-wave/briefs/build-common.md` binds as written: no typecheck, lint, test, install, build or Electron on the authoring machine; every check on the wave's build VM through `vmcheck.sh` under a time limit; the guards that read source text (a ticket number in renderer source is written in words); class 1a, the review and the pull request are the architect's.
- UC-7: a control for an act on a session on another machine reads the helper and nothing else (`test/lane-b/renderer-guards.test.ts` holds the renderer to it); the offer table is the only door, and each row is tested where it runs (`test/endpoint/`); `test/lane-b/offer-coverage.test.ts` passes unchanged.
- UC-8: the insertions in files other children own are those of Interfaces I and no others. An executor who needs another stops and reports.
- UC-11: the repository is public. Test content is invented; no machine, account, path or session text of a person's enters a test, a fixture, a comment or a commit.
- UC-14: nothing is stored that is not stored today; neither settings file, no layout key and no stored tab changes.
- D-1 and law 6: the engine is not patched and not guessed at; no milestone adds an engine statement beyond "Engine facts".
- Light theme default; components use tokens only. The foot uses the cards' existing classes.
- Every sentence a person reads is in Interfaces D or A, as written there; an executor adds none.

## Plan of Work

### M1 — A waiting answer reads as an answer

**What exists at its end.** A waiting message that is MAWS's answer envelope is drawn in the stack as "Answer to …" (Acceptance 1 to 3), on both routes that have rows.

**What it touches.** `src/renderer/src/composer/queue/stack.ts` (the row's `answer` becomes its words or null; `answerWords`; `STACK_WORDS.answer`, `.answers`, `.answerBare`; `rowText`), `composer/queue/stack-acts.ts` (`Read` gains `questions`, filled by `readOfEntry` from the entry's rows of kind `ask`), `composer/queue/QueueList.tsx` (the one test of `row.answer`), and their tests `stack.test.ts` and `QueueList.test.tsx`.

**Interfaces.** Exposes Interfaces A. Consumes `readAnswerEnvelope` (U3a), `askAnswerCopy` (`transcript/model/copy.ts`), the `ask` row of `transcript/model/rows.ts`.

**Decisions.** Decisions 2 and 3. `isAnswer` goes; nothing in `composer/` calls `parseAskSteer` afterwards. `newestToTake` and the row's controls test `row.answer !== null`. The `sending` and `handed` rows, which carry text and no controls, take their text through `answerWords` too, falling back to what they read today: a held answer that is sent now is `submitting` for a moment, and a message the transcript holds unread may be an answer whose capsule the window does not hold. The title is matched by the answer's `id` against the row's `questions`; an answer whose id the row does not hold falls back to its own `question` text.

**What it does not touch.** `src/shared/engine/arrival.ts`, `src/shared/maws/ask.ts`, the transcript's model and view (read, not edited; UC-3), `entry-text.ts`, the envelope sent to the model, the row's controls.

**What it proves.** Acceptance 1 to 3. Its tests also pin: a text that is no envelope is no answer (one changed character in the tag); the title prefers a non-empty header; an answer with a note reads `askAnswerCopy`'s line with the note; an envelope whose ask the transcript holds under a different turn (folded) still finds its header.

### M2 — The `/btw` card at the column's foot

**What exists at its end.** The card is the column's foot wherever the column is drawn for its session, and over the pane's corner otherwise (Acceptance 4 to 6).

**What it touches.** New `src/renderer/src/side/btw-place.ts` and its test; `side/BtwCard.tsx` (the placement `'foot'`, `BtwCardFoot`) and `BtwCard.test.tsx`; `side/register.ts` (the slot's registration in `registerSidePane`); `panel/summary/Summary.tsx` (one class, U8's file; `Summary.test.tsx` is not edited); `app/Shell.test.tsx` (the cases of Acceptance 4 to 6, on the mounted shell, with the slot registered as the app registers it).

**Interfaces.** Exposes Interfaces B. Consumes `useCardColumn` (`app/shell-view.ts`), `cardSession` (`shell/floating.ts`), the slot `sessionCardFoot` (`app/slots.ts`).

**Decisions.** Decisions 4 and 5. The foot's mount reads the same on-screen rule as the corner's for the unseen dot (`useOnScreen`: the column's session is the focused pane's, so it is on screen while the column is shown). While a page is open the column is not shown, so the card goes with the pane behind the page, as it is today. `data-btw-card` and `data-btw-chip` take the value `foot`. The foot's wrapper is a plain `div`: the `aside` is already the landmark and the card is its own labelled `section`.

**What it does not touch.** `session/SessionPane.tsx`, `app/Shell.tsx`, `app/slots.ts`, `app/slot-fallbacks.tsx`, `app/shell-view.ts`, `app/shell-geometry.ts`, the cards, the card's content, timer and store, the Side pane.

**What it proves.** Acceptance 4 to 6, in jsdom, which has no layout: where the card is in the tree and how many there are. That it stands at the column's bottom, that the cards end above it and that it covers neither the composer nor the jump control is M4's scene on a Mac. Its tests also pin: with the card closed the foot draws no element (the column's wrapper has one child, as U8b's test says); `btwPlace`'s whole table (Interfaces B).

### M3 — Send now and taking back on another machine

**What exists at its end.** Acceptance 7 to 12.

**What it touches.** U9's four files, by the insertions of Interfaces I: `src/endpoint/offers.ts`, `src/endpoint/capabilities.ts`, `src/shared/ipc/remote-unavailable.ts`, `src/main/lane-b/remote.ts`; `apps/org-protocol/src/channel.ts` (the minor) and `apps/org-protocol/test/messages.test.ts`; the helper `src/renderer/src/lane-b/remote-unavailable.ts` (one export). This child's own: `composer/queue/stack-acts.ts` (`Refusals`), `composer/queue/QueueList.tsx` (the three titles read the new fields), `composer/queue/take-back.ts` (decision 10's condition), `session/controls/lane-b.ts` (its header comment: the command is offered), `composer/mentions/SlashPalette.tsx` and `widgets/ForkWidget.tsx` (decision 11). Tests: `src/shared/ipc/remote-unavailable.test.ts`, `src/main/lane-b/remote.test.ts`, `test/endpoint/session-acts.test.ts`, `src/renderer/src/lane-b/remote-unavailable.test.ts`, `composer/queue/QueueList.test.tsx` (the block "the stack’s refused controls"), new `composer/Composer.remote-stack.test.tsx`, `composer/queue/take-back.test.ts` and `take-back-lifecycle.test.tsx`, `session/controls/lane-b.test.ts`, `composer/mentions/SlashPalette.test.tsx`, `widgets/ForkWidget.test.tsx`, and `test/lane-b/renderer-guards.test.ts` (its two entries for `session.steer.sendNow` go).

**Interfaces.** Exposes Interfaces C, D and E. Consumes U9's `disabledWords`, `refusalWords`, `failureWords`, `REMOTE_NEEDS`, `ACT_WORDS`, `useRemoteUnavailableAs`, `useForkUnavailable`, `remoteStandingOf`; U4a's `QueueControls.sendNow`, `stackActs`, `takeBack`.

**Decisions.** Decisions 6 to 12. The order of edits that keeps `test/lane-b/offer-coverage.test.ts` green at every commit: the row in `OFFERS`, the name in `ENGINE_HOST_ACTS`, the capability in `ENDPOINT_CAPABILITIES`, the entry in `REMOTE_NEEDS` and the removal from `REMOTE_UNAVAILABLE` are one commit. `session.steer.sendNow` is not a send: it is not added to `SENDS`, so it never waits behind a `session.send` that is still out, as an interrupt does not. The port's `sendNow` in `session/controls/lane-b.ts` is unchanged in code: a session on another machine was never gated there, and now its invocation reaches the adapter. `SESSION_ACTS` in `remote.test.ts` is the capability list the existing cases relink with; the new cases relink with build G's list (it, without `rl2.send-now`) and build F's (neither), written out in the test as constants read from the two builds.

**What it does not touch.** `src/engine-host/` (the command, the queue, the normaliser), `src/services/` (the draft store), `src/endpoint/actions.ts` and `authorize.ts`, `src/shared/ipc/schema/` and the wire's manifest, `lane-b/remote-drafts.ts`, the take-back's steps, `composer/Composer.tsx`, lane A.

**What it proves.** Acceptance 7 to 12. Its tests also pin, each by holding the sequence open and not by the final state alone:
- a Send now over the link whose act is not yet answered: that row's controls are disabled, the other rows' are not; its answer `delivering` marks every next-step row "Sending…"; `nothing_waiting` shows the notice line; an answer that never comes ends at main's bound as a toast, "`<machine>` took the request but hasn’t confirmed it", with the row left as it was;
- a second fresh Esc while the first Send now is out invokes the command a second time and never `session.interrupt`;
- a Send now handed to main while a `session.send` of the same session is still out goes at once;
- the take-back's three crossings in order (Interfaces F), with the claim held open, then the cancel held open, then the settle held open, and at each hold: what is invoked so far, that the box is read-only, and that a second ↑ and a press of Edit do nothing;
- `storeRefusesStage` for a machine whose capabilities are not yet known (the link not up) answers null, and the first press then goes by the claim's answer, as today;
- an engine host that has no handler for the command answers the op `refused unavailable` (`src/engine-host/ops.test.ts` already pins a name with no handler; the case is pointed at, not added), and the device words it "Not sent now: `<machine>` is busy; try again in a moment".

### M4 — The scenes, the record, the last run

**What exists at its end.** The e2e scenes below, written and typechecked and not run; the record; the landing's one whole-suite run green on the VM.

**What it touches.** `e2e/composer.spec.ts`, `e2e/side.spec.ts`, `e2e/remote.spec.ts` and whatever of `e2e/support/` the three need; `docs/tech-debt-tracker.md`; `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` (two dated sentences); this document's Progress, Surprises and Outcomes.

**The scenes.**

| spec (group in `package.json`) | scene | what it shows |
|---|---|---|
| `e2e/composer.spec.ts` (`e2e:composer`, `e2e:c7`) | new: "U4b, a waiting answer" | on the replay that keeps a turn running (`steerStopJournal`), the envelope `askSteerText` builds for one invented question is handed to the running turn through `session.steer`; the stack's row reads "Answer to `<the question>`: `<the label>`", offers Send now and neither Delete nor More; ↑ in the empty box walks the history and takes nothing back; after the square's Stop the row reads the same, marked "Held" |
| `e2e/side.spec.ts` (`e2e:side`) | changed: scene 5 | the card it asks for is `[data-btw-card="foot"]` inside the "Session cards" region, and `[data-btw-card="corner"]` has count 0; the card's box lies inside the column's, its bottom edge within 8 px of the column's, and it intersects neither the composer's frame nor the jump control; the "Session cards" icon pressed off moves the card to the corner, and pressed on moves it back; folded, the chip is in the column. After "Continue as a side thread" the Side pane is open, the column is gone and the card, still open, is at the corner |
| `e2e/side.spec.ts` (`e2e:side`) | unchanged, to be confirmed green: scene 8 | a side surface is open throughout, so its `[data-btw-card="corner"]` stands |
| `e2e/remote.spec.ts` (`e2e:remote`) | new: "U4b, Send now and a take-back on B" | A opens B's session MAWS runs, on B's replay of a turn that runs a long command (U4a's `sendNowJournal`, or its counterpart on B's replay list). A types a message and presses Enter: a "Next step" row. Send now: B's journal holds an outgoing `interrupt` with `send_now` and that message's uuid and no `cancel_async_message`; the row leaves; A's transcript reads "Ended for your message". Then a second message, and ↑: the box holds it; B's journal holds the `cancel_async_message` for its uuid; and the draft kept for the member on B, read from A through `session.drafts.get` once the box takes typing again, is the message as an ordinary draft, with no `takeBack` (the order of the two saves and the cancel is M3's unit proof, not this scene's). Then a third, and Delete: the row leaves. Then `/fork` picked in A's palette opens the fork's tab on B. Each step asserts that B's turn was not stopped by it |
| `e2e/remote.spec.ts` (`e2e:remote`) | new: "U4b, a machine that does not offer Send now" | the same opening with B's endpoint started under `MAWS_E2E_ENDPOINT_WITHOUT: 'rl2.send-now'`: the row's Send now is disabled with the sentence; Esc shows it in the stack; B's journal holds no outgoing `interrupt`; ⌘. stops B's turn. A second run of the block with `'rl2.send-now,rl2.session-acts'`: Edit and Delete disabled with their sentences, ↑ says Edit's and the box stays empty |
| `e2e/remote.spec.ts` (`e2e:remote`) | unchanged, to be confirmed green: the M8 scene's `/btw` step | it finds `[data-btw-card]` inside the main region, which holds the column |

Groups whose scenes cross what this landing moves and gain nothing, to be run as they are: `e2e:layout` and `e2e:panel` (the column's wrapper), `e2e:lane-a` (a terminal session's `/btw`), `e2e:widgets` (the palette's `/btw` and `/fork`), `e2e:tools` (the async ask), and the default group.

**The record** (in the same pull request, UC-10).
- No ruling is reversed and no contract of the charter is amended, so `docs/charter.md` is not edited.
- `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md`: at the two places U9's amendment of 2026-11-13 stands ("From the UX wave (U9), behind `rl2.session-acts`: …"), this sentence is appended: "Amended `<date>` (the UX wave, U4b; `docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md`): behind `rl2.send-now`, sending now a message that waits at the next step (`session.steer.sendNow`) is offered; it is sealed for the session's live launch and never resumes a session." `<date>` is the landing date.
- `docs/tech-debt-tracker.md`: the row "No e2e scene drives a take-back … or a `/fork` of a session on another machine" is closed (its closing column names the new scene). The row "The first press on a machine of an earlier build" is reworded to this Mac's own services, with the sentence that a machine over the link is closed from the first draw. The row "A Send now on an after-the-turn row in about the first 3 s" loses "U4b is where it would go" and gains "not built in U4b; the probe it needs is in that landing's document, Probes". One row is added: "Over the link a Stop pressed just after a Send now can be decided first on the machine; the Send now then answers `nothing_waiting` and the stack says 'The agent has already read this message' over a row that reads Held. `stackActs.sendNow` in `src/renderer/src/composer/queue/stack-acts.ts`. Closes when that line is shown only for a message the record shows started." If Reported 10 is ruled as written, one more: "A take-back whose record cannot be read because the link dropped loads the message under the 'may already have been read' line while it may still wait on the machine. `record()` in `composer/queue/take-back.ts`. Closes by asking again when the link opens."
- The register's rows (X-049, O-20), the board ticket, the tracker rows this landing closes on the board and the root's tracking map are updated at landing by the sessions that keep them, not by the executor.

**What it does not touch.** Any source file. `e2e/cross-build.spec.ts` and the coverage table (nothing new is stored).

**What it proves.** Nothing by running: the scenes are the architect's to run. The whole unit suite, the whole typecheck (which covers the e2e specs' project), eslint over the branch's paths, and the gate's script tests (the diff touches `e2e/`).

## Concrete Steps

From the worktree of branch `ux-wave/U4b`. `vmcheck.sh` is `~/.local/share/maws-ux-wave/tools/vmcheck.sh`; on the VM `<paths>` are repository paths. The VM is shared with landings in build: a slow or timed-out check is read against its load first.

1. **Master first.**

       git fetch origin master && git merge origin/master

   Merge, never rebase or force-push. Then check what this landing stands on:

       git grep -n "sessionCardFoot" -- src/renderer/src/app/slots.ts src/renderer/src/panel/summary/Summary.tsx
       git grep -n "export function readAnswerEnvelope" -- src/shared/engine/arrival.ts
       git grep -n "'session.steer.cancel': SESSION_ACTS_CAPABILITY" -- src/shared/ipc/remote-unavailable.ts
       git grep -n "'session.steer.sendNow': notYet" -- src/shared/ipc/remote-unavailable.ts
       git grep -n "RL2_PROTOCOL = " -- apps/org-protocol/src/channel.ts

   Each prints a line. The last gives the link's minor to raise by one. Then, for every file "What this document assumes of landings in flight" names that the merge changed (`git diff --name-only 63c97b5c0 HEAD`), read it again against that table's third column before building on it; where an assumption fails, do what the fourth column says, and where that is not enough, stop and report.

2. **The checks**, on the VM. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/U4b
       vmcheck.sh ux-wave/U4b -- 'timeout 600 pnpm exec vitest run <the milestone's test files>'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'     # the renderer
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'    # main, the endpoint, shared (M3)
       vmcheck.sh ux-wave/U4b -- 'timeout 600 pnpm exec eslint <the paths changed>'

   The first call for the branch installs dependencies there; allow it twenty minutes. Each call's exit status is the command's, so it is never piped into `tail` or `head` without `set -o pipefail`. At a milestone's tests-first commit the vitest run fails on the new assertions (for M1, a line such as `expected '[MAWS ask a-1] The user answered …' to be 'Answer to Layout: Grid'`); at its head it prints `Test Files … passed` with no failure, `tsc` prints nothing and eslint prints nothing.

   Per milestone, the test files: M1 `src/renderer/src/composer/queue`, `src/renderer/src/composer/Composer.test.tsx`, `test/support/tokens-guard.test.ts`. M2 `src/renderer/src/side`, `src/renderer/src/panel/summary`, `src/renderer/src/app/Shell.test.tsx`, `src/renderer/src/session`, `test/support/tokens-guard.test.ts`. M3 `src/shared/ipc/remote-unavailable.test.ts`, `src/shared/machine`, `src/main/lane-b`, `test/endpoint`, `test/lane-b`, `src/renderer/src/lane-b`, `src/renderer/src/composer`, `src/renderer/src/session/controls`, `src/renderer/src/widgets`, `src/renderer/src/sessions`, `src/engine-host/ops.test.ts`, and `apps/org-protocol/test/messages.test.ts` for the link's minor (the root's vitest run takes the package's project; `pnpm --filter org-protocol test` runs it alone).

3. **The wire's manifest** does not change. After M3, `vmcheck.sh ux-wave/U4b -- 'timeout 300 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'` passes with `WIRE_MINOR` untouched. If it fails, something was added to the wire by mistake: stop and report; never raise the minor to pass.

4. **The last run** (M4), after a fresh merge of master and a push:

       vmcheck.sh ux-wave/U4b -- 'timeout 1200 pnpm typecheck'
       vmcheck.sh ux-wave/U4b -- 'timeout 900 pnpm exec eslint $(git diff --name-only origin/master...HEAD -- "*.ts" "*.tsx" | tr "\n" " ")'
       vmcheck.sh ux-wave/U4b -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck.sh ux-wave/U4b -- 'timeout 2400 pnpm test'

   On the VM these fail on master too and are not this landing's: the desk-hub `test/deploy/{hub-reads,production-scripts,staging-scripts}.test.ts`, `src/services/machine/setup.test.ts`, `src/shared/machine/git-reads.test.ts`, `test/artifacts/portability.test.ts`; `src/renderer/src/sidebar/Sidebar.test.tsx` can fail under the whole suite's load and pass alone. Any other failure is this landing's. A run whose log has stopped growing while a process sits at full CPU is a loop: stop it, find the case one file at a time, and report the loop itself.

5. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The hand-back says: what exists, with the command and result that showed it; what is not verified (every scene of M4, by file and name, written and typechecked but not run, with its group); the decisions made; anything that contradicts this document or the child's file; what deserves a ticket.

6. **The architect's, after the hand-back.** "Proof that an executor does not run", in its order.

## Proof that an executor does not run

| # | the proof | when | what it needs | what comes back |
|---|---|---|---|---|
| 1 | **Class 1a** on GitHub Actions | on the head the executor hands back, and again on the final head if the review changed the branch | `scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u4b`, in the background | each job's conclusion and the run's URL; the pull request's body names the run on the final head |
| 2 | **The branch's review** | once class 1a is green | the xhigh panel of `doperpowers:review-code` with the lenses of "Size and review", given the base sha, the head sha and the worktree; U9's keeper reads the insertions of Interfaces I against U9's list (UC-7.6) | its verdict and findings; the findings are settled by a fix wave, never inline |
| 3 | **The new and changed scenes alone, then their groups** (C4; UC-10) | after the review's findings are settled | a Mac under the load rule. Alone, in this order: the new scene of `e2e/composer.spec.ts`; scene 5 of `e2e/side.spec.ts`; the two new scenes of `e2e/remote.spec.ts` (each starts two apps). Then the groups: `e2e:c7`, `e2e:side`, `e2e:remote`, `e2e:layout`, `e2e:panel`, `e2e:lane-a`, `e2e:widgets`, `e2e:tools`, and the default group | each scene and group named as run and green; a skipped scene is not evidence. What only this run shows: that the card stands at the column's bottom and covers neither the composer nor the jump control (jsdom has no layout); that the column is in fact drawn at the e2e window's width in scene 5; that an act crosses a real link and reaches the other machine's engine host |
| 4 | **The owner's look at the built window** | at the wave's next sitting | the card at the column's foot, open and folded, in a tall and a short window; an answer's row with one and with several questions; a refused Send now on a machine of build G, with its sentence | each called a clear improvement, or reworked; the answer to card 1 if it was not given before the build |
| 5 | **Older peers of the link, by hand** | with 3, if a second machine on build G is at hand | this build's app against a machine that runs build G: a next-step row there shows Send now disabled with the update sentence and Edit, Delete and ↑ working; nothing is sent that the machine refuses (its endpoint's log holds no `not-offered` for these acts) | the observation, recorded. No `e2e:cross-build` run is owed (decision 7); if the architect rules that one is, it is `scripts/ci-gate.sh "$PWD" --gates e2e:cross-build --peer-exact 2c7044231 --label u4b-xb` in the equal-wire mode, in which this landing has no scene of its own to run |

Until row 3 is green, no build that holds this landing is offered to a machine a person uses. Between the first landing and this one, Send now on a session of another machine is refused with a sentence (the root's UC-10, "Landing"); this landing ends that.

## The pull request

Its body names: the class 1a run on the final head; the review's verdict and what was dismissed or deferred; the Mac runs of row 3 by scene and group; the residue (the tracker rows of M4); that no ruling is reversed and no wire minor is taken; the link's minor it took; the insertions in U9's files, for U9's review; the one class in U8's file. It ends with the session line the build brief gives.

## Interfaces and Dependencies

What must exist at the end, by name. An executor who needs to change a name or a sentence here stops and reports.

### A. The words of a waiting answer (M1)

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

`answerWords`: `readAnswerEnvelope(text)`; null gives null. For each of its `answers`, in order: the question is `questions(call)?.find((q) => q.id === answer.id)`; the title is the first non-empty of the question's `header`, the question's `question` and the answer's own `question`, each trimmed; the words are `askAnswerCopy(answer)`. One answer: `answer(title, words)`, or `answerBare(words)` with no title. Any other number: `answers(pairs)`. (An envelope with no answers cannot be sent, `askAnswersProblem` in `src/shared/maws/ask.ts`; no case is built for it.)

`rowText(row)` is the row's `answer` where it has one, else as today. `stackRows` fills `answer` with `answerWords(messageText(content), read.questions)`, and gives a `sending` and a `handed` row the same words as its `text` where the function answers some. `readOfEntry` in `stack-acts.ts` answers `questions` from the entry's rows: the row of kind `ask` whose `askId` is the call, its `questions`. `NOTHING_READ.questions` answers null.

### B. Where the card is drawn (M2)

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

### C. The offer of `session.steer.sendNow` (M3; UC-7.2's five facts and the words)

| fact | value |
|---|---|
| the command | `session.steer.sendNow { appSessionId, messageUuid } → { outcome: 'delivering' \| 'stopped' \| 'nothing_waiting' }`, as U4a declared it (`src/shared/ipc/schema/session.ts`); unchanged |
| the grade | `converse` (`src/shared/ipc/grades/session.ts`); unchanged. It carries no content; what it adds is ending the running turn, which `session.interrupt` and `session.steer.cancel` allow at `converse` |
| the row | `'session.steer.sendNow': laneB('act')` in `OFFERS`: an act, run by the engine host, placed by `appSessionId`; no `accepts` (a remote caller may send the whole schema, which is two ids) and no `owners` |
| the device's half | the name in `ENGINE_HOST_ACTS`; and `const LIVE_ONLY: ReadonlySet<CommandName> = new Set(['maws.pane.answer', 'session.steer.sendNow'])`, read where `engineAct` today tests the one name: with no live context a command of the set is refused `not-live`, resumes nothing and sends nothing. The pane answer keeps today's sentence; Send now's is `failureWords('session.steer.sendNow', \`the session isn’t running on ${link.name}\`)` |
| the capability | `export const SEND_NOW_CAPABILITY = 'rl2.send-now'` beside `SESSION_ACTS_CAPABILITY`; appended to `ENDPOINT_CAPABILITIES` with its comment (the offer, U4b, this document, and that a device sends a machine the act only when its `h2` listed it); `REMOTE_NEEDS['session.steer.sendNow'] = SEND_NOW_CAPABILITY`; `RL2_PROTOCOL.minor` one above master's, with the test's title naming the capability |
| the words | D; and the command's row leaves `REMOTE_UNAVAILABLE` |

**Where it is authorised, and on what value.** (1) The endpoint (`src/endpoint/authorize.ts`): the caller's grade on the session the act names, `converse` or above, and the machine's read-only mode. (2) The endpoint's lane B branch (`src/endpoint/actions.ts`): the session's status is read, and the context the act was sealed for must be the session's launch and engine session now. (3) The engine host (`src/engine-host/ops.ts`): the input is held to the command's schema, the op is claimed in the ledger, and the context is checked again in the turn of the claim. (4) The act (`MessageQueue.sendNow`): the session is found by the same `appSessionId` the endpoint placed and the ledger claimed, and the uuid must be a pending steer of that session's own queue; any other uuid answers `nothing_waiting` without a word to the engine. So a caller cannot reach another session's message by naming its uuid, and the answer is one word that says nothing of any message's content. Each of (1) to (3) has its refusal tested at the endpoint (Acceptance 7); (4) is U4a's test of the queue, unchanged.

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

After the act, main words a refusal as `Not <done>: <reason>` (UC-7.5's second table, unchanged), and the window shows it as it is, as a toast: "Not sent now: `<machine>` is offline", "Not sent now: update MAWS on `<machine>` and try again", "Not sent now: you can read this session but not act on it", "Not sent now: `<machine>` is in read-only mode", "Not sent now: `<machine>` is busy; try again in a moment", "Not sent now: the session isn’t running on `<machine>`"; and the same reasons after "Not taken back: " for a Delete that was refused. A take-back's own withdrawal shows no such line: what became of the message is read from the record (U4a's decision 13). An act the link carried whose answer has not come by main's bound keeps today's sentence, "`<machine>` took the request but hasn’t confirmed it".

### E. The stack's refusals (M3)

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

`useRefusals` reads `useRemoteUnavailableAs`; `refusalsNow` reads, in `src/renderer/src/lane-b/remote-unavailable.ts`:

    /** The labelled answer read now, for a key pressed outside a render. */
    export function remoteUnavailableAsOf(label: string, appSessionId: AppSessionId | null, ...commands: CommandName[]): string | null;

`composer/Composer.tsx` calls `sendNowRefusal(refusalsNow(…), first)` and `takeBackRefusal(refusalsNow(…), row)` today and is not edited.

In `composer/queue/take-back.ts`, `refusalIn` answers the machine's sentence first where `remoteStandingOf(appSessionId)` is not null, its `capabilities` are not null and they lack `SESSION_ACTS_CAPABILITY`; then as today.

### F. The sequences over the link (M3)

**Send now.** The press (the row's button, or a fresh Esc) → the window invokes `session.steer.sendNow` → main's adapter: the tab holds the session, the peer's capabilities allow it, the session has a live launch → one engine-host act, sealed for that launch, `requires: 'rl2.send-now'`, never behind a send → the endpoint's four checks (C) → the engine's `interrupt { send_now }` → the engine's word back as `outcome`.

| at this point | the person acts in between | the awaited thing fails or never comes |
|---|---|---|
| the act is out, unanswered | the row's own controls are disabled; a second Esc sends the command again, which the engine answers `delivering` again or `nothing_waiting` (never a stop); a press of Stop is a `session.interrupt` that the machine may decide first: the message is then held, the Send now answers `nothing_waiting` or is rejected as "already being withdrawn", and the turn stops, which is what Stop asked for (Reported, 11, for the line shown) | the link drops before the act went: it waits under the link's hold and ends "Not sent now: `<machine>` is offline"; the message still waits there. The act went and its answer is lost: main's bound answers "`<machine>` took the request but hasn’t confirmed it"; if the engine did deliver, the row leaves at its `started` |
| the answer is `delivering` | every next-step row reads "Sending…" with no controls until its own `started` arrives over the session's stream | the stream is cut: the rows keep "Sending…" until the stream reopens and the queue's state is read again, which lists what still waits |

**Taking back a next-step row** (↑ or Edit; U4a's five steps, with what crosses the link). The window is the only actor; the machine's draft store holds the stage; no step is rolled back.

| # | step | crosses as | a complete copy is in | if it fails, or the person acts |
|---|---|---|---|---|
| 1 | the stage is built and the box held read-only | nothing | the machine's engine (the message waits) | a second ↑ or Edit does nothing while one is in hand |
| 2 | the claim: the stage saved whole, acknowledged | `session.drafts.set { draft: <stage>, replaces: 'claim:no-document' }`, a `machine` act, once, after the session's saves handed before it | the engine; and, once acknowledged, the machine's draft store | refused "a draft with a document is kept": "A draft is kept for this session, so the message was left waiting". Refused as stale (a store before U4a): the machine's sentence, remembered. Refused "a message being taken back is kept": that stage is read and carried forward first. Not sent (the link would cut an attachment), failed, or the link down: "Could not keep the message as a draft, so it was left waiting". In every one of these nothing was withdrawn. Its answer lost at main's bound while the save did land: the same line; the stage is kept there with the message still waiting, the store fences other saves, and the next ↑ or the next mount carries it forward |
| 3 | the withdrawal | `session.steer.cancel { messageUuid }`, an engine-host act, `requires: 'rl2.session-acts'`; the window waits five seconds for its answer | the machine's draft store (the stage); the engine until the cancel is done | `cancelled`: step 4. Any other answer, none in five seconds, or a refusal: the record is read (`session.promptHistory`, a call) and decides, by U4a's table: gone, read by the agent, listed under another name, or cannot say. Where the record itself cannot be read (the link is down), it cannot say (Reported, 10) |
| 4 | the load, then the settle | the load is the window's; the settle is `session.drafts.set { draft: <the box's draft>, replaces: 'settle:<the stage's revision>' }`, once per attempt | the box; the machine's draft store (the stage until the settle is taken, the draft after) | the agent has the message: the box stays empty, the stage is cleared by a settling save of `null`, and the stack says "The agent has already read this message". The settle fails: it is asked again with a growing wait, the box stays read-only, and after three tries the box's own writer names the form too. The settle is refused as stale: another mount settled first; what is kept is read and taken |
| 5 | whoever meets a stored stage carries it forward | steps 3 and 4 | as there | never rolled back |

The order is fixed by awaiting: the cancel is not invoked before the claim's answer, and the settle not before the load. `lane-b/remote-drafts.ts` sends each of the two saves once and reads nothing on their behalf (U4a). Delete is step 3's act alone, with its answer shown.

### G. Builds: what each side shows when the other does not know a command

Read from the two builds with `git show`: build F lists neither capability, has no `session.steer.sendNow`, declares `session.steer.cancel` unavailable, and its draft store knows no claim; build G lists `rl2.session-acts`, offers `session.steer.cancel`, declares `session.steer.sendNow` unavailable, and its draft store knows the claim.

| the device | the machine | Send now on a next-step row | ↑, Edit, Delete on a next-step row | ↑, Edit on an after-the-turn or a held row |
|---|---|---|---|---|
| this build | this build | works | work | work |
| this build | build G | disabled, "Can’t send now on `<machine>` yet. Update MAWS …"; Esc says it; nothing is sent | work | work |
| this build | build F | disabled, the same sentence | disabled, "Can’t edit …" and "Can’t delete …"; ↑ says Edit's | disabled from the first draw, "Taking a message back needs a newer MAWS on `<machine>`"; Delete works (`session.queue.remove`) |
| build G | this build | disabled in G's window, "Not on another machine yet: sending a waiting message now while the agent works"; G sends nothing | work, as between two machines of build G | work |
| build F | this build | F has no such command: its Send now and its Esc are `session.interrupt`, which is offered and stops the turn, as F does everywhere | F's next-step row offers Send now and Hold alone, and F declares the cancel unavailable | F has no take-back: its held row's own Edit and Delete are `session.queue.edit` and `session.queue.remove`, both offered |

A machine of this build whose engine host is still an earlier build's (the hours after an update, until its sessions are idle or handed over): an engine host of build G knows the command and runs it; one of build F has no handler, answers the op `refused unavailable`, and the device says "Not sent now: `<machine>` is busy; try again in a moment". Nothing is stopped on that path.

The proofs: the device's cases at both older lists (`src/main/lane-b/remote.test.ts`), the window's cases at both (`QueueList.test.tsx`, `Composer.remote-stack.test.tsx`), and M4's scene with the capability withheld. The rows whose device is an older build are those builds' own behaviour and are stated, not run.

### H. What is stored or sent (UC-14)

This landing stores nothing that is not stored today, and both older builds read everything it leaves.

| value | this landing | build F and build G |
|---|---|---|
| a take-back's stage in a machine's draft store (a member's draft whose document carries `attrs.takeBack`) | written exactly as U4a writes it; reachable for a next-step row on another machine since pull request 650; no field, key or form changes | F's store refuses the claim as stale, so nothing is staged there; G's store is this build's. A device of build F that opens such a session reads the stage as an ordinary draft, and its saves are fenced by a store of this build or of G (U4a's row of the cross-build coverage table) |
| the card's state, and where it is drawn | the window's memory; never stored | — |
| the endpoint's capability list | one more name in the `h2` | a device of F or G does not know the name and passes it by: a peer checks a capability, never the minor (`apps/org-protocol/src/channel.ts`) |
| `session.steer.sendNow` as an act on the link | sent only on a channel whose peer listed `rl2.send-now` | never received by F or G from this build; if one arrived, neither has a row for it and answers `not-offered` with nothing run |
| the wire between an app and its hosts | unchanged: no command, event, property or socket capability | — |

A run of this build, then build F or G on the same profile, then this build again leaves nothing different: no key is written. So the cross-build coverage table gains no row.

### I. Insertions in files other children own (UC-8)

| file | owner | the insertion |
|---|---|---|
| `src/endpoint/offers.ts` | U9 | one row and its comment |
| `src/endpoint/capabilities.ts` | U9 | one entry and its comment |
| `src/shared/ipc/remote-unavailable.ts` | U9 | the declared row removed; `SEND_NOW_CAPABILITY`; one entry of `REMOTE_NEEDS`; two rows of `ACT_WORDS`, and the comment above it that says taking back has no words yet |
| `src/main/lane-b/remote.ts` | U9 | one name in `ENGINE_HOST_ACTS`; `LIVE_ONLY` in place of the one-name test in `engineAct`; one sentence in the header comment |
| `src/renderer/src/lane-b/remote-unavailable.ts` | U9 | one export, `remoteUnavailableAsOf` |
| `test/endpoint/session-acts.test.ts`, `src/main/lane-b/remote.test.ts`, `src/shared/ipc/remote-unavailable.test.ts`, `src/renderer/src/lane-b/remote-unavailable.test.ts` | U9 | new cases; the assertion that `ACT_WORDS['session.steer.cancel']` is undefined is replaced by its words |
| `test/lane-b/renderer-guards.test.ts` | U9 | two entries removed |
| `apps/org-protocol/src/channel.ts`, `apps/org-protocol/test/messages.test.ts` | the link's (P5); UC-7.2 asks for it | the minor, and the number its test pins |
| `src/renderer/src/panel/summary/Summary.tsx` | U8 | one class; its test file is not edited, and its two cases of the slots pass as they are |
| `src/renderer/src/app/Shell.test.tsx` | U8 | new cases only |
| `src/renderer/src/side/register.ts` | U5's folder | one registration |
| `src/renderer/src/widgets/ForkWidget.tsx` and its test | U11 by the root's table | one hook in place of another |
| `docs/doperpowers/plans/2026-10-28-p5-o7-remote-lane-b.md` | P5 | two dated sentences (M4) |

This child's own: `src/renderer/src/composer/` (but `composer/docked/`), the `/btw` files in `side/` (`BtwCard.tsx`, the new `btw-place.ts`, their tests). In files the root's table gives to no child: `session/controls/lane-b.ts` (a comment).

### J. One reading of each fact

| the fact | the one function that decides it | who reads it today | this landing |
|---|---|---|---|
| a message's text is MAWS's answer envelope, and what it answers | `parseAskSteer` (`src/shared/maws/ask.ts`), as the class `answer` through `readAnswerEnvelope` (`src/shared/engine/arrival.ts`) | `composer/queue/stack.ts` (`isAnswer`, by `parseAskSteer`), `transcript/model/derive.ts` (`askSteerOf`), `transcript/model/reduce.ts`, `arrival.ts` itself (twice), `e2e/maws-tools.spec.ts` | `stack.ts` reads `readAnswerEnvelope`; no other reader moves |
| one answer in words | `askAnswerCopy` (`transcript/model/copy.ts`) | `transcript/view/rows/AskCapsule.tsx`, `transcript/model/serialize.ts`. (The envelope's own line is `answerText` in `ask.ts`, written for the model; the sheet's `AnswerValue` draws controls) | `stack.ts` reads it too |
| a question's title | "the header, else the question": written in place at `AskCapsule.tsx`, `serialize.ts`, `ask.ts` (`askSteerText`) and `transcript/model/answered.ts` | those four | `answerWords` writes the same rule; no shared function exists and none is added for one more reader |
| what a waiting answer's row says | `answerWords` (new) | — | its only place |
| whether an act is offered on a session's machine, and the sentence that closes its control | `disabledWords` (`src/shared/ipc/remote-unavailable.ts`), through the helper | `stack-acts.ts`, `SlashPalette.tsx`, `ForkWidget.tsx`, `InlineEdit.tsx`, the session menus, the side panels, the widgets | the stack through the labelled forms; `/fork` through `useForkUnavailable` |
| the sentence of an act that ended without its effect | `refusalWords` and `failureWords`, called by main (`src/main/lane-b/remote-outcomes.ts`) | the window shows `error.message` as it is (`said` in `stack-acts.ts`) | unchanged; two more commands have words |
| what the window knows of a session's machine | `remoteStandingOf` and `useRemoteStanding` (`lane-b/remote-standing.ts`) | the helper | `take-back.ts`'s one new condition |
| whether this Mac's serving engine host takes the command | `hostHasThisWire` (`src/shared/sessions/host-wire.ts`) | `composer/queue/host-wire.ts`, `stack-acts.ts`, `session/controls/lane-b.ts` | unchanged |
| whether a machine's draft store keeps a stage | `storeRefusesStage` and `useStoreRefusesStage` (`composer/queue/take-back.ts`) | `stack-acts.ts` | one condition inside it |
| what became of a message being taken back | `readRecord` (`take-back.ts`) | `take-back.ts` | unchanged |
| whether the card column is drawn, and for which session | `cardColumnNow` (`app/shell-view.ts`), through `useCardColumn` and `useCardColumnShown` | `app/Shell.tsx`, `panel/SurfaceRow.tsx`, `toggleSessionCards` | `btw-place.ts` |
| which session the floating card, its pill or the bar draws | `cardSession` (`shell/floating.ts`) | `shell/FloatingCard.tsx`, `shell/FloatingPill.tsx`, `panel/PanelHeader.tsx`, `main/Pane.tsx` | `btw-place.ts` |

### K. What a sibling reads from this landing, and what it consumes

Exposed: `SEND_NOW_CAPABILITY`; `remoteUnavailableAsOf`; `BtwCardFoot`, `btwPlace`, `useBtwPlace` and the attribute value `data-btw-card="foot"`, which a scene of any sibling that asks `/btw` beside a shown column now finds in place of `corner`; `answerWords`.

Consumed, each by the name it is exposed under: from U3a's document, `readAnswerEnvelope` (its Interfaces A and G). From U8b's, the slot `sessionCardFoot` and `useCardColumn` (its Interfaces C.1 and C.2). From U9's, the insertion list of its Interfaces 2, and `REMOTE_NEEDS`, `ACT_WORDS`, `disabledWords`, `refusalWords`, `failureWords`, `useRemoteUnavailableAs`, `useForkUnavailable` (its Interfaces 3 to 5). From U4a's, `QueueControls.sendNow`, `stackActs`, `Refusals`, `takeBack`, `storeRefusesStage`, `BtwCard`, `StackRow.answer` (its Interfaces D, G and L). Nothing of U6a's, U8a's or U13a's: this landing adds no key, no action id and no stored value.

## Size and review

Counted from the code at `63c97b5c0`; changed lines are estimates from the functions and the test blocks read, not from a diff.

| milestone | source | tests | scenes and docs | files |
|---|---|---|---|---|
| M1 | about 45 lines in 3 files | about 105 in 2 | — | 5 |
| M2 | about 70 in 4 (one new) | about 165 in 3 (one new) | — | 7 |
| M3 | about 80 in 12 | about 520 in 13 (one new) | — | 25 |
| M4 | — | — | about 370 in 3 specs and their support; about 30 in 3 documents | 7 |
| the landing | about 195 | about 790 | about 400 | about 42 distinct files, about 1,400 changed lines |

**The review rung** is the xhigh panel of `doperpowers:review-code`, on two grounds: the landing is past twenty files, and it adds a row to the offer table, which the root calls delicate ("U9's offers", UC-10). Its lenses: (1) the offer, checked where the act runs and on the value the act uses (Interfaces C), and that a peer without the capability is sent nothing; (2) the sequences over the link, with each test that holds a sequence open read as a sequence and not as a final state (Interfaces F); (3) one reading of each fact (Interfaces J): no second reader of the envelope, of a refusal or of the column's state; (4) the card's two mounts: drawn once in every state of the column, a split, a float and a page; focus, the inert column, the unseen dot; (5) the insertions in others' files against Interfaces I, and the guards that read source text. U9's keeper reads lens 1 and 5 against U9's own list (UC-7.6).

## Probes

None is needed for what this landing builds: every engine statement it rests on is recorded ("Engine facts").

One would be needed for what it leaves (Reported, 8), should the architect want it built: *on engine 2.1.322 under MAWS's launch environment, with a foreground shell command less than two seconds old (not yet a task): a `user` frame at priority `next` is written for a message M, as `session.queue.promote` at `next` writes it, and `interrupt { send_now: true, message_uuid: M }` is written at once after it. (i) Does the request wait for the task and move the command, in every run of five? (ii) With another message already waiting at the next step, are the two delivered as one? (iii) What does the request answer when it is written before the engine has queued M?* The default is written so that the answer changes one place: nothing is built, and `stackActs.sendNow` keeps `session.queue.promote` at `now` for a row that is not at the next step. If (i) holds, (ii) is yes and (iii) is never `nothing_waiting`, that one branch becomes a promote at `next` followed by the send-now, and the child's table changes its cell "that message alone goes now", which is the architect's to rule.

## Surprises & Discoveries

Found while reading the code for this document; each is where a later reader would otherwise look twice.

- The reader's class `answer` holds the structured answers and the whole envelope and neither a title nor words. Evidence: `readAnswerEnvelope` in `src/shared/engine/arrival.ts`; `AskAnswerSchema` in `src/shared/maws/tools.ts`. Hence decision 2.
- The foot slot stands under the last card, not at the column's bottom. Evidence: `SessionCards` in `panel/summary/Summary.tsx`. Hence decision 5.
- Taking back a next-step row on another machine has worked since pull request 650 with no code of this child's; what was missing is words, labels and a scene. Evidence: `OFFERS`, `REMOTE_NEEDS`, `take-back.ts`'s `setDraft` and `withdraw`.
- Both commands are on the wire already, so the landing takes a link minor and no wire minor. Evidence: `src/shared/ipc/wire-manifest.json`.
- U4b's own capability cannot say that a machine's draft store keeps a stage: build G keeps one and lists no `rl2.send-now`. `rl2.session-acts` can, by the order the two landings reached master. Evidence: the two builds' `capabilities.ts` and `drafts.ts`.
- Every engine-host act but a pane's answer resumes a released session first, the cancel included. Evidence: `engineAct` in `src/main/lane-b/remote.ts`. Hence decision 8 and Reported 4.
- The keys read the helper outside a render, and the helper's labelled form was a hook alone. Evidence: `refusalsNow` in `stack-acts.ts`; `lane-b/remote-unavailable.ts`.
- Once the command is offered, the renderer guard calls its two entries for it stale. Evidence: "declares nothing the code no longer needs" in `test/lane-b/renderer-guards.test.ts`.
- At the e2e window's width the card column is drawn in every scene with no side surface open, so a scene that asks `/btw` there finds the card at the foot. Evidence: `e2e/support/launch.ts` (1280 px), the default sidebar width (240 px) and `CARD_COLUMN_ROOM` (960 px).
- Claude Desktop's lines the child cites for these items still say what the child says: the side chat's waiting state (`web/app/v1/c9bd7af9c-DlJ4cmuC.js:21474` on), its place as a side pane (`c73f45bc3-CS022dPs.js:3484`), the take-back's restaging (`cc43287c9-CQ79M14o.js:86651` on), and the two sentences UC-7.5 follows (`i18n-web.json:4129`, `:17751`).

## Decision Log

- **2026-11-15 · The verification call.** This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets the xhigh panel of `doperpowers:review-code` ("Size and review" says why and names its lenses). Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, its review verdict and its residue; it carries no amendment of a reversed ruling, because this landing reverses none.

## Outcomes & Retrospective

Written at the landing.
