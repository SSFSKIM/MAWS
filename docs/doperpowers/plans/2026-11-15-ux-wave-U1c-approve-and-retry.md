# UX wave · U1, third landing (U1c): "Approve and retry" for a call auto mode blocked

> **Composite:** `docs/doperpowers/specs/2026-11-12-ux-wave-design.md`, the UX wave's root, cited below as *root*. **Child:** U1 (`docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, cited below as *the child's file*), its third landing, **U1c**, for item l4-approvals-12 (the child's acceptance line A15). **Parent pin:** master `63c97b5c09be316dacfb3f8c12cd52ca7bd51b80`, the commit every statement about the code below was checked against; the root, the child's file and the register are read at that commit.
>
> **Branch:** `ux-wave/U1c`, from that commit. **Board ticket:** 594. **The design is the child's file**, under "l4-approvals-12 · Approve a call that auto mode blocked, from its row": the button, the sentence it sends, the row's words, the repeated block and its one line, the routes. This document settles how that sits in today's code, and carries the points where the code contradicts the section (under "Reported to the architect"), each written with a default so that a ruling changes one named place.
>
> **Not in this landing:** anything of U1's other landings (the placement of requests, U1b; which of MAWS's tools load up front, U1d); a list of recently blocked calls outside the transcript; any change to what auto mode blocks; a button on the turn line's "N auto-denied" count; an allow rule written for the call (the child's file, "Why this, not that").

## Purpose

In auto mode the engine's classifier can block a call. The call is then over, and today the person can only type an instruction or change the mode. On today's build the blocked row is also hard to read: over the probe's own recorded session its label is 1,183 characters long, because it carries the whole text the engine wrote for the model, and on a session MAWS runs a second row repeats 1,093 characters of the same text (Surprises, 1 and 2).

After this landing the row of a call auto mode blocked reads ``Auto mode blocked: `cmd` `` and carries one button, **Approve and retry**. A press sends the session the engine's own grant sentence as a message. The transcript draws that message as one line, ``You approved `cmd` ``, the row reads ``Auto mode blocked: `cmd` · approved``, and the agent's retry is a new row below. If the retry is blocked again, its row says so, offers the button once more and explains in one line that a rule that always denies blocks every time. The classifier's stand-in reason is shown nowhere. The button is only a send, so it works for a session MAWS runs, a terminal session and a session on another machine, and where the session takes no message now it is drawn disabled with the sentence the composer already uses for that.

How to see it working: launch the app on the recorded session `spikes/protocol-probe/fixtures/uxwave/u1-soft-seeded-1.jsonl` (the scene of M4), send a prompt, click "1 auto-denied" on the turn's line, press **Approve and retry**, and watch the row read approved, the line appear and the command run. The same over `u1-hard-seeded-1.jsonl` ends on "Auto mode blocked again".

## Progress

- [x] (2026-11-15) Document written against master `63c97b5c0`; two checks of today's behaviour run on the build VM (Surprises 1 to 4).
- [ ] Adversarial review of this document, and the architect's rulings on "Reported to the architect".
- [ ] Probes T and B answered, or their defaults confirmed (they gate M2's start and one line of M3).
- [ ] M1 — the row's words, what an approval names, and what the transcript's rows say of it.
- [ ] M2 — the approval's line on the terminal route.
- [ ] M3 — the button, the press and the waiting row.
- [ ] M4 — the scenes, the whole suite and the acceptance run.

## The landing's edge

**In.** The blocked row's words (the reason cut out of the engine's text, the stand-in sentences dropped, "again", "· approved"); the engine's advisory row for a refused call no longer drawn; what an approval names for a shell command and for another call; the rule by which a row reads approved, read from the transcript's rows; the button, its press through the session's own send, and what it shows while its message is on its way; the waiting message's row above the composer; the approval's line where the sminos bridge carried the message; the scenes.

**Left to U1's other landings, or to nobody.** The permission prompt the engine raises at the third block in a row is an ordinary request: U1a drew its card and U1b places it, and nothing here touches it. The blocked row stays inside its turn's fold, reached by the turn line's count, as the child's file says ("Not included"); see Reported 6.

**What this document assumes of the landings in flight.** Each may reach master before or after this one; the list is checked again when the other is on master, and the second to land merges master first (root UC-8).

| landing (branch at authoring) | what it changes in a file this landing touches | what this document assumes |
|---|---|---|
| U1b, requests drawn in the transcript (`origin/ux-wave/U1b`, `0f746a7a5`) | `transcript/view/cells/CellLine.tsx`: a hook `useWaitsForApproval` and `data-waiting` on the cell; `transcript/model/rows.ts`, `schema.ts`, `copy.ts`, `derive.ts`, `reduce.ts`, `transcript.css` in other lines | A blocked call never waits for approval (its call is over), so the two states of `CellLine` cannot hold for one cell: the label override of §D applies when `waiting` is false, and the control is drawn after the line whichever lands first. No row kind, key or fold rule of U1b is read here. U1b removes the `request_slot` row; nothing here names it. |
| U2b, the to-human view (`origin/ux-wave/U2b`, `33434fb2d`) | `transcript/view/Transcript.tsx`, `TranscriptSlot.tsx`, `transcript/model/derive.ts`, `reduce.ts`, `rows.ts`, `owner-marks.ts`: the transcript's fold | A blocked row inside a working record folds with it, as it folds with its turn today. The rule of Design 2 reads the store's rows (`entries[key].rows`), before any projection, so a fold changes nothing it answers. This landing edits `derive.ts` in one predicate beside `supersededByHookRow` and nowhere else. |
| U6b, the file beside the chat (`origin/ux-wave/U6b`, `74aad04a6`) | `transcript/view/context.tsx`: one member of `TranscriptActions` | This landing adds one optional member to the same interface; the two are independent lines. |
| U10b-3, the chat bar over a surface (`origin/ux-wave/U10b-3`, `f05930ca3`) | `composer/frame/`; `e2e/panel.spec.ts` | No file in common. Where the conversation is folded to its bar the transcript is not drawn, so no blocked row and no button; nothing is added to the bar. |
| U5b, Review as one scroll (`origin/ux-wave/U5b`, `d94d75b8f`) | the code harness | No file in common. |
| U4b, the composer's integrations (`origin/ux-wave/U4b`, equal to master at authoring) | will word a waiting answer in `composer/queue/stack.ts` | This landing's insertion in `stack.ts` (§F) is one more reading beside `isAnswer`; whichever lands second keeps both. |

## Reported to the architect

Each point is a place where the code contradicts the child's section, or where the work needs an edit the section does not name. The document is written on the default; a different ruling changes the one place named.

