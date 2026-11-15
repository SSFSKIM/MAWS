# UX wave · U1, third landing (U1c): "Approve and retry" for a call auto mode blocked

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U1 (`docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, cited below as *the child's file*), its third landing, **U1c**, for item l4-approvals-12 (the child's acceptance line A15). **Parent pin:** master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`, the commit every statement about the code below was checked against; the root, the child's file and the register are read at that commit.
>
> **Branch:** `ux-wave/U1c`, from that commit. **Board ticket:** 594. **The design is the child's file**, under "l4-approvals-12 · Approve a call that auto mode blocked, from its row": the button, the sentence it sends, the row's words, the repeated block and its one line, the routes. This document settles how that sits in today's code. Where the code contradicted the section, the architect has ruled; the rulings are in "Ruled" and in the Decision Log.
>
> **Revision 2 (2026-11-15).** The adversarial review of the first writing (`433a6e9fd`) returned seven findings, four of them on consent itself, and the architect ruled on them and on the ten points the first writing reported. What moved: an approval survives the engine's joining of waiting messages, on the live route and from a file; the button stands only beside the whole subject of its grant; the state that keeps a second press from sending is a store that ends on evidence; the terminal route is offered state by state and only where probe T recorded the sentence honoured; during a turn a grant is sent for after the turn until probe B says the next step is honoured; a call that is not a plain shell command gets no button until probe C answers, and an MCP tool's call none in this landing; only a classifier block's advisory row is dropped; new grants use the engine's own encoding. The milestones are five, and the one for the terminal route is now M4.
>
> **Revision 3 (2026-11-15), at the build edge.** The probe set answered (T, B, C, D, E; `54dd334a4`) and the architect ruled on it and on the four places revision 2 built otherwise than written (rulings A to K, Decision Log 7 to 19). What moved: a grant during a turn goes at the next step (`GRANT_DURING_TURN` `'next'`, probe B, 27 of 27); the terminal route is offered in all three states (probe T, 9 of 9), and M4 is built for all three; the line names its subject whole only up to 200 characters; M1's joined rows, M2's file-route rows and M4's bridge rows are the recordings; a subagent's rows keep no button, for a corrected reason; a named call (probe C, honoured) is still a later landing's.
>
> **Not in this landing:** anything of U1's other landings (the placement of requests, U1b; which of MAWS's tools load up front, U1d); a list of recently blocked calls outside the transcript; any change to what auto mode blocks; a button on the turn line's "N auto-denied" count; an allow rule written for the call (the child's file, "Why this, not that"); a button for an MCP tool's call or on a subagent's rows; keeping a blocked row in view through its turn's fold (card 3).

## Purpose

In auto mode the engine's classifier can block a call. The call is then over, and today the person can only type an instruction or change the mode. On today's build the blocked row is also hard to read: over the probe's own recorded session its label is 1,183 characters long, because it carries the whole text the engine wrote for the model, and on a session MAWS runs a second row repeats 1,093 characters of the same text (Surprises, 1 and 2).

After this landing the row of a call auto mode blocked reads ``Auto mode blocked: `cmd` `` and carries one button, **Approve and retry**. A press sends the session the engine's own grant sentence as a message. The transcript draws that message as one line, ``You approved `cmd` ``, the row reads ``Auto mode blocked: `cmd` · approved``, and the agent's retry is a new row below. If the retry is blocked again, its row says so, offers the button once more and explains in one line that a rule that always denies blocks every time. The classifier's stand-in reason is shown nowhere. The button is only a send, so it can work for a session MAWS runs, a terminal session and a session on another machine; it is offered where a recording shows the sentence honoured, and elsewhere it is drawn disabled with a sentence that exists today.

**The one principle.** This button is the one control in the wave that consents to a call a safety check refused. So three things hold everywhere in this document. (a) It is drawn only beside the complete thing it consents to. (b) It is offered only where a recording shows the sentence is honoured as the person's. (c) "Approved" is said only on evidence, and that evidence survives everything the engine does to a waiting message.

How to see it working: launch the app on the recorded session `spikes/protocol-probe/fixtures/uxwave/u1-soft-seeded-1.jsonl` (scene S1 of M5), send a prompt, click "1 auto-denied" on the turn's line, press **Approve and retry**, and watch the row read approved, the line appear and the command run. The same over `u1-hard-seeded-1.jsonl` ends on "Auto mode blocked again".

## Progress

- [x] (2026-11-15) Document written against master `63c97b5c0`; two checks of today's behaviour run on the build VM (Surprises 1 to 4).
- [x] (2026-11-15) Adversarial review (seven findings) and the architect's rulings; revision 2.
- [x] (2026-11-15) Probes T, B, C, D and E answered on `ux-wave/U1c-probes`, merged into this branch at its final head `54dd334a4`; the architect's rulings at the build edge (A to K) recorded (Decision Log 7 to 19) and written into the places they name. The values B and T move are moved in M3 and M4, each in a commit that names its recording.
- [x] (2026-11-15) M1 — the grant as the reader knows it: the engine's encoding, both forms, several in one message, and the join. Commits `3fde30f1b`..`f1ad201ef` (one fix wave: rows beside a message withdrawn with it, an attachment beside grants kept), reviewed clean.
- [x] (2026-11-15) M2 — the row's words, what an approval names, and what the transcript's rows say of it. Commits `aa6fe8a0c`..`f8e14627c`, one fix wave `ca0456b35`..`2aa7b5f91` (the opened detail of a blocked call draws none of the engine's refusal text), reviewed clean.
- [x] (2026-11-15) M3 — the button, its subject, the press and the waiting row. Commits `5f3e2fb9f`..`9260461d2` (`GRANT_DURING_TURN` moved to `'next'` in `9260461d2`), one fix wave `e9708ba9e` (Decision Log 33, 34), reviewed clean.
- [ ] M4 — the terminal route, state by state. Built `2d4aa2fc6`..`a1ccab4ca` (the three values turned in `f4af7fa35`, `9452168c4`, `a71e4cdc2`); under review.
- [ ] M5 — the scenes, the whole suite and the acceptance run.

## The landing's edge

**In.** The grant sentence in the engine's encoding, read in both forms, singly, in the engine's plural form and as one part of a message the engine joined; the blocked row's words (the reason cut out of the engine's text, the stand-in sentences dropped, "again", "· approved"); a classifier block's advisory row no longer drawn once its call's row says it; what an approval names for a shell command; the rule by which a row reads approved, read from the transcript's rows; the button, the whole subject beside it, its press through the session's own send, and the store that keeps a second press from sending; the waiting message's row above the composer; the terminal route in the states probe T recorded honoured; the scenes.

**Left to U1's other landings, to a later landing, or to nobody.** The permission prompt the engine raises at the third block in a row is an ordinary request: U1a drew its card and U1b places it. A call named by its whole input (a file write, a shell call with execution flags) and an MCP tool's call get no button here: probe C recorded such a grant honoured, and how the whole subject of a call stands beside its button is a later landing's design (ruling I); a subagent's rows get no button (ruling J; tracker rows of M5). The blocked row stays inside its turn's fold, reached by the turn line's count (card 3).

**What this document assumes of the landings in flight.** Each may reach master before or after this one; the list is checked again when the other is on master, and the second to land merges master first (root UC-8).

