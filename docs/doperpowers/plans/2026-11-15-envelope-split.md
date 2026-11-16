# UX wave · ticket 704 · a joined answer is split where a message becomes an event (2026-11-15)

> **Parent:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md` (the UX wave's composite spec, its root), child **U4**, board ticket **704** ("A joined answer envelope is read as the person's text: split it where a user frame becomes the model's event"; the root's Tracking map lists it under U4, "for later"), parent pin master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`.
> **The statement of work** is the ticket's body, not a section of a child's file: its "What is left", "The fix this ticket asks for" and "Acceptance". In the root: the wave's laws (5 and 6 above all), UC-2 (the arrivals reader and X1's `arrival` field), UC-8, UC-10, UC-11, UC-14, and the Decision Log's line of 2026-11-15 on ticket 704.
> **Built on** the landing that found the fault, U4b, whose document is `docs/doperpowers/plans/2026-11-15-ux-wave-U4b-composer-integrations.md` (cited as *U4b's document*); its Decision Log's entries on the joined answer are built on, and four calls it added are removed here ("What this landing is built on").
> This document holds what the ticket does not: what the code holds at `ea51e3e8f`, the design the ticket left open, and the execution. Two points went to the wave's architect for ruling and an adversarial review found three faults; the architect ruled on all five on 2026-11-15 and the document was revised once to the rulings ("Ruled by the architect"; Decision Log).

## Purpose

When a person answers a question the agent asked without waiting, MAWS sends the answer to the model as a message of its own: an *envelope*, a first line `[MAWS ask <id>] The user answered the questions you asked:`, the answers in words, and a closing fenced `json` block. If that envelope and a message the person typed both wait for the engine's next step, the engine writes them to the model as ONE user message. Every place in MAWS that knows an envelope knows it only as a whole message, so the joined message was read as the person's own text, envelope and JSON included.

U4b repaired that where the transcript's model reads a user row: the bubble, Copy, Edit, the up-arrow history. After this landing the repair is made once, earlier, where the engine's frame or transcript line becomes a `user.message` event. A joined message is told as two things: the person's message, holding their own words and nothing else, and after it one message per envelope, each of the shape an envelope sent alone has today. Nothing downstream holds an envelope as the person's text, on any route, so U4b's four reader calls go. The surfaces U4b did not reach are right too: the text a rewind puts back in the box and its boundary's tooltip, the resume chooser's preview, the search text and its snippet, a session's title where it falls back to a later prompt, and the events a window of an older build receives from a host of this one.

A person sees no new thing. They stop seeing a line that begins `[MAWS ask` and a block of JSON in a title, a snippet, a preview, a prefilled box or a tooltip.

How to see it working: the unit tests named under each milestone, which run the probes' recordings through the real derivation on each route; in a running build, one scene of M3, which only a Mac run gives ("Proof that an executor does not run").

## Progress

- [x] (2026-11-15) The document written against `ea51e3e8f`; every reader of the ticket's list traced in code; eight points reported.
- [x] (2026-11-15) The adversarial review (three findings, all upheld) and the architect's rulings on A, B and the three; the document revised once to them.
- [x] (2026-11-15) The probes of "Probes" recorded and on the branch (merge `32c5a243d`): probes 1, 2 and 3 and the pasted-envelope case, thirteen recordings under `spikes/protocol-probe/fixtures/uxwave/u704-*`, findings `spikes/protocol-probe/findings-uxwave-u704-envelope-split.txt`. The stop condition is not met: every joined line's origin is `human`.
- [x] (2026-11-15) The architect's rulings on the probes' findings recorded in place ("Engine facts", "Probes", decisions 6 and 7, M1's and M3's tests; Decision Log).
- [x] (2026-11-15 UTC) M1 — One reading of a person's message, and the window that reads it once. Commits `6ad59e796`..`a29982f21`, fix `60af4bc4f`; task review clean.
- [x] (2026-11-15 UTC) M2 — The producers: the live wire, the file, another machine's rows, a rewind's text. Commits `5cc75f108`..`215b7d2c4`; task review clean.
- [ ] M3 — Outside the transcript: the search text, the resume preview, the title; the scene, the record, the last run.

## What this landing is built on

The branch `ux-wave/704-envelope-split` starts at `ea51e3e8fca0839c66ccd7ce7d3f0e186236953c`, the accepted head of `ux-wave/U4b`, which is not on master yet. This landing is built on a tree that holds U4b and lands after it in the chain (UC-10); its pull request opens when U4b is on master. If U4b's branch moves before then, this branch takes it by merge.

It keeps of U4b: the shared reader of envelopes inside a text and every rule its four reviews settled (an envelope opens only at the writer's whole first line; the shortest slice that reads whole, bounded by the next opening line; a pasted segment's body is data; a message with blocks that draw as attachments is never hidden), `askSteerOpening`, the stack's words for a waiting answer, and the recall's skip of a row that is an envelope alone.

It removes of U4b, because the model no longer holds a joined text:

| U4b's call | where | after this landing |
|---|---|---|
| `ownWords` and its call | `src/renderer/src/transcript/model/user-text.ts`, in `userTextOf` | gone; `userTextOf` reads its content as master does |
| `readAnswerEnvelopes` in `recordAskSteer` | `src/renderer/src/transcript/model/reduce.ts` | `recordAskSteer` reads one envelope from a whole text with `parseAskSteer`, as master does |
| `envelopesAnsweredHere`, `attachmentsAlone`, and their use in `answersHeldAsk` and `userRow` | `src/renderer/src/transcript/model/derive.ts` | `answersHeldAsk` is master's (`askSteerOf` with `askAnsweredHere`); `userRow` takes `userTextOf(event.content)` |
| `readAnswerEnvelopes` in `allAnswer` | `src/renderer/src/composer/editor/history.ts` | a row with no attachment whose text `readAnswerEnvelope` reads whole is skipped |

One call replaces the four in the window: the reducer's reading of a person's message as it enters (ruling B). It exists from M1, which is what lets M1 take U4b's calls out before M2 changes the producers.

From the documents of the other landings, by the names they expose: from U3a's, the arrivals reader `readNext` and `readArrivals` and its rules of reading (Interfaces A), what each class becomes on every route (Interfaces C), and X1's `arrival` field, which this landing reads and does not extend. From U13a's, the cross-build coverage table: this landing adds no row to it, because it stores no new key and adds nothing to the wire ("What is stored or sent"). From U4a's, `joined` on `user.message` and the reducer's `join`, unchanged. Nothing of U6a's (no action id), U8a's, U8b's or U9's (no act on the link, no capability, no minor).

## Words used here

A *member* is one waiting message as it was written. A *joined message* is the one user message the engine made of several members. The *envelope* is MAWS's own text for an answer (`askSteerText`, `src/shared/maws/ask.ts`); a *lone envelope* is one delivered as a message of its own, as today's code expects. The *person's part* of a message is what is left of its content once the envelopes are taken out. A *producer* is code that makes X1 events from what the engine wrote: the engine host's normaliser from the wire's frames (`src/engine-host/normalizer.ts`), and the backfill from the transcript file's rows (`recordToEvents`, `src/engine-host/fs/backfill.ts`), which also serves another machine's rows and the desk (`src/renderer/src/lane-a/plane-transcript.ts`) and the resume preview. A *window* is a renderer that holds a session's events. An *orphan* is an envelope whose ask the window does not hold. *Build G* is `2c7044231` (wire 3.46), the build in use; *build F* is `f1852de3a` (wire 3.33), kept as the build that can be gone back to. Whatever this landing stores or sends is stated against both.

## Engine facts

Every statement about the engine rests on a recorded line. Where none exists the row says so, and "Probes" says what must be recorded; the design depends on no unrecorded fact except where a row names its fallback.

| fact | recorded in |
|---|---|
| An envelope and a prompt waiting together are joined when the turn ends by itself (both orders, and a multi-line envelope) and on a Send now pressed before the running call is a task (both orders): 10 of 10. At a tool boundary inside the turn they are not: 4 of 4, each member its own replay and its own `queued_command` attachment under its `source_uuid` | `spikes/protocol-probe/findings-uxwave-u4b-envelope-join.txt`, "Verdict" 1 to 5; `fixtures/uxwave/u4b-env-end-*`, `u4b-env-two-*`, `u4b-env-two-late-*` |
| The joined text is the members in writing order with exactly one newline between, each member's bytes intact; nothing in the envelope changes that | the same file, "The joined form, byte for byte" |
| The joined message carries the LAST-written member's uuid. The first member also has a replay of its own text alone a few rows earlier, and no line in the file | `u4b-env-end-env-first-1.jsonl`: seq 518 (the envelope alone, its own uuid), 522 (`requesting` naming both), 524 (the joined text under the prompt's uuid); `u4b-env-end-prompt-first-1.jsonl`: 626 and 632 (under the envelope's uuid) |
| The joined replay on the wire carries `origin: {kind: "human"}` and `isReplay: true` | `u4b-env-end-env-first-1.jsonl` seq 524 |
| The engine's file holds ONE `user` line for a joined message, under the last uuid. Its keys are a lone prompt's plus one, `mergedSendUuids`; its `origin` is `{kind: "human"}`, its `entrypoint` `sdk-ts`, its `promptSource` `sdk`; its content is the joined text. The earlier member has its own replay on the wire and no line in the file | probe 1, 7 of 7 joined runs: `fixtures/uxwave/u704-end-env-first-{1,2}.transcript.jsonl` L46, `u704-end-prompt-first-{1,2}` L46, `u704-end-two-envelopes-1` L50 and `-2` L48, `u704-end-image-1` L46 and `-2` L44 (`spikes/protocol-probe/findings-uxwave-u704-envelope-split.txt`, "Probe 1"). The `u4b-env-*` files are a reduction of the line |
| The file's line of a joined message carries `mergedSendUuids`, the earlier members' uuids in order. The wire's replay of the joined message does not carry it and no event does | the same lines; the thirteen `u704-*` journals hold no such key (searched); a lone line (`u704-pasted-{1,2}` L3, every run's first prompt) has none |
| A lone envelope's line in the file carries `origin: {kind: "human"}`, `promptSource: "sdk"` and `entrypoint: "sdk-ts"` | `test/fixtures/transcripts/p1-maws-ask-async.jsonl` line 42 (engine 2.1.291) |
| A prompt typed at a terminal carries `origin: {kind: "human"}` too, on its `user` line and on the `queued_command` of one typed while a turn ran. What differs is the row's `entrypoint` (`cli`) and, on a `user` line, `promptSource` (`typed`); an event carries neither | `test/fixtures/transcripts/w1-terminal-queued.jsonl` lines 5 and 26 (2.1.283); `rewind-terminal.jsonl` |
| The engine's `last-prompt` row holds a message's text on one line (each newline a space), cut near 200 characters and closed with `…`; an envelope's is cut inside its result block | the same file, line 53 (2.1.291) |
| A `last-prompt` row is NOT written after every join: 3 of 7 joined runs wrote one (`u704-end-image-1` L59, `-2` L57; `u704-end-two-envelopes-1` L55), the four end-env-first and end-prompt-first runs none. When written, it is the joined text with each newline a space, cut near 196 characters and closed with `…` (envelope first: cut inside the result block). The rewind's own row is prompt first, 201 characters, and carries `explicit`, `rewound`, `cutUuid`. Nothing here states that such a row follows a join | `spikes/protocol-probe/findings-uxwave-u704-envelope-split.txt`, "Probe 1"; `u704-rewind-1.transcript.jsonl` L54 (2.1.322) |
| A rewind to a joined message answers the joined line's whole text as `prefillText` (prompt then envelope, byte for byte); `targetMessageUuid` is the joined uuid; the joined message is cut whole. The file after it holds the rewind's `last-prompt` row and the anchor prompt's line under the joined line's parent | probe 2: `u704-rewind-1.jsonl` seq 771 (the wire's `control_response`; seq 772 is the probe's meta row holding the same response); `u704-rewind-1.transcript.jsonl` L46, L54, L57 |
| An envelope waiting beside a prompt that carries an image joins as blocks: the envelope's text block, ending with the separating newline, then the prompt's own blocks unchanged (its text block, its image block); no block of its own for the separator. The file adds an `isMeta` `user` row after it naming the image | probe 3, 2 of 2: `u704-end-image-1.jsonl` seq 670, `.transcript.jsonl` L46, L47; `u704-end-image-2` seq 720, L44, L45. Document blocks are not recorded; decision 7 holds for any block |
| Two envelopes waiting with no prompt join into one line: envelope 1, one newline, envelope 2, each intact, under the SECOND envelope's uuid (`mergedSendUuids` names the first); the first is replayed alone under its own uuid | probe 1, 2 of 2: `u704-end-two-envelopes-1.jsonl` seq 756, 761, `.transcript.jsonl` L50; `-2` seq 818, 823, L48 |
| A prompt whose whole text is an envelope for an id no ask has lands as an ordinary prompt line (`origin` human, `entrypoint` `sdk-ts`, `promptSource` `sdk`, no `mergedSendUuids`); nothing marks it apart from a real answer's line | `u704-pasted-{1,2}.jsonl` seq 29, `.transcript.jsonl` L3 |
| A non-blocking ask's call is answered `{status: "asked", askId: <the call's tool-use id>}`; the answers reach the engine as the envelope, and the host journals a meta row `maws_ask_answered` | `fixtures/pass3/p1-maws-ask-async.jsonl` seq 104, 105, 120, 122 |

The envelope's bytes are MAWS's own and do not change here: `askSteerText` writes what it writes today.

## Today, at `ea51e3e8f`

A person's message becomes an event in three places. The normaliser emits MAWS's own write of each member (`userOut`), drops the engine's replay of it as an echo, and emits the replay that holds several members as one message with `joined` (the other members' uuids). The backfill emits one message per `user` row of the file and per `queued_command` attachment of a human prompt. The reader of another machine's rows emits one for an input the session never read (`undoneEvents`, `src/renderer/src/lane-a/source/off-chain.ts`). All three put the engine's text into `content` as it is. The reducer records an envelope's answers before it decides where the message goes (`recordAskSteer`), and derive draws no bubble for a message whose capsule took the answers (`answersHeldAsk`); U4b made those two and `userTextOf` read envelopes inside a text.

The ticket's list was a static reading taken before U4b's second step. Traced at this head:

| reader (the ticket's order) | what it reads | at this head, for a joined message | outcome |
|---|---|---|---|
| 1. an engine mod's UserMessage renderer | `userInput` (`transcript/surface/adapters.ts`) gives the site `row.text`, the derived row's text; it reads the event for its origin only | already the person's words, through U4b's `userTextOf`. **The list was wrong here** | no edit. After M2 the event's content is the person's part itself. Pinned (M2) |
| 2. the hook-refusal Edit prompt | `initiatingPrompt` picks a derived row; `rowPrefill(row)` | already right. **Wrong in the list** | no edit; pinned (M2) |
| 3a. the rewind picker's line | `typedFromRowText(row.text)` (`widgets/RewindWidget.tsx`) | already right. **Wrong in the list** | no edit; pinned (M2) |
| 3b. the rewind prefill | the outcome's `prefillText`, the engine's own text (`src/engine-host/rewind.ts`) | the joined text whole, by the engine's code | M2: the person's words (`personsWords`), no prefill when none are left |
| 3c. the rewind boundary's tooltip | `boundary.rewind.prefillText`, drawn as the row's `title` (`view/rows/Boundary.tsx`). Live it is the engine's answer (`normalizer.ts`); from the file it is the anchor row's `lastPrompt` (`fs/chain-follower.ts`), the one-line form | raw on both; and **the one-line form can never be read by a reader of whole envelopes**, which the list did not know | M2: `personsWords` on the live route, `flatPersonsWords` on the file's |
| 4. the stack's "handed" row | `unread.text` is the derived row's text (`composer/queue/stack-acts.ts`), worded by `answerWords` when it is one whole envelope | already right. **Wrong in the list** | no edit; pinned (M2) |
| 5. the search index and its snippet | the worker of `src/engine-host/fs/search-text.ts` reads raw rows; `src/services/index/session-search.ts` stores and cuts the snippet | joined texts and lone envelopes are indexed whole. The worker runs from a source string and can import nothing, which the list did not know | M3 (decisions 8 and 11; ruling A) |
| 6. the resume chooser's preview | `recentTurnsOf` maps rows through `recordToEvents` and takes the first prompt text of a turn (`src/services/sessions/recent-turns.ts`) | a joined text raw; a lone envelope whole | a joined message: right after M2 with no edit there (the person's message is the first event). An envelope alone: M3 (ruling A) |
| 7. `/export` | `export_conversation`'s text, written as the engine produced it (`widgets/ExportWidget.tsx`) | holds the envelope | not changed (decision 13) |
| 8. the title, the title search, the desk's titles | `summarize` (`src/engine-host/fs/summarize.ts`): the head's first user text, else the earliest `last-prompt` the windows hold; stored as `first_prompt` | the fallback is the one-line form. **The list missed the first source**: when the session's first prompt has no words (an image alone) the next user text is taken, which can be an envelope | M3: both sources pass the person's words only |
| 9. an anchored comment joined with an envelope | `userTextOf` runs `ownWords` before `readAnchoredMessage` | **not a fault at this head**: the envelope is out before the anchor's reader runs; untested | no edit; after M2 the content is the member's own bytes. Pinned by a join made by hand in the recorded form (no recording holds an anchored comment) |
| 10. `personsText` | it is in `src/shared/engine/arrival.ts` (the list names `backfill.ts`); it reads a whole text | yields nothing for a joined text. No caller acts on the class for MAWS's own envelope: both producers filter it out and the reader of rows treats it as the person's | M1: one `answer` per envelope found (the reader's rule 3), with no caller's events changed |
| *not in the list* | the undone input of another machine's rows (`typedPrompt` and `undoneEvents`, `lane-a/source/off-chain.ts`), a third maker of `user.message`, with `origin: null` | a joined row drawn "Not read" holds the raw text | M2: its message passes the same split as every other |
| *not in the list* (the review's finding 3) | `describe` in `src/renderer/src/sessions/RenameDialog.tsx` reads `session.events`, takes the first user text with words and sends it to `session.generateTitle` with `persist: true` | a lone envelope after a first prompt with no words, or an older host's whole joined event, becomes what the title is generated from | M3: the person's words; an envelope alone is passed over |
| *not in the list* | the owner's service reads answer lines from a prompt's text (`src/services/owner/service.ts`, `prompt`) | scans the joined text whole | right after M2 with no edit: it reads events |

Unchanged readers, each right as it is: the stack's reading of a message still in MAWS's queue (`readAnswerEnvelope`, one member by construction), the held tail (`TranscriptSlot.tsx`) and the `uncertain` row, whose tracker rows stay.

**Every other reader, searched once more** (ruled after the review: `git grep` for `'user.message'`, for `session.events` and `fs.agentEvents`, and for a `user` row's type, over `src` and `apps`, tests and the transcript's model left out). A reader of a `user.message`'s content, or of a `user` row's text, that is not in the table above:

| reader | what it reads | outcome |
|---|---|---|
| `commandInput` in `transcript/surface/adapters.ts` | the user messages before a command's output, for a line that begins `/` | no edit: an envelope's event never begins so, and a person's part is their own text |
| the arrival sites of the same file; `tools/agents/model/task-graph.ts` | synthetic carriers; a peer's hand-back | no edit: neither reads a person's message |
| `tools/agents/model/relay.ts`, `relay-store.ts` | a child agent's messages, for a relay's text | no edit: an agent's lane holds no envelope |
| `composer/submit/human-prompt-delivery.ts` (and `side/card/delivered.ts`), `transcript/source/ipc.ts` (`promptOf`), `services/sessions/setup-steps.ts` (`newestUserUuid`) | a message's uuid, never its content; the first stops at the first replay | no edit: the envelope's event shares the uuid and comes second |
| `stores/store-diagnostics.ts` (`eventDetail`) | an event's content as a line of the diagnostics dump | no edit: it shows what the event holds |
| `computer-use/reading.ts`, `lane-a/source/interrupt.ts`, `lane-a/stream/overlay.ts`, `withWaitingWords` in the backfill | the interrupt's marker and the cut reply, by origin | no edit |
| `services/sessions/recovery.ts`, `resume.ts`, `setup.ts` | a first message about to be sent, not an event | no edit |
| `services/sessions/launch-watch.ts`, `resync.ts`, `shared/host/stream-catchup.ts`, `main/lane-b/remote-history.ts` | carry events and read no content | no edit |
| `apps/desk-hub/deploy/vm/*.mjs` | a deployment check looking for its own prompt | no edit |
| `firstUserText` in `src/engine-host/fs/subagents.ts` | a child agent's first row, the parent's words to it | no edit |
| `main/lane-a/remote-state.ts`, `shared/engine/sminos-delivery.ts`, `ask-delivery.ts`, `services/lane-a/jobs.ts`, `services/owner/prompt-state.ts` | a row's marks, uuid or a plugin's row | no edit |
| `personNames` in `src/shared/files/named.ts` (U6's rule of a file the transcript names) | a `user` row's text, for a link or an anchor that names a path | **not changed, and stated for U6's owner**: an envelope in a person's row can name a path, lone or joined, today and after. It holds only the question's own strings, which the call's row already names (`anyStringLinks` over the call's input), and the person's typed answers. The window draws no bubble from an envelope after this landing as before it for a lone one; whether the rule should pass over an envelope is U6's question |

No reader of a message's content is in `src/main`, in the attention services or in the desk hub's source.

## Decisions settled at authoring

1. **The split lives where an event is made, in one function.** `splitPersonsMessage` (Interfaces C) takes a `user.message` as a producer is about to emit it and returns the messages to emit in its place. Each producer passes every `user.message` it makes through it: the normaliser at its emitter, the backfill at the end of `recordToEvents`, so the file, a gap's reseed, another machine's rows, the desk and the resume preview all pass; the undone input's message passes it too. *Why here:* it is the last place that still holds the row's own marks (decision 5) and the first where every reader after it is served at once, the readers outside a window included (the preview, the owner's service, a window of an older build). *The strongest alternative* is the window's ingest alone, with the producers untouched: one call, and it also reads what an older host made. It lost because it is the per-reader pattern moved up one step: every reader of events outside a window still needs a call of its own, and a window of build G or F on a host of this build stays wrong. Its one strength is kept by ruling B.

2. **The envelope is an event of its own, of today's shape; no field.** For a joined message the producer emits the person's message and then, for each envelope, a `user.message` whose content is the envelope's text, byte for byte. *Why:* a lone envelope is already this event, so every build knows what to do with it. This build's reducer and derive go back to master's code for an envelope; build G and build F record its answers and draw the person's words, with no change to them; no key, kind, type, wire minor or manifest entry is added (the wave takes no minor it does not need). A message of envelopes alone needs nothing special: each is its own event. *The strongest alternative* is an `answer` entry on the person's message in `arrival`, which also needs no minor (build G ignores the entry on a message that is not synthetic, build F drops the key). It lost on three counts: no older build would record the answers from it; a message of envelopes alone has no person's message to carry it, so a second shape would be needed; and this build would keep two readings of an answer, the field's and the text's, where one remains.

3. **Its uuid, its id, its place.** The envelope's event carries the SAME `messageUuid` as the person's message and comes directly after it. *Why the same uuid:* all three builds' reducers record an envelope's answers before they drop a second message under a uuid already placed (`recordAskSteer`, then the `index.messages.has` return: `reduce.ts` at `f1852de3a` lines 573 to 575, at `2c7044231` lines 704 to 707, and here), so the envelope answers its ask and places nothing: no bubble, no turn. A uuid of its own would open a pending turn on the file route, which has no lifecycle for it; a synthetic message is never read for an answer. That order is now a contract, pinned by a test. The event's `isReplay` and `origin` are the message's. `joined` and `arrival` stay on the first event emitted. Ids are the producer's own: the live emitter's next ordinal for the row; from the file `<uuid>#<n>`, the ordinals after every event the row already makes, so no existing id moves. A message that is one lone envelope is returned as it is (the same object). A message of several envelopes and nothing else becomes one event each, the first keeping `joined`. The same events are emitted on the live route, where the envelope's own write already recorded the answers: the routes stay equal, and a window that begins after that write still gets them.

4. **What addresses the message afterwards.** The person's message keeps the engine's uuid for the line, so a rewind and Edit address what the file holds, and `joined` still names the other members, so the reducer's `join` puts it where the first member stood, as today. The search text has no address and loses only the envelope's text. The resume preview takes a turn's first prompt, which is now the person's.

5. **One gate at every maker, and it does not tell who typed.** (Revised 2026-11-15 to the architect's ruling on the review's first finding; the first draft's claim that a prompt typed at a terminal is never split was false.) The split reads a message that is not synthetic, has no `bash` part, has a uuid, and whose `origin` is `human` or null. That is what the readers outside the transcript already take as a person's message (the resume preview and the owner's service test exactly this), and it is the gate inside `splitPersonsMessage`, so the normaliser, the backfill, the undone input and the window's ingest apply the same one. The gate tells a person's message from what is not one: a synthetic message, a command's output, a coordinator's or a peer's message, a shell line. It does not tell who typed it. A prompt of human origin that holds a whole valid envelope (the product's exact opening sentence for an id, and its closing block) is split wherever it was typed, at a terminal too: a terminal's prompt carries `origin: {kind: "human"}` as MAWS's own steer does (`w1-terminal-queued.jsonl` lines 5 and 26), and `steeredPrompt` gives its queued form the same event. The envelope's text leaves the person's bubble; it is read as that ask's answer where the session holds the ask, and is not drawn where it does not. U4b's readers already behave so. *Null counts as a person's* because the makers write it for one: the backfill lowers every origin that is not `human` to null on the branch that makes a plain prompt, where a row of an engine that wrote no origin object also lands; `undoneEvents` writes null for an input it has already judged the owner's (`ownerInput`); and a prompt a hook blocked, and a command a person typed at a terminal, are emitted with null (the last is the person's own line and holds an envelope only if they typed one into it). An origin that names something else (`peer`, `task-notification`, `local-command`, `coordinator`, the markers) is never split. *Provenance is not read:* what would tell MAWS's own steer from a typed prompt is the row's `entrypoint`, which the file's rows carry and events do not; a tracker row says what reading it would take (M3).

6. **By the text, on every route.** On the live route the members are known and the envelope could be cut by its length. The file has one line and no members, and a session must draw the same before and after a reload, so the text is read on both, by U4b's reader (U4b's document, the ruling "form (b) by the text"). *Not by `mergedSendUuids`* (the architect's ruling on the probes, 2026-11-15): the file's line of a joined message names its earlier members, but the key exists only in the file. A gate by it would give the file route and the live route different events for one message, and the window's reading of a message as it enters (ruling B) could not tell this build's unsplit message from an older host's without a new mark on the event, which is a wire change this landing does not take. This landing does not read the key; M3's provenance tracker row names it beside the row's `entrypoint`.

7. **Blocks.** Each text block is read by itself; a block left empty goes, and a block that held an envelope and nothing but white space beside it is a block left empty; every other block stays, in place and unchanged, with the person's part. So a message of an envelope and an image becomes the image alone and the envelope's event, which is what U4b's `attachmentsAlone` drew. The recorded join of an envelope and a prompt with an image (probe 3) is that case: the envelope's text block ends with the separating newline and goes, and the prompt's text block and image block stay as the engine wrote them. An envelope that spans two blocks is not read; the writer makes one text, and every recorded join holds each envelope whole in one text block.

8. **The reader's slicing is one function that uses its arguments alone.** The search text's worker is built from a source string and runs functions from their own source (`isMadeUpFinalAnswer`, `fingerprint`). So U4b's slicing moves, unchanged in what it does, into `envelopeSlices`, which takes the opening line's writer, the pasted segment's pattern and the check of a whole slice as arguments; and the envelope's own checks without the answers' schema become `answeredBlock`, which `parseAskSteer` reads through, so the two cannot drift (Interfaces A, B). The window and the producers check a slice with `parseAskSteer`; the worker with `answeredBlock`. They differ only for a slice whose block names its ask and status rightly and fails the answers' schema, which MAWS never writes. *The alternative*, a second, simpler reader for the worker, lost: it is the drift U4b's third finding was about.

9. **The engine's own copies of a message's text.** A rewind's whole text passes `personsWords`. The one-line form (`last-prompt`: the title's fallback, the file route's rewind tooltip) passes `flatPersonsWords`: everything from the envelope's opening sentence on is dropped, and what stands before it is the person's words. *Why so blunt:* the form is cut near 200 characters and an envelope is longer than that (its opening line, one answer and its result block with a real tool-use id twice), so in this form an envelope never ends and nothing after it survives the cut.

10. **A person's message is read once more where it enters a window** (ruling B), so a message an older build's host made is split too.

11. **Outside the transcript an answer reads as nothing** (ruling A).

12. **`personsText` gives one `answer` per envelope.** The reader's rule 3 (one carrier, several arrivals). Both producers go on filtering the class out for MAWS's own envelope, so no event changes because of it.

13. **Not changed.** `/export` is the engine's own record of the conversation, written as produced; the envelope is part of what the model was told, and MAWS draws nothing of it. The envelope's bytes. The held tail and the `uncertain` row (tracker rows of U4b). The desk's tail of sends, whose match of a joined steer U4b's table marks "not checked": the desk's own.

14. **Tests run what was recorded through the real derivation.** A recorded journal goes through the normaliser; a recorded transcript file through the chain follower; the same rows through the reader of another machine's rows; an older build's events are the frozen output of build G's producers for the same recordings. A case no recording holds is made by hand in the recorded form and says so in its name. The ask's call is the recorded one (probe 1), never staged by hand.

15. **No wire minor, no manifest change, no stored schema change.** `src/shared/ipc/wire.test.ts` passes with no generated file touched; if it does not, something reached the wire by mistake and the executor stops.

16. **One scene.** `e2e/composer.spec.ts`, beside "U4b, a waiting answer" (M3).

17. **The split reads the person's part again until a reading takes nothing out.** One reading can leave a part that still holds a whole envelope: where an envelope's lines stand inside another envelope's text, the reader bounds the outer one out at the inner one's opening line, takes the inner one, and what is left pairs into the outer one. `splitPersonsMessage` therefore reads the part it would return again, and returns only parts that hold no whole envelope beside other content. It ends because every reading that takes something out shortens the part by at least an envelope. So a producer of this build, the window's ingest of an older host's raw message, and the ingest of this build's own events give the same events in the same order, and the split of any event it returned is that event (ruling B's exception, met inside the one function).

## Ruled by the architect (2026-11-15)

**A. What an answer reads as outside the transcript: nothing.** The search finds nothing for an answer and the resume preview shows nothing for it; a turn opened by an envelope alone has no prompt there and shows the agent's reply and its count of tool calls. The one place is `answerOutsideTranscript` in `src/shared/engine/persons-message.ts`, which returns the empty string; the search text, the preview and the Rename dialog's description call it and nothing else decides. Text an older build already stored in the index keeps its envelopes until that transcript is read whole again; this landing forces no re-read.

**B. This build's reducer applies the same split once where events enter.** A host of build G emits a joined message whole on both routes, and a host of build F emits it whole from the file; such events reach a window of this build from a machine not yet updated, or from a host that outlived an update of the app. The window reads them with the same function, so nothing U4b made right goes raw again in any pairing of builds, and the model below that one call is master's. *Its known exception, part of the ruling:* where an envelope's lines stand inside another envelope's text, a second read can expose an outer envelope the first read bounded out, so such a text is split in two steps. That is accepted. A test pins that the result is the same in every window and that ingest ends: no event is produced from a part that holds no whole envelope (decision 17 says how the function meets both). The one place is the call of `splitPersonsMessage` in `src/renderer/src/transcript/model/reduce.ts` (Interfaces E). It exists from M1.

**The review's first finding: the gate.** Decision 5, in the ruling's words. The guarantee for a terminal's prompt is withdrawn; one gate at every maker, the undone input included; two cases added (a terminal's queued prompt holding a literal envelope, an undone input holding one); one tracker row for provenance; probe 1 states the joined line's `entrypoint`.

**The review's second finding: the reader's shape.** `readAnswerEnvelopes` keeps its answer, `{ envelopes, rest }`: `arrival.test.ts` compares the whole result in nineteen places and passes unedited. A caller that needs a slice's bytes calls `envelopeSlices`, which gives each member's text with what was read of it in the same pass; `personsParts` and `personsText` are served so, and no caller needs a second pass. `texts` is dropped (Interfaces B).

**The review's third finding: a missed reader.** The Rename dialog's `describe` ("Today"; M3), and the search made once more, whose list is in "Today".

## Reported to the architect, with what is built

**C. Three things a person can read differently from U4b's head, all in corners.** (1) An orphan envelope. U4b drew the raw text of a message of several envelopes when one was an orphan, and the raw text beside an image when the envelope beside it was one. Now an orphan is drawn only when it is the first event of its message (as a lone orphan is); otherwise nothing is drawn of it. An orphan exists only in a window that holds part of a session's history, and is read again when the older page arrives. Two expectations of `joined-answer.test.ts` change for it. (2) A rewind's prefill and tooltip from an older host stay raw, as on master; U4b did not change them either. (3) Ruling B's exception: a text where an envelope's lines stand around another envelope. U4b kept the outer one in the bubble as the person's words (its finding 4); now both leave the bubble and each answers its ask where the session holds it. The case of `history.test.ts` that pinned U4b's reading ("recalls a row as the bubble shows it, even where its text read again would pair fragments into an envelope") changes to it.

**D. The file route cannot be tested on what was recorded today.** The `u4b-env-*` fixtures keep the engine's file as a reduction, so no row of a joined message can go through `recordToEvents` as the engine wrote it, and the ask in them was invented, so no recording holds an ask's call beside its joined answer. "Probes" says what to record. No executor starts before probe 1 is on the branch.

**E. The ticket's list** ("Today", the table). Four of its readers take the derived row and were right since U4b's second step (1, 2, 3a, 4); one is no fault (9); one is in another file and has no caller that acts on it (10). It missed five things: the one-line form of `last-prompt`, which no reader of whole envelopes can read; that the search's worker can import nothing; the title's first source; the undone input of another machine's rows; and the Rename dialog's description.

**F. Found, not built: ticket candidates for the architect.** None is built here; each has the evidence at hand.
1. *Edit, or a rewind, on a joined message takes the answer out of the model's context while the capsule still reads Answered.* The engine holds the person's words and the envelope as one message under one uuid (the findings file: one `user` line under the last uuid). Edit starts from `rowPrefill(row)` and its Send rewinds to the row's uuid and resends the prefill (`startInlineEdit` in `composer/resubmit-seam.ts`); the rewind picker lists the joined row (`rewindTargets`). The prefill is the person's words (U4b; here too), so the envelope is not sent again. The answers recorded for the capsule live on the ask's turn (`askSteers`, `reduce.ts`) and nothing removes them at a `boundary.rewind`; the host's ask is answered. It exists at U4b's head and for any rewind past a lone envelope; a joined message makes it one press. Not run.
2. *MAWS's consent message joined with a waiting prompt.* `consentOf` (`src/shared/engine/arrival.ts`) reads a consent only as a whole text, from its first word to its last, and the normaliser treats it as the person's prompt or steer (`userOut`). If it can wait at the next step beside another message, the engine joins them as it joins any two (`u4p3-end2-1`, `u4b-two-1`) and no reader knows it: the sentence is drawn in the person's bubble and its one line is not. No sender of `consentMessage` is in this tree (U1's landing sends it), so whether it can wait beside another message is not traced. `personsParts` is where it would be read.
3. *`initiatingPrompt` after a turn opened by an envelope alone.* It takes the newest own prompt among the derived rows of a human turn (`request-card/initiating-prompt.ts`). A turn that an envelope alone opened draws no user row once its capsule took the answers (`answersHeldAsk`), so a hook's refusal in that turn finds an earlier turn's prompt, and "Edit prompt" would edit and rewind to that one. Read in code; not run.
4. The desk's tail of sends (decision 13), and U6's rule of a named file ("Today", the last table).

**G. The record.** X1's schema does not change, but its derivation gains a rule. A dated line in the charter at X1 is recommended, carried by the pull request (M3 gives the sentence); the architect is the writer of record.

**H. The desk's web app.** One new test file there (M3), a named insertion that goes to the coordinator first; no source file of the app is edited.

## What a person sees, and whether the owner needs a drawn example

No. Nothing is drawn that is not drawn today, no word is added, and what goes is text that was never meant to be seen (ruling A: an answer reads as nothing outside the transcript).

## Routes (law 5)

| route | what makes the events | this landing |
|---|---|---|
| a session MAWS runs, live | the normaliser, in the engine host of the build that serves it | M2 |
| the same session read from its file (a reload, an exited session, an older page, a gap's reseed) | the backfill | M2 |
| a terminal session | the backfill | no envelope arises on this route: MAWS's ask is served only to a session MAWS runs. The split runs here as everywhere: a file a session MAWS ran left behind is split whichever way it is read, and so is a prompt typed at a terminal that holds a whole valid envelope (decision 5) |
| another machine, drawn from its rows (and the desk) | the backfill, run in the window on the rows the machine sends | M2: right whatever build that machine runs, since the rows are the engine's own |
| a session MAWS runs on another machine | that machine's host | right at the window whatever build that machine runs (ruling B); at the source once it runs this build |

## What is stored or sent (UC-14)

This landing adds no key, column, event kind, property, command or capability, and changes no version. It changes the content of values that exist.

| value | this landing | build G (`2c7044231`) | build F (`f1852de3a`) |
|---|---|---|---|
| `user.message` events for a joined message, sent to a window on this Mac or over the link | the person's message, then one message per envelope under the same uuid (decisions 2, 3) | records the envelope's answers and places nothing more; draws the person's words. Today it draws the joined text raw and, from the file, leaves the capsule unanswered | the same. F does not know `joined` and its tolerant reader drops the key, so on the live route the members stay as they were written, as with a host of build G today; the split-out events record and place nothing |
| the same events as this build receives them from an older host | read once more at the window (ruling B) | emits the joined text whole, live and from the file | emits it whole from the file; live, its normaliser drops the joined replay (`normalizer.ts` at `f1852de3a`, lines 414 to 417) and the members stay apart |
| `boundary.rewind`'s `prefillText`, and the rewind outcome's | the same key; the person's words, or null | shows what it is sent | the same |
| the search text's pages (`fs.sessionText`) and the stored index (`session_text_chunks`, `session_text_state`) | the same shape and the same checkpoint; text this build reads holds no envelope | reads this build's stored text as its own; what it reads later it stores with envelopes whole | the same |
| `session.recentTurns`' answer | the same shape; a turn opened by an envelope alone has `prompt: null`, a value the schema already has | shows such a turn without a prompt line | the same |
| the session summary's `firstPrompt`, stored as `first_prompt` | a string as before | overwrites it with its own reading at its next summary | the same |
| the journal, the engine's file, the envelope sent to the model, both settings files, the layout | not written differently | — | — |

A run of this build, then build G or F on the same profile, then this build again: the index holds text read by each, by byte range, and nothing fails; where this build's summary finds no words for a title it keeps the stored one (`summary.firstPrompt ?? existing.first_prompt`), so a title an older build stored from an envelope can stay until the session's summary yields words. No key is written, so the cross-build coverage table gains no row.

Nothing here awaits anything: the split is a pure function called where an event is made or reduced, in the same step, and the search's resumable pass keeps its checkpoint as it is (M3 pins a pass resumed across the joined line). Nothing new is served to a remote caller: the events a link carries are of the kinds and shapes it carried, with less text in them.

## Probes

The architect arranges them; this is what each must record. Engine 2.1.322, MAWS's launch flags, environment and permission mode as U4b's second probes took them (`scenarios/pass3/uxwave-common-send-permission.mjs`), invented content only. The names below are the ones this document uses; if the probe names its files otherwise, its findings file gives the mapping.

**Recorded 2026-11-15** (merge `32c5a243d`; `spikes/protocol-probe/findings-uxwave-u704-envelope-split.txt`; scenario `scenarios/pass3/uxwave-u704-envelope.mjs`). Engine 2.1.322, each case twice unless named: `u704-end-env-first-{1,2}`, `u704-end-prompt-first-{1,2}`, `u704-two-late-env-first-{1,2}` (the control), `u704-end-two-envelopes-{1,2}` (probe 1); `u704-rewind-1` (probe 2); `u704-end-image-{1,2}` (probe 3); `u704-pasted-{1,2}` (the review's pasted envelope). Each is a journal and the engine's file whole, `<name>.transcript.jsonl`; the ask is real. What they show is in "Engine facts". The stop condition below is not met: every joined line's origin is `human`, and the two envelopes join in the form the reader reads. What each probe was asked to record:

**Probe 1, required before M1: the joined answer with its ask, the file kept whole.**
- *The ask is real.* The session's first turn has the model call a non-blocking ask on an SDK MCP server named `maws`, served by the harness (`spikes/protocol-probe/sdk-mcp.mjs`), whose `ask` tool answers as MAWS's does: one text block holding `{"status": "asked", "askId": <the call's tool-use id>}`, the id taken from the request's `_meta["claudecode/toolUseId"]` (the recorded form: `fixtures/pass3/p1-maws-ask-async.jsonl` seq 104 and 105). The envelope is built at run time by the repository's `askSteerText` for that id and written as `answerAsk` writes it (a `user` frame, origin human, priority `next`), followed by a meta row `maws_ask_answered` of the host's form (the same fixture, seq 122), so the journal reads as a host's.
- *Cases, each twice:* `u704-end-env-first` and `u704-end-prompt-first` (both wait while the model only writes; the turn ends by itself); `u704-two-late-env-first` (the control: both written once the running call is a task); `u704-end-two-envelopes` (two asks, both answered, no prompt: whether they join, and under which uuid).
- *Kept per recording:* the journal as U4b's probes keep it, every replay whole; and beside it `<name>.transcript.jsonl`, the engine's file with every line as the engine wrote it (the form `loadUxwaveTranscript` reads).
- *The findings file states,* from those files: the joined `user` line's keys, its `origin` and its `entrypoint` (and `promptSource`, if the line has one); a `last-prompt` row written after a joined message, whole, where one is written (3 of 7 joined runs wrote one); for the two envelopes, the joined text and its uuid.

**Probe 2, required for the rewind's two statements.** In one more run of `end-prompt-first`, after the joined turn has ended: `rewind_conversation` to the joined message's uuid, written as `src/engine-host/rewind.ts` writes it. Kept: the response whole (`prefillText`, `targetMessageUuid`) and the file after it (the anchor row). Name: `u704-rewind`. Recorded (`u704-rewind-1`): M2's two rewind cases run on it.

**Probe 3, optional.** An envelope waiting beside a prompt that carries an image block: whether they join, and the joined content's blocks. It settles U4b's "unknown"; decision 7 holds either way. Recorded (`u704-end-image-{1,2}`): they join, and the image case runs on the recording.

If probe 1 shows a joined line whose `origin` names something other than `human` (the gate reads `human` and an absent one alike), or two envelopes joined in a form the reader does not read, the executor stops before M1 and reports.

## Acceptance

Over the recorded joins: the ten of `u4b-env-*` (the live route only: their file is a reduction) and probe 1's (every route). "The prompt" is the recording's prompt member, "the envelope" its envelope member, both taken from the frames MAWS wrote in that recording.

1. **The events, live.** The normaliser's events for a joined recording hold one message of the person's under the last-written uuid whose content is exactly the prompt, `joined` naming the other member; directly after it, under the same uuid, one message whose content is exactly the envelope; and no `user.message` that holds text of both.
2. **The events, from the file and from another machine's rows.** The chain follower over the recorded file's bytes, and the reader of rows over the same rows, give the same pair for the joined line, with the file's ids and no `joined`.
3. **The person's message.** On each route the model draws one user row for the joined message, under the last-written uuid, whose text is exactly the prompt. Copy on it, Edit's prefill and the up-arrow's entry are the same text. No user row, copied text, prefill or recall entry of the session holds `[MAWS ask` or the envelope's fence.
4. **The capsule.** With the recorded call, the ask's row reads answered with the envelope's answers on each route; in the recording of two envelopes, both asks do.
5. **The control.** For the recordings the engine did not join, the events and the rows are what they were before this landing: equal to the files frozen at M1's start.
6. **An older build's events** (ruling B). Build G's events for the same recordings, from the journal and from the file, draw as 3 and 4 in this build's window. For a text where an envelope's lines stand inside another's, the window's events are the same whether the message came raw from an older host or split by a host of this build, and no part it holds would be split again.
7. **An older build receiving this build's events is unaffected.** No file under `src/shared/ipc` that the wire's manifest test generates changes, and `WIRE_MINOR` is untouched. Each event of 1 and 2 parses under X1. The envelope's event follows the person's under the same uuid, and `parseAskSteer` reads its content whole. The split returns each event this build's producers made of the recordings as it is (the same object).
8. **The surfaces the ticket lists.** For a recorded join: the UserMessage site's `text` prop is the prompt; the hook-refusal Edit prompt prefills the prompt; the rewind picker's line is the prompt's first line; the rewind's prefill is the prompt and the boundary's tooltip holds no envelope, live and from the file; a "handed" row reads the prompt; an anchored comment joined with an envelope keeps its anchor and its frame. A terminal's queued prompt that holds a literal envelope, and an undone input that holds one, are split as decision 5 says: the envelope's text is not in the person's row, it answers its ask where the session holds the ask, and it is not drawn where it does not.
9. **Outside the transcript.** The search text of the recorded file holds the prompt and nothing of the envelope; the resume preview's turn for the joined message has the prompt as its prompt, and a turn opened by an envelope alone has none; a session whose title falls back to a later prompt is never titled with an envelope's words; the description the Rename dialog sends to `session.generateTitle` is a person's words, never an envelope's.
10. **The whole.** `pnpm typecheck`, eslint on the changed files, the script tests and the whole unit suite pass on the build VM but for the known set the build brief lists.

In a running build (the architect's run): the scene of M3.

## Constraints that bind every milestone

- The wave's build brief binds as written. On the machine that holds the worktree: no typecheck, eslint, vitest, install, build or Electron. Every check runs on the build VM in a checkout of the pushed head, under a time limit, with the helper's own exit status.
- Master is taken by merge, never rebase; nothing is force-pushed. Every commit message ends with the build brief's `Sminos-Session:` line and carries no other attribution.
- UC-11: fixtures, tests and comments hold invented content only; a recording's content is the probe's own invention. No path of a home directory, no account, no machine's name.
- UC-2: the reader stays pure and imports nothing from the renderer or the engine host. The split is by the text, behind one gate (decision 5).
- UC-8: every edit in a file another child owns is one of the insertions of Interfaces I and nothing more.
- UC-14: no stored key, no version, no settings change (decision 15).
- Law 6: no code depends on an engine fact that "Engine facts" marks unrecorded, but through the fallback its row names.
- The tokens guard reads renderer source: a ticket is written in words there ("ticket 704"). `test/support/tokens-guard.test.ts` runs with every milestone that edits renderer source.
- The desk's web app imports `stores/transcript`, the transcript's model and `lane-a/plane-transcript` by relative path. Its typecheck, build and tests run at every milestone's head; it must draw as it did, and a change in what it draws is reported, not fixed in passing.
- A milestone that adds a fixture runs `node --test .github/scripts/maws-app-scan.test.mjs` on the VM.

## Plan of Work

### M1 — One reading of a person's message, and the window that reads it once

**What exists at its end.** The reader's slicing is one function that can run from its own source and gives each envelope's bytes with what was read of it. `splitPersonsMessage` exists and is tested on the recorded joined texts. A window reads a person's message through it once, where events enter the reducer (ruling B), and U4b's four calls are gone: the reducer's call is what lets them go in this milestone, before any producer changes, with the window still right for every message it is sent. To a person nothing differs from U4b's head but the corners of "Reported to the architect", C. Build G's events for the recordings are frozen as fixtures, and the window draws them right.

**What it touches.** `src/shared/maws/ask.ts` (`answeredBlock`); `src/shared/engine/arrival.ts` (`envelopeSlices`, `personsText`); `src/shared/engine/persons-message.ts` (new) and its test; `src/renderer/src/transcript/model/reduce.ts`, `derive.ts`, `user-text.ts`; `src/renderer/src/composer/editor/history.ts`; the tests beside them; `spikes/protocol-probe/fixtures/uxwave/` (the frozen files).

**Interfaces.** Exposes A, B, C and E; consumes probe 1's recordings.

**Decisions of this milestone.**
- *The frozen files come first.* Before any source edit, the events build G's producers give for each of probe 1's recordings and for `u4b-env-end-env-first-1` and `u4b-env-two-prompt-first-1` (the join on an early Send now, which probe 1 does not record again) are written beside the recordings as `<name>.base-events.json` (the journal through `journalToEvents`) and, for probe 1's, `<name>.base-backfill.json` (the file through the chain follower), the names `u3-tasks-r1` already uses. They are build G's because the producers are build G's at that commit: Concrete Steps 1 checks that only `normalizer-controls.ts` differs from `2c7044231`, by the schema a recorded tool call is read under, which reads an `ask` call the same. The means of writing them are the executor's; the commit that holds them names the head they were made at. One case holds that the producers at M1's head still give them; M2 removes that case when it changes the producers.
- *The reader moves, it is not rewritten.* `envelopeSlices` is U4b's `readAnswerEnvelopes`, `envelopeEnd`, `opensEnvelope` and `pastedLines` as they stand, taking their three outside references as arguments. `readAnswerEnvelopes` keeps its answer, `{ envelopes, rest }`, and every case of `arrival.test.ts` passes unedited, its nineteen whole-result comparisons among them; that is the proof nothing moved. A function the worker will run may use only its arguments: a case evaluates `envelopeSlices` and `answeredBlock` from their own source text, with nothing else in scope, over the reader's whole corpus.
- *`parseAskSteer` reads through `answeredBlock`,* then applies the answers' schema. `ask.test.ts` passes unedited.
- *The window's one call* (ruling B) is the first thing the reducer does with a person's message, before `recordAskSteer`; the parts it returns are reduced in order by the code below it. A split-out part's id is the event's id with a suffix no producer writes (Interfaces E).
- *The split ends* (decision 17): it returns no part that it would split again, so the reducer never asks twice about one part.
- *The tests U4b wrote on a joined text stay, by another road.* Those that give `userTextOf` a joined text directly (`user-text.test.ts`, one case of `history.test.ts`) move to `persons-message.test.ts` or build their row through the model; `edit-prefill.test.ts` and the cases of `joined-answer.test.ts` already go through the reducer and keep their meaning. Three expectations change and are named in the hand-back ("Reported to the architect", C): the join of two envelopes with one orphan, the orphan beside an image, and the row whose text read again pairs fragments into an envelope (ruling B's exception).

**What it does not touch.** No producer. The search, the preview, the title. `TranscriptSlot.tsx`, the stack. Any wire file.

**What it proves.** Acceptance 6; of 3 and 4, the model's part on build G's events; of 7, the reducer's contract. Its tests also pin:
- **first, before any code changes** (the architect's ruling on the probes): U4b's reader, as it stands at `ea51e3e8f`, on the recorded text of `u704-end-two-envelopes` reads two envelopes and no rest, and on each recorded joined text reads the envelope and the person's part byte for byte. If it does not, the executor stops and reports ("Probes", the last paragraph);
- the reader's corpus, unedited; for each recorded joined text `envelopeSlices` gives one member whose `text` equals the envelope member's frame content, byte for byte, and a `rest` equal to the prompt's;
- `answeredBlock` and `parseAskSteer` agree over the corpus and `ask.test.ts`'s texts, but for a block whose answers fail the schema, which one case names;
- `splitPersonsMessage`: over each recorded joined replay, the person's part then the envelope, in either order; a lone envelope and a plain prompt come back as the same object; a message of origin null is split as one of origin `human` is; a message that is synthetic, of an origin that names something else (`peer`, `task-notification`, `local-command`), a bash part, or without a uuid comes back as the same object; the recorded image join (`u704-end-image`, its replay through the real derivation, not a case made by hand) leaves the prompt's text block and image block, in place and unchanged, and the envelope's event; a text block holding an envelope beside an image alone leaves the image (made by hand from the recorded form); the recorded two envelopes (`u704-end-two-envelopes`) are two events, the first keeping `joined`;
- the ruling's exception, made by hand: a text where one envelope's lines stand around another whole envelope and a line of words. The split gives the words and both envelopes; the split of each part it returned is that part, the same object; and the window's rows and recorded answers are the same whether the reducer is given the raw message (as an older host sends it) or the parts (as a host of this build will);
- `flatPersonsWords`: over the recorded `last-prompt` rows, both forms: envelope first (a lone envelope's, `p1-maws-ask-async` line 53; the joined ones of `u704-end-image-{1,2}` and `u704-end-two-envelopes-1`), nothing of the person's is left and none of an envelope's words; prompt first (the rewind's row, `u704-rewind-1` L54), the person's words; a line without the opening sentence is unchanged;
- `personsText`: one `answer` per envelope of a recorded joined row; a consent message as before;
- the reducer: a message that is not synthetic, under a uuid already placed, records an envelope's answers and places nothing (the order decision 3 rests on);
- the recall: a row that is one whole envelope with no attachment is skipped, and one with an attachment is not.

### M2 — The producers: the live wire, the file, another machine's rows, a rewind's text

**What exists at its end.** A host of this build emits a joined message as the person's message and its envelopes, on the live wire and from the file; another machine's rows and the desk draw the same; an input drawn "Not read" is split as any other message is; a rewind puts the person's words in the box and its boundary's tooltip holds no envelope. A window of build G or F on such a host draws the person's words and an answered capsule.

**What it touches.** `src/engine-host/normalizer.ts` (the emitter; the rewind's boundary), `src/engine-host/fs/backfill.ts` (the end of `recordToEvents`), `src/engine-host/fs/chain-follower.ts` (the anchor's text), `src/engine-host/rewind.ts`, `src/renderer/src/lane-a/source/off-chain.ts`; their tests; `src/renderer/src/lane-a/joined-answer-routes.test.ts` (new, beside `arrival-routes.test.ts`, whose three roads it takes).

**Interfaces.** Consumes C; exposes D.

**Decisions of this milestone.**
- *Every `user.message` a producer makes passes the split,* not only the branches known to carry a join: the gate is inside the function, and a replay that a fresh normaliser meets with no memory of its write takes the general branch. The natural places are the emitter's `emit` and the tail of `recordToEvents`, where the row's ordinals are still at hand. A row's other events keep their ids (decision 3).
- *The normaliser's digest of what the host wrote* (`promptWritten`, `replayJoins`) reads the frame's content as written, before the split. Nothing there changes.
- *`undoneEvents`* passes its `user.message` through the split, like every maker (decision 5: one gate; its `origin: null` is a person's). The discarding lifecycle it emits stays last. An input that is one envelope alone comes back as it is.
- *The rewind's text.* `rewind.ts`' outcome and the normaliser's `boundary.rewind` pass `personsWords`; the chain follower's anchor passes `flatPersonsWords`. A text with nothing of the person's left is null: the box is not prefilled, the tooltip is absent.
- *The routes test* follows `arrival-routes.test.ts`: one recording drawn from its file through the chain follower, from the same rows through `freshSource`, and from its journal through `journalToEvents`; the three drawings are compared row by row, and what the live route alone carries (`joined`, `isReplay`) is stated.

**What it does not touch.** The reader and the split (M1's, reviewed before this starts). The window's model. The search, the preview, the title. No schema.

**What it proves.** Acceptance 1, 2, 3, 4, 5, 7 and 8. Its tests also pin:
- for the control recordings, the producers' events equal the frozen files exactly, ids included;
- the split returns every event the producers made of every recording as the same object;
- `normalizer-send-now.test.ts`'s cases of joined prompts with no envelope pass unedited;
- the UserMessage site's props, the hook-refusal prompt's prefill, the rewind picker's line and the "handed" row for a recorded join, each through the model from the recorded journal;
- the rewind's prefill and tooltip over probe 2's recorded response and anchor (`u704-rewind-1`: the response at seq 771, the wire's frame; the rewind's `last-prompt` row at L54); no case says that a `last-prompt` row follows a join;
- an anchored comment's message (written by the anchor's own writer) joined with an envelope in the recorded form, by hand: the row keeps its anchor and its frame, and the envelope answers its ask;
- a terminal's queued prompt holding a literal envelope: a row of the recorded shape of `w1-terminal-queued.jsonl` line 26 (its `entrypoint: "cli"` kept), its prompt a line of words and a whole envelope made by hand, through `recordToEvents` and the model. The person's row holds the words alone; with the ask's call in the session (staged by hand, and the case says so) the capsule reads answered; without it nothing of the envelope is drawn;
- an undone input holding a literal envelope: a row marked off the chain, through the reader of another machine's rows. The row drawn "Not read" holds the words alone, and the envelope is read to the same two outcomes.

### M3 — Outside the transcript; the scene, the record, the last run

**What exists at its end.** The search text and a new snippet hold no envelope; the resume preview shows no envelope; a title never falls back to an envelope's words, and Regenerate never generates one from an envelope. The scene is written. The record is made and the whole suite has run.

**What it touches.** `src/engine-host/fs/search-text.ts` (the worker's source), `src/services/sessions/recent-turns.ts` (`promptText`), `src/engine-host/fs/summarize.ts` (the two sources of `firstPrompt`), `src/renderer/src/sessions/RenameDialog.tsx` (`describe`); their tests; one new test file in `apps/desk-web/src/depth/view/` ("Reported to the architect", H); `e2e/composer.spec.ts` and, if the scene needs a journal writer, `e2e/support/c7-replay.ts`; `docs/charter.md`, `docs/tech-debt-tracker.md`, this document.

**Interfaces.** Consumes A, B, C; exposes F and G.

**Decisions of this milestone.**
- *The worker.* For a `user` row with no origin object or of origin `human` (the row's form of decision 5's gate; the worker reads rows and cannot class them as the backfill does), each text is replaced by its `rest` from `envelopeSlices` (given `askSteerOpening`, `PASTED_BLOCK` and `answeredBlock`, each from its own source), followed on lines of their own by what `answerOutsideTranscript` gives for each member, when that is not empty; a text left empty yields nothing. Every other row is read as today. The functions are interpolated as `isMadeUpFinalAnswer` is, and the same rule binds them: they use their arguments alone. If the built host cannot give the worker a working source of one of them, the executor stops and reports; it writes no second reader.
- *The preview.* `promptText` gives `answerOutsideTranscript(text)` for an event whose text `readAnswerEnvelope` reads whole. Under ruling A the turn takes no prompt from it.
- *The title.* The head's first user text is the first whose `personsWords` is not null, for a row with no origin object or of origin `human`; the fallback is the earliest `last-prompt` whose `flatPersonsWords` is not null. Each keeps its cut at 200 characters.
- *The Rename dialog's description* (the review's third finding). `describe` takes the first message whose person's words are not empty: `personsWords` of its text, so an older host's whole joined event gives the person's part; a message that is one envelope alone gives `answerOutsideTranscript` of it, nothing under ruling A, and the walk goes on to the next. Its filter of synthetic and bash messages stays.
- *The stored index is not re-read* (ruling A).
- *The scene*, in `e2e/composer.spec.ts` beside "U4b, a waiting answer": probe 1's `u704-end-prompt-first-1` through the replay (`e2e/support/c7-replay.ts`, as `sendNowAfterJournal` carries `u4b-two-1`): once the joined turn is drawn, the person's bubble holds the prompt alone, the page holds no `[MAWS ask`, and the ask's capsule reads answered. If the replay cannot carry the recorded ask's call, the scene asserts the bubble and the page alone and says so. It is written and typechecked here and run by the architect.
- *The record.* In `docs/charter.md`, at X1, one dated line (the architect's to confirm; "Reported to the architect", G): "Amended 2026-11-15 (UX wave, board ticket 704): a user message the engine joined from a person's message and MAWS's answer envelopes is told as the person's message, holding their part alone, and after it, under the same `messageUuid`, one `user.message` per envelope, of the shape an envelope sent alone has. No key, kind or type changes; a reader records an envelope's answers before it drops a second message under a placed uuid." In `docs/tech-debt-tracker.md`: the row of ticket 704 is closed at landing through the board's scripts; the recall's row is reworded to the case that remains (a row that is one whole envelope the person typed; the case of fragments that pair is now ruling B's exception and is split, not kept); new rows for the reducer's call and when it can go (no host older than this landing serves a window), for index text an older build stored, for a rewind's text from an older host, and for the split's provenance. That last row says: the split cannot tell MAWS's own steer from a prompt a person typed that holds a whole valid envelope (decision 5). The candidate evidence is the row's `entrypoint` (`sdk-ts` for a session MAWS runs, `cli` for a terminal: `p1-maws-ask-async.jsonl` line 42, `w1-terminal-queued.jsonl` lines 5 and 26), on a `user` line also `promptSource`. The file's line of a joined message also carries `mergedSendUuids`, the earlier members' uuids (probe 1), which no replay and no event carries. The file's rows carry these and events do not. Reading them would take: the backfill passing it to the split for the file's routes; on the live route the normaliser's own knowledge of which frames the host wrote as answers; and for the window's ingest either a key on the event, which is a wire minor, or no provenance there. Its closing condition is a ruling that the residue is worth one of those.

**What it does not touch.** The index's schema and its checkpoint. `session-search.ts`. Any source file of the desk's web app.

**What it proves.** Acceptance 9 and 10, and the whole of Acceptance run once more as written. Its tests also pin:
- the real worker (`SearchTextReader` over the recorded file's bytes) gives a text that holds the prompt and neither the envelope's opening line nor its fence; an assistant's row and a row of another origin are read as today;
- a pass resumed from a checkpoint taken before the joined line gives the same text for the bytes after it as a pass from the start;
- `recentTurnsOf` over the recorded file: the joined turn's prompt is the prompt; over `p1-maws-ask-async`'s file, the turn the envelope opened has no prompt and keeps its answer;
- `summarize` over a recorded file's bytes with a head window that ends before the first prompt's line does: the title is the prompt's words, or the next `last-prompt`'s, never an envelope's; and over a head whose first prompt has no words and whose next user text is an envelope (made by hand);
- the description `describe` passes to `session.generateTitle`, asserted on the call: for a session whose first message has no words and whose next is an envelope alone, the next person's words; for an older host's whole joined event (build G's frozen events), the prompt alone;
- the desk's web app draws a recorded join through its own session view as the window does.

## Concrete Steps

From the worktree of branch `ux-wave/704-envelope-split`. `vmcheck.sh` is the wave's check helper (the build brief says where it is); on the VM, paths are repository paths. The VM is shared: a slow or timed-out check is read against its load first.

1. **Master first, and what this stands on.**

       git fetch origin master && git merge origin/master
       git merge-base --is-ancestor ea51e3e8fca0839c66ccd7ce7d3f0e186236953c HEAD && echo "holds U4b"
       ls spikes/protocol-probe/fixtures/uxwave/ | grep "^u704-"
       ls spikes/protocol-probe/ | grep "findings-uxwave-u704"
       git diff --stat 2c7044231 HEAD -- src/engine-host/normalizer.ts src/engine-host/normalizer-send-now.ts src/engine-host/normalizer-arrivals.ts src/engine-host/normalizer-controls.ts src/engine-host/fs/backfill.ts src/engine-host/fs/chain-follower.ts

   The second prints `holds U4b`. The third lists probe 1's recordings, each a `.jsonl` and a `.transcript.jsonl`; if it lists nothing, stop and tell the architect: no milestone starts without them. Read the findings file for the joined line's `origin` and `entrypoint` and for the two envelopes' form before anything else ("Probes", the last paragraph). The last prints `normalizer-controls.ts` alone before M1's first commit; any other file means the frozen files could not be called build G's: stop and report.

2. **The checks**, on the VM. Push before every check: the VM sees only what is on origin.

       git push -u origin ux-wave/704-envelope-split
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 600 pnpm exec vitest run <the milestone's test paths>'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 600 pnpm exec eslint <the paths changed>'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm --filter desk-web typecheck'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm --filter desk-web build'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm --filter desk-web test'

   The first call for the branch installs dependencies there; allow it twenty minutes. A vitest filter is a path, never a bare word. At a milestone's tests-first commit the run fails on the new assertions (for M2, a line such as `expected '[MAWS ask toolu_…] The user answered …\nReply with …' to be 'Reply with the single word KIWI, …'`); at its head it prints `Test Files … passed` with no failure, and `tsc` and eslint print nothing.

   The test paths: the folders a milestone touches and the tests that import what it changes. M1: `src/shared/engine`, `src/shared/maws`, `src/renderer/src/transcript`, `src/renderer/src/composer/editor`, `src/renderer/src/composer/edit-prefill.test.ts`, `src/renderer/src/composer/queue`, `src/renderer/src/lane-a`, `src/engine-host/normalizer-arrivals.test.ts`, `src/engine-host/fs/backfill.test.ts`, `src/engine-host/session-maws.test.ts`, `src/engine-host/conformance/fixtures.test.ts`, `test/support/tokens-guard.test.ts`. M2: `src/engine-host/normalizer.test.ts`, `src/engine-host/normalizer-send-now.test.ts`, `src/engine-host/normalizer-arrivals.test.ts`, `src/engine-host/rewind.test.ts`, `src/engine-host/prompt-history.test.ts`, `src/engine-host/fs`, `src/renderer/src/lane-a`, `src/renderer/src/transcript`, `src/renderer/src/widgets`, `src/renderer/src/request-card`, `src/renderer/src/composer/queue`, `src/services/sessions/recent-turns.test.ts`, `src/services/owner`, `src/shared/graph`, `test/support/tokens-guard.test.ts`. M3: `src/engine-host/fs`, `src/services/sessions`, `src/services/index`, `src/shared/engine`, `src/renderer/src/sessions`, `test/support/tokens-guard.test.ts`, and the desk's web app's tests, which hold its new one.

   Whenever a fixture is added:

       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 300 node --test .github/scripts/maws-app-scan.test.mjs'

3. **The wire does not change.** After M2:

       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 300 pnpm exec vitest run src/shared/ipc/wire.test.ts src/shared/ipc/wire-fingerprint.test.ts'

   It passes with `WIRE_MINOR` and both generated files untouched. If it fails, something reached the wire by mistake: stop and report; never raise the minor to pass.

4. **The last run** (M3), after a fresh merge of master and a push:

       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 1200 pnpm typecheck'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 1200 pnpm build'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 900 pnpm exec eslint $(git diff --name-only origin/master...HEAD -- "*.ts" "*.tsx" | tr "\n" " ")'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
       vmcheck.sh ux-wave/704-envelope-split -- 'timeout 3600 pnpm test'

   The whole suite runs once, here. The build brief lists the files that fail or time out on the VM for the VM's reasons; each such failure is shown to pass alone or to fail on master there, and no such file is edited. Any other failure is this landing's. A run whose log has stopped growing while a process sits at full CPU is a loop: stop it, find the case one file at a time, and report the loop.

5. **Stop and hand back.** The executor runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. The hand-back says: what exists, with the command and result that showed it; what is not verified (the scene, written and typechecked, not run); the decisions made; the three changed expectations of "Reported to the architect", C; anything that contradicts this document or the ticket; what deserves a ticket.

## Proof that an executor does not run

Each is the architect's, with what it needs.

1. **The rulings on A and B** are made ("Ruled by the architect").
2. **Probes 1 and 2**, before M1 (probe 2 before M2 at the latest); probe 3 if wanted. They need the probe VM, the engine at 2.1.322 and the gateway route; "Probes" says what each keeps. Their recordings and findings file reach this branch by a merge of the probe's branch.
3. **The adversarial review of this document** is done (three findings, ruled; the Decision Log). A second read of the revision is the architect's call.
4. **Class 1a** on GitHub Actions on the final head: `static`, `unit`, `probes`.
5. **The review of the branch**: the xhigh panel ("Size and review").
6. **The Mac runs**, under UC-10's rules for the chain. The specs that cross the code this landing edits, by group: `e2e:composer` and `e2e:c7` (`composer.spec.ts`: the new scene; "U4b, a waiting answer"; U4a's Send now scenes over a joined message), `e2e:tools` (`maws-tools.spec.ts`, the ask answered without waiting), `e2e:transcript`, `e2e:lane-a`, `e2e:remote`, `e2e:to-human`, `e2e:default` (`resume-picker.spec.ts`, which no group's script lists), `e2e:desk-web`, and `e2e:cross-build`, whose crossing scenes pass the emitter this landing edits. The new scene runs alone on a Mac before the final set. No paid live group's scenes change.
7. **No look by the owner** is needed ("What a person sees").

## The pull request

Its body names its class 1a run, the review's verdict with what was dismissed or deferred, and its residue (the tracker rows of M3, the ticket candidates of "Reported to the architect", F). It reverses no ruling of the owner's. It carries the charter's dated line at X1 and the tracker's edits. It says that the wire's minor and manifest are unchanged and that the cross-build coverage table gains no row, with this document's table as the reason. It ends with the build brief's `Sminos-Session:` line.

## Interfaces and Dependencies

What must exist at the end, by name. An executor who needs to change a name or a signature here stops and reports.

### A. The envelope's own checks (`src/shared/maws/ask.ts`, M1)

    /** The envelope's own checks on a whole text, without the answers' schema: the tag at its start, the last `json`
     *  fence at its end, a block that parses, of status `answered`, naming the tag's ask. It uses nothing outside its
     *  own body: the search text's worker runs its source. */
    export function answeredBlock(text: string): { askId: string; result: unknown } | null;

