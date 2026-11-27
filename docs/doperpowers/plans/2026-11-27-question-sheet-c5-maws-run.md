# Question sheet, C5 — MAWS-run sessions: execution (2026-11-27)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C5** (MAWS-run sessions). **Parent pin:** `cc9fd7ff3` (branch `question-sheet`). The document was written at `7dd3627e9` and moved to this pin when the composite took the owner's ruling on which sessions an answer starts (§5.4, Acceptance 7, C5's Acceptance). **Ticket:** MAWS board #870, a child of #600. The child's section in the composite ("### C5: MAWS-run sessions") is its spec. The composite's §5.1, §5.4, §6 (its last paragraph), §7 (the MAWS-run paragraph), §9 and §11 are its design, binding where the composite's "Grades" paragraph says; X3's steer form and X6's `MAWS_QUESTION_SHEET` are the contracts it owns or sets, and X1, X2, X5 and X7 the ones it consumes. This document carries the constraints, the decisions the composite did not carry, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `b65a1e175` (C3's first landing, the prestart engine of #880 and the direct tell are on it); branch `question-sheet-c3` at `04bf48574` (C3's second landing: the side sheet, the row, the attention items), which is on master before M3 starts and is this child's base; doperpowers `main` at `42ab7915d` (C2 whole, sminos's sheet as built; the published set at version 1, digest `594200ae…e277`, unchanged since `2594002af`).
>
> **Read before M1:** the composite whole; in doperpowers, `sminos/types/sheet/README.md`, and in `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` the sections I2, I3, I4, I7, I8, I9 (its last paragraph, "In a MAWS-run session") and I10; here, C3's execution document (`docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md`: S8 to S16, §B, §C, §E, §H, §I), `docs/doperpowers/plans/2026-11-23-tool-choice.md` (D1, D6, D8, D12, §C, §E, §F, "What ticket 600 changes"), `docs/doperpowers/plans/2026-11-24-prestart-engine.md` (D1 to D6) and `spikes/protocol-probe/findings-qsheet-c0.txt` (P1, P2, P5).

After this child, a session MAWS runs whose question tool is "Default" asks through the same sheet a terminal session does. The agent's call returns at once and draws its row; nothing opens. The person answers in the side sheet, on the local page or with `sminos sheet answer`, and the agent has the answer as one message from MAWS: each question named by its id, a picked option by its place, what the person typed as they typed it. A question no longer holds the session's engine process: the process may be released while questions are open, or be gone for any other reason, and an answer given then starts the session again, once, if MAWS ran it last, and is delivered; a dismissal waits for the next message without starting anything. Each accepted outcome reaches the agent once, whatever happens between MAWS writing it and the agent reading it: a second answer that lost, a line sent twice, a Stop, a hook that blocked it, the engine host replaced or killed under the session. A session set to "MAWS" keeps `ask` exactly as it is, and no default changes.

How to see each of these is Concrete Steps. What closes the child is its Acceptance in the composite, cut into clauses under "The gates, by clause".

## Progress

- [x] (2026-11-27) This document written against the composite at `7dd3627e9`, MAWS master `b65a1e175`, `question-sheet-c3` at `04bf48574` and doperpowers `42ab7915d`.
- [x] (2026-11-27) The owner's two answers: an answer starts any session MAWS ran last that has no process, once per answer (F20, which the first writing had limited to a released one); F7's two sentences stand as written.
- [x] (2026-11-27) The document's buildability review: twelve findings (eleven of the first rank, one of the second), each checked against the design by the composite's writer and all taken, with the writer's rulings on F13 (it stays the default reading, with two limits), F16 (it stands, for a process still live) and the engine's transcript as the arbiter of what the journal leaves open (F21). This revision repairs all twelve; parent pin moved to `cc9fd7ff3`.
- [ ] One more review, of the delivery sections only (the state machine, §U, §V, §W).
- [ ] M1 — sminos: a MAWS-run session's routes (doperpowers). Starts at once.
- [ ] M2 — The probe: a MAWS launch that takes the sheet (spike). Sitting A starts at once; sitting B after M1's branch.
- [ ] M3 — The launch.
- [ ] M4 — The steer's form, the flights' fold, the steer as an arrival.
- [ ] M5 — The host: flights in the journal, the two ways a delivery is written, the settling.
- [ ] M6 — The deliverer: applied outcomes out, acknowledgements in, a session with no process started.
- [ ] M7 — What draws and what else reads: the notice, the channel journal, the words.
- [ ] M8 — Live on the Mac runner, and the acceptance.
- [ ] The branch's review (medium), the doperpowers pull request's (medium), the landing through the master landing architect.

## Words this document adds

The composite's Terms define terminal session, MAWS-run session, the tool, sheet, question, asker, surface, the page, the bridge and envelope. C2's plan adds the record, the door, the step and the published set; C3's adds the set's pin, the model, a sheet call, the spine and the side sheet. Added here:

- **The host** is the engine host: the detached process `mawsd` starts, which owns each MAWS-run session's engine process, its queue and its journal (`src/engine-host/`). The spine reaches it through `SpineHosts.dispatch('engine-host', …)` and hears it through `hosts.onEvent` (`src/services/spine-root.ts`).
- **A sheet launch** is a launch that carries `MAWS_QUESTION_SHEET`: its served set of MAWS's tools has `question: 'engine'` and its spec names the sminos home, on a host that sets the variable (F2, F3). Whether a running process is one is read from its spawn row (F31).
- **The deliverer** is the spine's part that sends accepted outcomes to a MAWS-run session and acknowledges them (`src/services/sheet/delivery.ts`, M6).
- **A steer** is a user-role message of priority `next` the host writes to the engine (`MessageQueue.steer`, `src/engine-host/queue.ts`). **A sheet steer** is one whose whole content is an envelope in the steer form (§T). **A rider** is such an envelope appended as the last text block of a message the person sent.
- **A flight** is one written message that carries outcomes, known by its engine session, the message's uuid and the keys it carries. It is **flying** until the journal says how it ended: **read** or **unread**, each for good, or **undecided**, where the journal cannot say and the engine's transcript must (§U).
- **The echo** is the engine's replay, on its output, of a user frame it has put into the conversation (the launch flag `--replay-user-messages`). **Taken** is the engine's `command_lifecycle` for a message saying `started` or `completed`.
- **The transcript** is the engine's own file of a session's conversation, which every later request is built from; the host reads it through `src/engine-host/fs/`.
- **The ledger** is the deliverer's small file of flights it has seen read and not yet seen acknowledged (F28).
- **An outcome wakes** when it gets a steer of its own, which starts a turn in an idle session. One that does not wake **rides**: it leaves with the next sheet steer or the person's next message (F16).
- **MAWS ran it last** is said of a session with no process: MAWS launched it at some time and the newest record of its transcript was written by MAWS's own launch, not by a terminal since (F20). **Released** is one way such a session lost its process, MAWS's own release of an idle one or one over the memory budget; it is no longer a condition of anything here.
- **The acknowledgement** is the inbox line of kind `delivered` (composite §4.1) MAWS appends for a flight that was read.
- **The probe** is M2's run of the real engine with sminos loaded, against the scripted model. **A recording** is one of its fixtures, an engine journal. The gate's suites play one back in place of an engine: in process (`src/engine-host/replay-transport.ts`), or as a real child process where a session host must hold one (**the stub engine**, `test/support/stub-engine.ts`).
- **The Mac runner** is the project's self-hosted Mac, the one the gate's `mini` lane runs on.

## Verification

