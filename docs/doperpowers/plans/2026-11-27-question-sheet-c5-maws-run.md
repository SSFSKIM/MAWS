# Question sheet, C5 — MAWS-run sessions: execution (2026-11-27)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C5** (MAWS-run sessions). **Parent pin:** `7dd3627e9` (branch `question-sheet`; the one commit after it, `4b9a057b7`, records the owner's look at the app and moves nothing this child reads). **Ticket:** MAWS board #870, a child of #600. The child's section in the composite ("### C5: MAWS-run sessions") is its spec. The composite's §5.1, §5.4, §6 (its last paragraph), §7 (the MAWS-run paragraph), §9 and §11 are its design, binding where the composite's "Grades" paragraph says; X3's steer form and X6's `MAWS_QUESTION_SHEET` are the contracts it owns or sets, and X1, X2, X5 and X7 the ones it consumes. This document carries the constraints, the decisions the composite did not carry, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `b65a1e175` (C3's first landing, the prestart engine of #880 and the direct tell are on it); branch `question-sheet-c3` at `04bf48574` (C3's second landing: the side sheet, the row, the attention items), which is on master before M3 starts and is this child's base; doperpowers `main` at `42ab7915d` (C2 whole, sminos's sheet as built; the published set at version 1, digest `594200ae…e277`, unchanged since `2594002af`).
>
> **Read before M1:** the composite whole; in doperpowers, `sminos/types/sheet/README.md`, and in `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` the sections I2, I3, I4, I7, I8, I9 (its last paragraph, "In a MAWS-run session") and I10; here, C3's execution document (`docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md`: S8 to S16, §B, §C, §E, §H, §I), `docs/doperpowers/plans/2026-11-23-tool-choice.md` (D1, D6, D8, D12, §C, §E, §F, "What ticket 600 changes"), `docs/doperpowers/plans/2026-11-24-prestart-engine.md` (D1 to D6) and `spikes/protocol-probe/findings-qsheet-c0.txt` (P1, P2, P5).

After this child, a session MAWS runs whose question tool is "Default" asks through the same sheet a terminal session does. The agent's call returns at once and draws its row; nothing opens. The person answers in the side sheet, on the local page or with `sminos sheet answer`, and the agent has the answer as one message from MAWS: each question named by its id, a picked option by its place, what the person typed as they typed it. A question no longer holds the session's engine process: the process may be released while questions are open, an answer given then starts it again and is delivered, and a dismissal waits for the next message without starting anything. Each accepted outcome reaches the agent once, whatever happens between MAWS writing it and the agent reading it: a second answer that lost, a line sent twice, a Stop, the engine host replaced under the session. A session set to "MAWS" keeps `ask` exactly as it is, and no default changes.

How to see each of these is Concrete Steps. What closes the child is its Acceptance in the composite, cut into clauses under "The gates, by clause".

## Progress

- [x] (2026-11-27) This document written against the composite at `7dd3627e9`, MAWS master `b65a1e175`, `question-sheet-c3` at `04bf48574` and doperpowers `42ab7915d`.
- [ ] The document's buildability review (one round).
- [ ] M1 — sminos: a MAWS-run session's routes (doperpowers).
- [ ] M2 — The probe: a MAWS launch that takes the sheet (spike).
- [ ] M3 — The launch.
- [ ] M4 — The steer's form, the flights' fold, the steer as an arrival.
- [ ] M5 — The host: flights in the journal, the two ways a delivery is written.
- [ ] M6 — The deliverer: applied outcomes out, acknowledgements in, a released session brought up.
- [ ] M7 — What draws and what else reads: the notice, the channel journal, the words.
- [ ] M8 — Live on the Mac runner, and the acceptance.
- [ ] The branch's review (medium), the doperpowers pull request's (medium), the landing through the master landing architect.

## Words this document adds

The composite's Terms define terminal session, MAWS-run session, the tool, sheet, question, asker, surface, the page, the bridge and envelope. C2's plan adds the record, the door, the step and the published set; C3's adds the set's pin, the model, a sheet call, the spine and the side sheet. Added here:

- **The host** is the engine host: the detached process `mawsd` starts, which owns each MAWS-run session's engine process, its queue and its journal (`src/engine-host/`). The spine reaches it through `SpineHosts.dispatch('engine-host', …)` and hears it through `hosts.onEvent` (`src/services/spine-root.ts`).
- **A sheet launch** is a launch whose served set of MAWS's tools has `question: 'engine'` on a host that lists the capability of F3. It is the launch that carries `MAWS_QUESTION_SHEET`.
- **The deliverer** is the spine's part that sends accepted outcomes to a MAWS-run session and acknowledges them (`src/services/sheet/delivery.ts`, M6).
- **A steer** is a user-role message of priority `next` the host writes to the engine (`MessageQueue.steer`, `src/engine-host/queue.ts`). **A sheet steer** is one whose whole content is an envelope in the steer form (§T). **A rider** is such an envelope appended as the last text block of a message the person sent.
- **A flight** is one written message that carries outcomes, known by the message's uuid and the keys it carries. It is **flying** until the journal says how it ended, then **read** or **unread** for good (§U).
- **An outcome wakes** when it gets a steer of its own, which starts a turn in an idle session. One that does not wake **rides**: it leaves with the next sheet steer or the person's next message (F16).
- **Released** is the digest's word (`SessionDigest.released`, `src/shared/ipc/schema/session.ts`): the session's last exit was MAWS's own release of an idle process or one over the memory budget, and nothing has launched, archived or taken it since.
- **The acknowledgement** is the inbox line of kind `delivered` (composite §4.1) MAWS appends for a flight that was read.
- **The probe** is M2's run of the real engine with sminos loaded, against the scripted model. **A recording** is one of its fixtures, an engine journal. The gate's suites play one back in place of an engine: in process (`src/engine-host/replay-transport.ts`), or as a real child process where a session host must hold one (**the stub engine**, `test/support/stub-engine.ts`).
- **The Mac runner** is the project's self-hosted Mac, the one the gate's `mini` lane runs on.

## Verification