`parseAskSteer(text)` is `answeredBlock(text)` and then `AskResultSchema` on `result`. What `askSteerText` and `askSteerOpening` write does not change.

### B. The reader (`src/shared/engine/arrival.ts`, M1)

    /** U4b's slicing of the envelopes inside a text, in one function that uses its arguments alone. */
    export function envelopeSlices<T>(
      text: string,
      opening: (askId: string) => string,       // the writer's whole first line: `askSteerOpening`
      pasted: RegExp,                            // a pasted segment, global: `PASTED_BLOCK`
      read: (slice: string) => T | null,         // a whole slice, read or refused
    ): { members: { text: string; read: T }[]; rest: string };

    export function readAnswerEnvelopes(text: string): { envelopes: AskSteer[]; rest: string };   // unchanged

`readAnswerEnvelopes` is `envelopeSlices` with `askSteerOpening`, `PASTED_BLOCK` and `parseAskSteer`, its members' `read` as `envelopes`; its answer keeps the shape it has (the review's second finding). Its rules are U4b's, word for word. A caller that needs a member's bytes calls `envelopeSlices` itself: `personsParts`, and `personsText`, which answers a consent as before, else one `answer` per member, its `summary` the member's text.

### C. The split (`src/shared/engine/persons-message.ts`, new, M1)

    import type { ContentBlock, EventPayload } from '../graph/events';
    export type UserMessage = Extract<EventPayload, { kind: 'user.message' }>;

    /** A person's content read apart: their own part, null when nothing of theirs is left, and the envelopes' texts in order. */
    export function personsParts(content: string | ContentBlock[]): { own: string | ContentBlock[] | null; envelopes: string[] };

    /** The one split: the messages to emit in a message's place. The message itself, the same object, when it splits nothing. */
    export function splitPersonsMessage(message: UserMessage): UserMessage[];

    /** The person's words in the engine's own copy of a message's whole text (a rewind's prefill); null when none are left. */
    export function personsWords(text: string): string | null;

    /** The same for the engine's one-line form (`last-prompt`): what stands before an envelope's opening sentence. */
    export function flatPersonsWords(line: string): string | null;

    /** What an answer reads as outside the transcript: the search text and the resume preview. Ruling A's one place.
     *  It uses its argument alone: the search text's worker runs its source. */
    export function answerOutsideTranscript(envelope: string): string;    // '' at authoring