| landing (branch at authoring) | what it changes in a file this landing touches | what this document assumes |
|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b`, `0f746a7a5`) | `transcript/view/cells/CellLine.tsx`: a hook `useWaitsForApproval` and `data-waiting` on the cell; `transcript/model/rows.ts`, `schema.ts`, `copy.ts`, `derive.ts`, `reduce.ts`, `keys.ts`, `transcript.css` in other lines | A blocked call never waits for approval (its call is over), so the two states of `CellLine` cannot hold for one cell: the label of §D applies when `waiting` is false, and the control is drawn after the line whichever lands first. U1b's `keys.ts` gains the end row's id; this landing adds one id form beside it. U1b removes the `request_slot` row; nothing here names it. |
| U2b, the to-human view (`origin/ux-wave/U2b`, `33434fb2d`) | `transcript/view/Transcript.tsx`, `TranscriptSlot.tsx`, `transcript/model/derive.ts`, `reduce.ts`, `rows.ts`, `owner-marks.ts`: the transcript's fold | A blocked row inside a working record folds with it, as it folds with its turn today. The rule of Design 3 reads the store's rows (`entries[key].rows`), before any projection, so a fold changes nothing it answers. This landing edits `derive.ts` in two places (the rows of a person's message that carries grants; one predicate in the `notice.posted` case). |
| U4b, the composer's integrations (`origin/ux-wave/U4b`, `1095a33f0`: its execution document, no code yet) | `composer/queue/stack.ts`: the row's `answer` becomes its words or null, `answerWords`, three entries of `STACK_WORDS`, `rowText`, and `isAnswer` goes; `stack-acts.ts`: `Read` gains `questions`; `QueueList.tsx`: the one test of `row.answer`, and three titles | This landing's insertions (§G) are one more field on the rows that have content (`grant`), one more branch of `rowText`, one more skip in `newestToTake`, and in `QueueList.tsx` the controls of a grant's row. A text is never both an answer's envelope and a grant, so the two branches of `rowText` are independent; whichever lands second keeps both. |
| U6b, the file beside the chat (`origin/ux-wave/U6b`, `74aad04a6`) | `transcript/view/context.tsx`: one member of `TranscriptActions` | This landing adds one optional member to the same interface; the two are independent lines. |
| U10b-3, the chat bar over a surface (`origin/ux-wave/U10b-3`, `f05930ca3`) | `composer/frame/`; `e2e/panel.spec.ts` | No file in common. Where the conversation is folded to its bar the transcript is not drawn, so no blocked row and no button; nothing is added to the bar. |
| U5b, Review as one scroll (`origin/ux-wave/U5b`, `d94d75b8f`) | the code harness | No file in common. |

## Ruled

The first writing reported ten points and the review found seven. Each is ruled (2026-11-15); the section named holds what is built.

| ruling | what it is | where |
|---|---|---|
| F1 | An approval survives the engine's joining of waiting messages, live and from a file. Whether the engine honours a grant inside a joined message is probe B's second question. | Design 2; §C; M1 |
| F2 | The button stands only beside the whole subject of its grant. | Design 6; §E; M3 |
| F3 | The state that keeps a second press from sending is a store, independent of any mount, and ends on evidence. Two presses in two windows inside one round trip stay possible: a tracker row. | Design 4; §F; M3 |
| F4 | Probe T gates the terminal route state by state; M4 does not start before it answers. | Design 7; M4 |
| F5 | An MCP tool's call gets no button in this landing. A built-in tool named by its whole input waits for probe C. | Design 3; M2 |
| F6 | Only a classifier block's advisory is dropped, and only once the call's own row exists. | Design 1; M2 |
| F7 | New grants use the engine's encoding; the reader reads that form and the plain one. | Design 2; §C; M1 |
| 1, 2 | The reader's insertions for the terminal route are accepted, behind F4's gate. | M4 |
| 3 | See F1 and probe B, which answered yes (27 of 27): during a turn a grant goes at the next step (ruling C). | Design 5 |
| 4 | Other tools: F5, which stands though probe C honoured a named call 6 of 6 (ruling I). A subagent's rows get no button: the grant never reaches the subagent, and the main loop runs the command in its own context (probe D, ruling J). | Design 6 |
| 5 | The reason is cut as Claude Desktop cuts it. The advisory row: F6. | Design 1 |
| 6 | The row behind its turn's fold is built as the child's file says, and is card 3. | Cards |
| 7 | The insertion in U4's stack is a named insertion. | §G |
| 8 | The model's insertions are accepted; the desk web app's drawing is a named difference. | Design 8 |
| 9 | A host of build F marks no grant: accepted, with F3's fallback. | Design 4, 7 |
| 10 | The four readers that meet an approval row: unchanged, one tracker row. | Design 9 |

Four rulings are built otherwise than written, and the Decision Log says how and why. The join needs no edit of `reduce.ts` and does need one of `derive.ts` (entry 2). "The button on the line" is the button directly under a line that wraps to show the subject whole, since the line is itself a button and clips at a width no model knows (entry 3). The join's fallback sends every grant during a turn for after it, not only while another message waits, and that is the shipped value (entry 4). And ruling F7's case as the review states it does not arise, though its encoding is built (entry 6). At the build edge the architect accepted entries 2, 3 and 6, entry 3 with a bound of 200 characters (Decision Log 7, 8, 10), and probe B superseded entry 4 (Decision Log 9).

### What a probe's answer changes

The probes run on `ux-wave/U1c-probes` (engine 2.1.322, auto mode held, one `autoMode.soft_deny` marker rule, the gateway route, never on the MacBook), their recordings under `spikes/protocol-probe/fixtures/uxwave/` and their answers in `spikes/protocol-probe/`: `findings-uxwave-u1c-terminal-grant.txt` (T), `findings-uxwave-u1c-during-turn.txt` (B), `findings-uxwave-u1c-other-tools.txt` (C), `findings-uxwave-u1c-subagent.txt` (D) and `findings-uxwave-u1c-both-forms.txt` (E), merged at `54dd334a4`. Nothing below is offered before its recording exists: every place ships at the value that needs no unrecorded consent.

| probe | its question | the one place | shipped value | a "yes, three of three" changes |
|---|---|---|---|---|
| T-a | A grant the bridge delivers to an idle terminal session: does the retry run? | `TERMINAL_OFFERED.idle` in `blocked-call/grants.ts` | `false` | the value; M4 starts; Acceptance 7a; scene S4's first part |
| T-b | The same, five seconds into a 30 s foreground call of the turn | `TERMINAL_OFFERED.running` | `false` | the value; Acceptance 7b; S4's second part; the appended row's insertions of M4 (§C, 7 and 8) are built only when T-b or T-c is honoured |
| T-c | The same, after an Esc during such a call | `TERMINAL_OFFERED.stopped` | `false` | the value; Acceptance 7c; S4's third part |
| T-d | The terminal's own `/permissions` › "Recently blocked" retry: what row does it leave in the transcript file (its origin, `isMeta`, its text)? | the origins `userRow` reads a grant on, in `arrival.ts` | not read | A recorded row lets a later landing read it; nothing here changes (What is not proven, 3) |
| B-1 | A grant written at the next step (`priority: 'next'`) while the blocked call's turn runs: does the retry run? | `GRANT_DURING_TURN` in `blocked-call/grants.ts` | `'after'` | `'next'`, only together with B-2 |
| B-2 | A grant that waits at the next step beside an ordinary message, and two grants waiting together, so that the engine joins them: is each grant honoured? (The session's transcript file is kept, for the joined row.) | the same constant | `'after'` | with B-1: `'next'`; then Acceptance 11 and scene S3 read "Next step" and Delete is a steer's withdrawal (Design 5 gives both forms) |
| C | A `Write` outside the working folder is blocked; the grant names `{ tool, input }` as the engine's own list does: does the retry run? | `blockedCallOf` in `transcript/model/blocked.ts` | commands only | the `call` branch of Design 3 is built in a later landing with its own tests; nothing in this landing changes |
| D | A block inside a subagent | — | no button on a subagent's rows | nothing here; recorded for a later landing |
| E | One classifier block kept as journal and as transcript file | the constructed rows of M2's file-route test | constructed | the recorded file replaces them |

A probe that answers anything but three of three leaves its place at the shipped value. If T answers no for every state, M4 is not built and the terminal route keeps its disabled button.

**Answered (2026-11-15; rulings B to K).**

- **T-a, T-b, T-c: yes, 3 of 3 each** (9 of 9; `u1c-t-idle-1..3`, `u1c-t-busy-1, -2, -4`, `u1c-t-esc-1..3`). M4 turns each `TERMINAL_OFFERED` value to `true` in a commit that names its recording; Acceptance 7a to 7c and S4's three parts stand; the fourth card of Design 7 does not arise. T-d is not asked in this landing (ruling A4).
- **B-1, B-2: yes, 27 of 27** (`u1c-b-*`), the joined cases 9 of 9. M3 moves `GRANT_DURING_TURN` to `'next'` in a commit that names the recordings; Acceptance 11 and S3 read "Next step". The two recorded forms of several waiting messages are in Design 2.
- **C: yes, 6 of 6** (`u1c-c-mcp-1..3`, `u1c-c-write-1..3`). Nothing here changes: this landing names plain shell commands only (ruling I); the recordings serve a later landing.
- **D:** the grant never reaches the subagent (6 of 6); the main loop runs the command itself, in its own context (5 of 6). No button on a subagent's rows stays (ruling J); what such a row reads today is in "What the code holds today".
- **E:** `u1c-e-1.jsonl` and `u1c-e-1.transcript.jsonl` hold one block, its grant and its retry in both forms, and replace M2's constructed file-route rows (ruling H).

### Cards for the owner

**Card 1. After you press "Approve and retry" while the agent is still working, what should the blocked row show until your approval has reached the agent?**
- *The button greys out until the agent has it* (recommended, and what is built). The approval waits above the composer like any message; there you can send it now or delete it. When the agent reads it, the line "You approved …" appears and the row reads "· approved". If you delete it, the button comes back.
- *The row reads "· approved" at once.* One state fewer on the row, but it says approved while the message may still sit in a held queue, and before any "You approved" line is in the transcript.
- *Place:* `readsApproved` in `transcript/model/blocked.ts`, which the label and the control both ask.
- **The owner's answer (2026-11-15):** "Button greys out (Recommended)". While the approval waits above the composer the row's button is greyed and cannot be pressed twice; the row reads approved once the agent has read it. Built as answered (Decision Log 32).

**Card 2. While that approval waits above the composer, what should its row there read?**
- *One line, "You approved `cmd`", with Send now and Delete* (recommended, and what is built). It reads as the line the transcript will draw, and it cannot be edited into something else.
- *The message as it will be sent.* The engine's whole sentence ("Permission granted for this exact command only, as one whole string: …"), two lines of it, with Edit as on any waiting message. Nothing is built in the stack.
- *Place:* §G (`stack.ts`, `QueueList.tsx`).
- **The owner's answer (2026-11-15):** "\"You approved cmd\" (Recommended)". The waiting row above the composer reads "You approved <command>", with Send now and Delete. Built as answered: a waiting grant's row draws Send now and Delete and no More menu, so no Edit and no move (`QueueList.tsx`, `row.grant`); the stack's uncertain row of a grant keeps U4a's own controls, Resume, Edit and Delete, and its Edit only puts the sentence in the box (Decision Log 30, 32).

**Card 3. A blocked call's row sits inside its turn's fold, and the turn's line says "1 auto-denied". Should a blocked call that nobody has approved stay in view?**
- *Yes, while it is in the session's newest turn* (recommended; not built in this landing). The moment after a block is the moment the button is for: the agent has stopped and is asking. A button two clicks away, behind a small count, will mostly lose to typing "go ahead", and the typed words name no exact command. It stays only until it is approved or the next turn starts, so at most the newest turn's unapproved blocks are ever in view. It needs the fold rule (`isPersistentRow` in `derive.ts`, and the to-human view's working record), which is U2's, so it is a landing of its own after this one.
- *No: the count is the way to it* (what is built, as the child's file says). Nothing more on screen; the person who wants the row clicks "1 auto-denied".
- *Yes, every one, always.* Rejected as a recommendation: a long session would keep every block nobody cared about in view for good.
- *Place:* the fold rule, in a later landing; this landing builds the second option.
- **The owner's answer (2026-11-15):** "Yes, in the newest turn (Recommended)". A blocked call that nobody has approved stays in view under the newest ended turn's line; an older turn's stays folded. It is board ticket 703's (blocked by this landing), and nothing of it is built here: this landing keeps the turn line's count that leads to the row (Decision Log 32).

The look needs no drawn example before it is built: one quiet button, one muted line and, for a subject the line cannot show whole, one block of monospace text, inside an existing row and in today's tokens. The owner sees the states (offered under its line, offered under its subject, greyed, approved, blocked again) on the screenshots of M5's scenes; the subject's block is a look decided on safety grounds (ruling F2) and is part of that look.

## What the code holds today

Line numbers are at the pin and are for the reader of this section only; an executor finds the function.

| piece | where, and what it does at the pin | is the child's statement still true? |
|---|---|---|
| The reader's `consent` class and `consentMessage` (U3a) | `src/shared/engine/arrival.ts`: `consentMessage(kind, subject)` (`:87-92`) builds the sentence, the subject quoted with `JSON.stringify`; the private `consentOf(text)` (`:95-108`) matches a text whole, by equality with what `consentMessage` builds, and gives `{ class: 'consent', kind, subject }`; `personsText` (`:164-169`) asks it for a row of origin `human` (`userRow`, `:141`) and for a `queued_command` attachment of origin `human` whose prompt is a string (`attachmentRow`, `:283`). The live normaliser asks the reader for the frame MAWS writes (`engine-host/normalizer.ts`, `userOut`) and puts `arrival: [consent]` on the `user.message`; the file reader does the same (`engine-host/fs/backfill.ts`, `consentOf`). | True for one grant in a message of its own, on a session MAWS runs and in its transcript file. Not where the bridge carried it (ruling 1), not for a message the engine joined (F1), and not for the engine's own encoding of a subject with invisible characters or its plural form (F7). The sentence is the engine's (`cli.pretty.js:521384-521387`, `Yn`) and is byte for byte the content of all ten recorded grants' `out` frames, compared at authoring. |
| The engine's joining of waiting messages (U4a) | When a turn starts from the engine's queue, every message waiting at the next step goes in as one `user` message, the texts joined by one newline, under the last one's uuid (`findings-uxwave-u4-send-now-cases.txt`; `u4p2-two-*`, `u4p3-end*`); the transcript file has one row for them. `Normalizer.userIn` forwards that replay as one `user.message` with `joined`, the other members' uuids, and no `arrival` (`replayJoins`, `engine-host/normalizer-send-now.ts`); `Batch.join` (`transcript/model/reduce.ts`) puts it in the first member's place and removes the others. A message at `priority: 'now'` is never joined, and a message read at a tool boundary is a `queued_command` of its own. | The child's file does not know the join. A grant that waited beside another message loses its mark today (F1). |
| The "You approved" line (U3a) | `transcript/model/derive.ts`: `consentOf(event)` (`:1535-1539`) gives the `user` row a `consent` field from the event's first consent mark, for a message that is not synthetic; `transcript/view/rows/User.tsx` draws `ConsentLine` for it in place of the bubble (`:52-66`), the words `CONSENT.approved` in `copy.ts` (`:258`), the subject as inline code. `serialize.ts` copies it as one line. | True for a message that is one grant. A message that held a grant and other words would draw the line and lose the words (Design 2). |
| The file reader's mapping of a refused call's kind (U2a) | `engine-host/fs/backfill.ts:416-419`: `denial` is read from the row's `toolDenialKind` through `denialKindOf` (`normalizer-support.ts:76-79`), for a row that holds exactly one result. The live reader reads `tool_result_meta[].non_execution_kind` through the same function (`normalizer.ts:446`). Rows of another machine's terminal session are mapped in this window by the same `recordToEvents` (`lane-a/plane-transcript.ts`, `eventsOf`). | True: on master, with its test. This landing adds no mapping. |
| The row's label (`cellLabel`) | `transcript/model/copy.ts:117-143`: for `disposition: 'auto_denied'`, ``Auto mode blocked: `subject` `` then ` · review unreadable` for `automode-parsing-error`, else ` · reason`. The label is built in `labelOf` (`cells.ts:379-382`), its subject the command, the file path or the tool's name; its `reason` comes from `cellOf` (`cells.ts:448`) as the result's whole trimmed text. The line's label is one line, clipped with an ellipsis (`.transcript-cell-label`, `transcript.css`). A refused file change's detail shows no diff (`EditDetail.tsx`). | The words are as the child's file says; the "reason" is the whole result text (ruling 5); and a clipped label or a path does not show what a grant would name (F2). |
| The engine's advisory for a refusal | The wire's `system/permission_denied` is mapped to `notice.posted` keyed `permission_denied:<tool use id>` (`engine-host/normalizer-system.ts`), which the transcript draws as a row; a transcript file has none. The engine sends it for a classifier block and for other denials alike. | Not named by the child's file. Over the recordings it repeats the stand-in reason beside every blocked row (Surprises, 2). |
| A subagent's blocked call (probe D, `findings-uxwave-u1c-subagent.txt`) | Its error result reaches the main wire with `parent_tool_use_id` and `agent_id` and a `tool_result_meta` entry that holds the decision only, with no `non_execution_kind` (6 of 6), so the live reader (`denialKindOf`) gives it no denial: in the subagent's transcript it reads as a call that failed, and the wire's `permission_denied` advisory (with `agent_id`) is drawn beside it, since its result carries no `automode-blocked` (Design 1). The subagent's own transcript file carries `toolDenialKind: "automode-blocked"` (6 of 6), so where its rows are read from that file the row is a blocked call and reads the short label of Design 1. The main transcript file holds no such row. M2 confirms each reading over `u1c-d-after-1` and corrects this row where it differs. | Not named by the child's file. The two routes read one row two ways; this landing leaves both as they are (ruling J), M5 adds one tracker row, and neither draws a button (Design 6). |
| The session's send | `session/controls/`: one port per session (`controlsFor`), `send(content, options)` and `capability('send')`; `sendToSession` (`controls-for.ts:121-124`) for a caller outside the composer, refusing in the holder's words when no port drives the session. A session MAWS runs: `sendHumanPrompt` (`composer/submit/send-human-prompt.ts`), which acquires a released session, sends when idle, steers at the next step while a turn runs, and with `when: 'after'` leaves the message in the host's queue for after the turn. Another machine's: one invocation (`sendWithoutAcquiring`), the same option. A terminal session: `laneA.send` through the bridge (`controls/lane-a.ts`), which keeps no queue and refuses `when: 'after'` during a turn. | True: "it is only a send". |
| The waiting messages | `composer/queue/stack.ts` (`stackRows`): the rows above the composer, read from the host's queue (`stores/queue.ts`, published to every window that shows the session) and the transcript's `unread` mark; a waiting row offers Send now, Delete and Edit, an answer's row Send now only. A terminal session's send whose fate the bridge has not named is held in the pending-send strip (`stores/lane-a.ts`, `pendingSends`). | The child's file leaves the wording of a waiting message to U4; ruling 7. |

Claude Desktop, checked at `app-5.1231.2`: the stand-in sentences it treats as no reason are a set of four (`web/app/v1/c62da1b56-Cmxkc-l_.js:424-429`); it cuts the reason out of the result text between the fixed opening and ". If you have other tasks" (`:473-484`), normalises white space and cuts at 1,000 characters (`:450-462`); its row reads "Blocked by auto mode" alone or with the reason (`:541-575`); it recognises a blocked call from the row's `toolDenialKind` or the result meta's `non_execution_kind` (`web/app/v1/c06cf64bb-DOE498Hm.js:3573-3603`). The lines say what the child's file says of them.

## The design

### Words used here

A **blocked call** is a tool call whose result carries the denial kind `automode-blocked`. The **grant** is the message "Approve and retry" sends: the reader's `consentMessage(kind, subject)`. An **approval row** is a `user` row with `consent`, the one that draws ``You approved `cmd` ``. A call's **name** is the pair `{ kind, subject }` a grant for it carries; its **key** is that pair as one string. The **record** is what a reload, and every other window, would still hold: the transcript's rows, the session's queue as its host publishes it, and a terminal session's pending sends. A grant is **read** when its approval row carries no waiting mark; it **waits** while the record holds it unread. A message is **joined** when the engine wrote several waiting messages as one (U4a, decision 32). The three **routes** are the root's law 5. **Build F** is `f1852de3a`; **the VM** is the wave's build VM, reached with `~/.local/share/maws-ux-wave/tools/vmcheck.sh`. Below, *Design N* is a numbered section of this design and *§X* a section of Interfaces and Dependencies.

### 1. What the row reads

The label of a blocked call is, in order: ``Auto mode blocked: `subject` ``, or ``Auto mode blocked again: `subject` `` when the row is blocked again (Design 3); then ` · reason` when the classifier gave one; then ` · approved` when the row is approved. The subject is what today's label names. The words are exact in §A.

The reason is the classifier's own, cut out of the engine's text the way Claude Desktop cuts it: the text must open with the engine's fixed opening, the reason runs to ". If you have other tasks", its white space is normalised, and it is no reason when it is one of the four stand-in sentences or the text does not open that way. A reason longer than 1,000 characters is cut at a word and ends in "…". Through the gateway the reason is always the stand-in (fifteen of fifteen recorded blocks in `u1-soft-seeded-*`, `u1-hard-seeded-*` and `u1-streak-seeded-*`: 5, 6 and 4), so there the row reads ``Auto mode blocked: `cmd` `` alone. This is one function, `classifierReason`, and `cellOf` calls it for the kind `automode-blocked` only: every other refusal's label is as today. A call the classifier could not judge (`automode-parsing-error`) keeps ` · review unreadable` and gets no button: nothing was judged, so there is nothing to consent to.

**The advisory row** (ruling F6). The engine's advisory for a refusal reaches the transcript as a notice keyed `permission_denied:<tool use id>`. It is not drawn when, and only when, the turn that holds it also holds that call's result with the kind `automode-blocked`: then the call's own row exists and carries the reason, on every route. Until the result arrives the advisory is drawn, and it leaves when the result does arrive. Every other advisory stays as today: a permission rule's, a hook's, a call of kind `automode-parsing-error` (whose row drops the reason, so the notice may be the only explanation, as for a refused edit), a stopped or unavailable review, an advisory whose call has no result, and one outside any turn.

### 2. The grant: its encoding, its forms, and the join

**The encoding** (ruling F7). The engine quotes each subject as JSON and then escapes every invisible or separator character but the plain space as `\uXXXX`, one escape per UTF-16 unit (`cli.pretty.js:521378-521385` of 2.1.322: the class `(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]`, `Pp`, `Yn`). `consentMessage` does the same from M1 on, so a no-break space or a zero-width character in a command is visible in the sentence the model reads. For a subject of printable ASCII the two encodings are one string, so the ten recorded grants stay byte for byte what `consentMessage` builds, and a test says so over all ten.

**The forms the reader reads.** One function, `readConsents(text)`, reads a whole text as grants and answers them in order, or none:

- the sentence for one call, its subject quoted in the engine's encoding or in the plain one (`JSON.stringify` alone), which is what builds before this landing sent and what a person may paste;
- the engine's own sentence for several calls ("these exact commands … each as one whole string: "a", "b" … any part of these … running them … retry these exact commands", and the same with "calls"), in either encoding, which gives one grant per quoted string.

A text is a grant only whole: it is rebuilt from what was parsed, in each encoding, and must equal the text. So the reader recognises the plural form where a person's own send carries it. No control of MAWS sends it: a press sends one sentence for one call.

**Whose text is read.** As today, only the person's own send: a row or a queued prompt of origin `human`, and the frame MAWS itself writes. One thing is added for the join: when the whole text is no grant and holds a line break, each line is read, and every line that is a whole grant sentence gives its grants. The engine joins waiting messages with exactly one line break and a grant sentence holds none (its subject is quoted), so in a joined message each grant is one line. A person who types such a line among other words has typed the grant, which is the reader's rule already (U3's file).

**The join, on the live route** (ruling F1). The host remembers, by uuid, the consent marks it put on each frame it wrote. When the engine's replay joins several of them, the one `user.message` the host forwards carries the marks of every member, in the joined order. The marks come from what the host itself wrote and nothing is read from the joined text, so no text gains a mark it did not have.

**The join, as recorded** (probe B, ruling C). Several messages waiting at the next step take one of two forms, and the engine honoured every grant in both. *Mid-turn*, with a tool boundary still ahead, they are NOT joined: each is replayed on the wire with its own uuid and its own text, and each is its own `queued_command` row of origin `human` in the file, in the order written (`u1c-b-join-grant-first-*`, `u1c-b-join-other-first-*`, `u1c-b-two-*`; 9 of 9). *At the turn's end*, with no tool boundary left, they are JOINED: the file holds one `user` row of origin `human` whose text is the texts in the order written with one line break between, under the SECOND frame's uuid; on the wire the first frame's uuid is replayed with its own text alone, then the second's with the joined text (`u1c-b-joinend-grant-first-*`, `u1c-b-joinend-other-first-*`, `u1c-b-twoend-*`; 9 of 9). M1 checks today's `replayJoins` against that recorded wire form before building on it; a difference goes to the architect.

**The join, from a file.** The file holds one row for the joined messages, of origin `human`, and the per-line reading above finds each grant in it.

**What the transcript draws of a person's message that carries marks.** Today a message with a mark is drawn as the approval's line, in place of its bubble. From M1 the model reads the message's text by lines:

- one mark, and no words but its sentence: one approval row, as today, under the message's own id and uuid;
- words besides the grants: the message's own row is the bubble, with the grant lines taken out, and each grant is an approval row after it, in order;
- several grants and no other words: the first takes the message's own row and the others follow as approval rows.

An approval row made beside its message has no message uuid (it is no point to rewind to, and no prompt to edit) and an id of its own form. If the lines cannot be matched to the marks, the bubble keeps the whole text and every mark still gets its approval row, so no approval is lost to a text this rule did not foresee. This is why the fix is in the message's rows and not in the reducer: `Batch.join` already puts the joined message in its place whatever it carries, and the loss was that one row can show one grant or one bubble (Decision Log, 2).

**What a join does not reach.** A terminal session's messages go through the bridge and are not joined. A host of `2c7044231` forwards a joined message without marks, and reads only the plain form of one grant whole; a host of build F marks nothing (Design 7).

### 3. What an approval names, and how a row knows it was approved

**The name.** One function, `blockedCallOf(toolName, input)`, gives a call's name, by the engine's own rule for its "Recently blocked" list (`cli.pretty.js:1242837-1242850` and `:1242901-1242905`): a shell call (`shellToolOf`: Bash, PowerShell) whose input holds a non-empty `command` and no other key but `description`, `timeout`, and `run_in_background` or `dangerouslyDisableSandbox` set false, is `{ kind: 'command', subject: command }`, the command whole and unchanged. Every other call has no name in this landing, and its row no button:

- a shell call with an execution flag set, and a built-in tool's call (a file write, an edit), which the engine names by the compact JSON of `{ tool, input }` under a bound of 4,096 units: probe C recorded such a grant honoured (6 of 6), but its row does not show its whole input (ruling F2), and how it would is a later landing's design (ruling I);
- an MCP tool's call: the name on the wire is the engine's sanitised one, and the engine's grant names the original server and tool, which the store does not hold (ruling F5; probe C honoured such a grant 6 of 6, ruling I; a tracker row of M5).

`cellOf` puts the name on the cell (`Cell.blocked`) for a call of kind `automode-blocked`, from the recorded call's input. The engine's list of shell tools was read in the bundle by its use, not its definition; `shellToolOf` is MAWS's reading of it (What is not proven, 5).

**The rule.** One pure function, `blockedStates(rows, hidden)`, reads the transcript's rows in order and answers, for each blocked call's row that has a name, that name and two facts. With *k* the row's key, and counting only rows outside a hidden branch (a rewound turn's rows prove nothing about what the session holds now):

- **again:** an approval row for *k* stands before it, read or waiting, and not dropped.
- **grant:** `read` when an approval row for *k* stands after it that is not dropped and carries no waiting mark (`pending`, `unread`); else `waiting` when one stands after it that waits; else `none`.

An approval row is a `user` row with `consent`, and nothing else: the mark is the reader's, put on by the host or the file reader that saw whose row it was. A `user` row does not say whose it is, and a peer's text that no reader claims is drawn as one too, so a row's text is never read for a grant here. The row reads **approved** exactly when `grant` is `read` (`readsApproved`). Nothing else makes a row approved: not a press, not the queue, not a later run of the same command.

Why the rows, and not the turn's derivation: the grant is rarely in the turn that holds the block, so a rule inside `deriveTurn` needs an index in the reducer, a re-derivation of every turn that holds the key, and an order across turns, pages and hidden branches. The flat row list is already in order, an approval row stays in view through every fold, and a blocked row needs its state only while it is drawn. So the rule is one pass over rows the store already holds, memoised on the rows' identity, and the model's turn memo is untouched. Two consequences are accepted. A blocked row drawn while an older page is not loaded reads "blocked" where it would read "blocked again", until that page is loaded; "approved" is never wrong for a drawn row, because every row after it is loaded with it. And the copied transcript (`serialize.ts`) carries the row's base words, with the approval's own line after it.

A later run of the same command does not retire the button, and several blocked rows of one key all read the same: a grant after them approves each. The sentence only permits a retry, and nothing in a folded turn's rows could say on every route that the call has since run.

### 4. The press, and the grant that is out

A press calls the session's own send with the grant: `sendToSession(appSessionId, consentMessage(kind, subject), options)`, the options of Design 5. Nothing else is sent, on any route, and no new command, offer or event exists. What is sent is the name the rule read from the store's own row, never the drawn cell's.

The send is awaited, and its answer and the record arrive on different channels. So the window keeps, in a store keyed by session and key, **a grant out**. Its only effect is to keep the button closed; it never makes a row read approved. It belongs to no mounted row: folding the turn, scrolling the row out of the list or closing the pane does not end it (ruling F3). It ends on evidence only.

| state | event | next | what a mounted row shows |
|---|---|---|---|
| none | press, with the gate open | sending; it remembers `rows`, how many approval rows the transcript holds for the key | the button, disabled |
| sending | the send answers `sent`, `steered`, `queued` or `unconfirmed` | delivered | the button, disabled |
| sending | the send answers `refused`, or throws | none, with a notice: the answer's `reason`, or the error's message | the button, enabled, and the notice under it |
| sending, delivered | the transcript holds more approval rows for the key than `rows` | none | what the record says: approved, the button disabled while the grant waits, or the button again when the grant was dropped |
| delivered | the record lists a waiting grant for the key outside the transcript (Design 5) | delivered; its clock is stopped | the button, disabled |
| delivered | no such grant is listed | delivered; its clock runs from the first moment none is listed | the button, disabled |
| delivered | the clock reaches `SETTLE_MS` (5 s) | none | what the record says |
| none, with a notice | a press | sending, no notice | — |

"The approval rows the transcript holds for a key" counts every one, read, waiting or dropped, that stands after the pressed blocked row (`approvalsFor`, from the press's remembered cell; where a closed turn folded that cell away, over that one turn's expanded rows; only when no held turn holds the call, every approval of the key in the held rows, which is correct or an undercount; Decision Log 33). The linearisation point of a press is the synchronous step that puts "sending" in the store before the send is called; a second press, on this row, on another row of the same key, or on the same row mounted again, finds the gate closed and sends nothing.

The evidence is the transcript's own approval row, which every grant that reached a session leaves wherever its host marks it. The clock is the fallback for what leaves none, and it counts from the delivery's outcome, not from the press: the send is acknowledged and the queue no longer lists the grant. It serves a host that marks no grant (build F, where the button then returns), a grant deleted from the queue before it was written, and the moment between a queue entry's release and its row. A send that never answers stays out: the port's own bounds end every send (a host's command deadline, the bridge's 5 s answer, the link's hold). After a reload nothing is out, and the record alone decides.

**Other windows.** A second window on the session reads the same record: a grant that waits in the queue disables its button too, because the queue's snapshot is published to every window, and an approval row approves there as here. What the record does not cover is two presses in two windows inside one round trip, before either's send has reached the host. Both grants are then delivered, as two messages of any kind would be. Closing that needs the host to refuse a second grant for a key it already holds, which is a change of the send's contract; it is not made in this landing and is a tracker row of M5.

### 5. While the grant waits, and during a turn

A grant **waits** for a key when the record holds it unread: an approval row after the block that carries `pending` or `unread`; an entry of the session's queue that is not released, or a steer the queue lists, whose text holds a grant for the key (`personsGrants`, the reader's reading of the person's own text); a pending send of a terminal session, in the state `sending` or `unconfirmed`, whose text holds one. While a grant waits the button is drawn disabled, and the message is where every waiting message is: above the composer.

**During a turn** (ruling 3, probe B, ruling C). A grant written at the next step while the blocked call's turn runs was honoured 27 of 27, the joined cases included (`findings-uxwave-u1c-during-turn.txt`, `u1c-b-*`). So on a session MAWS runs, here or on another machine, the press sends as Enter does: with no turn running it is sent at once, and with one running it is a steer at the next step. One constant holds this, `GRANT_DURING_TURN`, `'next'` from M3 on (its commit names the recordings); `'after'` is its other value.

- *As built (`'next'`).* The stack's row carries the mark "Next step"; Delete is the steer's withdrawal, which drops the grant's row, so the button returns at once; the agent reads the grant at its next tool boundary, in the same turn. A grant may then be joined with another waiting message, which Design 2 draws and reads.
- *The other value (`'after'`).* The press passes `when: 'after'`: the host keeps the grant in its queue and sends it alone when the turn has ended. The stack's row carries the mark "After the turn" (or "Held" when the queue is paused); Send now sends it as a `now` message, which the engine never joins; Delete takes the entry out of the queue, and the button returns when the clock of Design 4 has run.

**When the grant is read** (probe B). A next-step message is taken at the first tool boundary after it is queued. A grant written the instant the block arrives is queued just after that block's own result was handed back, so it is read at the NEXT call's result, in the same turn, however long that call runs (33 s and 27 s in the recordings); the greyed button and the waiting row last until then. If no tool boundary remains (the turn ends in a written reply), the grant waits to the turn's end and starts the next turn, where the retry runs.

A terminal session keeps no queue: there a grant during a turn can only go at the next step, as an appended row, which is state `running` of Design 7.

**Above the composer**, a waiting grant's row reads ``You approved cmd``, the words of the line it becomes, with Send now and Delete, and no Edit and no move: an edited grant is no grant (ruling 7, card 2). A waiting message that holds a grant among other words is the person's own message and reads as any message.

The readers of "a message of this session waits" today are `stackRows` (with `readOfEntry` in `stack-acts.ts`), `withQueueTail` in `derive.ts` and `PendingSends.tsx`. The gate does not go through `stackRows`, which words rows for drawing and leaves out a submission younger than 300 ms; it reads the same stores for every moment.

### 6. Where the button stands, and what stands beside it

**Beside its whole subject** (ruling F2). The button is drawn only where the subject of its grant is shown whole, exactly as the sentence will quote it. There are two cases, and one function decides between them (`lineNamesWhole`):

- *The line names it whole.* The grant is a command of at most 200 characters (`LINE_SUBJECT_MAX`, beside `lineNamesWhole`) with no line break and no backtick, and the command the row's line draws is that same string. Then the line of that row wraps in place of clipping, with its white space kept, so the whole command is on the line at any width, and the button stands directly under the line.
- *Otherwise* (a command of several lines, one longer than 200 characters, so that the row's line never grows to many lines, one that holds a backtick, which the line's code marks would break, or one a mod's rewrite draws differently): under the line the row shows the subject itself, the string the sentence quotes, whole, in the monospace face, its lines and spaces kept, in a block that scrolls beyond twelve lines; the button stands under that block.

The button cannot stand inside the line: the line is itself a button, the row's disclosure. And whether a clipped line happens to fit is a fact of the pane's width that no model holds and no unit test can see, so the line is made to wrap where it names the subject, and the rule is one of strings alone (Decision Log, 3). A call with no name (Design 3) has no button and nothing said: the row reads as a blocked row.

**Where it is drawn.** The control is drawn inside the blocked call's own line component (`CellLine`), for a cell that carries `blocked`, in a session's own transcript (`variant: 'session'`), where the mount supplies it. So it follows MAWS's drawing of the call: where a mod draws the call itself, the mod's drawing stands (law 2) and there is no button. It is not drawn in a subagent's transcript (ruling J: the grant never reaches the subagent, 6 of 6; the main loop takes it and runs the command itself, in its own context, 5 of 6, which does not continue the subagent's work and is not a retry of its step; `findings-uxwave-u1c-subagent.txt`), in the desk web app or the harness (no mount supplies it), nor on a row of a hidden branch.

**Its gate** has four values, by precedence: **approved** (no button; the label says it); **closed**, a grant is out or waits (the button, disabled); **unavailable**, the route does not offer it now (the button, disabled, its `title` the reason); **open**. One function, `gateOf`, decides it. The reasons are sentences that exist today: the port's own answer to `capability('send')`, the function the composer, the comment card and both ports' `send` already read; `heldWords` where no port drives the session; and for a terminal session's state that is not offered, the words of Design 7.

Under a row that is blocked again and still offers the button, one muted line explains the repetition (§A). It leaves with the button.

### 7. Routes (root law 5)

| route | the row | the press | offered | what closes the button, in whose words |
|---|---|---|---|---|
| A session MAWS runs here | The wire's `non_execution_kind`; from its transcript file after a relaunch, the row's `toolDenialKind`. | `session.send` (after `session.acquire` for a released session), with `when: 'after'`: sent at once when idle, kept in the host's queue during a turn. The host marks the grant as it writes it. | Yes: the recorded case (ten grants, five of five honoured under a rule that can be overridden). | `capability('send')`: the process starting or ended, a holder elsewhere. A send's refusal: a trust or relay step (the card's words), the host's error. |
| A session MAWS runs on another machine | The events of that machine's host. | As Enter sends there (Design 5, Decision Log 29): one invocation of `session.send` over the offer of that name (`src/endpoint/offers.ts`, `laneB('act')`) with no turn running or no status held, one `session.steer` at the next step with a running status held, each graded `converse` by effect (`src/shared/ipc/grades/session.ts`); the waiting row keeps the link's existing rules for a steer (Delete refused where the endpoint lacks the act; no Send now over the link). | Yes: the same engine path on that machine. | Main's overlay for `send` (`remote.session`): the link down, the member's grade; a grade refusal in `READER.notSent`'s words. |
| A terminal session, here or on another machine | The file's `toolDenialKind`, read as it is written; another machine's rows are mapped in this window. | `laneA.send`: the bridge submits the words as the user when the session is idle, and appends them into a running turn or after a Stop (`findings-uxwave-u5-terminal-text.txt`). On another machine through main's remote adapter and the offer `sminos.send`, graded `converse` by effect. | **State by state, by probe T** (ruling F4): every state, 9 of 9 (`u1c-t-*`, ruling B), from M4 (`f4af7fa35`, `9452168c4`, `a71e4cdc2`). | No bridge: `heldWords` ("Held by …"). A state not offered: below. A bridge that cannot deliver: the bridge's reason. `unconfirmed`: the pending-send strip, and the button closed while it holds the words. |

**The terminal route's states.** The bridge carries a message three ways, and the engine frames them differently: a row submitted as the user when idle; a row appended into the running turn, which the classifier's transcript frames as `non-user` (`cli.pretty.js:1339192-1339224`, `j9`); and after a Stop the appended row and then the bridge's wake. Probe T recorded the retry running in each of them three times of three (`findings-uxwave-u1c-terminal-grant.txt`; idle `u1c-t-idle-1..3`, during a turn `u1c-t-busy-1, -2, -4`, after an Esc `u1c-t-esc-1..3`). The button is offered in a state by one table, `TERMINAL_OFFERED`: M3 writes it with every state `false`, and M4 turns each to `true` in a commit that names its recording. The window knows the state by one function, `terminalStateOf`: `running` when the bridge says a turn runs or does not know (`turn.running`, `turn.unknown`); else `stopped` when the transcript's newest turn reads stopped; else `idle`. The words of a state that is not offered exist today:

| what is not offered | the button's `title` |
|---|---|
| no state (a value turned back; between M3 and M4 it was every state) | `LANE_A_WORDS.widget`: "Not available for a terminal session" |
| `running`, while `idle` is offered | `TERMINAL_KEEPS_NO_QUEUE`: "A terminal session takes a message at its next step; MAWS cannot hold one for after the turn" |
| `stopped`, while `idle` is offered | no sentence of today fits; if probe T answers so, the words are a fourth card for the owner, with the default "Not available right after a Stop in a terminal session" |

With every state offered from M4 on, the two lower rows stand only for a value turned back, and the fourth card does not arise (ruling B).

**During a turn on the terminal route** (rulings B, K). The appended grant reaches the model in the request after the running call's result, as a plain text block, without the wrapper the engine puts around a person's mid-turn message, and was honoured 3 of 3. So a terminal session reads the grant only at the running call's result, and the waiting state can last the whole length of that call. Why the classifier accepts a plugin's row, which its transcript frames `non-user` (Surprises, 5), as the person's consent is not visible, and may change with the service (What is not proven, 1).

M4 builds the reading of the bridge's rows for the states T honours, all three, and nothing for the others: a state that is not offered sends no grant through the bridge, so nothing there needs reading. The terminal's own `/permissions` › "Recently blocked" stays the way to approve in a state that is not offered; the row it leaves is not read here (What is not proven, 3).

**Authority.** The grant is a message, and the machine grades it as words, where the act runs, on the text it runs (`textGrade`'s floor, `converse`). It is not graded as a permission decision (`approve`), on purpose: the engine takes any go-ahead in the person's words as consent to a blocked call, so a higher grade on this one sentence would guard nothing a `converse` member cannot type. A member whose machine refused them at `view` has the port closed (`gated`, `controls-for.ts`), so the button is drawn disabled with the reason and whom to ask.

**A peer on each build.** The offers `session.send`, `session.steer` and `sminos.send` exist with the same grade at this build, at master `2c7044231` and at build F (`git show <sha>:src/endpoint/offers.ts`), and all three hold a message sent during a turn in the host's queue, so the press crosses the link to all three. What comes back differs:

| the session's machine runs | a session MAWS runs there | a terminal session there |
|---|---|---|
| this build | the host marks the grant, in either encoding, joined or not; line, approved | rows mapped here (M4, in the states offered) |
| master `2c7044231` | its host marks one grant in a message of its own, in the plain form: a command of printable ASCII reads approved; one with an invisible character, which this build sends in the engine's encoding, is not marked there and behaves as on build F | rows mapped here; the same |
| build F | no mark: the grant is the person's bubble, the row does not read approved, and the button returns when the clock of Design 4 has run | rows mapped here; the same |

Seen from a window of an older build, a session of this build shows the grant as U3a's line (`2c7044231`) or as the person's bubble (F, which drops the `arrival` key it does not know), and the blocked row with today's long label and no button.

*Tests:* the two ports' sends with a fake client (M3: one invocation, its name, its content and its option; the refusals); an event without the mark, which leaves the row unapproved and ends the grant-out state by its clock (M2, M3). No scene is added to `e2e/remote.spec.ts`: no code on the link's path changes.

### 8. Stored and sent, and the desk web app

**Root UC-14.** This landing stores nothing: no layout key, no setting, no file, no field of a stored form, and no wire minor. The grant-out store is the window's memory and is never written. It sends one message, whose text is the grant, through commands every build has. What an older build can meet is that text where any message's text is kept: a session's journal and transcript file, the queue's state file while the grant waits (`QueueState.entries[].content`, a string, read by F and by `2c7044231` as an ordinary queued message and sent as one), and a terminal session's rows. A joined `user.message` now carries `arrival` beside `joined`: both keys are U3a's and U4a's, a reader of `2c7044231` knows both, and F drops both. A run of this build, then F, then this build leaves a queued grant queued and a sent grant in the transcript, where this build reads it again. No cross-build run is owed: no stored form changes and no minor is taken, so neither the two-build run nor the equal-wire run has a scene of this landing's to run. The coverage table (U13a's M5) gains no row.

**The desk web app** (`apps/desk-web`) draws through the same reader, model and view, and mounts no control. After M2 it draws, for a blocked call, the short label with its reason, "again" and "· approved" as this window does, and no advisory row for a classifier block; for a grant, U3a's line, now also for a grant in a joined message; and no button and no subject block, because no mount supplies them. That is the named difference for the pull request. Its typecheck, build and test project are in every milestone's proof, and its e2e group is in the final Mac set: `conversation.spec.ts` and `reconnect.spec.ts` cross the reader and the transcript's rows.

### 9. One reading of each fact

| fact | the one function | who reads it today |
|---|---|---|
| what kind a call's refusal is | `denialKindOf` (`engine-host/normalizer-support.ts`), from the wire's `non_execution_kind` and the file row's `toolDenialKind` | `Normalizer` (the result branch), `recordToEvents`; then `classifyTool` and `denialDisposition` (`classify.ts`), whose answer on the cell (`classification.denial`) is read by `cellOf`, `labelOf`, `stoppedMember`, `caption.ts`, the turn's summary (`denialOfCell`), `CellLine`'s `asLabelled`, the attention service (`automode-unavailable` only) and `computer-use/reading.ts`. This landing reads `classification.denial.kind` on the cell, and the result's `denial` for the advisory's predicate; it adds no reader of the raw fields. |
| the grant's sentence, and whether a text is one | `consentMessage`, `readConsents` (today's private `consentOf`, widened) and `personsGrants` in `arrival.ts` | the reader's `personsText`; the normaliser's `userOut`; the file reader. This landing's other callers: `grants.ts` and `stack.ts`, each for a message that waits and has no row yet; the model's reading of a marked message's lines (Design 2); and M4's insertions. |
| whether a session takes a message now, and why not | `SessionControls.capability('send')`; `heldWords` with no port | `Composer.tsx`, `composer/editor/submit.ts`, `side/comment-form.ts`, each port's `send` |
| what a call is named in a grant | `blockedCallOf` (new) | `cellOf`, once per blocked call |
| whether a blocked row is approved, waits, or is blocked again | `blockedStates` (new) | `CellLine` (the label), the control |
| whether the button is offered | `gateOf` (new), over `TERMINAL_OFFERED` and `terminalStateOf` | the control |
| the classifier's reason | `classifierReason` (new) | `cellOf` |
| which messages wait | the stores of Design 5 | `stackRows`, `withQueueTail`, `PendingSends.tsx`; the gate (Design 5 says why not through `stackRows`) |

**The readers that meet an approval row for the first time** (ruling 10). No approval row existed before this landing sends one. Each of these is unchanged, and one tracker row of M5 names the four:

| reader | what it shows for an approval row |
|---|---|
| the rewind list (`widgets/RewindWidget.tsx`, `rewindTargets`) | It lists the grant among the person's prompts, by the row's text, which is the whole sentence. Rewinding to it is a true rewind to that message. An approval row made beside a joined message has no uuid and is not listed. |
| the refusal dialog's "Edit prompt" (`request-card/initiating-prompt.ts`) | When the turn a refusal interrupted was opened by a grant, "Edit prompt" names the grant and would put its sentence in the box. |
| the newest-prompt cursor (`composer/edit-prefill.ts`, `newestUserUuid`) | A grant is the newest message the person sent, which is true of it. |
| the to-human view's lead (`owner/report/project.ts`) | The grant opens its turn as its prompt row, so the approval's line stands above that turn's working record. |

### Why this, not that

- **The approval read from the turn's derivation** (an index in the reducer, as U1b's answer join). Rejected: Design 3. It would also put this landing's edits in `reduce.ts` beside two landings in flight.
- **Approved from the press.** Rejected by the brief and by a reload: the sent message is the only record.
- **A new origin, command or offer for the grant.** Rejected: "it is only a send" is what makes three routes one behaviour; `origin: 'answer'` is an existing provenance and only `'composer'` is branched on.
- **The marks of a join kept by the reducer.** Rejected: the reducer already puts the joined message where it belongs; what was missing is the marks on that message (the host's) and a row model that can show a message and its grants (Design 2).
- **The grants kept out of the joined message on the live route** (forwarding only the other members). Rejected: the live route and a reload from the file would then hold different messages under one uuid.
- **A handle per send** (the message uuid, the queue id, the delivery key) to know when the record has caught up. Rejected for the count of Design 4: three followers, one a route, where one count of the transcript's approval rows and one clock serve every route.
- **A host-side refusal of a second grant for a key.** Not in this landing: it changes what a send answers, on the wire (Design 4, "Other windows").
- **The subject shown only when the row is opened.** Rejected: the button would be hidden with it, and a button that shows without its subject is what ruling F2 forbids.
- **Words for the waiting state on the row** ("Approval waiting"). Rejected as the default: the stack already names the wait, and a new sentence is the owner's to choose (card 1).
- **Dropping every advisory row.** Rejected by ruling F6: for other refusals the advisory can be the only explanation drawn.

### What is not proven

1. Why the service's classifier takes a grant the bridge delivered as the person's consent, in each of the three states (probe T: 9 of 9, for a plugin's row its transcript frames `non-user`), and a grant appended during a turn, which reaches the model as a plain text block without the wrapper of a person's mid-turn message (3 of 3). Both are behaviours of the service on the recording date and may change with it (rulings B, K).
2. Recorded (probe B, 27 of 27): a grant read at the next step of the blocked call's turn, and a grant inside a joined message, in both forms. Unrecorded: a grant joined with a message whose content is blocks (7 below), and Send now on a waiting grant's row during a turn.
3. The row the terminal's own "Recently blocked" leaves. In the bundle it is sent as a meta message of origin `auto-continuation` (`cli.pretty.js:521751-521766`), not as a row of origin `human`, so the reader does not read it in either encoding, and a call approved in the terminal keeps its button in MAWS until the retry has run or the person presses. Reading it needs a recording first (probe T-d, not asked in this landing); this is also why ruling F7's case, a native grant that fails the reader for its encoding, does not arise on the route the review names. The encoding is built all the same, for what the model reads and for a grant a person pastes.
4. Recorded, and not built on here: a grant naming an MCP tool's call or a file write, honoured 6 of 6 (probe C, `findings-uxwave-u1c-other-tools.txt`; ruling I), and a block inside a subagent (probe D, `findings-uxwave-u1c-subagent.txt`; ruling J).
5. Recorded (probe E): `u1c-e-1.jsonl` and `u1c-e-1.transcript.jsonl` hold one block, its grant and its retry in both forms (`findings-uxwave-u1c-both-forms.txt`), and M2's file-route tests read them (ruling H).
6. The engine's list of shell tools, read by its use. If it holds a tool `shellToolOf` does not, that tool's blocked call has no name and no button.
7. How the engine joins messages whose content is blocks and not a string (an attachment beside a grant). The rule of Design 2 then falls back to the whole text and still draws every marked grant.
8. Recorded (probe B): the joined row as a transcript file holds it (`u1c-b-joinend-*.transcript.jsonl`, `u1c-b-twoend-*.transcript.jsonl`); M1's file case reads those files.
9. Whether the engine's count of consecutive blocks runs across turns. The row's line for a repeated block is the child's text either way.
10. The engine's plural sentence. No recording holds it (probe B: no row of any probe holds "these exact commands", "these exact calls" or "each as one whole string"); the reader's plural form is read from the bundle, not recorded (ruling C).

## Acceptance

The child's line A15, as behaviour. Items 1 to 4 are over the probe's recordings; each item names where it is proven.

1. **Approve, and the retry runs** (`u1-soft-seeded-1` to `-5`). After the block the row reads ``Auto mode blocked: `curl -s -o marker-N.txt "https://example.com/?maws-probe-marker-N"` `` with nothing after it, and carries **Approve and retry**. From the frame MAWS writes for the grant on, at every prefix of the journal, the row never offers the button again; once the grant is read the row ends in ` · approved`, the line ``You approved `curl …` `` stands in the next turn, and the retry is a row that ran. The grant the press builds is byte for byte the recorded `out` frame's content, in all ten recordings that hold one. *(M1 for the sentence; M2 by prefixes; M3 for the press; scene S1.)*
2. **Blocked again** (`u1-hard-seeded-1` to `-3`). The first row reads approved; the retry's row reads ``Auto mode blocked again: `curl …` ``, carries the button, and under it the line "A rule that always denies this command blocks it every time. Change the rule or the mode to run it." *(M2, M3; scene S2.)*
3. **Two blocks in a row, then the engine asks** (`u1-streak-seeded-1`, `-2`). Two blocked rows, each with its own button and neither "again"; the third and fourth calls are ordinary calls that ran, and their requests are ordinary permission requests (`decisionReasonType` `classifier`). Nothing is built for them. *(M2.)*
4. **No block, no row** (`u1-norule-seeded-1`, `-2`): no blocked row and no button; the grant the probe sent there still draws as the approval's line.
5. **No stand-in, and the advisory only where the row says it.** Over all fifteen recorded blocks no row's text holds "it gave no explanation". At the prefix that holds a block's advisory and not yet its result, the advisory is drawn; from the result on it is not. A reason that is not a stand-in is shown: a result text with the engine's opening and an invented reason reads ``Auto mode blocked: `cmd` · <that reason>``. An advisory whose call never gets a result, one for an edit refused as `automode-parsing-error`, and one for a call a permission rule denied are each still drawn. *(M2.)*
6. **The same from a file, and after a reload.** One session as its journal and as its transcript file (`u1c-e-1.jsonl`, `u1c-e-1.transcript.jsonl`, probe E) gives the same row states from both, applied whole, in two batches split at the grant, and in a fresh state. *(M2.)*
7. **A terminal session, state by state.** Probe T honoured all three states (ruling B), and from M4 every `TERMINAL_OFFERED` value is `true` (`f4af7fa35`, `9452168c4`, `a71e4cdc2`); against the recorded rows: **7a** `idle`, the press reaches the bridge once with the sentence whole, and the row the bridge submitted as the user draws the approval's line and reads the block approved, from the file and from another machine's rows alike; **7b** `running`, the same for the appended row and its mirror line; **7c** `stopped`, the same for the appended row, the mirror line and the wake. A state left `false` keeps its disabled button, with the words Design 7 gives for it. *(M3 as shipped; M4 per state; scene S4.)*
8. **Another machine.** The press sends as Enter does there (Decision Log 29): one `session.send` with the sentence as its content when no turn runs or no status is held, one `session.steer` at the next step when a running status is held; a refused Delete over the link leaves the grant out and the button disabled until the grant is read or the clock runs; with the overlay's `send` closed the button is disabled and its `title` is the overlay's reason; an event without the mark (a host of build F) leaves the row unapproved, and the button returns when the clock has run. *(M3, M2.)*
9. **Two presses send one grant, in one window.** With the send held open, a second press on the same row and a press on another row of the same key send nothing. With the row unmounted and mounted again while the send is unanswered, the button is still disabled and a press sends nothing. With the send answered and the transcript's row withheld, the same, for as long as the grant waits in the queue and for `SETTLE_MS` after the queue stops listing it. When the transcript then shows the grant's row, the row follows the record at once. When the clock runs out with no row, the button returns. A window that never pressed draws the button disabled while the queue's snapshot lists a grant for the key. *(M3, with fake timers and a send that resolves on command.)*
10. **A refused press says why.** A send that answers `refused`, or throws, leaves the button enabled with the answer's words under it, in a row mounted afresh too; the next press clears them. *(M3.)*
11. **While it waits, during a turn.** With a turn running on a session MAWS runs, the press is one `session.steer` at the next step (`GRANT_DURING_TURN` `'next'`, probe B); the row's button is disabled; the stack's row reads ``You approved <the command>`` with the mark "Next step", Send now and Delete, and no More; Delete withdraws the steer and the button returns at once; pressed again, the grant is read at the next tool boundary (the running call's result) and the row reads approved. A waiting grant keeps the button disabled after the pane is mounted afresh. *(M3; scene S3.)*
12. **Where there is no button.** A subagent's transcript; a row of a rewound branch; a call of kind `automode-parsing-error`; an MCP tool's blocked call; a blocked `Write`; a blocked shell call with `run_in_background: true`; a mount that supplies no control. Each draws the row with its short label and no button. *(M2, M3.)*
13. **The button stands beside its whole subject.** For a blocked command of one line the row's line wraps and holds the whole command, and the button is under it. For a command of several lines, and for one that holds a backtick, the row shows the subject in its block, equal to the string the grant quotes, and the button under the block. Two blocked rows whose lines draw the same command while their recorded commands differ each show their own subject in a block and each send their own. *(M3; scenes S1 and S3.)*
14. **A join keeps every approval.** A grant and an ordinary message that waited together, in both orders, and two grants: in both of probe B's recorded forms, mid-turn and not joined (`u1c-b-join-grant-first-*`, `u1c-b-join-other-first-*`, `u1c-b-two-*`) and at the turn's end and joined (`u1c-b-joinend-grant-first-*`, `u1c-b-joinend-other-first-*`, `u1c-b-twoend-*`), one recording of each form for each of the three pairings, live from its journal and from its transcript file, the transcript draws each grant's approval line and the ordinary message's bubble without the grant's sentence, and each blocked row before them reads approved. *(M1 for the rows; M2 for the blocked rows.)*
15. **The encoding.** For a command that holds U+00A0 and U+200B, the grant spells them `\u00a0` and `\u200b`, and the reader reads that text and the plain form of it to the same subject. The engine's sentence for two commands reads as two grants. Either sentence with one word changed reads as none. *(M1.)*
16. **The desk web app.** With no control registered, a blocked row draws its label ("again", "· approved" included) and no button and no block; the approval's line is drawn. Its typecheck, build and tests pass at every milestone. *(M2, M3.)*

## Constraints that bind every milestone

- The rules of `~/.local/share/maws-ux-wave/briefs/build-common.md` bind: no typecheck, lint, test, install, build or Electron on the MacBook; every check on the VM in a checkout of the pushed head; a merge of master, never a rebase or a force-push; commits end with the trailer the brief gives and carry no other attribution.
- **Nothing is offered on an unrecorded consent.** `TERMINAL_OFFERED`, `GRANT_DURING_TURN` and the commands-only rule of `blockedCallOf` ship at the values of "What a probe's answer changes", as the answers of 2026-11-15 move them: `GRANT_DURING_TURN` to `'next'` (M3) and each `TERMINAL_OFFERED` state to `true` (M4), each in a commit of its own; the commands-only rule stays (ruling I). A value moves only in a commit that names the recording under `spikes/protocol-probe/fixtures/uxwave/` and its count, and rewrites the acceptance item and the scene the table names for it. An executor does not move one on the bundle's reading or on a default.
- The engine is the pinned 2.1.322 and is not patched (charter D-1). Every statement about what it sends rests on a file under `spikes/protocol-probe/fixtures/` or on the bundle read as a reference, and the design says which; an executor who needs a fact neither holds stops and reports it.
- Root law 5: every behaviour is stated per route (Design 7). Root law 7: today's tokens and shapes; no colour or geometry is added. Root UC-6: no chord is added. Root UC-11: the repository is public; test content is invented, and nothing of a real session, journal or settings file is read or copied.
- Root UC-8 and UC-3. The files of other owners this landing edits, each by the smallest insertion, all named here. Added at the build edge: `src/renderer/src/stores/transcript.ts` (`hold(key)`, Decision Log 34) and P5 O9's `src/renderer/src/lane-a/conversation/delivery-frame.ts` (one optional key on `asQueuedPrompt`'s row, Decision Log 38). U3's: `src/shared/engine/arrival.ts` (§C, 1 to 3 in M1; 6 and 7 in M4), `src/engine-host/normalizer.ts` and `normalizer-send-now.ts` (§C, 4), `src/engine-host/fs/backfill.ts` (§C, 8, in M4), and in the transcript's model the rows of a person's message, `transcript/model/derive.ts` and `keys.ts` (§C, 5). U4's: `src/renderer/src/composer/queue/stack.ts` and `QueueList.tsx` (§G). The transcript's view: `transcript/view/context.tsx`, `transcript/view/cells/CellLine.tsx`, `transcript.css`. The transcript's model: `cells.ts`, `rows.ts`, `schema.ts`, `copy.ts`, and one predicate in `derive.ts`. `src/renderer/src/App.tsx` (one registration). `reduce.ts`, `groups.ts`, `classify.ts`, `Transcript.tsx` and `TranscriptSlot.tsx` are not edited.
- Root UC-14: nothing is stored and no wire minor is taken (Design 8). An executor who finds a need for either stops.
- The words a person reads are those of §A, exact. A guard reads renderer source for `#` followed by hex digits as a colour: a ticket is written in words ("ticket 594").
- The desk web app's three checks (§ Concrete Steps) are part of every milestone's proof.