1. **The approval's line is not drawn on the terminal route today.** The child's file says the reader recognises the grant "on the live wire, from a transcript file and from another machine's rows", and that this landing "only sends the message". The reader (`readArrivals`, `src/shared/engine/arrival.ts`) reads it only on a row of origin `human`. A terminal session receives MAWS's words through the sminos bridge: idle, as a row of origin `{kind: 'plugin', name: 'sminos', asUser: true}`; during a turn, as an appended meta row of the plugin's origin, followed by the bridge's mirror line (`findings-uxwave-u5-terminal-text.txt`, states 1 to 3; `fixtures/uxwave/u5-terminal-text-r1.rows.ndjson`, lines 40, 51, 52, 78, 83). Run on the VM at the pin: for both forms the reader answers no arrival, and the file reader makes a plain prompt (origin null, no `arrival`) or a plain steer (Surprises, 3). So on a terminal session, here or on another machine, the grant would draw as a bubble holding the whole sentence, and the row would never read approved. *Default:* M2 makes three insertions in U3's files (`arrival.ts`, `engine-host/fs/backfill.ts`; §C) so the line draws there. *One place:* M2. Without it the terminal route's gate (§E, `gateOf`) must be closed, with a sentence that would then be a card for the owner.
2. **Whether a grant the bridge delivers counts as the person's consent is not recorded.** The probe ran on MAWS's own wire with origin `human`. In the engine's bundle the classifier's transcript frames a row of origin `plugin` as `non-user` (`cli.pretty.js:1339192-1339224` of 2.1.322, `j9`), where a human row is framed `human`; its text is still entered as a `user` entry (`:451330-451349`). What the server-side classifier makes of that is not in the bundle. *Probe T* below. *Default:* the button is offered on a terminal session. *One place:* `gateOf` in `src/renderer/src/blocked-call/grants.ts`.
3. **A grant sent while the blocked call's turn still runs is not recorded.** The probe sent every grant to an idle session (`u1-soft-seeded-*`, the second `out` frame, `priority: 'now'`, after the turn's `result`). The child's file says the message is "queued when a turn runs"; in today's composer a message sent during a turn is a steer at the next step (`sendHumanPrompt`, `priority: 'next'`), which the engine keeps as a `queued_command` attachment of origin `human`, and the bundle frames that as the person's, mid-turn (`:451224-451250`). *Probe B* below. *Default:* the press sends as Enter does, so a steer while a turn runs. *One place:* the options `approve` passes to the port's `send` (§E).
4. **A block of a tool other than the shell, and a block inside a subagent, were not provoked** (the findings file, "Not provoked"). The child's file gives the sentence for both words ("command", "call"). *Default:* the button is offered for a call of any tool that can be named whole (Design 2, from the bundle's own rule); it is not offered on a subagent's rows, since the message reaches the main loop, which did not make the call. *Probes C and D* below. *One place each:* `blockedCallOf` in `transcript/model/blocked.ts`; the `variant === 'session'` condition in `CellLine.tsx`.
5. **Today's row carries the engine's whole text, twice.** The child's file reads today's label as ``Auto mode blocked: `cmd` · reason``. In the code the "reason" is the tool result's whole text (`cellOf`, `transcript/model/cells.ts`: `reason: resultText(result.content).trim()`), which for a classifier block is the engine's message to the model, about 1,100 characters in each recorded block read. And the wire's `system/permission_denied` frame is mapped to a `notice.posted` (`engine-host/normalizer-system.ts`) that the transcript draws as a row of its own after the blocked row, with the same text; a transcript file has no such row, so the two routes differ (Surprises, 1 and 2). *Default:* the reason is cut out of the text as Claude Desktop cuts it (Design 1), and the advisory row of a refused call is not drawn, for every refusal kind, because the call's own row says it on every route. *One place each:* `classifierReason` in `blocked.ts`; the predicate `supersededByCallRow` in `derive.ts`. The narrower reading (drop the advisory for a classifier block only) changes that predicate alone.
6. **The row is behind its turn's fold in the common case.** In the eight recorded sessions of one block to a turn, the turn ends within fifteen frames of the block, and a closed turn folds its work: the person sees the turn's line with "1 auto-denied" and must click the count to see the row and its button (Surprises, 4). The child's file relies on that count ("which already jumps to the first blocked row"). *Default:* as the child's file says, nothing more. Keeping an unapproved blocked row of the newest turn in view would need the approval rule inside the turn's derivation and an edit of the fold rule, which is U2's; it is named here so the owner's sitting can judge it on the built window.
7. **An insertion in U4's stack.** While a turn runs the grant waits above the composer like any message, and the stack would draw the whole sentence with Edit beside it. The child's own rule is that the message "is the person's act but not their prose: it draws as one line … never as a bubble". *Default:* the stack's row for a waiting grant reads ``You approved cmd`` with Send now and Delete and no Edit (§F), by one insertion in `composer/queue/stack.ts` and one in `QueueList.tsx`, with U4's review (root UC-8). It is card 2 below. *One place:* §F.
8. **Insertions in the transcript's model.** `Cell` gains one optional field, `blocked` (`rows.ts`, `schema.ts`, filled in `cellOf`); `cellLabel` gains two optional inputs; `derive.ts` gains the predicate of point 5. The root gives these files to no single child (UC-3); the insertions are named in M1.
9. **A session whose engine host is of build F.** F's host does not mark the grant (it has no arrivals reader), so its `user.message` carries no `arrival`: the grant draws as the person's bubble, the blocked row does not read approved, and the button returns once the settle time of Design 3 has passed. *Default:* accepted, as every line of U3a reads on a host of build F. Reading the grant from an unmarked row's text was rejected: a `user` row does not say whose it is, and a peer's text that no reader claims is drawn as one too (`derive.ts`, the `user.message` case), so a row could read approved on words the person never sent. *One place:* the definition of an approval row in `blockedStates`.
10. **Rows that meet an approval for the first time.** No approval row existed before this landing sends one. Four readers of a person's prompt then meet it: the rewind list (`widgets/RewindWidget.tsx`, which lists it by its text), the refusal dialog's "Edit prompt" (`request-card/initiating-prompt.ts`), the newest-prompt cursor (`composer/edit-prefill.ts`) and the to-human view's lead (`owner/report/project.ts`). *Default:* unchanged, and one row in `docs/tech-debt-tracker.md` names the four, written by M4; none is wrong enough to hold the landing (an approval is a point the session can be rewound to).

### Probes asked for

Each is run as the U1 probe was (engine 2.1.322, auto mode held on a model that supports it, one `autoMode.soft_deny` rule naming a harmless marker command, the gateway route, never on the MacBook), and kept under `spikes/protocol-probe/fixtures/uxwave/` with a dated section in `findings-uxwave-u1-classifier-block.txt`.