`personsParts`: a string is read by `envelopeSlices` (with `askSteerOpening`, `PASTED_BLOCK` and `parseAskSteer`); `own` is its `rest`, null when empty, and `envelopes` its members' texts. The part is read again until a reading takes nothing out (decision 17), the envelopes in the order they were taken, reading by reading. Blocks: each text block is read so, a block left empty goes, every other block stays in place; `own` is null when no block is left (decision 7).

`splitPersonsMessage` returns `[message]`, the same object, unless the message passes the gate (not synthetic, `bash: null`, a `messageUuid`, and an `origin` of `'human'` or null: decision 5) and its content holds an envelope beside a person's part or more than one envelope. Otherwise: the person's message when `own` is not null (`{ ...message, content: own }`), then for each envelope `{ kind: 'user.message', messageUuid, content: <its text>, isReplay: message.isReplay, isSynthetic: false, origin: message.origin, bash: null }`. `joined` and `arrival` are on the first of the returned messages and on no other. Given any message it returned, it returns that message, the same object. This is the only gate: no maker and no reader adds a condition of its own.

`flatPersonsWords`: the first place where the writer's opening sentence stands in the line, at its start or after a space (`askSteerOpening` with the id as the tag reads it); and, in a line closed with `…`, a head of that sentence (its tag with the id whole or cut, and as much of the sentence as the cut left) running from such a place to the closing `…`, since the engine's cut can fall inside the opening sentence itself (`u704-rewind-1` L54; Decision Log, M1); the words are the line before that place, trimmed; null when none are left; a line with neither is returned as it is.

