# Question sheet — one way for a session to ask its human, in the terminal and in MAWS (2026-11-23)

> **Parent:** the MAWS charter (`docs/charter.md`) and board ticket 600 ("O-19 step two: the sminos question tool in a session MAWS runs"), which this design carries out and widens: the tool is redesigned on the way. **Consumes:** the sminos plugin in the doperpowers repository (`sminos/hooks/mods/`, `sminos/skills/sminos/scripts/`), MAWS's engine host, services, renderer, `mawsd` and `apps/desk-web`. **Amends:** the UX wave's U1 (`docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, sections l4-approvals-08, O-17, O-21, O-22) and the tool choice (`docs/doperpowers/plans/2026-11-23-tool-choice.md`, D6), each where §8 and §9 say.
>
> **Status:** the design below was approved by the owner on 2026-11-23, in conversation, after the grill and a critique debate of two rounds. The roadmap sections (Children, Cross-Child Contracts, Ordering, Tracking Map) were added the same day by doperpowers:decomposing and approved by the owner that day. Children dispatch per their grain hint, each carrying its section as its spec; each child's artifact (plan, ledger, findings, pull request, ticket) opens by citing this document by path, child id and parent pin.

## Purpose

**Higher purpose.** The owner supervises many agent sessions, some in a terminal and some run by MAWS. A session that needs the human's judgment asks through a question tool. There are two today (`mcp__sminos__AskUserQuestion` in terminal sessions, `mcp__maws__ask` in sessions MAWS runs), with different limits and different behaviour, and the owner wants one.

**What the owner observed with today's tools.**
1. A call holds at most four questions of two to four options, so an agent with more to ask calls several times.
2. An agent cannot change a question it asked, so it asks a new one that overrides the old, and the human has to work out which stands.
3. A question often arrives without the context needed to judge it.
4. To comment on an option the human retypes it under "Other".

**What someone can do after this change.** An agent puts any number of questions on its session's sheet in one call, each with the context and the files the human needs to judge it, and later rewrites or withdraws a question it asked. The human sees a session's open questions in one place, answers any of them in any order with a note on any, and sends; what is answered or dismissed leaves the sheet. The same sheet is drawn in the MAWS app, on a local web page beside a terminal, and on the phone. A question survives the session's process: it is still there after a resume, and it can be answered while the session is stopped.

**To see it working.** In a terminal session, ask the agent to put eight questions to you with a file reference on one. The terminal shows one line, `8 open questions`, with a link. The link opens a page listing eight cards; the referenced file is shown as it was when asked. Answer three, press Send: the agent quotes the three answers at its next tool result and five cards remain. Ask the agent to rewrite one: its card changes in place and keeps what you had typed.

**What it must not be.** Not a blocking prompt: no question stops the agent. Not a queue to work through in order. Not an archive: answered questions live in the transcript, the sheet shows what is open. Not a second copy of the sheet per surface: one record, one writer.

## Progress

- [x] (2026-11-23) Design approved by the owner in conversation; critique debate converged (two rounds).
- [x] (2026-11-23) Spec written and committed as approved (this commit is the baseline).
- [x] (2026-11-23) The cut into children added (Children, Cross-Child Contracts, Ordering, Tracking Map).
- [x] (2026-11-23) Buildability review of the roadmap: thirteen findings, all taken.
- [x] (2026-11-23) Independent spec review: fifteen findings, fourteen taken, one answered in §2.2.
- [x] (2026-11-23) Closing review of the folds: eleven findings, all taken. Review of this document stops here; each plan child's execution document gets its own buildability review.
- [x] (2026-11-23) The owner approved the cut and asked for C0, C1 and C2.G1 to start.
- [x] (2026-11-23) C0, C1 and C2 dispatched. C2's execution document written; its 27 entries for this document taken, among them one reading of a binding sentence (§3's one writer is the plugin's step, on the tool's order) and the cases §4.2 did not carry.
- [x] (2026-11-23) C0's verdicts for P1 to P5 written into their sections: no binding sentence overturned; §2.3 gained three limits, §6's race is no longer called harmless.
- [x] (2026-11-23) C1's harness runs end to end (smoke: 12 sessions). The owner ruled that an agent asks when a question comes up, batching the frontier (§2.4), and sized the baseline: both wordings, the subject on Opus 5.5 at medium effort, every effort medium or low.
- [x] (2026-11-23) Buildability review of C2's execution document: eighteen findings, sixteen taken (one in part), one dismissed against §5.2's intent, one accepted as a stated limit; the author's fix wave is under way.
- [x] (2026-11-23) C1's baseline (207 sessions, $113.73). The owner set Acceptance 14's thresholds as proposed, dropped automatic capture, and kept the ask-early ruling in a shorter wording.
- [x] (2026-11-24) C1 landed (doperpowers #629). C3's execution document written and reviewed once (fifteen findings, all repaired); X2 and X5 settled by it.
- [x] (2026-11-24) The look of the sheet in the MAWS app, drawn as six frames and put to the owner: the four choices asked (the row's head line, the preview's place, the jump pill, a stopped session's items) all taken as recommended; C3's drawing milestones are unblocked.
- [x] (2026-11-23) Second, narrower review of what C2's M1 freezes: twelve findings, all taken, three by a simpler rule than the mechanism the first wave had added (places for picks; "more follows" in place of numbered parts; three first lines for a stored call). Review of C2's document stops here; M1 dispatched.
- [x] (2026-11-23) This document landed on master (#864, `eac9da2b2`); later revisions go as one pull request per child landing.
- [x] (2026-11-24) C2.G1 landed: the published set is on doperpowers `main` at `2594002af` (pull request #628), sminos 1.57.0, set version 1, digest `594200ae4e539c0688c67b511968861d8ebf03c87d1c45b512903a538326e277`. Its high-rung review ran two passes (eleven findings repaired; then seven, five repaired and two logged as known limits in doperpowers' `docs/doperpowers/TECH-DEBT.md`, rows 37 and 38) and stopped there. C2's M2 to M7 and C3's first landing (M1 to M3) are dispatched against it.
- [x] (2026-11-24) C4's execution document written and reviewed once; its thirteen entries for this document taken (§7's registration, §8.2's addresses, pairing, limits and memory, C4's edges), the port holder's limit restated after the review, with a tab proving the server before it sends its credential. The page's own look drawn and put to the owner.
- [x] (2026-11-24) C3's first landing on master (`386028383`, #879). The owner answered on the page's look and default; C4's page server (M1) is built and reviewed, its shell being built, its sheet milestones released. C2 is through M4 (asking and delivery work in a live terminal session); what its live checks showed of the engine is written into §6, §7 and Acceptance 15 and 18.
- [ ] Children: see the Tracking Map.

## Terms

- **Terminal session**: a Claude Code session a human started in a terminal with the sminos plugin loaded. **MAWS-run session**: a session MAWS launched over the engine's stream-json wire (`src/engine-host/launch.ts`). The code calls these lane A and lane B.
- **The tool**: `mcp__sminos__AskUserQuestion`, registered by the sminos plugin's ask mod (`sminos/hooks/mods/ask.tsx` in doperpowers). A *mod* is a TypeScript module the engine loads as function hooks when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; `$` is the engine interface a hook receives.
- **Sheet**: the open questions of one session, with the answers accepted for them and not yet delivered.
- **Question**: one item on a sheet, with an id and a revision.
- **Asker**: the main conversation, or the subagent (agent id and name) whose call added the question.
- **Surface**: a place where the human reads and answers a sheet: the MAWS app, the local page, desk-web's cards, the `sminos sheet` command.
- **The page**: the local web page `mawsd` serves (§8.2). `mawsd` is MAWS's per-machine daemon (`src/mawsd/`).
- **The bridge**: the sminos plugin's per-session endpoint other local processes reach a terminal session through (`sminos/skills/sminos/scripts/sminos_bridge.py`, HTTP over `$SMINOS_HOME/bridge/<session>.sock`).
- **Today's tool**: the tool as it is before this design: the engine's AskUserQuestion input plus `async`, answered in the engine's own dialog (`docs/doperpowers/specs/2026-10-13-ask-async-design.md` in doperpowers).
- **Envelope**: the text a delivery is carried in (§5.3).

## Design

### 1. The question

A question is the unit: it has identity, and everything else (a call, an answer, a delivery) names questions by id.

| field | meaning |
|---|---|
| `id` | `q<n>`, assigned by the tool, unique in the session, never reused |
| `revision` | 1 when added, +1 at each revise |
| `asker` | main, or `{agentId, name}` of the subagent that asked |
| `question` | the question, at most 2,000 characters |
| `header` | optional short label, at most 60 characters |
| `options` | zero to twelve: `label` (≤200), `description` (≤500, optional), `preview` (Markdown ≤8,000, optional, single-select only), `recommended` (optional) |
| `multiSelect` | optional, default false; only with options |
| `context` | optional Markdown, at most 8,000 characters: what the human needs to judge the question |
| `references` | zero to eight files, each a path with an optional line range, captured when asked (§2.3) |
| `askedAt`, `callId` | when, and the tool call that set the current revision |

States: **open**, then **answered**, **dismissed** (by the human) or **withdrawn** (by an agent, or by `/clear`). A closed question leaves the sheet once its outcome is delivered.

Ids are assigned and not chosen by the agent because an agent-chosen id lets one asker silently overwrite another's question, a subagent's against the main agent's included.

Option labels are unique within a question, checked at add and at revise; an entry that breaks this is refused alone (today's tool refuses the whole call), as is one with a preview on a multi-select question, `multiSelect` without options, or a line range out of order. Labels must be unique because an answer names its picks by label, and MAWS's steer names them by place, which two equal labels would make ambiguous.

Options start at zero. A question with no options is a text question; every question, with options or without, has one free-text field (§4.1), which replaces both today's "Other" row and today's note. The cap of twelve options is a guard against a malformed call, not a design limit. A sheet holds at most 500 open questions, a guard of the same kind: an add past it is refused with the reason. The lengths, the twelve options and the rule on previews are rules of the tool's input, checked at the call; the record's schema states structure and not these bounds, so a question imported from today's tool (§9) is kept as it was asked.

### 2. The tool

#### 2.1 Name and input

The tool keeps the name `mcp__sminos__AskUserQuestion`. Agent definitions that withhold it by name, skills and the to-human output style that name it, and MAWS's `ASK_MOD_TOOLS` (`src/renderer/src/transcript/model/classify.ts`) then need no change. A session holds either today's schema or the sheet's, never both (§7), and a reader tells a stored call's form by its input: the sheet's has `ask` or `withdraw`, today's has `questions`.

    {
      "ask":      [ Entry, … ],     // optional, 1 to 20 entries
      "withdraw": [ "q3", … ]       // optional
    }                               // at least one of the two, non-empty

    Entry = {
      "id":          "q3",          // present: revise this open question; absent: add a new one
      "question":    "…",
      "header":      "…",
      "options":     [ { "label": "…", "description": "…", "preview": "…", "recommended": true } ],
      "multiSelect": false,
      "context":     "…",
      "references":  [ { "path": "src/auth.ts", "lines": [40, 80] } ]
    }

While the sheet's schema is registered, the engine's built-in AskUserQuestion is withdrawn from the model the way today's tool withdraws it (`WITHDRAWN` in `sminos/hooks/mods/ask.tsx`), with a text that names no `async`; left in, the model would have two question tools again.

There is no `async` and no blocking mode: the call always returns at once. A revise replaces the whole question (its fields are the entry's) and raises the revision.

Who may change what: an entry with an `id` must name an open question the caller itself asked; `withdraw` takes the caller's own questions, and the main conversation may withdraw any open question of the session.

The schema is validated as a whole, as the engine validates any tool input, and a call that fails it changes nothing. A call names an id at most once, across `ask` and `withdraw`. Past the schema, each entry stands alone: an entry refused for its own reason (the id is not open, it is another asker's, a reference cannot be captured) is refused with that reason and the others apply.

#### 2.2 Result

The result names only what the call touched:

    Added q7, q8. Revised q3 (revision 2). Withdrew q2.

and, when part of a call was refused:

    Added q7 (entry 1), q8 (entry 4). Revised q3 (entry 2, revision 2).
    Not done: entry 3, the reference src/x.ts could not be read: permission denied. q5 is not open (answered at 14:05).

Its first line has a fixed grammar (contract X7): the sentences `Added …`, `Revised …`, `Withdrew …`, each present only when it names something, ids in the order of the call's entries. A call in which nothing was done has `Nothing done.` as its first line, so a stored call always has a first line of the grammar. When any entry of the call was refused, every added and revised id carries the place of its entry, so an id is never attached to the wrong entry. A fixed grammar is used and not a structured block as §5.3 has, because this text is read by the agent on every call and the block would be spent context; everything a row needs (which entry got which id, what was revised, what was withdrawn) is in the grammar and the call's own input. A transcript row is drawn from it, also long after the sheet's directory is gone, so no reader needs the file to know which id an entry got. Receipts are narrower: while the record lives it supplies what a history lacks, and once it is gone a row shows the outcomes the history being drawn holds, so a subagent's row whose answer went to the main conversation then shows its questions without receipts.

It does not list the rest of the sheet: the agent's context is spent on its work, and the full open list is supplied only when the agent has lost it (§5.5). When no surface can show the questions at this moment (§7), one sentence says so. When neither the call's step nor its settling (§3) gives an answer, the result's first line is `Outcome not known yet.`, the third and last form of the grammar, and the outcome follows as a line of context; a reader of such a stored call draws no ids. A call that was foreclosed (§3) answers `Nothing done.` with the reason and "call again".

#### 2.3 References

A reference is captured when the call is made, so the human sees the file the question was about even after the agent edits it. What is kept is what Read returned for the range (for a reference with no range, the whole file; Read refuses a file over 256 KB without a range, and the entry is then refused with Read's reason, which tells the agent to name one), stored under the hash of that body, with the file's size and modification time at capture. "Changed since asked" is computed by a reader on the session's machine, from the file's current size and modification time, and travels to remote surfaces as a flag.

Capture goes through the engine's own Read tool, not the plugin's file access: first `$.tool.check` for a Read of the path (it opens no dialog), and only on *allow* a `$.tool.call` of Read. The plugin's own `$.fs.read` runs with no permission check and outside the other plugins' secret guards, and a referenced `.env` would then be copied raw into the sheet and toward other machines. Bodies are kept in the session's sheet directory (§3) and served on demand; they are never pushed to the hub. **P3's verdict (C0, engine 2.1.331).** The check runs the other plugins' guards and the settings' deny rules, and the call runs the guards again, their scrubbing of the result included. A path outside the session's working directories gets `ask` from the check in every permission mode, with no dialog, and is therefore refused; the agent can quote an excerpt in `context`. A plugin's Read enters the session's read state: after a compaction the engine attaches the captured files to the model's context again, as if the model had read them. That is accepted. The files are ones the agent named as bearing on its question, and reading them outside Read would lose the guards' scrubbing of what goes into the record. Read's "unchanged since read" stub did not fire in this engine, for the plugin or for the model.

#### 2.4 What the description asks of the agent

Three things, each because one of the observed problems is behavioural and no mechanism fixes it: ask when a question comes up, then keep working; revise a question you asked instead of asking a second one that overrides it; and put in `context` and `references` what a reader who sees only the card needs to judge it, marking an option `recommended` when you have a recommendation.

"When a question comes up" is the owner's ruling of 2026-11-23. It was made on C1's smoke run, in which agents told only to put every question in one call asked in the last response or two of their turn. C1's baseline then showed that was mostly the test's simulated shell, whose inconsistencies the agents spent their turns on: on a consistent session the earlier wording asks 2 to 4 responses after a question arises, and this wording asks no sooner. What it does change is what follows the call: the agent kept working after asking in 11 of 40 runs, against 3 of 40. On revising and on the cards the two wordings are equal. Shown this, the owner kept the ruling and shortened it (2026-11-23): "ask when a question comes up, then keep working", with no further eval for a change this small. The sentence on batching went with it: a call takes twenty entries, and in the baseline every run that asked put its questions in one call under either wording.

It does not ask the agent to withdraw a question the human's message has already answered: the human dismisses it (the owner's ruling, 2026-11-23: the agent's context is not spent on tending the sheet).

### 3. The sheet's record

One directory per session on the session's machine:

    $SMINOS_HOME/sheet/<engine-session-id>/
      state.json     the sheet; written only on the tool's order, by the plugin's step, by atomic replace
      inbox.jsonl    answers and dismissals from surfaces; append-only, one JSON object per line
      refs/<sha256>  captured reference bodies
      uploads/       images pasted into an answer
      texts/         a human's typed text longer than 2,000 characters, as a file (§5.3)

`state.json` holds the open questions with every field of §1, the accepted outcomes not yet delivered (`pending`), the next id, how far the inbox has been read, and the verdict of every inbox key (§4.3), kept for the directory's life: a verdict that aged out would turn a resent line into the false refusal the key exists to prevent. It is written before the tool call returns. It also keeps, for the directory's life, how each closed question closed (with its revision, header, first 200 characters and receipt, which a `closed` verdict and the terminal's rows read; for the 32 answered last, the answer's line too, which the snapshot of §11 carries), and, for each call the mod has not yet acknowledged, its outcome: its result, or that it was foreclosed. Before the tool tells the model a call failed it settles that call id under the lock, which answers a result already committed or forecloses the id, so a step of it that runs late commits nothing; the mod then acknowledges the id, and its staged input and its outcome go together. A start forgets them all. It holds, too, what the project log is owed (§11), added in the same replace as the change that owes it. A stored reference holds, beside §2.3's fields, its absolute path, its kind and media type, its byte count and, for a text, Read's start line, line count and the file's total lines. The body kept is the content Read's result carries, the field a guard's hook rewrites.

**One writer.** `state.json` changes only on the tool's order, and each change is one *step*: the plugin's own command (`sminos sheet step`), started by the mod, reads the file, changes it and replaces it atomically, under the record's lock. The mod holds no copy of its own, only the last view a step answered. One other operation rewrites the file, under the same lock: the projection to the project log (§11), which removes from the file what it has written to the log and changes nothing else. A hook is not the writer itself because the engine's file access for a hook has no rename, no append and no lock, and refuses a read or a write past 4 MiB, which a sheet with previews can pass; a mod that kept the sheet in memory and wrote it whole could not replace atomically, could not share the door's lock, and would lose an update when two processes hold one session id (C2's rule K1, taken by this document's writer on 2026-11-23). P4 confirmed it on the owner's Mac (APFS): a hook's write in place tore for a reader in another process (3 of 225,781 reads), the step's replace never did, the lock held between two appenders and a step, and a reader without the lock never saw part of a write or of a batch. Two processes that hold one session id (a session resumed in two terminals) lose no update under the lock, but each delivers what it finds pending; that is not supported, and no worse than today. Every surface, on every route, changes the sheet by appending a line to the inbox, through one code path in sminos (`sminos sheet put`, under the same lock; contract X2), and a step applies it. Two writers on one file lose an answer when a resuming session loads and rewrites the file while a surface writes into it.

**Readers read the file.** Every local reader (the page, the MAWS app for terminal and MAWS-run sessions alike, the `sminos` command) reads `state.json` plus the inbox lines past the recorded offset. MAWS does not rebuild a sheet from its own event stream of a session: a second record has no job the file cannot do, and each place the two could disagree (an answer the tool refused as stale, a dismissal held for delivery, a session answered while stopped and then resumed in MAWS, a fork, a rewind) is a fault the human would see. MAWS's journal draws the transcript's rows and nothing else of the sheet.

**Why a file and not the transcript.** Today's tool rebuilds its open asks from the transcript at resume. That rebuild returns nothing once the transcript passes 4 MiB and the search's output is cut (`sminos/hooks/mods/ask.tsx`), a subagent's calls are not in the main transcript, and captured references and undelivered answers are in no transcript. The plugin's `$.store` is one 4 MiB file for every session on the machine.

**The tool drains the inbox** at session start, whenever its bridge comes up, when a surface that appended tells the bridge so, when a subagent stops, and whenever a check finds the inbox grown: one stat of the file at its own hook dispatches (a tool call, a submitted prompt, a turn's end) and on a five-second timer, since a surface's telling can be lost and an idle session dispatches no hook. A drain is a step, and every step drains before it applies its own event, so a revise never overtakes an answer already in the inbox. Only a session's start makes its record: a drain ordered before it changes nothing.

**Lifetime.** `/clear` closes the sheet of the session id it leaves (its questions withdrawn) and removes the directory, with whatever was pending: the conversation the answers were for is gone. The SessionStart of a `/clear` names only the new session, so the id it leaves is taken from the module's memory or from the session's end. A fork or a copy has a new session id and an empty sheet, and is told so (§5.5). A sheet that starts empty in a conversation that already used ids (a fork, or a directory that was lost) starts its ids past the highest it can find in the conversation it holds: its stored calls (X7), its envelopes, and the SessionStart context, which states the next id for this purpose (§5.5). A fork's parent directory is not read, since no module can learn which session a fork copied; the conversation is what the model's context was built from, so an id in the model's context never names a different question.

A stopped session's questions can be dismissed from a surface like any others; the lines wait in the inbox and a question with a queued dismissal is no longer listed. The directory of a stopped session is removed by the sminos daemon's sweep once its transcript is gone and the record has not been touched for an hour (at once where a note of a `/clear` names the session), or by `sminos sheet remove`; no surface deletes files. The lock file beside a record is left when the record goes: unlinking it would let two holders in.

### 4. Answers

#### 4.1 Shape

An answer to one question is the picked option labels (none, one, or several when multi-select) and free text (possibly empty), at least one of the two; images pasted into the text field are saved under `uploads/` and travel as file paths. There is no "Skip" (a question left alone stays open) and no "Decide for me" (the human picks the recommended option or says so in the text).

An inbox line:

    { "v": 1, "key": "<unique per act, made by the surface>", "kind": "answer" | "dismiss" | "retract" | "delivered",
      "id": "q7", "revision": 2, "picks": ["OAuth"], "text": "…", "images": ["uploads/….png"],
      "target": "<the key of the line a retract cancels>", "batch": "<one id for the lines of one Send>",
      "by": "page" | "maws" | "desk" | "cli", "at": "<time>" }

The lines of one Send are appended together under one lock and share a `batch`; the tool applies a batch whole and delivers its outcomes together to each recipient, so three answers of one Send never reach an agent as one and then two. (The one exception is a writer killed inside its single write, whose resend completes the batch; closing it would need a count on every line, for a window of one system call.) A Send too large for one envelope is the other exception: it leaves in more than one envelope, each but the last saying that more follows (§5.3). A Send that answers the main conversation's questions and a subagent's has two recipients (§6): each gets one envelope with its own. Each line keeps its own key and verdict. Editing a queued answer is a retract and a new answer. A `delivered` line names, in `keys`, outcomes whose delivery the appender made (§5.4). The writer's door fills `at` and assigns `batch`; a line's bounds are 20,000 characters of text, twelve picks, eight images and 200 keys, and one call of the door takes at most fifty lines.

#### 4.2 Applying a line

| line | sheet state | outcome | verdict |
|---|---|---|---|
| answer | question open, revision equal | question answered; a pending outcome is recorded | `applied` |
| answer | question open, revision differs | nothing changes | `stale` (with the current revision) |
| answer or dismiss | question not open | nothing changes | `closed` (with how it closed) |
| answer or dismiss | no question ever had this id | nothing changes | `closed` (how: unknown) |
| dismiss | question open | question dismissed; a pending outcome is recorded | `applied` |
| retract with target K | K is among the lines not yet applied | K is not applied | `retracted`, for K and for the retract |
| retract with target K | K was already applied or refused | nothing changes | `too-late` |
| retract with target K | K is itself a retract or a `delivered` line | nothing changes | `too-late` |
| retract with target K | the record has never seen K | K is not applied, should it arrive | `retracted` for the retract; K gets a verdict of its own (kind `unseen`, naming the retract and no question), which stands when K's line arrives; a second retract of K reads `too-late` |
| delivered, keys K… | any | each K that is pending leaves `pending`; a K that is not (already delivered, or unknown) is left alone | `applied` |
| any | a line with this key already has a verdict | nothing changes | the first verdict again |

A key that already has a verdict keeps it: a line carrying such a key is set aside before the unread lines are considered, so a resent copy of an applied answer is never the target of a later retract.

A drain reads every line not yet applied before it applies any, so a retract that follows its target in the inbox still cancels it. A retract can also arrive before its target (a remote copy out of order): the human's last word was to take the answer back, so the target is cancelled in advance. A line that is not valid (not JSON, no key, outside the schema, a pick that is no label of the question at that revision) is skipped without a verdict; the door refuses each of these it can see, so such a line did not come through the door. A drain, like a reader, stops at the inbox's last newline: bytes after it are a write that did not finish, and the next writer's newline makes them a line, skipped if not valid and applied if it was a whole object.

The revision check is what makes a rewrite safe: an answer names the revision the human saw, and an answer to a version the agent has since replaced is not applied; the surface shows the new version with the draft kept. The key makes a resent line (a remote copy retried) the same act and not a false refusal.

#### 4.3 What a surface shows for an answer it sent

**Queued**: appended and not yet applied (the session is stopped); it stays editable and retractable. **Accepted**: applied. **Delivered**: the agent has it (§5). A surface reads these from the file: lines past the offset are queued, `pending` entries are accepted, a verdict with no pending entry is delivered or refused. A queued answer or dismissal that a queued retract names reads queued and cancelled. The reader's model (`sminos sheet show --json`, X1) also carries the closed questions with their receipts, from which a row's receipt or "Withdrawn" is drawn while the record lives, and for each pending outcome its question and option labels.

Two surfaces answering the same question: the first line applied wins, the second reads `closed`.

### 5. Delivery

#### 5.1 Who delivers

The outcomes in `pending` are delivered by whoever runs the session now: **the tool in a terminal session, MAWS in a MAWS-run session.** Both read `pending` from the file, so a session answered while stopped in one and resumed in the other owes nothing to a record the other cannot see.

Each pending outcome records its recipient (the main conversation, or a subagent's id) and, in a MAWS-run session, whether the tool has taken it for a direct send to a subagent (§6). MAWS steers only outcomes for the main conversation that the tool has not taken, so no outcome is delivered by both.

An outcome leaves `pending` when its delivery is known, not when it was sent. What "known" means is said per runner: §5.2 for the tool, §5.4 for MAWS.

#### 5.2 Terminal sessions

The tool delivers by today's three routes (`sminos/hooks/mods/ask.tsx`): a prompt the plugin submits when the session is idle (from outside every hook's dispatch: inside a `tool.call` hook the host refuses it); context on the model's next main-loop tool result while a turn runs; context on the human's next prompt after a turn the human stopped. Outcomes accepted together go in one envelope. A route carries one envelope each time it opens; what does not fit (§5.3) leaves with the next opening.

For the tool a delivery is known when it sees, stored in the main conversation, a row one of its own routes wrote that carries the envelope's keys; at a start it searches the transcript for the same, so an envelope that landed just before the process died is not sent again, and one that did not is owed across the stop. It tells such a row by what the engine says of it, its door and its origin, read once the row is stored; a flight still unsettled when its turn ends is settled there against the conversation the model holds. Where the engine says nothing of a row's author, its form decides: a text quoting a whole envelope with keys still pending could only be written by a process that can read the record, which §8.2 already trusts. For a subagent a delivery is known when the send answers that it was delivered; a send that answers otherwise, or rejects, goes to the main conversation (§6).

A dismissal never starts a turn: it waits for the next envelope or the next of the other two routes. This is today's rule (sminos 1.47.0), kept.

Whatever is owed at a session's start, an answer queued while the session was stopped or an outcome accepted before a turn died, never starts a turn by itself: it is applied at the start and leaves with whichever route opens first, usually the first prompt that enters (the human's, a peer session's message, a schedule's) and otherwise the turn a fresh answer starts, and its lines say when the question was asked and answered and that the session was stopped meanwhile, so the model can weigh its age. The terminal says, at the resume, how many answers will go with the next message.

#### 5.3 The envelope

One versioned form, read by the model, by the tool (to mark an outcome delivered) and by MAWS's reader of arrivals (`src/shared/engine/ask-delivery.ts`):

    [sheet v1] The human answered questions on your sheet.
    q7 "Which auth method should the login use?" → OAuth, Passkeys. Their text: "passkeys only on mobile"
    q8 "…" → their text: "…"
    Dismissed: q9, q11.
    <sheet-delivery>{"v":1,"keys":["…"],"answered":[{"id":"q7","revision":2,"picks":[1,2],"text":"…","images":["/abs/….png"]}],"dismissed":["q9","q11"]}</sheet-delivery>

It lists what was answered and dismissed and nothing else; it does not repeat what is still open. In the block, `keys` holds the answered outcomes' keys in the order of `answered`, then the dismissed ones'; `picks` holds places (integers from 1) among the question's options at the answered revision, in the terminal form and in the steer alike, so there is one block and a pick is bounded whatever its label (in the prose a picked label is cut at 200 characters, which can only shorten a label today's tool let through); the JSON is one line and writes `<`, `>` and `&` as escapes, so the closing tag never occurs inside it. P5 showed the block reaches the model, and the row a `session.append` hook sees, byte for byte; the engine escapes only its own reminder tags inside a hook's context, which the escapes also avoid.

An envelope is at most 60,000 UTF-16 code units and 200 keys (what one `delivered` line can name), under the 100,000 characters past which the engine hands the model only a head and a path, so that an envelope always arrives whole and its block with it. A text longer than 2,000 characters is kept as a file in the record (`texts/<sha256>.txt`) from the moment it is accepted. A human's text stands in the prose in full while the envelope fits; when it does not, the longest texts that have a file are carried, one by one, as their first 500 characters and the file's absolute path, which the agent reads with Read. The block's `text` is at most the first 500 characters, with `textCut` when the text is longer and `textFile` when it has a file, so no text is in an envelope twice in full. Distinct batches share an envelope only while they fit; a batch that cannot fit alone leaves in consecutive envelopes. Batches holding an outcome that may start a turn are packed first. An envelope that does not carry everything now owed to its recipient says so (`More follows.` in its head, `more` in its block); nothing about a packing is recorded, and the next envelope is composed afresh from what is pending, by the tool or by MAWS for its steer.

#### 5.4 MAWS-run sessions

MAWS appends the inbox line like any surface, and delivers with the journaled `next` steer its `ask` uses today (`src/engine-host/session-maws.ts`). An open question no longer keeps a process alive: the count of what a process exit would lose (`SessionMaws.pending` in `src/engine-host/session-maws.ts`, which `src/engine-host/budget.ts` reads) does not include open sheet questions.

MAWS steers only outcomes the tool has applied, read from `pending`; it never steers from a line it appended, which may lose to an earlier answer or to a retract. In a live session MAWS appends and waits for the tool's verdict for the line's key: a line refused as stale or closed, retracted, or a resend of one already delivered ends there, with nothing to steer. For a session whose engine process is released, the sequence is: append the line (it reads queued); bring the session up without sending anything (the queue's `steer()` refuses a session that is not ready, `src/engine-host/queue.ts`); the tool drains at its start and applies; MAWS reads the verdicts and steers the applied answers. An answer from any surface, the page included, starts this sequence for a released MAWS-run session; a dismissal alone does not bring a session up, and waits in the inbox for its next start.

The steer is a user-role message, so board ticket 711's rule binds it (`src/shared/maws/ask.ts`): it holds no text the model wrote. Its lines name a question by id and a picked option by its place (`option 2`), carry the human's typed text as a JSON string, and carry the same `<sheet-delivery>` block. The model usually holds its questions in its own calls. Where it may not (after a compaction, or the main conversation receiving the answer to an ended subagent's question), the question's text and its option labels in order reach it from the tool, as trusted context and never in the steer: at a session start through §5.5, and for the main conversation receiving a subagent's answer as hook context on that prompt (built by C5, in the sminos plugin, from the reader's model, by key). The second needs P1's "can add context", which C0 confirmed: in a MAWS-run session the tool's `prompt.submit` hook sees the host's prompts and its steers (idle, and `next` in the middle of a turn), and context it adds reaches the model with them.

MAWS appends a `delivered` line naming the keys a steer carried only when its journal shows that steer reached the model. A write that settled is not that: a `next` steer can be written and then cancelled without the model reading it (`spikes/protocol-probe/findings-pass2.md`). Until then the outcome is in flight: MAWS's journal ties its keys to the steer's id, and a host that takes the session over reads that before it sends anything again, so an outcome is neither dropped by a cancelled steer nor sent twice across a handover. The tool takes delivered keys out of `pending`. Nothing in any prompt's text changes state: state changes only through the inbox, so a prompt that imitates an envelope, with real keys read from the sheet's files, does nothing. MAWS never computes a verdict itself either; §4.2's table has one implementation, the tool's.

A dismissal in a MAWS-run session is appended to the inbox and sent with MAWS's next steer or human message to that session, as a line of its own; it starts no turn.

P1's verdict (§12): in a session run over the wire the tool's added context reaches the model on a prompt and on a tool result, and `$.prompt.submit` starts a turn, except from inside a `tool.call` hook, where the host refuses it. Answers and dismissals for the main conversation are still delivered by MAWS's steer, as above; the verdict is what the two cases named above and §6's direct send stand on.

#### 5.5 When the agent has lost its sheet

At a session start that follows a compaction, a resume or a fork, the tool supplies context through the engine's SessionStart context: for each open question, and for each question whose outcome is accepted and not yet delivered, its id, revision, header, question text and option labels in order (no descriptions, previews or context); or, for a fork or a missing sheet directory, one line saying the sheet starts empty and why. A line in the tool's result would not reach a model that is waiting for answers and never calls the tool.

**P5's verdict.** The context reaches the model at a startup, a resume, a compaction, a fork and a `/clear`, in both kinds of session; an unchanged text is not added a second time at a resume. At a MAWS-run launch's first SessionStart the conversation cannot be read yet, and a fork's transcript does not exist, so what needs the conversation (a fork's id floor, §3) is read at the mod's own `session.start` or at the first prompt. The context has the envelope's budget (§5.3): each question and label is cut, and past the budget the list stops and says how many are left. A fork's context states the next id only when the conversation could be read by then; over the wire it cannot, and the floor then reaches the record with the first call.

### 6. Subagents

A subagent may call the tool; its questions go on the session's sheet with it as asker, and every surface names it.

An answer to a subagent's question goes to that subagent directly as a message, `$.session.send({ to: { agentId }, text })`, while the subagent is running. This is the engine's own queue, read at the subagent's next tool round, and the bridge already uses it (`sminos/hooks/mods/bridge-agent-ops.tsx`). P2 showed it works in a terminal session and in a MAWS-run one, in plan mode too: the send answers `isDelivered`, and only a true one counts as delivered. The engine frames the text as a message from the coordinator, so the tool's text itself says it is the human's answer to the subagent's own question. When the subagent has ended, the answer goes to the main conversation naming the asker and carrying the question text: the engine would resume an ended subagent to read a message, and whether a late answer is worth that is the main agent's call. Liveness is read from `$.agent.list()` at delivery; a subagent that ends between the check and its next round is resumed by the engine with the message: a new run of the subagent, whose hand-back starts a turn in the main conversation. That is rare and costs one turn, in which the subagent has read the answer to its own question. Across a process death an answer to a subagent's question may reach the main conversation as well: a send the engine delivered just before the process died is owed again at the next start, and the subagent is gone. This is accepted over a receipt protocol for a window of one step.

When a subagent ends with questions still open, the main conversation is told which, on its next route (a tool result or a prompt), since it cannot withdraw what it never saw. On engine 2.1.331 that is usually the subagent's own completion: the main loop's Agent runs in the background, the main turn ends, and the subagent's completion enters as a prompt some 30 ms after it stops, which the notice rides (C2's live check). A withdrawal is delivered to nobody: the caller knows what it withdrew, and a running subagent whose question the main conversation withdrew is not told, since nothing waits on a sheet question.

In a MAWS-run session the same send is made by the tool inside the session; MAWS appends the inbox line and sends no steer for that outcome. An ended subagent's answer MAWS delivers to the main conversation, naming the asker by its agent id (a name a model gave does not go into a user-role steer), with the question reaching the main conversation as §5.4 says.

### 7. Where no surface can answer

A session offers the sheet only where the human can reach it. A surface registers itself:

    $SMINOS_HOME/sheet/surfaces/<name>.json
    { "v": 1, "name": "mawsd", "pid": 1234, "url": "http://sheet.localhost:47590", "reach": "local" | "remote", "heartbeatAt": "<time>" }

The surface rewrites the file every 10 seconds; a registration whose `heartbeatAt` is older than 30 seconds, or whose process is gone, is not alive. `url` is an origin, with no path and no trailing slash (a reader appends the path, and strips a trailing slash should a surface write one). The default daemon's `name` is `mawsd`; a daemon of another profile that serves the page registers as `mawsd-<12 hex>`. When more than one registration is alive and suits, `mawsd` is taken first, then the others by name. A surface removes its file at a clean stop, and writes nothing where the sminos home does not exist. `reach` is `remote` when the machine's endpoint is enrolled and carries sheets to the phone and to other machines (§8.4), which C6 turns on; until then it is `local`.

At session start the tool offers the sheet's schema when the setting `SMINOS_QUESTION_SHEET` is on and a registered surface is alive and its reach suits the session. The setting is off by default until the last child turns the default on (§9), so that through every earlier step a terminal session takes the sheet only where someone opted in. On reach: under `SSH_CONNECTION` a `remote` surface is required, because a local page answers and the human cannot open it. Otherwise the tool offers today's tool, with the engine's dialog in the terminal. Today's tool, not the bare built-in, is the fallback: a machine without `mawsd` keeps the asynchronous asks its phone cards answer today. Today's tool therefore stays in the plugin until every machine the owner uses has a surface.

A session that starts with open questions or owed outcomes in its sheet's directory takes the sheet's schema whatever the setting and the surfaces say: with today's tool its sheet would never be drained. MAWS reads the same fact before it builds a launch: a session with such a sheet is launched with `MAWS_QUESTION_SHEET` and without `ask`, whatever its stored question tool is, so a terminal session answered while stopped and resumed in MAWS is not left with a sheet nobody drains or with two question tools.

The choice is made once per process and kept in `$.state`: the engine runs `session.start` again when a module reloads, and a plugin update must not change a running session's schema. The engine does not order the classic SessionStart after the plugin's `session.start` (observed on 2.1.331 by C2's live check: in one terminal launch SessionStart settled 25 ms before the choice was made, in another after), so nothing may assume the choice exists when SessionStart runs: the tool holds a SessionStart that comes early and orders the sheet's start once the choice is the sheet. C5 meets the same race at a MAWS launch.

In a MAWS-run session the tool registers the sheet's schema when MAWS set `MAWS_QUESTION_SHEET` at launch and the process is proven to be the one MAWS's engine host launched; MAWS itself is the surface. The proof must be positive and in hand before the schema is fixed for the process: the bridge's parent check (`sminos/skills/sminos/scripts/sminos_bridge.py`) can answer "unresolved" at a session's start, when the registry record is not written yet, and taking that for "no" would pin a real MAWS launch to the wrong tool for its life, taking it for "yes" would let a nested process through. How the proof is had is C2's and C5's to settle. C2's side (2026-11-23), which waits on C5's agreement: MAWS sets the variable to the launch's session id, and the tool honours it only when it equals the id of the session the process starts, which a nested process that inherits the variable never does (the alternative weighed was waiting a bounded time for the parent check); a launch whose proof never arrives keeps the engine's built-in tool and logs why. Neither weaker condition is enough: a `claude` started by a tool inside a MAWS session inherits the variable (`src/engine-host/launch.ts` documents the inheritance), and "non-interactive" also describes a one-shot `claude -p`, whose process ends before any answer. A headless process MAWS did not launch therefore never takes the sheet, also when its session has one: it ends before any answer and may run beside the session's own process, and the sheet waits for the next interactive or MAWS-run start.

If the surface disappears during a session, questions still go to the file; the tool's result says no surface can show them now, and the terminal's line says the page is unreachable and names `sminos sheet` (§8.3).

### 8. Surfaces

All surfaces draw the same components (a question card, a session's sheet, an overview of sessions), built in MAWS's renderer and imported by the page and by desk-web the way desk-web imports renderer modules today (`apps/desk-web/vite.config.ts`).

**The card.** Header and asker, the question, the context rendered as Markdown, each reference as a collapsed viewer (the captured text at its line range, or the image; "changed since asked" when it differs), the options with the focused option's preview (under the options below 560 px of card width, beside them from 560 px: the owner's ruling of 2026-11-24; with no option focused, the picked option's preview, else the recommended one's) and the recommended mark, the text field (always present, accepts a pasted image), and Dismiss set apart. A card whose question was rewritten since the human last saw it says "Updated" and keeps the draft; a kept draft stays at the revision it was written against, is shown as carried (its picks where they are still labels), and is not counted in Send and not sent until the human has kept or edited it on the updated card, since the revision check exists so that nobody answers wording they did not read, and a surface must not answer it for them.

**The sheet.** A session's open cards, oldest first, and one Send, labelled with the count of questions that have a draft answer, which sends those and leaves the rest. One Send is one call of the writer's door and at most fifty lines (an edit of a queued answer is a retract and a new answer, both in that Send); drafts past that stay drafts for the next Send, and the button says how many it sends. A Send that failed or got no answer is sent again as the same lines under the same keys. An answer refused as stale puts its draft back on the card, which says so; an answer that came second, or a retract that came too late, is said in a note on the sheet. Drafts are kept per question in the surface's memory.

#### 8.1 The MAWS app

The owner's ruling of 2026-11-23, which replaces the placement U1 gave a question's form (l4-approvals-08): **nothing opens by itself, the transcript row is the entry, and the side sheet is where a question is answered.**

- The row of a call that added or revised questions opens with a head line saying what the call did ("Asked 3 questions"), whose chevron folds what is under it (the owner's ruling of 2026-11-24), and shows one compact line per question (id, header, and the question's first sentence that ends in a question mark, or its first sentence when none does, so a question that opens with a statement is not shown as its preamble) and Open. Open shows the session's sheet in the side column, at that question. A call that revised reads "Revised q5", one that did both "Asked a question, revised q5", and one that only withdrew "Withdrew q6" and has no lines; past eight lines the rest stand behind "N more"; a refused entry's line shows its entry's number where an id would stand, and "Not asked".
- After the outcome the line is the receipt, filled on the question's own line as O-21 rules for today's rows: `q7 Auth method → OAuth`, "Dismissed", "Withdrawn". A revised question's line moves to the row of the revising call, and the earlier row reads "Revised below".
- The side sheet never opens, activates or closes by itself (O-17, kept). Its tab in the side column is titled "Sheet", since today's ask sheet is titled "Questions" and both live until the flip.
- The "Waiting for you" card has one line per open question, "from <agent>" when a subagent asked (where the card is too narrow, "from <agent>" gives way before the question does); choosing a line opens the sheet at that question.
- Every open question is a calm "Question waiting" item (`async_input`, O-22's kind and tone, kept). No question marks a session as stopped on the human (the owner's ruling: calm state only). A notice fires once per call, not once per question, and a revise fires none. For a terminal session it is the in-app notice only, as for every request of a terminal session (U1's O-22). This holds for every open question that has no queued answer, also while its session is stopped: a stopped session's open questions count in the sidebar's Needs you and in the dock badge, drawn in a calm tone and not the warning tone that list's rows have today (the owner's ruling of 2026-11-24, on the drawn example). The calm tone is for every row whose waiting items are all sheet questions, running or stopped: no sheet question marks a session as stopped on the human.
- An open sheet question does not raise the transcript's "Needs you" pill: that button leads to a form in the transcript, and a sheet question has none; the "Waiting for you" card lists it (the owner's ruling of 2026-11-24).
- A subagent's questions need no card of their own: they are on the sheet and in the "Waiting for you" card.
- The Overview and the project channel's waiting cards mount the session's sheet in place, once a session, in a compact form: each card folded to its line until chosen.
- A row is drawn from the history it stands in (the call's input, its result's first line, later calls and the deliveries' blocks that history holds), so it reads the same after a reload; the record supplies what that history lacks while it lives (§2.2). A subagent's own transcript shows the answer it was sent as its coordinator's message.

U1's placement stands unchanged for what is not a sheet question: a permission prompt, a plan, the engine's built-in AskUserQuestion, and today's sminos tool on a machine that still has it.

#### 8.2 The local page

The machine's default `mawsd` serves it, on `127.0.0.1` and `::1` and no other address, under the host name `sheet.localhost` and port 47590 (`MAWS_SHEET_PORT`, read from `mawsd`'s environment and then the login shell's; the 478xx ports are the endpoint's and its test scenes'; a `mawsd` of another profile serves it only under `MAWS_SHEET_PAGE=1`, so a test's daemon never takes the port). It listens on both loopback addresses or on neither [binding, beside the four rules below]: the name resolves to both, and a process on the other address would answer under the page's origin. A port that is taken is not served and not registered: the page's origin includes its port, so it never moves to another, and sessions started meanwhile have today's tool. `/` is the overview: every session on the machine with open questions, terminal and MAWS-run, stopped sessions grouped apart. `/s/<session>` is one sheet. It updates live.

The owner's rulings on the page's own look (2026-11-24, on a drawn example): a sheet is one column of the transcript's width that scrolls, with Send in a foot that stays at the bottom of the window; the browser tab's title carries the count of open questions; and, in the owner's words, "a left panel too that can open to show a long sheet at a glance … sort of a synthesis". That panel is the outline: closed until opened and then remembered, one line per open question in the cards' order (its draft as a receipt once it has one), and choosing a line goes to that card. It shows and leads, and holds no answer and sends nothing (the owner confirmed this reading on its drawn frame the same day: "yes this is correct"). Two panes with one card at a time were weighed and dropped. From C4's second landing `mawsd` serves the page by default (the owner's ruling of the same day), after that landing's live checks pass.

A browser is paired once: an unpaired browser is shown how to get a one-time code (`mawsd sheet pair`), and exchanges it for a credential. The code is typed, lives five minutes and works once; each browser pairs for itself; a credential lasts until `mawsd sheet unpair`, the page's own Unpair, or 90 days without use, and `mawsd sheet browsers` lists them. (A link that pairs the browser that opens it was weighed and lost: it pairs whichever browser the system opens links in.) The link printed in terminals carries no secret, since a lasting secret in a link drawn in every terminal ends in browser history.

What the page defends against is web content and other hosts: a page open in any browser, a development server an agent started, another machine on the network. It does not defend against a process running as the same user, which can already append to a sheet's inbox with `sminos sheet`; that is today's trust, unchanged. Nor does it close three things, which are stated limits. *Whoever answers on the page's port while `mawsd` is not listening* owns the page's origin, which is the name and the port. A tab proves the server before it sends its credential anywhere (the live connection opens with the tab's nonce and the server's proof over it, and no request carrying the credential leaves a tab before that), so an open tab gives a stranger on the port nothing; but a person who opens or reloads the page while another program holds the port runs that program's script in the page's origin, and it can take the pairing and use it against `mawsd` after it returns, until that browser is unpaired. For a program of the same user that is the trust above; for another account on the machine it is a gap this unit narrows (the default daemon holds the port from login, and serves on both addresses or neither) and does not close. *A browser extension* the person gave access to the page reads it. *A web page can tell* that something answers on the port.

- The credential is kept in the page's origin-scoped storage and sent in a header on every request for data, and on the live connection once the server has proven itself there (the tab's nonce, the server's proof over it, then the credential); no request carries it from a tab whose connection is not proven. It is not a cookie: a cookie is not scoped by port, on `127.0.0.1` or on `sheet.localhost`, so a development server an agent starts on the machine and gets opened in the same browser would receive it.
- Every request is refused unless its Host is the page's. A browser's navigation to the link carries no Origin, so the page's shell and the pairing screen are served on the Host check alone and hold no session's data. Everything that reads or changes a sheet requires the credential, and the live connection and every write also an Origin that is exactly the page's. A browser sends no Origin on a same-origin read, so a read carries none and is refused only when it carries another's; the exchange of a pairing code is a write.
- Every response carries `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff` and a content policy that loads nothing from outside the page and lets no other page frame it; agent-written Markdown is rendered without raw HTML and without remote images, and its links are limited to `http`, `https` and the sheet's own references (the components hold this for every surface: such a link goes to the surface's host, a link naming one of the question's own references opens it in the card, and any other link is drawn as its text, since in a browser an anchor is followed by gestures no click handler sees; that is one optional function on the transcript's Markdown context, which C4 adds and the transcript leaves unset).
- A reference's or an upload's body is bytes an agent chose, served from the page's origin: it is sent as plain text or as a raster image type, never as HTML or SVG.

The page has authority over every session on the machine and renders text agents wrote, which is why these four rules bind.

The page's memory (§8's drafts, and what was seen) is the browser's storage for the page's origin: a draft survives a reload and shows in a second tab, and is dropped after 30 days untouched.

#### 8.3 The terminal

One line above the prompt while the session has open questions: the count and the page's link to this session's sheet (`3 open questions · http://sheet.localhost:47590/s/<session>`). There is no in-terminal form. The call's row lists its questions and, after the outcome, their receipts, as §8.1's lines: each line shows the question's first sentence that ends in a question mark, or its first sentence when none does, as the app's does. It has no head line of the sheet's own, since the engine's tool row has a head and a fold already ("Asked 3 questions" is the app's). A receipt is read from the record while the record lives; for a question the record does not hold (a fork's copy of its parent's rows, a sheet that was removed), from the deliveries' blocks the process's conversation holds, and a question neither knows is drawn as its line alone. That reading is drawing only: when it fails the lines stand without receipts, and nothing of the record or of delivery depends on it (ruled for C2's M5, 2026-11-24).

`sminos sheet` is the command-line surface: `show` prints a session's open questions, `answer`, `dismiss` and `retract` append a line (without `retract` a queued answer could be taken back from no command line), `put` is the writer's door of X2, `surfaces` lists the registered surfaces, and `remove` deletes a stopped session's sheet. `answer` names the question with the revision the human saw, `q7` or `q7@2`: a bare id is taken only while the question is at revision 1, and at a higher one the command refuses and says to show it again; numbered picks are places in the named revision. `answer`, `dismiss` and `retract` refuse a session acting on its own sheet: an agent does not answer its own questions. `put` refuses nobody, since a daemon started from a session's shell must still serve that session's page. It is what remains when the page is unreachable. Today's `sminos answer <member> <request> <answers…>` (`sminos/skills/sminos/scripts/sminos_control.py`) answers a raised dialog of today's tool and is left as it is.

#### 8.4 The phone and other machines

Today a terminal session's question is answered from the phone (desk-web's cards) and, in the MAWS app, for a session on another machine, through the sminos daemon's remote operations and the endpoint (`src/endpoint/lane-a.ts`); a MAWS-run session's `ask` is answered remotely through `maws.ask.answer` (`src/endpoint/offers.ts`). The sheet is carried once for both kinds of session: reading a session's sheet and appending an inbox line travel that remote path, and desk-web's cards draw the same card component. Reference bodies are fetched on demand over the sealed channel. Pasting an image is not offered on the phone.

