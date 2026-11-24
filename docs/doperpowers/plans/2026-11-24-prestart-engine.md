# Prestart: a new chat's engine starts on the composer's first keystroke

> **Ticket:** board ticket 851. Its "Done when" is the contract; "Acceptance" restates it line by line.
>
> **Root:** `docs/charter.md`. D-1 binds: the engine is driven over its wire, never patched. This plan changes no part of X1 (the session record), no stored file and no launch spec field. X2 gains three commands and one optional field of `session.launch` (Interfaces). §4.4 is read in D9. The prewarmed spare pool (§P1, `claim_session`) stays deferred (D13).
>
> **Parent pin:** master `f2b32d6c9`. Every statement about the code below was checked against that commit.
>
> **Branch:** `ux-wave/prestart-engine`.
>
> **Revision 3 (2026-11-24): the structure changes.** The second adversarial review (of `b3ec9b017`) returned four P1s and four P2s. Every P1 had the same root: revision 2 made a prestart durable (its note) and left it half visible across stores that commit separately (the record, the owner binding, the route, a lane B member, a plugin surface). Patching each store would not have converged. Revision 3 makes the prestart ephemeral and puts it in the host:
> - **The host owns it.** It lives only while the spine connection that asked for it lives, and the host kills it when that connection drops or the host restarts.
> - **Nothing durable is written.** No note, no record, no reservation, no journal, no state file.
> - **It stays invisible until commit.** A host-side "uncommitted" flag hides the row from everything outside the host.
> - **Commit is one host operation:** `session.launch` with an `adopt` field. Around it, the spine's Send runs today's launch path unchanged, in today's order.
>
> Recovery therefore never meets a prestart. After any crash the engine is gone and Send launches as today. The first two reviews' nineteen findings are accounted for under "The findings of all three reviews", and the stop rule is answered in "Does the structure close it?".
>
> **Revision 4 (2026-11-24): the third review folded in.** The third review (of `0b3277679`) kept the ephemeral host design and found five P1s and four P2s. The architect and I recommended parking; the owner chose to fold them in and build. "Revision 4: the third review's rules" gives each finding its rule and its test, R4-1 to R4-9; where a rule amends D1–D11, that decision says so. In short:
> - **The durable commit point** is a promotion the native session host writes and acknowledges.
> - **Staging.** The hosted sequence map is staged with the journal.
> - **One gate.** The host keeps a public and an internal view of its rows, and publishes a snapshot at commit.
> - **The spine** fences its own request with an epoch.
> - **Send's reply** never waits for the surface.
> - **The endpoint** holds an uncommitted pin's member.
> - **Ownership.** A prestart is owned by the spine root that asked for it, not the daemon's link.
> - **The buffer** has a byte ceiling.
> - **Adoption** takes only a row in a claimable state.
>
> The native holder's work comes first, as its own milestone (M1).

## Purpose

Today a new chat launches its engine at Send. The person then waits for the engine to boot, run its SessionStart hooks and answer `initialize` before the first prompt is even written: about 2.2 s of the 4–5 s from Send to the first drawn row, measured on the owner's Mac on 2026-11-23.

After this plan, a New chat's engine starts at the first keystroke, from the launch spec as it stands at that moment. At Send the host hands that already-initialized engine over to the session, provided its spec still matches. Otherwise Send launches as today.

Until Send, the engine belongs to the draft, not to any session. Nothing outside the host can see it, and the host never writes it to disk, so a draft that is never sent leaves nothing behind. The one exception is the sminos membership it takes at SessionStart (Known limits 2).

## How the reference apps do it

**Claude Desktop** (`readable/app-5.1231.2`, read through `research/SOURCES.md`).

*What starts a prewarm*
- **The trigger is typing**, not opening the pane:
  - the composer calls `noteTyping` on every non-empty text change (`web/app/v1/cc43287c9-CQ79M14o.js:85839`, `:88218-88221`);
  - only for a new local draft (`:88142`, `:26575-26577`);
  - the first keystroke fires at once; later changes to the draft's settings are debounced 800 ms (`:26578`, `:26853-26866`).
- **Two kinds, at most one at a time** (`main-process/index.chunk-BjORVu2_.js:102295`; `index.chunk-BAt7rHkB.js:4674`):
  - a draft with a folder gets an Agent SDK spare: `prewarm()` parks it with `--await-claim`, and at send `claim_session` supplies the folder, trust, mode and environment (`index.chunk-BY2YbbTr.js:19840-20094`, `:17138-17186`). This kind is behind a GrowthBook gate (`BjORVu2_.js:102200`).
  - a draft with no folder gets a full session started hidden, `prewarmHidden` (`BjORVu2_.js:102141-102172`).

*How it stays hidden*
- It lives only in in-memory maps of the main process, never in `sessions` (`:102300`, `:102332`).
- `saveSession` writes no row for it (`:68020-68026`).
- Its events are swallowed; some are buffered and replayed at claim (`:91827-91845`, `:102814-102817`).
- Every IPC method that names its id answers "Session not found" (`BAt7rHkB.js:7864-7884`).
- Title generation and the restart checks skip it (`BjORVu2_.js:68064`, `:97059`).

*Claim, miss and lifetime*
- **Claim at send:** the draft's key must still match. Any miss (`key_mismatch`, `spare_exited`, `host_options_changed:*`, `cli_version`, `claim_timeout`, and others) disposes the prewarm and cold-starts (`BjORVu2_.js:103114-103158`, `:102488-102631`, `:104061-104082`).
- **Lifetime:**
  - a 10-minute TTL, with a claim refused past 8 minutes (`:102419-102422`; `cc43287c9-CQ79M14o.js:26872-26886`);
  - memory pressure and the process cap reclaim it first (`BjORVu2_.js:94479-94490`, `:102704`);
  - app quit disposes it (`:94547-94553`).
- **Ownership:** the prewarm is a child of the main process and dies with it. A crash can leave a stray park directory (`~/.claude/spares/spare-*`, `BY2YbbTr.js:19847-19879`), which nothing sweeps.
- **Telemetry:** `desktop_ccd_spare` and `desktop_ccd_session_start_timing`, with fields such as `prewarm_lead_ms` and `spare_miss_reason` (`index.chunk-BcuLdHaI.js:525-535`).

**Codex desktop** (`~/codex-app-src/readable/chatgpt-26.1111.21308`, still on disk despite SOURCES.md; the installed app is a newer build, 26.1117).
- **How it prewarms:** the app keeps at most one prewarmed thread per working folder (`main-process/early-bootstrap-226-2f6bd181558008cf.js:77556-77680`, `prewarmedThreadByCwd`). It starts the thread ahead with the app server's `thread/start` (`:102873`).
- **Claim:** `consumePrewarmedThread` uses the thread at start only when the folder, roots, service name and history mode all match. Otherwise it discards it with `thread/unsubscribe` (`:77632-77660`, `:70600-70611`; the discard sends `thread/unsubscribe`, `:82570`).
- **Lifetime:** it is tied to the app-server connection. The app clears every prewarmed thread when the connection reconnects, when feature enablement changes and when it disposes (`:102583`, `:254618`, `:81488`).
- What triggers the prewarm in the renderer was not traced.

**What MAWS takes from them**
- **Taken:**
  - the trigger is typing;
  - at most one prewarm per machine;
  - the prewarm lives in memory, owned by the process that holds the connection, and is cleared when that connection ends;
  - it is hidden by refusing its id outright, not by filtering each reader;
  - a key mismatch at send means a cold start, never an error.