The module is pure and imports the reader, the event types and nothing of the renderer or the engine host.

### D. Where a producer calls it (M2)

| producer | the place | ids |
|---|---|---|
| `src/engine-host/normalizer.ts` | every `user.message` the emitter is given | the emitter's own, in order |
| `src/engine-host/fs/backfill.ts` | every `user.message` `recordToEvents` returns for a row | the row's next ordinals, after its other events |
| `src/renderer/src/lane-a/source/off-chain.ts` | the `user.message` `undoneEvents` makes; its discarding lifecycle stays last | the row's uuid for the person's message, and the same with a suffix for a part beyond it |
| `src/engine-host/rewind.ts`, and the normaliser's `boundary.rewind` | `prefillText`, through `personsWords` | — |
| `src/engine-host/fs/chain-follower.ts` | the anchor's `lastPrompt`, through `flatPersonsWords` | — |

### E. The window's one call (`src/renderer/src/transcript/model/reduce.ts`, M1; ruling B)

In the reducer's `user.message` case, for a message that is not synthetic, before `recordAskSteer`: when `splitPersonsMessage` returns anything but the event itself, each part is reduced in order by the code below the call and the event itself is not. No part is asked about again: the function returns none it would split (decision 17). A part beyond the first takes the event's base with an id of the event's id and the suffix `~part<n>` (n from 1; no producer writes `~`). Below it the case is master's: `recordAskSteer` reads one envelope from a whole text, then `join`, then the return for a uuid already placed.

