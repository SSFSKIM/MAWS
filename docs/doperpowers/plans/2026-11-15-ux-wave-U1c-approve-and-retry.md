# UX wave · U1, third landing (U1c): "Approve and retry" for a call auto mode blocked

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U1 (`docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, cited below as *the child's file*), its third landing, **U1c**, for item l4-approvals-12 (the child's acceptance line A15). **Parent pin:** master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`, the commit every statement about the code below was checked against; the root, the child's file and the register are read at that commit.
>
> **Branch:** `ux-wave/U1c`, from that commit. **Board ticket:** 594. **The design is the child's file**, under "l4-approvals-12 · Approve a call that auto mode blocked, from its row": the button, the sentence it sends, the row's words, the repeated block and its one line, the routes. This document settles how that sits in today's code. Where the code contradicted the section, the architect has ruled; the rulings are in "Ruled" and in the Decision Log.
>
> **Revision 2 (2026-11-15).** The adversarial review of the first writing (`433a6e9fd`) returned seven findings, four of them on consent itself, and the architect ruled on them and on the ten points the first writing reported. What moved: an approval survives the engine's joining of waiting messages, on the live route and from a file; the button stands only beside the whole subject of its grant; the state that keeps a second press from sending is a store that ends on evidence; the terminal route is offered state by state and only where probe T recorded the sentence honoured; during a turn a grant is sent for after the turn until probe B says the next step is honoured; a call that is not a plain shell command gets no button until probe C answers, and an MCP tool's call none in this landing; only a classifier block's advisory row is dropped; new grants use the engine's own encoding. The milestones are five, and the one for the terminal route is now M4.
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
- [ ] Probes T, B, C and E answered (they run on `ux-wave/U1c-probes`); each answer is written into its one place ("What a probe's answer changes").
- [ ] M1 — the grant as the reader knows it: the engine's encoding, both forms, several in one message, and the join.
- [ ] M2 — the row's words, what an approval names, and what the transcript's rows say of it.
- [ ] M3 — the button, its subject, the press and the waiting row.
- [ ] M4 — the terminal route, state by state (starts only when probe T has answered).
- [ ] M5 — the scenes, the whole suite and the acceptance run.

## The landing's edge

**In.** The grant sentence in the engine's encoding, read in both forms, singly, in the engine's plural form and as one part of a message the engine joined; the blocked row's words (the reason cut out of the engine's text, the stand-in sentences dropped, "again", "· approved"); a classifier block's advisory row no longer drawn once its call's row says it; what an approval names for a shell command; the rule by which a row reads approved, read from the transcript's rows; the button, the whole subject beside it, its press through the session's own send, and the store that keeps a second press from sending; the waiting message's row above the composer; the terminal route in the states probe T recorded honoured; the scenes.

**Left to U1's other landings, to a later landing, or to nobody.** The permission prompt the engine raises at the third block in a row is an ordinary request: U1a drew its card and U1b places it. A call named by its whole input (a file write, a shell call with execution flags) waits for probe C; an MCP tool's call and a subagent's rows get no button here (tracker rows of M5). The blocked row stays inside its turn's fold, reached by the turn line's count (card 3).

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
| 3 | See F1 and probe B: during a turn a grant is sent for after the turn until B says otherwise. | Design 5 |
| 4 | Other tools: F5. A subagent's rows get no button; probe D is for a later landing and holds nothing here. | Design 6 |
| 5 | The reason is cut as Claude Desktop cuts it. The advisory row: F6. | Design 1 |
| 6 | The row behind its turn's fold is built as the child's file says, and is card 3. | Cards |
| 7 | The insertion in U4's stack is a named insertion. | §G |
| 8 | The model's insertions are accepted; the desk web app's drawing is a named difference. | Design 8 |
| 9 | A host of build F marks no grant: accepted, with F3's fallback. | Design 4, 7 |
| 10 | The four readers that meet an approval row: unchanged, one tracker row. | Design 9 |

Four rulings are built otherwise than written, and the Decision Log says how and why. The join needs no edit of `reduce.ts` and does need one of `derive.ts` (entry 2). "The button on the line" is the button directly under a line that wraps to show the subject whole, since the line is itself a button and clips at a width no model knows (entry 3). The join's fallback sends every grant during a turn for after it, not only while another message waits, and that is the shipped value (entry 4). And ruling F7's case as the review states it does not arise, though its encoding is built (entry 6).

### What a probe's answer changes

The probes run on `ux-wave/U1c-probes` (engine 2.1.322, auto mode held, one `autoMode.soft_deny` marker rule, the gateway route, never on the MacBook), their recordings under `spikes/protocol-probe/fixtures/uxwave/` and their answers in `findings-uxwave-u1-classifier-block.txt`. Nothing below is offered before its recording exists: every place ships at the value that needs no unrecorded consent.

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

### Cards for the owner

**Card 1. After you press "Approve and retry" while the agent is still working, what should the blocked row show until your approval has reached the agent?**
- *The button greys out until the agent has it* (recommended, and what is built). The approval waits above the composer like any message; there you can send it now or delete it. When the agent reads it, the line "You approved …" appears and the row reads "· approved". If you delete it, the button comes back.
- *The row reads "· approved" at once.* One state fewer on the row, but it says approved while the message may still sit in a held queue, and before any "You approved" line is in the transcript.
- *Place:* `readsApproved` in `transcript/model/blocked.ts`, which the label and the control both ask.

**Card 2. While that approval waits above the composer, what should its row there read?**
- *One line, "You approved `cmd`", with Send now and Delete* (recommended, and what is built). It reads as the line the transcript will draw, and it cannot be edited into something else.
- *The message as it will be sent.* The engine's whole sentence ("Permission granted for this exact command only, as one whole string: …"), two lines of it, with Edit as on any waiting message. Nothing is built in the stack.
- *Place:* §G (`stack.ts`, `QueueList.tsx`).

