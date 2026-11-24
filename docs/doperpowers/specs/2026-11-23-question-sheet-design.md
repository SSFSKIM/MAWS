# Question sheet — one way for a session to ask its human, in the terminal and in MAWS (2026-11-23)

> **Parent:** the MAWS charter (`docs/charter.md`) and board ticket 600 ("O-19 step two: the sminos question tool in a session MAWS runs"), which this design carries out and widens: the tool is redesigned on the way. **Consumes:** the sminos plugin in the doperpowers repository (`sminos/hooks/mods/`, `sminos/skills/sminos/scripts/`), MAWS's engine host, services, renderer, `mawsd` and `apps/desk-web`. **Amends:** the UX wave's U1 (`docs/doperpowers/specs/2026-11-12-ux-wave/U1-requests.md`, sections l4-approvals-08, O-17, O-21, O-22) and the tool choice (`docs/doperpowers/plans/2026-11-23-tool-choice.md`, D6), each where §8 and §9 say.
>
> **Status:** the design below was approved by the owner on 2026-11-23, in conversation, after the grill and a critique debate of two rounds. The roadmap sections (Children, Cross-Child Contracts, Ordering, Tracking Map) were added the same day by doperpowers:decomposing and await the owner's gate. Children dispatch per their grain hint, each carrying its section as its spec; each child's artifact (plan, ledger, findings, pull request, ticket) opens by citing this document by path, child id and parent pin.

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
- [ ] Independent spec review and buildability review of the roadmap.
- [ ] The owner's gate on the cut.
- [ ] Children: see the Tracking Map.

## Terms

- **Terminal session**: a Claude Code session a human started in a terminal with the sminos plugin loaded. **MAWS-run session**: a session MAWS launched over the engine's stream-json wire (`src/engine-host/launch.ts`). The code calls these lane A and lane B.
- **The tool**: `mcp__sminos__AskUserQuestion`, registered by the sminos plugin's ask mod (`sminos/hooks/mods/ask.tsx` in doperpowers). A *mod* is a TypeScript module the engine loads as function hooks when `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1`; `$` is the engine interface a hook receives.
- **Sheet**: the open questions of one session, with the answers accepted for them and not yet delivered.
- **Question**: one item on a sheet, with an id and a revision.
- **Asker**: the main conversation, or the subagent (agent id and name) whose call added the question.
- **Surface**: a place where the human reads and answers a sheet: the MAWS app, the local page, desk-web's cards, the `sminos` command line.
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

Options start at zero. A question with no options is a text question; every question, with options or without, has one free-text field (§4.1), which replaces both today's "Other" row and today's note. The cap of twelve options is a guard against a malformed call, not a design limit.

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