### F. The search text's worker (`src/engine-host/fs/search-text.ts`, M3)

The worker's source gains `askSteerOpening`, `PASTED_BLOCK`, `answeredBlock`, `envelopeSlices` and `answerOutsideTranscript`, each interpolated from its own source, and its `blocksOf` reads a `user` row with no origin object or of origin `human` through them (M3's decision). The reader's answer, the page's shape and the checkpoint do not change.

### G. The preview, the title and the Rename dialog (M3)

`promptText` in `src/services/sessions/recent-turns.ts`: an event whose text is one whole envelope reads as `answerOutsideTranscript` of it. `firstPrompt` in `src/engine-host/fs/summarize.ts` and `describe` in `src/renderer/src/sessions/RenameDialog.tsx`: decisions of M3. `RecentTurn`, `TranscriptSummary` and `session.generateTitle`'s input keep their shapes.

### H. Fixtures

Probe 1's and 2's recordings, by the names of "Probes", each `<name>.jsonl` and `<name>.transcript.jsonl`, with `findings-uxwave-u704-*.txt`. M1's frozen files, `<name>.base-events.json` and `<name>.base-backfill.json`. No existing fixture is edited.

### I. Insertions in files other children own (UC-8, UC-3)

| file | owner | the insertion |
|---|---|---|
| `src/shared/engine/arrival.ts` | U3 | `envelopeSlices` (U4b's four functions as one, moved); `personsText` over the members |
| `src/engine-host/normalizer.ts` | U3 (a caller of the reader) | the emitter's call; `personsWords` at `boundary.rewind` |
| `src/engine-host/fs/backfill.ts` | U3 | the call at the end of `recordToEvents` |
| `src/renderer/src/lane-a/source/off-chain.ts` | U3 | the undone input's message through the split |
| `src/renderer/src/sessions/RenameDialog.tsx` | no row of the root's table (U9 inserted in it) | `describe` reads the person's words |
| `src/renderer/src/transcript/model/reduce.ts`, `derive.ts`, `user-text.ts` | the transcript's (UC-3) | U4b's three insertions removed; one call added in `reduce.ts` (E) |
| `src/shared/maws/ask.ts` | no child (UC-15 covers `tools.ts` and `instructions.ts`, not this file) | `answeredBlock`; `parseAskSteer` reading through it |
| `src/engine-host/rewind.ts`, `src/engine-host/fs/chain-follower.ts`, `fs/summarize.ts`, `fs/search-text.ts`, `src/services/sessions/recent-turns.ts` | no child | one call each (D, F, G) |
| `apps/desk-web/src/depth/view/` | the desk's web app, outside the wave | one new test file; to the coordinator first |
| `e2e/composer.spec.ts`, `e2e/support/c7-replay.ts` | U4 | one scene, and a journal writer if it needs one |
| `docs/charter.md` | the architect's | one dated line at X1 |

This child's own: `src/renderer/src/composer/editor/history.ts`. New and this landing's: `src/shared/engine/persons-message.ts`.

### J. What a sibling reads from this landing

`splitPersonsMessage`, `personsParts`, `personsWords`, `flatPersonsWords`, `answerOutsideTranscript`, `envelopeSlices` and `answeredBlock`. Changed for callers: a person's `user.message` (decision 5's gate) never holds an envelope beside other content, on any route of this build, and in a window of this build whatever host made it; a reader that wants an answer reads the envelope's own event. Gone: `ownWords`, `envelopesAnsweredHere`, `attachmentsAlone`.