- **Differs:**
  - MAWS owns the prewarm in the engine host, not in the window, because sessions outlive the window here (D-16 as amended);
  - MAWS relaunches on every change rather than applying model and mode at claim (D6);
  - MAWS reaps by the idle release rather than a fixed 10-minute TTL (D9).

## What the wire says (evidence)

| | Fact | Evidence |
|---|---|---|
| W1 | SessionStart hooks run inside `initialize`, before its response. | `fixtures/p4/p4-r7y-stub-command.jsonl` seq 4–7; `uxwave/uxwave-851-hook-idle` |
| W2 | `system/init` arrives only with the first user message. | `p4-r7y-stub-command-plain.jsonl`; `uxwave/uxwave-851-idle` |
| W3 | A new session writes no transcript before its first message, even when a hook returned `additionalContext`. | `findings-uxwave-851-prestart.txt` Q1, Q2 |
| W4 | While it waits, the engine makes one `HEAD /api/hello` and no `/v1/messages` request. Measured over 60 s on 2.1.331. | `uxwave/uxwave-851-idle` |
| W5 | Mode, model and effort hold when set before the first message. Not used here (D6). | `uxwave/uxwave-851-set-model`, `-set-mode`, `-effort-live` |
| W6 | Additional directories have no live control. A folder decides the trust key, the project settings, `.mcp.json` and the hooks that have already run. | bundle 2.1.322; `src/engine-host/launch.ts` |
| W7 | An idle engine uses 215–420 MB and starts its stdio MCP servers before `initialize` is answered. | `real-settings-idle-1.jsonl`; `findings-p5-o16-veto-mcp.txt` 41–43 |

## Design

**D1 · The host owns a prestart, as an uncommitted row.** `session.prestart { spec, key }` asks the engine host to launch `spec` for `spec.appSessionId` and mark the row uncommitted. `key` (D5) is an opaque string from the spine.
- **The admission.** The host registers the admission synchronously, in the handler, before its first await. The admission names the asking connection (its `ClientRef`) and carries a generation number the host assigns. Every later event for that id cancels an admission whose launch has not started yet: a newer prestart, `session.launch`, `withdraw`, `forget`, `stop`, or the connection ending. The launcher re-checks the admission after its probes and before it spawns (`launcher.ts`), so a cancelled admission never spawns.
- **At most one uncommitted row per host,** as in both reference apps. A prestart for another intent kills the older one: the latest typing wins.

**D2 · An uncommitted row is visible to nothing outside the host** (the gate is widened to every public projection by R4-3, and to the endpoint by R4-6). Revision 2 had a filter per reader; revision 3 has a single gate in the host. Until commit:
- **No events and no listing.** The host emits no `session.status` or `session.eventBatch` for the row. `engine.sessions` leaves it out, so no listing of the spine, the renderer, the budget or the connectors sees it, and RL10 has no app id to join it to (D11). `session.status` and every other command naming the id answer as for an id with no row. The exceptions are the ones D3, D4 and D10 define.
- **No surface.** The handshake skips `ui_attach` and `ui_panes` (`surface.ts`), so no plugin pane, roster, focus request or prompt ask can reach a window. The engine may still send surface requests before attach. The host answers them itself and forwards nothing: `ui_copy` with `copied: false` (the clipboard untouched), `ui_prompt_read` with an empty box, `ui_prompt_fill` with `filled: false`, `ui_prompt_suggest` with `shown: false`. A decoded `plugin.toast` is dropped.
- **In the budget.** The budget sheets' lists leave the row out. Under memory pressure, the budget releases it before any idle session.
- **Interest and idle release** treat it as a row (D9).