## Plan of Work

Five milestones, each on the one before. M1 is the reader's and the host's; M2 is pure and changes what every route draws; M3 is the control; M4 is the terminal route and waits for probe T; M5 is the scenes and the acceptance.

### M1 — The grant as the reader knows it

**What exists at its end.** A grant is built in the engine's encoding and read in both; the engine's plural sentence is read; a grant that the engine joined with other waiting messages keeps its mark, on the live route and from a file; and the transcript draws a person's message that carries grants as its bubble and one approval line for each. With today's callers nothing on screen changes but for those cases, since nothing sends a grant yet.

**What it touches.** `src/shared/engine/arrival.ts`; `src/engine-host/normalizer.ts` and `normalizer-send-now.ts`; `src/renderer/src/transcript/model/derive.ts` and `keys.ts`; and their tests (`arrival.test.ts`, `normalizer-arrivals.test.ts`, `normalizer-send-now.test.ts`, `backfill.test.ts` for the file's joined row, `transcript/model/arrivals.test.ts`, `transcript/view/rows/notice.test.tsx`).

**Interfaces.** Exposes §C, 1 to 5: `consentMessage`, `readConsents`, `personsGrants`, the marks on a joined `user.message`, the approval rows of a message. Consumes nothing.

**Decisions.** §C. `readConsents` replaces the private `consentOf`; its three callers in the reader move to it. The host's memory of the marks it wrote is beside the digests `replayJoins` already keeps, bounded, and forgotten with them. The model matches a message's lines to its marks by `readConsents` and nothing looser. The reducer is not edited (Decision Log, 2).

**What it does not touch.** The reducer; any row but the person's message row; the reader's other classes; the file reader beyond what the reader's answer already gives it (`consentOf` in `backfill.ts` forwards every consent mark today).

**What it proves.** Acceptance 14's rows, and 15. Beyond acceptance: the ten recorded grants equal `consentMessage` of their commands and read as one grant each; a subject with a line break, a quote and a backslash round-trips in both encodings; a lone surrogate and a private-use character are escaped as the engine's class escapes them; the plural sentence with a quoted `", "` inside a subject; a grant line inside a peer's message, a task's notification, and a row of origin `plugin` gives no mark; on the live route the marks of a joined message are the members' own, in order, and a joined message none of whose members was a grant carries none; a joined message of three (`u4p3-end3-1`'s frames) with the grant in each place; the message's rows when the lines cannot be matched to the marks; the recorded joins' own tests (`normalizer-send-now.test.ts`, "the messages the engine joins") unchanged. The rows of a grant beside another message are probe B's recordings, not constructed rows (ruling C): one recording of each form (mid-turn, not joined; at the turn's end, joined) for each of the three pairings (grant first, the other first, two grants), live from its journal and from its transcript file, each asserting the rows Design 2 names (the bubble without the grant line and one approval row per grant; two approval rows for two grants).

