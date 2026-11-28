# Question sheet, C5 — MAWS-run sessions: execution (2026-11-27)

> **Composite:** `docs/doperpowers/specs/2026-11-23-question-sheet-design.md`, child **C5** (MAWS-run sessions). **Parent pin:** `2620c632b` (branch `question-sheet`). **Ticket:** MAWS board #870, a child of #600. The child's section in the composite ("### C5: MAWS-run sessions") is its spec. The composite's §5.1, §5.4, §6 (its last paragraph), §7 (the MAWS-run paragraph), §9 and §11 are its design, binding where the composite's "Grades" paragraph says; X6's `MAWS_QUESTION_SHEET` is the contract it sets, and X1, X2, X3, X5 and X7 the ones it consumes. This document carries the constraints, the decisions the composite did not carry, the interfaces and the milestones, and nothing of the design.
>
> **Written against:** MAWS master `b65a1e175` (C3's first landing, the prestart engine of #880 and the direct tell are on it); branch `question-sheet-c3` at `04bf48574` (C3's second landing: the side sheet, the row, the attention items), which is on master before M3 starts and is this child's base; this branch at `8da594399` (the carriers round's findings and fixtures); doperpowers `main` at `40b79a7d1` (C2 whole; the published set at version 1, digest `594200ae…e277`) and its branch `question-sheet-c5` at `75d21fc93`, the one commit of this child's sminos side that exists.
>
> **Read before M1:** the composite's §5.1 to §5.4, §6, §7 and §12's "carriers round"; `spikes/protocol-probe/findings-qsheet-c5-carriers.txt` (part B, "Where it landed" and "Containment"); in doperpowers, `sminos/types/sheet/README.md`, and in `docs/doperpowers/plans/2026-11-23-question-sheet-c2-sminos.md` the sections I7, I8, I9 and I10; here, C3's execution document (`docs/doperpowers/plans/2026-11-23-question-sheet-c3-maws-app.md`: S8 to S16, §C, §H, §I), `docs/doperpowers/plans/2026-11-23-tool-choice.md` (D1, D6, D8, D12, §C, §E, §F, "What ticket 600 changes") and `docs/doperpowers/plans/2026-11-24-prestart-engine.md` (D1 to D6).

After this child, a session MAWS runs whose question tool is "Default" asks through the same sheet a terminal session does, and is answered the same way. The agent's call returns at once and draws its row; nothing opens. The person answers in the side sheet, on the local page or with `sminos sheet answer`. The tool inside the session delivers the answer, as it does in a terminal: on the agent's next tool result while a turn runs, on the next prompt otherwise, each question's words and the picked labels with it. MAWS adds one thing a terminal does not need: when the session is idle and an answer is owed, it writes one constant sentence, and the tool fills it with the answer; when the session has no process, it starts it first. MAWS holds nothing of a delivery, so nothing that happens to its frame, its host or its journal can lose an answer, deliver it twice or carry it into another conversation. A question holds no engine process. A session set to "MAWS" keeps `ask` exactly as it is, and no default changes.

How to see each of these is Concrete Steps. What closes the child is its Acceptance in the composite, cut into clauses under "The gates, by clause".

## Progress

- [x] (2026-11-27) The owner's rulings that bind this child: in a MAWS-run session the tool delivers ("Yes, the tool delivers"); an answer starts any session MAWS ran last that has no process; the two sentences that say what "Default" is stand as written.
- [x] (2026-11-28) The carriers round, before this document: the permission check by carrier, and MAWS's constant frame over the wire (B1 to B6). Findings and fixtures on this branch at `8da594399`; its verdicts are in the composite's §12 and are facts here.
- [x] (2026-11-28) This document, written against the composite at `2620c632b`. It replaces an earlier one on this branch (`2a8ef52ee`, repaired at `5e97f8edf`) that built MAWS as the deliverer and failed two buildability reviews on that choice; the composite's §5.1 says why the choice lost. One commit of M1 exists from that time (doperpowers `question-sheet-c5` at `75d21fc93`), unreviewed and ungated; M1 builds on it and says what of it stays.
- [ ] The document's buildability review (one round).
- [ ] M1 — sminos: the tool delivers under runner `maws` (doperpowers). Starts at once.
- [ ] M2 — The wire sitting: M1's branch on MAWS's launch line.
- [ ] M3 — The launch.
- [ ] M4 — The ring, and a session with no process.
- [ ] M5 — What draws and what else reads: the ring's line, the notice, the channel journal, the words.
- [ ] M6 — Live on the Mac runner, and the acceptance.
- [ ] The branch's review (medium), the doperpowers pull request's (high), the landing through the master landing architect.

## Words this document adds