**D3 · Nothing durable, and it dies with its owner** (the roster mark and its end are the native host's, R4-1; the sequence map is staged with the journal, R4-2; the owner is the spine root, R4-7; the buffer is capped, R4-8).
- **On disk.** The journal rows of an uncommitted row (spawn, initialize, hook frames) are kept in memory. The state file, the stored spec and the observed facts are not written. All of them are flushed at commit.
- **The session host's roster entry** carries `prestart: true` until commit. It is the one on-disk trace, and its only reader is a successor host. A successor stops such a host rather than adopting it (`holder/adopt.ts`), and so does a handover's drain.
- **Killing.** "Kill" means stop the engine and drop the row: no released set entry, no files left.
- **What kills it:**
  - the owning connection ends (a spine or `mawsd` restart);
  - the host restarts;
  - `session.forget` or `session.stop` on the id (an intent's discard, D9);
  - a mismatched or plain `session.launch` (D4);
  - `withdraw` for its generation (D8);
  - the idle release and the budget (D9).

The spine keeps no state that outlives it (D10). Its recovery never meets a prestart: once the host restarts or the connection ends, the engine is gone.

**D4 · Commit is one host operation: `session.launch` with `adopt`** (its order is set by R4-1, R4-3 and R4-5, its precondition by R4-9). At Send, `runIntentSetup` runs exactly as today. The only difference is that `launchOnHost` sends `adopt: { key }` beside the spec. The host handles it under the id's serialization:
- **Adopt** when all of these hold:
  - an uncommitted row exists for the id;
  - its spec equals the given spec, ignoring `sessionId` (the pin the guards minted);
  - its key equals the given key;
  - the engine binary it was spawned with is the one the host is configured with now (finding R2-7);
  - it has not exited.

  The host then clears the flag. It flushes the buffered journal, writes the state file and the stored spec, rewrites the roster entry without `prestart`, attaches the surface (now, or in the handshake if that is still running), and emits the row's current status. It answers `launching` with the row's `launchId`, `launchedAt` and engine session id, the same shape as a fresh launch.
- **Otherwise** it kills any uncommitted row for the id and launches the spec as it does today.

Either way the answer is today's `session.launch` answer, and the spine does the rest in today's order:
1. `createForLaunch`;
2. the owner channel's decision and reservation;
3. the spawner proof;
4. `launchOnHost`;
5. `setRoute`;
6. `ownerChannelLaunched`;
7. `progress.launch`;
8. the watch;
9. the binding and the send.

The one addition: when the answer's engine session id differs from the guards' pin (an adoption), the spine writes it into `progress.engineSessionId` right after the answer.

What a crash at any point leaves is what today's launch leaves at the same point. A crash before the commit is a crash before the launch: the provisional record goes, and the intent keeps its message for Retry. A crash after it is a launched session, and recovery hands it off as today. Nothing is written between the host's check and its answer, and the spine sets nothing on the engine between the answer and `session.send` (D6).

**D5 · The key is the spec the host receives, plus what the spec does not carry.**
- **The spec.** The spine builds the prestart's spec through the same path Send uses: the served tool set, `intentLaunchSpec`, the owner channel's decision (computed without writing, D7) and `specForHost`.
- **The key.** It holds what decides the launch but isn't in the spec: the machine route's resolved base URL (`machineBaseUrl`). Without it, two different base URLs that map to the same legacy field would compare equal (round 1, finding 7).
- **No adoption** when the resolution is `unresolved`, or when the machine route goes to a host that doesn't list `engine.route-machine`.
- **The binary identity** is the host's to compare (D4).

**D6 · Every difference relaunches; nothing goes through the control protocol.**
- **What counts as a change:** a different folder, additional directories, route, model, effort, mode, profile, MCP servers, tool set, question tool, owner decision or cua socket changes the spec.
- **While the person types,** the spine asks for a new prestart, and the host replaces the old one (D1).
- **At Send,** any remaining difference means a fresh launch.

M0 showed that mode, model and effort hold when set live (W5). But their answers can carry refusals, a different effective mode, or `ok: false` inside a normal answer (`ipc.ts`), and setting anything on the engine between the check and the send would add a state that recovery does not know. Since the relaunch already happens while the person is typing, all a control path would save is a pick made in the last ~2 s before Send. Claude Desktop does apply model and mode at claim; MAWS gives that up for a recovery with no third state.

**D7 · The owner channel: decided without writing at prestart, reserved at Send before the commit.**
- **At prestart:** `ownerChannelLaunch` runs with `reserve: false`, which decides and writes nothing, so the spec carries the advertisement this launch would get.
- **At Send:** it runs as today. The record exists by then, so the reservation is written before `session.launch`.
- **Does reserving at commit keep R2 ("a 9 that cannot be reserved is never sent")?** Yes:
  - The reservation exists so that MAWS knows what a running launch was told (`src/shared/owner/draws.ts`, header), because the host cannot report it.
  - Before commit nothing reads that. The row is invisible, and the engine has drawn nothing: no turn, no Messages request (W4), and the to-human mod draws only through turns.
  - The reservation is written before the commit, the first moment anything can read the advertisement.
  - If the reservation fails, today's rule turns the advertisement into 8. The spec then differs from the prestart's, and the host launches fresh with 8.
- **Test:** a real owner store with a mod that declares 9.

**D8 · Which composers prestart, and the spawn target.**
- **Eligible:**
  - an intent of kind `create`, with no `lineage` and no `launchedBy`;
  - a location of kind `directory` or `existingWorktree`;
  - no `lastFailure` and no pending bootstrap;
  - no start in flight;
  - every Send guard passing with no card and no bootstrap. That means the location and directory rules, the direct-route model rule, the machine route with neither a refusal nor a sheet, trust already recorded or declined, a healthy relay (cached) on the gateway route, the launch gate, and the served set. The guards are shared with `guardIntentStart` and write nothing.
- **Covered:** a New chat on this machine; the floating chat, which draws the same `Composer`.
- **Not covered:**
  - a new-worktree location, because its checkout does not exist until Send;
  - a trust card or bootstrap;
  - a spawn to another machine;
  - a fork, a side thread or a blank start.
- **The spawn target is a renderer pick** (`useRemoteSpawn`). The composer asks for a prestart only while `spawnTargetOf(tab)` is this machine.
- **Picking another machine** sends `session.intent.prestart.withdraw { appSessionId, generation }` with the generation the composer was given, and leaves the draft alone.
- **The host acts only on that exact generation while it is uncommitted.** A withdraw after a Send has committed it, or after a newer generation has replaced it, does nothing. So no window can withdraw an engine another window has claimed (round 2, finding 6).

**D9 · Reaping, ending and switches.**
- **The idle release.** The row runs under the intent's id. While the New chat's tab is open, the window's interest keeps it. When interest ends (the tab closed, the tab set aside to ⌘⇧T, the window closed or the app quit), the host's `IdleRelease` kills the row after the idle time: `supervisor.idleExitMinutes`, 10 min by default, or 24 h on a server. Memory pressure can kill it sooner.
- **Why no timer of its own:** §4.4 rules out a fixed timer while an app holds a session. Claude Desktop's 10-minute TTL would be the alternative.
- **Discard** (closing a blank or confirmed draft, New chat closing other empty chats, the relaunch sweep) already calls `session.forget` for an id with no record, and that kills the row.
- **Emptying the draft** does not end the prestart.
- **Switches:**
  - with `MAWS_E2E=1`, a prestart happens only under `MAWS_E2E_PRESTART=1`;
  - never under the replay seam or the stub session source, where each launch takes the next fixture.

**D10 · The spine and the trigger** (the spine fences its own request, R4-4).
- **The trigger.** The composer calls `session.intent.prestart { appSessionId }` on the leading edge of the first change that leaves the document non-empty. After that it calls at most once every 10 s while the draft stays non-empty, so a prestart that was killed comes back with the next keystroke.
  - *Beaten:* the draft save, whose 750 ms trailing debounce waits for a pause in typing.
- **The spine:**
  - for an eligible intent, it builds the spec and the key and sends `session.prestart`;
  - for an ineligible one, it answers `skipped` with the reason;
  - it returns the generation either way.
- **What the spine keeps.** It keeps only an in-memory set of the ids it asked for. After an `intent.patch` that changes a launch-relevant field of one of them, it asks again, or withdraws if the intent is no longer eligible. The patch answers once the intent is written, and the request follows. A chip's acknowledgement never waits for a boot, and ticket 854's barrier (Send waits for every write it started) is unchanged.
- **Losing the set** (a spine restart) loses nothing: the host killed those rows when the connection ended.

**D11 · The desk and sminos (step 3 of the coordinator's brief)** (the endpoint's other marks are held, R4-6).
- **The desk cannot show an uncommitted engine as a session.** A sminos member on lane B is listed under its app id, once joined (`rl10/members.ts`, `listingId`). A join comes from one of two sources:
  - `engine.sessions` (`#join`), which leaves out the row (D2);
  - a spawn proof (`#bySpawn`), which a local New chat does not have.

  So both the hub's reports (`#report`) and a direct desk read (`#listings`, `calls.ts`) skip it, because its `listingId` is null. This needs nothing beyond the host flag.
- **One change: re-join at commit.** Today a join is tried when a member is reported, which for a prestart happens before commit, while the row is hidden. Without a retry, a committed session would be listed only at its first Stop. So when the spine reports a new record (`recordChanged`), the endpoint retries the join of any lane B member not yet joined, and the session is listed from Send on.
- **What remains visible:**
  - sminos's own record of the member (alias, membership) and anything sminos itself writes to the project's log at SessionStart. Accepted (Decision Log 2; Known limits 2). Hiding it would take a change in sminos, outside MAWS.
  - Claude Code's own registry of running processes. It is visible only to engine-level tools, and in the same class.

**D12 · Cost and hooks.**
- **Tokens:** none before Send (W4).
- **Hooks:** a prestart runs the person's SessionStart hooks at the keystroke and again at each relaunch. Whatever a hook spends is its own.
- **Memory:** one idle engine and its MCP servers per machine at most (D1, W7).

**D13 · The spare pool stays deferred.** `claim_session` stays unused. A prestart is one engine with one draft's exact spec. Claude Desktop's spare, by contrast, takes the folder at claim and is gated.

**D14 · The measure.**
- **The "before" arm.** It is the flag-off path on this branch, not a master build: with `MAWS_E2E_PRESTART` unset, Send takes exactly today's code path (accepted, Decision Log 2).
- **(a) The regression bound,** group `prestart-latency`, measured.
  - **Setup:** the latency stub engine with a new `LATENCY_STUB_INIT_MS=2000`.
  - **Runs:** paired flag-off and flag-on runs, in alternating order. Each run has 3 s of typing (longer than the 2 s boot), from the first real key press to Send.
  - **Stamps:** in the page, the first `keydown`, the Send press, and the first assistant row painted (the paint marker of `local-latency.spec.ts`). A run whose key-to-Send interval is outside 3 s ± 100 ms is reported and not counted.
  - **The bound:** flag-on's median Send-to-paint is at least 1.5 s below flag-off's.
  - **Engine starts:** counted outside the journal by the stub, one line per process start in `LATENCY_STUB_STARTS_FILE`. Flag-on counts exactly one start per Send.
- **(b) Acceptance,** group `prestart-engine`, measured. It spends nothing.
  - **Setup:** the pinned engine, `MAWS_E2E_ENGINE_BIN` set to a version path that is recorded. The API is the scripted Messages stand-in: `MAWS_RELAY_URL` points at it on the gateway route, and it answers `GET /api/hello` with 200. A scratch config holds three representative SessionStart hooks of 200 ms each.
  - **Runs:** the same paired runs and stamps as (a).
  - **Reported:** both medians and their difference. The live model's own `message_start` time (0.6–1.4 s on 2026-11-23) is the same in both arms, and is reported only as that estimate.
- **A live run** with the owner's hooks spends a message per Send, so it waits for the owner's word.

## Revision 4: the third review's rules

Each rule answers one finding of the third review (`reports/prestart-review-3.md`). Each was checked in the code it cites before it was written. Each rule names its test.

**R4-1 · The durable commit point is the native host's promotion (P1).**
The roster entry is written by the native session host, not by the engine host (`native/session-host/host/host.go` `writeRoster`, `persist`). Today the native protocol has no promotion and no acknowledgement of one (`holder/protocol.ts`).

*Native protocol*
- **Launch.** `launch` gains `prestart: true`. The host writes its roster entry with `prestart: true` from the start.
- **Promote.** A new client message, `{ t: 'promote' }`, makes the host rewrite the entry without the mark. It answers `{ t: 'promoted', ok: true }` only once that write succeeded.
  - A failed write answers `ok: false` with the message, and the entry stays marked. Unlike `persist`, which only warns, a failed promotion is reported back.
  - A second `promote` answers `ok: true` again.
  - A `promote` after the child has exited answers `ok: false`.
- **Writer lost.** A marked host whose writer goes away (connection lost, or no writer at all) ends its child through the stop ladder, then exits. Today a writer's loss arms the no-child exit only when there is no child (`host.go` `reviewNoChild`).
- **Successor.** An engine host reads the marked entry tolerantly and never adopts it. It ends the host (`end`, or the signals) and removes that launch's staged files (R4-2).

*The engine host's adopt (D4), in order*
1. Check the row is claimable (R4-9).
2. Write the staged files (R4-2) and the state file, with the row still hidden.
3. Send `promote` and wait for its answer.
4. On `ok: true`, clear the hidden flag, publish (R4-3) and answer (R4-5).
5. On `ok: false`, or no answer within its bound, end the engine. Remove the staged files, as for a marked successor, and launch fresh.

*What a crash leaves*
- **Before step 3:** a marked holder. Its successor ends it and removes the staged files.
- **After the acknowledgement:** an ordinary, complete launch, which the successor adopts as today. The record already exists, because Send created it before `session.launch`.

*Tests*
- Native, Go, with fault injection through the roster's write seam (`rosterWrite`):
  - a failed promotion write answers `ok: false` and the entry stays marked;
  - a marked host loses its writer: the child ends and the host exits;
  - an unmarked host keeps today's linger;
  - `promote` twice;
  - `promote` after the child's exit.
- TypeScript:
  - the successor ends a marked host and removes its files;
  - an engine host killed between staging and promotion, and right after promotion.
- The prebuilds are rebuilt and `scripts/check-session-host.sh` passes.

**R4-2 · The hosted sequence map is staged with the journal (P1).**
`recordHosted` (`engine-host/session.ts`) appends a `.hseq` line before each hosted row. A successor derives its replay frontier from those lines (`holder/checkpoint.ts`, `readCheckpoint`).

*While hidden*
- The rows and their map lines go to an in-memory stage, with their sequence numbers, timestamps and any retraction.
- The native ring is acknowledged as rows enter the stage. A hidden holder is never replayed, because its successor ends it (R4-1).

*At adopt, step 2*
- The journal file and its map file are written whole: the map line before its row, in the original order, with the original sequence numbers and timestamps.
- The frontier on disk then covers everything acknowledged before the holder becomes adoptable.
- A stage that cannot be written fails the adopt, which goes through R4-1's step 5.

*Tests*, through the native transport (the `hosted-launch` and `adopted-session` suites' harness):
- no `.jsonl` and no `.hseq` exist before Send;
- after promotion, `readCheckpoint` reads a frontier equal to the last acknowledged sequence;
- an engine host killed right after promotion is adopted, and its replay has no gap and no duplicate.

**R4-3 · Every public projection is gated, and a snapshot is published at commit (P1).**
Revision 3's gate covered status, events and `engine.sessions`. The handshake also publishes:
- the command catalogue, once per revision (`session.ts` `publishCatalog`);
- the model list, which feeds a shared cache kept on disk (`session.ts` `emit('models')`);
- the streams' `queue`, `brokerItems` and `checkpoint` (`ipc.ts`).

The host's own counts also read every row (`supervision.ts`).

*Two views of the table*
- `public()` leaves hidden rows out. Every per-row emitter, every stream, every listing and every count clients see reads it: `engine.sessions`, `engine.pendingItems`, the supervisor status and its counts, and the budget's lists.
- `all()` keeps them. The internal readers read it: the idle release, the budget's choice of what to release first, the handover's drain, the orphan ledger, and the filesystem monitor's own-PID set (`engine-host/index.ts`), so the prestart's own registry entry never reads as a foreign holder.

*While hidden*
- The latest catalogue and the latest model list are kept, not emitted.
- Events, queue and broker items are kept within the stage's ceiling (R4-8).

*At commit, step 4*
- Publish the row's current status, queue, broker items, its catalogue (by revision), its model list (so the cache is written once, now) and its kept events.
- Then emit nothing twice.

*Tests*
- During a real handshake, through the scripted engine transport, record every emitted name and every count. None is emitted for the hidden row.
- At commit, each is emitted exactly once.

**R4-4 · The spine fences its own request with an epoch (P1).**
A host admission exists only after the spine's verdict and spec, and those await (the owner channel's style read, `owner/launch.ts`). A discard, a Send or a change of target can complete in between (`sessions/service.ts` `discard`).

*The epoch*
- `session.intent.prestart` sets the intent's epoch before its first await, and returns it as a token.
- These end the current epoch: a discard; a Send (`startSession` marks `starting`); a withdraw; a target change; a newer request for the id.
- Just before dispatching `session.prestart`, the spine checks the epoch is still current. A stale one dispatches nothing.

*Withdraw*
- `session.intent.prestart.withdraw` names the token, not the host's generation.
- Replacements made by a patch keep the token, so the composer that asked can withdraw whatever generation now serves it.
- A withdraw whose token is not current, or that arrives once Send has started, does nothing, so no window cancels another window's claim.

*Tests*
- A request held in the style read while a discard completes, then released: nothing is admitted.
- The same with a Send.
- A patch replacing a generation, then a withdraw by the first token.
- Two windows, with a withdraw arriving after the other window's Send.

**R4-5 · Send's reply never waits for the surface (P1).**
`Surface.attach` awaits `ui_attach` and then `ui_panes` (`surface.ts`), each a bounded control of up to 8 s (`controls.ts`). `session.launch` has 10 s (`REQUEST_TIMEOUT_MS`). A fresh launch already answers before its handshake.

The adopt answers `launching` right after step 4 of R4-1. The surface attaches afterwards, without being awaited. An attach that fails is logged, as today. The setup's watch, installed before dispatch (`setup.ts`), sees the snapshot's single ready status.

*Tests*
- With `ui_attach` and `ui_panes` held for 7 s each, the answer arrives at once.
- One ready notification reaches the watch.
- An attach that fails leaves the session running.

**R4-6 · The endpoint holds a member whose pin is uncommitted (P2).**
RL10 records a member's marks before it is joined:
- the handed-off mark (`rl10/members.ts`, the `#changed` before `#join`);
- the persisted audience (`rl10/policy-cache.ts`);
- the project's presence through `sessionProjects()` (`rl10/link.ts`), which can register a project as known on this machine (`endpoint/registry.ts`).

*The rule*
- The engine host pushes an internal event, `engine.prestart { engineSessionId, state: 'hidden' | 'committed' | 'ended' }`, to its clients. A reconnecting client gets the current hidden set on its welcome.
- The endpoint holds a lane B member whose engine session id is hidden. A held member gets no marks, no audience, no project presence and no listing.
- At `committed`, the endpoint processes it as a member that has just arrived. At `ended`, it drops it with no trace.
- An ordinary unjoined member keeps today's fail-closed marks.

*Tests*
- An abandoned first member of a new project: nothing written to `handed-off.json`, the policy cache or the project registry.
- A committed member: processed, joined and listed. Checked on both the hub's publication and a direct desk read.

**R4-7 · A prestart is owned by the spine root that asked for it (P2).**
`mawsd` can release the spine root (yield, quiet release without re-exec) and keep its link to the engine host (`mawsd/spine-seam.ts`). `hostCall` names no client (`sessions/context.ts`).

*The rule*
- `session.prestart` carries `owner`, the spine root's id, made when the root loads.
- The host ends every hidden row of an owner in two cases: when told `session.prestart.release { owner }`, which `mawsd` sends as it disposes of the root; and when the connection that carried the owner ends.

*Test:* a spine root replaced on the same socket ends its prestarts, and the new root's request is admitted.

**R4-8 · The stage has a byte ceiling (P2).**
Every stderr line is journaled (`session.ts`). The memory budget samples engine process trees, not the host's heap.

*The rule:* the stage (journal rows, map lines, kept events) is capped at 1 MiB. Reaching the cap ends the prestart, and the next Send launches fresh.

*Test:* an engine that writes more stderr than the cap before Send is ended, and Send launches fresh.

**R4-9 · Adopt takes only a claimable row (P2).**
A failed initialize starts the stop at once (`session.ts` `initializeFailed`), and the ladder marks the row exiting before it waits (`session-ladder.ts`).

*The rule:* claimable means all of these:
- the row's lifecycle is starting, initializing or ready;
- it is not exiting, and no ladder, retirement or withdraw is under way;
- no initialize failure has been seen;
- it is hidden;
- its owner (R4-7) is still current.

Anything else launches fresh.

*Test:* a child held in its exit ladder is not adopted, and Send launches fresh.

## The findings of all three reviews

Round 1 reviewed `258d98442`, round 2 `b3ec9b017`, round 3 `0b3277679`. Each row says whether the finding is closed by the structure (S), closed by a specific change (C), or still open (O).

| # | Finding | | How |
|---|---|---|---|
| 1·1 | The record was created before the wait and the controls, so recovery would send the prompt to a mismatched engine. | S | Commit is the launch, in today's order. The host checks before it answers, and nothing is set before the send (D4, D6). |
| 1·2 | `reserveLaunch` refuses a session with no record, so 9 falls to 8. | S | The reservation is written at Send, after `createForLaunch` and before the commit, as today (D7). |
| 1·3 | No owner for a launch in flight. The host awaits before it reserves a row, and the watch was keyed by app id. | S + C | The host registers the admission before any await, and the launcher re-checks it before spawning. The id is serialized in the host, and the watch sees the row only once it is committed (D1, D4). |
| 1·4 | The sweep of intents with no record would erase a failed attempt's evidence. Discard drops the intent even when `forget` fails. | S | There is no sweep and nothing durable. A failed ordinary attempt is never touched (D3, D8). |
| 1·5 | Surface asks and toasts follow the intent's id. The budget sheets list rows with no record. | S | The host does not attach the surface, answers surface requests with negatives, drops toasts, and keeps the row out of the budget's lists (D2). |
| 1·6 | RL10 joins the pin to the app id with no record. | S + C | The row is not in `engine.sessions`, so there is no join. The endpoint re-joins at commit (D11). |
| 1·7 | The key was computed before the route was resolved, and `setRoute` does nothing without a record. | S + C | The key holds the host's spec plus the resolution, and `setRoute` runs in today's order (D4, D5). |
| 1·8 | The control answers carry refusals and `ok: false`. | S | No control path (D6). |
| 1·9 | An adopted prestart's crons seed `unknown`, which blocks the idle release. | S | A successor stops a host whose roster entry says `prestart`; nothing is adopted (D3). |
| 1·10 | The spawn target is a renderer pick. | C | The composer gates on `spawnTargetOf`, and a change withdraws the prestart (D8). |
| 1·11 | Waiting for ready removed the delay by construction, and the journal cannot count starts. | C | Paired runs with a fixed typing interval, the real key and paint stamps, starts counted in a file, and an acceptance group (D14). |
| 2·1 | The record can commit without the owner reservation or route. `launched` swallows write errors. | S | The record, reservation, launch, route and binding run in today's order around today's launch. A failure at any point does what it does for a launch today. That `launched` swallows its write error is today's behaviour for every launch (`owner/launch.ts`); it is outside this change and goes to the tracker (Known limits 6). |
| 2·2 | A lost launch reply cannot be retired by joining a promise. A new spine cannot tell "never dispatched" from "still starting". | S | The admission belongs to the connection, and the host cancels or kills it when that connection ends. A new spine has nothing to retire. The host never releases the id while an admission of the old connection is live, and an ordinary launch on the id kills it first (D1, D3). |
| 2·3 | The desk filter missed publication and expired too soon. | S | There is no filter to expire. A pin is listed only once the host commits it, because only then can it be joined (D11). |
| 2·4 | Plugin panes and clipboard writes still reached the unsent chat. | S | No surface attach before commit. `ui_copy` is answered `copied: false` without touching the clipboard. The panes are fetched at commit (D2, D4). |
| 2·5 | `holder.adopted` is not a one-shot event, so it would retire unrelated drafts. | S | There is no sweep by status. A host restart kills its own uncommitted rows (D3). |
| 2·6 | One window can withdraw another window's claimed engine. | C | Withdraw names a generation. The host acts only on that uncommitted generation, so a withdraw after commit or after a replacement does nothing (D8). |
| 2·7 | The launch key misses the engine binary. | C | The host compares the binary the row was spawned with against the one it is configured with now (D4). |
| 2·8 | The latency bound demanded the whole typing interval as the gain. | C | 3 s of typing against the 2 s stub, a 1.5 s bound, and the real key, Send and paint times recorded (D14). |
| 3·1 | The native child owns the roster, which has no promotion and no acknowledgement; a writer's loss doesn't end a marked holder. | C | Promotion written and acknowledged by the native host is the commit point; a marked holder ends on writer loss; the successor ends it (R4-1). |
| 3·2 | The hosted `.hseq` map is written before each row; buffering only the journal breaks the frontier. | C | Both sequences staged, written whole before promotion (R4-2). |
| 3·3 | The catalogue, the models cache, the streams and the supervision counts project every row. | C | Public and internal views of the table; the kept catalogue, models and events published once at commit (R4-3). |
| 3·4 | The spine's request awaits before admission, so a stale request can admit after a discard. | C | A spine epoch set before the first await and checked before dispatch; withdraw by token (R4-4). |
| 3·5 | The surface attach could time out Send's reply after the commit. | C | The answer comes after promotion; the attach is not awaited (R4-5). |
| 3·6 | RL10 marks, persists the audience and counts the project before a join. | C | The endpoint holds a hidden pin's member until it is committed or ends (R4-6). |
| 3·7 | `mawsd` can release the spine without ending its link. | C | Owner refs per spine root, released at disposal (R4-7). |
| 3·8 | The buffered journal has no ceiling of its own. | C | A 1 MiB stage cap that ends the prestart (R4-8). |
| 3·9 | Adopt took a row that was already terminating. | C | An allow-list of claimable states (R4-9). |

No finding is left open. One trace remains on purpose: the session host's roster entry, marked `prestart` until its promotion is acknowledged (R4-1). Its only reader is the successor that ends it.

## Does the structure close it? (the stop rule)

Yes, for everything MAWS owns.
- **Nothing durable.** A prestart leaves nothing on disk except the roster mark, whose meaning is "stop this host". No reader outside the host sees it. Without it, a host crash could not stop the engine.
- **Nothing visible before commit.** The single host gate (D2) replaces revision 2's seven reader filters and its endpoint filter, and the desk needs no filter at all (D11).
- **What remains visible** is outside MAWS and is a known limit: sminos's membership, and the engine's own process registry. The person's hooks run at the keystroke.

Both reference apps confirm the shape: an in-memory prewarm owned by the process holding the connection, hidden by refusing its id, claimed on a key match, and a cold start on any miss.

**Recommendation: build.** The work is now mostly in the host:
- the admission, the gate, the deferred journal, the adopt branch of `session.launch`, the roster mark and its successor rule;
- in the spine, one field on `launchOnHost`, a stateless prestart command and a patch hook;
- a trigger in the renderer;
- one re-join in the endpoint;
- the measure.

That is smaller than revision 2, and every recovery path is today's.

## Acceptance (ticket 851's "Done when")

- **A1.** Typing in a fresh New chat composer starts its engine with the launch spec as it stands then: folder, model, effort, mode, profile, route and tool set.
  - *Proof:* host and spine unit tests (the prestart's spec equals the one Send builds); e2e `prestart.spec.ts`.
- **A2.** Sending reuses the running engine: one engine start, counted outside the journal, and the record's pin is the engine's.
  - *Proof:* unit tests; e2e.
- **A3.** A change to the launch spec before Send relaunches the engine, and a difference at Send means a fresh launch (D6).
  - *Proof:* unit tests per field; a settings-only change on the machine route; two binaries; the held Tools pick of `e2e/sessions.spec.ts` with prestart on.
- **A4.** An abandoned draft's engine is reaped like an idle session (D9). A connection drop, a host restart, a discard and a withdraw each kill it and leave no file.
  - *Proof:* host unit tests per case; e2e for the blank-tab close.
- **A5.** The spare pool stays deferred (D13).
- **A6.** The first-row time is measured with the flag off and on, on the same Mac (D14).

## Interfaces

    // X2, additive (WIRE_MINOR +1)
    'session.intent.prestart':          { appSessionId } -> { status: 'started' | 'running' | 'skipped'; generation: number | null; reason?: string }   // window -> spine
    'session.intent.prestart.withdraw': { appSessionId, generation } -> void                                                                          // window -> spine -> host
    'session.prestart':                 { spec: LaunchSpec, key: string } -> { status: 'started' | 'running' | 'refused'; generation: number; reason?: string }   // spine -> host
    'session.prestart.withdraw':        { appSessionId, generation } -> void                                                                          // spine -> host
    'session.launch' input:             + adopt?: { key: string }      // D4; its answer is unchanged in shape and carries the engine session id

    // host: the uncommitted flag on the row (D2), its admission (D1), the buffered journal (D3), the roster's `prestart` mark (D3)
    // spine: prestartVerdict(s, intent) and prestartSpec(s, intent) -> { spec, key }, the guards and spec path shared with Send (D5, D8)
    // owner: ownerChannelLaunch(..., { reserve: false }) decides without writing (D7)
    // endpoint: recordChanged retries the join of an unjoined lane B member (D11)

An older host refuses `session.prestart` and ignores `adopt`, so the spine skips the prestart (the capability `engine.prestart` on the welcome says which). An older spine refuses the window's commands, which the window reads as `skipped`.

## Milestones

Each milestone is built test-first, and gets one `doperpowers:reviewer-medium` round of its range. What that round finds that the milestone introduced is fixed; the rest goes to the tracker and Known limits.

### M0 · The probe (done)
- `findings-uxwave-851-prestart.txt`, with four tests in `fixtures.test.mjs`.

### M1 · The native holder
- **Go** (`native/session-host`):
  - `launch` takes `prestart`; the roster entry carries `prestart: true`;
  - `promote` is answered with `promoted { ok }` after the write;
  - a marked host ends its child when its writer is lost;
  - fault injection through `rosterWrite`;
  - the tests of R4-1 in `host_test.go` and `proto_test.go`.
- **TypeScript:**
  - the protocol mirror (`holder/protocol.ts`), the roster schema (`holder/roster.ts`) and the transport's `promote`;
  - the successor's rule for a marked entry (`holder/adopt.ts`): end it, remove its staged files.
- **Prebuilds:** rebuilt with the Go of `go.version` (`pnpm build:session-host`) and committed, with the Go version named. `scripts/check-session-host.sh` must pass.
- **Proof:**
  - `go vet ./... && go test -race ./...`;
  - the check script;
  - vitest over `src/engine-host/holder`;
  - `tsc -p tsconfig.node.json`.

### M2 · The host
- **What:** D1–D4 as amended:
  - the admission with owner refs (R4-7);
  - the hidden flag, with public and internal views (R4-3);
  - the stage, with its map and its cap (R4-2, R4-8);
  - `adopt` in `session.launch`, in R4-1's order, with the claimable check (R4-9) and the answer before the attach (R4-5);
  - the kills, and at most one hidden row;
  - the budget releasing a prestart first;
  - surface requests answered while hidden;
  - the internal `engine.prestart` event (R4-6);
  - the capability `engine.prestart`.
- **Tests first:** D1–D4's list from revision 3, plus the tests of R4-2, R4-3, R4-5, R4-7, R4-8 and R4-9.
- **Proof:** the typecheck; eslint; vitest over `src/engine-host`.

### M3 · The spine and the window
- **What:**
  - the verdict and spec through Send's own functions, with the epoch (R4-4);
  - `reserve: false`;
  - `adopt` on `launchOnHost`, with the engine session id written to progress;
  - the owner ref and its release in `mawsd`;
  - the patch hook;
  - the window's two commands;
  - the trigger, with its spawn-target gate and withdraw by token.
- **Tests:** revision 3's M2 list, plus R4-4's orderings.
- **Proof:**
  - both typechecks, eslint and vitest over the touched directories;
  - the tokens guard;
  - `src/shared/machine`;
  - the desk-web importer check.

### M4 · The endpoint
- **What:** the hold of a hidden pin's member (R4-6), and the re-join at commit (D11).
- **Tests:** R4-6's tests; the re-join on both the hub's publication and a direct read.

### M5 · The measure and the scenes
- **What:** the stub's `LATENCY_STUB_INIT_MS` and `LATENCY_STUB_STARTS_FILE`, and three e2e specs:
  - `prestart-latency` (measured);
  - `prestart-engine` (measured);
  - `prestart.spec.ts`, in the default group, covering D14 and the scenes of revision 3's M3.
- **Registration:** the groups go into `MEASURED_E2E` and the group lists.
- **Proof:** the gate's script tests. The e2e runs go through the architect.

### M6 · The gate
- The checks of the brief, the native suite and its prebuild check, then class 1a once (label `pse`).
- The final branch review is the architect's.

## Known limits

1. The person's SessionStart hooks run at the keystroke, again at each relaunch, and for drafts that are never sent (D12).
2. sminos takes a prestart as a member at SessionStart. An abandoned draft leaves a sminos member that ended without doing any work (D11).
3. A hidden row is not counted as the holder of its folder. A worktree cleanup could therefore remove the folder under a prestart; the next Send then meets the location rule, as today. This is rare and benign.
4. One prestart per machine: drafting in two New chats at once prewarms only the latest (D1).
5. A pick made in the last moments before Send, or a settings change outside the intent, costs that Send a boot (D6).
6. `ownerChannelLaunched` swallows its write error for every launch (today's behaviour, round 2 finding 1). It is logged to the tracker and not changed here.
7. A spawn to another machine does not prestart (D8).
8. A prestart writing more than 1 MiB to its stage before Send is ended, and that Send launches fresh (R4-8).
9. A marked holder whose engine host dies between staging and promotion is ended by the successor, which removes the staged files. A successor of an older build ignores the mark and adopts it as a session with no record, so the uncommitted engine is not ended (Known limit, rare: it needs a downgrade across a crash).

## Progress

- [x] M0 · The probe. (2026-11-24.)
- [x] M1 · The native holder. (2026-11-24, as built: `6e2752e84`..`8da5df5cf`; then its review's fix wave, two P1s and six P2s, `e86f60623` (Go and the three prebuilds, Go 1.25.3) and the TypeScript commit carrying this entry.) R4-1's native protocol and tests are built as written, plus a `discard` the successor sends (Decision Log 9). The successor discards a marked host and never stops it by signals alone. A marked host keeps its entry when it exits, and the successor removes that entry only after the staged files. The decisions R4-1 left open are Decision Logs 8 and 9. Two of R4-1's TypeScript tests, an engine host killed between staging and promotion and right after promotion, need M2's staging and adopt, so they move to M2.
- [x] M2 · The host. (2026-11-24, as built: the commits after `ef3d845b7` on this branch, through the one carrying this entry.) D1–D4 as amended and R4-1 to R4-9's host side, in `src/engine-host/prestart.ts` (the stage, the staged journal and the held store writes) and `prestart-host.ts` (admissions, the hidden row's life, adopt, the kill), with the table's two views (`process-table.ts`), the hidden launch (`launcher.ts` `HiddenLaunch`), the session's hidden handshake (`session.ts`) and the deferred wiring and snapshot (`ipc.ts`). The commands, the event `engine.prestart`, the query `engine.prestarts` and the capability are in the shared schemas, WIRE_MINOR 62. Differences from the plan: a surface ask (`plugin.ask`) is dropped with the toast; `session.stop` and `session.forget` of a hidden id end it and then answer as for no row; the kill takes the row out of the table at once and keeps its process among the ending until its exit (Decision Log 10). The two R4-1 TypeScript tests M1 left to M2 are in `holder/prestart-hosted.test.ts`.
- [ ] M3 · The spine and the window.
- [ ] M4 · The endpoint.
- [ ] M5 · The measure and the scenes.
- [ ] M6 · The gate.

## Decision Log

1. **2026-11-24.** Revision 1, sent to the architect.
2. **2026-11-24.** The architect's answers:
   - a prestart joins sminos at SessionStart (a known limit);
   - the measure's "before" arm is the flag-off path on this branch;
   - M0 runs on the MacBook, isolated.
3. **2026-11-24.** M0: mode, model and effort hold when set before the first message.
4. **2026-11-24.** Revision 2, after round 1's eleven findings: a durable note, the record as the commit point, no control path.
5. **2026-11-24.** Revision 3, after round 2's eight findings and the architect's structural direction:
   - the prestart is ephemeral and host-owned (D1–D3);
   - commit is `session.launch` with `adopt`, inside today's launch path (D4);
   - the key carries the route resolution and the host compares the binary (D4, D5);
   - the reservation is made at Send (D7);
   - withdraw is scoped to a generation (D8);
   - the desk needs only a re-join (D11);
   - the measure uses 3 s of typing (D14).

   Taken from Claude Desktop and Codex: typing as the trigger, at most one prewarm, hidden by refusing its id, a cold start on any miss. Revision 2's note, its seven reader filters and its endpoint filter are gone.
6. **2026-11-24.** The third review (of `0b3277679`): five P1s and four P2s, all checked in the code and all real. The architect and I recommended parking. **The owner chose to fold them in and build.** Revision 4's rules R4-1 to R4-9 answer them. The native holder's work is milestone M1. There is no fourth plan review; each milestone gets one medium review of its range.
7. **2026-11-24. The strongest alternative, recorded:** the engine's own spare, `--await-claim` plus `claim_session`, as Claude Desktop ships it behind a gate (`main-process/index.chunk-BY2YbbTr.js:19840-20094`, `index.chunk-BjORVu2_.js:102488-102631`).
   - *Why it is strong:* a parked spare has no session, no folder and no identity until it is claimed, so nothing would have to be hidden. That removes the cause of every visibility finding.
   - *Why it lost:* the charter defers the spare pool (§P1, ticket 851's "Done when"), and the owner chose this route on 2026-11-24.
   - *Unknowns, if it comes back:* whether SessionStart hooks run at boot or at claim, and how a spare would sit under the native holder; a probe would have to answer both.

8. **2026-11-24. M1's open points, decided while building it:**
   - **Who promotes:** the writer only. An observer is answered `error` ("not the writer"), a superseded writer `fenced`, as for every other writer-only command.
   - **Where the mark is first written:** in the entry `launch` writes, the first that names the session. The entry the host writes at its start names no session, so a successor releases that host as holding no engine. `launch`'s write only warns on failure, as today. The commit then writes the marked entry before the fork, and a failure there fails the spawn. So no child ever runs under an entry without the mark.
   - **The entry's field:** `prestart` is written only while true, so an unmarked or promoted entry reads exactly as before. The `hello` does not carry it: only the successor reads the mark, and it reads the roster.
   - **What `promote` refuses:** a host with no running child (before the spawn, after the reap or the exit) and a host already exiting; both answer `ok: false` with the reason. A launch that is unmarked, or already promoted, is answered `ok: true` with no write.
   - **What counts as the writer's loss:** the writer's connection ends and no pending writer is attaching. The child is then ended at once through the host's own stop path (SIGTERM to its group, `HOST_EXIT_GRACE`, exit), with no grace for a reconnect. The prestart belongs to the connection that asked for it (D3), and a lost prestart costs only a cold Send. A writer superseded by a higher fence is not a loss. "No writer at all" needs no timer of its own: only a writer can set the mark, so a marked host with no writer is one whose writer was lost.
   - **The transport's `promote()`:** it is bounded by the host start's bound (`HOST_START_MS`, 5 s, or the deps' `startMs`), and a caller may pass a shorter one. It resolves with the host's answer, with a refusal when its connection closes, or with a refusal at the bound. It never rejects. It is refused at once when the engine has exited or no writer connection is up (a reconnect under way), so M2's adopt launches fresh instead of waiting. An answer that comes after its bound is skipped as owed, never taken for a later promotion's.
   - **How the successor ends a marked host:** a live one is recorded unattached at the start, never held, so a launch, a forget or a stop all of its session stops it first. It is ended through `stopHeldHost`: SIGTERM to the host, its own stop ladder, then SIGKILL to the child past the grace. Then its launch's `<launchId>.jsonl`, `<launchId>.<n>.jsonl`, `<launchId>.hseq` and `<launchId>.<n>.hseq` are removed from its session's journal directory, whatever the stop's outcome, since no writer is left for them. An end that fails is logged and not counted as a failed adoption: the unattached record guards the engine until it is gone. A dead marked host's staged files are removed along with its other files.

9. **2026-11-24. M1's review (two P1s, six P2s), fixed in one wave.** This entry supersedes Decision Log 8 where they differ.
   - **The entry outlives a marked host (finding 1).** A marked host that exits, for whatever reason, keeps its roster entry: exited, still marked. It is the only record naming the launch's staged files. The successor removes the staged files first and the entry only after that removal succeeded. A dead marked host's cleanup at the start does the same and never throws: a removal that fails is logged and keeps the entry, so the next start retries (finding 7). M2's own discard of a prestart must follow the same order.
   - **The successor's end is decided by the host (finding 2).** A new writer-only message, `{t:'discard'}`, is answered under the host's lock.
     - Still marked: the host answers `{t:'discarded', marked:true}`, closes promotion and admission, ends the child and exits, keeping its entry.
     - Not marked: it answers `marked:false` and does nothing, and the successor adopts it as any host.
     - The successor attaches at the next fence before asking. A predecessor's `promote` (or `commit`) still in its socket is then refused as fenced. Whichever of promote and discard takes the lock first decides.
     - The successor removes staged files only after `marked:true`, and the entry only once the host has also exited (`discardHost` waits through its ladder). A host that cannot be asked is a failed adoption, guarded as unattached.
     - Chosen over a mark in `attached`: the explicit answer names the act and closes promotion in the same step.
     - At its exit the host now writes each connection's queued control lines before closing it, bounded at one second, so the `discarded` answer is never lost to the exit it causes.
   - **The start's record of a marked entry (finding 6).** A marked entry naming a session is held for adoption, not recorded unattached, so a launch of that session is refused until its discard is decided. That covers a `ready` entry whose commit may be in flight. Holding, not an unattached record, because a host found promoted must be adoptable through the ordinary path, and an unattached record would stop it. Where an ordinary host of the same session takes the hold, the marked one is recorded unattached. A failed discard of a marked entry naming a session is recorded unattached even with no child known.
   - **Writer loss (findings 3 and 4).** It closes promotion and admission under the lock that sees the loss. A prestart's end, whether from writer loss or a discard, takes the ladder to SIGKILL of the group past the grace. The host's own signal keeps today's ladder.
   - **A reaped child (finding 5).** `promote` asks the kernel (`kill(pid, 0)`) as well as the reap's record, so a child reaped but not yet recorded is refused. Left open: a child that has exited and is not yet reaped (a zombie) still passes. That case is the same as a child dying just after its promotion, which the engine host reads as any exit.
   - **The transport's `promote` bound (finding 8).** `withinMs` only shortens the host start's bound. The slot of an answer owed after a timeout stays.

10. **2026-11-24. M2's open points, decided while building it.**
   - **One gate in the table.** `get` and `list` became the public view, so every existing reader (each handler naming an id, `engine.sessions`, `engine.pendingItems`, the streams, the supervisor's status and gate counts, the connectors, browser work, the ops ledger's status) leaves a hidden row out with no change of its own. `getAny` and `all` are the internal view, read by the memory sample, the budget's evaluation, a policy change, the orphan ledger, the filesystem monitor's own pids, journal pruning and a stop-all. The supervisor's quiet and its idle exit read the public view: a hidden row holds neither, and what ends the host ends the prestart anyway (its connection's loss, a restart).
   - **No stream until the reveal.** A hidden row has no stream, stored spec or model key in the host. Its events are kept (counted in the stage's ceiling), its latest model list kept, and the rest read from the session at the reveal, which opens the stream and publishes the snapshot once; checkpoints start then. `plugin.ask` is dropped with `plugin.toast`: the engine's surface asks are answered at once while hidden, and one published at commit could reach a window within the 4 s it acts on.
   - **The kill.** The row leaves the table synchronously, so the fresh launch that follows reserves at once without waiting for the ladder; the process stays among the table's ending (the orphan ledger, the own pids, a stop-all) until it exits. Its stop is `stop('stop')`'s ladder. After the exit the launch's staged files are removed, then the session host's entry (`holder/adopt.ts` `clearEndedPrestart`, once the host has exited within its ladder's bound, and only while the entry is still marked; a host still running keeps it for the next start). A hidden row that exits on its own is ended the same way.
   - **The admission** is read after the probes, after the session host's start (the host is then abandoned) and in the step that reserves the row. `session.prestart` answers at once (`started`); its launch runs behind the answer, and a launch that fails or is refused ends the prestart, logged. `refused` (generation 0) answers a replay spec, a released owner and an id with a live public row. `running` needs the same id, spec (but for `sessionId`), key, owner and connection.
   - **Stop and forget** of a hidden id end it and then answer as for an id with no row (a stop is `unknown session`; a forget erases nothing and emits `session.forgotten`). A commit under way is waited for first. Withdraw, the connection's end, the owner's release and a newer prestart leave a committing row alone.
   - **Serialization.** A launch, with or without `adopt`, runs under the id's chain only while a prestart of the id exists or its chain runs; any other launch takes today's path at once.
   - **Held writes.** The session's store is staged as its journal is: the last value of each kind, read back by the loads, written at the commit in the order each kind was first saved; a save after the commit waits for those writes. The observed facts recorder is held until the reveal, and a prestart that ends writes none.
   - **The binary** compared at adopt is the probe's path and version against the plan's `bin` and engine version.
   - **The budget** counts a hidden row's memory in the total, lists and counts it nowhere, and when over takes it before the least recently used row, quiet or not.
   - **No session host** (the embedded shape): a prestart is a direct spawn with nothing to promote; adopt treats the promotion as given. A replay never prestarts.
   - **The answer's engine session id** is today's `session.engineSessionId` in the `launching` answer's status; no field was added.
   - **Seen, not changed (M1's):** a successor that finds a marked host still live in the roster but already exiting (its writer lost, its token removed) cannot ask it to discard, so that adoption counts as failed and the staged files go at the next start. The hosted test covers the dead-host path the writer's loss leads to.

## Outcomes & Retrospective

(At the end.)