## Size and review

About 32 files and 1,500 changed lines without the fixtures: 17 source files (one new), about a dozen test files (three new), one e2e spec, two documents and the tracker. Three milestones.

The review of the branch is the xhigh panel, for two reasons. The diff is of panel size by its files. And the change sits in the two producers that every message of every session passes, where the failure is a person's words lost, text shown as theirs that they did not type, or an answer recorded for the wrong ask: U4b's reader took four review rounds to get right on a smaller surface. The panel reads for those three, and for an event an older build would read differently. Each milestone gets its task review at its boundary; M1's is clean before M2 starts, since M2 and M3 consume its functions. Class 1a on GitHub Actions is the gate of record.

## Surprises & Discoveries

Found while reading the code for this document.

- Observation: four readers of the ticket's list take the derived row's text, which U4b's second step already made the person's words.
  Evidence: `userInput` in `transcript/surface/adapters.ts` (`props: { text: row.text, … }`); `initiatingPrompt` and `rowPrefill`; `RewindWidget.tsx` (`typedFromRowText(row.text)`); `stack-acts.ts` (`text: row.text`). The list is dated before that step by the table it was taken from.
- Observation: the engine's `last-prompt` text is one line cut near 200 characters, so no reader of whole envelopes can read it, and an envelope in it never ends.
  Evidence: `test/fixtures/transcripts/p1-maws-ask-async.jsonl` line 53, which ends inside the result block's `"answers": [`.