### M2 — The row's words, what an approval names, and what the rows say

**What exists at its end.** A blocked call's row reads the short label on every route, with a real reason when the classifier gave one and none of the stand-ins; a classifier block's advisory row is gone once its result is in; each blocked command carries the name a grant would give it; and `blockedStates` answers, from rows alone, which blocked rows are approved, wait or are blocked again. `CellLine` draws "again" and "· approved". No button yet.

**What it touches.** New: `src/renderer/src/transcript/model/blocked.ts` and its test. Edited: `transcript/model/cells.ts` (`cellOf`: the reason, the field), `rows.ts` and `schema.ts` (`Cell.blocked`), `copy.ts` (`cellLabel`'s two inputs, the words of §A), `derive.ts` (the advisory's predicate, in the turn's `notice.posted` case), `transcript/view/cells/CellLine.tsx` (the label). Tests that pin today's label and change: `copy.test.ts` (the `auto_denied` cases gain the two inputs), `fixtures.test.ts` (the `denials` journal's blocked call reads without its invented text, which does not open as the engine's does), `reduce.test.ts` (the label list of its four refused calls), and any snapshot of rows that holds the long label or a classifier block's advisory (the executor finds them with the suite of the folders below).

**Interfaces.** Exposes §A, §B and the label half of §D. Consumes M1's approval rows.

**Decisions.** `blockedStates` is memoised on the rows array and the hidden turns (a `WeakMap`), and is asked by a store selector that answers `undefined` at once for a cell that is not a blocked call, so an ordinary cell pays nothing. The label is recomposed in the view through `cellLabel`, with the subject from one helper that `labelOf` also calls, never by editing the label's string. The `denials` journal is not edited (other suites read its events); the real-reason case is a unit case through `cellOf`. `Cell.blocked` is written only when present, so every stored snapshot of a cell without it still parses. The advisory's predicate reads the turn's own results; a notice outside a turn is not touched.

**What it does not touch.** The reducer, the fold rules, the turn's line and its counts, `classify.ts`. No button, no store, no send.

**What it proves.** Acceptance 1 to 6 at the model's level, 14's blocked rows, 12's first six cases, and 16's label. Beyond acceptance: `classifierReason` over each of the four stand-ins, a reason with inner white space, one longer than 1,000 characters, and a text without the opening; `blockedCallOf` over a plain command, a command with `description` and `timeout`, one with `run_in_background: false`, and null for one with `run_in_background: true`, for an MCP tool and for a `Write`; the rule over a dropped approval (the button returns), a waiting one (`waiting`), an approval in a hidden branch (not counted), two blocked rows of one key before one approval (both approved), a block, an approval and a block inside one turn; a `user` row without `consent` whose text is the grant, which is no approval row. The file route reads probe E's recording, `u1c-e-1.jsonl` beside `u1c-e-1.transcript.jsonl`, in place of constructed rows (ruling H). Over `u1c-d-after-1` (journal and the subagent's own transcript file), a test pins what a subagent's blocked row reads on each route today ("What the code holds today"), unchanged; the executor reports the size of making the two routes agree and does not build it (ruling J).