- **T (the terminal route).** In an interactive session with the sminos bridge MAWS drives, after a marker command is blocked: deliver the grant sentence through the bridge as `laneA.send` does, (a) with the session idle, (b) five seconds into a 30 s foreground call of the same turn, (c) after an Esc during such a call. Does the model's retry of the exact command run, three times of three in each state? Keep the transcript rows of the block, the delivered row, the mirror line and the retry (their keys, origin, `isMeta`, `toolDenialKind`). *Default and place:* Reported 2. A state that fails closes the gate for that state; all three failing drops M2.
- **B (during a turn, on MAWS's wire).** The model is told to run the marker command and then a 30 s foreground wait in the same turn. Once the block is seen, write the grant as a `user` frame of `priority: 'next'`. Does the retry run, three of three? Keep the journal and the session's transcript file. *Default and place:* Reported 3. If it fails, `approve` passes `when: 'after'` while a turn runs, and a terminal session's button is closed during a turn with the composer's existing sentence for that (`TERMINAL_KEEPS_NO_QUEUE`).
- **C (another tool).** A block of an MCP tool named by the rule, and of a `Write` outside the working folder: the frames (expected the four of the findings file's question 1) and the file row's `toolDenialKind`; then the grant with the word "call" and the subject of Design 2. Does the retry run, three of three each? *Default and place:* Reported 4. If it fails, `blockedCallOf` answers null for a call that is not a shell command.
- **D (inside a subagent).** A block in a subagent's loop: the frames on the main wire and the rows in the subagent's own transcript; then a grant sent to the main loop while the subagent still runs, and after it handed back. Whose retry runs, if any? *Default and place:* Reported 4.
- **E (both forms).** One classifier block kept as journal and as transcript file, which U2a's document already asks for. When it exists, the constructed rows of M1's file-route test are replaced by it.

### Cards for the owner

**Card 1. After you press "Approve and retry" while the agent is still working, what should the blocked row show until the agent has read your approval?**
- *The button greys out until the agent reads it* (recommended, and what is built). The approval waits above the composer like any message you send during a turn; there you can send it now or delete it. When the agent reads it, the line "You approved …" appears and the row reads "· approved". If you delete it, the button comes back.
- *The row reads "· approved" at once.* One state fewer on the row, but it says approved while the message may still sit in a held queue, and it would read approved before any "You approved" line is in the transcript.
- *Place:* `readsApproved` in `transcript/model/blocked.ts`, which the label and the control both ask.

**Card 2. While that approval waits above the composer, what should its row there read?**
- *One line, "You approved `cmd`", with Send now and Delete* (recommended, and what is built). It reads as the line the transcript will draw, and it cannot be edited into something else.
- *The message as it will be sent.* The engine's whole sentence ("Permission granted for this exact command only, as one whole string: …"), two lines of it, with Edit as on any waiting message. Nothing is built in the stack.
- *Place:* §F (`stack.ts`, `QueueList.tsx`).

The look needs no drawn example before it is built: it is one quiet button and one muted line inside an existing row, in today's tokens. The owner sees the four states (offered, greyed, approved, blocked again) on the screenshots of M4's scenes.

## What the code holds today

Line numbers are at the pin and are for the reader of this section only; an executor finds the function.

| piece the child's file names | where, and what it does at the pin | is the child's statement still true? |
|---|---|---|
| The reader's `consent` class and `consentMessage` (U3a) | `src/shared/engine/arrival.ts`: `consentMessage(kind, subject)` (`:87-92`) builds the sentence, the subject as one JSON string; the private `consentOf(text)` (`:95-108`) matches a text whole and gives `{ class: 'consent', kind, subject }`; `personsText` (`:164-169`) asks it for a row of origin `human` (`userRow`, `:141`) and for a `queued_command` attachment of origin `human` whose prompt is a string (`attachmentRow`, `:283`). The live normaliser asks the reader for the frame MAWS writes (`engine-host/normalizer.ts:735-738`) and puts `arrival: [consent]` on the `user.message`; the file reader does the same (`engine-host/fs/backfill.ts`, `consentOf` at `:229-232`, used for a prompt, a steer and a block message). | True for a session MAWS runs and for its transcript file. Not true where the bridge carried the message: Reported 1. The sentence itself is the engine's (`cli.pretty.js:521384-521387`, `Yn`) and is byte for byte the content of all ten recorded grants' `out` frames (the eight after a block and the two of the control), compared at authoring. |
| The "You approved" line (U3a) | `transcript/model/derive.ts`: `consentOf(event)` (`:1535-1539`) gives the `user` row a `consent` field, for a message that is not synthetic; `transcript/view/rows/User.tsx` draws `ConsentLine` for it (`:52-66`), the words `CONSENT.approved` in `copy.ts` (`:258`), the subject as inline code. `serialize.ts` copies it as one line. | True. Drawn over the recorded session at the pin: the grant's row is a `user` row with `consent` from the frame MAWS wrote (seq 48 of `u1-soft-seeded-1`) on, with no waiting mark (Surprises, 4). |
| The file reader's mapping of a refused call's kind (U2a) | `engine-host/fs/backfill.ts:416-419`: `denial` is read from the row's `toolDenialKind` through `denialKindOf` (`normalizer-support.ts:76-79`), for a row that holds exactly one result. The live reader reads `tool_result_meta[].non_execution_kind` through the same function (`normalizer.ts:446`). Rows of another machine's terminal session are mapped in this window by the same `recordToEvents` (`lane-a/plane-transcript.ts`, `eventsOf`). | True: on master, with its test (`backfill.test.ts`, "a row with the probe's keys and toolDenialKind automode-blocked gives that kind"). This landing adds no mapping. |
| The row's label (`cellLabel`) | `transcript/model/copy.ts:117-143`: for `disposition: 'auto_denied'`, ``Auto mode blocked: `subject` `` then ` · review unreadable` for `automode-parsing-error`, else ` · reason`. The label is built in `labelOf` (`cells.ts:379-382`), its subject the command, the file path or the tool's name; its `reason` comes from `cellOf` (`cells.ts:448`) as the result's whole trimmed text. `denialDisposition` (`classify.ts:155-170`) gives `auto_denied` for `automode-blocked` and `automode-parsing-error`, and such a call stands alone as a `cell` row (`classifyTool`, `stoppedMember`). | The words are as the child's file says; the "reason" is not the classifier's reason but the whole result text (Reported 5). |
| The session's send | `session/controls/`: one port per session (`controlsFor`), `send(content, options)` and `capability('send')`; `sendToSession` (`controls-for.ts:121-124`) for a caller outside the composer, refusing in the holder's words when no port drives the session. A session MAWS runs: `sendHumanPrompt` (`composer/submit/send-human-prompt.ts`), which acquires a released session, sends when idle and steers at the next step while a turn runs. Another machine's: one invocation (`sendWithoutAcquiring`). A terminal session: `laneA.send` through the bridge (`controls/lane-a.ts`, `send`). | True: "it is only a send". |
| The waiting messages | `composer/queue/stack.ts` (`stackRows`): the rows above the composer, read from the host's queue (`stores/queue.ts`) and the transcript's `unread` mark; a waiting row offers Send now, Delete and Edit, an answer's row Send now only. A terminal session keeps no MAWS queue; a send whose fate the bridge has not named is held in the pending-send strip (`stores/lane-a.ts`, `pendingSends`; `composer/PendingSends.tsx`). | The child's file leaves the wording of a waiting message to U4; see Reported 7. |

Claude Desktop, checked at `app-5.1231.2`: the stand-in sentences it treats as no reason are a set of four (`web/app/v1/c62da1b56-Cmxkc-l_.js:424-429`); it cuts the reason out of the result text between the fixed opening and ". If you have other tasks" (`:473-484`), normalises white space and cuts at 1,000 characters (`:450-462`); its row reads "Blocked by auto mode" alone or with the reason (`:541-575`); it recognises a blocked call from the row's `toolDenialKind` or the result meta's `non_execution_kind` (`web/app/v1/c06cf64bb-DOE498Hm.js:3573-3603`). The lines say what the child's file says of them.

## The design

### Words used here

A **blocked call** is a tool call whose result carries the denial kind `automode-blocked`. The **grant** is the message "Approve and retry" sends: the reader's `consentMessage(kind, subject)`. An **approval row** is the `user` row the transcript makes of a grant, the one that draws ``You approved `cmd` ``. A call's **name** is the pair `{ kind, subject }` a grant for it carries; its **key** is that pair as one string. The **record** is what a reload would still hold: the transcript's rows, the session's queue as its host publishes it, and a terminal session's pending sends. A grant is **read** when its approval row carries no waiting mark; it **waits** while the record holds it unread. The three **routes** are the root's law 5. **Build F** is `f1852de3a`; **the VM** is the wave's build VM, reached with `~/.local/share/maws-ux-wave/tools/vmcheck.sh`. Below, *Design N* is a numbered section of this design and *§X* a section of Interfaces and Dependencies.

### 1. What the row reads

The label of a blocked call is, in order: ``Auto mode blocked: `subject` ``, or ``Auto mode blocked again: `subject` `` when the row is blocked again (Design 2); then ` · reason` when the classifier gave one; then ` · approved` when the row is approved. The subject is what today's label names. The words are exact in Interfaces §A.

The reason is the classifier's own, cut out of the engine's text the way Claude Desktop cuts it: the text must open with the engine's fixed opening, the reason runs to ". If you have other tasks", its white space is normalised, and it is no reason when it is one of the four stand-in sentences or the text does not open that way. A reason longer than 1,000 characters is cut at a word and ends in "…". Through the gateway the reason is always the stand-in (fourteen of fourteen recorded blocks), so there the row reads ``Auto mode blocked: `cmd` `` alone. This is one function, `classifierReason`, and `cellOf` calls it for the kind `automode-blocked` only: every other refusal's label is as today. A call the classifier could not judge (`automode-parsing-error`) keeps ` · review unreadable` and gets no button: nothing was judged, so there is nothing to consent to.

The engine's advisory for a refused call (the wire's `system/permission_denied`, which the host maps to a notice keyed `permission_denied:<tool use id>`) is not drawn as a row. The refused call's own row says it, on every route; a transcript file never held the advisory, so today the live route alone draws it (Reported 5). The host still emits the event, and its broker still reads the frame.

### 2. What an approval names, and how a row knows it was approved

**The name.** One function, `blockedCallOf(toolName, input)`, gives a call's name, by the engine's own rule for its "Recently blocked" list (`cli.pretty.js:1242837-1242850` and `:1242901-1242905`; the sentence at `:521384-521387`):

- a shell call (`shellToolOf`: Bash, PowerShell) whose input holds a non-empty `command` and no other key but `description`, `timeout`, and `run_in_background` or `dangerouslyDisableSandbox` set false, is `{ kind: 'command', subject: command }`;
- any other call is `{ kind: 'call', subject }`, the subject being the compact JSON of `{ tool, input }`, or of `{ server, tool, input }` for an MCP tool (`MCP_TOOL` in `classify.ts`), when that string is at most 4,096 UTF-16 units (the engine's own bound, `:530211`);
- a call whose JSON is longer has no name, and its row no button. The engine itself withholds the exact string there, and a grant that names less than the call would approve something else.

`cellOf` puts the name on the cell (`Cell.blocked`) for a call of kind `automode-blocked`, from the recorded call's input. The one list of shell tools was read in the bundle by its use, not its definition; `shellToolOf` is MAWS's reading of it (What is not proven, 5).

**The rule.** One pure function, `blockedStates(rows, hidden)`, reads the transcript's rows in order and answers, for each blocked call's row, its name and two facts. With *k* the row's key, and counting only rows outside a hidden branch (a rewound turn's rows prove nothing about what the session holds now):

- **again:** an approval row for *k* stands before it, read or waiting, and not dropped.
- **grant:** `read` when an approval row for *k* stands after it that is not dropped and carries no waiting mark (`pending`, `unread`); else `waiting` when one stands after it that waits; else `none`.

An approval row is a `user` row with `consent`, and nothing else: the mark is the reader's, put on by the host or the file reader that saw whose row it was (Reported 9). The row reads **approved** exactly when `grant` is `read` (`readsApproved`). Nothing else makes a row approved: not a press, not the queue, not a later run of the same command.

Why the rows, and not the turn's derivation: the grant is rarely in the turn that holds the block, so a rule inside `deriveTurn` needs an index in the reducer, a re-derivation of every turn that holds the key, and an order across turns, pages and hidden branches. The flat row list is already in order, an approval row stays in view through every fold, and a blocked row needs its state only while it is drawn. So the rule is one pass over rows the store already holds, memoised on the rows' identity, and the model's turn memo is untouched. Two consequences are accepted. A blocked row drawn while an older page is not loaded reads "blocked" where it would read "blocked again", until that page is loaded; "approved" is never wrong for a drawn row, because every row after it is loaded with it. And the copied transcript (`serialize.ts`) carries the row's base words, with the approval's own line after it.

What is sent is the name the rule read from the store's own row, never the drawn cell's: where a mod rewrote the call's props for drawing, the drawn label follows the mod and the grant does not.

A later run of the same command does not retire the button, and several blocked rows of one key all read the same: a grant after them approves each. The sentence only permits a retry, and nothing in a folded turn's rows could say on every route that the call has since run.

### 3. The press, and two presses

A press calls the session's own send with the grant: `sendToSession(appSessionId, consentMessage(kind, subject), { origin: 'answer' })`. Nothing else is sent, on any route, and no new command, offer or event exists.

The send is awaited, and its answer and the record arrive on different channels, so the window keeps one small state per session and key, **a grant out**, whose only effect is to keep the button closed. It never makes a row read approved.

| state | event | next | what the row shows |
|---|---|---|---|
| none | press, with the gate open | out, unanswered; it remembers `rows`, how many approval rows the transcript holds for the key | the button, disabled |
| out, unanswered | the send answers `sent`, `steered`, `queued` or `unconfirmed` | out, answered; `quietSince` is now | the button, disabled |
| out, unanswered | the send answers `refused` or throws | none, with a notice: the answer's `reason`, or the error's message | the button, enabled, and the notice under it |
| out (either) | the transcript holds more approval rows for the key than `rows` | none | what the record says: approved, the button disabled while the grant waits, or the button again when the grant was dropped |
| out, answered | a grant for the key waits outside the transcript (Design 4) | out, answered; `quietSince` is now, each time it is seen | the button, disabled |
| out, answered | `SETTLE_MS` (5 s) pass after `quietSince` | none | what the record says |
| none, with a notice | a press, or the row leaves "offered" | none, no notice | — |

"The approval rows the transcript holds for a key" counts every one, read, waiting or dropped (`approvalsFor`). The linearisation point of a press is the synchronous step that records "out" before the send is called; a second press, on this row or on another row of the same key, finds the gate closed and sends nothing. The state ends at the transcript's own approval row, which every grant that reached the session leaves on every route (a host of build F marks none: there the settle time ends it, Reported 9). The settle time covers what leaves none and the moments between two channels: a grant deleted from the queue before it was written (the button returns five seconds after it leaves the queue), a queue entry released before its row is drawn, a terminal send whose fate is entered before its row is read from the file, and an answer that names nothing to follow. A press whose send never answers stays out until the pane is closed; the port's own bounds end every send (a host's command deadline, the bridge's 5 s answer, the link's hold), so that is a fault of the port and not a state to design. After a reload nothing is out, and the record alone decides.

### 4. While the grant waits

A grant **waits** for a key when the record holds it unread: an approval row after the block that carries `pending` or `unread` (a steer the engine has not taken, a prompt behind a running turn); an entry of the session's queue that is not released, or a steer the queue lists, whose text is a grant for the key; a pending send of a terminal session, in the state `sending` or `unconfirmed`, whose text is one. While a grant waits the button is drawn disabled, and the message is where every waiting message is: above the composer. Deleting it there brings the button back; sending it now or the turn's next step makes it read. A grant held back into the queue by a Stop is a queue entry like any other and keeps the button closed until the queue sends or the person deletes it.

Above the composer, a waiting grant's row reads ``You approved cmd``, the words of the line it becomes, with Send now and Delete, and no Edit and no move: an edited grant is no grant (Reported 7, card 2).

The readers of "a message of this session waits" today are `stackRows` (with `readOfEntry` in `stack-acts.ts`), `withQueueTail` in `derive.ts` and `PendingSends.tsx`. The gate does not go through `stackRows`, which words rows for drawing and leaves out a submission younger than 300 ms; it reads the same three stores for every moment.

### 5. Where the button is, and where it is not

The control is drawn inside the blocked call's own line component (`CellLine`), under the line, for a cell that carries `blocked`, in a session's own transcript (`variant: 'session'`), where the mount supplies it. So it follows MAWS's drawing of the call: where a mod draws the call itself, the mod's drawing stands (law 2) and there is no button. It is not drawn in a subagent's transcript (Reported 4), in the desk web app or the harness (no mount supplies it), nor on a row of a hidden branch.

Its gate has four values, by precedence: **approved** (no button; the label says it); **closed**, a grant is out or waits (the button, disabled); **unavailable**, the session takes no message now (the button, disabled, its `title` the reason); **open**. The reason is the port's own answer to `capability('send')`, the function the composer, the comment card and both ports' `send` already read, or `heldWords` where no port drives the session. No sentence is written for this landing.

Under a row that is blocked again and still offers the button, one muted line explains the repetition (Interfaces §A). It leaves with the button.

### 6. Routes (root law 5)

| route | the row | the press | what closes the button, in whose words |
|---|---|---|---|
| A session MAWS runs here | The wire's `non_execution_kind`; from its transcript file after a relaunch, the row's `toolDenialKind`. | `session.send` when idle (after `session.acquire` for a released session), `session.steer` at the next step while a turn runs (Reported 3). The host marks the grant as it writes it. | `capability('send')`: the process starting or ended, a holder elsewhere. A send's refusal: a trust or relay step (the card's words), the host's error. |
| A terminal session here | The file's `toolDenialKind`, read as it is written. | `laneA.send`: the bridge submits the words as the user when idle and appends them into a running turn. The row and its line come from the file (M2). | No bridge: `heldWords` ("Held by …"). A bridge that cannot deliver: the bridge's reason. `unconfirmed`: the pending-send strip, and the button closed while it holds the words. |
| A session MAWS runs on another machine | The events of that machine's host. | One invocation, `session.send` or `session.steer`, over the offers of those names (`src/endpoint/offers.ts`, `laneB('act')`), graded `converse` by effect (`src/shared/ipc/grades/session.ts`). | Main's overlay for `send` (`remote.session`): the link down, the member's grade; a grade refusal in `READER.notSent`'s words. |
| A terminal session on another machine | The rows of that machine's file, mapped in this window. | `laneA.send` through main's remote adapter, the offer `sminos.send`, graded `converse` by effect. | The link's reason, the bridge's. |

**Authority.** The grant is a message, and the machine grades it as words, where the act runs, on the text it runs (`textGrade`'s floor, `converse`). It is not graded as a permission decision (`approve`), on purpose: the engine takes any go-ahead in the person's words as consent to a blocked call, so a higher grade on this one sentence would guard nothing a `converse` member cannot type. A member whose grade is `view` has the port closed (`gated`, `controls-for.ts`), so the button is drawn disabled with the reason and whom to ask.

**A peer on each build.** The offers `session.send`, `session.steer` and `sminos.send` exist with the same grade at this build, at master `2c7044231` and at build F (`git show <sha>:src/endpoint/offers.ts`), so the press crosses the link to all three. What comes back differs:

| the session's machine runs | a session MAWS runs there | a terminal session there |
|---|---|---|
| this build | the host marks the grant; line, approved | rows mapped here; line, approved (M2) |
| master `2c7044231` | its host marks the grant (U3a is in it); line, approved | rows mapped here; the same |
| build F | no mark: the grant is the person's bubble, the row does not read approved, and the button returns after the settle time (Reported 9) | rows mapped here; the same |

Seen from a window of an older build, a session of this build shows the grant as U3a's line (`2c7044231`) or as the person's bubble (F, which drops the `arrival` key it does not know), and the blocked row with today's long label and no button.

*Tests:* the two ports' sends with a fake client (M3: one invocation, its name and its content; the refusals); an event without the mark, which leaves the row unapproved and ends the grant-out state by the settle time (M1, M3). No scene is added to `e2e/remote.spec.ts`: no code on the link's path changes.

### 7. Stored and sent (root UC-14)

This landing stores nothing: no layout key, no setting, no file, no field of a stored form, and no wire minor. It sends one message, whose text is the grant, through commands every build has. What an older build can meet is that text where any message's text is kept: a session's journal and transcript file, the queue's state file while the grant waits (`QueueState.entries[].content`, a string, read by F and by `2c7044231` as an ordinary queued message, sent as one), and a terminal session's rows. A run of this build, then F, then this build leaves a queued grant queued and a sent grant in the transcript, where this build reads it again. No cross-build run is owed: no stored form changes and no minor is taken, so neither the two-build run nor the equal-wire run has a scene of this landing's to run. The coverage table (U13a's M5) gains no row.

### 8. One reading of each fact

| fact | the one function | who reads it today |
|---|---|---|
| what kind a call's refusal is | `denialKindOf` (`engine-host/normalizer-support.ts`), from the wire's `non_execution_kind` and the file row's `toolDenialKind` | `Normalizer` (the result branch), `recordToEvents`; then `classifyTool` and `denialDisposition` (`classify.ts`), whose answer on the cell (`classification.denial`) is read by `cellOf`, `labelOf`, `stoppedMember`, `caption.ts`, the turn's summary (`denialOfCell`), `CellLine`'s `asLabelled`, the attention service (`automode-unavailable` only) and `computer-use/reading.ts`. This landing reads `classification.denial.kind` on the cell and adds no reader of the raw fields. |
| the grant's sentence, and whether a text is one | `consentMessage` and `readConsent` (today's private `consentOf`) in `arrival.ts` | the reader's `personsText`; the normaliser's `userOut`; the file reader. This landing's callers of `readConsent`, each for a message that waits and has no row yet: `grants.ts`, `stack.ts`; and M2's two insertions. |
| whether a session takes a message now, and why not | `SessionControls.capability('send')`; `heldWords` with no port | `Composer.tsx`, `composer/editor/submit.ts`, `side/comment-form.ts`, each port's `send` |
| what a call is named in a grant | `blockedCallOf` (new) | `cellOf`, once per blocked call |
| whether a blocked row is approved, waits, or is blocked again | `blockedStates` (new) | `CellLine` (the label), the control |
| the classifier's reason | `classifierReason` (new) | `cellOf` |
| which messages wait | the three stores of Design 4 | `stackRows`, `withQueueTail`, `PendingSends.tsx`; the gate (Design 4 says why not through `stackRows`) |