- Observation: the recordings of the join keep the engine's file as a reduction, and their ask was invented.
  Evidence: the `uxw_transcript` row of `u4b-env-end-env-first-1.jsonl` (a `user` line has `type`, `uuid`, `parentUuid`, `isSidechain`, `promptId` and its text); the findings file, "No recording records any answers".
- Observation: every build's reducer records an envelope's answers before it drops a message under a placed uuid, so an envelope's event under the person's uuid answers and places nothing, in builds that will never be changed.
  Evidence: `reduce.ts` at `f1852de3a` lines 573 to 575 and at `2c7044231` lines 704 to 707.
- Observation: the search text's worker runs from a source string; it can be given a function's source and nothing it imports.
  Evidence: `WORKER` in `src/engine-host/fs/search-text.ts` (`${isMadeUpFinalAnswer}`, `${fingerprint}`), and the comment on `isMadeUpFinalAnswer` in `src/shared/owner/message-call.ts`.
- Observation: build F's normaliser drops the replay that holds a joined message, so on a host of build F the live route never tells the join and the file route does.
  Evidence: `normalizer.ts` at `f1852de3a`, lines 414 to 417.
- Observation: a prompt typed at a terminal carries `origin: {kind: "human"}`, on its `user` line and on its queued form, so the origin cannot tell it from MAWS's own steer; the first draft of decision 5 said the opposite.
  Evidence: `test/fixtures/transcripts/w1-terminal-queued.jsonl` lines 5 and 26; `steeredPrompt` in `src/engine-host/fs/backfill.ts`. Found by the adversarial review.