There is no `async` and no blocking mode: the call always returns at once. A revise replaces the whole question (its fields are the entry's) and raises the revision.

Who may change what: an entry with an `id` must name an open question the caller itself asked; `withdraw` takes the caller's own questions, and the main conversation may withdraw any open question of the session.

The schema is validated as a whole, as the engine validates any tool input, and a call that fails it changes nothing. Past the schema, each entry stands alone: an entry refused for its own reason (the id is not open, it is another asker's, a reference cannot be captured) is refused with that reason and the others apply.

#### 2.2 Result

The result names only what the call touched:

    Added q7, q8. Revised q3 (revision 2). Withdrew q2.
    Not done: q5 is not open (answered at 14:05). The reference src/x.ts of your second new question could not be read: permission denied.

Its first line has a fixed grammar (contract X7): the sentences `Added …`, `Revised …`, `Withdrew …`, each present only when it names something, ids in the order of the call's entries. A transcript row is drawn from it, also long after the sheet's directory is gone, so no reader needs the file to know which id an entry got.

It does not list the rest of the sheet: the agent's context is spent on its work, and the full open list is supplied only when the agent has lost it (§5.5). When no surface can show the questions at this moment (§7), one sentence says so.

#### 2.3 References

A reference is captured when the call is made, so the human sees the file the question was about even after the agent edits it; a surface marks "changed since asked" when the file's current hash differs.

Capture goes through the engine's own Read tool, not the plugin's file access: first `$.tool.check` for a Read of the path (it opens no dialog), and only on *allow* a `$.tool.call` of Read. The plugin's own `$.fs.read` runs with no permission check and outside the other plugins' secret guards, and a referenced `.env` would then be copied raw into the sheet and toward other machines. Bodies are kept in the session's sheet directory (§3) and served on demand; they are never pushed to the hub. Probe P3 decides the details of capture (§12).

#### 2.4 What the description asks of the agent

Three things, each because one of the observed problems is behavioural and no mechanism fixes it: put every question you have in one call; revise a question you asked instead of asking a second one that overrides it; and put in `context` and `references` what a reader who sees only the card needs to judge it, marking an option `recommended` when you have a recommendation.

It does not ask the agent to withdraw a question the human's message has already answered: the human dismisses it (the owner's ruling, 2026-11-23: the agent's context is not spent on tending the sheet).

### 3. The sheet's record

One directory per session on the session's machine:

    $SMINOS_HOME/sheet/<engine-session-id>/
      state.json     the sheet; written only by the tool, by atomic replace
      inbox.jsonl    answers and dismissals from surfaces; append-only, one JSON object per line
      refs/<sha256>  captured reference bodies
      uploads/       images pasted into an answer

`state.json` holds the open questions with every field of §1, the accepted outcomes not yet delivered (`pending`), the next id, how far the inbox has been read, and a verdict per recent inbox key (§4.3). It is written before the tool call returns.

**One writer.** Only the tool writes `state.json`. Every surface, on every route, changes the sheet by appending a line to the inbox, through one code path in sminos (`sminos sheet put`, under a lock; contract X2), and the tool applies it. Two writers on one file lose an answer when a resuming session loads and rewrites the file while a surface writes into it.

**Readers read the file.** Every local reader (the page, the MAWS app for terminal and MAWS-run sessions alike, the `sminos` command) reads `state.json` plus the inbox lines past the recorded offset. MAWS does not rebuild a sheet from its own event stream of a session: a second record has no job the file cannot do, and each place the two could disagree (an answer the tool refused as stale, a dismissal held for delivery, a session answered while stopped and then resumed in MAWS, a fork, a rewind) is a fault the human would see. MAWS's journal draws the transcript's rows and nothing else of the sheet.

**Why a file and not the transcript.** Today's tool rebuilds its open asks from the transcript at resume. That rebuild returns nothing once the transcript passes 4 MiB and the search's output is cut (`sminos/hooks/mods/ask.tsx`), a subagent's calls are not in the main transcript, and captured references and undelivered answers are in no transcript. The plugin's `$.store` is one 4 MiB file for every session on the machine.

**The tool drains the inbox** at session start, whenever its bridge comes up, when a surface that appended tells the bridge so, and at every hook dispatch of its own (a tool call, a submitted prompt).

**Lifetime.** `/clear` closes the sheet of the session id it leaves (its questions withdrawn) and removes the directory. A fork or a copy has a new session id and an empty sheet, and is told so (§5.5). A stopped session's directory stays until its transcript is removed or the human dismisses the whole sheet from a surface.

### 4. Answers

#### 4.1 Shape

An answer to one question is the picked option labels (none, one, or several when multi-select) and free text (possibly empty), at least one of the two; images pasted into the text field are saved under `uploads/` and travel as file paths. There is no "Skip" (a question left alone stays open) and no "Decide for me" (the human picks the recommended option or says so in the text).

An inbox line:

    { "v": 1, "key": "<unique per act, made by the surface>", "kind": "answer" | "dismiss" | "retract",
      "id": "q7", "revision": 2, "picks": ["OAuth"], "text": "…", "images": ["uploads/….png"],
      "by": "page" | "maws" | "desk" | "cli", "at": "<time>" }

#### 4.2 Applying a line

| line | sheet state | outcome | verdict |
|---|---|---|---|
| answer | question open, revision equal | question answered; a pending outcome is recorded | `applied` |
| answer | question open, revision differs | nothing changes | `stale` (with the current revision) |
| answer or dismiss | question not open | nothing changes | `closed` (with how it closed) |
| dismiss | question open | question dismissed; a pending outcome is recorded | `applied` |
| retract of key K | K not yet applied | K is skipped when reached | `retracted` |
| any | a line with this key was already applied or refused | nothing changes | the first verdict again |

The revision check is what makes a rewrite safe: an answer names the revision the human saw, and an answer to a version the agent has since replaced is not applied; the surface shows the new version with the draft kept. The key makes a resent line (a remote copy retried) the same act and not a false refusal.

#### 4.3 What a surface shows for an answer it sent

**Queued**: appended and not yet applied (the session is stopped); it stays editable and retractable. **Accepted**: applied. **Delivered**: the agent has it (§5). A surface reads these from the file: lines past the offset are queued, `pending` entries are accepted, a verdict with no pending entry is delivered or refused.

Two surfaces answering the same question: the first line applied wins, the second reads `closed`.

### 5. Delivery

#### 5.1 Who delivers

The outcomes in `pending` are delivered by whoever runs the session now: **the tool in a terminal session, MAWS in a MAWS-run session.** Both read `pending` from the file, so a session answered while stopped in one and resumed in the other owes nothing to a record the other cannot see.

#### 5.2 Terminal sessions

The tool delivers by today's three routes (`sminos/hooks/mods/ask.tsx`): a prompt the plugin submits when the session is idle; context on the model's next main-loop tool result while a turn runs; context on the human's next prompt after a turn the human stopped. Outcomes accepted together go in one envelope.

A dismissal never starts a turn: it waits for the next envelope or the next of the other two routes. This is today's rule (sminos 1.47.0), kept.

An answer that was queued while the session was stopped is applied at the session's start and never starts a turn by itself: it rides the human's first prompt as context, and its lines say when the question was asked and answered and that the session was stopped meanwhile, so the model can weigh its age. The terminal says, at the resume, how many answers will go with the next message.

#### 5.3 The envelope

One versioned form, read by the model, by the tool (to mark an outcome delivered), by MAWS's reader of arrivals (`src/shared/engine/ask-delivery.ts`) and by the project log's export:

    [sheet v1] The human answered questions on your sheet.
    q7 "Which auth method should the login use?" → OAuth, Passkeys. Their text: "passkeys only on mobile"
    q8 "…" → their text: "…"
    Dismissed: q9, q11.
    <sheet-delivery>{"v":1,"keys":["…"],"answered":[{"id":"q7","revision":2,"picks":["OAuth","Passkeys"],"text":"…","images":["/abs/….png"]}],"dismissed":["q9","q11"]}</sheet-delivery>

It lists what was answered and dismissed and nothing else; it does not repeat what is still open.

#### 5.4 MAWS-run sessions

MAWS appends the inbox line like any surface, and delivers with the journaled `next` steer its `ask` uses today (`src/engine-host/session-maws.ts`), which also resumes a session whose engine process MAWS has released. An open question therefore no longer keeps a process alive: `src/engine-host/budget.ts` stops counting a session's open questions as a reason against release.

The steer is a user-role message, so board ticket 711's rule binds it (`src/shared/maws/ask.ts`): it holds no text the model wrote. Its lines name a question by id and a picked option by its place (`option 2`), carry the human's typed text as a JSON string, and carry the same `<sheet-delivery>` block with places in the stead of labels. The model holds its questions in its own calls, and gets them again after a compaction (§5.5).

The tool, inside the session, sees the steer in its `prompt.submit` hook (the bridge mod already reads host prompts there), drains the inbox first, and marks the outcomes whose keys the steer names as delivered. Nothing in the steer's text changes state: state changes only through the inbox, so a prompt that imitates an envelope does nothing.

A dismissal in a MAWS-run session is appended to the inbox and sent with MAWS's next steer or human message to that session, as a line of its own; it starts no turn.

Whether the tool's own delivery routes and its added context work in a session run over the wire is probe P1 (§12). The design does not depend on them: seeing the prompt is enough, and seeing is shipped.

#### 5.5 When the agent has lost its sheet

At a session start that follows a compaction, a resume or a fork, the tool supplies context through the engine's SessionStart context: each open question's id, header and question text, or, for a fork or a missing sheet directory, one line saying the sheet starts empty and why. A line in the tool's result would not reach a model that is waiting for answers and never calls the tool.

### 6. Subagents

A subagent may call the tool; its questions go on the session's sheet with it as asker, and every surface names it.

An answer to a subagent's question goes to that subagent directly as a message, `$.session.send({ to: { agentId }, text })`, while the subagent is running. This is the engine's own queue, read at the subagent's next tool round, and the bridge already uses it (`sminos/hooks/mods/bridge-agent-ops.tsx`). When the subagent has ended, the answer goes to the main conversation naming the asker and carrying the question text: the engine would resume an ended subagent to read a message, and whether a late answer is worth that is the main agent's call. Liveness is read from `$.agent.list()` at delivery; a subagent that ends between the check and its next round is resumed by the engine with the message, which is harmless (it reads the answer to its own question).

When a subagent ends with questions still open, the main conversation is told which, at the result of the Agent call or its next tool result, since it cannot withdraw what it never saw.

In a MAWS-run session the same send is made by the tool inside the session if probe P2 shows it works there; MAWS then appends the inbox line and sends no steer for that outcome. If it does not, MAWS delivers to the main conversation naming the asker.

### 7. Where no surface can answer

A session offers the sheet only where the human can reach it. A surface registers itself:

    $SMINOS_HOME/sheet/surfaces/<name>.json
    { "v": 1, "name": "mawsd", "pid": 1234, "url": "http://sheet.localhost:47831", "reach": "local" | "remote", "heartbeatAt": "<time>" }

`reach` is `remote` when the machine's endpoint is enrolled and carries sheets to the phone and to other machines (§8.4).

At session start the tool offers the sheet's schema when the setting `SMINOS_QUESTION_SHEET` is on and a registered surface is alive and its reach suits the session. The setting is off by default until the last child turns the default on (§9), so that through every earlier step a terminal session takes the sheet only where someone opted in. On reach: under `SSH_CONNECTION` a `remote` surface is required, because a local page answers and the human cannot open it. Otherwise the tool offers today's tool, with the engine's dialog in the terminal. Today's tool, not the bare built-in, is the fallback: a machine without `mawsd` keeps the asynchronous asks its phone cards answer today. Today's tool therefore stays in the plugin until every machine the owner uses has a surface.

The choice is made once per process and kept in `$.state`: the engine runs `session.start` again when a module reloads, and a plugin update must not change a running session's schema.

In a MAWS-run session the tool registers the sheet's schema when MAWS sets `MAWS_QUESTION_SHEET=1` at launch, and only then: MAWS itself is the surface. Being non-interactive is not the condition, since a one-shot `claude -p`, or a `claude` started by a tool inside a MAWS session, would get a tool whose process ends before any answer.

If the surface disappears during a session, questions still go to the file; the tool's result says no surface can show them now, and the terminal's line says the page is unreachable and names `sminos answer` (§8.3).

### 8. Surfaces

All surfaces draw the same components (a question card, a session's sheet, an overview of sessions), built in MAWS's renderer and imported by the page and by desk-web the way desk-web imports renderer modules today (`apps/desk-web/vite.config.ts`).

**The card.** Header and asker, the question, the context rendered as Markdown, each reference as a collapsed viewer (the captured text at its line range, or the image; "changed since asked" when it differs), the options with the focused option's preview beside them and the recommended mark, the text field (always present, accepts a pasted image), and Dismiss set apart. A card whose question was rewritten since the human last saw it says "Updated" and keeps the draft.

**The sheet.** A session's open cards, oldest first, and one Send, labelled with the count of questions that have a draft answer, which sends those and leaves the rest. Drafts are kept per question in the surface's memory.

#### 8.1 The MAWS app

The owner's ruling of 2026-11-23, which replaces the placement U1 gave a question's form (l4-approvals-08): **nothing opens by itself, the transcript row is the entry, and the side sheet is where a question is answered.**

- The row of a call that added or revised questions shows one compact line per question (id, header, the question's first sentence) and Open. Open shows the session's sheet in the side column, at that question.
- After the outcome the line is the receipt: `q7 Auth method → OAuth`, "Dismissed", "Withdrawn". A revised question's line moves to the row of the revising call, and the earlier row reads "Revised below".
- The side sheet never opens, activates or closes by itself (O-17, kept).
- The "Waiting for you" card has one line per open question, "from <agent>" when a subagent asked; choosing a line opens the sheet at that question.
- Every open question is a calm "Question waiting" item (`async_input`, O-22's kind and tone, kept). No question marks a session as stopped on the human (the owner's ruling: calm state only). A notification fires once per call, not once per question.
- A subagent's questions need no card of their own: they are on the sheet and in the "Waiting for you" card.
- The Overview and the project channel's waiting cards mount the same sheet component in place where they answer in place today.

U1's placement stands unchanged for what is not a sheet question: a permission prompt, a plan, the engine's built-in AskUserQuestion, and today's sminos tool on a machine that still has it.

#### 8.2 The local page

`mawsd` serves it on loopback only, under the host name `sheet.localhost` and port 47831 (configurable; 47830 is the endpoint's). `/` is the overview: every session on the machine with open questions, terminal and MAWS-run, stopped sessions grouped apart. `/s/<session>` is one sheet. It updates live.

A browser is paired once: an unpaired browser is shown how to get a one-time code (`mawsd sheet pair`), and exchanges it for a cookie. The link printed in terminals carries no secret, since a lasting secret in a link drawn in every terminal ends in browser history.

- The cookie is HttpOnly, SameSite=Strict and host-only on `sheet.localhost`. A cookie on `127.0.0.1` is not scoped by port, so any development server an agent starts on the machine would receive it.
- Every request, the live stream's included, is refused unless its Host is the page's and its Origin is exactly the page's.
- The page sends `Referrer-Policy: no-referrer` and a content policy that loads nothing from outside itself; agent-written Markdown is rendered without raw HTML and without remote images.

The page has authority over every session on the machine and renders text agents wrote, which is why these four bind.

#### 8.3 The terminal

One line above the prompt while the session has open questions: the count and the page's link to this session's sheet (`3 open questions · http://sheet.localhost:47831/s/<session>`). There is no in-terminal form. The call's row lists its questions and, after the outcome, their receipts, as §8.1's lines.

`sminos answer` is the command-line surface: it prints a session's open questions and appends an answer or a dismissal by id. It is what remains when the page is unreachable.

#### 8.4 The phone and other machines

Today a terminal session's question is answered from the phone (desk-web's cards) and, in the MAWS app, for a session on another machine, through the sminos daemon's remote operations and the endpoint (`src/endpoint/lane-a.ts`); a MAWS-run session's `ask` is answered remotely through `maws.ask.answer` (`src/endpoint/offers.ts`). The sheet is carried once for both kinds of session: reading a session's sheet and appending an inbox line travel that remote path, and desk-web's cards draw the same card component. Reference bodies are fetched on demand over the sealed channel. Pasting an image is not offered on the phone.

A terminal session's default changes to the sheet only after this works (the owner's ruling: nothing in use today stops working at any point).

### 9. What is retired

- **MAWS's `ask`** (`src/shared/maws/tools.ts`, `src/engine-host/tool-server/ask.ts`), with its four answer kinds the sheet does not have (file, folder, repository, design system; the owner's ruling). It stops being offered to new sessions when MAWS-run sessions take the sheet. The host keeps serving it to sessions launched with it until they end, a session adopted across a host handover included, and journals that hold `ask` rows are still drawn.
- **The `maws` value of the question-tool switch** (`src/shared/maws/tool-set.ts`). The stored value is kept and read as the default; nothing is migrated (the tool choice's D6 stands). "Default" then means the sheet where the tool runs, the engine's built-in otherwise.
- **U1's two question forms** (the stepper and the one-page form with Skip and "Decide for me") for sheet questions: one card.
- **Today's sminos tool**, later and outside this unit: it stays in the plugin as §7's fallback until every machine the owner uses has a surface. What this unit does is change the default (C7): when a session with open asks of today's tool first starts under the sheet's schema, those asks are imported once as sheet questions and the SessionStart context says so.

### 10. What the design leaves out

- An archive or a "recently answered" list: the transcript is the record.
- A "work is stopped on this" mark, and any blocking mode.
- Capturing the agent's preceding text as a question's context automatically. Under the to-human style that text is working notes, not something written for the human. Behaviour test E2 (§12) decides: if agents leave `context` empty where a reader of the card alone needs it, capture is added then.
- An overview across machines on the local page: the page shows this machine. The phone and the MAWS app show others.
- Starting a stopped terminal session in order to deliver an answer. It is delivered at the next resume.

### 11. Other readers of today's questions

Three consumers read today's asks and must read the sheet's: the `AskSnapshot` the ask mod keeps in `$.state` (`sminos/types/sminos.d.ts`), which doperpowers' appeal and reload mods observe; the project log's `question` and `answered` events; and MAWS's channel journal. Each is carried by the child that changes its source.

### 12. Probes and behaviour tests, before anything is built

| id | question | what decides |
|---|---|---|
| P1 | In a MAWS-run session: does the tool's `prompt.submit` hook see the host's steer; can it add context to it; does context on a tool result reach the model; does `$.prompt.submit` start a turn? | Seeing is required (§5.4). The rest only decides whether a dismissal and a subagent's answer can be delivered by the tool there. |
| P2 | `$.session.send` to a running subagent, in a terminal session and in a MAWS-run one; and to an ended one. | §6's route in each kind of session. |
| P3 | Capture: `$.tool.check` then `$.tool.call` of Read from the tool. Does it run the other plugins' guards; does Read's `file_unchanged` result return a stub after the model read the file; does the plugin's Read change what the model is taken to have read; how an image returns. | §2.3's capture, or a refusal to capture where it cannot be made safe. |
| P4 | Is the tool's atomic replace of `state.json` atomic to a reader in another process; does the inbox's locked append hold under two concurrent writers? | §3. |
| P5 | SessionStart context after a compaction, a resume and a fork. | §5.5. |
| E1 | Over long sessions, an agent that changes its mind about an open question revises it instead of adding a second. | The description's wording (§2.4). |
| E2 | A judge shown only the card, never the transcript, can answer the question from what the card carries. | The description's wording, and whether automatic capture is added (§10). |

P1 to P5 are spikes: their deliverable is a verdict written into the section that posed the question. E1 and E2 follow the pattern of the repository's existing behaviour evals (`output-styles/to-human-*-eval.py` in doperpowers). Three of the four observed problems depend on what the agent does, so E1 and E2 decide whether the design works more than any mechanism does.

## Acceptance (parent level)

The observable state that closes the unit as a whole; each item is observed in the running system. Children carry their own gates in their sections.

1. **Many questions, one call.** A terminal session's agent adds eight questions in one call, one with a file reference. The terminal shows `8 open questions` and a link; the page shows eight cards and the reference as captured. The tool's result names eight ids and nothing else.
2. **A subset.** The human answers three and presses Send. The agent quotes the three at its next tool result; five cards remain.
3. **Revise.** The agent revises one open question. Its card reads "Updated" and keeps a draft typed before. An answer sent against the earlier revision is not applied, and the card shows the new version.
4. **A note on an option.** The human picks an option and types a comment in the same card; the agent receives both.
5. **Dismiss.** Dismissing a question starts no turn; the agent is told with its next delivery.
6. **A stopped session.** With the terminal closed, the overview still lists the session's questions, apart. An answer given then reads "queued" and can be retracted. After the resume, it goes with the human's first message, marked with its age.
7. **The MAWS app.** A MAWS-run session asks. Nothing opens. The call's row shows one line per question; Open shows the side sheet at it; an answer reaches the agent and the line becomes the receipt. With the session's engine process released, an answer resumes it.
8. **A subagent.** A subagent's question shows "from <agent>". Answered while it runs, the subagent receives it; answered after it ended, the main agent receives it with the asker named.
9. **No surface.** On a machine without a registered surface, a new terminal session has today's tool and its dialog.
10. **The phone and another machine.** A sheet question is answered from desk-web, and from the MAWS app for a session on another machine.
11. **The page refuses strangers.** A request without the cookie, with another Origin, or with another Host is refused; the page loads nothing from outside itself.
12. **`ask` is gone for new sessions.** A new MAWS-run session lists no `ask`; an old transcript's `ask` rows are drawn; a session launched with `ask` still gets its answers.
13. **The flip.** A terminal session's default is the sheet; open asks of today's tool appear on it once.
14. **Behaviour.** E1 and E2 pass at the thresholds their spike sets with the owner.

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
- **Edges:** blocked-by: —; blocks: C2 (P2 terminal, P3, P4, P5), C5 (P1, P2 in a MAWS-run session).
- **Contracts:** none; its verdicts may move X3 and §6.
- **Design inheritance:** §12; `docs/doperpowers/specs/2026-10-13-ask-async-design.md` in doperpowers ("How the engine is reached") shows the probe-plugin method used for today's tool.
- **Required:** required.
- **Status:** not-dispatched (dispatchable now).

### C1: Behaviour baseline — spike (findings, never a merge)

- **Purpose:** Find out whether agents use the sheet as the design needs, since three of the four observed problems are behavioural: E1 (revise instead of asking again) and E2 (a card that can be judged alone), on long sessions, with a stub of the tool that accepts §2.1's input and records calls.
- **Acceptance:** The two evals exist in doperpowers beside the existing behaviour evals and run from one command each; a baseline result for each with the description wording of §2.4; the pass thresholds proposed to the owner and, once the owner sets them, written into Acceptance 14; a recommendation, with the evidence, on automatic capture of context (§10). E2's judge sees only the card.
- **Edges:** blocked-by: —; blocks: C2's description wording (C2 starts without it and takes its result before its last gate).
- **Contracts:** X7 (it fixes nothing; it consumes §2.1's input shape).
- **Design inheritance:** §2.4, §10, §12.
- **Required:** required.
- **Status:** not-dispatched (dispatchable now).

### C2: The sheet in sminos — plan (doperpowers repository)

- **Purpose:** The tool's new form and the sheet's record: the schema of §2 behind the start choice of §7, the directory, the inbox and the apply table of §3 and §4, delivery in terminal sessions (§5.2, §5.3, §5.5), subagents in terminal sessions (§6), the command-line surface, and the terminal's own drawing (§8.3). It lands beside today's tool and changes no default.
- **Acceptance:**
  - *G1, the contract published:* a JSON Schema for `state.json`, the inbox line and the surface registration, and a set of fixture directories covering every row of §4.2's table, in `sminos/types/sheet/`; `sminos sheet put` and `sminos sheet show --json` work against a directory with no session running.
  - *G2, a terminal session:* with `SMINOS_QUESTION_SHEET` on and a surface registration file present, Acceptance 1 to 6 hold with `sminos answer` standing in for the page, and Acceptance 8 holds; with the setting off, or no live registration, or `SSH_CONNECTION` with a local one only, the session has today's tool unchanged (Acceptance 9).
  - *G3, the other readers:* the `AskSnapshot` in `$.state` and the project log's `question` and `answered` events carry sheet questions (§11); the description passes C1's thresholds.
- **Edges:** blocked-by: C0 (P2 in a terminal, P3, P4, P5) for G2; G1 is not blocked. blocks: C3.G2, C4, C5, C6.
- **Contracts:** owner of X1, X2, X3 (the terminal form), X6, X7; consumer of X4.
- **Design inheritance:** §1 to §7, §8.3, §11. Advisory: when the inbox is drained (§3), how the terminal line is composed with the to-human band (the ask-async design in doperpowers, "Composing with to-human", is how today's line does it).
- **Required:** required.
- **Status:** not-dispatched (G1 dispatchable now; G2 blocked-by C0).

### C3: The sheet in the MAWS app — plan

- **Purpose:** The components every surface draws (the card, a session's sheet, the overview), MAWS's reading of sheets from their files and its appending through sminos's writer, and the app's own drawing for terminal sessions on this machine: the row's lines and receipts, the side sheet, the "Waiting for you" card and the attention items (§8.1), with U1 amended where §8.1 says.
- **Acceptance:**
  - *G1, on fixtures:* the components render every fixture directory of C2.G1, a card for each state a surface can show (open, updated since seen, queued, accepted, refused as stale); the reader lists every session directory under a given `$SMINOS_HOME`.
  - *G2, live:* for a terminal session on this machine with the sheet on, Acceptance 7's drawing holds in the app (nothing opens by itself; the row's lines; Open shows the side sheet at the question; the receipt), an answer sent in the app reaches the agent, and a stopped session's questions show.
- **Edges:** blocked-by: — for G1 (it builds on X1 as this document states it and re-reads C2.G1's fixtures when they exist); C2.G2 for G2. blocks: C4, C5, C6.
- **Contracts:** owner of X5; consumer of X1, X2, X3, X7.
- **Design inheritance:** §3 (readers read the file), §4.3, §8 (the card, the sheet), §8.1 [binding], U1's sections named in the header. Advisory: where the reader runs (`mawsd`'s spine, beside the terminal-session driver in `src/services/lane-a/`), and whether MAWS reaches the writer through the `sminos` command or the sminos daemon's socket (`src/endpoint/rl10/`): C2 and C3 settle it between them and record it under X2.
- **Required:** required.
- **Status:** not-dispatched (G1 dispatchable now).

### C4: The local page — plan

- **Purpose:** `mawsd` serves the sheet to a browser beside the terminal (§8.2) and registers itself as a surface (§7), so that a terminal session with the sheet on has a place to be answered.
- **Acceptance:** With `mawsd` running, a paired browser at `http://sheet.localhost:47831/` sees the overview of this machine's sessions, stopped ones apart, and `/s/<session>` live; Acceptance 1 to 6 hold end to end with the page as the surface; Acceptance 11 holds (each refusal shown by a request that is refused); the registration file exists while `mawsd` runs and is stale within its heartbeat after it stops; the terminal's line shows the link.
- **Edges:** blocked-by: C2.G2, C3.G1. blocks: C7.
- **Contracts:** owner of X4; consumer of X1, X2, X5.
- **Design inheritance:** §7, §8.2 (its four rules binding; the port, the pairing command and the bundle's build are advisory). This is `mawsd`'s first HTTP door: everything else it serves is a token-authenticated socket or a sealed channel (`src/shared/daemon/files.ts`), so the page's serving code is new and is reviewed at the *high* rung.
- **Required:** required.
- **Status:** not-dispatched (blocked-by C2, C3).

### C5: MAWS-run sessions — plan (ticket 600)

- **Purpose:** The sheet in a session MAWS runs: the launch sets `MAWS_QUESTION_SHEET` and stops offering `ask`; MAWS appends answers and delivers them with its steer in ticket 711's form (§5.4); an open question no longer holds an engine process; the rows, the side sheet and the cards of C3 draw these sessions too; `ask` and the switch's `maws` value are retired as §9 says.
- **Acceptance:** Acceptance 7 (with the engine process released, an answer resumes the session), 8 in a MAWS-run session by the route P2 allows, and 12; a dismissal reaches the agent with MAWS's next message and starts no turn; a MAWS-run session on another machine is answered from this one (the steer travels as today's does).
- **Edges:** blocked-by: C0 (P1, P2), C2.G2, C3.G2. blocks: C6, C7.
- **Contracts:** owner of X3's steer form; setter of X6's `MAWS_QUESTION_SHEET`; consumer of X1, X2, X5, X7.
- **Design inheritance:** §5.1, §5.4, §6's last paragraph, §7 (the MAWS-run paragraph), §9; the tool choice's "What ticket 600 changes" (`docs/doperpowers/plans/2026-11-23-tool-choice.md`). Two of ticket 600's three blockers are already answered by the design: the built-in is not needed, because the sheet uses no engine dialog, and answers come in through the inbox and the steer, not through the bridge.
- **Required:** required.
- **Status:** not-dispatched (blocked-by C0, C2, C3).

### C6: The phone and other machines — decomposing run at dispatch

- **Purpose:** A sheet question is answered from desk-web's cards and, in the MAWS app, for a session on another machine (§8.4), so that the terminal's default can change without taking away what works today.
- **Acceptance:** Acceptance 10; a reference's body is fetched on demand and is in no hub record; an answer resent over the remote path is applied once (§4.2's key).
- **Edges:** blocked-by: C2, C3, C5. blocks: C7.
- **Contracts:** consumer of X1, X2, X5.
- **Design inheritance:** §8.4, advisory in full: the carriage spans sminos's remote operations, the endpoint's grades and offers (`src/endpoint/lane-a.ts`, `src/endpoint/offers.ts`, `src/endpoint/by-effect.ts`), org-protocol's actions and desk-web's cards (`apps/desk-web/src/cards/`), and is cut when it nears dispatch, against what C2 to C5 landed.
- **Required:** required.
- **Status:** not-dispatched (deliberately late).

### C7: The flip — brief

- **Purpose:** The sheet becomes the default for terminal sessions, and open asks of today's tool move onto it once (§9).
- **Acceptance:** Acceptance 13; with no setting given, a new terminal session on a machine with a live surface of suitable reach has the sheet, and one on a machine without has today's tool.
- **Edges:** blocked-by: C4, C5, C6.
- **Contracts:** flips X6's default.
- **Design inheritance:** §7, §9.
- **Required:** required.
- **Status:** not-dispatched (deliberately late).

## Cross-Child Contracts

- **X1 · The sheet's record.** The directory of §3, the fields of §1, the inbox line of §4.1, the apply table of §4.2 and the three shown states of §4.3. *Owner:* C2, which publishes the JSON Schema and the fixture directories at C2.G1. *Binds:* C3, C4, C5, C6. A change after C2.G1 goes through this document's writer.
- **X2 · The writer's door.** Every change to a sheet from outside the tool is one inbox line appended by sminos's own code under its lock: `sminos sheet put` (a line on standard input, the verdict or `queued` on standard output) and `sminos sheet show --json`. Whether MAWS calls the command or the same code over the sminos daemon's socket is settled by C2 and C3 and recorded here. *Owner:* C2. *Binds:* C3, C4, C5, C6.
- **X3 · The envelope.** §5.3's text and its `<sheet-delivery>` block, and §5.4's form for a user-role steer (ids, option places, the human's text as JSON strings). *Owner:* C2 for the terminal form, C5 for the steer form; the block's JSON is one schema, published with X1. *Readers:* the tool, MAWS's reader of arrivals, the project log's export.
- **X4 · Surface registration.** The file of §7 and its heartbeat. *Owner:* C4 (it writes it). *Reader:* C2.
- **X5 · The components.** The question card, the session's sheet and the overview, over one model of a sheet read from X1, importable from MAWS's renderer by the page and by desk-web. *Owner:* C3. *Consumers:* C4, C5, C6.
- **X6 · The start choice.** `SMINOS_QUESTION_SHEET` (terminal sessions; off by default until C7) and `MAWS_QUESTION_SHEET=1` (set by MAWS at launch), read once per process and kept in `$.state`. *Owner:* C2. C5 sets MAWS's; C7 changes the default.
- **X7 · The stored call.** §2.1's input and the fixed first line of §2.2's result, from which a transcript row is drawn without the sheet's directory. *Owner:* C2. *Consumers:* C3, C5, and C1's stub.

## Ordering & Dependency Map

    C0 probes ──────────────┬────────────────────────────┐
    C1 behaviour ──┐        │                            │
                   ▼        ▼                            ▼
    C2.G1 ──► C2.G2/G3 ──► C4 the page ────────────► C7 the flip
       │          │                                      ▲
       ▼          ▼                                      │
    C3.G1 ──► C3.G2 ──────► C5 MAWS-run ──► C6 phone, other machines

- C0, C1, C2.G1 and C3.G1 start together: the contract X1 is stated in this document, so the app's components and the tool's record are built against the same fixtures before either runs live.
- C4 and C5 run in parallel once C2.G2 and C3 are in.
- C6 is cut and run last but one; C7 is the only step that changes what a terminal session gets with no setting, and it waits for everything.
- Today's sminos tool is not removed in this unit (Deferred).

## Verification

- This document: one independent spec review and one buildability review of the roadmap, before the owner's gate on the cut. The design was debated with the design critic before approval.
- Each plan child's execution document: the buildability review.
- Branch reviews through doperpowers:review-code: *high* for C2 (a fault loses or duplicates the human's answer) and C4 (a door into every session on the machine); *medium* for C3, C5 and C7; C6 names its own at its cut.
- Recomposition: Acceptance 1 to 14 run as written on the owner's machines by the session holding this document, then a scale review, since the unit spans two repositories and one cross-child record.

## Risks & Mitigations

- **Agents do not revise, or leave context empty.** C1 measures it before the tool is built; the description's wording and §10's capture are its levers.
- **The two repositories drift on X1.** One schema and one set of fixtures, published by C2.G1 and read by MAWS's tests.
- **A hook cannot do in a MAWS-run session what it does in a terminal.** The design needs only that it sees the host's prompt (shipped); C0's P1 decides the rest before C5 starts.
- **The page is a new door.** §8.2's four rules are binding and each has a refused request in C4's acceptance.
- **A long wait between C4 and C7.** The setting lets the owner use the sheet on this machine from C4 on, while the default waits.

## Deferred / Out of Scope

**Deferred (may return):** removing today's sminos tool from the plugin, once every machine the owner uses has a surface; an overview across machines on the local page; starting a stopped terminal session to deliver an answer; automatic capture of context (decided by C1); pasting an image on the phone.

**Out of scope (standing):** a blocking mode; an archive of answered questions; a mark that a session is stopped on the human; MAWS's file, folder, repository and design-system answer kinds.

## Tracking Map

Approved design: commit `2fe16c685` (the design, 2026-11-23). The roadmap's approval is recorded here when the owner gives it.

| child | artifact | status |
|---|---|---|
| C0 engine probes | findings in §12's sections; fixtures under `spikes/protocol-probe/` and the probe plugin's transcripts | not-dispatched |
| C1 behaviour baseline | the evals and their report in doperpowers | not-dispatched |
| C2 the sheet in sminos | execution document in doperpowers `docs/doperpowers/plans/` | not-dispatched |
| C3 the sheet in the MAWS app | execution document in `docs/doperpowers/plans/` | not-dispatched |
| C4 the local page | execution document in `docs/doperpowers/plans/` | not-dispatched |
| C5 MAWS-run sessions (ticket 600) | execution document in `docs/doperpowers/plans/` | not-dispatched |
| C6 the phone and other machines | its own cut at dispatch | not-dispatched (deliberately late) |
| C7 the flip | ledger in doperpowers `docs/doperpowers/ledgers/` | not-dispatched (deliberately late) |

## Outcomes & Retrospective

Pending — written at finish.