### M3 — The button, its subject, the press and the waiting row

**What exists at its end.** The control of Design 6 beside its subject, with the gate, the press and the grant-out store of Design 4, the waiting state and the turn-time sending of Design 5, and the stack's row of §G. On a terminal session the button is drawn disabled with its words (the table of Design 7, every state `false`).

**What it touches.** New: `src/renderer/src/blocked-call/` (`grants.ts`, `ApproveAndRetry.tsx`, `index.ts`, tests). Edited: `transcript/view/context.tsx` (one optional member), `transcript/view/cells/CellLine.tsx` (the mount, the wrapping line), `transcript/view/transcript.css` (the control, the subject's block, the wrapping line), `src/renderer/src/App.tsx` (the registration, beside the other transcript-action registrations), `composer/queue/stack.ts` and `QueueList.tsx` with their tests.

**Interfaces.** Consumes §A, §B, `readConsents`, `personsGrants`, the session's port (`sendToSession`, `sessionControls`, `heldWords`, `drivenByBridge`), the queue store, the lane A store and the transcript's store. Exposes §D's control, §E, §F, §G.

**Decisions.** The control is supplied to the transcript through `registerTranscriptActions`, as the composer's edit actions are, so the transcript's view imports no app store for it and a mount without it draws none. The grant-out state is a store of its own, never cleared by an unmount; while any grant is out it follows the transcript's store, the queue store and the lane A store by its own subscriptions, and drops them when none is. `gateOf` is the only function that decides the gate; `approve` the only one that sends; the three constants of "What a probe's answer changes" are each read in one place. A notice is the port's words, never composed. `GRANT_DURING_TURN` is written at `'after'` with both of its branches tested, then moved to `'next'` in a commit of its own that names `findings-uxwave-u1c-during-turn.txt` and the `u1c-b-*` recordings (27 of 27). Acceptance 8's "no steer" on another machine is checked against what the remote port sends under `'next'`; a difference goes to the architect. `lineNamesWhole`'s bound is pinned at 200 and 201 characters. A subagent's blocked row carries a name on the file route and on another machine's rows (M2, Decision Log 25), so only the control's `variant === 'session'` check keeps a button off it: M3 has a test, red first, that replays the recorded subagent file row (`u1c-d-after-1`'s subagent transcript) and asserts no button, and one for that row as another machine's rows give it. The button is a native `button` with `disabled` and `title`, as the stack's controls are; the muted line and the notice are `role="status"`.

**What it does not touch.** The ports (`session/controls/`), `send-human-prompt.ts`, the offers, the endpoint, the host. No new origin, command or capability.

**What it proves.** Acceptance 7 as shipped, 8 to 11, 13, 12's last case and 16's control. Beyond acceptance: the gate's precedence (approved over closed over unavailable over open) in each pairing; `terminalStateOf` over a running turn, an unknown one, a newest turn that reads stopped and an idle session; the words of each row of Design 7's table, with the table's values set by the test; the name sent is the store's when the drawn cell's props were rewritten; `origin: 'answer'` with `when: 'after'` on a session MAWS runs and without it on a terminal session; a session with no port sends nothing and shows `heldWords`; a queue entry in each state (`queued`, `submitting`, `released`), a listed steer, a pending send in each of its three states, each for the right key and for another key, and a waiting message that holds a grant among other words; the store's subscriptions end when nothing is out; the stack's `rowText`, its controls and its folded line for a waiting grant, a message that only holds a grant line among other words reading as any message, and a waiting answer's row unchanged.

### M4 — The terminal route, state by state

**Probe T honoured all three states** (ruling B), so M4 is built for all three: each `TERMINAL_OFFERED` value is turned to `true` in a commit that names its recording (idle `u1c-t-idle-1..3`; running `u1c-t-busy-1, -2, -4`; stopped `u1c-t-esc-1..3`; `findings-uxwave-u1c-terminal-grant.txt`, 3 of 3 each). Its tests replay the recorded rows, not constructed ones: idle, one `user` row of the plugin's origin with `asUser`; during a turn, an `isMeta` row of the plugin's origin without `asUser`, then the bridge's mirror line; after an Esc, the same two after the interrupted call's rows, then the bridge's wake row. Where a recorded row differs from what §C, 6 to 8, assume, the recording governs and the difference goes to the architect before it is built around.

**A prerequisite before any `TERMINAL_OFFERED` value turns `true`** (M3's review, Decision Log 35): a grant out on a terminal session must keep what its evidence arrives through, as M3's store does for the routes it offers. Another machine's terminal session draws through a plane source that a rebuild replaces (`lane-a/plane-transcript.ts`), and its network watch has its own mount-owned count (`lane-a/remote-source.ts`, `holdRemoteTranscript`), whose last release closes the transcript whatever the transcript store's count. So while a grant is out the store holds that upstream owner and keeps a transcript lease across a source's replacement, released when the last grant settles or the session goes; tests: a pane closed with a grant out, a plane rebuild with a grant out, and the release. An edit this needs in a file the document does not list goes to the architect first.

**What exists at its end.** For each honoured state, `TERMINAL_OFFERED` reads `true` with its recording named beside it; the button is offered there; and the grant the bridge carried in that state draws the approval's line and reads the block approved, from the file on this Mac and from another machine's rows.

**What it touches.** `src/renderer/src/blocked-call/grants.ts` (the table's values); `src/shared/engine/arrival.ts` (§C, 6 for `idle`; 7 for `running` or `stopped`); `src/engine-host/fs/backfill.ts` (§C, 8, for `running` or `stopped`); their tests (`arrival.test.ts`, `backfill.test.ts`), `src/renderer/src/lane-a/arrival-routes.test.ts`, which already draws one text by both file routes, and the blocked-call tests.

**Interfaces.** Consumes `readConsents`. Exposes nothing new: the events are U3a's (`arrival: [consent]` on a `user.message`).

**Decisions.** §C, 6 to 8. An insertion is built only for a state that is offered. The appended row itself is not made an arrival: its words become the person's steer where the bridge's mirror line names them, and the mark is put on that steer, so one message uuid never carries the mark on two events. The reader's first rule gains one clause and its header comment says so. The fourth card of Design 7 does not arise: `stopped` is honoured.

**What it does not touch.** `plane-transcript.ts`, `bridge-rows.ts`, the reducer, the model. No other class of arrival, and no row that today reads as a peer's, a wake or an answer.

**What it proves.** Acceptance 7a to 7c for the honoured states, against T's recorded rows. Beyond acceptance: a bridge delivery whose text is the grant with a sminos frame line before it is a peer's or the person's delivery as today, not an approval; a row of another plugin's origin with the grant's text is no approval; the grant in a row submitted as the user by a plugin that is not a bridge plugin (`BRIDGE_PLUGINS`) is no approval; a peer's inbox message holding the sentence is a peer's message; each built form through `recordToEvents` directly and through the remote rows' path gives the same rows; a state left `false` still sends nothing.

### M5 — The scenes, the whole suite and the acceptance

**What exists at its end.** Four scenes that an agent on a Mac can run, four tracker rows, and the acceptance list checked on the branch's head.

**What it touches.** `e2e/composer.spec.ts` (S1 to S3, in the group `e2e:composer`, which `e2e:c7` also runs), `e2e/support/c7-replay.ts` (a journal for S3), `e2e/lane-a.spec.ts` (S4, the group `e2e:lane-a`), `e2e/support/lane-a.ts` (a refused row's record), `docs/tech-debt-tracker.md`. No new spec file, so the gate's count of spec files and its group lists are unchanged.

**Interfaces.** §H.

**Decisions.** S1 and S2 replay the probe's recordings as they are, through the replay's own handshake adaptation; the replay matches a write by its frame type, so the press's content is read from the `user.message` event, as the composer's scenes read theirs. S3 needs a turn that outlives the block, which no recording holds, so its journal is built by a builder in `c7-replay.ts` from the recorded block's frames and a held tool call, with invented text and a command of two lines. A scene's wait is one of the forms the gate's guard allows (`.github/scripts/gate-plan.test.mjs`, above `LIVENESS_BOUNDS`). The tracker's four rows: a subagent's blocked row, which the live route reads as a failed call beside the advisory and the subagent's own file and another machine's rows as a blocked call (ruling J), with M2's estimate of making them agree (about 15 source lines in `normalizer.ts` and `normalizer-system.ts` or `normalizer-support.ts`, about 60 test lines; gated on an unrecorded engine fact: whether a subagent's `automode-parsing-error` takes the same wire shape, which either inference would misread as a block), named for board ticket 693; the four readers of Design 9, each with what it shows; two presses in two windows inside one round trip, and that closing it needs the host to refuse a second grant for a key; an MCP tool's grant, which needs the original server and tool names in the store and probe C's case for a sanitised name and one that holds the separator.

**What it does not touch.** Product source, unless a scene finds a defect, which goes back as a finding.

**What it proves.** The whole unit suite, once, and the acceptance list by number. The scenes are written, typechecked and guarded here, and run by the architect (Proofs an executor cannot run).

## Concrete Steps

Working directory for every command: the branch's worktree (branch `ux-wave/U1c`; the controller's brief names it). Checks run on the VM in a checkout of the pushed head, so commit and push first; the helper prints `vmcheck: ux-wave/U1c at <short sha>` and exits with the command's status, so it is never piped into `head` or `tail`.

    git fetch origin master && git merge origin/master

Then re-read "What this document assumes of the landings in flight" against whatever the merge brought, and after any merge run the milestone's own set again.

At every milestone, the desk web app's three checks:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm --filter desk-web typecheck && timeout 900 pnpm --filter desk-web build && timeout 900 pnpm --filter desk-web test'

M1, after each push:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 600 pnpm exec eslint src/shared/engine src/engine-host/normalizer.ts src/engine-host/normalizer-send-now.ts src/renderer/src/transcript/model'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 1500 pnpm exec vitest run src/shared/engine src/engine-host/normalizer src/engine-host/fs src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/composer/queue test/support/tokens-guard.test.ts'

Expect each to exit 0, and the new cases of `arrival.test.ts` to have failed before their source existed (for the encoding, a line such as `expected '…"a b"…' to be '…"a\u00a0b"…'`).

M2:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/renderer/src/transcript && timeout 1500 pnpm exec vitest run src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/stores/transcript test/support/tokens-guard.test.ts'

Expect the three label tests named in M2 to fail before their expectations move and pass after.

M3:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/renderer/src/blocked-call src/renderer/src/transcript/view src/renderer/src/composer/queue src/renderer/src/App.tsx && timeout 1500 pnpm exec vitest run src/renderer/src/blocked-call src/renderer/src/transcript src/renderer/src/composer src/renderer/src/session/controls src/renderer/src/App.test.tsx test/support/tokens-guard.test.ts'

M4:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/shared/engine src/engine-host/fs src/renderer/src/blocked-call && timeout 1500 pnpm exec vitest run src/shared/engine src/engine-host/fs src/engine-host/normalizer-arrivals.test.ts src/renderer/src/lane-a src/renderer/src/transcript/model src/renderer/src/blocked-call'

M5, the builder of the last milestone, once:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 1500 pnpm typecheck'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 3000 pnpm test'

Expect the typecheck and the script tests to exit 0 and the unit suite to fail only in the files `build-common.md` lists as failing on master. Then the executor stops and hands back: the head's sha, the commands run with their results, the acceptance items by number with the test that holds each, the decisions made, and anything that contradicts this document. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the review of the branch and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The words (M2, M3), exact

In `transcript/model/copy.ts`:

    export const BLOCKED = {
      approve: 'Approve and retry',
      always: {
        command: 'A rule that always denies this command blocks it every time. Change the rule or the mode to run it.',
        call: 'A rule that always denies this call blocks it every time. Change the rule or the mode to run it.',
      },
    } as const;

`cellLabel`'s `denied` input gains `again?: boolean` and `approved?: boolean`, read for `disposition: 'auto_denied'` alone:

    `Auto mode blocked${again ? ' again' : ''}: \`${subject}\``
      + (denialKind === 'automode-parsing-error' ? ' · review unreadable' : reason ? ` · ${reason}` : '')
      + (approved ? ' · approved' : '')

The approval's line is U3a's, unchanged: `CONSENT.approved` ("You approved") and the subject as inline code. The stack's row (§G) is `${CONSENT.approved} ${subject}`, plain text. A disabled button's `title` is the port's words, `heldWords`, or one of two sentences that exist today, read where they are defined: `LANE_A_WORDS.widget` (`session/controls/lane-a.ts`) and `TERMINAL_KEEPS_NO_QUEUE` (`composer/submit/submit-state.ts`). A notice is the send's own words. No other sentence is added; `BLOCKED.always.call` is unused until a later landing names a call.

In `transcript/model/blocked.ts`, the reason's constants, as the engine writes them and Claude Desktop reads them:

    const OPENING = 'Permission for this action was denied by the Claude Code auto mode classifier. Reason: ';
    const AFTER = '. If you have other tasks';
    const REASON_MAX = 1000;
    export const STAND_IN_REASONS: ReadonlySet<string> = new Set([
      'Blocked by classifier',
      'Blocked by fast classifier',
      'No reason provided',
      'The server-side auto mode classifier judged this action dangerous (it gave no explanation)',
    ]);

### §B. `transcript/model/blocked.ts` (M2)

    /** The classifier's own reason in a blocked call's result text; null when it gave none (Design 1). */
    export function classifierReason(resultText: string): string | null;

    /** What a grant names. */
    export interface BlockedCall { kind: 'command' | 'call'; subject: string }
    /** A call's name by the engine's rule; in this landing a plain shell command's, null for every other call (probe C's one place). */
    export function blockedCallOf(toolName: string, input: unknown): BlockedCall | null;
    export const blockedKey = (call: BlockedCall): string => `${call.kind}\u0000${call.subject}`;

    export interface BlockedState { call: BlockedCall; again: boolean; grant: 'none' | 'waiting' | 'read' }
    /** Whether the row reads approved: a grant that was read (card 1's one place). */
    export const readsApproved = (state: BlockedState): boolean => state.grant === 'read';
    /** Every blocked call's row that has a name and is outside a hidden branch, by its cell id (the rule of Design 3). */
    export function blockedStates(rows: readonly Row[], hidden: readonly TurnId[]): ReadonlyMap<CellId, BlockedState>;
    /** The approval rows for a key outside a hidden branch, read, waiting or dropped: what a press remembers and compares. */
    export function approvalsFor(rows: readonly Row[], hidden: readonly TurnId[], key: string, after: CellId | null): number;

`hidden` is the state's own list (`state.hidden?.turns`, or an empty constant), so the memo holds on its identity.

On `Cell` (`rows.ts`), with `blocked: z.strictObject({ kind: z.enum(['command', 'call']), subject: z.string() }).optional()` in `schema.ts`:

    /** UX wave U1c: what a grant for this call names; present only on a call auto mode blocked that has a name. */
    blocked?: BlockedCall;

A blocked call's row is a `cell` row whose `classification.denial.kind` is `'automode-blocked'` and which carries `blocked`. `blockedStates` reads the name from that field and nothing else of the call.

In `derive.ts`, in the turn's `notice.posted` case, beside `supersededByHookRow`: a notice whose key is `permission_denied:<id>` is not drawn when the turn's results hold a result for `<id>` whose `denial` is `'automode-blocked'`. No other notice is touched, and the loose rows' case is not edited.

### §C. The reader's and the host's insertions (U3's files)

M1:

1. `arrival.ts`, `consentMessage(kind, subject)`: the quoted subject is `JSON.stringify(subject)` with every match of `/(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]/gu` replaced by `\uXXXX` for each of its UTF-16 units, four lowercase hex digits each, as the engine's `Pp` writes them. Head and tail are unchanged.
2. `arrival.ts`, `readConsents(text: string): Extract<Arrival, { class: 'consent' }>[]`, exported, in place of the private `consentOf`. The sentence for one call: today's head and tail around one JSON string. The sentence for several, with `<kind>` the word:

        Permission granted for these exact <kind>s only, each as one whole string: <q1>, <q2>. This does not approve any other <kind>, any part of these, or running them with added options such as turning off the sandbox, extra network access, or running in the background. You may now retry these exact <kind>s if you would like.

   with two or more JSON strings joined by `, `. Each string is parsed with `JSON.parse`; the text is a grant when it equals the sentence rebuilt from the parsed subjects with every subject in the engine's encoding, or with every subject in the plain one. Any other text gives none.
3. `arrival.ts`, `personsGrants(text: string)`, exported, which `personsText` calls: the grants of the whole text; when there are none and the text holds `\n`, the grants of each line that is a whole sentence, in order. MAWS's answer envelope is read as today, on the whole text only. `personsText`'s callers do not change: a row of origin `human`, a queued prompt of origin `human`, and the frame MAWS writes (`userOut`).
4. `normalizer.ts` and `normalizer-send-now.ts`: where `userOut` puts consent marks on a frame it writes, it also remembers them by the frame's uuid; where `userIn` forwards a joined replay, the `user.message` carries `arrival`: the remembered marks of each uuid in `joined`, in order, then its own. A joined message with no remembered mark carries no `arrival`, as today. The memory is bounded (64 entries, the oldest dropped first) and outlives a member's own echo, because the first member is echoed before the joined replay (`u1c-b-joinend-grant-first-1` seq 345, then 350); it is dropped when a join takes it, when the prompt is cancelled, discarded or refused, and once the prompt started and the main lane answered (Decision Log 20).
5. `transcript/model/derive.ts` and `keys.ts`, the rows of a person's message whose event carries consent marks (Design 2): the message's text is split at `\n`; a line is a grant line when `readConsents` reads it; when the grant lines' grants are the event's marks, the rows are the bubble for the other lines (under the message's id and uuid, omitted when no other line holds a character) and one `user` row with `consent` per mark, in order, each with `messageUuid: null`, `editable: false` and the id `rowId.grant(messageUuid, n)`; when no other line is left, the first mark's row takes the message's own id and uuid. When they are not the marks, the bubble keeps the whole text and every mark gets its row. One mark on a text that is its sentence is today's row, unchanged.

M4, each built only for a state `TERMINAL_OFFERED` holds `true`:

6. (`idle`) `arrival.ts`, `pluginRow`, after the answers and the wake: a row a bridge plugin (`BRIDGE_PLUGINS`) **submitted as the user** (`deliveredPrompts(row)?.kind === 'submitted'`) whose whole text `readConsents` reads gives those grants. A row that opens with a sminos frame line is read as today, before this.
7. (`running`, `stopped`) `arrival.ts`, `attachmentRow`, the branch of a `queued_command` of origin `human`, mode `prompt`, not meta: the prompt's text is the string, or, when the prompt is text blocks alone, their text (`messageText`). Today the function leaves at its top for any prompt that is no string; the insertion admits blocks for this branch only. This is the form `steerAsDrawn` (`lane-a/source/bridge-rows.ts`) gives a row the bridge appended, on the route of another machine's rows. The prompt is read whole (Decision Log 37); the marks it reads make an approval row that waits until the read boundary of §C 8, never one that reads approved at the appended row (Decision Log 38).
8. (`running`, `stopped`) `engine-host/fs/backfill.ts`, where words the bridge appended become the person's message: `steered`, and the `said` of `withWaitingWords`. The `user.message` each builds carries the consent marks `readConsents` reads in its words, only for the words the bridge's mirror line names (Decision Log 37). The appended meta row itself stays as today (a synthetic message with no mark). **An approval appended while a turn runs waits for the running turn** (Decision Log 38): at its delivery only the `user.message` with its marks is emitted and its `started` is held; the `started` is emitted after the events of the running turn's next main-loop tool result (not an interrupt, outside a child); when the turn ends or is interrupted first, the held uuids move to the waiting words as words already drawn, and the next turn's start or the wake takes them; nothing else clears it. Late by one call, never early. This applies only to words whose `readConsents` is non-empty; every other bridge steer keeps today's drawing (the wider rule is board ticket 706). On another machine's rows the backfill knows MAWS's drawn row (`steerAsDrawn`, through `asQueuedPrompt`) by one optional key `asQueuedPrompt` sets (`lane-a/conversation/delivery-frame.ts`, a named insertion in P5 O9's file); while no turn runs nothing is emitted for it, the words wait as on the file route's idle branch, and `waitForTurn` skips a uuid already waiting, so the stopped state reads `none` until the wake on both routes.

The reader's header comment, rule (1), is brought to what is built: the person's own text read whole or by lines, and, with M4, the sentence where a sminos bridge carried it for the person.

### §D. The transcript's seam (M2, M3)

In `transcript/view/context.tsx`, on `TranscriptActions`:

    /** UX wave U1c: the control under a blocked call's line, for the row's session. Optional, with no default: a mount that omits it draws none. */
    renderBlockedCall?(props: BlockedCallProps): ReactNode;

    export interface BlockedCallProps { call: BlockedCall; again: boolean; grant: 'none' | 'waiting'; onLine: boolean }

In `CellLine`: a selector on the transcript's store gives the cell's `BlockedState` (`blockedStates(entry.rows, hidden turns).get(cell.id)`, `undefined` at once for any other cell). With a state, the drawn label is `cellLabel` with `again` and `approved: readsApproved(state)` (U1b's waiting label, where present, takes precedence and cannot coincide). When the row does not read approved, the context's `variant` is `'session'` and the action exists: `onLine` is `lineNamesWhole(cell, state.call)` (§E); with it the cell carries `data-names-whole` and its label wraps; and after the line's button and before the detail the row draws `actions.renderBlockedCall({ call: state.call, again: state.again, grant: state.grant, onLine })`.

### §E. The control and its subject (M3)

    // transcript/model/blocked.ts
    /** Whether the row's line shows the grant's subject whole and exactly: a command with no line break and no backtick, drawn as that same string. */
    export function lineNamesWhole(drawn: Cell, call: BlockedCall): boolean;

`lineNamesWhole` is true only when `call.kind` is `'command'`, the drawn cell's detail is a shell's whose `command` is identical to `call.subject`, and the subject holds no `\n`, `\r` or backtick and is at most `LINE_SUBJECT_MAX` long (`export const LINE_SUBJECT_MAX = 200`, beside it, counted as `subject.length`; a test at 200 and at 201).

`ApproveAndRetry.tsx` (in `src/renderer/src/blocked-call/`) draws, in order: when `onLine` is false, the subject's block, a `pre` whose text is `call.subject` and nothing else; the button (`BLOCKED.approve`; disabled unless the gate is open; its `title` an unavailable gate's reason); the muted line `BLOCKED.always[call.kind]` when `again`; the notice. The session is `useRowSession()`. In `transcript.css`: `.transcript-cell[data-names-whole] .transcript-cell-label` wraps with its white space kept (`white-space: pre-wrap; overflow-wrap: anywhere`); the subject's block is monospace at `--text-code`, `white-space: pre-wrap`, `overflow-wrap: anywhere`, at most twelve lines high and scrolling beyond, inside the cell's border.

`index.ts`: `registerBlockedCalls(): () => void`, which registers `renderBlockedCall` through `registerTranscriptActions`; `App.tsx` calls it once.

### §F. `src/renderer/src/blocked-call/grants.ts` (M3)

    export const SETTLE_MS = 5_000;
    /** Probe B's one place: how a grant is sent to a session MAWS runs while a turn runs. 'next' since probe B (u1c-b-*, 27 of 27). */
    export const GRANT_DURING_TURN: 'after' | 'next' = 'next';
    /** Probe T's one place: the states of a terminal session in which the button is offered. M3 writes all false; M4 turns each true by its recording (u1c-t-*, 3 of 3 each). */
    export const TERMINAL_OFFERED: Readonly<Record<'idle' | 'running' | 'stopped', boolean>> = { idle: true, running: true, stopped: true };

    export function terminalStateOf(appSessionId: AppSessionId): 'idle' | 'running' | 'stopped';
    export type Gate = { state: 'open' } | { state: 'closed' } | { state: 'unavailable'; reason: string };
    /** The keys of the grants the record holds unread outside the transcript, read by `personsGrants`: the queue's entries that are not released, its steers, a terminal session's pending sends that are sending or unconfirmed. */
    export function waitingGrants(appSessionId: AppSessionId): ReadonlySet<string>;
    /** The gate, by the precedence of Design 6. The one place a route, a state or a probe's answer closes the button. */
    export function gateOf(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): Gate;
    /** The press (Design 4). The only caller of the port's send for a grant. */
    export function approve(appSessionId: AppSessionId, call: BlockedCall): Promise<void>;
    /** The gate and the last press's notice, followed in a render. */
    export function useGrant(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): { gate: Gate; notice: string | null };

`gateOf`: closed when a grant is out for the key, when `grant` is `'waiting'`, or when `waitingGrants` holds the key. Else unavailable: with `heldWords(appSessionId)` when `sessionControls` answers null; for a session driven by its bridge (`drivenByBridge`) whose state `TERMINAL_OFFERED` does not offer, with the words of Design 7's table; with `capability('send')`'s reason when it is not available. Else open.

`approve` sends `consentMessage(call.kind, call.subject)` through `sendToSession` with `{ origin: 'answer' }`, and on a session not driven by its bridge, while `GRANT_DURING_TURN` is `'after'`, with `when: 'after'` too.

The grants out are a store (`useGrantsOut`), a map from session and key to `{ phase: 'sending' | 'delivered'; rows: number; quietSince: number | null }`, and beside it the notices by session and key. Its transitions are the table of Design 4. It is followed from the transcript's store (`approvalsFor`), the queue store and the lane A store by subscriptions the store itself holds while the map is not empty; nothing in it depends on a mounted component.

One insertion in another child's file serves the store: `hold(key)` in `src/renderer/src/stores/transcript.ts`, which joins the transcript's counted attachment that is there, so a grant out keeps the session's transcript attached after its pane closes; the store does not attach a source of its own because attaching the IPC source would replace another machine's pane source (Decision Log 34).

### §G. The stack's row (U4's files, M3)

In `composer/queue/stack.ts`: a row that has content carries `grant: BlockedCall | null`, set when `readConsents(messageText(content))` reads the whole text as exactly one grant; `rowText` answers `${CONSENT.approved} ${grant.subject}` for such a row, and for a row that has only text (`sending`, `handed`) when the whole text reads so; `newestToTake` skips a grant, as it skips an answer. In `QueueList.tsx`: a grant's row draws Send now and Delete and no More menu. An answer's row and every other row are unchanged.

### §H. The scenes (M5)

- **S1** (`e2e/composer.spec.ts`): the real session pane over the replay of `spikes/protocol-probe/fixtures/uxwave/u1-soft-seeded-1.jsonl`. A prompt is sent; the turn's line holds "1 auto-denied"; a click on it shows the row, whose text is ``Auto mode blocked: curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"`` and nothing more, the whole command on its wrapped line, the button under it and no subject block; the press's `user.message` content equals `consentMessage('command', …)` for that command; the line "You approved …" is drawn; the row's text ends in "· approved" and holds no button; the retry's cell reads done. Screenshots: offered, approved.
- **S2**: the same over `u1-hard-seeded-1.jsonl`, to the second turn's row: "Auto mode blocked again: …", the button, the muted line. Screenshot.
- **S3**: a built journal whose turn holds a blocked command of two lines and then a call that the replay holds open. The row shows the subject's block, equal to the command, and the button under it. The press while the turn runs: the grant's frame is written as a steer at the next step; the stack's row reads "You approved …" with the mark "Next step", Send now and Delete; the row's button is disabled; Delete withdraws the steer and the button is enabled again at once; a second press, then the release of the hold: the grant is read at that call's result, and the row reads approved. Screenshots: the subject's block, greyed with the stack.
- **S4** (`e2e/lane-a.spec.ts`): a terminal session whose transcript holds a blocked call (a result record with `toolDenialKind: 'automode-blocked'`). As shipped: the row with its short label, the button disabled, its title "Not available for a terminal session", and the fake bridge receives nothing on a press; before a bridge is live, the title "Held by …". M4 adds one part for each state it turns on: the press reaches the fake bridge as one delivery whose text is the sentence; the scene writes the bridge's rows for that state (as probe T recorded them) and the retry's records; the line and "· approved".

## Proofs an executor cannot run

Each is a step for the architect, with what it needs.

1. **The four scenes, each alone on a Mac**, on the head M5 hands back: `pnpm e2e:composer -g "<the scene's name>"` for S1 to S3 and `pnpm e2e:lane-a -g "<name>"` for S4, with their screenshots.
2. **The landing's Mac run set**, on the final head, under the load rule: `e2e:transcript` (every cell line and refused row the harness draws), `e2e:c7` (`e2e:requests` and `e2e:composer`: the stack, the request rows, the recorded joins), `e2e:lane-a`, `e2e:to-human` (the fold), `e2e:agents` (the drill-in's cell lines), `e2e:remote` (a remote transcript's rows and its sends), `e2e:desk-web` (`conversation.spec.ts` and `reconnect.spec.ts` cross the reader and the rows), and the default `pnpm e2e`. No existing scene is expected to change: at the pin no scene names "Auto mode blocked" or a classifier block's advisory. `e2e:cross-build` is not owed (Design 8). The paid group `p1-live` is not run: this landing changes none of its scenes and nothing it proves.
3. **The probes** ("What a probe's answer changes"), on `ux-wave/U1c-probes`: answered 2026-11-15 and merged at `54dd334a4`; each answer goes into its one place by a commit that names the recording.
4. **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u1c`), the branch's review, and the pull request, which names the desk web app's difference (Design 8).
5. **The owner's look**, on the built window or on the scenes' screenshots: the states of the row, the subject's block, the stack's row, and the three cards.
6. **A real block on a real session**, by the owner's sitting on the wave's build: a command a `soft_deny` rule names, blocked, approved, run. The recordings prove the frames; the sitting proves the whole. The command is the agent's own step from a task file the prompt names, not a command the prompt asks for by name: on the recording date the classifier blocked a marker command the person's own prompt asks for 1 time in 6, and every time as a task file's step (`findings-uxwave-u1c-during-turn.txt`, "The rule and a stated request"; ruling F).

## Size and review

Counted from the code at the pin, per milestone; estimates.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 160 lines in five files | about 420 in six files | — | 11 |
| M2 | about 170 lines (one new file of about 120; six edited) | about 400 (one new file; three edited) | — | 11 |
| M3 | about 430 lines (three new files of about 330; six edited) | about 620 (two new files; two edited) | — | 13 |
| M4 | about 35 lines in three files, for all three states | about 180 in four files | — | 7 |
| M5 | four tracker rows | — | about 300 lines in four files | 5 |

About 800 lines of source, 1,620 of tests and 300 of scenes, in about forty files. **The branch's review is the xhigh panel:** the size is past twenty files and two thousand lines, and this is the one control in the wave that consents to a call a safety check refused. Its lenses: consent's evidence (the marks through a join, both encodings, the plural form, that no row newly reads as the person's approval but the person's own send of the exact sentence); the rule (order, a hidden branch, a page not loaded, a dropped or waiting approval, a row that only looks like one); the press (the store across mounts, the held-open sequences, the clock, a second window); what stands beside the button (the two cases of the subject, a mod's rewrite); the routes and the gates (that each shipped value offers nothing unrecorded, every disabled state's words, what a `view` member and a remote caller can do).

## Surprises & Discoveries

- Observation 1: today's blocked row carries the engine's whole message to the model.
  Evidence: at `63c97b5c0`, `rowsOf` over `journalToEvents` of `u1-soft-seeded-1`, expanded: ``cell[denied/automode-blocked] Auto mode blocked: `curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"` · …(1183)`` (a label of 1,183 characters); `cells.ts`, `cellOf`: `reason: resultText(result.content).trim() || null`.
- Observation 2: on the live route each block draws a second row with the same text.
  Evidence: the same run, the next row: `error[notice/notice] Permission for this action was denied by the Claude Code auto mode classifier. Reason: The…(1093)`; `normalizer-system.ts`, `case 'permission_denied'` emits `notice.posted` keyed `permission_denied:<id>`; a transcript file holds no such row.
- Observation 3: the reader does not read a grant the bridge carried.
  Evidence: at `63c97b5c0`, on the VM: `readArrivals` of a `user` row of origin `{kind:'plugin',name:'sminos',asUser:true}` whose content is `consentMessage('command', …)`, and of the appended meta form, each answer `[]`; `recordToEvents` gives `{"origin":null,"synthetic":false,"arrival":null}` for the first and `[{"origin":null,"synthetic":true,"arrival":null},{"origin":"human","synthetic":false,"arrival":null}]` for the second with its mirror line. The same text of origin `human`, as a row and as a queued prompt, gives `[{"class":"consent","kind":"command",…}]`.
- Observation 4: the block's turn folds in the recorded session, and the grant's row carries no waiting mark when the session is idle.
  Evidence: the same run, not expanded: `user[prompt] …`, `divider[completed] denied=0 auto=1`, `text`, `user[consent] Permission granted for this exact command only…`, `divider[completed] …` (no `cell` row); at the prefix through seq 48 the grant's row is `user[consent]` with neither `pending` nor `unread`.
- Observation 5: the classifier's transcript frames a plugin's row as `non-user`.
  Evidence: `cli.pretty.js:1339192-1339224` of 2.1.322 (`j9`): `case "plugin": … return { frame: "non-user", kind: r, origin: n }`, where an absent origin or `human` gives `frame: "human"`.
- Observation 6 (the review's first finding): an approval that waited beside another message loses its mark.
  Evidence: `normalizer.ts`, `userIn`: the joined replay is emitted with `joined` and no `arrival`; `u4p2-two-1-1` seq 60 holds both texts joined by one line break under the second's uuid; `reduce.ts`, `Batch.join` replaces the first member's event and removes the others.
- Observation 7: the terminal's own "Recently blocked" retry is not a person's row.
  Evidence: `cli.pretty.js:521756` and `:521766` of 2.1.322: `metaMessages: [Yn(…)], metaMessagesOrigin: { kind: "auto-continuation" }`. The reader reads a grant on origin `human` only.
- Observation 8: a row's line clips at the pane's width, and the line is a button.
  Evidence: `transcript.css`: `.transcript-cell-label { … overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }`; `CellLine.tsx`: the line is `<button class="transcript-cell-line" aria-expanded=…>`.
- Observation 9: at the turn's end the engine joins waiting next-step messages; mid-turn it does not.
  Evidence: `findings-uxwave-u1c-during-turn.txt`; `u1c-b-joinend-grant-first-1` seq 345 (the first uuid replayed with its own text) and 350 (the second uuid with the joined text), its transcript file one `user` row under the second uuid; `u1c-b-join-grant-first-1`, two `queued_command` rows, two replays with their own texts.
- Observation 10: a subagent's blocked result carries no refusal kind on the main wire.
  Evidence: `findings-uxwave-u1c-subagent.txt`: `tool_result_meta [{id, permission_decision {reject, config, classifier}}]` with no `non_execution_kind`, 6 of 6; the subagent's own transcript file has `toolDenialKind: "automode-blocked"` (6 of 6).
- Observation 11: on the recording date the classifier lets a `soft_deny` rule yield to the person's own request in the prompt.
  Evidence: `findings-uxwave-u1c-during-turn.txt`, "The rule and a stated request": 1 block in 6 for the prompt's own request (`u1c-e-prompt-1..3`), every time as a task file's step.
- Observation 12: the two test cases that walk every recorded journal pass the 5 s default only narrowly once the probe set is merged (Decision Log 15).
- Observation 13: a third test walks every recorded fixture and times out at the 5 s default under the VM's load: `src/engine-host/journal.test.ts`, "numbersReadBack > passes every line of the probe's recordings …" (passes alone). It is not among the two cases of `ux-wave/fixture-walk-timeouts`.
- Observation 14 (M2): the recordings hold fifteen classifier blocks, not fourteen (soft 5 times one, hard 3 times two, streak 2 times two); the document's two counts are corrected.
- Observation 15 (M2): on the live route a subagent's blocked call reads `Failed: …` with the engine's whole text, and the advisory repeats that text: as long as the main loop's row was before M2.
- Observation 16 (M3): the renderer's React Compiler test project catches a component that reads a store through `getState` beside unused subscriptions; a gate of that shape needs a snapshot it reads.
- Observation 17 (M3): a completed turn with no work draws no divider (`derive.ts`), so the newest divider is not the newest turn.
- Observation 18 (M3's fix): a closed turn folds its blocked cell out of the store's rows (`derive.ts`), while its user rows and approvals stay; a count over the held rows therefore overcounts after a fold.

## Decision Log

- Decision 1: the verification call. This document got an adversarial review before an executor starts (seven findings, 2026-11-15). The branch gets `doperpowers:review-code` at the xhigh panel, for the reasons and with the lenses of "Size and review". Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, the review's verdict and its residue, and the desk web app's difference; item l4-approvals-12 reverses no earlier ruling (the child's "Rulings reversed" has no entry for it), so the pull request carries no amendment, and ticket 594 closes with it.
  Rationale: root UC-10.
  Date/Author: 2026-11-15, the author of this document.
- Decision 2: the join is repaired in the host's marks and in the message's rows; `reduce.ts` is not edited.
  Rationale: the architect ruled (F1) that approvals survive a join on both routes and named `normalizer.ts` and `reduce.ts`. The code needs the first and not the second: `Batch.join` puts the joined message in the first member's place whatever keys it carries, so a joined message that carries the marks is placed as it is today. What cannot hold them is the row: `derive.ts` gives a `user` row one `consent` from the event's first mark, and `User.tsx` then draws the line in place of the bubble, so a grant joined with an ordinary message would draw one line and lose the message's words, and two grants would draw one. The named insertion is therefore in `derive.ts` and `keys.ts` (§C, 5), with the reader's per-line reading for the file route (§C, 3). Rejected: keeping grants out of the joined message on the live route, which would leave the live route and a reload with different messages under one uuid.
  Date/Author: 2026-11-15, the author, on the architect's ruling F1.
- Decision 3: "the button on the line" is built as the button directly under a line that wraps to show the subject whole.
  Rationale: the architect ruled (F2) that the button is on the line where the line shows the subject whole ("a shell command that fits"), and under the subject's block otherwise. The line is a `button` (the row's disclosure), so a second button cannot stand inside it; and its label is one line clipped with an ellipsis at the pane's width, so "fits" is a fact of layout that no model holds and no unit test sees. The rule is therefore one of strings: where the line draws the grant's very string, with no line break or backtick, that row's label wraps with its white space kept, and the button stands directly under it; everywhere else the subject's block. The principle the ruling states holds in both cases.
  Date/Author: 2026-11-15, the author, on the architect's ruling F2.
- Decision 4 (superseded by Decision 9): during a turn every grant is sent for after the turn, not only while another message waits.
  Rationale: the architect's default for the join's fallback was to send the grant for after the turn while another message waits in the stack. A join is made when a later message is sent, which the press cannot foresee, so that default does not keep a grant from being joined. And a grant read at the turn's next step is itself unrecorded (probe B-1), where a grant sent after the turn is the recorded, honoured case. So `GRANT_DURING_TURN` ships as `'after'` for every grant, and turns to `'next'` only when probe B honours both the next step and the join.
  Date/Author: 2026-11-15, the author, on the architect's rulings F1 and 3.
- Decision 5: the terminal route's states are three as probe T names them, of which the window reads two from the bridge and the third from the transcript.
  Rationale: the bridge's state says whether a turn runs and nothing of a Stop; a session stopped by an Esc and an idle one both read "no turn runs". `terminalStateOf` reads `stopped` from the transcript's newest turn, so that probe T's three answers each have a value of their own in `TERMINAL_OFFERED`.
  Date/Author: 2026-11-15, the author, on the architect's ruling F4.
- Decision 6: ruling F7's encoding is built, and its case as the review states it does not arise.
  Rationale: the review's case is the engine's own grant failing the reader for its encoding. That grant is a meta message of origin `auto-continuation` (Surprises, 7), which the reader does not read in any encoding, and no recording shows its row. New grants take the engine's encoding for what the model reads, and the reader reads both forms and the plural one for a grant a person pastes or an earlier build sent. Reading the terminal's own row waits for probe T-d.
  Date/Author: 2026-11-15, the author, on the architect's ruling F7.
- Decision 7 (ruling A1): the join is repaired in the message's rows (`derive.ts`, one id form in `keys.ts`), not in `reduce.ts`: accepted as Decision 2 built it.
  Rationale: on master `consentOf` in `derive.ts` takes the event's first consent mark and `User.tsx` draws the approval's line in place of the bubble, so one row could show one grant or one bubble.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 8 (ruling A3): the button's place is a rule of strings (`lineNamesWhole`, Decision 3), accepted with one bound. A command longer than 200 characters takes the second case (the subject's block, scrolling beyond twelve lines, the button under it), so the row's line never grows to many lines; the line wraps only for a command of at most 200 characters with no line break and no backtick that the line draws as that same string. One constant, `LINE_SUBJECT_MAX`, beside `lineNamesWhole`; a test at 200 and at 201.
  Rationale: a wrapped line of a long command would make one row many lines high; the block already serves every subject the line cannot carry.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 9 (rulings A2, C): Decision 4 is superseded. A grant during a turn goes at the next step: `GRANT_DURING_TURN` is `'next'`, moved in M3 in a commit that names the recordings; Design 5's "next" form governs; Acceptance 11 and S3 read "Next step"; Delete is the steer's withdrawal.
  Rationale: probe B honoured a grant written at the next step while the blocked call's turn runs 27 of 27, the joined cases included 9 of 9 (`findings-uxwave-u1c-during-turn.txt`, `u1c-b-*`). A grant written the instant the block arrives is read at the NEXT call's result, in the same turn; with no tool boundary left it starts the next turn.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 10 (ruling A4): ruling F7's case does not arise as the review stated it; the encoding is built as written (Decision 6). Probe T-d (the row a terminal's own "Recently blocked" retry leaves) is for a later landing and is not asked now.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 11 (ruling B): the terminal route is offered in all three states. `TERMINAL_OFFERED.idle`, `.running` and `.stopped` are `true`, each moved in M4 in a commit that names its recording; M4 is built for all three; Acceptance 7a to 7c and S4's three parts stand; the fourth card does not arise. M4's tests replay the recorded rows (idle: one `user` row of the plugin's origin with `asUser`; during a turn: an `isMeta` row of the plugin's origin without `asUser`, then the bridge's mirror line; after an Esc: the same two after the interrupted call's rows, then the bridge's wake row); where a recorded row differs from what §C 6 to 8 assumed, the recording governs and the difference goes to the architect.
  Rationale: probe T, 9 of 9 (idle 3/3, five seconds into a 30 s call 3/3, after an Esc during such a call 3/3; `findings-uxwave-u1c-terminal-grant.txt`, `u1c-t-*`). Stated in Design 7 and What is not proven: during a turn a terminal session reads the grant only at the running call's result, so the waiting state can last that call's whole length; why the classifier accepts a plugin's row as the person's consent is not visible and may change with the service.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 12 (ruling C, the forms): the two recorded forms of several waiting messages replace the constructed rows of M1's tests. Mid-turn they are not joined (each its own replay and its own `queued_command` row); at the turn's end they are joined into one `user` row of origin `human`, the texts in the order written with one line break between, under the second frame's uuid, the first uuid replayed on the wire with its own text and then the second with the joined text. M1 replays one recording of each form for each of the three pairings and asserts Design 2's rows, live and from the file. The engine's plural sentence was written in no recording; the reader's plural form stays as written and is marked "read from the bundle, not recorded".
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 13 (ruling E): the three owner cards are out and unanswered; each card's default is built at the one place the document names: card 1 in `readsApproved`, card 2 in §G, card 3 nothing (the fold is as the child's file says). An answer may change one place.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 14 (ruling F): the owner's sitting that proves a soft block by hand (Proofs, 6) makes the command a task file's step: on the recording date the classifier blocks a marker command the person's own prompt asks for 1 time in 6 and every time as the agent's own step from a task file. No scene in the repository depends on it.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 15 (ruling G, replacing ruling D): the probe branch's final head `54dd334a4` (119 files, all under `spikes/protocol-probe/`) is merged. The two fixture-walking test files under `src/` were run on the VM after the merge: both cases that walk every recorded journal timed out at vitest's 5 s default under the VM's load (`normalizer-fidelity.test.ts`, "the remote reader over the recorded journals", 6.1 s with a raised bound; `replay-fixtures.test.ts`, "seeds the probe journals …", 3.0 s), and passed 11 of 11 with `--testTimeout=120000`. The architect gives each its own 60 s bound on a branch of its own (`ux-wave/fixture-walk-timeouts`), which reaches this branch at its chain merge; until then a failure of exactly those two cases with "Test timed out in 5000ms" is read as this known cause, shown by a rerun with a raised bound, and nothing else is set aside under that name. The secret scan's script test passes over the new fixtures (8 of 8).
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 16 (ruling H): probe E's `u1c-e-1.jsonl` and `u1c-e-1.transcript.jsonl` (one classifier block, its grant and its retry; seqs and lines in `findings-uxwave-u1c-both-forms.txt`) replace the constructed rows of M2's file-route test and Acceptance 6.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 17 (ruling I): probe C honoured a grant naming a call (an MCP tool's, a file write outside the working folder) 6 of 6, and this landing still names plain shell commands only (ruling F5 stands): how the whole subject of a call is shown beside its button is a design of its own, a later landing (board ticket 693); the residue names the recordings (`findings-uxwave-u1c-other-tools.txt`).
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 18 (ruling J): no button on a subagent's rows stays, its reason corrected: the grant never reaches the subagent (6 of 6); the main loop takes it and runs the command itself, in its own context (5 of 6), which does not continue the subagent's work and is not a retry of its step. "What the code holds today" says what a subagent's blocked row reads on each route (the main wire carries no refusal kind for it, the subagent's own file does); that reading is left as it is, M2 pins it and reports the size of making the routes agree without building it, and M5 adds one tracker row.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 19 (ruling K): a terminal grant during a turn reaches the model as a plain text block, without the wrapper the engine puts around a person's mid-turn message, and was honoured 3 of 3; listed under What is not proven, 1, as a behaviour of the service that may change.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 20 (M1): the host's consent marks outlive their member's own echo. §C 4's "dropped as the written digests are" read literally breaks the recorded join, since the first member's digest goes at its echo (seq 345) before the joined replay (350) needs its marks; they are dropped when a join takes them, when the prompt is cancelled, discarded or refused, once it started and the main lane answered, and past 64 entries.
  Date/Author: 2026-11-15, M1's executor; folded by the controller.
- Decision 21 (M1): `personsText` reads MAWS's answer envelope before the grants, so a grant line quoted inside an envelope is never the person's grant; for a whole text the order is equivalent to today's. `personsGrants` reads by lines only when the text holds the sentence's opening.
  Date/Author: 2026-11-15, M1's executor; folded by the controller.
- Decision 22 (M1): the rows of a person's message that carries marks. An approval row beside its message has the grant's sentence (`consentMessage(mark)`) as its text, `messageUuid: null`, `editable: false`, the id `rowId.grant(<message uuid or event id>, n)` and `beside: <message uuid>` (optional in `rows.ts` and `schema.ts`), so `withQueueTail` withdraws every row of a withdrawn message (`messageUuid ?? beside`). A message whose only words are grants keeps its whole text on its own row. Design 2's fallback (the whole bubble, then one approval row per mark) also takes a mark whose text is no grant (hand-made events only; `serialize.test.ts`'s fixture became the real sentence) and any content that holds a block other than text, so an attachment beside grants stays drawn.
  Rationale: the M1 review (two Important findings, fixed in `f1ad201ef`): a withdrawn message left its approval rows, and an image beside grant-only text blocks was hidden.
  Date/Author: 2026-11-15, M1's executor and reviewer; folded by the controller.
- Decision 23 (M1): a dropped approval row draws "You approved `cmd`" with the mark a dropped bubble already shows (`droppedRowMark`, else "Not sent") and `data-dropped`, in today's tokens (`transcript.css`: the meta line's gap, `--text-ui-sm`). This also changes U3a's single dropped grant, which drew the line unmarked. No new words.
  Rationale: a grant that was never sent must not read as an unqualified approval; the view marks every dropped person's row this way today.
  Date/Author: 2026-11-15, M1's executor; folded by the controller; sent to the architect as a visible change.
- Decision 24 (the architect, on Decision Log 22 and 23): a dropped approval row reads "You approved `cmd`" with the existing "Not sent" mark, U3a's single dropped grant included: accepted (a grant that never reached the engine must not read as an approval, and it adds no words). `beside` on approval rows (renderer-derived, not stored, not on the wire): accepted.
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 25 (M2, ruling J, the architect): a subagent's blocked row reads, on the live route, as a failed call (`Failed: …`, the engine's whole text as its error) beside the advisory, and from the subagent's own file and through another machine's rows as a blocked call with a name, state `none`, and no advisory; the main transcript holds no blocked row on any route (`lane-a/blocked-routes.test.ts` over `u1c-d-after-1`). This stays as ruling J says. Because the row carries a name on two routes, M3's `variant === 'session'` check is the only thing that keeps a button off it, and M3 tests it over the recorded rows, red first (M3's Decisions). M2's estimate of making the routes agree goes into the tracker row for board ticket 693 (M5).
  Date/Author: 2026-11-15, M2's executor and the architect; recorded by the controller.