- This document: one adversarial buildability review (the composite's Verification, "Each plan child's execution document"), done; and, after its repair, one more review of the delivery sections only, before M4.
- Each milestone: the task review of doperpowers:subagent-driven-execution at its boundary. M4 (the form every later milestone writes or reads, and the table that decides what "delivered" means) and M5 (the journal rows a later host must be able to read) are reviewed before anything consumes them.
- The branch: doperpowers:review-code at **medium** (the composite's Verification), once, on the whole range. The doperpowers pull request of M1 is reviewed at medium too: C2's own range was reviewed at high because a fault there loses or duplicates an answer, and M1 adds only context to routes that carry no answer in a MAWS-run session, so it can do neither.
- The landing: through the master landing architect, after the doperpowers pull request is on doperpowers `main` and M8 has run against that commit.
- No look is asked of the owner: this child draws nothing new. Its two changed sentences of copy (F7) were put to the owner, who let them stand as written.

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
- The wire moves in M5, and in M3 as well only if the probe sends the sminos home by a spec field (§S, B6): `WIRE_MINOR` (`src/shared/ipc/wire.ts`) rises by one over whatever master holds then, and `wire-manifest.json`, `wire-fingerprint.json` (both by `pnpm wire:manifest`), `routes.json` (by its test under `MAWS_ROUTES_WRITE=1`) and `src/shared/machine/address-paths.json` are regenerated in that commit. Commit `8f59e9b42` (`session.tellAgent`) is the pattern for adding a host command.
- This child adds cases to existing e2e specs and no spec file, so `default`'s own-spec pin does not move and no gate's group list changes. Its live driver is a rig with its own Playwright config, as C3's `e2e/sheet-live.rig.ts` is, which no group collects.

**Facts of the code at the pin**, each read at `b65a1e175` unless it names another tree.

- **What a launch's environment is.** `buildEnvironment` (`src/engine-host/launch.ts`) passes the login shell's variables through an allowlist that admits neither `SMINOS_HOME`, `DAEMON_HOME` nor any `MAWS_*`, and then sets its own (`SMNS_MEMBER`, `MAWS_LANE`). The other way a variable reaches an engine is the spec's `extraSettings.env`, which becomes the `--settings` JSON's `env` and which the engine applies to its process at startup; that is how `MAWS_NATIVE_TO_HUMAN` and `CUA_BROWSER_BACKENDS` travel (`extraSettingsOf` and `withOwnerChannel`, `src/services/sessions/launch-mapping.ts`). The journal's `spawn` row keeps the argument list, so a settings value is on record, and only the names of the process environment.
- **Who knows a launch's session id.** `buildLaunch` resolves it: the resumed id, else the spec's `sessionId`, else one it mints. A prestarted engine's spec has `sessionId: null` (`prestartLaunch`, `src/services/sessions/prestart.ts`, writes nothing), so its id exists only inside `buildLaunch`, and an adopted prestart keeps that id (`runIntentSetup`, `src/services/sessions/setup.ts`).
- **What the prestart compares.** `sameLaunchSpec` (`src/engine-host/prestart.ts`) compares the two specs whole, `sessionId` set to null in both. `prestartKey` (`hostLaunchOf`, `src/services/sessions/machine-route.ts`) holds route facts only. Nothing compares `plan.env` or `plan.args`.
- **Where a launch's set is decided.** `Setup`, the session service's context for a launch, is declared in `src/services/sessions/setup-steps.ts` (`hostLists` is on it). `servedSet` (`src/services/sessions/served-set.ts`) is asked once per attempt by `runIntentSetup`, `runResume` (`resume.ts`) and `prestartLaunch`; the answer goes to the spec builders (`intentLaunchSpec`, `resumeLaunchSpec`) as `ctx.mawsTools` and to `ownerChannelLaunch` (`src/services/owner/launch.ts`) inside the spec. A record MAWS did not create (a discovered terminal session) has no `mawsTools`, which reads as the full set, question `maws`.
- **The supplement.** `ownerChannelLaunch` appends one only when the to-human lane is on with an external style (`APPENDS['external-style-plus-supplement']`), chosen by the spec's question tool: supplement 3 for `maws`, supplement 4 for `engine`, whose text says sminos's tool is not available (`ASK_ENGINE`, `src/shared/owner/contract.ts`). `decideFlags` renders a prompt anew when what a session recorded differs from what the decision wants.
- **The direct tell is on master.** `buildLaunch` passes `--plugin-dir <mods/maws-tell>` on every launch, after the engine's fixed flags and before `--model`. The mod (`mods/maws-tell/hooks/register.mjs`) registers one tool on its own server, a `session.start` hook that calls `next` first, and three hooks matched to its own tool. It has no prompt hook and no unmatched `tool.call` hook, so it shares no dispatch with sminos's sheet. Its probe ran with no sminos loaded; M2 runs both.
- **sminos's start choice** (`chooseStart`, `sminos/hooks/mods/sheet-model.tsx`): `MAWS_QUESTION_SHEET` equal to the session's id gives the sheet with runner `maws`, tested before `MAWS_NATIVE_TO_HUMAN` and before "not interactive", either of which gives no question tool of sminos's at all. So a MAWS-run process without the variable never drains a record, whatever the record holds.
- **What sminos does in a MAWS-run session today** (`sminos/hooks/mods/sheet.tsx`): it drains, sends to running subagents, takes `delivered` lines, and composes no envelope for the main conversation. `take()` returns only a start's or a compaction's context there, and `withResultRoute` returns at once: **the notices (an ended subagent's open questions, a call's late outcome) are queued and never carried.** `landed` and the transcript search are terminal-only: in a MAWS-run session only a `delivered` line takes a key out of `pending`. The door's nudge reaches the session through its bridge's `sheet` op, which an observing bridge answers.
- **A pending outcome's recipient** is an agent only while that subagent runs and the tool has taken the outcome for its own send (`recipient_of`, `sminos_sheet_step.py`); a start, a reroute and any step that no longer finds the agent running make it `main` and not taken. So "recipient is `main`" is the whole test of what is MAWS's.
- **The steer's published example** (`test/fixtures/sheet/set/examples/terminal/steer.txt`, composed from `examples/terminal/input/`) is the terminal envelope of the same record with three differences: no question text, `option <n>` for each pick, and `(asked by the subagent <agent id>, which has ended)` for a subagent's question. It carries no line for an outcome owed across a stop and no `[Image source: …]` line; the image's path is in the block alone.
- **How a steer ends in the journal** (`src/engine-host/queue.ts`, `prompt-history.ts`; fixtures `spikes/protocol-probe/fixtures/pass3/steer-next*.jsonl`, `qsheet/qsheet-p1-hooks.jsonl`). The host journals an `out` `user` row with the message's `uuid` and `priority`; the engine answers `in` `command_lifecycle` rows naming it as `command_uuid`: `queued`, then `started` (folded into the running turn at its next tool round, or a turn of its own when idle) and `completed`, or `cancelled`, `discarded` or `refused` before any start. The queue's own rows are `meta` `{event:'queue', action, messageUuid}`: `withdraw` before it asks the engine to cancel, then `cancel`, `hold` or `giveback`; `abandon` for whatever is unended at an exit or at the next launch's recovery; `revert` where a write failed and the queue put the message back. `UnsettledFold` reads exactly these to say which steers are open. A steer cancelled while it waited leaves no trace in the model's requests.
- **What else the engine says of a message** (the same fixtures, and `uxwave/u4p2-two-1-2.jsonl`, `pass3/hooks-flipped.jsonl`, `qsheet/qsheet-p5-d-clear.jsonl`). It echoes a user frame it has put into the conversation: an `in` `user` row with `isReplay: true` under the frame's uuid, after `started` for a message that opens a turn and before it for one folded into a running turn. Of two steers that waited together, the first is echoed under its own uuid with its own text, both are `started`, and the echo under the second's uuid holds the text of both, joined by a line break; the turn's `result` names both. Each turn ends in a `result` row whose `user_message_uuids` name the messages it answered and whose `num_turns` counts its model turns. A prompt a hook blocked is `started`, never echoed, named by a `result` with `num_turns` 0, and `completed`. `/clear` is `started`, echoed as `<command-name>/clear</command-name>…` in place of its own text, named by a `result` with `num_turns` 0, and `completed`. A prompt whose turn was aborted after it began is `cancelled` after its `started`. So `started` and `completed` alone do not say a model was asked.
- **Who wrote a transcript's record.** Each record of the engine's transcript names the entrypoint that wrote it: `cli` for a terminal, `sdk-ts` for a launch of MAWS's (`OWN_ENTRYPOINT`, `src/engine-host/fs/holders.ts`; MAWS sets `CLAUDE_CODE_ENTRYPOINT` to it). The host's scan keeps the first one a file names, not the newest (`src/engine-host/fs/summarize.ts`), and the index's record holds neither; what the record holds is whether MAWS ever launched the session (`readRecordedRoute(record.gateway)`, `src/shared/engine/route.ts`, null for one MAWS only discovered). A steer the engine folded into a turn is in the transcript as a queued command attachment whose `source_uuid` is the steer's (`spikes/protocol-probe/findings-pass2.md`), and a blocked prompt is in it not at all.
- **What the journal keeps.** `pruneJournals` (`src/engine-host/journal.ts`) keeps a session's twenty newest launches and nothing older than thirty days, at the host's start and daily.
- **What a recording checks.** The replay and the stub engine accept a user frame the host writes by its type, not its content, so a suite that plays a recording says nothing of what a steer held unless it reads the frame itself.
- **A host of before this child** already launches a session whose question tool is `engine`, without `MAWS_QUESTION_SHEET`; a later host can adopt that process.
- **A write's rows.** `OutboundWriter.write` (`outbound-writer.ts`) writes the frame, and only when the write resolves journals the `preface` rows and the `out` row together. A write that rejects journals `write_failed` with no uuid. A host that detaches gives writes in flight three seconds and then fails them, though the session host may already have handed the frame to the engine; a host that dies between the pipe and the journal leaves the same hole. **So a tie that is journaled as a preface can be missing for a message the engine received.** Today's asynchronous `ask` has that hazard (its `maws_ask_answered` row is a preface), and it is why F12 journals the tie first.
- **What an adopter knows.** `EngineSession.adopt` (`session.ts`) folds the launch's rows (`launchRows`, `holder/restore.ts`) before it connects, and the session host replays what the engine wrote meanwhile from its ring, through the ordinary `record`. A ring that overflowed gives `host_attach` with `replayed: 'gap'` and a reseed from the engine's transcript; the lifecycle rows in the gap are gone.
- **What holds a process.** `SessionMaws.pending` is the tool server's calls in flight plus the asynchronous asks; `hardReasons` (`budget.ts`) refuses a release while it is above zero. Sheet questions are in neither count, since they are in no table of the host.
- **The released mark** (`SessionDigest.released`, `src/shared/ipc/schema/session.ts`) is the services' memory of this run, set at a release and dropped at a launch; it says nothing of a process that crashed, was ended, or went with the machine, and nothing after `mawsd` restarted.
- **Bringing a session up without sending.** `SessionService.acquire(appSessionId, reason, options)` (`src/services/sessions/service.ts`) resumes a session and resolves `{ status: 'ready', … }`; `reason` is logged and nothing branches on it; `resumeAfterHandover` calls it with `'resume'`. The queue's `steer` refuses a session whose process is not `ready`.
- **Which user frames the queue writes.** A submission, a steer and a promotion go through the `write` the session hands its queue (`MessageQueueDeps.write`, wired in `session.ts`); the plan sequence's frames are written by `session.ts` itself and never pass it. Only a submission's content passes `prepare` (`SessionMaws.withLinkedReads`), which already appends text blocks to what the person wrote and leaves the queue entry's own content alone; a steer and a promotion are written as given.
- **Events reach the spine at most once.** `mawsd/spine-hosts.ts` drops what arrives while the link is not ready, and an adopter's fold emits nothing again. A reader that must not miss a fact asks for it (`session.promptHistory` is the owner channel's way).
- **How a person's message is read for MAWS's own texts.** `readPersonsContent` (`src/shared/engine/arrival.ts`) takes MAWS's `ask` envelopes out of a person's content, whole or as members of a text the engine joined, and what is left is the bubble. On `question-sheet-c3`, `src/shared/engine/sheet-carrier.ts` reads a sheet's envelope on a plugin's prompt and a hook's context only, and says so: no carrier there is the person's.
- **The channel journal.** `LaneBSource` (`src/services/channel/lane-b.ts`) records `question` and `answered` entries from a MAWS process's live events only (an event with its journal row), keyed by `src = <project>/lane-b/<appSessionId>/<anchor>`; an answer waits for its question's entry (`requires`). The renderer joins an answer to its question by the anchor's form (`questionOf`, `src/renderer/src/channel/project.ts`), for `ask/…/answered` and `answer/…` only. sminos writes a member session's sheet questions to its own project log from the record (C2's I12), and where the machine's sminos daemon is enrolled its host events reach the same journal as lane A entries (`#journal`, `src/endpoint/rl10/link.ts`).
- **The notifier** on `question-sheet-c3` (`src/main/attention/notifier.ts`) announces a sheet item once per call and returns before any system notification for it, as for a terminal session's item; its comment leaves a MAWS-run session's to this child.

## Decisions settled at authoring

Each is a choice the composite left to this child, numbered F1 to F31 (the charter's are D-, C2's K- and U-, C3's S-, C4's T-). F20 is the owner's ruling of 2026-11-27; F13, F16 and F21 carry the composite's writer's rulings of the same day. Where one makes a sentence of the composite false or incomplete, the sentence is in the last section. The interfaces they fix are §R to §Z.

**The launch.**

- **F1 · A sheet launch is told by one fact the spec already carries: the served set's `question` is `engine`.** The launch line, the supplement, the spawn row, the prestart's comparison and an adopter all read `mawsTools` today, so no second fact can disagree with it. From this child on, "Default" on a host that lists F3's capability means the sheet where sminos runs and the engine's built-in where it does not, as the composite's §9 says. Lost: a `questionSheet` flag on the spec, which is a second fact, a wire change, and one more thing an older host ignores silently.
- **F2 · The host sets `MAWS_QUESTION_SHEET`, in `buildEnvironment`, to the session id `buildLaunch` resolved**, for a launch whose set's question is `engine` and whose spec names the sminos home (F4). Only `buildLaunch` knows the id of a prestarted engine, and an adopted prestart keeps it, so the variable a prestart was started with is the right one after Send. This is C2's proposal (the composite's §7) taken as built: the value is the session's id, and sminos honours it only when it equals the id of the session the process starts. Lost: the spine writing it into `extraSettings.env`, the way `MAWS_NATIVE_TO_HUMAN` travels. The spine does not know a prestart's id, and a value in the spec is compared by `sameLaunchSpec`, so Send's id would never equal the prestart's and no Default chat would be adopted. **How it joins the prestart's key:** it does not need to. The comparison that decides an adoption is `sameLaunchSpec` over the whole spec; the variable is derived from two things the spec holds (the set and the home, both compared) and the id the prestart itself minted (kept), so two launches that differ in it already differ in the spec. `prestartKey` gains nothing.
- **F3 · A host that sets the variable says so: the capability `engine.questionSheet`.** The spine reads it where it reads `engine.mawsTools` (`s.hostLists`), to choose the supplement (F6) and to serve the override (F5). Without it a Default launch is what it is today. It says what a host will do for a launch it is asked for now; what a running process was launched with is read from that launch's own record (F31), never from this.
- **F4 · The spine names the sminos home, as `SMINOS_HOME` in the spec's `extraSettings.env`, for a launch whose set's question is `engine`.** The value is the one the sheet's reader was created with (`sminosHome(deps.env, shellEnv)` in `spine-root.ts`), so what a MAWS-run session's sminos writes and what MAWS reads are the same directory by construction, not by two resolutions agreeing. It is stable between a prestart and its Send, so the comparison holds. `DAEMON_HOME` is not passed: sminos reads `SMINOS_HOME` first. Every other launch's line is unchanged. A home that cannot be resolved (the test runner's refusal of the real one) names nothing, and then the host sets no variable either: a sheet whose record MAWS cannot find is one nobody could answer. That same rule closes the skew of an older `mawsd` over a newer host: a spine without this child never names the home, so that host gives its Default launches the engine's built-in, as today. Lost: admitting the two names through the host's allowlist, which passes the login shell's value and not the reader's (they differ wherever `mawsd`'s own environment names a home), and changes the environment of every launch. M2's P6 decides whether a settings variable reaches sminos's own processes; its other answer has a written branch (§S, B6).
- **F5 · A session that already has a sheet is launched as a sheet launch for that launch, and its record keeps its set.** Before `servedSet`, a resume asks the sheet service for the record of the engine session it resumes; when the record holds an open question, a pending outcome or a queued line (the model's `open`, `hidden`, `pending`, and `sent` entries of state `queued`, any of them), and the host lists F3's capability, the set served is the record's with `question: 'engine'`. Nothing is written back: D1 stores a set once, and the stored `maws` goes on meaning `ask` for every launch that finds no sheet, until C7 retires the value. A record this build cannot read, or one read as `busy`, leaves the stored tool, logged: MAWS could deliver nothing from it either. A fork resumes under a new session id and an empty sheet, so it is never overridden. Known residue: a session whose conversation was sent `ask` keeps it in its requests after a launch that does not list it, and a call of it is answered by the engine's own "No such tool available" (the tool choice's P2). That takes a session that held `ask` in MAWS and then asked through the sheet in a terminal; it is logged, not built around.
- **F6 · A sheet launch's supplement is a new text, supplement 5**, chosen where 3 and 4 are (§R has it word for word). It names sminos's tool "where it is listed" and the built-in otherwise, because MAWS cannot know whether the session's sminos registered the tool (not installed, older, hooks off), and supplement 4's sentence that sminos's tool "is not available here" would be false in every session this child serves. It says a picked option's place is counted from 1: on a real model, C3's live run saw an agent read the block's `"picks":[1]` as perhaps counted from 0 before it fell back to the label in the terminal envelope's line, and MAWS's steer has no label to fall back on. A session recorded under supplement 4 and resumed as a sheet launch has its prompt rendered anew by `decideFlags`' existing rule.
- **F7 · Two sentences of the app say what "Default" is, and they change** (§R). The owner read them and let them stand as written (2026-11-27).

**sminos (M1), a second pull request in doperpowers; the published set does not move.**

- **F8 · In a MAWS-run session the tool's result route and prompt route carry its notices and its contexts, and never an envelope.** That settles two things at once. An ended subagent's open questions are told to the main conversation on its next route (the composite's Acceptance 18), which today's code queues and never sends there. And the item C2 left for this child: a call's late outcome, told as a notice after three unanswered settles, now reaches the main conversation in a MAWS-run session as it does in a terminal one. What stays as doperpowers' TECH-DEBT row 54, in both kinds of session, is its other half: a subagent caller's late outcome is told to the main conversation and not to the subagent. Lost: MAWS carrying a notice in its steer. A notice quotes a question's words, which a user-role message may not hold.
- **F9 · The words of a subagent's question reach the main conversation as the tool's context on the message that answers it.** On a prompt that carries a `<sheet-delivery>` block, in a MAWS-run session, the tool asks the reader's model for the block's keys (`sminos sheet show --json --keys`), and for each answered outcome still pending whose asker is a subagent adds one line: the id, the revision, the asker, the question and its option labels in order (§S). The main conversation's own questions get nothing: the model holds them in its own calls, and after a compaction or a resume §5.5's context, which C2 built and which lists every open question and every outcome accepted and not yet delivered, has given them back before any steer arrives. The lines are composed in the mod, from the published `show` output, so neither the step, the command nor the set changes. Adding context for every answered question was weighed and lost: it would make the agent's naming of an option independent of §5.5, at the price of every answer carrying its question twice.
- **F10 · Nothing of the set changes.** The steer's form as published has no line for an outcome owed across a stop and no image line (the image's path is in the block). This child composes exactly that. Both are listed for the composite's writer as held for the set's next version, and neither is needed by C5's Acceptance.

**Delivery.**

- **F11 · The deliverer runs on the spine and is driven by the record.** It sends what `pending` holds for the main conversation and never anything because of a line it appended: the app's Send, the page's, `sminos sheet answer` and a line that arrives twice are one case to it. The reader and the door are on the spine (C3's S3; X5: this child adds no reader), and a record changes for reasons no window knows. Lost: the host reading records itself, which is a second instance of the reader in a process built to stay small.
- **F12 · The host owns what was sent: a flight is tied to its keys by a journal row written before the frame is.** The row `sheet_flight` names the engine session, the message's uuid and the keys (§U). Journaled first, the tie exists for every message the engine could have received, including one whose write the host never saw complete; a tie journaled with the write, as `ask`'s is, can be missing exactly then, and the next host would send again. The price is the other history: a tie for a message the engine never received. F21 settles both.
- **F13 · A flight is read when the engine has taken its message into a turn and echoed it into the conversation carrying its block.** Taken is the engine's `command_lifecycle` for the message saying `started` or `completed`: the rule `UnsettledFold` and the owner channel's follower hold, and the composite's writer's ruling that it stays the default reading. The echo is the engine's replay of a user frame (`--replay-user-messages`) whose text holds a block naming the flight's keys: its own frame's, or the one message the engine made of several that waited together. Taken alone is not enough, on the fixtures in hand: a prompt a hook blocked is `started` and `completed` with no echo and a `result` that names it with zero model turns (`pass3/hooks-flipped.jsonl`), and `/clear` is `started`, echoed as the command's own markup and `completed` the same way (`qsheet/qsheet-p5-d-clear.jsonl`). So: a `result` that names the message with zero model turns, the block not echoed, leaves the flight unread; and a frame the engine treats as a command never carries a rider (F17). Where the wire says neither (a turn that had model turns ends naming the message, and no echo carried its block), the engine's transcript decides (F21). The acknowledgement is appended on nothing less: it cannot be taken back. M2's P11 asks the pinned engine for the four cases the fixtures do not hold (§S), and a case where neither the wire nor the transcript can tell is listed for the composite's writer, not guessed.
- **F14 · The host refuses to send a key that is flying, undecided or read.** `session.sheetSteer` and `session.sheetRide` check the session's flights and journal the tie in one synchronous step. That check is the linearization point of "one delivery": the deliverer may be wrong about what is in flight (it learns of it late, and its events can be lost), and the host is not.
- **F15 · One composer, held to the published bytes** (§T): `src/shared/sheet/steer.ts` composes the steer from the model's `pending`, packs it as C2's I7 packs an envelope (batches whole, those that wake first, 60,000 UTF-16 code units, 200 keys, `More follows.`), and a test composes `examples/terminal/input/` and compares with `steer.txt` byte for byte. A subagent's question is named by its agent id and always as "which has ended": the record does not say whether a subagent whose send failed still runs, the published example was composed with none running, and the case where it does run needs a send the engine refused. An image travels as its absolute path in the block.
- **F16 · An answer wakes; a dismissal rides; an answer whose steer a Stop withdrew, or a hook blocked, rides while that process lives.** A waking answer gets a steer at once, which carries everything else owed with it. What rides leaves as the last block of the person's next message to the session, or with the next steer. The Stop's case is what keeps Stop meaning stop (the composite's writer's ruling, 2026-11-27): a steer written to an idle engine starts a turn, so sending the answer again right after the person stopped the turn would start one behind their back. It is the tool's own third route (§5.2: context on the human's next prompt after a turn the human stopped), and the side sheet keeps reading "Accepted. Not delivered yet." meanwhile. A blocked steer rides for another reason: sent again by itself, it would be blocked again, in a loop. Both hold for the process they happened in. Once that process has ended, the answer is an answer to a session with no process, and F20 starts it.
- **F17 · A rider is appended by the session to a frame the queue marks as the person's**: a submission from the app's queue, the person's own steer (the `session.steer` command), and a queued message promoted to a steer, each only when its own text does not open with `/`. Nothing the host itself composes carries one: not `ask`'s steer, not a sheet steer, not a consent message, not the plan sequence's frames (which `session.ts` writes without the queue). A text that opens with `/` may be a command, which the engine runs without a model turn (F13); MAWS does not know the session's commands, so it reads the slash alone and a rider takes the next message. The queue entry keeps the person's content untouched (as a linked read's block does), and the rider's tie is journaled as a steer's is.
- **F18 · A sheet steer is the host's own kind of steer in the queue.** It is not published among the pending steers a window shows, "Hold until the turn ends" does not apply to it, and a Stop withdraws it from the engine and drops it (the queue's `cancel`) where it holds a person's steer. Held into the app queue it would be sent later as an ordinary message under a new uuid while its keys, unread, were sent again: two deliveries. `ask`'s steer is untouched.
- **F19 · The acknowledgement is one `delivered` line per flight, keyed by the flight**: `maws-delivered-<message uuid>`, `by: 'maws'`, through the door. The key makes a resend the same act (after a timeout, a restart of the spine), and the model's `sent` showing that key applied is how the deliverer knows the record has it. The tool takes the keys out of `pending`; a session with no process applies the line at its next start, before anything else.
- **F20 · An answer starts any session MAWS ran last that has no process, once per answer** (the owner's ruling, 2026-11-27: "Start it"). Whatever ended the process: MAWS's release of an idle one, the machine restarting, a crash, the person ending it. In the app such a session looks like a released one, and a question may wait for days. A dismissal alone starts none. A session a terminal held last and an archived one are not started: their answers go at their next start. **The fact "MAWS ran it last" is read from two durable things, neither of them the digest's released mark**, which lives in memory and names only a release: the index's record, which says whether MAWS ever launched the session (`readRecordedRoute(record.gateway)` is null for a session MAWS only discovered), and the engine's transcript, each of whose records names the entrypoint that wrote it. MAWS ran it last when the newest record that names an entrypoint names MAWS's own (`OWN_ENTRYPOINT`, `sdk-ts`); a terminal that has written since leaves `cli` there. The host reads the transcript, since it follows the engine's store already, and answers with the flights (§V). **"Once per answer" is read from the journal, not remembered**: the answer's time (a queued line's `at`, a pending outcome's `acceptedAt`) is compared with the start of the newest launch of that engine session the journal holds; an answer older than that launch has had its start and gets no other. So a session that comes up without taking the sheet (sminos gone) is not started in a loop, across restarts of everything. An acquisition that fails before any launch (a folder gone, trust not given) is remembered for the spine's run only and tried again after it. The app's answer, the page's and the command line's are one case: the trigger is the record. Delivery happens while `mawsd`'s services are loaded; an answer given while they are not is seen when they next load, and the session is started then.
- **F21 · Where the journal cannot say how a flight ended, the engine's transcript decides, and nothing is sent again on a guess** (the composite's writer's ruling on the review's third finding). The journal can say a flight is read (F13) and that the engine itself dropped it (`cancelled`, `discarded`, `refused` before any start; a zero-turn `result`). Every other ending is silence: the process ended, the queue put the message back or abandoned it, the host that wrote the tie died on either side of the write, the replay had a gap. For each of those the flight is undecided, and the host reads the transcript: the flight is read if a user record's `uuid` or a queued command's `source_uuid` is the message's, or a record written since the tie carries the flight's block (the engine files several waiting messages under one uuid); otherwise it is unread. The transcript is the right arbiter because it is what every later request is built from: a message that is not in it will not be in the model's history, whatever a dead process once did with it. In a live process one more thing is asked first, of a flight the engine has never spoken of: the engine is told to cancel that message (`cancel_async_message`), which answers after anything the engine already had to say about it, so a flight still unspoken at that answer was never received. A transcript that cannot be read (gone, torn where it is read, an I/O error) leaves the flight undecided: it is asked again, and it holds its keys meanwhile as a flying one does.
- **F22 · Nothing of the sheet is in what a process exit would lose.** `SessionMaws.pending` is not touched; a test pins that a session with open sheet questions, a rider offered and a flight flying reads zero from it. A flight flying when its process ends is settled by F21 and, if unread, sent again by F20, so counting it would only delay a release.
- **F28 · Once the deliverer has seen a flight read, its acknowledgement no longer depends on the journal.** It writes the flight (engine session, message uuid, keys) to a small ledger of its own before it calls the door, and takes it out when the model shows the acknowledgement applied or the record no longer lists those keys. A key in the ledger is never owed. The journal prunes a session's launches past twenty and past thirty days (`pruneJournals`, `src/engine-host/journal.ts`); without the ledger a door that failed through twenty launches would turn a read flight into "never sent". With it, the journal's rows matter only until the first pass after the flight is read, which is in the same launch. It is the one thing the deliverer keeps on disk.
- **F29 · Every flight, every rider and every question to the host names the engine session, and the host checks it.** A record is one engine session's, and `/clear` gives a process a new one: a rider offered for the old sheet, or a pass that read the old record, must not write into the new conversation. The three commands carry the engine session's id; the host compares it with the session its process is in now, in the same synchronous step as F14's check, and refuses another's; a rider held for a session the process has left is dropped; a flight's keys are looked up within its engine session.
- **F30 · A pass that leaves something unresolved asks for itself again.** Nothing else may ever change: an acknowledgement the door did not take, a session not yet ready, a flight undecided, a host that did not answer. Such a pass schedules its next one after two seconds, doubling to five minutes, and a pass that leaves nothing unresolved clears the schedule. §W says what each of the door's refusals leaves.
- **F31 · Whether a running process is a sheet launch is read from its own launch, not from what the host can do today.** A host of before this child already launches `question: 'engine'` without the variable, and a new host that adopts such a process lists the capability though that engine never took the sheet. The test is the launch's spawn row: its environment's names hold `MAWS_QUESTION_SHEET`. The one skew left open is a `mawsd` replaced by an older build while a sheet launch runs: answers are accepted by the tool and nobody delivers them until `mawsd` is this build again; the side sheet reads "Accepted. Not delivered yet." throughout. It is logged, not built around.

**What draws, and what else reads.**

- **F23 · MAWS's steer is the fourth carrier of a sheet's envelope, read by its form.** A text block of a person's row that is, whole, one envelope in the steer form, and a slice of a joined text that is one, is the sheet's: it is taken out of the person's words (`readPersonsContent`) and becomes the `sheet` arrival C3's rows already read. It is read by form on all three routes (live, a file's rows, another machine's rows), as MAWS's `ask` envelope is, so a session read from the engine's transcript alone draws the same. That reading draws and nothing else: no state moves on a prompt's text (the composite's §5.4), and a person who types an envelope sees a receipt drawn on a row and no more. Lost: marking the event from the journal's tie, which is exact and exists on one route of three.
- **F24 · A MAWS-run session's sheet item is announced as an asynchronous `ask`'s is**: once per call (C3's S11), in the app while it is focused and by a system notification while it is not. A terminal session's stays in-app only. The test is the record's holder (`self`), read where the notifier reads the record.
- **F25 · The channel journal takes a sheet question from the live call and its outcome from the record.** The question is what a MAWS process said (the rule of every lane B entry): at the live result of a sheet call, each entry the result's first line says was added becomes one `question` entry, with its options' labels as choices. The outcome is the record's, because the call's history does not hold it: a running subagent is answered directly, and a withdrawal and an answer accepted at a start reach no steer. When a recorded question is pending or closed in the model, one `answered` entry is recorded: the answer, "Dismissed" or "Withdrawn". It is looked for at each change of the record and again when the question's own entry is recorded, since an answer can be faster than that entry and nothing of the record changes afterwards. A revise records nothing new: one question, one outcome. The renderer's join learns the anchor's form.
- **F26 · A session set to `maws` is proven unchanged by the suites that hold it today**, named in M3 and M8, and by one new pin: its launch environment holds neither variable.
- **F27 · The engine is asked before MAWS is built on its answer.** M2 runs MAWS's own launch line with sminos loaded and settles what only the engine can say (§S, P6 to P13), each answer with a written branch or a named stop; its recordings are the fixtures the later milestones replay. What needs a model that reads (the agent naming the option it was sent by place) is asserted by M8's driver on a real model under a cap, and nothing else in this child spends.

## The delivery's state machine

Fixed here before any of it is built, because it is one state machine across four processes (the tool, the door, the spine, the host), and a functional description alone is how such things get built one flag at a time. The tables come first; §U to §W are their interfaces.

### Who acts, and on what

| actor | where | what it changes |
|---|---|---|
| the tool | sminos's mod and step, inside the session | `state.json`: applies inbox lines, moves a recipient, takes acknowledged keys out of `pending` |
| a surface | the app, the page, `sminos sheet` | appends answer, dismiss and retract lines through the door |
| the deliverer | the spine | asks the host to send; keeps the ledger of read flights; appends `delivered` lines through the door; asks the session service to start a session |
| the host | the engine host's session | writes the frame; journals the tie and reads how it ended; settles a flight from the transcript; holds one offered rider per session in memory |
| the engine | the pinned binary | starts, echoes, drops or never receives a message |

### An outcome, as the deliverer sees it

An outcome is MAWS's when the model lists it in `pending` with recipient `main`. For each such key, in this order:

| the key's standing | name | what the deliverer does |
|---|---|---|
| in the ledger | **read, to acknowledge** | append the acknowledgement unless the model's `sent` shows it queued or applied; never send |
| its latest flight is read | **read** | write it to the ledger, then as above |
| its latest flight is flying or undecided | **in flight** | nothing; an undecided one is asked about again (F30) |
| no flight; or its latest flight is unread and was dropped, absent, or of a process that has ended | **owed, wakes** if an answer; **owed, rides** if a dismissal | a waking key: send a steer now, carrying everything owed. Riders alone: offer them as the session's rider |
| its latest flight is unread, stopped or blocked, in the process that is live now | **owed, rides** | offer as the rider |

A key leaves the table when the model no longer lists it in `pending`.

### A session, as the deliverer sees it

| the session | what a pass may do |
|---|---|
| held by MAWS, its process ready, its launch a sheet launch (F31) | send a steer; offer a rider; acknowledge |
| held by MAWS, not ready | acknowledge; wait (F30) |
| held by MAWS, its launch not a sheet launch | nothing until its next launch |
| held by a terminal or a background job | nothing: the tool there delivers its own |
| no process, archived | nothing |
| no process, MAWS never launched it (the index) | nothing, and the host is not asked |
| no process, a terminal ran it last (the transcript) | nothing: its answers go at its next start |
| no process, MAWS ran it last | acknowledge what is read; start it for an answer that has had no start (F20) |

### A flight, as the journal says it

Rows are read in order. `U` is the flight's message uuid. A flight is **flying** until a row makes it **read**, **unread** or **undecided**; read and unread are final, and an undecided flight moves only at a `sheet_flight_settled` row or, for a launch that is over, by the transcript's word when it is asked (§U). While flying it carries four marks, each set once: *spoken* (the engine has named it at all), *taken*, *echoed*, *withdrawing*.

| row | while | the flight becomes |
|---|---|---|
| `meta` `sheet_flight` naming `U` | no flight `U` | flying |
| `in` `command_lifecycle` naming `U`, state `queued` | flying | spoken |
| `in` `command_lifecycle` naming `U`, state `started` or `completed` | flying | spoken, taken; **read** if echoed |
| `in` `user`, `isReplay` true, whose text holds a block naming exactly the flight's keys | flying | echoed; **read** if taken |
| `in` `result` whose `user_message_uuids` hold `U`, `num_turns` 0 | flying, not echoed | **unread**, blocked |
| `in` `result` whose `user_message_uuids` hold `U`, `num_turns` above 0 | flying, taken, not echoed | **undecided** |
| `in` `command_lifecycle` naming `U`, state `cancelled`, `discarded` or `refused` | flying, not taken, not withdrawing | **unread**, dropped |
| the same | flying, taken | no change (a turn aborted after it began; the echo or the turn's `result` decides) |
| the same | flying, withdrawing | withdrawing, dropped (the host's own row decides) |
| `meta` `queue`, action `withdraw`, naming `U` | flying | withdrawing |
| `meta` `queue`, action `cancel` or `hold`, naming `U` | flying | **unread**, stopped |
| `meta` `queue`, action `giveback`, naming `U` | withdrawing, dropped | **unread**, dropped |
| the same | withdrawing, not dropped | flying, no longer withdrawing |
| `meta` `queue`, action `abandon` or `revert`, naming `U` | flying | **undecided** |
| the launch's `exit` row, or the launch's rows ending where a later launch begins or no process is | flying | **undecided** |
| `meta` `sheet_flight_settled` naming `U`, `as: 'seen'` | flying or undecided | **read** |
| the same, `as: 'absent'` | flying or undecided | **unread**, absent |
| the same, `as: 'stopped'` | flying, withdrawing | **unread**, stopped |

`cancel` and `hold` are written only when the host itself withdrew the message and the engine said it had: for a sheet steer that is a Stop (F18), for a person's steer that carried a rider a Stop or the person's own hold. Both are "stopped". `sheet_flight_settled` is written only by the host's settling, below.

### How the host settles what the journal leaves open

The fold reads; the host settles, and journals what it found so the fold stays a reading of the journal. Four moments, one procedure each:

| moment | which flights | what the host does |
|---|---|---|
| an adoption has caught up with the engine (`EngineSession.caughtUp`) | withdrawing, dropped: the host that was withdrawing it died after the engine's `cancelled` and before its own row | journals `settled`, `as: 'stopped'` |
| the same | withdrawing, not dropped | nothing: the engine still holds it, the fold reads it flying again at the next row about it, and the new host's queue takes it as a host steer |
| the same; and a write that was rejected or reverted | flying, not spoken | reads the transcript: holds it, `as: 'seen'`. Else asks the engine to cancel `U` and reads the answer: if the engine has spoken of `U` by then, the table has it; if not, `as: 'absent'` |
| a `result` left a flight undecided, the process live | that flight | reads the transcript: holds it, `as: 'seen'`; else `as: 'absent'` |
| a question about a launch that is over (`session.sheetFlights`) | undecided | reads the transcript and answers read or unread, absent; journals nothing, since that launch's journal is closed, and reads again when asked again |

A transcript that cannot be read leaves the flight as it was, in every row. A request to the engine that fails leaves it as it was.

### Where a fact becomes true

- **An outcome exists** when the tool's step replaces `state.json` with it in `pending`. Nothing before that (a line appended, a door's `queued`) is acted on.
- **A key is being sent** when the host journals `sheet_flight`, in the same synchronous step as its checks that the engine session is the one named and that the key is neither flying, undecided nor read (F14, F29). The frame is handed to the writer after it.
- **A key is delivered** when the journal holds both rows of F13 for its flight, or a `settled` row saying the transcript holds it.
- **The deliverer will not send it again** when its ledger holds the flight (F28).
- **The record knows** when the tool's step applies the `delivered` line.

### What each failure leaves

Each row names the test that holds it, by the milestone it is in.

| what happens | what the journal and the record hold | what follows | test |
|---|---|---|---|
| a second answer to the same question | the tool's verdict `closed`; nothing new in `pending` | nothing is sent for it | M6 (`two-surfaces`), M8 scene 3 |
| a retract queued before the answer was applied | nothing in `pending`; the session is not started for a cancelled answer | nothing is sent | M6 (`retract-queued`), M8 scene 3 |
| a retract after | verdict `too-late`; the outcome stays | it is sent like any other | M6 (`retract-too-late`), M8 scene 3 |
| the same line sent twice | the first verdict again; one outcome | one flight | M6 (`resent-key`), M8 scene 3 |
| the steer waits and the person presses Stop | `withdraw`, the engine's `cancelled`, `cancel`: unread, stopped | the keys ride the person's next message | M4 (fold), M5 (queue), M8 scene 8 |
| the host is replaced inside that Stop, after the engine's `cancelled` | `withdraw`, `cancelled`, no `cancel`; the adopter's `settled`, `as: 'stopped'` | the same: the keys ride, are read with that message, are acknowledged | M4 (fold), M5 and M6 (`e2e:supervisor-daemon`) |
| the engine discards or refuses the steer | unread, dropped | a new steer | M4 (fold), M6 |
| a hook blocks the steer | `started`, no echo, a zero-turn `result`: unread, blocked | the keys ride | M2 (P11), M4 (fold on the recording), M6 |
| a turn with model turns ends naming the steer and nothing echoed its block | undecided; the host reads the transcript | read or unread, absent, by the transcript | M2 (P11), M4, M5 |
| the person's message that carried a rider is `/clear` or another command | never: a text opening with `/` takes no rider. If one did, the zero-turn `result` leaves it unread | the rider takes the next message | M5, M2 (P11) |
| the engine process ends with the steer waiting | `abandon` or the launch's end: undecided; the transcript does not hold it: unread, absent | the session is started for it (F20) and it is sent | M4, M5, M6, M8 scene 7 |
| the engine process ends just after taking the steer, the lifecycle rows lost | undecided; the transcript holds it | read; acknowledged; never sent again | M4, M5 |
| the host is replaced after the write, before `started` | the tie and the `out` row; the adopter replays `started` and the echo | read; the acknowledgement follows; nothing is sent again | M4, M5, M6 (`e2e:supervisor-daemon`), M8 scene 14 |
| the host dies after the tie and before the frame left it | the tie; no `out` row; the engine never speaks of `U` | at the adoption: the transcript lacks it, the engine's cancel answers and has not spoken: unread, absent; sent again | M5 (death before the write) |
| the host dies after the frame left it and before the `out` row | the tie; no `out` row; the engine speaks of `U` in the replay | the table: read, or still flying | M5 (death after the write) |
| the replay had a gap | rows missing between two the journal has | flights not spoken of are settled as at any adoption; a taken flight with no echo waits for its `result`, then the transcript | M5 |
| the transcript cannot be read when it is needed | the flight is as it was | nothing is sent; the pass asks again (F30) | M5, M6 |
| `/clear` between the deliverer's read of the record and its request | the request names the old engine session | the host refuses it (`other_session`); the old record is gone and its keys with it | M5, M6 |
| `/clear` between a rider's acceptance and the person's next message | the rider is held for the old engine session | dropped at the next frame; nothing of the old sheet enters the new conversation | M5 |
| the host is replaced while a rider is offered | the adopter holds none; its answer to `sheetFlights` says so | the next pass offers it again | M6 |
| the spine restarts after the flight is read, before the ledger has it | read, in the journal; the key still in `pending` | the pass at the start asks the host, ledgers, acknowledges, sends nothing | M6 |
| the acknowledgement's door call fails or times out | the ledger has the flight; perhaps a `delivered` line, perhaps not | the same line again under the same key, by the pass's own retry | M6 (the door recovers and nothing else changes) |
| the journal prunes the flight's launch before the acknowledgement is applied | the ledger has the flight | acknowledged from the ledger; never sent | M6 |
| a session MAWS ran last has no process, for any reason, and an answer is queued | no launch of it since the answer | started once; the tool applies; sent | M6, M8 scenes 6, 7, 15 |
| the same, and the session came up without the sheet | a launch since the answer; the line still queued | not started again, across restarts | M6 |
| a session a terminal ran last, or an archived one, has an answer queued | the transcript's newest entrypoint is not MAWS's; or the record's flag | nothing; it goes at its next start | M6, M8 scene 15 |
| a session resumed in a terminal with a key read and not yet acknowledged | the terminal's tool finds it pending | it may be told again there; a window of one acknowledgement, accepted as §6 accepts its like | none: accepted |

## Interfaces and Dependencies

`R/` is `src/renderer/src/`; `H/` is `sminos/hooks/mods/` and `S/` is `sminos/skills/sminos/scripts/` in doperpowers. Sections continue C4's letters (§X is skipped, since X1 to X7 are the composite's contracts). A milestone's name in a heading is where the interface is built. Code is given where it is itself the decision.

### §R · The launch (M3)

`src/shared/host/socket-protocol.ts`:

    export const ENGINE_QUESTION_SHEET_CAPABILITY = 'engine.questionSheet';   // in PEER_CAPABILITIES.engineHost; src/engine-host/detached.test.ts pins the welcome word for word

`src/engine-host/launch.ts`:

    export const QUESTION_SHEET_ENV = 'MAWS_QUESTION_SHEET';
    export function buildEnvironment(spec, captured, relayUrl, spawnerPid, holder, sessionId: SessionId): Record<string, string>

`buildLaunch` passes the id it resolved. `env[QUESTION_SHEET_ENV] = sessionId` exactly when `(spec.mawsTools ?? FULL_MAWS_TOOL_SET).question === 'engine'` and the spec names the home (`spec.extraSettings?.env?.SMINOS_HOME` is a non-empty string); no other launch has the key, whatever the captured environment holds. The spawn row's `envKeys` then hold the name, which is F31's test of a launch. An adopter's rebuilt plan (`environmentRebuilt`) is not the engine's environment and nothing reads the variable from it. Another branch (`ux-wave/obs4`) adds one argument to every launch in this function or its argument builder; the two changes touch neighbouring lines and merge by hand.

`src/services/sessions/launch-mapping.ts`:

    export const SMINOS_HOME_ENV = 'SMINOS_HOME';
    LaunchInput: sminosHome?: string                                   // the home MAWS's reader reads; written only where the set's question is `engine`
    intentLaunchSpec / resumeLaunchSpec ctx: sminosHome?: string | null

`extraSettingsOf` adds `SMINOS_HOME` to the settings' `env`, beside `CUA_BROWSER_BACKENDS`, when `input.mawsTools?.question === 'engine'` and `input.sminosHome` is set. The three callers that build a spec for a turn (`runIntentSetup`, `runResume`, `prestartLaunch`) pass it through the same builders, so a prestart's spec and its Send's are equal under `sameLaunchSpec`; a test builds both for one Default intent and compares them.

`src/services/sessions/setup-steps.ts`, on `Setup` (where `hostLists` is):

    sheet: { home(): Promise<string | null>; holds(engineSessionId: SessionId): Promise<boolean> } | null   // null: no sheet service this run

wired in `src/services/spine-root.ts` from the same `home` promise `createSheetService` is given (a rejection is null) and from `SheetService.read` through `sheetHolds`.

`src/shared/sheet/read.ts`:

    export function sheetHolds(model: SheetModel | null): boolean   // an open or hidden question, a pending outcome, or a `sent` entry of state `queued`

`src/services/sessions/served-set.ts`:

    export async function sheetOverride(s: Pick<Setup, 'hostLists' | 'sheet' | 'log'>, set: MawsToolSet, engineSessionId: SessionId | null): Promise<MawsToolSet>

F5's rule: `{ ...set, question: 'engine' }` when the set's question is `maws`, the engine session is named, the host lists `ENGINE_QUESTION_SHEET_CAPABILITY` and `s.sheet.holds` answers true; else the set as given. `runResume` calls it on the record's set before `servedSet`. `runIntentSetup` and `prestartLaunch` do not: a new session and a fork have no sheet.

`src/services/owner/launch.ts` and `src/shared/owner/contract.ts` (X18, amended): the decision's `question` gains a third value, `sheet`, taken when the spec's question tool is `engine` and the host lists the capability; `APPENDS['external-style-plus-supplement'].sheet = { text: 'supplement-sheet', records: 'supplement:5' }`; `AppendedText` gains `'supplement-sheet'`. The text, exact and pinned by a test word for word:

    SUPPLEMENT_5.text = `${SUPPLEMENT_HEADER(5)}\n\nThis session runs in MAWS. ${ASK_SHEET}`
    ASK_SHEET = 'Ask the human with `mcp__sminos__AskUserQuestion` where it is listed: it puts your questions on this session\'s sheet and returns at once, and their answers arrive later as a user message that names each question by its id and each picked option by its place among the options you gave, counted from 1. Where it is not listed, ask with the native AskUserQuestion, which waits for their answer. `mcp__doperpowers__AskUserQuestion` is not available here.'

Supplement 4 stays, for a Default launch on a host without the capability.

**The two sentences** (F7), each replacing the one that says "Claude Code's own"; the owner let them stand as written (2026-11-27):

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

**What the probe must show** (M2; P6 to P13 continue C0's P1 to P5). Scenario `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, built on `p1-common.mjs` as `qsheet-c0.mjs` is: MAWS's launch line and initialize, a scratch configuration home, a scratch sminos home, the scripted Messages API stand-in (`stub-api.mjs`), the direct tell's mod and the doperpowers checkout's sminos both by `--plugin-dir`, function hooks on; for P11 a blocking prompt hook in the scratch settings, as `pass3/hooks-flipped` has. Fixtures `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-*.jsonl`; findings `spikes/protocol-probe/findings-qsheet-c5.txt`; tests in `spikes/protocol-probe/fixtures.test.mjs` under "question sheet C5". Every host-written frame in a scenario is composed by hand as §T says, since M4's composer is later held to the same bytes.

The probe has two sittings. **Sitting A** needs no code of this child in either repository (doperpowers at `main`) and starts at once. **Sitting B** needs M1's branch. Every probe has, for each answer it can give, a branch a later milestone runs or a stop that goes to the composite's writer with the fixture; a stop halts the milestones named and no others.

| id | sitting | question | fixture | each answer, and what it leaves |
|---|---|---|---|---|
| P6 | A | Does `SMINOS_HOME` given in `--settings`' `env` reach the mod's `$.env.get` and the processes it starts (the step, the bridge), from the process's first `session.start`? | `-launch` | **Yes:** F4 as written. **No (B6):** the home travels as a spec field. `LaunchSpecSchema` gains `sminosHome: z.string().optional()` (`src/shared/engine/launch-spec.ts`), written by the same builders for the same launches and never sent to a host without the capability; `buildEnvironment` sets `SMINOS_HOME` from it, and F2's "the spec names the home" reads the field. The wire's minor then rises in M3 as well as in M5, and M3's entry says so |
| P7 | A | With `MAWS_QUESTION_SHEET` equal to the session's id in the process environment, on a new session, a resume and a fork: does `system/init` list sminos's tool, does the model's request hold its sheet schema and not the built-in, with both plugin directories loaded? | `-launch`, `-resume`, `-fork` | **Yes:** F2. **No (stop S7):** C2's proof does not hold on MAWS's launch; M3 to M8 wait for the writer |
| P8 | A | A resume whose record holds an open question and a queued answer, with nothing written by the host after initialize: is the answer applied (in `pending`, recipient `main`), and does the first request after the host's steer hold §5.5's context once? | `-resume` | **Yes:** F20's sequence as written. **Applied only after a first prompt (B8):** M1 gains one change, in the mod alone: in a session whose runner is `maws` the start is ordered at the mod's own `session.start`, without waiting for a prompt (C2 already orders it there when the classic SessionStart came early). **The mod cannot (stop S8):** the start needs what only a prompt gives; M6's F20 waits for the writer, since under the owner's ruling an answer to a session with no process has no prompt to send |
| P9 | A | A steer in §T's form: written idle; written during a tool call; written during a tool call and then withdrawn with `cancel_async_message`. And a person's frame of two text blocks whose last is an envelope (a rider). For each: the lifecycle rows, the echo and what it carries, the `result` and what it names, and what the model's requests hold | `-steer`, `-cancelled`, `-rider` | **As the fold's table has it:** proceed. **An echo of the rider's frame that does not carry the block (B9):** for carrier `rider` the fold takes the echo of the frame's own uuid as the echo. **Any other row differing:** the table is corrected to the fixture before M4 by this document's writer, and the correction is listed for the composite's writer. **A state that no row and no record of the transcript can tell (stop S9):** M4 to M6 wait |
| P10 | A | A `delivered` line put through the door while the session runs: is it applied through the observing bridge's `sheet` op, does the key leave `pending`, and does a steer's own text land nothing? | `-delivered` | **Applied at once:** F19. **Applied only at the tool's own check, seconds later (B10):** F19 stands and M8's waits are for the record, not a time. **Never applied while the session runs (stop S10):** M6 waits |
| P11 | A | The four cases F13 has no fixture for. (a) A `next` steer written idle that a prompt hook blocks. (b) One written during a tool call that the hook blocks; and one whose turn is interrupted before the next tool round. (c) Two steers waiting together, which the engine files as one message. (d) A frame that is a command (`/compact`) with an envelope appended, as a rider would be | `-blocked`, `-blocked-mid`, `-joined`, `-command` | **(a) `started`, no echo, a zero-turn `result` naming it:** unread, blocked, as the table has it. **No `result` names it:** the flight is undecided at `completed` with no echo (one more row in the table), and the transcript decides. **(b) `cancelled`, `discarded` or `refused`:** dropped. **`started` with no echo:** undecided at the turn's `result`; the transcript decides. **Echoed and yet not in the model's request:** the wire cannot tell and the transcript holds it; this is the stated limit, listed for the writer with the fixture, and the flight reads read. **(c) the joined echo holds each block on a line of its own:** both read, as the table has it. **A block broken by the join (stop S11):** M4 waits; a sheet steer would have to be kept from waiting beside another message. **(d) a zero-turn `result`, the echo the command's own markup:** unread, blocked, which is the backstop behind F17. **Anything else:** F17's rule is all that keeps a rider off a command, and M5 adds a test that no path attaches one |
| P12 | A | `cancel_async_message` for a uuid the engine never received: what it answers, and that it writes no frame | `-unknown-cancel` | **`cancelled: false`, no frame:** F21's live settling as written. **An error, or a frame (B12):** a flight not spoken of in a live process is left undecided until its launch ends, and the fourth row of the settling table loses its second sentence; the cost is an answer that waits for the process's end, logged |
| P13 | B | With M1's branch: the context on a steer that answers an ended subagent's question; the ended subagent's notice on the next route; whether the mod's prompt hook sees the engine's own notification prompt | `-subagent` | **The context and the notice are in the model's requests, once each:** F8, F9. **Either missing:** a fault of M1, fixed there before its pull request merges. **The hook does not see the notification prompt:** no change; the notice takes the next result or prompt |

The recordings are also what M4 to M7 replay. They are an engine's rows alone: the probe is not MAWS's host, so they hold no `sheet_flight`, no queue row and no `host_attach`. M4's tests put the host's rows in by one helper (`test/support/sheet-flight-rows.ts`, `withHostRows(recording, flights)`), which inserts each row where §V writes it: `sheet_flight` immediately before the recorded `out` `user` row of that uuid, `withdraw` before the recorded cancel request, `cancel` after its answer. M5's own tests then produce the same rows from the real session over a fake transport, and one test compares the two orders.

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

### §U · Flights (the fold M4; the rows and the settling M5)

`src/shared/sheet/flight.ts` (the shape the wire, the host and the spine share):

    export type SheetFlightState = 'flying' | 'read' | 'unread' | 'undecided';
    export interface SheetFlight { engineSessionId: string; messageUuid: string; keys: string[]; carrier: 'steer' | 'rider'; state: SheetFlightState;
                                   why?: 'dropped' | 'stopped' | 'blocked' | 'absent'; live: boolean }   // `why` with unread; `live`: of the process that runs now
    export const ackKeyOf = (messageUuid: string): string => `maws-delivered-${messageUuid}`;

`src/engine-host/sheet-flights.ts`:

    export class SheetFlights {
      push(row: JournalRow): void;                                      // the table "A flight, as the journal says it", and nothing else
      over(): void;                                                     // this launch has no process: what is flying is undecided
      holds(engineSessionId: string, keys: readonly string[]): string[];   // those of `keys` that are flying, undecided or read, in that engine session
      of(engineSessionId: string, keys: readonly string[]): SheetFlight[];  // each key's latest flight; a key in none is in no entry
      open(): SheetFlight[];                                            // every flight flying or undecided, with its marks: what a settling and an adopter's queue read
    }
    export function transcriptHolds(records: AsyncIterable<unknown>, flight: Pick<SheetFlight, 'messageUuid' | 'keys'>, since: string): Promise<boolean>
    export async function sheetFlightsOf(dir: string, appSessionId: AppSessionId, engineSessionId: string, keys: readonly string[], live: SheetFlights | null, transcript: (engineSessionId: string) => AsyncIterable<unknown> | null): Promise<SheetFlight[]>

The rows, all `meta`, journaled through the session's `record`:

    { event: 'sheet_flight', engineSessionId, messageUuid, keys: string[], carrier: 'steer' | 'rider' }   // before the frame is written (F12)
    { event: 'sheet_flight_settled', messageUuid, as: 'seen' | 'absent' | 'stopped' }                      // the host's settling, and only it
    { event: 'sheet_rider', engineSessionId, keys: string[] }                                              // the rider the session holds now; [] when it holds none

The normaliser's `pushMeta` ignores an event it does not know, the replay skips meta rows, and the backfill reads no journal, so the rows need no wire event and no older reader breaks on them. `sheet_rider` moves no flight: it is the record of an offer, for a reader of the journal and for M8's driver.

`transcriptHolds` is F21's rule: a user record whose `uuid` is the message's; a queued command attachment whose `source_uuid` is; or a user record or queued command whose time is not before `since` (the tie's) and whose text holds a block naming exactly the flight's keys. It reads records and decides nothing about files: the caller turns "cannot be read" into "leave the flight as it was".

`sheetFlightsOf` answers for the keys asked, within one engine session: from the live fold first, then from the app session's earlier launches newest first (`JournalReader.launches`, each folded through a fresh `SheetFlights` and ended with `over()`), stopping once every key has a flight or the launches end. A key's latest flight is the first found. An undecided flight of a launch that is over is settled there and then from the transcript, by `transcriptHolds`, and answered read or unread, absent; where the transcript cannot be read it is answered undecided. The host caches such an answer for its own run, since a transcript's past does not change.

Tests are the table, row by row, each as a journal of a few rows, and each row of "What each failure leaves" that names M4: the recordings of M2 with the host's rows put in (`-steer` to read; `-cancelled` to unread, stopped; `-blocked` to unread, blocked; `-joined` to two flights read by one echo; `-command` to unread, blocked; `-rider` to read); a journal with `host_detach` and `host_attach` whose replayed `started` and echo arrive after the attach; `withdraw` and the engine's `cancelled` with no row of the host's after them; a launch that ends with a flight flying, with a transcript that holds it, one that does not, and one that cannot be read; two launches, the key's flight in the older; two engine sessions in one launch (a `/clear`), the same key string in both.

### §V · The host: two ways a delivery is written, and the question of what was (M5)

`src/shared/ipc/` (`names/session.ts`, `schema/session.ts` as a group `SHEET_SESSION_COMMANDS`, `grades/session.ts`), owner `engine-host`:

    session.sheetSteer   { appSessionId, engineSessionId, text, keys }
                         → { status: 'written'; messageUuid } | { status: 'refused'; reason: 'not_ready' | 'not_sheet' | 'other_session' | 'in_flight' | 'not_written'; keys?: string[] }
    session.sheetRide    { appSessionId, engineSessionId, rider: { text, keys } | null }
                         → { status: 'held' } | { status: 'refused'; reason: 'not_sheet' | 'other_session' | 'in_flight'; keys?: string[] }
    session.sheetFlights { appSessionId, engineSessionId, keys }
                         → { flights: SheetFlight[]; process: 'live' | 'none'; sheetLaunch: boolean | null; rider: string[] | null;
                             ranLast: 'maws' | 'other' | null; launchedAt: string | null }

`text` is at most 60,000 UTF-16 code units and must hold for `isSteerEnvelope`; `keys` is 1 to 200 keys of the inbox line's pattern (0 to 200 for `sheetFlights`), and for the two that send equals the keys of the text's block: the handler parses the block and refuses a mismatch as a schema error, since the tie must name what the text carries. A caller with more than 200 keys asks in several calls. All three are deadline shape `immediate`; `sheetFlights` for a launch that is over may read a transcript and has the budget `session.promptHistory` has. No remote caller reaches them: they join neither `src/endpoint/offers.ts` nor `ENGINE_HOST_ACTS` in `src/main/lane-b/remote.ts`, and a test over the offer table says so. The deliverer runs on the session's own machine; what C6 carries is reading a sheet and appending to it.

What each does, in `src/engine-host/session.ts` (handlers in `ipc.ts`). The refusals are checked in this order, and the last check and the tie's row are one synchronous step with no await between them:

- **`sheetSteer`.** `not_sheet`: the launch's spawn row does not name `MAWS_QUESTION_SHEET` among its environment's keys (F31; an adopted session reads the row it adopted). `not_ready`: the process is not `ready`. `other_session`: the engine session the process is in now (`sessionId()`, which a `/clear` moves) is not the one named. `in_flight`, naming them: `SheetFlights.holds(engineSessionId, keys)` is not empty. Otherwise `MessageQueue.steer(text, { priority: 'next', host: true, before })`, whose `before(messageUuid)` journals `sheet_flight` with carrier `steer`. A write that is rejected answers `not_written`, and the session then settles that flight as the table's third row says (the transcript, then the engine's cancel), so a refused write ends as unread, absent, and a frame that did leave is found.
- **`sheetRide`.** Refused as `sheetSteer` is, but never for readiness: a rider waits. It holds the rider, with its engine session, in the session's memory, replacing the one held; `null` clears it; either way it journals `sheet_rider`. Offering the rider the session already holds changes nothing and answers `held`. When the queue next writes a frame it marks as the person's (F17) whose text does not open with `/`, the session, in one synchronous step: drops the rider if the process is in another engine session or any of its keys is flying, undecided or read (journaling `sheet_rider` with no keys); else appends it as one more text block after everything else, journals `sheet_flight` with carrier `rider` for that frame's uuid, and forgets the rider (`sheet_rider` with no keys). A rider is in place for the person's next message from the moment its `sheet_rider` row is journaled, and not before: a message the person sends in the instant between a dismissal being applied and that row goes without it, and the dismissal takes the message after. Nothing orders the two, and nothing needs to: a dismissal starts no turn and is owed no particular message.
- **`sheetFlights`.** `sheetFlightsOf` for the keys, with the live fold when the session has a process; `sheetLaunch` is F31's test of the newest launch of that engine session (null: none on record); `rider` the keys of the rider held for that engine session, or null. `ranLast` is F20's fact, read only when the session has no process: `maws` when the newest record of that engine session's transcript that names an entrypoint names `OWN_ENTRYPOINT` (`src/engine-host/fs/holders.ts`; the tail's records, as `src/engine-host/fs/summarize.ts` reads a tail), `other` when it names another, null when the transcript is missing or holds no such record. `launchedAt` is the time of the `spawn` row of the newest launch of that engine session the journal holds, or null.

**Settling** (`EngineSession`, the table "How the host settles what the journal leaves open"): at `caughtUp` after an adoption, at a rejected or reverted write of a frame that has a flight, and at a `result` that leaves a flight undecided. Each reads `SheetFlights.open()`, reads the transcript through the host's own reader of the engine's store (`src/engine-host/fs/`), asks the engine where the table says (`cancel_async_message`, the request the queue's `cancel` dep already makes), and journals `sheet_flight_settled`. It runs once per moment and per flight, awaits nothing the session's other work waits on, and a failure is logged and leaves the flight as it was; `sheetFlights` asked later finds it still open and the settling runs again.

`src/engine-host/queue.ts`:

    steer(content, opts?: { priority?: SteerPriority; preface?: Record<string, unknown>[]; before?: (messageUuid: MessageUuid) => void; host?: true }): Promise<{ messageUuid: MessageUuid }>
    MessageQueueDeps.write(frame, opts?: { preface?: Record<string, unknown>[]; person?: true }): Promise<void>

`before` runs after the readiness check and before the write; if it throws, the steer rejects and nothing is written. A steer with `host` is kept apart from the pending steers the queue publishes: it is in no `QueueState.steers`, `hold` and `cancelSteer` refuse its uuid as they refuse one that already started, and a Stop's withdrawal phase (`holdAll`) asks the engine to cancel it and, when the engine did, journals `cancel` and drops it; `settleAfterExit` abandons it with the rest. An adopter learns the host steers still waiting from `SheetFlights.open()`: the flying flights of carrier `steer` that are not taken. `person: true` is passed by the three paths of F17 and by nothing else.

`EngineSession`: the fold is fed by `record` (every row, live) and by `fold()` at an adoption, before the session connects or answers a command; `over()` at the process's exit.

`src/engine-host/journal.ts`: nothing changes. F28 is why pruning needs no rule of the sheet's.

Capability: M3 adds `engine.questionSheet` with the variable and this section arrives in M5; M3 to M8 land as one pull request, so no host that is ever released lists it without these commands.

### §W · The deliverer, the ledger and the acknowledgement (M6)

`src/services/sheet/service.ts`, on `SheetService`:

    acknowledge(session: string, flight: { messageUuid: string; keys: string[] }): Promise<SheetPutResult>

One inbox line through the door, `{ v: 1, key: ackKeyOf(messageUuid), kind: 'delivered', keys, by: 'maws' }`, for a session that has a record; the same refusals and the same locate rule as `put`. `put` goes on refusing a `delivered` line from any caller: only this method writes one, and nothing on the wire reaches it. `src/shared/sheet/model.ts` gains the line's schema (`SheetDeliveredLineSchema`), and `putLines` (`door.ts`) takes it. The stand-in door (`test/support/fake-sminos-cli.mjs`) appends it like any line; a staged outcome that follows it is the fixture `delivered-mixed`'s.

`src/services/sheet/ledger.ts` (F28):

    export interface ReadFlight { engineSessionId: string; messageUuid: string; keys: string[]; at: string }
    export interface SheetLedger { all(): ReadFlight[]; of(engineSessionId: string): ReadFlight[]; add(flight: ReadFlight): Promise<void>; remove(messageUuid: string): Promise<void> }
    export function openSheetLedger(file: string): Promise<SheetLedger>     // <profile>/sheet-read-flights.json, beside the machine's settings files, replaced atomically as they are

`add` resolves only once the file is replaced. A file that cannot be parsed is kept beside itself under another name and read as empty, logged: the cost is one acknowledgement that again depends on the journal. A file that cannot be written fails `add`, and the pass then does not call the door for that flight and asks for itself again (F30), so a flight is never acknowledged-in-progress without being in the ledger.

`src/services/sheet/delivery.ts`:

    export interface SheetDeliveryDeps {
      sheet: Pick<SheetService, 'list' | 'read' | 'onChange' | 'acknowledge'>;
      ledger: SheetLedger;
      home: Promise<string>;
      host: { lists(capability: string): Promise<boolean>; dispatch: HostDispatch; onEvent: HostEvents; onLink(listener: () => void): () => void };
      sessions: { record(appSessionId: AppSessionId): SessionRecord | null; acquire(appSessionId: AppSessionId, reason: 'resume'): Promise<AcquireOutcome> };
      clock?: { now(): number; after(ms: number, run: () => void): () => void };   // the tests' clock; the retry's
      log(line: string): void;
    }
    export function startSheetDelivery(deps: SheetDeliveryDeps): { stop(): void; idle(): Promise<void> /* the tests' wait: no pass running, owed or scheduled */ }

Started in `startSpine` (`src/services/spine-root.ts`) where the sheet service is, when there is one, and wired there: `host.lists` is the capability read the session service uses (`hostLists`), `dispatch` and `onEvent` are `SpineHosts`', `onLink` is `hosts.onStreaming('engine-host', …)` (how the owner channel's follower learns of a reconnect, `src/services/owner/register.ts`), a record is the index's (`index.sessions.get`), and `acquire` is `SessionService.acquire`. The digest's released mark is not read: F20 does not need it.

**One pass, for one record** (a session's passes never overlap; a trigger during a pass owes one more; the engine session is the record's, and every request to the host names it):

1. Read the model. No record, an unreadable one, or no app session for it: take from the ledger what it holds for this engine session if the record is gone, and stop. `mine` is `pending` with recipient `main`. Ledger entries of this engine session whose acknowledgement the model's `sent` shows applied, or none of whose keys is in `pending` any more, are removed.
2. Whose the session is now, from the index's record. Archived: stop. Holder `terminal` or `background_job`: stop. Holder `none` and `readRecordedRoute(record.gateway)` null (MAWS never launched it): stop. For none of these is the host asked, so a record MAWS has no part in never wakes it. Holder `self`: live. Holder `none` otherwise: no process.
3. What the host is asked. Live: `session.sheetFlights` for `mine`'s keys (none, when `mine` is empty: the answer's `rider` and `sheetLaunch` are still needed). No process: the same, but only when there is something to do it for (`mine` is not empty, the model has a queued answer, or the ledger holds a flight of this engine session); otherwise stop. More than 200 keys are asked 200 a call, and the answers put together: nothing below is decided on part of them.
4. Each flight read whose keys are not in the ledger is added to it. Each ledger entry of this engine session whose acknowledgement the model's `sent` does not show (queued or applied) is acknowledged; what the door answers is in the table below.
5. `owed` is `mine` less the keys in the ledger and the keys flying, undecided or read. `wakes(o)`: an answer whose latest flight, if any, is not unread for `stopped` or `blocked` with `live` true. Any flight undecided: the pass is unresolved (F30).
6. Live. `sheetLaunch` not true: stop; this launch has no sheet. Not ready: unresolved. If any of `owed` wakes: `composeSteer(owed, …)` and `session.sheetSteer`. `written` ends the pass; `in_flight` and `other_session` make the pass again from step 1; `not_ready` and `not_written` are unresolved. Else `rides` is `composeSteer(owed, …)` or null, and `session.sheetRide` is called whenever the keys the host says it holds (`rider`) differ from `rides`' keys: the offer is repeated at every pass that finds them different, so a rider lost with a host is offered again at the pass the new link triggers.
7. No process. `ranLast` not `maws`: stop. The answers that may start it are the model's queued answers that no queued retract cancels, by their `at`, and the answers in `owed`, by their `acceptedAt` (stopped and blocked no longer hold them back: that process has ended). If any of them is later than `launchedAt`, or `launchedAt` is null, and no acquisition for this session failed in this run: `acquire(appSessionId, 'resume')`. A dismissal starts nothing. The outcome is logged; `ready` leads to a pass from the status and the record like any other, and anything else is remembered for the run.

**What the door's answer to an acknowledgement leaves.**

| answer | what it means | what is left, and what follows |
|---|---|---|
| `ok` | the line is appended; the tool applies it now or at its next start | the ledger keeps the flight until the model's `sent` shows the key applied; nothing is scheduled for it |
| `busy` | the record's lock was not had | unresolved: the same line at the next retry |
| `failed` | nobody knows whether the line was appended (a timeout, an exit that says nothing) | unresolved: the same line under the same key, which the tool reads as one act |
| `unavailable` | no `sminos` MAWS may run was found | unresolved, at the retry's longest interval; the sheet already says answers cannot be sent from here |
| `refused` | the door would not take the line (the record's path is a link, or the line is malformed) | logged once per flight; unresolved at the longest interval. The key stays in the ledger and is never sent again |
| `no-sheet` | the record is gone | the ledger's entries for that engine session are removed: nothing is left to acknowledge |

**The retry** (F30). A pass that ends unresolved schedules one more for its record after 2 s, then 4, doubling to 300; any trigger runs a pass at once and keeps the interval; a pass that ends resolved clears it. `unavailable` and `refused` start at 300.

**Triggers.** `SheetService.onChange` for the record; `session.status` for its app session (a launch, a readiness, an exit, an adoption); `session.eventBatch` for an app session with a flight flying or undecided or a rider offered, when the batch holds a `command.lifecycle`, a `queue.transition` or a `turn.ended`; the host's link coming up, and the start, for every record `list` shows with something pending or queued and every engine session in the ledger; the retry. An event is only a reason to look: every fact a pass acts on is read from the record or asked of the host in that pass.

Tests, on a fake host that keeps §U's table and the stand-in door: each row of the three tables of the state machine that names M6; the pin's `more` record, 250 pending dismissals, asked about in two calls and packed only after both, leaving as 200 and then 50 across two riders; the host answering `in_flight` for a key the deliverer thought owed; the host answering `other_session` because the session was cleared between the record's read and the request (the pass starts again, finds the old record gone and sends nothing); an event lost (the pass at the link's return finds the flight read); two triggers in one pass make one more pass and one steer; a rider held, the host replaced, and the next pass offering it again; a door that answers `unavailable` three times and then `ok` with nothing else changing, on the tests' clock; a ledger that cannot be written; a session with no process and a queued answer started once though the trigger fires three times and the spine is started again; the same with a launch since the answer, not started; a queued dismissal alone, a queued answer a queued retract cancels, a session a terminal ran last and an archived one, none started.

### §Y · The steer as an arrival, and the notice (M4, M7)

`src/shared/engine/sheet-carrier.ts` gains the person's row as a carrier, and `src/shared/engine/arrival.ts` reads it where it reads MAWS's `ask` envelope (`readPersonsContent`, `personsText`):

    export function steerDeliveries(content: PersonsContent): { own: PersonsContent | null; deliveries: SheetDelivery[] }

A text block that `isSteerEnvelope` holds for is the sheet's whole. Inside a longer text (messages the engine joined into one), a slice from a line that opens with `[sheet v1] ` to the first block line after it is the sheet's when that slice is one envelope; everything else is the person's and is the bubble. The deliveries travel as the `sheet` entry C3 added (`sheetEntry(sheetFactsOf(arrivals))`), on the live normaliser and the file's backfill alike, so `SheetRow` draws receipts from them with no change, the carrier draws no bubble for a sheet steer, a person's message that carried a rider draws as the person wrote it, and the turn's notice row reads as C3 worded it. The module's opening comment, which says no carrier is the person's, is corrected: this one is, by form, for drawing only (F23).

`src/main/attention/notifier.ts`: the return that keeps a sheet item in-app applies unless the item's session is held by MAWS (`view.record(appSessionId)?.holder.kind === 'self'`); the once-per-call rule is unchanged.

### §Z · The channel journal (M7)

`src/services/channel/lane-b.ts`, fed as today by live events (`seq` not null) and, new, by `SheetService`:

    LaneBDeps: sheet?: { read(session: string): Promise<SheetModel | null>; onChange(listener: SheetListener): () => void }

- **The question.** At the live `tool.result` of a call for which `isSheetCall(input)` holds, `callEntries(input, resultText)` (`src/shared/sheet/call.ts`) names the entries added; each becomes `{ kind: 'question', text: entry.question, choices: entry.options, at: the result's time }` with anchor `pathOf('sheet', engineSessionId, id)`. A revised entry, a refused one and a call whose first line is not the sentences record nothing. A subagent's call is read the same way.
- **The outcome.** For an id whose question is recorded here (`recorded(src)`) and whose outcome is not: an entry in the model's `pending` gives `{ kind: 'answered', text: the picked labels joined by ", " and the text, as `askAnswerOf` joins an ask's, at: acceptedAt }` for an answer and "Dismissed" for a dismissal; else `closed[id]` gives its `receipt` for `answered` (the record's own cut: the labels, or the text's first 80 characters), "Dismissed" or "Withdrawn", at `closed[id].at`. Anchor `pathOf('sheet', engineSessionId, id, 'answered')`, requiring the question's. It is looked for at two moments: each change of the record, and right after a question's entry is recorded, by one read of the record. The second is for an answer that was applied before the question's entry existed, after which the record may never change again.

The engine session's id is in the anchor because an app session that was cleared starts a new sheet at `q1`. `src/renderer/src/channel/project.ts`, `questionOf`: an anchor `sheet/<engine session>/<id>/answered` joins the entry of `sheet/<engine session>/<id>`.

**The two lanes.** sminos writes a member session's sheet questions to its project log, as it writes a MAWS `ask`'s (`export_host`, `S/sminos.py`), and on a machine whose sminos daemon is enrolled such host events reach this journal as lane A entries (`#journal`, `src/endpoint/rl10/link.ts`). C5's Acceptance is one question and its outcome in the channel. M7 measures it, with the stand-in daemon the channel's suite already has (`e2e/support/fake-sminos.ts`), because only a stand-in can put the two arrivals in a chosen order; M8's scene 13 then reads what the real sminos wrote to its log for the same two questions, so the measurement is known to be of something that happens: for one sheet question and for one `ask` question of a session MAWS holds, the lane A host event arriving before lane B's entry and after it, and the count of entries a person would see for each. The rule on the count:

- the sheet's question stands once: nothing to do;
- the sheet's stands twice and today's `ask` stands twice too: it is how the two lanes meet today, not this child's; a row in `docs/tech-debt-tracker.md` and an entry for the composite's writer;
- the sheet's stands twice where `ask` stands once: it is this child's to fix before it lands. The fix is at the journal's door: a lane A entry whose engine session MAWS holds (the index's holder is `self`) and whose kind is `question` or `answered` is not recorded, since lane B tells that session's questions; one test in each arrival order.