A terminal session's default changes to the sheet only after this works (the owner's ruling: nothing in use today stops working at any point).

### 9. What is retired

- **MAWS's `ask`** (`src/shared/maws/tools.ts`, `src/engine-host/tool-server/ask.ts`), with its four answer kinds the sheet does not have (file, folder, repository, design system; the owner's ruling). Until the flip (C7) it stays beside the sheet: a session whose question tool is "Default" (the stored value `engine`) is launched with `MAWS_QUESTION_SHEET` and takes the sheet where the sminos tool runs, one set to `maws` keeps `ask` (unless it already has a sheet, §7), and MAWS's factory default stays `maws`. This amends the tool choice's D6, under which `engine` meant MAWS does nothing to the engine's question tools: it now sets that one variable, and still passes neither tool flag. At the flip it stops being offered to new launches. The host keeps serving it to every launch that started with it until that launch ends, a launch adopted across a host handover with an ask outstanding included: what a running launch is served is read from the launch, never from the new default. Journals that hold `ask` rows are still drawn.
- **The `maws` value of the question-tool switch** (`src/shared/maws/tool-set.ts`). From the flip on, the stored value is kept and read as the default for new launches, nothing is migrated, and the Tools submenu loses its question choice, which has one meaning left. "Default" then means the sheet where the tool runs, the engine's built-in otherwise.
- **U1's two question forms** (the stepper and the one-page form with Skip and "Decide for me") for sheet questions: one card.
- **Today's sminos tool**, later and outside this unit: it stays in the plugin as §7's fallback until every machine the owner uses has a surface. What this unit does is change the default (C7). Whenever a session with open asks of today's tool first starts under the sheet's schema, by a setting before the flip or by the default after it, those asks are imported once as sheet questions, each kept as it was asked and marked as imported, also where today's tool allowed what the sheet's input does not (a later revise of it is a call under the input's rules), and the SessionStart context says so. A fork or a copy imports nothing: its conversation holds its parent's asks, which belong to the parent's session (§3), and that decision is recorded so a later resume of the fork does not import them either. This holds for a fork whose first start is under the sheet; a fork first started under today's tool holds its parent's open asks as its own, as it does today, and a later start under the sheet imports them. The import is recorded as done only after a definite read of the transcript: today's rebuild returns the same empty list for "none open" and for a search that failed or was cut (`sminos/hooks/mods/ask.tsx`), and an import recorded on that result would lose the asks for good.

### 10. What the design leaves out

- An archive or a "recently answered" list: the transcript is the record.
- A "work is stopped on this" mark, and any blocking mode.
- Capturing the agent's preceding text as a question's context automatically. Under the to-human style that text is working notes, not something written for the human. Behaviour test E2 (§12) decided it: agents do not leave `context` empty where the card needs it, and appending their preceding text made more cards worse than better, so the owner dropped capture (2026-11-23).
- An overview across machines on the local page: the page shows this machine. The phone and the MAWS app show others.
- Starting a stopped terminal session in order to deliver an answer. It is delivered at the next resume.

### 11. Other readers of today's questions

Three consumers read today's asks and must read the sheet's: the `AskSnapshot` the ask mod keeps in `$.state` (`sminos/types/sminos.d.ts`), which doperpowers' appeal and reload mods observe; the project log's `question` and `answered` events; and MAWS's channel journal. Each is carried by the child that changes its source: the first two by C2, the third by C5 (`src/services/channel/lane-b.ts`). The project log needs more than new events: sminos's stop cleanup writes an `answered` event for a question left unanswered when its session stops and drops a later real answer as a duplicate (`sminos/skills/sminos/scripts/sminos.py`). A sheet question survives a stop, so it is exempt from that cleanup and keeps one identity in the log across stop and resume. The snapshot keeps its shape, gains one optional field for the sheet, and carries the sheet's answered questions as answered asks in today's shape, so the appeal's judge still reads the human's answers and no reader changes. The project log's events are written from the sheet's record, which keeps each until the log has it, and not exported from the transcript (an event's source names the session and the question, and the record keeps the project each question was written to, so its later events go there also after the session joins another project): a subagent's call and an answer accepted at a start are in no main transcript.

### 12. Probes and behaviour tests, before anything is built

| id | question | what decides |
|---|---|---|
| P1 | In a MAWS-run session: does the tool's `prompt.submit` hook see the host's steer; can it add context to it; does context on a tool result reach the model; does `$.prompt.submit` start a turn? | Nothing in the delivery of answers and dismissals depends on it. It decides whether the tool can add the question and its labels as context for a main conversation receiving a subagent's answer (§5.4), and whether §6's direct send has a fallback to stand on. |
| P2 | `$.session.send` to a running subagent, in a terminal session and in a MAWS-run one; and to an ended one. | §6's route in each kind of session. |
| P3 | Capture: `$.tool.check` then `$.tool.call` of Read from the tool. Does it run the other plugins' guards; does Read's `file_unchanged` result return a stub after the model read the file; does the plugin's Read change what the model is taken to have read; how an image returns. | §2.3's capture, or a refusal to capture where it cannot be made safe. |
| P4 | Is the step's replace of `state.json` (`os.replace` of a synced temporary file) atomic to a reader in another process; does the record's lock (`fcntl.flock` on a file beside it) hold between two appenders and a step; can a reader that holds no lock see part of one write of several lines? | §3; the last decides only how a reader without the lock (MAWS's) treats the inbox's tail. |
| P5 | SessionStart context after a compaction, a resume and a fork; and whether a hook's context, and the row a `session.append` hook sees, carry `<sheet-delivery>` as written or with its `<` escaped. | §5.5; how §5.3's readers match the block. |
| E1 | Over long sessions, an agent that changes its mind about an open question revises it instead of adding a second. | The description's wording (§2.4). |
| E2 | A judge shown only the card, never the transcript, can answer the question from what the card carries. | The description's wording, and whether automatic capture is added (§10). |

P1 to P5 are spikes: their deliverable is a verdict written into the section that posed the question. **Verdicts (C0, 2026-11-23, engine 2.1.331):** P1, yes to all four, except that a submit from inside a `tool.call` hook is refused (§5.4); P2, the send works in both kinds of session, and an ended subagent is resumed by it (§6); P3, capture through Read works and runs the guards, with three limits (§2.3); P4, the step's replace and lock hold, a hook's own write does not (§3); P5, the context arrives at every kind of start, and the block arrives as written (§5.5, §5.3). The runs used a scripted model, so what they show is what the engine sends; not shown: a real model reading it, `now` and `later` steers, an automatic compaction, another filesystem. Findings: `spikes/protocol-probe/findings-qsheet-c0.txt`; fixtures: `spikes/protocol-probe/fixtures/qsheet/` (pull request #874). E1 and E2 follow the pattern of the repository's existing behaviour evals (`tests/output-styles/` in doperpowers). Three of the four observed problems depend on what the agent does, so E1 and E2 decide whether the design works more than any mechanism does.

**C1's baseline (2026-11-23; 207 sessions, the subject on Opus 5.5 at medium effort; the ledger in doperpowers `docs/doperpowers/ledgers/2026-11-23-question-sheet-c1.md`).** E1: the open question was revised in 125 of 125 runs, under either wording, near and far, and a new matter got a new question in every control run; with a tool that can revise, observed problem 2 did not reproduce, so E1 guards against a regression. E2: every essential fact was on 85 to 91% of the cards about the session's own matters, and 72 to 76% passed with the reader's yes; the reasons shown forty tool rounds earlier were on the card every time, and the misses were late numbers and an option's consequence. The row-cap matter fails on the reader, which asks for what the session never knew, and is not gated until that reader is calibrated for an open-ended choice. The reader's verdict is a median of three, and only cards about matters whose facts the session showed are counted. Appending the agent's preceding text (§10's capture) made 6 passing cards fail and 3 failing cards pass.

## Acceptance (parent level)

The observable state that closes the unit as a whole; each item is observed in the running system. Children carry their own gates in their sections.

1. **Many questions, one call.** A terminal session's agent adds eight questions in one call, one with a file reference. The terminal shows `8 open questions` and a link; the page shows eight cards and the reference as captured. The tool's result names eight ids and nothing else.
2. **A subset.** The human answers three and presses Send. The agent quotes the three together, at its next tool result while a turn runs or at once when idle; five cards remain.
3. **Revise.** The agent revises one open question. Its card reads "Updated" and keeps a draft typed before. An answer sent against the earlier revision is not applied, and the card shows the new version.
4. **A note on an option.** The human picks an option and types a comment in the same card; the agent receives both.
5. **Dismiss.** Dismissing a question starts no turn; the agent is told with its next delivery.
6. **A stopped session.** With the terminal closed, the overview still lists the session's questions, apart. An answer given then reads "queued" and can be retracted. After the resume, it goes with the human's first message, marked with its age, and the project log shows one question with its real answer.
7. **The MAWS app.** A MAWS-run session asks. Nothing opens. The call's row shows one line per question; Open shows the side sheet at it; an answer reaches the agent and the line becomes the receipt. With the session's engine process released, an answer resumes it.
8. **A subagent.** A subagent's question shows "from <agent>". Answered while it runs, the subagent receives it; answered after it ended, the main agent receives it with the asker named.
9. **No surface.** On a machine without a registered surface, a new terminal session has today's tool and its dialog.
10. **The phone and another machine.** A sheet question is answered from desk-web, and from the MAWS app for a session on another machine.
11. **The page refuses strangers.** A request for a sheet's data without the credential, a write or a live connection from another Origin, and any request with another Host are refused; an unpaired browser still gets the pairing screen; a referenced HTML or SVG file is shown as text; the page loads nothing from outside itself.
12. **`ask` is gone for new sessions.** After the flip a new MAWS-run session lists no `ask`; an old transcript's `ask` rows are drawn; a launch that started with `ask` and has one outstanding is adopted by a new host and still gets its answer.
13. **The flip.** A terminal session's default is the sheet; open asks of today's tool appear on it once.
14. **Behaviour.** E1 and E2 pass at the thresholds the owner set on 2026-11-23 from C1's baseline, run with C1's harness, the subject at the shipped sessions' effort, the judges at their calibrated efforts and the calibration passing 6 of 6 first. E1, far history: at most 1 failure in 30 changed-scenario runs (a duplicated question, a revise plus a duplicate, an untouched target, or a run cut off), and no repurposed question in 10 control runs. E2, long history, over the cards about the session's own matters: every essential fact on at least 80% of them; a reader's "no" on at most 2; at least 85% of the personal-data and time-zone cards passing; the row-cap matter's rate reported and not gated until its reader is calibrated for an open-ended choice. Timing is reported, not gated.
15. **A reference that may not be read.** A question that references a file the session's permissions do not allow (a `.env`) is refused with the reason, and nothing of the file is in the sheet's directory. A file that a guard lets the engine read only in scrubbed form (the owner's secrets guard, observed live by C2 on 2.1.331: the captured body holds the guard's handle in the secret's place) is captured as the agent itself would have read it, and the secret's value is nowhere under the sheet's directory.
16. **Withdraw.** The agent withdraws a question it asked; its card disappears and its row reads "Withdrawn". A subagent cannot revise or withdraw the main agent's question.
17. **After a compaction and in a fork.** After a compaction the agent can still name its open questions and their options; a fork starts with an empty sheet, is told so, and its first new id is past every id its conversation holds.
18. **A subagent that ends.** When a subagent ends with a question open, the main agent is told which, on the main conversation's next route (a tool result or a prompt).
19. **Two surfaces, and none.** Two surfaces answer the same question: the first is applied, the second reads that it was already answered. With the surface stopped mid-session, the tool's result says nobody can see the questions now, and they show when it returns.

## Execution

**Constraints on every child [binding].**
- The engine is unmodified (charter D-1); the tool reaches it through function hooks only.
- Board ticket 711: no user-role text MAWS sends holds text a model wrote.
- §3's one writer and §4.2's table bind every surface.
- MAWS: tokens only, light theme default; gates through `scripts/ci-gate.sh` as `CLAUDE.md` says. doperpowers: the mods' suite `sminos/tests/mods/run.sh` and the command's suite `sminos/tests/run-sminos-tests.sh`.
- Nothing the owner uses today stops working at any step: a new path lands beside the old one, and a default changes only after its replacement is verified.

**Grades.** Binding, because only the whole picture could settle them: §1's shape, §2.1's ownership rule and name, §3 (the directory, one writer, readers read the file), §4, §5.1, §5.3, §5.4's ticket 711 form, §6's routes, §7, §8.1 (the owner's ruling), §8.2's four rules, §9, and the contracts below. Everything else in the design is advisory inheritance: a child starts from it and may overturn it with evidence, stating its choice in its own document and listing the sentence for this document's writer.

## Children

### C0: Engine probes — spike (findings, never a merge)

- **Purpose:** Answer §12's P1 to P5 against the pinned engine before anything depends on the answers: what a function hook sees and can do in a MAWS-run session, how a message reaches a subagent, how a reference is captured safely, whether the file and the inbox hold under concurrent processes, and what SessionStart context delivers.
- **Acceptance:** A verdict for each of P1 to P5 with its evidence, written by this document's writer into the section that posed the question (§2.3, §3, §5.4, §5.5, §6), and each fixture kept: terminal probes as a probe plugin's transcript, MAWS-run probes as scenarios and fixtures under `spikes/protocol-probe/`.
- **Edges:** blocked-by: —; blocks: C2.G2 (P2 in a terminal, P3, P4, P5), C5 (P1, P2 in a MAWS-run session, P5).
- **Contracts:** none; its verdicts may move X3 and §6.
- **Design inheritance:** §12; `docs/doperpowers/specs/2026-10-13-ask-async-design.md` in doperpowers ("How the engine is reached") shows the probe-plugin method used for today's tool.
- **Required:** required.
- **Status:** landed (2026-11-23): the verdicts are in §2.3, §3, §5.3, §5.4, §5.5, §6 and §12; the fixtures are on master (#874, `90ce5c017`).

### C1: Behaviour baseline — brief (doperpowers repository)

- **Purpose:** Find out whether agents use the sheet as the design needs, since three of the four observed problems are behavioural: E1 (revise instead of asking again) and E2 (a card that can be judged alone), on long sessions, with a stub of the tool that accepts §2.1's input and records calls.
- **Acceptance:** The two evals are merged in doperpowers under `tests/output-styles/` and run from one command each; a baseline result for each with the description wording of §2.4; the pass thresholds proposed to the owner and, once the owner sets them, written into Acceptance 14; a recommendation, with the evidence, on automatic capture of context (§10), which the owner rules on. E2's judge sees only the card.
- **Edges:** blocked-by: —; blocks: C2.G3 (the shipped description, and capture if the owner rules for it, are tested with this harness).
- **Contracts:** consumer of X7 (§2.1's input shape, as this document states it).
- **Design inheritance:** §2.4, §10, §12.
- **Required:** required.
- **Status:** landed (2026-11-23): doperpowers `ddab337fb` (pull request #629). The evals: `python3 tests/output-styles/question-sheet-revise-eval.py` and `python3 tests/output-styles/question-sheet-card-eval.py` (after `--calibrate`), each printing pass or fail against Acceptance 14; the shipped wording is `tests/output-styles/question-sheet/description-v3.md`. Its retrospective is the ledger's outcome section.

### C2: The sheet in sminos — plan (doperpowers repository)

- **Purpose:** The tool's new form and the sheet's record: the schema of §2 behind the start choice of §7, the directory, the inbox and the apply table of §3 and §4, delivery in terminal sessions (§5.2, §5.3, §5.5), subagents in terminal sessions (§6), the command-line surface, and the terminal's own drawing (§8.3). It lands beside today's tool and changes no default.
- **Acceptance:**
  - *G1, the contracts published:* in `sminos/types/sheet/`, a JSON Schema for `state.json`, the inbox line, the surface registration, the `<sheet-delivery>` block, the tool's input (X7) and what `sminos sheet show --json` prints (X2); an example of the envelope in its terminal form and in its steer form; the grammar of X7's first line; and fixture directories covering every row of §4.2's table, a batch, a retract before and after its target was applied, a resent copy of an applied line followed by a retract of it, a `delivered` line naming one pending and one already delivered key, and a stored call that partly succeeded with an added and a revised entry. Also: a retract of a key never seen and the late arrival of its line, an answer whose text has a file, an import valid only under today's tool, an envelope carrying a text by its file, and a Send that leaves in two envelopes. The envelope's examples are published with the records they were composed from, and the stored-call examples include a foreclosed call and one whose outcome was not known. `sminos sheet put` and `sminos sheet show --json` work against a directory with no session running. The set is published at one revision that MAWS's tests pin.
  - *G2, a terminal session:* with `SMINOS_QUESTION_SHEET` on and a live surface registration, Acceptance 1 to 6 and 15 to 19 hold with `sminos sheet answer` standing in for the page, and Acceptance 8 holds; with the setting off, or no live registration, or `SSH_CONNECTION` with a local one only, the session has today's tool unchanged (Acceptance 9). A session with open asks of today's tool that first starts under the sheet has them on the sheet once, also after two resumes, and keeps them when the transcript read was incomplete; a fork of such a session starts empty and stays empty (§9). One Send that answers the main agent's question and a running subagent's reaches each with its own. A `claude -p` started inside a MAWS-run session does not get the sheet (§7).
  - *G3, the other readers:* the `AskSnapshot` in `$.state` and the project log carry sheet questions, and stop, resume, answer leaves one question with its real answer in the log (§11); the shipped description passes C1's thresholds, with capture built if the owner ruled for it.
- **Edges:** blocked-by: C1 for G3. C0's verdicts are in, so nothing of G1 or G2 waits on a probe. blocks: C3, C4, C5, C6.
- **Contracts:** owner of X1, X2, X3's schema and terminal form, X4's schema, X6, X7.
- **Design inheritance:** §1 to §7, §8.3, §9's import, §11. Advisory: when the inbox is drained (§3), how the terminal line is composed with the to-human band (the ask-async design in doperpowers, "Composing with to-human", is how today's line does it).
- **Required:** required.
- **Status:** in-flight: G1 landed (doperpowers `main` at `2594002af`, pull request #628; sminos 1.57.0; set version 1, digest `594200ae…e277`), and M2 to M7 (G2, G3) are dispatched on the same branch, to land as one pull request after its own high-rung review. Its execution document (doperpowers, `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md`) was repaired after its buildability review (eighteen findings) and after a narrower review of what its first milestone freezes (twelve); no third review of the document. The published set carries a version, and a change to it from here is a ruling of this document's writer and a re-pin in MAWS. Two limits of the set are known and logged in doperpowers' `docs/doperpowers/TECH-DEBT.md` (rows 37 and 38): a reader that takes no lock can, in the instant of a short write, see a call's first lines before the rest or a rollback; and a JSON Schema validator that reads `$` as Python does lets a value with a trailing newline through, which the door itself refuses.

### C3: The sheet in the MAWS app — plan

- **Purpose:** The components every surface draws (the card, a session's sheet, the overview), MAWS's reading of sheets from their files and its appending through sminos's writer, and the app's own drawing for terminal sessions on this machine: the row's lines and receipts, the side sheet, the "Waiting for you" card and the attention items (§8.1), with U1 amended where §8.1 says.
- **Acceptance:**
  - *G1, on fixtures:* the components render every fixture directory of C2.G1 at its pinned revision, a card for each state a surface can show (open, updated since seen, queued, accepted, refused as stale); the reader lists every session directory under a given `$SMINOS_HOME`; a stored call that partly succeeded draws its row's lines with the right ids and no sheet directory.
  - *G2, live:* for a terminal session on this machine with the sheet on (set up as C2.G2's live check is: the merged plugin loaded by the session, the setting, and C2's stand-in surface registered, until C4's page registers itself), Acceptance 7's drawing holds in the app (nothing opens by itself; the row's lines; Open shows the side sheet at the question; the receipt), an answer sent in the app reaches the agent, three answers of one Send arrive together, and a stopped session's questions show; a withdrawn question's card disappears and its row reads "Withdrawn" (Acceptance 16); of two windows whose Sends for one question are in flight together, the second reads that it was already answered (Acceptance 19; a second window can answer only in the gap before the first answer moves the record, so the proof holds both Sends at the door and releases them together).
- **Edges:** blocked-by: C2.G1 for G1; C2.G2 for G2; board ticket #852 on master for the row's drawing alone (landed 2026-11-24 as master `5fc0bb8aa`, pull request #878; its rig launch 15 is taken, so C3's row milestone numbers its own after it). blocks: C4 (from its first landing: the reader, the service and the components), C5, C6.
- **Contracts:** owner of X5; consumer of X1, X2, X3, X7.
- **Design inheritance:** §3 (readers read the file), §4.3, §8 (the card, the sheet), §8.1 [binding], U1's sections named in the header. Advisory: the row's compact lines are drawn within the row model of board ticket #852 (`ux-wave/retire-tool-card`: a standalone tool call is a quiet line with a chevron, no bordered card), not merged at this pin, so the child builds on it once it lands; where the reader runs (`mawsd`'s spine, beside the terminal-session driver in `src/services/lane-a/`), and MAWS reaches the writer through the `sminos` command, as X2 records.
- **Required:** required.
- **Status:** in-flight: its first landing is on master (`386028383`, pull request #879, 2026-11-24: the pin, the model, the reader, the service, `sheet.*` on the wire at minor 65, the components), which closes G1 but for the row's drawing and unblocks C4's sheet milestones. Each milestone had its task review; the branch's medium review returned seven findings, all fixed, and six lesser ones are listed as deferred in the pull request's body with their reasons. Its second landing is being built on the same branch: M4 (the side sheet, the waiting card, the attention items, with U1's four amending sentences and one dated entry in the charter's §19) and M5 (the row), then pictures of the built surfaces for the owner; M6, the live gate, waits on C2.G2. Its execution document was reviewed once (fifteen findings, all repaired); the look was settled by the owner on a drawn example (2026-11-24).

### C4: The local page — plan

- **Purpose:** `mawsd` serves the sheet to a browser beside the terminal (§8.2) and registers itself as a surface (§7), so that a terminal session with the sheet on has a place to be answered.
- **Acceptance:** In a real browser: the link from the terminal, opened unpaired, shows the pairing screen; after pairing, `http://sheet.localhost:47590/` shows the overview of this machine's sessions, stopped ones apart, and `/s/<session>` updates live. Acceptance 1 to 6 hold end to end with the page as the surface. Acceptance 11 holds, each refusal shown by a request that is refused, and the unpaired link still loads its shell. The registration file exists with `reach: local` while `mawsd` runs and is not alive 30 seconds after it stops; questions asked while it was stopped show on the page when it returns (Acceptance 19). The terminal's line shows the link.
- **Edges:** blocked-by: C3's first landing (the reader, the service, the components; not the row) for its sheet routes and views, and C2.G2 for its live gate; its first two milestones (the page server's checks and pairing, the page's shell) wait on nothing. blocks: C7.
- **Contracts:** writer of X4; consumer of X1, X2, X5.
- **Design inheritance:** Two facts of C3's service this child builds on: it is the boundary (it takes a session only in the engine's id form and confines every path under the record, so the page's `/s/<session>` passes the value on and adds no check of its own), and the door's state is unknown until a record with something on it is read, so the page does not ask for it at start to decide what to draw. §7, §8.2 (its four rules binding; the port, the pairing command and the bundle's build are advisory). This is the first entrance of `mawsd` a browser can reach: a TCP listener with authority, where everything else is a Unix socket, a peer-checked socket or a sealed channel (`src/shared/daemon/files.ts`), so the page's serving code is new and is reviewed at the *high* rung.
- **Required:** required.
- **Status:** in-flight: its execution document is written (branch `question-sheet-c4`, `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md`) and repaired after its one buildability review (twelve findings, all taken); its first milestone, the page server, is being built. It builds in two landings: the first holds the page server and the page, served only under `MAWS_SHEET_PAGE=1`; the second is the live gate and the default. What is the page's own to look at (the pairing screen, the overview's frame, a sheet's frame, the page while `mawsd` is unreachable) was drawn as six frames and put to the owner on 2026-11-24 with four questions, all answered the same day (one column, with an outline panel the owner added; Send in a fixed foot; the count in the tab's title; served by default from the second landing on), so no milestone waits on the owner; the writer ruled the rest (the typed code, the name "Sheet", light only, a calm "not connected", the command named alone).

### C5: MAWS-run sessions — plan (ticket 600)

- **Purpose:** The sheet in a session MAWS runs, beside `ask`: a session whose question tool is "Default" is launched with `MAWS_QUESTION_SHEET` and takes the sheet; MAWS appends answers and delivers the applied ones with its steer in ticket 711's form (§5.4); an open question no longer holds an engine process; the rows, the side sheet and the cards of C3 draw these sessions too; the channel journal carries sheet questions (§11). A session set to `maws` keeps `ask`, and no default changes.
- **Acceptance:** On this machine: Acceptance 7, including a released session answered from the app and from `sminos sheet answer` by §5.4's sequence, with a second competing answer, a retract and a resent line in the inbox, each ending in one delivery of the applied outcome and none of a refused one; a steer cancelled before the model read it, and a host handover between a steer and its acknowledgement, each end in exactly one delivery; a terminal session answered while stopped and then resumed in MAWS, its stored question tool `maws`, is launched with the sheet and receives the answer; Acceptance 8 in a MAWS-run session by the route P2 allows; a dismissal reaches the agent with MAWS's next message and starts no turn; after a compaction, and for the main conversation receiving an ended subagent's answer, the agent names the option the human picked (§5.4); the channel journal shows one question and its outcome; a session set to `maws` still has `ask` and is answered as today, on this machine and from another; a MAWS-run session's sminos writes its record under the home MAWS's reader reads (the launch names it).
- **Edges:** blocked-by: C0 (P1, P2, P5), C2.G2, C3.G2. blocks: C6, C7.
- **Contracts:** owner of X3's steer form in MAWS; setter of X6's `MAWS_QUESTION_SHEET`; consumer of X1, X2, X5, X7.
- **Design inheritance:** §5.1, §5.4, §6's last paragraph, §7 (the MAWS-run paragraph), §9, §11; the tool choice's "What ticket 600 changes" (`docs/doperpowers/plans/2026-11-23-tool-choice.md`). Two of ticket 600's three blockers are already answered by the design: the built-in is not needed, because the sheet uses no engine dialog, and answers come in through the inbox and the steer, not through the bridge. A gap C3's author found, for this child to close: `src/engine-host/launch.ts` passes neither `SMINOS_HOME` nor `DAEMON_HOME` to a launch, while MAWS's reader honours them, so where the owner exports `SMINOS_HOME` a MAWS-run session's record would be written under one home and read under another. Advisory: the remote adapter already acquires a ready launch apart from sending (`src/main/lane-b/remote.ts`), which is the shape §5.4's sequence needs locally. Two branches of the UX wave border this child and are not merged at this pin: `ux-wave/prestart-engine` (#851) starts a new chat's engine on the first keystroke and adopts it at Send only if its launch spec still matches, so `MAWS_QUESTION_SHEET` must be part of that launch key, and the ux-wave session asked to be told when this child's launch shape is fixed; `ux-wave/subagent-tell` adds a hidden built-in MAWS mod, passed with `--plugin-dir` on every MAWS-run launch, that tells a subagent directly through `$.session.send`, which bears on P2 in a MAWS-run session and is a second plugin directory whose load order relative to sminos this child checks. From C2's delivery as built (M4, engine 2.1.331): what counts as an envelope having landed is read only from what the model reads, the stored row's message content and never a row's submission metadata; in the model's view the result route's context sits inside the tool result's text after its output, in a reminder wrapper, the prompt route's is a reminder block, and the idle prompt is a framed text block. While a direct send to a subagent is in flight the outcome stays owned by the plugin until the receipt's step has answered, so a reader of the file never sees that key as the main conversation's mid-send. A record path that is a link is refused by the door and the step (`bad-record`).
- **Required:** required.
- **Status:** not-dispatched (blocked-by C0, C2, C3).

### C6: The phone and other machines — decomposing run at dispatch

- **Purpose:** A sheet question of either kind of session is answered from desk-web's cards and, in the MAWS app, for a session on another machine (§8.4), so that the defaults can change without taking away what works today.
- **Acceptance:** Acceptance 10, for a terminal session and for a MAWS-run session; a reference's body is fetched on demand and is in no hub record; an answer resent over the remote path is applied once (§4.2's key); a machine whose endpoint carries sheets registers `reach: remote`, and a terminal session under `SSH_CONNECTION` on it takes the sheet.
- **Edges:** blocked-by: C2, C3, C5. blocks: C7.
- **Contracts:** consumer of X1, X2, X5; it turns X4's `reach` to `remote`.
- **Design inheritance:** C3 left `sheet.list`, `sheet.read`, `sheet.body`, `sheet.put` and `sheet.upload` refused to every caller through the endpoint, by a no-rule row each in `src/endpoint/by-effect.ts`; this child writes the rule of each it carries. As C3's service was built: `sheet.list` is refused `no-target` and not `no-rule`, because its input names no session and the `view` floor fails before the row is read, so a remote list needs a per-session placement as well as a rule; all five are `not-offered` under the real offer table; and `sheet.changed` reaches this machine's app only. §8.4, advisory in full: reading a sheet and appending to its inbox on another machine span sminos's remote operations, the endpoint's grades and offers (`src/endpoint/lane-a.ts`, `src/endpoint/offers.ts`, `src/endpoint/by-effect.ts`), org-protocol's actions and desk-web's cards (`apps/desk-web/src/cards/`), and are cut when near dispatch, against what C2 to C5 landed.
- **Required:** required.
- **Status:** not-dispatched (deliberately late).

### C7: The flip — brief (both repositories)

- **Purpose:** The sheet becomes the default: for terminal sessions `SMINOS_QUESTION_SHEET` is on unless set off, and in MAWS `ask` stops being offered to new launches, the switch's `maws` value reading as the default (§9).
- **Acceptance:** Acceptance 12 and 13; with no setting given, a new terminal session on a machine with a live surface of suitable reach has the sheet, and one on a machine without has today's tool; a launch that started with `ask` keeps being served it, across a host handover with an ask outstanding.
- **Edges:** blocked-by: C4, C5, C6.
- **Contracts:** flips X6's default.
- **Design inheritance:** §7, §9.
- **Required:** required.
- **Status:** not-dispatched (deliberately late).

## Cross-Child Contracts

- **X1 · The sheet's record.** The directory of §3, the fields of §1, the inbox line of §4.1, the apply table of §4.2 and the three shown states of §4.3. *Owner:* C2, which publishes the JSON Schema and the fixture directories at C2.G1. Published (2026-11-24): `sminos/types/sheet/` on doperpowers `main` at `2594002af`, set version 1, digest `594200ae4e539c0688c67b511968861d8ebf03c87d1c45b512903a538326e277`, with sminos 1.57.0; a consumer pins those three values. *Binds:* C3, C4, C5, C6. A change after C2.G1 goes through this document's writer.
- **X2 · The writer's door.** Every change to a sheet from outside the tool is one inbox line appended by sminos's own code under its lock: `sminos sheet put` (a line on standard input, the verdict or `queued` on standard output) and `sminos sheet show --json`. One call appends one line or the lines of one Send as a batch (§4.1). Whether MAWS calls the command or the same code over the sminos daemon's socket is settled by C2 and C3 and recorded here. Settled by C2 and C3 (2026-11-24): MAWS runs the command, `sminos sheet put --session <id>`, lines on standard input and one JSON object of results on standard output, its exits 0, 1, 2, 3 and 75, and `show`'s exit 3 for a session with no sheet, part of the contract; nothing is served over the daemon's socket (the daemon is optional, MAWS never connects to it, and the command is the one path that holds the record's lock). MAWS finds the command as an explicitly configured executable or in an enabled user-scope installation of the plugin, never in a project-scope or disabled one, and executes nothing until there is a record to answer. `put`'s results are per line `{ key, state: 'queued' }` or the bridge's verdict under its own name (`applied`), never a `sent` entry: a reader learns an act's fate from the model's `sent` alone. *Owner:* C2. *Binds:* C3, C4, C5, C6.
- **X3 · The envelope.** §5.3's text and its `<sheet-delivery>` block, and §5.4's form for a user-role steer (ids, option places, the human's text as JSON strings). *Owner:* C2 owns the block's schema and publishes it with an example of each form at C2.G1; C2 implements the terminal form and C5 the steer form. *Readers:* the tool and MAWS's reader of arrivals.
- **X4 · Surface registration.** The file of §7 and its liveness rule (rewritten every 10 seconds, not alive after 30). *Owner of the schema:* C2, published at C2.G1. *Writer:* C4, with `reach: local`; C6 turns `reach` to `remote` where the endpoint carries sheets. *Reader:* C2.
- **X5 · The components.** The question card, the session's sheet and the overview, over one model of a sheet read from X1, importable from MAWS's renderer by the page and by desk-web. *Owner:* C3. *Consumers:* C4, C5, C6. The boundary, as C3 draws it: a consumer imports two directories and nothing else, `src/shared/sheet/` (the model, pure) and `src/renderer/src/sheet/` (the components, which take a model, a surface's memory and a host that sends); the service that reads records and calls the door, the wire, the store, the side column's tool and the transcript's row stay in the app. The reader is MAWS's own, on the spine in `src/services/sheet/`, held to C2's set by its fixtures; it reads every record whichever kind of session wrote it, so C4 and C5 add no reader. The sheet's Markdown has its own link policy (§8.2's third rule), apart from the transcript's. As built in C3's first landing: a consumer keeps a session's memory and the components change it only by handing it an update (`onMemory(update: (current) => next)`), applied to the memory as it stands at that moment and callable after the component is gone, because two mounts of one session (the side sheet and an overview's card, two tabs of the page) that each replaced the whole memory lost each other's writes; a card's root carries `data-sheet-question`; the overview takes an optional `hrefOf(session)`; a refused link is an anchor with no address; and the policy for a link is one exported function.
- **X6 · The start choice.** `SMINOS_QUESTION_SHEET` (terminal sessions; off by default until C7) and `MAWS_QUESTION_SHEET` (set by MAWS at launch and honoured only with positive proof that MAWS's engine host launched the process, §7), decided once per process and kept in `$.state`; a session that already has a sheet takes the sheet. *Owner:* C2. C5 sets MAWS's; C7 changes the defaults.
- **X7 · The stored call.** §2.1's input and the fixed first line of §2.2's result, with entry places when a call partly succeeded, from which a transcript row is drawn without the sheet's directory. *Owner:* C2. *Consumers:* C3, C5, and C1's stub. Held for the set's next version, none of it worth a re-pin alone: the step refuses an entry with a lone surrogate under the clause "a string holds a lone UTF-16 surrogate", which the published list of clauses in `grammar/result.md` lacks (the first line's grammar is unaffected, and a reader shows a clause it does not know as written). Also held: `show`'s `hidden` entries (a question hidden by a queued dismissal) carry `{id, key}` and no header, so a surface that did not draw the card itself shows `q5 → Dismissed` without it; until the set carries the header, a surface shows it from its own memory when it has it.

## Ordering & Dependency Map

    C0 probes ─────────────┬───────────────────────────────┐
    C1 behaviour ──────────┼──► (C2.G3)                    │
                           ▼                               ▼
    C2.G1 contracts ──► C2.G2 ──► C4 the page ─────────► C7 the flip
          │                │                               ▲
          ▼                ▼                               │
        C3.G1 ────────► C3.G2 ──► C5 MAWS-run ──► C6 phone, other machines

- C0, C1 and C2.G1 start together. C2.G1 is small and comes first on purpose: it publishes the schemas, the envelope examples and the fixtures at one revision, and only then do the tool's record (C2.G2) and the app's components (C3.G1) proceed in parallel against it.
- C4 and C5 run in parallel once C2.G2 and C3 are in. Both land beside what exists: the page is used only by sessions with the setting on, and C5's sessions are those set to "Default".
- C6 carries both kinds of session to the phone and to other machines.
- C7 is the only step that changes a default, in the terminal and in MAWS, and it waits for everything.
- Today's sminos tool is not removed in this unit (Deferred).

## Verification

- This document: one independent spec review and one buildability review of the roadmap, before the owner's gate on the cut. The design was debated with the design critic before approval.
- Each plan child's execution document: the buildability review.
- Branch reviews through doperpowers:review-code: *high* for C2 (a fault loses or duplicates the human's answer) and for C4's first landing, which holds all of the page server (a door into every session on the machine), its second landing at the rung its diff warrants; *medium* for C3, C5 and C7; C6 names its own at its cut.
- Recomposition: Acceptance 1 to 19 run as written on the owner's machines by the session holding this document, reusing a child's evidence where it proved the item on the real surface, and adding the one check no single child can make: a released MAWS-run session answered from the page. Then a scale review, since the unit spans two repositories and one cross-child record.

## Risks & Mitigations

- **Agents do not revise, or leave context empty.** C1 measures it before the tool is built; the description's wording and §10's capture are its levers.
- **The two repositories drift on X1.** One schema and one set of fixtures, published by C2.G1 and read by MAWS's tests.
- **A hook cannot do in a MAWS-run session what it does in a terminal.** Closed by C0's P1: it sees the host's prompts and steers and can add context to them.
- **The page is a new door.** §8.2's four rules are binding and each has a refused request in C4's acceptance.
- **A long wait between C4 and C7.** The setting lets the owner use the sheet on this machine from C4 on, and "Default" in MAWS from C5 on, while the defaults wait.

## Deferred / Out of Scope

**Deferred (may return):** removing today's sminos tool from the plugin, once every machine the owner uses has a surface; an overview across machines on the local page; starting a stopped terminal session to deliver an answer; pasting an image on the phone; calibrating E2's reader for an open-ended choice, so the row-cap matter can be gated.

**Out of scope (standing):** a blocking mode; an archive of answered questions; a mark that a session is stopped on the human; MAWS's file, folder, repository and design-system answer kinds; automatic capture of the agent's preceding text as a question's context (the owner's ruling on C1's baseline).

## Tracking Map

Approved design: commit `2fe16c685` (the design, 2026-11-23). Approved cut: commit `d845b4973` (the roadmap after its three reviews), by the owner on 2026-11-23, with the instruction to start what nothing blocks.

Tickets are on MAWS's board, children of #600.

| child | artifact | status |
|---|---|---|
| C0 engine probes (#865) | verdicts in §12 and the sections it names; `spikes/protocol-probe/findings-qsheet-c0.txt` and `fixtures/qsheet/`, pull request #874 | landed: master `90ce5c017`; ticket closed with the findings |
| C1 behaviour baseline (#866) | ledger in doperpowers `docs/doperpowers/ledgers/2026-11-23-question-sheet-c1.md`; the evals under `tests/output-styles/` | landed: doperpowers `ddab337fb` (#629); baseline 207 sessions, re-measured unchanged after its review's 11 fixes; ticket closed |
| C2 the sheet in sminos (#867) | execution document in doperpowers `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` (on `main` since #628; branch `question-sheet-c2` carries the rest); the published set `sminos/types/sheet/` | in-flight: G1 landed, doperpowers `2594002af` (#628), sminos 1.57.0, digest `594200ae…e277`, 21 cases and 6 examples; M2 to M7 dispatched |
| C3 the sheet in the MAWS app (#868) | execution document `docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md` (branch `question-sheet-c3`) | in-flight: first landing on master `386028383` (#879; a task review per milestone, a medium branch review of seven findings, all fixed); second landing (M4, M5, then M6 after C2.G2) being built |
| C4 the local page (#869) | execution document `docs/doperpowers/plans/2026-11-24-question-sheet-c4-local-page.md` (branch `question-sheet-c4`) | in-flight: written, reviewed once (twelve findings, repaired); the page's look and default answered by the owner (2026-11-24); M1 (the page server) being built |
| C5 MAWS-run sessions (#870) | execution document in `docs/doperpowers/plans/` | not-dispatched |
| C6 the phone and other machines (#871) | its own cut at dispatch | not-dispatched (deliberately late) |
| C7 the flip (#872) | ledgers in both repositories' `docs/doperpowers/ledgers/` | not-dispatched (deliberately late) |

## Outcomes & Retrospective

Pending — written at finish.