- Decision 26 (M2): `shellToolOf` moves into `blocked.ts` and is re-exported by `cells.ts` (no import cycle; one reading of the fact). The view recomposes the label through `blockedLabel(cell, state)` in `cells.ts`, which calls `cellLabel` with the subject from `refusedSubject`, the helper `labelOf` also calls. The selector's guard is `isBlockedCell` (a cell with `blocked`, status `denied`, kind `automode-blocked`), so a mod's drawing with another status keeps its label. The advisory is a derivation item resolved after the turn's walk, so the predicate sees every result of the turn. `classifierReason` reads the result text untrimmed, as Claude Desktop does. `hiddenTurnsOf(state)` is exported from `blocked.ts` for the memo's identity. The `denials` snapshot was edited by hand to the derivation, which its test confirms.
  Date/Author: 2026-11-15, M2's executor; folded by the controller.
- Decision 27 (the architect): `src/engine-host/journal.test.ts` "numbersReadBack > passes every line of the probe's recordings" gets the same 60 s bound on master; it is not edited on this branch. Merge nothing until the architect names a head (master is `3678e3c00` at this entry).
  Date/Author: 2026-11-15, the architect; recorded by the controller.
- Decision 28 (the architect, on M2's review): the opened detail of a call of kind `automode-blocked` shows the command and none of the engine's refusal text; a real reason stays on the label only (Claude Desktop cuts it at 1,000 characters too, so the detail adds nothing). Built in `blocked.ts` (a display-only cell without the refusal's output, truncation and spill references) and `CellLine.tsx` (that cell goes to the native detail and to `renderDetail`, so the surface's fallback draws it too); the stored cell, the row's copy (`serialize.ts`) and what a mod's ToolResult component receives are unchanged. Acceptance 5's test opens every one of the fifteen recorded blocks and probe E's block from its journal and its file. The review found no tooltip, `title`, aria label or find text that still carries the stand-in for a blocked call; the accepted exceptions are the live subagent route (Decision Log 25) and a mod's own drawing (law 2).
  Rationale: the document's In and Acceptance 5 ("the stand-in sentences dropped"; the stand-in "shown nowhere"); M2's first test read labels and notices only.
  Date/Author: 2026-11-15, the architect; built by M2's executor; recorded by the controller.
- Decision 29 (the architect, ruling (a) on M3's question): under `'next'` the press on another machine's session MAWS runs sends as Enter does there: one `session.send` with no turn running or no status held, one `session.steer` at the next step with a running status held. Acceptance 8 and Design 7's row, written for `'after'`, are rewritten in the commit that moves the constant (`9260461d2`). The waiting grant's row follows the stack's existing rules for a steer over the link, in the words those controls have: Delete is refused where the endpoint lacks the act, and the button then stays disabled until the grant is read or the clock runs; Send now is not yet offered over the link. No new word. Tests: the remote route under `'next'` (a running status held: one steer, no send; none held: one send) and the refused Delete (the grant stays out, the row keeps its disabled button).
  Rationale: Design 5 governs, as revision 3 ruled ("on a session MAWS runs, here or on another machine, the press sends as Enter does").
  Date/Author: 2026-11-15, the architect; built by M3's executor; recorded by the controller.
- Decision 30 (M3, accepted by the architect): `grantOptions(appSessionId, during = GRANT_DURING_TURN)` is exported and is the one reader of the constant, so both branches are tested without mocking it. `approve` checks the gate with `grant: 'none'` and reads the store, the queue, the pending sends and the port, so a press on any row of the key finds a waiting grant closed. `useGrant` follows the gate through one `useSyncExternalStore` over the grants-out, queue, lane A and transcript stores (the React Compiler project memoised a render that read stores through `getState`, and the gate went stale). `terminalStateOf` reads `stopped` from the newest accepted turn as the divider's formula reads it, not from the newest divider (a turn with no work draws none), and reads `running` when no lane A state is heard. The words of a terminal state not offered: `TERMINAL_KEEPS_NO_QUEUE` for `running` while `idle` is offered, else `LANE_A_WORDS.widget`; `terminalRefusal(state, offered)` takes the table as an argument for tests. `grant` is on the stack's uncertain row too (it reads `You approved …`); its controls stay U4a's (Resume, Edit, Delete), and Edit only withdraws the row and puts the sentence in the box, where a send needs the person's own Enter (`composer/queue/take-back.ts`), so it cannot send a second grant by itself. The approval count is recomputed on each followed store change only while a grant is out. `lineNamesWhole` and `LINE_SUBJECT_MAX` are in `blocked.ts`. The subagent tests mount the real `Transcript` with `variant="child"` over `u1c-d-after-1`'s own file and its rows as another machine gives them, and draw the same row as a session's own row (which carries the button), so the absence is shown to be the variant's.
  Date/Author: 2026-11-15, M3's executor; accepted by the architect; folded by the controller.
- Decision 31 (M3, on Design 3's claim): a drawn blocked row has every later approval loaded, because every source fills the store as the newest window plus older pages joined before it, with no gap: a local session's `HistoryPager` (`transcript/source/older.ts`) puts a page before all it holds (`loadOlder`), and a jump into history (`seek`) walks the pages back to the one holding the target, taken in with one rebuild, never a window around it; another machine's rows (`lane-a/plane-transcript.ts`, `loadOlder`) are `[...older, ...this.rows]`. No route draws a window that is not the transcript's end.
  Date/Author: 2026-11-15, M3's executor; recorded by the controller.
- Decision 32 (the owner, 2026-11-15, on the three cards): card 1, "Button greys out (Recommended)", is the default built in `readsApproved`; card 2, "\"You approved cmd\" (Recommended)", is the default built in §G (a waiting grant's row draws Send now and Delete and no More menu; the uncertain row keeps U4a's Resume, Edit and Delete); card 3, "Yes, in the newest turn (Recommended)", is board ticket 703's, blocked by this landing, and nothing of it is built here (M5's tracker rows need nothing for it). No behaviour of this landing changes.
  Date/Author: 2026-11-15, the owner, through the architect; recorded by the controller.
- Decision 33 (the architect, on M3's review, finding 1): the count a press compares is over approvals of the key that stand AFTER the pressed blocked row. The press remembers the row's cell id (`BlockedCallProps.cell`); `approvalsFor(rows, hidden, key, after)`. Where the held rows lack the cell because a closed turn folded its work away (`derive.ts`, a turn not expanded keeps only the rows that stay in view, and its approvals stay), the turn that holds the call is found by the tool use's id through the reducer's index (`state.index.toolUses`) and counted over its expanded rows (`expandedTurnRows`, one turn, only while a grant is out); only when no held turn holds the call is the count every approval of the key in the held rows, which is then correct or an undercount. The simpler readings fail: counting every held approval is raised by an older page holding an earlier approval of the same command (the reproducing case: the grant-out ended while the send was unanswered) and by a folded turn after a press on a "blocked again" row; counting after the turn's first row overcounts a block, an approval and a block inside one turn (M2 pins it). Tests: an older page with an earlier approval; the cell id through a rebuild; two blocked rows of one key; the press during a running turn on an "again" row, the turn folding; a cell inside a run of calls, the run open and folded; the expansion counted to run only while a grant is out. An auto mode block never joins a run of calls today (`classify.ts`: `auto_denied` is not groupable), so the run case is tested over hand-made rows only: accepted as it stands.
  Date/Author: 2026-11-15, the architect, on the M3 fixer's case; built in `e9708ba9e`; recorded by the controller.
- Decision 34 (M3's review, findings 2 and 3; the architect): each press takes an attempt number, and a send's answer moves the grant only while its own attempt is current, so a late refusal or success of an earlier press never erases or advances a newer one. While a grant is out for a session the store holds that session's queue attachment (`attachQueue`) and its transcript (`hold(key)`, a named insertion in `stores/transcript.ts`, accepted: attaching the IPC source would replace another machine's pane source), released when its last grant settles; the lane A store is not held (main lists into it whatever is mounted). A session goes when it has no unarchived record and no listing row, or its machine is off the roster (archiving read as closing: accepted); then its grants end and every attachment they held is let go.
  Date/Author: 2026-11-15, M3's fixer; accepted by the architect; recorded by the controller.
- Decision 35 (M3's review, deferred to M4 as a blocking prerequisite): M3's store keeps one transcript attachment instance per session with a grant out, and skips re-acquiring while the session is held. If a pane attaches a replacement source, the lease no longer holds it, and closing that pane leaves a grant out with no attached transcript (the reviewer reproduced it: `out.size` 1, `attached(id)` false). The routes M3 offers are not exposed (`TERMINAL_OFFERED` all false; local IPC sources are cached per client and key), but another machine's terminal session is: plane rebuilds replace the source, and `holdRemoteTranscript`'s last release closes the remote watch. M4 builds the hold of that upstream owner and a lease that survives replacement before it turns any value on (M4, "A prerequisite").
  Date/Author: 2026-11-15, M3's reviewer; recorded by the controller.
- Decision 36 (M4): the prerequisite of Decision Log 35 is `blocked-call/hold.ts` (`holdSession`): while a grant is out it holds another machine's terminal plane (`holdRemoteTranscript`), takes the transcript hold again at each change of the transcript store, and attaches the plane's current source when nothing is attached or the plane has rebuilt, a microtask after the plane's notice so a pane attaching the same source in that tick is joined, not replaced. No file outside `blocked-call/` was edited. Its red run reproduced the reviewer's case (`attached` false after a replacement and the pane's close). Costs accepted: one hold and detach pair per transcript-store change while a grant is out; with the pane open, a plane rebuild can cost one extra hydration.
  Date/Author: 2026-11-15, M4's executor; folded by the controller.
- Decision 37 (M4): §C 8's marks go only on the words the bridge's mirror line names, not on every caller of `steered`: read literally, §C 8 would make a framed `human` delivery an approval, which M4's own proofs forbid. §C 7 reads a text-block prompt whole (`readConsents`), as §C 8 does on the file route, so the two routes agree on words that hold a grant line. The recorded rows match what §C 6 to 8 assumed; the idle row also carries `queuePriority: "later"`, `turnOrigin: "system"` and `promptSource: "system"`, which nothing reads. Each `TERMINAL_OFFERED` value turned `true` in a commit naming its recording: idle `f4af7fa35` (`u1c-t-idle-1..3`), running `9452168c4` (`u1c-t-busy-1, -2, -4`), stopped `a71e4cdc2` (`u1c-t-esc-1..3`), 3 of 3 each. With every state offered, the component case "a state left `false` sends nothing" has no state to run on; its logic stays covered by `terminalRefusal`'s table test and the refused-press test.
  Date/Author: 2026-11-15, M4's executor; folded by the controller.
- Decision 38 (the architect, on M4's review, finding 2): a terminal grant the bridge appends while a turn runs read approved one tool call early on both routes (the file route from the mirror line, the remote route from the appended row; `u1c-t-busy-1, -2, -4` at 53/54/50 and 52/53/49, where the engine reads it at 54/55/51), and the remote route read `read` from the appended row in the stopped state (`u1c-t-esc-*` at 56/51/52, until the wake). Ruled: the contract of §C 8 as corrected. Such an approval is a message waiting for the running turn from its delivery to the read boundary: at delivery only the `user.message` with its marks, the `started` held and emitted after the events of the running turn's next main-loop tool result (not an interrupt, outside a child); if the turn ends or is interrupted first, the held uuids move to the waiting words as words already drawn, taken by the next turn's start or the wake; nothing else clears it; late by one call, never early. Scope (A): only words whose `readConsents` is non-empty; every other bridge steer keeps today's drawing, and the wider rule is board ticket 706 (spawned by 594; a tracker row and the residue name it; nothing of it is built). The remote route's stopped state is corrected with it (nothing emitted while no turn runs, the waiting words as the file route's idle branch has them, `waitForTurn` skipping a uuid already waiting), so both routes read `none` until the wake. The backfill knows MAWS's drawn row by an explicit optional key `asQueuedPrompt` sets (`lane-a/conversation/delivery-frame.ts`, accepted as a named insertion in P5 O9's file), on two conditions: the builder first shows a drawn row is made and consumed inside one window and is never stored, cached across a relaunch or sent to another build (else it stops and reports, building nothing on the key); and a test over the fixtures' engine-written `queued_command` records shows none carries the key, beside the test that `asQueuedPrompt`'s row is recognised. Tests, red first: the prefix cases on both routes over `u1c-t-busy-1, -2, -4` (waiting from delivery to the boundary, then read) and `u1c-t-esc-1..3` (none until the wake, then read); a held approval when the turn ends with no boundary and when it is interrupted; the button closed and the row drawn as Design 5's waiting row while it waits; an ordinary bridge steer's events unchanged (scope A's fence).
  Date/Author: 2026-11-15, the architect, on the M4 executor's proposal; recorded by the controller.

## Outcomes & Retrospective

Pending — written at finish.