**Card 3. A blocked call's row sits inside its turn's fold, and the turn's line says "1 auto-denied". Should a blocked call that nobody has approved stay in view?**
- *Yes, while it is in the session's newest turn* (recommended; not built in this landing). The moment after a block is the moment the button is for: the agent has stopped and is asking. A button two clicks away, behind a small count, will mostly lose to typing "go ahead", and the typed words name no exact command. It stays only until it is approved or the next turn starts, so at most the newest turn's unapproved blocks are ever in view. It needs the fold rule (`isPersistentRow` in `derive.ts`, and the to-human view's working record), which is U2's, so it is a landing of its own after this one.
- *No: the count is the way to it* (what is built, as the child's file says). Nothing more on screen; the person who wants the row clicks "1 auto-denied".
- *Yes, every one, always.* Rejected as a recommendation: a long session would keep every block nobody cared about in view for good.
- *Place:* the fold rule, in a later landing; this landing builds the second option.

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
| The session's send | `session/controls/`: one port per session (`controlsFor`), `send(content, options)` and `capability('send')`; `sendToSession` (`controls-for.ts:121-124`) for a caller outside the composer, refusing in the holder's words when no port drives the session. A session MAWS runs: `sendHumanPrompt` (`composer/submit/send-human-prompt.ts`), which acquires a released session, sends when idle, steers at the next step while a turn runs, and with `when: 'after'` leaves the message in the host's queue for after the turn. Another machine's: one invocation (`sendWithoutAcquiring`), the same option. A terminal session: `laneA.send` through the bridge (`controls/lane-a.ts`), which keeps no queue and refuses `when: 'after'` during a turn. | True: "it is only a send". |
| The waiting messages | `composer/queue/stack.ts` (`stackRows`): the rows above the composer, read from the host's queue (`stores/queue.ts`, published to every window that shows the session) and the transcript's `unread` mark; a waiting row offers Send now, Delete and Edit, an answer's row Send now only. A terminal session's send whose fate the bridge has not named is held in the pending-send strip (`stores/lane-a.ts`, `pendingSends`). | The child's file leaves the wording of a waiting message to U4; ruling 7. |

Claude Desktop, checked at `app-5.1231.2`: the stand-in sentences it treats as no reason are a set of four (`web/app/v1/c62da1b56-Cmxkc-l_.js:424-429`); it cuts the reason out of the result text between the fixed opening and ". If you have other tasks" (`:473-484`), normalises white space and cuts at 1,000 characters (`:450-462`); its row reads "Blocked by auto mode" alone or with the reason (`:541-575`); it recognises a blocked call from the row's `toolDenialKind` or the result meta's `non_execution_kind` (`web/app/v1/c06cf64bb-DOE498Hm.js:3573-3603`). The lines say what the child's file says of them.

## The design

### Words used here

A **blocked call** is a tool call whose result carries the denial kind `automode-blocked`. The **grant** is the message "Approve and retry" sends: the reader's `consentMessage(kind, subject)`. An **approval row** is a `user` row with `consent`, the one that draws ``You approved `cmd` ``. A call's **name** is the pair `{ kind, subject }` a grant for it carries; its **key** is that pair as one string. The **record** is what a reload, and every other window, would still hold: the transcript's rows, the session's queue as its host publishes it, and a terminal session's pending sends. A grant is **read** when its approval row carries no waiting mark; it **waits** while the record holds it unread. A message is **joined** when the engine wrote several waiting messages as one (U4a, decision 32). The three **routes** are the root's law 5. **Build F** is `f1852de3a`; **the VM** is the wave's build VM, reached with `~/.local/share/maws-ux-wave/tools/vmcheck.sh`. Below, *Design N* is a numbered section of this design and *§X* a section of Interfaces and Dependencies.

### 1. What the row reads

The label of a blocked call is, in order: ``Auto mode blocked: `subject` ``, or ``Auto mode blocked again: `subject` `` when the row is blocked again (Design 3); then ` · reason` when the classifier gave one; then ` · approved` when the row is approved. The subject is what today's label names. The words are exact in §A.

The reason is the classifier's own, cut out of the engine's text the way Claude Desktop cuts it: the text must open with the engine's fixed opening, the reason runs to ". If you have other tasks", its white space is normalised, and it is no reason when it is one of the four stand-in sentences or the text does not open that way. A reason longer than 1,000 characters is cut at a word and ends in "…". Through the gateway the reason is always the stand-in (fourteen of fourteen recorded blocks), so there the row reads ``Auto mode blocked: `cmd` `` alone. This is one function, `classifierReason`, and `cellOf` calls it for the kind `automode-blocked` only: every other refusal's label is as today. A call the classifier could not judge (`automode-parsing-error`) keeps ` · review unreadable` and gets no button: nothing was judged, so there is nothing to consent to.

**The advisory row** (ruling F6). The engine's advisory for a refusal reaches the transcript as a notice keyed `permission_denied:<tool use id>`. It is not drawn when, and only when, the turn that holds it also holds that call's result with the kind `automode-blocked`: then the call's own row exists and carries the reason, on every route. Until the result arrives the advisory is drawn, and it leaves when the result does arrive. Every other advisory stays as today: a permission rule's, a hook's, a call of kind `automode-parsing-error` (whose row drops the reason, so the notice may be the only explanation, as for a refused edit), a stopped or unavailable review, an advisory whose call has no result, and one outside any turn.

### 2. The grant: its encoding, its forms, and the join

**The encoding** (ruling F7). The engine quotes each subject as JSON and then escapes every invisible or separator character but the plain space as `\uXXXX`, one escape per UTF-16 unit (`cli.pretty.js:521378-521385` of 2.1.322: the class `(?! )[\p{C}\p{Z}\p{Default_Ignorable_Code_Point}]`, `Pp`, `Yn`). `consentMessage` does the same from M1 on, so a no-break space or a zero-width character in a command is visible in the sentence the model reads. For a subject of printable ASCII the two encodings are one string, so the ten recorded grants stay byte for byte what `consentMessage` builds, and a test says so over all ten.

**The forms the reader reads.** One function, `readConsents(text)`, reads a whole text as grants and answers them in order, or none:

- the sentence for one call, its subject quoted in the engine's encoding or in the plain one (`JSON.stringify` alone), which is what builds before this landing sent and what a person may paste;
- the engine's own sentence for several calls ("these exact commands … each as one whole string: "a", "b" … any part of these … running them … retry these exact commands", and the same with "calls"), in either encoding, which gives one grant per quoted string.

A text is a grant only whole: it is rebuilt from what was parsed, in each encoding, and must equal the text. So the reader recognises the plural form where a person's own send carries it. No control of MAWS sends it: a press sends one sentence for one call.

**Whose text is read.** As today, only the person's own send: a row or a queued prompt of origin `human`, and the frame MAWS itself writes. One thing is added for the join: when the whole text is no grant and holds a line break, each line is read, and every line that is a whole grant sentence gives its grants. The engine joins waiting messages with exactly one line break and a grant sentence holds none (its subject is quoted), so in a joined message each grant is one line. A person who types such a line among other words has typed the grant, which is the reader's rule already (U3's file).

**The join, on the live route** (ruling F1). The host remembers, by uuid, the consent marks it put on each frame it wrote. When the engine's replay joins several of them, the one `user.message` the host forwards carries the marks of every member, in the joined order. The marks come from what the host itself wrote and nothing is read from the joined text, so no text gains a mark it did not have.

**The join, from a file.** The file holds one row for the joined messages, of origin `human`, and the per-line reading above finds each grant in it.

**What the transcript draws of a person's message that carries marks.** Today a message with a mark is drawn as the approval's line, in place of its bubble. From M1 the model reads the message's text by lines:

- one mark, and no words but its sentence: one approval row, as today, under the message's own id and uuid;
- words besides the grants: the message's own row is the bubble, with the grant lines taken out, and each grant is an approval row after it, in order;
- several grants and no other words: the first takes the message's own row and the others follow as approval rows.

An approval row made beside its message has no message uuid (it is no point to rewind to, and no prompt to edit) and an id of its own form. If the lines cannot be matched to the marks, the bubble keeps the whole text and every mark still gets its approval row, so no approval is lost to a text this rule did not foresee. This is why the fix is in the message's rows and not in the reducer: `Batch.join` already puts the joined message in its place whatever it carries, and the loss was that one row can show one grant or one bubble (Decision Log, 2).

**What a join does not reach.** A terminal session's messages go through the bridge and are not joined. A host of `2c7044231` forwards a joined message without marks, and reads only the plain form of one grant whole; a host of build F marks nothing (Design 7).

### 3. What an approval names, and how a row knows it was approved

**The name.** One function, `blockedCallOf(toolName, input)`, gives a call's name, by the engine's own rule for its "Recently blocked" list (`cli.pretty.js:1242837-1242850` and `:1242901-1242905`): a shell call (`shellToolOf`: Bash, PowerShell) whose input holds a non-empty `command` and no other key but `description`, `timeout`, and `run_in_background` or `dangerouslyDisableSandbox` set false, is `{ kind: 'command', subject: command }`, the command whole and unchanged. Every other call has no name in this landing, and its row no button:

- a shell call with an execution flag set, and a built-in tool's call (a file write, an edit), which the engine names by the compact JSON of `{ tool, input }` under a bound of 4,096 units: no recording shows such a grant honoured (probe C), and its row does not show its whole input (ruling F2);
- an MCP tool's call: the name on the wire is the engine's sanitised one, and the engine's grant names the original server and tool, which the store does not hold (ruling F5; a tracker row of M5).

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

"The approval rows the transcript holds for a key" counts every one, read, waiting or dropped (`approvalsFor`). The linearisation point of a press is the synchronous step that puts "sending" in the store before the send is called; a second press, on this row, on another row of the same key, or on the same row mounted again, finds the gate closed and sends nothing.

The evidence is the transcript's own approval row, which every grant that reached a session leaves wherever its host marks it. The clock is the fallback for what leaves none, and it counts from the delivery's outcome, not from the press: the send is acknowledged and the queue no longer lists the grant. It serves a host that marks no grant (build F, where the button then returns), a grant deleted from the queue before it was written, and the moment between a queue entry's release and its row. A send that never answers stays out: the port's own bounds end every send (a host's command deadline, the bridge's 5 s answer, the link's hold). After a reload nothing is out, and the record alone decides.

**Other windows.** A second window on the session reads the same record: a grant that waits in the queue disables its button too, because the queue's snapshot is published to every window, and an approval row approves there as here. What the record does not cover is two presses in two windows inside one round trip, before either's send has reached the host. Both grants are then delivered, as two messages of any kind would be. Closing that needs the host to refuse a second grant for a key it already holds, which is a change of the send's contract; it is not made in this landing and is a tracker row of M5.

### 5. While the grant waits, and during a turn

A grant **waits** for a key when the record holds it unread: an approval row after the block that carries `pending` or `unread`; an entry of the session's queue that is not released, or a steer the queue lists, whose text holds a grant for the key (`personsGrants`, the reader's reading of the person's own text); a pending send of a terminal session, in the state `sending` or `unconfirmed`, whose text holds one. While a grant waits the button is drawn disabled, and the message is where every waiting message is: above the composer.

**During a turn** (ruling 3, probe B). Every recorded grant reached an idle session, in a turn of its own, and was honoured. No recording shows a grant read at the next step of the turn that held the block, nor one inside a joined message. So on a session MAWS runs, here or on another machine, the press passes `when: 'after'`: with no turn running that changes nothing, and with one running the host keeps the grant in its queue and sends it when the turn has ended, alone, as the recorded grants were sent. One constant holds this, `GRANT_DURING_TURN`, shipped as `'after'`.

- *As shipped (`'after'`).* The stack's row carries the mark "After the turn" (or "Held" when the queue is paused). Send now sends it at once, as a `now` message, which the engine never joins. Delete takes the entry out of the queue; the button returns when the clock of Design 4 has run, five seconds later in the window that pressed and at once in any other. The turn's end sends the grant, its row is read, and the blocked row reads approved.
- *If probe B answers yes to both its questions (`'next'`).* The press sends as Enter does: a steer at the next step. The stack's mark is "Next step"; Delete is the steer's withdrawal, which drops the grant's row, so the button returns at once; the agent reads the grant at its next step, in the same turn. A grant may then be joined with another waiting message, which Design 2 already draws and reads.

The fallback the ruling sketched, sending for after the turn only while another message waits, cannot keep a grant from a join: the join is made when a later message is sent, which the press cannot foresee. So the shipped value sends every grant during a turn for after it.

A terminal session keeps no queue: there a grant during a turn can only go at the next step, as an appended row, which is state `running` of Design 7.

**Above the composer**, a waiting grant's row reads ``You approved cmd``, the words of the line it becomes, with Send now and Delete, and no Edit and no move: an edited grant is no grant (ruling 7, card 2). A waiting message that holds a grant among other words is the person's own message and reads as any message.

The readers of "a message of this session waits" today are `stackRows` (with `readOfEntry` in `stack-acts.ts`), `withQueueTail` in `derive.ts` and `PendingSends.tsx`. The gate does not go through `stackRows`, which words rows for drawing and leaves out a submission younger than 300 ms; it reads the same stores for every moment.

### 6. Where the button stands, and what stands beside it

**Beside its whole subject** (ruling F2). The button is drawn only where the subject of its grant is shown whole, exactly as the sentence will quote it. There are two cases, and one function decides between them (`lineNamesWhole`):

- *The line names it whole.* The grant is a command with no line break and no backtick, and the command the row's line draws is that same string. Then the line of that row wraps in place of clipping, with its white space kept, so the whole command is on the line at any width, and the button stands directly under the line.
- *Otherwise* (a command of several lines, one that holds a backtick, which the line's code marks would break, or one a mod's rewrite draws differently): under the line the row shows the subject itself, the string the sentence quotes, whole, in the monospace face, its lines and spaces kept, in a block that scrolls beyond twelve lines; the button stands under that block.

The button cannot stand inside the line: the line is itself a button, the row's disclosure. And whether a clipped line happens to fit is a fact of the pane's width that no model holds and no unit test can see, so the line is made to wrap where it names the subject, and the rule is one of strings alone (Decision Log, 3). A call with no name (Design 3) has no button and nothing said: the row reads as a blocked row.

**Where it is drawn.** The control is drawn inside the blocked call's own line component (`CellLine`), for a cell that carries `blocked`, in a session's own transcript (`variant: 'session'`), where the mount supplies it. So it follows MAWS's drawing of the call: where a mod draws the call itself, the mod's drawing stands (law 2) and there is no button. It is not drawn in a subagent's transcript (ruling 4: the message would reach the main loop, which did not make the call), in the desk web app or the harness (no mount supplies it), nor on a row of a hidden branch.

**Its gate** has four values, by precedence: **approved** (no button; the label says it); **closed**, a grant is out or waits (the button, disabled); **unavailable**, the route does not offer it now (the button, disabled, its `title` the reason); **open**. One function, `gateOf`, decides it. The reasons are sentences that exist today: the port's own answer to `capability('send')`, the function the composer, the comment card and both ports' `send` already read; `heldWords` where no port drives the session; and for a terminal session's state that is not offered, the words of Design 7.

Under a row that is blocked again and still offers the button, one muted line explains the repetition (§A). It leaves with the button.

### 7. Routes (root law 5)

| route | the row | the press | offered | what closes the button, in whose words |
|---|---|---|---|---|
| A session MAWS runs here | The wire's `non_execution_kind`; from its transcript file after a relaunch, the row's `toolDenialKind`. | `session.send` (after `session.acquire` for a released session), with `when: 'after'`: sent at once when idle, kept in the host's queue during a turn. The host marks the grant as it writes it. | Yes: the recorded case (ten grants, five of five honoured under a rule that can be overridden). | `capability('send')`: the process starting or ended, a holder elsewhere. A send's refusal: a trust or relay step (the card's words), the host's error. |
| A session MAWS runs on another machine | The events of that machine's host. | One invocation of `session.send` over the offer of that name (`src/endpoint/offers.ts`, `laneB('act')`), graded `converse` by effect (`src/shared/ipc/grades/session.ts`), the same option. | Yes: the same engine path on that machine. | Main's overlay for `send` (`remote.session`): the link down, the member's grade; a grade refusal in `READER.notSent`'s words. |
| A terminal session, here or on another machine | The file's `toolDenialKind`, read as it is written; another machine's rows are mapped in this window. | `laneA.send`: the bridge submits the words as the user when the session is idle, and appends them into a running turn or after a Stop (`findings-uxwave-u5-terminal-text.txt`). On another machine through main's remote adapter and the offer `sminos.send`, graded `converse` by effect. | **State by state, by probe T** (ruling F4). Shipped: no state. | No bridge: `heldWords` ("Held by …"). A state not offered: below. A bridge that cannot deliver: the bridge's reason. `unconfirmed`: the pending-send strip, and the button closed while it holds the words. |

**The terminal route's states.** The bridge carries a message three ways, and the engine frames them differently: a row submitted as the user when idle; a row appended into the running turn, which the classifier's transcript frames as `non-user` (`cli.pretty.js:1339192-1339224`, `j9`); and after a Stop the appended row and then the bridge's wake. No recording shows a grant honoured in any of them. So the button is offered in a state only when probe T recorded the retry running there three times of three, by one table, `TERMINAL_OFFERED`, shipped with every state `false`. The window knows the state by one function, `terminalStateOf`: `running` when the bridge says a turn runs or does not know (`turn.running`, `turn.unknown`); else `stopped` when the transcript's newest turn reads stopped; else `idle`. The words of a state that is not offered exist today:

| what is not offered | the button's `title` |
|---|---|
| no state (as shipped) | `LANE_A_WORDS.widget`: "Not available for a terminal session" |
| `running`, while `idle` is offered | `TERMINAL_KEEPS_NO_QUEUE`: "A terminal session takes a message at its next step; MAWS cannot hold one for after the turn" |
| `stopped`, while `idle` is offered | no sentence of today fits; if probe T answers so, the words are a fourth card for the owner, with the default "Not available right after a Stop in a terminal session" |

M4 builds the reading of the bridge's rows for the states T honours, and nothing for the others: a state that is not offered sends no grant through the bridge, so nothing there needs reading. The terminal's own `/permissions` › "Recently blocked" stays the way to approve in a state that is not offered; the row it leaves is not read here (What is not proven, 3).

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

1. A grant delivered by the bridge, in any of its three states (probe T). Nothing is offered there until it is.
2. A grant read at the next step of the blocked call's turn, and a grant inside a joined message (probe B). Nothing is sent that way until it is. One variant stays unrecorded under the shipped value: Send now on a waiting grant's row during a turn, which sends it as a `now` message; it arrives alone, in a turn of its own, as the recorded grants did, after the engine ends the running turn.
3. The row the terminal's own "Recently blocked" leaves. In the bundle it is sent as a meta message of origin `auto-continuation` (`cli.pretty.js:521751-521766`), not as a row of origin `human`, so the reader does not read it in either encoding, and a call approved in the terminal keeps its button in MAWS until the retry has run or the person presses. Reading it needs a recording first (probe T-d); this is also why ruling F7's case, a native grant that fails the reader for its encoding, does not arise on the route the review names. The encoding is built all the same, for what the model reads and for a grant a person pastes.
4. A block of another tool and its grant (probe C); a block inside a subagent (probe D).
5. A classifier block as a transcript file (probe E): the file-route tests use constructed rows that carry the keys the probe's digest recorded (`uxw_transcript_failed_rows`).
6. The engine's list of shell tools, read by its use. If it holds a tool `shellToolOf` does not, that tool's blocked call has no name and no button.
7. How the engine joins messages whose content is blocks and not a string (an attachment beside a grant). The rule of Design 2 then falls back to the whole text and still draws every marked grant.
8. The joined row as a transcript file holds it. The findings file says the file has one user line for the joined messages, under the last one's uuid; no file of a join is kept in the repository, so M1's file case is a constructed row of origin `human`. Probe B-2 keeps the session's transcript file, and that file then replaces the constructed row.
9. Whether the engine's count of consecutive blocks runs across turns. The row's line for a repeated block is the child's text either way.

## Acceptance

The child's line A15, as behaviour. Items 1 to 4 are over the probe's recordings; each item names where it is proven.

1. **Approve, and the retry runs** (`u1-soft-seeded-1` to `-5`). After the block the row reads ``Auto mode blocked: `curl -s -o marker-N.txt "https://example.com/?maws-probe-marker-N"` `` with nothing after it, and carries **Approve and retry**. From the frame MAWS writes for the grant on, at every prefix of the journal, the row never offers the button again; once the grant is read the row ends in ` · approved`, the line ``You approved `curl …` `` stands in the next turn, and the retry is a row that ran. The grant the press builds is byte for byte the recorded `out` frame's content, in all ten recordings that hold one. *(M1 for the sentence; M2 by prefixes; M3 for the press; scene S1.)*
2. **Blocked again** (`u1-hard-seeded-1` to `-3`). The first row reads approved; the retry's row reads ``Auto mode blocked again: `curl …` ``, carries the button, and under it the line "A rule that always denies this command blocks it every time. Change the rule or the mode to run it." *(M2, M3; scene S2.)*
3. **Two blocks in a row, then the engine asks** (`u1-streak-seeded-1`, `-2`). Two blocked rows, each with its own button and neither "again"; the third and fourth calls are ordinary calls that ran, and their requests are ordinary permission requests (`decisionReasonType` `classifier`). Nothing is built for them. *(M2.)*
4. **No block, no row** (`u1-norule-seeded-1`, `-2`): no blocked row and no button; the grant the probe sent there still draws as the approval's line.
5. **No stand-in, and the advisory only where the row says it.** Over all fourteen recorded blocks no row's text holds "it gave no explanation". At the prefix that holds a block's advisory and not yet its result, the advisory is drawn; from the result on it is not. A reason that is not a stand-in is shown: a result text with the engine's opening and an invented reason reads ``Auto mode blocked: `cmd` · <that reason>``. An advisory whose call never gets a result, one for an edit refused as `automode-parsing-error`, and one for a call a permission rule denied are each still drawn. *(M2.)*
6. **The same from a file, and after a reload.** The same session as rows of a transcript file (constructed, with the keys the probe's digest recorded) gives the same row states as the journal, applied whole, in two batches split at the grant, and in a fresh state. *(M2.)*
7. **A terminal session, state by state.** As shipped, in each of the three states (`idle`, `running`, `stopped`) the blocked row carries the button disabled, its `title` "Not available for a terminal session", and a press sends nothing to the bridge. For each state probe T honours, once its value is `true` (M4): **7a** `idle`, the press reaches the bridge once with the sentence whole, and the row the bridge submitted as the user draws the approval's line and reads the block approved, from the file and from another machine's rows alike; **7b** `running`, the same for the appended row and its mirror line; **7c** `stopped`, the same for the appended row, the mirror line and the wake. A state left `false` keeps its disabled button, with the words Design 7 gives for it. *(M3 as shipped; M4 per state; scene S4.)*
8. **Another machine.** The press is one `session.send` with the sentence as its content and no steer, whether or not a turn runs there; with the overlay's `send` closed the button is disabled and its `title` is the overlay's reason; an event without the mark (a host of build F) leaves the row unapproved, and the button returns when the clock has run. *(M3, M2.)*
9. **Two presses send one grant, in one window.** With the send held open, a second press on the same row and a press on another row of the same key send nothing. With the row unmounted and mounted again while the send is unanswered, the button is still disabled and a press sends nothing. With the send answered and the transcript's row withheld, the same, for as long as the grant waits in the queue and for `SETTLE_MS` after the queue stops listing it. When the transcript then shows the grant's row, the row follows the record at once. When the clock runs out with no row, the button returns. A window that never pressed draws the button disabled while the queue's snapshot lists a grant for the key. *(M3, with fake timers and a send that resolves on command.)*
10. **A refused press says why.** A send that answers `refused`, or throws, leaves the button enabled with the answer's words under it, in a row mounted afresh too; the next press clears them. *(M3.)*
11. **While it waits, during a turn.** As shipped: with a turn running on a session MAWS runs, the press is one `session.send` kept in the host's queue; the row's button is disabled; the stack's row reads ``You approved <the command>`` with the mark "After the turn", Send now and Delete, and no More; Delete brings the button back within `SETTLE_MS` in this window; the turn's end sends the grant and the row reads approved. A grant in a paused queue keeps the button disabled after the pane is mounted afresh. *(M3; scene S3.)* If probe B turns the constant to `'next'`: the press is one `session.steer`, the mark is "Next step", and Delete brings the button back at once; S3 and this item are rewritten in the commit that turns it.
12. **Where there is no button.** A subagent's transcript; a row of a rewound branch; a call of kind `automode-parsing-error`; an MCP tool's blocked call; a blocked `Write`; a blocked shell call with `run_in_background: true`; a mount that supplies no control. Each draws the row with its short label and no button. *(M2, M3.)*
13. **The button stands beside its whole subject.** For a blocked command of one line the row's line wraps and holds the whole command, and the button is under it. For a command of several lines, and for one that holds a backtick, the row shows the subject in its block, equal to the string the grant quotes, and the button under the block. Two blocked rows whose lines draw the same command while their recorded commands differ each show their own subject in a block and each send their own. *(M3; scenes S1 and S3.)*
14. **A join keeps every approval.** A grant and an ordinary message that waited together, in both orders, and two grants: on the live route (the recorded join's frames, `u4p2-two-1-1`, with those texts in place of its own) and from a file (one row of origin `human` whose text is the joined text), the transcript draws each grant's approval line and the ordinary message's bubble without the grant's sentence, and each blocked row before them reads approved. *(M1 for the rows; M2 for the blocked rows.)*
15. **The encoding.** For a command that holds U+00A0 and U+200B, the grant spells them ` ` and `​`, and the reader reads that text and the plain form of it to the same subject. The engine's sentence for two commands reads as two grants. Either sentence with one word changed reads as none. *(M1.)*
16. **The desk web app.** With no control registered, a blocked row draws its label ("again", "· approved" included) and no button and no block; the approval's line is drawn. Its typecheck, build and tests pass at every milestone. *(M2, M3.)*

## Constraints that bind every milestone

- The rules of `~/.local/share/maws-ux-wave/briefs/build-common.md` bind: no typecheck, lint, test, install, build or Electron on the MacBook; every check on the VM in a checkout of the pushed head; a merge of master, never a rebase or a force-push; commits end with the trailer the brief gives and carry no other attribution.
- **Nothing is offered on an unrecorded consent.** `TERMINAL_OFFERED`, `GRANT_DURING_TURN` and the commands-only rule of `blockedCallOf` ship at the values of "What a probe's answer changes". A value moves only in a commit that names the recording under `spikes/protocol-probe/fixtures/uxwave/` and its count, and rewrites the acceptance item and the scene the table names for it. An executor does not move one on the bundle's reading or on a default.
- The engine is the pinned 2.1.322 and is not patched (charter D-1). Every statement about what it sends rests on a file under `spikes/protocol-probe/fixtures/` or on the bundle read as a reference, and the design says which; an executor who needs a fact neither holds stops and reports it.
- Root law 5: every behaviour is stated per route (Design 7). Root law 7: today's tokens and shapes; no colour or geometry is added. Root UC-6: no chord is added. Root UC-11: the repository is public; test content is invented, and nothing of a real session, journal or settings file is read or copied.
- Root UC-8 and UC-3. The files of other owners this landing edits, each by the smallest insertion, all named here. U3's: `src/shared/engine/arrival.ts` (§C, 1 to 3 in M1; 6 and 7 in M4), `src/engine-host/normalizer.ts` and `normalizer-send-now.ts` (§C, 4), `src/engine-host/fs/backfill.ts` (§C, 8, in M4), and in the transcript's model the rows of a person's message, `transcript/model/derive.ts` and `keys.ts` (§C, 5). U4's: `src/renderer/src/composer/queue/stack.ts` and `QueueList.tsx` (§G). The transcript's view: `transcript/view/context.tsx`, `transcript/view/cells/CellLine.tsx`, `transcript.css`. The transcript's model: `cells.ts`, `rows.ts`, `schema.ts`, `copy.ts`, and one predicate in `derive.ts`. `src/renderer/src/App.tsx` (one registration). `reduce.ts`, `groups.ts`, `classify.ts`, `Transcript.tsx` and `TranscriptSlot.tsx` are not edited.
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

**What it proves.** Acceptance 14's rows, and 15. Beyond acceptance: the ten recorded grants equal `consentMessage` of their commands and read as one grant each; a subject with a line break, a quote and a backslash round-trips in both encodings; a lone surrogate and a private-use character are escaped as the engine's class escapes them; the plural sentence with a quoted `", "` inside a subject; a grant line inside a peer's message, a task's notification, and a row of origin `plugin` gives no mark; on the live route the marks of a joined message are the members' own, in order, and a joined message none of whose members was a grant carries none; a joined message of three (`u4p3-end3-1`'s frames) with the grant in each place; the message's rows when the lines cannot be matched to the marks; the recorded joins' own tests (`normalizer-send-now.test.ts`, "the messages the engine joins") unchanged.

### M2 — The row's words, what an approval names, and what the rows say

**What exists at its end.** A blocked call's row reads the short label on every route, with a real reason when the classifier gave one and none of the stand-ins; a classifier block's advisory row is gone once its result is in; each blocked command carries the name a grant would give it; and `blockedStates` answers, from rows alone, which blocked rows are approved, wait or are blocked again. `CellLine` draws "again" and "· approved". No button yet.

**What it touches.** New: `src/renderer/src/transcript/model/blocked.ts` and its test. Edited: `transcript/model/cells.ts` (`cellOf`: the reason, the field), `rows.ts` and `schema.ts` (`Cell.blocked`), `copy.ts` (`cellLabel`'s two inputs, the words of §A), `derive.ts` (the advisory's predicate, in the turn's `notice.posted` case), `transcript/view/cells/CellLine.tsx` (the label). Tests that pin today's label and change: `copy.test.ts` (the `auto_denied` cases gain the two inputs), `fixtures.test.ts` (the `denials` journal's blocked call reads without its invented text, which does not open as the engine's does), `reduce.test.ts` (the label list of its four refused calls), and any snapshot of rows that holds the long label or a classifier block's advisory (the executor finds them with the suite of the folders below).

**Interfaces.** Exposes §A, §B and the label half of §D. Consumes M1's approval rows.

**Decisions.** `blockedStates` is memoised on the rows array and the hidden turns (a `WeakMap`), and is asked by a store selector that answers `undefined` at once for a cell that is not a blocked call, so an ordinary cell pays nothing. The label is recomposed in the view through `cellLabel`, with the subject from one helper that `labelOf` also calls, never by editing the label's string. The `denials` journal is not edited (other suites read its events); the real-reason case is a unit case through `cellOf`. `Cell.blocked` is written only when present, so every stored snapshot of a cell without it still parses. The advisory's predicate reads the turn's own results; a notice outside a turn is not touched.

**What it does not touch.** The reducer, the fold rules, the turn's line and its counts, `classify.ts`. No button, no store, no send.

**What it proves.** Acceptance 1 to 6 at the model's level, 14's blocked rows, 12's first six cases, and 16's label. Beyond acceptance: `classifierReason` over each of the four stand-ins, a reason with inner white space, one longer than 1,000 characters, and a text without the opening; `blockedCallOf` over a plain command, a command with `description` and `timeout`, one with `run_in_background: false`, and null for one with `run_in_background: true`, for an MCP tool and for a `Write`; the rule over a dropped approval (the button returns), a waiting one (`waiting`), an approval in a hidden branch (not counted), two blocked rows of one key before one approval (both approved), a block, an approval and a block inside one turn; a `user` row without `consent` whose text is the grant, which is no approval row.

### M3 — The button, its subject, the press and the waiting row

**What exists at its end.** The control of Design 6 beside its subject, with the gate, the press and the grant-out store of Design 4, the waiting state and the turn-time sending of Design 5, and the stack's row of §G. On a terminal session the button is drawn disabled with its words (the table of Design 7, every state `false`).

**What it touches.** New: `src/renderer/src/blocked-call/` (`grants.ts`, `ApproveAndRetry.tsx`, `index.ts`, tests). Edited: `transcript/view/context.tsx` (one optional member), `transcript/view/cells/CellLine.tsx` (the mount, the wrapping line), `transcript/view/transcript.css` (the control, the subject's block, the wrapping line), `src/renderer/src/App.tsx` (the registration, beside the other transcript-action registrations), `composer/queue/stack.ts` and `QueueList.tsx` with their tests.

**Interfaces.** Consumes §A, §B, `readConsents`, `personsGrants`, the session's port (`sendToSession`, `sessionControls`, `heldWords`, `drivenByBridge`), the queue store, the lane A store and the transcript's store. Exposes §D's control, §E, §F, §G.

**Decisions.** The control is supplied to the transcript through `registerTranscriptActions`, as the composer's edit actions are, so the transcript's view imports no app store for it and a mount without it draws none. The grant-out state is a store of its own, never cleared by an unmount; while any grant is out it follows the transcript's store, the queue store and the lane A store by its own subscriptions, and drops them when none is. `gateOf` is the only function that decides the gate; `approve` the only one that sends; the three constants of "What a probe's answer changes" are each read in one place. A notice is the port's words, never composed. The button is a native `button` with `disabled` and `title`, as the stack's controls are; the muted line and the notice are `role="status"`.

**What it does not touch.** The ports (`session/controls/`), `send-human-prompt.ts`, the offers, the endpoint, the host. No new origin, command or capability.

**What it proves.** Acceptance 7 as shipped, 8 to 11, 13, 12's last case and 16's control. Beyond acceptance: the gate's precedence (approved over closed over unavailable over open) in each pairing; `terminalStateOf` over a running turn, an unknown one, a newest turn that reads stopped and an idle session; the words of each row of Design 7's table, with the table's values set by the test; the name sent is the store's when the drawn cell's props were rewritten; `origin: 'answer'` with `when: 'after'` on a session MAWS runs and without it on a terminal session; a session with no port sends nothing and shows `heldWords`; a queue entry in each state (`queued`, `submitting`, `released`), a listed steer, a pending send in each of its three states, each for the right key and for another key, and a waiting message that holds a grant among other words; the store's subscriptions end when nothing is out; the stack's `rowText`, its controls and its folded line for a waiting grant, a message that only holds a grant line among other words reading as any message, and a waiting answer's row unchanged.

### M4 — The terminal route, state by state

**Starts only when probe T has answered**, and is built for the states it honoured three of three. If it honoured none, this milestone is not built and M5 follows M3.

**What exists at its end.** For each honoured state, `TERMINAL_OFFERED` reads `true` with its recording named beside it; the button is offered there; and the grant the bridge carried in that state draws the approval's line and reads the block approved, from the file on this Mac and from another machine's rows.

**What it touches.** `src/renderer/src/blocked-call/grants.ts` (the table's values); `src/shared/engine/arrival.ts` (§C, 6 for `idle`; 7 for `running` or `stopped`); `src/engine-host/fs/backfill.ts` (§C, 8, for `running` or `stopped`); their tests (`arrival.test.ts`, `backfill.test.ts`), `src/renderer/src/lane-a/arrival-routes.test.ts`, which already draws one text by both file routes, and the blocked-call tests.

**Interfaces.** Consumes `readConsents`. Exposes nothing new: the events are U3a's (`arrival: [consent]` on a `user.message`).

**Decisions.** §C, 6 to 8. An insertion is built only for a state that is offered. The appended row itself is not made an arrival: its words become the person's steer where the bridge's mirror line names them, and the mark is put on that steer, so one message uuid never carries the mark on two events. The reader's first rule gains one clause and its header comment says so. If `stopped` is not honoured while `idle` is, the executor stops: its words are a card for the owner (Design 7).

**What it does not touch.** `plane-transcript.ts`, `bridge-rows.ts`, the reducer, the model. No other class of arrival, and no row that today reads as a peer's, a wake or an answer.

**What it proves.** Acceptance 7a to 7c for the honoured states, against T's recorded rows. Beyond acceptance: a bridge delivery whose text is the grant with a sminos frame line before it is a peer's or the person's delivery as today, not an approval; a row of another plugin's origin with the grant's text is no approval; the grant in a row submitted as the user by a plugin that is not a bridge plugin (`BRIDGE_PLUGINS`) is no approval; a peer's inbox message holding the sentence is a peer's message; each built form through `recordToEvents` directly and through the remote rows' path gives the same rows; a state left `false` still sends nothing.

### M5 — The scenes, the whole suite and the acceptance

**What exists at its end.** Four scenes that an agent on a Mac can run, three tracker rows, and the acceptance list checked on the branch's head.

**What it touches.** `e2e/composer.spec.ts` (S1 to S3, in the group `e2e:composer`, which `e2e:c7` also runs), `e2e/support/c7-replay.ts` (a journal for S3), `e2e/lane-a.spec.ts` (S4, the group `e2e:lane-a`), `e2e/support/lane-a.ts` (a refused row's record), `docs/tech-debt-tracker.md`. No new spec file, so the gate's count of spec files and its group lists are unchanged.

**Interfaces.** §H.

**Decisions.** S1 and S2 replay the probe's recordings as they are, through the replay's own handshake adaptation; the replay matches a write by its frame type, so the press's content is read from the `user.message` event, as the composer's scenes read theirs. S3 needs a turn that outlives the block, which no recording holds, so its journal is built by a builder in `c7-replay.ts` from the recorded block's frames and a held tool call, with invented text and a command of two lines. A scene's wait is one of the forms the gate's guard allows (`.github/scripts/gate-plan.test.mjs`, above `LIVENESS_BOUNDS`). The tracker's three rows: the four readers of Design 9, each with what it shows; two presses in two windows inside one round trip, and that closing it needs the host to refuse a second grant for a key; an MCP tool's grant, which needs the original server and tool names in the store and probe C's case for a sanitised name and one that holds the separator.

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

Expect each to exit 0, and the new cases of `arrival.test.ts` to have failed before their source existed (for the encoding, a line such as `expected '…"a b"…' to be '…"a b"…'`).

M2:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/renderer/src/transcript && timeout 1500 pnpm exec vitest run src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/stores/transcript test/support/tokens-guard.test.ts'

Expect the three label tests named in M2 to fail before their expectations move and pass after.

M3:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/renderer/src/blocked-call src/renderer/src/transcript/view src/renderer/src/composer/queue src/renderer/src/App.tsx && timeout 1500 pnpm exec vitest run src/renderer/src/blocked-call src/renderer/src/transcript src/renderer/src/composer src/renderer/src/session/controls src/renderer/src/App.test.tsx test/support/tokens-guard.test.ts'

M4, when probe T has answered:

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
    export function approvalsFor(rows: readonly Row[], hidden: readonly TurnId[], key: string): number;

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
4. `normalizer.ts` and `normalizer-send-now.ts`: where `userOut` puts consent marks on a frame it writes, it also remembers them by the frame's uuid; where `userIn` forwards a joined replay, the `user.message` carries `arrival`: the remembered marks of each uuid in `joined`, in order, then its own. A joined message with no remembered mark carries no `arrival`, as today. The memory is bounded and dropped as the written digests are.
5. `transcript/model/derive.ts` and `keys.ts`, the rows of a person's message whose event carries consent marks (Design 2): the message's text is split at `\n`; a line is a grant line when `readConsents` reads it; when the grant lines' grants are the event's marks, the rows are the bubble for the other lines (under the message's id and uuid, omitted when no other line holds a character) and one `user` row with `consent` per mark, in order, each with `messageUuid: null`, `editable: false` and the id `rowId.grant(messageUuid, n)`; when no other line is left, the first mark's row takes the message's own id and uuid. When they are not the marks, the bubble keeps the whole text and every mark gets its row. One mark on a text that is its sentence is today's row, unchanged.

M4, each built only for a state `TERMINAL_OFFERED` holds `true`:

6. (`idle`) `arrival.ts`, `pluginRow`, after the answers and the wake: a row a bridge plugin (`BRIDGE_PLUGINS`) **submitted as the user** (`deliveredPrompts(row)?.kind === 'submitted'`) whose whole text `readConsents` reads gives those grants. A row that opens with a sminos frame line is read as today, before this.
7. (`running`, `stopped`) `arrival.ts`, `attachmentRow`, the branch of a `queued_command` of origin `human`, mode `prompt`, not meta: the prompt's text is the string, or, when the prompt is text blocks alone, their text (`messageText`). Today the function leaves at its top for any prompt that is no string; the insertion admits blocks for this branch only. This is the form `steerAsDrawn` (`lane-a/source/bridge-rows.ts`) gives a row the bridge appended, on the route of another machine's rows.
8. (`running`, `stopped`) `engine-host/fs/backfill.ts`, where words the bridge appended become the person's message: `steered`, and the `said` of `withWaitingWords`. The `user.message` each builds carries the consent marks `readConsents` reads in its words. The appended meta row itself stays as today (a synthetic message with no mark).

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

`lineNamesWhole` is true only when `call.kind` is `'command'`, the drawn cell's detail is a shell's whose `command` is identical to `call.subject`, and the subject holds no `\n`, `\r` or backtick.

`ApproveAndRetry.tsx` (in `src/renderer/src/blocked-call/`) draws, in order: when `onLine` is false, the subject's block, a `pre` whose text is `call.subject` and nothing else; the button (`BLOCKED.approve`; disabled unless the gate is open; its `title` an unavailable gate's reason); the muted line `BLOCKED.always[call.kind]` when `again`; the notice. The session is `useRowSession()`. In `transcript.css`: `.transcript-cell[data-names-whole] .transcript-cell-label` wraps with its white space kept (`white-space: pre-wrap; overflow-wrap: anywhere`); the subject's block is monospace at `--text-code`, `white-space: pre-wrap`, `overflow-wrap: anywhere`, at most twelve lines high and scrolling beyond, inside the cell's border.

`index.ts`: `registerBlockedCalls(): () => void`, which registers `renderBlockedCall` through `registerTranscriptActions`; `App.tsx` calls it once.

### §F. `src/renderer/src/blocked-call/grants.ts` (M3)

    export const SETTLE_MS = 5_000;
    /** Probe B's one place: how a grant is sent to a session MAWS runs while a turn runs. Shipped 'after'. */
    export const GRANT_DURING_TURN: 'after' | 'next' = 'after';
    /** Probe T's one place: the states of a terminal session in which the button is offered. Shipped all false. */
    export const TERMINAL_OFFERED: Readonly<Record<'idle' | 'running' | 'stopped', boolean>> = { idle: false, running: false, stopped: false };

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

### §G. The stack's row (U4's files, M3)

In `composer/queue/stack.ts`: a row that has content carries `grant: BlockedCall | null`, set when `readConsents(messageText(content))` reads the whole text as exactly one grant; `rowText` answers `${CONSENT.approved} ${grant.subject}` for such a row, and for a row that has only text (`sending`, `handed`) when the whole text reads so; `newestToTake` skips a grant, as it skips an answer. In `QueueList.tsx`: a grant's row draws Send now and Delete and no More menu. An answer's row and every other row are unchanged.

### §H. The scenes (M5)

- **S1** (`e2e/composer.spec.ts`): the real session pane over the replay of `spikes/protocol-probe/fixtures/uxwave/u1-soft-seeded-1.jsonl`. A prompt is sent; the turn's line holds "1 auto-denied"; a click on it shows the row, whose text is ``Auto mode blocked: curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"`` and nothing more, the whole command on its wrapped line, the button under it and no subject block; the press's `user.message` content equals `consentMessage('command', …)` for that command; the line "You approved …" is drawn; the row's text ends in "· approved" and holds no button; the retry's cell reads done. Screenshots: offered, approved.
- **S2**: the same over `u1-hard-seeded-1.jsonl`, to the second turn's row: "Auto mode blocked again: …", the button, the muted line. Screenshot.
- **S3**: a built journal whose turn holds a blocked command of two lines and then a call that the replay holds open. The row shows the subject's block, equal to the command, and the button under it. The press while the turn runs: no `user` frame is written; the stack's row reads "You approved …" with the mark "After the turn", Send now and Delete; the row's button is disabled; Delete, and after `SETTLE_MS` the button is enabled again; a second press, the release of the hold and the turn's end: the grant's frame is written, and the row reads approved. Screenshots: the subject's block, greyed with the stack.
- **S4** (`e2e/lane-a.spec.ts`): a terminal session whose transcript holds a blocked call (a result record with `toolDenialKind: 'automode-blocked'`). As shipped: the row with its short label, the button disabled, its title "Not available for a terminal session", and the fake bridge receives nothing on a press; before a bridge is live, the title "Held by …". M4 adds one part for each state it turns on: the press reaches the fake bridge as one delivery whose text is the sentence; the scene writes the bridge's rows for that state (as probe T recorded them) and the retry's records; the line and "· approved".

## Proofs an executor cannot run

Each is a step for the architect, with what it needs.

1. **The four scenes, each alone on a Mac**, on the head M5 hands back: `pnpm e2e:composer -g "<the scene's name>"` for S1 to S3 and `pnpm e2e:lane-a -g "<name>"` for S4, with their screenshots.
2. **The landing's Mac run set**, on the final head, under the load rule: `e2e:transcript` (every cell line and refused row the harness draws), `e2e:c7` (`e2e:requests` and `e2e:composer`: the stack, the request rows, the recorded joins), `e2e:lane-a`, `e2e:to-human` (the fold), `e2e:agents` (the drill-in's cell lines), `e2e:remote` (a remote transcript's rows and its sends), `e2e:desk-web` (`conversation.spec.ts` and `reconnect.spec.ts` cross the reader and the rows), and the default `pnpm e2e`. No existing scene is expected to change: at the pin no scene names "Auto mode blocked" or a classifier block's advisory. `e2e:cross-build` is not owed (Design 8). The paid group `p1-live` is not run: this landing changes none of its scenes and nothing it proves.
3. **The probes** ("What a probe's answer changes"), on `ux-wave/U1c-probes`: T before M4 starts; B, C and E whenever they answer, each into its one place, by a commit that names the recording.
4. **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u1c`), the branch's review, and the pull request, which names the desk web app's difference (Design 8).
5. **The owner's look**, on the built window or on the scenes' screenshots: the states of the row, the subject's block, the stack's row, and the three cards.
6. **A real block on a real session**, by the owner's sitting on the wave's build: a command a `soft_deny` rule names, blocked, approved, run. The recordings prove the frames; the sitting proves the whole.

## Size and review

Counted from the code at the pin, per milestone; estimates.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 160 lines in five files | about 420 in six files | — | 11 |
| M2 | about 170 lines (one new file of about 120; six edited) | about 400 (one new file; three edited) | — | 11 |
| M3 | about 430 lines (three new files of about 330; six edited) | about 620 (two new files; two edited) | — | 13 |
| M4 | about 35 lines in three files, for all three states | about 180 in four files | — | 7 |
| M5 | three tracker rows | — | about 300 lines in four files | 5 |

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
- Decision 4: during a turn every grant is sent for after the turn, not only while another message waits.
  Rationale: the architect's default for the join's fallback was to send the grant for after the turn while another message waits in the stack. A join is made when a later message is sent, which the press cannot foresee, so that default does not keep a grant from being joined. And a grant read at the turn's next step is itself unrecorded (probe B-1), where a grant sent after the turn is the recorded, honoured case. So `GRANT_DURING_TURN` ships as `'after'` for every grant, and turns to `'next'` only when probe B honours both the next step and the join.
  Date/Author: 2026-11-15, the author, on the architect's rulings F1 and 3.
- Decision 5: the terminal route's states are three as probe T names them, of which the window reads two from the bridge and the third from the transcript.
  Rationale: the bridge's state says whether a turn runs and nothing of a Stop; a session stopped by an Esc and an idle one both read "no turn runs". `terminalStateOf` reads `stopped` from the transcript's newest turn, so that probe T's three answers each have a value of their own in `TERMINAL_OFFERED`.
  Date/Author: 2026-11-15, the author, on the architect's ruling F4.
- Decision 6: ruling F7's encoding is built, and its case as the review states it does not arise.
  Rationale: the review's case is the engine's own grant failing the reader for its encoding. That grant is a meta message of origin `auto-continuation` (Surprises, 7), which the reader does not read in any encoding, and no recording shows its row. New grants take the engine's encoding for what the model reads, and the reader reads both forms and the plural one for a grant a person pastes or an earlier build sent. Reading the terminal's own row waits for probe T-d.
  Date/Author: 2026-11-15, the author, on the architect's ruling F7.

## Outcomes & Retrospective

Pending — written at finish.