- This document: one adversarial buildability review before M1 (the composite's Verification, "Each plan child's execution document").
- Each milestone: the task review of doperpowers:subagent-driven-execution at its boundary. M4 (the form every later milestone writes or reads, and the table that decides what "delivered" means) and M5 (the journal rows a later host must be able to read) are reviewed before anything consumes them.
- The branch: doperpowers:review-code at **medium** (the composite's Verification), once, on the whole range. The doperpowers pull request of M1 is reviewed at medium too: C2's own range was reviewed at high because a fault there loses or duplicates an answer, and M1 adds only context to routes that carry no answer in a MAWS-run session, so it can do neither.
- The landing: through the master landing architect, after the doperpowers pull request is on doperpowers `main` and M8 has run against that commit.
- No look is asked of the owner: this child draws nothing new. Its two changed sentences of copy (F7) go to the owner through the composite's writer and hold no milestone.

## Constraints on every milestone

**Binding inheritance** (the composite's "Constraints on every child" and "Grades").

- The engine is an unmodified, pinned binary (charter D-1), reached through its launch line, its stream-json wire and its control protocol only. A claim about the wire is verified against `spikes/protocol-probe/fixtures/` or by M2's probe, never against a document alone.
- Board ticket 711: no user-role text MAWS sends holds text a model wrote. Here it binds every byte of §T: a question's words, a header, an option's label and a subagent's name never enter a steer or a rider.
- §3's one writer and §4.2's table: MAWS changes a sheet only by inbox lines through the door, computes no verdict, and sends only what `pending` holds, by key. §5.1: an outcome is delivered by whoever runs the session; MAWS sends only outcomes whose recipient is the main conversation.
- X1 and X3: the published set is frozen at version 1. Nothing here changes a schema, an example, the grammar or the door's contract. A need to change one stops the milestone and goes to the composite's writer as a ruling request.
- §8.1 is the owner's ruling: nothing opens by itself, calm state only, no question marks a session as stopped on the person.
- Nothing the owner uses today stops working at any step. A session whose question tool is `maws` launches with the same line, the same list and the same paragraph as before (the tool choice's A3; `src/engine-host/launch.test.ts` holds the line), and `ask` is served, answered and re-raised across a handover exactly as today until C7. Every path added here is inert for a session that is not a sheet launch.

**This child's own rules.**

- **Both repositories are public.** No file, test, fixture, document, commit message or pull request carries a path under a real home, a machine's name, an account, or the version of software installed on the owner's machines. Examples use invented names and paths; the set's copy under `test/fixtures/sheet/set/` is never edited. A fixture the probe records holds the engine's own frames; the scenario runs under a scratch configuration home and a scratch sminos home, so no real path enters it, and M2 checks that before committing.
- **Nothing is installed, built, typechecked or launched on the laptop this was written on.** Typecheck, lint, the unit suite and the probes' tests run on GitHub Actions: `scripts/ci-gate.sh <worktree> --gates static,unit,probes`. Each Electron e2e group a milestone names runs through the same script (`--gates e2e:<group>`). A call naming no gates is refused. In doperpowers the gates are `ci-gate --gates …` from its worktree, named in M1.
- **Live steps run on the Mac runner**, from checkouts under `~/.local/share/question-sheet-c5/` there (`maws/` and `doperpowers/`), each driven by a script that asserts from the record, the journal and the scripted model's requests. No step is a person watching a window. The runner's load rule (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5) holds.
- **Commits and the pull requests' bodies** end with the line `Sminos-Session: question-sheet-design#23738737 (MAWS on macbook)`.
- Light theme is the default; components use tokens only. Copy lives in a `copy.ts` beside its module and follows the word cut's rules (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`).
- The wire moves once, in M5: `WIRE_MINOR` (`src/shared/ipc/wire.ts`) rises by one over whatever master holds then, and `wire-manifest.json`, `wire-fingerprint.json` (both by `pnpm wire:manifest`), `routes.json` (by its test under `MAWS_ROUTES_WRITE=1`) and `src/shared/machine/address-paths.json` are regenerated in that commit. Commit `8f59e9b42` (`session.tellAgent`) is the pattern for adding a host command.
- This child adds cases to existing e2e specs and no spec file, so `default`'s own-spec pin does not move and no gate's group list changes. Its live driver is a rig with its own Playwright config, as C3's `e2e/sheet-live.rig.ts` is, which no group collects.

**Facts of the code at the pin**, each read at `b65a1e175` unless it names another tree.

- **What a launch's environment is.** `buildEnvironment` (`src/engine-host/launch.ts`) passes the login shell's variables through an allowlist that admits neither `SMINOS_HOME`, `DAEMON_HOME` nor any `MAWS_*`, and then sets its own (`SMNS_MEMBER`, `MAWS_LANE`). The other way a variable reaches an engine is the spec's `extraSettings.env`, which becomes the `--settings` JSON's `env` and which the engine applies to its process at startup; that is how `MAWS_NATIVE_TO_HUMAN` and `CUA_BROWSER_BACKENDS` travel (`extraSettingsOf` and `withOwnerChannel`, `src/services/sessions/launch-mapping.ts`). The journal's `spawn` row keeps the argument list, so a settings value is on record, and only the names of the process environment.
- **Who knows a launch's session id.** `buildLaunch` resolves it: the resumed id, else the spec's `sessionId`, else one it mints. A prestarted engine's spec has `sessionId: null` (`prestartLaunch`, `src/services/sessions/prestart.ts`, writes nothing), so its id exists only inside `buildLaunch`, and an adopted prestart keeps that id (`runIntentSetup`, `src/services/sessions/setup.ts`).
- **What the prestart compares.** `sameLaunchSpec` (`src/engine-host/prestart.ts`) compares the two specs whole, `sessionId` set to null in both. `prestartKey` (`hostLaunchOf`, `src/services/sessions/machine-route.ts`) holds route facts only. Nothing compares `plan.env` or `plan.args`.
- **Where a launch's set is decided.** `servedSet` (`src/services/sessions/served-set.ts`), asked once per attempt by `runIntentSetup`, `runResume` (`resume.ts`) and `prestartLaunch`; the answer goes to the spec builders (`intentLaunchSpec`, `resumeLaunchSpec`) as `ctx.mawsTools` and to `ownerChannelLaunch` (`src/services/owner/launch.ts`) inside the spec. A record MAWS did not create (a discovered terminal session) has no `mawsTools`, which reads as the full set, question `maws`.
- **The supplement.** `ownerChannelLaunch` appends one only when the to-human lane is on with an external style (`APPENDS['external-style-plus-supplement']`), chosen by the spec's question tool: supplement 3 for `maws`, supplement 4 for `engine`, whose text says sminos's tool is not available (`ASK_ENGINE`, `src/shared/owner/contract.ts`). `decideFlags` renders a prompt anew when what a session recorded differs from what the decision wants.
- **The direct tell is on master.** `buildLaunch` passes `--plugin-dir <mods/maws-tell>` on every launch, after the engine's fixed flags and before `--model`. The mod (`mods/maws-tell/hooks/register.mjs`) registers one tool on its own server, a `session.start` hook that calls `next` first, and three hooks matched to its own tool. It has no prompt hook and no unmatched `tool.call` hook, so it shares no dispatch with sminos's sheet. Its probe ran with no sminos loaded; M2 runs both.
- **sminos's start choice** (`chooseStart`, `sminos/hooks/mods/sheet-model.tsx`): `MAWS_QUESTION_SHEET` equal to the session's id gives the sheet with runner `maws`, tested before `MAWS_NATIVE_TO_HUMAN` and before "not interactive", either of which gives no question tool of sminos's at all. So a MAWS-run process without the variable never drains a record, whatever the record holds.
- **What sminos does in a MAWS-run session today** (`sminos/hooks/mods/sheet.tsx`): it drains, sends to running subagents, takes `delivered` lines, and composes no envelope for the main conversation. `take()` returns only a start's or a compaction's context there, and `withResultRoute` returns at once: **the notices (an ended subagent's open questions, a call's late outcome) are queued and never carried.** `landed` and the transcript search are terminal-only: in a MAWS-run session only a `delivered` line takes a key out of `pending`. The door's nudge reaches the session through its bridge's `sheet` op, which an observing bridge answers.
- **A pending outcome's recipient** is an agent only while that subagent runs and the tool has taken the outcome for its own send (`recipient_of`, `sminos_sheet_step.py`); a start, a reroute and any step that no longer finds the agent running make it `main` and not taken. So "recipient is `main`" is the whole test of what is MAWS's.
- **The steer's published example** (`test/fixtures/sheet/set/examples/terminal/steer.txt`, composed from `examples/terminal/input/`) is the terminal envelope of the same record with three differences: no question text, `option <n>` for each pick, and `(asked by the subagent <agent id>, which has ended)` for a subagent's question. It carries no line for an outcome owed across a stop and no `[Image source: …]` line; the image's path is in the block alone.
- **How a steer ends in the journal** (`src/engine-host/queue.ts`, `prompt-history.ts`; fixtures `spikes/protocol-probe/fixtures/pass3/steer-next*.jsonl`, `qsheet/qsheet-p1-hooks.jsonl`). The host journals an `out` `user` row with the message's `uuid` and `priority`; the engine answers `in` `command_lifecycle` rows naming it as `command_uuid`: `queued`, then `started` (folded into the running turn at its next tool round, or a turn of its own when idle) and `completed`, or `cancelled`, `discarded` or `refused` before any start. The queue's own rows are `meta` `{event:'queue', action, messageUuid}`: `withdraw` before it asks the engine to cancel, then `cancel`, `hold` or `giveback`; `abandon` for whatever is unended at an exit or at the next launch's recovery; `revert` where a write failed and the queue put the message back. `UnsettledFold` reads exactly these to say which steers are open. A steer cancelled while it waited leaves no trace in the model's requests.
- **A write's rows.** `OutboundWriter.write` (`outbound-writer.ts`) writes the frame, and only when the write resolves journals the `preface` rows and the `out` row together. A write that rejects journals `write_failed` with no uuid. A host that detaches gives writes in flight three seconds and then fails them, though the session host may already have handed the frame to the engine; a host that dies between the pipe and the journal leaves the same hole. **So a tie that is journaled as a preface can be missing for a message the engine received.** Today's asynchronous `ask` has that hazard (its `maws_ask_answered` row is a preface), and it is why F12 journals the tie first.
- **What an adopter knows.** `EngineSession.adopt` (`session.ts`) folds the launch's rows (`launchRows`, `holder/restore.ts`) before it connects, and the session host replays what the engine wrote meanwhile from its ring, through the ordinary `record`. A ring that overflowed gives `host_attach` with `replayed: 'gap'` and a reseed from the engine's transcript; the lifecycle rows in the gap are gone.
- **What holds a process.** `SessionMaws.pending` is the tool server's calls in flight plus the asynchronous asks; `hardReasons` (`budget.ts`) refuses a release while it is above zero. Sheet questions are in neither count, since they are in no table of the host.
- **Bringing a session up without sending.** `SessionService.acquire(appSessionId, reason, options)` (`src/services/sessions/service.ts`) resumes a session and resolves `{ status: 'ready', … }`; `reason` is logged and nothing branches on it; `resumeAfterHandover` calls it with `'resume'`. The queue's `steer` refuses a session whose process is not `ready`.
- **The one path of a user frame.** Every user frame a session writes goes through the `write` the session hands its queue (`MessageQueueDeps.write`, wired in `session.ts`). Only a submission's content passes `prepare` (`SessionMaws.withLinkedReads`), which already appends text blocks to what the person wrote and leaves the queue entry's own content alone; a steer and a promotion are written as given.
- **Events reach the spine at most once.** `mawsd/spine-hosts.ts` drops what arrives while the link is not ready, and an adopter's fold emits nothing again. A reader that must not miss a fact asks for it (`session.promptHistory` is the owner channel's way).
- **How a person's message is read for MAWS's own texts.** `readPersonsContent` (`src/shared/engine/arrival.ts`) takes MAWS's `ask` envelopes out of a person's content, whole or as members of a text the engine joined, and what is left is the bubble. On `question-sheet-c3`, `src/shared/engine/sheet-carrier.ts` reads a sheet's envelope on a plugin's prompt and a hook's context only, and says so: no carrier there is the person's.
- **The channel journal.** `LaneBSource` (`src/services/channel/lane-b.ts`) records `question` and `answered` entries from a MAWS process's live events only (an event with its journal row), keyed by `src = <project>/lane-b/<appSessionId>/<anchor>`; an answer waits for its question's entry (`requires`). The renderer joins an answer to its question by the anchor's form (`questionOf`, `src/renderer/src/channel/project.ts`), for `ask/…/answered` and `answer/…` only. sminos writes a member session's sheet questions to its own project log from the record (C2's I12), and where the machine's sminos daemon is enrolled its host events reach the same journal as lane A entries (`#journal`, `src/endpoint/rl10/link.ts`).
- **The notifier** on `question-sheet-c3` (`src/main/attention/notifier.ts`) announces a sheet item once per call and returns before any system notification for it, as for a terminal session's item; its comment leaves a MAWS-run session's to this child.

## Decisions settled at authoring

Each is a choice the composite left to this child, numbered F1 to F27 (the charter's are D-, C2's K- and U-, C3's S-, C4's T-). Where one makes a sentence of the composite false or incomplete, the sentence is in the last section. The interfaces they fix are §R to §Z.

**The launch.**

- **F1 · A sheet launch is told by one fact the spec already carries: the served set's `question` is `engine`.** The launch line, the supplement, the spawn row, the prestart's comparison and an adopter all read `mawsTools` today, so no second fact can disagree with it. From this child on, "Default" on a host that lists F3's capability means the sheet where sminos runs and the engine's built-in where it does not, as the composite's §9 says. Lost: a `questionSheet` flag on the spec, which is a second fact, a wire change, and one more thing an older host ignores silently.
- **F2 · The host sets `MAWS_QUESTION_SHEET`, in `buildEnvironment`, to the session id `buildLaunch` resolved**, for a sheet launch. Only `buildLaunch` knows the id of a prestarted engine, and an adopted prestart keeps it, so the variable a prestart was started with is the right one after Send. This is C2's proposal (the composite's §7) taken as built: the value is the session's id, and sminos honours it only when it equals the id of the session the process starts. Lost: the spine writing it into `extraSettings.env`, the way `MAWS_NATIVE_TO_HUMAN` travels. The spine does not know a prestart's id, and a value in the spec is compared by `sameLaunchSpec`, so Send's id would never equal the prestart's and no Default chat would be adopted. **How it joins the prestart's key:** it does not need to. The comparison that decides an adoption is `sameLaunchSpec` over the whole spec; the variable is derived from two things, the set (compared) and the id the prestart itself minted (kept), so two launches that differ in it already differ in the spec. `prestartKey` gains nothing.
- **F3 · A host that sets the variable says so: the capability `engine.questionSheet`.** The spine reads it where it reads `engine.mawsTools` (`s.hostLists`). Without it a Default launch is what it is today, the spine appends supplement 4, serves no override (F5) and delivers nothing. The host that outlives a `mawsd` update is the case: the engine host is detached and may be the older build.
- **F4 · The spine names the sminos home, as `SMINOS_HOME` in the spec's `extraSettings.env`, for a sheet launch.** The value is the one the sheet's reader was created with (`sminosHome(deps.env, shellEnv)` in `spine-root.ts`), so what a MAWS-run session's sminos writes and what MAWS reads are the same directory by construction, not by two resolutions agreeing. It is stable between a prestart and its Send, so the comparison holds. `DAEMON_HOME` is not passed: sminos reads `SMINOS_HOME` first. It is set on sheet launches only, so every other launch's line is unchanged. A home that cannot be resolved (the test runner's refusal of the real one) names nothing and is logged. Lost: admitting the two names through the host's allowlist, which passes the login shell's value and not the reader's (they differ wherever `mawsd`'s own environment names a home), and changes the environment of every launch. Lost: a new spec field read by `buildEnvironment`, kept as the fallback if M2 finds a settings variable does not reach sminos's own processes.
- **F5 · A session that already has a sheet is launched as a sheet launch for that launch, and its record keeps its set.** Before `servedSet`, a resume asks the sheet service for the record of the engine session it resumes; when the record holds an open question, a pending outcome or a queued line (the model's `open`, `hidden`, `pending`, and `sent` entries of state `queued`, any of them), and the host lists F3's capability, the set served is the record's with `question: 'engine'`. Nothing is written back: D1 stores a set once, and the stored `maws` goes on meaning `ask` for every launch that finds no sheet, until C7 retires the value. A record this build cannot read, or one read as `busy`, leaves the stored tool, logged: MAWS could deliver nothing from it either. A fork resumes under a new session id and an empty sheet, so it is never overridden. Known residue: a session whose conversation was sent `ask` keeps it in its requests after a launch that does not list it, and a call of it is answered by the engine's own "No such tool available" (the tool choice's P2). That takes a session that held `ask` in MAWS and then asked through the sheet in a terminal; it is logged, not built around.
- **F6 · A sheet launch's supplement is a new text, supplement 5**, chosen where 3 and 4 are (§R has it word for word). It names sminos's tool "where it is listed" and the built-in otherwise, because MAWS cannot know whether the session's sminos registered the tool (not installed, older, hooks off), and supplement 4's sentence that sminos's tool "is not available here" would be false in every session this child serves. A session recorded under supplement 4 and resumed as a sheet launch has its prompt rendered anew by `decideFlags`' existing rule.
- **F7 · Two sentences of the app say what "Default" is, and they change** (§R). They are this child's until the owner reads them; they go to the owner through the composite's writer.

**sminos (M1), a second pull request in doperpowers; the published set does not move.**

- **F8 · In a MAWS-run session the tool's result route and prompt route carry its notices and its contexts, and never an envelope.** That settles two things at once. An ended subagent's open questions are told to the main conversation on its next route (the composite's Acceptance 18), which today's code queues and never sends there. And the item C2 left for this child: a call's late outcome, told as a notice after three unanswered settles, now reaches the main conversation in a MAWS-run session as it does in a terminal one. What stays as doperpowers' TECH-DEBT row 54, in both kinds of session, is its other half: a subagent caller's late outcome is told to the main conversation and not to the subagent. Lost: MAWS carrying a notice in its steer. A notice quotes a question's words, which a user-role message may not hold.
- **F9 · The words of a subagent's question reach the main conversation as the tool's context on the message that answers it.** On a prompt that carries a `<sheet-delivery>` block, in a MAWS-run session, the tool asks the reader's model for the block's keys (`sminos sheet show --json --keys`), and for each answered outcome still pending whose asker is a subagent adds one line: the id, the revision, the asker, the question and its option labels in order (§S). The main conversation's own questions get nothing: the model holds them in its own calls, and after a compaction or a resume §5.5's context, which C2 built and which lists every open question and every outcome accepted and not yet delivered, has given them back before any steer arrives. The lines are composed in the mod, from the published `show` output, so neither the step, the command nor the set changes. Adding context for every answered question was weighed and lost: it would make the agent's naming of an option independent of §5.5, at the price of every answer carrying its question twice.
- **F10 · Nothing of the set changes.** The steer's form as published has no line for an outcome owed across a stop and no image line (the image's path is in the block). This child composes exactly that. Both are listed for the composite's writer as held for the set's next version, and neither is needed by C5's Acceptance.

**Delivery.**

- **F11 · The deliverer runs on the spine and is driven by the record.** It sends what `pending` holds for the main conversation and never anything because of a line it appended: the app's Send, the page's, `sminos sheet answer` and a line that arrives twice are one case to it. The reader and the door are on the spine (C3's S3; X5: this child adds no reader), and a record changes for reasons no window knows. Lost: the host reading records itself, which is a second instance of the reader in a process built to stay small.
- **F12 · The host owns what was sent: a flight is tied to its keys by a journal row written before the frame is.** The row `sheet_flight` names the message's uuid and the keys (§U). Journaled first, the tie exists for every message the engine could have received, including one whose write the host never saw complete; a tie journaled with the write, as `ask`'s is, can be missing exactly then, and the next host would send again. A flight whose write was refused before the pipe is voided by a row; one whose fate nobody knows stays flying until the engine speaks of it or the launch ends.
- **F13 · A flight is read when the engine's `command_lifecycle` for its message says `started` or `completed`.** That is the engine taking the message into a turn, the rule `UnsettledFold` and the owner channel's follower already hold, and it is not the write: a message written and then cancelled, discarded or refused never starts. Lost: the engine's replay of the user frame, which is nearer to "the model's request holds it" but is told to no reader for an echo and, for several messages the engine joined, comes under one uuid. Stated limit: another plugin's prompt hook that drops a message the engine has started leaves it read here though the model never saw it; that holds for every message MAWS sends, and the tool's own hook drops nothing.
- **F14 · The host refuses to send a key that is flying or read.** `session.sheetSteer` and `session.sheetRide` check the session's flights and journal the tie in one synchronous step. That check is the linearization point of "one delivery": the deliverer may be wrong about what is in flight (it learns of it late, and its events can be lost), and the host is not.
- **F15 · One composer, held to the published bytes** (§T): `src/shared/sheet/steer.ts` composes the steer from the model's `pending`, packs it as C2's I7 packs an envelope (batches whole, those that wake first, 60,000 UTF-16 code units, 200 keys, `More follows.`), and a test composes `examples/terminal/input/` and compares with `steer.txt` byte for byte. A subagent's question is named by its agent id and always as "which has ended": the record does not say whether a subagent whose send failed still runs, the published example was composed with none running, and the case where it does run needs a send the engine refused. An image travels as its absolute path in the block.
- **F16 · An answer wakes; a dismissal rides; an answer whose steer a Stop withdrew rides.** A waking answer gets a steer at once, which carries everything else owed with it. What rides leaves as the last block of the person's next message to the session, or with the next steer. The third case is what keeps Stop meaning stop: a steer written to an idle engine starts a turn, so sending the answer again right after the person stopped the session would start one behind their back. It is the tool's own third route (§5.2: context on the human's next prompt after a turn the human stopped), and the side sheet keeps reading "Accepted. Not delivered yet." meanwhile.
- **F17 · A rider is appended where every user frame is written**, in the `write` the session hands its queue, to a frame the queue marks as the person's (a submission, the person's own steer, a promotion). One place covers the three, the queue entry keeps the person's content untouched (as a linked read's block does), and the rider's tie is journaled as a steer's is.
- **F18 · A sheet steer is the host's own kind of steer in the queue.** It is not published among the pending steers a window shows, "Hold until the turn ends" does not apply to it, and a Stop withdraws it from the engine and drops it (the queue's `cancel`) where it holds a person's steer. Held into the app queue it would be sent later as an ordinary message under a new uuid while its keys, unread, were sent again: two deliveries. `ask`'s steer is untouched.
- **F19 · The acknowledgement is one `delivered` line per flight, keyed by the flight**: `maws-delivered-<message uuid>`, `by: 'maws'`, through the door. The key makes a resend the same act (after a timeout, a restart of the spine), and the model's `sent` showing that key is how the deliverer knows it has acknowledged. The tool takes the keys out of `pending`; a session with no process applies the line at its next start, before anything else.
- **F20 · A released session is brought up for an answer, once per answer.** When the record of a session the digest marks released shows a queued answer that no queued retract cancels, or a pending answer that wakes, the deliverer calls `SessionService.acquire(appSessionId, 'resume')` and sends nothing; the tool drains at its start, and the steer follows from the record like any other. A queued dismissal alone brings nothing up. A session the person stopped, one that crashed, and one a terminal held last are not released and are not started: their answers go at their next start, as a stopped terminal session's do (the composite's §10). Each key is tried once per run of the spine, so a session that comes up without taking the sheet (sminos gone) is not started in a loop. Delivery happens while `mawsd`'s services are loaded, and the released mark is theirs to hold: an answer given while they are not loaded, or after the mark was lost with them, is delivered at the session's next start.
- **F21 · After a gap in the replay, a flying flight is settled from the engine's transcript.** At a `host_attach` whose replay had a gap, the session reads the transcript it reseeds from; a flight whose uuid that transcript holds (a user record's, or a queued command's `source_uuid`) is journaled as seen (`sheet_flight_seen`) and is read. The fold stays a reading of the journal alone.
- **F22 · Nothing of the sheet is in what a process exit would lose.** `SessionMaws.pending` is not touched; a test pins that a session with open sheet questions, a rider offered and a flight flying reads zero from it. A flight flying when its process ends is unread and is sent again, so counting it would only delay a release.

**What draws, and what else reads.**

- **F23 · MAWS's steer is the fourth carrier of a sheet's envelope, read by its form.** A text block of a person's row that is, whole, one envelope in the steer form, and a slice of a joined text that is one, is the sheet's: it is taken out of the person's words (`readPersonsContent`) and becomes the `sheet` arrival C3's rows already read. It is read by form on all three routes (live, a file's rows, another machine's rows), as MAWS's `ask` envelope is, so a session read from the engine's transcript alone draws the same. That reading draws and nothing else: no state moves on a prompt's text (the composite's §5.4), and a person who types an envelope sees a receipt drawn on a row and no more. Lost: marking the event from the journal's tie, which is exact and exists on one route of three.
- **F24 · A MAWS-run session's sheet item is announced as an asynchronous `ask`'s is**: once per call (C3's S11), in the app while it is focused and by a system notification while it is not. A terminal session's stays in-app only. The test is the record's holder (`self`), read where the notifier reads the record.
- **F25 · The channel journal takes a sheet question from the live call and its outcome from the record.** The question is what a MAWS process said (the rule of every lane B entry): at the live result of a sheet call, each entry the result's first line says was added becomes one `question` entry, with its options' labels as choices. The outcome is the record's, because the call's history does not hold it: a running subagent is answered directly, and a withdrawal and an answer accepted at a start reach no steer. When a recorded question is pending or closed in the model, one `answered` entry is recorded: the answer, "Dismissed" or "Withdrawn". A revise records nothing new: one question, one outcome. The renderer's join learns the anchor's form.
- **F26 · A session set to `maws` is proven unchanged by the suites that hold it today**, named in M3 and M8, and by one new pin: its launch environment holds neither variable.
- **F27 · The engine is asked before MAWS is built on its answer.** M2 runs MAWS's own launch line with sminos loaded and settles the four things only the engine can say (§S, "What the probe must show"); its recordings are the fixtures the later milestones replay. What needs a model that reads (the agent naming the option it was sent by place) is asserted by M8's script on a real model under a cap, and nothing else in this child spends.

## The delivery's state machine

Fixed here before any of it is built, because it is one state machine across four processes (the tool, the door, the spine, the host), and a functional description alone is how such things get built one flag at a time.

### Who acts, and on what

| actor | where | what it changes |
|---|---|---|
| the tool | sminos's mod and step, inside the session | `state.json`: applies inbox lines, moves a recipient, takes acknowledged keys out of `pending` |
| a surface | the app, the page, `sminos sheet` | appends answer, dismiss and retract lines through the door |
| the deliverer | the spine | asks the host to send; appends `delivered` lines through the door; asks the session service to bring a released session up |
| the host | the engine host's session | writes the frame; journals the tie and reads how it ended; holds one offered rider per session in memory |
| the engine | the pinned binary | starts, drops or never receives a message |

### An outcome, as the deliverer sees it

An outcome is MAWS's when the model lists it in `pending` with recipient `main`. For each such key the host's flights give one of four states, and the deliverer does one thing per state:

| the key's latest flight | name | what the deliverer does |
|---|---|---|
| none, or unread for a reason other than a Stop | **owed, wakes** if an answer; **owed, rides** if a dismissal | a waking key: send a steer now, carrying everything owed. Riders alone: offer them as the session's rider |
| unread, withdrawn at a Stop | **owed, rides** | offer as the rider |
| flying | **in flight** | nothing |
| read | **read** | append the acknowledgement unless the model's `sent` already shows its key; nothing else, ever |

A key leaves the table when the model no longer lists it in `pending`.

### A flight, as the journal says it

Rows are read in order; a flight leaves `flying` once and never moves again. `U` is the flight's message uuid.

| row | while | the flight becomes |
|---|---|---|
| `meta` `sheet_flight` naming `U` | no flight `U` | flying |
| `in` `command_lifecycle`, `command_uuid` `U`, state `started` or `completed` | flying | **read** |
| `meta` `sheet_flight_seen` naming `U` (F21) | flying | **read** |
| `meta` `queue`, action `withdraw`, naming `U` | flying | flying, being withdrawn |
| `in` `command_lifecycle` for `U`, state `cancelled`, `discarded` or `refused` | flying, not being withdrawn | **unread**, dropped |
| the same | flying, being withdrawn | flying, being withdrawn, dropped (the queue's own row decides) |
| `meta` `queue`, action `cancel` or `hold`, naming `U` | flying | **unread**, stopped |
| `meta` `queue`, action `giveback`, naming `U` | being withdrawn, dropped | **unread**, dropped |
| the same | being withdrawn, not dropped | flying |
| `meta` `queue`, action `abandon` or `revert`, naming `U` | flying | **unread**, ended |
| `meta` `sheet_flight_void` naming `U` | flying | **unread**, void |
| the launch's `exit` row, or the launch's rows ending where a later launch begins | flying | **unread**, ended |

`cancel` and `hold` are written only when the host itself withdrew the message, which for a sheet steer is a Stop (F18) and for a person's steer that carried a rider is a Stop or the person's own hold; both are "stopped". Every other unread reason leaves an answer waking.

### Where a fact becomes true

- **An outcome exists** when the tool's step replaces `state.json` with it in `pending`. Nothing before that (a line appended, a door's `queued`) is acted on.
- **A key is being sent** when the host journals `sheet_flight`, in the same synchronous step as its check that the key is neither flying nor read (F14). The frame is handed to the writer after it.
- **A key is delivered** when the journal holds the lifecycle row of F13 for its flight.
- **The record knows** when the tool's step applies the `delivered` line.

### What each failure leaves

| what happens | what the journal and the record hold | what follows |
|---|---|---|
| a second answer to the same question | the tool's verdict `closed`; nothing new in `pending` | nothing is sent for it |
| a retract before the answer was applied | nothing in `pending` | nothing is sent |
| a retract after | verdict `too-late`; the outcome stays | it is sent like any other |
| the same line sent twice | the first verdict again; one outcome | one flight |
| the steer waits and the person presses Stop | `withdraw`, the engine's `cancelled`, `cancel`: unread, stopped | the keys ride the person's next message |
| the engine discards or refuses the steer | unread, dropped | a new steer |
| the engine process ends with the steer waiting | `abandon`, or the launch's end: unread, ended | a released session is brought up for it (F20); any other session sends at its next start |
| the host is replaced after the write, before `started` | the tie and the `out` row; the adopter replays `started` | read; the acknowledgement follows; nothing is sent again |
| the host is replaced during the write | the tie; perhaps no `out` row | flying until the engine speaks of `U` or the launch ends; never a second message while flying |
| the spine restarts after `started`, before the acknowledgement | read, in the journal; the key still in `pending` | the deliverer asks the host, appends the acknowledgement, sends nothing |
| the acknowledgement's door call times out | perhaps a `delivered` line, perhaps not | the same line again under the same key |
| a session resumed in a terminal with a key read and not yet acknowledged | the terminal's tool finds it pending | it may be told again there; a window of one acknowledgement, accepted as §6 accepts its like |

## Interfaces and Dependencies

`R/` is `src/renderer/src/`; `H/` is `sminos/hooks/mods/` and `S/` is `sminos/skills/sminos/scripts/` in doperpowers. Sections continue C4's letters (§X is skipped, since X1 to X7 are the composite's contracts). A milestone's name in a heading is where the interface is built. Code is given where it is itself the decision.

### §R · The launch (M3)

`src/shared/host/socket-protocol.ts`:

    export const ENGINE_QUESTION_SHEET_CAPABILITY = 'engine.questionSheet';   // in PEER_CAPABILITIES.engineHost; src/engine-host/detached.test.ts pins the welcome word for word

`src/engine-host/launch.ts`:

    export const QUESTION_SHEET_ENV = 'MAWS_QUESTION_SHEET';
    export function buildEnvironment(spec, captured, relayUrl, spawnerPid, holder, sessionId: SessionId): Record<string, string>

`buildLaunch` passes the id it resolved. `env[QUESTION_SHEET_ENV] = sessionId` exactly when `(spec.mawsTools ?? FULL_MAWS_TOOL_SET).question === 'engine'`; no other launch has the key, whatever the captured environment holds. An adopter's rebuilt plan (`environmentRebuilt`) is not the engine's environment and nothing reads the variable from it: what an adopter knows of a launch is its spawn row's `mawsTools`.

`src/services/sessions/launch-mapping.ts`:

    export const SMINOS_HOME_ENV = 'SMINOS_HOME';
    LaunchInput: sminosHome?: string                                   // the home MAWS's reader reads; written only for a sheet launch
    intentLaunchSpec / resumeLaunchSpec ctx: sminosHome?: string | null

`extraSettingsOf` adds `SMINOS_HOME` to the settings' `env`, beside `CUA_BROWSER_BACKENDS`, when `input.mawsTools?.question === 'engine'` and `input.sminosHome` is set. The three callers that build a spec for a turn (`runIntentSetup`, `runResume`, `prestartLaunch`) pass it through the same builders, so a prestart's spec and its Send's are equal under `sameLaunchSpec`; a test builds both for one Default intent and compares them.

`src/services/sessions/context.ts`, on `Setup`:

    sheet: { home(): Promise<string | null>; holds(engineSessionId: SessionId): Promise<boolean> } | null   // null: no sheet service this run

wired in `src/services/spine-root.ts` from the same `home` promise `createSheetService` is given (a rejection is null) and from `SheetService.read` through `sheetHolds`.

`src/shared/sheet/read.ts`:

    export function sheetHolds(model: SheetModel | null): boolean   // an open or hidden question, a pending outcome, or a `sent` entry of state `queued`

`src/services/sessions/served-set.ts`:

    export async function sheetOverride(s: Pick<Setup, 'hostLists' | 'sheet' | 'log'>, set: MawsToolSet, engineSessionId: SessionId | null): Promise<MawsToolSet>

F5's rule: `{ ...set, question: 'engine' }` when the set's question is `maws`, the engine session is named, the host lists `ENGINE_QUESTION_SHEET_CAPABILITY` and `s.sheet.holds` answers true; else the set as given. `runResume` calls it on the record's set before `servedSet`. `runIntentSetup` and `prestartLaunch` do not: a new session and a fork have no sheet.

`src/services/owner/launch.ts` and `src/shared/owner/contract.ts` (X18, amended): the decision's `question` gains a third value, `sheet`, taken when the spec's question tool is `engine` and the host lists the capability; `APPENDS['external-style-plus-supplement'].sheet = { text: 'supplement-sheet', records: 'supplement:5' }`; `AppendedText` gains `'supplement-sheet'`. The text, exact and pinned by a test word for word:

    SUPPLEMENT_5.text = `${SUPPLEMENT_HEADER(5)}\n\nThis session runs in MAWS. ${ASK_SHEET}`
    ASK_SHEET = 'Ask the human with `mcp__sminos__AskUserQuestion` where it is listed: it puts your questions on this session\'s sheet and returns at once, and their answers arrive later as a user message that names each question by its id and each picked option by its place among the options you gave. Where it is not listed, ask with the native AskUserQuestion, which waits for their answer. `mcp__doperpowers__AskUserQuestion` is not available here.'

Supplement 4 stays, for a Default launch on a host without the capability.

**The two sentences** (F7), each replacing the one that says "Claude Code's own":

| constant | file | becomes |
|---|---|---|
| `TOOLS_MENU.questionFacts.engine` | `R/composer/copy.ts` | "The question sheet, or Claude Code's own" |
| `MAWS_TOOLS.questionNotes.default.note` | `R/settings-tab/copy.ts` | "Default is the question sheet where sminos is installed: the session goes on working while you answer. Without it, Claude Code's own, which waits. A session keeps its own." |

**The records of the change.** One dated entry in the charter's Decision Log (`docs/charter.md`, §19) for supplement 5 and for what D6's `engine` now does; the tool choice plan's "What ticket 600 changes" rewritten to what was built.

### §S · sminos's two additions (M1), and what the probe must show (M2)

`H/sheet.tsx`, for a session whose runner is `maws` (`isTerminal()` false):

- `take(gen, route)` returns the notices waiting and the context owed, each an entry of its own, and no flight. `putBack` returns what the entered prompt did not carry, as for a terminal session.
- `withResultRoute` no longer returns early for the runner: a main-loop call's result carries what `take` gives, under every other condition it has today (the generation it was dispatched in, the engine's own tool, not denied, not aborted).
- The `prompt.submit` hook, beside what `take` gives, adds F9's context when the prompt's text holds a block: `keysIn([e.text])`, then `sminos sheet show --session <id> --json --keys <k,…>` in calls of at most fifty keys (the command's bound), each under `STEP_TIMEOUT_MS`. A `show` that fails or times out adds nothing and is logged; the prompt is never dropped or held for it beyond that bound.

`H/sheet-model.tsx` (pure, tested without an engine):

    export function steerContext(pending: readonly ShownOutcome[]): string | undefined   // undefined: no answered outcome of a subagent's question among them

The text, in §5.5's own line form (C2's I10, as built):

    [sheet v1] This message answers questions a subagent put on your sheet. What each asked:
    q12 (revision 1), asked by the subagent reviewer (a1b2c3) "Migration" — "Ship the migration today?" Options: 1. Yes; 2. No.
    q14 (revision 2), asked by the subagent reviewer (a1b2c3) — "Which region first?" No options: answered in text.

One line per pending outcome of kind `answer` whose snapshot's asker is a subagent, by the id's number; the header, when there is one, as a JSON string after the asker; the question as a JSON string. It has the envelope's budget (60,000 UTF-16 code units): when the whole would pass it, each question is cut at 300 characters and each label at 80, and past that the list stops with `and N more.` A dismissed question gets no line, as the terminal envelope gives it none.

Tests join `sminos/tests/mods/` on the suite's fake port: a notice queued in a MAWS-run generation leaves on a prompt and on a result, once, and returns to the queue when the prompt entered without it; no envelope and no flight is ever made there; the context's text for one, several and no subagent outcomes, at the budget, and with a `show` that fails. The plugin's version rises as the repository's `version-bump` gate requires. `docs/doperpowers/TECH-DEBT.md` row 54 loses its sentence about C5 and keeps the rest.

**What the probe must show** (M2; P6 to P10 continue C0's P1 to P5). Scenario `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, built on `p1-common.mjs` as `qsheet-c0.mjs` is: MAWS's launch line and initialize, a scratch configuration home, a scratch sminos home, the scripted Messages API stand-in (`stub-api.mjs`), the direct tell's mod and the doperpowers checkout's sminos both by `--plugin-dir`, function hooks on. Fixtures `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-*.jsonl`; findings `spikes/protocol-probe/findings-qsheet-c5.txt`; tests in `spikes/protocol-probe/fixtures.test.mjs` under "question sheet C5".

| id | question | fixture | what decides |
|---|---|---|---|
| P6 | Does `SMINOS_HOME` given in `--settings`' `env` reach the mod's `$.env.get` and the processes it starts (the step, the bridge), from the process's first `session.start`? | `qsheet-c5-launch` | Yes: F4 stands. No: F4 is rewritten to a spec field `sminosHome` that `buildEnvironment` sets, before M3 starts |
| P7 | With `MAWS_QUESTION_SHEET` equal to the session's id in the process environment, on a new session, a resume and a fork: does `system/init` list sminos's tool, does the model's request hold its sheet schema and not the built-in, with both plugin directories loaded? | `qsheet-c5-launch`, `-resume`, `-fork` | Yes: F2 stands. No: the milestone stops and the finding goes to the composite's writer, since C2's proof would not hold on MAWS's launch |
| P8 | A resume whose record holds an open question and a queued answer: is the answer applied at the start with no prompt written, recipient `main`, and does the first request after the host's first message hold §5.5's context once? | `qsheet-c5-resume` | F20's sequence. A start that needs a prompt before it drains would change F20 to send after the first prompt |
| P9 | A steer in §T's form, idle, during a tool call, and during a tool call then withdrawn with `cancel_async_message`: which lifecycle rows, and what the model's requests hold. With M1's branch: the context on a steer that answers an ended subagent's question, the ended subagent's notice on the next route, and whether the mod's prompt hook sees the engine's own notification prompt | `qsheet-c5-steer`, `-cancelled`, `-subagent` | §U's table, row for row. A row the fixture contradicts is corrected in the table before M4 |
| P10 | A `delivered` line put through the door while the session runs: is it applied through the observing bridge's `sheet` op, does the key leave `pending`, and does a steer's own text land nothing? | `qsheet-c5-delivered` | F19 |

The recordings are also what M5 to M7 replay, so each fixture's host-written frames are composed as §T says, by hand in the scenario; M4's composer is then held to the same bytes.

### §T · The steer's form: X3 in MAWS (M4)

`src/shared/sheet/steer.ts`, pure:

    export const STEER_LIMITS = { units: 60_000, keys: 200 } as const;
    export interface Steer { text: string; keys: string[]; more: boolean }
    export function composeSteer(owed: readonly SheetOutcome[], record: string, wakes: (outcome: SheetOutcome) => boolean): Steer | null   // null: nothing owed
    export function isSteerEnvelope(text: string): boolean                                   // whole, one envelope of this form

`record` is the record's absolute directory (`<home>/sheet/<session>`), which names texts and images. The form, line by line; `<json>` is the value as a JSON string (`JSON.stringify`), and nothing else of a line is variable:

    [sheet v1] The human answered questions on your sheet.                        head; " More follows." appended when `more`
    [sheet v1] The human dismissed questions on your sheet; no answer will come for them.     the head when the envelope answers nothing
    q7 → option 1, option 2. Their text: <json>                                    an answer with picks and text
    q7 → option 1.                                                                 picks alone
    q8 → their text: <json>                                                        text alone
    q8 → their text, 20,000 characters, is in <absolute path> and begins: <json>   a text carried by its file: its first 500 characters and "…"; the count with thousands separators
    q7 → option 1. Their text, 20,000 characters, is in <absolute path> and begins: <json>     the same with picks
    q12 (asked by the subagent a1b2c3, which has ended) → option 1.                a subagent's question: the agent's id, after the question's id
    Dismissed: q9, q11.                                                            one line, when any
    <sheet-delivery>{…}</sheet-delivery>                                           the block, last, one line

Answers stand by the id's number, then the dismissed line, then the block. The block is the terminal envelope's own (C2's I7): compact JSON, keys in the order `v`, `keys`, `answered`, `dismissed`, `more`; `keys` the answered outcomes' in order, then the dismissed ones'; each answered entry `id`, `revision`, `picks` (the outcome's `places`), `text` (its first 500 characters), `textCut` when the text is longer, `textFile` as an absolute path when the outcome has one, `images` as absolute paths; `<`, `>`, `&`, U+2028 and U+2029 written as `\u` escapes. Lengths count code points (`src/shared/sheet/text.ts`); the budget counts UTF-16 code units.

Packing is I7's, rule for rule: outcomes group by `batch` (one without is a group alone); groups holding an outcome for which `wakes` answers true come first, each run in the order accepted; groups join whole while the text stays within both limits; if not even the first fits, its longest texts that have a file are carried by head and file, longest first, until it does, and then no second group joins; if it still does not, that group's outcomes in order while they fit. `more` is true when anything owed is left out. One outcome always fits alone.

Tests: `examples/terminal/input/` composed with every outcome waking equals `steer.txt` byte for byte (with `{HOME}` as the record's home); the pin's `more` record gives 200 keys, `More follows.` and `"more": true`, as its terminal envelope does; its `long` and `split` records give envelopes within both limits, and composing again from what each leaves (the keys it carried taken out) carries the rest, nothing twice and nothing never (the steer's prose is shorter than the terminal's, so where a packing ends may differ from the published terminal envelopes, and is not compared with them); for every record of the pin, the prose above the block holds no question, header, label or subagent's name of that record; a snapshot whose asker is a subagent; `parseSheetDeliveries` reads every composed text back to the keys it was given.

### §U · Flights (the fold M4; the rows M5)

`src/shared/sheet/flight.ts` (the shape the wire, the host and the spine share):

    export type SheetFlightState = 'flying' | 'read' | 'unread';
    export interface SheetFlight { messageUuid: string; keys: string[]; carrier: 'steer' | 'rider'; state: SheetFlightState; why?: 'dropped' | 'stopped' | 'ended' | 'void' }   // `why` with unread
    export const ackKeyOf = (messageUuid: string): string => `maws-delivered-${messageUuid}`;

`src/engine-host/sheet-flights.ts` (pure but for the journal read in the last function):

    export class SheetFlights {
      push(row: JournalRow): void;              // the table of "A flight, as the journal says it", and nothing else
      ended(): void;                            // this launch is over: what is flying is unread, ended
      holds(keys: readonly string[]): string[]; // those of `keys` that are flying or read
      of(keys: readonly string[]): SheetFlight[];   // each key's latest flight, newest first; a key in none is in no entry
    }
    export async function sheetFlightsOf(dir: string, appSessionId: AppSessionId, keys: readonly string[], live: SheetFlights | null): Promise<SheetFlight[]>

The rows, all `meta`, journaled through the session's `record`:

    { event: 'sheet_flight', messageUuid, keys: string[], carrier: 'steer' | 'rider' }    // before the frame is written (F12)
    { event: 'sheet_flight_void', messageUuid }                                           // the writer refused the frame before the pipe
    { event: 'sheet_flight_seen', messageUuid }                                           // the engine's transcript holds it, after a gap (F21)

The normaliser's `pushMeta` ignores an event it does not know, the replay skips meta rows, and the backfill reads no journal, so the rows need no wire event and no older reader breaks on them. `sheetFlightsOf` answers for the keys asked: from the live fold first, then from the session's earlier launches newest first (`JournalReader.launches`, each folded through a fresh `SheetFlights` and ended, since a launch that is not the live process's is over), stopping once every key has a flight or the launches end. A key's latest flight is the first found.

Tests are the table, row by row, each as a journal of a few rows; the fixtures of M2 (`-steer`, `-cancelled`) folded to read and to unread, stopped; a journal with `host_detach` and `host_attach` whose replayed `started` arrives after the attach; a launch that ends with a flight flying; two launches, the key's flight in the older.

### §V · The host: two ways a delivery is written, and the question of what was (M5)

`src/shared/ipc/` (`names/session.ts`, `schema/session.ts` as a group `SHEET_SESSION_COMMANDS`, `grades/session.ts`), owner `engine-host`:

    session.sheetSteer   { appSessionId, text, keys }                 → { status: 'written'; messageUuid } | { status: 'refused'; reason: 'not_ready' | 'not_sheet' | 'in_flight' | 'not_written'; keys?: string[] }
    session.sheetRide    { appSessionId, rider: { text, keys } | null } → { status: 'held' } | { status: 'refused'; reason: 'not_sheet' | 'in_flight'; keys?: string[] }
    session.sheetFlights { appSessionId, keys }                       → { flights: SheetFlight[]; process: 'live' | 'none' }

`text` is at most 60,000 UTF-16 code units and must hold for `isSteerEnvelope`; `keys` is 1 to 200 keys of the inbox line's pattern, and equals the keys of the text's block (the handler parses the block and refuses a mismatch as a schema error: the tie must name what the text carries). All three are deadline shape `immediate`. No remote caller reaches them: they join neither `src/endpoint/offers.ts` nor `ENGINE_HOST_ACTS` in `src/main/lane-b/remote.ts`, and a test over the offer table says so. The deliverer runs on the session's own machine; what C6 carries is reading a sheet and appending to it.

What each does, in `src/engine-host/session.ts` (handlers in `ipc.ts`):

- **`sheetSteer`.** Refused `not_sheet` when the launch's set does not have `question: 'engine'` (the plan's, or for an adopted session its spawn row's). Refused `not_ready` when the process is not `ready`. Refused `in_flight`, naming them, when `SheetFlights.holds(keys)` is not empty. Otherwise `MessageQueue.steer(text, { priority: 'next', host: true, before })`, whose `before(messageUuid)` journals `sheet_flight` with carrier `steer`. A write the writer refused before the pipe journals `sheet_flight_void` and answers `not_written`; any other rejection answers `not_written` and journals nothing more, so the flight stays flying (which rejections are the first kind is read in `outbound-writer.ts`: a frame refused while the writer is frozen never left the host; one failed at a detach's deadline may have).
- **`sheetRide`.** Holds the rider in the session's memory, replacing the one held; `null` clears it. Refused as `sheetSteer` is, but never for readiness: a rider waits. The session appends the rider it holds, as one more text block after everything else, to the next user frame the queue marks as the person's, journals `sheet_flight` with carrier `rider` for that frame's uuid before it is written, and forgets the rider. A rider whose keys are flying or read by then is dropped instead (the deliverer offers again from what it next reads).
- **`sheetFlights`.** `sheetFlightsOf` for the session's journal directory, with the live fold when the session has a process.

`src/engine-host/queue.ts`:

    steer(content, opts?: { priority?: SteerPriority; preface?: Record<string, unknown>[]; before?: (messageUuid: MessageUuid) => void; host?: true }): Promise<{ messageUuid: MessageUuid }>
    MessageQueueDeps.write(frame, opts?: { preface?: Record<string, unknown>[]; person?: true }): Promise<void>

`before` runs after the readiness check and before the write; if it throws, the steer rejects and nothing is written. A steer with `host` is kept apart from the pending steers the queue publishes: it is in no `QueueState.steers`, `hold` and `cancelSteer` refuse its uuid as they refuse one that already started, and a Stop's withdrawal phase (`holdAll`) asks the engine to cancel it and, when the engine did, journals `cancel` and drops it; `settleAfterExit` abandons it with the rest. An adopter learns the host steers still waiting from the fold's flying flights of carrier `steer`. `person: true` is passed by the three paths that write the person's own words (`submit`, the `session.steer` command's steer, `promote`) and by nothing else: `ask`'s steer, the plan sequence's frames and a sheet steer take no rider.

`EngineSession`: the fold is fed by `record` (every row, live) and by `fold()` at an adoption, before the session connects or answers a command; `ended()` at the process's exit; and at a `host_attach` whose `replayed` is `gap`, F21.

Capability: the deliverer does not call a host that does not list `engine.questionSheet`. M3 adds the capability with the variable and this section arrives in M5; M3 to M8 land as one pull request, so no host that is ever released lists it without these commands.

### §W · The deliverer, and the acknowledgement (M6)

`src/services/sheet/service.ts`, on `SheetService`:

    acknowledge(session: string, flight: { messageUuid: string; keys: string[] }): Promise<SheetPutResult>

One inbox line through the door, `{ v: 1, key: ackKeyOf(messageUuid), kind: 'delivered', keys, by: 'maws' }`, for a session that has a record; the same refusals and the same locate rule as `put`. `put` goes on refusing a `delivered` line from any caller: only this method writes one, and nothing on the wire reaches it. `src/shared/sheet/model.ts` gains the line's schema (`SheetDeliveredLineSchema`), and `putLines` (`door.ts`) takes it. The stand-in door (`test/support/fake-sminos-cli.mjs`) appends it like any line; a staged outcome that follows it is the fixture `delivered-mixed`'s.

`src/services/sheet/delivery.ts`:

    export interface SheetDeliveryDeps {
      sheet: Pick<SheetService, 'list' | 'read' | 'onChange' | 'acknowledge'>;
      home: Promise<string>;
      host: { lists(capability: string): Promise<boolean>; dispatch: HostDispatch; onEvent: HostEvents; onLink(listener: () => void): () => void };
      sessions: { record(appSessionId: AppSessionId): SessionRecord | null; digest(appSessionId: AppSessionId): SessionDigest | null; onDigest(listener: (appSessionId: AppSessionId) => void): () => void;
                  acquire(appSessionId: AppSessionId, reason: 'resume'): Promise<AcquireOutcome> };
      log(line: string): void;
    }
    export function startSheetDelivery(deps: SheetDeliveryDeps): { stop(): void; idle(): Promise<void> /* the tests' wait: no pass running or owed */ }

Started in `startSpine` (`src/services/spine-root.ts`) where the sheet service is, when there is one, and wired there: `host.lists` is the capability read the session service uses (`hostLists`), `dispatch` and `onEvent` are `SpineHosts`', `onLink` is `hosts.onStreaming('engine-host', …)` (how the owner channel's follower learns of a reconnect, `src/services/owner/register.ts`), a record is the index's (`index.sessions.get`), a digest the session read model's (`SessionReadModel`, `src/services/sessions/index.ts`), and `acquire` is `SessionService.acquire`. It keeps nothing on disk.

**One pass, for one record** (a session's passes never overlap; a trigger during a pass owes one more):

1. Read the model. No record, an unreadable one, or no app session for it: stop. `mine` is `pending` with recipient `main`.
2. Whose the session is now. Holder `self`: it is MAWS's and live. Holder `none` with the digest's released mark: it is MAWS's and released. Anything else, stop: a terminal's or a job's session is delivered by the tool there, and one that is neither held nor released gets what it is owed at its next start. Nothing below is asked of the host for such a session, so a record MAWS has no part in never wakes it.
3. With something in `mine`, ask `session.sheetFlights` for its keys. For each flight read: unless the model's `sent` has an entry keyed `ackKeyOf(messageUuid)`, `acknowledge` it; a `busy` or `failed` answer is tried again at the next trigger, under the same key.
4. `owed` is `mine` less the keys flying and read. `wakes(o)` is: an answer whose latest flight, if any, is not unread for `stopped`.
5. Live, and the process ready: if any of `owed` wakes, `composeSteer(owed, …)` and `session.sheetSteer`; `written` ends the pass (the next trigger finds it flying), `in_flight` reads the flights again, `not_ready` waits for the status, `not_sheet` ends this session's passes until its next launch. Else, `session.sheetRide` with `composeSteer(owed, …)` or null, sent only when it differs from the rider last accepted for this launch.
6. Released: if the model has a queued answer that no queued retract cancels, or `owed` holds one that wakes, and none of those keys was tried in this run, `acquire(appSessionId, 'resume')`. Its outcome is logged; a pass follows from the status and the record like any other.

**Triggers.** `SheetService.onChange` for the record; `session.status` for its app session; `session.eventBatch` for an app session with a flight flying, when the batch holds a `command.lifecycle` or a `queue.transition`; the digest's `released` appearing; the host's link coming up, and the start, for every record `list` shows with something pending or queued. An event is only a reason to look: every fact a pass acts on is read from the record or asked of the host in that pass.

Tests, on a fake host that keeps §U's table and the stand-in door: each row of "An outcome, as the deliverer sees it" and of "What each failure leaves"; a pass that finds a flight read and the acknowledgement already queued appends nothing; the host answering `in_flight` for a key the deliverer thought owed; an event lost (the pass at the link's return finds the flight read); two triggers in one pass make one more pass and one steer; a released session with a queued dismissal alone is not acquired; one with a queued answer is acquired once though the trigger fires three times; a session held by a terminal is never touched.

### §Y · The steer as an arrival, and the notice (M4, M7)

`src/shared/engine/sheet-carrier.ts` gains the person's row as a carrier, and `src/shared/engine/arrival.ts` reads it where it reads MAWS's `ask` envelope (`readPersonsContent`, `personsText`):

    export function steerDeliveries(content: PersonsContent): { own: PersonsContent | null; deliveries: SheetDelivery[] }

A text block that `isSteerEnvelope` holds for is the sheet's whole. Inside a longer text (messages the engine joined into one), a slice from a line that opens with `[sheet v1] ` to the first block line after it is the sheet's when that slice is one envelope; everything else is the person's and is the bubble. The deliveries travel as the `sheet` entry C3 added (`sheetEntry(sheetFactsOf(arrivals))`), on the live normaliser and the file's backfill alike, so `SheetRow` draws receipts from them with no change, the carrier draws no bubble for a sheet steer, a person's message that carried a rider draws as the person wrote it, and the turn's notice row reads as C3 worded it. The module's opening comment, which says no carrier is the person's, is corrected: this one is, by form, for drawing only (F23).

`src/main/attention/notifier.ts`: the return that keeps a sheet item in-app applies unless the item's session is held by MAWS (`view.record(appSessionId)?.holder.kind === 'self'`); the once-per-call rule is unchanged.

### §Z · The channel journal (M7)

`src/services/channel/lane-b.ts`, fed as today by live events (`seq` not null) and, new, by `SheetService`:

    LaneBDeps: sheet?: { read(session: string): Promise<SheetModel | null>; onChange(listener: SheetListener): () => void }

- **The question.** At the live `tool.result` of a call for which `isSheetCall(input)` holds, `callEntries(input, resultText)` (`src/shared/sheet/call.ts`) names the entries added; each becomes `{ kind: 'question', text: entry.question, choices: entry.options, at: the result's time }` with anchor `pathOf('sheet', engineSessionId, id)`. A revised entry, a refused one and a call whose first line is not the sentences record nothing. A subagent's call is read the same way.
- **The outcome.** At each change of a record whose app session has a question recorded here (`recorded(src)`), for each such id with no outcome recorded: an entry in the model's `pending` gives `{ kind: 'answered', text: the picked labels joined by ", " and the text, as `askAnswerOf` joins an ask's, at: acceptedAt }` for an answer and "Dismissed" for a dismissal; else `closed[id]` gives its `receipt` for `answered` (the record's own cut: the labels, or the text's first 80 characters), "Dismissed" or "Withdrawn", at `closed[id].at`. Anchor `pathOf('sheet', engineSessionId, id, 'answered')`, requiring the question's.

The engine session's id is in the anchor because an app session that was cleared starts a new sheet at `q1`. `src/renderer/src/channel/project.ts`, `questionOf`: an anchor `sheet/<engine session>/<id>/answered` joins the entry of `sheet/<engine session>/<id>`.

## The gates, by clause

The composite's Acceptance for this child, with the two sentences of its Purpose that are not in its Acceptance and the composite's Acceptance 18 as it reads for a MAWS-run session, cut into the clauses a milestone can prove.

| clause | what it says (the composite's C5 section) | proven in |
|---|---|---|
| A.a | Acceptance 7 for a MAWS-run session: it asks, nothing opens, the call's row shows one line per question, Open shows the side sheet at it | M7 (replayed), M8 (live) |
| A.b | an answer reaches the agent and the line becomes the receipt | M6 (the steer written and acknowledged, over a recording), M4 and M7 (the receipt drawn from the steer), M8 (live) |
| A.c | a released session answered from the app is resumed and receives the answer, by §5.4's sequence | M6 (the acquisition, then the steer), M8 (live) |
| A.d | the same from `sminos sheet answer` | M6 (a line the app did not send), M8 (live) |
| A.e | with a second competing answer, a retract and a resent line in the inbox, each ends in one delivery of the applied outcome and none of a refused one | M6 (on the pin's `two-surfaces`, `retract-queued`, `retract-too-late` and `resent-key` fixtures), M8 (live, counted in the model's requests) |
| A.f | a steer cancelled before the model read it ends in exactly one delivery | M2 (the engine's rows), M4 (the fold), M5 (the Stop's withdrawal), M6 (the rider), M8 (live) |
| A.g | a host handover between a steer and its acknowledgement ends in exactly one delivery | M4 (the fold across `host_attach`), M5 (`e2e:supervisor-daemon`: the adopter refuses the key and reads `started`), M6 (the acknowledgement after the link returns) |
| A.h | a terminal session answered while stopped and then resumed in MAWS, its stored question tool `maws`, is launched with the sheet and receives the answer | M3 (the override, the launch), M8 (live) |
| A.i | Acceptance 8 in a MAWS-run session by the route P2 allows: answered while it runs, the subagent receives it; after it ended, the main agent receives it with the asker named | M2 (P9), M6 (an outcome whose recipient is an agent is never MAWS's), M8 (live) |
| A.j | a dismissal reaches the agent with MAWS's next message and starts no turn | M5 (the rider on the person's frame), M6 (a dismissal alone makes no steer and brings nothing up), M8 (live) |
| A.k | after a compaction the agent names the option the human picked | M8 (live, a real model); it rests on §5.5, which C2 built |
| A.l | the main conversation receiving an ended subagent's answer names the option picked | M1 (the context), M2 (P9: it reaches the model), M8 (live, a real model) |
| A.m | the channel journal shows one question and its outcome | M7, M8 (live) |
| A.n | a session set to `maws` still has `ask` and is answered as today, on this machine and from another | M3 (its launch line and environment pinned; `e2e:tools`, `e2e:remote`), M5 (`e2e:supervisor-daemon`'s `ask` cases unchanged), M8 (the same groups on the landing's head) |
| A.o | a MAWS-run session's sminos writes its record under the home MAWS's reader reads; the launch names it | M2 (P6), M3, M8 (live, under a home that is not the default) |
| A.p | a session whose question tool is "Default" is launched with `MAWS_QUESTION_SHEET` and takes the sheet, a prestarted one included | M2 (P7), M3 (the variable equals the plan's id with a null spec id; a prestart's spec equals its Send's), M8 (live: a new chat typed, then sent) |
| A.q | an open question no longer holds an engine process | M5 (F22's pin), M8 (live: released with a question open) |
| A.r | a subagent that ends with a question open: the main agent is told which, on its next route (Acceptance 18, in a MAWS-run session) | M1, M2 (P9), M8 (live) |

## Plan of Work

M1 is in doperpowers and M2 is a spike; M3 to M8 are one pull request in MAWS, on `question-sheet-c5` rebased on the master that holds C3's second landing. M1 and M2 wait on nothing. M3 waits on M2's verdicts for P6 and P7. M4 waits on M2's for P9. M5 consumes M4; M6 consumes M3, M4 and M5; M7 consumes M4 and M6; M8 consumes all.

### M1 — sminos: a MAWS-run session's routes

**At its end.** In a session whose runner is `maws`, an ended subagent's open questions and a call's late outcome are told to the main conversation on its next tool result or prompt, and a message that answers a subagent's question carries that question's words and options as the tool's context. A terminal session behaves exactly as before, and so does every session MAWS launches today, since none has the runner until M3.

**Where.** doperpowers, a branch from `main` at `42ab7915d` or later; one pull request, its body ending with the session line.

**Touches.** `H/sheet.tsx`, `H/sheet-model.tsx`, their tests under `sminos/tests/mods/`, the plugin's version, `docs/doperpowers/TECH-DEBT.md` row 54, and one paragraph of `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` (I9's "In a MAWS-run session", brought to what the mod now does).

**Interfaces.** Exposes §S's two behaviours to M2 and M8. Consumes C2's `take`, `putBack`, `withResultRoute`, `keysIn` and the command's `show --json --keys`, all as built.

**Decisions.** F8, F9, F10. The context is composed in the mod and not by the step, so no event, no view and no published shape moves; `sminos/types/sheet/` is not touched and `python3 -B sminos/tests/sheet-contract.gen.py --check` still passes. A notice put back because a prompt entered without it is the terminal's rule, unchanged. The mod still submits nothing and opens no idle route in a MAWS-run session (C0's P1: a turn the tool submits there is a turn MAWS did not send).

**Does not touch.** The step, the door, the command, the set, the terminal's routes, the bridge.

**Proves.** A.l's context and A.r, on the suite's fake port: §S's tests.

**Gate.** `ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,version-bump` from the doperpowers worktree.

### M2 — The probe: a MAWS launch that takes the sheet (spike)

**The question it answers.** P6 to P10 of §S: whether the launch F2 and F4 describe makes sminos take the sheet under the home MAWS names, what the engine's rows are for a steer that is read and for one withdrawn, and whether M1's context and an acknowledgement do what §S and F19 say, on the engine MAWS's launches run.

**What to build and how to run it.** The scenario `qsheet-c5.mjs` of §S, on the Mac runner, with the doperpowers checkout at M1's branch. It spends nothing: the model is the scripted stand-in. The steps are Concrete Steps'.

**What to observe.** Each row of §S's table, from the fixture's frames, the stand-in's recorded requests, the mod's own log and the files under the scratch sminos home.

**Promote or discard.** Each row's last column. A verdict that changes a decision is written into that decision and into the section it bears on before the next milestone starts, by this document's writer; a verdict that stops the child (P7's "no") goes to the composite's writer with the fixture. The fixtures and the findings are kept either way; the scenario stays as the way to ask again on a later engine.

**Touches.** `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-*.jsonl`, `spikes/protocol-probe/findings-qsheet-c5.txt`, `spikes/protocol-probe/fixtures.test.mjs`.

**Does not touch.** `src/`. The findings name no machine, no home and no version of anything but what the engine's own frames carry.

**Gate.** `scripts/ci-gate.sh "$PWD" --gates probes` on the commit that holds the fixtures and their tests.

### M3 — The launch

**At its end.** A session whose question tool is "Default", new, resumed, forked or prestarted, is launched with `MAWS_QUESTION_SHEET` naming its own session and `SMINOS_HOME` naming the home MAWS reads, on a host that lists `engine.questionSheet`. A session whose record already holds a sheet is launched the same way whatever its stored tool. Its supplement names the tool it has. A session set to "MAWS" is launched exactly as before.

**Blocked by.** M2's verdicts for P6 and P7; C3's second landing on master.

**Touches.** `src/shared/host/socket-protocol.ts`; `src/engine-host/launch.ts`, `launcher.ts` (the adopter's rebuild passes the id it has), `detached.test.ts`; `src/services/sessions/` (`launch-mapping.ts`, `served-set.ts`, `context.ts`, `resume.ts`, `setup.ts`, `prestart.ts`); `src/services/spine-root.ts`; `src/shared/sheet/read.ts`; `src/services/owner/launch.ts`, `src/shared/owner/contract.ts`; `R/composer/copy.ts`, `R/settings-tab/copy.ts`; `docs/charter.md` (§19), `docs/doperpowers/plans/2026-11-23-tool-choice.md`.

**Interfaces.** Exposes §R. Consumes `servedSet`, `sameLaunchSpec`, `ownerChannelLaunch` and `decideFlags` as they are, and C3's `SheetService.read`.

**Decisions.** F1 to F7. The capability is listed in the same commit that sets the variable: a host that lists it and does not set it would have the spine append supplement 5 to a session with no sheet. `launch.test.ts`'s pin of the full set's line is not edited; a second pin holds a Default launch's environment and settings, and a third that a `maws` launch's environment has neither name. The override reads the record once per attempt and the automatic retry reuses the spec, as D8 has it.

**Does not touch.** `ask`, its flags, its server, its steer; `LaunchSpec`'s schema; `prestartKey`; the stored set of any session.

**Proves.** A.h's launch, A.n's launch, A.o, A.p at the unit level: `buildLaunch` with a null spec id and question `engine` has `env.MAWS_QUESTION_SHEET === plan.sessionId`, and with a resume the resumed id; a `maws` launch has neither variable and its line is the pin's; `extraSettingsOf` writes the home for a sheet launch only; a Default intent's prestart spec equals its Send's under `sameLaunchSpec`, and a `maws` intent's differs from a Default one's; `sheetOverride` on each of: a record with an open question, a queued line alone, nothing, an unreadable record, a host without the capability, a fork; supplement 5 word for word, and `decideFlags` rendering anew from a recorded 4.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:remote`.

### M4 — The steer's form, the flights' fold, the steer as an arrival

**At its end.** Three pure things exist and are held to recorded bytes: a composer whose output for the published example's record is the published steer; a fold that reads a journal to "this message was read" or "it was not, and why"; and a reader that finds the sheet's deliveries in a message MAWS wrote, so a row's receipt and a turn's notice are drawn from a MAWS-run session's own history.

**Blocked by.** M2's verdict for P9.

**Touches.** `src/shared/sheet/steer.ts`, `flight.ts` and their tests; `src/engine-host/sheet-flights.ts` and its test; `src/shared/engine/sheet-carrier.ts`, `arrival.ts`, their tests; `src/engine-host/normalizer.ts` and `src/engine-host/fs/backfill.ts` only if the person's row does not already reach the reader they share; `test/fixtures/sheet/transcripts/` and one snapshot under `test/snapshots/transcript/sheet/`.

**Interfaces.** Exposes §T, §U's fold and shape, and §Y's `steerDeliveries`, to M5, M6 and M7. Consumes C3's model (`SheetOutcome`), `parseSheetDeliveries`, `sheetEntry` and `sheetFactsOf`.

**Decisions.** F13, F15, F23, and "A flight, as the journal says it". The composer takes `wakes` as a parameter because what wakes is the deliverer's knowledge (F16), not the record's: sminos's own composer reads `acrossStop`, which in MAWS is true of every answer a start applied, the released session's among them. The fold reads raw rows and not events, as `UnsettledFold` does: an adopter's fold drops events, and the normaliser tells no reader of an echo.

**Does not touch.** The queue, the session, any command, the spine.

**Proves.** A.b's receipt (the snapshot: a transcript whose only delivery is a steer draws the receipt, no bubble and the notice row; one whose delivery rode a person's message draws that message as typed); A.f and A.g at the fold; §T's and §U's tests.

**Gate.** Class 1a; `e2e:transcript`, `e2e:desk-web` (the rows are bundled there).

### M5 — The host: flights in the journal, the two ways a delivery is written

**At its end.** The host can be asked to send an envelope as a steer, to hold one as the rider of the person's next message, and what became of any key. It refuses to send a key twice, a Stop takes a waiting sheet steer back, and a host that adopts the session answers the same questions from the same journal.

**Touches.** `src/engine-host/` (`queue.ts`, `session.ts`, `ipc.ts`, `sheet-flights.ts`, their tests, `session-maws.test.ts` for F22's pin); `src/shared/ipc/` (names, schema, grades, `wire.ts`, the three pinned files), `src/shared/machine/address-paths.json`; `e2e/supervisor.spec.ts`.

**Interfaces.** Exposes §V to M6. Consumes §T's `isSteerEnvelope` and `parseSheetDeliveries`, §U's fold.

**Decisions.** F12, F14, F17, F18, F21, F22. The check and the tie are one synchronous step, with no await between `holds` and the row. The rider is appended in the session's `write`, after `prepare` has made a submission's content, so a linked read's blocks come first and the envelope is last. A frame the queue reverts (its write failed) leaves its rider's flight unread, and the deliverer offers again. The queue's persisted and published shapes do not change: a host steer is kept in the queue's memory only, which is why an adopter takes them from the fold.

**Does not touch.** `ask`'s table, steer and restore; `SessionMaws.pending`; the normaliser's events; the spine.

**Proves.** A.f (a sheet steer waiting when Stop is pressed is cancelled, journals `cancel`, and nothing of it is published or held), A.g (in `e2e:supervisor-daemon`, on the stub engine with M2's `-steer` recording: a steer written, the host handed over before `started`, the adopter answers `in_flight` for the key and then `read`), A.j (a rider is the last block of the person's next frame, tied to that frame's uuid, and a sheet steer and an `ask` steer take none), A.q (F22's pin), each refusal of §V, and F21 (after a gap, a flying flight whose uuid the transcript holds is journaled seen and is read; one it does not hold stays flying).

**Gate.** Class 1a; `e2e:supervisor-daemon`, `e2e:c7`, `e2e:tools`.

### M6 — The deliverer: applied outcomes out, acknowledgements in, a released session brought up

**At its end.** With the app running, an outcome the tool accepted for the main conversation of a MAWS-run session is sent once and acknowledged once, whoever gave the answer; a released session with a new answer is started and receives it; a dismissal waits for the person's next message.

**Touches.** `src/services/sheet/` (`delivery.ts`, `service.ts`, `door.ts`, their tests); `src/shared/sheet/model.ts`; `src/services/spine-root.ts`; `test/support/fake-sminos-cli.mjs`; `e2e/requests.spec.ts`.

**Interfaces.** Exposes nothing later milestones call. Consumes §R's capability, §T, §U's shape, §V, and C3's service.

**Decisions.** F11, F16, F19, F20, and the deliverer's two tables. The deliverer holds no fact between passes that a pass acts on; what it remembers (the rider last accepted, the keys it tried to bring a session up for) only spares a call, and losing it at a restart costs one call more. A pitfall for the replayed cases: a replay ends as a mismatch at a write its recording does not hold (`src/engine-host/replay-transport.ts`), and a steer's text carries the keys a surface made and paths under the run's own home, which no recording has. How the replay matches a host-written user frame is read there before the cases are written; if it compares content, the case's recording is made to hold the frame the case will write (the keys seeded through the stand-in door's staged outcome, the home the case's own), and nothing in `src/` is loosened for it.

**Does not touch.** The components, the store, the wire's `sheet.*` commands; `put`'s refusal of a `delivered` line.

**Proves.** A.b, A.c, A.d, A.e, A.i (an outcome whose recipient is an agent is never sent), A.j, and A.g's last step, by §W's tests; and in `e2e:c7`, replayed from M2's recordings with the stand-in door: an answer sent in the side sheet of a MAWS-run session ends with one `sheet_flight` row, one steer in the engine's input and one `delivered` line naming its key; the same after the session was released first.

**Gate.** Class 1a; `e2e:c7`, `e2e:supervisor-daemon`, `e2e:lane-a` (the sheet service's terminal cases, unchanged).

### M7 — What draws and what else reads: the notice, the channel journal, the words

**At its end.** A MAWS-run session's question is announced as its `ask` would be; the project's channel shows the question and, once, what became of it; and every surface C3 built is seen drawing a MAWS-run session.

**Touches.** `src/main/attention/notifier.ts`; `src/services/channel/` (`lane-b.ts`, `register.ts`); `src/services/spine-root.ts`; `R/channel/project.ts`; `e2e/channel.spec.ts`, `e2e/requests.spec.ts`; `docs/tech-debt-tracker.md`.

**Interfaces.** Consumes §Y's reader, C3's `callEntries`, `isSheetCall`, `SheetService` and `isSheetItem`.

**Decisions.** F24, F25. Limits logged in `docs/tech-debt-tracker.md`, one row each: delivery waits for `mawsd`'s services to be loaded; the released mark lives in the services' memory and is rebuilt only from an engine host that still runs, so after either was restarted a released session is not started for an answer, which then goes at its next start; a prompt hook of another plugin that drops a started message leaves its outcomes acknowledged; a subagent whose send was refused while it still runs is named as ended; a session that held `ask` and is launched with the sheet keeps `ask` offered and failing; a steer carries no age for an answer owed across a stop and no image line; a prestarted Default engine that is never adopted leaves an empty record for sminos's sweep.

**Does not touch.** The components (`R/sheet/`), the row, the side sheet: they are C3's and draw any record. A fault found in one is fixed where it lives and reported.

**Proves.** A.a (in `e2e:c7`, replayed from M2's `-launch` recording over a seeded record: nothing opens, the row's lines, Open at the question, the "Waiting for you" line); A.m (a live sheet call records one `question` entry per added question and none for a revise; a pending outcome, then a closed one, record one `answered` entry between them; the renderer joins it); the notifier's two cases.

**Gate.** Class 1a; `e2e:c7`, `e2e:settings`, `e2e:panel`, `e2e:to-human`.

### M8 — Live on the Mac runner, and the acceptance

**At its end.** Every clause of "The gates, by clause" has been observed in the running system: the built app, the real engine, the real sminos at the commit that is or will be doperpowers `main`, driven by one script.

**Touches.** `e2e/sheet-maws-live.rig.ts`, `e2e/sheet-maws-live.config.ts`, `e2e/support/sheet-live.ts` (C3's, extended) and `e2e/support/model-stub.ts`; this document's Progress and Outcomes.

**Decisions.** F27. The driver follows C3's (`e2e/sheet-live.rig.ts`, `e2e/sheet-live.config.ts`): not a `*.spec.ts`, its own config its whole selection, the same variables (`SHEET_LIVE_DOPERPOWERS`, `SHEET_LIVE_OUT`), the same scratch homes, record readers and terminal driver from `e2e/support/sheet-live.ts`. Its sminos home is a scratch directory that is not the default's name, exported to the app so the reader resolves it, and never exported to the engine by anything but the launch. MAWS's launches reach the checkout's sminos through an engine wrapper the driver writes at run time and names in `MAWS_E2E_ENGINE_BIN`, as `e2e/support/headless-browser.ts` wraps the engine: it `exec`s the real binary with `--plugin-dir <the checkout's sminos>` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` added, so the engine's parent is still the host (`SMNS_MEMBER`'s check). `MAWS_SMINOS_CLI` names the checkout's `bin/sminos`. Every scene but two is answered by the scripted model: `e2e/support/model-stub.ts` gains a script of replies (text, a tool call with a given input) in the manner of `spikes/protocol-probe/stub-api.mjs`, so those scenes spend nothing and every request the model was sent is on record to be counted. The two that need a model that reads (A.k, A.l) run on a real one, the smallest, through the gateway's variables as C3's driver does, under a cap of US$0.50 for the run. A release is provoked the way `e2e/support/c12-live.ts` provokes one. The driver asserts from files and records only: the sheet's `state.json` and `inbox.jsonl`, the session's journal, the engine's transcript, the stand-in's requests, the channel's entries through `channel.history`, and what a window shows by role and name. It joins no list in `.github/workflows/gate.yml`: the gate's runners hold no sminos checkout.

**Does not touch.** Anything a milestone before it built, but for a fault the run finds, which is fixed where it lives and reported.

**Proves.** A.a to A.r, by the scenes Concrete Steps lists, in addition to every gate of M3 to M7 on the landing's head.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:transcript`, `e2e:panel`, `e2e:to-human`, `e2e:lane-a`, `e2e:remote`, `e2e:supervisor-daemon`, `e2e:desk-web` on the landing's head; the live driver on the Mac runner.

## Concrete Steps

A gate tests the committed head and runs on GitHub Actions; nothing below is run on the laptop this was written on. `<doperpowers>` is that repository's worktree. Steps marked "on the Mac runner" are run there over ssh, from `~/.local/share/question-sheet-c5/maws` and `~/.local/share/question-sheet-c5/doperpowers`, clones of the two public repositories at the branches under work, updated with `git fetch` and a checkout of the commit named in the step's report.

**M1.** In `<doperpowers>`:

    python3 -B sminos/tests/sheet-contract.gen.py --check          # the set is untouched: prints the same 21 cases, 6 examples and digest as before
    ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,version-bump

The mods' suite gains §S's cases and ends with the kit's summary and no failure; `claude plugin validate` prints no refusal for `sminos`.

**M2.** On the Mac runner, with the doperpowers clone at M1's branch:

    cd ~/.local/share/question-sheet-c5/maws/spikes/protocol-probe
    QSHEET_SMINOS=~/.local/share/question-sheet-c5/doperpowers/sminos node run-pass3.mjs qsheet-c5
    QSHEET_SMINOS=… QSHEET_ONLY=qsheet-c5-steer node run-pass3.mjs qsheet-c5      # one fixture again

The run prints one line per step and writes `fixtures/qsheet/qsheet-c5-{launch,resume,fork,steer,cancelled,subagent,delivered}.jsonl`. Read each against §S's table before anything else:

- `-launch`: the run's notes hold `state.json` at `<the scratch sminos home>/sheet/<the session's id>/` and no `sheet/` under the scratch home's default place; the `system/init` frame lists `mcp__sminos__AskUserQuestion` and the tell's server; the first request's tools hold a schema with `ask` and `withdraw` and no built-in `AskUserQuestion`; the mod's log holds `sheet: sheet (maws): MAWS_QUESTION_SHEET names this session`.
- `-steer`: for the idle steer, `command_lifecycle` `queued` then `started` for its uuid and a request that holds its text; for the one written during a tool call, the same with the text in the request after the tool's result.
- `-cancelled`: `queued`, then `cancelled` after the cancel request, no `started`, and no request holding the text.
- `-subagent`: the request that holds the steer `q… (asked by the subagent …, which has ended) → option 1.` also holds the context's line with the question's words; a request before it holds the ended subagent's notice once.
- `-delivered`: the door's output names the `delivered` line's key with state `applied`, and `state.json` no longer lists the outcome in `pending`.

Then check that no fixture holds a path outside the scratch directories, write the findings, add the tests, and from the worktree:

    scripts/ci-gate.sh "$PWD" --gates probes

**M3.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:tools,e2e:c7,e2e:settings,e2e:remote

`src/engine-host/launch.test.ts` shows the full set's line unchanged beside the new pins. The composer's Tools submenu and Settings › Sessions read the two sentences of §R.

**M4.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:transcript,e2e:desk-web

`src/shared/sheet/steer.test.ts` holds the comparison with `test/fixtures/sheet/set/examples/terminal/steer.txt`; a failure prints the two texts.

**M5.**

    pnpm wire:manifest                                             # in the Mac runner's clone, never on the laptop; routes.json by its test under MAWS_ROUTES_WRITE=1; the regenerated files are committed with the commands
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:supervisor-daemon,e2e:c7,e2e:tools

**M6, M7.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:c7,e2e:supervisor-daemon,e2e:lane-a
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:c7,e2e:settings,e2e:panel,e2e:to-human        # M7

**M8.** The landing's gates, then the driver on the Mac runner, the app built from the landing's head and the doperpowers clone at the commit the report names:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:tools,e2e:c7,e2e:settings,e2e:transcript,e2e:panel,e2e:to-human,e2e:lane-a,e2e:remote,e2e:supervisor-daemon,e2e:desk-web

    cd ~/.local/share/question-sheet-c5/maws && pnpm install && scripts/e2e-build.sh plain
    SHEET_LIVE_DOPERPOWERS=~/.local/share/question-sheet-c5/doperpowers SHEET_LIVE_OUT=~/.local/share/question-sheet-c5/out \
      pnpm exec playwright test --config e2e/sheet-maws-live.config.ts

It ends `13 passed`, one test a scene, and leaves under `SHEET_LIVE_OUT` a line of `steps.jsonl` for each assertion, each record as it stood, and each session's journal and transcript. The scenes, in order; "the model" is the scripted one unless the scene says real:

| scene | what the driver does | what it asserts | clause |
|---|---|---|---|
| 1 | types in a new chat whose question tool is Default, waits for the prestart, sends; the model calls the tool with two questions | the journal's `spawn` row names `MAWS_QUESTION_SHEET` among its environment's keys and `SMINOS_HOME` in its settings; the launch was adopted from the prestart; `state.json` is under the scratch sminos home and holds `q1`, `q2`; the side column is as it was; the call's row has two lines; the session's row reads "Question waiting" | A.a, A.o, A.p |
| 2 | presses Open on `q1`, picks its second option, types a note, presses Send | exactly one request to the model holds `q1 → option 2. Their text: "…"`; the journal holds one `sheet_flight` for its key, read; the inbox holds one `delivered` line naming it; `closed.q1.deliveredAt` is set; the row's line is the receipt | A.b |
| 3 | for `q2`, puts through the real command an answer, a second answer under another key, the first line again, and a retract of the second | the door's verdicts are `applied`, `closed`, `applied` again and `too-late`; one request holds `q2`, with the first answer; one `delivered` line names one key | A.e |
| 4 | the model asks `q3`; the driver dismisses it in the side sheet, waits twenty seconds, then sends "go on" | no request and no `sheet_flight` of carrier `steer` in those twenty seconds; the request of "go on" holds the person's words and, as its last block, an envelope with `Dismissed: q3.`, once | A.j |
| 5 | the model asks `q4`; the driver provokes a release | the digest reads released while `state.json` holds `q4` open | A.q |
| 6 | answers `q4` in the app | the session is acquired with no message sent by the driver; one request holds `q4`'s answer; one acknowledgement | A.c |
| 7 | the model asks `q5`; release again; `sminos sheet answer` from a shell | the same as scene 6 | A.d |
| 8 | the model runs a sleep of sixty seconds and asks `q6` first; the driver answers during the sleep, then presses Stop, then sends "go on" | `queued` and then `cancelled` for the steer; the queue's `cancel` row; no request holds the envelope before "go on", and that request holds it once, as the message's last block | A.f |
| 9 | a terminal session (C3's driver's setup) asks, is closed, is answered with `sminos sheet answer` (queued), and is then resumed in MAWS, where its record's question tool is `maws` | the launch's set has `question: 'engine'` and the record's stored set is unchanged; the tools hold no `ask`; one request holds the answer | A.h |
| 10 | the model starts a background subagent that asks, then sleeps; the driver answers during the sleep. A second subagent asks and ends; the driver answers | the first answer is in a request of the subagent under the tool's opening line and in none of the main conversation's, and no `sheet_flight` names its key; a request of the main conversation holds the ended subagent's notice once; the second answer's steer names the agent's id and the request holds the context's line | A.i, A.r |
| 11 | real model: asks it to put one question with two named options on its sheet, compacts, answers with the second option, asks nothing more | the model's reply holds the second option's label | A.k |
| 12 | real model: asks it to have a subagent put one question with two named options and finish; answers with the first | the main agent's reply holds the first option's label | A.l |
| 13 | reads `channel.history` for the project; then starts a session set to MAWS and has the model call `ask` | for `q1`: one `question` entry and one `answered` entry of lane B, and the count of entries of any lane for it, which is reported; the `maws` session's tools hold `ask`, its environment's keys hold neither variable, and the ask is answered in its form | A.m, A.n |

The handover (A.g) is not a scene: it is M5's case in `e2e:supervisor-daemon`, whose engine is a recorded one because nothing else can be handed over on cue.

## Outcomes & Retrospective

Pending — written at finish.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at the parent pin `7dd3627e9`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what the `ux-wave` session should be told. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules.

**Sentences.**

1. §5.4, "delivers with the journaled `next` steer its `ask` uses today" and "MAWS's journal ties its keys to the steer's id". Incomplete: `ask`'s tie is journaled with the write, and a write the host did not see complete then has none. Proposed: "delivers with a `next` steer whose keys MAWS's journal ties to the message's id before the message is written, so the tie exists for every message the engine could have received."
2. §5.4, "only when its journal shows that steer reached the model". Proposed addition: "which is the engine's `command_lifecycle` for the message saying `started` or `completed`: the engine took it into a turn. A message cancelled, discarded or refused before that, or still waiting when its process ended, was not read and its outcomes are sent again. Another plugin's prompt hook that drops a started message is not seen (a stated limit)."
3. §5.4, "A dismissal in a MAWS-run session is … sent with MAWS's next steer or human message to that session, as a line of its own". Proposed: "… as an envelope of its own, appended as the last block of the person's next message or carried in the next steer. So is an answer whose steer the person's Stop withdrew before the model read it: sending it again at once would start a turn in a session just stopped."
4. §5.4, "For a session whose engine process is released". Proposed addition: "Released is MAWS's own release of an idle process or one over the memory budget, with nothing launched since (the digest's mark). A session the person stopped, one that crashed and one a terminal held last are not started for an answer: it goes at their next start. A session is brought up once for an answer; and all of this happens while `mawsd`'s services are loaded."
5. §5.4, "(built by C5, in the sminos plugin, from the reader's model, by key)". As built: on any prompt of a MAWS-run session that carries a block, for each answered outcome among its keys whose asker is a subagent, one line of §5.5's form. The compaction case stands on §5.5 alone.
6. §6, "naming the asker by its agent id". Proposed addition: "and as ended, which the published steer says of every subagent's question the main conversation receives; a subagent whose send was refused while it still runs is named so too (rare, logged)."
7. §7, "a session with such a sheet is launched with `MAWS_QUESTION_SHEET` and without `ask`, whatever its stored question tool is". Proposed addition: "for that launch: the stored tool is kept and decides again once the sheet is empty. It needs a host that sets the variable (the capability `engine.questionSheet`); a record MAWS cannot read leaves the stored tool; and a session whose conversation was once sent `ask` keeps it offered and failing there (the tool choice's P2)."
8. §7, "C2's side (2026-11-23), which waits on C5's agreement". Agreed as built: the host sets the variable in `buildLaunch`, to the id it resolved. And "C5 meets the same race at a MAWS launch": it assumes no order; it acts on the record, which exists only once the start has run.
9. §9, "a session whose question tool is "Default" … is launched with `MAWS_QUESTION_SHEET`". Proposed addition: "and with `SMINOS_HOME` in its settings' environment, naming the home MAWS reads, on a host that lists `engine.questionSheet`; its supplement is a new text, 5, which names sminos's tool where it is listed and the built-in otherwise."
10. C5's section, "`MAWS_QUESTION_SHEET` must be part of that launch key". As found: an adoption is decided by comparing the two specs whole (`sameLaunchSpec`), and the variable is derived from the spec's set and the id the prestart minted, so it is covered with nothing added; `prestartKey` holds route facts only. And "`ux-wave/subagent-tell` … whose load order relative to sminos this child checks": it is on master; its mod shares no hook's dispatch with the sheet, and M2 runs both.
11. §6 and Acceptance 18, and C2's Status ("a late outcome's notice … reaches only the main conversation's queue, which a MAWS-run session's routes do not read (C5)"). As C2 built it, a MAWS-run session's routes carried no notice at all, the ended subagent's among them. M1 makes both routes carry notices there. What remains is doperpowers' TECH-DEBT 54 as it reads for a terminal session: a subagent caller's late outcome is told to the main conversation.
12. §11, "the third by C5 (`src/services/channel/lane-b.ts`)". Proposed addition: "A sheet question enters the channel journal from the live call that added it and its outcome from the record (an answer, "Dismissed" or "Withdrawn"), one entry each; a revise adds none."
13. X2, "`show --json --keys` answers the model for named keys (C5's steer is built from it)". False: MAWS composes its steer from its own reader's model, as it draws everything else. `--keys` is what the plugin's hook asks for item 5's context.
14. §8.1, "For a terminal session it is the in-app notice only". Proposed addition: "A MAWS-run session's is announced as its asynchronous `ask` is: by a system notification while the app is not focused, once per call."
15. X3 and §5.3, for the set's next version, none of it worth a re-pin: the published steer has no line saying an answer was given while the session was stopped (the terminal form's "asked …, answered …") and no `[Image source: …]` line, so a model learns of an image only from the block's path. Both hold nothing a model wrote and could join the steer's form.
16. §11's project log and the channel journal. sminos writes a member session's sheet questions to its project log, and on a machine whose sminos daemon is enrolled its host events reach MAWS's channel journal as lane A entries. Whether a MAWS-run session's question then stands twice in the channel (once from each lane) is counted by M8's last scene and reported; today's `ask`, which sminos exports too, is the same question, so this child reports and does not decide it.

**For the owner, through you.**

1. Two sentences that say what "Default" is (§R, F7). They are in the app's words and I recommend them as written; they hold no milestone.

No ruling of the owner's is needed to start. Three choices here are the writer's to look at before M3, since each reads a binding sentence one way: what "reached the model" is (F13), that an answer withdrawn at a Stop waits for the next message (F16), and that only a released session is started for an answer (F20).

**For the `ux-wave` session, through you.** The launch shape is fixed as follows. A launch whose set has question `engine` carries one more environment variable, `MAWS_QUESTION_SHEET`, set by the host inside `buildLaunch` to the session id that function resolves, so a prestarted engine has it with the id the prestart minted and keeps it through adoption; and one more settings variable, `SMINOS_HOME`, written into the spec's `extraSettings.env` by the spec builders, the same at prestart and at Send. Nothing joins `prestartKey`, and `sameLaunchSpec` needs no change: the set and the settings are already compared. The host lists a new capability, `engine.questionSheet`. Two things the wave may meet: a prestarted Default engine runs sminos's start, so an abandoned prestart leaves an empty sheet record under the sminos home, which sminos sweeps; and `MessageQueue.steer` gains two options (`before`, `host`) and the queue's `write` one (`person`), with a host's own steer kept out of the pending steers a window shows.