### Why this, not that

- **The approval read from the turn's derivation** (an index in the reducer, as U1b's answer join). Rejected: Design 2. It would also put this landing's edits in `reduce.ts` and `derive.ts` beside two landings in flight.
- **Approved from the press.** Rejected by the brief and by a reload: the sent message is the only record.
- **A new origin, command or offer for the grant.** Rejected: "it is only a send" is what makes three routes one behaviour; `origin: 'answer'` is an existing provenance and only `'composer'` is branched on.
- **A handle per send** (the message uuid, the queue id, the delivery key) to know when the record has caught up. Rejected for the count of Design 3: the three handles need three followers, one a route, where one count of the transcript's approval rows and one settle time serve every route alike.
- **Words for the waiting state on the row** ("Approval waiting"). Rejected as the default: the stack already names the wait, and a new sentence is the owner's to choose (card 1).
- **Keeping the advisory row and shortening it.** Rejected: it would be a second row for one refusal on one route only.

### What is not proven

1. A grant delivered by the bridge, in any of its three states (probe T). The line's drawing there (M2) is proven on row shapes the U5 probe recorded, with the grant's text in place of that probe's.
2. A grant written during the blocked call's turn (probe B).
3. A block of another tool and its grant (probe C); a block inside a subagent (probe D). The subject of a `call` follows the bundle, not a recording.
4. A classifier block as a transcript file (probe E): the file-route tests use constructed rows that carry the keys the probe's digest recorded (`uxw_transcript_failed_rows`).
5. The engine's list of shell tools, read by its use. If it holds a tool `shellToolOf` does not, that tool's blocked call is named as a `call`, which is a longer subject and not a wrong one.
6. The engine escapes invisible and control characters in its own sentence (`cli.pretty.js:521381-521385`); `consentMessage` quotes with `JSON.stringify` alone. Nothing here depends on the difference; it is noted for U3.
7. Whether the engine's count of consecutive blocks runs across turns. The row's line for a repeated block is the child's text either way.