The composite's Terms define terminal session, MAWS-run session, the tool, sheet, question, asker, surface, the page, the bridge and envelope. C2's plan adds the record, the door, the step, the view, a route, a flight (the tool's: one envelope on one route until it lands or fails) and the published set; C3's adds the set's pin, the model, a sheet call, the spine and the side sheet. Added here:

- **The host** is the engine host: the detached process `mawsd` starts, which owns each MAWS-run session's engine process, its queue and its journal (`src/engine-host/`). The spine reaches it through `SpineHosts.dispatch('engine-host', …)` and hears it through `hosts.onEvent` (`src/services/spine-root.ts`). A host with no session to run is **parked**: it has exited, and `mawsd` starts one again when something wants it.
- **A sheet launch** is a launch that carries `MAWS_QUESTION_SHEET`: its served set of MAWS's tools has `question: 'engine'` and its spec names the sminos home, on a host that sets the variable (F2, F3). Whether a running process is one is read from its spawn row (F31).
- **The form** is the number in the variable's value, `2:<session id>`: the delivery's form a plugin must know to take the sheet under MAWS (the composite's §5.4, "The proof names the form").
- **The ring** is the one frame MAWS writes for a delivery: a user-role message whose whole text is the constant sentence "The human answered questions on your sheet." (the composite's §5.4), written as a steer of the host's own kind. **To ring** is to write it. **The ringer** is the spine's part that decides when (`src/services/sheet/ring.ts`, M4).
- **Filled** and **dropped** are what the tool's prompt hook does with a ring: it adds the ready envelope as context, or, when no envelope is ready for the main conversation, drops the frame, and no turn starts.
- **Owed** is said of an answer the record shows for the main conversation and not yet delivered: pending with recipient `main`, or, for a session with no process, queued in the inbox and not cancelled by a queued retract.
- **MAWS ran it last** is said of a session with no process: MAWS launched it at some time, and the newest record of its transcript that names an entrypoint names MAWS's (F37).
- **The transcript** is the engine's own file of a session's conversation.
- **The carriers round** is the probe of 2026-11-28 named in Progress. **A recording** is one of a probe's fixtures, an engine journal; the gate's suites play one back in place of an engine, in process (`src/engine-host/replay-transport.ts`) or as a real child process where a session host must hold one (**the stub engine**, `test/support/stub-engine.ts`).
- **The Mac runner** is the project's self-hosted Mac, the one the gate's `mini` lane runs on.

## Verification

- This document: one adversarial buildability review before M1's work resumes (the composite's Verification, "Each plan child's execution document").
- Each milestone: the task review of doperpowers:subagent-driven-execution at its boundary. M1 is reviewed, and M2 has run, before M4 consumes what the tool does with a ring.
- The branch: doperpowers:review-code at **medium** (the composite's Verification), once, on the whole range. The doperpowers pull request of M1 is reviewed at **high**: it opens the tool's delivery under a second runner and changes what a stopped turn leaves in both, and a fault there loses or duplicates the human's answer, which is why C2's own range was reviewed at that rung.
- The landing: through the master landing architect, after M1 is on doperpowers `main` and M6 has run against that commit.
- No look is asked of the owner for layout: this child draws one new line (the ring's, F39), whose words go to the owner through the composite's writer and hold no milestone. The two sentences of F7 were put to the owner, who let them stand.

## Constraints on every milestone

**Binding inheritance** (the composite's "Constraints on every child" and "Grades").

- The engine is an unmodified, pinned binary (charter D-1), reached through its launch line, its stream-json wire and its control protocol only. A claim about the wire is verified against `spikes/protocol-probe/fixtures/` or by M2's sitting, never against a document alone.
- §5.1: the tool delivers, in both kinds of session. MAWS composes no envelope, ties no message to an outcome, appends no acknowledgement and reads no delivery from its journal. Anything that would have MAWS decide whether an outcome was delivered is outside this child and goes to the composite's writer.
- Board ticket 711: no user-role text MAWS sends holds text a model wrote. The ring is a constant; the envelope's words travel as the tool's context.
- §3's one writer and §4.2's table: MAWS changes a sheet only by inbox lines through the door (C3's `SheetService.put`), computes no verdict, and acts only on what the record shows.
- X1 and X3: the published set is frozen at version 1. Nothing here changes a schema, an example, the grammar or the door's contract. Its steer example and its `delivered` line stay, unused.
- §8.1 is the owner's ruling: nothing opens by itself, calm state only, no question marks a session as stopped on the person.
- Nothing the owner uses today stops working at any step. A session whose question tool is `maws` launches with the same line, the same list and the same paragraph as before (the tool choice's A3; `src/engine-host/launch.test.ts` holds the line), and `ask` is served, answered and re-raised across a handover exactly as today until C7. Every path added here is inert for a session that is not a sheet launch, and M1 changes nothing for a session whose runner is `terminal` but F34's one fix.

**This child's own rules.**

- **Both repositories are public.** No file, test, fixture, document, commit message or pull request carries a path under a real home, a machine's name, an account, or the version of software installed on the owner's machines. Examples use invented names and paths; the set's copy under `test/fixtures/sheet/set/` is never edited. A recording holds the engine's own frames, and the engine's version with them.
- **Nothing is installed, built, typechecked or launched on the laptop this was written on.** Typecheck, lint, the unit suite and the probes' tests run on GitHub Actions: `scripts/ci-gate.sh <worktree> --gates static,unit,probes`. A commit that adds or changes a file under `spikes/protocol-probe/fixtures/qsheet/` is gated with `--gates unit,probes`: the unit suite seeds every recording there (`src/services/index/replay-fixtures.test.ts`). Each Electron e2e group a milestone names runs through the same script (`--gates e2e:<group>`). A call naming no gates is refused. In doperpowers the gates are `ci-gate --gates …` from its worktree, named in M1.
- **Live steps run on the Mac runner**, from clones under `~/.local/share/question-sheet-c5/` there (`maws/` and `doperpowers/`), each driven by a script that asserts from the record, the journal, the transcript and the scripted model's requests. No step is a person watching a window. The runner's load rule (`docs/doperpowers/plans/2026-10-14-gate-offload.md` §3.5) holds.
- **Every step that launches an engine on a Mac gives it a work folder under `/tmp`** (F41), and a scratch `HOME`, a scratch configuration directory and a scratch sminos home beside it. A work folder under a person's home makes the engine load that home's `CLAUDE.md` as an ancestor's project file whatever scratch home is set; the carriers round discarded its first trials for it.
- **Commits and the pull requests' bodies** end with the line `Sminos-Session: question-sheet-design#23738737 (MAWS on macbook)`.
- Light theme is the default; components use tokens only. Copy lives in a `copy.ts` beside its module and follows the word cut's rules (`docs/doperpowers/specs/2026-11-16-word-cut-design.md`).
- The wire moves once, in M4 (one host command): `WIRE_MINOR` (`src/shared/ipc/wire.ts`) rises by one over whatever master holds then, and `wire-manifest.json`, `wire-fingerprint.json` (both by `pnpm wire:manifest`), `routes.json` (by its test under `MAWS_ROUTES_WRITE=1`) and `src/shared/machine/address-paths.json` are regenerated in that commit; commit `8f59e9b42` (`session.tellAgent`) is the pattern. It moves in M3 as well only under M2's branch B6 (§S).
- This child adds cases to existing e2e specs and no spec file, so `default`'s own-spec pin does not move and no gate's group list changes. Its live driver is a rig with its own Playwright config, as C3's `e2e/sheet-live.rig.ts` is, which no group collects.

**Facts of the code and of the engine**, each read at the trees named above; "B1" to "B6" are the carriers round's.

- **What a launch's environment is.** `buildEnvironment` (`src/engine-host/launch.ts`) passes the login shell's variables through an allowlist that admits neither `SMINOS_HOME`, `DAEMON_HOME` nor any `MAWS_*`, and then sets its own (`SMNS_MEMBER`, `MAWS_LANE`). The other way a variable reaches an engine is the spec's `extraSettings.env`, which becomes the `--settings` JSON's `env` and which the engine applies to its process at startup; that is how `MAWS_NATIVE_TO_HUMAN` and `CUA_BROWSER_BACKENDS` travel (`extraSettingsOf` and `withOwnerChannel`, `src/services/sessions/launch-mapping.ts`). The journal's `spawn` row keeps the argument list, so a settings value is on record, and only the names of the process environment (`envKeys`).
- **Who knows a launch's session id.** `buildLaunch` resolves it: the resumed id, else the spec's `sessionId`, else one it mints. A prestarted engine's spec has `sessionId: null` (`prestartLaunch`, `src/services/sessions/prestart.ts`, writes nothing), so its id exists only inside `buildLaunch`, and an adopted prestart keeps that id (`runIntentSetup`, `src/services/sessions/setup.ts`).
- **What the prestart compares.** `sameLaunchSpec` (`src/engine-host/prestart.ts`) compares the two specs whole, `sessionId` set to null in both. `prestartKey` (`hostLaunchOf`, `src/services/sessions/machine-route.ts`) holds route facts only. Nothing compares `plan.env` or `plan.args`.
- **Where a launch's set is decided.** `Setup`, the session service's context for a launch, is declared in `src/services/sessions/setup-steps.ts` (`hostLists` is on it). `servedSet` (`src/services/sessions/served-set.ts`) is asked once per attempt by `runIntentSetup`, `runResume` (`resume.ts`) and `prestartLaunch`; the answer goes to the spec builders (`intentLaunchSpec`, `resumeLaunchSpec`) as `ctx.mawsTools` and to `ownerChannelLaunch` (`src/services/owner/launch.ts`) inside the spec. A record MAWS did not create (a discovered terminal session) has no `mawsTools`, which reads as the full set, question `maws`.
- **The supplement.** `ownerChannelLaunch` appends one only when the to-human lane is on with an external style (`APPENDS['external-style-plus-supplement']`), chosen by the spec's question tool: supplement 3 for `maws`, supplement 4 for `engine`, whose text says sminos's tool is not available (`ASK_ENGINE`, `src/shared/owner/contract.ts`). `decideFlags` renders a prompt anew when what a session recorded differs from what the decision wants.
- **The direct tell is on master.** `buildLaunch` passes `--plugin-dir <mods/maws-tell>` on every launch, after the engine's fixed flags and before `--model`. Its mod registers one tool on its own server, a `session.start` hook that calls `next` first, and three hooks matched to its own tool: no prompt hook, no unmatched `tool.call` hook, so it shares no dispatch with sminos's sheet. Another branch (`ux-wave/obs4`) adds one argument to every launch in `buildLaunch` or its argument builder.
- **sminos's start choice at `main`** (`chooseStart`, `sminos/hooks/mods/sheet-model.tsx`): `MAWS_QUESTION_SHEET` equal to the session's id gives the sheet with runner `maws`; a value that is set and does not equal it is logged and passed over, and the next rows (`MAWS_NATIVE_TO_HUMAN` set, or a session that is not interactive) give no question tool of sminos's at all. So a published sminos given `2:<id>` takes no sheet, and the session has the engine's built-in.
- **What sminos does under runner `maws`.** At `main` it drains, sends to running subagents, takes `delivered` lines, composes no envelope for the main conversation (`ready`, `sminos_sheet_step.py`: the main conversation's only for runner `terminal`), opens no route for it, lands nothing and searches no transcript at a start. Five places hold that back, each a test of the runner (`isTerminal()` in `sminos/hooks/mods/sheet.tsx`): the idle route in `deliver`, the envelope in `take`, the landing in the `session.append` hook, the search in `afterStart`, and the step's `ready`. At `75d21fc93` `take` and `withResultRoute` carry the notices and contexts there (not the envelope), and the prompt hook, on a prompt whose text holds a block, asks `sheet show --json --keys` and adds one line per answered subagent question (`askedBy`, `steerContext`, `shownOutcomes`, and a `show` option on the tests' harness).
- **A stopped turn in the tool, as built.** `endTurn` calls `deliver` only when the turn's reason is `answer`, but every adopted view and `orderKeys` call `deliver` too, and `gen.noIdle` (the keys the idle route will not start a turn for) is filled only by a failed idle submit (`missed`). So after a turn the person stopped, the next step for any reason (a dismissal, a reroute, a `landed` retry) opens the idle route for an answer that was ready at the Stop.
- **MAWS's constant frame over the wire** (B1, B4). Written to an idle session with an answer pending, the frame reaches the tool's prompt hook with origin `composer` and no turn id; the hook's context and the frame reach the model as one user message; the stored row is an attachment of kind `hook_additional_context` (hook `prompt.submit`), which the tool's `session.append` hook sees and lands, about a third of a second after. On the wire only the frame's own echo shows. The engine holds its reply to the host's `initialize` until the plugins' `session.start` has settled, and a frame written earlier waits with it, so no frame arrives before the tool's start; at a resumed launch with a queued answer the hook took the envelope (marked as answered while the session was stopped) and the start's context together.
- **A frame during a turn carries nothing** (B1). A `next` frame is given to the prompt hook when the engine folds it in, at the running call's result, by which time the result route has delivered on that result; a `now` frame moves the call to the background and the same happens. Any prompt that enters with an envelope ready carries it, the person's own included.
- **A dropped frame** (B2). A function hook can drop a host's frame (`return { drop: reason }`). The engine then echoes nothing and calls no model, and emits: `command_lifecycle` `queued` and `started`; `system/init`; a `system` frame of subtype `informational`, level `warning`, `prevent_continuation: true`, `prompt_submit_outcome: { kind: 'dropped_by_hook', prompt_kept: false, reason }`; a `result` (success, `num_turns` 0, the drop's sentence as its text, origin `human`); `command_lifecycle` `completed`. Read without the outcome field, that is a turn that ran.
- **The prompt hook has ten seconds** (B3). Past them the prompt enters without the hook's context, and the hook's later work is lost with it; the limit holds for every prompt.
- **Nothing of a delivery is on the wire** (B5). A context on a tool result is in the model's request and in the transcript, as an attachment of kind `hook_additional_context` (hook `tool.call`), and in no frame the engine sends its host; the same holds for a context on a prompt.
- **A process killed as an envelope landed** (B6). The resumed start's search of the transcript takes the key out of `pending` before any prompt; the common case is smaller still, since the `landed` step is a child process the kill of the engine does not reach.
- **Where the tool's start context goes over the wire.** On a resumed launch the classic SessionStart fires before the tool has made its choice, so the start's context rides the next prompt as that hook's context; only a compaction's SessionStart carries it itself.
- **What holds a process.** `SessionMaws.pending` is the tool server's calls in flight plus the asynchronous asks; `hardReasons` (`budget.ts`) refuses a release while it is above zero. Sheet questions are in neither count, since they are in no table of the host.
- **A steer in the queue** (`src/engine-host/queue.ts`). `MessageQueue.steer(content, { priority: 'next', preface })` refuses a session that is not ready, journals the `preface` rows with the frame's `out` row once the write resolves, and keeps a `next` steer among the pending steers it publishes (`QueueState.steers`) until the engine starts or drops it; a Stop's withdrawal phase (`holdAll`) holds such a steer into the app queue, to be sent later as a message.
- **Bringing a session up without sending.** `SessionService.acquire(appSessionId, reason, options)` (`src/services/sessions/service.ts`) resumes a session and resolves `{ status: 'ready', … }`; `reason` is logged and nothing branches on it; `resumeAfterHandover` calls it with `'resume'`.
- **A spine that may not wake the host.** `mawsd` loads the spine for a command, for the endpoint, or for the engine host's events (`ensure`, `src/mawsd/spine-seam.ts`). A load that only events caused is not `wanted`: its adapter refuses every dispatch to an engine host that is not ready (`host_unavailable`, `SpineHostsAdapter.dispatch`, `src/mawsd/spine-hosts.ts`), so it never starts a parked one. A need marks a load wanted (`need`, today only for the events in `NEED_EVENTS`), and a wanted load's `SpineHosts.need()` has `mawsd` start the host.
- **Who wrote a transcript's record.** Each record of the engine's transcript names the entrypoint that wrote it: `cli` for a terminal, `sdk-ts` for a launch of MAWS's (`OWN_ENTRYPOINT`, `src/engine-host/fs/holders.ts`; MAWS sets `CLAUDE_CODE_ENTRYPOINT` to it). The index's row holds the transcript's path (`transcript_path`, `src/services/index/sessions.ts`) and whether MAWS ever launched the session (`readRecordedRoute(record.gateway)`, `src/shared/engine/route.ts`, null for one MAWS only discovered); it does not hold who wrote last.
- **Events reach the spine at most once.** `mawsd/spine-hosts.ts` drops what arrives while the link is not ready, and an adopter's fold emits nothing again. A reader that must not miss a fact asks for it.
- **How a carrier is read for the transcript** (`question-sheet-c3`). `src/shared/engine/sheet-carrier.ts` reads a sheet's envelope on a plugin's prompt and on a hook's context, and `SheetRow` draws receipts from the deliveries a history holds and, while the record lives, from the record. The live wire carries no hook's context, so on the live route only the file's rows ever held one; a MAWS-run session's live rows have the record alone.
- **The channel journal.** `LaneBSource` (`src/services/channel/lane-b.ts`) records `question` and `answered` entries from a MAWS process's live events only, keyed by `src = <project>/lane-b/<appSessionId>/<anchor>`; the journal's `src` is unique, and an answer waits for its question's entry (`requires`). The renderer joins an answer to its question by the anchor's form (`questionOf`, `src/renderer/src/channel/project.ts`). sminos writes every sheet question, a MAWS-run session's too, to its own project log from the record, the question and its outcome under one `src` of its own, `sheet:<session>:<id>` (`src`, `sminos_sheet_step.py`; the projection in `sminos_sheet.py`); where the machine's sminos daemon is enrolled, its host events reach the same journal as lane A entries under `<project>/<writer>/<seq>` (`#journal`, `src/endpoint/rl10/link.ts`).
- **The notifier** on `question-sheet-c3` (`src/main/attention/notifier.ts`) announces a sheet item once per call and returns before any system notification for it, as for a terminal session's item; its comment leaves a MAWS-run session's to this child.

## Decisions settled at authoring

Each is a choice the composite left to this child. They are numbered in the F series (the charter's are D-, C2's K- and U-, C3's S-, C4's T-); the numbers not in this list (F9, F11 to F21, F28 to F30) belonged to the design in which MAWS delivered, are withdrawn, and are not used again. Where a decision makes a sentence of the composite false or incomplete, the sentence is in the last section. The interfaces they fix are §R, §S, §V, §W, §Y and §Z.

**The launch.**

- **F1 · A sheet launch is told by one fact the spec already carries: the served set's `question` is `engine`.** The launch line, the supplement, the spawn row, the prestart's comparison and an adopter all read `mawsTools` today, so no second fact can disagree with it. From this child on, "Default" on a host that lists F3's capability means the sheet where a sminos that knows the form runs, and the engine's built-in where it does not, as the composite's §9 says. Lost: a `questionSheet` flag on the spec, which is a second fact, a wire change, and one more thing an older host ignores silently.
- **F2 · The host sets `MAWS_QUESTION_SHEET`, in `buildEnvironment`, to `2:` and the session id `buildLaunch` resolved**, for a launch whose set's question is `engine` and whose spec names the sminos home (F4). Only `buildLaunch` knows the id of a prestarted engine, and an adopted prestart keeps it, so the variable a prestart was started with is the right one after Send. Lost: the spine writing it into `extraSettings.env`, the way `MAWS_NATIVE_TO_HUMAN` travels: the spine does not know a prestart's id, and a value in the spec is compared by `sameLaunchSpec`, so Send's id would never equal the prestart's and no Default chat would be adopted. **How it joins the prestart's key:** it does not need to. The comparison that decides an adoption is `sameLaunchSpec` over the whole spec; the variable is derived from two things the spec holds (the set and the home, both compared), a constant and the id the prestart itself minted (kept). `prestartKey` gains nothing.
- **F32 · The form is 2, and it is the host's constant.** The composite's §5.4 fixes the value's shape: the number names the delivery's form, so a plugin that would apply answers and never deliver them under a MAWS that rings (sminos as published, and `75d21fc93`) does not take the sheet. Form 1 was never set by any host: the value is `2:<id>` from the first host that sets the variable at all.
- **F3 · A host that sets the variable says so: the capability `engine.questionSheet`.** The spine reads it where it reads `engine.mawsTools` (`s.hostLists`), to choose the supplement (F6), to serve the override (F5), and before the ringer asks the host anything (F35). Without it a Default launch is what it is today. It says what a host will do for a launch it is asked for now; what a running process was launched with is read from that launch's own record (F31).
- **F4 · The spine names the sminos home, as `SMINOS_HOME` in the spec's `extraSettings.env`, for a launch whose set's question is `engine`.** The value is the one the sheet's reader was created with (`sminosHome(deps.env, shellEnv)` in `spine-root.ts`), so what a MAWS-run session's sminos writes and what MAWS reads are the same directory by construction, not by two resolutions agreeing. It is stable between a prestart and its Send, so the comparison holds. `DAEMON_HOME` is not passed: sminos reads `SMINOS_HOME` first. Every other launch's line is unchanged. A home that cannot be resolved (the test runner's refusal of the real one) names nothing, and then the host sets no variable either: a sheet whose record MAWS cannot find is one nobody could answer. That same rule closes the skew of an older `mawsd` over a newer host at a launch: a spine without this child never names the home, so that host gives its Default launches the engine's built-in, as today. Lost: admitting the two names through the host's allowlist, which passes the login shell's value and not the reader's (they differ wherever `mawsd`'s own environment names a home), and changes the environment of every launch. Whether a settings variable reaches sminos's own processes is M2's P6; its other answer has a written branch (§S, B6).
- **F5 · A session that already has a sheet is launched as a sheet launch for that launch, and its record keeps its set.** Before `servedSet`, a resume asks the sheet service for the record of the engine session it resumes; when the record holds an open question, a pending outcome or a queued line (the model's `open`, `hidden`, `pending`, and `sent` entries of state `queued`, any of them), and the host lists F3's capability, the set served is the record's with `question: 'engine'`. Nothing is written back: D1 stores a set once, and the stored `maws` goes on meaning `ask` for every launch that finds no sheet, until C7 retires the value. A record this build cannot read, or one read as `busy`, leaves the stored tool, logged. A fork resumes under a new session id and an empty sheet, so it is never overridden. Known residue: a session whose conversation was sent `ask` keeps it in its requests after a launch that does not list it, and a call of it is answered by the engine's own "No such tool available" (the tool choice's P2); it is logged, not built around.
- **F6 · A sheet launch's supplement is a new text, supplement 5**, chosen where 3 and 4 are (§R has it word for word). It names sminos's tool "where it is listed" and the built-in otherwise, because MAWS cannot know whether the session's sminos registered the tool (not installed, hooks off, or one that does not know the form), and supplement 4's sentence that sminos's tool "is not available here" would be false in every session this child serves. A session recorded under supplement 4 and resumed as a sheet launch has its prompt rendered anew by `decideFlags`' existing rule.
- **F7 · Two sentences of the app say what "Default" is, and they change** (§R). The owner read them and let them stand as written (2026-11-27).
- **F31 · Whether a running process is a sheet launch is read from its own launch, not from what the host can do today.** A host of before this child already launches `question: 'engine'` without the variable, and a host of this child that adopts such a process lists the capability though that engine never took the sheet. The test is the launch's spawn row: its environment's names hold `MAWS_QUESTION_SHEET`. The host answers a ring for any other launch with `not_sheet`.

**sminos (M1), a second pull request in doperpowers; the published set does not move.**

- **F8 · Under runner `maws` the tool delivers as it does in a terminal, by every route but its own idle prompt.** The result route and the prompt route carry the ready envelope, the notices and the contexts; a stored row of a route's kind lands its keys; a start searches the transcript for envelopes that landed before the process died; the step composes the main conversation's envelope. Four of the five tests of the runner that held this back go (in `take`, at the landing, in `afterStart`, in the step's `ready`); the fifth stays: the tool submits no prompt of its own there, because a plugin can attach no context to its own submit, does not know why its process was started, and its queued prompt is outside what a Stop in MAWS withdraws (the composite's §5.1). With the routes open, an ended subagent's open questions and a call's late outcome reach the main conversation in a MAWS-run session as in a terminal one (the composite's Acceptance 18, and the item C2's Status left for this child); doperpowers' TECH-DEBT row 54 keeps its other half, in both kinds of session. Of `75d21fc93`, the half that put the notices and contexts on a MAWS-run session's routes stays and is completed by this; the half that added a line per answered subagent question to a prompt carrying a block (`askedBy`, `steerContext`, `shownOutcomes`, the harness's `show`) is removed: the envelope is now the tool's own context and carries the question's words and the asker itself.
- **F33 · The tool fills a ring and drops an empty one, and waits for nothing.** A prompt whose whole text is the ring's sentence, under runner `maws`: when an envelope is ready for the main conversation in the view the mod holds, the prompt enters with it as context, as any prompt does; when none is, the hook drops the frame and takes nothing, so a notice or a start's context that was waiting still waits for a prompt that enters. No other prompt is ever dropped, and no prompt at all under runner `terminal`. A person's message can never be that prompt: MAWS writes a person's own frame whose whole text equals the sentence with one line break after it (§V), so under runner `maws` the only frame of exactly that text is a ring. The hook orders no step and waits for none: it has ten seconds for everything (B3), and a hook that passed them would let the frame in bare, as a turn about nothing. An answer the step has applied and the mod has not yet adopted is therefore not ready at that instant: the ring is dropped, the answer stays pending, and MAWS rings again (F36).
- **F34 · A turn the person stopped is marked in the tool, in both runners.** At the end of a main turn whose reason is not `answer`, every key then pending for the main conversation joins `gen.noIdle`, the set the idle route already will not start a turn for. That set's existing rules are then exactly the composite's Stop rule: nothing in it opens the idle route, a fresh answer does and takes the rest along, and a prompt that enters carries them all. It closes a gap of C2's as built (a later dismissal, a reroute or a `landed` retry opened the idle route after a Stop), which in a terminal session is the fault itself and in a MAWS-run session is the same rule MAWS's ringer keeps on its side (F36).
- **F10 · Nothing of the set changes.** Its steer example and the inbox's `delivered` line were written for the design in which MAWS composed and acknowledged; nothing composes or appends them now, and they stay in version 1 until the set's next version removes them (the composite's X3).

**The ring, and a session with no process.**

- **F35 · The ring is one constant frame, written by the host as a steer of its own kind, and only to a session that is ready with no turn running.** Its whole text is the composite's sentence. The host refuses it (`busy`) while a main turn is open or another ring waits unstarted: a frame folded into a running turn carries nothing (B1), and would then be dropped or, worse, read bare. It is the host's own kind of steer in the queue: not published among the pending steers a window shows, not holdable, and a Stop that finds it unstarted withdraws it from the engine and drops it, where it would hold a person's steer into the app queue and send it later as a message. A meta row rides its write (`sheet_ring`) so a reader of the journal can count rings; nothing reads that row to decide anything. MAWS keeps nothing else of a ring: whatever becomes of the frame, the outcome is landed by the tool or still pending.
- **F36 · The ringer runs on the spine, looks at the record and the session's state, and keeps only memory.** It rings when the table of "When MAWS rings" says so: an answer owed to the main conversation, the session ready and idle. A dismissal alone never rings. After a turn that ended aborted, the answers pending at that moment do not ring until the person's next message to the session, which carries them by the tool's prompt route; an answer that arrives after the Stop rings, and the tool's envelope then carries the others too. A ring whose turn ended, or that was dropped, with an answer it was for still pending is repeated after 2, 15 and 120 seconds and then not again for those answers: each repeat past a hook that ran out of time is a turn about nothing, and the answer still leaves with the next prompt of any origin or the next tool result. Everything the ringer remembers (the stopped answers, the count of repeats, the keys it started a session for) is lost with `mawsd`'s services and costs at most one ring or one start more.
- **F37 · An answer owed to a session with no process starts it when MAWS ran it last, once per key per run of the spine.** Owed is queued in the inbox or pending in the record: an answer the tool accepted before its process died is pending and starts the session like a queued one. A dismissal starts none. "MAWS ran it last" is read without the host, which may be parked: the index's record says whether MAWS ever launched the session (`readRecordedRoute(record.gateway)` is not null) and where its transcript is, and the newest record of that transcript that names an entrypoint names MAWS's (`sdk-ts`); a terminal that has written since leaves `cli` there. An archived session and one whose transcript cannot be read or names no entrypoint are not started. A key is tried once in a run of the spine: a start that ends in the session ready, or in a refusal that will not change by itself (the folder is gone, trust is not given), spends it; a failure that may pass (the host did not answer, an acquisition is already running) is tried again after 5, 30 and 120 seconds and then spent. No time is compared and nothing is written: the cost of forgetting is one start more after `mawsd` restarted, of a session that would come up, find nothing new and wait.
- **F38 · The ringer may wake a parked host, and nothing else of the sheet may.** A spine loaded only by the engine host's events refuses every dispatch to a host that is not ready, so a start asked for by an answer from `sminos sheet answer`, with no window open, would be refused. The ringer therefore states a need, once it has decided on F37's evidence that a session is to be started: `SpineHosts.want('sheet')` marks the load wanted, as an event in `NEED_EVENTS` does, and the acquisition's own wait then has `mawsd` start the host. Reading a record, drawing a sheet and deciding not to start a session never state it, so a record MAWS has no part in wakes nothing. What this does not reach is `mawsd` with its services not loaded at all: nobody there is watching the sheet's files, and an answer given then is seen when the services next load (a window, the page, any command). It is logged as a limit.
- **F22 · Nothing of the sheet is in what a process exit would lose.** `SessionMaws.pending` is not touched; a test pins that a session with open sheet questions, an answer pending and a ring unstarted reads zero from it.
- **F40 · The skews, stated.** A sminos that does not know form 2 (as published, and `75d21fc93`) takes no sheet under `2:<id>`: the session has the engine's built-in and supplement 5's second sentence. A host without the capability launches Default as today, and the spine appends supplement 4. A `mawsd` replaced by an older build while a sheet launch runs rings nothing: answers stay pending and leave with the person's next message or the agent's next tool result, since the tool's routes need no ring.

**What draws, and what else reads.**

- **F23 · A MAWS-run session's rows draw from the record while it lives and from the transcript's attachments after, and the ring is drawn as the sheet's own line.** Nothing of a delivery crosses the wire (B5), so the live route has only MAWS's own frame. C3's `SheetRow` already lays the record over a row's lines, and its reader already finds an envelope in a hook's context among a file's rows; neither changes. What is added is the ring: a person's-origin row whose whole text is the ring's sentence is no message of the person's, on every route, and is read as the sheet's arrival with no deliveries of its own.
- **F39 · A ring that was filled heads its turn with one line; a ring that was dropped leaves nothing.** The line is C3's notice row for a sheet's delivery: where the history being drawn holds the tool's context for that turn (a file's rows), it names the ids as C3 words it; where it holds only the ring (the live route), it reads "Answers from your sheet", this child's own words until the owner reads them. A dropped ring draws no bubble, no line, no notice of the drop and no turn: the engine reports it as a finished turn with zero model turns and a warning (B2), which MAWS reads by `prompt_submit_outcome` and keeps out of the transcript, the session's phase and the unread mark.
- **F24 · A MAWS-run session's sheet item is announced as an asynchronous `ask`'s is**: once per call (C3's S11), in the app while it is focused and by a system notification while it is not. A terminal session's stays in-app only. The test is the record's holder (`self`), read where the notifier reads the record.
- **F25 · The channel journal takes a sheet question from the live call and its outcome from the record, under the identity sminos gives them.** The question is what a MAWS process said (the rule of every lane B entry): at the live result of a sheet call, each entry the result's first line says was added becomes one `question` entry, with its options' labels as choices. The outcome is the record's: when a recorded question is pending or closed in the model, one `answered` entry is recorded, the answer, "Dismissed" or "Withdrawn"; it is looked for at each change of the record and again when the question's own entry is recorded. sminos tells the same question and outcome in its project log, and where its daemon is enrolled those arrive as lane A entries. Both lanes therefore key a sheet's entries by sminos's own shared source for the question and its outcome, with the kind: the journal's unique `src` then refuses the second arrival, in either order, whoever holds the session by then. A revise records nothing new: one question, one outcome. Today's `ask`, which sminos exports too, is not touched and is measured beside it.
- **F26 · A session set to `maws` is proven unchanged by the suites that hold it today**, named in M3 and M6, and by one new pin: its launch environment holds neither variable.

**Proof.**

- **F27 · What the tool does is proven where the tool is, and once more on MAWS's launch line.** That an applied outcome reaches the model once, in the conversation that asked, whatever becomes of a ring, is the tool's property: M1's suites hold each case on the mods' fake port, and M2 runs M1's branch under MAWS's launch line against the scripted model, where the model's history can be counted. MAWS's own tests are the ring, the wake and the drawing. A real model is needed for one thing, the agent naming the option the person picked, by its label, and M6 asks it under a cap.
- **F41 · An engine launched for a probe or a live step works under `/tmp`.** Its work folder, its `HOME`, its configuration directory and its sminos home are scratch directories under `/tmp`; a script that launches one refuses a work folder under the invoking user's home.

## When MAWS rings

The whole of MAWS's part in a delivery, fixed before it is built. It is small because the tool owns the rest: there is no state of an outcome here, only when to write one sentence.

### Who acts, and on what

| actor | where | what it does |
|---|---|---|
| the tool | sminos's mod and step, inside the session | applies inbox lines; composes the envelope; puts it on a route; lands it by the stored row; searches the transcript at a start |
| a surface | the app, the page, `sminos sheet` | appends answer, dismiss and retract lines through the door |
| the ringer | the spine | reads the record and the session's state; asks the host to ring; asks the session service to start a session |
| the host | the engine host's session | writes the ring, or refuses; withdraws an unstarted ring at a Stop |
| the engine | the pinned binary | gives the ring to the tool's prompt hook; runs the turn, or reports the drop |

### The table

`A` is the set of answers owed to the main conversation (pending with recipient `main`, kind `answer`). `S` is the set the ringer marked at the session's last aborted turn and has not cleared. A dismissal is in neither.

| the record | the session | the ringer |
|---|---|---|
| `A` is empty | any | nothing |
| every answer of `A` is in `S` | any | nothing, until the person's next message clears `S` (the tool's prompt route carries them with it) |
| `A` holds an answer not in `S` | held by MAWS, ready, no turn running, a sheet launch | **ring**, unless the repeats for these answers are spent |
| the same | held by MAWS, a turn running | wait: the result route may deliver; look again at the turn's end |
| the same | held by MAWS, not ready | wait for the session's status |
| the same | held by MAWS, not a sheet launch | nothing until its next launch |
| the same, or an answer queued and not cancelled | no process, MAWS ran it last, not archived | **start** it, once per key (F37); then the rows above |
| anything | held by a terminal or a background job | nothing: the tool there has its own idle route |
| anything | no process, and not MAWS's last, or archived | nothing: it goes at the session's next start |

### What moves the ringer

| what happens | what the ringer does |
|---|---|
| the record changes (`SheetService.onChange`) | a pass for that record |
| the session's status changes (ready, exited, adopted) | a pass |
| a main turn ends, not aborted | a pass (an answer applied during the turn, with no tool call after it, is still pending) |
| a main turn ends aborted | `S` becomes the answers pending now; then a pass, which rings for nothing |
| the person's message enters the session (a `user.message` of the person's that is not a ring) | `S` and the repeats are cleared |
| a ring's turn ended, or the ring was dropped, and an answer of `A` it was written for is still pending | a pass after the next wait of F36, at most three times |
| the host answers `busy` or `not_ready` | nothing now; the turn's end or the status brings a pass |
| the host's link comes up; the spine starts | a pass for every record with an answer pending or queued |

A pass reads the record and the index's record of the session afresh and asks the host; nothing it acts on is remembered from an event, which may have been lost.

### What each case leaves

Every row is the tool's guarantee seen from MAWS: the last column is what the model's history holds, and where it is proven.

| what happens | what MAWS did | the outcome | proven in |
|---|---|---|---|
| a second answer to the same question | nothing for it: the tool's verdict is `closed` and `A` does not grow | the first answer, once | M1, M6 scene 3 |
| a retract queued before the answer was applied; the session has no process | no start: a queued answer a queued retract cancels is not owed | nothing | M4, M6 scene 3 |
| the same line sent twice | one outcome in `A`, one ring | once | M1, M6 scene 3 |
| the ring finds nothing ready (the answer left by a tool result first; the mod has not adopted the view yet) | wrote a ring | the tool drops it: no turn. If the answer is still pending, a repeat | M1, M2 (W2), M4 |
| a ring is written twice | two rings | the first is filled; the second is dropped | M1, M2 (W3) |
| a ring is written after a `/clear` | a ring into the new conversation | dropped: the new session's sheet is empty, and the old record went with its conversation | M1, M2 (W4) |
| the person presses Stop on the turn a ring opened | the Stop; `S` marked | the tool looks for the envelope in the conversation at the turn's end: there, it lands; not there, the answer is pending and goes with the person's next message | M1, M2 (W7), M4, M6 scene 8 |
| after a Stop, a dismissal is sent | nothing | no turn; the dismissal and the stopped answer go with the next message | M1 (F34), M2 (W8), M6 scene 8 |
| the host is replaced between a ring and its landing | nothing more | the engine runs on; the tool fills and lands as if nothing happened; an unstarted ring the new host does not know is filled or dropped like any | M2 (the tool's part), M6 scene 14 |
| the process is killed as the envelope landed | a start, if an answer is still owed | the start's search takes the landed key out before any prompt; a ring that follows is dropped | M1, M2 (W6; the round's B6) |
| the hook runs out of its ten seconds | wrote a ring | the frame enters bare, a turn about nothing; the answer is pending; a repeat, bounded | M1 (the hook waits for nothing), M4 (the bound) |
| the answer is for a subagent that still runs | nothing: its recipient is the agent | the tool sends it directly | M1, M2 (W10), M6 scene 11 |
| `mawsd` is an older build while a sheet launch runs | nothing | pending until the person's next message or the agent's next tool result | F40; logged |

## Interfaces and Dependencies

`R/` is `src/renderer/src/`; `H/` is `sminos/hooks/mods/` and `S/` is `sminos/skills/sminos/scripts/` in doperpowers. Sections continue C4's letters; §X is skipped, since X1 to X7 are the composite's contracts, and §T and §U are not used. A milestone's name in a heading is where the interface is built. Code is given where it is itself the decision.

### §R · The launch (M3)

`src/shared/host/socket-protocol.ts`:

    export const ENGINE_QUESTION_SHEET_CAPABILITY = 'engine.questionSheet';   // in PEER_CAPABILITIES.engineHost; src/engine-host/detached.test.ts pins the welcome word for word

`src/engine-host/launch.ts`:

    export const QUESTION_SHEET_ENV = 'MAWS_QUESTION_SHEET';
    export const QUESTION_SHEET_FORM = 2;                                      // the delivery's form: the tool delivers, MAWS rings (composite §5.4)
    export function buildEnvironment(spec, captured, relayUrl, spawnerPid, holder, sessionId: SessionId): Record<string, string>

`buildLaunch` passes the id it resolved. `env[QUESTION_SHEET_ENV] = `${QUESTION_SHEET_FORM}:${sessionId}`` exactly when `(spec.mawsTools ?? FULL_MAWS_TOOL_SET).question === 'engine'` and the spec names the home (`spec.extraSettings?.env?.SMINOS_HOME` is a non-empty string); no other launch has the key, whatever the captured environment holds. The spawn row's `envKeys` then hold the name, which is F31's test of a launch. An adopter's rebuilt plan (`environmentRebuilt`) is not the engine's environment and nothing reads the variable from it. `ux-wave/obs4`'s new argument in this function or its argument builder touches neighbouring lines and merges by hand.

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
    ASK_SHEET = 'Ask the human with `mcp__sminos__AskUserQuestion` where it is listed: it puts your questions on this session\'s sheet and returns at once, and their answers reach you later, each naming its question by id and the options they picked by label. Where it is not listed, ask with the native AskUserQuestion, which waits for their answer. `mcp__doperpowers__AskUserQuestion` is not available here.'

Supplement 4 stays, for a Default launch on a host without the capability.

**The two sentences** (F7), each replacing the one that says "Claude Code's own"; the owner let them stand as written (2026-11-27):

| constant | file | becomes |
|---|---|---|
| `TOOLS_MENU.questionFacts.engine` | `R/composer/copy.ts` | "The question sheet, or Claude Code's own" |
| `MAWS_TOOLS.questionNotes.default.note` | `R/settings-tab/copy.ts` | "Default is the question sheet where sminos is installed: the session goes on working while you answer. Without it, Claude Code's own, which waits. A session keeps its own." |

**The records of the change.** One dated entry in the charter's Decision Log (`docs/charter.md`, §19) for supplement 5 and for what D6's `engine` now does; the tool choice plan's "What ticket 600 changes" rewritten to what was built.

### §S · sminos under runner `maws` (M1), and the wire sitting (M2)

On doperpowers `question-sheet-c5`, on top of `75d21fc93`.

**The start choice** (`H/sheet-model.tsx`, `chooseStart`; C2's I8, one row changed):

    MAWS_QUESTION_SHEET is `2:<the session's id>`   → 'sheet', runner 'maws'
    MAWS_QUESTION_SHEET set to anything else         → passed over, with one debug line saying which: another session's id, another form, or no form

A value that is the bare id (the form of the published plugin) is "no form" and is passed over. The constant is one export (`MAWS_FORM = 2`).

**The routes** (`H/sheet.tsx`, `S/sminos_sheet_step.py`), F8:

- `take(gen, route)` is the terminal's in both runners: the ready envelope as a flight, the notices, the context owed.
- The landing in the `session.append` hook and the search in `afterStart` run in both runners.
- The step's `ready` composes the main conversation's envelope for runner `maws` as for `terminal`. Its form is the terminal form of C2's I7 (the question's words, the picked labels, a subagent asker named with its state), since the carrier is the tool's own.
- `deliver`'s idle branch stays behind `isTerminal()`: under runner `maws` the tool submits nothing. Its sends to running subagents are unchanged. The line above the prompt (`bandNow`) stays a terminal's.
- `askedBy`, `steerContext`, `shownOutcomes` and the harness's `show` option are removed, with their tests.

**The ring** (`H/sheet.tsx`, the `prompt.submit` hook; `H/sheet-model.tsx`), F33:

    export const RING = 'The human answered questions on your sheet.'   // MAWS's constant frame (composite §5.4); the envelope's head is this sentence after `[sheet v1] `

Under runner `maws`, for a prompt whose `e.text === RING`: if `readyFor(gen, 'main')` is undefined, the hook returns `{ drop: 'nothing is ready on the sheet' }` before `take`, so nothing is taken and nothing needs putting back; otherwise it goes on as for any prompt. The check is made on the view the mod holds at that instant, in the same synchronous stretch as `take`; the hook awaits nothing before `next`. A generation that has not started (`routable()` undefined) drops a ring too: the start's own step is still running, and a ring let in bare would be a turn about nothing. Under runner `terminal` the constant has no meaning and nothing is dropped.

**A stopped turn** (`H/sheet.tsx`, `endTurn`), F34, both runners: when a main turn ends with a reason other than `answer`, each key the view lists as pending for the main conversation (and each key of its ready envelope) is added to `gen.noIdle`, and `gen.idleFailedAt` is set as a failed idle submit sets it for a view that is cut; nothing else of `endTurn` changes. `freshWake`'s rule then holds what the composite wants: those keys alone open nothing, a newer answer opens the idle route (in a terminal session) and its envelope carries them.

**Tests**, on the suite's fake port (`sminos/tests/mods/sheet-delivery.test.ts`, `sheet-model.test.ts`, `sheet.test.ts`) and the step's (`sminos/tests/test_sheet_step.py`). Under runner `maws`:

- a ring with an envelope ready enters with it, the stored hook-context row lands its keys, and a second ring is dropped; the same for a person's prompt, which carries the envelope and is never dropped whatever is ready;
- a ring with nothing ready is dropped and takes neither a waiting notice nor a waiting context, which the next prompt that enters then carries;
- a ring before the generation has started is dropped;
- a tool result carries the envelope while a turn runs, and a ring folded into that turn afterwards is dropped;
- no idle submit is ever made, whatever the view holds;
- a start whose record lists keys pending searches the transcript and lands those found (the fixture of the carriers round's B6 as the transcript);
- an envelope for the main conversation that answers an ended subagent's question names the asker and carries the question (the step's test);
- one Send that answers the main conversation's question and a running subagent's: the subagent's goes by the send, the main's by the next route.

In both runners (F34): after a turn that ended with a reason other than `answer`, a dismissal applied, a reroute and a `landed` retry each open no idle route; a new answer does, in a terminal session, and its envelope holds the stopped answer too; a prompt that enters carries all of them. The start choice: `2:<id>` takes the sheet; the bare id, `1:<id>`, `2:<another id>` and `3:<id>` do not, each with its debug line. `python3 -B sminos/tests/sheet-contract.gen.py --check` prints the set's digest unchanged. The plugin's version is one rise over `main`'s for the whole pull request. `docs/doperpowers/TECH-DEBT.md` row 54 and the C2 plan's I9 ("In a MAWS-run session") are brought to what the mod does.

**The wire sitting** (M2). Scenario `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, which the carriers round wrote: MAWS's launch line and initialize, the scripted Messages API stand-in, a scratch root under `/tmp`. For this sitting it loads M1's branch as it is, with no patch (`qsheet-c5-sminos-probe.patch` was the round's way to force a runner and is not applied), the direct tell's mod beside it, `MAWS_QUESTION_SHEET=2:<id>` in the process environment and `SMINOS_HOME` in `--settings`' `env`. Fixtures `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-m1-*.jsonl`; findings appended to `spikes/protocol-probe/findings-qsheet-c5-carriers.txt` under "M1's branch on the wire"; tests in `spikes/protocol-probe/fixtures.test.mjs` under "question sheet C5". In every cell the count is of the model's history: the last request's messages, and the transcript.

Two of its cells ask the engine something no fixture holds, and have a branch for each answer:

| id | question | each answer, and what it leaves |
|---|---|---|
| P6 | Does `SMINOS_HOME` given in `--settings`' `env` reach the mod's `$.env.get` and the processes it starts (the step, the bridge), from the process's first `session.start`? | **Yes** (the record is under the named home and nothing is under the scratch home's default place): F4 as written. **No (B6):** the home travels as a spec field. `LaunchSpecSchema` gains `sminosHome: z.string().optional()` (`src/shared/engine/launch-spec.ts`), written by the same builders for the same launches and never sent to a host without the capability; `buildEnvironment` sets `SMINOS_HOME` from it, and F2's "the spec names the home" reads the field. The wire's minor then rises in M3 as well as in M4 |
| P7 | With `MAWS_QUESTION_SHEET=2:<id>` on a new session, a resume and a fork, the tell's mod loaded beside: does `system/init` list sminos's tool, does the model's request hold its sheet schema and not the built-in? And with the bare id, and with doperpowers `main`'s plugin given `2:<id>`: is there no sheet? | **Yes to all:** F2, F32, F40. **The sheet is not taken under `2:<id>` (stop S7):** M3 to M6 wait for the composite's writer with the fixture. **A sheet is taken where it should not be:** a fault of M1's choice, fixed there |

The rest are M1's behaviour seen on the wire; a cell that fails is a fault of M1, fixed there before its pull request merges, and each cell's recording is what M4 and M5 replay.

| id | the cell | what the model's history and the record must show |
|---|---|---|
| W1 | a ring to an idle session with an answer pending | the envelope once, in the same message as the sentence; the key out of `pending`; `closed.<id>.deliveredAt` set |
| W2 | a ring with nothing pending; then a person's message of other words | the ring's frames are B2's (`prompt_submit_outcome` `dropped_by_hook`, a zero-turn `result`), no model request; the person's message enters and is answered |
| W3 | two rings written one after the other, an answer pending | the envelope once; the second ring dropped |
| W4 | an answer pending; `/clear`; a ring | nothing of the old sheet in the new conversation; the ring dropped; the old record removed |
| W5 | an answer applied one second into a long tool call; a ring written `next` during the call | the envelope once, on the call's result; what the engine does with a ring dropped while it is being folded into a turn (the lifecycle rows, any frame), recorded for §Y |
| W6 | the round's B6 on M1's branch: the engine and its children killed as the request holds the block; a resume; a ring | the key leaves `pending` at the start, before any prompt; the ring dropped; the envelope once across the two processes' history |
| W7 | a ring; an interrupt as soon as the frame's `started` shows; then a person's message | the envelope once: either it landed in the interrupted turn, or it is pending and rides the message |
| W8 | an answer pending at an interrupted turn; then a dismissal; then a person's message | no model request between the interrupt and the message; the message's context holds the answer and the dismissal |
| W9 | a resume whose record holds an open question and a queued answer; a ring at ready | the answer applied at the start with no frame written; the ring carries it and the start's context (B4); once |
| W10 | a subagent asks and still runs: an answer. A second asks and ends: an answer; a ring | the first in the subagent's history under the tool's opening line and not in the main conversation's; the ended subagent's notice once; the second in the main conversation's envelope, the asker named, the question's words with it |
| W11 | an answer pending; a compaction; a ring | the envelope once after the compaction, with the question's words |

### §V · The host's ring (M4)

`src/shared/maws/sheet-ring.ts`:

    export const SHEET_RING = 'The human answered questions on your sheet.';   // the composite's §5.4; sminos's RING is the same bytes, and a test in each repository holds its own to this line

`src/shared/ipc/` (`names/session.ts`, `schema/session.ts`, `grades/session.ts`), owner `engine-host`, deadline shape `immediate`:

    session.sheetRing { appSessionId } → { status: 'written'; messageUuid } | { status: 'refused'; reason: 'not_sheet' | 'not_ready' | 'busy' | 'not_written' }

No remote caller reaches it: it joins neither `src/endpoint/offers.ts` nor `ENGINE_HOST_ACTS` in `src/main/lane-b/remote.ts`, and a test over the offer table says so. The ringer runs on the session's own machine.

In `src/engine-host/session.ts` (handler in `ipc.ts`), checked in this order: `not_sheet`, the launch's spawn row does not name `MAWS_QUESTION_SHEET` among its environment's keys (F31; an adopted session reads the row it adopted); `not_ready`, the process is not `ready`; `busy`, a main turn is open, the queue holds a submission not yet ended, or a ring written earlier has not been started or dropped by the engine. Otherwise `MessageQueue.steer(SHEET_RING, { priority: 'next', host: true, preface: [{ event: 'sheet_ring' }] })`; a rejected write answers `not_written`. The answer says the frame was written, and nothing about a delivery.

`src/engine-host/queue.ts`:

    steer(content, opts?: { priority?: SteerPriority; preface?: Record<string, unknown>[]; host?: true }): Promise<{ messageUuid: MessageUuid }>

A steer with `host` is kept apart from the pending steers the queue publishes: it is in no `QueueState.steers`, `hold` and `cancelSteer` refuse its uuid as they refuse one that already started, a Stop's withdrawal phase (`holdAll`) asks the engine to cancel it and, when the engine did, journals `cancel` and drops it, and `settleAfterExit` abandons it with the rest. It lives in the queue's memory only; the queue's persisted and published shapes do not change. An adopter does not know a ring its predecessor left unstarted as the host's own: it is one of the fold's unended steers, it starts within milliseconds as any `next` steer to an idle engine does, and the tool fills or drops it. `ask`'s steer is untouched.

**A person's frame is never a ring.** In the three paths that write the person's own words (`submit`, the `session.steer` command's steer, `promote`), a frame whose whole text equals `SHEET_RING` is written with one line break appended. The queue entry keeps what the person typed.

The normaliser's `pushMeta` ignores an event it does not know, so `sheet_ring` needs no wire event.

### §W · The ringer (M4)

`src/services/sheet/ring.ts`:

    export interface SheetRingDeps {
      sheet: Pick<SheetService, 'list' | 'read' | 'onChange'>;
      host: { lists(capability: string): Promise<boolean>; dispatch: HostDispatch; onEvent: HostEvents; onLink(listener: () => void): () => void; want(reason: 'sheet'): void };
      sessions: { record(appSessionId: AppSessionId): SessionRecord | null; transcriptOf(appSessionId: AppSessionId): string | null;
                  acquire(appSessionId: AppSessionId, reason: 'resume'): Promise<AcquireOutcome> };
      lastWriter?: (transcript: string) => Promise<string | null>;                  // the tests' seam; defaults to lastEntrypoint
      clock?: { after(ms: number, run: () => void): () => void };                    // the tests' clock: the repeats and the retries
      log(line: string): void;
    }
    export function startSheetRinger(deps: SheetRingDeps): { stop(): void; idle(): Promise<void> /* the tests' wait: no pass running, owed or scheduled */ }
    export const RING_REPEATS_MS = [2_000, 15_000, 120_000] as const;
    export const START_RETRIES_MS = [5_000, 30_000, 120_000] as const;

`src/services/sheet/last-writer.ts`:

    export async function lastEntrypoint(transcript: string): Promise<string | null>   // the `entrypoint` of the newest record that names one; null: no file, no such record in the last 8 MiB, or an I/O error

It reads the file backwards from its end in blocks, takes whole lines only, and stops at the first line that parses and names an entrypoint. `OWN_ENTRYPOINT` moves from `src/engine-host/fs/holders.ts` to `src/shared/engine/` so the host and the spine read one constant.

Started in `startSpine` (`src/services/spine-root.ts`) where the sheet service is, when there is one, and wired there: `host.lists` is the capability read the session service uses (`hostLists`), `dispatch` and `onEvent` are `SpineHosts`', `onLink` is `hosts.onStreaming('engine-host', …)` (how the owner channel's follower learns of a reconnect, `src/services/owner/register.ts`), `want` is new (below), a record is the index's (`index.sessions.get`), the transcript's path is its row's `transcript_path`, and `acquire` is `SessionService.acquire`. It writes nothing to disk.

**One pass, for one record** (a session's passes never overlap; a trigger during a pass owes one more). The table of "When MAWS rings" is the rule; a pass is how it is read:

1. Read the model. No record, an unreadable one, or no app session for it: stop. `A` is the pending outcomes of recipient `main` and kind `answer`; `Q` the queued answers no queued retract cancels.
2. The index's record. Archived: stop. Holder `terminal` or `background_job`: stop. Holder `self`: step 3. Holder `none`: step 4.
3. Live. `A` empty, or every key of `A` in this session's `S`: stop. The repeats for these keys spent: stop. Otherwise `session.sheetRing`. `written`: remember which keys of `A` the ring was for. `busy`, `not_ready`: stop; the turn's end or the status brings the next pass. `not_sheet`: no more passes for this session until its next launch. `not_written`: one repeat is spent.
4. No process. `A` and `Q` both empty: stop. `readRecordedRoute(record.gateway)` null: stop. `lastEntrypoint(transcript)` not `OWN_ENTRYPOINT`: stop. Every key of `A` and `Q` already tried in this run, or in `S`: stop. Otherwise mark those keys tried, `host.want('sheet')`, and `acquire(appSessionId, 'resume')`. `ready`: nothing more; the status and the record bring the pass that rings. A refusal that will not change by itself (`needs_trust`, `missing_directory`, `failed`): logged, the keys stay tried. A failure that may pass (the host unavailable, an acquisition already in flight): the keys are untried again after the next wait of `START_RETRIES_MS`, three times.

**The session's turn, as the ringer hears it** (`session.eventBatch`): a main-lane `turn.ended` whose turn was aborted (the event's `terminalReason` is one of the engine's `aborted…` words) sets `S` to the keys of `A` as the record has them then; any other main-lane `turn.ended` brings a pass, and, when a ring was written for keys still in `A`, schedules the next repeat instead of ringing at once; a `user.message` of the person's that is not a ring clears `S` and the repeats. A ring's own end, filled or dropped, is heard as the `command.lifecycle` `completed` of the uuid `session.sheetRing` answered (§Y keeps a dropped ring's turn out of every reader, but not this event). Which words of `terminalReason` mean an aborted turn is read from `src/shared/graph/enums.ts` and the recordings (`aborted_tools` is one), and pinned by a test over W7's and W8's recordings.

**The wake** (F38). `src/mawsd/spine-hosts.ts` and `src/mawsd/spine-seam.ts`: `SpineHosts` gains `want?(reason: string): void`; the adapter's `want` calls the seam's existing `need` path, which marks the load `wanted`, logging the reason. After it, the session service's own wait on the engine host has `mawsd` start a parked one (`need`, as for any command of a wanted load). In the app's own spine the host is never parked and `want` is absent. Only step 4 calls it.

Tests, on a fake host and the stand-in door: each row of "The table", "What moves the ringer" and "What each case leaves" that names M4. Among them: an answer applied while a turn runs rings only at the turn's end, and not at all if the turn's end finds it delivered; after an aborted turn a dismissal and a retract ring for nothing, a new answer rings, and the person's message clears the mark; a ring dropped four times is not written a fifth time; an event lost (the pass at the link's return rings); two triggers in one pass make one ring; a session with no process and a queued answer is started once though the trigger fires three times; a queued answer a queued retract cancels, a queued dismissal alone, a session a terminal ran last (`cli`), one with no transcript, an archived one: none started, and for none of them is `want` called; an answer pending from before the process died starts it. And over the real seam (`src/mawsd/process-spine.test.ts`'s way: a real daemon over the built bundles and a scratch profile): **a spine loaded by an event alone, the engine host parked, an answer appended from outside** (the stand-in door, as `sminos sheet answer` would): the load becomes wanted, the host is started, the session is acquired, and one ring is written; the same with a record whose session a terminal ran last leaves the host parked.

### §Y · Drawing a MAWS-run session (M5)

**The ring as a row.** `src/shared/engine/sheet-carrier.ts` and `src/shared/engine/arrival.ts`: a person's-origin user row whose whole text is `SHEET_RING` is read, on all three routes (the live normaliser, a file's rows, another machine's rows), as the `sheet` arrival C3 added, with no deliveries. It draws no bubble. `R/transcript/`: the turn it opened is headed by C3's notice row for a sheet's delivery; where the same turn's history holds a hook's context with a block (a file's rows: C3's reader, unchanged), the row names the ids as C3 words it, and where it holds none, it reads `SHEET_ROW.ring`, "Answers from your sheet" (`R/transcript/model/copy.ts`). A person's message of the same words is not a ring: it carries the line break §V appends.

**A dropped ring** (`src/engine-host/normalizer.ts`, and `normalizer-arrivals.ts` where a prompt's turn is opened). The engine's frames for it are B2's. A ring is known at its `out` row by its text. Its `user.message` is emitted when the engine echoes it, not when it is written, so a ring that is never echoed is never a row; a `system` frame whose `prompt_submit_outcome.kind` is `dropped_by_hook`, while the prompt the engine last started is a ring, is not a notice; and the zero-turn `result` that names only that ring ends no turn a reader sees: no `turn.started` or `turn.ended` reaches the transcript, the digest's phase or the unread mark for it. The ringer still needs to hear it, so the normaliser emits one event for it, of an existing kind a transcript does not draw (`command.lifecycle` `completed` is already emitted; the ringer reads that for a uuid it rang with). A file's rows hold nothing of a dropped ring: the engine files no record for it.

**Receipts.** Nothing is added. While the record lives, `SheetRow` lays it over the row's lines (an answer accepted, then its receipt once the tool has landed it and the record shows the question closed); after, a file's attachments give the deliveries C3's reader reads. What W5 shows of a ring dropped inside a running turn is drawn as any dropped ring.

`src/main/attention/notifier.ts`: the return that keeps a sheet item in-app applies unless the item's session is held by MAWS (`view.record(appSessionId)?.holder.kind === 'self'`); the once-per-call rule is unchanged.

### §Z · The channel journal (M5)

`src/services/channel/lane-b.ts`, fed as today by live events (`seq` not null) and, new, by `SheetService`:

    LaneBDeps: sheet?: { read(session: string): Promise<SheetModel | null>; onChange(listener: SheetListener): () => void }
    export const sheetSrc = (project: string, engineSessionId: string, id: string, kind: 'question' | 'answered'): string   // `<project>/sheet/<engine session>/<id>` and `…/answered`, each part encoded as pathOf encodes

- **The question.** At the live `tool.result` of a call for which `isSheetCall(input)` holds, `callEntries(input, resultText)` (`src/shared/sheet/call.ts`) names the entries added; each becomes `{ kind: 'question', text: entry.question, choices: entry.options, at: the result's time }` under `sheetSrc(…, 'question')`. A revised entry, a refused one and a call whose first line is not the sentences record nothing. A subagent's call is read the same way.
- **The outcome.** For an id whose question's `src` is recorded (by either lane) and whose outcome's is not: an entry in the model's `pending` gives `{ kind: 'answered', text: the picked labels joined by ", " and the text, as `askAnswerOf` joins an ask's, at: acceptedAt }` for an answer and "Dismissed" for a dismissal; else `closed[id]` gives its `receipt` for `answered` (the record's own cut), "Dismissed" or "Withdrawn", at `closed[id].at`. It is looked for at each change of the record, and right after a question's entry is recorded, by one read of the record.
- **Lane A's entry for the same thing.** `#journal` (`src/endpoint/rl10/link.ts`): a host event whose own `src` is sminos's `sheet:<session>:<id>` is recorded under `sheetSrc(project, session, id, kind)` for its kind (`question`, `answered`) in place of `<project>/<writer>/<seq>`; every other event keeps today's `src`. The journal's unique `src` then keeps one entry for the question and one for its outcome, whichever lane's arrives first and whoever holds the session at either arrival; the entry kept is the first.

`src/renderer/src/channel/project.ts`, `questionOf`: an entry whose `src` is `<project>/sheet/<engine session>/<id>/answered` joins the entry of `<project>/sheet/<engine session>/<id>`, of either lane.

Tests: one sheet question and its outcome, lane B first and lane A first, and with the session's holder changed between the two arrivals: two entries in the journal each time. Today's `ask` beside it as the control, unchanged: whatever count it shows in each order is reported in this document's Progress and, if it is two, logged in `docs/tech-debt-tracker.md` and listed for the composite's writer; it is not this child's to change.

## The gates, by clause

The composite's Acceptance for this child as it stands at `2620c632b`, with the two sentences of its Purpose that are not in its Acceptance, Acceptance 18 as it reads for a MAWS-run session, and the killed process the composite's §12 names, cut into the clauses a milestone can prove. "Once" is a count in the model's history, in the conversation that asked.

| clause | what it says (the composite's C5 section) | proven in |
|---|---|---|
| A.a | Acceptance 7 for a MAWS-run session: it asks, nothing opens, the call's row shows one line per question, Open shows the side sheet at it | M5 (replayed), M6 scene 1 |
| A.b | an answer reaches the agent and the line becomes the receipt | M1, M2 (W1), M4 (the ring), M5 (the receipt from the record), M6 scene 2 |
| A.c | a released session, and one whose process is gone without a release, answered from the app and from `sminos sheet answer`, is started and receives the answer, by §5.4's sequence | M2 (W9: the start applies, the ring fills), M4 (F37's cases; the event-loaded spine and the parked host), M6 scenes 6, 7 and 15 |
| A.d | with a second competing answer, a retract and a resent line in the inbox, each ends in one delivery of the applied outcome and none of a refused one | M1 (C2's own cases under runner `maws`), M4 (a cancelled queued answer starts nothing), M6 scene 3 |
| A.e | a ring withdrawn by a Stop, a ring written twice, a ring written after a `/clear`, and a host handover between a ring and its landing each end with every applied outcome delivered once to the conversation that asked and none to another | M1, M2 (W3, W4, W7), M4 (the host's refusals, the queue's own kind), M6 scenes 8, 9 and 14 |
| A.f | after a Stop the answer goes with the person's next message and a dismissal sent meanwhile starts no turn | M1 (F34), M2 (W8), M4 (the ringer's mark), M6 scene 8 |
| A.g | a ring that finds nothing ready starts no turn | M1 (F33), M2 (W2), M5 (nothing is drawn of it), M6 scene 9 |
| A.h | a terminal session answered while stopped and then resumed in MAWS, its stored question tool `maws`, is launched with the sheet and receives the answer | M3 (the override, the launch), M6 scene 10 |
| A.i | Acceptance 8 in a MAWS-run session by the route P2 allows: answered while it runs, the subagent receives it; after it ended, the main agent receives it with the asker named | M1, M2 (W10), M6 scene 11 |
| A.j | a dismissal reaches the agent with the next prompt or tool result and starts no turn | M1, M4 (a dismissal alone neither rings nor starts a session), M6 scene 4 |
| A.k | after a compaction, and for the main conversation receiving an ended subagent's answer, the agent names the option the human picked | M2 (W10, W11: the labels are in the request), M6 scenes 12 and 13 (a real model) |
| A.l | a launch under a sminos that does not know the proof's form has the engine's built-in tool and no sheet | M1 (the choice), M2 (P7), M6 scene 16 |
| A.m | the channel journal shows one question and its outcome | M5 (both lanes, both orders, a holder changed between), M6 scene 17 |
| A.n | a session set to `maws` still has `ask` and is answered as today, on this machine and from another | M3 (its launch line and environment pinned; `e2e:tools`, `e2e:remote`), M4 (`e2e:supervisor-daemon`'s `ask` cases unchanged), M6 (the same groups on the landing's head, and scene 17) |
| A.o | a MAWS-run session's sminos writes its record under the home MAWS's reader reads; the launch names it | M2 (P6), M3, M6 scene 1 (under a home that is not the default) |
| A.p | a session whose question tool is "Default" is launched with `MAWS_QUESTION_SHEET` and takes the sheet, a prestarted one included | M2 (P7), M3 (the value is `2:` and the plan's id with a null spec id; a prestart's spec equals its Send's), M6 scene 1 |
| A.q | an open question no longer holds an engine process | M4 (F22's pin), M6 scene 5 |
| A.r | a subagent that ends with a question open: the main agent is told which, on its next route (Acceptance 18, in a MAWS-run session) | M1, M2 (W10), M6 scene 11 |
| A.s | a process killed as the envelope landed delivers nothing twice | M1 (the start's search under runner `maws`), M2 (W6) |

## Plan of Work

M1 is in doperpowers; M2 runs it on the wire; M3 to M6 are one pull request in MAWS, on `question-sheet-c5` rebased on the master that holds C3's second landing. **M1 starts at once and waits on nothing, C3's landing included.** Another session's work in doperpowers builds on M1's routes once they are on `main`, so M1 is reviewed and merged on its own, as soon as its gates and M2 are green, without waiting for anything in MAWS's `src/`.

    M1 sminos ──► M2 the wire sitting ──┬──► M3 the launch (P6, P7; C3's landing) ──► M4 the ring ──► M5 drawing, channel ──► M6 live
                                        └──► (M1 merges to doperpowers main)

M2 needs M1's branch and nothing of MAWS's `src/`. M3 waits on M2's P6 and P7 and on C3's second landing. M4 consumes M3's capability and M2's recordings. M5 consumes M4's constant and M2's recordings. M6 consumes all, and M1 on doperpowers `main`.

### M1 — sminos: the tool delivers under runner `maws`

**At its end.** In a session launched with `MAWS_QUESTION_SHEET=2:<its id>`, the tool delivers answers and dismissals to the main conversation by its result route and its prompt route, lands them by the stored row and at a start by the transcript, fills MAWS's ring and drops an empty one, and submits no prompt of its own. In both kinds of session, what was pending when a turn was stopped opens no idle route until a new answer or a prompt. A terminal session is otherwise exactly as before, and so is every session MAWS launches today, since none has the variable until M3.

**Blocked by.** Nothing.

**Where.** doperpowers, branch `question-sheet-c5`, on top of `75d21fc93`; one pull request, its body ending with the session line.

**Touches.** `H/sheet.tsx`, `H/sheet-model.tsx`, `S/sminos_sheet_step.py`, their tests (`sminos/tests/mods/`, `sminos/tests/test_sheet_step.py`), the tests' harness, the plugin's version, `sminos/hooks/mods/README.md`, `docs/doperpowers/TECH-DEBT.md` row 54, and the C2 plan's I8 and I9 where they speak of a MAWS-run session.

**Interfaces.** Exposes §S's behaviour to M2, M4 (what a ring is to the tool) and M6. Consumes C2's `take`, `putBack`, `withResultRoute`, `readyFor`, `freshWake`, `land`, `afterStart` and the step's `envelope`, all as built.

**Decisions.** F8, F10, F32 (the form's reading), F33, F34. Of `75d21fc93`: the `!isTerminal()` branch of `take` and the open result route stay as the start of F8; `askedBy`, `steerContext`, `shownOutcomes`, the harness's `show` and their nineteen tests go; its two rewritten MAWS-run tests are rewritten again to F8. The ring's check sits before `take` and awaits nothing, so the hook's ten seconds are spent only on what the hooks beneath it do. The step's change is one condition in `ready`; its view's shape does not change, and neither does anything under `sminos/types/sheet/`. F34 changes one place (`endTurn`) and no rule of `noIdle`. The mod's log says of each ring whether it was filled or dropped and why, at debug level, since M2 and M6 read it.

**Does not touch.** The door, the command, the set, the bridge, the terminal's routes but for F34, the idle route's own code.

**Proves.** A.b, A.d, A.e, A.f, A.g, A.i, A.j, A.l, A.r and A.s at the tool, on the suite's fake port and the step's tests: §S's list.

**Gate.** `ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,sminos-idle,version-bump` from the doperpowers worktree. `75d21fc93` has never been gated or typechecked: the first run is of the whole range.

### M2 — The wire sitting: M1's branch on MAWS's launch line

**At its end.** It is known, from recordings, that M1's branch under MAWS's own launch line takes the sheet under the named home, fills and drops a ring as §S says, and delivers each applied outcome once across a second ring, a `/clear`, an interrupt, a kill and a resume; and the recordings M4 and M5 replay exist.

**Blocked by.** M1's branch (its gates green; its review may still be open).

**What to build and how to run it.** The cells P6, P7 and W1 to W11 of §S, added to the carriers round's scenario, on the Mac runner, against the scripted model: nothing is spent. Every launch's work folder, `HOME`, configuration directory and sminos home are under `/tmp` (F41). The steps are Concrete Steps'.

**Promote or discard.** P6 and P7 each have their branches and one stop in §S. A W cell that fails is a fault of M1 and goes back to it; M2 is done when every cell passes on M1's head and that head is the one M1's pull request merges. A branch taken (B6) is written into F4, §R and M3 before M3 starts, by this document's writer.

**Touches.** `spikes/protocol-probe/scenarios/pass3/qsheet-c5.mjs`, `spikes/protocol-probe/fixtures/qsheet/qsheet-c5-m1-*.jsonl`, `spikes/protocol-probe/findings-qsheet-c5-carriers.txt`, `spikes/protocol-probe/fixtures.test.mjs`.

**Does not touch.** `src/`. The findings name no machine and no home.

**Proves.** A.b, A.c's start, A.e but for the handover, A.f, A.g, A.i, A.k's labels, A.l, A.o, A.p, A.r and A.s, on the wire.

**Gate.** `scripts/ci-gate.sh "$PWD" --gates unit,probes` on the commit that holds the recordings and their tests.

### M3 — The launch

**At its end.** A session whose question tool is "Default", new, resumed, forked or prestarted, is launched with `MAWS_QUESTION_SHEET` naming the form and its own session and `SMINOS_HOME` naming the home MAWS reads, on a host that lists `engine.questionSheet`. A session whose record already holds a sheet is launched the same way whatever its stored tool. Its supplement names the tool it has. A session set to "MAWS" is launched exactly as before.

**Blocked by.** M2's verdicts for P6 and P7; C3's second landing on master.

**Touches.** `src/shared/host/socket-protocol.ts`; `src/engine-host/launch.ts`, `launcher.ts` (the adopter's rebuild passes the id it has), `detached.test.ts`; `src/services/sessions/` (`launch-mapping.ts`, `served-set.ts`, `setup-steps.ts`, `resume.ts`, `setup.ts`, `prestart.ts`); `src/services/spine-root.ts`; `src/shared/sheet/read.ts`; `src/services/owner/launch.ts`, `src/shared/owner/contract.ts`; `R/composer/copy.ts`, `R/settings-tab/copy.ts`; `docs/charter.md` (§19), `docs/doperpowers/plans/2026-11-23-tool-choice.md`. Under B6 also `src/shared/engine/launch-spec.ts`, `src/shared/ipc/wire.ts` and the wire's three pinned files.

**Interfaces.** Exposes §R. Consumes `servedSet`, `sameLaunchSpec`, `ownerChannelLaunch` and `decideFlags` as they are, and C3's `SheetService.read`.

**Decisions.** F1 to F7, F31, F32. The capability is listed in the same commit that sets the variable. `launch.test.ts`'s pin of the full set's line is not edited; a second pin holds a Default launch's environment and settings, a third that a `maws` launch's environment has neither name, and a fourth that a Default launch whose spec names no home has no variable. The override reads the record once per attempt and the automatic retry reuses the spec, as D8 has it. `ux-wave/obs4`'s argument is merged by hand if it has landed.

**Does not touch.** `ask`, its flags, its server, its steer; `prestartKey`; the stored set of any session; and, unless P6 answered B6, `LaunchSpec`'s schema and the wire.

**Proves.** A.h's launch, A.n's launch, A.o, A.p at the unit level: `buildLaunch` with a null spec id and question `engine` has `env.MAWS_QUESTION_SHEET === '2:' + plan.sessionId`, and with a resume the resumed id; a `maws` launch has neither variable and its line is the pin's; `extraSettingsOf` writes the home for a sheet launch only; a Default intent's prestart spec equals its Send's under `sameLaunchSpec`, and a `maws` intent's differs from a Default one's; `sheetOverride` on each of: a record with an open question, a queued line alone, nothing, an unreadable record, a host without the capability, a fork; supplement 5 word for word, and `decideFlags` rendering anew from a recorded 4.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:remote`.

### M4 — The ring, and a session with no process

**At its end.** With `mawsd`'s services loaded, an answer owed to the main conversation of a MAWS-run session that sits idle gets one constant frame, and no session gets one while a turn runs, for a dismissal, or for what was pending at a Stop. A session MAWS ran last that has no process is started by an answer, once, also when the host was parked and no window is open. MAWS has written nothing but the frame.

**Blocked by.** M3; M2's recordings.

**Touches.** `src/shared/maws/sheet-ring.ts`; `src/engine-host/` (`queue.ts`, `session.ts`, `ipc.ts`, their tests, `session-maws.test.ts` for F22's pin, `fs/holders.ts` for the constant's move); `src/shared/engine/` (`OWN_ENTRYPOINT`); `src/shared/ipc/` (names, schema, grades, `wire.ts`, the three pinned files), `src/shared/machine/address-paths.json`; `src/services/sheet/` (`ring.ts`, `last-writer.ts`, their tests); `src/services/index/sessions.ts` (the transcript's path, if no reader of it exists); `src/services/spine-root.ts`; `src/mawsd/spine-hosts.ts`, `spine-seam.ts`, `process-spine.test.ts`; `e2e/requests.spec.ts`, `e2e/supervisor.spec.ts`.

**Interfaces.** Exposes §V's constant to M5. Consumes §R's capability and C3's service.

**Decisions.** F22, F35 to F38, F40, and the three tables of "When MAWS rings". The host's `busy` is the rule's own enforcement: the ringer may be wrong about a turn (its events can be lost), and the host is not. The ringer never asks a host that does not list the capability. `want` is called at one place. Nothing here reads a `command.lifecycle` to learn whether an outcome was delivered: the ringer reads a ring's `completed` only to time a repeat, and whether to repeat is the record's word.

**Does not touch.** `ask`'s table, steer and restore; `SessionMaws.pending`; `SheetService`'s reader and door; the components; the digest.

**Proves.** A.c, A.d's start, A.e's host side, A.f's mark, A.j, A.q, by §V's refusals in their order and §W's tests; and over real processes:

- in `e2e:c7`, replayed from W1's recording over a seeded record with the stand-in door: an answer sent in the side sheet of an idle MAWS-run session ends with one `sheet_ring` row in the journal and one frame of the constant text in the engine's input, and an answer sent while the recording's turn runs ends with none until the turn's end;
- in `e2e:supervisor-daemon`: an unstarted ring is withdrawn by a Stop and nothing of it is published or held; the `ask` cases of that suite are unchanged;
- `process-spine`'s case of §W: the event-loaded spine, the parked host, the outside answer.

**Gate.** Class 1a; `e2e:c7`, `e2e:supervisor-daemon`, `e2e:tools`, `e2e:lane-a` (the sheet service's terminal cases, unchanged).

### M5 — What draws and what else reads: the ring's line, the notice, the channel journal, the words

**At its end.** A MAWS-run session's transcript shows a delivery as the sheet's line and never as a message of the person's, and shows nothing of a ring that found nothing; its question is announced as its `ask` would be; the project's channel shows the question and, once, what became of it, whichever lane told it first.

**Touches.** `src/shared/engine/sheet-carrier.ts`, `arrival.ts`; `src/engine-host/normalizer.ts`, `normalizer-arrivals.ts`, `fs/backfill.ts` (only if a file's ring row does not already reach the shared reader); `R/transcript/` (the notice row's words, `model/copy.ts`); `src/main/attention/notifier.ts`; `src/services/channel/` (`lane-b.ts`, `register.ts`); `src/endpoint/rl10/link.ts`; `R/channel/project.ts`; `src/services/spine-root.ts`; `test/fixtures/sheet/transcripts/`, one snapshot under `test/snapshots/transcript/sheet/`; `e2e/channel.spec.ts`, `e2e/requests.spec.ts`; `docs/tech-debt-tracker.md`.

**Interfaces.** Consumes §V's `SHEET_RING`, C3's `callEntries`, `isSheetCall`, `sheetEntry`, `SheetRow`, `SheetService` and `isSheetItem`.

**Decisions.** F23, F24, F25, F39. Limits logged in `docs/tech-debt-tracker.md`, one row each: ringing and starting need `mawsd`'s services loaded, and an answer given while they are not is seen when they next load; a `mawsd` replaced by an older build rings nothing and a running sheet launch's answers leave with the next prompt or tool result; a prompt hook that runs past its ten seconds lets a ring in bare, a turn about nothing, at most four times for one answer; another SDK client that wrote to a session after MAWS reads as MAWS having run it last; a session that held `ask` and is launched with the sheet keeps `ask` offered and failing; a prestarted Default engine that is never adopted leaves an empty record for sminos's sweep; the live transcript's line for a delivery names no question until the transcript is read from its file.

**Does not touch.** The components (`R/sheet/`), the side sheet, `SheetRow`'s own drawing: they are C3's and draw any record. A fault found in one is fixed where it lives and reported.

**Proves.** A.a (in `e2e:c7`, replayed from M2's recordings over a seeded record: nothing opens, the row's lines, Open at the question, the "Waiting for you" line); A.b's receipt (the row's line becomes the receipt when the seeded record closes the question); A.g (the normaliser over W2's recording emits no row, no notice and no turn, and the snapshot of a transcript whose only ring was dropped is empty of it); the ring's line on the live route and, from a file's rows with the attachment, with its ids (one snapshot each); a person's message of the ring's words drawn as their message; A.m (§Z's tests); the notifier's two cases.

**Gate.** Class 1a; `e2e:c7`, `e2e:settings`, `e2e:transcript`, `e2e:panel`, `e2e:to-human`, `e2e:desk-web`.

### M6 — Live on the Mac runner, and the acceptance

**At its end.** Every clause of "The gates, by clause" has been observed in the running system: the built app, the real engine, the real sminos at the commit that is on doperpowers `main`, driven by one script.

**Touches.** `e2e/sheet-maws-live.rig.ts`, `e2e/sheet-maws-live.config.ts`, `e2e/support/sheet-live.ts` (C3's, extended) and `e2e/support/model-stub.ts`; this document's Progress and Outcomes.

**Decisions.** F27, F41. The driver follows C3's (`e2e/sheet-live.rig.ts`, `e2e/sheet-live.config.ts`): not a `*.spec.ts`, its own config its whole selection, the same variables (`SHEET_LIVE_DOPERPOWERS`, `SHEET_LIVE_OUT`), the same record readers and terminal driver from `e2e/support/sheet-live.ts`. Every scratch directory it makes is under `/tmp`, the sessions' work folders first of all, and it refuses to start otherwise. Its sminos home is one that is not the default's name, exported to the app so the reader resolves it, and never exported to the engine by anything but the launch. MAWS's launches reach the checkout's sminos through an engine wrapper the driver writes at run time and names in `MAWS_E2E_ENGINE_BIN`, as `e2e/support/headless-browser.ts` wraps the engine: it `exec`s the real binary with `--plugin-dir <the checkout's sminos>` and `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1` added, so the engine's parent is still the host (`SMNS_MEMBER`'s check). `MAWS_SMINOS_CLI` names the checkout's `bin/sminos`. Every scene but two is answered by the scripted model: `e2e/support/model-stub.ts` gains a script of replies (text, a tool call with a given input) in the manner of `spikes/protocol-probe/stub-api.mjs`, so those scenes spend nothing and every request the model was sent is on record. The two that need a model that reads (A.k) run on a real one, the smallest, through the gateway's variables as C3's driver does, under a cap of US$0.50 for the run; in each the option picked is the second of three, and the reply must hold its label and neither of the others'. **A delivery is counted in the model's history**: the last request's messages, and the transcript's attachments, never the number of requests that hold a block. **No scene waits a fixed time**: each waits for a row or a record (a key leaving `pending`, a `sheet_ring` row, the mod's log line that a ring was dropped), and "starts no turn" is the count of the model's requests being the same at the next such event. A process is ended by the means the scene names (a release as C12's live spec provokes one, `e2e/c12-live.spec.ts`; the session's own stop; a kill of the engine and its host); a handover as `e2e/supervisor.spec.ts` asks for one. The driver asserts from files and records only: the sheet's `state.json` and `inbox.jsonl`, the session's journal, the engine's transcript, the stand-in's requests, the mod's debug log, the channel's entries through `channel.history`, and what a window shows by role and name. It joins no list in `.github/workflows/gate.yml`: the gate's runners hold no sminos checkout.

**Does not touch.** Anything a milestone before it built, but for a fault the run finds, which is fixed where it lives and reported.

**Proves.** A.a to A.r, by the scenes Concrete Steps lists, in addition to every gate of M3 to M5 on the landing's head.

**Gate.** Class 1a; `e2e:tools`, `e2e:c7`, `e2e:settings`, `e2e:transcript`, `e2e:panel`, `e2e:to-human`, `e2e:lane-a`, `e2e:remote`, `e2e:supervisor-daemon`, `e2e:desk-web` on the landing's head; the live driver on the Mac runner.

## Concrete Steps

A gate tests the committed head and runs on GitHub Actions; nothing below is run on the laptop this was written on. `<doperpowers>` is that repository's worktree on `question-sheet-c5`. Steps marked "on the Mac runner" are run there over ssh, from `~/.local/share/question-sheet-c5/maws` and `~/.local/share/question-sheet-c5/doperpowers`, clones of the two public repositories at the branches under work, updated with `git fetch` and a checkout of the commit named in the step's report. The clones are the code; every engine they launch works under `/tmp`.

**M1.** In `<doperpowers>`:

    python3 -B sminos/tests/sheet-contract.gen.py --check          # the set is untouched: prints the same 21 cases, 6 examples and digest as before
    ci-gate --gates sminos-mods,mods-types,sminos,sminos-suites-a,sminos-suites-b,sminos-suites-c,sminos-idle,version-bump

The mods' suite ends with the kit's summary and no failure, with §S's cases in it and `75d21fc93`'s F9 cases gone; `claude plugin validate` prints no refusal for `sminos`.

**M2.** On the Mac runner, the doperpowers clone at M1's head (and, for P7's last cell, a second copy of the plugin at doperpowers `main`):

    cd ~/.local/share/question-sheet-c5/maws/spikes/protocol-probe
    QC5_SMINOS=~/.local/share/question-sheet-c5/doperpowers/sminos QC5_SMINOS_MAIN=<the copy at main> QC5_CELLS=m1 node run-pass3.mjs qsheet-c5
    QC5_SMINOS=… QC5_CELLS=m1 QC5_ONLY=w6 node run-pass3.mjs qsheet-c5        # one cell again

(The variables' names are the scenario's to fix, in its header beside the carriers round's own; these stand for: the plugin under test, the published plugin for P7's last cell, this sitting's cells, one cell.)

It prints one line per cell, `ok` or what was observed, and writes `fixtures/qsheet/qsheet-c5-m1-{p6,p7-new,p7-resume,p7-fork,p7-bare,p7-main,w1,…,w11}.jsonl`, each with the wire both ways, the sheet's state at each step, the transcript's rows in brief, the mod's debug lines, the stand-in's requests and the containment note. Before anything else: the containment note of every recording lists no instruction file but the engine's own, and no recording holds a path outside `/tmp`. Then the findings' new section says, for P6 and P7, which answer and which branch or stop; from the worktree:

    scripts/ci-gate.sh "$PWD" --gates unit,probes

**M3.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:tools,e2e:c7,e2e:settings,e2e:remote

`src/engine-host/launch.test.ts` shows the full set's line unchanged beside the new pins. The composer's Tools submenu and Settings › Sessions read the two sentences of §R.

**M4.**

    pnpm wire:manifest                                             # in the Mac runner's clone, never on the laptop; routes.json by its test under MAWS_ROUTES_WRITE=1; the regenerated files are committed with the command
    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:c7,e2e:supervisor-daemon,e2e:tools,e2e:lane-a

**M5.**

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:c7,e2e:settings,e2e:transcript,e2e:panel,e2e:to-human,e2e:desk-web

**M6.** The landing's gates, then the driver on the Mac runner, the app built from the landing's head and the doperpowers clone at the commit of `main` the report names:

    scripts/ci-gate.sh "$PWD" --gates static,unit,probes,e2e:tools,e2e:c7,e2e:settings,e2e:transcript,e2e:panel,e2e:to-human,e2e:lane-a,e2e:remote,e2e:supervisor-daemon,e2e:desk-web

    cd ~/.local/share/question-sheet-c5/maws && pnpm install && scripts/e2e-build.sh plain
    SHEET_LIVE_DOPERPOWERS=~/.local/share/question-sheet-c5/doperpowers SHEET_LIVE_OUT=~/.local/share/question-sheet-c5/out \
      pnpm exec playwright test --config e2e/sheet-maws-live.config.ts

It ends `17 passed`, one test a scene, and leaves under `SHEET_LIVE_OUT` a line of `steps.jsonl` for each assertion, each record as it stood, and each session's journal and transcript. The scenes, in order; "the model" is the scripted one unless the scene says real, and "holds it once" is a count in the model's history:

| scene | what the driver does | what it asserts | clause |
|---|---|---|---|
| 1 | types in a new chat whose question tool is Default, waits for the prestart, sends; the model calls the tool with two questions | the journal's `spawn` row names `MAWS_QUESTION_SHEET` among its environment's keys and `SMINOS_HOME` in its settings; the launch was adopted from the prestart; `state.json` is under the scratch sminos home and holds `q1`, `q2`; the side column is as it was; the call's row has two lines; the session's row reads "Question waiting" | A.a, A.o, A.p |
| 2 | with the session idle, presses Open on `q1`, picks its second option, types a note, presses Send | one `sheet_ring` row; the history holds `q1`'s envelope once, with the question's words, the picked label and the note, in the same message as the ring's sentence; `q1` left `pending` and `closed.q1.deliveredAt` is set; the inbox holds no `delivered` line; the transcript shows the sheet's line and no message of the person's; the row's line is the receipt | A.b |
| 3 | for `q2`, puts through the real command an answer, a second answer under another key, the first line again, and a retract of the second. Then, for a session with no process and one question open, an answer and a retract of it, both queued | the door's verdicts are `applied`, `closed`, `applied` again and `too-late`; the history holds `q2` once, with the first answer. The session with the cancelled answer is not started, and after its next start nothing was delivered for that question | A.d |
| 4 | the model asks `q3` and the turn ends; the driver dismisses it in the side sheet, then, once the record shows the dismissal pending, sends "go on" | no `sheet_ring` row and no request between the dismissal and "go on"; the history then holds the dismissal once, as context on that message | A.j |
| 5 | the model asks `q4`; the driver provokes a release | the session has no process while `state.json` holds `q4` open | A.q |
| 6 | answers `q4` in the app | the session is acquired with no message sent by the driver; one ring after it is ready; the history holds `q4`'s answer once, marked as answered while the session was stopped | A.c |
| 7 | the model asks `q5`; the driver kills the engine and its host, closes every window, waits for the host to be parked, and answers with `sminos sheet answer` from a shell | the host is started, the session acquired, one ring; the history holds the answer once. Starting `mawsd` again with nothing new starts the session once more at most and delivers nothing more | A.c |
| 8 | the model asks `q6` and then runs a sleep; the driver answers during the sleep (the result route delivers); the model asks `q7` and `q8`, the turn ends, the driver answers `q7` and presses Stop as soon as the ring's turn starts; then dismisses `q8`; then sends "go on" | `q6` once, on the sleep's result, and no ring for it; for `q7`: once, either in the stopped turn or with "go on", never both; no ring and no request between the Stop and "go on"; "go on" carries the dismissal | A.e, A.f |
| 9 | with nothing pending, asks the host for a ring through the rig's `invoke` (`e2e/support/c7-replay.ts`), twice; then `/clear`s a session that has an answer pending and asks again | each ring is dropped: the mod's log says so, no request, no row, no line in the transcript, the session's phase unchanged; nothing of the cleared session's sheet is in the new conversation's history | A.e, A.g |
| 10 | a terminal session (C3's driver's setup) asks, is closed, is answered with `sminos sheet answer` (queued), and is then resumed in MAWS, where its record's question tool is `maws` | no launch before the person resumes it (a terminal ran it last); the launch's set has `question: 'engine'` and the record's stored set is unchanged; the tools hold no `ask`; the history holds the answer once | A.h |
| 11 | the model starts a background subagent that asks, then sleeps; the driver answers during the sleep. A second subagent asks and ends; the driver answers | the first answer is in the subagent's history under the tool's opening line and not in the main conversation's, and no ring was written for it; the main conversation's history holds the ended subagent's notice once; the second answer arrives by a ring, its envelope naming the asker and holding the question's words | A.i, A.r |
| 12 | real model: asks it to put one question with three named options on its sheet, compacts, answers with the second option | the model's reply holds the second option's label and neither of the others' | A.k |
| 13 | real model: asks it to have a subagent put one question with three named options and finish; answers with the second | the main agent's reply holds the second option's label and neither of the others' | A.k |
| 14 | the model asks `q9` and the turn ends; the driver answers and asks for a host handover as the ring is written | the journal holds `host_detach` and `host_attach`; the history holds the answer once; `q9` left `pending` once | A.e |
| 15 | the person ends a session with a question open (the session's own stop); the driver answers it in the app. Then archives another such session and answers it from the command line | the first is started once and its history holds the answer once; the archived one is not started and its answer stays queued | A.c |
| 16 | starts a Default session with the engine wrapper pointing at the plugin of doperpowers `main` | the tools hold the engine's built-in `AskUserQuestion` and no sheet schema; no record is made; a question is asked and answered in its call's row as today | A.l |
| 17 | reads `channel.history` for the project; then starts a session set to MAWS and has the model call `ask` | for `q1`: one `question` entry and one `answered` entry; the `maws` session's tools hold `ask`, its environment's keys hold neither variable, and the ask is answered in its form | A.m, A.n |

## Outcomes & Retrospective

Pending — written at finish.

## For the composite's writer

State, like Progress. Three lists: the sentences of the composite, as it stands at the parent pin `2620c632b`, that this document makes false or incomplete, each with the replacement proposed; what needs the owner; what the `ux-wave` session should be told. An advisory sentence this child overturns is this document's text from now on; a binding one stands until the writer rules.

**Sentences.**

1. §5.4, "A frame that finds nothing ready is dropped by the tool's hook, and no turn starts." Incomplete on two points. The frame the tool drops is one whose whole text is the sentence, under runner `maws`; so that a person's message can never be that frame, MAWS writes a person's own message of exactly those words with a line break after it. And "ready" is the view the mod holds at that instant: an answer the step has applied and the mod has not yet adopted is not ready, the ring is dropped, and MAWS's repeat carries it. Proposed addition: "The tool's hook waits for nothing: a ring that arrives before the mod holds the answer is dropped and repeated."
2. §5.4, "A ring whose turn ended with its answer still pending is repeated a bounded number of times with a growing wait". Proposed, the bound as built: "after 2, 15 and 120 seconds, and then not again for those answers until a new answer or the person's next message".
3. §5.4, "it does not ring after the person's Stop: what was pending when a turn was stopped leaves with the person's next message". Proposed addition: "MAWS's mark is in its services' memory and holds across the end of that process: a stopped answer neither rings nor starts the session until the person's next message, or until `mawsd`'s services have restarted, after which it is an answer owed like any other." The composite's "A session with no process" paragraph would otherwise have the stopped answer start the session as soon as its process is released.
4. §5.4, "brings the session up, once per answer". As built: once per key per run of `mawsd`'s services, with nothing written; after a restart of the services a session that came up without taking the sheet may be started once more. And "An answer from any surface starts this, the page and `sminos sheet answer` included": while `mawsd`'s services are loaded. With no window, no page and no command since `mawsd` went quiet, nothing watches the sheet's files, and the answer is seen when the services next load. Proposed: both said there, the second as a stated limit.
5. §5.4, "a session MAWS ran last". How it is known, for the composite to say: "MAWS ran a session last when its index holds a launch of it and the newest record of the engine's transcript that names an entrypoint names MAWS's own; a terminal that has written since makes it the terminal's. It is read without the engine host, which may not be running."
6. §5.4, "What MAWS draws … MAWS's frame is drawn as the sheet's own line". Incomplete: the live route cannot name the questions a ring delivered, since nothing of the envelope is on the wire; the line reads "Answers from your sheet" until the transcript is read from its file, where it names the ids. And a ring the tool dropped is drawn as nothing at all, which MAWS has to arrange: the engine reports it as a finished turn with a warning.
7. §7, "a session with such a sheet is launched with `MAWS_QUESTION_SHEET` and without `ask`, whatever its stored question tool is". Proposed addition: "for that launch: the stored tool is kept and decides again once the sheet is empty. It needs a host that sets the variable (the capability `engine.questionSheet`); a record MAWS cannot read leaves the stored tool; and a session whose conversation was once sent `ask` keeps it offered and failing there (the tool choice's P2)."
8. §9, "a session whose question tool is "Default" … is launched with `MAWS_QUESTION_SHEET`". Proposed addition: "and with `SMINOS_HOME` in its settings' environment, naming the home MAWS reads, on a host that lists `engine.questionSheet`; the host sets the variable only where the launch names that home. Its supplement is a new text, 5, which names sminos's tool where it is listed and the built-in otherwise. Whether a running process has the sheet is read from its own launch's record."
9. C5's section, "`MAWS_QUESTION_SHEET` must be part of that launch key". As found: an adoption is decided by comparing the two specs whole (`sameLaunchSpec`), and the variable is derived from the spec's set and home, a constant and the id the prestart minted, so it is covered with nothing added; `prestartKey` holds route facts only. And "`ux-wave/subagent-tell` … whose load order relative to sminos this child checks": it is on master; its mod shares no hook's dispatch with the sheet, and M2 runs both.
10. C5's section, Status, "(doperpowers `question-sheet-c5` at `75d21fc93`: a MAWS-run session's routes carry the sheet's notices), which the rewritten first milestone builds on". Half of that commit is removed by M1: the line it added to a prompt carrying a block, one per answered subagent question, has no job now that the envelope is the tool's own context.
11. §11, "the third by C5 (`src/services/channel/lane-b.ts`)". Proposed addition: "A sheet question enters the channel journal from the live call that added it and its outcome from the record (an answer, "Dismissed" or "Withdrawn"), one entry each; a revise adds none. sminos's own project log tells the same two, and where they arrive by its lane as well, both lanes key them by sminos's source for the question, so the journal holds each once."
12. §8.1, "For a terminal session it is the in-app notice only". Proposed addition: "A MAWS-run session's is announced as its asynchronous `ask` is: by a system notification while the app is not focused, once per call."
13. §6, the MAWS-run paragraph, "an ended subagent's answer is the main conversation's like any other: MAWS rings for it". True, and one thing beside it: an answer to a subagent that still runs is never MAWS's to ring for, and the ringer reads that from the outcome's recipient alone.

**For the owner, through you.** One line of copy, when convenient: the transcript's line for a delivery on the live route, "Answers from your sheet" (F39). It holds no milestone.

**For the `ux-wave` session, through you.** The launch shape is fixed as follows. A launch whose set has question `engine` and whose spec names the sminos home carries one more environment variable, `MAWS_QUESTION_SHEET`, set by the host inside `buildLaunch` to `2:` and the session id that function resolves, so a prestarted engine has it with the id the prestart minted and keeps it through adoption; and one more settings variable, `SMINOS_HOME`, written into the spec's `extraSettings.env` by the spec builders, the same at prestart and at Send. Nothing joins `prestartKey`, and `sameLaunchSpec` needs no change. The host lists a new capability, `engine.questionSheet`. The wave's own new argument in `buildLaunch` sits beside these lines and merges by hand. Three things the wave may meet: a prestarted Default engine runs sminos's start, so an abandoned prestart leaves an empty sheet record under the sminos home, which sminos sweeps; `MessageQueue.steer` gains one option (`host`), and a host's own steer is kept out of the pending steers a window shows; and the three paths that write a person's own words append a line break to a message that is exactly "The human answered questions on your sheet.".