- Observation: one reading of a text can leave a part that still holds a whole envelope, where an envelope's lines stand inside another's.
  Evidence: U4b's case "recalls a row as the bubble shows it, even where its text read again would pair fragments into an envelope" (`composer/editor/history.test.ts`). Hence decision 17.
- Observation: U4b drew the recorded image join with the separator left in: its reader ran over the text blocks joined by `\n\n`, so the bubble began `\n\n` before the prompt. Reading block by block (decision 7) draws the prompt alone.
  Evidence: M1's red run, the four `u704-end-image` cases of `joined-answer-older-host.test.ts`.
- Observation: the engine's `last-prompt` row of a rewind can cut inside the envelope's opening sentence.
  Evidence: `u704-rewind-1.transcript.jsonl` L54. Hence the revised `flatPersonsWords`.
- Observation: after a rewind to the joined message, its turn is gone from `turnActivity`, so the recall holds no entry for it.
  Evidence: M1's check on the backfill route of `u704-rewind-1`; `recallEntries` skips rows whose turn is not in the activity.
- Observation: the frozen backfill's `user.message` for a joined line has exactly the keys the split's envelope event has, so the split of build G's events reproduces this build's producers' events object for object, two envelopes included.
  Evidence: M2's routes test (Acceptance 2 and 7).
- Observation: the producers' code for a person's message is the same at this branch's base as at build G.
  Evidence: `git diff --stat 2c7044231 ea51e3e8f` over the normaliser's files, the backfill and the chain follower names `normalizer-controls.ts` alone (the schema a recorded tool call is read under).

- Observation: the engine's file marks a joined message: its line carries `mergedSendUuids`, the earlier members' uuids, which the wire's replay does not.
  Evidence: probe 1, every joined line ("Engine facts"); no `u704-*` journal holds the key.
- Observation: a `last-prompt` row does not follow every join (3 of 7 joined runs), so nothing may assume one exists.
  Evidence: `spikes/protocol-probe/findings-uxwave-u704-envelope-split.txt`, "Probe 1".
- Observation: an envelope joined with a prompt that carries an image joins as blocks, the separator appended to the envelope's text block.
  Evidence: `u704-end-image-{1,2}` (probe 3).

## Decision Log

- **2026-11-15 (UTC) · The verification call, at authoring.** This document gets an adversarial review before an executor starts (the architect dispatches it). Each milestone gets a task review at its boundary. The branch gets the `doperpowers:review-code` xhigh panel before it lands, by its size and by where the change sits ("Size and review"). Class 1a on GitHub Actions is the gate of record. The architect rules on A and B and arranges the probes before M1.
- **2026-11-15 (UTC) · Ruling A: nothing.** The search finds nothing for an answer and the resume preview shows nothing for it. The one place stays `answerOutsideTranscript`. No drawn example is needed.
- **2026-11-15 (UTC) · Ruling B: the reducer applies the same split once at ingest.** Its known exception is part of the ruling: where an envelope's lines stand inside another envelope's text, a second read can expose an outer envelope the first read bounded out, so such a text is split in two steps; accepted, with a test that the result is the same in every window and that ingest ends. The reducer's call exists from M1, which is what lets M1 remove U4b's reader calls before M2 changes the producers. *How the document meets it* (the author's, decision 17): the second step is taken inside `splitPersonsMessage`, which reads the part it would return again until a reading takes nothing out; so a producer of this build emits the fully split events, the ingest of its events changes nothing, and the ingest of an older host's raw message reaches the same events. The alternative, one reading in the producer and the second at ingest, gives this build's windows the same result and leaves a window of build G or F holding the outer envelope in the person's bubble.
- **2026-11-15 (UTC) · The adversarial review's first finding, upheld: the gate.** The draft said a prompt typed at a terminal is never split; a terminal's queued prompt carries `origin.kind: "human"` (`w1-terminal-queued.jsonl` line 26) and `steeredPrompt` gives it the event MAWS's own steer gets, and the draft sent `undoneEvents`' `origin: null` rows through an ungated function. Ruled: the split is by the text on every route, as U4b's ruling has it; the guarantee for a terminal's prompt is withdrawn; one gate at every maker, the undone input included. Decision 5 is rewritten in the ruling's words. *Decided from the code:* `origin: null` counts as a person's, because the makers write null for one (the backfill's plain branch, a blocked prompt, the undone input) and the readers outside the transcript already read `human` and null alike. Two cases are added (M2), a tracker row for provenance (M3), and probe 1 states the joined line's `entrypoint`. The stop on a joined line whose origin is not `human` is narrowed to one whose origin names something else.
- **2026-11-15 (UTC) · The review's second finding, upheld: the reader's shape.** `readAnswerEnvelopes` keeps `{ envelopes, rest }`; `texts` is dropped from Interfaces B. No named caller needs it: `personsParts` and `personsText` call `envelopeSlices`, which gives a member's bytes in the same pass.
- **2026-11-15 (UTC) · The review's third finding, upheld: a missed reader.** `describe` in `sessions/RenameDialog.tsx` is added to "Today" and to M3. The search was made once more over `src` and `apps`; its list is in "Today". It found one more reader of a `user` row's text that is not changed and is stated for its owner: U6's rule of a file the transcript names (`personNames`, `src/shared/files/named.ts`).
- **2026-11-15 (UTC) · "Found, not built" carries three ticket candidates with their evidence**, for the architect: Edit or a rewind on a joined message; the consent message joined with a waiting prompt; `initiatingPrompt` after a turn an envelope alone opened.
- **2026-11-15 (UTC) · The architect's rulings on the probes' findings** (probes 1, 2, 3 and the pasted case, merge `32c5a243d`). (1) Six new engine facts, each with its recording, are in "Engine facts": `mergedSendUuids` on the file's joined line only; the image join as blocks; a `last-prompt` row not written after every join and its form when written; two envelopes joined under the second's uuid; a rewind's `prefillText` the joined line's whole text; a pasted whole envelope an ordinary prompt line. (2) The split stays by the text behind the one gate (decisions 5 and 6); this landing does NOT read `mergedSendUuids`, for the reason now in decision 6; M3's provenance tracker row names the key beside `entrypoint`. (3) Decision 7 on the recording: a text block holding an envelope and nothing but white space beside it is a block left empty and goes; the image case runs `u704-end-image` through the real derivation and asserts the prompt's text block and image block stay in place and unchanged. (4) M1 opens with one test before any code changes: U4b's reader on the recorded two-envelope text reads two envelopes and no rest, and on each recorded joined text the envelope and the person's part byte for byte; else stop. (5) The cases that were made by hand for want of a probe (the rewind's two, the image) run on the recordings; `flatPersonsWords` is tested on the recorded `last-prompt` rows in both forms; no statement that a `last-prompt` row follows a join is written. *The executor's reading:* "probe 1's recordings" in M1's frozen files means all thirteen `u704-*` recordings (the control among them), so Acceptance 5 and the producers' equality cases of M2 can compare against any of them.
- **2026-11-15 (UTC) · M1's executor's decisions, folded by the plan executor.**
  - *The frozen files* (`6ad59e796`, made at `37136e2bd`): `base-events` is `journalToEvents` over the journal, `base-backfill` the chain follower over the file's bytes with the recording's own session id, as `arrival-routes.test.ts` drives it, in `u3-tasks-r1`'s format; 13 `u704-*` recordings plus the two `u4b-env-*` the milestone names. Written by a test run twice on the build VM (identical bytes) and not committed: a committed generator would be a test that writes fixtures.
  - *The scan:* the frozen files carry the journals' `apiMessageId`s, which gitleaks cut mid-id read as api keys; one path-bound allowance in `.github/maws-app/gitleaks.toml` for `msg_` ids in `fixtures/uxwave/*.base-{events,backfill}.json`.
  - *White space beside an envelope in a string* counts as no person's part, as decision 7 has it for a block: a string `<envelope>\n` leaves no bubble of a newline.
  - *A lone envelope* (returned as the same object) is a content that IS the envelope: a string equal to it, or one text block equal to it. `<envelope>\n` is split to the envelope's event, so that `recordAskSteer`, which reads a whole text, records its answers.
  - *The window's part ids* are `<id>~part<n>` (Interfaces E revised); the first part keeps the event's id, so its row id does not move. The code below the reducer's call moved unchanged into `placePrompt`.
  - *`flatPersonsWords` on a cut opening sentence* (Interfaces C revised): the recorded rewind row is cut inside the opening sentence, so read as first worded the rule would keep the envelope's head. In a line closed with `…`, a head of the opening sentence from a tag at the line's start or after a space counts as the opening (decision 9's purpose: nothing from the envelope's opening on is kept). A line not closed with `…` is matched only on the whole sentence. The task review found a cut right after the tag's closing bracket uncleaned; fixed (`60af4bc4f`), with a case at every prefix length of the opening. Its bounded consequence: a closed line ending in ` […` keeps only the words before the `[`.
  - *Where tests live:* the window test that reads the recall and Edit's prefill is `src/renderer/src/lane-a/joined-answer-older-host.test.ts`, because `tsconfig.node.json` typechecks `transcript/model` and the test reaches the composer; `tsconfig.web.json` lists the new `test/support/recorded-joins.ts`. The shared split's recorded cases split build G's frozen events, the producers' real output; the node project cannot import the renderer's `journalToEvents`.
  - *A fourth changed expectation* beyond point C's three, following decision 7 as written: an envelope beside a block no attachment draws (`container_upload`) now leaves that block as the person's message, which draws as master draws such a message (a user row with no text); U4b drew no row. Not reachable from MAWS's composer. Reported to the architect.
  - *Master not merged* at Concrete Steps 1: the architect's brief for this run says merge nothing until it names a head.
- **2026-11-15 (UTC) · The architect: a waiting message with an attachment is never the stack's answer row.** A message waiting in MAWS's queue (`next`, `after`, `held`, and one being sent) that holds MAWS's answer envelope beside any attachment block is not drawn as the answer row; it stays an ordinary message with its ordinary controls, as the rule ruled for grant sentences has it. Built in M2 in `src/renderer/src/composer/queue/stack.ts` (`answerWords`' callers), red first. The document was silent: "Unchanged readers" held the stack's reading as one member by construction, which an attachment beside a pasted envelope breaks.
- **2026-11-15 (UTC) · M2's executor's decisions, folded by the plan executor.**
  - *The normaliser's split* sits in `Emitter.emit` (the former body a private `push`), so every caller, a gap's reseed included, passes it; a reseed's events, already split by `recordToEvents`, come back as the same objects.
  - *The backfill's split* runs over `recordToEvents`' result after `withWaitingWords`, so an envelope's event takes the row's next ordinal after every event the row makes, the waiting words' included; a later part copies the split event's base and takes only a new id. The first part keeps the event's id, an envelope's too when no person's part is left.
  - *The undone input's later parts* are `<uuid>#part<n>`, which collides with neither `#undone` nor the backfill's `#<n>` (Interfaces D's "a suffix").
  - *The stack's rule* reads "an attachment block" as any block whose type is not `text`; the rule covers `next`, `after`, `held` and the row being sent; the `handed` row keeps its reading. One function (`waitingAnswer`) and three call sites.
  - *The rewind's recorded response* is seq 771, the wire's frame the normaliser reads ("Engine facts" corrected in place; 772 is the probe's meta row).
  - *U4b's stand-in for the file route* (`joined-answer.test.ts`, "its capsule is Answered from the joined line alone") dropped every message holding the envelope's text, which after M2 also dropped the joined replay's own envelope event; its filter now keeps that one event (a replay under the joined uuid). The real file route is pinned by `joined-answer-routes.test.ts` and M1's older-host test.
  - *The routes test's id check* on the file route sets the rewind anchor's `prefillText` aside, the one value this landing changes there; its own case pins it.

## Outcomes & Retrospective

Pending — written at finish.