## The gates, by clause

The composite's Acceptance for this child as it stands at `cc9fd7ff3`, with the two sentences of its Purpose that are not in its Acceptance and the composite's Acceptance 18 as it reads for a MAWS-run session, cut into the clauses a milestone can prove.

| clause | what it says (the composite's C5 section) | proven in |
|---|---|---|
| A.a | Acceptance 7 for a MAWS-run session: it asks, nothing opens, the call's row shows one line per question, Open shows the side sheet at it | M7 (replayed), M8 (live) |
| A.b | an answer reaches the agent and the line becomes the receipt | M6 (the steer written and acknowledged, over a recording), M4 and M7 (the receipt drawn from the steer), M8 (live) |
| A.c | a released session answered from the app is resumed and receives the answer, by §5.4's sequence | M6 (the acquisition, then the steer), M8 scene 6 |
| A.d | the same from `sminos sheet answer` | M6 (a line the app did not send), M8 scene 7 |
| A.e | a session whose process is gone without a release (the machine restarted, it crashed, the person ended it), MAWS having run it last, is started by an answer from the app and from the command line, once per answer; a dismissal alone, a session a terminal held last and an archived one start nothing | M5 (`ranLast`, `launchedAt`), M6 (step 7's cases, across a restart of the spine), M8 scenes 7 and 15 |
| A.f | with a second competing answer, a retract and a resent line in the inbox, each ends in one delivery of the applied outcome and none of a refused one | M6 (on the pin's `two-surfaces`, `retract-queued`, `retract-too-late` and `resent-key` fixtures), M8 scene 3 (counted in the model's history) |
| A.g | a steer cancelled before the model read it ends in exactly one delivery | M2 (P9, P11), M4 (the fold), M5 (the Stop's withdrawal, and a host replaced inside it), M6 (the rider), M8 scene 8 |
| A.h | a host handover between a steer and its acknowledgement ends in exactly one delivery | M4 (the fold across `host_attach`), M5 (death on each side of the write; the adopter's refusal and its settling), M6 (`e2e:supervisor-daemon`: the real adopter, the real deliverer, the content the engine was sent, one acknowledgement), M8 scene 14 (the real engine and the real door) |
| A.i | a terminal session answered while stopped and then resumed in MAWS, its stored question tool `maws`, is launched with the sheet and receives the answer | M3 (the override, the launch), M8 scene 9 |
| A.j | Acceptance 8 in a MAWS-run session by the route P2 allows: answered while it runs, the subagent receives it; after it ended, the main agent receives it with the asker named | M2 (P13), M6 (an outcome whose recipient is an agent is never MAWS's), M8 scene 10 |
| A.k | a dismissal reaches the agent with MAWS's next message and starts no turn | M5 (the rider on the person's frame), M6 (a dismissal alone makes no steer and starts no session), M8 scene 4 |
| A.l | after a compaction the agent names the option the human picked | M8 scene 11 (a real model); it rests on §5.5, which C2 built |
| A.m | the main conversation receiving an ended subagent's answer names the option picked | M1 (the context), M2 (P13: it reaches the model), M8 scene 12 (a real model) |
| A.n | the channel journal shows one question and its outcome | M7 (lane B's entries; the two lanes measured and ruled), M8 scene 13 |
| A.o | a session set to `maws` still has `ask` and is answered as today, on this machine and from another | M3 (its launch line and environment pinned; `e2e:tools`, `e2e:remote`), M5 (`e2e:supervisor-daemon`'s `ask` cases unchanged), M8 (the same groups on the landing's head, and scene 13) |
| A.p | a MAWS-run session's sminos writes its record under the home MAWS's reader reads; the launch names it | M2 (P6), M3, M8 scene 1 (under a home that is not the default) |
| A.q | a session whose question tool is "Default" is launched with `MAWS_QUESTION_SHEET` and takes the sheet, a prestarted one included | M2 (P7), M3 (the variable equals the plan's id with a null spec id; a prestart's spec equals its Send's), M8 scene 1 |
| A.r | an open question no longer holds an engine process | M5 (F22's pin), M8 scene 5 |
| A.s | a subagent that ends with a question open: the main agent is told which, on its next route (Acceptance 18, in a MAWS-run session) | M1, M2 (P13), M8 scene 10 |

## Plan of Work

M1 is in doperpowers and M2 is a spike; M3 to M8 are one pull request in MAWS, on `question-sheet-c5` rebased on the master that holds C3's second landing. **Two things start at once and wait on nothing, C3's landing included: M1, and M2's sitting A.** Another session's work in doperpowers builds on M1's routes once they are on `main`, so M1 is reviewed and merged on its own, as soon as its gates and sitting B's P13 are green, without waiting for anything in MAWS.

    M1 sminos ─────────────┬──► M2 sitting B (P13) ─────────────────────────────┐
    M2 sitting A (P6–P12) ─┼──► M3 the launch (P6, P7; C3's landing) ──┐        │
                           └──► M4 pure parts (P9, P11, P12) ──► M5 ───┴──► M6 ─┴──► M7 ──► M8

M3 waits on sitting A's verdicts for P6 and P7 and on C3's second landing. M4 waits on sitting A's for P9, P11 and P12. M5 consumes M4; M6 consumes M3, M4 and M5 and sitting A's P8 and P10; M7 consumes M4 and M6; M8 consumes all, and M1 on doperpowers `main`.

### M1 — sminos: a MAWS-run session's routes

**At its end.** In a session whose runner is `maws`, an ended subagent's open questions and a call's late outcome are told to the main conversation on its next tool result or prompt, and a message that answers a subagent's question carries that question's words and options as the tool's context. A terminal session behaves exactly as before, and so does every session MAWS launches today, since none has the runner until M3.

**Blocked by.** Nothing.

**Where.** doperpowers, a branch from `main` at `42ab7915d` or later; one pull request, its body ending with the session line.

**Touches.** `H/sheet.tsx`, `H/sheet-model.tsx`, their tests under `sminos/tests/mods/`, the plugin's version, `docs/doperpowers/TECH-DEBT.md` row 54, and one paragraph of `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` (I9's "In a MAWS-run session", brought to what the mod now does).

**Interfaces.** Exposes §S's two behaviours to M2's sitting B and to M8. Consumes C2's `take`, `putBack`, `withResultRoute`, `keysIn` and the command's `show --json --keys`, all as built.

**Decisions.** F8, F9, F10. The context is composed in the mod and not by the step, so no event, no view and no published shape moves; `sminos/types/sheet/` is not touched and `python3 -B sminos/tests/sheet-contract.gen.py --check` still passes. A notice put back because a prompt entered without it is the terminal's rule, unchanged. The mod still submits nothing and opens no idle route in a MAWS-run session (C0's P1: a turn the tool submits there is a turn MAWS did not send). If sitting A's P8 answers B8, the one change that branch names joins this milestone before its pull request merges.

**Does not touch.** The step, the door, the command, the set, the terminal's routes, the bridge.

**Proves.** A.m's context and A.s, on the suite's fake port: §S's tests.

**Gate.** `ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,version-bump` from the doperpowers worktree; then P13.

### M2 — The probe: a MAWS launch that takes the sheet (spike)

**The question it answers.** P6 to P13 of §S: whether the launch F2 and F4 describe makes sminos take the sheet under the home MAWS names; what the engine's rows are for a steer and a rider that are read, withdrawn, blocked, joined with another message, or riding a command; what the engine answers about a message it never received; and whether M1's context and an acknowledgement do what §S and F19 say, on the engine MAWS's launches run.

**Blocked by.** Sitting A: nothing. Sitting B: M1's branch.

**What to build and how to run it.** The scenario `qsheet-c5.mjs` of §S, on the Mac runner. It spends nothing: the model is the scripted stand-in. The steps are Concrete Steps'.

**What to observe.** Each row of §S's table, from the fixture's frames, the stand-in's recorded requests, the mod's own log, the engine's transcript and the files under the scratch sminos home.

**Promote or discard.** §S's table is the criteria: each probe's last column names, for each answer, the branch that runs or the stop. A branch is written into the decision and the section it bears on before the milestone that reads it starts, by this document's writer, and where it changes what the composite says it is listed in the last section. A stop goes to the composite's writer with the fixture and halts only the milestones it names. Nothing is decided on a case the probe did not run: a row of §U's table the fixtures do not show stays out of M4 until they do. The fixtures and the findings are kept either way; the scenario stays as the way to ask again on a later engine.

**Touches.** `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-*.jsonl`, `spikes/protocol-probe/findings-qsheet-c5.txt`, `spikes/protocol-probe/fixtures.test.mjs`.

**Does not touch.** `src/`. The findings name no machine, no home and no version of anything but what the engine's own frames carry.

**Gate.** `scripts/ci-gate.sh "$PWD" --gates probes` on the commit that holds the fixtures and their tests.

### M3 — The launch

**At its end.** A session whose question tool is "Default", new, resumed, forked or prestarted, is launched with `MAWS_QUESTION_SHEET` naming its own session and `SMINOS_HOME` naming the home MAWS reads, on a host that lists `engine.questionSheet`. A session whose record already holds a sheet is launched the same way whatever its stored tool. Its supplement names the tool it has. A session set to "MAWS" is launched exactly as before.

**Blocked by.** Sitting A's verdicts for P6 and P7; C3's second landing on master.

**Touches.** `src/shared/host/socket-protocol.ts`; `src/engine-host/launch.ts`, `launcher.ts` (the adopter's rebuild passes the id it has), `detached.test.ts`; `src/services/sessions/` (`launch-mapping.ts`, `served-set.ts`, `setup-steps.ts`, `resume.ts`, `setup.ts`, `prestart.ts`); `src/services/spine-root.ts`; `src/shared/sheet/read.ts`; `src/services/owner/launch.ts`, `src/shared/owner/contract.ts`; `R/composer/copy.ts`, `R/settings-tab/copy.ts`; `docs/charter.md` (§19), `docs/doperpowers/plans/2026-11-23-tool-choice.md`. Under P6's branch B6 also `src/shared/engine/launch-spec.ts`, `src/shared/ipc/wire.ts` and the wire's three pinned files.

**Interfaces.** Exposes §R. Consumes `servedSet`, `sameLaunchSpec`, `ownerChannelLaunch` and `decideFlags` as they are, and C3's `SheetService.read`.

**Decisions.** F1 to F7, F31's test of a launch. The capability is listed in the same commit that sets the variable: a host that lists it and does not set it would have the spine append supplement 5 to a session with no sheet. `launch.test.ts`'s pin of the full set's line is not edited; a second pin holds a Default launch's environment and settings, a third that a `maws` launch's environment has neither name, and a fourth that a Default launch whose spec names no home has no variable. The override reads the record once per attempt and the automatic retry reuses the spec, as D8 has it.

**Does not touch.** `ask`, its flags, its server, its steer; `prestartKey`; the stored set of any session; and, unless P6 answered B6, `LaunchSpec`'s schema and the wire.

**Proves.** A.i's launch, A.o's launch, A.p, A.q at the unit level: `buildLaunch` with a null spec id and question `engine` has `env.MAWS_QUESTION_SHEET === plan.sessionId`, and with a resume the resumed id; a `maws` launch has neither variable and its line is the pin's; `extraSettingsOf` writes the home for a sheet launch only; a Default intent's prestart spec equals its Send's under `sameLaunchSpec`, and a `maws` intent's differs from a Default one's; `sheetOverride` on each of: a record with an open question, a queued line alone, nothing, an unreadable record, a host without the capability, a fork; supplement 5 word for word, and `decideFlags` rendering anew from a recorded 4.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:remote`.

### M4 — The steer's form, the flights' fold, the steer as an arrival

**At its end.** Three pure things exist and are held to recorded bytes: a composer whose output for the published example's record is the published steer; a fold that reads a journal to "this message was read", "it was not, and why" or "the journal cannot say"; and a reader that finds the sheet's deliveries in a message MAWS wrote, so a row's receipt and a turn's notice are drawn from a MAWS-run session's own history.

**Blocked by.** Sitting A's verdicts for P9, P11 and P12.

**Touches.** `src/shared/sheet/steer.ts`, `flight.ts` and their tests; `src/engine-host/sheet-flights.ts` and its test; `test/support/sheet-flight-rows.ts`; `src/shared/engine/sheet-carrier.ts`, `arrival.ts`, their tests; `src/engine-host/normalizer.ts` and `src/engine-host/fs/backfill.ts` only if the person's row does not already reach the reader they share; `test/fixtures/sheet/transcripts/` and one snapshot under `test/snapshots/transcript/sheet/`.

**Interfaces.** Exposes §T, §U's fold, shape and `transcriptHolds`, and §Y's `steerDeliveries`, to M5, M6 and M7. Consumes C3's model (`SheetOutcome`), `parseSheetDeliveries`, `sheetEntry` and `sheetFactsOf`.

**Decisions.** F13, F15, F21's rule of what a transcript holds, F23, and the table "A flight, as the journal says it". The composer takes `wakes` as a parameter because what wakes is the deliverer's knowledge (F16), not the record's: sminos's own composer reads `acrossStop`, which in MAWS is true of every answer a start applied. The fold reads raw rows and not events, as `UnsettledFold` does: an adopter's fold drops events, and the normaliser tells no reader of an echo.

**Does not touch.** The queue, the session, any command, the spine.

**Proves.** A.b's receipt (the snapshot: a transcript whose only delivery is a steer draws the receipt, no bubble and the notice row; one whose delivery rode a person's message draws that message as typed); A.g and A.h at the fold; §T's and §U's tests.

**Gate.** Class 1a; `e2e:transcript`, `e2e:desk-web` (the rows are bundled there).

### M5 — The host: flights in the journal, the two ways a delivery is written, the settling

**At its end.** The host can be asked to send an envelope as a steer, to hold one as the rider of the person's next message, and what became of any key. It refuses to send a key twice or into another engine session, a Stop takes a waiting sheet steer back, it settles from the engine's transcript what its journal cannot say, and a host that adopts the session answers the same questions from the same journal.

**Touches.** `src/engine-host/` (`queue.ts`, `session.ts`, `ipc.ts`, `sheet-flights.ts`, their tests, `session-maws.test.ts` for F22's pin); `src/shared/ipc/` (names, schema, grades, `wire.ts`, the three pinned files), `src/shared/machine/address-paths.json`; `test/support/stub-engine.ts` (a directive that writes each user frame it is sent to a file, since the stub and the replay accept a user write by its type and not its content); `e2e/supervisor.spec.ts`.

**Interfaces.** Exposes §V to M6. Consumes §T's `isSteerEnvelope` and `parseSheetDeliveries`, §U's fold and `transcriptHolds`.

**Decisions.** F12, F14, F17, F18, F21, F22, F29, F31, and the table "How the host settles what the journal leaves open". The checks and the tie are one synchronous step, with no await between the last check and the row. The rider is appended in the session's `write`, after `prepare` has made a submission's content, so a linked read's blocks come first and the envelope is last. The queue's persisted and published shapes do not change: a host steer is kept in the queue's memory only, which is why an adopter takes them from the fold. A settling never blocks a write or an exit, and a failed one changes nothing.

**Does not touch.** `ask`'s table, steer and restore; `SessionMaws.pending`; the normaliser's events; `journal.ts`; the spine.

**Proves.** Each row of "What each failure leaves" that names M5, each as a test with the journal it leaves:

- A.g: a sheet steer waiting when Stop is pressed is cancelled, journals `cancel`, and nothing of it is published or held; and with the host replaced after the engine's `cancelled` and before `cancel`, the adopter journals `settled` as stopped.
- A.h: the host killed before the frame leaves it (the tie alone: at the adoption the transcript lacks it, the engine's cancel answers, `settled` as absent); killed after the frame left and before the `out` row (the replay brings `started` and the echo: read); handed over after the `out` row and before `started` (in `e2e:supervisor-daemon`, on the stub engine with M2's `-steer` recording: the adopter answers `in_flight` for the key, then read, and the file of frames the stub was sent holds the steer's text once, byte for byte the composed one).
- F21: a launch that ends with a flight flying, asked about afterwards with a transcript that holds the message, one that does not, and one that cannot be read (undecided, and asked again to the same answer); a `result` with model turns and no echo; a replay with a gap.
- A.k: a rider is the last block of the person's next frame, tied to that frame's uuid; a frame whose text opens with `/`, a sheet steer, an `ask` steer and the plan sequence's frames take none.
- F29: `/clear` between a rider's acceptance and the next frame drops the rider; a request naming the engine session the process has left is refused `other_session`; the same key string in two engine sessions of one launch is two keys.
- A.e's facts: `ranLast` for a transcript whose newest record is MAWS's, a terminal's, and for none; `launchedAt` with one launch, several, and none.
- A.r (F22's pin), F31 (a launch whose spawn row lacks the variable is refused `not_sheet` by a host that lists the capability), and each refusal of §V in its order.

**Gate.** Class 1a; `e2e:supervisor-daemon`, `e2e:c7`, `e2e:tools`.

### M6 — The deliverer: applied outcomes out, acknowledgements in, a session with no process started

**At its end.** With `mawsd`'s services loaded, an outcome the tool accepted for the main conversation of a MAWS-run session is sent once and acknowledged once, whoever gave the answer; a session MAWS ran last that has no process is started by a new answer and receives it; a dismissal waits for the person's next message; and nothing waits on an event that may never come.

**Blocked by.** M3, M4, M5; sitting A's verdicts for P8 and P10.

**Touches.** `src/services/sheet/` (`delivery.ts`, `ledger.ts`, `service.ts`, `door.ts`, their tests); `src/shared/sheet/model.ts`; `src/services/spine-root.ts`; `test/support/fake-sminos-cli.mjs`; `e2e/requests.spec.ts`, `e2e/supervisor.spec.ts`.

**Interfaces.** Exposes nothing later milestones call. Consumes §R's capability, §T, §U's shape, §V, and C3's service.

**Decisions.** F11, F16, F19, F20, F28, F30, and the two tables of what the deliverer sees. The ledger is the only thing it keeps; everything else a pass acts on is read in that pass. A replayed case cannot rest on the replay to check what was written, since the replay accepts a user write by its type: each case reads the frames the engine was sent (the stub's file, M5) and compares the text.

**Does not touch.** The components, the store, the wire's `sheet.*` commands; `put`'s refusal of a `delivered` line; the digest.

**Proves.** A.b to A.f, A.j (an outcome whose recipient is an agent is never sent), A.k, by §W's tests and each row of "What each failure leaves" that names M6. And two cases over real processes:

- in `e2e:c7`, replayed from M2's recordings with the stand-in door: an answer sent in the side sheet of a MAWS-run session ends with one `sheet_flight` row, the composed text in the engine's input once and one `delivered` line naming its key; the same with the session's process gone first;
- in `e2e:supervisor-daemon`, A.h whole: the real `mawsd` with the deliverer, the real session host, the stub engine on M2's `-steer` recording, the stand-in door. One answer is applied (and beside it a queued answer that a queued retract cancels, which must reach nobody); the steer is written and the host handed over before `started`; afterwards the file of frames the engine was sent holds the applied key's block once and the retracted one's never, the journal holds one `sheet_flight` and the adopter's rows, the inbox one `delivered` line naming that key, and the staged record no longer lists it in `pending`. A second case hands the host over inside a Stop and ends with the rider read and acknowledged.

**Gate.** Class 1a; `e2e:c7`, `e2e:supervisor-daemon`, `e2e:lane-a` (the sheet service's terminal cases, unchanged).

### M7 — What draws and what else reads: the notice, the channel journal, the words

**At its end.** A MAWS-run session's question is announced as its `ask` would be; the project's channel shows the question and, once, what became of it; and every surface C3 built is seen drawing a MAWS-run session.

**Touches.** `src/main/attention/notifier.ts`; `src/services/channel/` (`lane-b.ts`, `register.ts`); `src/services/spine-root.ts`; `R/channel/project.ts`; `e2e/channel.spec.ts`, `e2e/requests.spec.ts`; `docs/tech-debt-tracker.md`.

**Interfaces.** Consumes §Y's reader, C3's `callEntries`, `isSheetCall`, `SheetService` and `isSheetItem`.

**Decisions.** F24, F25, and §Z's rule on the two lanes, applied to what the measurement shows: the count for the sheet's question and for `ask`'s, in both orders, is written into this document's Progress with the branch taken. Limits logged in `docs/tech-debt-tracker.md`, one row each: delivery waits for `mawsd`'s services to be loaded; a `mawsd` replaced by an older build leaves a running sheet launch's answers undelivered until it is this build again; a subagent whose send was refused while it still runs is named as ended; a session that held `ask` and is launched with the sheet keeps `ask` offered and failing; a steer carries no age for an answer owed across a stop and no image line; a prestarted Default engine that is never adopted leaves an empty record for sminos's sweep; another SDK client that wrote to a session after MAWS reads as MAWS having run it last; a text the person begins with `/` that is no command still takes no rider; and whatever P11 leaves as a case the wire cannot tell.

**Does not touch.** The components (`R/sheet/`), the row, the side sheet: they are C3's and draw any record. A fault found in one is fixed where it lives and reported.

**Proves.** A.a (in `e2e:c7`, replayed from M2's `-launch` recording over a seeded record: nothing opens, the row's lines, Open at the question, the "Waiting for you" line); A.n (a live sheet call records one `question` entry per added question and none for a revise; a pending outcome, then a closed one, record one `answered` entry between them; an outcome already pending when the question's entry is recorded is recorded with no further change of the record; the renderer joins it; and §Z's measurement, with the fix and its two tests if the third branch is the one); the notifier's two cases.

**Gate.** Class 1a; `e2e:c7`, `e2e:settings`, `e2e:panel`, `e2e:to-human`.

### M8 — Live on the Mac runner, and the acceptance

**At its end.** Every clause of "The gates, by clause" has been observed in the running system: the built app, the real engine, the real sminos at the commit that is on doperpowers `main`, driven by one script.

**Touches.** `e2e/sheet-maws-live.rig.ts`, `e2e/sheet-maws-live.config.ts`, `e2e/support/sheet-live.ts` (C3's, extended) and `e2e/support/model-stub.ts`; this document's Progress and Outcomes.

**Decisions.** F27. The driver follows C3's (`e2e/sheet-live.rig.ts`, `e2e/sheet-live.config.ts`): not a `*.spec.ts`, its own config its whole selection, the same variables (`SHEET_LIVE_DOPERPOWERS`, `SHEET_LIVE_OUT`), the same scratch homes, record readers and terminal driver from `e2e/support/sheet-live.ts`. Its sminos home is a scratch directory that is not the default's name, exported to the app so the reader resolves it, and never exported to the engine by anything but the launch. MAWS's launches reach the checkout's sminos through an engine wrapper the driver writes at run time and names in `MAWS_E2E_ENGINE_BIN`, as `e2e/support/headless-browser.ts` wraps the engine: it `exec`s the real binary with `--plugin-dir <the checkout's sminos>` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` added, so the engine's parent is still the host (`SMNS_MEMBER`'s check). `MAWS_SMINOS_CLI` names the checkout's `bin/sminos`. Every scene but two is answered by the scripted model: `e2e/support/model-stub.ts` gains a script of replies (text, a tool call with a given input) in the manner of `spikes/protocol-probe/stub-api.mjs`, so those scenes spend nothing and every request the model was sent is on record. The two that need a model that reads (A.l, A.m) run on a real one, the smallest, through the gateway's variables as C3's driver does, under a cap of US$0.50 for the run; in each the option picked is the second of three, so a model that counted places from 0 would name the third and fail the scene. **A delivery is counted in the model's history, not in its requests**: a steer taken into a turn stands in every later request of the session, so the driver reads the last request's messages (and the engine's transcript) and counts the message blocks that hold a key's block. **No scene waits a fixed time**: each waits for a row or a record (the `sheet_rider` row before the person's next message, a `delivered` line, a key leaving `pending`), and "starts no turn" is the count of requests being the same at the next such event. A process is ended by the means the scene names (a release as C12's live spec provokes one, `e2e/c12-live.spec.ts`; the session's own Stop; a kill of the engine and its host); a handover as `e2e/supervisor.spec.ts` asks for one. The driver asserts from files and records only: the sheet's `state.json` and `inbox.jsonl`, the session's journal, the engine's transcript, the stand-in's requests, sminos's project log, the channel's entries through `channel.history`, and what a window shows by role and name. It joins no list in `.github/workflows/gate.yml`: the gate's runners hold no sminos checkout.

**Does not touch.** Anything a milestone before it built, but for a fault the run finds, which is fixed where it lives and reported.

**Proves.** A.a to A.s, by the scenes Concrete Steps lists, in addition to every gate of M3 to M7 on the landing's head.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:transcript`, `e2e:panel`, `e2e:to-human`, `e2e:lane-a`, `e2e:remote`, `e2e:supervisor-daemon`, `e2e:desk-web` on the landing's head; the live driver on the Mac runner.

## Concrete Steps

A gate tests the committed head and runs on GitHub Actions; nothing below is run on the laptop this was written on. `<doperpowers>` is that repository's worktree. Steps marked "on the Mac runner" are run there over ssh, from `~/.local/share/question-sheet-c5/maws` and `~/.local/share/question-sheet-c5/doperpowers`, clones of the two public repositories at the branches under work, updated with `git fetch` and a checkout of the commit named in the step's report.

**M1.** In `<doperpowers>`:

    python3 -B sminos/tests/sheet-contract.gen.py --check          # the set is untouched: prints the same 21 cases, 6 examples and digest as before
    ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,version-bump

The mods' suite gains §S's cases and ends with the kit's summary and no failure; `claude plugin validate` prints no refusal for `sminos`.

**M2.** On the Mac runner. Sitting A with the doperpowers clone at `main`, sitting B with it at M1's branch:

    cd ~/.local/share/question-sheet-c5/maws/spikes/protocol-probe
    QSHEET_SMINOS=~/.local/share/question-sheet-c5/doperpowers/sminos QSHEET_SITTING=A node run-pass3.mjs qsheet-c5
    QSHEET_SMINOS=… QSHEET_SITTING=B node run-pass3.mjs qsheet-c5
    QSHEET_SMINOS=… QSHEET_ONLY=qsheet-c5-steer node run-pass3.mjs qsheet-c5      # one fixture again

Sitting A writes `fixtures/qsheet/qsheet-c5-{launch,resume,fork,steer,cancelled,rider,delivered,blocked,blocked-mid,joined,command,unknown-cancel}.jsonl`, sitting B `qsheet-c5-subagent.jsonl`. Read each against §S's table before anything else, and write into the findings, for each probe, which answer it gave and which branch or stop that is:

- `-launch` (P6, P7): the run's notes hold `state.json` at `<the scratch sminos home>/sheet/<the session's id>/` and no `sheet/` under the scratch home's default place; the `system/init` frame lists `mcp__sminos__AskUserQuestion` and the tell's server; the first request's tools hold a schema with `ask` and `withdraw` and no built-in `AskUserQuestion`; the mod's log holds `sheet: sheet (maws): MAWS_QUESTION_SHEET names this session`.
- `-resume` (P8): before any host frame after initialize, `state.json` lists the queued answer's outcome in `pending` with recipient `main`.
- `-steer` (P9): for the idle steer, `command_lifecycle` `queued` then `started` for its uuid, an echo whose text holds its block, and a request that holds its text; for the one written during a tool call, the echo and `started` after the tool's result, and the turn's `result` naming it.
- `-cancelled` (P9): `queued`, then `cancelled` after the cancel request, no `started`, no echo, and no request holding the text.
- `-rider` (P9): the echo of the two-block frame holds both blocks, and the request holds the person's words and the envelope.
- `-blocked`, `-blocked-mid`, `-joined`, `-command` (P11): the rows §S's last column names for each case, and, for each, whether the engine's transcript holds the message.
- `-unknown-cancel` (P12): the answer to the cancel, and no frame after it.
- `-delivered` (P10): the door's output names the `delivered` line's key with state `applied`, and `state.json` no longer lists the outcome in `pending`.
- `-subagent` (P13): the request that holds the steer `q… (asked by the subagent …, which has ended) → option 1.` also holds the context's line with the question's words; a request before it holds the ended subagent's notice once.

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

**M8.** The landing's gates, then the driver on the Mac runner, the app built from the landing's head and the doperpowers clone at the commit of `main` the report names:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:tools,e2e:c7,e2e:settings,e2e:transcript,e2e:panel,e2e:to-human,e2e:lane-a,e2e:remote,e2e:supervisor-daemon,e2e:desk-web

    cd ~/.local/share/question-sheet-c5/maws && pnpm install && scripts/e2e-build.sh plain
    SHEET_LIVE_DOPERPOWERS=~/.local/share/question-sheet-c5/doperpowers SHEET_LIVE_OUT=~/.local/share/question-sheet-c5/out \
      pnpm exec playwright test --config e2e/sheet-maws-live.config.ts

It ends `15 passed`, one test a scene, and leaves under `SHEET_LIVE_OUT` a line of `steps.jsonl` for each assertion, each record as it stood, and each session's journal and transcript. The scenes, in order; "the model" is the scripted one unless the scene says real, and "holds it once" is a count in the model's history as M8's entry defines it:

| scene | what the driver does | what it asserts | clause |
|---|---|---|---|
| 1 | types in a new chat whose question tool is Default, waits for the prestart, sends; the model calls the tool with two questions | the journal's `spawn` row names `MAWS_QUESTION_SHEET` among its environment's keys and `SMINOS_HOME` in its settings; the launch was adopted from the prestart; `state.json` is under the scratch sminos home and holds `q1`, `q2`; the side column is as it was; the call's row has two lines; the session's row reads "Question waiting" | A.a, A.p, A.q |
| 2 | presses Open on `q1`, picks its second option, types a note, presses Send | the model's history holds `q1 → option 2. Their text: "…"` once; the journal holds one `sheet_flight` for its key, read; the inbox holds one `delivered` line naming it; `closed.q1.deliveredAt` is set; the row's line is the receipt | A.b |
| 3 | for `q2`, puts through the real command an answer, a second answer under another key, the first line again, and a retract of the second. Then, with a session that has no process and one question open: an answer and a retract of it, both queued | the door's verdicts are `applied`, `closed`, `applied` again and `too-late`; the history holds `q2` once, with the first answer; one `delivered` line names one key. The session with the cancelled answer is not started, and after its next start nothing was sent for that question | A.f |
| 4 | the model asks `q3`; the driver dismisses it in the side sheet, waits for the `sheet_rider` row that names its key, then sends "go on" | between the dismissal and "go on", no request and no `sheet_flight` of carrier `steer`; the history then holds the person's words and, as that message's last block, an envelope with `Dismissed: q3.`, once | A.k |
| 5 | the model asks `q4`; the driver provokes a release | the session has no process while `state.json` holds `q4` open | A.r |
| 6 | answers `q4` in the app | the session is acquired with no message sent by the driver; the history holds `q4`'s answer once; one acknowledgement | A.c |
| 7 | the model asks `q5`; the driver kills the engine and its host, starts `mawsd` again, and answers with `sminos sheet answer` from a shell | the same as scene 6; the journal holds one launch since the answer. Answering nothing more and starting `mawsd` again starts no launch | A.d, A.e |
| 8 | the model runs a sleep of sixty seconds and asks `q6` first; the driver answers during the sleep, then presses Stop, waits for the `sheet_rider` row, then sends "go on" | `queued` and then `cancelled` for the steer; the queue's `cancel` row; the history holds no envelope before "go on", and holds it once after, as that message's last block | A.g |
| 9 | a terminal session (C3's driver's setup) asks, is closed, is answered with `sminos sheet answer` (queued), and is then resumed in MAWS, where its record's question tool is `maws` | no launch before the person resumes it (a terminal ran it last); the launch's set has `question: 'engine'` and the record's stored set is unchanged; the tools hold no `ask`; the history holds the answer once | A.i, A.e |
| 10 | the model starts a background subagent that asks, then sleeps; the driver answers during the sleep. A second subagent asks and ends; the driver answers | the first answer is in the subagent's history under the tool's opening line and not in the main conversation's, and no `sheet_flight` names its key; the main conversation's history holds the ended subagent's notice once; the second answer's steer names the agent's id and the history holds the context's line | A.j, A.s |
| 11 | real model: asks it to put one question with three named options on its sheet, compacts, answers with the second option | the model's reply holds the second option's label and not the third's | A.l |
| 12 | real model: asks it to have a subagent put one question with three named options and finish; answers with the second | the main agent's reply holds the second option's label and not the third's | A.m |
| 13 | reads `channel.history` for the project and sminos's project log; then starts a session set to MAWS and has the model call `ask` | for `q1`: one `question` entry and one `answered` entry of lane B; whether sminos's log holds an event for the sheet's question and for the `ask`'s, reported beside M7's measurement; the `maws` session's tools hold `ask`, its environment's keys hold neither variable, and the ask is answered in its form | A.n, A.o |
| 14 | the model runs a sleep and asks `q7` first; the driver answers during the sleep, asks for a host handover while the steer waits, and lets the sleep end | the journal holds `host_detach`, `host_attach` and one `sheet_flight` for the key; the history holds the answer once; one `delivered` line; the key left `pending` once (`closed.q7.deliveredAt` is set once and the model's `sent` shows one acknowledgement applied) | A.h |
| 15 | the person ends a session with a question open (the session's own stop); the driver answers it in the app. Then archives another such session and answers it from the command line | the first is started once and its history holds the answer once; the archived one is not started and its answer stays queued | A.e |

## Outcomes & Retrospective

Pending — written at finish.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at the parent pin `cc9fd7ff3`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what the `ux-wave` session should be told. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules. The entries the composite took at `cc9fd7ff3` left this list (which sessions an answer starts).

**Sentences.**

1. §5.4, "delivers with the journaled `next` steer its `ask` uses today" and "MAWS's journal ties its keys to the steer's id". Incomplete: `ask`'s tie is journaled with the write, and a write the host did not see complete then has none. Proposed: "delivers with a `next` steer whose keys MAWS's journal ties to the message's id and to the engine session before the message is written, so the tie exists for every message the engine could have received."
2. §5.4, "only when its journal shows that steer reached the model". Proposed addition: "which is the engine having taken the message into a turn (`command_lifecycle` `started` or `completed`) and echoed it into the conversation carrying its block. A `result` that names the message with no model turn (a hook blocked it; the frame was a command) leaves it unread. Where the journal says neither, and whenever a process, a host or a write ended without the engine's word, the engine's transcript decides: a message in it is read, one not in it is sent again, and one that cannot be looked for is neither sent nor acknowledged until it can."
3. §5.4, "A dismissal in a MAWS-run session is … sent with MAWS's next steer or human message to that session, as a line of its own". Proposed: "… as an envelope of its own, appended as the last block of the person's next message that is not a command, or carried in the next steer. So, while its process lives, is an answer whose steer the person's Stop withdrew or a hook blocked."
4. §5.4, "The same sequence runs for a session MAWS ran last that has no process". Proposed addition, how it is known: "MAWS ran a session last when its index holds a launch of it and the newest record of the engine's transcript was written by MAWS's own entrypoint; a terminal that has written since makes it the terminal's. Once per answer is read from the journal: an answer older than the session's newest launch has had its start. All of this happens while `mawsd`'s services are loaded."
5. §5.4, "(built by C5, in the sminos plugin, from the reader's model, by key)". As built: on any prompt of a MAWS-run session that carries a block, for each answered outcome among its keys whose asker is a subagent, one line of §5.5's form. The compaction case stands on §5.5 alone.
6. §6, "naming the asker by its agent id". Proposed addition: "and as ended, which the published steer says of every subagent's question the main conversation receives; a subagent whose send was refused while it still runs is named so too (rare, logged)."
7. §7, "a session with such a sheet is launched with `MAWS_QUESTION_SHEET` and without `ask`, whatever its stored question tool is". Proposed addition: "for that launch: the stored tool is kept and decides again once the sheet is empty. It needs a host that sets the variable (the capability `engine.questionSheet`); a record MAWS cannot read leaves the stored tool; and a session whose conversation was once sent `ask` keeps it offered and failing there (the tool choice's P2)."
8. §7, "C2's side (2026-11-23), which waits on C5's agreement". Agreed as built: the host sets the variable in `buildLaunch`, to the id it resolved, for a launch whose spec names the sminos home. And "C5 meets the same race at a MAWS launch": it assumes no order; it acts on the record, which exists only once the start has run (P8 asks whether that needs a prompt).
9. §9, "a session whose question tool is "Default" … is launched with `MAWS_QUESTION_SHEET`". Proposed addition: "and with `SMINOS_HOME` in its settings' environment, naming the home MAWS reads, on a host that lists `engine.questionSheet`; its supplement is a new text, 5, which names sminos's tool where it is listed and the built-in otherwise, and says a picked option's place is counted from 1. Whether a running process has the sheet is read from its own launch's record."
10. C5's section, "`MAWS_QUESTION_SHEET` must be part of that launch key". As found: an adoption is decided by comparing the two specs whole (`sameLaunchSpec`), and the variable is derived from the spec's set and home and the id the prestart minted, so it is covered with nothing added; `prestartKey` holds route facts only. And "`ux-wave/subagent-tell` … whose load order relative to sminos this child checks": it is on master; its mod shares no hook's dispatch with the sheet, and M2 runs both.
11. §6 and Acceptance 18, and C2's Status ("a late outcome's notice … reaches only the main conversation's queue, which a MAWS-run session's routes do not read (C5)"). As C2 built it, a MAWS-run session's routes carried no notice at all, the ended subagent's among them. M1 makes both routes carry notices there. What remains is doperpowers' TECH-DEBT 54 as it reads for a terminal session: a subagent caller's late outcome is told to the main conversation.
12. §11, "the third by C5 (`src/services/channel/lane-b.ts`)". Proposed addition: "A sheet question enters the channel journal from the live call that added it and its outcome from the record (an answer, "Dismissed" or "Withdrawn"), one entry each; a revise adds none." What M7's measurement of the two lanes shows, and the branch of §Z it took, is added here when it is known.
13. X2, "`show --json --keys` answers the model for named keys (C5's steer is built from it)". False: MAWS composes its steer from its own reader's model, as it draws everything else. `--keys` is what the plugin's hook asks for item 5's context.
14. §8.1, "For a terminal session it is the in-app notice only". Proposed addition: "A MAWS-run session's is announced as its asynchronous `ask` is: by a system notification while the app is not focused, once per call."
15. X3 and §5.3, for the set's next version, none of it worth a re-pin: the published steer has no line saying an answer was given while the session was stopped (the terminal form's "asked …, answered …") and no `[Image source: …]` line, so a model learns of an image only from the block's path. Both hold nothing a model wrote and could join the steer's form. A third, from C3's live run: nothing in an envelope says a place is counted from 1; this child says it in supplement 5, and the block's own form could.
16. What the probe may still leave (F13): if P11 finds a message the engine echoed and filed in its transcript and still kept from the model's request, the wire and the transcript cannot tell it from one that was read, and the flight reads read. It is listed here with its fixture when M2 has run, and the composite then says it as a limit of §5.4; until then nothing in this document assumes it either way.

**For the owner, through you.** Nothing is waiting. The two sentences of F7 and which sessions an answer starts are answered (2026-11-27).

**For the `ux-wave` session, through you.** The launch shape is fixed as follows. A launch whose set has question `engine` and whose spec names the sminos home carries one more environment variable, `MAWS_QUESTION_SHEET`, set by the host inside `buildLaunch` to the session id that function resolves, so a prestarted engine has it with the id the prestart minted and keeps it through adoption; and one more settings variable, `SMINOS_HOME`, written into the spec's `extraSettings.env` by the spec builders, the same at prestart and at Send. Nothing joins `prestartKey`, and `sameLaunchSpec` needs no change: the set and the settings are already compared. The host lists a new capability, `engine.questionSheet`. The wave's own new argument in `buildLaunch` sits beside these lines and merges by hand. Two things the wave may meet: a prestarted Default engine runs sminos's start, so an abandoned prestart leaves an empty sheet record under the sminos home, which sminos sweeps; and `MessageQueue.steer` gains two options (`before`, `host`) and the queue's `write` one (`person`), with a host's own steer kept out of the pending steers a window shows.