## Acceptance

The child's line A15, on the three routes, as behaviour. Items 1 to 4 are over the probe's recordings; each names where it is proven.

1. **Approve, and the retry runs** (`u1-soft-seeded-1` to `-5`). After the block the row reads ``Auto mode blocked: `curl -s -o marker-N.txt "https://example.com/?maws-probe-marker-N"` `` with nothing after it, and carries **Approve and retry**. From the frame MAWS writes for the grant on, at every prefix of the journal, the row never offers the button again; once the grant is read the row ends in ` · approved`, the line ``You approved `curl …` `` stands in the next turn, and the retry is a row that ran. The grant the press builds is byte for byte the recorded `out` frame's content, in all ten recordings that hold one. *(M1 by prefixes; M3 for the press; M4's scene S1 on the running app.)*
2. **Blocked again** (`u1-hard-seeded-1` to `-3`). The first row reads approved; the retry's row reads ``Auto mode blocked again: `curl …` ``, carries the button, and under it the line "A rule that always denies this command blocks it every time. Change the rule or the mode to run it." *(M1, M3; scene S2.)*
3. **Two blocks in a row, then the engine asks** (`u1-streak-seeded-1`, `-2`). Two blocked rows, each with its own button and neither "again"; the third and fourth calls are ordinary calls that ran, and their requests are ordinary permission requests (`decisionReasonType` `classifier`). Nothing is built for them. *(M1.)*
4. **No block, no row** (`u1-norule-seeded-1`, `-2`): no blocked row and no button; the grant the probe sent there still draws as the approval's line.
5. **No stand-in, and no second row.** Over all fourteen recorded blocks no row's text holds "it gave no explanation", and no row is drawn from the advisory. A reason that is not a stand-in is shown: a result text with the engine's opening and an invented reason reads ``Auto mode blocked: `cmd` · <that reason>``. *(M1.)*
6. **The same from a file, and after a reload.** The same session as rows of a transcript file (constructed, with the keys the probe's digest recorded) gives the same row states as the journal, applied whole, in two batches split at the grant, and in a fresh state. *(M1.)*
7. **A terminal session.** A file whose grant the bridge carried, idle (a row of the plugin's origin submitted as the user), during a turn (an appended row and its mirror line) and after an Esc (the same, then the wake), draws the approval's line and reads the block approved, from the file and from another machine's rows alike. The press reaches the bridge once, with the sentence whole. *(M2; M3; scene S4.)*
8. **Another machine.** The press is one `session.send`, or one `session.steer` while a turn runs, with the sentence as its content; with the overlay's `send` closed the button is disabled and its `title` is the overlay's reason; an event without the mark (a host of build F) leaves the row unapproved, and the button returns after the settle time. *(M3, M1.)*
9. **Two presses send one grant.** With the send held open, a second press on the same row and a press on another row of the same key send nothing. With the send answered and the transcript's row withheld, the same, for as long as the grant waits in the queue and for `SETTLE_MS` after it leaves. When the transcript then shows the grant's row, the row follows the record at once. When the settle time passes with no row, the button returns. *(M3, with fake timers and a send that resolves on command.)*
10. **A refused press says why.** A send that answers `refused`, or throws, leaves the button enabled with the answer's words under it, and the next press clears them. *(M3.)*
11. **While it waits.** With a turn running, the press steers; the row's button is disabled; the stack's row reads ``You approved <the command>`` with Send now and Delete and no More; Delete brings the button back; the turn's next step makes the row read approved. A grant in a paused queue keeps the button disabled after the pane is mounted afresh. *(M3; scene S3.)*
12. **Where there is no button.** A subagent's transcript; a row of a rewound branch; a call whose JSON passes 4,096 units; a call of kind `automode-parsing-error`; a mount that supplies no control. Each draws the row and no button. *(M1, M3.)*

## Constraints that bind every milestone

- The rules of `~/.local/share/maws-ux-wave/briefs/build-common.md` bind: no typecheck, lint, test, install, build or Electron on the MacBook; every check on the VM in a checkout of the pushed head; a merge of master, never a rebase or a force-push; commits end with the trailer the brief gives and carry no other attribution.
- The engine is the pinned 2.1.322 and is not patched (charter D-1). Every statement about what it sends rests on a file under `spikes/protocol-probe/fixtures/` or on the bundle read as a reference, and the design says which; an executor who needs a fact neither holds stops and reports it.
- Root law 5: every behaviour is stated per route (Design 6). Root law 7: today's tokens and shapes; no colour or geometry is added. Root UC-6: no chord is added. Root UC-11: the repository is public; test content is invented, and nothing of a real session, journal or settings file is read or copied.
- Root UC-8 and UC-3. The files of other owners this landing edits, each by the smallest insertion, all named here: `src/shared/engine/arrival.ts` and `src/engine-host/fs/backfill.ts` (U3: M1's export, M2's three insertions); `src/renderer/src/composer/queue/stack.ts` and `QueueList.tsx` (U4: §F); `src/renderer/src/transcript/view/context.tsx` and `transcript/view/cells/CellLine.tsx` (the transcript's view: one optional member, one mount); `transcript/model/cells.ts`, `rows.ts`, `schema.ts`, `copy.ts`, `derive.ts` (the transcript's model: the field, the label's inputs, the reason, one predicate); `src/renderer/src/App.tsx` (one registration). `groups.ts`, `classify.ts`, `reduce.ts`, `Transcript.tsx` and `TranscriptSlot.tsx` are not edited.
- Root UC-14: nothing is stored and no wire minor is taken (Design 7). An executor who finds a need for either stops.
- The words a person reads are those of Interfaces §A, exact. A guard reads renderer source for `#` followed by hex digits as a colour: a ticket is written in words ("ticket 594").
- Engine facts still open are the probes'. M2 does not start until the architect has said that probe T is answered or that its default stands; the same for probe B and the one line of M3 it decides.

## Plan of Work

Four milestones, each on the one before. M1 is pure and changes what every route draws; M2 is the reader's; M3 is the control; M4 is the scenes and the acceptance.

### M1 — The row's words, what an approval names, and what the rows say

**What exists at its end.** A blocked call's row reads the short label on every route, with a real reason when the classifier gave one and none of the stand-ins; the advisory row is gone; each blocked cell carries the name a grant would give it; and `blockedStates` answers, from rows alone, which blocked rows are approved, wait or are blocked again. `CellLine` draws "again" and "· approved". No button yet: a row that would offer one reads as a blocked row.

**What it touches.** New: `src/renderer/src/transcript/model/blocked.ts` and its test. Edited: `transcript/model/cells.ts` (`cellOf`: the reason, the field), `rows.ts` and `schema.ts` (`Cell.blocked`), `copy.ts` (`cellLabel`'s two inputs, the words of §A), `derive.ts` (the predicate, in the turn's and the loose rows' `notice.posted` cases), `transcript/view/cells/CellLine.tsx` (the label), `src/shared/engine/arrival.ts` (`consentOf` exported as `readConsent`). Tests that pin today's label and change: `copy.test.ts` (the `auto_denied` cases gain the two inputs), `fixtures.test.ts` (the `denials` journal's blocked call reads without its invented text, which does not open as the engine's does), `reduce.test.ts` (the label list of its four refused calls), and any snapshot of rows that holds an advisory row or the long label (the executor finds them with the suite of the folders below).

**Interfaces.** Exposes §A, §B and `readConsent` (§C) to M2 and M3. Consumes nothing.

**Decisions.** `blockedStates` is memoised on the rows array and the hidden turns (a `WeakMap`), and is asked by a store selector that answers `undefined` at once for a cell that is not a blocked call, so an ordinary cell pays nothing. The label is recomposed in the view through `cellLabel`, with the subject from one helper that `labelOf` also calls, never by editing the label's string. The `denials` journal is not edited (other suites read its events); the real-reason case is a unit case through `cellOf`. `Cell.blocked` is written only when present, so every stored snapshot of a cell without it still parses.

**What it does not touch.** The reducer, the turn's derivation beyond the one predicate, the fold rules, the turn's line and its counts, `classify.ts`. No button, no store, no send.

**What it proves.** Acceptance 1 to 6 at the model's level, and 12's first four cases. Beyond acceptance: `classifierReason` over each of the four stand-ins, a reason with inner white space, one longer than 1,000 characters, and a text without the opening; `blockedCallOf` over a plain command, a command with `description` and `timeout`, one with `run_in_background: true` (a `call`), an MCP tool (`server`, `tool`), a `Write`, and a call one unit past the bound; the rule over a dropped approval (the button returns), a waiting one (`waiting`), an approval in a hidden branch (not counted), two blocked rows of one key before one approval (both approved), a block, an approval and a block inside one turn (a steer); a command with quotes, a backslash and a line break, whose approval row matches it; a `user` row without `consent` whose text is the grant, which is no approval row (Reported 9).

### M2 — The approval's line on the terminal route

**What exists at its end.** A terminal session's transcript, read from its file on this Mac or as another machine's rows, draws ``You approved `cmd` `` for a grant the bridge carried, in each of the bridge's three forms, and the blocked row before it reads approved.

**What it touches.** `src/shared/engine/arrival.ts` (two insertions), `src/engine-host/fs/backfill.ts` (one, in the two functions that make the person's message of appended words), their tests (`arrival.test.ts`, `backfill.test.ts`), and `src/renderer/src/lane-a/arrival-routes.test.ts`, which already draws one text by both file routes.

**Interfaces.** Consumes `readConsent`. Exposes nothing new: the events are U3a's (`arrival: [consent]` on a `user.message`).

**Decisions.** §C. The appended row itself is not made an arrival: its words become the person's steer where the bridge's mirror line names them, and the mark is put on that steer, so one message uuid never carries the mark on two events. The reader's first rule gains one clause and its header comment says so.

**What it does not touch.** `plane-transcript.ts`, `bridge-rows.ts`, the reducer, the model. No other class of arrival, and no row that today reads as a peer's, a wake or an answer.

**What it proves.** Acceptance 7's reading half. Beyond it: a bridge delivery whose text is the grant with a sminos frame line before it is a peer's or the person's delivery as today, not an approval; a row of another plugin's origin with the grant's text is no approval; the grant in a row submitted as the user by a plugin that is not a bridge plugin (`BRIDGE_PLUGINS`) is no approval; a peer's inbox message holding the sentence is a peer's message; the three forms through `recordToEvents` directly and through the remote rows' path give the same rows.

### M3 — The button, the press and the waiting row

**What exists at its end.** The control of Design 5 on every route, with the gate, the press and the grant-out state of Design 3, the waiting state of Design 4, and the stack's row of §F.

**What it touches.** New: `src/renderer/src/blocked-call/` (`grants.ts`, `ApproveAndRetry.tsx`, `index.ts`, tests). Edited: `transcript/view/context.tsx` (one optional member), `transcript/view/cells/CellLine.tsx` (the mount), `transcript/view/transcript.css` (the control's two rules), `src/renderer/src/App.tsx` (the registration, beside the other transcript-action registrations), `composer/queue/stack.ts` and `QueueList.tsx` with their tests.

**Interfaces.** Consumes §A, §B, `readConsent`, the session's port (`sendToSession`, `sessionControls`, `heldWords`), the queue store and the lane A store. Exposes §D, §E, §F.

**Decisions.** The control is supplied to the transcript through `registerTranscriptActions`, as the composer's edit actions are, so the transcript's view imports no app store for it and a mount without it (the desk web app, the harness) draws none. The grant-out state is module state behind a subscription, keyed by session and key, with one timer per state for the settle time; it is cleared for a session when its last control unmounts. `gateOf` is the only function that decides the gate; `approve` the only one that sends. A notice is the port's words, never composed. The button is a native `button` with `disabled` and `title`, as the stack's controls are; the muted line and the notice are `role="status"`.

**What it does not touch.** The ports (`session/controls/`), `send-human-prompt.ts`, the offers, the endpoint, the host. No new origin, command or capability.

**What it proves.** Acceptance 7's press, 8 to 11, and 12's last case. Beyond acceptance: the gate's precedence (approved over closed over unavailable over open) in each pairing; the name sent is the store's when the drawn cell's props were rewritten; `origin: 'answer'` and no `when`; a session with no port sends nothing and shows `heldWords`; a queue entry in each state (`queued`, `submitting`, `released`), a listed steer, a pending send in each of its three states, each for the right key and for another key; the stack's `rowText`, its controls and its folded line for a waiting grant, and a waiting answer's row unchanged.

### M4 — The scenes, the whole suite and the acceptance

**What exists at its end.** Four scenes that an agent on a Mac can run, the debt row of Reported 10, and the acceptance list checked on the branch's head.

**What it touches.** `e2e/composer.spec.ts` (S1 to S3, in the group `e2e:composer`, which `e2e:c7` also runs), `e2e/support/c7-replay.ts` (a journal for S3), `e2e/lane-a.spec.ts` (S4, the group `e2e:lane-a`), `e2e/support/lane-a.ts` (a refused row's record), `docs/tech-debt-tracker.md`. No new spec file, so the gate's count of spec files and its group lists are unchanged.

**Interfaces.** §G.

**Decisions.** S1 and S2 replay the probe's recordings as they are, through the replay's own handshake adaptation; the replay matches a write by its frame type, so the press's content is read from the `user.message` event, as the composer's scenes read theirs. S3 needs a turn that outlives the block, which no recording holds, so its journal is built by a builder in `c7-replay.ts` from the recorded block's frames and a held tool call, with invented text. A scene's wait is one of the forms the gate's guard allows (`.github/scripts/gate-plan.test.mjs`, above `LIVENESS_BOUNDS`).

**What it does not touch.** Product source, unless a scene finds a defect, which goes back as a finding.

**What it proves.** The whole unit suite, once, and the acceptance list by number. The scenes are written, typechecked and guarded here, and run by the architect (Proofs an executor cannot run).

## Concrete Steps

Working directory for every command: the branch's worktree (branch `ux-wave/U1c`; the controller's brief names it). Checks run on the VM in a checkout of the pushed head, so commit and push first; the helper prints `vmcheck: ux-wave/U1c at <short sha>` and exits with the command's status, so it is never piped into `head` or `tail`.

    git fetch origin master && git merge origin/master

Then re-read "What this document assumes of the landings in flight" against whatever the merge brought, and after any merge run the milestone's own set again.

M1, after each push:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 600 pnpm exec eslint src/renderer/src/transcript src/shared/engine/arrival.ts'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 1200 pnpm exec vitest run src/renderer/src/transcript src/renderer/src/lane-a src/renderer/src/stores/transcript src/shared/engine test/support/tokens-guard.test.ts'

Expect each to exit 0, the first run of `blocked.test.ts` to have failed before its source existed, and the three label tests named in M1 to fail before their expectations move and pass after. The known failures of `build-common.md` on the VM are not this landing's.

M2:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.node.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/shared/engine src/engine-host/fs && timeout 1200 pnpm exec vitest run src/shared/engine src/engine-host/fs src/engine-host/normalizer-arrivals.test.ts src/renderer/src/lane-a src/renderer/src/transcript/model'

M3:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 900 pnpm exec tsc --noEmit -p tsconfig.web.json --tsBuildInfoFile /dev/null && timeout 600 pnpm exec eslint src/renderer/src/blocked-call src/renderer/src/transcript/view src/renderer/src/composer/queue src/renderer/src/App.tsx && timeout 1500 pnpm exec vitest run src/renderer/src/blocked-call src/renderer/src/transcript src/renderer/src/composer src/renderer/src/session/controls src/renderer/src/App.test.tsx test/support/tokens-guard.test.ts'

M4, the builder of the last milestone, once:

    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 1500 pnpm typecheck'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 600 node --test .github/scripts/*.test.mjs scripts/*.test.mjs'
    ~/.local/share/maws-ux-wave/tools/vmcheck.sh ux-wave/U1c -- 'timeout 3000 pnpm test'

Expect the typecheck and the script tests to exit 0 and the unit suite to fail only in the files `build-common.md` lists as failing on master. Then the executor stops and hands back: the head's sha, the commands run with their results, the acceptance items by number with the test that holds each, the decisions made, and anything that contradicts this document. It runs no `scripts/ci-gate.sh`, opens no pull request and starts no Electron e2e. Class 1a, the review of the branch and the pull request are the architect's.

## Interfaces and Dependencies

### §A. The words (M1, M3), exact

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

The approval's line is U3a's, unchanged: `CONSENT.approved` ("You approved") and the subject as inline code. The stack's row (§F) is `${CONSENT.approved} ${subject}`, plain text. A disabled button's `title` and a notice are the port's words. No other sentence is added.

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

### §B. `transcript/model/blocked.ts` (M1)

    /** The classifier's own reason in a blocked call's result text; null when it gave none (Design 1). */
    export function classifierReason(resultText: string): string | null;

    /** What a grant names. */
    export interface BlockedCall { kind: 'command' | 'call'; subject: string }
    /** A call's name by the engine's rule, or null when it cannot be named whole. */
    export function blockedCallOf(toolName: string, input: unknown): BlockedCall | null;
    export const blockedKey = (call: BlockedCall): string => `${call.kind}\u0000${call.subject}`;

    export interface BlockedState { call: BlockedCall; again: boolean; grant: 'none' | 'waiting' | 'read' }
    /** Whether the row reads approved: a grant that was read (card 1's one place). */
    export const readsApproved = (state: BlockedState): boolean => state.grant === 'read';
    /** Every blocked call's row that can be named and is outside a hidden branch, by its cell id (the rule of Design 2). */
    export function blockedStates(rows: readonly Row[], hidden: readonly TurnId[]): ReadonlyMap<CellId, BlockedState>;
    /** The approval rows for a key outside a hidden branch, read, waiting or dropped: the transcript's part of a press's count. */
    export function approvalsFor(rows: readonly Row[], hidden: readonly TurnId[], key: string): number;

`hidden` is the state's own list (`state.hidden?.turns`, or an empty constant), so the memo holds on its identity.

On `Cell` (`rows.ts`), with `blocked: z.strictObject({ kind: z.enum(['command', 'call']), subject: z.string() }).optional()` in `schema.ts`:

    /** UX wave U1c: what a grant for this call names; present only on a call auto mode blocked that can be named whole. */
    blocked?: BlockedCall;

A blocked call's row is a `cell` row whose `classification.denial.kind` is `'automode-blocked'` and which carries `blocked`. `blockedStates` reads the name from that field and nothing else of the call.

In `derive.ts`, beside `supersededByHookRow`, used in both `notice.posted` cases:

    // UX wave U1c: the engine's advisory for a refused call (the wire's `system/permission_denied`), which the call's own row says on every route
    const supersededByCallRow = (event: Event<'notice.posted'>) => event.key?.startsWith('permission_denied:') === true;

### §C. The reader's insertions (U3's files)

M1, in `src/shared/engine/arrival.ts`: today's private `consentOf` is exported under the name `readConsent`, with `readAnswerEnvelope`'s kind of comment (a grant read from a message's text alone, for a message that still waits). `personsText` calls it. No behaviour changes.

M2, three insertions:

1. `arrival.ts`, `pluginRow`, after the answers and the wake: a row a bridge plugin (`BRIDGE_PLUGINS`) **submitted as the user** (`deliveredPrompts(row)?.kind === 'submitted'`) whose whole text `readConsent` reads is `[consent]`. A row that opens with a sminos frame line is read as today, before this.
2. `arrival.ts`, `attachmentRow`, the branch of a `queued_command` of origin `human`, mode `prompt`, not meta: the prompt's text is the string, or, when the prompt is text blocks alone, their text (`messageText`). Today the function leaves at its top for any prompt that is no string; the insertion admits blocks for this branch only. This is the form `steerAsDrawn` (`lane-a/source/bridge-rows.ts`) gives a row the bridge appended, on the route of another machine's rows.
3. `engine-host/fs/backfill.ts`, where words the bridge appended become the person's message: `steered`, and the `said` of `withWaitingWords`. The `user.message` each builds carries `arrival: [consent]` when `readConsent` reads its words. The appended meta row itself stays as today (a synthetic message with no mark).

The reader's header comment, rule (1), gains: "…and its consent message where a sminos bridge carried it for the person".

### §D. The transcript's seam (M1, M3)

In `transcript/view/context.tsx`, on `TranscriptActions`:

    /** UX wave U1c: the control under a blocked call's line, for the row's session. Optional, with no default: a mount that omits it draws none. */
    renderBlockedCall?(props: BlockedCallProps): ReactNode;

    export interface BlockedCallProps { call: BlockedCall; again: boolean; grant: 'none' | 'waiting' }

In `CellLine`: a selector on the transcript's store gives the cell's `BlockedState` (`blockedStates(entry.rows, hidden turns).get(cell.id)`, `undefined` at once for any other cell). With a state, the drawn label is `cellLabel` with `again` and `approved: readsApproved(state)` (U1b's waiting label, where present, takes precedence and cannot coincide). After the line's button and before the detail, when the row does not read approved, the context's `variant` is `'session'` and the action exists: `actions.renderBlockedCall({ call: state.call, again: state.again, grant: state.grant })`.

### §E. `src/renderer/src/blocked-call/` (M3)

    // grants.ts
    export const SETTLE_MS = 5_000;
    export type Gate = { state: 'open' } | { state: 'closed' } | { state: 'unavailable'; reason: string };
    /** The keys of the grants the record holds unread outside the transcript: the queue's entries that are not released, its steers, a terminal session's pending sends that are sending or unconfirmed. */
    export function waitingGrants(appSessionId: AppSessionId): ReadonlySet<string>;
    /** The gate, by the precedence of Design 5. The one place a route, a state or a probe's answer closes the button. */
    export function gateOf(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): Gate;
    /** The press (Design 3). The only caller of the port's send for a grant: `sendToSession(appSessionId, consentMessage(call.kind, call.subject), { origin: 'answer' })`. */
    export function approve(appSessionId: AppSessionId, call: BlockedCall): Promise<void>;
    /** The gate and the last press's notice, followed in a render. */
    export function useGrant(appSessionId: AppSessionId, call: BlockedCall, grant: 'none' | 'waiting'): { gate: Gate; notice: string | null };

    // ApproveAndRetry.tsx: the button (BLOCKED.approve; disabled unless the gate is open; its title an unavailable gate's reason),
    // the muted line BLOCKED.always[call.kind] when `again`, and the notice. The session is `useRowSession()`.
    // index.ts: `registerBlockedCalls(): () => void`, which registers `renderBlockedCall` through `registerTranscriptActions`; App.tsx calls it once.

`gateOf`: closed when a grant is out for the key, when `grant` is `'waiting'`, or when `waitingGrants` holds the key; else unavailable with `capability('send')`'s reason, or `heldWords(appSessionId)` when `sessionControls` answers null; else open. The grant-out state is the table of Design 3, followed from the transcript's store (`approvalsFor`), the queue store and the lane A store.

### §F. The stack's row (U4's files, M3)

In `composer/queue/stack.ts`: a row that has content carries `grant: BlockedCall | null`, read by `readConsent(messageText(content))`; `rowText` answers `${CONSENT.approved} ${grant.subject}` for such a row, and for a row that has only text (`sending`, `handed`) when `readConsent` reads that text; `newestToTake` skips a grant, as it skips an answer. In `QueueList.tsx`: a grant's row draws Send now and Delete and no More menu. An answer's row and every other row are unchanged.

### §G. The scenes (M4)

- **S1** (`e2e/composer.spec.ts`): the real session pane over the replay of `spikes/protocol-probe/fixtures/uxwave/u1-soft-seeded-1.jsonl`. A prompt is sent; the turn's line holds "1 auto-denied"; a click on it shows the row, whose text is ``Auto mode blocked: curl -s -o marker-1.txt "https://example.com/?maws-probe-marker-1"`` and nothing more, with the button; the press's `user.message` content equals `consentMessage('command', …)` for that command; the line "You approved …" is drawn; the row's text ends in "· approved" and holds no button; the retry's cell reads done. Screenshots: offered, approved.
- **S2**: the same over `u1-hard-seeded-1.jsonl`, to the second turn's row: "Auto mode blocked again: …", the button, the muted line. Screenshot.
- **S3**: a built journal whose turn holds the recorded block and then a call that the replay holds open. The press while the turn runs: the stack's row reads "You approved …" with its mark "Next step", Send now and Delete; the row's button is disabled; Delete brings it back; a second press and the release of the hold make the row read approved. Screenshot: greyed, with the stack.
- **S4** (`e2e/lane-a.spec.ts`): a terminal session whose transcript holds a blocked call (a result record with `toolDenialKind: 'automode-blocked'`). The row and its button; the press reaches the fake bridge as one delivery whose text is the sentence; the scene writes the bridge's row (submitted as the user) and the retry's records; the line and "· approved". Before a bridge is live: the button disabled, its title "Held by …".

## Proofs an executor cannot run

Each is a step for the architect, with what it needs.

1. **The four scenes, each alone on a Mac**, on the head M4 hands back: `pnpm e2e:composer -g "<the scene's name>"` for S1 to S3 and `pnpm e2e:lane-a -g "<name>"` for S4, with their screenshots.
2. **The landing's Mac run set**, on the final head, under the load rule: `e2e:transcript` (every cell line and refused row the harness draws), `e2e:c7` (`e2e:requests` and `e2e:composer`: the stack, the request rows), `e2e:lane-a`, `e2e:to-human` (the fold), `e2e:agents` (the drill-in's cell lines), `e2e:remote` (a remote transcript's rows and its sends), and the default `pnpm e2e`. No existing scene is expected to change: at the pin no scene names "Auto mode blocked" or the advisory. `e2e:cross-build` is not owed (Design 7). The paid group `p1-live` is not run: this landing changes none of its scenes and nothing it proves.
3. **Probes T, B, C, D and E** ("Probes asked for"): an engine, off the MacBook. T before M2 starts; B before M3's send options are final.
4. **Class 1a** (`scripts/ci-gate.sh "$PWD" --gates static,unit,probes --label u1c`), the branch's review, and the pull request.
5. **The owner's look**, on the built window or on the scenes' screenshots: the four states of the row, the stack's row, and the two cards. The sitting also judges Reported 6 (the row behind its turn's fold).
6. **A real block on a real session**, by the owner's sitting on the wave's build: a command a `soft_deny` rule names, blocked, approved, run. The recordings prove the frames; the sitting proves the whole.

## Size and review

Counted from the code at the pin, per milestone.

| milestone | source | tests | scenes | files |
|---|---|---|---|---|
| M1 | about 170 lines (one new file of about 110; six edited) | about 380 (one new file; three edited) | — | 11 |
| M2 | about 30 lines in two files | about 150 in three files | — | 5 |
| M3 | about 330 lines (three new files of about 250; six edited) | about 480 (two new files; two edited) | — | 13 |
| M4 | one tracker row | — | about 260 lines in four files | 5 |

About 530 lines of source, 1,010 of tests and 260 of scenes, in about thirty files. **The branch's review is the xhigh panel:** the size is past twenty files, and this is the one control in the wave that consents to a call auto mode refused, on three routes and across the machine link. Its lenses: the rule (order, a hidden branch, a page not loaded, a dropped or waiting approval, a row that only looks like one); the press (two presses, the held-open sequences, the settle time); the routes and the authority (what a `view` member and a remote caller can do; every disabled state's reason); the reader's insertions (that no row newly reads as the person's approval but a bridge's delivery of the exact sentence).

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

## Decision Log

- Decision: the verification call. This document gets an adversarial review before an executor starts (the architect dispatches it). The branch gets `doperpowers:review-code` at the xhigh panel, for the reasons and with the lenses of "Size and review". Class 1a on GitHub Actions is the gate of record. The pull request's body names its class 1a run, the review's verdict and its residue; item l4-approvals-12 reverses no earlier ruling (the child's "Rulings reversed" has no entry for it), so the pull request carries no amendment, and ticket 594 closes with it.
  Rationale: root UC-10.
  Date/Author: 2026-11-15, the author of this document.

## Outcomes & Retrospective

Pending — written at finish.
